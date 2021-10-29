import PlaylistLoader from './playlist-loader.js';
import {parseManifest} from '../manifest.js';
import {mergeMedia} from './utils.js';

/**
 * Calculates the time to wait before refreshing a live playlist
 *
 * @param {Object} media
 *        The current media
 * @param {boolean} update
 *        True if there were any updates from the last refresh, false otherwise
 * @return {number}
 *         The time in ms to wait before refreshing the live playlist
 */
export const timeBeforeRefresh = function(manifest, update) {
  const lastSegment = manifest.segments && manifest.segments[manifest.segments.length - 1];
  const lastPart = lastSegment && lastSegment.parts && lastSegment.parts[lastSegment.parts.length - 1];
  const lastDuration = lastPart && lastPart.duration || lastSegment && lastSegment.duration;

  if (update && lastDuration) {
    return lastDuration * 1000;
  }

  // if the playlist is unchanged since the last reload or last segment duration
  // cannot be determined, try again after half the target duration
  return (manifest.partTargetDuration || manifest.targetDuration || 10) * 500;
};

// clone a preload segment so that we can add it to segments
// without worrying about adding properties and messing up the
// mergeMedia update algorithm.
const clonePreloadSegment = (preloadSegment) => {
  preloadSegment = preloadSegment || {};
  const result = Object.assign({}, preloadSegment);

  if (preloadSegment.parts) {
    result.parts = [];
    for (let i = 0; i < preloadSegment.parts.length; i++) {
      // clone the part
      result.parts.push(Object.assign({}, preloadSegment.parts[i]));
    }
  }

  if (preloadSegment.preloadHints) {
    result.preloadHints = [];
    for (let i = 0; i < preloadSegment.preloadHints.length; i++) {
      // clone the preload hint
      result.preloadHints.push(Object.assign({}, preloadSegment.preloadHints[i]));
    }
  }

  return result;
};

export const getAllSegments = function(manifest) {
  const segments = manifest.segments || [];
  let preloadSegment = manifest.preloadSegment;

  // a preloadSegment with only preloadHints is not currently
  // a usable segment, only include a preloadSegment that has
  // parts.
  if (preloadSegment && preloadSegment.parts && preloadSegment.parts.length) {
    let add = true;

    // if preloadHints has a MAP that means that the
    // init segment is going to change. We cannot use any of the parts
    // from this preload segment.
    if (preloadSegment.preloadHints) {
      for (let i = 0; i < preloadSegment.preloadHints.length; i++) {
        if (preloadSegment.preloadHints[i].type === 'MAP') {
          add = false;
          break;
        }
      }
    }

    if (add) {
      preloadSegment = clonePreloadSegment(preloadSegment);

      // set the duration for our preload segment to target duration.
      preloadSegment.duration = manifest.targetDuration;
      preloadSegment.preload = true;

      segments.push(preloadSegment);
    }
  }

  if (manifest.skip) {
    manifest.segments = manifest.segments || [];
    // add back in objects for skipped segments, so that we merge
    // old properties into the new segments
    for (let i = 0; i < manifest.skip.skippedSegments; i++) {
      manifest.segments.unshift({skipped: true});
    }
  }

  return segments;
};

const parseManifest_ = function(options) {
  const parsedMedia = parseManifest(options);

  // TODO: this should go in parseManifest, as it
  // always needs to happen directly afterwards
  parsedMedia.segments = getAllSegments(parsedMedia);

  return parsedMedia;
};

class HlsMediaPlaylistLoader extends PlaylistLoader {

  parseManifest_(manifestString, callback) {
    const parsedMedia = parseManifest_({
      onwarn: ({message}) => this.logger_(`m3u8-parser warn for ${this.uri()}: ${message}`),
      oninfo: ({message}) => this.logger_(`m3u8-parser info for ${this.uri()}: ${message}`),
      manifestString,
      customTagParsers: this.options_.customTagParsers,
      customTagMappers: this.options_.customTagMappers,
      experimentalLLHLS: this.options_.experimentalLLHLS
    });

    const {media, updated} = mergeMedia({
      oldMedia: this.manifest_,
      newMedia: parsedMedia,
      baseUri: this.uri()
    });

    this.mediaRefreshTime_ = timeBeforeRefresh(media, updated);

    callback(media, updated);
  }

  start() {
    // if we already have a vod manifest then we never
    // need to re-request it.
    if (this.manifest() && this.manifest().endList) {
      this.started_ = true;
      return;
    }

    super.start();
  }

}

export default HlsMediaPlaylistLoader;
