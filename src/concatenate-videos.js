import videojs from 'video.js';
// import { Parser as M3u8Parser } from 'm3u8-parser';
import window from 'global/window';
import config from './config';
import { simpleTypeFromSourceType } from './videojs-http-streaming';
import { parseCodecs } from './util/codecs.js';
import {
  // setupMediaPlaylists,
  // resolveMediaGroupUris,
  resolveSegmentUris,
  parseManifest as parseHlsManifest
} from './playlist-loader';
import { parseMasterXml } from './dash-playlist-loader';
import { resolveUrl } from './resolve-url';

/**
 * Requests all of the urls provided, then calls back.
 *
 * @param {string[]} urls
 *        An array of urls
 * @param {function(Object, Object)} callback
 *        Callback function with error and object containing url to response text entries
 */
const requestAll = (urls, callback) => {
  let requestsRemaining = urls.length;
  const responses = {};

  urls.forEach((url) => {
    const request = videojs.xhr(url, (err, response) => {
      if (requestsRemaining <= 0) {
        // this case should only be triggered if a previous requested erred
        return;
      }

      if (err) {
        callback({
          message: err.message,
          request
        });
        // clear remaining requests to break future callbacks
        requestsRemaining = 0;
        return;
      }

      if (!response || (
        response.statusCode !== 200 &&
        response.statusCode !== 206 &&
        response.statusCode !== 0)) {
        callback({
          message: 'Request failed',
          request
        });
        // clear remaining requests to break future callbacks
        requestsRemaining = 0;
        return;
      }

      requestsRemaining--;

      responses[url] = request.responseText;

      if (requestsRemaining === 0) {
        callback(null, responses);
      }
    });
  });
};

/**
 * Parses a manifest string into a VHS supported manifest object.
 *
 * @param {Object} config
 * @param {string} config.url
 *        URL to the manifest
 * @param {string} config.manifestString
 *        The manifest itself
 * @param {string} config..mimeType
 *        Mime type of the manifest
 *
 * @return {Object}
 *          A VHS manifest object
 */
const parseManifest = ({ url, manifestString, mimeType }) => {
  const type = simpleTypeFromSourceType(mimeType);

  if (type === 'dash') {
    return parseMasterXml({
      masterXml: manifestString,
      srcUrl: url,
      clientOffset: 0
    });
  }

  const manifest = parseHlsManifest({
    manifestString,
    src: url
  });

  if (manifest.playlists) {
    manifest.playlists.forEach((playlist) => {
      playlist.resolvedUri = resolveUrl(url, playlist.uri);

      // For HLS playlists, media playlist segment lists are not yet available. However,
      // they shouldn't be requested yet, as that will lead to a lot of request time to
      // download all of the manifests, and only one from each master is ultimately
      // needed.
    });
  } else {
    manifest.attributes = {};
    manifest.resolvedUri = url;
    manifest.segments.forEach((segment) => {
      resolveSegmentUris(segment, manifest.resolvedUri);
    });
  }

  return manifest;
};

/**
 * Selects the closest matching video playlist to the provided vertical resolution from
 * an array of manifest objects. If the playlists do not include resolution information,
 * the function will match based on VHS' INITIAL_BANDWIDTH config property.
 *
 * @param {Object[]} manifestObjects
 *        An array of manifest objects (in the format used by VHS)
 * @param {number} targetVerticalResolution
 *        The vertical resolution to search for among playlists within each manifest
 *
 * @return {Object[]}
 *          An array of playlist objects, one from each of the provided manifests
 */
const chooseVideoPlaylists = (manifestObjects, targetVerticalResolution) => {
  return manifestObjects.map((manifestObject) => {
    // if the manifest is not a master, then it is the only rendition to use
    if (!manifestObject.playlists) {
      return manifestObject;
    }

    return manifestObject.playlists.reduce((acc, playlist) => {
      if (!acc) {
        return playlist;
      }

      if (playlist.attributes.RESOLUTION) {
        if (Math.abs(playlist.attributes.RESOLUTION) - targetVerticalResolution <
            Math.abs(acc.attributes.RESOLUTION) - targetVerticalResolution) {
          return playlist;
        }
        return acc;
      }

      return Math.abs(playlist.attributes.BANDWIDTH - config.INITIAL_BANDWIDTH) <
        Math.abs(acc.attributes.BANDWIDTH - config.INITIAL_BANDWIDTH) ? playlist : acc;
    }, null);
  });
};

/**
 * Selects valid audio playlists for the provided video playlists, if a relevant audio
 * playlist exists.
 *
 * Note that the manifest objects and video playlists must be the same lengths and in the
 * same order.
 *
 * Only one audio playlist will be selected for each video playlist, and only if the audio
 * playlist has the DEFAULT attribute set to YES. This means that alternate audio is not
 * supported.
 *
 * @param {Object[]} manifestObjects
 *        An array of manifest objects (in the format used by VHS)
 * @param {Object[]} videoPlaylists
 *        An array of video playlists
 *
 * @return {Object[]}
 *          An array of audio playlist objects, one for each of the provided video
 *          playlists
 */
const chooseAudioPlaylists = (manifestObjects, videoPlaylists) => {
  if (manifestObjects.length !== videoPlaylists.length) {
    throw new Error('Invalid number of video playlists for provided manifests');
  }

  const numExpectedPlaylists = manifestObjects.length;
  const audioPlaylists = [];

  for (let i = 0; i < numExpectedPlaylists; i++) {
    const manifestObject = manifestObjects[i];
    const videoPlaylist = videoPlaylists[i];

    if (!videoPlaylist.attributes.AUDIO ||
        !manifestObject.mediaGroups.AUDIO[videoPlaylist.attributes.AUDIO]) {
      // unable to find a matching audio object
      continue;
    }

    const manifestAudioPlaylists =
      manifestObject.mediaGroups.AUDIO[videoPlaylist.attributes.AUDIO];
    const audioPlaylistNames = Object.keys(manifestAudioPlaylists);

    for (let j = 0; j < audioPlaylistNames.length; j++) {
      const audioPlaylist = manifestAudioPlaylists[audioPlaylistNames[j]];

      if (audioPlaylist.default &&
          // some audio playlists are merely identifiers for muxed audio, don't include
          // those (note that resolvedUri should handle the HLS case, presence of
          // playlists the DASH case)
          (audioPlaylist.resolvedUri || audioPlaylist.playlists)) {
        audioPlaylists.push(audioPlaylist.playlists ?
          audioPlaylist.playlists[0] : audioPlaylist);
        break;
      }
    }
  }

  // This should cover multiple cases. For instance, if a manifest was video only or if
  // a manifest only had muxed default audio.
  if (audioPlaylists.length > 0 && audioPlaylists.length !== numExpectedPlaylists) {
    throw new Error('Did not find matching audio playlists for all video playlists');
  }

  return audioPlaylists;
};

/**
 * Joins the segments of each playlist together into one, with a discontinuity on the
 * start of each new section. Playlist will include basic properties necessary for VHS to
 * play back the playlist.
 *
 * @param {Object} config
 * @param {Object[]} config.playlists
 *        An array of playlist objects (in the format used by VHS)
 * @param {string} config.uriSuffix
 *        A suffix to use for the mocked URI of the combined playlist. This is needed when
 *        using demuxed audio, as if the generated URI matches a video playlist's
 *        generated URI, the rendition will be considered audio only by VHS.
 *
 * @return {Object}
 *          A single playlist containing the combined elements (and joined segments) of
 *          all of the provided playlists
 */
const combinePlaylists = ({ playlists, uriSuffix = '' }) => {
  const combinedPlaylist = playlists.reduce((acc, playlist) => {
    const firstNewSegmentIndex = acc.segments.length;
    // need to clone because we're modifying the segment objects
    const clonedSegments = JSON.parse(JSON.stringify(playlist.segments));
    const concatenatedSegments = acc.segments.concat(clonedSegments);

    // don't add a discontinuity to the first segment
    if (acc.segments.length > 0) {
      concatenatedSegments[firstNewSegmentIndex].discontinuity = true;
    }

    acc.segments = concatenatedSegments;

    return acc;
  }, {
    segments: []
  });

  // TODO instead of relying on the attributes object of the first playlist, use a subset
  // of relevant properties to ensure they accurately reflect the content (can't assume
  // the first playlist has the same attributes as the others)
  combinedPlaylist.attributes = playlists[0].attributes || {};
  combinedPlaylist.uri = `combined-playlist${uriSuffix}`;
  combinedPlaylist.resolvedUri = combinedPlaylist.uri;
  combinedPlaylist.playlistType = 'VOD';
  combinedPlaylist.targetDuration = combinedPlaylist.segments.reduce((acc, segment) => {
    return segment.duration > acc ? segment.duration : acc;
  }, 0);
  combinedPlaylist.endList = true;
  combinedPlaylist.mediaSequence = 0;
  combinedPlaylist.discontinuitySequence = 0;
  combinedPlaylist.discontinuityStarts = [];

  let timeline = 0;

  for (let i = 0; i < combinedPlaylist.segments.length; i++) {
    const segment = combinedPlaylist.segments[i];

    if (segment.discontinuity) {
      combinedPlaylist.discontinuityStarts.push(i);
      timeline++;
    }
    segment.timeline = timeline;
  }

  return combinedPlaylist;
};

/**
 * Constructs a basic (only the essential information) master manifest given an array of
 * playlists.
 *
 * @param {Object} config
 * @param {Object} config.videoPlaylist
 *        A video playlist object (in the format used by VHS)
 * @param {Object} config.audioPlaylist
 *        An audio playlist object (in the format used by VHS)
 *
 * @return {Object}
 *          A master manifest object containing the playlists
 */
const constructMasterManifest = ({ videoPlaylist, audioPlaylist }) => {
  const videoPlaylists = [videoPlaylist];
  const audioPlaylists = audioPlaylist ? [audioPlaylist] : null;

  // VHS playlist arrays have properties with the playlist URI in addition to the standard
  // indices. This must be maintained for compatibility.
  videoPlaylists[videoPlaylist.uri] = videoPlaylist;

  if (audioPlaylists) {
    audioPlaylists[audioPlaylist.uri] = audioPlaylist;
  }

  const master = {
    mediaGroups: {
      'AUDIO': {},
      'VIDEO': {},
      'CLOSED-CAPTIONS': {},
      'SUBTITLES': {}
    },
    // placeholder URI, same as used in VHS when no master
    uri: window.location.href,
    playlists: videoPlaylists
  };

  if (audioPlaylist) {
    master.mediaGroups.AUDIO.audio = {
      default: {
        autoselect: true,
        default: true,
        // language is not included to avoid having to verify default languages between
        // concatenated playlists
        language: '',
        uri: 'combined-audio-playlists',
        playlists: audioPlaylists
      }
    };
    master.playlists[0].attributes.AUDIO = 'audio';
  }

  return master;
};

/**
 * Checks the VHS-formatted manifest objects for incompatibilities to see if they can be
 * concatenated together. The incompatibilities checked for are:
 *
 * - Presence of a rendition with both audio and video in each source (audio only and
 *   video only are not currently supported)
 * - Presence of either a demuxed audio playlist rendition in each source or a muxed
 *   rendition in each source (to maintain consistency between sources)
 * - Chosen renditions must have compatible codecs with each other
 * - Chosen renditions must have supported codecs by the browser's implementaiton of MSE
 *   (media source extensions)
 *
 * Note that the function will short circuit with the first error detected, meaning that
 * the playlists may have multiple incompatibilities.
 *
 * @param {Object[]} manifestObjects
 *        An array of manifest objects (in the format used by VHS)
 *
 * @return {(null|string)}
 *          null if no errors or a string with an error if one was detected
 */
const checkForIncompatibility = (manifestObjects) => {
  let expectedNumberOfCodecs = 2;

  // TODO all checks

  // Add all video/audio codecs into a map, and add 1 if a playlist exists in the
  // manifestObject (only 1 for each playlist)
  manifestObjects.map((manifestObject) => {
    // master will have multiple, media only one
    const playlists = manifestObject.playlists || [manifestObject];

    playlists.forEach((playlist) => {
      const codecs = parseCodecs(playlist.attributes.CODECS);

      if (!expectedNumberOfCodecs) {
        expectedNumberOfCodecs = codecs.codecCount;
      }

      // TODO must check all playlists
      if (expectedNumberOfCodecs !== codecs.codecCount) {
        // playlists
        return;
      }
    });
  });

  return null;
};

/**
 * Requests and parses any unresolved playlists and calls back with the result.
 *
 * @param {Object} config
 * @param {Object[]} config.playlists
 *        An array of playlist objects
 * @param {string[]} config.mimeTypes
 *        An array of mime types (should be one-for-one with the playlists array)
 * @param {function(Object, Object)} config.callback
 *        Callback function with error and playlist URI to resolved playlist objects map
 */
const resolvePlaylists = ({ playlists, mimeTypes, callback }) => {
  const playlistUris = playlists
    // if the segments are already resolved, don't need to request (DASH case)
    .filter((playlist) => !playlist.segments)
    .map((playlist) => playlist.resolvedUri);
  const preResolvedPlaylists = playlists.filter((playlist) => playlist.segments);
  const origPlaylistsToParsed = {};

  preResolvedPlaylists.forEach((playlist) => {
    origPlaylistsToParsed[playlist.resolvedUri] = playlist;
  });

  if (!playlistUris.length) {
    // all playlists pre-resolved
    callback(null, origPlaylistsToParsed);
    return;
  }

  const uriToPlaylistsMap = {};
  const uriToMimeTypeMap = {};

  for (let i = 0; i < playlists.length; i++) {
    const playlist = playlists[i];

    // it's possible for the caller to concat two of the same video together
    if (!uriToPlaylistsMap[playlist.resolvedUri]) {
      uriToPlaylistsMap[playlist.resolvedUri] = [];
    }
    uriToPlaylistsMap[playlist.resolvedUri].push(playlist);
    uriToMimeTypeMap[playlist.resolvedUri] = mimeTypes[i].mimeType;
  }

  requestAll(playlistUris, (err, responses) => {
    if (err) {
      callback(err);
      return;
    }

    for (let i = 0; i < playlistUris.length; i++) {
      const uri = playlistUris[i];
      const origPlaylists = uriToPlaylistsMap[uri];
      const playlistString = responses[uri];
      const mimeType = uriToMimeTypeMap[uri];
      const playlist = parseManifest({
        url: uri,
        manifestString: playlistString,
        mimeType
      });

      origPlaylists.forEach((origPlaylist) => {
        origPlaylistsToParsed[origPlaylist.resolvedUri] = playlist;
      });
    }

    callback(null, origPlaylistsToParsed);
  });
};

/**
 * Returns a single rendition VHS formatted master playlist object given a list of
 * manifest strings, their URLs, their mime types, and a target vertical resolution.
 *
 * As of now, only DASH and HLS are supported.
 *
 * This function will select the closest rendition (absolute value difference) to the
 * target vertical resolution. If resolution information is not available as part of the
 * manifest, then it will fall back to the INITIAL_BANDWIDTH config value from VHS.
 *
 * @param {Object} config
 * @param {Object[]} config.manifests
 * @param {string} config.manifests[].url
 *        URL to a manifest
 * @param {string} config.manifests[].manifestString
 *        The manifest itself
 * @param {string} config.manifests[].mimeType
 *        Mime type of the manifest
 * @param {number} config.targetVerticalResolution
 *        The vertical resolution to search for among playlists within each manifest
 * @param {function(Object, Object)} config.callback
 *        Callback function with error and concatenated manifest parameters
 *
 * @return {Object} The concatenated manifest object (in the format used by VHS)
 *
 * @throws Will throw if there are incompatibility errors between the playlists
 */
const concatenateManifests = ({ manifests, targetVerticalResolution, callback }) => {
  const manifestObjects = manifests.map((manifest) => parseManifest({
    url: manifest.url,
    manifestString: manifest.response,
    mimeType: manifest.mimeType
  }));
  const incompatibilityErrors = checkForIncompatibility(manifestObjects);

  if (incompatibilityErrors) {
    throw new Error(incompatibilityErrors);
  }

  // Video renditions are assumed to be codec compatible, but may have different
  // resolutions. Choose the video rendition closest to the target resolution from each
  // manifest.
  const videoPlaylists = chooseVideoPlaylists(manifestObjects, targetVerticalResolution);

  // A rendition with demuxed audio can't be concatenated with a rendition with muxed
  // audio. VHS assumes (based on how most media streaming formats work) that a rendition
  // will not change how it's playing back audio (whether from muxed as part of the
  // rendition's video segments, or demuxed as segments in an alternate audio playlist),
  // except due to user interaction (e.g., clicking an alternate audio playlist in the
  // UI). Therefore, a rendition must maintain a consistent playback scheme (as either
  // demuxed or muxed) throughout the its entire stream.
  const audioPlaylists = chooseAudioPlaylists(manifestObjects, videoPlaylists);
  const allPlaylists = videoPlaylists.concat(audioPlaylists);
  // To correctly set the mime types for all playlists, we have to use the mime types
  // provided by the manifests for the associated playlists. Since  videoPlaylists and
  // audioPlaylists are associated 1:1, and the manifests to videoPlaylists are 1:1, the
  // manifest mime types may be reused for both.
  const mimeTypes = manifests.map((manifest) => manifest.mimeType);

  for (let i = 0; i < audioPlaylists.length; i++) {
    mimeTypes.push(mimeTypes[i]);
  }

  resolvePlaylists({
    playlists: allPlaylists,
    mimeTypes,
    callback: (err, resolvedPlaylistsMap) => {
      if (err) {
        callback(err);
        return;
      }

      allPlaylists.forEach((playlist) => {
        playlist.segments = resolvedPlaylistsMap[playlist.resolvedUri].segments;
      });

      const combinedVideoPlaylist = combinePlaylists({ playlists: videoPlaylists });
      const combinedAudioPlaylist = audioPlaylists.length ? combinePlaylists({
        playlists: audioPlaylists,
        uriSuffix: '-audio'
      }) : null;

      callback(null, constructMasterManifest({
        videoPlaylist: combinedVideoPlaylist,
        audioPlaylist: combinedAudioPlaylist
      }));
    }
  });
};

/**
 * Calls back with a single rendition VHS formatted master playlist object given a list of
 * URLs and their mime types as well as a target vertical resolution.
 *
 * As of now, only DASH and HLS are supported.
 *
 * This function will select the closest rendition (absolute value difference) to the
 * target vertical resolution. If resolution information is not available as part of the
 * manifest, then it will fall back to the INITIAL_BANDWIDTH config value from VHS.
 *
 * @param {Object} config
 * @param {Object[]} config.manifests
 * @param {string} config.manifests[].url
 *        URL to a manifest
 * @param {string} config.manifests[].mimeType
 *        Mime type of the manifest
 * @param {number} config.targetVerticalResolution
 *        The vertical resolution to search for among playlists within each manifest
 * @param {function(Object, Object)} config.callback
 *        Callback function with error and concatenated manifest parameters
 */
export const concatenateVideos = ({ manifests, targetVerticalResolution, callback }) => {
  if (!manifests || !manifests.length) {
    callback({ message: 'No sources provided' });
    return;
  }

  for (let i = 0; i < manifests.length; i++) {
    // The requirement for every manifest needing a URL may be reconsidered in the future
    // to accept pre-parsed manifest objects.
    if (!manifests[i].url) {
      callback({ message: 'All manifests must include a URL' });
      return;
    }

    if (!manifests[i].mimeType) {
      callback({ message: 'All manifests must include a mime type' });
      return;
    }
  }

  const urls = manifests.map((manifestObject) => manifestObject.url);

  requestAll(urls, (err, responses) => {
    if (err) {
      callback(err);
      return;
    }

    const orderedManifests = manifests.map((manifestObject) => {
      return {
        url: manifestObject.url,
        response: responses[manifestObject.url],
        mimeType: manifestObject.mimeType
      };
    });

    try {
      concatenateManifests({
        manifests: orderedManifests,
        targetVerticalResolution,
        callback
      });
    } catch (e) {
      callback(e);
    }
  });
};
