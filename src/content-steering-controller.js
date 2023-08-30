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
 */
class SteeringManifest {
  constructor() {
    this.priority_ = [];
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
}

/**
 * This class represents a content steering manifest and associated state. See both HLS and DASH specifications.
 * HLS: https://developer.apple.com/streaming/HLSContentSteeringSpecification.pdf and
 * https://datatracker.ietf.org/doc/draft-pantos-hls-rfc8216bis/ section 4.4.6.6.
 * DASH: https://dashif.org/docs/DASH-IF-CTS-00XX-Content-Steering-Community-Review.pdf
 *
 * @param {Object} segmentLoader a reference to the mainSegmentLoader
 */
export default class ContentSteeringController extends videojs.EventTarget {
  // pass a segment loader reference for throughput rate and xhr
  constructor(segmentLoader) {
    super();

    this.currentPathway = null;
    this.defaultPathway = null;
    this.queryBeforeStart = null;
    this.availablePathways_ = new Set();
    // TODO: Implement exclusion.
    this.excludedPathways_ = new Set();
    this.steeringManifest = new SteeringManifest();
    this.proxyServerUrl_ = null;
    this.manifestType_ = null;
    this.ttlTimeout_ = null;
    this.request_ = null;
    this.mainSegmentLoader_ = segmentLoader;
    this.logger_ = logger('Content Steering');
  }

  /**
   * Assigns the content steering tag properties to the steering controller
   *
   * @param {string} baseUrl the baseURL from the manifest for resolving the steering manifest url
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
    this.steeringManifest.reloadUri = resolveUrl(baseUrl, steeringUri);
    // pathwayId is HLS defaultServiceLocation is DASH
    this.defaultPathway = steeringTag.pathwayId || steeringTag.defaultServiceLocation;
    // currently only DASH supports the following properties on <ContentSteering> tags.
    if (this.manifestType_ === 'DASH') {
      this.queryBeforeStart = steeringTag.queryBeforeStart || false;
      this.proxyServerUrl_ = steeringTag.proxyServerURL;
    }

    // trigger a steering event if we have a pathway from the content steering tag.
    // this tells VHS which segment pathway to start with.
    if (this.defaultPathway) {
      this.trigger('content-steering');
    }
  }

  /**
   * Requests the content steering manifest and parse the response. This should only be called after
   * assignTagProperties was called with a content steering tag.
   */
  requestSteeringManifest() {
    // add parameters to the steering uri
    const reloadUri = this.steeringManifest.reloadUri;
    // We currently don't support passing MPD query parameters directly to the content steering URL as this requires
    // ExtUrlQueryInfo tag support. See the DASH content steering spec section 8.1.
    const uri = this.proxyServerUrl_ ? this.setProxyServerUrl_(reloadUri) : this.setSteeringParams_(reloadUri);

    this.request_ = this.mainSegmentLoader_.vhs_.xhr({
      uri
    }, (error) => {
      // TODO: HLS CASES THAT NEED ADDRESSED:
      // If the client receives HTTP 410 Gone in response to a manifest request,
      // it MUST NOT issue another request for that URI for the remainder of the
      // playback session. It MAY continue to use the most-recently obtained set
      // of Pathways.
      // If the client receives HTTP 429 Too Many Requests with a Retry-After
      // header in response to a manifest request, it SHOULD wait until the time
      // specified by the Retry-After header to reissue the request.
      if (error) {
        // TODO: HLS RETRY CASE:
        // If the Steering Manifest cannot be loaded and parsed correctly, the
        // client SHOULD continue to use the previous values and attempt to reload
        // it after waiting for the previously-specified TTL (or 5 minutes if
        // none).
        this.logger_(`manifest failed to load ${error}.`);
        // TODO: we may want to expose the error object here.
        this.trigger('error');
        return;
      }
      const steeringManifestJson = JSON.parse(this.request_.responseText);

      this.assignSteeringProperties_(steeringManifestJson);
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

    if (path) {
      const pathwayKey = `_${this.manifestType_}_pathway`;

      urlObject.searchParams.set(pathwayKey, path);
    }

    if (this.mainSegmentLoader_.throughput.rate) {
      const throughputKey = `_${this.manifestType_}_throughput`;
      const rateInteger = Math.round(this.mainSegmentLoader_.throughput.rate);

      urlObject.searchParams.set(throughputKey, rateInteger);
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
    // TODO: HLS handle PATHWAY-CLONES. See section 7.2 https://datatracker.ietf.org/doc/draft-pantos-hls-rfc8216bis/

    // TODO: fully implement priority logic.
    // 1. apply first pathway from the array.
    // 2. if first first pathway doesn't exist in manifest, try next pathway.
    //    a. if all pathways are exhausted, ignore the steering manifest priority.
    // 3. if segments fail from an established pathway, try all variants/renditions, then exclude the failed pathway.
    //    a. exclude a pathway for a minimum of the last TTL duration. Meaning, from the next steering response,
    //       the excluded pathway will be ignored.
    const chooseNextPathway = (pathways) => {
      for (const path of pathways) {
        if (this.availablePathways_.has(path)) {
          return path;
        }
      }
    };
    const nextPathway = chooseNextPathway(this.steeringManifest.priority);

    if (this.currentPathway !== nextPathway) {
      this.currentPathway = nextPathway;
      this.trigger('content-steering');
    }
    this.startTTLTimeout_();
  }

  /**
   * Returns the pathway to use for steering decisions
   *
   * @return returns the current pathway or the default
   */
  getPathway() {
    return this.currentPathway || this.defaultPathway;
  }

  /**
   * Start the timeout for re-requesting the steering manifest at the TTL interval.
   */
  startTTLTimeout_() {
    // 300 (5 minutes) is the default value.
    const ttlMS = this.steeringManifest.ttl * 1000;

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
    this.abort();
    this.clearTTLTimeout_();
    this.currentPathway = null;
    this.defaultPathway = null;
    this.queryBeforeStart = null;
    this.proxyServerUrl_ = null;
    this.manifestType_ = null;
    this.ttlTimeout_ = null;
    this.request_ = null;
    this.availablePathways_ = new Set();
    this.excludedPathways_ = new Set();
    this.steeringManifest = new SteeringManifest();
  }

  /**
   * adds a pathway to the available pathways set
   *
   * @param {string} pathway the pathway string to add
   */
  addAvailablePathway(pathway) {
    this.availablePathways_.add(pathway);
  }
}
