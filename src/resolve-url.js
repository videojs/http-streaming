/**
 * @file resolve-url.js - Handling how URLs are resolved and manipulated
 */

import _resolveUrl from '@videojs/vhs-utils/es/resolve-url.js';

export const resolveUrl = _resolveUrl;

/**
 * If the xhr request was redirected, return the responseURL, otherwise,
 * return the original url.
 *
 * @api private
 *
 * @param  {string} url - an url being requested
 * @param  {XMLHttpRequest} req - xhr request result
 *
 * @return {string}
 */
export const resolveManifestRedirect = (url, req) => {
  // To understand how the responseURL below is set and generated:
  // - https://fetch.spec.whatwg.org/#concept-response-url
  // - https://fetch.spec.whatwg.org/#atomic-http-redirect-handling
  if (
    req &&
    req.responseURL &&
    url !== req.responseURL
  ) {
    return req.responseURL;
  }

  return url;
};

export default resolveUrl;
