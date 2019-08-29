/**
 * @file resolve-url.js - Handling how URLs are resolved and manipulated
 */

import URLToolkit from 'url-toolkit';
import window from 'global/window';

export const resolveUrl = function(baseURL, relativeURL) {
  // return early if we don't need to resolve
  if ((/^[a-z]+:/i).test(relativeURL)) {
    return relativeURL;
  }

  // if the base URL is relative then combine with the current location
  if (!(/\/\//i).test(baseURL)) {
    baseURL = URLToolkit.buildAbsoluteURL(window.location.href, baseURL);
  }

  return URLToolkit.buildAbsoluteURL(baseURL, relativeURL);
};

/**
 * Checks whether xhr request was redirected and returns correct url depending
 * on `handleManifestRedirects` option
 *
 * @api private
 *
 * @param {boolean} handleManifestRedirect - whether to handle redirects
 * @param {string} url - url being requested
 * @param {string} responseUrl - xhr response url result
 *
 * @return {string}
 */
export const resolveManifestRedirect = (handleManifestRedirect, url, responseUrl) => {
  // To understand how the responseURL below is set and generated:
  // - https://fetch.spec.whatwg.org/#concept-response-url
  // - https://fetch.spec.whatwg.org/#atomic-http-redirect-handling
  if (handleManifestRedirect && responseUrl && url !== responseUrl) {
    return responseUrl;
  }

  return url;
};

export default resolveUrl;
