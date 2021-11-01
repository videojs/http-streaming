import PlaylistLoader from './playlist-loader.js';
import containerRequest from '../util/container-request.js';
import {addSidxSegmentsToPlaylist} from 'mpd-parser';
import parseSidx from 'mux.js/lib/tools/parse-sidx';
import {toUint8} from '@videojs/vhs-utils/es/byte-helpers';
import {segmentXhrHeaders} from '../xhr';
import {mergeMedia, forEachPlaylist} from './utils.js';

export const getMediaAccessor = function(mainManifest, uri) {
  let result;

  forEachPlaylist(mainManifest, function(media, index, array) {
    if (media.uri === uri) {
      result = {
        get: () => array[index],
        set: (v) => {
          array[index] = v;
        }
      };

      return true;
    }
  });

  return result;
};

class DashMediaPlaylistLoader extends PlaylistLoader {
  constructor(uri, options) {
    super(uri, options);
    this.manifest_ = null;
    this.manifestString_ = null;

    this.sidx_ = null;
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

  onMainUpdated_() {
    if (!this.started_) {
      return;
    }
    const oldMedia = this.manifest_;
    const mediaAccessor = getMediaAccessor(
      this.mainPlaylistLoader_.manifest(),
      this.uri()
    );

    // redefine the getters and setters.
    Object.defineProperty(this, 'manifest_', {
      get: mediaAccessor.get,
      set: mediaAccessor.set,
      writeable: true,
      enumerable: true
    });

    // use them
    const newMedia = this.manifest_;

    this.requestSidx_(() => {
      if (newMedia.sidx && this.sidx_) {
        addSidxSegmentsToPlaylist(newMedia, this.sidx_, newMedia.sidx.resolvedUri);
      }
      newMedia.id = newMedia.id || newMedia.attributes.NAME;
      newMedia.uri = newMedia.uri || newMedia.attributes.NAME;

      const {media, updated} = mergeMedia({
        oldMedia,
        newMedia,
        uri: this.mainPlaylistLoader_.uri()
      });

      this.manifest_ = media;

      if (updated) {
        this.mainPlaylistLoader_.setMediaRefreshTime_(this.manifest().targetDuration * 1000);
        this.trigger('updated');
      }
    });
  }

  requestSidx_(callback) {
    if ((this.sidx_ && this.manifest_.sidx) || !this.manifest_.sidx) {
      return callback();
    }
    const uri = this.manifest_.sidx.resolvedUri;

    const parseSidx_ = (error, request) => {
      if (error) {
        this.error_ = typeof err === 'object' && !(error instanceof Error) ? error : {
          status: request.status,
          message: 'DASH sidx request error at URL: ' + request.uri,
          response: request.response,
          // MEDIA_ERR_NETWORK
          code: 2
        };

        this.trigger('error');
        return;
      }

      let sidx;

      try {
        sidx = parseSidx(toUint8(request.response).subarray(8));
      } catch (e) {
        // sidx parsing failed.
        this.error_ = e;
        this.trigger('error');
        return;
      }

      this.sidx = sidx;
      callback();

    };

    this.request_ = containerRequest(uri, this.vhs_.xhr, (error, request, container, bytes) => {
      this.request_ = null;

      if (error || !container || container !== 'mp4') {
        return parseSidx_(error || {
          status: request.status,
          message: `Unsupported ${container || 'unknown'} container type for sidx segment at URL: ${uri}`,
          blacklistDuration: Infinity,
          // MEDIA_ERR_NETWORK
          code: 2
        }, null);
      }

      // if we already downloaded the sidx bytes in the container request, use them
      const {offset, length} = this.manifest_.sidx.byterange;

      if (bytes.length >= (length + offset)) {
        return parseSidx_(error, {
          response: bytes.subarray(offset, offset + length),
          status: request.status,
          uri: request.uri
        });
      }

      // otherwise request sidx bytes
      this.makeRequest_({
        uri,
        responseType: 'arraybuffer',
        headers: segmentXhrHeaders({byterange: this.manifest_.sidx.byterange})
      }, parseSidx_, false);
    });
  }

  start() {
    if (this.started_) {
      return;
    }

    this.started_ = true;
    this.onMainUpdated_();
  }

  stop() {
    if (!this.started_) {
      return;
    }
    // redefine the getters and setters.
    Object.defineProperty(this, 'manifest_', {
      value: null,
      writeable: true,
      enumerable: true
    });
    super.stop();
  }

  dispose() {
    this.mainPlaylistLoader_.off('updated', this.boundOnMainUpdated_);
    super.dispose();
  }
}

export default DashMediaPlaylistLoader;
