import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { LaMetricAccessory } from './platformAccessory.js';

interface LaMetricDeviceConfig {
  id?: string;
  name: string;
  ip: string;
  port?: number;      // default 4343
  apiKey: string;
  apps?: any[];
}

export class LaMetricPlatform implements DynamicPlatformPlugin {
  private readonly accessories: PlatformAccessory[] = [];

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('LaMetric Platform init');

    this.api.on('didFinishLaunching', () => {
      this.log.debug('LaMetric Platform finished launching');
      this.discoverDevices();
    });
  }

  discoverDevices() {
    // 1) Read device list from config
    const list: LaMetricDeviceConfig[] = [];

    // Preferred: array of devices
    if (Array.isArray((this.config as any).devices) && (this.config as any).devices.length > 0) {
      for (const raw of (this.config as any).devices) {
        if (!raw || !raw.ip || !raw.apiKey) {
          this.log.error(`Invalid device config (missing ip/apiKey): ${JSON.stringify(raw)}`);
          continue;
        }
        list.push({
          id: raw.id,
          name: raw.name || 'LaMetric',
          ip: raw.ip,
          port: Number(raw.port ?? 4343),
          apiKey: raw.apiKey,
          apps: raw.apps ?? [],
        });
      }
    } else {
      // Backward compatible: single device at top-level
      if (!(this.config as any).ip || !(this.config as any).apiKey) {
        this.log.error('Invalid legacy LaMetric config: missing ip or apiKey');
      }
      if ((this.config as any).ip && (this.config as any).apiKey) {
        list.push({
          id: (this.config as any).id,
          name: (this.config as any).name || 'LaMetric',
          ip: (this.config as any).ip,
          port: Number((this.config as any).port ?? 4343),
          apiKey: (this.config as any).apiKey,
          apps: (this.config as any).apps ?? [],
        });
      }
    }

    if (list.length === 0) {
      this.log.warn('No LaMetric devices configured. Add either platform.devices[] or platform.ip/apiKey in config.json.');
      return;
    }

    this.log.info(`Discovered ${list.length} LaMetric device(s) from config`);

    // 2) For each configured device, restore or create accessory
    for (const device of list) {
      this.log.info(`Config for ${device.name}: ip=${device.ip}, port=${device.port}, apps=${device.apps?.length ?? 0}`);
      const stableId = device.id || `${device.ip}:${device.port}`;

      const baseUuid = this.api.hap.uuid.generate(stableId);

      // Helper to find cached accessory by uuid
      const findCached = (u: string) => this.accessories.find(a => a.UUID === u);

      // Define all roles we want to expose as separate accessories
      const roles: Array<{ role: 'tv'|'light'|'speaker'|'crypto'|'wake'; name: string; category: number; uuid: string }>= [
        { role: 'tv',      name: device.name,                 category: this.api.hap.Categories.TELEVISION, uuid: this.api.hap.uuid.generate(stableId + ':tv') },
        { role: 'light',   name: `${device.name} Light`,      category: this.api.hap.Categories.LIGHTBULB,  uuid: this.api.hap.uuid.generate(stableId + ':light') },
        { role: 'speaker', name: `${device.name} Speaker`,    category: this.api.hap.Categories.SPEAKER,    uuid: this.api.hap.uuid.generate(stableId + ':speaker') },
        { role: 'crypto',  name: 'Show Crypto',               category: this.api.hap.Categories.SWITCH,     uuid: this.api.hap.uuid.generate(stableId + ':crypto') },
        { role: 'wake',    name: 'Wake Display',              category: this.api.hap.Categories.SWITCH,     uuid: this.api.hap.uuid.generate(stableId + ':wake') },
      ];

      for (const meta of roles) {
        const cached = findCached(meta.uuid);
        if (cached) {
          this.log.info(`Restoring accessory: ${meta.name} [${meta.role}] (${stableId})`);
          cached.context.device = device;
          cached.context.role = meta.role;
          try {
            cached.category = meta.category;
            const info = cached.getService(this.api.hap.Service.AccessoryInformation)
              || cached.addService(this.api.hap.Service.AccessoryInformation);
            info.setCharacteristic(this.api.hap.Characteristic.Manufacturer, 'LaMetric')
                .setCharacteristic(this.api.hap.Characteristic.Model, 'LaMetric Time')
                .setCharacteristic(this.api.hap.Characteristic.SerialNumber, `${stableId}:${meta.role}`)
                .setCharacteristic(this.api.hap.Characteristic.Name, meta.name);
            this.api.updatePlatformAccessories([cached]);
          } catch (e) {
            this.log.warn('Failed to sync AccessoryInformation for', cached.displayName, e as any);
          }
          new LaMetricAccessory(this, cached);
        } else {
          this.log.info(`Adding accessory: ${meta.name} [${meta.role}] (${stableId})`);
          const accessory = new this.api.platformAccessory(meta.name, meta.uuid);
          accessory.context.device = device;
          accessory.context.role = meta.role;
          accessory.category = meta.category;
          const info = accessory.getService(this.api.hap.Service.AccessoryInformation)
            || accessory.addService(this.api.hap.Service.AccessoryInformation);
          info.setCharacteristic(this.api.hap.Characteristic.Manufacturer, 'LaMetric')
              .setCharacteristic(this.api.hap.Characteristic.Model, 'LaMetric Time')
              .setCharacteristic(this.api.hap.Characteristic.SerialNumber, `${stableId}:${meta.role}`)
              .setCharacteristic(this.api.hap.Characteristic.Name, meta.name);
          new LaMetricAccessory(this, accessory);
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        }
      }
    }
  }

  configureAccessory(accessory: PlatformAccessory) {
    const dev = (accessory.context as any)?.device;
    if (!dev) {
      this.log.warn(`Accessory ${accessory.displayName} has no device context, unregistering.`);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      return;
    }
    const idInfo = ` (${dev.ip}${dev.port ? ':' + dev.port : ''})`;
    this.log.info('Loading accessory from cache:', accessory.displayName + idInfo);
    this.accessories.push(accessory);
    try {
      if (!accessory.category) {
        accessory.category = this.api.hap.Categories.TELEVISION;
      }
    } catch {}
  }
}
