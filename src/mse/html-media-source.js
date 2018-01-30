/**
 * @file html-media-source.js
 */
import window from 'global/window';
import document from 'global/document';
import videojs from 'video.js';
import VirtualSourceBuffer from './virtual-source-buffer';
import {durationOfVideo} from './add-text-track-data';
import {
  isAudioCodec,
  isVideoCodec,
  parseContentType,
  translateLegacyCodecs
} from './codec-utils';

/**
 * Our MediaSource implementation in HTML, mimics native
 * MediaSource where/if possible.
 *
 * @link https://developer.mozilla.org/en-US/docs/Web/API/MediaSource
 * @class HtmlMediaSource
 * @extends videojs.EventTarget
 */
export default class HtmlMediaSource extends videojs.EventTarget {
  constructor() {
    super();
    let property;

    this.nativeMediaSource_ = new window.MediaSource();
    // delegate to the native MediaSource's methods by default
    for (property in this.nativeMediaSource_) {
      if (!(property in HtmlMediaSource.prototype) &&
          typeof this.nativeMediaSource_[property] === 'function') {
        this[property] = this.nativeMediaSource_[property].bind(this.nativeMediaSource_);
      }
    }

    // emulate `duration` and `seekable` until seeking can be
    // handled uniformly for live streams
    // see https://github.com/w3c/media-source/issues/5
    this.duration_ = NaN;
    Object.defineProperty(this, 'duration', {
      get() {
        if (this.duration_ === Infinity) {
          return this.duration_;
        }
        return this.nativeMediaSource_.duration;
      },
      set(duration) {
        this.duration_ = duration;
        if (duration !== Infinity) {
          this.nativeMediaSource_.duration = duration;
          return;
        }
      }
    });
    Object.defineProperty(this, 'seekable', {
      get() {
        if (this.duration_ === Infinity) {
          return videojs.createTimeRanges([[0, this.nativeMediaSource_.duration]]);
        }
        return this.nativeMediaSource_.seekable;
      }
    });

    Object.defineProperty(this, 'readyState', {
      get() {
        return this.nativeMediaSource_.readyState;
      }
    });

    Object.defineProperty(this, 'activeSourceBuffers', {
      get() {
        return this.activeSourceBuffers_;
      }
    });

    // the list of virtual and native SourceBuffers created by this
    // MediaSource
    this.sourceBuffers = [];

    this.activeSourceBuffers_ = [];

    /**
     * update the list of active source buffers based upon various
     * imformation from HLS and video.js
     *
     * @private
     */
    this.updateActiveSourceBuffers_ = () => {
      // Retain the reference but empty the array
      this.activeSourceBuffers_.length = 0;

      // If there is only one source buffer, then it will always be active and audio will
      // be disabled based on the codec of the source buffer
      if (this.sourceBuffers.length === 1) {
        let sourceBuffer = this.sourceBuffers[0];

        sourceBuffer.appendAudioInitSegment_ = true;
        sourceBuffer.audioDisabled_ = !sourceBuffer.audioCodec_;
        this.activeSourceBuffers_.push(sourceBuffer);
        return;
      }

      // There are 2 source buffers, a combined (possibly video only) source buffer and
      // and an audio only source buffer.
      // By default, the audio in the combined virtual source buffer is enabled
      // and the audio-only source buffer (if it exists) is disabled.
      let disableCombined = false;
      let disableAudioOnly = true;

      // TODO: maybe we can store the sourcebuffers on the track objects?
      // safari may do something like this
      for (let i = 0; i < this.player_.audioTracks().length; i++) {
        let track = this.player_.audioTracks()[i];

        if (track.enabled && track.kind !== 'main') {
          // The enabled track is an alternate audio track so disable the audio in
          // the combined source buffer and enable the audio-only source buffer.
          disableCombined = true;
          disableAudioOnly = false;
          break;
        }
      }

      this.sourceBuffers.forEach((sourceBuffer) => {
        /* eslinst-disable */
        // TODO once codecs are required, we can switch to using the codecs to determine
        //      what stream is the video stream, rather than relying on videoTracks
        /* eslinst-enable */

        sourceBuffer.appendAudioInitSegment_ = true;

        if (sourceBuffer.videoCodec_ && sourceBuffer.audioCodec_) {
          // combined
          sourceBuffer.audioDisabled_ = disableCombined;
        } else if (sourceBuffer.videoCodec_ && !sourceBuffer.audioCodec_) {
          // If the "combined" source buffer is video only, then we do not want
          // disable the audio-only source buffer (this is mostly for demuxed
          // audio and video hls)
          sourceBuffer.audioDisabled_ = true;
          disableAudioOnly = false;
        } else if (!sourceBuffer.videoCodec_ && sourceBuffer.audioCodec_) {
          // audio only
          sourceBuffer.audioDisabled_ = disableAudioOnly;
          if (disableAudioOnly) {
            return;
          }
        }

        this.activeSourceBuffers_.push(sourceBuffer);
      });
    };

    this.onPlayerMediachange_ = () => {
      this.sourceBuffers.forEach((sourceBuffer) => {
        sourceBuffer.appendAudioInitSegment_ = true;
      });
    };

    this.onHlsReset_ = () => {
      this.sourceBuffers.forEach((sourceBuffer) => {
        if (sourceBuffer.transmuxer_) {
          sourceBuffer.transmuxer_.postMessage({action: 'resetCaptions'});
        }
      });
    };

    this.onHlsSegmentTimeMapping_ = (event) => {
      this.sourceBuffers.forEach(buffer => buffer.timeMapping_ = event.mapping);
    };

    // Re-emit MediaSource events on the polyfill
    [
      'sourceopen',
      'sourceclose',
      'sourceended'
    ].forEach(function(eventName) {
      this.nativeMediaSource_.addEventListener(eventName, this.trigger.bind(this));
    }, this);

    // capture the associated player when the MediaSource is
    // successfully attached
    this.on('sourceopen', (event) => {
      // Get the player this MediaSource is attached to
      let video = document.querySelector('[src="' + this.url_ + '"]');

      if (!video) {
        return;
      }

      this.player_ = videojs(video.parentNode);

      // hls-reset is fired by videojs.Hls on to the tech after the main SegmentLoader
      // resets its state and flushes the buffer
      this.player_.tech_.on('hls-reset', this.onHlsReset_);
      // hls-segment-time-mapping is fired by videojs.Hls on to the tech after the main
      // SegmentLoader inspects an MTS segment and has an accurate stream to display
      // time mapping
      this.player_.tech_.on('hls-segment-time-mapping', this.onHlsSegmentTimeMapping_);

      if (this.player_.audioTracks && this.player_.audioTracks()) {
        this.player_.audioTracks().on('change', this.updateActiveSourceBuffers_);
        this.player_.audioTracks().on('addtrack', this.updateActiveSourceBuffers_);
        this.player_.audioTracks().on('removetrack', this.updateActiveSourceBuffers_);
      }

      this.player_.on('mediachange', this.onPlayerMediachange_);
    });

    this.on('sourceended', (event) => {
      let duration = durationOfVideo(this.duration);

      for (let i = 0; i < this.sourceBuffers.length; i++) {
        let sourcebuffer = this.sourceBuffers[i];
        let cues = sourcebuffer.metadataTrack_ && sourcebuffer.metadataTrack_.cues;

        if (cues && cues.length) {
          cues[cues.length - 1].endTime = duration;
        }
      }
    });

    // explicitly terminate any WebWorkers that were created
    // by SourceHandlers
    this.on('sourceclose', function(event) {
      this.sourceBuffers.forEach(function(sourceBuffer) {
        if (sourceBuffer.transmuxer_) {
          sourceBuffer.transmuxer_.terminate();
        }
      });

      this.sourceBuffers.length = 0;
      if (!this.player_) {
        return;
      }

      if (this.player_.audioTracks && this.player_.audioTracks()) {
        this.player_.audioTracks().off('change', this.updateActiveSourceBuffers_);
        this.player_.audioTracks().off('addtrack', this.updateActiveSourceBuffers_);
        this.player_.audioTracks().off('removetrack', this.updateActiveSourceBuffers_);
      }

      // We can only change this if the player hasn't been disposed of yet
      // because `off` eventually tries to use the el_ property. If it has
      // been disposed of, then don't worry about it because there are no
      // event handlers left to unbind anyway
      if (this.player_.el_) {
        this.player_.off('mediachange', this.onPlayerMediachange_);
        this.player_.tech_.off('hls-reset', this.onHlsReset_);
        this.player_.tech_.off('hls-segment-time-mapping', this.onHlsSegmentTimeMapping_);
      }
    });
  }

  /**
   * Add a range that that can now be seeked to.
   *
   * @param {Double} start where to start the addition
   * @param {Double} end where to end the addition
   * @private
   */
  addSeekableRange_(start, end) {
    let error;

    if (this.duration !== Infinity) {
      error = new Error('MediaSource.addSeekableRange() can only be invoked ' +
                        'when the duration is Infinity');
      error.name = 'InvalidStateError';
      error.code = 11;
      throw error;
    }

    if (end > this.nativeMediaSource_.duration ||
        isNaN(this.nativeMediaSource_.duration)) {
      this.nativeMediaSource_.duration = end;
    }
  }

  /**
   * Add a source buffer to the media source.
   *
   * @link https://developer.mozilla.org/en-US/docs/Web/API/MediaSource/addSourceBuffer
   * @param {String} type the content-type of the content
   * @return {Object} the created source buffer
   */
  addSourceBuffer(type) {
    let buffer;
    let parsedType = parseContentType(type);

    // Create a VirtualSourceBuffer to transmux MPEG-2 transport
    // stream segments into fragmented MP4s
    if ((/^(video|audio)\/mp2t$/i).test(parsedType.type)) {
      let codecs = [];

      if (parsedType.parameters && parsedType.parameters.codecs) {
        codecs = parsedType.parameters.codecs.split(',');
        codecs = translateLegacyCodecs(codecs);
        codecs = codecs.filter((codec) => {
          return (isAudioCodec(codec) || isVideoCodec(codec));
        });
      }

      if (codecs.length === 0) {
        codecs = ['avc1.4d400d', 'mp4a.40.2'];
      }

      buffer = new VirtualSourceBuffer(this, codecs);

      if (this.sourceBuffers.length !== 0) {
        // If another VirtualSourceBuffer already exists, then we are creating a
        // SourceBuffer for an alternate audio track and therefore we know that
        // the source has both an audio and video track.
        // That means we should trigger the manual creation of the real
        // SourceBuffers instead of waiting for the transmuxer to return data
        this.sourceBuffers[0].createRealSourceBuffers_();
        buffer.createRealSourceBuffers_();

        // Automatically disable the audio on the first source buffer if
        // a second source buffer is ever created
        this.sourceBuffers[0].audioDisabled_ = true;
      }
    } else {
      // delegate to the native implementation
      buffer = this.nativeMediaSource_.addSourceBuffer(type);
    }

    this.sourceBuffers.push(buffer);
    return buffer;
  }
}
