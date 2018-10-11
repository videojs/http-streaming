/**
 * @file time.js
 */

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

export const getStreamTime = (player, masterPlaylistController) => {
  return function({
    time = player.currentTime(),
    callback
  } = {}) {
    const streamTime = {
      mediaSeconds: time,
      programDateTime: null
    };

    const media = masterPlaylistController.media();
    const timeline = buildMediaTimeline(media);

    if (timeline) {
      const segment = findSegmentForTime(time, timeline);

      if (segment.dateTimeObject) {
        // TODO confirm this is YYYY-MM-DDThh:mm:ss.SSSZ ISO_8601 format
        streamTime.programDateTime = segment.dateTimeObject.toISOString();
      }
    }

    if (callback) {
      return callback(streamTime);
    }

    return streamTime;
  };
};
