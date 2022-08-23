/**
 * Provides a compatibility layer between Video.js 7 and 8 API changes for VHS.
 */
import videojs from 'video.js';

/**
 * Delegates to videojs.obj.merge (Video.js 8) or videojs.mergeOptions (Video.js 7).
 */
export function merge(...args) {
  const context = videojs.obj || videojs;
  const fn = context.merge || context.mergeOptions;

  return fn.apply(context, args);
}
