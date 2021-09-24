import PlaylistLoader from './playlist-loader.js';
import {resolveUrl} from './resolve-url';
import {
  parse as parseMpd,
  parseUTCTiming
// TODO
// addSidxSegmentsToPlaylist,
// generateSidxKey,
} from 'mpd-parser';
import {forEachMediaGroup} from './utils.js';

export const findMedia = function(mainManifest, id) {
  if (!mainManifest || !mainManifest.playlists || !mainManifest.playlists.length) {
    return;
  }
  for (let i = 0; i < mainManifest.playlists.length; i++) {
    const media = mainManifest.playlists[i];

    if (media.id === id) {
      return media;
    }
  }

  let foundMedia;

  forEachMediaGroup(mainManifest, function(properties, type, group, label) {
    if (!properties.playlists) {
      return;
    }

    for (let i = 0; i < properties.playlists; i++) {
      const media = mainManifest.playlists[i];

      if (media.id === id) {
        foundMedia = media;
        return true;
      }
    }
  });

  return foundMedia;
};

const mergeMedia = function(oldMedia, newMedia) {

};

const mergeMainManifest = function(oldMain, newMain, sidxMapping) {
  const result = newMain;

  if (!oldMain) {
    return result;
  }

  result.playlists = [];

  // First update the media in playlist array
  for (let i = 0; i < newMain.playlists.length; i++) {
    const newMedia = newMain.playlists[i];
    const oldMedia = findMedia(oldMain, newMedia.id);
    const {updated, mergedMedia} = mergeMedia(oldMedia, newMedia);

    result.mergedManifest.playlists[i] = mergedMedia;

    if (updated) {
      result.updated = true;
    }
  }

  // Then update media group playlists
  forEachMediaGroup(newMain, (newProperties, type, group, label) => {
    const oldProperties = oldMain.mediaGroups &&
        oldMain.mediaGroups[type] && oldMain.mediaGroups[type][group] &&
        oldMain.mergedMedia[type][group][label];

    // nothing to merge.
    if (!oldProperties || !newProperties || !oldProperties.playlists || !newProperties.playlists || !oldProperties.Playlists.length || !newProperties.playlists.length) {
      return;
    }

    for (let i = 0; i < newProperties.playlists.length; i++) {
      const newMedia = newProperties.playlists[i];
      const oldMedia = oldProperties.playlists[i];
      const mergedMedia = mergeMedia(oldMedia, newMedia);

      result.mediaGroups[type][group][label].playlists[i] = mergedMedia;
    }
  });

  return result;
};

class DashMainPlaylistLoader extends PlaylistLoader {
  constructor(uri, options) {
    super(uri, options);
    this.clientOffset_ = null;
    this.sidxMapping_ = null;
    this.mediaList_ = options.mediaList;
    this.clientClockOffset_ = null;
    this.setMediaRefreshTimeout_ = this.setMediaRefreshTimeout_.bind(this);
  }

  parseManifest_(manifestString, callback) {
    this.syncClientServerClock_(manifestString, function(clientOffset) {
      const parsedManifest = parseMpd(manifestString, {
        manifestUri: this.uri_,
        clientOffset,
        sidxMapping: this.sidxMapping_
      });

      const mergedManifest = mergeMainManifest(
        this.manifest_,
        parsedManifest,
        this.sidxMapping_
      );

      callback(mergedManifest);
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
