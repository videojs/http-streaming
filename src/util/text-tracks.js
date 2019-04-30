/**
 * @file text-tracks.js
 */
import window from 'global/window';
import videojs from 'video.js';

/**
 * Create captions text tracks on video.js if they do not exist
 *
 * @param {Object} inbandTextTracks a reference to current inbandTextTracks
 * @param {Object} tech the video.js tech
 * @param {Object} captionStreams the caption streams to create
 * @private
 */
export const createCaptionsTrackIfNotExists = function(inbandTextTracks, tech, captionStreams) {
  for (let trackId in captionStreams) {
    if (!inbandTextTracks[trackId]) {
      tech.trigger({type: 'usage', name: 'hls-608'});
      let track = tech.textTracks().getTrackById(trackId);

      if (track) {
        // Resuse an existing track with a CC# id because this was
        // very likely created by videojs-contrib-hls from information
        // in the m3u8 for us to use
        inbandTextTracks[trackId] = track;
      } else {
        // Otherwise, create a track with the default `CC#` label and
        // without a language
        inbandTextTracks[trackId] = tech.addRemoteTextTrack({
          kind: 'captions',
          id: trackId,
          label: trackId
        }, false).track;
      }
    }
  }
};

export const addCaptionData = function({
    inbandTextTracks,
    captionArray,
    timestampOffset
  }) {
  if (!captionArray) {
    return;
  }

  const Cue = window.WebKitDataCue || window.VTTCue;

  captionArray.forEach((caption) => {
    const track = caption.stream;
    let startTime = caption.startTime;
    let endTime = caption.endTime;

    if (!inbandTextTracks[track]) {
      return;
    }

    startTime += timestampOffset;
    endTime += timestampOffset;

    inbandTextTracks[track].addCue(
      new Cue(
        startTime,
        endTime,
        caption.text
      ));
  });
};

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
        videojs.log.warn(
          'cue.frame.id is deprecated. Use cue.value.key instead.'
        );
        return cue.value.key;
      }
    },
    value: {
      get() {
        videojs.log.warn(
          'cue.frame.value is deprecated. Use cue.value.data instead.'
        );
        return cue.value.data;
      }
    },
    privateData: {
      get() {
        videojs.log.warn(
          'cue.frame.privateData is deprecated. Use cue.value.data instead.'
        );
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
  let Cue = window.WebKitDataCue || window.VTTCue;

  if (captionArray) {
    captionArray.forEach(function(caption) {
      let track = caption.stream;

      this.inbandTextTracks_[track].addCue(
        new Cue(
          caption.startTime + this.timestampOffset,
          caption.endTime + this.timestampOffset,
          caption.text
        ));
    }, sourceHandler);
  }

  if (metadataArray) {
    let videoDuration = durationOfVideo(sourceHandler.mediaSource_.duration);

    metadataArray.forEach(function(metadata) {
      let time = metadata.cueTime + this.timestampOffset;

      // if time isn't a finite number between 0 and Infinity, like NaN,
      // ignore this bit of metadata.
      // This likely occurs when you have an non-timed ID3 tag like TIT2,
      // which is the "Title/Songname/Content description" frame
      if (typeof time !== 'number' || window.isNaN(time) || time < 0 || !(time < Infinity)) {
        return;
      }

      metadata.frames.forEach(function(frame) {
        let cue = new Cue(
          time,
          time,
          frame.value || frame.url || frame.data || '');

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
      let cues = sourceHandler.metadataTrack_.cues;
      let cuesArray = [];

      // Create a copy of the TextTrackCueList...
      // ...disregarding cues with a falsey value
      for (let i = 0; i < cues.length; i++) {
        if (cues[i]) {
          cuesArray.push(cues[i]);
        }
      }

      // Group cues by their startTime value
      let cuesGroupedByStartTime = cuesArray.reduce((obj, cue) => {
        let timeSlot = obj[cue.startTime] || [];

        timeSlot.push(cue);
        obj[cue.startTime] = timeSlot;

        return obj;
      }, {});

      // Sort startTimes by ascending order
      let sortedStartTimes = Object.keys(cuesGroupedByStartTime)
                                   .sort((a, b) => Number(a) - Number(b));

      // Map each cue group's endTime to the next group's startTime
      sortedStartTimes.forEach((startTime, idx) => {
        let cueGroup = cuesGroupedByStartTime[startTime];
        let nextTime = Number(sortedStartTimes[idx + 1]) || videoDuration;

        // Map each cue's endTime the next group's startTime
        cueGroup.forEach((cue) => {
          cue.endTime = nextTime;
        });
      });
    }
  }
};

/**
 * Create text tracks on video.js if they exist on a segment.
 *
 * @param {Object} sourceBuffer the VSB or FSB
 * @param {Object} mediaSource the HTML media source
 * @param {Object} segment the segment that may contain the text track
 * @private
 */
export const createTextTracksIfNecessary = function(sourceBuffer, mediaSource, segment) {
  const player = mediaSource.player_;

  // create an in-band caption track if one is present in the segment
  if (segment.captions &&
      segment.captions.length) {
    if (!sourceBuffer.inbandTextTracks_) {
      sourceBuffer.inbandTextTracks_ = {};
    }

    for (let trackId in segment.captionStreams) {
      if (!sourceBuffer.inbandTextTracks_[trackId]) {
        player.tech_.trigger({type: 'usage', name: 'hls-608'});
        let track = player.textTracks().getTrackById(trackId);

        if (track) {
          // Resuse an existing track with a CC# id because this was
          // very likely created by videojs-contrib-hls from information
          // in the m3u8 for us to use
          sourceBuffer.inbandTextTracks_[trackId] = track;
        } else {
          // Otherwise, create a track with the default `CC#` label and
          // without a language
          sourceBuffer.inbandTextTracks_[trackId] = player.addRemoteTextTrack({
            kind: 'captions',
            id: trackId,
            label: trackId
          }, false).track;
        }
      }
    }
  }

  if (segment.metadata &&
      segment.metadata.length &&
      !sourceBuffer.metadataTrack_) {
    sourceBuffer.metadataTrack_ = player.addRemoteTextTrack({
      kind: 'metadata',
      label: 'Timed Metadata'
    }, false).track;
    sourceBuffer.metadataTrack_.inBandMetadataTrackDispatchType =
      segment.metadata.dispatchType;
  }
};

/**
 * Remove cues from a track on video.js.
 *
 * @param {Double} start start of where we should remove the cue
 * @param {Double} end end of where the we should remove the cue
 * @param {Object} track the text track to remove the cues from
 * @private
 */
export const removeCuesFromTrack = function(start, end, track) {
  let i;
  let cue;

  if (!track) {
    return;
  }

  if (!track.cues) {
    return;
  }

  i = track.cues.length;

  while (i--) {
    cue = track.cues[i];

    // Remove any overlapping cue
    if (cue.startTime <= end && cue.endTime >= start) {
      track.removeCue(cue);
    }
  }
};
