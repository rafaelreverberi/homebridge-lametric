import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { LaMetricPlatform } from './platform';
import fetch from 'node-fetch';
import https from 'https';

export class LaMetricAccessory {
  private service: Service;
  private brightnessService?: Service;
  private agent = new https.Agent({ rejectUnauthorized: false });
  private cryptoTimer?: NodeJS.Timeout;
  private cryptoSessionId = 0;
  private wakeTimer?: NodeJS.Timeout;
  private lastAppBeforeWake: { package: string; widget: string; name?: string } | null = null;

  private get device() {
    const ctx = (this.accessory.context as any)?.device ?? {};
    return {
      ip: ctx.ip ?? this.platform.config.ip,
      port: ctx.port ?? 4343,
      apiKey: ctx.apiKey ?? this.platform.config.apiKey,
    } as { ip: string; port: number; apiKey: string };
  }

  private get apps(): Array<{ id?: string; name?: string; package: string; widget: string }> {
    const ctx = (this.accessory.context as any)?.device ?? {};
    return Array.isArray(ctx.apps) ? ctx.apps : [];
  }

  private async fetchAppsFromDevice(): Promise<Array<{ id?: string; name?: string; package: string; widget: string }>> {
    try {
      const data = await this.request('GET', '/api/v2/device/apps');
      if (data && typeof data === 'object') {
        const appsList: Array<{ id?: string; name?: string; package: string; widget: string }> = [];
        for (const [pkg, app] of Object.entries<any>(data)) {
          if (app && app.widgets) {
            for (const wid of Object.keys(app.widgets)) {
              appsList.push({
                id: wid,
                name: app.title ?? pkg,
                package: pkg,
                widget: wid,
              });
            }
          }
        }
        return appsList;
      }
    } catch (e) {
      this.platform.log.warn('Failed to fetch apps from device', e as any);
    }
    return [];
  }

  private findApp(key: string) {
    return this.apps.find(a => a.id === key || a.name === key || a.package === key);
  }

  // Robustly find an app by id/name/package from config or device
  private async findAppAny(key: string): Promise<{ package: string; widget: string; name?: string } | null> {
    // Try config-defined apps first
    const fromConfig = this.apps.find(a => a.id === key || a.name?.toLowerCase() === key.toLowerCase() || a.package === key);
    if (fromConfig) {
      return { package: fromConfig.package, widget: fromConfig.widget, name: fromConfig.name };
    }
    // Fallback: fetch from device
    const fromDevice = await this.fetchAppsFromDevice();
    const m = fromDevice.find(a => a.id === key || a.name?.toLowerCase() === key.toLowerCase() || a.package === key);
    return m ? { package: m.package, widget: m.widget, name: m.name } : null;
  }

  private async activateWidget(app: { package: string; widget: string }) {
    const path = `/api/v2/device/apps/${app.package}/widgets/${app.widget}/activate`;
    this.platform.log.info(`Activating widget: ${app.package} widget=${app.widget}`);
    return await this.request('PUT', path);
  }

  private async getForegroundApp(): Promise<{ title?: string; package?: string; widget?: string } | null> {
    const data = await this.request('GET', '/api/v2/device/apps');
    try {
      // data is an object keyed by package; each value has widgets map with visible flags
      for (const [pkg, app] of Object.entries<any>(data as any)) {
        if (app && app.widgets) {
          for (const [wid, w] of Object.entries<any>(app.widgets)) {
            if (w && w.visible === true) {
              this.platform.log.info(`Foreground app detected: ${app.title ?? pkg} (${pkg}) widget=${wid}`);
              return { title: app.title, package: pkg, widget: wid };
            }
          }
        }
      }
    } catch (e) {
      this.platform.log.warn('Failed to parse foreground app', e as any);
    }
    return null;
  }

  private async computeActive(): Promise<0 | 1> {
    // Rule: if foreground is "blackout" app → INACTIVE; if foreground is "clock" or anything else → ACTIVE
    const blackout = this.findApp('blackout') || this.findApp('com.lametric.bc174be97cb45248d1b7f6003ed71600');
    try {
      const fg = await this.getForegroundApp();
      if (fg?.package) {
        if (blackout && fg.package === blackout.package) {
          this.platform.log.info('computeActive → blackout foreground → INACTIVE');
          return 0;
        }
        // any non-blackout in foreground counts as active (including clock)
        this.platform.log.info('computeActive → non-blackout foreground → ACTIVE');
        return 1;
      }
    } catch (e) {
      this.platform.log.warn('computeActive (apps) failed, will fallback to display', e as any);
    }

    // Fallback to display info
    try {
      const info = await this.getDeviceInfo();
      const display = info?.display;
      if (!display) {
        return 0;
      }
      const enabled = display.enabled !== false;
      const b = typeof display.brightness === 'number' ? display.brightness : 0;
      const val: 0 | 1 = (enabled && b >= 2) ? 1 : 0;
      this.platform.log.info(`computeActive (fallback display) → ${val ? 'ACTIVE' : 'INACTIVE'} (brightness=${b})`);
      return val;
    } catch (e) {
      this.platform.log.warn('computeActive fallback failed', e as any);
      return 1; // avoid spinner in Home app
    }
  }

  constructor(
    private readonly platform: LaMetricPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    const Service = this.platform.api.hap.Service;
    const Characteristic = this.platform.api.hap.Characteristic;
    const role: string = (this.accessory.context as any)?.role ?? 'tv';

    // Helper to set a sane device/display name
    const dev = (this.accessory.context as any)?.device;
    const deviceName = dev?.name || this.accessory.displayName || 'LaMetric';

    // === ROLE: LIGHT (only brightness slider) ===
    if (role === 'light') {
      // Reuse brightnessService slot for Lightbulb
      this.brightnessService = this.accessory.getService(Service.Lightbulb)
        || this.accessory.addService(Service.Lightbulb, 'Display Brightness', 'lametric-display-brightness');
      // For type safety, point service to the same service (not used outside)
      this.service = this.brightnessService;

      this.brightnessService.setCharacteristic(Characteristic.Name, 'Display Brightness');

      this.brightnessService.getCharacteristic(Characteristic.On)
        .onGet(async () => (await this.computeActive()) === Characteristic.Active.ACTIVE)
        .onSet(async (v) => {
          await this.setActive(!!v);
        });

      this.brightnessService.getCharacteristic(Characteristic.Brightness)
        .onGet(this.getBrightness.bind(this))
        .onSet(this.setBrightness.bind(this));

      // Periodic refresh: keep brightness/active in sync
      setInterval(async () => {
        try {
          const active = await this.computeActive();
          let brightness: number | undefined;
          try {
            const info = await this.getDeviceInfo();
            const display = info?.display ?? {};
            if (typeof display.brightness === 'number') {
              brightness = display.brightness;
            }
          } catch {}
          if (this.brightnessService) {
            this.brightnessService.updateCharacteristic(Characteristic.On, active === 1);
            if (typeof brightness === 'number') {
              this.brightnessService.updateCharacteristic(Characteristic.Brightness, Math.max(2, brightness));
            }
          }
        } catch (e) {
          this.platform.log.warn('Light status refresh failed', e as any);
        }
      }, 15000);

      return; // light accessory done
    }

    // === ROLE: SPEAKER (volume/mute only) ===
    if (role === 'speaker') {
      // Use TelevisionSpeaker as standalone control
      const speakerService = this.accessory.getService(Service.TelevisionSpeaker)
        || this.accessory.addService(Service.TelevisionSpeaker, 'Speaker');
      // Assign to service to satisfy class field (not otherwise used here)
      this.service = speakerService;

      speakerService.setCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE);
      speakerService.setCharacteristic(Characteristic.VolumeControlType, Characteristic.VolumeControlType.ABSOLUTE);

      speakerService.getCharacteristic(Characteristic.Volume)
        .onGet(this.getVolume.bind(this))
        .onSet(this.setVolume.bind(this));

      speakerService.getCharacteristic(Characteristic.Mute)
        .onGet(async () => {
          try {
            const info = await this.getDeviceInfo();
            return (info?.audio?.volume ?? 0) === 0;
          } catch {
            return false;
          }
        })
        .onSet(async (v) => {
          try {
            await this.request('PUT', '/api/v2/device/audio', { volume: v ? 0 : 50 });
          } catch (e) {
            this.platform.log.error('Failed to set mute', e);
          }
        });

      return; // speaker accessory done
    }

    // === ROLE: CRYPTO (stateless switch) ===
    if (role === 'crypto') {
      const cryptoSwitch = this.accessory.getService('Show Crypto')
        || this.accessory.addService(Service.Switch, 'Show Crypto', 'switch-show-crypto');
      cryptoSwitch.setCharacteristic(Characteristic.Name, 'Show Crypto');
      // Assign service for completeness
      this.service = cryptoSwitch;

      const OnChar = Characteristic.On;
      const SHOW_CRYPTO_MS = 80500; // tuned value

      cryptoSwitch.getCharacteristic(OnChar)
        .onGet(() => false)
        .onSet(async (v) => {
          try {
            if (v) {
              if (this.cryptoTimer) {
                clearTimeout(this.cryptoTimer);
                this.cryptoTimer = undefined;
              }
              const session = Date.now();
              this.cryptoSessionId = session;
              let crypto = await this.findAppAny('crypto');
              if (!crypto) {
                crypto = {
                  package: 'com.lametric.439e235927e03d3f184562dd909174bf',
                  widget: '99113d90618f445a8b299f0f1d2c94d4',
                  name: 'Crypto',
                };
              }
              await this.activateWidget(crypto);
              cryptoSwitch.updateCharacteristic(OnChar, false);
              this.cryptoTimer = setTimeout(async () => {
                if (this.cryptoSessionId !== session) {
                  return;
                }
                try {
                  const clock = this.findApp('clock') || this.findApp('com.lametric.clock');
                  if (clock) {
                    await this.activateWidget(clock);
                  }
                } catch {} finally {
                  if (this.cryptoSessionId === session) {
                    this.cryptoTimer = undefined;
                  }
                }
              }, SHOW_CRYPTO_MS);
            } else {
              if (this.cryptoTimer) {
                clearTimeout(this.cryptoTimer);
                this.cryptoTimer = undefined;
              }
              this.cryptoSessionId = 0;
              const clock = this.findApp('clock') || this.findApp('com.lametric.clock');
              if (clock) {
                await this.activateWidget(clock);
              }
              cryptoSwitch.updateCharacteristic(OnChar, false);
            }
          } catch (e) {
            this.platform.log.error('Show Crypto switch failed', e as any);
            cryptoSwitch.updateCharacteristic(OnChar, false);
          }
        });

      return; // crypto accessory done
    }

    // === ROLE: WAKE (stateless switch) ===
    if (role === 'wake') {
      const wakeSwitch = this.accessory.getService('Wake Display')
        || this.accessory.addService(Service.Switch, 'Wake Display', 'switch-wake-display');
      wakeSwitch.setCharacteristic(Characteristic.Name, 'Wake Display');
      this.service = wakeSwitch;

      const OnChar = Characteristic.On;
      const WAKE_DURATION = 5000; // 5s
      const WAKE_MAX_BRIGHTNESS = 25; // softer at night
      const WAKE_STEP = 5;
      const STEP_INTERVAL = 200;

      wakeSwitch.getCharacteristic(OnChar)
        .onGet(() => false)
        .onSet(async (v) => {
          try {
            if (v) {
              if (this.wakeTimer) {
                clearTimeout(this.wakeTimer);
                this.wakeTimer = undefined;
              }
              const fg = await this.getForegroundApp();
              this.lastAppBeforeWake = (fg && fg.package && fg.widget) ? { package: fg.package, widget: fg.widget, name: fg.title } : null;
              await this.setBrightness(2);
              const clock = this.findApp('clock') || this.findApp('com.lametric.clock');
              if (clock) {
                await this.activateWidget(clock);
              }
              let current = 2;
              const brighten = setInterval(async () => {
                if (current < WAKE_MAX_BRIGHTNESS) {
                  current += WAKE_STEP;
                  await this.setBrightness(current);
                } else {
                  clearInterval(brighten);
                }
              }, STEP_INTERVAL);

              this.wakeTimer = setTimeout(async () => {
                clearInterval(brighten);
                // dim back down smoothly to 2
                let down = WAKE_MAX_BRIGHTNESS;
                while (down > 2) {
                  down -= WAKE_STEP;
                  await this.setBrightness(down);
                  await new Promise(res => setTimeout(res, STEP_INTERVAL));
                }
                await this.setBrightness(2);
                if (this.lastAppBeforeWake) {
                  try {
                    await this.activateWidget(this.lastAppBeforeWake);
                    await new Promise(r => setTimeout(r, 1200));
                    await this.setBrightness(100);
                  } catch {}
                }
                this.wakeTimer = undefined;
              }, WAKE_DURATION);

              wakeSwitch.updateCharacteristic(OnChar, false);
            } else {
              if (this.wakeTimer) {
                clearTimeout(this.wakeTimer);
                this.wakeTimer = undefined;
              }
              this.lastAppBeforeWake = null;
              wakeSwitch.updateCharacteristic(OnChar, false);
            }
          } catch (e) {
            this.platform.log.error('Wake Display switch failed', e as any);
            wakeSwitch.updateCharacteristic(OnChar, false);
          }
        });

      return; // wake accessory done
    }

    // === ROLE: TV (default) – only TV with Active + Input list ===
    this.service = this.accessory.getService(Service.Television)
      || this.accessory.addService(Service.Television);

    this.service.setCharacteristic(Characteristic.Name, deviceName);
    this.service.setCharacteristic(Characteristic.ConfiguredName, deviceName);
    this.service.setCharacteristic(Characteristic.SleepDiscoveryMode, Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);

    // Power state (maps to blackout/clock via setActive)
    this.service.getCharacteristic(Characteristic.Active)
      .onGet(this.getActive.bind(this))
      .onSet(this.setActive.bind(this));

    // Optional hardware button mapping (keep if you use it)
    this.service.getCharacteristic(Characteristic.VolumeSelector)
      .onSet(this.setVolume.bind(this));

    // Input sources
    const tvService = this.service;
    (async () => {
      const InputSource = Service.InputSource;

      // hash helper for stable IDs
      function hashId(str: string): number {
        let hash = 2166136261;
        for (let i = 0; i < str.length; i++) {
          hash ^= str.charCodeAt(i);
          hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
        }
        return Math.abs(hash >>> 0) % 2147483647;
      }

      const fromConfig = Array.isArray(this.apps) ? this.apps : [];
      const fromDevice = await this.fetchAppsFromDevice();
      const byKey = new Map<string, { id?: string; name?: string; package: string; widget: string }>();
      for (const app of [...fromDevice, ...fromConfig]) {
        const key = `${app.package}-${app.widget}`;
        byKey.set(key, { id: app.id, name: app.name, package: app.package, widget: app.widget });
      }
      const appsList = Array.from(byKey.values());
      this.platform.log.info(`InputSources: using ${appsList.length} apps (config=${fromConfig.length}, device=${fromDevice.length})`);

      // cleanup old inputs not in desired set
      const desiredKeys = new Set(appsList.map(a => `${a.package}-${a.widget}`));
      const existingInputs = this.accessory.services.filter(s => s.UUID === InputSource.UUID);
      for (const s of existingInputs) {
        const subtype: string | undefined = (s as any).subtype;
        if (!subtype || !desiredKeys.has(subtype)) {
          try {
            this.accessory.removeService(s);
          } catch {}
        }
      }

      const idToApp = new Map<number, typeof appsList[0]>();
      const subtypeToId = new Map<string, number>();

      appsList.forEach((app) => {
        const subtype = `${app.package}-${app.widget}`;
        const stableId = hashId(subtype);
        idToApp.set(stableId, app);
        subtypeToId.set(subtype, stableId);
        const input = this.accessory.getService(subtype)
          || this.accessory.addService(InputSource, app.name ?? app.package, subtype);
        input
          .setCharacteristic(Characteristic.Identifier, stableId)
          .setCharacteristic(Characteristic.Name, app.name ?? app.package)
          .setCharacteristic(Characteristic.ConfiguredName, app.name ?? app.package)
          .setCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED)
          .setCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.APPLICATION);
        tvService.addLinkedService(input);
      });

      tvService.getCharacteristic(Characteristic.ActiveIdentifier)
        .onGet(async () => {
          try {
            const fg = await this.getForegroundApp();
            if (fg) {
              const subtype = `${fg.package}-${fg.widget}`;
              const stableId = subtypeToId.get(subtype);
              if (typeof stableId === 'number') {
                return stableId;
              }
            }
          } catch {}
          return appsList.length > 0 ? hashId(`${appsList[0].package}-${appsList[0].widget}`) : 0;
        })
        .onSet(async (id) => {
          const app = idToApp.get(id as number);
          if (app) {
            // Ensure TV is active before switching
            const Active = Characteristic.Active;
            const current = tvService.getCharacteristic(Active).value as number | undefined;
            if (current !== Active.ACTIVE) {
              tvService.updateCharacteristic(Active, Active.ACTIVE);
            }
            await this.activateWidget(app);
            this.platform.log.info(`Switched to app: ${app.name ?? app.package}`);
          }
        });
    })();

    // Periodic status refresh: only for TV power state (no brightness here)
    setInterval(async () => {
      try {
        const active = await this.computeActive();
        this.service.updateCharacteristic(Characteristic.Active, active);
      } catch (e) {
        this.platform.log.warn('TV status refresh failed', e as any);
      }
    }, 15000);
  }

  private async request(method: 'GET' | 'PUT', path: string, body?: any) {
    const { ip, port } = this.device;
    const url = `https://${ip}:${port}${path}`;
    const payload = body ? JSON.stringify(body) : undefined;

    this.platform.log.info(`[HTTP ${method}] ${url} ${payload ? 'body=' + payload : ''}`);

    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': `Basic ${Buffer.from(`dev:${this.device.apiKey}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: payload,
      // @ts-ignore node-fetch agent type
      agent: this.agent,
    });

    const text = await res.text();
    this.platform.log.info(`[HTTP ${method}] ${res.status} ${res.statusText} response=${text}`);

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async getVolume(): Promise<CharacteristicValue> {
    try {
      const info = await this.getDeviceInfo();
      const v = typeof info?.audio?.volume === 'number' ? info.audio.volume : 50;
      this.platform.log.info(`getVolume → ${v}`);
      return v;
    } catch (e) {
      this.platform.log.error('Failed to get volume', e);
      return 50;
    }
  }

  async setVolume(value: CharacteristicValue) {
    try {
      await this.request('PUT', '/api/v2/device/audio', { volume: value });
      this.platform.log.info(`Volume set to ${value}`);
    } catch (e) {
      this.platform.log.error('Failed to set volume', e);
      throw e;
    }
  }

  async setBrightness(value: CharacteristicValue) {
    const brightness = (typeof value === 'number' ? value : Number(value));
    const safe = brightness === 0 ? 2 : brightness;
    try {
      await this.request('PUT', '/api/v2/device/display', { brightness_mode: 'manual', brightness: safe });
      this.platform.log.info(`Brightness set (requested=${brightness}, sent=${safe})`);
      // Sync UI immediately on the Lightbulb service (if present)
      if (this.brightnessService) {
        this.brightnessService.updateCharacteristic(this.platform.api.hap.Characteristic.Brightness, safe);
      }
    } catch (e) {
      this.platform.log.error('Failed to set brightness', e);
      throw e;
    }
  }

  async getBrightness(): Promise<CharacteristicValue> {
    try {
      const info = await this.getDeviceInfo();
      const b = typeof info?.display?.brightness === 'number' ? info.display.brightness : undefined;
      const val = typeof b === 'number' ? Math.max(2, b) : 100;
      this.platform.log.info(`getBrightness → ${val} (raw=${b})`);
      return val;
    } catch (e) {
      this.platform.log.error('Failed to get brightness', e);
      // Return a sane default to avoid spinner in Home app
      return 100;
    }
  }

  private async getDeviceInfo() {
    // /api/v2/device returns full device object including display/audio
    return await this.request('GET', '/api/v2/device');
  }

  async getActive(): Promise<CharacteristicValue> {
    const active = await this.computeActive();
    this.platform.log.info(`getActive → ${active ? 'ACTIVE' : 'INACTIVE'}`);
    return active;
  }

  async setActive(value: CharacteristicValue) {
    const on = !!value;
    const blackout = this.findApp('blackout') || this.findApp('com.lametric.bc174be97cb45248d1b7f6003ed71600');
    const clock = this.findApp('clock') || this.findApp('com.lametric.clock');

    try {
      if (!on) {
        if (blackout) {
          await this.activateWidget(blackout);
          this.platform.log.info('setActive(false) → blackout widget activated');
        } else {
          await this.request('PUT', '/api/v2/device/display', { brightness_mode: 'manual', brightness: 2 });
          this.platform.log.info('setActive(false) → fallback brightness=2');
        }
        if (this.brightnessService) {
          this.brightnessService.updateCharacteristic(this.platform.api.hap.Characteristic.Brightness, 2);
          this.brightnessService.updateCharacteristic(this.platform.api.hap.Characteristic.On, false);
        }
      } else {
        if (clock) {
          await this.activateWidget(clock);
          this.platform.log.info('setActive(true) → clock widget activated');
        } else {
          await this.request('PUT', '/api/v2/device/display', { brightness_mode: 'manual', brightness: 100 });
          this.platform.log.info('setActive(true) → fallback brightness=100');
        }
        if (this.brightnessService) {
          this.brightnessService.updateCharacteristic(this.platform.api.hap.Characteristic.Brightness, 100);
          this.brightnessService.updateCharacteristic(this.platform.api.hap.Characteristic.On, true);
        }
      }
    } catch (e) {
      this.platform.log.error('Failed to set active state', e);
      throw e;
    }
  }
}
