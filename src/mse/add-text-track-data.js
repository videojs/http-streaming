/**
 * @file add-text-track-data.js
 */
import window from 'global/window';
import videojs from 'video.js';
/**
 * Define properties on a cue for backwards compatability,
 * but warn the user that the way that they are using it
 * is depricated and will be removed at a later date.
 *
 * @param {Cue} cue the cue to add the properties on
 * @private
 */
const deprecateOldCue = function(cue) {
  Object.defineProperties(cue.frame, {
    id: {
      get() {
        videojs.log.warn('cue.frame.id is deprecated. Use cue.value.key instead.');
        return cue.value.key;
      }
    },
    value: {
      get() {
        videojs.log.warn('cue.frame.value is deprecated. Use cue.value.data instead.');
        return cue.value.data;
      }
    },
    privateData: {
      get() {
        videojs.log.warn('cue.frame.privateData is deprecated. Use cue.value.data instead.');
        return cue.value.data;
      }
    }
  });
};

export const durationOfVideo = function(duration) {
  let dur;

  if (isNaN(duration) || Math.abs(duration) === Infinity) {
    dur = Number.MAX_VALUE;
  } else {
    dur = duration;
  }
  return dur;
};
/**
 * Add text track data to a source handler given the captions and
 * metadata from the buffer.
 *
 * @param {Object} sourceHandler the virtual source buffer
 * @param {Array} captionArray an array of caption data
 * @param {Array} metadataArray an array of meta data
 * @private
 */
export const addTextTrackData = function(sourceHandler, captionArray, metadataArray) {
  const Cue = window.WebKitDataCue || window.VTTCue;

  if (captionArray) {
    captionArray.forEach(function(caption) {
      const track = caption.stream;

      this.inbandTextTracks_[track].addCue(new Cue(
        caption.startTime + this.timestampOffset,
        caption.endTime + this.timestampOffset,
        caption.text
      ));
    }, sourceHandler);
  }

  if (metadataArray) {
    const videoDuration = durationOfVideo(sourceHandler.mediaSource_.duration);

    metadataArray.forEach(function(metadata) {
      const time = metadata.cueTime + this.timestampOffset;

      metadata.frames.forEach(function(frame) {
        const cue = new Cue(
          time,
          time,
          frame.value || frame.url || frame.data || ''
        );

        cue.frame = frame;
        cue.value = frame;
        deprecateOldCue(cue);

        this.metadataTrack_.addCue(cue);
      }, this);
    }, sourceHandler);

    // Updating the metadeta cues so that
    // the endTime of each cue is the startTime of the next cue
    // the endTime of last cue is the duration of the video
    if (sourceHandler.metadataTrack_ &&
        sourceHandler.metadataTrack_.cues &&
        sourceHandler.metadataTrack_.cues.length) {
      const cues = sourceHandler.metadataTrack_.cues;
      const cuesArray = [];

      // Create a copy of the TextTrackCueList...
      // ...disregarding cues with a falsey value
      for (let i = 0; i < cues.length; i++) {
        if (cues[i]) {
          cuesArray.push(cues[i]);
        }
      }

      // Group cues by their startTime value
      const cuesGroupedByStartTime = cuesArray.reduce((obj, cue) => {
        const timeSlot = obj[cue.startTime] || [];

        timeSlot.push(cue);
        obj[cue.startTime] = timeSlot;

        return obj;
      }, {});

      // Sort startTimes by ascending order
      const sortedStartTimes = Object.keys(cuesGroupedByStartTime)
        .sort((a, b) => Number(a) - Number(b));

      // Map each cue group's endTime to the next group's startTime
      sortedStartTimes.forEach((startTime, idx) => {
        const cueGroup = cuesGroupedByStartTime[startTime];
        const nextTime = Number(sortedStartTimes[idx + 1]) || videoDuration;

        // Map each cue's endTime the next group's startTime
        cueGroup.forEach((cue) => {
          cue.endTime = nextTime;
        });
      });
    }
  }
};
