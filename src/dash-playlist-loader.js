import { EventTarget, mergeOptions } from 'video.js';
import { parse as parseMpd, parseUTCTiming } from 'mpd-parser';
import {
  refreshDelay,
  setupMediaPlaylists,
  resolveMediaGroupUris,
  updateMaster as updatePlaylist,
  forEachMediaGroup
} from './playlist-loader';
import resolveUrl from './resolve-url';
import window from 'global/window';

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
      }
    }
  });

  return update;
};

export default class DashPlaylistLoader extends EventTarget {
  // DashPlaylistLoader must accept either a src url or a playlist because subsequent
  // playlist loader setups from media groups will expect to be able to pass a playlist
  // (since there aren't external URLs to media playlists with DASH)
  constructor(srcUrlOrPlaylist, hls, withCredentials, masterPlaylistLoader) {
    super();

    this.hls_ = hls;
    this.withCredentials = withCredentials;

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

    // initialize the loader state
    if (typeof srcUrlOrPlaylist === 'string') {
      this.srcUrl = srcUrlOrPlaylist;
      this.state = 'HAVE_NOTHING';
      return;
    }

    this.masterPlaylistLoader_ = masterPlaylistLoader;

    this.state = 'HAVE_METADATA';
    this.started = true;
    // we only should have one playlist so select it
    this.media(srcUrlOrPlaylist);
    // trigger async to mimic behavior of HLS, where it must request a playlist
    window.setTimeout(() => {
      this.trigger('loadedmetadata');
    }, 0);
  }

  dispose() {
    this.stopRequest();
    window.clearTimeout(this.mediaUpdateTimeout);
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

    this.state = 'HAVE_METADATA';

    // switching to the active playlist is a no-op
    if (!mediaChange) {
      return;
    }

    // switching from an already loaded playlist
    if (this.media_) {
      this.trigger('mediachanging');
    }

    this.media_ = playlist;

    this.refreshMedia_();

    // trigger media change if the active media has been updated
    if (startingState !== 'HAVE_MASTER') {
      this.trigger('mediachange');
    }
  }

  pause() {
    this.stopRequest();
    if (this.state === 'HAVE_NOTHING') {
      // If we pause the loader before any data has been retrieved, its as if we never
      // started, so reset to an unstarted state.
      this.started = false;
    }
  }

  load() {
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

  /**
   * Handler for after client/server clock synchronization has happened. Sets up
   * xml refresh timer if specificed by the manifest.
   */
  onClientServerClockSync_() {
    this.master = this.parseMasterXml();

    this.state = 'HAVE_MASTER';

    this.trigger('loadedplaylist');

    if (!this.media_) {
      // no media playlist was specifically selected so start
      // from the first listed one
      this.media(this.master.playlists[0]);
    }
    // trigger loadedmetadata to resolve setup of media groups
    // trigger async to mimic behavior of HLS, where it must request a playlist
    window.setTimeout(() => {
      this.trigger('loadedmetadata');
    }, 0);

    // TODO: minimumUpdatePeriod can have a value of 0. Currently the manifest will not
    // be refreshed when this is the case. The inter-op guide says that when the
    // minimumUpdatePeriod is 0, the manifest should outline all currently available
    // segments, but future segments may require an update. I think a good solution
    // would be to update the manifest at the same rate that the media playlists
    // are "refreshed", i.e. every targetDuration.
    if (this.master.minimumUpdatePeriod) {
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

      this.master = updateMaster(this.master, newMaster);

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
