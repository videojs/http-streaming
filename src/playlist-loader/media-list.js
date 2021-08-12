import videojs from 'video.js';

class MediaList extends videojs.EventTarget {
  init(playlistLoaders) {
    playlistLoaders.forEach((playlistLoader) => {
      this.add(playlistLoader);
    });
  }

  add(playlistLoader) {

  }

  remove(playlistLoader) {

  }

  dispose() {
  }
}

export default MediaList;
