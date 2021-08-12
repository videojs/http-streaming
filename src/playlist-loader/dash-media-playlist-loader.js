import PlaylistLoader from './playlist-loader.js';

class DashMediaPlaylistLoader extends PlaylistLoader {
  constructor(uri, options) {
    super(uri, options);

    this.mainPlaylistLoader_ = options.mainPlaylistLoader;

    this.mainPlaylistLoader_.on('updated', (updates) => {
      for (let i = 0; i < updates.length; i++) {
        if (updates[i].type === 'media' && updates[i].uri === this.uri()) {
          this.trigger('updated');
          break;
        }
      }
    });
  }

  manifest() {
    return this.mainPlaylistLoader_.getPlaylist(this.uri_);
  }

  start() {
    if (!this.started_) {
      this.started_ = true;
    }
  }
}

export default DashMediaPlaylistLoader;
