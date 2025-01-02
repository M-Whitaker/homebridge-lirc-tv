import type { API } from 'homebridge';

import { PLATFORM_NAME } from './settings.js';
import { LIRC } from './platform.js';

/**
 * This method registers the platform with Homebridge
 */
export default (api: API) => {
  api.registerPlatform(PLATFORM_NAME, LIRC);
};
