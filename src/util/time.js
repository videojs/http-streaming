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

export const getStreamTime = ({
  playlist,
  time = undefined,
  onsuccess,
  onreject
}) => {

  if (!playlist || !onsuccess || !onreject || time === undefined) {
    return onreject({
      message: 'getStreamTime: player, playlist, onsuccess and onreject must be provided'
    });
  }

  const matchedSegment = findSegmentForTime(time, playlist);

  if (!matchedSegment) {
    return onreject({
      message: 'valid streamTime was not found'
    });
  }

  if (matchedSegment.type === 'estimate') {
    return onreject({
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

  return onsuccess(streamTime);
};
