import videojs from 'video.js';
import window from 'global/window';
import { resolveUrl } from './resolve-url';
const { log } = videojs;

export const createPlaylistID = (index, uri) => {
  return `${index}-${uri}`;
};

/**
 * Loops through all supported media groups in master and calls the provided
 * callback for each group
 *
 * @param {Object} master
 *        The parsed master manifest object
 * @param {Function} callback
 *        Callback to call for each media group
 */
export const forEachMediaGroup = (master, callback) => {
  ['AUDIO', 'SUBTITLES'].forEach((mediaType) => {
    for (const groupKey in master.mediaGroups[mediaType]) {
      for (const labelKey in master.mediaGroups[mediaType][groupKey]) {
        const mediaProperties = master.mediaGroups[mediaType][groupKey][labelKey];

        callback(mediaProperties, mediaType, groupKey, labelKey);
      }
    }
  });
};

/**
 * Adds ID, resolvedUri, and attributes properties to the playlist, where necessary. In
 * addition, if a master playlist is provided, the playlist ID to playlist reference is
 * added to the playlists array.
 *
 * @param {Object} config
 *        Arguments object
 * @param {Object} config.playlist
 *        The media playlist
 * @param {Object} [config.master]
 *        The master playlist containing this media playlist (if applicable)
 * @param {string} id
 *        ID to use for the playlist
 */
export const setupMediaPlaylist = ({ playlist, master, id }) => {
  playlist.id = id;

  // For media playlist sources, the URI is resolved at the time of the response (to
  // handle redirects), therefore, only media playlists within a master must be resolved
  // here.
  if (master) {
    playlist.resolvedUri = resolveUrl(master.uri, playlist.uri);
    master.playlists[playlist.id] = playlist;
  }

  if (!playlist.attributes) {
    // Although the spec states an #EXT-X-STREAM-INF tag MUST have a BANDWIDTH attribute,
    // the stream can be played without it. This means a poorly formatted master playlist
    // may not have an attribute list. An attributes property is added here to prevent
    // undefined references when this scenario is encountered.
    //
    // In addition, m3u8-parser does not attach an attributes property to media playlists,
    // so ensure that the property is attached to avoid undefined reference errors
    playlist.attributes = {};

    if (master) {
      log.warn('Invalid playlist STREAM-INF detected. Missing BANDWIDTH attribute.');
    }
  }
};

/**
 * Adds ID, resolvedUri, and attributes properties to each playlist of the master, where
 * necessary. In addition, creates playlist IDs for each playlist and adds playlist ID to
 * playlist references is to the playlists array.
 *
 * @param {Object} master
 *        The master playlist
 */
export const setupMediaPlaylists = (master) => {
  // setup by-URI lookups and resolve media playlist URIs
  let i = master.playlists.length;

  while (i--) {
    const playlist = master.playlists[i];

    setupMediaPlaylist({
      playlist,
      master,
      id: createPlaylistID(i, playlist.uri)
    });
  }
};

/**
 * Adds resolvedUri properties to each media group.
 *
 * @param {Object} master
 *        The master playlist
 */
export const resolveMediaGroupUris = (master) => {
  forEachMediaGroup(master, (properties) => {
    if (properties.uri) {
      properties.resolvedUri = resolveUrl(master.uri, properties.uri);
    }
  });
};

/**
 * Creates a master playlist warapper to insert a sole media playlist into.
 *
 * @param {Object} media
 *        Media playlist
 *
 * @return {Object}
 *         Master playlist
 */
export const masterForMedia = (media) => {
  const id = createPlaylistID(0, media.uri);
  const master = {
    mediaGroups: {
      'AUDIO': {},
      'VIDEO': {},
      'CLOSED-CAPTIONS': {},
      'SUBTITLES': {}
    },
    uri: window.location.href,
    playlists: [{
      uri: media.uri,
      id,
      resolvedUri: media.uri,
      // m3u8-parser does not attach an attributes property to media playlists so make
      // sure that the property is attached to avoid undefined reference errors
      attributes: {}
    }]
  };

  master.playlists[id] = media;

  return master;
};

/**
 * Does an in-place update of the master manifest to add updated playlist URI references
 * as well as other properties needed by VHS that aren't included by mpd-parser.
 *
 * @param {Object} manifest
 *        Manifest object returned from parser
 * @param {string} srcUrl
 *        The mpd URL
 */
export const addPropertiesToManifest = (manifest, srcUrl) => {
  manifest.uri = srcUrl;

  const master = manifest.playlists ? manifest : masterForMedia(manifest, srcUrl);

  for (let i = 0; i < master.playlists.length; i++) {
    if (!master.playlists[i].uri) {
      // Set up phony URIs for the playlists since we won't have external URIs for DASH
      // but reference playlists by their URI throughout the project
      // TODO: consider adding dummy URIs in mpd-parser
      const phonyUri = `placeholder-uri-${i}`;

      master.playlists[i].uri = phonyUri;
    }
  }

  forEachMediaGroup(master, (properties, mediaType, groupKey, labelKey) => {
    if (properties.playlists &&
        properties.playlists.length &&
        !properties.playlists[0].uri) {
      // set up phony URIs for the media group playlists since we won't have external
      // URIs for DASH but reference playlists by their URI throughout the project
      const phonyUri = `placeholder-uri-${mediaType}-${groupKey}-${labelKey}`;
      const id = createPlaylistID(0, phonyUri);

      properties.playlists[0].uri = phonyUri;
      properties.playlists[0].id = id;
      // setup URI references
      master.playlists[id] = properties.playlists[0];
    }
  });

  setupMediaPlaylists(master);
  resolveMediaGroupUris(master);

  return master;
};
