/**
 * @file time.js
 */
const findSegmentForTime = (time, playlist) => {

  if (!playlist.segments || playlist.segments.length === 0) {
    return null;
  }

  // Assumptions:
  // - there will always be a segment.duration
  // - we can start from zero
  // - segments are in time order
  // - segment.start and segment.end only come
  //    from syncController

  let manifestTime = 0;

  for (let i = 0; i < playlist.segments.length; i++) {
    const segment = playlist.segments[i];
    const estimatedStart = manifestTime;
    const estimatedEnd = manifestTime + segment.duration;

    if (segment.start <= time && time <= segment.end) {
      return {
        segment,
        estimatedStart,
        estimatedEnd,
        type: 'accurate'
      };
    } else if (estimatedStart <= time && time <= estimatedEnd) {
      return {
        segment,
        estimatedStart,
        estimatedEnd,
        type: 'estimate'
      };
    }

    manifestTime = estimatedEnd;
  }

  return null;
};

const timeWithinSegment = (requestedTime, segment) => {
  const segmentDuration = segment.duration;
  const segmentTime = segment.dateTimeObject;

  return requestedTime >= segmentTime &&
    ((requestedTime - segmentTime) / 1000) < segmentDuration;
};

const findSegmentForStreamTime = (streamTime, playlist) => {
  let dateTimeObject;

  try {
    dateTimeObject = new Date(streamTime);
  } catch (e) {
    // TODO something here?
  }

  // Assumptions:
  //  - verifyProgramDateTimeTags has already been run
  //  - live streams have been started

  let matchedSegment;

  // TODO: just estimate the PDT for each segment like in findSegmentForTime
  for (let i = 1; i <= playlist.segments.length; i++) {
    const prev = playlist.segments[i - 1];
    const prevTime = prev.dateTimeObject.toISOString();
    const next = playlist.segments[i];
    const nextTime = next.dateTimeObject.toISOString();
    const requestedTime = dateTimeObject.toISOString();

    if (
        prevTime <= requestedTime &&
        requestedTime < nextTime
    ) {
      matchedSegment = prev;
      break;
    }
  }

  const lastSegment = playlist.segments[playlist.segments.length - 1];

  if (timeWithinSegment(dateTimeObject, lastSegment)) {
    matchedSegment = lastSegment;
  }

  if (matchedSegment) {
    if (matchedSegment.start && matchedSegment.end) {
      return {
        segment: matchedSegment,
        type: 'accurate'
      };
    }

    return {
      segment: matchedSegment,
      type: 'estimate'
    };
  }

  // TODO error as time hasn't been found
  return null;
};

const getOffsetFromTimestamp = (comparisonTimeStamp, streamTime) => {
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

const verifyProgramDateTimeTags = (playlist) => {
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

  if (!playlist || time === undefined) {
    return callback({
      message: 'getStreamTime: playlist and time must be provided'
    });
  } else if (!callback) {
    throw new Error('getStreamTime: callback must be provided');
  }

  const matchedSegment = findSegmentForTime(time, playlist);

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
      message: 'seekToStreamTime: streamTime, seekTo and playlist must be provided',
      newTime: null
    });
  }

  if (!playlist.endList && tech.paused()) {
    return callback({
      message: 'player must be playing a live stream to start buffering',
      newTime: null
    });
  }

  if (!verifyProgramDateTimeTags(playlist)) {
    return callback({
      message: 'programDateTime tags must be provided in the manifest ' + playlist.resolvedUri,
      newTime: null
    });
  }

  const matchedSegment = findSegmentForStreamTime(streamTime, playlist);

  // no match
  if (!matchedSegment) {
    return callback({
      message: `${streamTime} was not found in the stream`,
      newTime: null
    });
  }

  if (matchedSegment.type === 'estimate') {
    // we've run out of retries
    if (retryCount === 0) {
      return callback({
        message: `${streamTime} is not buffered yet. Try again`,
        newTime: null
      });
    }

    // TODO Otherwise retry (wip)
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
