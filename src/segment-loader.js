/**
 * @file segment-loader.js
 */
import Playlist from './playlist';
import videojs from 'video.js';
import work from 'webwackify';
import Config from './config';
import window from 'global/window';
import BinUtils from './bin-utils';
import { mediaSegmentRequest, REQUEST_ERRORS } from './media-segment-request';
import transmuxerWorker from './transmuxer-worker';
import segmentTransmuxer from './segment-transmuxer';
import { TIME_FUDGE_FACTOR, timeUntilRebuffer as timeUntilRebuffer_ } from './ranges';
import { minRebufferMaxBandwidthSelector } from './playlist-selectors';
import logger from './util/logger';
import { concatSegments } from './util/segment';
import { concatTypedArrays } from './util/typed-array';
import {
  addTextTrackData,
  createTextTracksIfNecessary,
  removeCuesFromTrack
} from './util/text-tracks';
import { gopsSafeToAlignWith, removeGopBuffer, updateGopBuffer } from './util/gops';

const { initSegmentId } = BinUtils;

const workerResolve = () => {
  let result;

  try {
    result = require.resolve('./transmuxer-worker');
  } catch (e) {
    // no result
  }

  return result;
};

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

  if (!trackInfo.containsAudio && !trackInfo.containsVideo) {
    return 'Neither audio nor video found in segment.';
  }

  if (startingMedia.containsVideo && !trackInfo.containsVideo) {
    return 'Only audio found in segment when we expected video.' +
      ' We can\'t switch to audio only from a stream that had video.' +
      ' To get rid of this message, please add codec information to the manifest.';
  }

  if (!startingMedia.containsVideo && trackInfo.containsVideo) {
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

const isFmp4 = (segment) => {
  // TODO we need a better way if determining if a segment is an mp4 or not. We rely on
  // this method at the moment because the spec requires a map tag on each fmp4
  // segment), however, ts segments may have the map tag as well
  return !!segment.map;
};

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
    this.startingMedia_ = void 0;
    this.segmentMetadataTrack_ = settings.segmentMetadataTrack;
    this.goalBufferLength_ = settings.goalBufferLength;
    this.sourceType_ = settings.sourceType;
    this.sourceUpdater_ = settings.sourceUpdater;
    this.inbandTextTracks_ = settings.inbandTextTracks;
    this.state_ = 'INIT';

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

    // Fragmented mp4 playback
    this.activeInitSegmentId_ = null;
    this.initSegments_ = {};

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

    this.mediaSource_.addEventListener('sourceopen', () => this.ended_ = false);

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
  }

  createTransmuxer_() {
    const transmuxer = work(transmuxerWorker, workerResolve());

    transmuxer.postMessage({
      action: 'init',
      options: {
        remux: false,
        alignGopsAtEnd: this.safeAppend_,
        keepOriginalTimestamps: true
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
    if (this.transmuxer) {
      this.transmuxer_.terminate();
    }
    if (this.sourceUpdater_) {
      this.sourceUpdater_.dispose();
    }
    this.resetStats_();
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
        bytes: map.bytes
      };
    }

    return storedMap || map;
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

    const oldId = oldPlaylist ? oldPlaylist.id : null;

    this.logger_(`playlist update [${oldId} => ${newPlaylist.id}]`);

    // in VOD, this is always a rendition switch (or we updated our syncInfo above)
    // in LIVE, we always want to update with new playlists (including refreshes)
    this.trigger('syncinfoupdate');

    // if we were unpaused but waiting for a playlist, start
    // buffering now
    if (this.state === 'INIT' && this.couldBeginLoading_()) {
      return this.init_();
    }

    if (!oldPlaylist || oldPlaylist.uri !== newPlaylist.uri) {
      if (this.mediaIndex !== null) {
        // we must "resync" the segment loader when we switch renditions and
        // the segment loader is already synced to the previous rendition
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
    // in `handleUpdateEnd_` after the segment has been successfully appended
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
   */
  resetEverything() {
    this.ended_ = false;
    this.resetLoader();
    if (this.transmuxer_) {
      segmentTransmuxer.reset(this.transmuxer_);
    }
    this.remove(0, this.duration_());
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
    this.mediaIndex = null;
    this.syncPoint_ = null;
    this.abort();
  }

  /**
   * Remove any data in the source buffer between start and end times
   * @param {Number} start - the start time of the region to remove from the buffer
   * @param {Number} end - the end time of the region to remove from the buffer
   */
  remove(start, end) {
    if (this.sourceUpdater_) {
      if (!this.audioDisabled) {
        this.sourceUpdater_.removeAudio(start, end);
      }
      if (this.loaderType_ === 'main') {
        this.gopBuffer_ = removeGopBuffer(this.gopBuffer_, start, end, this.timeMapping_);
        this.sourceUpdater_.removeVideo(start, end);
      }
    }

    // remove any captions and ID3 tags
    for (let track in this.inbandTextTracks_) {
      removeCuesFromTrack(start, end, this.inbandTextTracks_[track]);
    }
    removeCuesFromTrack(start, end, this.segmentMetadataTrack_);
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

    // see if we need to begin loading immediately
    let segmentInfo = this.checkBuffer_(this.buffered_(),
                                        this.playlist_,
                                        this.mediaIndex,
                                        this.hasPlayed_(),
                                        this.currentTime_(),
                                        this.syncPoint_);

    if (!segmentInfo) {
      return;
    }

    let isEndOfStream = detectEndOfStream(this.playlist_,
                                          this.mediaSource_,
                                          segmentInfo.mediaIndex);

    if (isEndOfStream) {
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
    // offset on the source buffer
    if (segmentInfo.timeline !== this.currentTimeline_ ||
        this.startsBeforeTimestampOffset(segmentInfo)) {
      segmentInfo.timestampOffset = segmentInfo.startOfSegment;
    }

    this.loadSegment_(segmentInfo);
  }

  startsBeforeTimestampOffset(segmentInfo) {
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

    if (audioBuffered && audioBuffered.length) {
      audioAppendStart = audioBuffered.end(audioBuffered.length - 1);
    }

    if (videoBuffered) {
      gopsToAlignWith = gopsSafeToAlignWith(
        this.gopBuffer_, this.currentTime_(), this.timeMapping_);
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

  setupSourceBuffers_(trackInfo) {
    this.sourceUpdater_.createSourceBuffers({
      audio: trackInfo.containsAudio ? {} : null,
      video: trackInfo.containsVideo ? {} : null
    });

    if (this.checkForIllegalMediaSwitch(trackInfo)) {
      return;
    }
  }

  handleData_(simpleSegment, result) {
    if (this.checkForAbort_(simpleSegment.requestId) ||
        this.abortRequestEarly_(simpleSegment.stats)) {
      return;
    }

    if (isFmp4(simpleSegment)) {
      // fmp4 isn't parsed (yet), therefore doesn't have track info
      // fmp4 is always demuxed (current assumption)
      // TODO audio only
      simpleSegment.trackInfo = {
        containsAudio: this.loaderType_ === 'audio',
        containsVideo: this.loaderType_ === 'main'
      };
    }
    this.setupSourceBuffers_(simpleSegment.trackInfo);

    const segmentInfo = this.pendingSegment_;

    this.setTimeMapping_(segmentInfo.timeline);

    segmentInfo.byteLength += result.data.byteLength;
    this.updateMediaSecondsLoaded_(segmentInfo.segment);

    // Note that the state isn't changed from loading to appending. This is because abort
    // logic may change behavior depending on the state, and changing state too early may
    // inflate our estimates of bandwidth. In the future this should be re-examined to
    // note more granular states.

    // don't process and append data if the mediaSource is closed
    if (this.mediaSource_.readyState === 'closed') {
      return;
    }

    if (isFmp4(segmentInfo.segment)) {
      // TODO do we need this here? maybe handle map directly
      segmentInfo.segment.map.bytes = simpleSegment.map.bytes;
      segmentInfo.timingInfo = result.timingInfo;
    } else {
      segmentInfo.timingInfo = this.updatedTimingInfo_({
        currentTimingInfo: segmentInfo.timingInfo,
        playlist: segmentInfo.playlist,
        mediaIndex: segmentInfo.mediaIndex,
        videoDtsTimeFromTransmuxed: result.videoDtsTime,
        currentVideoTimestampOffset: this.sourceUpdater_.videoTimestampOffset(),
        useVideoTimingInfo:
          this.loaderType_ === 'main' && this.startingMedia_.containsVideo,
        videoTimingInfo: result.videoTimingInfo,
        audioTimingInfo: result.audioTimingInfo
      });
    }

    // Timestamp offset should be updated once we get new data and have its timing info,
    // as we use the start of the segment to offset the best guess (playlist provided)
    // timestamp offset.
    this.updateTimestampOffset_(segmentInfo);

    this.appendData_(segmentInfo, result);
  }

  appendData_(segmentInfo, result) {
    // Merge multiple video and audio segments into one and append
    const {
      type,
      data,
    } = result;
    let initSegment = result.initSegment;

    if (!data || !data.byteLength) {
      return;
    }

    if (type === 'audio' && this.audioDisabled_) {
      return;
    }

    const segments = [data];
    let byteLength = data.byteLength;

    // fmp4
    if (segmentInfo.segment.map) {
      // if the media initialization segment is changing, append it before the content
      // segment
      const initId = initSegmentId(segmentInfo.segment.map);

      if (!this.activeInitSegmentId_ || this.activeInitSegmentId_ !== initId) {
        initSegment = this.initSegmentForMap(segmentInfo.segment.map);
      }
    }

    // TODO handle resetting appendInitSegment (discos, track changes, and media changes)
    // We also may or may not want to always append the init segment for video (we used to
    // always append it for each video segment). Consider appending on each new segment.
    if (initSegment && this.appendInitSegment_[type]) {
      this.appendInitSegment_[type] = segmentInfo.segment.map ? true : false;

      segments.unshift(initSegment);
      byteLength += initSegment.byteLength;
    }

    const bytes = concatSegments({
      bytes: byteLength,
      segments
    });

    // no need for a callback on progress, just keep pushing data on
    this.sourceUpdater_.appendBuffer(type, bytes, () => {});
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
    // the transmuxer still needs to be updated before then. In the future we may want to
    // remove this since we are using actual timestamps from the transmuxer, and rely only
    // on setting the offset on the source buffers.
    this.updateTransmuxerTimestampOffset_(segmentInfo);

    const simpleSegment = this.createSimplifiedSegmentObj_(segmentInfo);

    segmentInfo.abortRequests = mediaSegmentRequest(this.hls_.xhr,
      this.xhrOptions_,
      this.decrypter_,
      simpleSegment,
      // progress callback
      this.handleProgress_.bind(this),
      this.handleData_.bind(this),
      this.segmentRequestFinished_.bind(this));
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

    if (segment.key) {
      // if the media sequence is greater than 2^32, the IV will be incorrect
      // assuming 10s segments, that would be about 1300 years
      const iv = segment.key.iv || new Uint32Array([
        0, 0, 0, segmentInfo.mediaIndex + segmentInfo.playlist.mediaSequence
      ]);

      simpleSegment.key = {
        resolvedUri: segment.key.resolvedUri,
        iv
      };
    }

    if (isFmp4(segment)) {
      simpleSegment.map = this.initSegmentForMap(segment.map);
    }

    return simpleSegment;
  }

  /**
   * Handle the callback from the segmentRequest function and set the
   * associated SegmentLoader state and errors if necessary
   *
   * @private
   */
  segmentRequestFinished_(error, simpleSegment, result) {
    // every request counts as a media request even if it has been aborted
    // or canceled due to a timeout
    this.mediaRequests += 1;

    if (simpleSegment.stats) {
      this.mediaBytesTransferred += simpleSegment.stats.bytesReceived;
      this.mediaTransferDuration += simpleSegment.stats.roundTripTime;
    }

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
        this.mediaRequestsTimedout += 1;
        this.bandwidth = 1;
        this.roundTrip = NaN;
        this.trigger('bandwidthupdate');
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
    this.bandwidth = simpleSegment.stats.bandwidth;
    this.roundTrip = simpleSegment.stats.roundTripTime;

    const segmentInfo = this.pendingSegment_;

    segmentInfo.endOfAllRequests = simpleSegment.endOfAllRequests;

    // TODO this and below, we may not have result from before
    if (result.gopInfo) {
      this.gopBuffer_ = updateGopBuffer(
        this.gopBuffer_, result.gopInfo, this.safeAppend_);
    }

    const prioritizedTimestampOffset =
      this.sourceUpdater_.videoTimestampOffset() === null ?
        this.sourceUpdater_.videoTimestampOffset() :
        this.sourceUpdater_.audioTimestampOffset();

    // TODO eventually we may want to do this elsewhere so we don't have to pass in the
    // tech (and can handle removes more gracefully)
    createTextTracksIfNecessary(this.inbandTextTracks_, this.hls_.tech_, result);
    // There's potentially an issue where we could double add metadata if there's a
    // muxed audio/video source with a metadata track, and an alt audio with a metadata
    // track. However, this probably won't happen, and if it does it can be handled then.
    addTextTrackData({
      inbandTextTracks: this.inbandTextTracks_,
      timestampOffset: prioritizedTimestampOffset,
      videoDuration: this.duration_(),
      captionArray: result.captions,
      metadataArray: result.metadata
    });

    // Although we may have already started appending on progress, we shouldn't switch the
    // state away from loading until we are officially done loading the segment data.
    this.state = 'APPENDING';

    const isEndOfStream = detectEndOfStream(segmentInfo.playlist,
                                            this.mediaSource_,
                                            segmentInfo.mediaIndex + 1);
    const isWalkingForward = this.mediaIndex !== null;
    const isDiscontinuity = segmentInfo.timeline !== this.currentTimeline_;

    if (isEndOfStream || (isWalkingForward && isDiscontinuity)) {
      segmentTransmuxer.endTimeline(this.transmuxer_);
    }

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

  updateTransmuxerTimestampOffset_(segmentInfo) {
    // note that we're potentially using the same timestamp offset for both video and
    // audio
    const timestampOffset = segmentInfo.timestampOffset;
    let shouldSetTimestampOffset = false;

    if (this.loaderType_ === 'main' &&
        timestampOffset !== this.sourceUpdater_.videoTimestampOffset()) {
      shouldSetTimestampOffset = true;
    }

    if (!this.audioDisabled_ &&
        timestampOffset !== this.sourceUpdater_.audioTimestampOffset()) {
      shouldSetTimestampOffset = true;
    }

    if (timestampOffset !== null && shouldSetTimestampOffset) {
      // this won't shift the timestamps (since keepOriginalTimestamps is set to true),
      // however, the transmuxer needs to know there was a discontinuity to reset other
      // values
      this.gopBuffer_.length = 0;
      this.timeMapping_ = 0;
      this.transmuxer_.postMessage({
        action: 'setTimestampOffset',
        timestampOffset: timestampOffset
      });
    }
  }

  updatedTimingInfo_({
    currentTimingInfo,
    playlist,
    mediaIndex,
    videoDtsTimeFromTransmuxed,
    currentVideoTimestampOffset,
    useVideoTimingInfo,
    videoTimingInfo,
    audioTimingInfo
  }) {
    const updatedTimingInfo = currentTimingInfo || {};

    // TODO clean up
    if (typeof updatedTimingInfo.start === 'undefined') {
      // The start of a segment should be the start of the first full frame contained
      // within that segment. Since the transmuxer maintains a cache of incomplete data
      // from and/or the last frame seen, the start time may reflect a frame that starts
      // in the previous segment. Check for that case and ensure the start time is
      // accurate for the segment.
      if (useVideoTimingInfo) {
        const previousSegment = playlist.segments[mediaIndex - 1];

        if (mediaIndex === 0 ||
            !previousSegment ||
            typeof previousSegment.start === 'undefined' ||
            previousSegment.end !==
              (videoDtsTimeFromTransmuxed + currentVideoTimestampOffset)) {
          updatedTimingInfo.start = videoDtsTimeFromTransmuxed;
        }
      } else {
        updatedTimingInfo.start = audioTimingInfo.start;
      }
    }

    // TODO timing info may want to be moved to media segment request
    // it's possible we transmux audio after finishing video, so don't set the timing
    // info if it doesn't come back from the function
    updatedTimingInfo.end = useVideoTimingInfo && videoTimingInfo ?
      videoTimingInfo.end : audioTimingInfo ?
      audioTimingInfo.end : updatedTimingInfo.end;

    return updatedTimingInfo;
  }

  waitForAppendsToComplete_(segmentInfo) {
    // Although transmuxing is done, appends may not yet be finished. Throw a marker
    // on each queue this loader is responsible for to ensure that the appends are
    // complete.
    const waitForVideo = this.loaderType_ === 'main' && this.startingMedia_.containsVideo;
    const waitForAudio = !this.audioDisabled;

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
      this.handleUpdateEnd_();
    }
  }

  checkForIllegalMediaSwitch(trackInfo) {
    // When we have our first timing info, determine what media types this loader is
    // dealing with. Although we're maintaining extra state, it helps to preserve the
    // separation of segment loader from the actual source buffers.
    if (typeof this.startingMedia_ === 'undefined' &&
        // Guard against cases where we're not getting timing info at all until we are
        // certain that all streams will provide it.
        (trackInfo.containsAudio || trackInfo.containsVideo)) {
      this.startingMedia_ = {
        containsAudio: trackInfo.containsAudio,
        containsVideo: trackInfo.containsVideo
      };
    }

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

  updateTimestampOffset_(segmentInfo) {
    // if there's no timestamp offset or it's already been changed once for this segment,
    // don't do it again
    if (segmentInfo.timestampOffset === null || segmentInfo.changedTimestampOffset) {
      return;
    }

    let didChange = false;

    // Primary timing goes by video, and audio is trimmed in the transmuxer, meaning that
    // the timing info here comes from video. In the event that the audio is longer than
    // the video, this will trim the start of the audio.
    segmentInfo.timestampOffset -= segmentInfo.timingInfo.start;
    // TODO in the even that there are partial segment downloads, each will try to update
    // the timestamp offset. Retaining this bit of state prevents us from updating in the
    // future (within the same segment), however, there may be a better way to handle it.
    segmentInfo.changedTimestampOffset = true;

    if (this.loaderType_ === 'main' &&
        segmentInfo.timestampOffset !== this.sourceUpdater_.videoTimestampOffset()) {
      this.sourceUpdater_.videoTimestampOffset(segmentInfo.timestampOffset);
      didChange = true;
    }

    if (!this.audioDisabled_ &&
        segmentInfo.timestampOffset !== this.sourceUpdater_.audioTimestampOffset()) {
      this.sourceUpdater_.audioTimestampOffset(segmentInfo.timestampOffset);
      didChange = true;
    }

    if (didChange) {
      this.trigger('timestampoffset');
    }
  }

  /**
   * callback to run when appendBuffer is finished. detects if we are
   * in a good state to do things with the data we got, or if we need
   * to wait for more
   *
   * @private
   */
  handleUpdateEnd_() {
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
    const segment = segmentInfo.segment;
    const isWalkingForward = this.mediaIndex !== null;

    this.syncController_.saveSegmentTimingInfo(segmentInfo);

    this.logger_(segmentInfoString(segmentInfo));

    // TODO for partial segment downloads, this can be done much earlier
    if (segmentInfo.isSyncRequest) {
      this.trigger('syncinfoupdate');
      this.pendingSegment_ = null;
      this.state = 'READY';
      return;
    }

    this.pendingSegment_ = null;
    this.recordThroughput_(segmentInfo);
    this.addSegmentMetadataCue_(segmentInfo);

    this.state = 'READY';

    this.mediaIndex = segmentInfo.mediaIndex;
    this.fetchAtBuffer_ = true;
    this.currentTimeline_ = segmentInfo.timeline;

    // We must update the syncinfo to recalculate the seekable range before
    // the following conditional otherwise it may consider this a bad "guess"
    // and attempt to resync when the post-update seekable window and live
    // point would mean that this was the perfect segment to fetch
    this.trigger('syncinfoupdate');

    // If we previously appended a segment that ends more than 3 targetDurations before
    // the currentTime_ that means that our conservative guess was too conservative.
    // In that case, reset the loader state so that we try to use any information gained
    // from the previous request to create a new, more accurate, sync-point.
    if (segment.end &&
        this.currentTime_() - segment.end > segmentInfo.playlist.targetDuration * 3) {
      this.resetEverything();
      return;
    }

    // Don't do a rendition switch unless we have enough time to get a sync segment
    // and conservatively guess
    if (isWalkingForward) {
      this.trigger('bandwidthupdate');
    }
    this.trigger('progress');

    // any time an update finishes and the last segment is in the
    // buffer, end the stream. this ensures the "ended" event will
    // fire if playback reaches that point.
    const isEndOfStream = detectEndOfStream(segmentInfo.playlist,
                                            this.mediaSource_,
                                            segmentInfo.mediaIndex + 1);

    if (isEndOfStream) {
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
