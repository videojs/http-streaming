/**
 * @file time.js
 */
import videojs from 'video.js';

const findSegmentForTime = (time, timeline) => {
  const matchingSegments = timeline.filter((x) => {
    return x.start <= time && time <= x.end;
  });

  if (matchingSegments.length === 0) {
    return null;
  }

  return matchingSegments[0].segment;
};

const buildMediaTimeline = (playlist) => {
  const timeline = [];

  if (!playlist.segments || playlist.segments.length === 0) {
    return;
  }

  // Assumptions:
  // - there will always be a segment.duration
  // - we can start from zero
  // - segments are in time order
  // - segment.start and segment.end only come
  //    from syncController(ignored for now)

  let time = 0;

  playlist.segments.forEach((segment) => {
    const end = time + segment.duration;

    timeline.push({
      start: time,
      end,
      segment
    });

    time = end;
  });

  return timeline;
};

export const getStreamTime = ({
  player,
  playlist,
  time,
  callback
}) => {

  if (!player || !playlist) {
    videojs.log.warn('getStreamTime: no player or playlist provided');
    return null;
  } else if (time === undefined || time === null) {
    time = player.currentTime();
  }

  const streamTime = {
    mediaSeconds: time,
    programDateTime: null
  };

  const timeline = buildMediaTimeline(playlist);

  if (timeline) {
    const segment = findSegmentForTime(time, timeline);

    if (segment.dateTimeObject) {
      // TODO this is currently the time of the beginning of the
      // segment. This still needs to be modified to be offset
      // by the time requested.
      streamTime.programDateTime = segment.dateTimeObject.toISOString();
    }
  }

  if (callback) {
    return callback(streamTime);
  }

  return streamTime;
};
