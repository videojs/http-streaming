import document from 'global/document';
import sinon from 'sinon';
import videojs from 'video.js';
import URLToolkit from 'url-toolkit';
import testDataManifests from 'create-test-data!manifests';
import xhrFactory from '../src/xhr';
import window from 'global/window';
import { muxed as muxedSegment } from 'create-test-data!segments';
import {bytesToString, isTypedArray} from '@videojs/vhs-utils/es/byte-helpers';
import {createTimeRanges} from '../src/util/vjs-compat';

// return an absolute version of a page-relative URL
export const absoluteUrl = function(relativeUrl) {
  return URLToolkit.buildAbsoluteURL(window.location.href, relativeUrl);
};

const origOpen = sinon.FakeXMLHttpRequest.prototype.open;

sinon.FakeXMLHttpRequest.prototype.open = function() {
  this.responseURL = absoluteUrl(arguments[1]);
  return origOpen.apply(this, arguments);
};

// used for treating the response however we want, instead of the browser deciding
// responses we don't have to worry about the browser changing responses
sinon.FakeXMLHttpRequest.prototype.overrideMimeType = function overrideMimeType(mimeType) {
  this.mimeTypeOverride = mimeType;
};

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

    this.buffered = createTimeRanges();
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

  changeType() {}

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
    this.seekable = createTimeRanges();
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
    this.seekable = createTimeRanges(start, end);
  }

  addSourceBuffer(mime) {
    const sourceBuffer = new MockSourceBuffer();

    sourceBuffer.mimeType_ = mime;
    this.sourceBuffers.push(sourceBuffer);
    return sourceBuffer;
  }

  removeSourceBuffer(sourceBuffer) {
    const index = this.sourceBuffers.indexOf(sourceBuffer);

    if (index !== -1) {
      this.sourceBuffers.splice(index, 1);
    }
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

export const useFakeMediaSource = function() {
  window.MediaSource = MockMediaSource;
  window.URL.createObjectURL = (object) => realCreateObjectURL(object instanceof MockMediaSource ? object.nativeMediaSource_ : object);

  return {
    restore() {
      window.MediaSource = RealMediaSource;
      window.URL.createObjectURL = realCreateObjectURL;
    }
  };
};

export const downloadProgress = (xhr, rawEventData) => {
  const text = rawEventData.toString();

  // `responseText` primarily used when requesting as text so that data can be seen on
  // progress events.
  if (xhr.mimeTypeOverride === 'text/plain; charset=x-user-defined') {
    xhr.responseText = text;
  }

  // although text.length won't provide an exact byte length in all cases, it is close
  // enough
  //
  // note that the `total` property isn't provided since it isn't needed by our code
  // (right now)
  xhr.downloadProgress({ loaded: text.length });
};

export const useFakeEnvironment = function(assert) {
  const realXMLHttpRequest = videojs.xhr.XMLHttpRequest;

  const fakeEnvironment = {
    objurls: [],
    requests: [],
    restore() {
      fakeEnvironment.objurls.forEach(function(objurl) {
        window.URL.revokeObjectURL(objurl);
      });
      window.URL.createObjectURL = realCreateObjectURL;
      this.clock.restore();
      videojs.xhr.XMLHttpRequest = realXMLHttpRequest;
      this.xhr.restore();
      ['warn', 'error'].forEach((level) => {
        if (this.log && this.log[level] && this.log[level].restore) {
          if (assert) {
            const calls = (this.log[level].args || []).map((args) => {
              return args.reduce((acc, val) => {
                if (acc) {
                  acc += ', ';
                }

                acc += val;

                if (val.stack) {
                  acc += '\n' + val.stack;
                }
                return acc;
              }, '');
            }).join('\n  ');

            assert.equal(
              this.log[level].callCount,
              0,
              'no unexpected logs at level "' + level + '":\n' + calls
            );
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
        const callCount = this.callCount;

        this.callCount = 0;
        return callCount;
      }
    });
  });
  fakeEnvironment.clock = sinon.useFakeTimers();
  fakeEnvironment.xhr = sinon.useFakeXMLHttpRequest();

  fakeEnvironment.requests.length = 0;
  fakeEnvironment.xhr.onCreate = function(xhr) {
    fakeEnvironment.requests.push(xhr);
  };
  videojs.xhr.XMLHttpRequest = fakeEnvironment.xhr;

  window.URL.createObjectURL = (object) => {
    const objurl = realCreateObjectURL(object);

    fakeEnvironment.objurls.push(objurl);

    return objurl;
  };

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

    const playPromise = tech.play_();

    // Catch/silence error when a pause interrupts a play request
    // on browsers which return a promise
    if (typeof playPromise !== 'undefined' && typeof playPromise.then === 'function') {
      playPromise.then(null, (e) => {});
    }

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
  const video = document.createElement('video');

  video.className = 'video-js';
  if (src) {
    if (typeof src === 'string') {
      video.src = src;
    } else if (src.src) {
      const source = document.createElement('source');

      source.src = src.src;
      if (src.type) {
        source.type = src.type;
      }
      video.appendChild(source);
    }
  }
  document.querySelector('#qunit-fixture').appendChild(video);
  const player = videojs(video, options || {});

  player.buffered = function() {
    return createTimeRanges(0, 0);
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
  if (player.tech_.vhs) {
    player.tech_.vhs.xhr = xhrFactory();
    // simulate the sourceopen event
    player.tech_.vhs.mediaSource.readyState = 'open';
    player.tech_.vhs.mediaSource.dispatchEvent({
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

  const isPartialRequest = request.mimeTypeOverride === 'text/plain; charset=x-user-defined';

  if (/\.m3u8?/.test(request.url)) {
    contentType = 'application/vnd.apple.mpegurl';
  } else if (/\.ts/.test(request.url)) {
    contentType = 'video/MP2T';
  } else if (/\.mpd/.test(request.url)) {
    contentType = 'application/dash+xml';
  } else if (request.responseType === 'arraybuffer' || isPartialRequest) {
    contentType = 'binary/octet-stream';
  }

  if (!data) {
    data = testDataManifests[manifestName];
  }

  // default to a uint8array for some old tests.
  // This may be a good target to clean up in the future.
  let response = data || new Uint8Array(1024);

  if (isTypedArray(response)) {
    // a string for partial requests or a buffer for non-partial requests
    response = isPartialRequest ? bytesToString(response) : response.buffer;
  }

  request.respond(200, { 'Content-Type': contentType }, response);
};

export const playlistWithDuration = function(time, conf) {
  const targetDuration = conf && typeof conf.targetDuration === 'number' ?
    conf.targetDuration : 10;
  const result = {
    targetDuration,
    mediaSequence: conf && conf.mediaSequence ? conf.mediaSequence : 0,
    discontinuityStarts: conf && conf.discontinuityStarts ? conf.discontinuityStarts : [],
    segments: [],
    endList: conf && typeof conf.endList !== 'undefined' ? !!conf.endList : true,
    uri: conf && typeof conf.uri !== 'undefined' ? conf.uri : 'playlist.m3u8',
    discontinuitySequence:
      conf && conf.discontinuitySequence ? conf.discontinuitySequence : 0,
    attributes: conf && typeof conf.attributes !== 'undefined' ? conf.attributes : {}
  };

  if (conf && conf.llhls) {
    result.partTargetDuration = conf.llhls.partTargetDuration || (targetDuration / 5);
  }

  result.id = result.uri;

  const remainder = time % targetDuration;
  const count = Math.floor(time / targetDuration) + (remainder ? 1 : 0);
  let i;
  const isEncrypted = conf && conf.isEncrypted;
  const extension = conf && conf.extension ? conf.extension : '.ts';
  let timeline = result.discontinuitySequence;
  let discontinuityStartsIndex = 0;

  for (i = 0; i < count; i++) {
    const isDiscontinuity = result.discontinuityStarts &&
        result.discontinuityStarts[discontinuityStartsIndex] === i;

    if (isDiscontinuity) {
      timeline++;
      discontinuityStartsIndex++;
    }

    const segment = {
      uri: i + extension,
      resolvedUri: i + extension,
      // last segment will be less then 10 if duration is uneven
      duration: (i + 1 === count && remainder) ? remainder : targetDuration,
      timeline
    };

    if (isEncrypted) {
      segment.key = {
        uri: i + '-key.php',
        resolvedUri: i + '-key.php'
      };
    }

    if (isDiscontinuity) {
      segment.discontinuity = true;
    }

    // add parts for the the last 3 segments in llhls playlists
    if (conf && conf.llhls && (count - i) <= 3) {
      segment.parts = [];
      const partRemainder = segment.duration % result.partTargetDuration;
      const partCount = Math.floor(segment.duration / result.partTargetDuration) + (partRemainder ? 1 : 0);

      for (let z = 0; z < partCount; z++) {
        const uri = `segment${i}.part${z}${extension}`;

        segment.parts.push({
          uri,
          resolvedUri: uri,
          duration: (z + 1 === partCount && partRemainder) ? partRemainder : result.partTargetDuration
        });
      }
    }

    result.segments.push(segment);
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
export const requestAndAppendSegment = function({
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
  tickClock,
  decryptionTicks
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

  return new Promise((resolve, reject) => {
    segmentLoader.one('appending', resolve);
    segmentLoader.one('error', reject);

    clock.tick(requestDurationMillis);
    if (initSegmentRequest) {
      standardXHRResponse(initSegmentRequest, initSegment);
    }
    standardXHRResponse(request, segment);

    // we need decryptionTicks for syncWorker, as decryption
    // happens in a setTimeout on the main thread
    if (decryptionTicks) {
      clock.tick(2);
    }
  }).then(function() {
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
  });
};

export const disposePlaybackWatcher = (player) => {
  player.tech(true).vhs.playbackWatcher_.dispose();
};

export const setupMediaSource = (mediaSource, sourceUpdater, options) => {
  // this can be a valid case, for instance, for the vtt loader
  if (!mediaSource) {
    return Promise.resolve();
  }

  // must attach a media source to a video element
  const videoEl =
    (options && options.videoEl) ? options.videoEl : document.createElement('video');

  videoEl.src = window.URL.createObjectURL(mediaSource);

  // With the addition of the initialized EME requirement for source-updater start, a lot
  // of tests which use the media source, but don't start at the top level of the plugin
  // (where the EME initialization is done) faileddue to the source updatel never
  // reporting as ready. This direct initialization works around the issue.
  sourceUpdater.initializedEme();

  return new Promise((resolve, reject) => {
    mediaSource.addEventListener('sourceopen', () => {
      const codecs = {};

      if (!options || !options.isVideoOnly) {
        codecs.audio = 'mp4a.40.2';
      }
      if (!options || !options.isAudioOnly) {
        codecs.video = 'avc1.4d001e';
      }

      if (!options || !options.dontCreateSourceBuffers) {
        sourceUpdater.createSourceBuffers(codecs);
      }

      resolve();
    });

    mediaSource.addEventListener('error', (e) => {
      reject(e);
    });
  });
};
