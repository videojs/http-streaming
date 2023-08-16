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
  constructor() {
    this.version = null;
    this.ttl = null;
    this.reloadUri = null;
    this.cdnPriority = null;
    this.ttlTimeout = null;
    this.currentCdn = null;
    this.request = null;
  }

  /**
   * This function will extract the content steering data from both DASH and HLS manifest objects.
   *
   * @param {Function} xhr the tech xhr function
   * @param {string} manifestUri the uri of the main manifest for path resolution
   * @param {Object} steeringTag the content steering tag from the manifest
   */
  handleContentSteeringTags(xhr, manifestUri, steeringTag) {
    if (!xhr || !steeringTag) {
      return;
    }
    // serverUri is HLS serverURL is DASH
    const steeringUri = steeringTag.serverUri || steeringTag.serverURL;

    // pathwayId is HLS defaultServiceLocation is DASH
    this.currentCdn = steeringTag.pathwayId || steeringTag.defaultServiceLocation;
    // resolve the URI to an absolute URI.
    const uri = resolveUrl(manifestUri, steeringUri);

    this.requestContentSteeringManifest_(uri, xhr);
  }

  /**
   * Requests the steering manifest and parse response.
   *
   * @param {string} uri the uri to request the steering manifest from
   * @param {Function} xhr the tech xhr function
   */
  requestContentSteeringManifest_(uri, xhr) {
    // TODO: Handle steering query parameters.
    this.request = xhr({
      uri
    }, (error) => {
      if (error) {
        // TODO: Add error handling.
      }
      const steeringManifestJson = JSON.parse(this.request.responseText);

      this.assignSteeringProperties_(steeringManifestJson, uri);
      this.startTTLTimeout_(uri, xhr);
    });
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
  }
}
