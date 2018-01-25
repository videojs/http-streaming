import { EventTarget } from 'video.js';
import mpdParser from 'mpd-parser';
import {
  setupMediaPlaylists,
  resolveMediaGroupUris
} from './playlist-loader';

/**
 *
 */
export default class DashPlaylistLoader extends EventTarget {
  // DashPlaylistLoader must accept either a src url or a playlist because subsequent
  // playlist loader setups from media groups will expect to be able to pass a playlist
  // (since there aren't external URLs to media playlists with DASH)

  /**
   *
   * @param {Object} srcUrlOrPlaylist
   * @param {Object} hls
   * @param {boolean} withCredentials
   */
  constructor(srcUrlOrPlaylist, hls, withCredentials) {
    super();

    this.hls_ = hls;
    this.withCredentials = withCredentials;

    if (!srcUrlOrPlaylist) {
      throw new Error('A non-empty playlist URL or playlist is required');
    }

    // initialize the loader state
    if (typeof srcUrlOrPlaylist === 'string') {
      this.srcUrl = srcUrlOrPlaylist;
      this.state = 'HAVE_NOTHING';
      return;
    }

    this.state = 'HAVE_METADATA';
    this.started = true;
    // we only should have one, so select it
    this.media(srcUrlOrPlaylist);
    // trigger async to mimic behavior of HLS, where it must request a playlist
    setTimeout(() => {
      this.trigger('loadedmetadata');
    }, 0);
  }

  /**
   *
   */
  dispose() {
    this.stopRequest();
  }

  /**
   *
   */
  stopRequest() {
    if (this.request) {
      const oldRequest = this.request;

      this.request = null;
      oldRequest.onreadystatechange = null;
      oldRequest.abort();
    }
  }

  /**
   *
   * @param {Object} playlist
   *
   * @return {Object}
   */
  media(playlist) {
    // getter
    if (!playlist) {
      return this.media_;
    }

    // setter
    if (this.state === 'HAVE_NOTHING') {
      throw new Error('Cannot switch media playlist from ' + this.state);
    }

    // find the playlist object if the target playlist has been specified by URI
    if (typeof playlist === 'string') {
      if (!this.master.playlists[playlist]) {
        throw new Error('Unknown playlist URI: ' + playlist);
      }
      playlist = this.master.playlists[playlist];
    }

    const mediaChange = !this.media_ || playlist.uri !== this.media_.uri;

    this.state = 'HAVE_METADATA';
    this.media_ = playlist;

    // trigger media change if the active media has been updated
    if (mediaChange) {
      this.trigger('mediachanging');
      // since every playlist is technically loaded, trigger that we loaded it
      this.trigger('loadedplaylist');
      this.trigger('mediachange');
    }
    return;
  }

  /**
   *
   */
  pause() {
    this.stopRequest();
    if (this.state === 'HAVE_NOTHING') {
      // If we pause the loader before any data has been retrieved, its as if we never
      // started, so reset to an unstarted state.
      this.started = false;
    }
  }

  /**
   *
   */
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
   *
   */
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

      this.master = mpdParser.parse(req.responseText, this.srcUrl);
      this.master.uri = this.srcUrl;

      this.state = 'HAVE_MASTER';

      // TODO mediaSequence will be added in mpd-parser
      this.master.playlists.forEach((playlist) => {
        playlist.mediaSequence = 0;
      });
      for (const groupKey in this.master.mediaGroups.AUDIO) {
        for (const labelKey in this.master.mediaGroups.AUDIO[groupKey]) {
          this.master.mediaGroups.AUDIO[groupKey][labelKey].playlists.forEach(
            (playlist) => {
              playlist.mediaSequence = 0;
            });
        }
      }

      // set up phony URIs for the playlists since we won't have external URIs for DASH
      // but reference playlists by their URI throughout the project
      for (let i = 0; i < this.master.playlists.length; i++) {
        const phonyUri = `placeholder-uri-${i}`;

        this.master.playlists[i].uri = phonyUri;
        // set up by URI references
        this.master.playlists[phonyUri] = this.master.playlists[i];
      }

      setupMediaPlaylists(this.master);
      resolveMediaGroupUris(this.master);

      this.trigger('loadedplaylist');
      if (!this.media_) {
        // no media playlist was specifically selected so start
        // from the first listed one
        this.media(this.master.playlists[0]);
      }
      // trigger loadedmetadata to resolve setup of media groups
      // trigger async to mimic behavior of HLS, where it must request a playlist
      setTimeout(() => {
        this.trigger('loadedmetadata');
      }, 0);
    });
  }
}
