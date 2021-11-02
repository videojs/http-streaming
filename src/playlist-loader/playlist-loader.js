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
    this.on('refresh', this.refreshManifest_);
    this.on('updated', this.setMediaRefreshTimeout_);
  }

  error() {
    return this.error_;
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

  started() {
    return this.started_;
  }

  lastRequestTime() {
    return this.lastRequestTime_;
  }

  refreshManifest_(callback) {
    this.makeRequest_({uri: this.uri()}, (request, wasRedirected) => {
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
  makeRequest_(options, callback) {
    if (!this.started_) {
      this.triggerError_('makeRequest_ cannot be called before started!');
      return;
    }

    const xhrOptions = videojs.mergeOptions({withCredentials: this.options_.withCredentials}, options);
    let handleErrors = true;

    if (xhrOptions.hasOwnProperty('handleErrors')) {
      handleErrors = xhrOptions.handleErrors;
      delete xhrOptions.handleErrors;
    }

    this.request_ = this.options_.vhs.xhr(xhrOptions, (error, request) => {
      // disposed
      if (this.isDisposed_) {
        return;
      }

      // successful or errored requests are finished.
      this.request_ = null;

      const wasRedirected = Boolean(this.options_.handleManifestRedirects &&
        request.responseURL !== xhrOptions.uri);

      if (error && handleErrors) {
        this.triggerError_(`Request error at URI ${request.uri}`);
        return;
      }

      callback(request, wasRedirected, error);
    });
  }

  triggerError_(error) {
    if (typeof error === 'string') {
      error = {message: error};
    }

    this.error_ = error;
    this.trigger('error');
  }

  start() {
    if (!this.started_) {
      this.started_ = true;
      this.refreshManifest_();
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
    if (this.refreshTimeout_) {
      window.clearTimeout(this.refreshTimeout_);
      this.refreshTimeout_ = null;
    }
  }

  setMediaRefreshTimeout_() {
    // do nothing if disposed
    if (this.isDisposed_) {
      return;
    }
    const time = this.getMediaRefreshTime_();

    this.clearMediaRefreshTimeout_();

    if (typeof time !== 'number') {
      this.logger_('Not setting media refresh time, as time given is not a number.');
      return;
    }

    this.refreshTimeout_ = window.setTimeout(() => {
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
