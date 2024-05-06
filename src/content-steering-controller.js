import resolveUrl from './resolve-url';
import window from 'global/window';
import logger from './util/logger';
import videojs from 'video.js';

/**
 * A utility class for setting properties and maintaining the state of the content steering manifest.
 *
 * Content Steering manifest format:
 * VERSION: number (required) currently only version 1 is supported.
 * TTL: number in seconds (optional) until the next content steering manifest reload.
 * RELOAD-URI: string (optional) uri to fetch the next content steering manifest.
 * SERVICE-LOCATION-PRIORITY or PATHWAY-PRIORITY a non empty array of unique string values.
 * PATHWAY-CLONES: array (optional) (HLS only) pathway clone objects to copy from other playlists.
 */
class SteeringManifest {
  constructor() {
    this.priority_ = [];
    this.pathwayClones_ = new Map();
  }

  set version(number) {
    // Only version 1 is currently supported for both DASH and HLS.
    if (number === 1) {
      this.version_ = number;
    }
  }

  set ttl(seconds) {
    // TTL = time-to-live, default = 300 seconds.
    this.ttl_ = seconds || 300;
  }

  set reloadUri(uri) {
    if (uri) {
      // reload URI can be relative to the previous reloadUri.
      this.reloadUri_ = resolveUrl(this.reloadUri_, uri);
    }
  }

  set priority(array) {
    // priority must be non-empty and unique values.
    if (array && array.length) {
      this.priority_ = array;
    }
  }

  set pathwayClones(array) {
    // pathwayClones must be non-empty.
    if (array && array.length) {
      this.pathwayClones_ = new Map(array.map((clone) => [clone.ID, clone]));
    }
  }

  get version() {
    return this.version_;
  }

  get ttl() {
    return this.ttl_;
  }

  get reloadUri() {
    return this.reloadUri_;
  }

  get priority() {
    return this.priority_;
  }

  get pathwayClones() {
    return this.pathwayClones_;
  }
}

/**
 * This class represents a content steering manifest and associated state. See both HLS and DASH specifications.
 * HLS: https://developer.apple.com/streaming/HLSContentSteeringSpecification.pdf and
 * https://datatracker.ietf.org/doc/draft-pantos-hls-rfc8216bis/ section 4.4.6.6.
 * DASH: https://dashif.org/docs/DASH-IF-CTS-00XX-Content-Steering-Community-Review.pdf
 *
 * @param {function} xhr for making a network request from the browser.
 * @param {function} bandwidth for fetching the current bandwidth from the main segment loader.
 */
export default class ContentSteeringController extends videojs.EventTarget {
  constructor(xhr, bandwidth) {
    super();

    this.currentPathway = null;
    this.defaultPathway = null;
    this.queryBeforeStart = false;
    this.availablePathways_ = new Set();
    this.steeringManifest = new SteeringManifest();
    this.proxyServerUrl_ = null;
    this.manifestType_ = null;
    this.ttlTimeout_ = null;
    this.request_ = null;
    this.currentPathwayClones = new Map();
    this.nextPathwayClones = new Map();
    this.excludedSteeringManifestURLs = new Set();
    this.logger_ = logger('Content Steering');
    this.xhr_ = xhr;
    this.getBandwidth_ = bandwidth;
  }

  /**
   * Assigns the content steering tag properties to the steering controller
   *
   * @param {string} baseUrl the baseURL from the main manifest for resolving the steering manifest url
   * @param {Object} steeringTag the content steering tag from the main manifest
   */
  assignTagProperties(baseUrl, steeringTag) {
    this.manifestType_ = steeringTag.serverUri ? 'HLS' : 'DASH';
    // serverUri is HLS serverURL is DASH
    const steeringUri = steeringTag.serverUri || steeringTag.serverURL;

    if (!steeringUri) {
      this.logger_(`steering manifest URL is ${steeringUri}, cannot request steering manifest.`);
      this.trigger('error');
      return;
    }
    // Content steering manifests can be encoded as a data URI. We can decode, parse and return early if that's the case.
    if (steeringUri.startsWith('data:')) {
      this.decodeDataUriManifest_(steeringUri.substring(steeringUri.indexOf(',') + 1));
      return;
    }

    // reloadUri is the resolution of the main manifest URL and steering URL.
    this.steeringManifest.reloadUri = resolveUrl(baseUrl, steeringUri);
    // pathwayId is HLS defaultServiceLocation is DASH
    this.defaultPathway = steeringTag.pathwayId || steeringTag.defaultServiceLocation;
    // currently only DASH supports the following properties on <ContentSteering> tags.
    this.queryBeforeStart = steeringTag.queryBeforeStart;
    this.proxyServerUrl_ = steeringTag.proxyServerURL;

    // trigger a steering event if we have a pathway from the content steering tag.
    // this tells VHS which segment pathway to start with.
    // If queryBeforeStart is true we need to wait for the steering manifest response.
    if (this.defaultPathway && !this.queryBeforeStart) {
      this.trigger('content-steering');
    }
  }

  /**
   * Requests the content steering manifest and parse the response. This should only be called after
   * assignTagProperties was called with a content steering tag.
   *
   * @param {string} initialUri The optional uri to make the request with.
   *    If set, the request should be made with exactly what is passed in this variable.
   *    This scenario should only happen once on initalization.
   */
  requestSteeringManifest(initial) {
    const reloadUri = this.steeringManifest.reloadUri;

    if (!reloadUri) {
      return;
    }

    // We currently don't support passing MPD query parameters directly to the content steering URL as this requires
    // ExtUrlQueryInfo tag support. See the DASH content steering spec section 8.1.

    // This request URI accounts for manifest URIs that have been excluded.
    const uri = initial ? reloadUri : this.getRequestURI(reloadUri);

    // If there are no valid manifest URIs, we should stop content steering.
    if (!uri) {
      this.logger_('No valid content steering manifest URIs. Stopping content steering.');
      this.trigger('error');
      this.dispose();
      return;
    }
    const metadata = {
      contentSteeringInfo: {
        uri
      }
    };

    this.trigger({ type: 'contentsteeringloadstart', metadata });
    this.request_ = this.xhr_({
      uri,
      requestType: 'content-steering-manifest'
    }, (error, errorInfo) => {
      if (error) {
        // If the client receives HTTP 410 Gone in response to a manifest request,
        // it MUST NOT issue another request for that URI for the remainder of the
        // playback session. It MAY continue to use the most-recently obtained set
        // of Pathways.
        if (errorInfo.status === 410) {
          this.logger_(`manifest request 410 ${error}.`);
          this.logger_(`There will be no more content steering requests to ${uri} this session.`);

          this.excludedSteeringManifestURLs.add(uri);
          return;
        }
        // If the client receives HTTP 429 Too Many Requests with a Retry-After
        // header in response to a manifest request, it SHOULD wait until the time
        // specified by the Retry-After header to reissue the request.
        if (errorInfo.status === 429) {
          const retrySeconds = errorInfo.responseHeaders['retry-after'];

          this.logger_(`manifest request 429 ${error}.`);
          this.logger_(`content steering will retry in ${retrySeconds} seconds.`);
          this.startTTLTimeout_(parseInt(retrySeconds, 10));
          return;
        }
        // If the Steering Manifest cannot be loaded and parsed correctly, the
        // client SHOULD continue to use the previous values and attempt to reload
        // it after waiting for the previously-specified TTL (or 5 minutes if
        // none).
        this.logger_(`manifest failed to load ${error}.`);
        this.startTTLTimeout_();
        return;
      }
      this.trigger({ type: 'contentsteeringloadcomplete', metadata });
      let steeringManifestJson;

      try {
        steeringManifestJson = JSON.parse(this.request_.responseText);
      } catch (parseError) {
        const errorMetadata = {
          errorType: videojs.Error.StreamingContentSteeringParserError,
          error: parseError
        };

        this.trigger({ type: 'error', metadata: errorMetadata });
      }

      this.assignSteeringProperties_(steeringManifestJson);
      const parsedMetadata = {
        contentSteeringInfo: metadata.contentSteeringInfo,
        contentSteeringManifest: {
          version: this.steeringManifest.version,
          reloadUri: this.steeringManifest.reloadUri,
          priority: this.steeringManifest.priority
        }
      };

      this.trigger({ type: 'contentsteeringparsed', metadata: parsedMetadata });
      this.startTTLTimeout_();
    });
  }

  /**
   * Set the proxy server URL and add the steering manifest url as a URI encoded parameter.
   *
   * @param {string} steeringUrl the steering manifest url
   * @return the steering manifest url to a proxy server with all parameters set
   */
  setProxyServerUrl_(steeringUrl) {
    const steeringUrlObject = new window.URL(steeringUrl);
    const proxyServerUrlObject = new window.URL(this.proxyServerUrl_);

    proxyServerUrlObject.searchParams.set('url', encodeURI(steeringUrlObject.toString()));
    return this.setSteeringParams_(proxyServerUrlObject.toString());
  }

  /**
   * Decodes and parses the data uri encoded steering manifest
   *
   * @param {string} dataUri the data uri to be decoded and parsed.
   */
  decodeDataUriManifest_(dataUri) {
    const steeringManifestJson = JSON.parse(window.atob(dataUri));

    this.assignSteeringProperties_(steeringManifestJson);
  }

  /**
   * Set the HLS or DASH content steering manifest request query parameters. For example:
   * _HLS_pathway="<CURRENT-PATHWAY-ID>" and _HLS_throughput=<THROUGHPUT>
   * _DASH_pathway and _DASH_throughput
   *
   * @param {string} uri to add content steering server parameters to.
   * @return a new uri as a string with the added steering query parameters.
   */
  setSteeringParams_(url) {
    const urlObject = new window.URL(url);
    const path = this.getPathway();
    const networkThroughput = this.getBandwidth_();

    if (path) {
      const pathwayKey = `_${this.manifestType_}_pathway`;

      urlObject.searchParams.set(pathwayKey, path);
    }

    if (networkThroughput) {
      const throughputKey = `_${this.manifestType_}_throughput`;

      urlObject.searchParams.set(throughputKey, networkThroughput);
    }
    return urlObject.toString();
  }

  /**
   * Assigns the current steering manifest properties and to the SteeringManifest object
   *
   * @param {Object} steeringJson the raw JSON steering manifest
   */
  assignSteeringProperties_(steeringJson) {
    this.steeringManifest.version = steeringJson.VERSION;
    if (!this.steeringManifest.version) {
      this.logger_(`manifest version is ${steeringJson.VERSION}, which is not supported.`);
      this.trigger('error');
      return;
    }
    this.steeringManifest.ttl = steeringJson.TTL;
    this.steeringManifest.reloadUri = steeringJson['RELOAD-URI'];
    // HLS = PATHWAY-PRIORITY required. DASH = SERVICE-LOCATION-PRIORITY optional
    this.steeringManifest.priority = steeringJson['PATHWAY-PRIORITY'] || steeringJson['SERVICE-LOCATION-PRIORITY'];

    // Pathway clones to be created/updated in HLS.
    // See section 7.2 https://datatracker.ietf.org/doc/draft-pantos-hls-rfc8216bis/
    this.steeringManifest.pathwayClones = steeringJson['PATHWAY-CLONES'];
    this.nextPathwayClones = this.steeringManifest.pathwayClones;

    // 1. apply first pathway from the array.
    // 2. if first pathway doesn't exist in manifest, try next pathway.
    //    a. if all pathways are exhausted, ignore the steering manifest priority.
    // 3. if segments fail from an established pathway, try all variants/renditions, then exclude the failed pathway.
    //    a. exclude a pathway for a minimum of the last TTL duration. Meaning, from the next steering response,
    //       the excluded pathway will be ignored.
    //       See excludePathway usage in excludePlaylist().

    // If there are no available pathways, we need to stop content steering.
    if (!this.availablePathways_.size) {
      this.logger_('There are no available pathways for content steering. Ending content steering.');
      this.trigger('error');
      this.dispose();
    }

    const chooseNextPathway = (pathwaysByPriority) => {
      for (const path of pathwaysByPriority) {
        if (this.availablePathways_.has(path)) {
          return path;
        }
      }

      // If no pathway matches, ignore the manifest and choose the first available.
      return [...this.availablePathways_][0];
    };

    const nextPathway = chooseNextPathway(this.steeringManifest.priority);

    if (this.currentPathway !== nextPathway) {
      this.currentPathway = nextPathway;
      this.trigger('content-steering');
    }
  }

  /**
   * Returns the pathway to use for steering decisions
   *
   * @return {string} returns the current pathway or the default
   */
  getPathway() {
    return this.currentPathway || this.defaultPathway;
  }

  /**
   * Chooses the manifest request URI based on proxy URIs and server URLs.
   * Also accounts for exclusion on certain manifest URIs.
   *
   * @param {string} reloadUri the base uri before parameters
   *
   * @return {string} the final URI for the request to the manifest server.
   */
  getRequestURI(reloadUri) {
    if (!reloadUri) {
      return null;
    }

    const isExcluded = (uri) => this.excludedSteeringManifestURLs.has(uri);

    if (this.proxyServerUrl_) {
      const proxyURI = this.setProxyServerUrl_(reloadUri);

      if (!isExcluded(proxyURI)) {
        return proxyURI;
      }
    }

    const steeringURI = this.setSteeringParams_(reloadUri);

    if (!isExcluded(steeringURI)) {
      return steeringURI;
    }

    // Return nothing if all valid manifest URIs are excluded.
    return null;
  }

  /**
   * Start the timeout for re-requesting the steering manifest at the TTL interval.
   *
   * @param {number} ttl time in seconds of the timeout. Defaults to the
   *        ttl interval in the steering manifest
   */
  startTTLTimeout_(ttl = this.steeringManifest.ttl) {
    // 300 (5 minutes) is the default value.
    const ttlMS = ttl * 1000;

    this.ttlTimeout_ = window.setTimeout(() => {
      this.requestSteeringManifest();
    }, ttlMS);
  }

  /**
   * Clear the TTL timeout if necessary.
   */
  clearTTLTimeout_() {
    window.clearTimeout(this.ttlTimeout_);
    this.ttlTimeout_ = null;
  }

  /**
   * aborts any current steering xhr and sets the current request object to null
   */
  abort() {
    if (this.request_) {
      this.request_.abort();
    }
    this.request_ = null;
  }

  /**
   * aborts steering requests clears the ttl timeout and resets all properties.
   */
  dispose() {
    this.off('content-steering');
    this.off('error');
    this.abort();
    this.clearTTLTimeout_();
    this.currentPathway = null;
    this.defaultPathway = null;
    this.queryBeforeStart = null;
    this.proxyServerUrl_ = null;
    this.manifestType_ = null;
    this.ttlTimeout_ = null;
    this.request_ = null;
    this.excludedSteeringManifestURLs = new Set();
    this.availablePathways_ = new Set();
    this.steeringManifest = new SteeringManifest();
  }

  /**
   * adds a pathway to the available pathways set
   *
   * @param {string} pathway the pathway string to add
   */
  addAvailablePathway(pathway) {
    if (pathway) {
      this.availablePathways_.add(pathway);
    }
  }

  /**
   * Clears all pathways from the available pathways set
   */
  clearAvailablePathways() {
    this.availablePathways_.clear();
  }

  /**
   * Removes a pathway from the available pathways set.
   */
  excludePathway(pathway) {
    return this.availablePathways_.delete(pathway);
  }

  /**
   * Checks the refreshed DASH manifest content steering tag for changes.
   *
   * @param {string} baseURL new steering tag on DASH manifest refresh
   * @param {Object} newTag the new tag to check for changes
   * @return a true or false whether the new tag has different values
   */
  didDASHTagChange(baseURL, newTag) {
    return !newTag && this.steeringManifest.reloadUri ||
      newTag && (resolveUrl(baseURL, newTag.serverURL) !== this.steeringManifest.reloadUri ||
      newTag.defaultServiceLocation !== this.defaultPathway ||
      newTag.queryBeforeStart !== this.queryBeforeStart ||
      newTag.proxyServerURL !== this.proxyServerUrl_);
  }

  getAvailablePathways() {
    return this.availablePathways_;
  }
}
