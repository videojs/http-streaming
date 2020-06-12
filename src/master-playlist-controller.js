/**
 * @file master-playlist-controller.js
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
import Decrypter from 'worker!./decrypter-worker.worker.js';
import Config from './config';
import {
  parseCodecs,
  browserSupportsCodec,
  muxerSupportsCodec,
  DEFAULT_AUDIO_CODEC,
  DEFAULT_VIDEO_CODEC
} from '@videojs/vhs-utils/dist/codecs.js';
import { codecsForPlaylist } from './util/codecs.js';
import { createMediaTypes, setupMediaGroups } from './media-groups';
import logger from './util/logger';

const ABORT_EARLY_BLACKLIST_SECONDS = 60 * 2;

let Hls;

// SegmentLoader stats that need to have each loader's
// values summed to calculate the final value
const loaderStats = [
  'mediaRequests',
  'mediaRequestsAborted',
  'mediaRequestsTimedout',
  'mediaRequestsErrored',
  'mediaTransferDuration',
  'mediaBytesTransferred'
];
const sumLoaderStat = function(stat) {
  return this.audioSegmentLoader_[stat] +
         this.mainSegmentLoader_[stat];
};
const shouldSwitchToMedia = function({
  currentPlaylist,
  nextPlaylist,
  forwardBuffer,
  bufferLowWaterLine,
  duration,
  log
}) {
  // we have no other playlist to switch to
  if (!nextPlaylist) {
    videojs.log.warn('We received no playlist to switch to. Please check your stream.');
    return false;
  }

  // If the playlist is live, then we want to not take low water line into account.
  // This is because in LIVE, the player plays 3 segments from the end of the
  // playlist, and if `BUFFER_LOW_WATER_LINE` is greater than the duration availble
  // in those segments, a viewer will never experience a rendition upswitch.
  if (!currentPlaylist.endList) {
    return true;
  }

  // For the same reason as LIVE, we ignore the low water line when the VOD
  // duration is below the max potential low water line
  if (duration < Config.MAX_BUFFER_LOW_WATER_LINE) {
    return true;
  }

  // we want to switch down to lower resolutions quickly to continue playback, but
  if (nextPlaylist.attributes.BANDWIDTH < currentPlaylist.attributes.BANDWIDTH) {
    return true;
  }

  // ensure we have some buffer before we switch up to prevent us running out of
  // buffer while loading a higher rendition.
  if (forwardBuffer >= bufferLowWaterLine) {
    return true;
  }

  return false;
};

/**
 * the master playlist controller controller all interactons
 * between playlists and segmentloaders. At this time this mainly
 * involves a master playlist and a series of audio playlists
 * if they are available
 *
 * @class MasterPlaylistController
 * @extends videojs.EventTarget
 */
export class MasterPlaylistController extends videojs.EventTarget {
  constructor(options) {
    super();

    const {
      src,
      handleManifestRedirects,
      withCredentials,
      tech,
      bandwidth,
      externHls,
      useCueTags,
      blacklistDuration,
      enableLowInitialPlaylist,
      sourceType,
      cacheEncryptionKeys,
      handlePartialData
    } = options;

    if (!src) {
      throw new Error('A non-empty playlist URL or JSON manifest string is required');
    }

    Hls = externHls;

    this.withCredentials = withCredentials;
    this.tech_ = tech;
    this.hls_ = tech.hls;
    this.sourceType_ = sourceType;
    this.useCueTags_ = useCueTags;
    this.blacklistDuration = blacklistDuration;
    this.enableLowInitialPlaylist = enableLowInitialPlaylist;
    if (this.useCueTags_) {
      this.cueTagsTrack_ = this.tech_.addTextTrack(
        'metadata',
        'ad-cues'
      );
      this.cueTagsTrack_.inBandMetadataTrackDispatchType = '';
    }

    this.requestOptions_ = {
      withCredentials,
      handleManifestRedirects,
      timeout: null
    };

    this.on('error', this.pauseLoading);

    this.mediaTypes_ = createMediaTypes();

    this.mediaSource = new window.MediaSource();

    this.mediaSource.addEventListener('durationchange', () => {
      this.tech_.trigger('durationchange');
    });
    // load the media source into the player
    this.mediaSource.addEventListener('sourceopen', this.handleSourceOpen_.bind(this));
    this.mediaSource.addEventListener('sourceended', this.handleSourceEnded_.bind(this));
    // we don't have to handle sourceclose since dispose will handle termination of
    // everything, and the MediaSource should not be detached without a proper disposal

    this.seekable_ = videojs.createTimeRanges();
    this.hasPlayed_ = false;

    this.syncController_ = new SyncController(options);
    this.segmentMetadataTrack_ = tech.addRemoteTextTrack({
      kind: 'metadata',
      label: 'segment-metadata'
    }, false).track;

    this.decrypter_ = new Decrypter();
    this.sourceUpdater_ = new SourceUpdater(this.mediaSource);
    this.inbandTextTracks_ = {};
    this.timelineChangeController_ = new TimelineChangeController();

    const segmentLoaderSettings = {
      hls: this.hls_,
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
      handlePartialData,
      sourceUpdater: this.sourceUpdater_,
      timelineChangeController: this.timelineChangeController_
    };

    // The source type check not only determines whether a special DASH playlist loader
    // should be used, but also covers the case where the provided src is a vhs-json
    // manifest object (instead of a URL). In the case of vhs-json, the default
    // PlaylistLoader should be used.
    this.masterPlaylistLoader_ = this.sourceType_ === 'dash' ?
      new DashPlaylistLoader(src, this.hls_, this.requestOptions_) :
      new PlaylistLoader(src, this.hls_, this.requestOptions_);
    this.setupMasterPlaylistLoaderListeners_();

    // setup segment loaders
    // combined audio/video or just video when alternate audio track is selected
    this.mainSegmentLoader_ =
      new SegmentLoader(videojs.mergeOptions(segmentLoaderSettings, {
        segmentMetadataTrack: this.segmentMetadataTrack_,
        loaderType: 'main'
      }), options);

    // alternate audio track
    this.audioSegmentLoader_ =
      new SegmentLoader(videojs.mergeOptions(segmentLoaderSettings, {
        loaderType: 'audio'
      }), options);

    this.subtitleSegmentLoader_ =
      new VTTSegmentLoader(videojs.mergeOptions(segmentLoaderSettings, {
        loaderType: 'vtt',
        featuresNativeTextTracks: this.tech_.featuresNativeTextTracks
      }), options);

    this.setupSegmentLoaderListeners_();

    // Create SegmentLoader stat-getters
    // mediaRequests_
    // mediaRequestsAborted_
    // mediaRequestsTimedout_
    // mediaRequestsErrored_
    // mediaTransferDuration_
    // mediaBytesTransferred_
    loaderStats.forEach((stat) => {
      this[stat + '_'] = sumLoaderStat.bind(this, stat);
    });

    this.logger_ = logger('MPC');

    this.triggeredFmp4Usage = false;
    this.masterPlaylistLoader_.load();
  }

  /**
   * Register event handlers on the master playlist loader. A helper
   * function for construction time.
   *
   * @private
   */
  setupMasterPlaylistLoaderListeners_() {
    this.masterPlaylistLoader_.on('loadedmetadata', () => {
      const media = this.masterPlaylistLoader_.media();
      const requestTimeout = (media.targetDuration * 1.5) * 1000;

      // If we don't have any more available playlists, we don't want to
      // timeout the request.
      if (isLowestEnabledRendition(this.masterPlaylistLoader_.master, this.masterPlaylistLoader_.media())) {
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
        masterPlaylistLoader: this.masterPlaylistLoader_,
        hls: this.hls_,
        master: this.master(),
        mediaTypes: this.mediaTypes_,
        blacklistCurrentPlaylist: this.blacklistCurrentPlaylist.bind(this)
      });

      this.triggerPresenceUsage_(this.master(), media);
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

    this.masterPlaylistLoader_.on('loadedplaylist', () => {
      let updatedPlaylist = this.masterPlaylistLoader_.media();

      if (!updatedPlaylist) {
        let selectedMedia;

        if (this.enableLowInitialPlaylist) {
          selectedMedia = this.selectInitialPlaylist();
        }

        if (!selectedMedia) {
          selectedMedia = this.selectPlaylist();
        }

        this.initialMedia_ = selectedMedia;
        this.masterPlaylistLoader_.media(this.initialMedia_);

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

    this.masterPlaylistLoader_.on('error', () => {
      this.blacklistCurrentPlaylist(this.masterPlaylistLoader_.error);
    });

    this.masterPlaylistLoader_.on('mediachanging', () => {
      this.mainSegmentLoader_.abort();
      this.mainSegmentLoader_.pause();
    });

    this.masterPlaylistLoader_.on('mediachange', () => {
      const media = this.masterPlaylistLoader_.media();
      const requestTimeout = (media.targetDuration * 1.5) * 1000;

      // If we don't have any more available playlists, we don't want to
      // timeout the request.
      if (isLowestEnabledRendition(this.masterPlaylistLoader_.master, this.masterPlaylistLoader_.media())) {
        this.requestOptions_.timeout = 0;
      } else {
        this.requestOptions_.timeout = requestTimeout;
      }

      // TODO: Create a new event on the PlaylistLoader that signals
      // that the segments have changed in some way and use that to
      // update the SegmentLoader instead of doing it twice here and
      // on `loadedplaylist`
      this.mainSegmentLoader_.playlist(media, this.requestOptions_);

      this.mainSegmentLoader_.load();

      this.tech_.trigger({
        type: 'mediachange',
        bubbles: true
      });
    });

    this.masterPlaylistLoader_.on('playlistunchanged', () => {
      const updatedPlaylist = this.masterPlaylistLoader_.media();
      const playlistOutdated = this.stuckAtPlaylistEnd_(updatedPlaylist);

      if (playlistOutdated) {
        // Playlist has stopped updating and we're stuck at its end. Try to
        // blacklist it and switch to another playlist in the hope that that
        // one is updating (and give the player a chance to re-adjust to the
        // safe live point).
        this.blacklistCurrentPlaylist({
          message: 'Playlist no longer updating.'
        });
        // useful for monitoring QoS
        this.tech_.trigger('playliststuck');
      }
    });

    this.masterPlaylistLoader_.on('renditiondisabled', () => {
      this.tech_.trigger({type: 'usage', name: 'hls-rendition-disabled'});
    });
    this.masterPlaylistLoader_.on('renditionenabled', () => {
      this.tech_.trigger({type: 'usage', name: 'hls-rendition-enabled'});
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
    this.mainSegmentLoader_.playlist(updatedPlaylist, this.requestOptions_);
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
  triggerPresenceUsage_(master, media) {
    const mediaGroups = master.mediaGroups || {};
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
      this.tech_.trigger({type: 'usage', name: 'hls-demuxed'});
    }

    if (Object.keys(mediaGroups.SUBTITLES).length) {
      this.tech_.trigger({type: 'usage', name: 'hls-webvtt'});
    }

    if (Hls.Playlist.isAes(media)) {
      this.tech_.trigger({type: 'usage', name: 'hls-aes'});
    }

    if (audioGroupKeys.length &&
        Object.keys(mediaGroups.AUDIO[audioGroupKeys[0]]).length > 1) {
      this.tech_.trigger({type: 'usage', name: 'hls-alternate-audio'});
    }

    if (this.useCueTags_) {
      this.tech_.trigger({type: 'usage', name: 'hls-playlist-cue-tags'});
    }
  }
  /**
   * Register event handlers on the segment loaders. A helper function
   * for construction time.
   *
   * @private
   */
  setupSegmentLoaderListeners_() {
    this.mainSegmentLoader_.on('bandwidthupdate', () => {
      const nextPlaylist = this.selectPlaylist();
      const currentPlaylist = this.masterPlaylistLoader_.media();
      const buffered = this.tech_.buffered();
      const forwardBuffer = buffered.length ?
        buffered.end(buffered.length - 1) - this.tech_.currentTime() : 0;

      const bufferLowWaterLine = this.bufferLowWaterLine();

      if (shouldSwitchToMedia({
        currentPlaylist,
        nextPlaylist,
        forwardBuffer,
        bufferLowWaterLine,
        duration: this.duration(),
        log: this.logger_
      })) {
        this.masterPlaylistLoader_.media(nextPlaylist);
      }

      this.tech_.trigger('bandwidthupdate');
    });
    this.mainSegmentLoader_.on('progress', () => {
      this.trigger('progress');
    });

    this.mainSegmentLoader_.on('error', () => {
      this.blacklistCurrentPlaylist(this.mainSegmentLoader_.error());
    });

    this.mainSegmentLoader_.on('appenderror', () => {
      this.error = this.mainSegmentLoader_.error_;
      this.trigger('error');
    });

    this.mainSegmentLoader_.on('syncinfoupdate', () => {
      this.onSyncInfoUpdate_();
    });

    this.mainSegmentLoader_.on('timestampoffset', () => {
      this.tech_.trigger({type: 'usage', name: 'hls-timestamp-offset'});
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

    this.mainSegmentLoader_.on('earlyabort', () => {
      this.blacklistCurrentPlaylist({
        message: 'Aborted early because there isn\'t enough bandwidth to complete the ' +
          'request without rebuffering.'
      }, ABORT_EARLY_BLACKLIST_SECONDS);
    });

    this.mainSegmentLoader_.on('trackinfo', () => {
      this.tryToCreateSourceBuffers_();
    });

    this.mainSegmentLoader_.on('fmp4', () => {
      if (!this.triggeredFmp4Usage) {
        this.tech_.trigger({type: 'usage', name: 'hls-fmp4'});
        this.triggeredFmp4Usage = true;
      }
    });

    this.audioSegmentLoader_.on('fmp4', () => {
      if (!this.triggeredFmp4Usage) {
        this.tech_.trigger({type: 'usage', name: 'hls-fmp4'});
        this.triggeredFmp4Usage = true;
      }
    });

    this.audioSegmentLoader_.on('ended', () => {
      this.logger_('audioSegmentLoader ended');
      this.onEndOfStream();
    });

    this.audioSegmentLoader_.on('trackinfo', () => {
      this.tryToCreateSourceBuffers_();
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
   * Re-tune playback quality level for the current player
   * conditions without performing destructive actions, like
   * removing already buffered content
   *
   * @private
   */
  smoothQualityChange_() {
    const media = this.selectPlaylist();

    if (media !== this.masterPlaylistLoader_.media()) {
      this.masterPlaylistLoader_.media(media);

      this.mainSegmentLoader_.resetLoader();
      // don't need to reset audio as it is reset when media changes
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
  fastQualityChange_() {
    const media = this.selectPlaylist();

    if (media === this.masterPlaylistLoader_.media()) {
      return;
    }

    this.masterPlaylistLoader_.media(media);

    // Delete all buffered data to allow an immediate quality switch, then seek to give
    // the browser a kick to remove any cached frames from the previous rendtion (.04 seconds
    // ahead is roughly the minimum that will accomplish this across a variety of content
    // in IE and Edge, but seeking in place is sufficient on all other browsers)
    // Edge/IE bug: https://developer.microsoft.com/en-us/microsoft-edge/platform/issues/14600375/
    // Chrome bug: https://bugs.chromium.org/p/chromium/issues/detail?id=651904
    this.mainSegmentLoader_.resetEverything(() => {
      // Since this is not a typical seek, we avoid the seekTo method which can cause segments
      // from the previously enabled rendition to load before the new playlist has finished loading
      if (videojs.browser.IE_VERSION || videojs.browser.IS_EDGE) {
        this.tech_.setCurrentTime(this.tech_.currentTime() + 0.04);
      } else {
        this.tech_.setCurrentTime(this.tech_.currentTime());
      }
    });

    // don't need to reset audio as it is reset when media changes
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
    const media = this.masterPlaylistLoader_.media();

    // Check that everything is ready to begin buffering for the first call to play
    //  If 1) there is no active media
    //     2) the player is paused
    //     3) the first play has already been setup
    // then exit early
    if (!media || this.tech_.paused() || this.hasPlayed_) {
      return false;
    }

    // when the video is a live stream
    if (!media.endList) {
      const seekable = this.seekable();

      if (!seekable.length) {
        // without a seekable range, the player cannot seek to begin buffering at the live
        // point
        return false;
      }

      if (videojs.browser.IE_VERSION &&
          this.tech_.readyState() === 0) {
        // IE11 throws an InvalidStateError if you try to set currentTime while the
        // readyState is 0, so it must be delayed until the tech fires loadedmetadata.
        this.tech_.one('loadedmetadata', () => {
          this.trigger('firstplay');
          this.tech_.setCurrentTime(seekable.end(0));
          this.hasPlayed_ = true;
        });

        return false;
      }

      // trigger firstplay to inform the source handler to ignore the next seek event
      this.trigger('firstplay');
      // seek to the live point
      this.tech_.setCurrentTime(seekable.end(0));
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
    try {
      this.tryToCreateSourceBuffers_();
    } catch (e) {
      videojs.log.warn('Failed to create Source Buffers', e);
      if (this.mediaSource.readyState !== 'open') {
        this.trigger('error');
      } else {
        this.sourceUpdater_.endOfStream('decode');
      }
      return;
    }

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
      // if the audio playlist loader exists, then alternate audio is active
      if (!this.mainSegmentLoader_.startingMedia_ ||
          this.mainSegmentLoader_.startingMedia_.hasVideo) {
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
    const absolutePlaylistEnd = Hls.Playlist.playlistEnd(playlist, expired);
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
   * Blacklists a playlist when an error occurs for a set amount of time
   * making it unavailable for selection by the rendition selection algorithm
   * and then forces a new playlist (rendition) selection.
   *
   * @param {Object=} error an optional error that may include the playlist
   * to blacklist
   * @param {number=} blacklistDuration an optional number of seconds to blacklist the
   * playlist
   */
  blacklistCurrentPlaylist(error = {}, blacklistDuration) {
    // If the `error` was generated by the playlist loader, it will contain
    // the playlist we were trying to load (but failed) and that should be
    // blacklisted instead of the currently selected playlist which is likely
    // out-of-date in this scenario
    const currentPlaylist = error.playlist || this.masterPlaylistLoader_.media();

    blacklistDuration = blacklistDuration ||
                        error.blacklistDuration ||
                        this.blacklistDuration;

    // If there is no current playlist, then an error occurred while we were
    // trying to load the master OR while we were disposing of the tech
    if (!currentPlaylist) {
      this.error = error;

      if (this.mediaSource.readyState !== 'open') {
        this.trigger('error');
      } else {
        this.sourceUpdater_.endOfStream('network');
      }

      return;
    }

    const playlists = this.masterPlaylistLoader_.master.playlists;
    const enabledPlaylists = playlists.filter(isEnabled);
    const isFinalRendition = enabledPlaylists.length === 1 && enabledPlaylists[0] === currentPlaylist;

    // Don't blacklist the only playlist unless it was blacklisted
    // forever
    if (playlists.length === 1 && blacklistDuration !== Infinity) {
      videojs.log.warn(`Problem encountered with playlist ${currentPlaylist.id}. ` +
                       'Trying again since it is the only playlist.');

      this.tech_.trigger('retryplaylist');
      return this.masterPlaylistLoader_.load(isFinalRendition);
    }

    if (isFinalRendition) {
      // Since we're on the final non-blacklisted playlist, and we're about to blacklist
      // it, instead of erring the player or retrying this playlist, clear out the current
      // blacklist. This allows other playlists to be attempted in case any have been
      // fixed.
      let reincluded = false;

      playlists.forEach((playlist) => {
        // skip current playlist which is about to be blacklisted
        if (playlist === currentPlaylist) {
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

    // Blacklist this playlist
    currentPlaylist.excludeUntil = Date.now() + (blacklistDuration * 1000);
    this.tech_.trigger('blacklistplaylist');
    this.tech_.trigger({type: 'usage', name: 'hls-rendition-blacklisted'});

    // Select a new playlist
    const nextPlaylist = this.selectPlaylist();

    if (!nextPlaylist) {
      this.error = 'Playback cannot continue. No available working or supported playlists.';
      this.trigger('error');
      return;
    }
    const logFn = error.internal ? this.logger_ : videojs.log.warn;
    const errorMessage = error.message ? (' ' + error.message) : '';

    logFn(`${(error.internal ? 'Internal problem' : 'Problem')} encountered with playlist ${currentPlaylist.id}.` +
      `${errorMessage} Switching to playlist ${nextPlaylist.id}.`);

    return this.masterPlaylistLoader_.media(nextPlaylist, isFinalRendition);
  }

  /**
   * Pause all segment/playlist loaders
   */
  pauseLoading() {
    // pause all segment loaders
    this.mainSegmentLoader_.pause();
    if (this.mediaTypes_.AUDIO.activePlaylistLoader) {
      this.audioSegmentLoader_.pause();
    }
    if (this.mediaTypes_.SUBTITLES.activePlaylistLoader) {
      this.subtitleSegmentLoader_.pause();
    }

    // pause all playlist loaders
    this.masterPlaylistLoader_.pause();
    Object.keys(this.mediaTypes_).forEach((type) => {
      if (this.mediaTypes_[type].activePlaylistLoader) {
        this.mediaTypes_[type].activePlaylistLoader.pause();
      }
    });
  }

  /**
   * set the current time on all segment loaders
   *
   * @param {TimeRange} currentTime the current time to set
   * @return {TimeRange} the current time
   */
  setCurrentTime(currentTime) {
    const buffered = Ranges.findRange(this.tech_.buffered(), currentTime);

    if (!(this.masterPlaylistLoader_ && this.masterPlaylistLoader_.media())) {
      // return immediately if the metadata is not ready yet
      return 0;
    }

    // it's clearly an edge-case but don't thrown an error if asked to
    // seek within an empty playlist
    if (!this.masterPlaylistLoader_.media().segments) {
      return 0;
    }

    // if the seek location is already buffered, continue buffering as usual
    if (buffered && buffered.length) {
      return currentTime;
    }

    // cancel outstanding requests so we begin buffering at the new
    // location
    this.mainSegmentLoader_.resetEverything();
    this.mainSegmentLoader_.abort();
    if (this.mediaTypes_.AUDIO.activePlaylistLoader) {
      this.audioSegmentLoader_.resetEverything();
      this.audioSegmentLoader_.abort();
    }
    if (this.mediaTypes_.SUBTITLES.activePlaylistLoader) {
      this.subtitleSegmentLoader_.resetEverything();
      this.subtitleSegmentLoader_.abort();
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
    if (!this.masterPlaylistLoader_) {
      return 0;
    }

    const media = this.masterPlaylistLoader_.media();

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

    return Hls.Playlist.duration(media);
  }

  /**
   * check the seekable range
   *
   * @return {TimeRange} the seekable range
   */
  seekable() {
    return this.seekable_;
  }

  onSyncInfoUpdate_() {
    let audioSeekable;

    if (!this.masterPlaylistLoader_) {
      return;
    }

    let media = this.masterPlaylistLoader_.media();

    if (!media) {
      return;
    }

    let expired = this.syncController_.getExpiredTime(media, this.duration());

    if (expired === null) {
      // not enough information to update seekable
      return;
    }

    const suggestedPresentationDelay = this.masterPlaylistLoader_.master.suggestedPresentationDelay;
    const mainSeekable = Hls.Playlist.seekable(media, expired, suggestedPresentationDelay);

    if (mainSeekable.length === 0) {
      return;
    }

    if (this.mediaTypes_.AUDIO.activePlaylistLoader) {
      media = this.mediaTypes_.AUDIO.activePlaylistLoader.media();
      expired = this.syncController_.getExpiredTime(media, this.duration());

      if (expired === null) {
        return;
      }

      audioSeekable = Hls.Playlist.seekable(media, expired, suggestedPresentationDelay);

      if (audioSeekable.length === 0) {
        return;
      }
    }

    let oldEnd;
    let oldStart;

    if (this.seekable_ && this.seekable_.length) {
      oldEnd = this.seekable_.end(0);
      oldStart = this.seekable_.start(0);
    }

    if (!audioSeekable) {
      // seekable has been calculated based on buffering video data so it
      // can be returned directly
      this.seekable_ = mainSeekable;
    } else if (audioSeekable.start(0) > mainSeekable.end(0) ||
               mainSeekable.start(0) > audioSeekable.end(0)) {
      // seekables are pretty far off, rely on main
      this.seekable_ = mainSeekable;
    } else {
      this.seekable_ = videojs.createTimeRanges([[
        (audioSeekable.start(0) > mainSeekable.start(0)) ? audioSeekable.start(0) :
          mainSeekable.start(0),
        (audioSeekable.end(0) < mainSeekable.end(0)) ? audioSeekable.end(0) :
          mainSeekable.end(0)
      ]]);
    }

    // seekable is the same as last time
    if (this.seekable_ && this.seekable_.length) {
      if (this.seekable_.end(0) === oldEnd && this.seekable_.start(0) === oldStart) {
        return;
      }
    }

    this.logger_(`seekable updated [${Ranges.printableRange(this.seekable_)}]`);

    this.tech_.trigger('seekablechanged');
  }

  /**
   * Update the player duration
   */
  updateDuration(isLive) {
    if (this.mediaSource.readyState !== 'open') {
      this.mediaSource.addEventListener('sourceopen', this.updateDuration.bind(this, isLive));
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
    let duration = Hls.Playlist.duration(this.masterPlaylistLoader_.media());

    if (buffered.length > 0) {
      duration = Math.max(duration, buffered.end(buffered.length - 1));
    }

    if (this.mediaSource.duration !== duration) {
      this.sourceUpdater_.setDuration(duration);
    }
  }

  /**
   * dispose of the MasterPlaylistController and everything
   * that it controls
   */
  dispose() {
    this.trigger('dispose');
    this.decrypter_.terminate();
    this.masterPlaylistLoader_.dispose();
    this.mainSegmentLoader_.dispose();

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
    this.off();
  }

  /**
   * return the master playlist object if we have one
   *
   * @return {Object} the master playlist object that we parsed
   */
  master() {
    return this.masterPlaylistLoader_.master;
  }

  /**
   * return the currently selected playlist
   *
   * @return {Object} the currently selected playlist object that we parsed
   */
  media() {
    // playlist loader will not return media if it has not been fully loaded
    return this.masterPlaylistLoader_.media() || this.initialMedia_;
  }

  /**
   * Create source buffers and exlude any incompatible renditions.
   *
   * @private
   */
  tryToCreateSourceBuffers_() {
    // media source is not ready yet
    if (this.mediaSource.readyState !== 'open') {
      return;
    }

    // source buffers are already created
    if (this.sourceUpdater_.ready()) {
      return;
    }

    const mainStartingMedia = this.mainSegmentLoader_.startingMedia_;
    const hasAltAudio = !!this.mediaTypes_.AUDIO.activePlaylistLoader;

    // Because a URI is required for EXT-X-STREAM-INF tags (therefore, there must always
    // be a playlist, even for audio only playlists with alt audio), a segment will always
    // be downloaded for the main segment loader, and the track info parsed from it.
    // Therefore we must always wait for the segment loader's track info.
    if (!mainStartingMedia || (hasAltAudio && !this.audioSegmentLoader_.startingMedia_)) {
      return;
    }
    const audioStartingMedia = this.audioSegmentLoader_ && this.audioSegmentLoader_.startingMedia_ || {};
    const media = this.masterPlaylistLoader_.media();
    const playlistCodecs = codecsForPlaylist(this.masterPlaylistLoader_.master, media);
    const codecs = {};

    // priority of codecs: playlist -> mux.js parsed codecs -> default
    if (mainStartingMedia.isMuxed) {
      codecs.video = playlistCodecs.video || mainStartingMedia.videoCodec || DEFAULT_VIDEO_CODEC;
      codecs.video += ',' + (playlistCodecs.audio || mainStartingMedia.audioCodec || DEFAULT_AUDIO_CODEC);
      if (hasAltAudio) {
        codecs.audio = playlistCodecs.audio ||
          audioStartingMedia.audioCodec ||
          DEFAULT_AUDIO_CODEC;
      }
    } else {
      if (mainStartingMedia.hasAudio || hasAltAudio) {
        codecs.audio = playlistCodecs.audio ||
          mainStartingMedia.audioCodec ||
          audioStartingMedia.audioCodec ||
          DEFAULT_AUDIO_CODEC;
      }

      if (mainStartingMedia.hasVideo) {
        codecs.video =
          playlistCodecs.video ||
          mainStartingMedia.videoCodec ||
          DEFAULT_VIDEO_CODEC;
      }
    }

    // fmp4 relies on browser support, while ts relies on muxer support
    const supportFunction = mainStartingMedia.isFmp4 ? browserSupportsCodec : muxerSupportsCodec;
    const unsupportedCodecs = [];

    ['audio', 'video'].forEach(function(type) {
      if (codecs.hasOwnProperty(type) && !supportFunction(codecs[type])) {
        unsupportedCodecs.push(codecs[type]);
      }
    });

    // if we have any unsupported codecs blacklist this playlist.
    if (unsupportedCodecs.length) {
      const supporter = mainStartingMedia.isFmp4 ? 'browser' : 'muxer';

      // reset startingMedia_ when the intial playlist is blacklisted.
      this.mainSegmentLoader_.startingMedia_ = void 0;

      this.blacklistCurrentPlaylist({
        playlist: media,
        message: `${supporter} does not support codec(s): "${unsupportedCodecs.join(',')}".`,
        internal: true
      }, Infinity);
      return;
    }

    if (!codecs.video && !codecs.audio) {
      const error = 'Failed to create SourceBuffers. No compatible SourceBuffer ' +
        'configuration for the variant stream:' + media.resolvedUri;

      videojs.log.warn(error);
      this.error = error;

      if (this.mediaSource.readyState !== 'open') {
        this.trigger('error');
      } else {
        this.sourceUpdater_.endOfStream('decode');
      }
    }

    try {
      this.sourceUpdater_.createSourceBuffers(codecs);
    } catch (e) {
      const error = 'Failed to create SourceBuffers: ' + e;

      videojs.log.warn(error);
      this.error = error;
      if (this.mediaSource.readyState !== 'open') {
        this.trigger('error');
      } else {
        this.sourceUpdater_.endOfStream('decode');
      }
      return;
    }

    const codecString = [codecs.video, codecs.audio].filter(Boolean).join(',');

    // TODO:
    // blacklisting incompatible renditions will have to change
    // once we add support for `changeType` on source buffers.
    // We will have to not blacklist any rendition until we try to
    // switch to it and learn that it is incompatible and if it is compatible
    // we `changeType` on the sourceBuffer.
    this.excludeIncompatibleVariants_(codecString);
  }

  /**
   * Blacklist playlists that are known to be codec or
   * stream-incompatible with the SourceBuffer configuration. For
   * instance, Media Source Extensions would cause the video element to
   * stall waiting for video data if you switched from a variant with
   * video and audio to an audio-only one.
   *
   * @param {Object} media a media playlist compatible with the current
   * set of SourceBuffers. Variants in the current master playlist that
   * do not appear to have compatible codec or stream configurations
   * will be excluded from the default playlist selection algorithm
   * indefinitely.
   * @private
   */
  excludeIncompatibleVariants_(codecString) {
    const codecs = parseCodecs(codecString);
    const codecCount = Object.keys(codecs).length;

    this.master().playlists.forEach((variant) => {
      // skip variants that are already blacklisted forever
      if (variant.excludeUntil === Infinity) {
        return;
      }
      /* TODO: Decide whether two codecs should be assumed here.
       * Right now, for playlists that don't specify codecs, VHS assumes
       * that there are two (one for audio and one for video).
       * Although this is often the case, this may lead to broken behavior
       * if the playlist only has one codec. It may be better in the future
       * to decide at time of segment download how many tracks there are and
       * determine the proper codecs. This will come at a cost of potentially
       * more bandwidth, but will be a more robust approach than the assumption here.
       */

      let variantCodecs = {};
      let variantCodecCount = 2;
      const blacklistReasons = [];

      // get codecs from the playlist for this variant
      const variantCodecStrings = codecsForPlaylist(this.masterPlaylistLoader_.master, variant);

      if (variantCodecStrings.audio || variantCodecStrings.video) {
        const variantCodecString = [variantCodecStrings.video, variantCodecStrings.audio]
          .filter(Boolean)
          .join(',');

        variantCodecs = parseCodecs(variantCodecString);
        variantCodecCount = Object.keys(variantCodecs).length;
      }

      // The number of streams cannot change
      if (variantCodecCount !== codecCount) {
        blacklistReasons.push(`codec count "${variantCodecCount}" !== "${codecCount}"`);
        variant.excludeUntil = Infinity;
      }

      // the video codec cannot change
      if (variantCodecs.video && codecs.video &&
        variantCodecs.video.type.toLowerCase() !== codecs.video.type.toLowerCase()) {
        blacklistReasons.push(`video codec "${variantCodecs.video.type}" !== "${codecs.video.type}"`);
        variant.excludeUntil = Infinity;
      }

      // the audio codec cannot change
      if (variantCodecs.audio && codecs.audio &&
        variantCodecs.audio.type.toLowerCase() !== codecs.audio.type.toLowerCase()) {
        variant.excludeUntil = Infinity;
        blacklistReasons.push(`audio codec "${variantCodecs.audio.type}" !== "${codecs.audio.type}"`);
      }

      if (blacklistReasons.length) {
        this.logger_(`blacklisting ${variant.id}: ${blacklistReasons.join(' && ')}`);
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

    return Math.min(initial + currentTime * rate, max);
  }

}
