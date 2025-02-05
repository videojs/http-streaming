/**
 * @file xhr.js
 */

/**
 * A wrapper for videojs.xhr that tracks bandwidth.
 *
 * @param {Object} options options for the XHR
 * @param {Function} callback the callback to call when done
 * @return {Request} the xhr request that is going to be made
 */
import videojs from 'video.js';
import window from 'global/window';
import {merge} from './util/vjs-compat';

const callbackWrapper = function(request, error, response, callback) {
  const reqResponse = request.responseType === 'arraybuffer' ? request.response : request.responseText;

  if (!error && reqResponse) {
    request.responseTime = Date.now();
    request.roundTripTime = request.responseTime - request.requestTime;
    request.bytesReceived = reqResponse.byteLength || reqResponse.length;
    if (!request.bandwidth) {
      request.bandwidth =
        Math.floor((request.bytesReceived / request.roundTripTime) * 8 * 1000);
    }
  }

  if (response.headers) {
    request.responseHeaders = response.headers;
  }

  // videojs.xhr now uses a specific code on the error
  // object to signal that a request has timed out instead
  // of setting a boolean on the request object
  if (error && error.code === 'ETIMEDOUT') {
    request.timedout = true;
  }

  // videojs.xhr no longer considers status codes outside of 200 and 0
  // (for file uris) to be errors, but the old XHR did, so emulate that
  // behavior. Status 206 may be used in response to byterange requests.
  if (!error &&
    !request.aborted &&
    response.statusCode !== 200 &&
    response.statusCode !== 206 &&
    response.statusCode !== 0) {
    error = new Error('XHR Failed with a response of: ' +
                      (request && (reqResponse || request.responseText)));
  }

  callback(error, request);
};

/**
 * Iterates over the request hooks Set and calls them in order
 *
 * @param {Set} hooks the hook Set to iterate over
 * @param {Object} options the request options to pass to the xhr wrapper
 * @return the callback hook function return value, the modified or new options Object.
 */
const callAllRequestHooks = (requestSet, options) => {
  if (!requestSet || !requestSet.size) {
    return;
  }
  let newOptions = options;

  requestSet.forEach((requestCallback) => {
    newOptions = requestCallback(newOptions);
  });
  return newOptions;
};

/**
 * Iterates over the response hooks Set and calls them in order.
 *
 * @param {Set} hooks the hook Set to iterate over
 * @param {Object} request the xhr request object
 * @param {Object} error the xhr error object
 * @param {Object} response the xhr response object
 */
const callAllResponseHooks = (responseSet, request, error, response) => {
  if (!responseSet || !responseSet.size) {
    return;
  }
  responseSet.forEach((responseCallback) => {
    responseCallback(request, error, response);
  });
};

const xhrFactory = function() {
  const xhr = function XhrFunction(options, callback) {
    // Add a default timeout
    options = merge({
      timeout: 45e3
    }, options);

    // Allow an optional user-specified function to modify the option
    // object before we construct the xhr request
    // TODO: Remove beforeRequest in the next major release.
    const beforeRequest = XhrFunction.beforeRequest || videojs.Vhs.xhr.beforeRequest;
    // onRequest and onResponse hooks as a Set, at either the player or global level.
    // TODO: new Set added here for beforeRequest alias. Remove this when beforeRequest is removed.
    const _requestCallbackSet = XhrFunction._requestCallbackSet || videojs.Vhs.xhr._requestCallbackSet || new Set();
    const _responseCallbackSet = XhrFunction._responseCallbackSet || videojs.Vhs.xhr._responseCallbackSet;

    if (beforeRequest && typeof beforeRequest === 'function') {
      videojs.log.warn('beforeRequest is deprecated, use onRequest instead.');
      _requestCallbackSet.add(beforeRequest);
    }

    // Use the standard videojs.xhr() method unless `videojs.Vhs.xhr` has been overriden
    // TODO: switch back to videojs.Vhs.xhr.name === 'XhrFunction' when we drop IE11
    const xhrMethod = videojs.Vhs.xhr.original === true ? videojs.xhr : videojs.Vhs.xhr;

    // call all registered onRequest hooks, assign new options.
    const beforeRequestOptions = callAllRequestHooks(_requestCallbackSet, options);

    // Remove the beforeRequest function from the hooks set so stale beforeRequest functions are not called.
    _requestCallbackSet.delete(beforeRequest);

    // xhrMethod will call XMLHttpRequest.open and XMLHttpRequest.send
    const request = xhrMethod(beforeRequestOptions || options, function(error, response) {
      // call all registered onResponse hooks
      callAllResponseHooks(_responseCallbackSet, request, error, response);
      return callbackWrapper(request, error, response, callback);
    });
    const originalAbort = request.abort;

    request.abort = function() {
      request.aborted = true;
      return originalAbort.apply(request, arguments);
    };
    request.uri = options.uri;
    request.requestType = options.requestType;
    request.requestTime = Date.now();
    return request;
  };

  xhr.original = true;

  return xhr;
};

/**
 * Turns segment byterange into a string suitable for use in
 * HTTP Range requests
 *
 * @param {Object} byterange - an object with two values defining the start and end
 *                             of a byte-range
 */
export const byterangeStr = function(byterange) {
  // `byterangeEnd` is one less than `offset + length` because the HTTP range
  // header uses inclusive ranges
  let byterangeEnd;
  const byterangeStart = byterange.offset;

  if (typeof byterange.offset === 'bigint' || typeof byterange.length === 'bigint') {
    byterangeEnd = window.BigInt(byterange.offset) + window.BigInt(byterange.length) - window.BigInt(1);
  } else {
    byterangeEnd = byterange.offset + byterange.length - 1;
  }

  return 'bytes=' + byterangeStart + '-' + byterangeEnd;
};

/**
 * Defines headers for use in the xhr request for a particular segment.
 *
 * @param {Object} segment - a simplified copy of the segmentInfo object
 *                           from SegmentLoader
 */
const segmentXhrHeaders = function(segment) {
  const headers = {};

  if (segment.byterange) {
    headers.Range = byterangeStr(segment.byterange);
  }
  return headers;
};

export {segmentXhrHeaders, callbackWrapper, xhrFactory};

export default xhrFactory;
