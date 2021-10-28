import {mergeOptions} from 'video.js';
import {resolveUrl} from '../resolve-url';

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
 * @param {Object} a the old segment
 * @param {Object} b the new segment
 *
 * @return {Object} the merged segment
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
 * @param {Function} callback
 *        Callback to call for each media group,
 *        *NOTE* The return value is used here. Any true
 *        value will stop the loop.
 */
export const forEachMediaGroup = (mainManifest, callback) => {
  if (!mainManifest.mediaGroups) {
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
