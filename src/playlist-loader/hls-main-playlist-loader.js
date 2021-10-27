import PlaylistLoader from './playlist-loader.js';
import {parseManifest} from '../manifest.js';

class HlsMainPlaylistLoader extends PlaylistLoader {
  parseManifest_(manifestString, callback) {
    const parsedManifest = parseManifest({
      onwarn: ({message}) => this.logger_(`m3u8-parser warn for ${this.uri_}: ${message}`),
      oninfo: ({message}) => this.logger_(`m3u8-parser info for ${this.uri_}: ${message}`),
      manifestString,
      customTagParsers: this.options_.customTagParsers,
      customTagMappers: this.options_.customTagMappers,
      experimentalLLHLS: this.options_.experimentalLLHLS
    });

    callback(parsedManifest, this.manifestString_ !== manifestString);
  }

  start() {
    // never re-request the manifest.
    if (this.manifest_) {
      this.started_ = true;
      return;
    }

    super.start();
  }
}

export default HlsMainPlaylistLoader;
