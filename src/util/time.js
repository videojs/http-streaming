/**
 * @file time.js
 */

/**
 * Checks whether a given time is within a segment based on its start time
 * and duration. For playerTime, the requested time is in seconds, for
 * streamTime, the time is a Date object.
 *
 * @param {Date|Number} requestedTime Time to check is within a segment
 * @param {"stream" | "player"} type Whether passing in a playerTime or streamTime
 * @param {Date|Number} segmentStart The start time of the segment
 * @param {Number} duration Segment duration in seconds
 */
export const timeWithinSegment = (requestedTime, type, segmentStart, duration) => {
  let endTime;

  if (type === 'stream') {
    endTime = new Date(duration * 1000 + segmentStart.getTime());

    const requestedTimeString = requestedTime.toISOString();
    const segmentTimeString = segmentStart.toISOString();
    const endTimeString = endTime.toISOString();

    return segmentTimeString <= requestedTimeString &&
      requestedTimeString <= endTimeString;

  } else if (type === 'player') {
    endTime = duration + segmentStart;

    return segmentStart <= requestedTime &&
      requestedTime <= endTime;
  }
};

/**
 * Finds a segment that contains the time requested. This might be an estimate or
 * an accurate match.
 *
 * @param {Date|Number} time The streamTime or playerTime to find a matching segment for
 * @param {"stream" | "player"} type Either the playerTime or streamTime
 * @param {Object} playlist A playlist object
 * @return {Object} match
 * @return {Object} match.segment The matched segment from the playlist
 * @return {Date|Number} match.estimatedStart The estimated start time of the segment
 * @return {"accurate" | "estimate"} match.type Whether the match is estimated or accurate
 */
const findSegmentForTime = (time, type, playlist) => {
  if (!playlist.segments || playlist.segments.length === 0) {
    return null;
  }

  if (type !== 'player' && type !== 'stream') {
    return null;
  }

  let manifestTime = 0;

  for (let i = 0; i < playlist.segments.length; i++) {
    const segment = playlist.segments[i];
    const estimatedEnd = manifestTime + segment.duration;
    let segmentStart;
    let estimatedStart;

    if (type === 'player') {
      segmentStart = segment.start;
      estimatedStart = manifestTime;
    } else {
      // we can rely on the program date time being accurate
      segmentStart = segment.dateTimeObject;
      estimatedStart = segment.dateTimeObject;
    }

    const timeWithinSegmentEnd =
      typeof segment.start !== 'undefined' &&
      typeof segment.end !== 'undefined' &&
      timeWithinSegment(
        time,
        type,
        segmentStart,
        segment.end - segment.start
      );
    const timeWithinSegmentDuration = timeWithinSegment(
      time,
      type,
      estimatedStart,
      segment.duration
    );

    if (timeWithinSegmentEnd) {
      return {
        segment,
        estimatedStart,
        type: 'accurate'
      };

    } else if (timeWithinSegmentDuration) {
      return {
        segment,
        estimatedStart,
        type: 'estimate'
      };
    }

    manifestTime = estimatedEnd;
  }

  return null;
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
  // - segment.start and segment.end only come
  //    from syncController

  return findSegmentForTime(time, 'player', playlist);
};

/**
 * Finds a segment that contains the stream time give as an ISO-8601 string.
 *
 * @param {String} streamTime The ISO-8601 streamTime to find a match for
 * @param {Object} playlist A playlist object to search within
 */
export const findSegmentForStreamTime = (streamTime, playlist) => {
  let dateTimeObject;

  try {
    dateTimeObject = new Date(streamTime);
  } catch (e) {
    // TODO something here?
    return null;
  }

  // Assumptions:
  //  - verifyProgramDateTimeTags has already been run
  //  - live streams have been started
  return findSegmentForTime(dateTimeObject, 'stream', playlist);
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
 * Returns the streamTime  of the media given a playlist and a playerTime.
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
        'Accurate streamTime could not be determined. Please seek to e.seekTime and try again',
      seekTime: matchedSegment.estimatedStart
    });
  }

  const streamTime = {
    mediaSeconds: time
  };

  if (matchedSegment.segment.dateTimeObject) {
    // TODO this is currently the time of the beginning of the
    // segment. This still needs to be modified to be offset
    // by the time requested.
    streamTime.programDateTime = matchedSegment.segment.dateTimeObject.toISOString();
  }

  return callback(null, streamTime);
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
