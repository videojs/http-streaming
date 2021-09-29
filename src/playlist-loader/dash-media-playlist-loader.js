import PlaylistLoader from './playlist-loader.js';
import {findMedia} from './dash-main-playlist-loader.js';
import deepEqualObject from '../util/deep-equal-object.js';

class DashMediaPlaylistLoader extends PlaylistLoader {
  constructor(uri, options) {
    super(uri, options);
    this.manifest_ = null;
    this.manifestString_ = null;

    this.mainPlaylistLoader_ = options.mainPlaylistLoader;
    this.boundOnMainUpdated_ = () => this.onMainUpdated_();

    this.mainPlaylistLoader_.on('updated', this.boundOnMainUpdated_);
  }

  // noop, as media playlists in dash do not have
  // a uri to refresh or a manifest string
  refreshManifest_() {}
  parseManifest_() {}
  setMediaRefreshTimeout_() {}
  clearMediaRefreshTimeout_() {}
  getMediaRefreshTime_() {}
  getManifestString_() {}
  stopRequest() {}

  onMainUpdated_() {
    if (!this.started_) {
      return;
    }
    const oldManifest = this.manifest_;

    this.manifest_ = findMedia(
      this.mainPlaylistLoader_.manifest(),
      this.uri()
    );

    const wasUpdated = !deepEqualObject(oldManifest, this.manifest_);

    if (wasUpdated) {
      this.mainPlaylistLoader_.setMediaRefreshTime_(this.manifest().targetDuration * 1000);
      this.trigger('updated');
    }
  }

  start() {
    if (!this.started_) {
      this.started_ = true;
      this.onMainUpdated_();
    }
  }

  stop() {
    if (this.started_) {
      this.started_ = false;
      this.manifest_ = null;
    }
  }

  dispose() {
    this.mainPlaylistLoader_.off('updated', this.boundOnMainUpdated_);
    super.dispose();
  }
}

export default DashMediaPlaylistLoader;
