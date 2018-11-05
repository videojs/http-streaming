/**
 * @file time.js
 */
const findSegmentForTime = (time, playlist) => {

  if (!playlist.segments || playlist.segments.length === 0) {
    return;
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

const findSegmentForStreamTime = (streamTime, playlist) => {
  let dateTimeObject;

  try {
    dateTimeObject = new Date(streamTime);
  } catch (e) {
    // TODO something here?
  }

  // Assumptions:
  //   - verifyProgramDateTimeTags has already been run

  for (let i = 1; i <= playlist.segments.length; i++) {
    const prev = playlist.segments[i - 1];
    const next = playlist.segments[i];

    if (
      prev.dateTimeObject.toISOString() ===
      dateTimeObject.toISOString()
    ) {
      return prev;

    } else if (
      next.dateTimeObject.toISOString() ===
      dateTimeObject.toISOString()
    ) {
      return next;

    } else if (
      (prev.dateTimeObject.toISOString() <
        dateTimeObject.toISOString()) &&
      (dateTimeObject.toISOString() <
        next.dateTimeObject.toISOString())
    ) {
      return prev;

    } else if (
      i === playlist.segments.length &&
      (dateTimeObject.toISOString() >
        next.dateTimeObject.toISOString())
    ) {
      return next;
    }
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

  return streamTimeEpoch - segmentTimeEpoch;
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
  seekTo,
  callback
}) => {

  if (typeof streamTime === 'undefined' || !playlist || !seekTo) {
    return callback({
      message: 'seekToStreamTime: streamTime, seekTo and playlist must be provided',
      newTime: null
    });
  } else if (!callback) {
    throw new Error('seekToStreamTime: callback must be provided');
  }

  if (!verifyProgramDateTimeTags(playlist)) {
    return callback({
      message: 'programDateTime tags must be provided in the manifest ' + playlist.resolvedUri,
      newTime: null
    });
  }

  const segment = findSegmentForStreamTime(streamTime, playlist);

  if (!segment) {
    return callback({
      message: `${streamTime} was not found in the stream`,
      newTime: null
    });
  }

  const milliSecondOffset = getOffsetFromTimestamp(
    segment.dateTimeObject,
    streamTime
  );

  // TODO: need to wait until segment.start is available
  const seekToTime = segment.start + milliSecondOffset / 1000;

  seekTo(seekToTime);
  callback(null, seekToTime);
};
