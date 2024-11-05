import videojs from 'video.js';
import {
  parse as parseMpd,
  addSidxSegmentsToPlaylist,
  generateSidxKey,
  parseUTCTiming
} from 'mpd-parser';
import {
  refreshDelay,
  updateMain as updatePlaylist,
  isPlaylistUnchanged
} from './playlist-loader';
import { resolveUrl, resolveManifestRedirect } from './resolve-url';
import parseSidx from 'mux.js/lib/tools/parse-sidx';
import { segmentXhrHeaders } from './xhr';
import window from 'global/window';
import {
  forEachMediaGroup,
  addPropertiesToMain
} from './manifest';
import containerRequest from './util/container-request.js';
import {toUint8} from '@videojs/vhs-utils/es/byte-helpers';
import logger from './util/logger';
import {merge} from './util/vjs-compat';
import { getStreamingNetworkErrorMetadata } from './error-codes.js';

const { EventTarget } = videojs;

const dashPlaylistUnchanged = function(a, b) {
  if (!isPlaylistUnchanged(a, b)) {
    return false;
  }

  // for dash the above check will often return true in scenarios where
  // the playlist actually has changed because mediaSequence isn't a
  // dash thing, and we often set it to 1. So if the playlists have the same amount
  // of segments we return true.
  // So for dash we need to make sure that the underlying segments are different.

  // if sidx changed then the playlists are different.
  if (a.sidx && b.sidx && (a.sidx.offset !== b.sidx.offset || a.sidx.length !== b.sidx.length)) {
    return false;
  } else if ((!a.sidx && b.sidx) || (a.sidx && !b.sidx)) {
    return false;
  }

  // one or the other does not have segments
  // there was a change.
  if (a.segments && !b.segments || !a.segments && b.segments) {
    return false;
  }

  // neither has segments nothing changed
  if (!a.segments && !b.segments) {
    return true;
  }

  // check segments themselves
  for (let i = 0; i < a.segments.length; i++) {
    const aSegment = a.segments[i];
    const bSegment = b.segments[i];

    // if uris are different between segments there was a change
    if (aSegment.uri !== bSegment.uri) {
      return false;
    }

    // neither segment has a byterange, there will be no byterange change.
    if (!aSegment.byterange && !bSegment.byterange) {
      continue;
    }
    const aByterange = aSegment.byterange;
    const bByterange = bSegment.byterange;

    // if byterange only exists on one of the segments, there was a change.
    if ((aByterange && !bByterange) || (!aByterange && bByterange)) {
      return false;
    }

    // if both segments have byterange with different offsets, there was a change.
    if (aByterange.offset !== bByterange.offset || aByterange.length !== bByterange.length) {
      return false;
    }
  }

  // if everything was the same with segments, this is the same playlist.
  return true;
};

/**
 * Use the representation IDs from the mpd object to create groupIDs, the NAME is set to mandatory representation
 * ID in the parser. This allows for continuous playout across periods with the same representation IDs
 * (continuous periods as defined in DASH-IF 3.2.12). This is assumed in the mpd-parser as well. If we want to support
 * periods without continuous playback this function may need modification as well as the parser.
 */
const dashGroupId = (type, group, label, playlist) => {
  // If the manifest somehow does not have an ID (non-dash compliant), use the label.
  const playlistId = playlist.attributes.NAME || label;

  return `placeholder-uri-${type}-${group}-${playlistId}`;
};

/**
 * Parses the main XML string and updates playlist URI references.
 *
 * @param {Object} config
 *        Object of arguments
 * @param {string} config.mainXml
 *        The mpd XML
 * @param {string} config.srcUrl
 *        The mpd URL
 * @param {Date} config.clientOffset
 *         A time difference between server and client
 * @param {Object} config.sidxMapping
 *        SIDX mappings for moof/mdat URIs and byte ranges
 * @return {Object}
 *         The parsed mpd manifest object
 */
export const parseMainXml = ({
  mainXml,
  srcUrl,
  clientOffset,
  sidxMapping,
  previousManifest
}) => {
  const manifest = parseMpd(mainXml, {
    manifestUri: srcUrl,
    clientOffset,
    sidxMapping,
    previousManifest
  });

  addPropertiesToMain(manifest, srcUrl, dashGroupId);

  return manifest;
};

/**
 * Removes any mediaGroup labels that no longer exist in the newMain
 *
 * @param {Object} update
 *         The previous mpd object being updated
 * @param {Object} newMain
 *         The new mpd object
 */
const removeOldMediaGroupLabels = (update, newMain) => {
  forEachMediaGroup(update, (properties, type, group, label) => {
    if (!newMain.mediaGroups[type][group] || !(label in newMain.mediaGroups[type][group])) {
      delete update.mediaGroups[type][group][label];
    }
  });
};

/**
 * Returns a new main manifest that is the result of merging an updated main manifest
 * into the original version.
 *
 * @param {Object} oldMain
 *        The old parsed mpd object
 * @param {Object} newMain
 *        The updated parsed mpd object
 * @return {Object}
 *         A new object representing the original main manifest with the updated media
 *         playlists merged in
 */
export const updateMain = (oldMain, newMain, sidxMapping) => {
  let noChanges = true;
  let update = merge(oldMain, {
    // These are top level properties that can be updated
    duration: newMain.duration,
    minimumUpdatePeriod: newMain.minimumUpdatePeriod,
    timelineStarts: newMain.timelineStarts
  });

  // First update the playlists in playlist list
  for (let i = 0; i < newMain.playlists.length; i++) {
    const playlist = newMain.playlists[i];

    if (playlist.sidx) {
      const sidxKey = generateSidxKey(playlist.sidx);

      // add sidx segments to the playlist if we have all the sidx info already
      if (sidxMapping && sidxMapping[sidxKey] && sidxMapping[sidxKey].sidx) {
        addSidxSegmentsToPlaylist(playlist, sidxMapping[sidxKey].sidx, playlist.sidx.resolvedUri);
      }
    }
    const playlistUpdate = updatePlaylist(update, playlist, dashPlaylistUnchanged);

    if (playlistUpdate) {
      update = playlistUpdate;
      noChanges = false;
    }
  }

  // Then update media group playlists
  forEachMediaGroup(newMain, (properties, type, group, label) => {
    if (properties.playlists && properties.playlists.length) {
      const id = properties.playlists[0].id;
      const playlistUpdate = updatePlaylist(update, properties.playlists[0], dashPlaylistUnchanged);

      if (playlistUpdate) {
        update = playlistUpdate;

        // add new mediaGroup label if it doesn't exist and assign the new mediaGroup.
        if (!(label in update.mediaGroups[type][group])) {
          update.mediaGroups[type][group][label] = properties;
        }

        // update the playlist reference within media groups
        update.mediaGroups[type][group][label].playlists[0] = update.playlists[id];

        noChanges = false;
      }
    }
  });

  // remove mediaGroup labels and references that no longer exist in the newMain
  removeOldMediaGroupLabels(update, newMain);

  if (newMain.minimumUpdatePeriod !== oldMain.minimumUpdatePeriod) {
    noChanges = false;
  }

  if (noChanges) {
    return null;
  }

  return update;
};

// SIDX should be equivalent if the URI and byteranges of the SIDX match.
// If the SIDXs have maps, the two maps should match,
// both `a` and `b` missing SIDXs is considered matching.
// If `a` or `b` but not both have a map, they aren't matching.
const equivalentSidx = (a, b) => {
  const neitherMap = Boolean(!a.map && !b.map);

  const equivalentMap = neitherMap || Boolean(a.map && b.map &&
    a.map.byterange.offset === b.map.byterange.offset &&
    a.map.byterange.length === b.map.byterange.length);

  return equivalentMap &&
    a.uri === b.uri &&
    a.byterange.offset === b.byterange.offset &&
    a.byterange.length === b.byterange.length;
};

// exported for testing
export const compareSidxEntry = (playlists, oldSidxMapping) => {
  const newSidxMapping = {};

  for (const id in playlists) {
    const playlist = playlists[id];
    const currentSidxInfo = playlist.sidx;

    if (currentSidxInfo) {
      const key = generateSidxKey(currentSidxInfo);

      if (!oldSidxMapping[key]) {
        break;
      }

      const savedSidxInfo = oldSidxMapping[key].sidxInfo;

      if (equivalentSidx(savedSidxInfo, currentSidxInfo)) {
        newSidxMapping[key] = oldSidxMapping[key];
      }
    }
  }

  return newSidxMapping;
};

/**
 *  A function that filters out changed items as they need to be requested separately.
 *
 *  The method is exported for testing
 *
 *  @param {Object} main the parsed mpd XML returned via mpd-parser
 *  @param {Object} oldSidxMapping the SIDX to compare against
 */
export const filterChangedSidxMappings = (main, oldSidxMapping) => {
  const videoSidx = compareSidxEntry(main.playlists, oldSidxMapping);
  let mediaGroupSidx = videoSidx;

  forEachMediaGroup(main, (properties, mediaType, groupKey, labelKey) => {
    if (properties.playlists && properties.playlists.length) {
      const playlists = properties.playlists;

      mediaGroupSidx = merge(
        mediaGroupSidx,
        compareSidxEntry(playlists, oldSidxMapping)
      );
    }
  });

  return mediaGroupSidx;
};

export default class DashPlaylistLoader extends EventTarget {
  // DashPlaylistLoader must accept either a src url or a playlist because subsequent
  // playlist loader setups from media groups will expect to be able to pass a playlist
  // (since there aren't external URLs to media playlists with DASH)
  constructor(srcUrlOrPlaylist, vhs, options = { }, mainPlaylistLoader) {
    super();

    this.isPaused_ = true;

    this.mainPlaylistLoader_ = mainPlaylistLoader || this;
    if (!mainPlaylistLoader) {
      this.isMain_ = true;
    }

    const { withCredentials = false } = options;

    this.vhs_ = vhs;
    this.withCredentials = withCredentials;
    this.addMetadataToTextTrack = options.addMetadataToTextTrack;

    if (!srcUrlOrPlaylist) {
      throw new Error('A non-empty playlist URL or object is required');
    }

    // event naming?
    this.on('minimumUpdatePeriod', () => {
      this.refreshXml_();
    });

    // live playlist staleness timeout
    this.on('mediaupdatetimeout', () => {
      this.refreshMedia_(this.media().id);
    });

    this.state = 'HAVE_NOTHING';
    this.loadedPlaylists_ = {};
    this.logger_ = logger('DashPlaylistLoader');

    // initialize the loader state
    // The mainPlaylistLoader will be created with a string
    if (this.isMain_) {
      this.mainPlaylistLoader_.srcUrl = srcUrlOrPlaylist;
      // TODO: reset sidxMapping between period changes
      // once multi-period is refactored
      this.mainPlaylistLoader_.sidxMapping_ = {};
    } else {
      this.childPlaylist_ = srcUrlOrPlaylist;
    }
  }

  get isPaused() {
    return this.isPaused_;
  }

  requestErrored_(err, request, startingState) {
    // disposed
    if (!this.request) {
      return true;
    }

    // pending request is cleared
    this.request = null;

    if (err) {
      // use the provided error object or create one
      // based on the request/response
      this.error = typeof err === 'object' && !(err instanceof Error) ? err : {
        status: request.status,
        message: 'DASH request error at URL: ' + request.uri,
        response: request.response,
        // MEDIA_ERR_NETWORK
        code: 2,
        metadata: err.metadata
      };
      if (startingState) {
        this.state = startingState;
      }

      this.trigger('error');
      return true;
    }
  }

  /**
   * Verify that the container of the sidx segment can be parsed
   * and if it can, get and parse that segment.
   */
  addSidxSegments_(playlist, startingState, cb) {
    const sidxKey = playlist.sidx && generateSidxKey(playlist.sidx);

    // playlist lacks sidx or sidx segments were added to this playlist already.
    if (!playlist.sidx || !sidxKey || this.mainPlaylistLoader_.sidxMapping_[sidxKey]) {
      // keep this function async
      window.clearTimeout(this.mediaRequest_);
      this.mediaRequest_ = window.setTimeout(() => cb(false), 0);
      return;
    }

    // resolve the segment URL relative to the playlist
    const uri = resolveManifestRedirect(playlist.sidx.resolvedUri);

    const fin = (err, request) => {
      if (this.requestErrored_(err, request, startingState)) {
        return;
      }

      const sidxMapping = this.mainPlaylistLoader_.sidxMapping_;
      const { requestType } = request;
      let sidx;

      try {
        sidx = parseSidx(toUint8(request.response).subarray(8));
      } catch (e) {
        e.metadata = getStreamingNetworkErrorMetadata({requestType, request, parseFailure: true });

        // sidx parsing failed.
        this.requestErrored_(e, request, startingState);
        return;
      }

      sidxMapping[sidxKey] = {
        sidxInfo: playlist.sidx,
        sidx
      };

      addSidxSegmentsToPlaylist(playlist, sidx, playlist.sidx.resolvedUri);

      return cb(true);
    };
    const REQUEST_TYPE = 'dash-sidx';

    this.request = containerRequest(uri, this.vhs_.xhr, (err, request, container, bytes) => {
      if (err) {
        return fin(err, request);
      }

      if (!container || container !== 'mp4') {
        const sidxContainer = container || 'unknown';

        return fin({
          status: request.status,
          message: `Unsupported ${sidxContainer} container type for sidx segment at URL: ${uri}`,
          // response is just bytes in this case
          // but we really don't want to return that.
          response: '',
          playlist,
          internal: true,
          playlistExclusionDuration: Infinity,
          // MEDIA_ERR_NETWORK
          code: 2
        }, request);
      }

      // if we already downloaded the sidx bytes in the container request, use them
      const {offset, length} = playlist.sidx.byterange;

      if (bytes.length >= (length + offset)) {
        return fin(err, {
          response: bytes.subarray(offset, offset + length),
          status: request.status,
          uri: request.uri
        });
      }

      // otherwise request sidx bytes
      this.request = this.vhs_.xhr({
        uri,
        responseType: 'arraybuffer',
        requestType: 'dash-sidx',
        headers: segmentXhrHeaders({byterange: playlist.sidx.byterange})
      }, fin);
    }, REQUEST_TYPE);
  }

  dispose() {
    this.isPaused_ = true;
    this.trigger('dispose');
    this.stopRequest();
    this.loadedPlaylists_ = {};
    window.clearTimeout(this.minimumUpdatePeriodTimeout_);
    window.clearTimeout(this.mediaRequest_);
    window.clearTimeout(this.mediaUpdateTimeout);
    this.mediaUpdateTimeout = null;
    this.mediaRequest_ = null;
    this.minimumUpdatePeriodTimeout_ = null;

    if (this.mainPlaylistLoader_.createMupOnMedia_) {
      this.off('loadedmetadata', this.mainPlaylistLoader_.createMupOnMedia_);
      this.mainPlaylistLoader_.createMupOnMedia_ = null;
    }

    this.off();
  }

  hasPendingRequest() {
    return this.request || this.mediaRequest_;
  }

  stopRequest() {
    if (this.request) {
      const oldRequest = this.request;

      this.request = null;
      oldRequest.onreadystatechange = null;
      oldRequest.abort();
    }
  }

  media(playlist) {
    // getter
    if (!playlist) {
      return this.media_;
    }

    // setter
    if (this.state === 'HAVE_NOTHING') {
      throw new Error('Cannot switch media playlist from ' + this.state);
    }

    const startingState = this.state;

    // find the playlist object if the target playlist has been specified by URI
    if (typeof playlist === 'string') {
      if (!this.mainPlaylistLoader_.main.playlists[playlist]) {
        throw new Error('Unknown playlist URI: ' + playlist);
      }
      playlist = this.mainPlaylistLoader_.main.playlists[playlist];
    }

    const mediaChange = !this.media_ || playlist.id !== this.media_.id;

    // switch to previously loaded playlists immediately
    if (mediaChange &&
      this.loadedPlaylists_[playlist.id] &&
      this.loadedPlaylists_[playlist.id].endList) {
      this.state = 'HAVE_METADATA';
      this.media_ = playlist;

      // trigger media change if the active media has been updated
      if (mediaChange) {
        this.trigger('mediachanging');
        this.trigger('mediachange');
      }
      return;
    }

    // switching to the active playlist is a no-op
    if (!mediaChange) {
      return;
    }

    // switching from an already loaded playlist
    if (this.media_) {
      this.trigger('mediachanging');
    }
    this.addSidxSegments_(playlist, startingState, (sidxChanged) => {
      // everything is ready just continue to haveMetadata
      this.haveMetadata({startingState, playlist});
    });
  }

  haveMetadata({startingState, playlist}) {
    this.state = 'HAVE_METADATA';
    this.loadedPlaylists_[playlist.id] = playlist;
    window.clearTimeout(this.mediaRequest_);
    this.mediaRequest_ = null;

    // This will trigger loadedplaylist
    this.refreshMedia_(playlist.id);

    // fire loadedmetadata the first time a media playlist is loaded
    // to resolve setup of media groups
    if (startingState === 'HAVE_MAIN_MANIFEST') {
      this.trigger('loadedmetadata');
    } else {
      // trigger media change if the active media has been updated
      this.trigger('mediachange');
    }
  }

  pause() {
    this.isPaused_ = true;

    if (this.mainPlaylistLoader_.createMupOnMedia_) {
      this.off('loadedmetadata', this.mainPlaylistLoader_.createMupOnMedia_);
      this.mainPlaylistLoader_.createMupOnMedia_ = null;
    }
    this.stopRequest();
    window.clearTimeout(this.mediaUpdateTimeout);
    this.mediaUpdateTimeout = null;
    if (this.isMain_) {
      window.clearTimeout(this.mainPlaylistLoader_.minimumUpdatePeriodTimeout_);
      this.mainPlaylistLoader_.minimumUpdatePeriodTimeout_ = null;
    }
    if (this.state === 'HAVE_NOTHING') {
      // If we pause the loader before any data has been retrieved, its as if we never
      // started, so reset to an unstarted state.
      this.started = false;
    }
  }

  load(isFinalRendition) {
    this.isPaused_ = false;

    window.clearTimeout(this.mediaUpdateTimeout);
    this.mediaUpdateTimeout = null;

    const media = this.media();

    if (isFinalRendition) {
      const delay = media ? (media.targetDuration / 2) * 1000 : 5 * 1000;

      this.mediaUpdateTimeout = window.setTimeout(() => this.load(), delay);
      return;
    }

    // because the playlists are internal to the manifest, load should either load the
    // main manifest, or do nothing but trigger an event
    if (!this.started) {
      this.start();
      return;
    }

    if (media && !media.endList) {
      // Check to see if this is the main loader and the MUP was cleared (this happens
      // when the loader was paused). `media` should be set at this point since one is always
      // set during `start()`.
      if (this.isMain_ && !this.minimumUpdatePeriodTimeout_) {
        // Trigger minimumUpdatePeriod to refresh the main manifest
        this.trigger('minimumUpdatePeriod');
        // Since there was no prior minimumUpdatePeriodTimeout it should be recreated
        this.updateMinimumUpdatePeriodTimeout_();
      }
      this.trigger('mediaupdatetimeout');
    } else {
      this.trigger('loadedplaylist');
    }
  }

  start() {
    this.started = true;

    // We don't need to request the main manifest again
    // Call this asynchronously to match the xhr request behavior below
    if (!this.isMain_) {
      window.clearTimeout(this.mediaRequest_);
      this.mediaRequest_ = window.setTimeout(() => this.haveMain_(), 0);
      return;
    }

    this.requestMain_((req, mainChanged) => {
      this.haveMain_();

      if (!this.hasPendingRequest() && !this.media_) {
        this.media(this.mainPlaylistLoader_.main.playlists[0]);
      }
    });
  }

  requestMain_(cb) {
    const metadata = {
      manifestInfo: {
        uri: this.mainPlaylistLoader_.srcUrl
      }
    };

    this.trigger({type: 'manifestrequeststart', metadata});
    this.request = this.vhs_.xhr({
      uri: this.mainPlaylistLoader_.srcUrl,
      withCredentials: this.withCredentials,
      requestType: 'dash-manifest'
    }, (error, req) => {
      if (error) {
        const { requestType } = req;

        error.metadata = getStreamingNetworkErrorMetadata({ requestType, request: req, error });
      }

      if (this.requestErrored_(error, req)) {
        if (this.state === 'HAVE_NOTHING') {
          this.started = false;
        }
        return;
      }
      this.trigger({type: 'manifestrequestcomplete', metadata});

      const mainChanged = req.responseText !== this.mainPlaylistLoader_.mainXml_;

      this.mainPlaylistLoader_.mainXml_ = req.responseText;

      if (req.responseHeaders && req.responseHeaders.date) {
        this.mainLoaded_ = Date.parse(req.responseHeaders.date);
      } else {
        this.mainLoaded_ = Date.now();
      }

      this.mainPlaylistLoader_.srcUrl = resolveManifestRedirect(this.mainPlaylistLoader_.srcUrl, req);

      if (mainChanged) {
        this.handleMain_();
        this.syncClientServerClock_(() => {
          return cb(req, mainChanged);
        });
        return;
      }

      return cb(req, mainChanged);
    });

  }

  /**
   * Parses the main xml for UTCTiming node to sync the client clock to the server
   * clock. If the UTCTiming node requires a HEAD or GET request, that request is made.
   *
   * @param {Function} done
   *        Function to call when clock sync has completed
   */
  syncClientServerClock_(done) {
    const utcTiming = parseUTCTiming(this.mainPlaylistLoader_.mainXml_);

    // No UTCTiming element found in the mpd. Use Date header from mpd request as the
    // server clock
    if (utcTiming === null) {
      this.mainPlaylistLoader_.clientOffset_ = this.mainLoaded_ - Date.now();
      return done();
    }

    if (utcTiming.method === 'DIRECT') {
      this.mainPlaylistLoader_.clientOffset_ = utcTiming.value - Date.now();
      return done();
    }

    this.request = this.vhs_.xhr({
      uri: resolveUrl(this.mainPlaylistLoader_.srcUrl, utcTiming.value),
      method: utcTiming.method,
      withCredentials: this.withCredentials,
      requestType: 'dash-clock-sync'
    }, (error, req) => {
      // disposed
      if (!this.request) {
        return;
      }

      if (error) {
        const { requestType } = req;

        this.error.metadata = getStreamingNetworkErrorMetadata({ requestType, request: req, error });
        // sync request failed, fall back to using date header from mpd
        // TODO: log warning
        this.mainPlaylistLoader_.clientOffset_ = this.mainLoaded_ - Date.now();
        return done();
      }

      let serverTime;

      if (utcTiming.method === 'HEAD') {
        if (!req.responseHeaders || !req.responseHeaders.date) {
          // expected date header not preset, fall back to using date header from mpd
          // TODO: log warning
          serverTime = this.mainLoaded_;
        } else {
          serverTime = Date.parse(req.responseHeaders.date);
        }
      } else {
        serverTime = Date.parse(req.responseText);
      }

      this.mainPlaylistLoader_.clientOffset_ = serverTime - Date.now();

      done();
    });
  }

  haveMain_() {
    this.state = 'HAVE_MAIN_MANIFEST';
    if (this.isMain_) {
      // We have the main playlist at this point, so
      // trigger this to allow PlaylistController
      // to make an initial playlist selection
      this.trigger('loadedplaylist');
    } else if (!this.media_) {
      // no media playlist was specifically selected so select
      // the one the child playlist loader was created with
      this.media(this.childPlaylist_);
    }
  }

  handleMain_() {
    // clear media request
    window.clearTimeout(this.mediaRequest_);
    this.mediaRequest_ = null;

    const oldMain = this.mainPlaylistLoader_.main;
    const metadata = {
      manifestInfo: {
        uri: this.mainPlaylistLoader_.srcUrl
      }
    };

    this.trigger({type: 'manifestparsestart', metadata});
    let newMain;

    try {
      newMain = parseMainXml({
        mainXml: this.mainPlaylistLoader_.mainXml_,
        srcUrl: this.mainPlaylistLoader_.srcUrl,
        clientOffset: this.mainPlaylistLoader_.clientOffset_,
        sidxMapping: this.mainPlaylistLoader_.sidxMapping_,
        previousManifest: oldMain
      });
    } catch (error) {
      this.error = error;
      this.error.metadata = {
        errorType: videojs.Error.StreamingDashManifestParserError,
        error
      };
      this.trigger('error');
    }

    // if we have an old main to compare the new main against
    if (oldMain) {
      newMain = updateMain(oldMain, newMain, this.mainPlaylistLoader_.sidxMapping_);
    }

    // only update main if we have a new main
    this.mainPlaylistLoader_.main = newMain ? newMain : oldMain;
    const location = this.mainPlaylistLoader_.main.locations && this.mainPlaylistLoader_.main.locations[0];

    if (location && location !== this.mainPlaylistLoader_.srcUrl) {
      this.mainPlaylistLoader_.srcUrl = location;
    }

    if (!oldMain || (newMain && newMain.minimumUpdatePeriod !== oldMain.minimumUpdatePeriod)) {
      this.updateMinimumUpdatePeriodTimeout_();
    }

    this.addEventStreamToMetadataTrack_(newMain);
    if (newMain) {
      const { duration, endList } = newMain;
      const renditions = [];

      newMain.playlists.forEach((playlist) => {
        renditions.push({
          id: playlist.id,
          bandwidth: playlist.attributes.BANDWIDTH,
          resolution: playlist.attributes.RESOLUTION,
          codecs: playlist.attributes.CODECS
        });
      });
      const parsedManifest = {
        duration,
        isLive: !endList,
        renditions
      };

      metadata.parsedManifest = parsedManifest;
      this.trigger({type: 'manifestparsecomplete', metadata});
    }

    return Boolean(newMain);
  }

  updateMinimumUpdatePeriodTimeout_() {
    const mpl = this.mainPlaylistLoader_;

    // cancel any pending creation of mup on media
    // a new one will be added if needed.
    if (mpl.createMupOnMedia_) {
      mpl.off('loadedmetadata', mpl.createMupOnMedia_);
      mpl.createMupOnMedia_ = null;
    }

    // clear any pending timeouts
    if (mpl.minimumUpdatePeriodTimeout_) {
      window.clearTimeout(mpl.minimumUpdatePeriodTimeout_);
      mpl.minimumUpdatePeriodTimeout_ = null;
    }

    let mup = mpl.main && mpl.main.minimumUpdatePeriod;

    // If the minimumUpdatePeriod has a value of 0, that indicates that the current
    // MPD has no future validity, so a new one will need to be acquired when new
    // media segments are to be made available. Thus, we use the target duration
    // in this case
    if (mup === 0) {
      if (mpl.media()) {
        mup = mpl.media().targetDuration * 1000;
      } else {
        mpl.createMupOnMedia_ = mpl.updateMinimumUpdatePeriodTimeout_;
        mpl.one('loadedmetadata', mpl.createMupOnMedia_);
      }
    }

    // if minimumUpdatePeriod is invalid or <= zero, which
    // can happen when a live video becomes VOD. skip timeout
    // creation.
    if (typeof mup !== 'number' || mup <= 0) {
      if (mup < 0) {
        this.logger_(`found invalid minimumUpdatePeriod of ${mup}, not setting a timeout`);
      }
      return;
    }

    this.createMUPTimeout_(mup);
  }

  createMUPTimeout_(mup) {
    const mpl = this.mainPlaylistLoader_;

    mpl.minimumUpdatePeriodTimeout_ = window.setTimeout(() => {
      mpl.minimumUpdatePeriodTimeout_ = null;
      mpl.trigger('minimumUpdatePeriod');
      mpl.createMUPTimeout_(mup);
    }, mup);
  }

  /**
   * Sends request to refresh the main xml and updates the parsed main manifest
   */
  refreshXml_() {
    this.requestMain_((req, mainChanged) => {
      if (!mainChanged) {
        return;
      }

      if (this.media_) {
        this.media_ = this.mainPlaylistLoader_.main.playlists[this.media_.id];
      }

      // This will filter out updated sidx info from the mapping
      this.mainPlaylistLoader_.sidxMapping_ = filterChangedSidxMappings(
        this.mainPlaylistLoader_.main,
        this.mainPlaylistLoader_.sidxMapping_
      );

      this.addSidxSegments_(this.media(), this.state, (sidxChanged) => {
        // TODO: do we need to reload the current playlist?
        this.refreshMedia_(this.media().id);
      });
    });
  }

  /**
   * Refreshes the media playlist by re-parsing the main xml and updating playlist
   * references. If this is an alternate loader, the updated parsed manifest is retrieved
   * from the main loader.
   */
  refreshMedia_(mediaID) {
    if (!mediaID) {
      throw new Error('refreshMedia_ must take a media id');
    }

    // for main we have to reparse the main xml
    // to re-create segments based on current timing values
    // which may change media. We only skip updating the main manifest
    // if this is the first time this.media_ is being set.
    // as main was just parsed in that case.
    if (this.media_ && this.isMain_) {
      this.handleMain_();
    }

    const playlists = this.mainPlaylistLoader_.main.playlists;
    const mediaChanged = !this.media_ || this.media_ !== playlists[mediaID];

    if (mediaChanged) {
      this.media_ = playlists[mediaID];
    } else {
      this.trigger('playlistunchanged');
    }

    if (!this.mediaUpdateTimeout) {
      const createMediaUpdateTimeout = () => {
        if (this.media().endList) {
          return;
        }

        this.mediaUpdateTimeout = window.setTimeout(() => {
          this.trigger('mediaupdatetimeout');
          createMediaUpdateTimeout();
        }, refreshDelay(this.media(), Boolean(mediaChanged)));
      };

      createMediaUpdateTimeout();
    }

    this.trigger('loadedplaylist');
  }

  /**
   * Takes eventstream data from a parsed DASH manifest and adds it to the metadata text track.
   *
   * @param {manifest} newMain the newly parsed manifest
   */
  addEventStreamToMetadataTrack_(newMain) {
    // Only add new event stream metadata if we have a new manifest.
    if (newMain && this.mainPlaylistLoader_.main.eventStream) {
      // convert EventStream to ID3-like data.
      const metadataArray = this.mainPlaylistLoader_.main.eventStream.map((eventStreamNode) => {
        return {
          cueTime: eventStreamNode.start,
          frames: [{ data: eventStreamNode.messageData }]
        };
      });

      this.addMetadataToTextTrack('EventStream', metadataArray, this.mainPlaylistLoader_.main.duration);
    }
  }

  /**
   * Returns the key ID set from a playlist
   *
   * @param {playlist} playlist to fetch the key ID set from.
   * @return a Set of 32 digit hex strings that represent the unique keyIds for that playlist.
   */
  getKeyIdSet(playlist) {
    if (playlist.contentProtection) {
      const keyIds = new Set();

      for (const keysystem in playlist.contentProtection) {
        const defaultKID = playlist.contentProtection[keysystem].attributes['cenc:default_KID'];

        if (defaultKID) {
          // DASH keyIds are separated by dashes.
          keyIds.add(defaultKID.replace(/-/g, '').toLowerCase());
        }
      }
      return keyIds;
    }
  }
}
