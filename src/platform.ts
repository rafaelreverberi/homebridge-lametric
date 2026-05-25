import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { LaMetricAccessory } from './platformAccessory.js';

interface LaMetricDeviceConfig {
  id?: string;
  name: string;
  ip: string;
  port?: number;      // default 4343
  apiKey: string;
  apps?: any[];
  actions?: any[];
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
      let sawNonBlankDeviceConfig = false;

      for (const raw of (this.config as any).devices) {
        if (!raw || !raw.ip || !raw.apiKey) {
          if (this.isBlankDeviceConfig(raw)) {
            continue;
          }
          sawNonBlankDeviceConfig = true;
          this.log.error(`Invalid device config (missing ip/apiKey): ${JSON.stringify(raw)}`);
          continue;
        }
        sawNonBlankDeviceConfig = true;
        list.push({
          id: raw.id,
          name: raw.name || 'LaMetric',
          ip: raw.ip,
          port: Number(raw.port ?? 4343),
          apiKey: raw.apiKey,
          apps: raw.apps ?? [],
          actions: raw.actions ?? [],
        });
      }

      if (list.length === 0 && sawNonBlankDeviceConfig) {
        this.log.warn('No valid entries found in platform.devices[]. Falling back to top-level ip/apiKey configuration.');
      }
    }

    // Backward compatible: single device at top-level
    if (list.length === 0) {
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
          actions: (this.config as any).actions ?? [],
        });
      }
    }

    if (list.length === 0) {
      this.log.warn('No LaMetric devices configured. Add either platform.devices[] or platform.ip/apiKey in config.json.');
      return;
    }

    this.log.info(`Discovered ${list.length} LaMetric device(s) from config`);

    const configuredDevices = list.map((device) => ({
      device,
      stableId: this.getStableId(device, list.length),
    }));

    const desiredUuids = new Set(
      configuredDevices.map(({ stableId }) => this.api.hap.uuid.generate(`${stableId}:tv`)),
    );
    const staleDeviceAccessories = this.accessories.filter(accessory =>
      (accessory.context as any)?.role === 'device' && !desiredUuids.has(accessory.UUID),
    );
    if (staleDeviceAccessories.length > 0) {
      this.log.info(`Removing ${staleDeviceAccessories.length} stale LaMetric accessory/accessories from cache`);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, staleDeviceAccessories);
    }

    // 2) For each configured device, restore or create accessory
    for (const { device, stableId } of configuredDevices) {
      this.log.info(`Config for ${device.name}: ip=${device.ip}, port=${device.port}, apps=${device.apps?.length ?? 0}`);

      // Helper to find cached accessory by uuid
      const findCached = (u: string) => this.accessories.find(a => a.UUID === u);

      // v1.1 exposes one HomeKit accessory per physical LaMetric. Remove cached
      // split-role accessories from v1.0 so Home doesn't keep stale tiles.
      const legacyUuids = ['light', 'speaker', 'crypto', 'wake']
        .map(role => this.api.hap.uuid.generate(`${stableId}:${role}`));
      const legacyAccessories = this.accessories.filter(accessory => legacyUuids.includes(accessory.UUID));
      if (legacyAccessories.length > 0) {
        this.log.info(`Removing ${legacyAccessories.length} legacy split accessory/accessories for ${device.name}`);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, legacyAccessories);
      }

      const uuid = this.api.hap.uuid.generate(`${stableId}:tv`);
      const cached = findCached(uuid);

      if (cached) {
        this.log.info(`Restoring accessory: ${device.name} (${stableId})`);
        cached.context.device = device;
        cached.context.role = 'device';
        try {
          cached.category = this.api.hap.Categories.TELEVISION;
          const info = cached.getService(this.api.hap.Service.AccessoryInformation)
            || cached.addService(this.api.hap.Service.AccessoryInformation);
          info.setCharacteristic(this.api.hap.Characteristic.Manufacturer, 'LaMetric')
            .setCharacteristic(this.api.hap.Characteristic.Model, 'LaMetric Time')
            .setCharacteristic(this.api.hap.Characteristic.SerialNumber, stableId)
            .setCharacteristic(this.api.hap.Characteristic.Name, device.name);
          this.api.updatePlatformAccessories([cached]);
        } catch (e) {
          this.log.warn('Failed to sync AccessoryInformation for', cached.displayName, e as any);
        }
        new LaMetricAccessory(this, cached);
      } else {
        this.log.info(`Adding accessory: ${device.name} (${stableId})`);
        const accessory = new this.api.platformAccessory(device.name, uuid);
        accessory.context.device = device;
        accessory.context.role = 'device';
        accessory.category = this.api.hap.Categories.TELEVISION;
        const info = accessory.getService(this.api.hap.Service.AccessoryInformation)
          || accessory.addService(this.api.hap.Service.AccessoryInformation);
        info.setCharacteristic(this.api.hap.Characteristic.Manufacturer, 'LaMetric')
          .setCharacteristic(this.api.hap.Characteristic.Model, 'LaMetric Time')
          .setCharacteristic(this.api.hap.Characteristic.SerialNumber, stableId)
          .setCharacteristic(this.api.hap.Characteristic.Name, device.name);
        new LaMetricAccessory(this, accessory);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
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

  private getStableId(device: LaMetricDeviceConfig, totalDevices: number): string {
    if (device.id) {
      return device.id;
    }

    if (totalDevices === 1) {
      return device.name || 'LaMetric';
    }

    return `${device.ip}:${device.port}`;
  }

  private isBlankDeviceConfig(raw: any): boolean {
    if (!raw || typeof raw !== 'object') {
      return true;
    }

    const hasIdentity = Boolean(raw.id || raw.ip || raw.apiKey);
    const hasApps = Array.isArray(raw.apps) && raw.apps.length > 0;
    const hasEnabledActions = Array.isArray(raw.actions) && raw.actions.some((action: any) => action?.enabled !== false);

    return !hasIdentity && !hasApps && !hasEnabledActions;
  }
}
