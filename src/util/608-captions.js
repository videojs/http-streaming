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
