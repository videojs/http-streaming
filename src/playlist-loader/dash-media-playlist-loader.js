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

/**
 * A class to encapsulate all of the functionality for
 * Dash media playlists. Note that this PlaylistLoader does
 * not refresh, parse, or have manifest strings. This is because
 * Dash doesn't really have media playlists. We only use them because:
 * 1. We want to match our HLS API
 * 2. Dash does have sub playlists but everything is updated on main.
 *
 * @extends PlaylistLoader
 */
class DashMediaPlaylistLoader extends PlaylistLoader {
  /**
   * Create an instance of this class.
   *
   * @param {string} uri
   *        The uri of the manifest.
   *
   * @param {Object} options
   *        Options that can be used. See base class for
   *        shared options.
   *
   * @param {boolean} options.mainPlaylistLoader
   *        The main playlist loader this playlist exists on.
   */
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

  /**
   * A function that is run when main updates, but only
   * functions if this playlist loader is started. It will
   * merge it's old manifest with the new one, and update it
   * with sidx segments if needed.
   *
   * @listens {DashMainPlaylistLoader#updated}
   * @private
   */
  onMainUpdated_() {
    if (!this.started_) {
      return;
    }

    // save our old media information
    const oldMedia = this.manifest_;

    // get the newly updated media information
    const mediaAccessor = getMediaAccessor(
      this.mainPlaylistLoader_.manifest(),
      this.uri()
    );

    if (!mediaAccessor) {
      this.triggerError_('could not find playlist on mainPlaylistLoader');
      return;
    }

    // use them
    const newMedia = this.manifest_ = mediaAccessor.get();

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

      // set the newly merged media on main
      mediaAccessor.set(media);
      this.manifest_ = mediaAccessor.get();

      if (updated) {
        this.mainPlaylistLoader_.setMediaRefreshTime_(this.manifest().targetDuration * 1000);
        this.trigger('updated');
      }
    });
  }

  /**
   * A function that is run when main updates, but only
   * functions if this playlist loader is started. It will
   * merge it's old manifest with the new one, and update it
   * with sidx segments if needed.
   *
   * @listens {DashMainPlaylistLoader#updated}
   * @private
   */
  requestSidx_(callback) {
    if ((this.sidx_ && this.manifest_.sidx) || !this.manifest_.sidx) {
      return callback();
    }
    const uri = this.manifest_.sidx.resolvedUri;

    const parseSidx_ = (request, wasRedirected) => {
      let sidx;

      try {
        sidx = parseSidx(toUint8(request.response).subarray(8));
      } catch (e) {
        // sidx parsing failed.
        this.triggerError_(e);
        return;
      }

      this.sidx_ = sidx;
      callback();

    };

    this.request_ = containerRequest(uri, this.vhs_.xhr, (error, request, container, bytes) => {
      this.request_ = null;

      if (error || !container || container !== 'mp4') {
        if (error) {
          this.triggerError_(error);
        } else {
          container = container || 'unknown';
          this.triggerError_(`Unsupported ${container} container type for sidx segment at URL: ${uri}`);
        }
        return;
      }

      // if we already downloaded the sidx bytes in the container request, use them
      const {offset, length} = this.manifest_.sidx.byterange;

      if (bytes.length >= (length + offset)) {
        return parseSidx_({
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
      }, parseSidx_);
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

    this.manifest_ = null;
    // reset media refresh time
    this.mainPlaylistLoader_.setMediaRefreshTime_(null);
    super.stop();
  }

  dispose() {
    this.mainPlaylistLoader_.off('updated', this.boundOnMainUpdated_);
    super.dispose();
  }
}

export default DashMediaPlaylistLoader;
