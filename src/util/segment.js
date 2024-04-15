/**
 * Combine all segments into a single Uint8Array
 *
 * @param {Object} segmentObj
 * @return {Uint8Array} concatenated bytes
 * @private
 */
export const concatSegments = (segmentObj) => {
  let offset = 0;
  let tempBuffer;

  if (segmentObj.bytes) {
    tempBuffer = new Uint8Array(segmentObj.bytes);

    // combine the individual segments into one large typed-array
    segmentObj.segments.forEach((segment) => {
      tempBuffer.set(segment, offset);
      offset += segment.byteLength;
    });
  }

  return tempBuffer;
};

/**
 * Example:
 * https://host.com/path1/path2/path3/segment.ts?arg1=val1
 * -->
 * path3/segment.ts
 *
 * @param resolvedUri
 * @return {string}
 */
export function compactSegmentUrlDescription(resolvedUri) {
  try {
    return new URL(resolvedUri)
      .pathname
      .split('/')
      .slice(-2)
      .join('/');
  } catch (e) {
    return '';
  }
}
