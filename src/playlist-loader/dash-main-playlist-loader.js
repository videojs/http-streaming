import PlaylistLoader from './playlist-loader.js';
import {resolveUrl} from '../resolve-url';
import {parse as parseMpd, parseUTCTiming} from 'mpd-parser';
import {mergeManifest, forEachPlaylist} from './utils.js';

class DashMainPlaylistLoader extends PlaylistLoader {
  constructor(uri, options) {
    super(uri, options);
    this.clientOffset_ = null;
    this.sidxMapping_ = {};
    this.mediaList_ = options.mediaList;
    this.clientClockOffset_ = null;
    this.setMediaRefreshTimeout_ = this.setMediaRefreshTimeout_.bind(this);
  }

  playlists() {
    const playlists = [];

    forEachPlaylist(this.manifest_, (media) => {
      playlists.push(media);
    });

    return playlists;
  }

  parseManifest_(manifestString, callback) {
    this.syncClientServerClock_(manifestString, (clientOffset) => {
      const parsedManifest = parseMpd(manifestString, {
        manifestUri: this.uri_,
        clientOffset,
        sidxMapping: this.sidxMapping_
      });

      // merge everything except for playlists, they will merge themselves
      const mergeResult = mergeManifest(this.manifest_, parsedManifest, ['playlists']);

      // always trigger updated, as playlists will have to update themselves
      callback(mergeResult.manifest, true);
    });
  }

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

  // used by dash media playlist loaders in cases where
  // minimumUpdatePeriod is zero
  setMediaRefreshTime_(time) {
    this.mediaRefreshTime_ = time;
    this.setMediaRefreshTimeout_();
  }

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
