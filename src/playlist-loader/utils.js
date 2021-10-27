import {mergeOptions} from 'video.js';
import {resolveUrl} from '../resolve-url';

export const isMediaUnchanged = (a, b) => a === b ||
  (a.segments && b.segments && a.segments.length === b.segments.length &&
   a.endList === b.endList &&
   a.mediaSequence === b.mediaSequence &&
   (a.preloadSegment && b.preloadSegment && a.preloadSegment === b.preloadSegment));

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
const mergeSegment = function(a, b, baseUri) {
  const result = {
    mergedSegment: b,
    updated: false
  };

  if (!a) {
    result.updated = true;
    return b;
  }

  result.mergedSegment = mergeOptions(a, b);

  // if only the old segment has preload hints
  // and the new one does not, remove preload hints.
  if (a.preloadHints && !b.preloadHints) {
    delete result.preloadHints;
  }

  // if only the old segment has parts
  // then the parts are no longer valid
  if (a.parts && !b.parts) {
    delete result.parts;
  // if both segments have parts
  // copy part propeties from the old segment
  // to the new one.
  } else if (a.parts && b.parts) {
    for (let i = 0; i < b.parts.length; i++) {
      if (a.parts && a.parts[i]) {
        result.parts[i] = mergeOptions(a.parts[i], b.parts[i]);
      }
    }
  }

  // set skipped to false for segments that have
  // have had information merged from the old segment.
  if (!a.skipped && b.skipped) {
    result.skipped = false;
  }

  // set preload to false for segments that have
  // had information added in the new segment.
  if (a.preload && !b.preload) {
    result.preload = false;
  }

  return result;
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
    let mergedSegment;

    if (oldSegment) {
      currentMap = oldSegment.map || currentMap;

      mergedSegment = mergeSegment(oldSegment, newSegment, baseUri);
    } else {
      // carry over map to new segment if it is missing
      if (currentMap && !newSegment.map) {
        newSegment.map = currentMap;
      }

      mergedSegment = newSegment;
    }

    result.segments.push(resolveSegmentUris(mergedSegment, baseUri));
  }
  return result;
};

/**
 * Loops through all supported media groups in master and calls the provided
 * callback for each group. Unless true is returned from the callback.
 *
 * @param {Object} master
 *        The parsed master manifest object
 * @param {Function} callback
 *        Callback to call for each media group
 */
export const forEachMediaGroup = (master, callback) => {
  if (!master.mediaGroups) {
    return;
  }
  ['AUDIO', 'SUBTITLES'].forEach((mediaType) => {
    if (!master.mediaGroups[mediaType]) {
      return;
    }
    for (const groupKey in master.mediaGroups[mediaType]) {
      for (const labelKey in master.mediaGroups[mediaType][groupKey]) {
        const mediaProperties = master.mediaGroups[mediaType][groupKey][labelKey];

        const stop = callback(mediaProperties, mediaType, groupKey, labelKey);

        if (stop) {
          return;
        }
      }
    }
  });
};
