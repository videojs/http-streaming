import videojs from 'video.js';
import { parse as parseMpd, parseUTCTiming } from 'mpd-parser';
import {
  refreshDelay,
  setupMediaPlaylists,
  resolveMediaGroupUris,
  updateMaster as updatePlaylist,
  forEachMediaGroup
} from './playlist-loader';
import { resolveUrl, resolveManifestRedirect } from './resolve-url';
import window from 'global/window';

const { EventTarget, mergeOptions } = videojs;

/**
 * Returns a new master manifest that is the result of merging an updated master manifest
 * into the original version.
 *
 * @param {Object} oldMaster
 *        The old parsed mpd object
 * @param {Object} newMaster
 *        The updated parsed mpd object
 * @return {Object}
 *         A new object representing the original master manifest with the updated media
 *         playlists merged in
 */
export const updateMaster = (oldMaster, newMaster) => {
  let noChanges;
  let update = mergeOptions(oldMaster, {
    // These are top level properties that can be updated
    duration: newMaster.duration,
    minimumUpdatePeriod: newMaster.minimumUpdatePeriod
  });

  // First update the playlists in playlist list
  for (let i = 0; i < newMaster.playlists.length; i++) {
    const playlistUpdate = updatePlaylist(update, newMaster.playlists[i]);

    if (playlistUpdate) {
      update = playlistUpdate;
    } else {
      noChanges = true;
    }
  }

  // Then update media group playlists
  forEachMediaGroup(newMaster, (properties, type, group, label) => {
    if (properties.playlists && properties.playlists.length) {
      const uri = properties.playlists[0].uri;
      const playlistUpdate = updatePlaylist(update, properties.playlists[0]);

      if (playlistUpdate) {
        update = playlistUpdate;
        // update the playlist reference within media groups
        update.mediaGroups[type][group][label].playlists[0] = update.playlists[uri];
        noChanges = false;
      }
    }
  });

  if (noChanges) {
    return null;
  }

  return update;
};

export default class DashPlaylistLoader extends EventTarget {
  // DashPlaylistLoader must accept either a src url or a playlist because subsequent
  // playlist loader setups from media groups will expect to be able to pass a playlist
  // (since there aren't external URLs to media playlists with DASH)
  constructor(srcUrlOrPlaylist, hls, options = { }, masterPlaylistLoader) {
    super();

    const { withCredentials = false, handleManifestRedirects = false } = options;

    this.hls_ = hls;
    this.withCredentials = withCredentials;
    this.handleManifestRedirects = handleManifestRedirects;

    if (!srcUrlOrPlaylist) {
      throw new Error('A non-empty playlist URL or playlist is required');
    }

    // event naming?
    this.on('minimumUpdatePeriod', () => {
      this.refreshXml_();
    });

    // live playlist staleness timeout
    this.on('mediaupdatetimeout', () => {
      this.refreshMedia_();
    });

    this.state = 'HAVE_NOTHING';
    this.loadedPlaylists_ = {};

    // initialize the loader state
    // The masterPlaylistLoader will be created with a string
    if (typeof srcUrlOrPlaylist === 'string') {
      this.srcUrl = srcUrlOrPlaylist;
      return;
    }

    this.setupChildLoader(masterPlaylistLoader, srcUrlOrPlaylist);
  }

  setupChildLoader(masterPlaylistLoader, playlist) {
    this.masterPlaylistLoader_ = masterPlaylistLoader;
    this.childPlaylist_ = playlist;
  }

  dispose() {
    this.stopRequest();
    this.loadedPlaylists_ = {};
    window.clearTimeout(this.mediaUpdateTimeout);
  }

  hasPendingRequest() {
    return this.request || this.mediaRequest_;
  }

  stopRequest() {
    if (this.request) {
      const oldRequest = this.request;

      this.request = null;
      oldRequest.onreadystatechange = null;
      oldRequest.abort();
    }
  }

  media(playlist) {
    // getter
    if (!playlist) {
      return this.media_;
    }

    // setter
    if (this.state === 'HAVE_NOTHING') {
      throw new Error('Cannot switch media playlist from ' + this.state);
    }

    const startingState = this.state;

    // find the playlist object if the target playlist has been specified by URI
    if (typeof playlist === 'string') {
      if (!this.master.playlists[playlist]) {
        throw new Error('Unknown playlist URI: ' + playlist);
      }
      playlist = this.master.playlists[playlist];
    }

    const mediaChange = !this.media_ || playlist.uri !== this.media_.uri;

    // switch to previously loaded playlists immediately
    if (mediaChange &&
        this.loadedPlaylists_[playlist.uri] &&
        this.loadedPlaylists_[playlist.uri].endList) {
      this.state = 'HAVE_METADATA';
      this.media_ = playlist;

      // trigger media change if the active media has been updated
      if (mediaChange) {
        this.trigger('mediachanging');
        this.trigger('mediachange');
      }
      return;
    }

    // switching to the active playlist is a no-op
    if (!mediaChange) {
      return;
    }

    // switching from an already loaded playlist
    if (this.media_) {
      this.trigger('mediachanging');
    }

    // TODO: check for sidx here

    // Continue asynchronously if there is no sidx
    // wait one tick to allow haveMaster to run first on a child loader
    this.mediaRequest_ = window.setTimeout(
      this.haveMetadata.bind(this, { startingState, playlist }),
      0
    );
  }

  haveMetadata({startingState, playlist}) {
    this.state = 'HAVE_METADATA';
    this.media_ = playlist;
    this.loadedPlaylists_[playlist.uri] = playlist;
    this.mediaRequest_ = null;

    // This will trigger loadedplaylist
    this.refreshMedia_();

    // fire loadedmetadata the first time a media playlist is loaded
    // to resolve setup of media groups
    if (startingState === 'HAVE_MASTER') {
      this.trigger('loadedmetadata');
    } else {
      // trigger media change if the active media has been updated
      this.trigger('mediachange');
    }
  }

  pause() {
    this.stopRequest();
    window.clearTimeout(this.mediaUpdateTimeout);
    if (this.state === 'HAVE_NOTHING') {
      // If we pause the loader before any data has been retrieved, its as if we never
      // started, so reset to an unstarted state.
      this.started = false;
    }
  }

  load(isFinalRendition) {
    window.clearTimeout(this.mediaUpdateTimeout);

    const media = this.media();

    if (isFinalRendition) {
      const delay = media ? (media.targetDuration / 2) * 1000 : 5 * 1000;

      this.mediaUpdateTimeout = window.setTimeout(() => this.load(), delay);
      return;
    }

    // because the playlists are internal to the manifest, load should either load the
    // main manifest, or do nothing but trigger an event
    if (!this.started) {
      this.start();
      return;
    }

    this.trigger('loadedplaylist');
  }

  /**
   * Parses the master xml string and updates playlist uri references
   *
   * @return {Object}
   *         The parsed mpd manifest object
   */
  parseMasterXml() {
    const master = parseMpd(this.masterXml_, {
      manifestUri: this.srcUrl,
      clientOffset: this.clientOffset_
    });

    master.uri = this.srcUrl;

    // Set up phony URIs for the playlists since we won't have external URIs for DASH
    // but reference playlists by their URI throughout the project
    // TODO: Should we create the dummy uris in mpd-parser as well (leaning towards yes).
    for (let i = 0; i < master.playlists.length; i++) {
      const phonyUri = `placeholder-uri-${i}`;

      master.playlists[i].uri = phonyUri;
      // set up by URI references
      master.playlists[phonyUri] = master.playlists[i];
    }

    // set up phony URIs for the media group playlists since we won't have external
    // URIs for DASH but reference playlists by their URI throughout the project
    forEachMediaGroup(master, (properties, mediaType, groupKey, labelKey) => {
      if (properties.playlists && properties.playlists.length) {
        const phonyUri = `placeholder-uri-${mediaType}-${groupKey}-${labelKey}`;

        properties.playlists[0].uri = phonyUri;
        // setup URI references
        master.playlists[phonyUri] = properties.playlists[0];
      }
    });

    setupMediaPlaylists(master);
    resolveMediaGroupUris(master);

    return master;
  }

  start() {
    this.started = true;

    // We don't need to request the master manifest again
    // Call this asynchronously to match the xhr request behavior below
    if (this.masterPlaylistLoader_) {
      this.mediaRequest_ = window.setTimeout(
        this.haveMaster_.bind(this),
        0
      );
      return;
    }

    // request the specified URL
    this.request = this.hls_.xhr({
      uri: this.srcUrl,
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
          message: 'DASH playlist request error at URL: ' + this.srcUrl,
          responseText: req.responseText,
          // MEDIA_ERR_NETWORK
          code: 2
        };
        if (this.state === 'HAVE_NOTHING') {
          this.started = false;
        }
        return this.trigger('error');
      }

      this.masterXml_ = req.responseText;

      if (req.responseHeaders && req.responseHeaders.date) {
        this.masterLoaded_ = Date.parse(req.responseHeaders.date);
      } else {
        this.masterLoaded_ = Date.now();
      }

      this.srcUrl = resolveManifestRedirect(this.handleManifestRedirects, this.srcUrl, req);

      this.syncClientServerClock_(this.onClientServerClockSync_.bind(this));
    });
  }

  /**
   * Parses the master xml for UTCTiming node to sync the client clock to the server
   * clock. If the UTCTiming node requires a HEAD or GET request, that request is made.
   *
   * @param {Function} done
   *        Function to call when clock sync has completed
   */
  syncClientServerClock_(done) {
    const utcTiming = parseUTCTiming(this.masterXml_);

    // No UTCTiming element found in the mpd. Use Date header from mpd request as the
    // server clock
    if (utcTiming === null) {
      this.clientOffset_ = this.masterLoaded_ - Date.now();
      return done();
    }

    if (utcTiming.method === 'DIRECT') {
      this.clientOffset_ = utcTiming.value - Date.now();
      return done();
    }

    this.request = this.hls_.xhr({
      uri: resolveUrl(this.srcUrl, utcTiming.value),
      method: utcTiming.method,
      withCredentials: this.withCredentials
    }, (error, req) => {
      // disposed
      if (!this.request) {
        return;
      }

      if (error) {
        // sync request failed, fall back to using date header from mpd
        // TODO: log warning
        this.clientOffset_ = this.masterLoaded_ - Date.now();
        return done();
      }

      let serverTime;

      if (utcTiming.method === 'HEAD') {
        if (!req.responseHeaders || !req.responseHeaders.date) {
          // expected date header not preset, fall back to using date header from mpd
          // TODO: log warning
          serverTime = this.masterLoaded_;
        } else {
          serverTime = Date.parse(req.responseHeaders.date);
        }
      } else {
        serverTime = Date.parse(req.responseText);
      }

      this.clientOffset_ = serverTime - Date.now();

      done();
    });
  }

  haveMaster_() {
    this.state = 'HAVE_MASTER';
    // clear media request
    this.mediaRequest_ = null;

    if (!this.masterPlaylistLoader_) {
      this.master = this.parseMasterXml();
      // We have the master playlist at this point, so
      // trigger this to allow MasterPlaylistController
      // to make an initial playlist selection
      this.trigger('loadedplaylist');
    } else if (!this.media_) {
      // no media playlist was specifically selected so select
      // the one the child playlist loader was created with
      this.media(this.childPlaylist_);
    }
  }

  /**
   * Handler for after client/server clock synchronization has happened. Sets up
   * xml refresh timer if specificed by the manifest.
   */
  onClientServerClockSync_() {
    this.haveMaster_();

    if (!this.hasPendingRequest() && !this.media_) {
      this.media(this.master.playlists[0]);
    }

    // TODO: minimumUpdatePeriod can have a value of 0. Currently the manifest will not
    // be refreshed when this is the case. The inter-op guide says that when the
    // minimumUpdatePeriod is 0, the manifest should outline all currently available
    // segments, but future segments may require an update. I think a good solution
    // would be to update the manifest at the same rate that the media playlists
    // are "refreshed", i.e. every targetDuration.
    if (this.master && this.master.minimumUpdatePeriod) {
      window.setTimeout(() => {
        this.trigger('minimumUpdatePeriod');
      }, this.master.minimumUpdatePeriod);
    }
  }

  /**
   * Sends request to refresh the master xml and updates the parsed master manifest
   * TODO: Does the client offset need to be recalculated when the xml is refreshed?
   */
  refreshXml_() {
    // The srcUrl here *may* need to pass through handleManifestsRedirects when
    // sidx is implemented
    this.request = this.hls_.xhr({
      uri: this.srcUrl,
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
          message: 'DASH playlist request error at URL: ' + this.srcUrl,
          responseText: req.responseText,
          // MEDIA_ERR_NETWORK
          code: 2
        };
        if (this.state === 'HAVE_NOTHING') {
          this.started = false;
        }
        return this.trigger('error');
      }

      this.masterXml_ = req.responseText;

      const newMaster = this.parseMasterXml();
      const updatedMaster = updateMaster(this.master, newMaster);

      if (updatedMaster) {
        this.master = updatedMaster;
      }

      window.setTimeout(() => {
        this.trigger('minimumUpdatePeriod');
      }, this.master.minimumUpdatePeriod);
    });
  }

  /**
   * Refreshes the media playlist by re-parsing the master xml and updating playlist
   * references. If this is an alternate loader, the updated parsed manifest is retrieved
   * from the master loader.
   */
  refreshMedia_() {
    let oldMaster;
    let newMaster;

    if (this.masterPlaylistLoader_) {
      oldMaster = this.masterPlaylistLoader_.master;
      newMaster = this.masterPlaylistLoader_.parseMasterXml();
    } else {
      oldMaster = this.master;
      newMaster = this.parseMasterXml();
    }

    const updatedMaster = updateMaster(oldMaster, newMaster);

    if (updatedMaster) {
      if (this.masterPlaylistLoader_) {
        this.masterPlaylistLoader_.master = updatedMaster;
      } else {
        this.master = updatedMaster;
      }
      this.media_ = updatedMaster.playlists[this.media_.uri];
    } else {
      this.trigger('playlistunchanged');
    }

    if (!this.media().endList) {
      this.mediaUpdateTimeout = window.setTimeout(()=> {
        this.trigger('mediaupdatetimeout');
      }, refreshDelay(this.media(), !!updatedMaster));
    }

    this.trigger('loadedplaylist');
  }
}
