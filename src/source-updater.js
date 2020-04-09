/**
 * @file source-updater.js
 */
import videojs from 'video.js';
import logger from './util/logger';
import noop from './util/noop';
import { buffered } from './util/buffer';
import {getMimeForCodec} from '@videojs/vhs-utils/dist/codecs.js';

const updating = (type, sourceUpdater) => {
  const sourceBuffer = sourceUpdater[`${type}Buffer`];

  return (sourceBuffer && sourceBuffer.updating) || sourceUpdater.queuePending[type];
};

const nextQueueIndexOfType = (type, queue) => {
  for (let i = 0; i < queue.length; i++) {
    const queueEntry = queue[i];

    if (queueEntry.type === 'mediaSource') {
      // If the next entry is a media source entry (uses multiple source buffers), block
      // processing to allow it to go through first.
      return null;
    }

    if (queueEntry.type === type) {
      return i;
    }
  }

  return null;
};

const shiftQueue = (type, sourceUpdater) => {
  if (sourceUpdater.queue.length === 0) {
    return;
  }

  let queueIndex = 0;
  let queueEntry = sourceUpdater.queue[queueIndex];

  if (queueEntry.type === 'mediaSource') {
    if (!sourceUpdater.updating()) {
      sourceUpdater.queue.shift();
      queueEntry.action(sourceUpdater);

      if (queueEntry.doneFn) {
        queueEntry.doneFn();
      }

      // Only specific source buffer actions must wait for async updateend events. Media
      // Source actions process synchronously. Therefore, both audio and video source
      // buffers are now clear to process the next queue entries.
      shiftQueue('audio', sourceUpdater);
      shiftQueue('video', sourceUpdater);
    }

    // Media Source actions require both source buffers, so if the media source action
    // couldn't process yet (because one or both source buffers are busy), block other
    // queue actions until both are available and the media source action can process.
    return;
  }

  if (type === 'mediaSource') {
    // If the queue was shifted by a media source action (this happens when pushing a
    // media source action onto the queue), then it wasn't from an updateend event from an
    // audio or video source buffer, so there's no change from previous state, and no
    // processing should be done.
    return;
  }

  // Media source queue entries don't need to consider whether the source updater is
  // started (i.e., source buffers are created) as they don't need the source buffers, but
  // source buffer queue entries do.
  if (!sourceUpdater.started_ || updating(type, sourceUpdater)) {
    return;
  }

  if (queueEntry.type !== type) {
    queueIndex = nextQueueIndexOfType(type, sourceUpdater.queue);

    if (queueIndex === null) {
      // Either there's no queue entry that uses this source buffer type in the queue, or
      // there's a media source queue entry before the next entry of this type, in which
      // case wait for that action to process first.
      return;
    }

    queueEntry = sourceUpdater.queue[queueIndex];
  }

  sourceUpdater.queue.splice(queueIndex, 1);
  queueEntry.action(type, sourceUpdater);

  if (!queueEntry.doneFn) {
    // synchronous operation, process next entry
    shiftQueue(type, sourceUpdater);
    return;
  }

  // asynchronous operation, so keep a record that this source buffer type is in use
  sourceUpdater.queuePending[type] = queueEntry;
};

const actions = {
  appendBuffer: (bytes, segmentInfo) => (type, sourceUpdater) => {
    const sourceBuffer = sourceUpdater[`${type}Buffer`];

    sourceUpdater.logger_(`Appending segment ${segmentInfo.mediaIndex}'s ${bytes.length} bytes to ${type}Buffer`);

    sourceBuffer.appendBuffer(bytes);
  },
  remove: (start, end) => (type, sourceUpdater) => {
    const sourceBuffer = sourceUpdater[`${type}Buffer`];

    sourceBuffer.removing = true;

    sourceUpdater.logger_(`Removing ${start} to ${end} from ${type}Buffer`);
    sourceBuffer.remove(start, end);
  },
  timestampOffset: (offset) => (type, sourceUpdater) => {
    const sourceBuffer = sourceUpdater[`${type}Buffer`];

    sourceUpdater.logger_(`Setting ${type}timestampOffset to ${offset}`);

    sourceBuffer.timestampOffset = offset;
  },
  callback: (callback) => (type, sourceUpdater) => {
    callback();
  },
  endOfStream: (error) => (sourceUpdater) => {
    if (sourceUpdater.mediaSource.readyState !== 'open') {
      return;
    }
    sourceUpdater.logger_(`Calling mediaSource endOfStream(${error || ''})`);

    try {
      sourceUpdater.mediaSource.endOfStream(error);
    } catch (e) {
      videojs.log.warn('Failed to call media source endOfStream', e);
    }
  },
  duration: (duration) => (sourceUpdater) => {
    sourceUpdater.logger_(`Setting mediaSource duration to ${duration}`);
    try {
      sourceUpdater.mediaSource.duration = duration;
    } catch (e) {
      videojs.log.warn('Failed to set media source duration', e);
    }
  }
};

const pushQueue = ({type, sourceUpdater, action, doneFn, name}) => {
  sourceUpdater.queue.push({
    type,
    action,
    doneFn,
    name
  });
  shiftQueue(type, sourceUpdater);
};

const onUpdateend = (type, sourceUpdater) => (e) => {
  // Although there should, in theory, be a pending action for any updateend receieved,
  // there are some actions that may trigger updateend events without set definitions in
  // the w3c spec. For instance, setting the duration on the media source may trigger
  // updateend events on source buffers. This does not appear to be in the spec. As such,
  // if we encounter an updateend without a corresponding pending action from our queue
  // for that source buffer type, process the next action.
  if (sourceUpdater.queuePending[type]) {
    sourceUpdater[`${type}Buffer`].removing = false;
    const doneFn = sourceUpdater.queuePending[type].doneFn;

    sourceUpdater.queuePending[type] = null;

    if (doneFn) {
      // if there's an error, report it
      doneFn(sourceUpdater[`${type}Error_`]);
    }
  }

  shiftQueue(type, sourceUpdater);
};

/**
 * A queue of callbacks to be serialized and applied when a
 * MediaSource and its associated SourceBuffers are not in the
 * updating state. It is used by the segment loader to update the
 * underlying SourceBuffers when new data is loaded, for instance.
 *
 * @class SourceUpdater
 * @param {MediaSource} mediaSource the MediaSource to create the SourceBuffer from
 * @param {string} mimeType the desired MIME type of the underlying SourceBuffer
 */
export default class SourceUpdater extends videojs.EventTarget {
  constructor(mediaSource) {
    super();
    this.mediaSource = mediaSource;
    this.logger_ = logger('SourceUpdater');
    // initial timestamp offset is 0
    this.audioTimestampOffset_ = 0;
    this.videoTimestampOffset_ = 0;
    this.queue = [];
    this.queuePending = {
      audio: null,
      video: null
    };
    this.delayedAudioAppendQueue_ = [];
    this.videoAppendQueued_ = false;
  }

  ready() {
    return !!(this.audioBuffer || this.videoBuffer);
  }

  createSourceBuffers(codecs) {
    if (this.ready()) {
      // already created them before
      return;
    }

    if (this.mediaSource.readyState === 'closed') {
      this.sourceopenListener_ = this.createSourceBuffers.bind(this, codecs);
      this.mediaSource.addEventListener('sourceopen', this.sourceopenListener_);
      return;
    }

    if (codecs.audio) {
      const mime = getMimeForCodec(codecs.audio);

      this.audioBuffer = this.mediaSource.addSourceBuffer(mime);
      this.audioBuffer.removing = false;
      this.logger_(`created SourceBuffer ${mime}`);
    }

    if (codecs.video) {
      const mime = getMimeForCodec(codecs.video);

      this.videoBuffer = this.mediaSource.addSourceBuffer(mime);
      this.videoBuffer.removing = false;
      this.logger_(`created SourceBuffer ${mime}`);
    }

    this.trigger('ready');
    this.start_();
  }

  start_() {
    this.started_ = true;

    if (this.audioBuffer) {
      this.onAudioUpdateEnd_ = onUpdateend('audio', this);
      this.audioBuffer.addEventListener('updateend', this.onAudioUpdateEnd_);
      this.onAudioError_ = (e) => {
        // used for debugging
        this.audioError_ = e;
      };
      this.audioBuffer.addEventListener('error', this.onAudioError_);
      shiftQueue('audio', this);
    }
    if (this.videoBuffer) {
      this.onVideoUpdateEnd_ = onUpdateend('video', this);
      this.videoBuffer.addEventListener('updateend', this.onVideoUpdateEnd_);
      this.onVideoError_ = (e) => {
        // used for debugging
        this.videoError_ = e;
      };
      this.videoBuffer.addEventListener('error', this.onVideoError_);
      shiftQueue('video', this);
    }
  }

  /**
   * Queue an update to append an ArrayBuffer.
   *
   * @param {MediaObject} object containing audioBytes and/or videoBytes
   * @param {Function} done the function to call when done
   * @see http://www.w3.org/TR/media-source/#widl-SourceBuffer-appendBuffer-void-ArrayBuffer-data
   */
  appendBuffer(options, doneFn) {
    const {segmentInfo, type, bytes} = options;

    this.processedAppend_ = true;
    if (type === 'audio' && this.videoBuffer && !this.videoAppendQueued_) {
      this.delayedAudioAppendQueue_.push([options, doneFn]);
      this.logger_(`delayed audio append of ${bytes.length} until video append`);
      return;
    }

    pushQueue({
      type,
      sourceUpdater: this,
      action: actions.appendBuffer(bytes, segmentInfo || {mediaIndex: -1}),
      doneFn,
      name: 'appendBuffer'
    });

    if (type === 'video') {
      this.videoAppendQueued_ = true;
      if (!this.delayedAudioAppendQueue_.length) {
        return;
      }
      const queue = this.delayedAudioAppendQueue_.slice();

      this.logger_(`queuing delayed audio ${queue.length} appendBuffers`);

      this.delayedAudioAppendQueue_.length = 0;
      queue.forEach((que) => {
        this.appendBuffer.apply(this, que);
      });
    }
  }

  audioBuffered() {
    return this.audioBuffer && this.audioBuffer.buffered ? this.audioBuffer.buffered :
      videojs.createTimeRange();
  }

  videoBuffered() {
    return this.videoBuffer && this.videoBuffer.buffered ? this.videoBuffer.buffered :
      videojs.createTimeRange();
  }

  buffered() {
    return buffered(this.videoBuffer, this.audioBuffer);
  }

  setDuration(duration, doneFn = noop) {
    // In order to set the duration on the media source, it's necessary to wait for all
    // source buffers to no longer be updating. "If the updating attribute equals true on
    // any SourceBuffer in sourceBuffers, then throw an InvalidStateError exception and
    // abort these steps." (source: https://www.w3.org/TR/media-source/#attributes).
    pushQueue({
      type: 'mediaSource',
      sourceUpdater: this,
      action: actions.duration(duration),
      name: 'duration',
      doneFn
    });
  }

  endOfStream(error = null, doneFn = noop) {
    if (typeof error !== 'string') {
      error = undefined;
    }
    // In order to set the duration on the media source, it's necessary to wait for all
    // source buffers to no longer be updating. "If the updating attribute equals true on
    // any SourceBuffer in sourceBuffers, then throw an InvalidStateError exception and
    // abort these steps." (source: https://www.w3.org/TR/media-source/#attributes).
    pushQueue({
      type: 'mediaSource',
      sourceUpdater: this,
      action: actions.endOfStream(error),
      name: 'endOfStream',
      doneFn
    });
  }

  /**
   * Queue an update to remove a time range from the buffer.
   *
   * @param {number} start where to start the removal
   * @param {number} end where to end the removal
   * @param {Function} [done=noop] optional callback to be executed when the remove
   * operation is complete
   * @see http://www.w3.org/TR/media-source/#widl-SourceBuffer-remove-void-double-start-unrestricted-double-end
   */
  removeAudio(start, end, done = noop) {
    if (!this.audioBuffered().length || this.audioBuffered().end(0) === 0) {
      done();
      return;
    }

    pushQueue({
      type: 'audio',
      sourceUpdater: this,
      action: actions.remove(start, end),
      doneFn: done,
      name: 'remove'
    });
  }

  /**
   * Queue an update to remove a time range from the buffer.
   *
   * @param {number} start where to start the removal
   * @param {number} end where to end the removal
   * @param {Function} [done=noop] optional callback to be executed when the remove
   * operation is complete
   * @see http://www.w3.org/TR/media-source/#widl-SourceBuffer-remove-void-double-start-unrestricted-double-end
   */
  removeVideo(start, end, done = noop) {
    if (!this.videoBuffered().length || this.videoBuffered().end(0) === 0) {
      done();
      return;
    }

    pushQueue({
      type: 'video',
      sourceUpdater: this,
      action: actions.remove(start, end),
      doneFn: done,
      name: 'remove'
    });
  }

  /**
   * Whether the underlying sourceBuffer is updating or not
   *
   * @return {boolean} the updating status of the SourceBuffer
   */
  updating() {
    // the audio/video source buffer is updating
    if (updating('audio', this) || updating('video', this)) {
      return true;
    }

    return false;
  }

  /**
   * Set/get the timestampoffset on the audio SourceBuffer
   *
   * @return {number} the timestamp offset
   */
  audioTimestampOffset(offset) {
    if (typeof offset !== 'undefined' &&
        this.audioBuffer &&
        // no point in updating if it's the same
        this.audioTimestampOffset_ !== offset) {
      pushQueue({
        type: 'audio',
        sourceUpdater: this,
        action: actions.timestampOffset(offset),
        name: 'timestampOffset'
      });
      this.audioTimestampOffset_ = offset;
    }
    return this.audioTimestampOffset_;
  }

  /**
   * Set/get the timestampoffset on the video SourceBuffer
   *
   * @return {number} the timestamp offset
   */
  videoTimestampOffset(offset) {
    if (typeof offset !== 'undefined' &&
        this.videoBuffer &&
        // no point in updating if it's the same
        this.videoTimestampOffset !== offset) {
      pushQueue({
        type: 'video',
        sourceUpdater: this,
        action: actions.timestampOffset(offset),
        name: 'timestampOffset'
      });
      this.videoTimestampOffset_ = offset;
    }
    return this.videoTimestampOffset_;
  }

  audioQueueCallback(callback) {
    if (this.audioBuffer) {
      pushQueue({
        type: 'audio',
        sourceUpdater: this,
        action: actions.callback(callback),
        name: 'callback'
      });
    }
  }

  videoQueueCallback(callback) {
    if (this.videoBuffer) {
      pushQueue({
        type: 'video',
        sourceUpdater: this,
        action: actions.callback(callback),
        name: 'callback'
      });
    }
  }

  /**
   * dispose of the source updater and the underlying sourceBuffer
   */
  dispose() {
    this.trigger('dispose');
    const audioDisposeFn = () => {
      if (this.mediaSource.readyState === 'open') {
        // ie 11 likes to throw on abort with InvalidAccessError or InvalidStateError
        // dom exceptions
        try {
          this.audioBuffer.abort();
        } catch (e) {
          videojs.log.warn('Failed to call abort on audio buffer', e);
        }
      }
      this.audioBuffer.removeEventListener('updateend', this.onAudioUpdateEnd_);
      this.audioBuffer.removeEventListener('updateend', audioDisposeFn);
      this.audioBuffer.removeEventListener('error', this.onAudioError_);
      this.audioBuffer = null;
    };
    const videoDisposeFn = () => {
      if (this.mediaSource.readyState === 'open') {
        // ie 11 likes to throw on abort with InvalidAccessError or InvalidStateError
        // dom exceptions
        try {
          this.videoBuffer.abort();
        } catch (e) {
          videojs.log.warn('Failed to call abort on video buffer', e);
        }
      }
      this.videoBuffer.removeEventListener('updateend', this.onVideoUpdateEnd_);
      this.videoBuffer.removeEventListener('error', this.onVideoError_);
      this.videoBuffer.removeEventListener('updateend', videoDisposeFn);
      this.videoBuffer = null;
    };

    // TODO: can we just use "updating" rather than removing?
    //       this was implemented in https://github.com/videojs/http-streaming/pull/442
    if (this.audioBuffer) {
      if (this.audioBuffer.removing) {
        this.audioBuffer.addEventListener('updateend', audioDisposeFn);
      } else {
        audioDisposeFn();
      }
    }

    if (this.videoBuffer) {
      if (this.videoBuffer.removing) {
        this.videoBuffer.addEventListener('updateend', videoDisposeFn);
      } else {
        videoDisposeFn();
      }
    }

    this.videoAppendQueued_ = false;
    this.delayedAudioAppendQueue_.length = 0;

    this.mediaSource.removeEventListener('sourceopen', this.sourceopenListener_);

    this.off();
  }
}
