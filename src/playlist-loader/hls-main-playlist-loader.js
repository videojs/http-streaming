import PlaylistLoader from './playlist-loader.js';
import {parseManifest} from '../manifest.js';

class HlsMainPlaylistLoader extends PlaylistLoader {
  parseManifest_(oldManifest, manifestString, callback) {
    const newManifest = parseManifest({
      onwarn: ({message}) => this.logger_(`m3u8-parser warn for ${this.uri_}: ${message}`),
      oninfo: ({message}) => this.logger_(`m3u8-parser info for ${this.uri_}: ${message}`),
      manifestString,
      customTagParsers: this.options_.customTagParsers,
      customTagMappers: this.options_.customTagMappers,
      experimentalLLHLS: this.options_.experimentalLLHLS
    });

    // updated is always true for
    callback(newManifest, true);
  }

  start() {
    // never re-request the manifest.
    if (this.manifest_) {
      this.started_ = true;
    }

    super.start();
  }
}

export default HlsMainPlaylistLoader;
