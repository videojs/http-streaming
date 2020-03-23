/**
 * @file master-playlist-controller.js
 */
import window from 'global/window';
import PlaylistLoader from './playlist-loader';
import DashPlaylistLoader from './dash-playlist-loader';
import { isEnabled, isLowestEnabledRendition } from './playlist.js';
import SegmentLoader from './segment-loader';
import VTTSegmentLoader from './vtt-segment-loader';
import * as Ranges from './ranges';
import videojs from 'video.js';
import { updateAdCues } from './ad-cue-tags';
import SyncController from './sync-controller';
import Decrypter from 'worker!./decrypter-worker.worker.js';
import Config from './config';
import {
  parseCodecs,
  mapLegacyAvcCodecs,
  mimeTypesForPlaylist
} from './util/codecs.js';
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
  currentPlaylist, nextPlaylist, forwardBuffer, bufferLowWaterLine, duration
}) {
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

    let {
      url,
      handleManifestRedirects,
      withCredentials,
      tech,
      bandwidth,
      externHls,
      useCueTags,
      blacklistDuration,
      enableLowInitialPlaylist,
      sourceType,
      seekTo,
      cacheEncryptionKeys
    } = options;

    if (!url) {
      throw new Error('A non-empty playlist URL is required');
    }

    Hls = externHls;

    this.withCredentials = withCredentials;
    this.tech_ = tech;
    this.hls_ = tech.hls;
    this.seekTo_ = seekTo;
    this.sourceType_ = sourceType;
    this.useCueTags_ = useCueTags;
    this.blacklistDuration = blacklistDuration;
    this.enableLowInitialPlaylist = enableLowInitialPlaylist;
    if (this.useCueTags_) {
      this.cueTagsTrack_ = this.tech_.addTextTrack('metadata',
        'ad-cues');
      this.cueTagsTrack_.inBandMetadataTrackDispatchType = '';
    }

    this.requestOptions_ = {
      withCredentials,
      handleManifestRedirects,
      timeout: null
    };

    this.mediaTypes_ = createMediaTypes();

    this.mediaSource = new videojs.MediaSource();

    // load the media source into the player
    this.mediaSource.addEventListener('sourceopen', this.handleSourceOpen_.bind(this));

    this.seekable_ = videojs.createTimeRanges();
    this.hasPlayed_ = false;

    this.syncController_ = new SyncController(options);
    this.segmentMetadataTrack_ = tech.addRemoteTextTrack({
      kind: 'metadata',
      label: 'segment-metadata'
    }, false).track;

    this.decrypter_ = new Decrypter();
    this.inbandTextTracks_ = {};

    const segmentLoaderSettings = {
      hls: this.hls_,
      mediaSource: this.mediaSource,
      currentTime: this.tech_.currentTime.bind(this.tech_),
      seekable: () => this.seekable(),
      seeking: () => this.tech_.seeking(),
      duration: () => this.mediaSource.duration,
      hasPlayed: () => this.hasPlayed_,
      goalBufferLength: () => this.goalBufferLength(),
      bandwidth,
      syncController: this.syncController_,
      decrypter: this.decrypter_,
      sourceType: this.sourceType_,
      inbandTextTracks: this.inbandTextTracks_,
      cacheEncryptionKeys
    };

    this.masterPlaylistLoader_ = this.sourceType_ === 'dash' ?
      new DashPlaylistLoader(url, this.hls_, this.requestOptions_) :
      new PlaylistLoader(url, this.hls_, this.requestOptions_);
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
    loaderStats.forEach((stat) => {
      this[stat + '_'] = sumLoaderStat.bind(this, stat);
    });

    this.logger_ = logger('MPC');

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
      let media = this.masterPlaylistLoader_.media();
      let requestTimeout = (media.targetDuration * 1.5) * 1000;

      // If we don't have any more available playlists, we don't want to
      // timeout the request.
      if (isLowestEnabledRendition(
            this.masterPlaylistLoader_.master, this.masterPlaylistLoader_.media())) {
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

      try {
        this.setupSourceBuffers_();
      } catch (e) {
        videojs.log.warn('Failed to create SourceBuffers', e);
        return this.mediaSource.endOfStream('decode');
      }
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
        // blacklist any variants that are not supported by the browser before selecting
        // an initial media as the playlist selectors do not consider browser support
        this.excludeUnsupportedVariants_();

        let selectedMedia;

        if (this.enableLowInitialPlaylist) {
          selectedMedia = this.selectInitialPlaylist();
        }

        if (!selectedMedia) {
          selectedMedia = this.selectPlaylist();
        }

        this.initialMedia_ = selectedMedia;
        this.masterPlaylistLoader_.media(this.initialMedia_);
        return;
      }

      if (this.useCueTags_) {
        this.updateAdCues_(updatedPlaylist);
      }

      // TODO: Create a new event on the PlaylistLoader that signals
      // that the segments have changed in some way and use that to
      // update the SegmentLoader instead of doing it twice here and
      // on `mediachange`
      this.mainSegmentLoader_.playlist(updatedPlaylist, this.requestOptions_);
      this.updateDuration();

      // If the player isn't paused, ensure that the segment loader is running,
      // as it is possible that it was temporarily stopped while waiting for
      // a playlist (e.g., in case the playlist errored and we re-requested it).
      if (!this.tech_.paused()) {
        this.mainSegmentLoader_.load();
        if (this.audioSegmentLoader_) {
          this.audioSegmentLoader_.load();
        }
      }

      if (!updatedPlaylist.endList) {
        let addSeekableRange = () => {
          let seekable = this.seekable();

          if (seekable.length !== 0) {
            this.mediaSource.addSeekableRange_(seekable.start(0), seekable.end(0));
          }
        };

        if (this.duration() !== Infinity) {
          let onDurationchange = () => {
            if (this.duration() === Infinity) {
              addSeekableRange();
            } else {
              this.tech_.one('durationchange', onDurationchange);
            }
          };

          this.tech_.one('durationchange', onDurationchange);
        } else {
          addSeekableRange();
        }
      }
    });

    this.masterPlaylistLoader_.on('error', () => {
      this.blacklistCurrentPlaylist(this.masterPlaylistLoader_.error);
    });

    this.masterPlaylistLoader_.on('mediachanging', () => {
      this.mainSegmentLoader_.abort();
      this.mainSegmentLoader_.pause();
    });

    this.masterPlaylistLoader_.on('mediachange', () => {
      let media = this.masterPlaylistLoader_.media();
      let requestTimeout = (media.targetDuration * 1.5) * 1000;

      // If we don't have any more available playlists, we don't want to
      // timeout the request.
      if (isLowestEnabledRendition(
            this.masterPlaylistLoader_.master, this.masterPlaylistLoader_.media())) {
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
      let updatedPlaylist = this.masterPlaylistLoader_.media();
      let playlistOutdated = this.stuckAtPlaylistEnd_(updatedPlaylist);

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
   * A helper function for triggerring presence usage events once per source
   *
   * @private
   */
  triggerPresenceUsage_(master, media) {
    let mediaGroups = master.mediaGroups || {};
    let defaultDemuxed = true;
    let audioGroupKeys = Object.keys(mediaGroups.AUDIO);

    for (let mediaGroup in mediaGroups.AUDIO) {
      for (let label in mediaGroups.AUDIO[mediaGroup]) {
        let properties = mediaGroups.AUDIO[mediaGroup][label];

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

    if (Hls.Playlist.isFmp4(media)) {
      this.tech_.trigger({type: 'usage', name: 'hls-fmp4'});
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
            duration: this.duration()
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

    this.mainSegmentLoader_.on('syncinfoupdate', () => {
      this.onSyncInfoUpdate_();
    });

    this.mainSegmentLoader_.on('timestampoffset', () => {
      this.tech_.trigger({type: 'usage', name: 'hls-timestamp-offset'});
    });
    this.audioSegmentLoader_.on('syncinfoupdate', () => {
      this.onSyncInfoUpdate_();
    });

    this.mainSegmentLoader_.on('ended', () => {
      this.onEndOfStream();
    });

    this.mainSegmentLoader_.on('earlyabort', () => {
      this.blacklistCurrentPlaylist({
        message: 'Aborted early because there isn\'t enough bandwidth to complete the ' +
          'request without rebuffering.'
      }, ABORT_EARLY_BLACKLIST_SECONDS);
    });

    this.mainSegmentLoader_.on('reseteverything', () => {
      // If playing an MTS stream, a videojs.MediaSource is listening for
      // hls-reset to reset caption parsing state in the transmuxer
      this.tech_.trigger('hls-reset');
    });

    this.mainSegmentLoader_.on('segmenttimemapping', (event) => {
      // If playing an MTS stream in html, a videojs.MediaSource is listening for
      // hls-segment-time-mapping update its internal mapping of stream to display time
      this.tech_.trigger({
        type: 'hls-segment-time-mapping',
        mapping: event.mapping
      });
    });

    this.audioSegmentLoader_.on('ended', () => {
      this.onEndOfStream();
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
    let media = this.selectPlaylist();

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
      this.seekTo_(0);
    }

    if (this.hasPlayed_) {
      this.load();
    }

    let seekable = this.tech_.seekable();

    // if the viewer has paused and we fell out of the live window,
    // seek forward to the live point
    if (this.tech_.duration() === Infinity) {
      if (this.tech_.currentTime() < seekable.start(0)) {
        return this.seekTo_(seekable.end(seekable.length - 1));
      }
    }
  }

  /**
   * Seek to the latest media position if this is a live video and the
   * player and video are loaded and initialized.
   */
  setupFirstPlay() {
    let media = this.masterPlaylistLoader_.media();

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
          this.seekTo_(seekable.end(0));
          this.hasPlayed_ = true;
        });

        return false;
      }

      // trigger firstplay to inform the source handler to ignore the next seek event
      this.trigger('firstplay');
      // seek to the live point
      this.seekTo_(seekable.end(0));
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
      this.setupSourceBuffers_();
    } catch (e) {
      videojs.log.warn('Failed to create Source Buffers', e);
      return this.mediaSource.endOfStream('decode');
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
          this.mainSegmentLoader_.startingMedia_.containsVideo) {
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

    this.logger_(`calling mediaSource.endOfStream()`);
    // on chrome calling endOfStream can sometimes cause an exception,
    // even when the media source is in a valid state.
    try {
      this.mediaSource.endOfStream();
    } catch (e) {
      videojs.log.warn('Failed to call media source endOfStream', e);
    }
  }

  /**
   * Check if a playlist has stopped being updated
   * @param {Object} playlist the media playlist object
   * @return {boolean} whether the playlist has stopped being updated or not
   */
  stuckAtPlaylistEnd_(playlist) {
    let seekable = this.seekable();

    if (!seekable.length) {
      // playlist doesn't have enough information to determine whether we are stuck
      return false;
    }

    let expired =
      this.syncController_.getExpiredTime(playlist, this.mediaSource.duration);

    if (expired === null) {
      return false;
    }

    // does not use the safe live end to calculate playlist end, since we
    // don't want to say we are stuck while there is still content
    let absolutePlaylistEnd = Hls.Playlist.playlistEnd(playlist, expired);
    let currentTime = this.tech_.currentTime();
    let buffered = this.tech_.buffered();

    if (!buffered.length) {
      // return true if the playhead reached the absolute end of the playlist
      return absolutePlaylistEnd - currentTime <= Ranges.SAFE_TIME_DELTA;
    }
    let bufferedEnd = buffered.end(buffered.length - 1);

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
   * @param {Number=} blacklistDuration an optional number of seconds to blacklist the
   * playlist
   */
  blacklistCurrentPlaylist(error = {}, blacklistDuration) {
    let currentPlaylist;
    let nextPlaylist;

    // If the `error` was generated by the playlist loader, it will contain
    // the playlist we were trying to load (but failed) and that should be
    // blacklisted instead of the currently selected playlist which is likely
    // out-of-date in this scenario
    currentPlaylist = error.playlist || this.masterPlaylistLoader_.media();

    blacklistDuration = blacklistDuration ||
                        error.blacklistDuration ||
                        this.blacklistDuration;

    // If there is no current playlist, then an error occurred while we were
    // trying to load the master OR while we were disposing of the tech
    if (!currentPlaylist) {
      this.error = error;

      try {
        return this.mediaSource.endOfStream('network');
      } catch (e) {
        return this.trigger('error');
      }
    }

    let isFinalRendition =
      this.masterPlaylistLoader_.master.playlists.filter(isEnabled).length === 1;
    let playlists = this.masterPlaylistLoader_.master.playlists;

    if (playlists.length === 1) {
      // Never blacklisting this playlist because it's the only playlist
      videojs.log.warn('Problem encountered with the current ' +
                       'HLS playlist. Trying again since it is the only playlist.');

      this.tech_.trigger('retryplaylist');
      return this.masterPlaylistLoader_.load(isFinalRendition);
    }

    if (isFinalRendition) {
      // Since we're on the final non-blacklisted playlist, and we're about to blacklist
      // it, instead of erring the player or retrying this playlist, clear out the current
      // blacklist. This allows other playlists to be attempted in case any have been
      // fixed.
      videojs.log.warn('Removing all playlists from the blacklist because the last ' +
                       'rendition is about to be blacklisted.');
      playlists.forEach((playlist) => {
        if (playlist.excludeUntil !== Infinity) {
          delete playlist.excludeUntil;
        }
      });
      // Technically we are retrying a playlist, in that we are simply retrying a previous
      // playlist. This is needed for users relying on the retryplaylist event to catch a
      // case where the player might be stuck and looping through "dead" playlists.
      this.tech_.trigger('retryplaylist');
    }

    // Blacklist this playlist
    currentPlaylist.excludeUntil = Date.now() + (blacklistDuration * 1000);
    this.tech_.trigger('blacklistplaylist');
    this.tech_.trigger({type: 'usage', name: 'hls-rendition-blacklisted'});

    // Select a new playlist
    nextPlaylist = this.selectPlaylist();
    videojs.log.warn('Problem encountered with the current HLS playlist.' +
                     (error.message ? ' ' + error.message : '') +
                     ' Switching to another playlist.');

    return this.masterPlaylistLoader_.media(nextPlaylist, isFinalRendition);
  }

  /**
   * Pause all segment loaders
   */
  pauseLoading() {
    this.mainSegmentLoader_.pause();
    if (this.mediaTypes_.AUDIO.activePlaylistLoader) {
      this.audioSegmentLoader_.pause();
    }
    if (this.mediaTypes_.SUBTITLES.activePlaylistLoader) {
      this.subtitleSegmentLoader_.pause();
    }
  }

  /**
   * set the current time on all segment loaders
   *
   * @param {TimeRange} currentTime the current time to set
   * @return {TimeRange} the current time
   */
  setCurrentTime(currentTime) {
    let buffered = Ranges.findRange(this.tech_.buffered(), currentTime);

    if (!(this.masterPlaylistLoader_ && this.masterPlaylistLoader_.media())) {
      // return immediately if the metadata is not ready yet
      return 0;
    }

    // it's clearly an edge-case but don't thrown an error if asked to
    // seek within an empty playlist
    if (!this.masterPlaylistLoader_.media().segments) {
      return 0;
    }

    // In flash playback, the segment loaders should be reset on every seek, even
    // in buffer seeks. If the seek location is already buffered, continue buffering as
    // usual
    // TODO: redo this comment
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

    if (this.mediaSource) {
      return this.mediaSource.duration;
    }

    return Hls.Playlist.duration(this.masterPlaylistLoader_.media());
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

    let expired = this.syncController_.getExpiredTime(media, this.mediaSource.duration);

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
      expired = this.syncController_.getExpiredTime(media, this.mediaSource.duration);

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
  updateDuration() {
    let oldDuration = this.mediaSource.duration;
    let newDuration = Hls.Playlist.duration(this.masterPlaylistLoader_.media());
    let buffered = this.tech_.buffered();
    let setDuration = () => {
      // on firefox setting the duration may sometimes cause an exception
      // even if the media source is open and source buffers are not
      // updating, something about the media source being in an invalid state.
      this.logger_(`Setting duration from ${this.mediaSource.duration} => ${newDuration}`);
      try {
        this.mediaSource.duration = newDuration;
      } catch (e) {
        videojs.log.warn('Failed to set media source duration', e);
      }
      this.tech_.trigger('durationchange');

      this.mediaSource.removeEventListener('sourceopen', setDuration);
    };

    if (buffered.length > 0) {
      newDuration = Math.max(newDuration, buffered.end(buffered.length - 1));
    }

    // if the duration has changed, invalidate the cached value
    if (oldDuration !== newDuration) {
      // update the duration
      if (this.mediaSource.readyState !== 'open') {
        this.mediaSource.addEventListener('sourceopen', setDuration);
      } else {
        setDuration();
      }
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

      for (let id in groups) {
        groups[id].forEach((group) => {
          if (group.playlistLoader) {
            group.playlistLoader.dispose();
          }
        });
      }
    });

    this.audioSegmentLoader_.dispose();
    this.subtitleSegmentLoader_.dispose();
    this.off();

    if (this.mediaSource.dispose) {
      this.mediaSource.dispose();
    }
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
   * setup our internal source buffers on our segment Loaders
   *
   * @private
   */
  setupSourceBuffers_() {
    let media = this.masterPlaylistLoader_.media();
    let mimeTypes;

    // wait until a media playlist is available and the Media Source is
    // attached
    if (!media || this.mediaSource.readyState !== 'open') {
      return;
    }

    mimeTypes = mimeTypesForPlaylist(this.masterPlaylistLoader_.master, media);
    if (mimeTypes.length < 1) {
      this.error =
        'No compatible SourceBuffer configuration for the variant stream:' +
        media.resolvedUri;
      return this.mediaSource.endOfStream('decode');
    }

    this.configureLoaderMimeTypes_(mimeTypes);
    // exclude any incompatible variant streams from future playlist
    // selection
    this.excludeIncompatibleVariants_(media);
  }

  configureLoaderMimeTypes_(mimeTypes) {
    // If the content is demuxed, we can't start appending segments to a source buffer
    // until both source buffers are set up, or else the browser may not let us add the
    // second source buffer (it will assume we are playing either audio only or video
    // only).
    const sourceBufferEmitter =
      // If there is more than one mime type
      mimeTypes.length > 1 &&
      // and the first mime type does not have muxed video and audio
      mimeTypes[0].indexOf(',') === -1 &&
      // and the two mime types are different (they can be the same in the case of audio
      // only with alternate audio)
      mimeTypes[0] !== mimeTypes[1] ?
        // then we want to wait on the second source buffer
        new videojs.EventTarget() :
        // otherwise there is no need to wait as the content is either audio only,
        // video only, or muxed content.
        null;

    this.mainSegmentLoader_.mimeType(mimeTypes[0], sourceBufferEmitter);
    if (mimeTypes[1]) {
      this.audioSegmentLoader_.mimeType(mimeTypes[1], sourceBufferEmitter);
    }
  }

  /**
   * Blacklists playlists with codecs that are unsupported by the browser.
   */
  excludeUnsupportedVariants_() {
    this.master().playlists.forEach(variant => {
      if (variant.attributes.CODECS &&
          window.MediaSource &&
          window.MediaSource.isTypeSupported &&
          !window.MediaSource.isTypeSupported(
            `video/mp4; codecs="${mapLegacyAvcCodecs(variant.attributes.CODECS)}"`)) {
        variant.excludeUntil = Infinity;
      }
    });
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
  excludeIncompatibleVariants_(media) {
    let codecCount = 2;
    let videoCodec = null;
    let codecs;

    if (media.attributes.CODECS) {
      codecs = parseCodecs(media.attributes.CODECS);
      videoCodec = codecs.videoCodec;
      codecCount = codecs.codecCount;
    }

    this.master().playlists.forEach(function(variant) {
      let variantCodecs = {
        codecCount: 2,
        videoCodec: null
      };

      if (variant.attributes.CODECS) {
        variantCodecs = parseCodecs(variant.attributes.CODECS);
      }

      // if the streams differ in the presence or absence of audio or
      // video, they are incompatible
      if (variantCodecs.codecCount !== codecCount) {
        variant.excludeUntil = Infinity;
      }

      // if h.264 is specified on the current playlist, some flavor of
      // it must be specified on all compatible variants
      if (variantCodecs.videoCodec !== videoCodec) {
        variant.excludeUntil = Infinity;
      }
    });
  }

  updateAdCues_(media) {
    let offset = 0;
    let seekable = this.seekable();

    if (seekable.length) {
      offset = seekable.start(0);
    }

    updateAdCues(media, this.cueTagsTrack_, offset);
  }

  /**
   * Calculates the desired forward buffer length based on current time
   *
   * @return {Number} Desired forward buffer length in seconds
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
   * @return {Number} Desired buffer low water line in seconds
   */
  bufferLowWaterLine() {
    const currentTime = this.tech_.currentTime();
    const initial = Config.BUFFER_LOW_WATER_LINE;
    const rate = Config.BUFFER_LOW_WATER_LINE_RATE;
    const max = Math.max(initial, Config.MAX_BUFFER_LOW_WATER_LINE);

    return Math.min(initial + currentTime * rate, max);
  }
}
