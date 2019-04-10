import videojs from 'video.js';
import { Parser as M3u8Parser } from 'm3u8-parser';
import window from 'global/window';
import config from './config';
import { simpleTypeFromSourceType } from './videojs-http-streaming';
import { parseCodecs } from './util/codecs.js';
import {
  setupMediaPlaylists,
  resolveMediaGroupUris,
  resolveSegmentUris,
  parseManifest as parseHlsManifest
} from './playlist-loader';
import { parseMasterXml } from './dash-playlist-loader';
import { resolveUrl } from './resolve-url';

const requestAll = (urls, callback) => {
  let requestsRemaining = urls.length;
  let responses = {};

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

const parseManifest = ({ url, manifestString, mimeType }) => {
  const type = simpleTypeFromSourceType(mimeType);

  if (type === 'dash') {
    return parseMasterXml({
      masterXml: manifestString,
      srcUrl: url,
      clientOffset: 0
    });
  }

  const manifest = parseHlsManifest({ manifestString });

  if (manifest.playlists) {
    manifest.playlists.forEach((playlist) => {
      playlist.resolvedUri = resolveUrl(url, playlist.uri);

      playlist.segments.forEach((segment) => {
        resolveSegmentUris(segment, playlist.resolvedUri);
      });
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

const combinePlaylists = (playlists) => {
  const combinedPlaylist = playlists.reduce((acc, playlist) => {
    const firstNewSegmentIndex = acc.segments.length;
    const concatenatedSegments = acc.segments.concat(playlist.segments);

    // don't add a discontinuity to the first segment
    if (acc.segments.length > 0) {
      concatenatedSegments[firstNewSegmentIndex].discontinuity = true;
    }

    acc.segments = concatenatedSegments;

    return acc;
  }, {
    segments: []
  });

  // TODO instead of relying on the attributes object of the first playlist, either
  // merge the playlist attributes, or, better, pick and choose only relevant
  // properties
  combinedPlaylist.attributes = playlists[0].attributes;
  combinedPlaylist.uri = 'combined-playlist';
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

const constructMasterManifest = (playlists) => {
  // VHS playlist arrays have properties with the playlist URI in addition to the standard
  // indices. This must be maintained for compatibility.
  playlists.forEach((playlist) => {
    playlists[playlist.uri] = playlist;
  });

  const master = {
    mediaGroups: {
      'AUDIO': {},
      'VIDEO': {},
      'CLOSED-CAPTIONS': {},
      'SUBTITLES': {}
    },
    // placeholder URI, same as used in VHS when no master
    uri: window.location.href,
    playlists
  };

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
 * the playlists may have multiple incompatibility errors.
 *
 * @param {Object[]} manifestObjects
 *        An array of manifest objects (in the format used by VHS)
 *
 * @returns {(null|string)}
 *          null if no errors or a string with an error if one was detected
 */
const checkForIncompatibility = (manifestObjects) => {
  let expectedNumberOfCodecs = 2;

  // TODO
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

const concatenateManifests = ({ manifests, targetVerticalResolution }) => {
  const manifestObjects = manifests.map((manifestObject) => parseManifest({
    url: manifestObject.url,
    manifestString: manifestObject.response,
    mimeType: manifestObject.mimeType
  }));
  const incompatibilityErrors = checkForIncompatibility(manifestObjects);

  if (incompatibilityErrors) {
    throw new Error(incompatibilityErrors);
  }

  // Video renditions are assumed to be codec compatible, but may have different
  // resolutions. Choose the video rendition closest to the target resolution from each
  // manifest.
  const videoPlaylists = chooseVideoPlaylists(manifestObjects, targetVerticalResolution);

  // TODO demuxed audio
  //
  // A rendition with demuxed audio can't be concatenated with a rendition with muxed
  // audio.  VHS assumes (based on how most media streaming formats work) that a rendition
  // will not change how it's playing back audio (whether from muxed as part of the
  // rendition's video segments, or demuxed as segments in an alternate audio playlist),
  // except due to user interaction (e.g., clicking an alternate audio playlist in the
  // UI). Therefore, a rendition must maintain a consistent playback scheme (as either
  // demuxed or muxed) throughout the its entire stream.
  //
  // const altAudioPlaylists = chooseAudioPlaylists(manifestObjects, videoPlaylists)

  const combinedPlaylist = combinePlaylists(videoPlaylists);

  return constructMasterManifest([combinedPlaylist]);
};

/**
 * Returns a single rendition VHS formatted master playlist object given a list of URLs
 * and their mime types as well as a target vertical resolution.
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
 * @param {function(Object, Object)} config.callback.
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
      callback(null, concatenateManifests({
        manifests: orderedManifests,
        targetVerticalResolution
      }));
    } catch (e) {
      callback(e);
    }
  });
};
