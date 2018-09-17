/**
 * @file source-updater.js
 */
import videojs from 'video.js';
import logger from './util/logger';
import noop from './util/noop';
import { buffered } from './util/buffer';

const actions = {
  appendBuffer: (bytes) => (type, updater) => {
    const {
      [`${type}Buffer`]: sourceBuffer
    } = updater;

    sourceBuffer.appendBuffer(bytes);
  },
  remove: (start, end) => (type, updater) => {
    const {
      [`${type}Buffer`]: sourceBuffer
    } = updater;

    sourceBuffer.remove(start, end);
  },
  timestampOffset: (offset) => (type, updater) => {
    const {
      [`${type}Buffer`]: sourceBuffer
    } = updater;

    sourceBuffer.timestampOffset = offset;
  },
  callback: (callback) => (type, updater) => {
    callback();
  }
};

const updating = (type, updater) => {
  const {
    [`${type}Buffer`]: sourceBuffer,
    queue: {
      [type]: {
        pending
      }
    }
  } = updater;

  return (sourceBuffer && sourceBuffer.updating) || pending;
};

const shiftQueue = (type, updater) => {
  const {
    queue: {
      [type]: queue
    },
    started_
  } = updater;

  if (updating(type, updater) || !queue.actions.length || !started_) {
    return;
  }

  const action = queue.actions.shift();

  queue.pending = action[1];
  action[0](type, updater);
};

const pushQueue = (type, updater, action) => {
  const {
    queue: { [type]: queue }
  } = updater;

  queue.actions.push(action);
  shiftQueue(type, updater);
};

const onUpdateend = (type, updater) => () => {
  const {
    queue: { [type]: queue }
  } = updater;

  if (!queue.pending) {
    shiftQueue(type, updater);
  }

  if (!queue.pending) {
    // nothing in the queue
    return;
  }

  const doneFn = queue.pending.doneFn;

  queue.pending = null;

  if (doneFn) {
    // if there's an error, report it
    doneFn(updater[`${type}Error_`]);
  }

  shiftQueue(type, updater);
};

/**
 * A queue of callbacks to be serialized and applied when a
 * MediaSource and its associated SourceBuffers are not in the
 * updating state. It is used by the segment loader to update the
 * underlying SourceBuffers when new data is loaded, for instance.
 *
 * @class SourceUpdater
 * @param {MediaSource} mediaSource the MediaSource to create the SourceBuffer from
 * @param {String} mimeType the desired MIME type of the underlying SourceBuffer
 */
export default class SourceUpdater extends videojs.EventTarget {
  constructor(mediaSource) {
    super();
    this.mediaSource = mediaSource;
    this.logger_ = logger('SourceUpdater');
    // initial timestamp offset is 0
    this.audioTimestampOffset_ = 0;
    this.videoTimestampOffset_ = 0;
    this.queue = {
      audio: {
        actions: [],
        doneFn: null
      },
      video: {
        actions: [],
        doneFn: null
      }
    };
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
      this.mediaSource.addEventListener(
        'sourceopen', this.createSourceBuffers.bind(this, codecs));
      return;
    }

    if (codecs.audio) {
      this.audioBuffer = this.mediaSource.addSourceBuffer(
        `audio/mp4;codecs="${codecs.audio}"`);
      this.logger_(`created SourceBuffer audio/mp4;codecs="${codecs.audio}`);
    }

    if (codecs.video) {
      this.videoBuffer = this.mediaSource.addSourceBuffer(
        `video/mp4;codecs="${codecs.video}"`);
      this.logger_(`created SourceBuffer video/mp4;codecs="${codecs.video}"`);
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
        this.audioError_ = e;
      };
      this.audioBuffer.addEventListener('error', this.onAudioError_);
      shiftQueue('audio', this);
    }
    if (this.videoBuffer) {
      this.onVideoUpdateEnd_ = onUpdateend('video', this);
      this.videoBuffer.addEventListener('updateend', this.onVideoUpdateEnd_);
      this.onVideoError_ = (e) => {
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
  appendBuffer(type, bytes, doneFn) {
    this.processedAppend_ = true;
    pushQueue(type, this, [
      actions.appendBuffer(bytes),
      { doneFn, name: 'appendBuffer' }
    ]);
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

  /**
   * Queue an update to remove a time range from the buffer.
   *
   * @param {Number} start where to start the removal
   * @param {Number} end where to end the removal
   * @param {Function} [done=noop] optional callback to be executed when the remove
   * operation is complete
   * @see http://www.w3.org/TR/media-source/#widl-SourceBuffer-remove-void-double-start-unrestricted-double-end
   */
  removeAudio(start, end, done = noop) {
    if (!this.audioBuffered().length || this.audioBuffered().end(0) === 0) {
      done();
      return;
    }

    pushQueue('audio', this, [
      actions.remove(start, end),
      { doneFn: done, name: 'remove' }
    ]);
  }

  /**
   * Queue an update to remove a time range from the buffer.
   *
   * @param {Number} start where to start the removal
   * @param {Number} end where to end the removal
   * @param {Function} [done=noop] optional callback to be executed when the remove
   * operation is complete
   * @see http://www.w3.org/TR/media-source/#widl-SourceBuffer-remove-void-double-start-unrestricted-double-end
   */
  removeVideo(start, end, done = noop) {
    if (!this.videoBuffered().length || this.videoBuffered().end(0) === 0) {
      done();
      return;
    }

    pushQueue('video', this, [
      actions.remove(start, end),
      { doneFn: done, name: 'remove' }
    ]);
  }

  /**
   * Whether the underlying sourceBuffer is updating or not
   *
   * @return {Boolean} the updating status of the SourceBuffer
   */
  updating() {
    if (this.audioBuffer && this.audioBuffer.updating) {
      return true;
    }
    if (this.videoBuffer && this.videoBuffer.updating) {
      return true;
    }
    if (this.pendingCallback_) {
      return true;
    }
    return false;
  }

  /**
   * Set/get the timestampoffset on the audio SourceBuffer
   *
   * @return {Number} the timestamp offset
   */
  audioTimestampOffset(offset) {
    if (typeof offset !== 'undefined' &&
        this.audioBuffer &&
        // no point in updating if it's the same
        this.audioBuffer.timestampOffset !== offset) {
      pushQueue('audio', this, [
        actions.timestampOffset(offset),
        null
      ]);
      this.audioTimestampOffset_ = offset;
    }
    return this.audioTimestampOffset_;
  }

  /**
   * Set/get the timestampoffset on the video SourceBuffer
   *
   * @return {Number} the timestamp offset
   */
  videoTimestampOffset(offset) {
    if (typeof offset !== 'undefined' &&
        this.videoBuffer &&
        // no point in updating if it's the same
        this.videoBuffer.timestampOffset !== offset) {
      pushQueue('video', this, [
        actions.timestampOffset(offset),
        null
      ]);
      this.videoTimestampOffset_ = offset;
    }
    return this.videoTimestampOffset_;
  }

  audioQueueCallback(callback) {
    if (this.audioBuffer) {
      pushQueue('audio', this, [
        actions.callback(callback),
        null
      ]);
    }
  }

  videoQueueCallback(callback) {
    if (this.videoBuffer) {
      pushQueue('video', this, [
        actions.callback(callback),
        null
      ]);
    }
  }

  /**
   * dispose of the source updater and the underlying sourceBuffer
   */
  dispose() {
    // Abort then remove each source buffer. Removing is important for idempotency.
    if (this.audioBuffer) {
      if (this.mediaSource.readyState === 'open') {
        this.audioBuffer.abort();
      }
      this.audioBuffer.removeEventListener('updateend', this.onAudioUpdateEnd_);
      this.audioBuffer.removeEventListener('error', this.onAudioError_);
      this.audioBuffer = null;
    }
    if (this.videoBuffer) {
      if (this.mediaSource.readyState === 'open') {
        this.videoBuffer.abort();
      }
      this.videoBuffer.removeEventListener('updateend', this.onVideoUpdateEnd_);
      this.videoBuffer.removeEventListener('error', this.onVideoError_);
      this.videoBuffer = null;
    }
  }
}
