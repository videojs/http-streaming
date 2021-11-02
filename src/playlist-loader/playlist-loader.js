import videojs from 'video.js';
import logger from '../util/logger';
import window from 'global/window';

/**
 * A base class for PlaylistLoaders that seeks to encapsulate all the
 * shared functionality from dash and hls.
 *
 * @extends videojs.EventTarget
 */
class PlaylistLoader extends videojs.EventTarget {

  /**
   * Create an instance of this class.
   *
   * @param {string} uri
   *        The uri of the manifest.
   *
   * @param {Object} options
   *        Options that can be used.
   *
   * @param {Object} options.vhs
   *        The VHS object, used for it's xhr
   *
   * @param {Object} [options.manifest]
   *        A starting manifest object.
   *
   * @param {Object} [options.manifestString]
   *        The raw manifest string.
   *
   * @param {number} [options.lastRequestTime]
   *        The last request time.
   *
   * @param {boolean} [options.withCredentials=false]
   *        If requests should be sent withCredentials or not.
   *
   * @param {boolean} [options.handleManifestRedirects=false]
   *        If manifest redirects should change the internal uri
   */
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

  /**
   * A getter for the current error object.
   *
   * @return {Object|null}
   *         The current error or null.
   */
  error() {
    return this.error_;
  }

  /**
   * A getter for the current request object.
   *
   * @return {Object|null}
   *         The current request or null.
   */
  request() {
    return this.request_;
  }

  /**
   * A getter for the uri string.
   *
   * @return {string}
   *         The uri.
   */
  uri() {
    return this.uri_;
  }

  /**
   * A getter for the manifest object.
   *
   * @return {Object|null}
   *         The manifest or null.
   */
  manifest() {
    return this.manifest_;
  }

  /**
   * Determine if the loader is started or not.
   *
   * @return {boolean}
   *         True if stared, false otherwise.
   */
  started() {
    return this.started_;
  }

  /**
   * The last time a request happened.
   *
   * @return {number|null}
   *         The last request time or null.
   */
  lastRequestTime() {
    return this.lastRequestTime_;
  }

  /**
   * A function that is called to when the manifest should be
   * re-requested and parsed.
   *
   * @listens {PlaylistLoader#updated}
   * @private
   */
  refreshManifest_() {
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

  /**
   * A function that is called to when the manifest should be
   * parsed and merged.
   *
   * @param {string} manifestText
   *        The text of the manifest directly from a request.
   *
   * @param {Function} callback
   *        The callback that takes two arguments. The parsed
   *        and merged manifest, and weather or not that manifest
   *        was updated.
   *
   * @private
   */
  parseManifest_(manifestText, callback) {}

  /**
   * A function that is called when a playlist loader needs to
   * make a request of any kind. Uses `withCredentials` from the
   * constructor, but can be overriden if needed.
   *
   * @param {Object} options
   *        Options for the request.
   *
   * @param {string} options.uri
   *        The uri to request.
   *
   * @param {boolean} [options.handleErrors=true]
   *        If errors should trigger on the playlist loader. If
   *        This is false, errors will be passed along.
   *
   * @param {boolean} [options.withCredentials=false]
   *        If this request should be sent withCredentials. Defaults
   *        to the value passed in the constructor or false.
   *
   * @param {Function} callback
   *        The callback that takes three arguments. 1 the request,
   *        2 if we were redirected, and 3 error
   *
   * @private
   */
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

  /**
   * Trigger an error on this playlist loader.
   *
   * @param {Object|string} error
   *        The error object or string
   *
   * @private
   */
  triggerError_(error) {
    if (typeof error === 'string') {
      error = {message: error};
    }

    this.error_ = error;
    this.trigger('error');
    this.stop();
  }

  /**
   * Start the loader
   */
  start() {
    if (!this.started_) {
      this.started_ = true;
      this.refreshManifest_();
    }
  }

  /**
   * Stop the loader
   */
  stop() {
    if (this.started_) {
      this.started_ = false;
      this.stopRequest();
      this.clearMediaRefreshTimeout_();
    }
  }

  /**
   * Stop any requests on the loader
   */
  stopRequest() {
    if (this.request_) {
      this.request_.onreadystatechange = null;
      this.request_.abort();
      this.request_ = null;
    }
  }

  /**
   * clear the media refresh timeout
   *
   * @private
   */
  clearMediaRefreshTimeout_() {
    if (this.refreshTimeout_) {
      window.clearTimeout(this.refreshTimeout_);
      this.refreshTimeout_ = null;
    }
  }

  /**
   * Set or clear the media refresh timeout based on
   * what getMediaRefreshTime_ returns.
   *
   * @listens {PlaylistLoader#updated}
   * @private
   */
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

  /**
   * Get the amount of time to let elapsed before refreshing
   * the manifest.
   *
   * @return {number|null}
   *         The media refresh time in milliseconds.
   * @private
   */
  getMediaRefreshTime_() {
    return this.mediaRefreshTime_;
  }

  /**
   * Dispose and cleanup this playlist loader.
   *
   * @private
   */
  dispose() {
    this.isDisposed_ = true;
    this.stop();
    this.trigger('dispose');
  }
}

export default PlaylistLoader;
