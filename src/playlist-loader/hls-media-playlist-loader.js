import PlaylistLoader from './playlist-loader.js';
import {parseManifest} from '../manifest.js';
import {mergeOptions} from 'video.js';
import {mergeSegments} from './utils.js';

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
const timeBeforeRefresh = function(manifest, update) {
  const lastSegment = manifest.segments[manifest.segments.length - 1];
  const lastPart = lastSegment && lastSegment.parts && lastSegment.parts[lastSegment.parts.length - 1];
  const lastDuration = lastPart && lastPart.duration || lastSegment && lastSegment.duration;

  if (update && lastDuration) {
    return lastDuration * 1000;
  }

  // if the playlist is unchanged since the last reload or last segment duration
  // cannot be determined, try again after half the target duration
  return (manifest.partTargetDuration || manifest.targetDuration || 10) * 500;
};

export const getAllSegments = function(manifest) {
  const segments = manifest.segments || [];
  const preloadSegment = manifest.preloadSegment;

  // a preloadSegment with only preloadHints is not currently
  // a usable segment, only include a preloadSegment that has
  // parts.
  if (preloadSegment && preloadSegment.parts && preloadSegment.parts.length) {
    // if preloadHints has a MAP that means that the
    // init segment is going to change. We cannot use any of the parts
    // from this preload segment.
    if (preloadSegment.preloadHints) {
      for (let i = 0; i < preloadSegment.preloadHints.length; i++) {
        if (preloadSegment.preloadHints[i].type === 'MAP') {
          return segments;
        }
      }
    }
    // set the duration for our preload segment to target duration.
    preloadSegment.duration = manifest.targetDuration;
    preloadSegment.preload = true;

    segments.push(preloadSegment);
  }

  return segments;
};

const mergeMedia = function(oldMedia, newMedia) {
  const result = {
    mergedMedia: newMedia,
    updated: true
  };

  if (!oldMedia) {
    return result;
  }

  result.mergedManifest = mergeOptions(oldMedia, newMedia);

  // always use the new manifest's preload segment
  if (result.mergedManifest.preloadSegment && !newMedia.preloadSegment) {
    delete result.mergedManifest.preloadSegment;
  }

  newMedia.segments = getAllSegments(newMedia);

  if (newMedia.skip) {
    newMedia.segments = newMedia.segments || [];
    // add back in objects for skipped segments, so that we merge
    // old properties into the new segments
    for (let i = 0; i < newMedia.skip.skippedSegments; i++) {
      newMedia.segments.unshift({skipped: true});
    }
  }

  // if the update could overlap existing segment information, merge the two segment lists
  const {updated, mergedSegments} = mergeSegments(oldMedia, newMedia);

  if (updated) {
    result.updated = true;
  }

  result.mergedManifest.segments = mergedSegments;

  return result;
};

class HlsMediaPlaylistLoader extends PlaylistLoader {

  parseManifest_(manifestString, callback) {
    const parsedMedia = parseManifest({
      onwarn: ({message}) => this.logger_(`m3u8-parser warn for ${this.uri_}: ${message}`),
      oninfo: ({message}) => this.logger_(`m3u8-parser info for ${this.uri_}: ${message}`),
      manifestString,
      customTagParsers: this.options_.customTagParsers,
      customTagMappers: this.options_.customTagMappers,
      experimentalLLHLS: this.options_.experimentalLLHLS
    });
    const updated = true;

    this.mediaRefreshTime_ = timeBeforeRefresh(this.manifest(), updated);

    callback(mergeMedia(this.manifest_, parsedMedia), updated);
  }

  start() {
    // if we already have a vod manifest then we never
    // need to re-request it.
    if (this.manifest() && this.manifest().endList) {
      this.started_ = true;
    }

    super.start();
  }
}

export default HlsMediaPlaylistLoader;
