import PlaylistLoader from './playlist-loader.js';
import {resolveUrl} from '../resolve-url';
import {parse as parseMpd, parseUTCTiming} from 'mpd-parser';
import {mergeManifest, forEachPlaylist} from './utils.js';

/**
 * An instance of the `DashMainPlaylistLoader` class is created when VHS is passed a DASH
 * manifest. For dash main playlists are the only thing that needs to be refreshed. This
 * is important to note as a lot of the `DashMediaPlaylistLoader` logic looks to
 * `DashMainPlaylistLoader` for guidance.
 *
 * @extends PlaylistLoader
 */
class DashMainPlaylistLoader extends PlaylistLoader {

  /**
   * Create an instance of this class.
   *
   * @param {Element} uri
   *        The uri of the manifest.
   *
   * @param {Object} options
   *        Options that can be used, see the base class for more information.
   */
  constructor(uri, options) {
    super(uri, options);
    this.clientOffset_ = null;
    this.clientClockOffset_ = null;
    this.setMediaRefreshTimeout_ = this.setMediaRefreshTimeout_.bind(this);
  }

  /**
   * Get an array of all playlists in this manifest, including media group
   * playlists.
   *
   * @return {Object[]}
   *          An array of playlists.
   */
  playlists() {
    const playlists = [];

    forEachPlaylist(this.manifest_, (media) => {
      playlists.push(media);
    });

    return playlists;
  }

  /**
   * Parse a new manifest and merge it with an old one. Calls back
   * with the merged manifest and weather or not it was updated.
   *
   * @param {string} manifestString
   *        A manifest string directly from the request response.
   *
   * @param {Function} callback
   *        A callback that takes the manifest and updated
   *
   * @private
   */
  parseManifest_(manifestString, callback) {
    this.syncClientServerClock_(manifestString, (clientOffset) => {
      const parsedManifest = parseMpd(manifestString, {
        manifestUri: this.uri_,
        clientOffset
      });

      // merge everything except for playlists, they will merge themselves
      const mergeResult = mergeManifest(this.manifest_, parsedManifest, ['playlists']);

      // always trigger updated, as playlists will have to update themselves
      callback(mergeResult.manifest, true);
    });
  }

  /**
   * Used by parsedManifest to get the client server sync offest.
   *
   * @param {string} manifestString
   *        A manifest string directly from the request response.
   *
   * @param {Function} callback
   *        A callback that takes the client offset
   *
   * @private
   */
  syncClientServerClock_(manifestString, callback) {
    let utcTiming;

    try {
      utcTiming = parseUTCTiming(manifestString);
    } catch (e) {
      utcTiming = null;
    }

    // No UTCTiming element found in the mpd. Use Date header from mpd request as the
    // server clock
    if (utcTiming === null) {
      return callback(this.lastRequestTime() - Date.now());
    }

    if (utcTiming.method === 'DIRECT') {
      return callback(utcTiming.value - Date.now());
    }

    this.makeRequest_({
      uri: resolveUrl(this.uri(), utcTiming.value),
      method: utcTiming.method,
      handleErrors: false
    }, (request, wasRedirected, error) => {
      let serverTime = this.lastRequestTime();

      if (!error && utcTiming.method === 'HEAD' && request.responseHeaders && request.responseHeaders.date) {
        serverTime = Date.parse(request.responseHeaders.date);
      }

      if (!error && request.responseText) {
        serverTime = Date.parse(request.responseText);
      }

      callback(serverTime - Date.now());
    });
  }

  /**
   * Used by DashMediaPlaylistLoader in cases where
   * minimumUpdatePeriod is zero. This allows the currently active
   * playlist to set the mediaRefreshTime_ time to it's targetDuration.
   *
   * @param {number} time
   *        Set the mediaRefreshTime
   *
   * @private
   */
  setMediaRefreshTime_(time) {
    this.mediaRefreshTime_ = time;
    this.setMediaRefreshTimeout_();
  }

  /**
   * Get the amount of time that should elapse before the media is
   * re-requested. Returns null if it shouldn't be re-requested. For
   * Dash we look at minimumUpdatePeriod (from the manifest) or the
   * targetDuration of the currently selected media
   * (from a DashMediaPlaylistLoader).
   *
   * @return {number}
   *         Returns the media refresh time
   *
   * @private
   */
  getMediaRefreshTime_() {
    const minimumUpdatePeriod = this.manifest_.minimumUpdatePeriod;

    // if minimumUpdatePeriod is invalid or <= zero, which
    // can happen when a live video becomes VOD. We do not have
    // a media refresh time.
    if (typeof minimumUpdatePeriod !== 'number' || minimumUpdatePeriod < 0) {
      return null;
    }

    // If the minimumUpdatePeriod has a value of 0, that indicates that the current
    // MPD has no future validity, so a new one will need to be acquired when new
    // media segments are to be made available. Thus, we use the target duration
    // in this case
    // TODO: can we do this in a better way? It would be much better
    // if DashMainPlaylistLoader didn't care about media playlist loaders at all.
    // Right now DashMainPlaylistLoader's call `setMediaRefreshTime_` to set
    // the medias target duration.
    if (minimumUpdatePeriod === 0) {
      return this.mediaRefreshTime_;
    }

    return minimumUpdatePeriod;
  }

}

export default DashMainPlaylistLoader;
