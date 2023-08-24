import resolveUrl from './resolve-url';
import window from 'global/window';
import logger from './util/logger';

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
      this.reloadUri_ = resolveUrl(this.reloadUri_, uri);
    }
  }

  set priority(array) {
    // priority must be non-empty and unique values.
    if (array.length) {
      this.priority_ = new Set(array);
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
 * @param {Object} playlistLoader a reference to the mainPlaylistLoader
 * @param {Object} segmentLoader a reference to the mainSegmentLoader
 */
export default class ContentSteering {
  // pass a playlist loader and segment loader reference for triggering events, logging and xhr.
  constructor(playlistLoader, segmentLoader) {
    this.currentPathway = null;
    this.steeringManifest = new SteeringManifest();
    this.queryBeforeStart_ = null;
    this.proxyServerUrl_ = null;
    this.manifestType_ = null;
    this.ttlTimeout_ = null;
    this.request_ = null;
    this.mainPlaylistLoader_ = playlistLoader;
    this.mainSegmentLoader_ = segmentLoader;
    this.logger_ = logger('ContentSteering');
  }

  /**
   * This function will extract the content steering data from both DASH and HLS manifest objects.
   */
  handleContentSteeringTag() {
    const steeringTag = this.mainPlaylistLoader_.main.contentSteering;

    if (!steeringTag) {
      return;
    }
    this.assignTagProperties_(this.mainPlaylistLoader_.main.uri, steeringTag);
  }

  /**
   * Requests the steering manifest and parse response.
   */
  requestContentSteeringManifest() {
    if (!this.steeringManifest.reloadUri) {
      this.logger_(`${this.logString_} manifest URL is ${this.steeringManifest.reloadUri}, cannot request steering manifest.`);
    }
    // add parameters to the steering uri
    const reloadUri = this.steeringManifest.reloadUri;
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
        this.mainPlaylistLoader_.logger(`manifest failed to load ${error}.`);
        return;
      }
      const steeringManifestJson = JSON.parse(this.request_.responseText);

      this.assignSteeringProperties_(steeringManifestJson);
    });
  }

  /**
   * Assigns the content steering tag properties to
   *
   * @param {string} baseUrl the baseURL from the manifest for resolving the steering manifest url.
   */
  assignTagProperties_(baseUrl, steeringTag) {
    this.manifestType_ = steeringTag.serverUri ? 'HLS' : 'DASH';
    // serverUri is HLS serverURL is DASH
    const steeringUri = steeringTag.serverUri || steeringTag.serverURL;

    // Content steering manifests can be encoded as a data URI. We can decode, parse and return early if that's the case.
    if (steeringUri.startsWith('data:')) {
      this.decodeDataUriManifest_(steeringUri.substring(steeringUri.indexOf(',') + 1));
      return;
    }
    this.steeringManifest.reloadUri = resolveUrl(baseUrl, steeringUri);
    // pathwayId is HLS defaultServiceLocation is DASH
    this.currentPathway = steeringTag.pathwayId || steeringTag.defaultServiceLocation;
    // currently only DASH supports the following properties on <ContentSteering> tags.
    if (this.manifestType_ === 'DASH') {
      this.queryBeforeStart = steeringTag.queryBeforeStart || false;
      this.proxyServerUrl_ = steeringTag.proxyServerUrl;
    }

    // trigger a steering event if we have a pathway from the content steering tag.
    // this tells VHS which segment pathway to start with.
    if (this.currentPathway && !this.queryBeforeStart) {
      this.mainPlaylistLoader_.trigger('content-steering');
    }
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

    if (this.currentPathway) {
      const pathwayKey = `_${this.manifestType_}_pathway`;

      urlObject.searchParams.set(pathwayKey, this.currentPathway);
    }

    if (this.mainSegmentLoader_.throughput.rate) {
      const throughputKey = `_${this.manifestType_}_throughput`;
      const rateInteger = Math.round(this.mainSegmentLoader_.throughput.rate);

      urlObject.searchParams.set(throughputKey, rateInteger);
    }
    return urlObject.toString();
  }

  /**
   * Assigns the current steering manifest properties and to the ContentSteering class.
   *
   * @param {Object} steeringJson the raw JSON steering manifest
   */
  assignSteeringProperties_(steeringJson) {
    this.steeringManifest.version = steeringJson.VERSION;
    if (!this.steeringManifest.version) {
      this.logger_(`manifest version is ${this.steeringManifest.version}, which is not supported.`);
      return;
    }
    this.steeringManifest.ttl = steeringJson.TTL;
    this.steeringManifest.reloadUri = steeringJson['RELOAD-URI'];
    // HLS = PATHWAY-PRIORITY required. DASH = SERVICE-LOCATION-PRIORITY optional, default = false
    this.steeringManifest.priority = steeringJson['PATHWAY-PRIORITY'] || steeringJson['SERVICE-LOCATION-PRIORITY'];
    // TODO: HLS handle PATHWAY-CLONES. See section 7.2 https://datatracker.ietf.org/doc/draft-pantos-hls-rfc8216bis/
    // Fire a content-steering event here to let the player know we have new steering data.
    this.mainPlaylistLoader_.trigger('content-steering');
    this.startTTLTimeout_();
  }

  /**
   * Start the timeout for re-requesting the steering manifest at the TTL interval.
   */
  startTTLTimeout_() {
    if (!this.steeringManifest.ttl) {
      this.logger_(`manifest ttl is ${this.steeringManifest.ttl} cannot reload steering manifest.`);
    }
    const ttlMS = this.steeringManifest.ttl * 1000;

    this.ttlTimeout = window.setTimeout(() => {
      this.requestContentSteeringManifest();
    }, ttlMS);
  }

  /**
   * Clear the TTL timeout if necessary.
   */
  clearTTLTimeout() {
    window.clearTimeout(this.ttlTimeout);
    this.ttlTimeout = null;
  }

  /**
   * aborts any current steering xhr and sets the current request object to null
   */
  abort() {
    if (this.request_) {
      this.request_.abort();
    }
  }

  dispose() {
    this.abort();
    this.clearTTLTimeout();
    this.currentPathway = null;
    this.queryBeforeStart_ = null;
    this.proxyServerUrl_ = null;
    this.manifestType_ = null;
    this.ttlTimeout_ = null;
    this.request_ = null;
  }
}

