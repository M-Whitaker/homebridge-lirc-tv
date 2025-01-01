import type { API } from 'homebridge';

import { PLATFORM_NAME } from './settings';
import { LIRC } from './platform';

/**
 * This method registers the platform with Homebridge
 */
export default (api: API) => {
  api.registerPlatform(PLATFORM_NAME, LIRC);
};
