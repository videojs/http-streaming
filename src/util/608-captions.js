const getOrCreateTextTrack = function(mediaSource, caption) {
  const player = mediaSource.player_;
  const trackId = caption.stream;
  let track = player.textTracks().getTrackById(trackId);

  if (!track) {
    track = player.addRemoteTextTrack({
      kind: 'captions',
      id: trackId,
      label: trackId
    }, false).track;
  }

  return track;
};

const addTextTrackData = function(track, caption) {
  const Cue = window.WebKitDataCue || window.VTTCue;

  track.addCue(
    new Cue(
      caption.startTime,
      caption.endTime,
      caption.text
    ));
};

const handleCaptions = function(sourceHandler, sourceBuffer, segment) {
  var player = sourceHandler.player_;

  if (segment.captions.length) {
    for (var i = 0; i < segment.captions.length; i ++) {
      const caption = segment.captions[i];
      let track = getOrCreateTextTrack(sourceHandler, caption);

      addTextTrackData(track, caption);
    }
  }
};

export default handleCaptions;
