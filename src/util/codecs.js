/**
 * @file - codecs.js - Handles tasks regarding codec strings such as translating them to
 * codec strings, or translating codec strings into objects that can be examined.
 */

import videojs from 'video.js';

// Default codec parameters if none were provided for video and/or audio
const defaultCodecs = {
  videoCodec: 'avc1',
  videoObjectTypeIndicator: '.4d400d',
  // AAC-LC
  audioProfile: '2'
};

export const translateLegacyCodec = function(codec) {
  if (!codec) {
    return codec;
  }

  return codec.replace(/avc1\.(\d+)\.(\d+)/i, function(orig, profile, avcLevel) {
    let profileHex = ('00' + Number(profile).toString(16)).slice(-2);
    let avcLevelHex = ('00' + Number(avcLevel).toString(16)).slice(-2);

    return 'avc1.' + profileHex + '00' + avcLevelHex;
  });
};

/**
 * Replace the old apple-style `avc1.<dd>.<dd>` codec string with the standard
 * `avc1.<hhhhhh>`
 *
 * @param {Array} codecs an array of codec strings to fix
 * @return {Array} the translated codec array
 * @private
 */
export const translateLegacyCodecs = function(codecs) {
  return codecs.map(translateLegacyCodec);
};

/**
 * Parses a codec string to retrieve the number of codecs specified,
 * the video codec and object type indicator, and the audio profile.
 */

export const parseCodecs = function(codecs = '') {
  let result = {
    codecCount: 0
  };
  let parsed;

  result.codecCount = codecs.split(',').length;
  result.codecCount = result.codecCount || 2;

  // parse the video codec
  parsed = (/(^|\s|,)+(avc[13])([^ ,]*)/i).exec(codecs);
  if (parsed) {
    result.videoCodec = parsed[2];
    result.videoObjectTypeIndicator = parsed[3];
  }

  // parse the last field of the audio codec
  result.audioProfile =
    (/(^|\s|,)+mp4a.[0-9A-Fa-f]+\.([0-9A-Fa-f]+)/i).exec(codecs);
  result.audioProfile = result.audioProfile && result.audioProfile[2];

  return result;
};

/**
 * Replace codecs in the codec string with the old apple-style `avc1.<dd>.<dd>` to the
 * standard `avc1.<hhhhhh>`.
 *
 * @param codecString {String} the codec string
 * @return {String} the codec string with old apple-style codecs replaced
 *
 * @private
 */
export const mapLegacyAvcCodecs = function(codecString) {
  return codecString.replace(/avc1\.(\d+)\.(\d+)/i, (match) => {
    return translateLegacyCodecs([match])[0];
  });
};

/**
 * Returns a set of codec strings parsed from the playlist or the default
 * codec strings if no codecs were specified in the playlist
 * @param {Playlist} media the current media playlist
 * @return {Object} an object with the video and audio codecs
 */
const getCodecs = function(media) {
  // if the codecs were explicitly specified, use them instead of the
  // defaults
  let mediaAttributes = media.attributes || {};

  if (mediaAttributes.CODECS) {
    return parseCodecs(mediaAttributes.CODECS);
  }
  return defaultCodecs;
};

const audioProfileFromDefault = (master, audioGroupId) => {
  if (!master.mediaGroups.AUDIO || !audioGroupId) {
    return null;
  }

  const audioGroup = master.mediaGroups.AUDIO[audioGroupId];

  if (!audioGroup) {
    return null;
  }

  for (let name in audioGroup) {
    const audioType = audioGroup[name];

    if (audioType.default && audioType.playlists) {
      // codec should be the same for all playlists within the audio type
      return parseCodecs(audioType.playlists[0].attributes.CODECS).audioProfile;
    }
  }

  return null;
};

export const isMaat = (master, media) => {
  const mediaAttributes = media.attributes || {};

  return master.mediaGroups.AUDIO &&
    mediaAttributes.AUDIO &&
    master.mediaGroups.AUDIO[mediaAttributes.AUDIO];
};

export const isMuxed = (master, media) => {
  if (!isMaat(master, media)) {
    return true;
  }

  const mediaAttributes = media.attributes || {};
  const audioGroup = master.mediaGroups.AUDIO[mediaAttributes.AUDIO];

  for (let groupId in audioGroup) {
    // If an audio group has a URI (the case for HLS, as HLS will use external playlists),
    // or there are listed playlists (the case for DASH, as the manifest will have already
    // provided all of the details necessary to generate the audio playlist, as opposed to
    // HLS' externally requested playlists), then the content is demuxed.
    if (!audioGroup[groupId].uri && !audioGroup[groupId].playlists) {
      return true;
    }
  }

  return false;
};

/**
 * Calculates the codec strings for a working configuration of
 * SourceBuffers to play variant streams in a master playlist. If
 * there is no possible working configuration, an empty object will be
 * returned.
 *
 * @param master {Object} the m3u8 object for the master playlist
 * @param media {Object} the m3u8 object for the variant playlist
 * @return {Object} the codec strings.
 *
 * @private
 */
export const codecsForPlaylist = function(master, media) {
  const mediaAttributes = media.attributes || {};
  const codecInfo = getCodecs(media);

  // HLS with multiple-audio tracks must always get an audio codec.
  // Put another way, there is no way to have a video-only multiple-audio HLS!
  if (isMaat(master, media) && !codecInfo.audioProfile) {
    if (!isMuxed(master, media)) {
      // It is possible for codecs to be specified on the audio media group playlist but
      // not on the rendition playlist. This is mostly the case for DASH, where audio and
      // video are always separate (and separately specified).
      codecInfo.audioProfile = audioProfileFromDefault(master, mediaAttributes.AUDIO);
    }

    if (!codecInfo.audioProfile) {
      videojs.log.warn(
        'Multiple audio tracks present but no audio codec string is specified. ' +
        'Attempting to use the default audio codec (mp4a.40.2)');
      codecInfo.audioProfile = defaultCodecs.audioProfile;
    }
  }

  const codecs = {};

  if (codecInfo.videoCodec) {
    codecs.video = `${codecInfo.videoCodec}${codecInfo.videoObjectTypeIndicator}`;
  }

  if (codecInfo.audioProfile) {
    codecs.audio = `mp4a.40.${codecInfo.audioProfile}`;
  }

  return codecs;
};

export const isLikelyFmp4Data = (bytes) => {
  // not enough data to determine, in which case it is an invalid mp4 file/fragment anyway
  if (bytes.length < 8) {
    return false;
  }

  // ignore the first 4 bytes (they represent the box length)
  // ftyp/styp (file type/segment type) should be the first box in an mp4 or mp4 fragment
  if ((bytes[4] === 'f'.charCodeAt(0) || (bytes[4] === 's'.charCodeAt(0))) &&
      (bytes[5] === 't'.charCodeAt(0)) &&
      (bytes[6] === 'y'.charCodeAt(0)) &&
      (bytes[7] === 'p'.charCodeAt(0))) {
    return true;
  }

  return false;
};
