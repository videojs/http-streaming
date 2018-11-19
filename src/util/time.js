/**
 * @file time.js
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

export const findSegmentForPlayerTime = (time, playlist) => {
  // Assumptions:
  // - there will always be a segment.duration
  // - we can start from zero
  // - segments are in time order
  // - segment.start and segment.end only come
  //    from syncController

  return findSegmentForTime(time, 'player', playlist);
};

export const findSegmentForStreamTime = (streamTime, playlist) => {
  let dateTimeObject;

  try {
    dateTimeObject = new Date(streamTime);
  } catch (e) {
    // TODO something here?
  }

  // Assumptions:
  //  - verifyProgramDateTimeTags has already been run
  //  - live streams have been started

  return findSegmentForTime(dateTimeObject, 'stream', playlist);
};

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
