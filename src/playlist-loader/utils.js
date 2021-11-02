import {mergeOptions} from 'video.js';
import {resolveUrl} from '../resolve-url';
import deepEqual from '../util/deep-equal.js';

/**
 * Get aboslute uris for all uris on a segment unless
 * they are already resolved.
 *
 * @param {Object} segment
 *        The segment to get aboslute uris for.
 *
 * @param {string} baseUri
 *        The base uri to use for resolving.
 *
 * @return {Object}
 *         The segment with resolved uris.
 */
const resolveSegmentUris = function(segment, baseUri) {
  // preloadSegment will not have a uri at all
  // as the segment isn't actually in the manifest yet, only parts
  if (!segment.resolvedUri && segment.uri) {
    segment.resolvedUri = resolveUrl(baseUri, segment.uri);
  }
  if (segment.key && !segment.key.resolvedUri) {
    segment.key.resolvedUri = resolveUrl(baseUri, segment.key.uri);
  }
  if (segment.map && !segment.map.resolvedUri) {
    segment.map.resolvedUri = resolveUrl(baseUri, segment.map.uri);
  }

  if (segment.map && segment.map.key && !segment.map.key.resolvedUri) {
    segment.map.key.resolvedUri = resolveUrl(baseUri, segment.map.key.uri);
  }
  if (segment.parts && segment.parts.length) {
    segment.parts.forEach((p) => {
      if (p.resolvedUri) {
        return;
      }
      p.resolvedUri = resolveUrl(baseUri, p.uri);
    });
  }

  if (segment.preloadHints && segment.preloadHints.length) {
    segment.preloadHints.forEach((p) => {
      if (p.resolvedUri) {
        return;
      }
      p.resolvedUri = resolveUrl(baseUri, p.uri);
    });
  }

  return segment;
};

/**
 * Returns a new segment object with properties and
 * the parts array merged.
 *
 * @param {Object} a
 *        The old segment
 *
 * @param {Object} b
 *        The new segment
 *
 * @return {Object}
 *         The merged segment and if it was updated.
 */
export const mergeSegment = function(a, b) {
  let segment = b;
  let updated = false;

  if (!a) {
    updated = true;
  }

  a = a || {};
  b = b || {};

  segment = mergeOptions(a, b);

  // if only the old segment has preload hints
  // and the new one does not, remove preload hints.
  if (a.preloadHints && !b.preloadHints) {
    updated = true;
    delete segment.preloadHints;
  }

  // if only the old segment has parts
  // then the parts are no longer valid
  if (a.parts && !b.parts) {
    updated = true;
    delete segment.parts;
  // if both segments have parts
  // copy part propeties from the old segment
  // to the new one.
  } else if (a.parts && b.parts) {
    if (a.parts.length !== b.parts.length) {
      updated = true;
    }
    for (let i = 0; i < b.parts.length; i++) {
      if (a.parts && a.parts[i]) {
        segment.parts[i] = mergeOptions(a.parts[i], b.parts[i]);
      }
    }
  }

  // set skipped to false for segments that have
  // have had information merged from the old segment.
  if (!a.skipped && b.skipped) {
    delete segment.skipped;
  }

  // set preload to false for segments that have
  // had information added in the new segment.
  if (a.preload && !b.preload) {
    updated = true;
    delete segment.preload;
  }

  return {updated, segment};
};

/**
 * Merge two segment arrays.
 *
 * @param {Object} options
 *        options for this function
 *
 * @param {Object[]} options.oldSegments
 *        old segments
 *
 * @param {Object[]} options.newSegments
 *        new segments
 *
 * @param {string} options.baseUri
 *        The absolute uri to base aboslute segment uris on.
 *
 * @param {number} [options.offset=0]
 *        The segment offset that should be used to match old
 *        segments to new segments. IE: media sequence segment 1
 *        is segment zero in new and segment 1 in old. Offset would
 *        then be 1.
 *
 * @return {Object[]}
 *         The merged segment array.
 */
export const mergeSegments = function({oldSegments, newSegments, offset = 0, baseUri}) {
  oldSegments = oldSegments || [];
  newSegments = newSegments || [];
  const result = {
    segments: [],
    updated: false
  };

  if (!oldSegments || !oldSegments.length || oldSegments.length !== newSegments.length) {
    result.updated = true;
  }

  let currentMap;

  for (let newIndex = 0; newIndex < newSegments.length; newIndex++) {
    const oldSegment = oldSegments[newIndex + offset];
    const newSegment = newSegments[newIndex];

    const {updated, segment} = mergeSegment(oldSegment, newSegment);

    if (updated) {
      result.updated = updated;
    }

    const mergedSegment = segment;

    // save and or carry over the map
    if (mergedSegment.map) {
      currentMap = mergedSegment.map;
    } else if (currentMap && !mergedSegment.map) {
      result.updated = true;
      mergedSegment.map = currentMap;
    }

    result.segments.push(resolveSegmentUris(mergedSegment, baseUri));
  }
  return result;
};

const MEDIA_GROUP_TYPES = ['AUDIO', 'SUBTITLES'];

/**
 * Loops through all supported media groups in mainManifest and calls the provided
 * callback for each group. Unless true is returned from the callback.
 *
 * @param {Object} mainManifest
 *        The parsed main manifest object
 *
 * @param {Function} callback
 *        Callback to call for each media group,
 *        *NOTE* The return value is used here. Any true
 *        value will stop the loop.
 */
export const forEachMediaGroup = (mainManifest, callback) => {
  if (!mainManifest || !mainManifest.mediaGroups) {
    return;
  }

  for (let i = 0; i < MEDIA_GROUP_TYPES.length; i++) {
    const mediaType = MEDIA_GROUP_TYPES[i];

    if (!mainManifest.mediaGroups[mediaType]) {
      continue;
    }
    for (const groupKey in mainManifest.mediaGroups[mediaType]) {
      if (!mainManifest.mediaGroups[mediaType][groupKey]) {
        continue;
      }
      for (const labelKey in mainManifest.mediaGroups[mediaType][groupKey]) {
        if (!mainManifest.mediaGroups[mediaType][groupKey][labelKey]) {
          continue;
        }
        const mediaProperties = mainManifest.mediaGroups[mediaType][groupKey][labelKey];

        const stop = callback(mediaProperties, mediaType, groupKey, labelKey);

        if (stop) {
          return;
        }
      }
    }
  }
};

/**
 * Loops through all playlists including media group playlists and runs the
 * callback for each one. Unless true is returned from the callback.
 *
 * @param {Object} mainManifest
 *        The parsed main manifest object
 *
 * @param {Function} callback
 *        Callback to call for each playlist
 *        *NOTE* The return value is used here. Any true
 *        value will stop the loop.
 */
export const forEachPlaylist = function(mainManifest, callback) {
  if (!mainManifest) {
    return;
  }
  if (mainManifest.playlists) {
    for (let i = 0; i < mainManifest.playlists.length; i++) {
      const stop = callback(mainManifest.playlists[i], i, mainManifest.playlists);

      if (stop) {
        return;
      }
    }
  }

  forEachMediaGroup(mainManifest, function(properties, type, group, label) {
    if (!properties.playlists) {
      return;
    }

    for (let i = 0; i < properties.playlists.length; i++) {
      const stop = callback(properties.playlists[i], i, properties.playlists);

      if (stop) {
        return stop;
      }
    }
  });
};

/**
 * Shallow merge for an object and report if an update occured.
 *
 * @param {Object} a
 *        The old manifest
 *
 * @param {Object} b
 *        The new manifest
 *
 * @param {string[]} excludeKeys
 *        An array of keys to completly ignore.
 *        *NOTE* properties from the new manifest will still
 *        exist, even though they were ignored
 *
 * @return {Object}
 *         The merged manifest and if it was updated.
 */
export const mergeManifest = function(a, b, excludeKeys) {
  excludeKeys = excludeKeys || [];

  let updated = !a;
  const mergedManifest = b;

  a = a || {};
  b = b || {};

  const keys = [];

  Object.keys(a).concat(Object.keys(b)).forEach(function(key) {
    // make keys unique and exclude specified keys
    if (excludeKeys.indexOf(key) !== -1 || keys.indexOf(key) !== -1) {
      return;
    }
    keys.push(key);
  });

  keys.forEach(function(key) {
    // both have the key
    if (a.hasOwnProperty(key) && b.hasOwnProperty(key)) {
      // if the value is different media was updated
      if (!deepEqual(a[key], b[key])) {
        updated = true;
      }
      // regardless grab the value from the new object
      mergedManifest[key] = b[key];
      // only oldMedia has the key don't bring it over, but media was updated
    } else if (a.hasOwnProperty(key) && !b.hasOwnProperty(key)) {
      updated = true;
      // otherwise the key came from newMedia
    } else {
      updated = true;
      mergedManifest[key] = b[key];
    }
  });

  return {manifest: mergedManifest, updated};
};

/**
 * Shallow merge a media manifest and deep merge it's segments.
 *
 * @param {Object} options
 *        The options for this function
 *
 * @param {Object} options.oldMedia
 *        The old media
 *
 * @param {Object} options.newMedia
 *        The new media
 *
 * @param {string} options.baseUri
 *        The base uri used for resolving aboslute uris.
 *
 * @return {Object}
 *         The merged media and if it was updated.
 */
export const mergeMedia = function({oldMedia, newMedia, baseUri}) {
  const mergeResult = mergeManifest(oldMedia, newMedia, ['segments']);

  // we need to update segments because we store timing information on them,
  // and we also want to make sure we preserve old segment information in cases
  // were the newMedia skipped segments.
  const segmentResult = mergeSegments({
    oldSegments: oldMedia && oldMedia.segments,
    newSegments: newMedia && newMedia.segments,
    baseUri,
    offset: oldMedia ? (newMedia.mediaSequence - oldMedia.mediaSequence) : 0
  });

  mergeResult.manifest.segments = segmentResult.segments;

  return {
    updated: mergeResult.updated || segmentResult.updated,
    media: mergeResult.manifest
  };
};
