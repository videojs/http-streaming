/**
 * @file source-updater.js
 */
import videojs from 'video.js';
import { printableRange } from './ranges';
import logger from './util/logger';
import noop from './util/noop';
import { parseMimeTypes } from './util/codecs';

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
export default class SourceUpdater {
  constructor(mediaSource) {
    this.callbacks_ = [];
    this.pendingCallback_ = null;
    this.timestampOffset_ = 0;
    this.mediaSource = mediaSource;
    this.logger_ = logger(`SourceUpdater`);
  }

  ready() {
    return this.audioBuffer || this.videoBuffer;
  }

  createSourceBuffers(codecs) {
    if (this.ready()) {
      // already created them before
      return;
    }

    if (this.mediaSource.readyState === 'closed') {
      this.mediaSource.addEventListener(
        'sourceopen', this.createSourceBuffers.bind(this, mimeType));
      return;
    }

    if (codecs.audio) {
      // default
      let audioCodec = 'mp4a.40.2';

      if (codecs.audio.mimeType) {
        let parsed = parseMimeTypes(codecs.audio.mimeType);

        if (parsed && parsed.audio) {
          audioCodec = parsed.audio;
        }
      }

      this.audioBuffer = this.mediaSource.addSourceBuffer(
        `audio/mp4;codecs="${audioCodec}"`);
    }

    if (codecs.video) {
      // default
      let videoCodec = 'avc1.4d400d';

      if (codecs.video.mimeType) {
        let parsed = parseMimeTypes(codecs.video.mimeType);

        if (parsed && parsed.video) {
          videoCodec = parsed.video;
        }
      }

      this.videoBuffer = this.mediaSource.addSourceBuffer(
        `video/mp4;codecs="${videoCodec}"`);
    }

    this.logger_('created SourceBuffer');
    this.start_();
  }

  start_() {
    this.started_ = true;

    // run completion handlers and process callbacks as updateend
    // events fire
    this.onUpdateendCallback_ = () => {
      let pendingCallback = this.pendingCallback_;

      this.pendingCallback_ = null;

      if (this.audioBuffer && this.videoBuffer) {
        this.logger_(`buffered intersection [${printableRange(this.buffered())}]`);
      }
      if (this.audioBuffer) {
        this.logger_(`buffered audio [${printableRange(this.audioBuffer.buffered)}]`);
      }
      if (this.videoBuffer) {
        this.logger_(`buffered video [${printableRange(this.videoBuffer.buffered)}]`);
      }

      if (pendingCallback) {
        pendingCallback();
      }

      this.runCallback_();
    };

    if (this.audioBuffer) {
      this.audioBuffer.addEventListener('updateend', this.onUpdateendCallback_);
    }
    if (this.videoBuffer) {
      this.videoBuffer.addEventListener('updateend', this.onUpdateendCallback_);
    }

    this.runCallback_();
  }

  /**
   * Queue an update to append an ArrayBuffer.
   *
   * @param {MediaObject} object containing audioBytes and/or videoBytes
   * @param {Function} done the function to call when done
   * @see http://www.w3.org/TR/media-source/#widl-SourceBuffer-appendBuffer-void-ArrayBuffer-data
   */
  appendBuffer(mediaObject, done) {
    this.processedAppend_ = true;
    if (mediaObject.audioBytes && mediaObject.videoBytes) {
      this.queueCallback_(() => {
        this.audioBuffer.appendBuffer(mediaObject.audioBytes);
      }, () => {
        this.queueCallback_(() => {
          this.videoBuffer.appendBuffer(mediaObject.videoBytes);
        }, done);
      });
      return;
    }
    this.queueCallback_(() => {
      if (mediaObject.audioBytes) {
        this.audioBuffer.appendBuffer(mediaObject.audioBytes);
      }
      if (mediaObject.videoBytes) {
        this.videoBuffer.appendBuffer(mediaObject.videoBytes);
      }
    }, done);
  }

  audioBuffered() {
    return this.audioBuffer && this.audioBuffer.buffered;
  }

  videoBuffered() {
    return this.videoBuffer && this.videoBuffer.buffered;
  }

  /**
   * Indicates what TimeRanges are buffered in the managed SourceBuffer.
   *
   * @see http://www.w3.org/TR/media-source/#widl-SourceBuffer-buffered
   */
  buffered() {
    let start = null;
    let end = null;
    let arity = 0;
    let extents = [];
    let ranges = [];

    // neither buffer has been created yet
    if (!this.videoBuffer && !this.audioBuffer) {
      return videojs.createTimeRange();
    }

    // only one buffer is configured
    if (!this.videoBuffer) {
      return this.audioBuffer.buffered;
    }
    if (!this.audioBuffer) {
      return this.videoBuffer.buffered;
    }

    // both buffers are configured
    if (this.audioDisabled_) {
      return this.videoBuffer.buffered;
    }

    // both buffers are empty
    if (this.videoBuffer.buffered.length === 0 &&
        this.audioBuffer.buffered.length === 0) {
      return videojs.createTimeRange();
    }

    // Handle the case where we have both buffers and create an
    // intersection of the two
    let videoBuffered = this.videoBuffer.buffered;
    let audioBuffered = this.audioBuffer.buffered;
    let count = videoBuffered.length;

    // A) Gather up all start and end times
    while (count--) {
      extents.push({time: videoBuffered.start(count), type: 'start'});
      extents.push({time: videoBuffered.end(count), type: 'end'});
    }
    count = audioBuffered.length;
    while (count--) {
      extents.push({time: audioBuffered.start(count), type: 'start'});
      extents.push({time: audioBuffered.end(count), type: 'end'});
    }
    // B) Sort them by time
    extents.sort(function(a, b) {
      return a.time - b.time;
    });

    // C) Go along one by one incrementing arity for start and decrementing
    //    arity for ends
    for (count = 0; count < extents.length; count++) {
      if (extents[count].type === 'start') {
        arity++;

        // D) If arity is ever incremented to 2 we are entering an
        //    overlapping range
        if (arity === 2) {
          start = extents[count].time;
        }
      } else if (extents[count].type === 'end') {
        arity--;

        // E) If arity is ever decremented to 1 we leaving an
        //    overlapping range
        if (arity === 1) {
          end = extents[count].time;
        }
      }

      // F) Record overlapping ranges
      if (start !== null && end !== null) {
        ranges.push([start, end]);
        start = null;
        end = null;
      }
    }

    return videojs.createTimeRanges(ranges);
  }

  /**
   * Queue an update to remove a time range from the buffer.
   *
   * @param {Number} start where to start the removal
   * @param {Number} end where to end the removal
   * @see http://www.w3.org/TR/media-source/#widl-SourceBuffer-remove-void-double-start-unrestricted-double-end
   */
  removeAudio(start, end) {
    if (!this.audioBuffer) {
      return;
    }

    this.queueCallback_(() => {
      this.audioBuffer.remove(start, end);
    }, noop);
  }

  /**
   * Queue an update to remove a time range from the buffer.
   *
   * @param {Number} start where to start the removal
   * @param {Number} end where to end the removal
   * @see http://www.w3.org/TR/media-source/#widl-SourceBuffer-remove-void-double-start-unrestricted-double-end
   */
  removeVideo(start, end) {
    if (!this.videoBuffer) {
      return;
    }

    this.queueCallback_(() => {
      this.videoBuffer.remove(start, end);
    }, noop);
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
    return false
  }

  /**
   * Set/get the timestampoffset on the SourceBuffer
   *
   * @return {Number} the timestamp offset
   */
  timestampOffset(offset) {
    if (typeof offset !== 'undefined') {
      this.queueCallback_(() => {
        if (this.audioBuffer) {
          this.audioBuffer.timestampOffset = offset;
        }
        if (this.videoBuffer) {
          this.videoBuffer.timestampOffset = offset;
        }
      });
      this.timestampOffset_ = offset;
    }
    return this.timestampOffset_;
  }

  /**
   * Queue a callback to run
   */
  queueCallback_(callback, done) {
    this.callbacks_.push([callback.bind(this), done]);
    this.runCallback_();
  }

  /**
   * Run a queued callback
   */
  runCallback_() {
    let callbacks;

    if (!this.updating() &&
        this.callbacks_.length &&
        this.started_) {
      callbacks = this.callbacks_.shift();
      this.pendingCallback_ = callbacks[1];
      callbacks[0]();
    }
  }

  /**
   * dispose of the source updater and the underlying sourceBuffer
   */
  dispose() {
    if (this.audioBuffer) {
      if (this.mediaSource.readyState === 'open') {
        this.audioBuffer.abort();
      }
      this.audioBuffer.removeEventListener('updateend', this.onUpdateendCallback_);
    }
    if (this.videoBuffer) {
      if (this.mediaSource.readyState === 'open') {
        this.videoBuffer.abort();
      }
      this.videoBuffer.removeEventListener('updateend', this.onUpdateendCallback_);
    }
  }
}
