/**
 * @file videojs-http-streaming.js
 *
 * The main file for the HLS project.
 * License: https://github.com/videojs/videojs-http-streaming/blob/master/LICENSE
 */
import document from 'global/document';
import PlaylistLoader from './playlist-loader';
import Playlist from './playlist';
import xhrFactory from './xhr';
import { Decrypter, AsyncStream, decrypt } from 'aes-decrypter';
import * as utils from './bin-utils';
import {
  getProgramTime,
  seekToProgramTime
} from './util/time';
import { timeRangesToArray } from './ranges';
import { MediaSource, URL } from './mse/index';
import videojs from 'video.js';
import { MasterPlaylistController } from './master-playlist-controller';
import Config from './config';
import renditionSelectionMixin from './rendition-mixin';
import PlaybackWatcher from './playback-watcher';
import reloadSourceOnError from './reload-source-on-error';
import {
  lastBandwidthSelector,
  lowestBitrateCompatibleVariantSelector,
  comparePlaylistBandwidth,
  comparePlaylistResolution
} from './playlist-selectors.js';
import { version } from '../package.json';
import { isAudioCodec, isVideoCodec, parseContentType } from './util/codecs';

const Hls = {
  PlaylistLoader,
  Playlist,
  Decrypter,
  AsyncStream,
  decrypt,
  utils,

  STANDARD_PLAYLIST_SELECTOR: lastBandwidthSelector,
  INITIAL_PLAYLIST_SELECTOR: lowestBitrateCompatibleVariantSelector,
  comparePlaylistBandwidth,
  comparePlaylistResolution,

  xhr: xhrFactory()
};

// Define getter/setters for config properites
[
  'GOAL_BUFFER_LENGTH',
  'MAX_GOAL_BUFFER_LENGTH',
  'GOAL_BUFFER_LENGTH_RATE',
  'BUFFER_LOW_WATER_LINE',
  'MAX_BUFFER_LOW_WATER_LINE',
  'BUFFER_LOW_WATER_LINE_RATE',
  'BANDWIDTH_VARIANCE'
].forEach((prop) => {
  Object.defineProperty(Hls, prop, {
    get() {
      videojs.log.warn(`using Hls.${prop} is UNSAFE be sure you know what you are doing`);
      return Config[prop];
    },
    set(value) {
      videojs.log.warn(`using Hls.${prop} is UNSAFE be sure you know what you are doing`);

      if (typeof value !== 'number' || value < 0) {
        videojs.log.warn(`value of Hls.${prop} must be greater than or equal to 0`);
        return;
      }

      Config[prop] = value;
    }
  });
});

export const LOCAL_STORAGE_KEY = 'videojs-vhs';

const simpleTypeFromSourceType = (type) => {
  const mpegurlRE = /^(audio|video|application)\/(x-|vnd\.apple\.)?mpegurl/i;

  if (mpegurlRE.test(type)) {
    return 'hls';
  }

  const dashRE = /^application\/dash\+xml/i;

  if (dashRE.test(type)) {
    return 'dash';
  }

  return null;
};

/**
 * Updates the selectedIndex of the QualityLevelList when a mediachange happens in hls.
 *
 * @param {QualityLevelList} qualityLevels The QualityLevelList to update.
 * @param {PlaylistLoader} playlistLoader PlaylistLoader containing the new media info.
 * @function handleHlsMediaChange
 */
const handleHlsMediaChange = function(qualityLevels, playlistLoader) {
  let newPlaylist = playlistLoader.media();
  let selectedIndex = -1;

  for (let i = 0; i < qualityLevels.length; i++) {
    if (qualityLevels[i].id === newPlaylist.id) {
      selectedIndex = i;
      break;
    }
  }

  qualityLevels.selectedIndex_ = selectedIndex;
  qualityLevels.trigger({
    selectedIndex,
    type: 'change'
  });
};

/**
 * Adds quality levels to list once playlist metadata is available
 *
 * @param {QualityLevelList} qualityLevels The QualityLevelList to attach events to.
 * @param {Object} hls Hls object to listen to for media events.
 * @function handleHlsLoadedMetadata
 */
const handleHlsLoadedMetadata = function(qualityLevels, hls) {
  hls.representations().forEach((rep) => {
    qualityLevels.addQualityLevel(rep);
  });
  handleHlsMediaChange(qualityLevels, hls.playlists);
};

// HLS is a source handler, not a tech. Make sure attempts to use it
// as one do not cause exceptions.
Hls.canPlaySource = function() {
  return videojs.log.warn('HLS is no longer a tech. Please remove it from ' +
    'your player\'s techOrder.');
};

const emeKeySystems = (keySystemOptions, mainSegmentLoader, audioSegmentLoader) => {
  if (!keySystemOptions) {
    return keySystemOptions;
  }

  let videoMimeType;
  let audioMimeType;

  // if there is a mimeType associated with the audioSegmentLoader, then the audio
  // and video mimeType and codec strings are already in the format we need to
  // pass with the other key systems
  if (audioSegmentLoader.mimeType_) {
    videoMimeType = mainSegmentLoader.mimeType_;
    audioMimeType = audioSegmentLoader.mimeType_;

  // if there is no audioSegmentLoader mimeType, then we have to create the
  // the audio and video mimeType/codec strings from information extrapolated
  // from the mainSegmentLoader mimeType (ex. 'video/mp4; codecs="mp4, avc1"' -->
  // 'video/mp4; codecs="avc1"' and 'audio/mp4; codecs="mp4"')
  } else {
    const parsedMimeType = parseContentType(mainSegmentLoader.mimeType_);
    const codecs = parsedMimeType.parameters.codecs.split(',');

    let audioCodec;
    let videoCodec;

    codecs.forEach(codec => {
      codec = codec.trim();

      if (isAudioCodec(codec)) {
        audioCodec = codec;
      } else if (isVideoCodec(codec)) {
        videoCodec = codec;
      }
    });

    videoMimeType = `${parsedMimeType.type}; codecs="${videoCodec}"`;
    audioMimeType = `${parsedMimeType.type.replace('video', 'audio')}; codecs="${audioCodec}"`;
  }

  // upsert the content types based on the selected playlist
  const keySystemContentTypes = {};
  const videoPlaylist = mainSegmentLoader.playlist_;

  for (let keySystem in keySystemOptions) {
    keySystemContentTypes[keySystem] = {
      audioContentType: audioMimeType,
      videoContentType: videoMimeType
    };

    if (videoPlaylist.contentProtection &&
        videoPlaylist.contentProtection[keySystem] &&
        videoPlaylist.contentProtection[keySystem].pssh) {
      keySystemContentTypes[keySystem].pssh =
        videoPlaylist.contentProtection[keySystem].pssh;
    }

    // videojs-contrib-eme accepts the option of specifying: 'com.some.cdm': 'url'
    // so we need to prevent overwriting the URL entirely
    if (typeof keySystemOptions[keySystem] === 'string') {
      keySystemContentTypes[keySystem].url = keySystemOptions[keySystem];
    }
  }

  return videojs.mergeOptions(keySystemOptions, keySystemContentTypes);
};

const setupEmeOptions = (hlsHandler) => {
  const mainSegmentLoader = hlsHandler.masterPlaylistController_.mainSegmentLoader_;
  const audioSegmentLoader = hlsHandler.masterPlaylistController_.audioSegmentLoader_;

  const player = videojs.players[hlsHandler.tech_.options_.playerId];

  if (player.eme) {
    const sourceOptions = emeKeySystems(
      hlsHandler.source_.keySystems,
      mainSegmentLoader,
      audioSegmentLoader
    );

    if (sourceOptions) {
      player.currentSource().keySystems = sourceOptions;

      // Works around https://bugs.chromium.org/p/chromium/issues/detail?id=895449
      // in non-IE11 browsers. In IE11 this is too early to initialize media keys
      if (!(videojs.browser.IE_VERSION === 11) && player.eme.initializeMediaKeys) {
        player.eme.initializeMediaKeys();
      }
    }
  }
};

const getVhsLocalStorage = () => {
  if (!window.localStorage) {
    return null;
  }

  const storedObject = window.localStorage.getItem(LOCAL_STORAGE_KEY);

  if (!storedObject) {
    return null;
  }

  try {
    return JSON.parse(storedObject);
  } catch (e) {
    // someone may have tampered with the value
    return null;
  }
};

const updateVhsLocalStorage = (options) => {
  if (!window.localStorage) {
    return false;
  }

  let objectToStore = getVhsLocalStorage();

  objectToStore = objectToStore ? videojs.mergeOptions(objectToStore, options) : options;

  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(objectToStore));
  } catch (e) {
    // Throws if storage is full (e.g., always on iOS 5+ Safari private mode, where
    // storage is set to 0).
    // https://developer.mozilla.org/en-US/docs/Web/API/Storage/setItem#Exceptions
    // No need to perform any operation.
    return false;
  }

  return objectToStore;
};

/**
 * Whether the browser has built-in HLS support.
 */
Hls.supportsNativeHls = (function() {
  let video = document.createElement('video');

  // native HLS is definitely not supported if HTML5 video isn't
  if (!videojs.getTech('Html5').isSupported()) {
    return false;
  }

  // HLS manifests can go by many mime-types
  let canPlay = [
    // Apple santioned
    'application/vnd.apple.mpegurl',
    // Apple sanctioned for backwards compatibility
    'audio/mpegurl',
    // Very common
    'audio/x-mpegurl',
    // Very common
    'application/x-mpegurl',
    // Included for completeness
    'video/x-mpegurl',
    'video/mpegurl',
    'application/mpegurl'
  ];

  return canPlay.some(function(canItPlay) {
    return (/maybe|probably/i).test(video.canPlayType(canItPlay));
  });
}());

Hls.supportsNativeDash = (function() {
  if (!videojs.getTech('Html5').isSupported()) {
    return false;
  }

  return (/maybe|probably/i).test(
    document.createElement('video').canPlayType('application/dash+xml'));
}());

Hls.supportsTypeNatively = (type) => {
  if (type === 'hls') {
    return Hls.supportsNativeHls;
  }

  if (type === 'dash') {
    return Hls.supportsNativeDash;
  }

  return false;
};

/**
 * HLS is a source handler, not a tech. Make sure attempts to use it
 * as one do not cause exceptions.
 */
Hls.isSupported = function() {
  return videojs.log.warn('HLS is no longer a tech. Please remove it from ' +
    'your player\'s techOrder.');
};

const Component = videojs.getComponent('Component');

/**
 * The Hls Handler object, where we orchestrate all of the parts
 * of HLS to interact with video.js
 *
 * @class HlsHandler
 * @extends videojs.Component
 * @param {Object} source the soruce object
 * @param {Tech} tech the parent tech object
 * @param {Object} options optional and required options
 */
class HlsHandler extends Component {
  constructor(source, tech, options) {
    super(tech, options.hls);

    // tech.player() is deprecated but setup a reference to HLS for
    // backwards-compatibility
    if (tech.options_ && tech.options_.playerId) {
      let _player = videojs(tech.options_.playerId);

      if (!_player.hasOwnProperty('hls')) {
        Object.defineProperty(_player, 'hls', {
          get: () => {
            videojs.log.warn('player.hls is deprecated. Use player.tech().hls instead.');
            tech.trigger({ type: 'usage', name: 'hls-player-access' });
            return this;
          },
          configurable: true
        });
      }

      // Set up a reference to the HlsHandler from player.vhs. This allows users to start
      // migrating from player.tech_.hls... to player.vhs... for API access. Although this
      // isn't the most appropriate form of reference for video.js (since all APIs should
      // be provided through core video.js), it is a common pattern for plugins, and vhs
      // will act accordingly.
      _player.vhs = this;
      // deprecated, for backwards compatibility
      _player.dash = this;

      this.player_ = _player;
    }

    this.tech_ = tech;
    this.source_ = source;
    this.stats = {};
    this.ignoreNextSeekingEvent_ = false;
    this.setOptions_();

    if (this.options_.overrideNative &&
      tech.overrideNativeAudioTracks &&
      tech.overrideNativeVideoTracks) {
      tech.overrideNativeAudioTracks(true);
      tech.overrideNativeVideoTracks(true);
    } else if (this.options_.overrideNative &&
      (tech.featuresNativeVideoTracks || tech.featuresNativeAudioTracks)) {
      // overriding native HLS only works if audio tracks have been emulated
      // error early if we're misconfigured
      throw new Error('Overriding native HLS requires emulated tracks. ' +
        'See https://git.io/vMpjB');
    }

    // listen for fullscreenchange events for this player so that we
    // can adjust our quality selection quickly
    this.on(document, [
      'fullscreenchange', 'webkitfullscreenchange',
      'mozfullscreenchange', 'MSFullscreenChange'
    ], (event) => {
      let fullscreenElement = document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement;

      if (fullscreenElement && fullscreenElement.contains(this.tech_.el())) {
        this.masterPlaylistController_.smoothQualityChange_();
      }
    });

    this.on(this.tech_, 'seeking', function() {
      if (this.ignoreNextSeekingEvent_) {
        this.ignoreNextSeekingEvent_ = false;
        return;
      }

      this.setCurrentTime(this.tech_.currentTime());
    });

    this.on(this.tech_, 'error', function() {
      if (this.masterPlaylistController_) {
        this.masterPlaylistController_.pauseLoading();
      }
    });

    this.on(this.tech_, 'play', this.play);
  }

  setOptions_() {
    // defaults
    this.options_.withCredentials = this.options_.withCredentials || false;
    this.options_.handleManifestRedirects = this.options_.handleManifestRedirects || false;
    this.options_.limitRenditionByPlayerDimensions = this.options_.limitRenditionByPlayerDimensions === false ? false : true;
    this.options_.useDevicePixelRatio = this.options_.useDevicePixelRatio || false;
    this.options_.smoothQualityChange = this.options_.smoothQualityChange || false;
    this.options_.useBandwidthFromLocalStorage =
      typeof this.source_.useBandwidthFromLocalStorage !== 'undefined' ?
        this.source_.useBandwidthFromLocalStorage :
        this.options_.useBandwidthFromLocalStorage || false;
    this.options_.customTagParsers = this.options_.customTagParsers || [];
    this.options_.customTagMappers = this.options_.customTagMappers || [];
    this.options_.cacheEncryptionKeys = this.options_.cacheEncryptionKeys || false;

    if (typeof this.options_.blacklistDuration !== 'number') {
      this.options_.blacklistDuration = 5 * 60;
    }

    if (typeof this.options_.bandwidth !== 'number') {
      if (this.options_.useBandwidthFromLocalStorage) {
        const storedObject = getVhsLocalStorage();

        if (storedObject && storedObject.bandwidth) {
          this.options_.bandwidth = storedObject.bandwidth;
          this.tech_.trigger({type: 'usage', name: 'hls-bandwidth-from-local-storage'});
        }
        if (storedObject && storedObject.throughput) {
          this.options_.throughput = storedObject.throughput;
          this.tech_.trigger({type: 'usage', name: 'hls-throughput-from-local-storage'});
        }
      }
    }
     // if bandwidth was not set by options or pulled from local storage, start playlist
    // selection at a reasonable bandwidth
    if (typeof this.options_.bandwidth !== 'number') {
      this.options_.bandwidth = Config.INITIAL_BANDWIDTH;
    }

    // If the bandwidth number is unchanged from the initial setting
    // then this takes precedence over the enableLowInitialPlaylist option
    this.options_.enableLowInitialPlaylist =
      this.options_.enableLowInitialPlaylist &&
      this.options_.bandwidth === Config.INITIAL_BANDWIDTH;

    // grab options passed to player.src
    [
      'withCredentials',
      'useDevicePixelRatio',
      'limitRenditionByPlayerDimensions',
      'bandwidth',
      'smoothQualityChange',
      'customTagParsers',
      'customTagMappers',
      'handleManifestRedirects',
      'cacheEncryptionKeys'
    ].forEach((option) => {
      if (typeof this.source_[option] !== 'undefined') {
        this.options_[option] = this.source_[option];
      }
    });

    this.limitRenditionByPlayerDimensions = this.options_.limitRenditionByPlayerDimensions;
    this.useDevicePixelRatio = this.options_.useDevicePixelRatio;
  }
  /**
   * called when player.src gets called, handle a new source
   *
   * @param {Object} src the source object to handle
   */
  src(src, type) {
    // do nothing if the src is falsey
    if (!src) {
      return;
    }
    this.setOptions_();
    // add master playlist controller options
    this.options_.url = this.source_.src;
    this.options_.tech = this.tech_;
    this.options_.externHls = Hls;
    this.options_.sourceType = simpleTypeFromSourceType(type);
    // Whenever we seek internally, we should update the tech
    this.options_.seekTo = (time) => {
      this.tech_.setCurrentTime(time);
    };

    this.masterPlaylistController_ = new MasterPlaylistController(this.options_);
    this.playbackWatcher_ = new PlaybackWatcher(
      videojs.mergeOptions(this.options_, {
        seekable: () => this.seekable(),
        media: () => this.masterPlaylistController_.media()
      }));

    this.masterPlaylistController_.on('error', () => {
      let player = videojs.players[this.tech_.options_.playerId];

      player.error(this.masterPlaylistController_.error);
    });

    // `this` in selectPlaylist should be the HlsHandler for backwards
    // compatibility with < v2
    this.masterPlaylistController_.selectPlaylist =
      this.selectPlaylist ?
        this.selectPlaylist.bind(this) : Hls.STANDARD_PLAYLIST_SELECTOR.bind(this);

    this.masterPlaylistController_.selectInitialPlaylist =
      Hls.INITIAL_PLAYLIST_SELECTOR.bind(this);

    // re-expose some internal objects for backwards compatibility with < v2
    this.playlists = this.masterPlaylistController_.masterPlaylistLoader_;
    this.mediaSource = this.masterPlaylistController_.mediaSource;

    // Proxy assignment of some properties to the master playlist
    // controller. Using a custom property for backwards compatibility
    // with < v2
    Object.defineProperties(this, {
      selectPlaylist: {
        get() {
          return this.masterPlaylistController_.selectPlaylist;
        },
        set(selectPlaylist) {
          this.masterPlaylistController_.selectPlaylist = selectPlaylist.bind(this);
        }
      },
      throughput: {
        get() {
          return this.masterPlaylistController_.mainSegmentLoader_.throughput.rate;
        },
        set(throughput) {
          this.masterPlaylistController_.mainSegmentLoader_.throughput.rate = throughput;
          // By setting `count` to 1 the throughput value becomes the starting value
          // for the cumulative average
          this.masterPlaylistController_.mainSegmentLoader_.throughput.count = 1;
        }
      },
      bandwidth: {
        get() {
          return this.masterPlaylistController_.mainSegmentLoader_.bandwidth;
        },
        set(bandwidth) {
          this.masterPlaylistController_.mainSegmentLoader_.bandwidth = bandwidth;
          // setting the bandwidth manually resets the throughput counter
          // `count` is set to zero that current value of `rate` isn't included
          // in the cumulative average
          this.masterPlaylistController_.mainSegmentLoader_.throughput = {
            rate: 0,
            count: 0
          };
        }
      },
      /**
       * `systemBandwidth` is a combination of two serial processes bit-rates. The first
       * is the network bitrate provided by `bandwidth` and the second is the bitrate of
       * the entire process after that - decryption, transmuxing, and appending - provided
       * by `throughput`.
       *
       * Since the two process are serial, the overall system bandwidth is given by:
       *   sysBandwidth = 1 / (1 / bandwidth + 1 / throughput)
       */
      systemBandwidth: {
        get() {
          let invBandwidth = 1 / (this.bandwidth || 1);
          let invThroughput;

          if (this.throughput > 0) {
            invThroughput = 1 / this.throughput;
          } else {
            invThroughput = 0;
          }

          let systemBitrate = Math.floor(1 / (invBandwidth + invThroughput));

          return systemBitrate;
        },
        set() {
          videojs.log.error('The "systemBandwidth" property is read-only');
        }
      }
    });

    if (this.options_.bandwidth) {
      this.bandwidth = this.options_.bandwidth;
    }
    if (this.options_.throughput) {
      this.throughput = this.options_.throughput;
    }

    Object.defineProperties(this.stats, {
      bandwidth: {
        get: () => this.bandwidth || 0,
        enumerable: true
      },
      mediaRequests: {
        get: () => this.masterPlaylistController_.mediaRequests_() || 0,
        enumerable: true
      },
      mediaRequestsAborted: {
        get: () => this.masterPlaylistController_.mediaRequestsAborted_() || 0,
        enumerable: true
      },
      mediaRequestsTimedout: {
        get: () => this.masterPlaylistController_.mediaRequestsTimedout_() || 0,
        enumerable: true
      },
      mediaRequestsErrored: {
        get: () => this.masterPlaylistController_.mediaRequestsErrored_() || 0,
        enumerable: true
      },
      mediaTransferDuration: {
        get: () => this.masterPlaylistController_.mediaTransferDuration_() || 0,
        enumerable: true
      },
      mediaBytesTransferred: {
        get: () => this.masterPlaylistController_.mediaBytesTransferred_() || 0,
        enumerable: true
      },
      mediaSecondsLoaded: {
        get: () => this.masterPlaylistController_.mediaSecondsLoaded_() || 0,
        enumerable: true
      },
      buffered: {
        get: () => timeRangesToArray(this.tech_.buffered()),
        enumerable: true
      },
      currentTime: {
        get: () => this.tech_.currentTime(),
        enumerable: true
      },
      currentSource: {
        get: () => this.tech_.currentSource_,
        enumerable: true
      },
      currentTech: {
        get: () => this.tech_.name_,
        enumerable: true
      },
      duration: {
        get: () => this.tech_.duration(),
        enumerable: true
      },
      master: {
        get: () => this.playlists.master,
        enumerable: true
      },
      playerDimensions: {
        get: () => this.tech_.currentDimensions(),
        enumerable: true
      },
      seekable: {
        get: () => timeRangesToArray(this.tech_.seekable()),
        enumerable: true
      },
      timestamp: {
        get: () => Date.now(),
        enumerable: true
      },
      videoPlaybackQuality: {
        get: () => this.tech_.getVideoPlaybackQuality(),
        enumerable: true
      }
    });

    this.tech_.one('canplay',
      this.masterPlaylistController_.setupFirstPlay.bind(this.masterPlaylistController_));

    this.tech_.on('bandwidthupdate', () => {
      if (this.options_.useBandwidthFromLocalStorage) {
        updateVhsLocalStorage({
          bandwidth: this.bandwidth,
          throughput: Math.round(this.throughput)
        });
      }
    });

    this.masterPlaylistController_.on('selectedinitialmedia', () => {
      // Add the manual rendition mix-in to HlsHandler
      renditionSelectionMixin(this);
      setupEmeOptions(this);
    });

    // the bandwidth of the primary segment loader is our best
    // estimate of overall bandwidth
    this.on(this.masterPlaylistController_, 'progress', function() {
      this.tech_.trigger('progress');
    });

    // In the live case, we need to ignore the very first `seeking` event since
    // that will be the result of the seek-to-live behavior
    this.on(this.masterPlaylistController_, 'firstplay', function() {
      this.ignoreNextSeekingEvent_ = true;
    });

    this.setupQualityLevels_();

    // do nothing if the tech has been disposed already
    // this can occur if someone sets the src in player.ready(), for instance
    if (!this.tech_.el()) {
      return;
    }

    this.tech_.src(videojs.URL.createObjectURL(
      this.masterPlaylistController_.mediaSource));
  }

  /**
   * Initializes the quality levels and sets listeners to update them.
   *
   * @method setupQualityLevels_
   * @private
   */
  setupQualityLevels_() {
    let player = videojs.players[this.tech_.options_.playerId];

    // if there isn't a player or there isn't a qualityLevels plugin
    // or qualityLevels_ listeners have already been setup, do nothing.
    if (!player || !player.qualityLevels || this.qualityLevels_) {
      return;
    }

    this.qualityLevels_ = player.qualityLevels();

    this.masterPlaylistController_.on('selectedinitialmedia', () => {
      handleHlsLoadedMetadata(this.qualityLevels_, this);
    });

    this.playlists.on('mediachange', () => {
      handleHlsMediaChange(this.qualityLevels_, this.playlists);
    });
  }

  /**
   * Begin playing the video.
   */
  play() {
    this.masterPlaylistController_.play();
  }

  /**
   * a wrapper around the function in MasterPlaylistController
   */
  setCurrentTime(currentTime) {
    this.masterPlaylistController_.setCurrentTime(currentTime);
  }

  /**
   * a wrapper around the function in MasterPlaylistController
   */
  duration() {
    return this.masterPlaylistController_.duration();
  }

  /**
   * a wrapper around the function in MasterPlaylistController
   */
  seekable() {
    return this.masterPlaylistController_.seekable();
  }

  /**
   * Abort all outstanding work and cleanup.
   */
  dispose() {
    if (this.playbackWatcher_) {
      this.playbackWatcher_.dispose();
    }
    if (this.masterPlaylistController_) {
      this.masterPlaylistController_.dispose();
    }
    if (this.qualityLevels_) {
      this.qualityLevels_.dispose();
    }

    if (this.player_) {
      delete this.player_.vhs;
      delete this.player_.dash;
      delete this.player_.hls;
    }

    if (this.tech_ && this.tech_.hls) {
      delete this.tech_.hls;
    }

    super.dispose();
  }

  convertToProgramTime(time, callback) {
    return getProgramTime({
      playlist: this.masterPlaylistController_.media(),
      time,
      callback
    });
  }

  // the player must be playing before calling this
  seekToProgramTime(programTime, callback, pauseAfterSeek = true, retryCount = 2) {
    return seekToProgramTime({
      programTime,
      playlist: this.masterPlaylistController_.media(),
      retryCount,
      pauseAfterSeek,
      seekTo: this.options_.seekTo,
      tech: this.options_.tech,
      callback
    });
  }
}

/**
 * The Source Handler object, which informs video.js what additional
 * MIME types are supported and sets up playback. It is registered
 * automatically to the appropriate tech based on the capabilities of
 * the browser it is running in. It is not necessary to use or modify
 * this object in normal usage.
 */
const HlsSourceHandler = {
  name: 'videojs-http-streaming',
  VERSION: version,
  canHandleSource(srcObj, options = {}) {
    let localOptions = videojs.mergeOptions(videojs.options, options);

    return HlsSourceHandler.canPlayType(srcObj.type, localOptions);
  },
  handleSource(source, tech, options = {}) {
    let localOptions = videojs.mergeOptions(videojs.options, options);

    tech.hls = new HlsHandler(source, tech, localOptions);
    tech.hls.xhr = xhrFactory();

    tech.hls.src(source.src, source.type);
    return tech.hls;
  },
  canPlayType(type, options = {}) {
    const { hls: { overrideNative } } = videojs.mergeOptions(videojs.options, options);
    const supportedType = simpleTypeFromSourceType(type);
    const canUseMsePlayback = supportedType &&
      (!Hls.supportsTypeNatively(supportedType) || overrideNative);

    return canUseMsePlayback ? 'maybe' : '';
  }
};

if (typeof videojs.MediaSource === 'undefined' ||
    typeof videojs.URL === 'undefined') {
  videojs.MediaSource = MediaSource;
  videojs.URL = URL;
}

// register source handlers with the appropriate techs
if (MediaSource.supportsNativeMediaSources()) {
  videojs.getTech('Html5').registerSourceHandler(HlsSourceHandler, 0);
}

videojs.HlsHandler = HlsHandler;
videojs.HlsSourceHandler = HlsSourceHandler;
videojs.Hls = Hls;
if (!videojs.use) {
  videojs.registerComponent('Hls', Hls);
}
videojs.options.hls = videojs.options.hls || {};

if (videojs.registerPlugin) {
  videojs.registerPlugin('reloadSourceOnError', reloadSourceOnError);
} else {
  videojs.plugin('reloadSourceOnError', reloadSourceOnError);
}

export {
  Hls,
  HlsHandler,
  HlsSourceHandler,
  emeKeySystems,
  simpleTypeFromSourceType
};
