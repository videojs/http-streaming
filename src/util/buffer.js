import videojs from 'video.js';

export const buffered = (videoBuffer, audioBuffer, audioDisabled) => {
  let start = null;
  let end = null;
  let arity = 0;
  const extents = [];
  const ranges = [];

  // neither buffer has been created yet
  if (!videoBuffer && !audioBuffer) {
    return videojs.createTimeRange();
  }

  // only one buffer is configured
  if (!videoBuffer) {
    return audioBuffer.buffered;
  }
  if (!audioBuffer) {
    return videoBuffer.buffered;
  }

  // both buffers are configured
  if (audioDisabled) {
    return videoBuffer.buffered;
  }

  // both buffers are empty
  if (videoBuffer.buffered.length === 0 &&
      audioBuffer.buffered.length === 0) {
    return videojs.createTimeRange();
  }

  // Handle the case where we have both buffers and create an
  // intersection of the two
  const videoBuffered = videoBuffer.buffered;
  const audioBuffered = audioBuffer.buffered;
  let count = videoBuffered.length;

  // A) Gather up all start and end times
  while (count--) {
    extents.push({time: videoBuffered.start(count), type: 'start'});
    extents.push({time: videoBuffered.end(count), type: 'end'});
  }
  count = audioBuffered.length;
  while (count--) {
    extents.push({time: audioBuffered.start(count), type: 'start'});
    extents.push({time: audioBuffered.end(count), type: 'end'});
  }
  // B) Sort them by time
  extents.sort(function(a, b) {
    return a.time - b.time;
  });

  // C) Go along one by one incrementing arity for start and decrementing
  //    arity for ends
  for (count = 0; count < extents.length; count++) {
    if (extents[count].type === 'start') {
      arity++;

      // D) If arity is ever incremented to 2 we are entering an
      //    overlapping range
      if (arity === 2) {
        start = extents[count].time;
      }
    } else if (extents[count].type === 'end') {
      arity--;

      // E) If arity is ever decremented to 1 we leaving an
      //    overlapping range
      if (arity === 1) {
        end = extents[count].time;
      }
    }

    // F) Record overlapping ranges
    if (start !== null && end !== null) {
      ranges.push([start, end]);
      start = null;
      end = null;
    }
  }

  return videojs.createTimeRanges(ranges);
};
