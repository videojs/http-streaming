/**
 * @file playlist-controller.js
 */
import window from 'global/window';
import PlaylistLoader from './playlist-loader';
import DashPlaylistLoader from './dash-playlist-loader';
import { isEnabled, isLowestEnabledRendition } from './playlist.js';
import SegmentLoader from './segment-loader';
import SourceUpdater from './source-updater';
import VTTSegmentLoader from './vtt-segment-loader';
import * as Ranges from './ranges';
import videojs from 'video.js';
import { updateAdCues } from './ad-cue-tags';
import SyncController from './sync-controller';
import TimelineChangeController from './timeline-change-controller';
import Decrypter from 'worker!./decrypter-worker.js';
import Config from './config';
import {
  parseCodecs,
  browserSupportsCodec,
  muxerSupportsCodec,
  DEFAULT_AUDIO_CODEC,
  DEFAULT_VIDEO_CODEC
} from '@videojs/vhs-utils/es/codecs.js';
import { codecsForPlaylist, unwrapCodecList, codecCount } from './util/codecs.js';
import { createMediaTypes, setupMediaGroups } from './media-groups';
import logger from './util/logger';
import {merge, createTimeRanges} from './util/vjs-compat';
import { addMetadata, createMetadataTrackIfNotExists, addDateRangeMetadata } from './util/text-tracks';
import ContentSteeringController from './content-steering-controller';
import { bufferToHexString } from './util/string.js';
import {debounce} from './util/fn';

const ABORT_EARLY_EXCLUSION_SECONDS = 10;

let Vhs;

// SegmentLoader stats that need to have each loader's
// values summed to calculate the final value
const loaderStats = [
  'mediaRequests',
  'mediaRequestsAborted',
  'mediaRequestsTimedout',
  'mediaRequestsErrored',
  'mediaTransferDuration',
  'mediaBytesTransferred',
  'mediaAppends'
];
const sumLoaderStat = function(stat) {
  return this.audioSegmentLoader_[stat] +
         this.mainSegmentLoader_[stat];
};
const shouldSwitchToMedia = function({
  currentPlaylist,
  buffered,
  currentTime,
  nextPlaylist,
  bufferLowWaterLine,
  bufferHighWaterLine,
  duration,
  bufferBasedABR,
  log
}) {
  // we have no other playlist to switch to
  if (!nextPlaylist) {
    videojs.log.warn('We received no playlist to switch to. Please check your stream.');
    return false;
  }

  const sharedLogLine = `allowing switch ${currentPlaylist && currentPlaylist.id || 'null'} -> ${nextPlaylist.id}`;

  if (!currentPlaylist) {
    log(`${sharedLogLine} as current playlist is not set`);
    return true;
  }

  // no need to switch if playlist is the same
  if (nextPlaylist.id === currentPlaylist.id) {
    return false;
  }

  // determine if current time is in a buffered range.
  const isBuffered = Boolean(Ranges.findRange(buffered, currentTime).length);

  // If the playlist is live, then we want to not take low water line into account.
  // This is because in LIVE, the player plays 3 segments from the end of the
  // playlist, and if `BUFFER_LOW_WATER_LINE` is greater than the duration availble
  // in those segments, a viewer will never experience a rendition upswitch.
  if (!currentPlaylist.endList) {
    // For LLHLS live streams, don't switch renditions before playback has started, as it almost
    // doubles the time to first playback.
    if (!isBuffered && typeof currentPlaylist.partTargetDuration === 'number') {
      log(`not ${sharedLogLine} as current playlist is live llhls, but currentTime isn't in buffered.`);
      return false;
    }
    log(`${sharedLogLine} as current playlist is live`);
    return true;
  }

  const forwardBuffer = Ranges.timeAheadOf(buffered, currentTime);
  const maxBufferLowWaterLine = bufferBasedABR ?
    Config.EXPERIMENTAL_MAX_BUFFER_LOW_WATER_LINE : Config.MAX_BUFFER_LOW_WATER_LINE;

  // For the same reason as LIVE, we ignore the low water line when the VOD
  // duration is below the max potential low water line
  if (duration < maxBufferLowWaterLine) {
    log(`${sharedLogLine} as duration < max low water line (${duration} < ${maxBufferLowWaterLine})`);
    return true;
  }

  const nextBandwidth = nextPlaylist.attributes.BANDWIDTH;
  const currBandwidth = currentPlaylist.attributes.BANDWIDTH;

  // when switching down, if our buffer is lower than the high water line,
  // we can switch down
  if (nextBandwidth < currBandwidth && (!bufferBasedABR || forwardBuffer < bufferHighWaterLine)) {
    let logLine = `${sharedLogLine} as next bandwidth < current bandwidth (${nextBandwidth} < ${currBandwidth})`;

    if (bufferBasedABR) {
      logLine += ` and forwardBuffer < bufferHighWaterLine (${forwardBuffer} < ${bufferHighWaterLine})`;
    }
    log(logLine);
    return true;
  }

  // and if our buffer is higher than the low water line,
  // we can switch up
  if ((!bufferBasedABR || nextBandwidth > currBandwidth) && forwardBuffer >= bufferLowWaterLine) {
    let logLine = `${sharedLogLine} as forwardBuffer >= bufferLowWaterLine (${forwardBuffer} >= ${bufferLowWaterLine})`;

    if (bufferBasedABR) {
      logLine += ` and next bandwidth > current bandwidth (${nextBandwidth} > ${currBandwidth})`;
    }
    log(logLine);
    return true;
  }

  log(`not ${sharedLogLine} as no switching criteria met`);

  return false;
};

/**
 * the main playlist controller controller all interactons
 * between playlists and segmentloaders. At this time this mainly
 * involves a main playlist and a series of audio playlists
 * if they are available
 *
 * @class PlaylistController
 * @extends videojs.EventTarget
 */
export class PlaylistController extends videojs.EventTarget {
  constructor(options) {
    super();

    // Adding a slight debounce to avoid duplicate calls during rapid quality changes, for example:
    // When selecting quality from the quality list,
    // where we may have multiple bandwidth profiles for the same vertical resolution.
    this.fastQualityChange_ = debounce(this.fastQualityChange_.bind(this), 100);

    const {
      src,
      withCredentials,
      tech,
      bandwidth,
      externVhs,
      useCueTags,
      playlistExclusionDuration,
      enableLowInitialPlaylist,
      sourceType,
      cacheEncryptionKeys,
      bufferBasedABR,
      leastPixelDiffSelector,
      captionServices,
      experimentalUseMMS
    } = options;

    if (!src) {
      throw new Error('A non-empty playlist URL or JSON manifest string is required');
    }

    let { maxPlaylistRetries } = options;

    if (maxPlaylistRetries === null || typeof maxPlaylistRetries === 'undefined') {
      maxPlaylistRetries = Infinity;
    }

    Vhs = externVhs;

    this.bufferBasedABR = Boolean(bufferBasedABR);
    this.leastPixelDiffSelector = Boolean(leastPixelDiffSelector);
    this.withCredentials = withCredentials;
    this.tech_ = tech;
    this.vhs_ = tech.vhs;
    this.player_ = options.player_;
    this.sourceType_ = sourceType;
    this.useCueTags_ = useCueTags;
    this.playlistExclusionDuration = playlistExclusionDuration;
    this.maxPlaylistRetries = maxPlaylistRetries;
    this.enableLowInitialPlaylist = enableLowInitialPlaylist;
    this.usingManagedMediaSource_ = false;

    if (this.useCueTags_) {
      this.cueTagsTrack_ = this.tech_.addTextTrack(
        'metadata',
        'ad-cues'
      );
      this.cueTagsTrack_.inBandMetadataTrackDispatchType = '';
    }

    this.requestOptions_ = {
      withCredentials,
      maxPlaylistRetries,
      timeout: null
    };

    this.on('error', this.pauseLoading);

    this.mediaTypes_ = createMediaTypes();

    if (experimentalUseMMS && window.ManagedMediaSource) {
      // Airplay source not yet implemented. Remote playback must be disabled.
      this.tech_.el_.disableRemotePlayback = true;
      this.mediaSource = new window.ManagedMediaSource();
      this.usingManagedMediaSource_ = true;

      videojs.log('Using ManagedMediaSource');
    } else if (window.MediaSource) {
      this.mediaSource = new window.MediaSource();
    }

    this.handleDurationChange_ = this.handleDurationChange_.bind(this);
    this.handleSourceOpen_ = this.handleSourceOpen_.bind(this);
    this.handleSourceEnded_ = this.handleSourceEnded_.bind(this);
    this.load = this.load.bind(this);
    this.pause = this.pause.bind(this);

    this.mediaSource.addEventListener('durationchange', this.handleDurationChange_);

    // load the media source into the player
    this.mediaSource.addEventListener('sourceopen', this.handleSourceOpen_);
    this.mediaSource.addEventListener('sourceended', this.handleSourceEnded_);
    this.mediaSource.addEventListener('startstreaming', this.load);
    this.mediaSource.addEventListener('endstreaming', this.pause);
    // we don't have to handle sourceclose since dispose will handle termination of
    // everything, and the MediaSource should not be detached without a proper disposal

    this.seekable_ = createTimeRanges();
    this.hasPlayed_ = false;

    this.syncController_ = new SyncController(options);
    this.segmentMetadataTrack_ = tech.addRemoteTextTrack({
      kind: 'metadata',
      label: 'segment-metadata'
    }, false).track;

    this.segmentMetadataTrack_.mode = 'hidden';

    this.decrypter_ = new Decrypter();
    this.sourceUpdater_ = new SourceUpdater(this.mediaSource);
    this.inbandTextTracks_ = {};
    this.timelineChangeController_ = new TimelineChangeController();
    this.keyStatusMap_ = new Map();

    const segmentLoaderSettings = {
      vhs: this.vhs_,
      parse708captions: options.parse708captions,
      useDtsForTimestampOffset: options.useDtsForTimestampOffset,
      captionServices,
      mediaSource: this.mediaSource,
      currentTime: this.tech_.currentTime.bind(this.tech_),
      seekable: () => this.seekable(),
      seeking: () => this.tech_.seeking(),
      duration: () => this.duration(),
      hasPlayed: () => this.hasPlayed_,
      goalBufferLength: () => this.goalBufferLength(),
      bandwidth,
      syncController: this.syncController_,
      decrypter: this.decrypter_,
      sourceType: this.sourceType_,
      inbandTextTracks: this.inbandTextTracks_,
      cacheEncryptionKeys,
      sourceUpdater: this.sourceUpdater_,
      timelineChangeController: this.timelineChangeController_,
      exactManifestTimings: options.exactManifestTimings,
      addMetadataToTextTrack: this.addMetadataToTextTrack.bind(this)
    };

    // The source type check not only determines whether a special DASH playlist loader
    // should be used, but also covers the case where the provided src is a vhs-json
    // manifest object (instead of a URL). In the case of vhs-json, the default
    // PlaylistLoader should be used.
    this.mainPlaylistLoader_ = this.sourceType_ === 'dash' ?
      new DashPlaylistLoader(src, this.vhs_, merge(this.requestOptions_, { addMetadataToTextTrack: this.addMetadataToTextTrack.bind(this) })) :
      new PlaylistLoader(src, this.vhs_, merge(this.requestOptions_, { addDateRangesToTextTrack: this.addDateRangesToTextTrack_.bind(this) }));
    this.setupMainPlaylistLoaderListeners_();

    // setup segment loaders
    // combined audio/video or just video when alternate audio track is selected
    this.mainSegmentLoader_ =
      new SegmentLoader(merge(segmentLoaderSettings, {
        segmentMetadataTrack: this.segmentMetadataTrack_,
        loaderType: 'main'
      }), options);

    // alternate audio track
    this.audioSegmentLoader_ =
      new SegmentLoader(merge(segmentLoaderSettings, {
        loaderType: 'audio'
      }), options);

    this.subtitleSegmentLoader_ =
      new VTTSegmentLoader(merge(segmentLoaderSettings, {
        loaderType: 'vtt',
        featuresNativeTextTracks: this.tech_.featuresNativeTextTracks,
        loadVttJs: () => new Promise((resolve, reject) => {
          function onLoad() {
            tech.off('vttjserror', onError);
            resolve();
          }

          function onError() {
            tech.off('vttjsloaded', onLoad);
            reject();
          }

          tech.one('vttjsloaded', onLoad);
          tech.one('vttjserror', onError);

          // safe to call multiple times, script will be loaded only once:
          tech.addWebVttScript_();
        })
      }), options);

    const getBandwidth = () => {
      return this.mainSegmentLoader_.bandwidth;
    };

    this.contentSteeringController_ = new ContentSteeringController(this.vhs_.xhr, getBandwidth);
    this.setupSegmentLoaderListeners_();

    if (this.bufferBasedABR) {
      this.mainPlaylistLoader_.one('loadedplaylist', () => this.startABRTimer_());
      this.tech_.on('pause', () => this.stopABRTimer_());
      this.tech_.on('play', () => this.startABRTimer_());
    }

    // Create SegmentLoader stat-getters
    // mediaRequests_
    // mediaRequestsAborted_
    // mediaRequestsTimedout_
    // mediaRequestsErrored_
    // mediaTransferDuration_
    // mediaBytesTransferred_
    // mediaAppends_
    loaderStats.forEach((stat) => {
      this[stat + '_'] = sumLoaderStat.bind(this, stat);
    });

    this.logger_ = logger('pc');

    this.triggeredFmp4Usage = false;
    if (this.tech_.preload() === 'none') {
      this.loadOnPlay_ = () => {
        this.loadOnPlay_ = null;
        this.mainPlaylistLoader_.load();
      };

      this.tech_.one('play', this.loadOnPlay_);
    } else {
      this.mainPlaylistLoader_.load();
    }

    this.timeToLoadedData__ = -1;
    this.mainAppendsToLoadedData__ = -1;
    this.audioAppendsToLoadedData__ = -1;

    const event = this.tech_.preload() === 'none' ? 'play' : 'loadstart';

    // start the first frame timer on loadstart or play (for preload none)
    this.tech_.one(event, () => {
      const timeToLoadedDataStart = Date.now();

      this.tech_.one('loadeddata', () => {
        this.timeToLoadedData__ = Date.now() - timeToLoadedDataStart;
        this.mainAppendsToLoadedData__ = this.mainSegmentLoader_.mediaAppends;
        this.audioAppendsToLoadedData__ = this.audioSegmentLoader_.mediaAppends;
      });
    });
  }

  mainAppendsToLoadedData_() {
    return this.mainAppendsToLoadedData__;
  }

  audioAppendsToLoadedData_() {
    return this.audioAppendsToLoadedData__;
  }

  appendsToLoadedData_() {
    const main = this.mainAppendsToLoadedData_();
    const audio = this.audioAppendsToLoadedData_();

    if (main === -1 || audio === -1) {
      return -1;
    }

    return main + audio;
  }

  timeToLoadedData_() {
    return this.timeToLoadedData__;
  }

  /**
   * Run selectPlaylist and switch to the new playlist if we should
   *
   * @param {string} [reason=abr] a reason for why the ABR check is made
   * @private
   */
  checkABR_(reason = 'abr') {
    const nextPlaylist = this.selectPlaylist();

    if (nextPlaylist && this.shouldSwitchToMedia_(nextPlaylist)) {
      this.switchMedia_(nextPlaylist, reason);
    }
  }

  switchMedia_(playlist, cause, delay) {
    const oldMedia = this.media();
    const oldId = oldMedia && (oldMedia.id || oldMedia.uri);
    const newId = playlist && (playlist.id || playlist.uri);

    if (oldId && oldId !== newId) {
      this.logger_(`switch media ${oldId} -> ${newId} from ${cause}`);
      const metadata = {
        renditionInfo: {
          id: newId,
          bandwidth: playlist.attributes.BANDWIDTH,
          resolution: playlist.attributes.RESOLUTION,
          codecs: playlist.attributes.CODECS
        },
        cause
      };

      this.trigger({type: 'renditionselected', metadata});
      this.tech_.trigger({type: 'usage', name: `vhs-rendition-change-${cause}`});
    }
    this.mainPlaylistLoader_.media(playlist, delay);
  }

  /**
   * A function that ensures we switch our playlists inside of `mediaTypes`
   * to match the current `serviceLocation` provided by the contentSteering controller.
   * We want to check media types of `AUDIO`, `SUBTITLES`, and `CLOSED-CAPTIONS`.
   *
   * This should only be called on a DASH playback scenario while using content steering.
   * This is necessary due to differences in how media in HLS manifests are generally tied to
   * a video playlist, where in DASH that is not always the case.
   */
  switchMediaForDASHContentSteering_() {
    ['AUDIO', 'SUBTITLES', 'CLOSED-CAPTIONS'].forEach((type) => {
      const mediaType = this.mediaTypes_[type];
      const activeGroup = mediaType ? mediaType.activeGroup() : null;
      const pathway = this.contentSteeringController_.getPathway();

      if (activeGroup && pathway) {
        // activeGroup can be an array or a single group
        const mediaPlaylists = activeGroup.length ? activeGroup[0].playlists : activeGroup.playlists;

        const dashMediaPlaylists = mediaPlaylists.filter((p) => p.attributes.serviceLocation === pathway);

        // Switch the current active playlist to the correct CDN
        if (dashMediaPlaylists.length) {
          this.mediaTypes_[type].activePlaylistLoader.media(dashMediaPlaylists[0]);
        }
      }
    });
  }

  /**
   * Start a timer that periodically calls checkABR_
   *
   * @private
   */
  startABRTimer_() {
    this.stopABRTimer_();
    this.abrTimer_ = window.setInterval(() => this.checkABR_(), 250);
  }

  /**
   * Stop the timer that periodically calls checkABR_
   *
   * @private
   */
  stopABRTimer_() {
    // if we're scrubbing, we don't need to pause.
    // This getter will be added to Video.js in version 7.11.
    if (this.tech_.scrubbing && this.tech_.scrubbing()) {
      return;
    }
    window.clearInterval(this.abrTimer_);
    this.abrTimer_ = null;
  }

  /**
   * Get a list of playlists for the currently selected audio playlist
   *
   * @return {Array} the array of audio playlists
   */
  getAudioTrackPlaylists_() {
    const main = this.main();
    const defaultPlaylists = main && main.playlists || [];

    // if we don't have any audio groups then we can only
    // assume that the audio tracks are contained in main
    // playlist array, use that or an empty array.
    if (!main || !main.mediaGroups || !main.mediaGroups.AUDIO) {
      return defaultPlaylists;
    }

    const AUDIO = main.mediaGroups.AUDIO;
    const groupKeys = Object.keys(AUDIO);
    let track;

    // get the current active track
    if (Object.keys(this.mediaTypes_.AUDIO.groups).length) {
      track = this.mediaTypes_.AUDIO.activeTrack();
    // or get the default track from main if mediaTypes_ isn't setup yet
    } else {
      // default group is `main` or just the first group.
      const defaultGroup = AUDIO.main || groupKeys.length && AUDIO[groupKeys[0]];

      for (const label in defaultGroup) {
        if (defaultGroup[label].default) {
          track = {label};
          break;
        }
      }
    }

    // no active track no playlists.
    if (!track) {
      return defaultPlaylists;
    }

    const playlists = [];

    // get all of the playlists that are possible for the
    // active track.
    for (const group in AUDIO) {
      if (AUDIO[group][track.label]) {
        const properties = AUDIO[group][track.label];

        if (properties.playlists && properties.playlists.length) {
          playlists.push.apply(playlists, properties.playlists);
        } else if (properties.uri) {
          playlists.push(properties);
        } else if (main.playlists.length) {
          // if an audio group does not have a uri
          // see if we have main playlists that use it as a group.
          // if we do then add those to the playlists list.
          for (let i = 0; i < main.playlists.length; i++) {
            const playlist = main.playlists[i];

            if (playlist.attributes && playlist.attributes.AUDIO && playlist.attributes.AUDIO === group) {
              playlists.push(playlist);
            }
          }
        }
      }
    }

    if (!playlists.length) {
      return defaultPlaylists;
    }

    return playlists;
  }

  /**
   * Register event handlers on the main playlist loader. A helper
   * function for construction time.
   *
   * @private
   */
  setupMainPlaylistLoaderListeners_() {
    this.mainPlaylistLoader_.on('loadedmetadata', () => {
      const media = this.mainPlaylistLoader_.media();
      const requestTimeout = (media.targetDuration * 1.5) * 1000;

      // If we don't have any more available playlists, we don't want to
      // timeout the request.
      if (isLowestEnabledRendition(this.mainPlaylistLoader_.main, this.mainPlaylistLoader_.media())) {
        this.requestOptions_.timeout = 0;
      } else {
        this.requestOptions_.timeout = requestTimeout;
      }

      // if this isn't a live video and preload permits, start
      // downloading segments
      if (media.endList && this.tech_.preload() !== 'none') {
        this.mainSegmentLoader_.playlist(media, this.requestOptions_);
        this.mainSegmentLoader_.load();
      }

      setupMediaGroups({
        sourceType: this.sourceType_,
        segmentLoaders: {
          AUDIO: this.audioSegmentLoader_,
          SUBTITLES: this.subtitleSegmentLoader_,
          main: this.mainSegmentLoader_
        },
        tech: this.tech_,
        requestOptions: this.requestOptions_,
        mainPlaylistLoader: this.mainPlaylistLoader_,
        vhs: this.vhs_,
        main: this.main(),
        mediaTypes: this.mediaTypes_,
        excludePlaylist: this.excludePlaylist.bind(this)
      });

      this.triggerPresenceUsage_(this.main(), media);
      this.setupFirstPlay();

      if (!this.mediaTypes_.AUDIO.activePlaylistLoader ||
          this.mediaTypes_.AUDIO.activePlaylistLoader.media()) {
        this.trigger('selectedinitialmedia');
      } else {
        // We must wait for the active audio playlist loader to
        // finish setting up before triggering this event so the
        // representations API and EME setup is correct
        this.mediaTypes_.AUDIO.activePlaylistLoader.one('loadedmetadata', () => {
          this.trigger('selectedinitialmedia');
        });
      }

    });

    this.mainPlaylistLoader_.on('loadedplaylist', () => {
      if (this.loadOnPlay_) {
        this.tech_.off('play', this.loadOnPlay_);
      }
      let updatedPlaylist = this.mainPlaylistLoader_.media();

      if (!updatedPlaylist) {
        // Add content steering listeners on first load and init.
        this.attachContentSteeringListeners_();
        this.initContentSteeringController_();
        // exclude any variants that are not supported by the browser before selecting
        // an initial media as the playlist selectors do not consider browser support
        this.excludeUnsupportedVariants_();

        let selectedMedia;

        if (this.enableLowInitialPlaylist) {
          selectedMedia = this.selectInitialPlaylist();
        }

        if (!selectedMedia) {
          selectedMedia = this.selectPlaylist();
        }

        if (!selectedMedia || !this.shouldSwitchToMedia_(selectedMedia)) {
          return;
        }

        this.initialMedia_ = selectedMedia;

        this.switchMedia_(this.initialMedia_, 'initial');

        // Under the standard case where a source URL is provided, loadedplaylist will
        // fire again since the playlist will be requested. In the case of vhs-json
        // (where the manifest object is provided as the source), when the media
        // playlist's `segments` list is already available, a media playlist won't be
        // requested, and loadedplaylist won't fire again, so the playlist handler must be
        // called on its own here.
        const haveJsonSource = this.sourceType_ === 'vhs-json' && this.initialMedia_.segments;

        if (!haveJsonSource) {
          return;
        }
        updatedPlaylist = this.initialMedia_;
      }

      this.handleUpdatedMediaPlaylist(updatedPlaylist);
    });

    this.mainPlaylistLoader_.on('error', () => {
      const error = this.mainPlaylistLoader_.error;

      this.excludePlaylist({ playlistToExclude: error.playlist, error });
    });

    this.mainPlaylistLoader_.on('mediachanging', () => {
      this.mainSegmentLoader_.abort();
      this.mainSegmentLoader_.pause();
    });

    this.mainPlaylistLoader_.on('mediachange', () => {
      const media = this.mainPlaylistLoader_.media();
      const requestTimeout = (media.targetDuration * 1.5) * 1000;

      // If we don't have any more available playlists, we don't want to
      // timeout the request.
      if (isLowestEnabledRendition(this.mainPlaylistLoader_.main, this.mainPlaylistLoader_.media())) {
        this.requestOptions_.timeout = 0;
      } else {
        this.requestOptions_.timeout = requestTimeout;
      }

      if (this.sourceType_ === 'dash') {
        // we don't want to re-request the same hls playlist right after it was changed

        // Initially it was implemented as workaround to restart playlist loader for live
        // when playlist loader is paused because of playlist exclusions:
        // see: https://github.com/videojs/http-streaming/pull/1339
        // but this introduces duplicate "loadedplaylist" event.
        // Ideally we want to re-think playlist loader life-cycle events,
        // but simply checking "paused" state should help a lot
        if (this.mainPlaylistLoader_.isPaused) {
          this.mainPlaylistLoader_.load();
        }
      }

      // TODO: Create a new event on the PlaylistLoader that signals
      // that the segments have changed in some way and use that to
      // update the SegmentLoader instead of doing it twice here and
      // on `loadedplaylist`
      this.mainSegmentLoader_.pause();
      this.mainSegmentLoader_.playlist(media, this.requestOptions_);

      if (this.waitingForFastQualityPlaylistReceived_) {
        this.runFastQualitySwitch_();
      } else {
        this.mainSegmentLoader_.load();
      }

      this.tech_.trigger({
        type: 'mediachange',
        bubbles: true
      });
    });

    this.mainPlaylistLoader_.on('playlistunchanged', () => {
      const updatedPlaylist = this.mainPlaylistLoader_.media();

      // ignore unchanged playlists that have already been
      // excluded for not-changing. We likely just have a really slowly updating
      // playlist.
      if (updatedPlaylist.lastExcludeReason_ === 'playlist-unchanged') {
        return;
      }

      const playlistOutdated = this.stuckAtPlaylistEnd_(updatedPlaylist);

      if (playlistOutdated) {
        // Playlist has stopped updating and we're stuck at its end. Try to
        // exclude it and switch to another playlist in the hope that that
        // one is updating (and give the player a chance to re-adjust to the
        // safe live point).
        this.excludePlaylist({
          error: {
            message: 'Playlist no longer updating.',
            reason: 'playlist-unchanged'
          }
        });
        // useful for monitoring QoS
        this.tech_.trigger('playliststuck');
      }
    });

    this.mainPlaylistLoader_.on('renditiondisabled', () => {
      this.tech_.trigger({type: 'usage', name: 'vhs-rendition-disabled'});
    });
    this.mainPlaylistLoader_.on('renditionenabled', () => {
      this.tech_.trigger({type: 'usage', name: 'vhs-rendition-enabled'});
    });

    const playlistLoaderEvents = [
      'manifestrequeststart',
      'manifestrequestcomplete',
      'manifestparsestart',
      'manifestparsecomplete',
      'playlistrequeststart',
      'playlistrequestcomplete',
      'playlistparsestart',
      'playlistparsecomplete',
      'renditiondisabled',
      'renditionenabled'
    ];

    playlistLoaderEvents.forEach((eventName) => {
      this.mainPlaylistLoader_.on(eventName, (metadata) => {
        // trigger directly on the player to ensure early events are fired.
        this.player_.trigger({...metadata});
      });
    });
  }

  /**
   * Given an updated media playlist (whether it was loaded for the first time, or
   * refreshed for live playlists), update any relevant properties and state to reflect
   * changes in the media that should be accounted for (e.g., cues and duration).
   *
   * @param {Object} updatedPlaylist the updated media playlist object
   *
   * @private
   */
  handleUpdatedMediaPlaylist(updatedPlaylist) {
    if (this.useCueTags_) {
      this.updateAdCues_(updatedPlaylist);
    }

    // TODO: Create a new event on the PlaylistLoader that signals
    // that the segments have changed in some way and use that to
    // update the SegmentLoader instead of doing it twice here and
    // on `mediachange`
    this.mainSegmentLoader_.pause();
    this.mainSegmentLoader_.playlist(updatedPlaylist, this.requestOptions_);
    if (this.waitingForFastQualityPlaylistReceived_) {
      this.runFastQualitySwitch_();
    }

    this.updateDuration(!updatedPlaylist.endList);

    // If the player isn't paused, ensure that the segment loader is running,
    // as it is possible that it was temporarily stopped while waiting for
    // a playlist (e.g., in case the playlist errored and we re-requested it).
    if (!this.tech_.paused()) {
      this.mainSegmentLoader_.load();
      if (this.audioSegmentLoader_) {
        this.audioSegmentLoader_.load();
      }
    }
  }

  /**
   * A helper function for triggerring presence usage events once per source
   *
   * @private
   */
  triggerPresenceUsage_(main, media) {
    const mediaGroups = main.mediaGroups || {};
    let defaultDemuxed = true;
    const audioGroupKeys = Object.keys(mediaGroups.AUDIO);

    for (const mediaGroup in mediaGroups.AUDIO) {
      for (const label in mediaGroups.AUDIO[mediaGroup]) {
        const properties = mediaGroups.AUDIO[mediaGroup][label];

        if (!properties.uri) {
          defaultDemuxed = false;
        }
      }
    }

    if (defaultDemuxed) {
      this.tech_.trigger({type: 'usage', name: 'vhs-demuxed'});
    }

    if (Object.keys(mediaGroups.SUBTITLES).length) {
      this.tech_.trigger({type: 'usage', name: 'vhs-webvtt'});
    }

    if (Vhs.Playlist.isAes(media)) {
      this.tech_.trigger({type: 'usage', name: 'vhs-aes'});
    }

    if (audioGroupKeys.length &&
        Object.keys(mediaGroups.AUDIO[audioGroupKeys[0]]).length > 1) {
      this.tech_.trigger({type: 'usage', name: 'vhs-alternate-audio'});
    }

    if (this.useCueTags_) {
      this.tech_.trigger({type: 'usage', name: 'vhs-playlist-cue-tags'});
    }
  }

  shouldSwitchToMedia_(nextPlaylist) {
    const currentPlaylist = this.mainPlaylistLoader_.media() ||
      this.mainPlaylistLoader_.pendingMedia_;
    const currentTime = this.tech_.currentTime();
    const bufferLowWaterLine = this.bufferLowWaterLine();
    const bufferHighWaterLine = this.bufferHighWaterLine();
    const buffered = this.tech_.buffered();

    return shouldSwitchToMedia({
      buffered,
      currentTime,
      currentPlaylist,
      nextPlaylist,
      bufferLowWaterLine,
      bufferHighWaterLine,
      duration: this.duration(),
      bufferBasedABR: this.bufferBasedABR,
      log: this.logger_
    });
  }
  /**
   * Register event handlers on the segment loaders. A helper function
   * for construction time.
   *
   * @private
   */
  setupSegmentLoaderListeners_() {
    this.mainSegmentLoader_.on('bandwidthupdate', () => {
      // Whether or not buffer based ABR or another ABR is used, on a bandwidth change it's
      // useful to check to see if a rendition switch should be made.
      this.checkABR_('bandwidthupdate');
      this.tech_.trigger('bandwidthupdate');
    });

    this.mainSegmentLoader_.on('timeout', () => {
      if (this.bufferBasedABR) {
        // If a rendition change is needed, then it would've be done on `bandwidthupdate`.
        // Here the only consideration is that for buffer based ABR there's no guarantee
        // of an immediate switch (since the bandwidth is averaged with a timeout
        // bandwidth value of 1), so force a load on the segment loader to keep it going.
        this.mainSegmentLoader_.load();
      }
    });

    // `progress` events are not reliable enough of a bandwidth measure to trigger buffer
    // based ABR.
    if (!this.bufferBasedABR) {
      this.mainSegmentLoader_.on('progress', () => {
        this.trigger('progress');
      });
    }

    this.mainSegmentLoader_.on('error', () => {
      const error = this.mainSegmentLoader_.error();

      this.excludePlaylist({ playlistToExclude: error.playlist, error });
    });

    this.mainSegmentLoader_.on('appenderror', () => {
      this.error = this.mainSegmentLoader_.error_;
      this.trigger('error');
    });

    this.mainSegmentLoader_.on('syncinfoupdate', () => {
      this.onSyncInfoUpdate_();
    });

    this.mainSegmentLoader_.on('timestampoffset', () => {
      this.tech_.trigger({type: 'usage', name: 'vhs-timestamp-offset'});
    });
    this.audioSegmentLoader_.on('syncinfoupdate', () => {
      this.onSyncInfoUpdate_();
    });

    this.audioSegmentLoader_.on('appenderror', () => {
      this.error = this.audioSegmentLoader_.error_;
      this.trigger('error');
    });

    this.mainSegmentLoader_.on('ended', () => {
      this.logger_('main segment loader ended');
      this.onEndOfStream();
    });

    // There is the possibility of the video segment and the audio segment
    // at a current time to be on different timelines. When this occurs, the player
    // forwards playback to a point where these two segment types are back on the same
    // timeline. This time will be just after the end of the audio segment that is on
    // a previous timeline.
    this.timelineChangeController_.on('audioTimelineBehind', () => {
      const segmentInfo = this.audioSegmentLoader_.pendingSegment_;

      if (!segmentInfo || !segmentInfo.segment || !segmentInfo.segment.syncInfo) {
        return;
      }

      // Update the current time to just after the faulty audio segment.
      // This moves playback to a spot where both audio and video segments
      // are on the same timeline.
      const newTime = segmentInfo.segment.syncInfo.end + 0.01;

      this.tech_.setCurrentTime(newTime);
    });

    this.timelineChangeController_.on('fixBadTimelineChange', () => {
      // pause, reset-everything and load for all segment-loaders
      this.logger_('Fix bad timeline change. Restarting al segment loaders...');
      this.mainSegmentLoader_.pause();
      this.mainSegmentLoader_.resetEverything();
      if (this.mediaTypes_.AUDIO.activePlaylistLoader) {
        this.audioSegmentLoader_.pause();
        this.audioSegmentLoader_.resetEverything();
      }
      if (this.mediaTypes_.SUBTITLES.activePlaylistLoader) {
        this.subtitleSegmentLoader_.pause();
        this.subtitleSegmentLoader_.resetEverything();
      }

      // start segment loader loading in case they are paused
      this.load();
    });

    this.mainSegmentLoader_.on('earlyabort', (event) => {
      // never try to early abort with the new ABR algorithm
      if (this.bufferBasedABR) {
        return;
      }

      this.delegateLoaders_('all', ['abort']);

      this.excludePlaylist({
        error: {
          message: 'Aborted early because there isn\'t enough bandwidth to complete ' +
            'the request without rebuffering.'
        },
        playlistExclusionDuration: ABORT_EARLY_EXCLUSION_SECONDS
      });
    });

    const updateCodecs = () => {
      if (!this.sourceUpdater_.hasCreatedSourceBuffers()) {
        return this.tryToCreateSourceBuffers_();
      }

      const codecs = this.getCodecsOrExclude_();

      // no codecs means that the playlist was excluded
      if (!codecs) {
        return;
      }

      this.sourceUpdater_.addOrChangeSourceBuffers(codecs);
    };

    this.mainSegmentLoader_.on('trackinfo', updateCodecs);
    this.audioSegmentLoader_.on('trackinfo', updateCodecs);

    this.mainSegmentLoader_.on('fmp4', () => {
      if (!this.triggeredFmp4Usage) {
        this.tech_.trigger({type: 'usage', name: 'vhs-fmp4'});
        this.triggeredFmp4Usage = true;
      }
    });

    this.audioSegmentLoader_.on('fmp4', () => {
      if (!this.triggeredFmp4Usage) {
        this.tech_.trigger({type: 'usage', name: 'vhs-fmp4'});
        this.triggeredFmp4Usage = true;
      }
    });

    this.audioSegmentLoader_.on('ended', () => {
      this.logger_('audioSegmentLoader ended');
      this.onEndOfStream();
    });

    const segmentLoaderEvents = [
      'segmentselected',
      'segmentloadstart',
      'segmentloaded',
      'segmentkeyloadstart',
      'segmentkeyloadcomplete',
      'segmentdecryptionstart',
      'segmentdecryptioncomplete',
      'segmenttransmuxingstart',
      'segmenttransmuxingcomplete',
      'segmenttransmuxingtrackinfoavailable',
      'segmenttransmuxingtiminginfoavailable',
      'segmentappendstart',
      'appendsdone',
      'bandwidthupdated',
      'timelinechange',
      'codecschange'
    ];

    segmentLoaderEvents.forEach((eventName) => {
      this.mainSegmentLoader_.on(eventName, (metadata) => {
        this.player_.trigger({...metadata});
      });

      this.audioSegmentLoader_.on(eventName, (metadata) => {
        this.player_.trigger({...metadata});
      });

      this.subtitleSegmentLoader_.on(eventName, (metadata) => {
        this.player_.trigger({...metadata});
      });
    });

  }

  mediaSecondsLoaded_() {
    return Math.max(this.audioSegmentLoader_.mediaSecondsLoaded +
                    this.mainSegmentLoader_.mediaSecondsLoaded);
  }

  /**
   * Call load on our SegmentLoaders
   */
  load() {
    this.mainSegmentLoader_.load();

    if (this.mediaTypes_.AUDIO.activePlaylistLoader) {
      this.audioSegmentLoader_.load();
    }

    if (this.mediaTypes_.SUBTITLES.activePlaylistLoader) {
      this.subtitleSegmentLoader_.load();
    }
  }

  /**
   * Call pause on our SegmentLoaders
   */
  pause() {
    this.mainSegmentLoader_.pause();

    if (this.mediaTypes_.AUDIO.activePlaylistLoader) {
      this.audioSegmentLoader_.pause();
    }

    if (this.mediaTypes_.SUBTITLES.activePlaylistLoader) {
      this.subtitleSegmentLoader_.pause();
    }
  }

  /**
   * Re-tune playback quality level for the current player
   * conditions. This method will perform destructive actions like removing
   * already buffered content in order to readjust the currently active
   * playlist quickly. This is good for manual quality changes
   *
   * @private
   */
  fastQualityChange_(media = this.selectPlaylist()) {
    if (media && media === this.mainPlaylistLoader_.media()) {
      this.logger_('skipping fastQualityChange because new media is same as old');
      return;
    }

    this.switchMedia_(media, 'fast-quality');

    // we would like to avoid race condition when we call fastQuality,
    // reset everything and start loading segments from prev segments instead of new because new playlist is not received yet
    this.waitingForFastQualityPlaylistReceived_ = true;
  }

  runFastQualitySwitch_() {
    this.waitingForFastQualityPlaylistReceived_ = false;
    this.mainSegmentLoader_.pause();
    this.mainSegmentLoader_.resetEverything();
    if (this.mediaTypes_.AUDIO.activePlaylistLoader) {
      this.audioSegmentLoader_.pause();
      this.audioSegmentLoader_.resetEverything();
    }
    if (this.mediaTypes_.SUBTITLES.activePlaylistLoader) {
      this.subtitleSegmentLoader_.pause();
      this.subtitleSegmentLoader_.resetEverything();
    }

    // start segment loader loading in case they are paused
    this.load();
  }

  /**
   * Begin playback.
   */
  play() {
    if (this.setupFirstPlay()) {
      return;
    }

    if (this.tech_.ended()) {
      this.tech_.setCurrentTime(0);
    }

    if (this.hasPlayed_) {
      this.load();
    }

    const seekable = this.tech_.seekable();

    // if the viewer has paused and we fell out of the live window,
    // seek forward to the live point
    if (this.tech_.duration() === Infinity) {
      if (this.tech_.currentTime() < seekable.start(0)) {
        return this.tech_.setCurrentTime(seekable.end(seekable.length - 1));
      }
    }
  }

  /**
   * Seek to the latest media position if this is a live video and the
   * player and video are loaded and initialized.
   */
  setupFirstPlay() {
    const media = this.mainPlaylistLoader_.media();

    // Check that everything is ready to begin buffering for the first call to play
    //  If 1) there is no active media
    //     2) the player is paused
    //     3) the first play has already been setup
    // then exit early
    if (!media || this.tech_.paused() || this.hasPlayed_) {
      return false;
    }

    // when the video is a live stream and/or has a start time
    if (!media.endList || media.start) {
      const seekable = this.seekable();

      if (!seekable.length) {
        // without a seekable range, the player cannot seek to begin buffering at the
        // live or start point
        return false;
      }

      const seekableEnd = seekable.end(0);
      let startPoint = seekableEnd;

      if (media.start) {
        const offset = media.start.timeOffset;

        if (offset < 0) {
          startPoint = Math.max(seekableEnd + offset, seekable.start(0));
        } else {
          startPoint = Math.min(seekableEnd, offset);
        }
      }

      // trigger firstplay to inform the source handler to ignore the next seek event
      this.trigger('firstplay');
      // seek to the live point
      this.tech_.setCurrentTime(startPoint);
    }

    this.hasPlayed_ = true;
    // we can begin loading now that everything is ready
    this.load();
    return true;
  }

  /**
   * handle the sourceopen event on the MediaSource
   *
   * @private
   */
  handleSourceOpen_() {
    // Only attempt to create the source buffer if none already exist.
    // handleSourceOpen is also called when we are "re-opening" a source buffer
    // after `endOfStream` has been called (in response to a seek for instance)
    this.tryToCreateSourceBuffers_();

    // if autoplay is enabled, begin playback. This is duplicative of
    // code in video.js but is required because play() must be invoked
    // *after* the media source has opened.
    if (this.tech_.autoplay()) {
      const playPromise = this.tech_.play();

      // Catch/silence error when a pause interrupts a play request
      // on browsers which return a promise
      if (typeof playPromise !== 'undefined' && typeof playPromise.then === 'function') {
        playPromise.then(null, (e) => {});
      }
    }

    this.trigger('sourceopen');
  }

  /**
   * handle the sourceended event on the MediaSource
   *
   * @private
   */
  handleSourceEnded_() {
    if (!this.inbandTextTracks_.metadataTrack_) {
      return;
    }

    const cues = this.inbandTextTracks_.metadataTrack_.cues;

    if (!cues || !cues.length) {
      return;
    }

    const duration = this.duration();

    cues[cues.length - 1].endTime = isNaN(duration) || Math.abs(duration) === Infinity ?
      Number.MAX_VALUE : duration;
  }

  /**
   * handle the durationchange event on the MediaSource
   *
   * @private
   */
  handleDurationChange_() {
    this.tech_.trigger('durationchange');
  }

  /**
   * Calls endOfStream on the media source when all active stream types have called
   * endOfStream
   *
   * @param {string} streamType
   *        Stream type of the segment loader that called endOfStream
   * @private
   */
  onEndOfStream() {
    let isEndOfStream = this.mainSegmentLoader_.ended_;

    if (this.mediaTypes_.AUDIO.activePlaylistLoader) {
      const mainMediaInfo = this.mainSegmentLoader_.getCurrentMediaInfo_();

      // if the audio playlist loader exists, then alternate audio is active
      if (!mainMediaInfo || mainMediaInfo.hasVideo) {
        // if we do not know if the main segment loader contains video yet or if we
        // definitively know the main segment loader contains video, then we need to wait
        // for both main and audio segment loaders to call endOfStream
        isEndOfStream = isEndOfStream && this.audioSegmentLoader_.ended_;
      } else {
        // otherwise just rely on the audio loader
        isEndOfStream = this.audioSegmentLoader_.ended_;
      }
    }

    if (!isEndOfStream) {
      return;
    }

    this.stopABRTimer_();
    this.sourceUpdater_.endOfStream();
  }

  /**
   * Check if a playlist has stopped being updated
   *
   * @param {Object} playlist the media playlist object
   * @return {boolean} whether the playlist has stopped being updated or not
   */
  stuckAtPlaylistEnd_(playlist) {
    const seekable = this.seekable();

    if (!seekable.length) {
      // playlist doesn't have enough information to determine whether we are stuck
      return false;
    }

    const expired =
      this.syncController_.getExpiredTime(playlist, this.duration());

    if (expired === null) {
      return false;
    }

    // does not use the safe live end to calculate playlist end, since we
    // don't want to say we are stuck while there is still content
    const absolutePlaylistEnd = Vhs.Playlist.playlistEnd(playlist, expired);
    const currentTime = this.tech_.currentTime();
    const buffered = this.tech_.buffered();

    if (!buffered.length) {
      // return true if the playhead reached the absolute end of the playlist
      return absolutePlaylistEnd - currentTime <= Ranges.SAFE_TIME_DELTA;
    }
    const bufferedEnd = buffered.end(buffered.length - 1);

    // return true if there is too little buffer left and buffer has reached absolute
    // end of playlist
    return bufferedEnd - currentTime <= Ranges.SAFE_TIME_DELTA &&
           absolutePlaylistEnd - bufferedEnd <= Ranges.SAFE_TIME_DELTA;
  }

  /**
   * Exclude a playlist for a set amount of time, making it unavailable for selection by
   * the rendition selection algorithm, then force a new playlist (rendition) selection.
   *
   * @param {Object=} playlistToExclude
   *                  the playlist to exclude, defaults to the currently selected playlist
   * @param {Object=} error
   *                  an optional error
   * @param {number=} playlistExclusionDuration
   *                  an optional number of seconds to exclude the playlist
   */
  excludePlaylist({
    playlistToExclude = this.mainPlaylistLoader_.media(),
    error = {},
    playlistExclusionDuration
  }) {

    // If the `error` was generated by the playlist loader, it will contain
    // the playlist we were trying to load (but failed) and that should be
    // excluded instead of the currently selected playlist which is likely
    // out-of-date in this scenario
    playlistToExclude = playlistToExclude || this.mainPlaylistLoader_.media();

    playlistExclusionDuration = playlistExclusionDuration ||
      error.playlistExclusionDuration ||
      this.playlistExclusionDuration;

    // If there is no current playlist, then an error occurred while we were
    // trying to load the main OR while we were disposing of the tech
    if (!playlistToExclude) {
      this.error = error;

      if (this.mediaSource.readyState !== 'open') {
        this.trigger('error');
      } else {
        this.sourceUpdater_.endOfStream('network');
      }

      return;
    }

    playlistToExclude.playlistErrors_++;

    const playlists = this.mainPlaylistLoader_.main.playlists;
    const enabledPlaylists = playlists.filter(isEnabled);
    const isFinalRendition = enabledPlaylists.length === 1 && enabledPlaylists[0] === playlistToExclude;

    // Don't exclude the only playlist unless it was excluded
    // forever
    if (playlists.length === 1 && playlistExclusionDuration !== Infinity) {
      videojs.log.warn(`Problem encountered with playlist ${playlistToExclude.id}. ` +
                       'Trying again since it is the only playlist.');

      this.tech_.trigger('retryplaylist');
      // if this is a final rendition, we should delay
      return this.mainPlaylistLoader_.load(isFinalRendition);
    }

    if (isFinalRendition) {
      // If we're content steering, try other pathways.
      if (this.main().contentSteering) {
        const pathway = this.pathwayAttribute_(playlistToExclude);
        // Ignore at least 1 steering manifest refresh.
        const reIncludeDelay = this.contentSteeringController_.steeringManifest.ttl * 1000;

        this.contentSteeringController_.excludePathway(pathway);
        this.excludeThenChangePathway_();
        setTimeout(() => {
          this.contentSteeringController_.addAvailablePathway(pathway);
        }, reIncludeDelay);
        return;
      }
      // Since we're on the final non-excluded playlist, and we're about to exclude
      // it, instead of erring the player or retrying this playlist, clear out the current
      // exclusion list. This allows other playlists to be attempted in case any have been
      // fixed.
      let reincluded = false;

      playlists.forEach((playlist) => {
        // skip current playlist which is about to be excluded
        if (playlist === playlistToExclude) {
          return;
        }
        const excludeUntil = playlist.excludeUntil;

        // a playlist cannot be reincluded if it wasn't excluded to begin with.
        if (typeof excludeUntil !== 'undefined' && excludeUntil !== Infinity) {
          reincluded = true;
          delete playlist.excludeUntil;
        }
      });

      if (reincluded) {
        videojs.log.warn('Removing other playlists from the exclusion list because the last ' +
                         'rendition is about to be excluded.');
        // Technically we are retrying a playlist, in that we are simply retrying a previous
        // playlist. This is needed for users relying on the retryplaylist event to catch a
        // case where the player might be stuck and looping through "dead" playlists.
        this.tech_.trigger('retryplaylist');
      }
    }

    // Exclude this playlist
    let excludeUntil;

    if (playlistToExclude.playlistErrors_ > this.maxPlaylistRetries) {
      excludeUntil = Infinity;
    } else {
      excludeUntil = Date.now() + (playlistExclusionDuration * 1000);
    }

    playlistToExclude.excludeUntil = excludeUntil;

    if (error.reason) {
      playlistToExclude.lastExcludeReason_ = error.reason;
    }
    this.tech_.trigger('excludeplaylist');
    this.tech_.trigger({type: 'usage', name: 'vhs-rendition-excluded'});

    // TODO: only load a new playlist if we're excluding the current playlist
    // If this function was called with a playlist that's not the current active playlist
    // (e.g., media().id !== playlistToExclude.id),
    // then a new playlist should not be selected and loaded, as there's nothing wrong with the current playlist.
    const nextPlaylist = this.selectPlaylist();

    if (!nextPlaylist) {
      this.error = 'Playback cannot continue. No available working or supported playlists.';
      this.trigger('error');
      return;
    }

    const logFn = error.internal ? this.logger_ : videojs.log.warn;
    const errorMessage = error.message ? (' ' + error.message) : '';

    logFn(`${(error.internal ? 'Internal problem' : 'Problem')} encountered with playlist ${playlistToExclude.id}.` +
      `${errorMessage} Switching to playlist ${nextPlaylist.id}.`);

    // if audio group changed reset audio loaders
    if (nextPlaylist.attributes.AUDIO !== playlistToExclude.attributes.AUDIO) {
      this.delegateLoaders_('audio', ['abort', 'pause']);
    }

    // if subtitle group changed reset subtitle loaders
    if (nextPlaylist.attributes.SUBTITLES !== playlistToExclude.attributes.SUBTITLES) {
      this.delegateLoaders_('subtitle', ['abort', 'pause']);
    }

    this.delegateLoaders_('main', ['abort', 'pause']);

    const delayDuration = (nextPlaylist.targetDuration / 2) * 1000 || 5 * 1000;
    const shouldDelay = typeof nextPlaylist.lastRequest === 'number' &&
      (Date.now() - nextPlaylist.lastRequest) <= delayDuration;

    // delay if it's a final rendition or if the last refresh is sooner than half targetDuration
    return this.switchMedia_(nextPlaylist, 'exclude', isFinalRendition || shouldDelay);
  }

  /**
   * Pause all segment/playlist loaders
   */
  pauseLoading() {
    this.delegateLoaders_('all', ['abort', 'pause']);
    this.stopABRTimer_();
  }

  /**
   * Call a set of functions in order on playlist loaders, segment loaders,
   * or both types of loaders.
   *
   * @param {string} filter
   *        Filter loaders that should call fnNames using a string. Can be:
   *        * all - run on all loaders
   *        * audio - run on all audio loaders
   *        * subtitle - run on all subtitle loaders
   *        * main - run on the main loaders
   *
   * @param {Array|string} fnNames
   *        A string or array of function names to call.
   */
  delegateLoaders_(filter, fnNames) {
    const loaders = [];

    const dontFilterPlaylist = filter === 'all';

    if (dontFilterPlaylist || filter === 'main') {
      loaders.push(this.mainPlaylistLoader_);
    }

    const mediaTypes = [];

    if (dontFilterPlaylist || filter === 'audio') {
      mediaTypes.push('AUDIO');
    }

    if (dontFilterPlaylist || filter === 'subtitle') {
      mediaTypes.push('CLOSED-CAPTIONS');
      mediaTypes.push('SUBTITLES');
    }

    mediaTypes.forEach((mediaType) => {
      const loader = this.mediaTypes_[mediaType] &&
        this.mediaTypes_[mediaType].activePlaylistLoader;

      if (loader) {
        loaders.push(loader);
      }
    });

    ['main', 'audio', 'subtitle'].forEach((name) => {
      const loader = this[`${name}SegmentLoader_`];

      if (loader && (filter === name || filter === 'all')) {
        loaders.push(loader);
      }
    });

    loaders.forEach((loader) => fnNames.forEach((fnName) => {
      if (typeof loader[fnName] === 'function') {
        loader[fnName]();
      }
    }));
  }

  /**
   * set the current time on all segment loaders
   *
   * @param {TimeRange} currentTime the current time to set
   * @return {TimeRange} the current time
   */
  setCurrentTime(currentTime) {
    const buffered = Ranges.findRange(this.tech_.buffered(), currentTime);

    if (!(this.mainPlaylistLoader_ && this.mainPlaylistLoader_.media())) {
      // return immediately if the metadata is not ready yet
      return 0;
    }

    // it's clearly an edge-case but don't thrown an error if asked to
    // seek within an empty playlist
    if (!this.mainPlaylistLoader_.media().segments) {
      return 0;
    }

    // if the seek location is already buffered, continue buffering as usual
    if (buffered && buffered.length) {
      return currentTime;
    }

    // cancel outstanding requests so we begin buffering at the new
    // location
    this.mainSegmentLoader_.pause();
    this.mainSegmentLoader_.resetEverything();
    if (this.mediaTypes_.AUDIO.activePlaylistLoader) {
      this.audioSegmentLoader_.pause();
      this.audioSegmentLoader_.resetEverything();
    }
    if (this.mediaTypes_.SUBTITLES.activePlaylistLoader) {
      this.subtitleSegmentLoader_.pause();
      this.subtitleSegmentLoader_.resetEverything();
    }

    // start segment loader loading in case they are paused
    this.load();
  }

  /**
   * get the current duration
   *
   * @return {TimeRange} the duration
   */
  duration() {
    if (!this.mainPlaylistLoader_) {
      return 0;
    }

    const media = this.mainPlaylistLoader_.media();

    if (!media) {
      // no playlists loaded yet, so can't determine a duration
      return 0;
    }

    // Don't rely on the media source for duration in the case of a live playlist since
    // setting the native MediaSource's duration to infinity ends up with consequences to
    // seekable behavior. See https://github.com/w3c/media-source/issues/5 for details.
    //
    // This is resolved in the spec by https://github.com/w3c/media-source/pull/92,
    // however, few browsers have support for setLiveSeekableRange()
    // https://developer.mozilla.org/en-US/docs/Web/API/MediaSource/setLiveSeekableRange
    //
    // Until a time when the duration of the media source can be set to infinity, and a
    // seekable range specified across browsers, just return Infinity.
    if (!media.endList) {
      return Infinity;
    }

    // Since this is a VOD video, it is safe to rely on the media source's duration (if
    // available). If it's not available, fall back to a playlist-calculated estimate.

    if (this.mediaSource) {
      return this.mediaSource.duration;
    }

    return Vhs.Playlist.duration(media);
  }

  /**
   * check the seekable range
   *
   * @return {TimeRange} the seekable range
   */
  seekable() {
    return this.seekable_;
  }

  getSeekableRange_(playlistLoader, mediaType) {
    const media = playlistLoader.media();

    if (!media) {
      return null;
    }

    const mediaSequenceSync = this.syncController_.getMediaSequenceSync(mediaType);

    if (mediaSequenceSync && mediaSequenceSync.isReliable) {
      const start = mediaSequenceSync.start;
      const end = mediaSequenceSync.end;

      if (!isFinite(start) || !isFinite(end)) {
        return null;
      }

      const liveEdgeDelay = Vhs.Playlist.liveEdgeDelay(this.mainPlaylistLoader_.main, media);

      // Make sure our seekable end is not less than the seekable start
      const calculatedEnd = Math.max(start, end - liveEdgeDelay);

      return createTimeRanges([[start, calculatedEnd]]);
    }

    const expired = this.syncController_.getExpiredTime(media, this.duration());

    if (expired === null) {
      return null;
    }

    const seekable = Vhs.Playlist.seekable(
      media,
      expired,
      Vhs.Playlist.liveEdgeDelay(this.mainPlaylistLoader_.main, media)
    );

    return seekable.length ? seekable : null;
  }

  computeFinalSeekable_(mainSeekable, audioSeekable) {
    if (!audioSeekable) {
      return mainSeekable;
    }

    const mainStart = mainSeekable.start(0);
    const mainEnd = mainSeekable.end(0);
    const audioStart = audioSeekable.start(0);
    const audioEnd = audioSeekable.end(0);

    if (audioStart > mainEnd || mainStart > audioEnd) {
      // Seekables are far apart, rely on main
      return mainSeekable;
    }

    // Return the overlapping seekable range
    return createTimeRanges([[
      Math.max(mainStart, audioStart),
      Math.min(mainEnd, audioEnd)
    ]]);
  }

  onSyncInfoUpdate_() {
    // TODO check for creation of both source buffers before updating seekable
    //
    // A fix was made to this function where a check for
    // this.sourceUpdater_.hasCreatedSourceBuffers
    // was added to ensure that both source buffers were created before seekable was
    // updated. However, it originally had a bug where it was checking for a true and
    // returning early instead of checking for false. Setting it to check for false to
    // return early though created other issues. A call to play() would check for seekable
    // end without verifying that a seekable range was present. In addition, even checking
    // for that didn't solve some issues, as handleFirstPlay is sometimes worked around
    // due to a media update calling load on the segment loaders, skipping a seek to live,
    // thereby starting live streams at the beginning of the stream rather than at the end.
    //
    // This conditional should be fixed to wait for the creation of two source buffers at
    // the same time as the other sections of code are fixed to properly seek to live and
    // not throw an error due to checking for a seekable end when no seekable range exists.
    //
    // For now, fall back to the older behavior, with the understanding that the seekable
    // range may not be completely correct, leading to a suboptimal initial live point.
    if (!this.mainPlaylistLoader_) {
      return;
    }

    const mainSeekable = this.getSeekableRange_(this.mainPlaylistLoader_, 'main');

    if (!mainSeekable) {
      return;
    }

    let audioSeekable;

    if (this.mediaTypes_.AUDIO.activePlaylistLoader) {
      audioSeekable = this.getSeekableRange_(this.mediaTypes_.AUDIO.activePlaylistLoader, 'audio');

      if (!audioSeekable) {
        return;
      }
    }

    const oldSeekable = this.seekable_;

    this.seekable_ = this.computeFinalSeekable_(mainSeekable, audioSeekable);

    if (!this.seekable_) {
      return;
    }

    if (oldSeekable && oldSeekable.length && this.seekable_.length) {
      if (oldSeekable.start(0) === this.seekable_.start(0) &&
        oldSeekable.end(0) === this.seekable_.end(0)) {
        // Seekable range hasn't changed
        return;
      }
    }

    this.logger_(`seekable updated [${Ranges.printableRange(this.seekable_)}]`);

    const metadata = {
      seekableRanges: this.seekable_
    };

    this.trigger({ type: 'seekablerangeschanged', metadata });
    this.tech_.trigger('seekablechanged');
  }

  /**
   * Update the player duration
   */
  updateDuration(isLive) {
    if (this.updateDuration_) {
      this.mediaSource.removeEventListener('sourceopen', this.updateDuration_);
      this.updateDuration_ = null;
    }
    if (this.mediaSource.readyState !== 'open') {
      this.updateDuration_ = this.updateDuration.bind(this, isLive);
      this.mediaSource.addEventListener('sourceopen', this.updateDuration_);
      return;
    }

    if (isLive) {
      const seekable = this.seekable();

      if (!seekable.length) {
        return;
      }

      // Even in the case of a live playlist, the native MediaSource's duration should not
      // be set to Infinity (even though this would be expected for a live playlist), since
      // setting the native MediaSource's duration to infinity ends up with consequences to
      // seekable behavior. See https://github.com/w3c/media-source/issues/5 for details.
      //
      // This is resolved in the spec by https://github.com/w3c/media-source/pull/92,
      // however, few browsers have support for setLiveSeekableRange()
      // https://developer.mozilla.org/en-US/docs/Web/API/MediaSource/setLiveSeekableRange
      //
      // Until a time when the duration of the media source can be set to infinity, and a
      // seekable range specified across browsers, the duration should be greater than or
      // equal to the last possible seekable value.

      // MediaSource duration starts as NaN
      // It is possible (and probable) that this case will never be reached for many
      // sources, since the MediaSource reports duration as the highest value without
      // accounting for timestamp offset. For example, if the timestamp offset is -100 and
      // we buffered times 0 to 100 with real times of 100 to 200, even though current
      // time will be between 0 and 100, the native media source may report the duration
      // as 200. However, since we report duration separate from the media source (as
      // Infinity), and as long as the native media source duration value is greater than
      // our reported seekable range, seeks will work as expected. The large number as
      // duration for live is actually a strategy used by some players to work around the
      // issue of live seekable ranges cited above.
      if (isNaN(this.mediaSource.duration) || this.mediaSource.duration < seekable.end(seekable.length - 1)) {
        this.sourceUpdater_.setDuration(seekable.end(seekable.length - 1));
      }
      return;
    }

    const buffered = this.tech_.buffered();
    let duration = Vhs.Playlist.duration(this.mainPlaylistLoader_.media());

    if (buffered.length > 0) {
      duration = Math.max(duration, buffered.end(buffered.length - 1));
    }

    if (this.mediaSource.duration !== duration) {
      this.sourceUpdater_.setDuration(duration);
    }
  }

  /**
   * dispose of the PlaylistController and everything
   * that it controls
   */
  dispose() {
    this.trigger('dispose');
    this.decrypter_.terminate();
    this.mainPlaylistLoader_.dispose();
    this.mainSegmentLoader_.dispose();
    this.contentSteeringController_.dispose();
    this.keyStatusMap_.clear();

    if (this.loadOnPlay_) {
      this.tech_.off('play', this.loadOnPlay_);
    }

    ['AUDIO', 'SUBTITLES'].forEach((type) => {
      const groups = this.mediaTypes_[type].groups;

      for (const id in groups) {
        groups[id].forEach((group) => {
          if (group.playlistLoader) {
            group.playlistLoader.dispose();
          }
        });
      }
    });

    this.audioSegmentLoader_.dispose();
    this.subtitleSegmentLoader_.dispose();
    this.sourceUpdater_.dispose();
    this.timelineChangeController_.dispose();

    this.stopABRTimer_();

    if (this.updateDuration_) {
      this.mediaSource.removeEventListener('sourceopen', this.updateDuration_);
    }

    this.mediaSource.removeEventListener('durationchange', this.handleDurationChange_);

    // load the media source into the player
    this.mediaSource.removeEventListener('sourceopen', this.handleSourceOpen_);
    this.mediaSource.removeEventListener('sourceended', this.handleSourceEnded_);
    this.off();
  }

  /**
   * return the main playlist object if we have one
   *
   * @return {Object} the main playlist object that we parsed
   */
  main() {
    return this.mainPlaylistLoader_.main;
  }

  /**
   * return the currently selected playlist
   *
   * @return {Object} the currently selected playlist object that we parsed
   */
  media() {
    // playlist loader will not return media if it has not been fully loaded
    return this.mainPlaylistLoader_.media() || this.initialMedia_;
  }

  areMediaTypesKnown_() {
    const usingAudioLoader = !!this.mediaTypes_.AUDIO.activePlaylistLoader;
    const hasMainMediaInfo = !!this.mainSegmentLoader_.getCurrentMediaInfo_();
    // if we are not using an audio loader, then we have audio media info
    // otherwise check on the segment loader.
    const hasAudioMediaInfo = !usingAudioLoader ? true : !!this.audioSegmentLoader_.getCurrentMediaInfo_();

    // one or both loaders has not loaded sufficently to get codecs
    if (!hasMainMediaInfo || !hasAudioMediaInfo) {
      return false;
    }

    return true;
  }

  // find from and to for codec switch event
  getCodecsOrExclude_() {
    const media = {
      main: this.mainSegmentLoader_.getCurrentMediaInfo_() || {},
      audio: this.audioSegmentLoader_.getCurrentMediaInfo_() || {}
    };

    const playlist = this.mainSegmentLoader_.getPendingSegmentPlaylist() || this.media();

    // set "main" media equal to video
    media.video = media.main;
    const playlistCodecs = codecsForPlaylist(this.main(), playlist);
    const codecs = {};
    const usingAudioLoader = !!this.mediaTypes_.AUDIO.activePlaylistLoader;

    if (media.main.hasVideo) {
      codecs.video = playlistCodecs.video || media.main.videoCodec || DEFAULT_VIDEO_CODEC;
    }

    if (media.main.isMuxed) {
      codecs.video += `,${playlistCodecs.audio || media.main.audioCodec || DEFAULT_AUDIO_CODEC}`;
    }

    if ((media.main.hasAudio && !media.main.isMuxed) || media.audio.hasAudio || usingAudioLoader) {
      codecs.audio = playlistCodecs.audio || media.main.audioCodec || media.audio.audioCodec || DEFAULT_AUDIO_CODEC;
      // set audio isFmp4 so we use the correct "supports" function below
      media.audio.isFmp4 = (media.main.hasAudio && !media.main.isMuxed) ? media.main.isFmp4 : media.audio.isFmp4;
    }

    // no codecs, no playback.
    if (!codecs.audio && !codecs.video) {
      this.excludePlaylist({
        playlistToExclude: playlist,
        error: { message: 'Could not determine codecs for playlist.' },
        playlistExclusionDuration: Infinity
      });
      return;
    }

    // fmp4 relies on browser support, while ts relies on muxer support
    const supportFunction = (isFmp4, codec) => (isFmp4 ? browserSupportsCodec(codec, this.usingManagedMediaSource_) : muxerSupportsCodec(codec));
    const unsupportedCodecs = {};
    let unsupportedAudio;

    ['video', 'audio'].forEach(function(type) {
      if (codecs.hasOwnProperty(type) && !supportFunction(media[type].isFmp4, codecs[type])) {
        const supporter = media[type].isFmp4 ? 'browser' : 'muxer';

        unsupportedCodecs[supporter] = unsupportedCodecs[supporter] || [];
        unsupportedCodecs[supporter].push(codecs[type]);

        if (type === 'audio') {
          unsupportedAudio = supporter;
        }
      }
    });

    if (usingAudioLoader && unsupportedAudio && playlist.attributes.AUDIO) {
      const audioGroup = playlist.attributes.AUDIO;

      this.main().playlists.forEach(variant => {
        const variantAudioGroup = variant.attributes && variant.attributes.AUDIO;

        if (variantAudioGroup === audioGroup && variant !== playlist) {
          variant.excludeUntil = Infinity;
        }
      });
      this.logger_(`excluding audio group ${audioGroup} as ${unsupportedAudio} does not support codec(s): "${codecs.audio}"`);
    }

    // if we have any unsupported codecs exclude this playlist.
    if (Object.keys(unsupportedCodecs).length) {
      const message = Object.keys(unsupportedCodecs).reduce((acc, supporter) => {

        if (acc) {
          acc += ', ';
        }

        acc += `${supporter} does not support codec(s): "${unsupportedCodecs[supporter].join(',')}"`;

        return acc;
      }, '') + '.';

      this.excludePlaylist({
        playlistToExclude: playlist,
        error: {
          internal: true,
          message
        },
        playlistExclusionDuration: Infinity
      });
      return;
    }
    // check if codec switching is happening
    if (
      this.sourceUpdater_.hasCreatedSourceBuffers() &&
      !this.sourceUpdater_.canChangeType()
    ) {
      const switchMessages = [];

      ['video', 'audio'].forEach((type) => {
        const newCodec = (parseCodecs(this.sourceUpdater_.codecs[type] || '')[0] || {}).type;
        const oldCodec = (parseCodecs(codecs[type] || '')[0] || {}).type;

        if (newCodec && oldCodec && newCodec.toLowerCase() !== oldCodec.toLowerCase()) {
          switchMessages.push(`"${this.sourceUpdater_.codecs[type]}" -> "${codecs[type]}"`);
        }
      });

      if (switchMessages.length) {
        this.excludePlaylist({
          playlistToExclude: playlist,
          error: {
            message: `Codec switching not supported: ${switchMessages.join(', ')}.`,
            internal: true
          },
          playlistExclusionDuration: Infinity
        });
        return;
      }
    }

    // TODO: when using the muxer shouldn't we just return
    // the codecs that the muxer outputs?
    return codecs;
  }

  /**
   * Create source buffers and exlude any incompatible renditions.
   *
   * @private
   */
  tryToCreateSourceBuffers_() {
    // media source is not ready yet or sourceBuffers are already
    // created.
    if (
      this.mediaSource.readyState !== 'open' ||
      this.sourceUpdater_.hasCreatedSourceBuffers()
    ) {
      return;
    }

    if (!this.areMediaTypesKnown_()) {
      return;
    }

    const codecs = this.getCodecsOrExclude_();

    // no codecs means that the playlist was excluded
    if (!codecs) {
      return;
    }

    this.sourceUpdater_.createSourceBuffers(codecs);

    const codecString = [codecs.video, codecs.audio].filter(Boolean).join(',');

    this.excludeIncompatibleVariants_(codecString);
  }

  /**
   * Excludes playlists with codecs that are unsupported by the muxer and browser.
   */
  excludeUnsupportedVariants_() {
    const playlists = this.main().playlists;
    const ids = [];

    // TODO: why don't we have a property to loop through all
    // playlist? Why did we ever mix indexes and keys?
    Object.keys(playlists).forEach(key => {
      const variant = playlists[key];

      // check if we already processed this playlist.
      if (ids.indexOf(variant.id) !== -1) {
        return;
      }

      ids.push(variant.id);

      const codecs = codecsForPlaylist(this.main, variant);
      const unsupported = [];

      if (codecs.audio && !muxerSupportsCodec(codecs.audio) && !browserSupportsCodec(codecs.audio, this.usingManagedMediaSource_)) {
        unsupported.push(`audio codec ${codecs.audio}`);
      }

      if (codecs.video && !muxerSupportsCodec(codecs.video) && !browserSupportsCodec(codecs.video, this.usingManagedMediaSource_)) {
        unsupported.push(`video codec ${codecs.video}`);
      }

      if (codecs.text && codecs.text === 'stpp.ttml.im1t') {
        unsupported.push(`text codec ${codecs.text}`);
      }

      if (unsupported.length) {
        variant.excludeUntil = Infinity;
        this.logger_(`excluding ${variant.id} for unsupported: ${unsupported.join(', ')}`);
      }
    });
  }

  /**
   * Exclude playlists that are known to be codec or
   * stream-incompatible with the SourceBuffer configuration. For
   * instance, Media Source Extensions would cause the video element to
   * stall waiting for video data if you switched from a variant with
   * video and audio to an audio-only one.
   *
   * @param {Object} media a media playlist compatible with the current
   * set of SourceBuffers. Variants in the current main playlist that
   * do not appear to have compatible codec or stream configurations
   * will be excluded from the default playlist selection algorithm
   * indefinitely.
   * @private
   */
  excludeIncompatibleVariants_(codecString) {
    const ids = [];
    const playlists = this.main().playlists;
    const codecs = unwrapCodecList(parseCodecs(codecString));
    const codecCount_ = codecCount(codecs);
    const videoDetails = codecs.video && parseCodecs(codecs.video)[0] || null;
    const audioDetails = codecs.audio && parseCodecs(codecs.audio)[0] || null;

    Object.keys(playlists).forEach((key) => {
      const variant = playlists[key];

      // check if we already processed this playlist.
      // or it if it is already excluded forever.
      if (ids.indexOf(variant.id) !== -1 || variant.excludeUntil === Infinity) {
        return;
      }

      ids.push(variant.id);
      const exclusionReasons = [];

      // get codecs from the playlist for this variant
      const variantCodecs = codecsForPlaylist(this.mainPlaylistLoader_.main, variant);
      const variantCodecCount = codecCount(variantCodecs);

      // if no codecs are listed, we cannot determine that this
      // variant is incompatible. Wait for mux.js to probe
      if (!variantCodecs.audio && !variantCodecs.video) {
        return;
      }

      // TODO: we can support this by removing the
      // old media source and creating a new one, but it will take some work.
      // The number of streams cannot change
      if (variantCodecCount !== codecCount_) {
        exclusionReasons.push(`codec count "${variantCodecCount}" !== "${codecCount_}"`);
      }

      // only exclude playlists by codec change, if codecs cannot switch
      // during playback.
      if (!this.sourceUpdater_.canChangeType()) {
        const variantVideoDetails = variantCodecs.video && parseCodecs(variantCodecs.video)[0] || null;
        const variantAudioDetails = variantCodecs.audio && parseCodecs(variantCodecs.audio)[0] || null;

        // the video codec cannot change
        if (variantVideoDetails && videoDetails && variantVideoDetails.type.toLowerCase() !== videoDetails.type.toLowerCase()) {
          exclusionReasons.push(`video codec "${variantVideoDetails.type}" !== "${videoDetails.type}"`);
        }

        // the audio codec cannot change
        if (variantAudioDetails && audioDetails && variantAudioDetails.type.toLowerCase() !== audioDetails.type.toLowerCase()) {
          exclusionReasons.push(`audio codec "${variantAudioDetails.type}" !== "${audioDetails.type}"`);
        }
      }

      if (exclusionReasons.length) {
        variant.excludeUntil = Infinity;
        this.logger_(`excluding ${variant.id}: ${exclusionReasons.join(' && ')}`);
      }
    });
  }

  updateAdCues_(media) {
    let offset = 0;
    const seekable = this.seekable();

    if (seekable.length) {
      offset = seekable.start(0);
    }

    updateAdCues(media, this.cueTagsTrack_, offset);
  }

  /**
   * Calculates the desired forward buffer length based on current time
   *
   * @return {number} Desired forward buffer length in seconds
   */
  goalBufferLength() {
    const currentTime = this.tech_.currentTime();
    const initial = Config.GOAL_BUFFER_LENGTH;
    const rate = Config.GOAL_BUFFER_LENGTH_RATE;
    const max = Math.max(initial, Config.MAX_GOAL_BUFFER_LENGTH);

    return Math.min(initial + currentTime * rate, max);
  }

  /**
   * Calculates the desired buffer low water line based on current time
   *
   * @return {number} Desired buffer low water line in seconds
   */
  bufferLowWaterLine() {
    const currentTime = this.tech_.currentTime();
    const initial = Config.BUFFER_LOW_WATER_LINE;
    const rate = Config.BUFFER_LOW_WATER_LINE_RATE;
    const max = Math.max(initial, Config.MAX_BUFFER_LOW_WATER_LINE);
    const newMax = Math.max(initial, Config.EXPERIMENTAL_MAX_BUFFER_LOW_WATER_LINE);

    return Math.min(initial + currentTime * rate, this.bufferBasedABR ? newMax : max);
  }

  bufferHighWaterLine() {
    return Config.BUFFER_HIGH_WATER_LINE;
  }

  addDateRangesToTextTrack_(dateRanges) {
    createMetadataTrackIfNotExists(this.inbandTextTracks_, 'com.apple.streaming', this.tech_);
    addDateRangeMetadata({
      inbandTextTracks: this.inbandTextTracks_,
      dateRanges
    });
  }

  addMetadataToTextTrack(dispatchType, metadataArray, videoDuration) {
    const timestampOffset = this.sourceUpdater_.videoBuffer ?
      this.sourceUpdater_.videoTimestampOffset() : this.sourceUpdater_.audioTimestampOffset();

    // There's potentially an issue where we could double add metadata if there's a muxed
    // audio/video source with a metadata track, and an alt audio with a metadata track.
    // However, this probably won't happen, and if it does it can be handled then.
    createMetadataTrackIfNotExists(this.inbandTextTracks_, dispatchType, this.tech_);
    addMetadata({
      inbandTextTracks: this.inbandTextTracks_,
      metadataArray,
      timestampOffset,
      videoDuration
    });
  }

  /**
   * Utility for getting the pathway or service location from an HLS or DASH playlist.
   *
   * @param {Object} playlist for getting pathway from.
   * @return the pathway attribute of a playlist
   */
  pathwayAttribute_(playlist) {
    return playlist.attributes['PATHWAY-ID'] || playlist.attributes.serviceLocation;
  }

  /**
   * Initialize available pathways and apply the tag properties.
   */
  initContentSteeringController_() {
    const main = this.main();

    if (!main.contentSteering) {
      return;
    }
    for (const playlist of main.playlists) {
      this.contentSteeringController_.addAvailablePathway(this.pathwayAttribute_(playlist));
    }
    this.contentSteeringController_.assignTagProperties(main.uri, main.contentSteering);
    // request the steering manifest immediately if queryBeforeStart is set.
    if (this.contentSteeringController_.queryBeforeStart) {
      // When queryBeforeStart is true, initial request should omit steering parameters.
      this.contentSteeringController_.requestSteeringManifest(true);
      return;
    }
    // otherwise start content steering after playback starts
    this.tech_.one('canplay', () => {
      this.contentSteeringController_.requestSteeringManifest();
    });
  }

  /**
   * Reset the content steering controller and re-init.
   */
  resetContentSteeringController_() {
    this.contentSteeringController_.clearAvailablePathways();
    this.contentSteeringController_.dispose();
    this.initContentSteeringController_();
  }

  /**
   * Attaches the listeners for content steering.
   */
  attachContentSteeringListeners_() {
    this.contentSteeringController_.on('content-steering', this.excludeThenChangePathway_.bind(this));
    const contentSteeringEvents = [
      'contentsteeringloadstart',
      'contentsteeringloadcomplete',
      'contentsteeringparsed'
    ];

    contentSteeringEvents.forEach((eventName) => {
      this.contentSteeringController_.on(eventName, (metadata) => {
        this.trigger({...metadata});
      });
    });

    if (this.sourceType_ === 'dash') {
      this.mainPlaylistLoader_.on('loadedplaylist', () => {
        const main = this.main();
        // check if steering tag or pathways changed.
        const didDashTagChange = this.contentSteeringController_.didDASHTagChange(main.uri, main.contentSteering);
        const didPathwaysChange = () => {
          const availablePathways = this.contentSteeringController_.getAvailablePathways();
          const newPathways = [];

          for (const playlist of main.playlists) {
            const serviceLocation = playlist.attributes.serviceLocation;

            if (serviceLocation) {
              newPathways.push(serviceLocation);
              if (!availablePathways.has(serviceLocation)) {
                return true;
              }
            }
          }
          // If we have no new serviceLocations and previously had availablePathways
          if (!newPathways.length && availablePathways.size) {
            return true;
          }
          return false;
        };

        if (didDashTagChange || didPathwaysChange()) {
          this.resetContentSteeringController_();
        }
      });
    }
  }

  /**
   * Simple exclude and change playlist logic for content steering.
   */
  excludeThenChangePathway_() {
    const currentPathway = this.contentSteeringController_.getPathway();

    if (!currentPathway) {
      return;
    }

    this.handlePathwayClones_();

    const main = this.main();
    const playlists = main.playlists;
    const ids = new Set();
    let didEnablePlaylists = false;

    Object.keys(playlists).forEach((key) => {
      const variant = playlists[key];
      const pathwayId = this.pathwayAttribute_(variant);
      const differentPathwayId = pathwayId && currentPathway !== pathwayId;
      const steeringExclusion = variant.excludeUntil === Infinity && variant.lastExcludeReason_ === 'content-steering';

      if (steeringExclusion && !differentPathwayId) {
        delete variant.excludeUntil;
        delete variant.lastExcludeReason_;
        didEnablePlaylists = true;
      }
      const noExcludeUntil = !variant.excludeUntil && variant.excludeUntil !== Infinity;
      const shouldExclude = !ids.has(variant.id) && differentPathwayId && noExcludeUntil;

      if (!shouldExclude) {
        return;
      }
      ids.add(variant.id);
      variant.excludeUntil = Infinity;
      variant.lastExcludeReason_ = 'content-steering';
      // TODO: kind of spammy, maybe move this.
      this.logger_(`excluding ${variant.id} for ${variant.lastExcludeReason_}`);
    });

    if (this.contentSteeringController_.manifestType_ === 'DASH') {
      Object.keys(this.mediaTypes_).forEach((key) => {
        const type = this.mediaTypes_[key];

        if (type.activePlaylistLoader) {
          const currentPlaylist = type.activePlaylistLoader.media_;

          // Check if the current media playlist matches the current CDN
          if (currentPlaylist && currentPlaylist.attributes.serviceLocation !== currentPathway) {
            didEnablePlaylists = true;
          }
        }
      });
    }

    if (didEnablePlaylists) {
      this.changeSegmentPathway_();
    }
  }

  /**
   * Add, update, or delete playlists and media groups for
   * the pathway clones for HLS Content Steering.
   *
   * See https://datatracker.ietf.org/doc/draft-pantos-hls-rfc8216bis/
   *
   * NOTE: Pathway cloning does not currently support the `PER_VARIANT_URIS` and
   * `PER_RENDITION_URIS` as we do not handle `STABLE-VARIANT-ID` or
   * `STABLE-RENDITION-ID` values.
   */
  handlePathwayClones_() {
    const main = this.main();
    const playlists = main.playlists;
    const currentPathwayClones = this.contentSteeringController_.currentPathwayClones;
    const nextPathwayClones = this.contentSteeringController_.nextPathwayClones;

    const hasClones = (currentPathwayClones && currentPathwayClones.size) || (nextPathwayClones && nextPathwayClones.size);

    if (!hasClones) {
      return;
    }

    for (const [id, clone] of currentPathwayClones.entries()) {
      const newClone = nextPathwayClones.get(id);

      // Delete the old pathway clone.
      if (!newClone) {
        this.mainPlaylistLoader_.updateOrDeleteClone(clone);
        this.contentSteeringController_.excludePathway(id);
      }
    }

    for (const [id, clone] of nextPathwayClones.entries()) {
      const oldClone = currentPathwayClones.get(id);

      // Create a new pathway if it is a new pathway clone object.
      if (!oldClone) {
        const playlistsToClone = playlists.filter(p => {
          return p.attributes['PATHWAY-ID'] === clone['BASE-ID'];
        });

        playlistsToClone.forEach((p) => {
          this.mainPlaylistLoader_.addClonePathway(clone, p);
        });

        this.contentSteeringController_.addAvailablePathway(id);
        continue;
      }

      // There have not been changes to the pathway clone object, so skip.
      if (this.equalPathwayClones_(oldClone, clone)) {
        continue;
      }

      // Update a preexisting cloned pathway.
      // True is set for the update flag.
      this.mainPlaylistLoader_.updateOrDeleteClone(clone, true);
      this.contentSteeringController_.addAvailablePathway(id);
    }

    // Deep copy contents of next to current pathways.
    this.contentSteeringController_.currentPathwayClones = new Map(JSON.parse(JSON.stringify([...nextPathwayClones])));
  }

  /**
   * Determines whether two pathway clone objects are equivalent.
   *
   * @param {Object} a The first pathway clone object.
   * @param {Object} b The second pathway clone object.
   * @return {boolean} True if the pathway clone objects are equal, false otherwise.
   */
  equalPathwayClones_(a, b) {
    if (
      a['BASE-ID'] !== b['BASE-ID'] ||
      a.ID !== b.ID ||
      a['URI-REPLACEMENT'].HOST !== b['URI-REPLACEMENT'].HOST
    ) {
      return false;
    }

    const aParams = a['URI-REPLACEMENT'].PARAMS;
    const bParams = b['URI-REPLACEMENT'].PARAMS;

    // We need to iterate through both lists of params because one could be
    // missing a parameter that the other has.
    for (const p in aParams) {
      if (aParams[p] !== bParams[p]) {
        return false;
      }
    }

    for (const p in bParams) {
      if (aParams[p] !== bParams[p]) {
        return false;
      }
    }

    return true;
  }

  /**
   * Changes the current playlists for audio, video and subtitles after a new pathway
   * is chosen from content steering.
   */
  changeSegmentPathway_() {
    const nextPlaylist = this.selectPlaylist();

    this.pauseLoading();

    // Switch audio and text track playlists if necessary in DASH
    if (this.contentSteeringController_.manifestType_ === 'DASH') {
      this.switchMediaForDASHContentSteering_();
    }

    this.switchMedia_(nextPlaylist, 'content-steering');
  }

  /**
   * Iterates through playlists and check their keyId set and compare with the
   * keyStatusMap, only enable playlists that have a usable key. If the playlist
   * has no keyId leave it enabled by default.
   */
  excludeNonUsablePlaylistsByKeyId_() {
    if (!this.mainPlaylistLoader_ || !this.mainPlaylistLoader_.main) {
      return;
    }

    let nonUsableKeyStatusCount = 0;
    const NON_USABLE = 'non-usable';

    this.mainPlaylistLoader_.main.playlists.forEach((playlist) => {
      const keyIdSet = this.mainPlaylistLoader_.getKeyIdSet(playlist);

      // If the playlist doesn't have keyIDs lets not exclude it.
      if (!keyIdSet || !keyIdSet.size) {
        return;
      }
      keyIdSet.forEach((key) => {
        const USABLE = 'usable';
        const hasUsableKeyStatus = this.keyStatusMap_.has(key) && this.keyStatusMap_.get(key) === USABLE;
        const nonUsableExclusion = playlist.lastExcludeReason_ === NON_USABLE && playlist.excludeUntil === Infinity;

        if (!hasUsableKeyStatus) {
          // Only exclude playlists that haven't already been excluded as non-usable.
          if (playlist.excludeUntil !== Infinity && playlist.lastExcludeReason_ !== NON_USABLE) {
            playlist.excludeUntil = Infinity;
            playlist.lastExcludeReason_ = NON_USABLE;
            this.logger_(`excluding playlist ${playlist.id} because the key ID ${key} doesn't exist in the keyStatusMap or is not ${USABLE}`);
          }
          // count all nonUsableKeyStatus
          nonUsableKeyStatusCount++;
        } else if (hasUsableKeyStatus && nonUsableExclusion) {
          delete playlist.excludeUntil;
          delete playlist.lastExcludeReason_;
          this.logger_(`enabling playlist ${playlist.id} because key ID ${key} is ${USABLE}`);
        }
      });
    });

    // If for whatever reason every playlist has a non usable key status. Lets try re-including the SD renditions as a failsafe.
    if (nonUsableKeyStatusCount >= this.mainPlaylistLoader_.main.playlists.length) {
      this.mainPlaylistLoader_.main.playlists.forEach((playlist) => {
        const isNonHD = playlist && playlist.attributes && playlist.attributes.RESOLUTION && playlist.attributes.RESOLUTION.height < 720;
        const excludedForNonUsableKey = playlist.excludeUntil === Infinity && playlist.lastExcludeReason_ === NON_USABLE;

        if (isNonHD && excludedForNonUsableKey) {
          // Only delete the excludeUntil so we don't try and re-exclude these playlists.
          delete playlist.excludeUntil;
          videojs.log.warn(`enabling non-HD playlist ${playlist.id} because all playlists were excluded due to ${NON_USABLE} key IDs`);
        }
      });
    }
  }

  /**
   * Adds a keystatus to the keystatus map, tries to convert to string if necessary.
   *
   * @param {any} keyId the keyId to add a status for
   * @param {string} status the status of the keyId
   */
  addKeyStatus_(keyId, status) {
    const isString = typeof keyId === 'string';
    const keyIdHexString = isString ? keyId : bufferToHexString(keyId);
    const formattedKeyIdString = keyIdHexString.slice(0, 32).toLowerCase();

    this.logger_(`KeyStatus '${status}' with key ID ${formattedKeyIdString} added to the keyStatusMap`);
    this.keyStatusMap_.set(formattedKeyIdString, status);
  }

  /**
   * Utility function for adding key status to the keyStatusMap and filtering usable encrypted playlists.
   *
   * @param {any} keyId the keyId from the keystatuschange event
   * @param {string} status the key status string
   */
  updatePlaylistByKeyStatus(keyId, status) {
    this.addKeyStatus_(keyId, status);
    if (!this.waitingForFastQualityPlaylistReceived_) {
      this.excludeNonUsableThenChangePlaylist_();
    }
    // Listen to loadedplaylist with a single listener and check for new contentProtection elements when a playlist is updated.
    this.mainPlaylistLoader_.off('loadedplaylist', this.excludeNonUsableThenChangePlaylist_.bind(this));
    this.mainPlaylistLoader_.on('loadedplaylist', this.excludeNonUsableThenChangePlaylist_.bind(this));
  }

  excludeNonUsableThenChangePlaylist_() {
    this.excludeNonUsablePlaylistsByKeyId_();
    this.fastQualityChange_();
  }
}
