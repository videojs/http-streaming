/**
 * @file - codecs.js - Handles tasks regarding codec strings such as translating them to
 * codec strings, or translating codec strings into objects that can be examined.
 */

import {findBox} from 'mux.js/lib/mp4/probe';
import {
  translateLegacyCodec,
  parseCodecs,
  codecsFromDefault
} from '@videojs/vhs-utils/dist/codecs.js';
import { segmentXhrHeaders } from '../xhr';

/**
 * Returns a set of codec strings parsed from the playlist or the default
 * codec strings if no codecs were specified in the playlist
 *
 * @param {Playlist} media the current media playlist
 * @return {Object} an object with the video and audio codecs
 */
const getCodecs = function(media) {
  // if the codecs were explicitly specified, use them instead of the
  // defaults
  const mediaAttributes = media.attributes || {};

  if (mediaAttributes.CODECS) {
    return parseCodecs(mediaAttributes.CODECS);
  }
};

export const isMaat = (master, media) => {
  const mediaAttributes = media.attributes || {};

  return master && master.mediaGroups && master.mediaGroups.AUDIO &&
    mediaAttributes.AUDIO &&
    master.mediaGroups.AUDIO[mediaAttributes.AUDIO];
};

export const isMuxed = (master, media) => {
  if (!isMaat(master, media)) {
    return true;
  }

  const mediaAttributes = media.attributes || {};
  const audioGroup = master.mediaGroups.AUDIO[mediaAttributes.AUDIO];

  for (const groupId in audioGroup) {
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
  const codecInfo = getCodecs(media) || {};

  // HLS with multiple-audio tracks must always get an audio codec.
  // Put another way, there is no way to have a video-only multiple-audio HLS!
  if (isMaat(master, media) && !codecInfo.audio) {
    if (!isMuxed(master, media)) {
      // It is possible for codecs to be specified on the audio media group playlist but
      // not on the rendition playlist. This is mostly the case for DASH, where audio and
      // video are always separate (and separately specified).
      const defaultCodecs = codecsFromDefault(master, mediaAttributes.AUDIO);

      if (defaultCodecs) {
        codecInfo.audio = defaultCodecs.audio;
      }

    }
  }

  const codecs = {};

  if (codecInfo.video) {
    codecs.video = translateLegacyCodec(`${codecInfo.video.type}${codecInfo.video.details}`);
  }

  if (codecInfo.audio) {
    codecs.audio = translateLegacyCodec(`${codecInfo.audio.type}${codecInfo.audio.details}`);
  }

  return codecs;
};
const bytesToString = (bytes) =>
  typeof bytes === 'number' ? String.fromCharCode(bytes) : String.fromCharCode.apply(null, bytes);

export const isLikelyFmp4Data = (bytes) => {
  return findBox(bytes, ['moof']).length > 0;
};

const getId3Offset = function(bytes) {
  if (bytesToString(bytes.subarray(0, 3)) !== 'ID3') {
    return 0;
  }
  const returnSize = (bytes[6] << 21) |
                     (bytes[7] << 14) |
                     (bytes[8] << 7) |
                     (bytes[9]);
  const flags = bytes[5];
  const footerPresent = (flags & 16) >> 4;

  if (footerPresent) {
    return returnSize + 20;
  }
  return returnSize + 10;
};

export const isLikelyAacData = (bytes) => {
  const offset = getId3Offset(bytes);

  return bytes.length >= offset + 2 &&
    (bytes[offset] & 0xFF) === 0xFF &&
    (bytes[offset + 1] & 0xE0) === 0xE0 &&
    (bytes[offset + 1] & 0x16) === 0x10;
};

export const isLikelyMp3Data = (bytes) => {
  const offset = getId3Offset(bytes);

  return bytes.length >= offset + 2 &&
    (bytes[offset] & 0xFF) === 0xFF &&
    (bytes[offset + 1] & 0xE0) === 0xE0 &&
    (bytes[offset + 2] & 0x06) === 0x02;
};

/*
 * Check to see if the bytes are part of a WebM media file.
 *
 * @param {Uint8Array} bytes
 *        The starting bytes of the file, generally from the map, or media initialization
 *        section, of the file.
 * @return {Boolean}
 *         Whether the bytes likely come from a WebM media file.
 * @see https://en.wikipedia.org/wiki/List_of_file_signatures
 */
export const isLikelyWebmData = (bytes) =>
  bytes.length >= 4 &&
  (bytes[0] & 0xFF) === 0x1A &&
  (bytes[1] & 0xFF) === 0x45 &&
  (bytes[2] & 0xFF) === 0xDF &&
  (bytes[3] & 0xFF) === 0xA3;

export const isLikelyMp4Data = (bytes) =>
  bytes.length >= 8 &&
  (/^(f|s)typ$/).test(bytesToString(bytes.subarray(4, 8))) &&
  // not 3gp data
  !(/^ftyp3g$/).test(bytesToString(bytes.subarray(4, 10)));

export const isLikely3gpData = (bytes) =>
  bytes.length >= 10 &&
  (/^ftyp3g$/).test(bytesToString(bytes.subarray(4, 10)));

export const isLikelyTsData = (bytes) =>
  bytes.length >= 1 && bytes[0] === 0x47;

export const isLikelyFlacData = (bytes) =>
  bytes.length >= 4 && (/^fLaC$/).test(bytesToString(bytes.subarray(0, 4)));

export const isLikelyOggData = (bytes) =>
  bytes.length >= 4 && (/^OggS$/).test(bytesToString(bytes.subarray(0, 4)));

export const toUint8 = (bytes) => (bytes instanceof Uint8Array) ? bytes :
  new Uint8Array(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength);

export const containerTypeForBytes = (bytes) => {
  // auto convert to Uint8Array as needed
  bytes = toUint8(bytes);

  if (isLikelyWebmData(bytes)) {
    return 'webm';
  }

  if (isLikelyFlacData(bytes)) {
    return 'flac';
  }

  if (isLikelyOggData(bytes)) {
    return 'ogg';
  }

  if (isLikelyMp3Data(bytes)) {
    return 'mp3';
  }

  if (isLikelyAacData(bytes)) {
    return 'aac';
  }

  if (isLikely3gpData(bytes)) {
    return '3gp';
  }

  if (isLikelyMp4Data(bytes)) {
    return 'mp4';
  }

  // ts is the least specific check as it only
  // checks one byte. so it should be last
  if (isLikelyTsData(bytes)) {
    return 'ts';
  }
};

// When not using separate audio media groups, audio and video is   return false;

// A useful list of file signatures can be found here
// https://en.wikipedia.org/wiki/List_of_file_signatures
export const containerTypeForSegment = (uri, xhr, cb) => {
  const byterange = {offset: 0, length: 10};
  const options = {
    responseType: 'arraybuffer',
    uri,
    byterange,
    headers: segmentXhrHeaders({byterange})
  };

  const handleResponse = (err, request) => {
    if (err) {
      return cb(err, request);
    }

    // we have an id3offset, download after that ends
    const id3Offset = getId3Offset(toUint8(request.response));

    // we only need 2 bytes past the id3 offset for aac/mp3 data
    if (id3Offset) {
      options.byterange = {offset: id3Offset, length: 2};
      options.headers = segmentXhrHeaders({byterange: options.byterange});

      return xhr(options, handleResponse);
    }

    const type = containerTypeForBytes(request.response);

    // if we get "ts" back we need to check another single byte
    // to verify that the content is actually ts
    if (type === 'ts' && options.byterange.offset === 0) {
      options.byterange = {offset: 188, length: 1};
      options.headers = segmentXhrHeaders({byterange: options.byterange});
      return xhr(options, handleResponse);
    }

    return cb(null, request, type);
  };

  return xhr(options, handleResponse);
};
