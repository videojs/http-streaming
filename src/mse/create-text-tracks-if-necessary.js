/**
 * @file create-text-tracks-if-necessary.js
 */

/**
 * Create text tracks on video.js if they exist on a segment.
 *
 * @param {Object} inbandTextTracks a reference to current inbandTextTracks
 * @param {Object} mediaSource the HTML media source
 * @param {Object} segment the segment that may contain the text track
 * @private
 */
const createTextTracksIfNecessary = function(inbandTextTracks, tech, segment) {
  // create an in-band caption track if one is present in the segment
  if (segment.captions &&
      segment.captions.length) {
    if (!inbandTextTracks.inbandTextTracks_) {
      inbandTextTracks.inbandTextTracks_ = {};
    }

    for (let trackId in segment.captionStreams) {
      if (!inbandTextTracks.inbandTextTracks_[trackId]) {
        tech.trigger({type: 'usage', name: 'hls-608'});
        let track = tech.textTracks().getTrackById(trackId);

        if (track) {
          // Resuse an existing track with a CC# id because this was
          // very likely created by videojs-contrib-hls from information
          // in the m3u8 for us to use
          inbandTextTracks.inbandTextTracks_[trackId] = track;
        } else {
          // Otherwise, create a track with the default `CC#` label and
          // without a language
          inbandTextTracks.inbandTextTracks_[trackId] = tech.addRemoteTextTrack({
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
      !inbandTextTracks.metadataTrack_) {
    inbandTextTracks.metadataTrack_ = tech.addRemoteTextTrack({
      kind: 'metadata',
      label: 'Timed Metadata'
    }, false).track;
    inbandTextTracks.metadataTrack_.inBandMetadataTrackDispatchType =
      segment.metadata.dispatchType;
  }
};

export default createTextTracksIfNecessary;
