import document from 'global/document';
import sinon from 'sinon';
import videojs from 'video.js';
import URLToolkit from 'url-toolkit';
import testDataManifests from './test-manifests.js';
import xhrFactory from '../src/xhr';
import { isLikelyFmp4Data } from '../src/util/codecs';
import window from 'global/window';
import { muxed as muxedSegment } from './test-segments';

const RealMediaSource = window.MediaSource;
const realCreateObjectURL = window.URL.createObjectURL;

// a SourceBuffer that tracks updates but otherwise is a noop
class MockSourceBuffer extends videojs.EventTarget {
  constructor() {
    super();
    this.updates_ = [];

    this.updating = false;
    this.on('updateend', function() {
      this.updating = false;
    });

    this.buffered = videojs.createTimeRanges();
    this.duration_ = NaN;

    Object.defineProperty(this, 'duration', {
      get() {
        return this.duration_;
      },
      set(duration) {
        this.updates_.push({
          duration
        });
        this.duration_ = duration;
      }
    });
  }

  abort() {
    this.updates_.push({
      abort: true
    });
  }

  appendBuffer(config) {
    this.updates_.push({
      append: config
    });
    this.updating = true;
  }

  remove(start, end) {
    this.updates_.push({
      remove: [start, end]
    });
  }
}

class MockMediaSource extends videojs.EventTarget {
  constructor() {
    super();
    this.readyState = 'closed';
    this.on('sourceopen', function() {
      this.readyState = 'open';
    });

    this.activeSourceBuffers = [];
    // this.activeSourceBuffers.onaddsourcebuffer: null,
    // this.activeSourceBuffers.onremovesourcebuffer: null
    this.sourceBuffers = this.activeSourceBuffers;
    this.duration_ = NaN;
    this.seekable = videojs.createTimeRange();
    this.onsourceclose = null;
    this.onsourceended = null;
    this.onsourceopen = null;
    this.nativeMediaSource_ = new RealMediaSource();

    Object.defineProperty(this, 'duration', {
      get() {
        return this.duration_;
      },
      set(duration) {
        this.duration_ = duration;
        this.trigger('durationchange');
      }
    });
  }

  addSeekableRange_(start, end) {
    this.seekable = videojs.createTimeRange(start, end);
  }

  addSourceBuffer(mime) {
    let sourceBuffer = new MockSourceBuffer();

    sourceBuffer.mimeType_ = mime;
    this.sourceBuffers.push(sourceBuffer);
    return sourceBuffer;
  }

  endOfStream(error) {
    this.readyState = 'ended';
    this.error_ = error;
  }
}

MockMediaSource.isTypeSupported = RealMediaSource.isTypeSupported;

export class MockTextTrack {
  constructor() {
    this.cues = [];
  }
  addCue(cue) {
    this.cues.push(cue);
  }
  removeCue(cue) {
    for (let i = 0; i < this.cues.length; i++) {
      if (this.cues[i] === cue) {
        this.cues.splice(i, 1);
        break;
      }
    }
  }
}

// return an absolute version of a page-relative URL
export const absoluteUrl = function(relativeUrl) {
  return URLToolkit.buildAbsoluteURL(window.location.href, relativeUrl);
};

export const useFakeMediaSource = function() {
  window.MediaSource = MockMediaSource;
  window.URL.createObjectURL = (object) => realCreateObjectURL(
    object instanceof MockMediaSource ? object.nativeMediaSource_ : object);

  return {
    restore() {
      window.MediaSource = RealMediaSource;
      window.URL.createObjectURL = realCreateObjectURL;
    }
  };
};

export const useFakeEnvironment = function(assert) {
  let realXMLHttpRequest = videojs.xhr.XMLHttpRequest;

  let fakeEnvironment = {
    requests: [],
    restore() {
      this.clock.restore();
      videojs.xhr.XMLHttpRequest = realXMLHttpRequest;
      this.xhr.restore();
      ['warn', 'error'].forEach((level) => {
        if (this.log && this.log[level] && this.log[level].restore) {
          if (assert) {
            let calls = (this.log[level].args || []).map((args) => {
              return args.join(', ');
            }).join('\n  ');

            assert.equal(this.log[level].callCount,
                        0,
                        'no unexpected logs at level "' + level + '":\n  ' + calls);
          }
          this.log[level].restore();
        }
      });
    }
  };

  fakeEnvironment.log = {};
  ['warn', 'error'].forEach((level) => {
    // you can use .log[level].args to get args
    sinon.stub(videojs.log, level);
    fakeEnvironment.log[level] = videojs.log[level];
    Object.defineProperty(videojs.log[level], 'calls', {
      get() {
        // reset callCount to 0 so they don't have to
        let callCount = this.callCount;

        this.callCount = 0;
        return callCount;
      }
    });
  });
  fakeEnvironment.clock = sinon.useFakeTimers();
  fakeEnvironment.xhr = sinon.useFakeXMLHttpRequest();

  // Sinon 1.10.2 handles abort incorrectly (triggering the error event)
  // Later versions fixed this but broke the ability to set the response
  // to an arbitrary object (in our case, a typed array).
  XMLHttpRequest.prototype = Object.create(XMLHttpRequest.prototype);
  XMLHttpRequest.prototype.abort = function abort() {
    this.response = this.responseText = '';
    this.errorFlag = true;
    this.requestHeaders = {};
    this.responseHeaders = {};

    if (this.readyState > 0 && this.sendFlag) {
      this.readyStateChange(4);
      this.sendFlag = false;
    }

    this.readyState = 0;
  };

  XMLHttpRequest.prototype.downloadProgress = function downloadProgress(rawEventData) {
    // `responseText` we only really use when we’re requesting as text
    // so that we can see data on progress events.
    // `downloadProgress` should be called with 0 bytes
    // and then add new bytes each progress event
    if (this.mimeTypeOverride === 'text/plain; charset=x-user-defined') {
      this.responseText = rawEventData.toString();
    }

    this.dispatchEvent(new sinon.ProgressEvent('progress',
                                               rawEventData,
                                               this));
  };

  // used for treating the response however we want, instead of the browser deciding
  // responses we don't have to worry about the browser changing responses
  XMLHttpRequest.prototype.overrideMimeType = function overrideMimeType(mimeType) {
    this.mimeTypeOverride = mimeType;
  };

  // add support for xhr.responseURL
  XMLHttpRequest.prototype.open = (function(origFn) {
    return function() {
      this.responseURL = absoluteUrl(arguments[1]);

      return origFn.apply(this, arguments);
    };
  }(XMLHttpRequest.prototype.open));

  fakeEnvironment.requests.length = 0;
  fakeEnvironment.xhr.onCreate = function(xhr) {
    fakeEnvironment.requests.push(xhr);
  };
  videojs.xhr.XMLHttpRequest = fakeEnvironment.xhr;

  return fakeEnvironment;
};

// patch over some methods of the provided tech so it can be tested
// synchronously with sinon's fake timers
export const mockTech = function(tech) {
  if (tech.isMocked_) {
    // make this function idempotent because HTML and Flash based
    // playback have very different lifecycles. For HTML, the tech
    // is available on player creation. For Flash, the tech isn't
    // ready until the source has been loaded and one tick has
    // expired.
    return;
  }

  tech.isMocked_ = true;
  tech.src_ = null;
  tech.time_ = null;

  tech.paused_ = !tech.autoplay();
  tech.paused = function() {
    return tech.paused_;
  };

  if (!tech.currentTime_) {
    tech.currentTime_ = tech.currentTime;
  }
  tech.currentTime = function() {
    return tech.time_ === null ? tech.currentTime_() : tech.time_;
  };

  tech.setSrc = function(src) {
    tech.src_ = src;
  };
  tech.src = function(src) {
    if (src !== null) {
      return tech.setSrc(src);
    }
    return tech.src_ === null ? tech.src : tech.src_;
  };
  tech.currentSrc_ = tech.currentSrc;
  tech.currentSrc = function() {
    return tech.src_ === null ? tech.currentSrc_() : tech.src_;
  };

  tech.play_ = tech.play;
  tech.play = function() {
    tech.play_();
    tech.paused_ = false;
    tech.trigger('play');
  };
  tech.pause_ = tech.pause;
  tech.pause = function() {
    tech.pause_();
    tech.paused_ = true;
    tech.trigger('pause');
  };

  tech.setCurrentTime = function(time) {
    tech.time_ = time;

    setTimeout(function() {
      tech.trigger('seeking');
      setTimeout(function() {
        tech.trigger('seeked');
      }, 1);
    }, 1);
  };
};

export const createPlayer = function(options, src, clock) {
  let video;
  let player;

  video = document.createElement('video');
  video.className = 'video-js';
  if (src) {
    if (typeof src === 'string') {
      video.src = src;
    } else if (src.src) {
      let source = document.createElement('source');

      source.src = src.src;
      if (src.type) {
        source.type = src.type;
      }
      video.appendChild(source);
    }
  }
  document.querySelector('#qunit-fixture').appendChild(video);
  player = videojs(video, options || {});

  player.buffered = function() {
    return videojs.createTimeRange(0, 0);
  };

  if (clock) {
    clock.tick(1);
  }

  mockTech(player.tech_);

  return player;
};

export const openMediaSource = function(player, clock) {
  player.tech_.triggerReady();
  clock.tick(1);
  // mock the tech *after* it has finished loading so that we don't
  // mock a tech that will be unloaded on the next tick
  mockTech(player.tech_);
  if (player.tech_.hls) {
    player.tech_.hls.xhr = xhrFactory();
    // simulate the sourceopen event
    player.tech_.hls.mediaSource.readyState = 'open';
    player.tech_.hls.mediaSource.dispatchEvent({
      type: 'sourceopen',
      swfId: player.tech_.el() && player.tech_.el().id
    });
    clock.tick(1);
  }
};

export const standardXHRResponse = function(request, data) {
  if (!request.url) {
    return;
  }

  let contentType = 'application/json';
  // contents off the global object
  let manifestName = (/(?:.*\/)?(.*)\.(m3u8|mpd)/).exec(request.url);

  if (manifestName) {
    manifestName = manifestName[1];
  } else {
    manifestName = request.url;
  }

  if (/\.m3u8?/.test(request.url)) {
    contentType = 'application/vnd.apple.mpegurl';
  } else if (/\.ts/.test(request.url)) {
    contentType = 'video/MP2T';
  } else if (/\.mpd/.test(request.url)) {
    contentType = 'application/dash+xml';
  } else if (request.responseType === 'arraybuffer') {
    contentType = 'binary/octet-stream';
  }

  if (!data) {
    data = testDataManifests[manifestName];
  }

  const isTypedBuffer = data instanceof Uint8Array || data instanceof Uint32Array;

  request.response =
    // if segment data was passed, use that, otherwise use a placeholder
    isTypedBuffer ? data.buffer : new Uint8Array(1024).buffer;

  // `response` will get the full value after the request finishes
  request.respond(
    200,
    { 'Content-Type': contentType },
    isTypedBuffer ? '' : data
  );
};

export const playlistWithDuration = function(time, conf) {
  let result = {
    targetDuration: 10,
    mediaSequence: conf && conf.mediaSequence ? conf.mediaSequence : 0,
    discontinuityStarts: conf && conf.discontinuityStarts ? conf.discontinuityStarts : [],
    segments: [],
    endList: conf && typeof conf.endList !== 'undefined' ? !!conf.endList : true,
    uri: conf && typeof conf.uri !== 'undefined' ? conf.uri : 'playlist.m3u8',
    discontinuitySequence:
      conf && conf.discontinuitySequence ? conf.discontinuitySequence : 0,
    attributes: conf && typeof conf.attributes !== 'undefined' ? conf.attributes : {}
  };
  let count = Math.floor(time / 10);
  let remainder = time % 10;
  let i;
  let isEncrypted = conf && conf.isEncrypted;
  let extension = conf && conf.extension ? conf.extension : '.ts';
  let timeline = result.discontinuitySequence;
  let discontinuityStartsIndex = 0;

  for (i = 0; i < count; i++) {
    if (result.discontinuityStarts &&
        result.discontinuityStarts[discontinuityStartsIndex] === i) {
      timeline++;
      discontinuityStartsIndex++;
    }

    result.segments.push({
      uri: i + extension,
      resolvedUri: i + extension,
      duration: 10,
      timeline
    });
    if (isEncrypted) {
      result.segments[i].key = {
        uri: i + '-key.php',
        resolvedUri: i + '-key.php'
      };
    }
  }
  if (remainder) {
    result.segments.push({
      uri: i + extension,
      duration: remainder,
      timeline: result.discontinuitySequence
    });
  }
  return result;
};

// Attempts to produce an absolute URL to a given relative path
// based on window.location.href
export const urlTo = function(path) {
  return window.location.href
    .split('/')
    .slice(0, -1)
    .concat([path])
    .join('/');
};

export const createResponseText = function(length) {
  let responseText = '';

  for (let i = 0; i < length; i++) {
    responseText += '0';
  }

  return responseText;
};

/*
 * Helper method to request and append a segment (from XHR to source buffers).
 *
 * @param {Object} request the mocked request
 * @param {Uint8Array} [segment=muxed segment] segment bytes to response with
 * @param {Object} segmentLoader the segment loader
 * @param {Object} clock the mocked clock
 * @param {Number} [bandwidth] bandwidth to use in bits/s
 *                             (takes precedence over requestDurationMillis)
 * @param {Number} [throughput] throughput to use in bits/s
 * @param {Number} [requestDurationMillis=1000] duration of request to tick the clock, in
 *                                              milliseconds
 * @param {Boolean} [isOnlyAudio] segment and append should only be for audio
 * @param {Boolean} [isOnlyVideo] segment and append should only be for video
 * @param {Boolean} [tickClock=true] tick clock after updateend to allow for next
 *                                   asynchronous request
 */
export const requestAndAppendSegment = async function({
  request,
  initSegmentRequest,
  segment,
  initSegment,
  segmentLoader,
  clock,
  bandwidth,
  throughput,
  requestDurationMillis,
  isOnlyAudio,
  isOnlyVideo,
  tickClock
}) {
  segment = segment || muxedSegment();
  tickClock = typeof tickClock === 'undefined' ? true : tickClock;

  // record now since the bytes will be lost during processing
  const segmentByteLength = segment.byteLength;

  if (bandwidth) {
    requestDurationMillis = ((segmentByteLength * 8) / bandwidth) * 1000;
  }
  // one second default
  requestDurationMillis = requestDurationMillis || 1000;

  clock.tick(requestDurationMillis);
  if (initSegmentRequest) {
    standardXHRResponse(initSegmentRequest, initSegment);
  }
  standardXHRResponse(request, segment);

  // fmp4 segments don't need to be transmuxed, therefore will execute synchronously
  if (!isLikelyFmp4Data(segment)) {
    await new Promise((accept, reject) => {
      segmentLoader.on('appending', accept);
    });
  }

  if (throughput) {
    const appendMillis = ((segmentByteLength * 8) / throughput) * 1000;

    clock.tick(appendMillis - (tickClock ? 1 : 0));
  }

  if (segmentLoader.sourceUpdater_.audioBuffer instanceof MockSourceBuffer ||
      segmentLoader.sourceUpdater_.videoBuffer instanceof MockSourceBuffer) {
    // source buffers are mocked, so must manually trigger update ends on buffers,
    // since they don't actually do any appends
    if (isOnlyAudio) {
      segmentLoader.sourceUpdater_.audioBuffer.trigger('updateend');
    } else if (isOnlyVideo) {
      segmentLoader.sourceUpdater_.videoBuffer.trigger('updateend');
    } else {
      segmentLoader.sourceUpdater_.audioBuffer.trigger('updateend');
      segmentLoader.sourceUpdater_.videoBuffer.trigger('updateend');
    }
  }

  if (tickClock) {
    clock.tick(1);
  }
};

export const disposePlaybackWatcher = (player) => {
  player.vhs.playbackWatcher_.dispose();
};

export const setupMediaSource = (mediaSource, sourceUpdater, options) => {
  // this can be a valid case, for instance, for the vtt loader
  if (!mediaSource) {
    return;
  }

  // must attach a media source to a video element
  const videoEl =
    (options && options.videoEl) ? options.videoEl : document.createElement('video');

  videoEl.src = window.URL.createObjectURL(mediaSource);

  return new Promise((resolve, reject) => {
    mediaSource.addEventListener('sourceopen', () => {
      const codecs = {};

      if (!options || !options.isVideoOnly) {
        codecs.audio = 'mp4a.40.2';
      }
      if (!options || !options.isAudioOnly) {
        codecs.video = 'avc1.4d001e';
      }

      sourceUpdater.createSourceBuffers(codecs);
      resolve();
    });

    mediaSource.addEventListener('error', (e) => {
      reject(e);
    });
  });
};
