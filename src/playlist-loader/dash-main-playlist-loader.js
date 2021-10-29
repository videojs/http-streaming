import PlaylistLoader from './playlist-loader.js';
import {resolveUrl} from '../resolve-url';
import {parse as parseMpd, parseUTCTiming} from 'mpd-parser';
import {mergeManifest} from './utils.js';

class DashMainPlaylistLoader extends PlaylistLoader {
  constructor(uri, options) {
    super(uri, options);
    this.clientOffset_ = null;
    this.sidxMapping_ = {};
    this.mediaList_ = options.mediaList;
    this.clientClockOffset_ = null;
    this.setMediaRefreshTimeout_ = this.setMediaRefreshTimeout_.bind(this);
  }

  parseManifest_(manifestString, callback) {
    this.syncClientServerClock_(manifestString, (clientOffset) => {
      const parsedManifest = parseMpd(manifestString, {
        manifestUri: this.uri_,
        clientOffset,
        sidxMapping: this.sidxMapping_
      });

      // merge everything except for playlists, they will merge themselves
      const main = mergeManifest(this.manifest_, parsedManifest, ['playlists']);

      // always trigger updated, as playlists will have to update themselves
      callback(main, true);
    });
  }

  syncClientServerClock_(manifestString, callback) {
    const utcTiming = parseUTCTiming(manifestString);

    // No UTCTiming element found in the mpd. Use Date header from mpd request as the
    // server clock
    if (utcTiming === null) {
      return callback(this.lastRequestTime() - Date.now());
    }

    if (utcTiming.method === 'DIRECT') {
      return callback(utcTiming.value - Date.now());
    }

    this.makeRequest({
      uri: resolveUrl(this.uri(), utcTiming.value),
      method: utcTiming.method
    }, function(request) {
      let serverTime;

      if (utcTiming.method === 'HEAD') {
        if (!request.responseHeaders || !request.responseHeaders.date) {
          // expected date header not preset, fall back to using date header from mpd
          this.logger_('warning expected date header from mpd not present, using mpd request time.');
          serverTime = this.lastRequestTime();
        } else {
          serverTime = Date.parse(request.responseHeaders.date);
        }
      } else {
        serverTime = Date.parse(request.responseText);
      }

      callback(serverTime - Date.now());
    });
  }

  // used by dash media playlist loaders in cases where
  // minimumUpdatePeriod is zero
  setMediaRefreshTime_(time) {
    if (!this.getMediaRefreshTime_()) {
      this.setMediaRefreshTimeout_(time);
    }
  }

  getMediaRefreshTime_() {
    const minimumUpdatePeriod = this.manifest_.minimumUpdatePeriod;

    // if minimumUpdatePeriod is invalid or <= zero, which
    // can happen when a live video becomes VOD. We do not have
    // a media refresh time.
    if (typeof minimumUpdatePeriod !== 'number' || minimumUpdatePeriod < 0) {
      return;
    }

    // If the minimumUpdatePeriod has a value of 0, that indicates that the current
    // MPD has no future validity, so a new one will need to be acquired when new
    // media segments are to be made available. Thus, we use the target duration
    // in this case
    // TODO: can we do this in a better way? It would be much better
    // if DashMainPlaylistLoader didn't care about media playlist loaders at all.
    if (minimumUpdatePeriod === 0) {
      return;
    }

    return minimumUpdatePeriod;
  }

}

export default DashMainPlaylistLoader;
