import mp4probe from 'mux.js/lib/mp4/probe';

/**
 * Probe an fmp4 segment to determine the start of the segment in it's internal
 * "media time".
 *
 * @private
 * @param {Uint8Array} segmentBytes - segment bytes
 * @param {Uint8Array} mapBytes - map bytes
 * @return {object} The start and end time of the current segment in "media time"
 */
export const probeMp4Segment = (segmentBytes, mapBytes) => {
  let timescales = mp4probe.timescale(mapBytes);
  let startTime = mp4probe.startTime(timescales, segmentBytes);

  return {
    start: startTime,
    end: startTime + segment.duration
  };
};

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
}
