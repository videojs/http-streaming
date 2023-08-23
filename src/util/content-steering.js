import resolveUrl from '../resolve-url';
import window from 'global/window';

// Content Steering manifest format
//
// VERSION: number (required)
// TTL: number in seconds (optional), default is 300 seconds.
// RELOAD-URI: string (optional)
// SERVICE-LOCATION-PRIORITY or PATHWAY-PRIORITY array of strings (handle quoted and not quoted) (optional) default = false in DASH
// TODO: add spec references.

/**
 * This class represents a content steering manifest and associated state.
 */
export default class ContentSteering {
  constructor(xhr, manifestUri, steeringTag, mainPlaylistLoader) {
    // pass a playlist loader reference for triggering events.
    this.mainPlaylistLoader_ = mainPlaylistLoader;
    this.queryBeforeStart = false;
    this.nullAllProperties_();

    this.handleContentSteeringTags_(xhr, manifestUri, steeringTag);
  }

  /**
   * This function will extract the content steering data from both DASH and HLS manifest objects.
   *
   * @param {Function} xhr the tech xhr function
   * @param {string} manifestUri the uri of the main manifest for path resolution
   * @param {Object} steeringTag the content steering tag from the manifest
   */
  handleContentSteeringTags_(xhr, manifestUri, steeringTag) {
    if (!xhr || !steeringTag) {
      return;
    }
    this.manifestType = steeringTag.serverUri ? 'HLS' : 'DASH';
    // serverUri is HLS serverURL is DASH
    const steeringUri = steeringTag.serverUri || steeringTag.serverURL;

    // pathwayId is HLS defaultServiceLocation is DASH
    this.currentCdn = steeringTag.pathwayId || steeringTag.defaultServiceLocation;
    // currently only DASH supports forcing a steering request prior to playback
    this.queryBeforeStart = this.manifestType === 'DASH' && steeringTag.queryBeforeStart;

    if (this.currentCdn && !this.queryBeforeStart) {
      this.mainPlaylistLoader_.trigger('content-steering');
    }

    // Content steering manifests can be encoded as a data URI. We can decode, parse and return early if that's the case.
    if (steeringUri.startsWith('data:')) {
      this.decodeDataUriManifest_(steeringUri.substring(steeringUri.indexOf(',') + 1), xhr, manifestUri);
      return;
    }

    // resolve the URI to an absolute URI.
    const uri = resolveUrl(manifestUri, steeringUri);

    this.requestContentSteeringManifest_(uri, xhr);
  }

  /**
   * Decodes and parses the data uri encoded steering manifest
   *
   * @param {string} dataUri the data uri to be decoded and parsed.
   */
  decodeDataUriManifest_(dataUri, xhr, manifestUri) {
    const steeringManifestJson = JSON.parse(window.atob(dataUri));

    this.assignSteeringProperties_(steeringManifestJson, manifestUri);
    this.startTTLTimeout_(this.reloadUri, xhr);
  }

  /**
   * Requests the steering manifest and parse response.
   *
   * @param {string} uri the uri to request the steering manifest from
   * @param {Function} xhr the tech xhr function
   */
  requestContentSteeringManifest_(uri, xhr) {
    this.request = xhr({
      uri: this.setSteeringParams_(uri)
    }, (error) => {
      if (error) {
        this.mainPlaylistLoader_.logger.warn(`sontent steering manifest failed to load ${error}`);
        this.dispose();
        return;
      }
      const steeringManifestJson = JSON.parse(this.request.responseText);

      this.assignSteeringProperties_(steeringManifestJson, uri);
      // Fire a content-steering event here to let the player know we have new steering data.
      this.mainPlaylistLoader_.trigger('content-steering');
      this.startTTLTimeout_(this.reloadUri, xhr);
    });
  }

  /**
   * Set the HLS or DASH content steering manifest request query parameters. For example:
   * _HLS_pathway="<CURRENT-PATHWAY-ID>" and _HLS_throughput=<THROUGHPUT>
   * _DASH_pathway and _DASH_throughput
   *
   * @param {string} uri to add content steering server parameters to.
   * @return a new uri as a string with the added steering query parameters.
   */
  setSteeringParams_(uri) {
    const urlObject = new window.URL(uri);

    // set the pathway query param if we have a currentCdn or pathway
    if (this.currentCdn) {
      const pathwayKey = `_${this.manifestType}_pathway`;

      urlObject.searchParams.set(pathwayKey, this.currentCdn);
    }
    // set throughput query param if we have a throughput rate
    const hasThroughputRate = this.mainSegmentLoader_ && this.mainSegmentLoader_.throughput && this.mainSegmentLoader_.throughput.rate;

    if (hasThroughputRate) {
      const throughputKey = `_${this.manifestType}_throughput`;

      urlObject.searchParams.set(throughputKey, this.mainSegmentLoader_.throughput.rate);
    }
    return urlObject.toString();
  }

  /**
   * Assigns the current steering manifest properties and to the ContentSteering class.
   *
   * @param {Object} steeringManifest the raw JSON steering manifest
   * @param {string} baseUri the baseUri for url path resolution
   */
  assignSteeringProperties_(steeringManifest, baseUri) {
    this.version = steeringManifest.VERSION;
    // time-to-live default = 300 seconds
    this.ttl = steeringManifest.TTL || 300;
    // RELOAD-URI is optional and can be relative, if absent use current manifest uri.
    this.reloadUri = steeringManifest['RELOAD-URI'] ? resolveUrl(baseUri, steeringManifest['RELOAD-URI']) : baseUri;
    // HLS = PATHWAY-PRIORITY, DASH = SERVICE-LOCATION-PRIORITY default = false
    this.cdnPriority = steeringManifest['PATHWAY-PRIORITY'] || steeringManifest['SERVICE-LOCATION-PRIORITY'] || false;
  }

  /**
   * Start the timeout for re-requesting the steering manifest at the TTL interval.
   *
   * @param {string} uri the uri to request the steering manifest from after the ttl interval
   * @param {Function} xhr the tech xhr function
   */
  startTTLTimeout_(uri, xhr) {
    const ttlMS = this.ttl * 1000;

    this.ttlTimeout = window.setTimeout(() => {
      this.requestContentSteeringManifest_(uri, xhr);
    }, ttlMS);
  }

  /**
   * Clear the TTL timeout if necessary.
   */
  clearTTLTimeout_() {
    window.clearTimeout(this.ttlTimeout);
    this.ttlTimeout = null;
  }

  nullAllProperties_() {
    this.version = null;
    this.ttl = null;
    this.reloadUri = null;
    this.cdnPriority = null;
    this.ttlTimeout = null;
    this.currentCdn = null;
    this.request = null;
    this.manifestType = null;
  }

  /**
   * aborts any current steering xhr and sets the current request object to null
   */
  abort() {
    if (this.request) {
      this.request.abort();
      this.request = null;
    }
  }

  /**
   * aborts and clears the timeout on any steering manifest requests.
   */
  dispose() {
    this.abort();
    this.clearTTLTimeout_();
    this.nullAllProperties_();
    this.logger = null;
  }
}
