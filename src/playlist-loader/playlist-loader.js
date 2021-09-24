import videojs from 'video.js';
import logger from '../util/logger';
import window from 'global/window';

class PlaylistLoader extends videojs.EventTarget {
  constructor(uri, options = {}) {
    super();
    this.logger_ = logger(this.constructor.name);
    this.uri_ = uri;
    this.options_ = options;
    this.manifest_ = options.manifest || null;
    this.vhs_ = options.vhs;
    this.manifestString_ = options.manifestString || null;
    this.lastRequestTime_ = options.lastRequestTime || null;

    this.mediaRefreshTime_ = null;
    this.mediaRefreshTimeout_ = null;
    this.request_ = null;
    this.started_ = false;
    this.on('refresh', this.refreshManifest);
    this.on('updated', this.setMediaRefreshTimeout_);
  }

  request() {
    return this.request_;
  }

  uri() {
    return this.uri_;
  }

  manifest() {
    return this.manifest_;
  }

  manifestString() {
    return this.manifestString_;
  }

  started() {
    return this.started_;
  }

  lastRequestTime() {
    return this.lastRequestTime_;
  }

  refreshManifest(callback) {
    this.makeRequest({uri: this.uri()}, (request, wasRedirected) => {
      if (wasRedirected) {
        this.uri_ = request.responseURL;
      }

      if (request.responseHeaders && request.responseHeaders.date) {
        this.lastRequestTime_ = Date.parse(request.responseHeaders.date);
      } else {
        this.lastRequestTime_ = Date.now();
      }

      this.parseManifest_(request.responseText, (parsedManifest, updated) => {
        if (updated) {
          this.manifestString_ = request.responseText;
          this.manifest_ = parsedManifest;
          this.trigger('updated');
        }
      });
    });
  }

  parseManifest_(manifestText, callback) {}

  // make a request and do custom error handling
  makeRequest(options, callback, handleErrors = true) {
    const xhrOptions = videojs.mergeOptions({withCredentials: this.options_.withCredentials}, options);

    this.request_ = this.options_.vhs.xhr(xhrOptions, (error, request) => {
      // disposed
      if (this.isDisposed_) {
        return;
      }

      // successful or errored requests are finished.
      this.request_ = null;

      if (error) {
        this.error = typeof error === 'object' && !(error instanceof Error) ? error : {
          status: request.status,
          message: `Playlist request error at URI ${request.uri}`,
          response: request.response,
          code: (request.status >= 500) ? 4 : 2
        };

        this.trigger('error');
        return;
      }

      const wasRedirected =
        this.options_.handleManifestRedirects &&
        request.responseURL !== xhrOptions.uri;

      callback(request, wasRedirected);
    });
  }

  start() {
    if (!this.started_) {
      this.started_ = true;
      this.refreshManifest();
    }
  }

  stop() {
    if (this.started_) {
      this.started_ = false;
      this.stopRequest();
      this.clearMediaRefreshTimeout_();
    }
  }

  // stop a request if one exists.
  stopRequest() {
    if (this.request_) {
      this.request_.onreadystatechange = null;
      this.request_.abort();
      this.request_ = null;
    }
  }

  clearMediaRefreshTimeout_() {
    if (this.mediaRefreshTimeout_) {
      window.clearTimeout(this.mediaRefreshTimeout_);
      this.mediaRefreshTimeout_ = null;
    }
  }

  setMediaRefreshTimeout_(time = this.getMediaRefreshTime_()) {
    this.clearMediaRefreshTimeout_();

    if (typeof time !== 'number') {
      return;
    }

    this.refreshTimeout_ = window.setTimout(() => {
      this.refreshTimeout_ = null;
      this.trigger('refresh');
      this.setMediaRefreshTimeout_();
    }, time);
  }

  getMediaRefreshTime_() {
    return this.mediaRefreshTime_;
  }

  dispose() {
    this.isDisposed_ = true;
    this.stop();
    this.trigger('dispose');
  }
}

export default PlaylistLoader;
