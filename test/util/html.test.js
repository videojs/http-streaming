import document from 'global/document';
import window from 'global/window';
import QUnit from 'qunit';
import sinon from 'sinon';
import videojs from 'video.js';

QUnit.module('videojs-contrib-media-sources - HTML', {
  beforeEach() {
    this.fixture = document.getElementById('qunit-fixture');
    this.video = document.createElement('video');
    this.fixture.appendChild(this.video);
    this.source = document.createElement('source');

    this.player = videojs(this.video);
    // add a fake source so that we can get this.player_ on sourceopen
    this.url = 'fake.ts';
    this.source.src = this.url;
    this.video.appendChild(this.source);

    // Mock the environment's timers because certain things - particularly
    // player readiness - are asynchronous in video.js 5.
    this.clock = sinon.useFakeTimers();
    this.oldMediaSource = window.MediaSource || window.WebKitMediaSource;
    window.MediaSource = videojs.extend(videojs.EventTarget, {
      constructor() {
        this.isNative = true;
        this.sourceBuffers = [];
        this.duration = NaN;
      },
      addSourceBuffer(type) {
        let buffer = new (videojs.extend(videojs.EventTarget, {
          type,
          appendBuffer() {}
        }))();

        this.sourceBuffers.push(buffer);
        return buffer;
      }
    });
    window.MediaSource.isTypeSupported = function(mime) {
      return true;
    };
    window.WebKitMediaSource = window.MediaSource;
  },
  afterEach() {
    this.clock.restore();
    this.player.dispose();
    window.MediaSource = this.oldMediaSource;
    window.WebKitMediaSource = window.MediaSource;
  }
});

const createDataMessage = function(type, typedArray, extraObject) {
  let message = {
    data: {
      action: 'data',
      segment: {
        type,
        data: typedArray.buffer,
        initSegment: {
          data: typedArray.buffer,
          byteOffset: typedArray.byteOffset,
          byteLength: typedArray.byteLength
        }
      },
      byteOffset: typedArray.byteOffset,
      byteLength: typedArray.byteLength
    }
  };

  return Object.keys(extraObject || {}).reduce(function(obj, key) {
    obj.data.segment[key] = extraObject[key];
    return obj;
  }, message);
};

// Create a WebWorker-style message that signals the transmuxer is done
const doneMessage = {
  data: {
    action: 'done'
  }
};

// send fake data to the transmuxer to trigger the creation of the
// native source buffers
const initializeNativeSourceBuffers = function(sourceBuffer) {
  // initialize an audio source buffer
  sourceBuffer.transmuxer_.onmessage(createDataMessage('audio', new Uint8Array(1)));

  // initialize a video source buffer
  sourceBuffer.transmuxer_.onmessage(createDataMessage('video', new Uint8Array(1)));

  // instruct the transmuxer to flush the "data" it has buffered so
  // far
  sourceBuffer.transmuxer_.onmessage(doneMessage);
};

// TODO move to master-playlist-controller source buffer creation
// do we want to handle this case anymore? it may be better to always try to use what's
// specified
QUnit.todo('handles invalid codec string', function(assert) {
  let mediaSource = new videojs.MediaSource();
  let sourceBuffer =
    mediaSource.addSourceBuffer('video/mp2t; codecs="nope"');

  initializeNativeSourceBuffers(sourceBuffer);

  assert.ok(mediaSource.videoBuffer_, 'created a video buffer');
  assert.strictEqual(
    mediaSource.videoBuffer_.type,
    'video/mp4;codecs="avc1.4d400d"',
    'video buffer has the default codec'
  );

  assert.ok(mediaSource.audioBuffer_, 'created an audio buffer');
  assert.strictEqual(
    mediaSource.audioBuffer_.type,
    'audio/mp4;codecs="mp4a.40.2"',
    'audio buffer has the default codec'
  );
  assert.strictEqual(mediaSource.sourceBuffers.length, 1, 'created one virtual buffer');
  assert.strictEqual(
    mediaSource.sourceBuffers[0],
    sourceBuffer,
    'returned the virtual buffer'
  );
});

// TODO move to master-playlist-controller source buffer creation
QUnit.todo('parses old-school apple codec strings to the modern standard',
function(assert) {
  let mediaSource = new videojs.MediaSource();
  let sourceBuffer =
    mediaSource.addSourceBuffer('video/mp2t; codecs="avc1.100.31,mp4a.40.5"');

  initializeNativeSourceBuffers(sourceBuffer);

  assert.ok(mediaSource.videoBuffer_, 'created a video buffer');
  assert.strictEqual(mediaSource.videoBuffer_.type,
              'video/mp4;codecs="avc1.64001f"',
              'passed the video codec along');

  assert.ok(mediaSource.audioBuffer_, 'created a video buffer');
  assert.strictEqual(mediaSource.audioBuffer_.type,
              'audio/mp4;codecs="mp4a.40.5"',
              'passed the audio codec along');

});

// TODO move to segment loader
QUnit.todo('sets transmuxer baseMediaDecodeTime on appends', function(assert) {
  let mediaSource = new window.MediaSource();
  let sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');
  let resets = [];

  sourceBuffer.transmuxer_.postMessage = function(message) {
    if (message.action === 'setTimestampOffset') {
      resets.push(message.timestampOffset);
    }
  };

  sourceBuffer.timestampOffset = 42;

  assert.strictEqual(
    resets.length,
    1,
    'reset called'
  );
  assert.strictEqual(
    resets[0],
    42,
    'set the baseMediaDecodeTime based on timestampOffset'
  );
});
