// TODO handle fmp4 case where the timing info is accurate and doesn't involve transmux

/**
 * @file time.js
 */

// Add 25% to the segment duration to account for small discrepencies in segment timing.
// 25% was arbitrarily chosen, and may need to be refined over time.
const SEGMENT_END_FUDGE_PERCENT = 0.25;

export const playerTimeToStreamTime = (playerTime, segment) => {
  // If there's no "anchor point" for the stream time (i.e., a time that can be used to
  // sync the start of a segment with a real world stream time), then a stream time can't
  // be calculated.
  if (!segment.dateTimeObject) {
    return null;
  }

  const transmuxerPrependedSeconds = segment.videoTimingInfo.transmuxerPrependedSeconds;
  const transmuxedStart = segment.videoTimingInfo.transmuxedPresentationStart;

  // get the proper start of new content (not prepended old content) from the segment,
  // in player time
  const startOfSegment = transmuxedStart + transmuxerPrependedSeconds;
  const offsetFromSegmentStart = playerTime - startOfSegment;

  return new Date(segment.dateTimeObject.getTime() + offsetFromSegmentStart * 1000);
};

export const originalSegmentVideoDuration = (videoTimingInfo) => {
  return videoTimingInfo.transmuxedPresentationEnd -
    videoTimingInfo.transmuxedPresentationStart -
    videoTimingInfo.transmuxerPrependedSeconds;
};

/**
 * Finds a segment that contains the time requested given as an ISO-8601 string. The
 * returned segment might be an estimate or an accurate match.
 *
 * @param {String} streamTime The ISO-8601 streamTime to find a match for
 * @param {Object} playlist A playlist object to search within
 */
export const findSegmentForStreamTime = (streamTime, playlist) => {
  // Assumptions:
  //  - verifyProgramDateTimeTags has already been run
  //  - live streams have been started

  let dateTimeObject;

  try {
    dateTimeObject = new Date(streamTime);
  } catch (e) {
    return null;
  }

  if (!playlist || !playlist.segments || playlist.segments.length === 0) {
    return null;
  }

  let segment = playlist.segments[0];

  if (dateTimeObject < segment.dateTimeObject) {
    // Requested time is before stream start.
    return null;
  }

  for (let i = 0; i < playlist.segments.length - 1; i++) {
    segment = playlist.segments[i];

    const nextSegmentStart = playlist.segments[i + 1].dateTimeObject;

    if (dateTimeObject < nextSegmentStart) {
      break;
    }
  }

  const lastSegment = playlist.segments[playlist.segments.length - 1];
  const lastSegmentStart = lastSegment.dateTimeObject;
  const lastSegmentDuration = lastSegment.videoTimingInfo ?
    originalSegmentVideoDuration(lastSegment.videoTimingInfo) :
    lastSegment.duration + lastSegment.duration * SEGMENT_END_FUDGE_PERCENT;
  const lastSegmentEnd =
    new Date(lastSegmentStart.getTime() + lastSegmentDuration * 1000);

  if (dateTimeObject > lastSegmentEnd) {
    return null;
  }

  if (dateTimeObject > lastSegmentStart) {
    segment = lastSegment;
  }

  return {
    segment,
    estimatedStart: segment.dateTimeObject,
    // Since all segments will have accurate date time objects, as long as the time is
    // not the last segment, the boundaries should provide accurate numbers. Otherwise,
    // the time is only accurate if the segment was downloaded at some point (determined
    // by the presence of the videoTimingInfo object).
    type: (segment.videoTimingInfo || segment !== lastSegment) ? 'accurate' : 'estimate'
  };
};

/**
 * Finds a segment that contains the given player time(in seconds).
 *
 * @param {Number} time The player time to find a match for
 * @param {Object} playlist A playlist object to search within
 */
export const findSegmentForPlayerTime = (time, playlist) => {
  // Assumptions:
  // - there will always be a segment.duration
  // - we can start from zero
  // - segments are in time order

  if (!playlist || !playlist.segments || playlist.segments.length === 0) {
    return null;
  }

  let segmentEnd = 0;
  let segment;

  for (let i = 0; i < playlist.segments.length; i++) {
    segment = playlist.segments[i];

    // videoTimingInfo is set after the segment is downloaded and transmuxed, and
    // should contain the most accurate values we have for the segment's player times.
    //
    // Use the accurate transmuxedPresentationEnd value if it is available, otherwise fall
    // back to an estimate based on the manifest derived (inaccurate) segment.duration, to
    // calculate an end value.
    segmentEnd = segment.videoTimingInfo ?
      segment.videoTimingInfo.transmuxedPresentationEnd : segmentEnd + segment.duration;

    if (time <= segmentEnd) {
      break;
    }
  }

  const lastSegment = playlist.segments[playlist.segments.length - 1];

  if (lastSegment.videoTimingInfo &&
      lastSegment.videoTimingInfo.transmuxedPresentationEnd < time) {
    // The time requested is beyond the stream end.
    return null;
  }

  if (time > segmentEnd) {
    if (time > segmentEnd + (lastSegment.duration * SEGMENT_END_FUDGE_PERCENT)) {
      // Technically, because the duration value is only an estimate, the time may still
      // exist in the last segment, however, there isn't enough information to make even
      // a reasonable estimate.
      return null;
    }

    segment = lastSegment;
  }

  return {
    segment,
    estimatedStart: segment.videoTimingInfo ?
      segment.videoTimingInfo.transmuxedPresentationStart : segmentEnd - segment.duration,
    // Because videoTimingInfo is only set after transmux, it is the only way to get
    // accurate timing values.
    type: segment.videoTimingInfo ? 'accurate' : 'estimate'
  };
};

/**
 * Gives the offset of the comparisonTimestamp from the streamTime timestamp in seconds.
 * If the offset returned is positive, the streamTime occurs before the comparisonTimestamp.
 * If the offset is negative, the streamTime occurs before the comparisonTimestamp.
 *
 * @param {String} comparisonTimeStamp An ISO-8601 timestamp to compare against
 * @param {String} streamTime The streamTime as an ISO-8601 string
 * @return {Number} offset
 */
export const getOffsetFromTimestamp = (comparisonTimeStamp, streamTime) => {
  let segmentDateTime;
  let streamDateTime;

  try {
    segmentDateTime = new Date(comparisonTimeStamp);
    streamDateTime = new Date(streamTime);
  } catch (e) {
    // TODO handle error
  }

  const segmentTimeEpoch = segmentDateTime.getTime();
  const streamTimeEpoch = streamDateTime.getTime();

  return (streamTimeEpoch - segmentTimeEpoch) / 1000;
};

/**
 * Checks that all segments in this playlist have programDateTime tags.
 *
 * @param {Object} playlist A playlist object
 */
export const verifyProgramDateTimeTags = (playlist) => {
  if (!playlist.segments || playlist.segments.length === 0) {
    return false;
  }

  for (let i = 0; i < playlist.segments.length; i++) {
    const segment = playlist.segments[i];

    if (!segment.dateTimeObject) {
      return false;
    }
  }

  return true;
};

/**
 * Returns the streamTime of the media given a playlist and a playerTime.
 * The playlist must have programDateTime tags for a programDateTime tag to be returned.
 * If the segments containing the time requested have not been buffered yet, an estimate
 * may be returned to the callback.
 *
 * @param {Object} args
 * @param {Object} args.playlist A playlist object to search within
 * @param {Number} time A playerTime in seconds
 * @param {Function} callback(err, streamTime)
 * @returns {String} err.message A detailed error message
 * @returns {Object} streamTime
 * @returns {Number} streamTime.mediaSeconds The streamTime in seconds
 * @returns {String} streamTime.programDateTime The streamTime as an ISO-8601 String
 */
export const getStreamTime = ({
  playlist,
  time = undefined,
  callback
}) => {

  if (!callback) {
    throw new Error('getStreamTime: callback must be provided');
  }

  if (!playlist || time === undefined) {
    return callback({
      message: 'getStreamTime: playlist and time must be provided'
    });
  }

  const matchedSegment = findSegmentForPlayerTime(time, playlist);

  if (!matchedSegment) {
    return callback({
      message: 'valid streamTime was not found'
    });
  }

  if (matchedSegment.type === 'estimate') {
    return callback({
      message:
        'Accurate streamTime could not be determined.' +
        ' Please seek to e.seekTime and try again',
      seekTime: matchedSegment.estimatedStart
    });
  }

  const streamTimeObject = {
    mediaSeconds: time
  };
  const streamTime = playerTimeToStreamTime(time, matchedSegment.segment);

  if (streamTime) {
    streamTimeObject.programDateTime = streamTime.toISOString();
  }

  return callback(null, streamTimeObject);
};

/**
 * Seeks in the player to a time that matches the given streamTime ISO-8601 string.
 *
 * @param {Object} args
 * @param {String} args.streamTime A streamTime to seek to as an ISO-8601 String
 * @param {Object} args.playlist A playlist to look within
 * @param {Number} args.retryCount The number of times to try for an accurate seek. Default is 2.
 * @param {Function} args.seekTo A method to perform a seek
 * @param {Boolean} args.pauseAfterSeek Whether to end in a paused state after seeking. Default is true.
 * @param {Object} args.tech The tech to seek on
 * @param {Function} args.callback(err, newTime) A callback to return the new time to
 * @returns {String} err.message A detailed error message
 * @returns {Number} newTime The exact time that was seeked to in seconds
 */
export const seekToStreamTime = ({
  streamTime,
  playlist,
  retryCount = 2,
  seekTo,
  pauseAfterSeek = true,
  tech,
  callback
}) => {

  if (!callback) {
    throw new Error('seekToStreamTime: callback must be provided');
  }

  if (typeof streamTime === 'undefined' || !playlist || !seekTo) {
    return callback({
      message: 'seekToStreamTime: streamTime, seekTo and playlist must be provided'
    });
  }

  if (!playlist.endList && !tech.hasStarted_) {
    return callback({
      message: 'player must be playing a live stream to start buffering'
    });
  }

  if (!verifyProgramDateTimeTags(playlist)) {
    return callback({
      message: 'programDateTime tags must be provided in the manifest ' + playlist.resolvedUri
    });
  }

  const matchedSegment = findSegmentForStreamTime(streamTime, playlist);

  // no match
  if (!matchedSegment) {
    return callback({
      message: `${streamTime} was not found in the stream`
    });
  }

  if (matchedSegment.type === 'estimate') {
    // we've run out of retries
    if (retryCount === 0) {
      return callback({
        message: `${streamTime} is not buffered yet. Try again`
      });
    }

    return seekToStreamTime({
      streamTime,
      playlist,
      retryCount: retryCount - 1,
      seekTo,
      pauseAfterSeek,
      tech,
      callback
    });
  }

  const segment = matchedSegment.segment;
  const mediaOffset = getOffsetFromTimestamp(
    segment.dateTimeObject,
    streamTime
  );

  // Since the segment.start value is determined from the buffered end or ending time
  // of the prior segment, the seekToTime doesn't need to account for any transmuxer
  // modifications.
  const seekToTime = segment.start + mediaOffset;
  const seekedCallback = () => {
    return callback(null, tech.currentTime());
  };

  // listen for seeked event
  tech.one('seeked', seekedCallback);
  // pause before seeking as video.js will restore this state
  if (pauseAfterSeek) {
    tech.pause();
  }
  seekTo(seekToTime);
};
