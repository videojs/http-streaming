import PlaylistLoader from './playlist-loader.js';
import {findMedia} from './dash-main-playlist-loader.js';

const findManifestString = function(manifestString, id) {

};

const wasMediaUpdated = function(oldManifest, newManifest) {

};

class DashMediaPlaylistLoader extends PlaylistLoader {
  constructor(uri, options) {
    super(uri, options);

    this.mainPlaylistLoader_ = options.mainPlaylistLoader;
    this.onMainUpdated_ = this.onMainUpdated_.bind(this);

    this.mainPlaylistLoader_.on('updated', this.onMainUpdated_);
  }

  onMainUpdated_() {
    const oldManifestString = this.manifestString_;
    const oldManifest = this.manifest_;

    this.manifestString_ = findManifestString(
      this.mainPlaylistLoader_.manifestString(),
      this.uri()
    );

    this.manifest_ = findMedia(
      this.mainPlaylistLoader_.manifest(),
      this.uri()
    );

    const wasUpdated = !oldManifestString ||
      this.manifestString_ !== oldManifestString ||
      wasMediaUpdated(oldManifest, this.manifest_);

    if (wasUpdated) {
      this.trigger('updated');
      this.mainPlaylistLoader_.setMediaRefreshTime_(this.manifest().targetDuration * 1000);
    }
  }

  manifest() {
    return findMedia(this.mainPlaylistLoader_.manifest(), this.uri());
  }

  start() {
    if (!this.started_) {
      this.started_ = true;
    }
  }

  dispose() {
    super.dispose();
  }
}

export default DashMediaPlaylistLoader;
