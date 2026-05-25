import { LaMetricPlatform } from './platform.js';
import { PLATFORM_NAME } from './settings.js';

export default (api: any) => {
  api.registerPlatform(PLATFORM_NAME, LaMetricPlatform);
};
