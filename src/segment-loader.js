/**
 * @file segment-loader.js
 */
import Playlist from './playlist';
import videojs from 'video.js';
import Config from './config';
import window from 'global/window';
import { initSegmentId, segmentKeyId } from './bin-utils';
import { mediaSegmentRequest, REQUEST_ERRORS } from './media-segment-request';
import TransmuxWorker from 'worker!./transmuxer-worker.worker.js';
import segmentTransmuxer from './segment-transmuxer';
import { TIME_FUDGE_FACTOR, timeUntilRebuffer as timeUntilRebuffer_ } from './ranges';
import { minRebufferMaxBandwidthSelector } from './playlist-selectors';
import { CaptionParser } from 'mux.js/lib/mp4';
import logger from './util/logger';
import { concatSegments } from './util/segment';
import {
  createCaptionsTrackIfNotExists,
  createMetadataTrackIfNotExists,
  addMetadata,
  addCaptionData,
  removeCuesFromTrack
} from './util/text-tracks';
import { gopsSafeToAlignWith, removeGopBuffer, updateGopBuffer } from './util/gops';

// in ms
const CHECK_BUFFER_DELAY = 500;

/**
 * Determines if we should call endOfStream on the media source based
 * on the state of the buffer or if appened segment was the final
 * segment in the playlist.
 *
 * @param {Object} playlist a media playlist object
 * @param {Object} mediaSource the MediaSource object
 * @param {Number} segmentIndex the index of segment we last appended
 * @returns {Boolean} do we need to call endOfStream on the MediaSource
 */
const detectEndOfStream = function(playlist, mediaSource, segmentIndex) {
  if (!playlist || !mediaSource) {
    return false;
  }

  let segments = playlist.segments;

  // determine a few boolean values to help make the branch below easier
  // to read
  let appendedLastSegment = segmentIndex === segments.length;

  // if we've buffered to the end of the video, we need to call endOfStream
  // so that MediaSources can trigger the `ended` event when it runs out of
  // buffered data instead of waiting for me
  return playlist.endList &&
    mediaSource.readyState === 'open' &&
    appendedLastSegment;
};

const finite = (num) => typeof num === 'number' && isFinite(num);

export const illegalMediaSwitch = (loaderType, startingMedia, trackInfo) => {
  // Although these checks should most likely cover non 'main' types, for now it narrows
  // the scope of our checks.
  if (loaderType !== 'main' || !startingMedia || !trackInfo) {
    return null;
  }

  if (!trackInfo.hasAudio && !trackInfo.hasVideo) {
    return 'Neither audio nor video found in segment.';
  }

  if (startingMedia.hasVideo && !trackInfo.hasVideo) {
    return 'Only audio found in segment when we expected video.' +
      ' We can\'t switch to audio only from a stream that had video.' +
      ' To get rid of this message, please add codec information to the manifest.';
  }

  if (!startingMedia.hasVideo && trackInfo.hasVideo) {
    return 'Video found in segment when we expected only audio.' +
      ' We can\'t switch to a stream with video from an audio only stream.' +
      ' To get rid of this message, please add codec information to the manifest.';
  }

  return null;
};

/**
 * Calculates a time value that is safe to remove from the back buffer without interupting
 * playback.
 *
 * @param {TimeRange} seekable
 *        The current seekable range
 * @param {Number} currentTime
 *        The current time of the player
 * @param {Number} targetDuration
 *        The target duration of the current playlist
 * @return {Number}
 *         Time that is safe to remove from the back buffer without interupting playback
 */
export const safeBackBufferTrimTime = (seekable, currentTime, targetDuration) => {
  let removeToTime;

  if (seekable.length &&
      seekable.start(0) > 0 &&
      seekable.start(0) < currentTime) {
    // If we have a seekable range use that as the limit for what can be removed safely
    removeToTime = seekable.start(0);
  } else {
    // otherwise remove anything older than 30 seconds before the current play head
    removeToTime = currentTime - 30;
  }

  // Don't allow removing from the buffer within target duration of current time
  // to avoid the possibility of removing the GOP currently being played which could
  // cause playback stalls.
  return Math.min(removeToTime, currentTime - targetDuration);
};

const segmentInfoString = (segmentInfo) => {
  const {
    segment: {
      start,
      end
    },
    playlist: {
      mediaSequence: seq,
      id,
      segments = []
    },
    mediaIndex: index,
    timeline
  } = segmentInfo;

  return [
    `appending [${index}] of [${seq}, ${seq + segments.length}] from playlist [${id}]`,
    `[${start} => ${end}] in timeline [${timeline}]`
  ].join(' ');
};

const timingInfoPropertyForMedia = (mediaType) => `${mediaType}TimingInfo`;

/**
 * An object that manages segment loading and appending.
 *
 * @class SegmentLoader
 * @param {Object} options required and optional options
 * @extends videojs.EventTarget
 */
export default class SegmentLoader extends videojs.EventTarget {
  constructor(settings, options = {}) {
    super();
    // check pre-conditions
    if (!settings) {
      throw new TypeError('Initialization settings are required');
    }
    if (typeof settings.currentTime !== 'function') {
      throw new TypeError('No currentTime getter specified');
    }
    if (!settings.mediaSource) {
      throw new TypeError('No MediaSource specified');
    }
    // public properties
    this.bandwidth = settings.bandwidth;
    this.throughput = {rate: 0, count: 0};
    this.roundTrip = NaN;
    this.resetStats_();
    this.mediaIndex = null;

    // private settings
    this.hasPlayed_ = settings.hasPlayed;
    this.currentTime_ = settings.currentTime;
    this.seekable_ = settings.seekable;
    this.seeking_ = settings.seeking;
    this.duration_ = settings.duration;
    this.mediaSource_ = settings.mediaSource;
    this.hls_ = settings.hls;
    this.loaderType_ = settings.loaderType;
    // we always know the starting media for audio segment loaders (by definition),
    // however, the main segment loader can be any combination, so we must wait for track
    // info to determine the starting media
    this.startingMedia_ = this.loaderType_ === 'audio' ? {
      hasAudio: true,
      hasVideo: false
    } : void 0;
    this.segmentMetadataTrack_ = settings.segmentMetadataTrack;
    this.goalBufferLength_ = settings.goalBufferLength;
    this.sourceType_ = settings.sourceType;
    this.sourceUpdater_ = settings.sourceUpdater;
    this.inbandTextTracks_ = settings.inbandTextTracks;
    this.state_ = 'INIT';
    this.handlePartialData_ = false;

    // private instance variables
    this.checkBufferTimeout_ = null;
    this.error_ = void 0;
    this.currentTimeline_ = -1;
    this.pendingSegment_ = null;
    this.xhrOptions_ = null;
    this.pendingSegments_ = [];
    this.audioDisabled_ = false;
    // TODO possibly move gopBuffer and timeMapping info to a separate controller
    this.gopBuffer_ = [];
    this.timeMapping_ = 0;
    this.safeAppend_ = videojs.browser.IE_VERSION >= 11;
    this.appendInitSegment_ = {
      audio: true,
      video: true
    };
    this.playlistOfLastInitSegment_ = {
      audio: null,
      video: null
    };
    this.callQueue_ = [];
    this.metadataQueue_ = {
      id3: [],
      caption: []
    };

    // Fragmented mp4 playback
    this.activeInitSegmentId_ = null;
    this.initSegments_ = {};

    // HLSe playback
    this.cacheEncryptionKeys_ = settings.cacheEncryptionKeys;
    this.keyCache_ = {};

    // Fmp4 CaptionParser
    if (this.loaderType_ === 'main') {
      this.captionParser_ = new CaptionParser();
    } else {
      this.captionParser_ = null;
    }

    this.decrypter_ = settings.decrypter;

    // Manages the tracking and generation of sync-points, mappings
    // between a time in the display time and a segment index within
    // a playlist
    this.syncController_ = settings.syncController;
    this.syncPoint_ = {
      segmentIndex: 0,
      time: 0
    };

    this.transmuxer_ = this.createTransmuxer_();

    this.syncController_.on('syncinfoupdate', () => this.trigger('syncinfoupdate'));

    this.mediaSource_.addEventListener('sourceopen', () => {
      this.ended_ = false;
    });

    // ...for determining the fetch location
    this.fetchAtBuffer_ = false;

    this.logger_ = logger(`SegmentLoader[${this.loaderType_}]`);

    Object.defineProperty(this, 'state', {
      get() {
        return this.state_;
      },
      set(newState) {
        if (newState !== this.state_) {
          this.logger_(`${this.state_} -> ${newState}`);
          this.state_ = newState;
        }
      }
    });

    this.sourceUpdater_.on('ready', () => {
      // check if any calls were waiting on source buffer creation
      if (this.hasEnoughInfoToAppend_()) {
        this.processCallQueue_();
      }
    });
  }

  createTransmuxer_() {
    const transmuxer = new TransmuxWorker();

    transmuxer.postMessage({
      action: 'init',
      options: {
        remux: false,
        alignGopsAtEnd: this.safeAppend_,
        keepOriginalTimestamps: true,
        handlePartialData: this.handlePartialData_
      }
    });

    return transmuxer;
  }

  /**
   * reset all of our media stats
   *
   * @private
   */
  resetStats_() {
    this.mediaBytesTransferred = 0;
    this.mediaRequests = 0;
    this.mediaRequestsAborted = 0;
    this.mediaRequestsTimedout = 0;
    this.mediaRequestsErrored = 0;
    this.mediaTransferDuration = 0;
    this.mediaSecondsLoaded = 0;
  }

  /**
   * dispose of the SegmentLoader and reset to the default state
   */
  dispose() {
    this.state = 'DISPOSED';
    this.pause();
    this.abort_();
    if (this.transmuxer_) {
      this.transmuxer_.terminate();
      // Although it isn't an instance of a class, the segment transmuxer must still be
      // cleaned up.
      segmentTransmuxer.dispose();
    }
    this.resetStats_();
    if (this.captionParser_) {
      this.captionParser_.reset();
    }
  }

  setAudio(enable) {
    this.audioDisabled_ = !enable;
    if (enable) {
      this.appendInitSegment_.audio = true;
    }
  }

  /**
   * abort anything that is currently doing on with the SegmentLoader
   * and reset to a default state
   */
  abort() {
    if (this.state !== 'WAITING') {
      if (this.pendingSegment_) {
        this.pendingSegment_ = null;
      }
      return;
    }

    this.abort_();

    // We aborted the requests we were waiting on, so reset the loader's state to READY
    // since we are no longer "waiting" on any requests. XHR callback is not always run
    // when the request is aborted. This will prevent the loader from being stuck in the
    // WAITING state indefinitely.
    this.state = 'READY';

    // don't wait for buffer check timeouts to begin fetching the
    // next segment
    if (!this.paused()) {
      this.monitorBuffer_();
    }
  }

  /**
   * abort all pending xhr requests and null any pending segements
   *
   * @private
   */
  abort_() {
    if (this.pendingSegment_) {
      this.pendingSegment_.abortRequests();
    }

    // clear out the segment being processed
    this.pendingSegment_ = null;
    this.callQueue_ = [];
    this.metadataQueue_.id3 = [];
    this.metadataQueue_.caption = [];
  }

  checkForAbort_(requestId) {
    // If the state is APPENDING, then aborts will not modify the state, meaning the first
    // callback that happens should reset the state to READY so that loading can continue.
    if (this.state === 'APPENDING' && !this.pendingSegment_) {
      this.state = 'READY';
      return true;
    }

    if (!this.pendingSegment_ || this.pendingSegment_.requestId !== requestId) {
      return true;
    }

    return false;
  }

  /**
   * set an error on the segment loader and null out any pending segements
   *
   * @param {Error} error the error to set on the SegmentLoader
   * @return {Error} the error that was set or that is currently set
   */
  error(error) {
    if (typeof error !== 'undefined') {
      this.error_ = error;
    }

    this.pendingSegment_ = null;
    return this.error_;
  }

  endOfStream() {
    this.ended_ = true;
    if (this.transmuxer_) {
      // need to clear out any cached data to prepare for the new segment
      segmentTransmuxer.reset(this.transmuxer_);
    }
    this.gopBuffer_.length = 0;
    this.pause();
    this.trigger('ended');
  }

  /**
   * Indicates which time ranges are buffered
   *
   * @return {TimeRange}
   *         TimeRange object representing the current buffered ranges
   */
  buffered_() {
    if (!this.sourceUpdater_) {
      return videojs.createTimeRanges();
    }

    return this.sourceUpdater_.buffered();
  }

  /**
   * Gets and sets init segment for the provided map
   *
   * @param {Object} map
   *        The map object representing the init segment to get or set
   * @param {Boolean=} set
   *        If true, the init segment for the provided map should be saved
   * @return {Object}
   *         map object for desired init segment
   */
  initSegmentForMap(map, set = false) {
    if (!map) {
      return null;
    }

    const id = initSegmentId(map);
    let storedMap = this.initSegments_[id];

    if (set && !storedMap && map.bytes) {
      this.initSegments_[id] = storedMap = {
        resolvedUri: map.resolvedUri,
        byterange: map.byterange,
        bytes: map.bytes,
        timescales: map.timescales,
        videoTrackIds: map.videoTrackIds
      };
    }

    return storedMap || map;
  }

  /**
   * Gets and sets key for the provided key
   *
   * @param {Object} key
   *        The key object representing the key to get or set
   * @param {Boolean=} set
   *        If true, the key for the provided key should be saved
   * @return {Object}
   *         Key object for desired key
   */
  segmentKey(key, set = false) {
    if (!key) {
      return null;
    }

    const id = segmentKeyId(key);
    let storedKey = this.keyCache_[id];

    // TODO: We should use the HTTP Expires header to invalidate our cache per
    // https://tools.ietf.org/html/draft-pantos-http-live-streaming-23#section-6.2.3
    if (this.cacheEncryptionKeys_ && set && !storedKey && key.bytes) {
      this.keyCache_[id] = storedKey = {
        resolvedUri: key.resolvedUri,
        bytes: key.bytes
      };
    }

    const result = {
      resolvedUri: (storedKey || key).resolvedUri
    };

    if (storedKey) {
      result.bytes = storedKey.bytes;
    }

    return result;
  }

  /**
   * Returns true if all configuration required for loading is present, otherwise false.
   *
   * @return {Boolean} True if the all configuration is ready for loading
   * @private
   */
  couldBeginLoading_() {
    return this.playlist_ && !this.paused();
  }

  /**
   * load a playlist and start to fill the buffer
   */
  load() {
    // un-pause
    this.monitorBuffer_();

    // if we don't have a playlist yet, keep waiting for one to be
    // specified
    if (!this.playlist_) {
      return;
    }

    // not sure if this is the best place for this
    this.syncController_.setDateTimeMapping(this.playlist_);

    // if all the configuration is ready, initialize and begin loading
    if (this.state === 'INIT' && this.couldBeginLoading_()) {
      return this.init_();
    }

    // if we're in the middle of processing a segment already, don't
    // kick off an additional segment request
    if (!this.couldBeginLoading_() ||
        (this.state !== 'READY' &&
        this.state !== 'INIT')) {
      return;
    }

    this.state = 'READY';
  }

  /**
   * Once all the starting parameters have been specified, begin
   * operation. This method should only be invoked from the INIT
   * state.
   *
   * @private
   */
  init_() {
    this.state = 'READY';
    // if this is the audio segment loader, and it hasn't been inited before, then any old
    // audio data from the muxed content should be removed
    this.resetEverything();
    return this.monitorBuffer_();
  }

  /**
   * set a playlist on the segment loader
   *
   * @param {PlaylistLoader} media the playlist to set on the segment loader
   */
  playlist(newPlaylist, options = {}) {
    if (!newPlaylist) {
      return;
    }

    let oldPlaylist = this.playlist_;
    let segmentInfo = this.pendingSegment_;

    this.playlist_ = newPlaylist;
    this.xhrOptions_ = options;

    // when we haven't started playing yet, the start of a live playlist
    // is always our zero-time so force a sync update each time the playlist
    // is refreshed from the server
    if (!this.hasPlayed_()) {
      newPlaylist.syncInfo = {
        mediaSequence: newPlaylist.mediaSequence,
        time: 0
      };
    }

    let oldId = null;

    if (oldPlaylist) {
      if (oldPlaylist.id) {
        oldId = oldPlaylist.id;
      } else if (oldPlaylist.uri) {
        oldId = oldPlaylist.uri;
      }
    }

    this.logger_(`playlist update [${oldId} => ${newPlaylist.id || newPlaylist.uri}]`);

    // in VOD, this is always a rendition switch (or we updated our syncInfo above)
    // in LIVE, we always want to update with new playlists (including refreshes)
    this.trigger('syncinfoupdate');

    // if we were unpaused but waiting for a playlist, start
    // buffering now
    if (this.state === 'INIT' && this.couldBeginLoading_()) {
      return this.init_();
    }

    if (!oldPlaylist || oldPlaylist.uri !== newPlaylist.uri) {
      if (this.mediaIndex !== null || this.handlePartialData_) {
        // we must "resync" the segment loader when we switch renditions and
        // the segment loader is already synced to the previous rendition
        //
        // or if we're handling partial data, we need to ensure the transmuxer is cleared
        // out before we start adding more data
        this.resyncLoader();
      }

      // the rest of this function depends on `oldPlaylist` being defined
      return;
    }

    // we reloaded the same playlist so we are in a live scenario
    // and we will likely need to adjust the mediaIndex
    let mediaSequenceDiff = newPlaylist.mediaSequence - oldPlaylist.mediaSequence;

    this.logger_(`live window shift [${mediaSequenceDiff}]`);

    // update the mediaIndex on the SegmentLoader
    // this is important because we can abort a request and this value must be
    // equal to the last appended mediaIndex
    if (this.mediaIndex !== null) {
      this.mediaIndex -= mediaSequenceDiff;
    }

    // update the mediaIndex on the SegmentInfo object
    // this is important because we will update this.mediaIndex with this value
    // in `handleAppendsDone_` after the segment has been successfully appended
    if (segmentInfo) {
      segmentInfo.mediaIndex -= mediaSequenceDiff;

      // we need to update the referenced segment so that timing information is
      // saved for the new playlist's segment, however, if the segment fell off the
      // playlist, we can leave the old reference and just lose the timing info
      if (segmentInfo.mediaIndex >= 0) {
        segmentInfo.segment = newPlaylist.segments[segmentInfo.mediaIndex];
      }
    }

    this.syncController_.saveExpiredSegmentInfo(oldPlaylist, newPlaylist);
  }

  /**
   * Prevent the loader from fetching additional segments. If there
   * is a segment request outstanding, it will finish processing
   * before the loader halts. A segment loader can be unpaused by
   * calling load().
   */
  pause() {
    if (this.checkBufferTimeout_) {
      window.clearTimeout(this.checkBufferTimeout_);

      this.checkBufferTimeout_ = null;
    }
  }

  /**
   * Returns whether the segment loader is fetching additional
   * segments when given the opportunity. This property can be
   * modified through calls to pause() and load().
   */
  paused() {
    return this.checkBufferTimeout_ === null;
  }

  /**
   * Delete all the buffered data and reset the SegmentLoader
   * @param {Function} [done] an optional callback to be executed when the remove
   * operation is complete
   */
  resetEverything(done) {
    this.ended_ = false;
    this.appendInitSegment_ = {
      audio: true,
      video: true
    };
    this.resetLoader();
    this.remove(0, this.duration_(), done);
    // clears fmp4 captions
    if (this.captionParser_) {
      this.captionParser_.clearAllCaptions();
    }
  }

  /**
   * Force the SegmentLoader to resync and start loading around the currentTime instead
   * of starting at the end of the buffer
   *
   * Useful for fast quality changes
   */
  resetLoader() {
    this.fetchAtBuffer_ = false;
    this.resyncLoader();
  }

  /**
   * Force the SegmentLoader to restart synchronization and make a conservative guess
   * before returning to the simple walk-forward method
   */
  resyncLoader() {
    if (this.transmuxer_) {
      // need to clear out any cached data to prepare for the new segment
      segmentTransmuxer.reset(this.transmuxer_);
    }
    this.mediaIndex = null;
    this.syncPoint_ = null;
    this.callQueue_ = [];
    this.metadataQueue_.id3 = [];
    this.metadataQueue_.caption = [];
    this.abort();
  }

  /**
   * Remove any data in the source buffer between start and end times
   * @param {Number} start - the start time of the region to remove from the buffer
   * @param {Number} end - the end time of the region to remove from the buffer
   * @param {Function} [done] - an optional callback to be executed when the remove
   * operation is complete
   */
  remove(start, end, done = () => {}) {
    if (!this.sourceUpdater_ || !this.startingMedia_) {
      // nothing to remove if we haven't processed any media
      return;
    }

    // set it to one to complete this function's removes
    let removesRemaining = 1;
    const removeFinished = () => {
      removesRemaining--;
      if (removesRemaining === 0) {
        done();
      }
    };

    if (!this.audioDisabled_) {
      removesRemaining++;
      this.sourceUpdater_.removeAudio(start, end, removeFinished);
    }

    if (this.loaderType_ === 'main' && this.startingMedia_.hasVideo) {
      this.gopBuffer_ = removeGopBuffer(this.gopBuffer_, start, end, this.timeMapping_);
      removesRemaining++;
      this.sourceUpdater_.removeVideo(start, end, removeFinished);
    }

    // remove any captions and ID3 tags
    for (let track in this.inbandTextTracks_) {
      removeCuesFromTrack(start, end, this.inbandTextTracks_[track]);
    }
    removeCuesFromTrack(start, end, this.segmentMetadataTrack_);

    if (this.inbandTextTracks_) {
      for (let id in this.inbandTextTracks_) {
        removeCuesFromTrack(start, end, this.inbandTextTracks_[id]);
      }
    }
    // finished this function's removes
    removeFinished();
  }

  /**
   * (re-)schedule monitorBufferTick_ to run as soon as possible
   *
   * @private
   */
  monitorBuffer_() {
    if (this.checkBufferTimeout_) {
      window.clearTimeout(this.checkBufferTimeout_);
    }

    this.checkBufferTimeout_ = window.setTimeout(this.monitorBufferTick_.bind(this), 1);
  }

  /**
   * As long as the SegmentLoader is in the READY state, periodically
   * invoke fillBuffer_().
   *
   * @private
   */
  monitorBufferTick_() {
    if (this.state === 'READY') {
      this.fillBuffer_();
    }

    if (this.checkBufferTimeout_) {
      window.clearTimeout(this.checkBufferTimeout_);
    }

    this.checkBufferTimeout_ = window.setTimeout(this.monitorBufferTick_.bind(this),
                                                 CHECK_BUFFER_DELAY);
  }

  /**
   * fill the buffer with segements unless the sourceBuffers are
   * currently updating
   *
   * Note: this function should only ever be called by monitorBuffer_
   * and never directly
   *
   * @private
   */
  fillBuffer_() {
    // TODO since the source buffer maintains a queue, and we shouldn't call this function
    // except when we're ready for the next segment, this check can most likely be removed
    if (this.sourceUpdater_.updating()) {
      return;
    }

    if (!this.syncPoint_) {
      this.syncPoint_ = this.syncController_.getSyncPoint(this.playlist_,
                                                          this.duration_(),
                                                          this.currentTimeline_,
                                                          this.currentTime_());
    }

    const buffered = this.buffered_();

    // see if we need to begin loading immediately
    let segmentInfo = this.checkBuffer_(buffered,
                                        this.playlist_,
                                        this.mediaIndex,
                                        this.hasPlayed_(),
                                        this.currentTime_(),
                                        this.syncPoint_);

    if (!segmentInfo) {
      return;
    }

    if (this.isEndOfStream_(segmentInfo.mediaIndex)) {
      this.endOfStream();
      return;
    }

    if (segmentInfo.mediaIndex === this.playlist_.segments.length - 1 &&
        this.mediaSource_.readyState === 'ended' &&
        !this.seeking_()) {
      return;
    }

    // check to see if we are crossing a discontinuity or requesting a segment that starts
    // earlier than the last set timestamp offset to see if we need to set the timestamp
    // offset on the transmuxer and source buffer
    if (segmentInfo.timeline !== this.currentTimeline_ ||
        this.startsBeforeSourceBufferTimestampOffset(segmentInfo)) {
      // segmentInfo.startOfSegment used to be used as the timestamp offset, however, that
      // value uses the end of the last segment if it is available. While this value
      // should often be correct, it's better to rely on the buffered end, as the new
      // content post discontinuity should line up with the buffered end as if it were
      // time 0 for the new content.
      segmentInfo.timestampOffset =
        buffered.length ? buffered.end(buffered.length - 1) : segmentInfo.startOfSegment;
      if (this.captionParser_) {
        this.captionParser_.clearAllCaptions();
      }
    }

    this.loadSegment_(segmentInfo);
  }

  startsBeforeSourceBufferTimestampOffset(segmentInfo) {
    if (segmentInfo.startOfSegment === null) {
      return false;
    }

    if (this.loaderType === 'main' &&
        segmentInfo.startOfSegment < this.sourceUpdater_.videoTimestampOffset()) {
      return true;
    }

    if (this.audioDisabled_) {
      return false;
    }

    return segmentInfo.startOfSegment < this.sourceUpdater_.audioTimestampOffset();
  }

  /**
   * Determines if this segment loader is at the end of it's stream.
   *
   * @param {Number} mediaIndex the index of segment we last appended
   * @param {Object} [playlist=this.playlist_] a media playlist object
   * @returns {Boolean} true if at end of stream, false otherwise.
   */
  isEndOfStream_(mediaIndex, playlist = this.playlist_) {
    return detectEndOfStream(
      playlist,
      this.mediaSource_,
      mediaIndex
    ) && !this.sourceUpdater_.updating();
  }

  /**
   * Determines what segment request should be made, given current playback
   * state.
   *
   * @param {TimeRanges} buffered - the state of the buffer
   * @param {Object} playlist - the playlist object to fetch segments from
   * @param {Number} mediaIndex - the previous mediaIndex fetched or null
   * @param {Boolean} hasPlayed - a flag indicating whether we have played or not
   * @param {Number} currentTime - the playback position in seconds
   * @param {Object} syncPoint - a segment info object that describes the
   * @returns {Object} a segment request object that describes the segment to load
   */
  checkBuffer_(buffered, playlist, mediaIndex, hasPlayed, currentTime, syncPoint) {
    let lastBufferedEnd = 0;
    let startOfSegment;

    if (buffered.length) {
      lastBufferedEnd = buffered.end(buffered.length - 1);
    }

    let bufferedTime = Math.max(0, lastBufferedEnd - currentTime);

    if (!playlist.segments.length) {
      return null;
    }

    // if there is plenty of content buffered, and the video has
    // been played before relax for awhile
    if (bufferedTime >= this.goalBufferLength_()) {
      return null;
    }

    // if the video has not yet played once, and we already have
    // one segment downloaded do nothing
    if (!hasPlayed && bufferedTime >= 1) {
      return null;
    }

    // When the syncPoint is null, there is no way of determining a good
    // conservative segment index to fetch from
    // The best thing to do here is to get the kind of sync-point data by
    // making a request
    if (syncPoint === null) {
      mediaIndex = this.getSyncSegmentCandidate_(playlist);
      return this.generateSegmentInfo_(playlist, mediaIndex, null, true);
    }

    // Under normal playback conditions fetching is a simple walk forward
    if (mediaIndex !== null) {
      let segment = playlist.segments[mediaIndex];

      if (segment && segment.end) {
        startOfSegment = segment.end;
      } else {
        startOfSegment = lastBufferedEnd;
      }
      return this.generateSegmentInfo_(playlist, mediaIndex + 1, startOfSegment, false);
    }

    // There is a sync-point but the lack of a mediaIndex indicates that
    // we need to make a good conservative guess about which segment to
    // fetch
    if (this.fetchAtBuffer_) {
      // Find the segment containing the end of the buffer
      let mediaSourceInfo = Playlist.getMediaInfoForTime(playlist,
                                                         lastBufferedEnd,
                                                         syncPoint.segmentIndex,
                                                         syncPoint.time);

      mediaIndex = mediaSourceInfo.mediaIndex;
      startOfSegment = mediaSourceInfo.startTime;
    } else {
      // Find the segment containing currentTime
      let mediaSourceInfo = Playlist.getMediaInfoForTime(playlist,
                                                         currentTime,
                                                         syncPoint.segmentIndex,
                                                         syncPoint.time);

      mediaIndex = mediaSourceInfo.mediaIndex;
      startOfSegment = mediaSourceInfo.startTime;
    }

    return this.generateSegmentInfo_(playlist, mediaIndex, startOfSegment, false);
  }

  /**
   * The segment loader has no recourse except to fetch a segment in the
   * current playlist and use the internal timestamps in that segment to
   * generate a syncPoint. This function returns a good candidate index
   * for that process.
   *
   * @param {Object} playlist - the playlist object to look for a
   * @returns {Number} An index of a segment from the playlist to load
   */
  getSyncSegmentCandidate_(playlist) {
    if (this.currentTimeline_ === -1) {
      return 0;
    }

    let segmentIndexArray = playlist.segments
      .map((s, i) => {
        return {
          timeline: s.timeline,
          segmentIndex: i
        };
      }).filter(s => s.timeline === this.currentTimeline_);

    if (segmentIndexArray.length) {
      return segmentIndexArray[Math.min(segmentIndexArray.length - 1, 1)].segmentIndex;
    }

    return Math.max(playlist.segments.length - 1, 0);
  }

  generateSegmentInfo_(playlist, mediaIndex, startOfSegment, isSyncRequest) {
    if (mediaIndex < 0 || mediaIndex >= playlist.segments.length) {
      return null;
    }

    let segment = playlist.segments[mediaIndex];
    const audioBuffered = this.sourceUpdater_.audioBuffered();
    const videoBuffered = this.sourceUpdater_.videoBuffered();
    let audioAppendStart;
    let gopsToAlignWith;

    if (audioBuffered.length) {
      // since the transmuxer is using the actual timing values, but the buffer is
      // adjusted by the timestamp offset, we must adjust the value here
      audioAppendStart = audioBuffered.end(audioBuffered.length - 1) -
        this.sourceUpdater_.audioTimestampOffset();
    }

    if (videoBuffered.length) {
      gopsToAlignWith = gopsSafeToAlignWith(
        this.gopBuffer_,
        // since the transmuxer is using the actual timing values, but the time is
        // adjusted by the timestmap offset, we must adjust the value here
        this.currentTime_() - this.sourceUpdater_.videoTimestampOffset(),
        this.timeMapping_);
    }

    return {
      requestId: 'segment-loader-' + Math.random(),
      // resolve the segment URL relative to the playlist
      uri: segment.resolvedUri,
      // the segment's mediaIndex at the time it was requested
      mediaIndex,
      // whether or not to update the SegmentLoader's state with this
      // segment's mediaIndex
      isSyncRequest,
      startOfSegment,
      // the segment's playlist
      playlist,
      // unencrypted bytes of the segment
      bytes: null,
      // when a key is defined for this segment, the encrypted bytes
      encryptedBytes: null,
      // The target timestampOffset for this segment when we append it
      // to the source buffer
      timestampOffset: null,
      // The timeline that the segment is in
      timeline: segment.timeline,
      // The expected duration of the segment in seconds
      duration: segment.duration,
      // retain the segment in case the playlist updates while doing an async process
      segment,
      byteLength: 0,
      transmuxer: this.transmuxer_,
      audioAppendStart,
      gopsToAlignWith
    };
  }

  /**
   * Determines if the network has enough bandwidth to complete the current segment
   * request in a timely manner. If not, the request will be aborted early and bandwidth
   * updated to trigger a playlist switch.
   *
   * @param {Object} stats
   *        Object containing stats about the request timing and size
   * @return {Boolean} True if the request was aborted, false otherwise
   * @private
   */
  abortRequestEarly_(stats) {
    if (this.hls_.tech_.paused() ||
        // Don't abort if the current playlist is on the lowestEnabledRendition
        // TODO: Replace using timeout with a boolean indicating whether this playlist is
        //       the lowestEnabledRendition.
        !this.xhrOptions_.timeout ||
        // Don't abort if we have no bandwidth information to estimate segment sizes
        !(this.playlist_.attributes.BANDWIDTH)) {
      return false;
    }

    // Wait at least 1 second since the first byte of data has been received before
    // using the calculated bandwidth from the progress event to allow the bitrate
    // to stabilize
    if (Date.now() - (stats.firstBytesReceivedAt || Date.now()) < 1000) {
      return false;
    }

    const currentTime = this.currentTime_();
    const measuredBandwidth = stats.bandwidth;
    const segmentDuration = this.pendingSegment_.duration;

    const requestTimeRemaining =
      Playlist.estimateSegmentRequestTime(segmentDuration,
                                          measuredBandwidth,
                                          this.playlist_,
                                          stats.bytesReceived);

    // Subtract 1 from the timeUntilRebuffer so we still consider an early abort
    // if we are only left with less than 1 second when the request completes.
    // A negative timeUntilRebuffering indicates we are already rebuffering
    const timeUntilRebuffer = timeUntilRebuffer_(this.buffered_(),
                                                 currentTime,
                                                 this.hls_.tech_.playbackRate()) - 1;

    // Only consider aborting early if the estimated time to finish the download
    // is larger than the estimated time until the player runs out of forward buffer
    if (requestTimeRemaining <= timeUntilRebuffer) {
      return false;
    }

    const switchCandidate = minRebufferMaxBandwidthSelector({
      master: this.hls_.playlists.master,
      currentTime,
      bandwidth: measuredBandwidth,
      duration: this.duration_(),
      segmentDuration,
      timeUntilRebuffer,
      currentTimeline: this.currentTimeline_,
      syncController: this.syncController_
    });

    if (!switchCandidate) {
      return;
    }

    const rebufferingImpact = requestTimeRemaining - timeUntilRebuffer;

    const timeSavedBySwitching = rebufferingImpact - switchCandidate.rebufferingImpact;

    let minimumTimeSaving = 0.5;

    // If we are already rebuffering, increase the amount of variance we add to the
    // potential round trip time of the new request so that we are not too aggressive
    // with switching to a playlist that might save us a fraction of a second.
    if (timeUntilRebuffer <= TIME_FUDGE_FACTOR) {
      minimumTimeSaving = 1;
    }

    if (!switchCandidate.playlist ||
        switchCandidate.playlist.uri === this.playlist_.uri ||
        timeSavedBySwitching < minimumTimeSaving) {
      return false;
    }

    // set the bandwidth to that of the desired playlist being sure to scale by
    // BANDWIDTH_VARIANCE and add one so the playlist selector does not exclude it
    // don't trigger a bandwidthupdate as the bandwidth is artifial
    this.bandwidth =
      switchCandidate.playlist.attributes.BANDWIDTH * Config.BANDWIDTH_VARIANCE + 1;
    this.abort();
    this.trigger('earlyabort');
    return true;
  }

  /**
   * XHR `progress` event handler
   *
   * @param {Event}
   *        The XHR `progress` event
   * @param {Object} simpleSegment
   *        A simplified segment object copy
   * @private
   */
  handleProgress_(event, simpleSegment) {
    if (this.checkForAbort_(simpleSegment.requestId) ||
        this.abortRequestEarly_(simpleSegment.stats)) {
      return;
    }

    this.trigger('progress');
  }

  handleTrackInfo_(simpleSegment, trackInfo) {
    if (this.checkForAbort_(simpleSegment.requestId) ||
        this.abortRequestEarly_(simpleSegment.stats)) {
      return;
    }

    if (!trackInfo) {
      // At the moment, the only case we have where we won't have track info is fmp4,
      // since fmp4 isn't parsed (yet).
      // Also assume that fmp4 is always demuxed.
      trackInfo = {
        hasAudio: this.loaderType_ === 'audio',
        // TODO fmp4 audio only
        hasVideo: this.loaderType_ === 'main'
      };
    }

    // When we have track info, determine what media types this loader is dealing with.
    if (typeof this.startingMedia_ === 'undefined' &&
        // Guard against cases where we're not getting track info at all until we are
        // certain that all streams will provide it.
        (trackInfo.hasAudio || trackInfo.hasVideo)) {
      this.startingMedia_ = {
        hasAudio: trackInfo.hasAudio,
        hasVideo: trackInfo.hasVideo
      };
    }

    this.trigger('trackinfo');

    if (this.checkForIllegalMediaSwitch(trackInfo)) {
      return;
    }
  }

  handleTimingInfo_(simpleSegment, mediaType, timeType, time) {
    if (this.checkForAbort_(simpleSegment.requestId) ||
        this.abortRequestEarly_(simpleSegment.stats)) {
      return;
    }

    if (!mediaType) {
      // If media type isn't set, that means it's not being parsed from the content. This
      // can happen in the case of fmp4, since we don't parse the media type (yet). In
      // this case, just use the loader type, since fmp4 should always be demuxed.
      mediaType =
        this.loaderType_ === 'main' && this.startingMedia_.hasVideo ? 'video' : 'audio';
    }

    const segmentInfo = this.pendingSegment_;
    const timingInfoProperty = timingInfoPropertyForMedia(mediaType);

    segmentInfo[timingInfoProperty] = segmentInfo[timingInfoProperty] || {};
    segmentInfo[timingInfoProperty][timeType] = time;

    // check if any calls were waiting on the timing info
    if (this.hasEnoughInfoToAppend_()) {
      this.processCallQueue_();
    }
  }

  handleCaptions_(simpleSegment, captions) {
    if (this.checkForAbort_(simpleSegment.requestId) ||
      this.abortRequestEarly_(simpleSegment.stats)) {
      return;
    }

    // This could only happen with fmp4 segments, but
    // should still not happen in general
    if (captions.length === 0) {
      this.logger_('SegmentLoader received no captions from a caption event');
      return;
    }

    const segmentInfo = this.pendingSegment_;

    // Wait until we have some video data so that caption timing
    // can be adjusted by the timestamp offset
    if (!segmentInfo.hasAppendedData_) {
      this.metadataQueue_.caption.push(
        this.handleCaptions_.bind(this, simpleSegment, captions));
      return;
    }

    const timestampOffset = this.sourceUpdater_.videoTimestampOffset() === null ?
      this.sourceUpdater_.audioTimestampOffset() :
      this.sourceUpdater_.videoTimestampOffset();

    captions.forEach((caption) => {
      createCaptionsTrackIfNotExists(
        this.inbandTextTracks_, this.hls_.tech_, caption.stream);
      addCaptionData({
        captionArray: [caption],
        inbandTextTracks: this.inbandTextTracks_,
        timestampOffset
      });
    });

    // Reset stored captions since we added parsed
    // captions to a text track at this point
    if (this.captionParser_) {
      this.captionParser_.clearParsedCaptions();
    }
  }

  handleId3_(simpleSegment, id3Frames, dispatchType) {
    if (this.checkForAbort_(simpleSegment.requestId) ||
        this.abortRequestEarly_(simpleSegment.stats)) {
      return;
    }

    const segmentInfo = this.pendingSegment_;

    // we need to have appended data in order for the timestamp offset to be set
    if (!segmentInfo.hasAppendedData_) {
      this.metadataQueue_.id3.push(
        this.handleId3_.bind(this, simpleSegment, id3Frames, dispatchType));
      return;
    }

    const timestampOffset = this.sourceUpdater_.videoTimestampOffset() === null ?
      this.sourceUpdater_.audioTimestampOffset() :
      this.sourceUpdater_.videoTimestampOffset();

    // There's potentially an issue where we could double add metadata if there's a muxed
    // audio/video source with a metadata track, and an alt audio with a metadata track.
    // However, this probably won't happen, and if it does it can be handled then.
    createMetadataTrackIfNotExists(this.inbandTextTracks_, dispatchType, this.hls_.tech_);
    addMetadata({
      inbandTextTracks: this.inbandTextTracks_,
      metadataArray: id3Frames,
      timestampOffset,
      videoDuration: this.duration_()
    });
  }

  processMetadataQueue_() {
    this.metadataQueue_.id3.forEach((fn) => fn());
    this.metadataQueue_.caption.forEach((fn) => fn());

    this.metadataQueue_.id3 = [];
    this.metadataQueue_.caption = [];
  }

  processCallQueue_() {
    const callQueue = this.callQueue_;

    // this also takes care of any places within function calls where callQueue_.length is
    // checked
    this.callQueue_ = [];
    callQueue.forEach((fun) => fun());
  }

  hasEnoughInfoToAppend_() {
    if (!this.sourceUpdater_.ready()) {
      // waiting on one of the segment loaders to get enough data to create source buffers
      return false;
    }

    const segmentInfo = this.pendingSegment_;

    if (!segmentInfo) {
      // no segment to append any data for
      return false;
    }

    if (this.loaderType_ === 'main' &&
        !this.handlePartialData_ &&
        !segmentInfo.videoTimingInfo) {
      // video timing info is needed before an append can happen, since video time is the
      // "source of truth"
      // TODO handle the case where there's no video in the segment, but there is video in
      // the rendition (this case has only been noticed once before, and content is not
      // usually configured this way)
      return false;
    }

    return true;
  }

  handleData_(simpleSegment, result) {
    if (this.checkForAbort_(simpleSegment.requestId) ||
        this.abortRequestEarly_(simpleSegment.stats)) {
      return;
    }

    // If there's anything in the call queue, then this data came later and should be
    // executed after the calls currently queued.
    if (this.callQueue_.length || !this.hasEnoughInfoToAppend_()) {
      this.callQueue_.push(this.handleData_.bind(this, simpleSegment, result));
      return;
    }

    const segmentInfo = this.pendingSegment_;

    // update the time mapping so we can translate from display time to media time
    this.setTimeMapping_(segmentInfo.timeline);

    // for tracking overall stats
    this.updateMediaSecondsLoaded_(segmentInfo.segment);

    // Note that the state isn't changed from loading to appending. This is because abort
    // logic may change behavior depending on the state, and changing state too early may
    // inflate our estimates of bandwidth. In the future this should be re-examined to
    // note more granular states.

    // don't process and append data if the mediaSource is closed
    if (this.mediaSource_.readyState === 'closed') {
      return;
    }

    if (simpleSegment.map) {
      // move the map bytes onto the segment loader's segment state object
      segmentInfo.segment.map.bytes = simpleSegment.map.bytes;
    }

    if (simpleSegment.isFmp4) {
      this.trigger('fmp4');
    }

    segmentInfo.isFmp4 = simpleSegment.isFmp4;
    segmentInfo.timingInfo = segmentInfo.timingInfo || {};

    if (segmentInfo.isFmp4) {
      // for fmp4 the loader type is used to determine whether audio or video (fmp4 is
      // always considered demuxed)
      result.type = this.loaderType_ === 'main' ? 'video' : 'audio';

      segmentInfo.timingInfo.start =
        segmentInfo[timingInfoPropertyForMedia(result.type)].start;
    } else {
      const useVideoTimingInfo =
        this.loaderType_ === 'main' && this.startingMedia_.hasVideo;
      let firstVideoFrameTimeForData;

      if (useVideoTimingInfo) {
        firstVideoFrameTimeForData = this.handlePartialData_ ?
          result.videoFrameDtsTime : segmentInfo.videoTimingInfo.start;
      }

      // Segment loader knows more about segment timing than the transmuxer (in certain
      // aspects), so make any changes required for a more accurate start time.
      // Don't set the end time yet, as the segment may not be finished processing.
      segmentInfo.timingInfo.start = this.trueSegmentStart_({
        currentStart: segmentInfo.timingInfo.start,
        playlist: segmentInfo.playlist,
        mediaIndex: segmentInfo.mediaIndex,
        currentVideoTimestampOffset: this.sourceUpdater_.videoTimestampOffset(),
        useVideoTimingInfo,
        firstVideoFrameTimeForData,
        videoTimingInfo: segmentInfo.videoTimingInfo,
        audioTimingInfo: segmentInfo.audioTimingInfo
      });
    }

    // Init segments for audio and video only need to be appended in certain cases. Now
    // that data is about to be appended, we can check the final cases to determine
    // whether we should append an init segment.
    this.updateAppendInitSegmentStatus(segmentInfo, result.type);
    // Timestamp offset should be updated once we get new data and have its timing info,
    // as we use the start of the segment to offset the best guess (playlist provided)
    // timestamp offset.
    this.updateSourceBufferTimestampOffset_(segmentInfo);
    // Save some state so that in the future anything waiting on first append (and/or
    // timestamp offset(s)) can process immediately. While the extra state isn't optimal,
    // we need some notion of whether the timestamp offset or other relevant information
    // has had a chance to be set.
    segmentInfo.hasAppendedData_ = true;
    // Now that the timestamp offset should be set, we can append any waiting ID3 tags.
    this.processMetadataQueue_();

    this.appendData_(segmentInfo, result);
  }

  updateAppendInitSegmentStatus(segmentInfo, type) {
    // alt audio doesn't manage timestamp offset
    if (this.loaderType_ === 'main' &&
        typeof segmentInfo.timestampOffset === 'number' &&
        // in the case that we're handling partial data, we don't want to append an init
        // segment for each chunk
        !segmentInfo.changedTimestampOffset) {
      // if the timestamp offset changed, the timeline may have changed, so we have to re-
      // append init segments
      this.appendInitSegment_ = {
        audio: true,
        video: true
      };
    }

    if (this.playlistOfLastInitSegment_[type] !== segmentInfo.playlist) {
      // make sure we append init segment on playlist changes, in case the media config
      // changed
      this.appendInitSegment_[type] = true;
    }
  }

  getInitSegmentAndUpdateState_({ type, initSegment, map, playlist }) {
    // "The EXT-X-MAP tag specifies how to obtain the Media Initialization Section
    // (Section 3) required to parse the applicable Media Segments.  It applies to every
    // Media Segment that appears after it in the Playlist until the next EXT-X-MAP tag
    // or until the end of the playlist."
    // https://tools.ietf.org/html/draft-pantos-http-live-streaming-23#section-4.3.2.5
    if (map) {
      const id = initSegmentId(map);

      if (this.activeInitSegmentId_ === id) {
        // don't need to re-append the init segment if the ID matches
        return null;
      }

      // a map-specified init segment takes priority over any transmuxed (or otherwise
      // obtained) init segment
      //
      // this also caches the init segment for later use
      initSegment = this.initSegmentForMap(map, true).bytes;
      this.activeInitSegmentId_ = id;
    }

    // We used to always prepend init segments for video, however, that shouldn't be
    // necessary. Instead, we should only append on changes, similar to what we've always
    // done for audio. This is more important (though may not be that important) for
    // frame-by-frame appending for LHLS, simply because of the increased quantity of
    // appends.
    if (initSegment && this.appendInitSegment_[type]) {
      // Make sure we track the playlist that we last used for the init segment, so that
      // we can re-append the init segment in the event that we get data from a new
      // playlist. Discontinuities and track changes are handled in other sections.
      this.playlistOfLastInitSegment_[type] = playlist;
      // we should only be appending the next init segment if we detect a change, or if
      // the segment has a map
      this.appendInitSegment_[type] = map ? true : false;

      return initSegment;
    }

    return null;
  }

  appendToSourceBuffer_({ type, initSegment, data }) {
    const segments = [data];
    let byteLength = data.byteLength;

    if (initSegment) {
      // if the media initialization segment is changing, append it before the content
      // segment
      segments.unshift(initSegment);
      byteLength += initSegment.byteLength;
    }

    // Technically we should be OK appending the init segment separately, however, we
    // haven't yet tested that, and prepending is how we have always done things.
    const bytes = concatSegments({
      bytes: byteLength,
      segments
    });

    const videoSegmentTimingInfoCallback =
      this.handleVideoSegmentTimingInfo_.bind(this, initSegment.requestId)

    this.sourceUpdater_.appendBuffer({type, bytes, videoSegmentTimingInfoCallback}, (error) => {
      if (error) {
        this.error(error);
        // If an append errors, we can't recover.
        // (see https://w3c.github.io/media-source/#sourcebuffer-append-error).
        // Trigger a special error so that it can be handled separately from normal,
        // recoverable errors.
        this.trigger('appenderror');
      }
    });
  }

  handleVideoSegmentTimingInfo_(requestId, event) {
    if (!this.pendingSegment_ || requestId !== this.pendingSegment_.requestId) {
      return;
    }

    const segment = this.pendingSegment_.segment;

    if (!segment.videoTimingInfo) {
      segment.videoTimingInfo = {};
    }

    segment.videoTimingInfo.transmuxerPrependedSeconds =
      event.videoSegmentTimingInfo.prependedContentDuration || 0;
    segment.videoTimingInfo.transmuxedPresentationStart =
      event.videoSegmentTimingInfo.start.presentation;
    segment.videoTimingInfo.transmuxedPresentationEnd =
      event.videoSegmentTimingInfo.end.presentation;
    // mainly used as a reference for debugging
    segment.videoTimingInfo.baseMediaDecodeTime =
      event.videoSegmentTimingInfo.baseMediaDecodeTime;
  }

  appendData_(segmentInfo, result) {
    const {
      type,
      data
    } = result;

    if (!data || !data.byteLength) {
      return;
    }

    if (type === 'audio' && this.audioDisabled_) {
      return;
    }

    const initSegment = this.getInitSegmentAndUpdateState_({
      type,
      initSegment: result.initSegment,
      playlist: segmentInfo.playlist,
      map: segmentInfo.segment.map
    });

    this.appendToSourceBuffer_({ type, initSegment, data });
  }

  /**
   * load a specific segment from a request into the buffer
   *
   * @private
   */
  loadSegment_(segmentInfo) {
    this.state = 'WAITING';
    this.pendingSegment_ = segmentInfo;
    this.trimBackBuffer_(segmentInfo);

    // We'll update the source buffer's timestamp offset once we have transmuxed data, but
    // the transmuxer still needs to be updated before then.
    //
    // Even though keepOriginalTimestamps is set to true for the transmuxer, timestamp
    // offset must be passed to the transmuxer for stream correcting adjustments.
    if (this.shouldUpdateTransmuxerTimestampOffset_(segmentInfo.timestampOffset)) {
      this.gopBuffer_.length = 0;
      // gopsToAlignWith was set before the GOP buffer was cleared
      segmentInfo.gopsToAlignWith = [];
      this.timeMapping_ = 0;
      // reset values in the transmuxer since a discontinuity should start fresh
      this.transmuxer_.postMessage({
        action: 'reset'
      });
      this.transmuxer_.postMessage({
        action: 'setTimestampOffset',
        timestampOffset: segmentInfo.timestampOffset
      });
    }

    const simpleSegment = this.createSimplifiedSegmentObj_(segmentInfo);

    segmentInfo.abortRequests = mediaSegmentRequest({
      xhr: this.hls_.xhr,
      xhrOptions: this.xhrOptions_,
      decryptionWorker: this.decrypter_,
      captionParser: this.captionParser_,
      segment: simpleSegment,
      handlePartialData: this.handlePartialData_,
      progressFn: this.handleProgress_.bind(this),
      trackInfoFn: this.handleTrackInfo_.bind(this),
      timingInfoFn: this.handleTimingInfo_.bind(this),
      captionsFn: this.handleCaptions_.bind(this),
      id3Fn: this.handleId3_.bind(this),

      dataFn: this.handleData_.bind(this),
      doneFn: this.segmentRequestFinished_.bind(this)
    });
  }

  /**
   * trim the back buffer so that we don't have too much data
   * in the source buffer
   *
   * @private
   *
   * @param {Object} segmentInfo - the current segment
   */
  trimBackBuffer_(segmentInfo) {
    const removeToTime = safeBackBufferTrimTime(this.seekable_(),
                                                this.currentTime_(),
                                                this.playlist_.targetDuration || 10);

    // Chrome has a hard limit of 150MB of
    // buffer and a very conservative "garbage collector"
    // We manually clear out the old buffer to ensure
    // we don't trigger the QuotaExceeded error
    // on the source buffer during subsequent appends

    if (removeToTime > 0) {
      this.remove(0, removeToTime);
    }
  }

  /**
   * created a simplified copy of the segment object with just the
   * information necessary to perform the XHR and decryption
   *
   * @private
   *
   * @param {Object} segmentInfo - the current segment
   * @returns {Object} a simplified segment object copy
   */
  createSimplifiedSegmentObj_(segmentInfo) {
    const segment = segmentInfo.segment;
    const simpleSegment = {
      resolvedUri: segment.resolvedUri,
      byterange: segment.byterange,
      requestId: segmentInfo.requestId,
      transmuxer: segmentInfo.transmuxer,
      audioAppendStart: segmentInfo.audioAppendStart,
      gopsToAlignWith: segmentInfo.gopsToAlignWith
    };

    const previousSegment = segmentInfo.playlist.segments[segmentInfo.mediaIndex];

    if (previousSegment &&
        previousSegment.end &&
        previousSegment.timeline === segment.timeline) {
      simpleSegment.baseStartTime = previousSegment.end + segmentInfo.timestampOffset;
    }

    if (segment.key) {
      // if the media sequence is greater than 2^32, the IV will be incorrect
      // assuming 10s segments, that would be about 1300 years
      const iv = segment.key.iv || new Uint32Array([
        0, 0, 0, segmentInfo.mediaIndex + segmentInfo.playlist.mediaSequence
      ]);

      simpleSegment.key = this.segmentKey(segment.key);
      simpleSegment.key.iv = iv;
    }

    if (segment.map) {
      simpleSegment.map = this.initSegmentForMap(segment.map);
    }

    // if this request included a segment key, save that data in the cache
    if (simpleSegment.key) {
      this.segmentKey(simpleSegment.key, true);
    }

    return simpleSegment;
  }

  saveTransferStats_(stats) {
    // every request counts as a media request even if it has been aborted
    // or canceled due to a timeout
    this.mediaRequests += 1;

    if (stats) {
      this.mediaBytesTransferred += stats.bytesReceived;
      this.mediaTransferDuration += stats.roundTripTime;
    }
  }

  saveBandwidthRelatedStats_(stats) {
    this.bandwidth = stats.bandwidth;
    this.roundTrip = stats.roundTripTime;

    // byteLength will be used for throughput, and should be based on bytes receieved,
    // which we only know at the end of the request and should reflect total bytes
    // downloaded rather than just bytes processed from components of the segment
    this.pendingSegment_.byteLength = stats.bytesReceived;
  }

  handleTimeout_() {
    // although the VTT segment loader bandwidth isn't really used, it's good to
    // maintain functinality between segment loaders
    this.mediaRequestsTimedout += 1;
    this.bandwidth = 1;
    this.roundTrip = NaN;
    this.trigger('bandwidthupdate');
  }

  /**
   * Handle the callback from the segmentRequest function and set the
   * associated SegmentLoader state and errors if necessary
   *
   * @private
   */
  segmentRequestFinished_(error, simpleSegment, result) {
    // TODO handle special cases, e.g., muxed audio/video but only audio in the segment

    // check the call queue directly since this function doesn't need to deal with any
    // data, and can continue even if the source buffers are not set up and we didn't get
    // any data from the segment
    if (this.callQueue_.length) {
      this.callQueue_.push(
        this.segmentRequestFinished_.bind(this, error, simpleSegment, result));
      return;
    }

    this.saveTransferStats_(simpleSegment.stats);

    // The request was aborted and the SegmentLoader has already been reset
    if (!this.pendingSegment_) {
      this.mediaRequestsAborted += 1;
      return;
    }

    // the request was aborted and the SegmentLoader has already started
    // another request. this can happen when the timeout for an aborted
    // request triggers due to a limitation in the XHR library
    // do not count this as any sort of request or we risk double-counting
    if (simpleSegment.requestId !== this.pendingSegment_.requestId) {
      return;
    }

    // an error occurred from the active pendingSegment_ so reset everything
    if (error) {
      this.pendingSegment_ = null;
      this.state = 'READY';

      // the requests were aborted just record the aborted stat and exit
      // this is not a true error condition and nothing corrective needs
      // to be done
      if (error.code === REQUEST_ERRORS.ABORTED) {
        this.mediaRequestsAborted += 1;
        return;
      }

      this.pause();

      // the error is really just that at least one of the requests timed-out
      // set the bandwidth to a very low value and trigger an ABR switch to
      // take emergency action
      if (error.code === REQUEST_ERRORS.TIMEOUT) {
        this.handleTimeout_();
        return;
      }

      // if control-flow has arrived here, then the error is real
      // emit an error event to blacklist the current playlist
      this.mediaRequestsErrored += 1;
      this.error(error);
      this.trigger('error');
      return;
    }

    // the response was a success so set any bandwidth stats the request
    // generated for ABR purposes
    this.saveBandwidthRelatedStats_(simpleSegment.stats);

    const segmentInfo = this.pendingSegment_;

    segmentInfo.endOfAllRequests = simpleSegment.endOfAllRequests;

    if (result.gopInfo) {
      this.gopBuffer_ = updateGopBuffer(
        this.gopBuffer_, result.gopInfo, this.safeAppend_);
    }

    // Although we may have already started appending on progress, we shouldn't switch the
    // state away from loading until we are officially done loading the segment data.
    this.state = 'APPENDING';

    const isEndOfStream = detectEndOfStream(segmentInfo.playlist,
                                            this.mediaSource_,
                                            segmentInfo.mediaIndex + 1);
    const isWalkingForward = this.mediaIndex !== null;
    const isDiscontinuity = segmentInfo.timeline !== this.currentTimeline_ &&
      // TODO verify this behavior
      // currentTimeline starts at -1, but we shouldn't end the timeline switching to 0,
      // the first timeline
      segmentInfo.timeline > 0;

    if (!segmentInfo.isFmp4 &&
        (isEndOfStream || (isWalkingForward && isDiscontinuity))) {
      segmentTransmuxer.endTimeline(this.transmuxer_);
    }

    // used for testing
    this.trigger('appending');

    this.waitForAppendsToComplete_(segmentInfo);
  }

  setTimeMapping_(timeline) {
    const timelineMapping = this.syncController_.mappingForTimeline(timeline);

    if (timelineMapping !== null) {
      this.timeMapping_ = timelineMapping;
    }
  }

  updateMediaSecondsLoaded_(segment) {
    if (typeof segment.start === 'number' && typeof segment.end === 'number') {
      this.mediaSecondsLoaded += segment.end - segment.start;
    } else {
      this.mediaSecondsLoaded += segment.duration;
    }
  }

  shouldUpdateTransmuxerTimestampOffset_(timestampOffset) {
    if (timestampOffset === null) {
      return false;
    }

    // note that we're potentially using the same timestamp offset for both video and
    // audio

    if (this.loaderType_ === 'main' &&
        timestampOffset !== this.sourceUpdater_.videoTimestampOffset()) {
      return true;
    }

    if (!this.audioDisabled_ &&
        timestampOffset !== this.sourceUpdater_.audioTimestampOffset()) {
      return true;
    }

    return false;
  }

  trueSegmentStart_({
    currentStart,
    playlist,
    mediaIndex,
    firstVideoFrameTimeForData,
    currentVideoTimestampOffset,
    useVideoTimingInfo,
    videoTimingInfo,
    audioTimingInfo
  }) {
    if (typeof currentStart !== 'undefined') {
      // if start was set once, keep using it
      return currentStart;
    }

    if (!useVideoTimingInfo) {
      return audioTimingInfo.start;
    }

    const previousSegment = playlist.segments[mediaIndex - 1];

    // The start of a segment should be the start of the first full frame contained
    // within that segment. Since the transmuxer maintains a cache of incomplete data
    // from and/or the last frame seen, the start time may reflect a frame that starts
    // in the previous segment. Check for that case and ensure the start time is
    // accurate for the segment.
    if (mediaIndex === 0 ||
        !previousSegment ||
        typeof previousSegment.start === 'undefined' ||
        previousSegment.end !==
          (firstVideoFrameTimeForData + currentVideoTimestampOffset)) {
      return firstVideoFrameTimeForData;
    }

    return videoTimingInfo.start;
  }

  waitForAppendsToComplete_(segmentInfo) {
    // Although transmuxing is done, appends may not yet be finished. Throw a marker
    // on each queue this loader is responsible for to ensure that the appends are
    // complete.
    const waitForVideo = this.loaderType_ === 'main' && this.startingMedia_.hasVideo;
    const waitForAudio = !this.audioDisabled_ && this.startingMedia_.hasAudio;

    segmentInfo.waitingOnAppends = 0;

    // Since source updater could call back synchronously, do the increments first.
    if (waitForVideo) {
      segmentInfo.waitingOnAppends++;
    }
    if (waitForAudio) {
      segmentInfo.waitingOnAppends++;
    }

    if (waitForVideo) {
      this.sourceUpdater_.videoQueueCallback(
        this.checkAppendsDone_.bind(this, segmentInfo));
    }
    if (waitForAudio) {
      this.sourceUpdater_.audioQueueCallback(
        this.checkAppendsDone_.bind(this, segmentInfo));
    }
  }

  checkAppendsDone_(segmentInfo) {
    if (this.checkForAbort_(segmentInfo.requestId)) {
      return;
    }

    segmentInfo.waitingOnAppends--;

    if (segmentInfo.waitingOnAppends === 0) {
      this.handleAppendsDone_();
    }
  }

  checkForIllegalMediaSwitch(trackInfo) {
    const illegalMediaSwitchError =
      illegalMediaSwitch(this.loaderType_, this.startingMedia_, trackInfo);

    if (illegalMediaSwitchError) {
      this.error({
        message: illegalMediaSwitchError,
        blacklistDuration: Infinity
      });
      this.trigger('error');
      return true;
    }

    return false;
  }

  updateSourceBufferTimestampOffset_(segmentInfo) {
    if (segmentInfo.timestampOffset === null ||
        // we don't yet have the start for whatever media type (video or audio) has
        // priority, timing-wise, so we must wait
        typeof segmentInfo.timingInfo.start !== 'number' ||
        // already updated the timestamp offset for this segment
        segmentInfo.changedTimestampOffset ||
        // the alt audio loader should not be responsible for setting the timestamp offset
        this.loaderType_ !== 'main') {
      return;
    }

    let didChange = false;

    // Primary timing goes by video, and audio is trimmed in the transmuxer, meaning that
    // the timing info here comes from video. In the event that the audio is longer than
    // the video, this will trim the start of the audio.
    // This also trims any offset from 0 at the beginning of the media
    segmentInfo.timestampOffset -= segmentInfo.timingInfo.start;
    // In the event that there are partial segment downloads, each will try to update the
    // timestamp offset. Retaining this bit of state prevents us from updating in the
    // future (within the same segment), however, there may be a better way to handle it.
    segmentInfo.changedTimestampOffset = true;

    if (segmentInfo.timestampOffset !== this.sourceUpdater_.videoTimestampOffset()) {
      this.sourceUpdater_.videoTimestampOffset(segmentInfo.timestampOffset);
      didChange = true;
    }

    if (segmentInfo.timestampOffset !== this.sourceUpdater_.audioTimestampOffset()) {
      this.sourceUpdater_.audioTimestampOffset(segmentInfo.timestampOffset);
      didChange = true;
    }

    if (didChange) {
      this.trigger('timestampoffset');
    }
  }

  updateTimingInfoEnd_(segmentInfo) {
    const useVideoTimingInfo =
      this.loaderType_ === 'main' && this.startingMedia_.hasVideo;
    const prioritizedTimingInfo = useVideoTimingInfo && segmentInfo.videoTimingInfo ?
      segmentInfo.videoTimingInfo : segmentInfo.audioTimingInfo;

    segmentInfo.timingInfo.end = typeof prioritizedTimingInfo.end === 'number' ?
      // End time may not exist in a case where we aren't parsing the full segment (one
      // current example is the case of fmp4), so use the rough duration to calculate an
      // end time.
      prioritizedTimingInfo.end : prioritizedTimingInfo.start + segmentInfo.duration;
  }

  /**
   * callback to run when appendBuffer is finished. detects if we are
   * in a good state to do things with the data we got, or if we need
   * to wait for more
   *
   * @private
   */
  handleAppendsDone_() {
    if (!this.pendingSegment_) {
      this.state = 'READY';
      // TODO should this move into this.checkForAbort to speed up requests post abort in
      // all appending cases?
      if (!this.paused()) {
        this.monitorBuffer_();
      }
      return;
    }

    const segmentInfo = this.pendingSegment_;

    // Now that the end of the segment has been reached, we can set the end time. It's
    // best to wait until all appends are done so we're sure that the primary media is
    // finished (and we have its end time).
    this.updateTimingInfoEnd_(segmentInfo);
    this.syncController_.saveSegmentTimingInfo(segmentInfo);

    this.logger_(segmentInfoString(segmentInfo));

    this.recordThroughput_(segmentInfo);
    this.pendingSegment_ = null;
    this.state = 'READY';

    // TODO minor, but for partial segment downloads, this can be done earlier to save
    // on bandwidth and download time
    if (segmentInfo.isSyncRequest) {
      this.trigger('syncinfoupdate');
      return;
    }

    this.addSegmentMetadataCue_(segmentInfo);
    this.fetchAtBuffer_ = true;
    this.currentTimeline_ = segmentInfo.timeline;

    // We must update the syncinfo to recalculate the seekable range before
    // the following conditional otherwise it may consider this a bad "guess"
    // and attempt to resync when the post-update seekable window and live
    // point would mean that this was the perfect segment to fetch
    this.trigger('syncinfoupdate');

    const segment = segmentInfo.segment;

    // If we previously appended a segment that ends more than 3 targetDurations before
    // the currentTime_ that means that our conservative guess was too conservative.
    // In that case, reset the loader state so that we try to use any information gained
    // from the previous request to create a new, more accurate, sync-point.
    if (segment.end &&
        this.currentTime_() - segment.end > segmentInfo.playlist.targetDuration * 3) {
      this.resetEverything();
      return;
    }

    const isWalkingForward = this.mediaIndex !== null;

    // Don't do a rendition switch unless we have enough time to get a sync segment
    // and conservatively guess
    if (isWalkingForward) {
      this.trigger('bandwidthupdate');
    }
    this.trigger('progress');

    this.mediaIndex = segmentInfo.mediaIndex;

    // used for testing
    this.trigger('appended');

    // any time an update finishes and the last segment is in the
    // buffer, end the stream. this ensures the "ended" event will
    // fire if playback reaches that point.
    if (this.isEndOfStream_(segmentInfo.mediaIndex + 1, segmentInfo.playlist)) {
      this.endOfStream();
    }

    if (!this.paused()) {
      this.monitorBuffer_();
    }
  }

  /**
   * Records the current throughput of the decrypt, transmux, and append
   * portion of the semgment pipeline. `throughput.rate` is a the cumulative
   * moving average of the throughput. `throughput.count` is the number of
   * data points in the average.
   *
   * @private
   * @param {Object} segmentInfo the object returned by loadSegment
   */
  recordThroughput_(segmentInfo) {
    const rate = this.throughput.rate;
    // Add one to the time to ensure that we don't accidentally attempt to divide
    // by zero in the case where the throughput is ridiculously high
    const segmentProcessingTime =
      Date.now() - segmentInfo.endOfAllRequests + 1;
    // Multiply by 8000 to convert from bytes/millisecond to bits/second
    const segmentProcessingThroughput =
      Math.floor((segmentInfo.byteLength / segmentProcessingTime) * 8 * 1000);

    // This is just a cumulative moving average calculation:
    //   newAvg = oldAvg + (sample - oldAvg) / (sampleCount + 1)
    this.throughput.rate +=
      (segmentProcessingThroughput - rate) / (++this.throughput.count);
  }

  /**
   * Adds a cue to the segment-metadata track with some metadata information about the
   * segment
   *
   * @private
   * @param {Object} segmentInfo
   *        the object returned by loadSegment
   * @method addSegmentMetadataCue_
   */
  addSegmentMetadataCue_(segmentInfo) {
    if (!this.segmentMetadataTrack_) {
      return;
    }

    const segment = segmentInfo.segment;
    const start = segment.start;
    const end = segment.end;

    // Do not try adding the cue if the start and end times are invalid.
    if (!finite(start) || !finite(end)) {
      return;
    }

    removeCuesFromTrack(start, end, this.segmentMetadataTrack_);

    const Cue = window.WebKitDataCue || window.VTTCue;
    const value = {
      custom: segment.custom,
      dateTimeObject: segment.dateTimeObject,
      dateTimeString: segment.dateTimeString,
      bandwidth: segmentInfo.playlist.attributes.BANDWIDTH,
      resolution: segmentInfo.playlist.attributes.RESOLUTION,
      codecs: segmentInfo.playlist.attributes.CODECS,
      byteLength: segmentInfo.byteLength,
      uri: segmentInfo.uri,
      timeline: segmentInfo.timeline,
      playlist: segmentInfo.playlist.uri,
      start,
      end
    };
    const data = JSON.stringify(value);
    const cue = new Cue(start, end, data);

    // Attach the metadata to the value property of the cue to keep consistency between
    // the differences of WebKitDataCue in safari and VTTCue in other browsers
    cue.value = value;

    this.segmentMetadataTrack_.addCue(cue);
  }
}
