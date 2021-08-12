import PlaylistLoader from './playlist-loader.js';
import {
  parse as parseMpd
// TODO
// addSidxSegmentsToPlaylist,
// generateSidxKey,
// parseUTCTiming
} from 'mpd-parser';
import {forEachMediaGroup} from './manifest';

const findMedia = function(mainManifest, id) {
  if (!mainManifest || !mainManifest.playlists || !mainManifest.playlists.length) {
    return;
  }
  for (let i = 0; i < mainManifest.playlists.length; i++) {
    const media = mainManifest.playlists[i];

    if (media.id === id) {
      return media;
    }
  }

  forEachMediaGroup(mainManifest, function(properties, type, group, label) {

  });
};

const mergeMedia = function(oldMedia, newMedia) {

};

const mergeMainManifest = function(oldMain, newMain, sidxMapping) {
  const result = {
    mergedManifest: newMain,
    updated: false
  };

  if (!oldMain) {
    return result;
  }

  if (oldMain.minimumUpdatePeriod !== newMain.minimumUpdatePeriod) {
    result.updated = true;
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

      const {updated, mergedMedia} = mergeMedia(oldMedia, newMedia);

      result.mediaGroups[type][group][label].playlists[i] = mergedMedia;

      if (updated) {
        result.updated = true;
      }
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
  }

  parseManifest_(oldManifest, manifestString, callback) {
    const newManifest = parseMpd(manifestString, {
      manifestUri: this.uri_,
      clientOffset: this.clientOffset_,
      sidxMapping: this.sidxMapping_
    });

    const {updated, mergedManifest} = mergeMainManifest(
      oldManifest,
      newManifest,
      this.sidxMapping_
    );

    if (mergedManifest.minimumUpdatePeriod === 0) {
      // use media playlist target duration.
      // TODO: need a way for the main playlist loader to get the
      // target duration of the currently selected

    } else if (typeof mergedManifest.minimumUpdatePeriod === 'number') {
      this.mediaUpdateTime_ = mergedManifest.minimumUpdatePeriod;
    }

    callback(mergedManifest, updated);
  }
}

export default DashMainPlaylistLoader;
