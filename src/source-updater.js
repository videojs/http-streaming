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
 * @param {MediaSource} mediaSource the MediaSource to create the
 * SourceBuffer from
 * @param {String} mimeType the desired MIME type of the underlying
 * SourceBuffer
 * @param {Object} sourceBufferEmitter an event emitter that fires when a source buffer is
 * added to the media source
 */
export default class SourceUpdater {
  constructor(mediaSource, mimeType, type, sourceBufferEmitter) {
    this.callbacks_ = [];
    this.pendingCallback_ = null;
    this.timestampOffset_ = 0;
    this.mediaSource = mediaSource;
    this.processedAppend_ = false;
    this.type_ = type;
    this.mimeType_ = mimeType;
    this.logger_ = logger(`SourceUpdater[${type}][${mimeType}]`);

    if (mediaSource.readyState === 'closed') {
      mediaSource.addEventListener(
        'sourceopen', this.createSourceBuffers_.bind(this, mimeType, sourceBufferEmitter));
    } else {
      this.createSourceBuffers_(mimeType, sourceBufferEmitter);
    }
  }

  createSourceBuffers_(mimeType, sourceBufferEmitter) {
    const codecs = parseMimeTypes(mimeType) || ['avc1.4d400d', 'mp4a.40.2'];

    if (codecs.audio) {
      this.audioBuffer = this.mediaSource.addSourceBuffer(
        `audio/mp4;codecs="${codecs.audio}"`);
    }
    if (codecs.video) {
      this.videoBuffer = this.mediaSource.addSourceBuffer(
        `video/mp4;codecs="${codecs.video}"`);
    }

    this.logger_('created SourceBuffer');

    if (sourceBufferEmitter) {
      sourceBufferEmitter.trigger('sourcebufferadded');

      if (this.mediaSource.sourceBuffers.length < 2) {
        // There's another source buffer we must wait for before we can start updating
        // our own (or else we can get into a bad state, i.e., appending video/audio data
        // before the other video/audio source buffer is available and leading to a video
        // or audio only buffer).
        sourceBufferEmitter.on('sourcebufferadded', () => {
          this.start_();
        });
        return;
      }
    }

    this.start_();
  }

  start_() {
    this.started_ = true;

    // run completion handlers and process callbacks as updateend
    // events fire
    this.onUpdateendCallback_ = () => {
      let pendingCallback = this.pendingCallback_;

      this.pendingCallback_ = null;

      this.logger_(`buffered [${printableRange(this.buffered())}]`);

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
   * Aborts the current segment and resets the segment parser.
   *
   * @param {Function} done function to call when done
   * @see http://w3c.github.io/media-source/#widl-SourceBuffer-abort-void
   */
  abort(done) {
    if (this.processedAppend_) {
      this.queueCallback_(() => {
        if (this.audioBuffer) {
          this.audioBuffer.abort();
        }
        if (this.videoBuffer) {
          this.videoBuffer.abort();
        }
      }, done);
    }
  }

  /**
   * Queue an update to append an ArrayBuffer.
   *
   * @param {ArrayBuffer} bytes (TODO)
   * @param {Function} done the function to call when done
   * @see http://www.w3.org/TR/media-source/#widl-SourceBuffer-appendBuffer-void-ArrayBuffer-data
   */
  appendBuffer(mediaObject, done) {
    // TODO eventually we should probably have two source updaters, one for audio and one for video
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
  remove(start, end) {
    if (this.processedAppend_) {
      this.queueCallback_(() => {
        this.logger_(`remove [${start} => ${end}]`);

        if (this.audioBuffer) {
          this.audioBuffer.remove(start, end);
        }
        if (this.videoBuffer) {
          this.videoBuffer.remove(start, end);
        }
      }, noop);
    }
  }

  /**
   * Whether the underlying sourceBuffer is updating or not
   *
   * @return {Boolean} the updating status of the SourceBuffer
   */
  updating() {
    return
      (!this.audioBuffer ||
       this.audioBuffer.updating ||
       this.pendingCallback_) ||
      (!this.videoBuffer ||
       this.videoBuffer.updating ||
       this.pendingCallback_);
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
