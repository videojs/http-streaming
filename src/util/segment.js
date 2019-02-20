import mp4probe from 'mux.js/lib/mp4/probe';
import tsInspector from 'mux.js/lib/tools/ts-inspector.js';
import { ONE_SECOND_IN_TS } from 'mux.js/lib/utils/clock';

/**
 * Probe an fmp4 segment to determine the start of the segment in it's internal
 * "media time".
 *
 * @private
 * @param {Uint8Array} segmentBytes - segment bytes
 * @param {Uint8Array} mapBytes - map bytes
 * @return {object} The start and end time of the current segment in "media time"
 */
export const probeMp4StartTime = (segmentBytes, mapBytes) => {
  const timescales = mp4probe.timescale(mapBytes);

  return mp4probe.startTime(timescales, segmentBytes);
};

/**
 * Probe an mpeg2-ts segment to determine the start time of the segment in it's
 * internal "media time," as well as whether it contains video and/or audio.
 *
 * @private
 * @param {Uint8Array} bytes - segment bytes
 * @return {object} The start time of the current segment in "media time" as well as
 *                  whether it contains video and/or audio
 */
export const probeTsSegment = (bytes, baseStartTime) => {
  let timeInfo = tsInspector.inspect(bytes, baseStartTime * ONE_SECOND_IN_TS);

  if (!timeInfo) {
    return null;
  }

  const result = {
    // each type's time info comes back as an array of 2 times, start and end
    hasVideo: timeInfo.video && timeInfo.video.length === 2,
    hasAudio: timeInfo.audio && timeInfo.audio.length === 2
  };

  if (result.hasVideo) {
    result.videoStart = timeInfo.video[0].dtsTime;
  }
  if (result.hasAudio) {
    result.audioStart = timeInfo.audio[0].dtsTime;
  }

  return result;
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
};
