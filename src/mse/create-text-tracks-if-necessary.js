/**
 * @file create-text-tracks-if-necessary.js
 */

/**
 * Create text tracks on video.js if they exist on a segment.
 *
 * @param {Object} sourceBuffer the VSB or FSB
 * @param {Object} mediaSource the HTML media source
 * @param {Object} segment the segment that may contain the text track
 * @private
 */
const createTextTracksIfNecessary = function(sourceBuffer, mediaSource, segment) {
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

export default createTextTracksIfNecessary;
