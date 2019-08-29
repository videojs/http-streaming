/**
 * @file playlist-loader.js
 *
 * A state machine that manages the loading, caching, and updating of
 * M3U8 playlists.
 *
 */
import { resolveUrl, resolveManifestRedirect } from './resolve-url';
import videojs from 'video.js';
import { Parser as M3u8Parser } from 'm3u8-parser';
import window from 'global/window';

const { mergeOptions, EventTarget, log } = videojs;

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
  * Returns a new array of segments that is the result of merging
  * properties from an older list of segments onto an updated
  * list. No properties on the updated playlist will be overridden.
  *
  * @param {Array} original the outdated list of segments
  * @param {Array} update the updated list of segments
  * @param {number=} offset the index of the first update
  * segment in the original segment list. For non-live playlists,
  * this should always be zero and does not need to be
  * specified. For live playlists, it should be the difference
  * between the media sequence numbers in the original and updated
  * playlists.
  * @return a list of merged segment objects
  */
export const updateSegments = (original, update, offset) => {
  const result = update.slice();

  offset = offset || 0;
  const length = Math.min(original.length, update.length + offset);

  for (let i = offset; i < length; i++) {
    result[i - offset] = mergeOptions(original[i], result[i - offset]);
  }
  return result;
};

export const resolveSegmentUris = (segment, baseUri) => {
  if (!segment.resolvedUri) {
    segment.resolvedUri = resolveUrl(baseUri, segment.uri);
  }
  if (segment.key && !segment.key.resolvedUri) {
    segment.key.resolvedUri = resolveUrl(baseUri, segment.key.uri);
  }
  if (segment.map && !segment.map.resolvedUri) {
    segment.map.resolvedUri = resolveUrl(baseUri, segment.map.uri);
  }
};

/**
  * Returns a new master playlist that is the result of merging an
  * updated media playlist into the original version. If the
  * updated media playlist does not match any of the playlist
  * entries in the original master playlist, null is returned.
  *
  * @param {Object} master a parsed master M3U8 object
  * @param {Object} media a parsed media M3U8 object
  * @return {Object} a new object that represents the original
  * master playlist with the updated media playlist merged in, or
  * null if the merge produced no change.
  */
export const updateMaster = (master, media) => {
  const result = mergeOptions(master, {});
  const playlist = result.playlists[media.uri];

  if (!playlist) {
    return null;
  }

  // consider the playlist unchanged if the number of segments is equal, the media
  // sequence number is unchanged, and this playlist hasn't become the end of the playlist
  if (playlist.segments &&
      media.segments &&
      playlist.segments.length === media.segments.length &&
      playlist.endList === media.endList &&
      playlist.mediaSequence === media.mediaSequence) {
    return null;
  }

  const mergedPlaylist = mergeOptions(playlist, media);

  // if the update could overlap existing segment information, merge the two segment lists
  if (playlist.segments) {
    mergedPlaylist.segments = updateSegments(
      playlist.segments,
      media.segments,
      media.mediaSequence - playlist.mediaSequence
    );
  }

  // resolve any segment URIs to prevent us from having to do it later
  mergedPlaylist.segments.forEach((segment) => {
    resolveSegmentUris(segment, mergedPlaylist.resolvedUri);
  });

  // TODO Right now in the playlists array there are two references to each playlist, one
  // that is referenced by index, and one by URI. The index reference may no longer be
  // necessary.
  for (let i = 0; i < result.playlists.length; i++) {
    if (result.playlists[i].uri === media.uri) {
      result.playlists[i] = mergedPlaylist;
    }
  }
  result.playlists[media.uri] = mergedPlaylist;

  return result;
};

/*
 * Adds properties expected by VHS for consistency. For instance, m3u8-parser doesn't add
 * an attributes object to media playlists that aren't a part of a master playlist. This
 * function will add an empty object, if one is not provided, to allow VHS' code to expect
 * media playlists to have the same form whether they are from a master or media playlist,
 * and no matter what source type provided the media.
 *
 * @param {Object} config
 * @param {Object} config.playlist
 *        The media playlist
 * @param {string} [config.masterUri]
 *        URI of the master playlist containing the media playlist (if applicable)
 * @param {number} [config.index=0]
 *        Index of the media playlist within the master playlist list (if applicable)
 */
export const setupMediaPlaylist = ({ playlist, masterUri, index = 0 }) => {
  // For media playlist sources, the URI is resolved at the time of the response (to
  // handle redirects), therefore, only media playlists within a master must be resolved
  // here.
  if (masterUri) {
    playlist.resolvedUri = resolveUrl(masterUri, playlist.uri);
  }
  playlist.id = index;

  // Although the spec states an #EXT-X-STREAM-INF tag MUST have a
  // BANDWIDTH attribute, we can play the stream without it. This means a poorly
  // formatted master playlist may not have an attributes list. An attributes
  // property is added here to prevent undefined references when we encounter
  // this scenario.
  //
  // In addition, m3u8-parser does not attach an attributes property to media
  // playlists so make sure that the property is attached to avoid the same undefined
  // reference errors.
  playlist.attributes = playlist.attributes || {};
};

/*
 * For a consistent object schema, add properties expected by VHS to the media playlists
 * within a master manifest.
 *
 * Also logs warnings if any issues are seen with the playlists.
 *
 * @param {Object} config
 * @param {Object[]} config.playlists
 *        The media playlists from a master manifest
 * @param {string} [config.masterUri]
 *        URI of the master playlist containing the media playlists
 */
export const setupMasterMediaPlaylists = ({ playlists, masterUri }) => {
  // setup by-URI lookups and resolve media playlist URIs
  let i = playlists.length;

  while (i--) {
    const playlist = playlists[i];

    playlists[playlist.uri] = playlist;

    if (!playlist.attributes) {
      log.warn('Invalid playlist STREAM-INF detected. Missing BANDWIDTH attribute.');
    }

    setupMediaPlaylist({
      playlist,
      masterUri,
      index: i
    });
  }
};

export const resolveMediaGroupUris = (master) => {
  forEachMediaGroup(master, (properties) => {
    if (properties.uri) {
      properties.resolvedUri = resolveUrl(master.uri, properties.uri);
    }
  });
};

/**
 * Calculates the time to wait before refreshing a live playlist
 *
 * @param {Object} media
 *        The current media
 * @param {boolean} update
 *        True if there were any updates from the last refresh, false otherwise
 * @return {number}
 *         The time in ms to wait before refreshing the live playlist
 */
export const refreshDelay = (media, update) => {
  const lastSegment = media.segments[media.segments.length - 1];
  let delay;

  if (update && lastSegment && lastSegment.duration) {
    delay = lastSegment.duration * 1000;
  } else {
    // if the playlist is unchanged since the last reload or last segment duration
    // cannot be determined, try again after half the target duration
    delay = (media.targetDuration || 10) * 500;
  }
  return delay;
};

/*
 * Adds properties to the manifest that may not have been provided by the parser or object
 * provider.
 *
 * @param {Object} manifest
 *                 The manifest object
 * @param {string=} srcUri
 *                  The manifest's URI
 */
export const addPropertiesToParsedManifest = ({ manifest, srcUri }) => {
  if (srcUri) {
    manifest.uri = srcUri;
  }

  if (manifest.playlists) {
    resolveMediaGroupUris(manifest);
    setupMasterMediaPlaylists({
      playlists: manifest.playlists,
      masterUri: manifest.uri
    });
  } else {
    setupMediaPlaylist({
      playlist: manifest
    });
  }
};

/**
 * Parses a given m3u8 playlist, then sets up the media playlists and groups to prepare it
 * for use in VHS.
 *
 * This function is exported to allow others to reuse the same logic for constructing a
 * VHS manifest object from an HLS manifest string. It provides for consistent resolution
 * of playlists, media groups, and URIs as is done internally for VHS-downloaded
 * manifests. This is particularly useful in cases where a user may want to manipulate a
 * manifest object before passing it in as the source to VHS.
 *
 * @param {string} manifestString
 *        The downloaded manifest string
 * @param {Object[]} [customTagParsers]
 *        An array of custom tag parsers for the m3u8-parser instance
 * @param {Object[]} [customTagMappers]
 *         An array of custom tag mappers for the m3u8-parser instance
 */
export const parseManifest = ({
  manifestString,
  customTagParsers = [],
  customTagMappers = [],
  src
}) => {
  const parser = new M3u8Parser();

  customTagParsers.forEach(customParser => parser.addParser(customParser));
  customTagMappers.forEach(mapper => parser.addTagMapper(mapper));

  parser.push(manifestString);
  parser.end();

  const manifest = parser.manifest;

  addPropertiesToParsedManifest({ manifest, srcUri: src });

  return manifest;
};

/**
 * Load a playlist from a remote location
 *
 * @class PlaylistLoader
 * @extends Stream
 * @param {string|Object} src url or object of manifest
 * @param {boolean} withCredentials the withCredentials xhr option
 * @class
 */
export default class PlaylistLoader extends EventTarget {
  constructor(src, hls, options = { }) {
    super();

    if (!src) {
      throw new Error('A non-empty playlist URL or object is required');
    }

    const { withCredentials = false, handleManifestRedirects = false } = options;

    this.src = src;
    this.hls_ = hls;
    this.withCredentials = withCredentials;
    this.handleManifestRedirects = handleManifestRedirects;

    const hlsOptions = hls.options_;

    this.customTagParsers = (hlsOptions && hlsOptions.customTagParsers) || [];
    this.customTagMappers = (hlsOptions && hlsOptions.customTagMappers) || [];

    // initialize the loader state
    this.state = 'HAVE_NOTHING';

    // live playlist staleness timeout
    this.on('mediaupdatetimeout', () => {
      if (this.state !== 'HAVE_METADATA') {
        // only refresh the media playlist if no other activity is going on
        return;
      }

      this.state = 'HAVE_CURRENT_METADATA';

      this.request = this.hls_.xhr({
        uri: resolveUrl(this.master.uri, this.media().uri),
        withCredentials: this.withCredentials
      }, (error, req) => {
        // disposed
        if (!this.request) {
          return;
        }

        if (error) {
          return this.playlistRequestError(this.request, this.media().uri, 'HAVE_METADATA');
        }

        this.haveMetadata(this.request.responseText, this.media().uri);
      });
    });
  }

  playlistRequestError(xhr, url, startingState) {
    // any in-flight request is now finished
    this.request = null;

    if (startingState) {
      this.state = startingState;
    }

    this.error = {
      playlist: this.master.playlists[url],
      status: xhr.status,
      message: `HLS playlist request error at URL: ${url}.`,
      responseText: xhr.responseText,
      code: (xhr.status >= 500) ? 4 : 2
    };

    this.trigger('error');
  }

  // update the playlist loader's state in response to a new or
  // updated playlist.
  haveMetadata(playlist, url) {
    // any in-flight request is now finished
    this.request = null;
    this.state = 'HAVE_METADATA';

    const manifest = typeof playlist === 'string' ?
      parseManifest({
        manifestString: playlist,
        customTagParsers: this.customTagParsers,
        customTagMappers: this.customTagMappers,
        src: url
      }) : playlist;

    // merge this playlist into the master
    const update = updateMaster(this.master, manifest);

    this.targetDuration = manifest.targetDuration;

    if (update) {
      this.master = update;
      this.media_ = this.master.playlists[manifest.uri];
    } else {
      this.trigger('playlistunchanged');
    }

    // refresh live playlists after a target duration passes
    if (!this.media().endList) {
      window.clearTimeout(this.mediaUpdateTimeout);
      this.mediaUpdateTimeout = window.setTimeout(() => {
        this.trigger('mediaupdatetimeout');
      }, refreshDelay(this.media(), !!update));
    }

    this.trigger('loadedplaylist');
  }

  /**
    * Abort any outstanding work and clean up.
    */
  dispose() {
    this.stopRequest();
    window.clearTimeout(this.mediaUpdateTimeout);
    window.clearTimeout(this.finalRenditionTimeout);
  }

  stopRequest() {
    if (this.request) {
      const oldRequest = this.request;

      this.request = null;
      oldRequest.onreadystatechange = null;
      oldRequest.abort();
    }
  }

  /**
    * When called without any arguments, returns the currently
    * active media playlist. When called with a single argument,
    * triggers the playlist loader to asynchronously switch to the
    * specified media playlist. Calling this method while the
    * loader is in the HAVE_NOTHING causes an error to be emitted
    * but otherwise has no effect.
    *
    * @param {Object=} playlist the parsed media playlist
    * object to switch to
    * @param {boolean=} is this the last available playlist
    *
    * @return {Playlist} the current loaded media
    */
  media(playlist, isFinalRendition) {
    // getter
    if (!playlist) {
      return this.media_;
    }

    // setter
    if (this.state === 'HAVE_NOTHING') {
      throw new Error('Cannot switch media playlist from ' + this.state);
    }

    // find the playlist object if the target playlist has been
    // specified by URI
    if (typeof playlist === 'string') {
      if (!this.master.playlists[playlist]) {
        throw new Error('Unknown playlist URI: ' + playlist);
      }
      playlist = this.master.playlists[playlist];
    }

    window.clearTimeout(this.finalRenditionTimeout);

    if (isFinalRendition) {
      const delay = (playlist.targetDuration / 2) * 1000 || 5 * 1000;

      this.finalRenditionTimeout =
        window.setTimeout(this.media.bind(this, playlist, false), delay);
      return;
    }

    const startingState = this.state;
    const mediaChange = !this.media_ || playlist.uri !== this.media_.uri;

    // switch to fully loaded playlists immediately
    if (this.master.playlists[playlist.uri].endList ||
        // handle the case of a playlist object pre-loaded (e.g., if using the a data URI
        // with a manifest object and demuxed audio, where the playlist will be within
        // mediaGroups)
        (playlist.endList && playlist.segments.length)) {
      // abort outstanding playlist requests
      if (this.request) {
        this.request.onreadystatechange = null;
        this.request.abort();
        this.request = null;
      }
      this.state = 'HAVE_METADATA';
      this.media_ = playlist;

      // trigger media change if the active media has been updated
      if (mediaChange) {
        this.trigger('mediachanging');

        if (startingState === 'HAVE_MASTER') {
          // The initial playlist was a master manifest, and the first media selected was
          // also provided (in the form of a resolved playlist object) as part of the
          // source object (rather than just a URL).  Therefore, since the media playlist
          // doesn't need to be requested, loadedmetadata won't trigger as part of the
          // normal flow, and needs an explicit trigger here.
          this.trigger('loadedmetadata');
        } else {
          this.trigger('mediachange');
        }
      }
      return;
    }

    // switching to the active playlist is a no-op
    if (!mediaChange) {
      return;
    }

    this.state = 'SWITCHING_MEDIA';

    // there is already an outstanding playlist request
    if (this.request) {
      if (playlist.resolvedUri === this.request.url) {
        // requesting to switch to the same playlist multiple times
        // has no effect after the first
        return;
      }
      this.request.onreadystatechange = null;
      this.request.abort();
      this.request = null;
    }

    // request the new playlist
    if (this.media_) {
      this.trigger('mediachanging');
    }

    this.request = this.hls_.xhr({
      uri: playlist.resolvedUri,
      withCredentials: this.withCredentials
    }, (error, req) => {
      // disposed
      if (!this.request) {
        return;
      }

      playlist.resolvedUri = resolveManifestRedirect(
        this.handleManifestRedirects,
        playlist.resolvedUri,
        req.responseURL
      );

      if (error) {
        return this.playlistRequestError(this.request, playlist.uri, startingState);
      }

      this.haveMetadata(req.responseText, playlist.uri);

      // fire loadedmetadata the first time a media playlist is loaded
      if (startingState === 'HAVE_MASTER') {
        this.trigger('loadedmetadata');
      } else {
        this.trigger('mediachange');
      }
    });
  }

  /**
   * pause loading of the playlist
   */
  pause() {
    this.stopRequest();
    window.clearTimeout(this.mediaUpdateTimeout);
    if (this.state === 'HAVE_NOTHING') {
      // If we pause the loader before any data has been retrieved, its as if we never
      // started, so reset to an unstarted state.
      this.started = false;
    }
    // Need to restore state now that no activity is happening
    if (this.state === 'SWITCHING_MEDIA') {
      // if the loader was in the process of switching media, it should either return to
      // HAVE_MASTER or HAVE_METADATA depending on if the loader has loaded a media
      // playlist yet. This is determined by the existence of loader.media_
      if (this.media_) {
        this.state = 'HAVE_METADATA';
      } else {
        this.state = 'HAVE_MASTER';
      }
    } else if (this.state === 'HAVE_CURRENT_METADATA') {
      this.state = 'HAVE_METADATA';
    }
  }

  /**
   * start loading of the playlist
   */
  load(isFinalRendition) {
    window.clearTimeout(this.mediaUpdateTimeout);

    const media = this.media();

    if (isFinalRendition) {
      const delay = media ? (media.targetDuration / 2) * 1000 : 5 * 1000;

      this.mediaUpdateTimeout = window.setTimeout(() => this.load(), delay);
      return;
    }

    if (!this.started) {
      this.start();
      return;
    }

    if (media && !media.endList) {
      this.trigger('mediaupdatetimeout');
    } else {
      this.trigger('loadedplaylist');
    }
  }

  /**
   * start loading of the playlist
   */
  start() {
    this.started = true;

    if (typeof this.src === 'object') {
      // uri is expected to be part of the object, but resolvedUri is added on internally
      this.src.resolvedUri = this.src.uri;

      // Although a user may have provided an already VHS-processed manifest object as the
      // source, since JSON can't represent certain attributes used by VHS (namely, in the
      // playlists array VHS will add named properties), processing the manifest object
      // through our property adding function should provide those non-representable
      // attributes.
      addPropertiesToParsedManifest({
        manifest: this.src,
        srcUri: this.src.uri
      });

      // Since a manifest object was passed in as the source (instead of a URL), the first
      // request can be skipped (since the top level of the manifest, at a minimum, is
      // already available as a parsed manifest object. However, it's still possible, if
      // the manifest object represents a master playlist, that some media playlists will
      // need to be resolved before the starting segment list is available. Therefore,
      // go directly to setup of the initial playlist, and let the normal flow continue
      // from there.
      //
      // Note that the call to setup is asynchronous, as other sections of VHS may assume
      // that the first request is asynchronous.
      setTimeout(() => {
        this.setupInitialPlaylist(this.src);
      }, 0);
      return;
    }

    // request the specified URL
    this.request = this.hls_.xhr({
      uri: this.src,
      withCredentials: this.withCredentials
    }, (error, req) => {
      // disposed
      if (!this.request) {
        return;
      }

      // clear the loader's request reference
      this.request = null;

      if (error) {
        this.error = {
          status: req.status,
          message: `HLS playlist request error at URL: ${this.src}.`,
          responseText: req.responseText,
          // MEDIA_ERR_NETWORK
          code: 2
        };
        if (this.state === 'HAVE_NOTHING') {
          this.started = false;
        }
        return this.trigger('error');
      }

      this.src = resolveManifestRedirect(
        this.handleManifestRedirects,
        this.src,
        req.responseURL
      );

      const manifest = parseManifest({
        manifestString: req.responseText,
        customTagParsers: this.customTagParsers,
        customTagMappers: this.customTagMappers,
        src: this.src
      });

      manifest.uri = this.src;
      manifest.resolvedUri = this.src;

      this.setupInitialPlaylist(manifest);
    });
  }

  /**
   * Given a manifest object that's either a master or media playlist, trigger the proper
   * events and set the state of the playlist loader.
   *
   * If the manifest object represents a master playlist, `loadedplaylist` will be
   * triggered to allow listeners to select a playlist, or, the loader will default to the
   * first one.
   *
   * If the manifest object represents a media playlist, `loadedplaylist` will be
   * triggered followed by `loadedmetadata`, as the only available playlist is loaded.
   *
   * In the case of a media playlist, a master playlist object wrapper with one playlist
   * will be created so that all logic can handle playlists in the same fashion (as an
   * assumed manifest object schema).
   *
   * @param {Object} manifest
   *        The parsed manifest object
   */
  setupInitialPlaylist(manifest) {
    this.state = 'HAVE_MASTER';

    if (manifest.playlists) {
      this.master = manifest;
      this.trigger('loadedplaylist');
      if (!this.request) {
        // no media playlist was specifically selected so start
        // from the first listed one
        this.media(this.master.playlists[0]);
      }
      return;
    }

    // loaded a media playlist, infer a master playlist
    this.master = {
      mediaGroups: {
        'AUDIO': {},
        'VIDEO': {},
        'CLOSED-CAPTIONS': {},
        'SUBTITLES': {}
      },
      uri: window.location.href,
      playlists: [{
        uri: this.src,
        id: 0,
        resolvedUri: this.src,
        // m3u8-parser does not attach an attributes property to media playlists so make
        // sure that the property is attached to avoid undefined reference errors
        attributes: {}
      }]
    };

    // In the case where a media playlist was passed in as an object, use the playlist's
    // resolved URI attribute (since there's no reference to the source URI otherwise).
    const playlistId = typeof this.src === 'string' ? this.src : this.src.resolvedUri;

    this.master.playlists[playlistId] = this.master.playlists[0];
    this.haveMetadata(manifest, this.src);
    return this.trigger('loadedmetadata');
  }
}
