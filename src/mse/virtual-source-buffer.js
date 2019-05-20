/**
 * @file virtual-source-buffer.js
 */
import videojs from 'video.js';
import { createTextTracksIfNecessary } from '../util/text-tracks.js';
import { removeCuesFromTrack } from '../util/text-tracks.js';
import { addTextTrackData } from '../util/text-tracks.js';
import TransmuxWorker from 'worker!../transmuxer-worker.worker.js';
import { isAudioCodec, isVideoCodec } from '../util/codecs';
import {
  gopsSafeToAlignWith,
  updateGopBuffer,
  removeGopBuffer
} from '../util/gops';
import { buffered } from '../util/buffer';

const ONE_SECOND_IN_TS = 90000;

// We create a wrapper around the SourceBuffer so that we can manage the
// state of the `updating` property manually. We have to do this because
// Firefox changes `updating` to false long before triggering `updateend`
// events and that was causing strange problems in videojs-contrib-hls
const makeWrappedSourceBuffer = function(mediaSource, mimeType) {
  const sourceBuffer = mediaSource.addSourceBuffer(mimeType);
  const wrapper = Object.create(null);

  wrapper.updating = false;
  wrapper.realBuffer_ = sourceBuffer;

  for (let key in sourceBuffer) {
    if (typeof sourceBuffer[key] === 'function') {
      wrapper[key] = (...params) => sourceBuffer[key](...params);
    } else if (typeof wrapper[key] === 'undefined') {
      Object.defineProperty(wrapper, key, {
        get: () => sourceBuffer[key],
        set: (v) => sourceBuffer[key] = v
      });
    }
  }

  return wrapper;
};

/**
 * VirtualSourceBuffers exist so that we can transmux non native formats
 * into a native format, but keep the same api as a native source buffer.
 * It creates a transmuxer, that works in its own thread (a web worker) and
 * that transmuxer muxes the data into a native format. VirtualSourceBuffer will
 * then send all of that data to the naive sourcebuffer so that it is
 * indestinguishable from a natively supported format.
 *
 * @param {HtmlMediaSource} mediaSource the parent mediaSource
 * @param {Array} codecs array of codecs that we will be dealing with
 * @class VirtualSourceBuffer
 * @extends video.js.EventTarget
 */
export default class VirtualSourceBuffer extends videojs.EventTarget {
  constructor(mediaSource, codecs) {
    super(videojs.EventTarget);
    this.timestampOffset_ = 0;
    this.pendingBuffers_ = [];
    this.bufferUpdating_ = false;

    this.mediaSource_ = mediaSource;
    this.codecs_ = codecs;
    this.audioCodec_ = null;
    this.videoCodec_ = null;
    this.audioDisabled_ = false;
    this.appendAudioInitSegment_ = true;
    this.gopBuffer_ = [];
    this.timeMapping_ = 0;
    this.safeAppend_ = videojs.browser.IE_VERSION >= 11;

    let options = {
      remux: false,
      alignGopsAtEnd: this.safeAppend_
    };

    this.codecs_.forEach((codec) => {
      if (isAudioCodec(codec)) {
        this.audioCodec_ = codec;
      } else if (isVideoCodec(codec)) {
        this.videoCodec_ = codec;
      }
    });

    // append muxed segments to their respective native buffers as
    // soon as they are available
    this.transmuxer_ = new TransmuxWorker();
    this.transmuxer_.postMessage({action: 'init', options });

    this.transmuxer_.onmessage = (event) => {
      if (event.data.action === 'data') {
        return this.data_(event);
      }

      if (event.data.action === 'done') {
        return this.done_(event);
      }

      if (event.data.action === 'gopInfo') {
        return this.appendGopInfo_(event);
      }

      if (event.data.action === 'videoSegmentTimingInfo') {
        return this.videoSegmentTimingInfo_(event.data.videoSegmentTimingInfo);
      }
    };

    // this timestampOffset is a property with the side-effect of resetting
    // baseMediaDecodeTime in the transmuxer on the setter
    Object.defineProperty(this, 'timestampOffset', {
      get() {
        return this.timestampOffset_;
      },
      set(val) {
        if (typeof val === 'number' && val >= 0) {
          this.timestampOffset_ = val;
          this.appendAudioInitSegment_ = true;

          // reset gop buffer on timestampoffset as this signals a change in timeline
          this.gopBuffer_.length = 0;
          this.timeMapping_ = 0;

          // We have to tell the transmuxer to set the baseMediaDecodeTime to
          // the desired timestampOffset for the next segment
          this.transmuxer_.postMessage({
            action: 'setTimestampOffset',
            timestampOffset: val
          });
        }
      }
    });

    // setting the append window affects both source buffers
    Object.defineProperty(this, 'appendWindowStart', {
      get() {
        return (this.videoBuffer_ || this.audioBuffer_).appendWindowStart;
      },
      set(start) {
        if (this.videoBuffer_) {
          this.videoBuffer_.appendWindowStart = start;
        }
        if (this.audioBuffer_) {
          this.audioBuffer_.appendWindowStart = start;
        }
      }
    });

    // this buffer is "updating" if either of its native buffers are
    Object.defineProperty(this, 'updating', {
      get() {
        return !!(this.bufferUpdating_ ||
          (!this.audioDisabled_ && this.audioBuffer_ && this.audioBuffer_.updating) ||
          (this.videoBuffer_ && this.videoBuffer_.updating));
      }
    });

    // the buffered property is the intersection of the buffered
    // ranges of the native source buffers
    Object.defineProperty(this, 'buffered', {
      get() {
        return buffered(this.videoBuffer_, this.audioBuffer_, this.audioDisabled_);
      }
    });
  }

  /**
   * When we get a data event from the transmuxer
   * we call this function and handle the data that
   * was sent to us
   *
   * @private
   * @param {Event} event the data event from the transmuxer
   */
  data_(event) {
    let segment = event.data.segment;

    // Cast ArrayBuffer to TypedArray
    segment.data = new Uint8Array(
      segment.data,
      event.data.byteOffset,
      event.data.byteLength
    );

    segment.initSegment = new Uint8Array(
      segment.initSegment.data,
      segment.initSegment.byteOffset,
      segment.initSegment.byteLength
    );

    createTextTracksIfNecessary(this, this.mediaSource_, segment);

    // Add the segments to the pendingBuffers array
    this.pendingBuffers_.push(segment);
    return;
  }

  /**
   * When we get a done event from the transmuxer
   * we call this function and we process all
   * of the pending data that we have been saving in the
   * data_ function
   *
   * @private
   * @param {Event} event the done event from the transmuxer
   */
  done_(event) {
    // Don't process and append data if the mediaSource is closed
    if (this.mediaSource_.readyState === 'closed') {
      this.pendingBuffers_.length = 0;
      return;
    }

    // All buffers should have been flushed from the muxer
    // start processing anything we have received
    this.processPendingSegments_();
    return;
  }

  videoSegmentTimingInfo_(timingInfo) {
    const timingInfoInSeconds = {
      start: {
        decode: timingInfo.start.dts / ONE_SECOND_IN_TS,
        presentation: timingInfo.start.pts / ONE_SECOND_IN_TS
      },
      end: {
        decode: timingInfo.end.dts / ONE_SECOND_IN_TS,
        presentation: timingInfo.end.pts / ONE_SECOND_IN_TS
      },
      baseMediaDecodeTime: timingInfo.baseMediaDecodeTime / ONE_SECOND_IN_TS
    };

    if (timingInfo.prependedContentDuration) {
      timingInfoInSeconds.prependedContentDuration =
          timingInfo.prependedContentDuration / ONE_SECOND_IN_TS;
    }

    this.trigger({
      type: 'videoSegmentTimingInfo',
      videoSegmentTimingInfo: timingInfoInSeconds
    });
  }

  /**
   * Create our internal native audio/video source buffers and add
   * event handlers to them with the following conditions:
   * 1. they do not already exist on the mediaSource
   * 2. this VSB has a codec for them
   *
   * @private
   */
  createRealSourceBuffers_() {
    let types = ['audio', 'video'];

    types.forEach((type) => {
      // Don't create a SourceBuffer of this type if we don't have a
      // codec for it
      if (!this[`${type}Codec_`]) {
        return;
      }

      // Do nothing if a SourceBuffer of this type already exists
      if (this[`${type}Buffer_`]) {
        return;
      }

      let buffer = null;

      // If the mediasource already has a SourceBuffer for the codec
      // use that
      if (this.mediaSource_[`${type}Buffer_`]) {
        buffer = this.mediaSource_[`${type}Buffer_`];
        // In multiple audio track cases, the audio source buffer is disabled
        // on the main VirtualSourceBuffer by the HTMLMediaSource much earlier
        // than createRealSourceBuffers_ is called to create the second
        // VirtualSourceBuffer because that happens as a side-effect of
        // videojs-contrib-hls starting the audioSegmentLoader. As a result,
        // the audioBuffer is essentially "ownerless" and no one will toggle
        // the `updating` state back to false once the `updateend` event is received
        //
        // Setting `updating` to false manually will work around this
        // situation and allow work to continue
        buffer.updating = false;
      } else {
        const codecProperty = `${type}Codec_`;
        const mimeType = `${type}/mp4;codecs="${this[codecProperty]}"`;

        buffer = makeWrappedSourceBuffer(this.mediaSource_.nativeMediaSource_, mimeType);

        this.mediaSource_[`${type}Buffer_`] = buffer;
      }

      this[`${type}Buffer_`] = buffer;

      // Wire up the events to the SourceBuffer
      ['update', 'updatestart', 'updateend'].forEach((event) => {
        buffer.addEventListener(event, () => {
          // if audio is disabled
          if (type === 'audio' && this.audioDisabled_) {
            return;
          }

          if (event === 'updateend') {
            this[`${type}Buffer_`].updating = false;
          }

          let shouldTrigger = types.every((t) => {
            // skip checking audio's updating status if audio
            // is not enabled
            if (t === 'audio' && this.audioDisabled_) {
              return true;
            }
            // if the other type is updating we don't trigger
            if (type !== t &&
                this[`${t}Buffer_`] &&
                this[`${t}Buffer_`].updating) {
              return false;
            }
            return true;
          });

          if (shouldTrigger) {
            return this.trigger(event);
          }
        });
      });
    });
  }

  /**
   * Emulate the native mediasource function, but our function will
   * send all of the proposed segments to the transmuxer so that we
   * can transmux them before we append them to our internal
   * native source buffers in the correct format.
   *
   * @link https://developer.mozilla.org/en-US/docs/Web/API/SourceBuffer/appendBuffer
   * @param {Uint8Array} segment the segment to append to the buffer
   */
  appendBuffer(segment) {
    // Start the internal "updating" state
    this.bufferUpdating_ = true;

    if (this.audioBuffer_ && this.audioBuffer_.buffered.length) {
      let audioBuffered = this.audioBuffer_.buffered;

      this.transmuxer_.postMessage({
        action: 'setAudioAppendStart',
        appendStart: audioBuffered.end(audioBuffered.length - 1)
      });
    }

    if (this.videoBuffer_) {
      this.transmuxer_.postMessage({
        action: 'alignGopsWith',
        gopsToAlignWith: gopsSafeToAlignWith(this.gopBuffer_,
                                             this.mediaSource_.player_ ?
                                               this.mediaSource_.player_.currentTime() :
                                               null,
                                             this.timeMapping_)
      });
    }

    this.transmuxer_.postMessage({
      action: 'push',
      // Send the typed-array of data as an ArrayBuffer so that
      // it can be sent as a "Transferable" and avoid the costly
      // memory copy
      data: segment.buffer,

      // To recreate the original typed-array, we need information
      // about what portion of the ArrayBuffer it was a view into
      byteOffset: segment.byteOffset,
      byteLength: segment.byteLength
    },
    [segment.buffer]);
    this.transmuxer_.postMessage({action: 'flush'});
  }

  /**
   * Appends gop information (timing and byteLength) received by the transmuxer for the
   * gops appended in the last call to appendBuffer
   *
   * @param {Event} event
   *        The gopInfo event from the transmuxer
   * @param {Array} event.data.gopInfo
   *        List of gop info to append
   */
  appendGopInfo_(event) {
    this.gopBuffer_ = updateGopBuffer(this.gopBuffer_,
                                      event.data.gopInfo,
                                      this.safeAppend_);
  }

  /**
   * Emulate the native mediasource function and remove parts
   * of the buffer from any of our internal buffers that exist
   *
   * @link https://developer.mozilla.org/en-US/docs/Web/API/SourceBuffer/remove
   * @param {Double} start position to start the remove at
   * @param {Double} end position to end the remove at
   */
  remove(start, end) {
    if (this.videoBuffer_) {
      this.videoBuffer_.updating = true;
      this.videoBuffer_.remove(start, end);
      this.gopBuffer_ = removeGopBuffer(this.gopBuffer_, start, end, this.timeMapping_);
    }
    if (!this.audioDisabled_ && this.audioBuffer_) {
      this.audioBuffer_.updating = true;
      this.audioBuffer_.remove(start, end);
    }

    // Remove Metadata Cues (id3)
    removeCuesFromTrack(start, end, this.metadataTrack_);

    // Remove Any Captions
    if (this.inbandTextTracks_) {
      for (let track in this.inbandTextTracks_) {
        removeCuesFromTrack(start, end, this.inbandTextTracks_[track]);
      }
    }
  }

  /**
   * Process any segments that the muxer has output
   * Concatenate segments together based on type and append them into
   * their respective sourceBuffers
   *
   * @private
   */
  processPendingSegments_() {
    let sortedSegments = {
      video: {
        segments: [],
        bytes: 0
      },
      audio: {
        segments: [],
        bytes: 0
      },
      captions: [],
      metadata: []
    };

    // Sort segments into separate video/audio arrays and
    // keep track of their total byte lengths
    sortedSegments = this.pendingBuffers_.reduce(function(segmentObj, segment) {
      let type = segment.type;
      let data = segment.data;
      let initSegment = segment.initSegment;

      segmentObj[type].segments.push(data);
      segmentObj[type].bytes += data.byteLength;

      segmentObj[type].initSegment = initSegment;

      // Gather any captions into a single array
      if (segment.captions) {
        segmentObj.captions = segmentObj.captions.concat(segment.captions);
      }

      if (segment.info) {
        segmentObj[type].info = segment.info;
      }

      // Gather any metadata into a single array
      if (segment.metadata) {
        segmentObj.metadata = segmentObj.metadata.concat(segment.metadata);
      }

      return segmentObj;
    }, sortedSegments);

    // Create the real source buffers if they don't exist by now since we
    // finally are sure what tracks are contained in the source
    if (!this.videoBuffer_ && !this.audioBuffer_) {
      // Remove any codecs that may have been specified by default but
      // are no longer applicable now
      if (sortedSegments.video.bytes === 0) {
        this.videoCodec_ = null;
      }
      if (sortedSegments.audio.bytes === 0) {
        this.audioCodec_ = null;
      }

      this.createRealSourceBuffers_();
    }

    if (sortedSegments.audio.info) {
      this.mediaSource_.trigger({type: 'audioinfo', info: sortedSegments.audio.info});
    }
    if (sortedSegments.video.info) {
      this.mediaSource_.trigger({type: 'videoinfo', info: sortedSegments.video.info});
    }

    if (this.appendAudioInitSegment_) {
      if (!this.audioDisabled_ && this.audioBuffer_) {
        sortedSegments.audio.segments.unshift(sortedSegments.audio.initSegment);
        sortedSegments.audio.bytes += sortedSegments.audio.initSegment.byteLength;
      }
      this.appendAudioInitSegment_ = false;
    }

    let triggerUpdateend = false;

    // Merge multiple video and audio segments into one and append
    if (this.videoBuffer_ && sortedSegments.video.bytes) {
      sortedSegments.video.segments.unshift(sortedSegments.video.initSegment);
      sortedSegments.video.bytes += sortedSegments.video.initSegment.byteLength;
      this.concatAndAppendSegments_(sortedSegments.video, this.videoBuffer_);

    } else if (this.videoBuffer_ && (this.audioDisabled_ || !this.audioBuffer_)) {
      // The transmuxer did not return any bytes of video, meaning it was all trimmed
      // for gop alignment. Since we have a video buffer and audio is disabled, updateend
      // will never be triggered by this source buffer, which will cause contrib-hls
      // to be stuck forever waiting for updateend. If audio is not disabled, updateend
      // will be triggered by the audio buffer, which will be sent upwards since the video
      // buffer will not be in an updating state.
      triggerUpdateend = true;
    }

    // Add text-track data for all
    addTextTrackData(this, sortedSegments.captions, sortedSegments.metadata);

    if (!this.audioDisabled_ && this.audioBuffer_) {
      this.concatAndAppendSegments_(sortedSegments.audio, this.audioBuffer_);
    }

    this.pendingBuffers_.length = 0;

    if (triggerUpdateend) {
      this.trigger('updateend');
    }

    // We are no longer in the internal "updating" state
    this.bufferUpdating_ = false;
  }

  /**
   * Combine all segments into a single Uint8Array and then append them
   * to the destination buffer
   *
   * @param {Object} segmentObj
   * @param {SourceBuffer} destinationBuffer native source buffer to append data to
   * @private
   */
  concatAndAppendSegments_(segmentObj, destinationBuffer) {
    let offset = 0;
    let tempBuffer;

    if (segmentObj.bytes) {
      tempBuffer = new Uint8Array(segmentObj.bytes);

      // Combine the individual segments into one large typed-array
      segmentObj.segments.forEach(function(segment) {
        tempBuffer.set(segment, offset);
        offset += segment.byteLength;
      });

      try {
        destinationBuffer.updating = true;
        destinationBuffer.appendBuffer(tempBuffer);
      } catch (error) {
        if (this.mediaSource_.player_) {
          this.mediaSource_.player_.error({
            code: -3,
            type: 'APPEND_BUFFER_ERR',
            message: error.message,
            originalError: error
          });
        }
      }
    }
  }

  /**
   * Emulate the native mediasource function. abort any soureBuffer
   * actions and throw out any un-appended data.
   *
   * @link https://developer.mozilla.org/en-US/docs/Web/API/SourceBuffer/abort
   */
  abort() {
    if (this.videoBuffer_) {
      this.videoBuffer_.abort();
    }
    if (!this.audioDisabled_ && this.audioBuffer_) {
      this.audioBuffer_.abort();
    }
    if (this.transmuxer_) {
      this.transmuxer_.postMessage({action: 'reset'});
    }
    this.pendingBuffers_.length = 0;
    this.bufferUpdating_ = false;
  }
}
