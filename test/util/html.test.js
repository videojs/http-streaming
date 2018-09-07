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

// TODO move to segment-loader
QUnit.todo(
'only appends audio init segment for first segment or on audio/media changes',
function(assert) {
  let mp4Segments = [];
  let initBuffer = new Uint8Array([0, 1]);
  let dataBuffer = new Uint8Array([2, 3]);
  let mediaSource;
  let sourceBuffer;

  mediaSource = new window.MediaSource();
  sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');
  sourceBuffer.audioDisabled_ = false;
  mediaSource.player_ = this.player;
  mediaSource.url_ = this.url;
  mediaSource.trigger('sourceopen');

  sourceBuffer.concatAndAppendSegments_ = function(segmentObj, destinationBuffer) {
    let segment = segmentObj.segments.reduce((seg, arr) => seg.concat(Array.from(arr)),
      []);

    mp4Segments.push(segment);
  };

  assert.ok(sourceBuffer.appendAudioInitSegment_, 'will append init segment next');

  // an init segment
  sourceBuffer.transmuxer_.onmessage(createDataMessage('audio', dataBuffer, {
    initSegment: {
      data: initBuffer.buffer,
      byteOffset: initBuffer.byteOffset,
      byteLength: initBuffer.byteLength
    }
  }));

  // Segments are concatenated
  assert.strictEqual(
    mp4Segments.length,
    0,
    'segments are not appended until after the `done` message'
  );

  // send `done` message
  sourceBuffer.transmuxer_.onmessage(doneMessage);

  // Segments are concatenated
  assert.strictEqual(mp4Segments.length, 1, 'emitted the fragment');
  // Contains init segment on first segment
  assert.strictEqual(mp4Segments[0][0], 0, 'fragment contains the correct first byte');
  assert.strictEqual(mp4Segments[0][1], 1, 'fragment contains the correct second byte');
  assert.strictEqual(mp4Segments[0][2], 2, 'fragment contains the correct third byte');
  assert.strictEqual(mp4Segments[0][3], 3, 'fragment contains the correct fourth byte');
  assert.ok(!sourceBuffer.appendAudioInitSegment_, 'will not append init segment next');

  dataBuffer = new Uint8Array([4, 5]);
  sourceBuffer.transmuxer_.onmessage(createDataMessage('audio', dataBuffer, {
    initSegment: {
      data: initBuffer.buffer,
      byteOffset: initBuffer.byteOffset,
      byteLength: initBuffer.byteLength
    }
  }));
  sourceBuffer.transmuxer_.onmessage(doneMessage);
  assert.strictEqual(mp4Segments.length, 2, 'emitted the fragment');
  // does not contain init segment on next segment
  assert.strictEqual(mp4Segments[1][0], 4, 'fragment contains the correct first byte');
  assert.strictEqual(mp4Segments[1][1], 5, 'fragment contains the correct second byte');

  // audio track change
  this.player.audioTracks().trigger('change');
  sourceBuffer.audioDisabled_ = false;
  assert.ok(sourceBuffer.appendAudioInitSegment_,
            'audio change sets appendAudioInitSegment_');
  dataBuffer = new Uint8Array([6, 7]);
  sourceBuffer.transmuxer_.onmessage(createDataMessage('audio', dataBuffer, {
    initSegment: {
      data: initBuffer.buffer,
      byteOffset: initBuffer.byteOffset,
      byteLength: initBuffer.byteLength
    }
  }));
  sourceBuffer.transmuxer_.onmessage(doneMessage);
  assert.strictEqual(mp4Segments.length, 3, 'emitted the fragment');
  // contains init segment after audio track change
  assert.strictEqual(mp4Segments[2][0], 0, 'fragment contains the correct first byte');
  assert.strictEqual(mp4Segments[2][1], 1, 'fragment contains the correct second byte');
  assert.strictEqual(mp4Segments[2][2], 6, 'fragment contains the correct third byte');
  assert.strictEqual(mp4Segments[2][3], 7, 'fragment contains the correct fourth byte');
  assert.ok(!sourceBuffer.appendAudioInitSegment_, 'will not append init segment next');

  dataBuffer = new Uint8Array([8, 9]);
  sourceBuffer.transmuxer_.onmessage(createDataMessage('audio', dataBuffer, {
    initSegment: {
      data: initBuffer.buffer,
      byteOffset: initBuffer.byteOffset,
      byteLength: initBuffer.byteLength
    }
  }));
  sourceBuffer.transmuxer_.onmessage(doneMessage);
  assert.strictEqual(mp4Segments.length, 4, 'emitted the fragment');
  // does not contain init segment in next segment
  assert.strictEqual(mp4Segments[3][0], 8, 'fragment contains the correct first byte');
  assert.strictEqual(mp4Segments[3][1], 9, 'fragment contains the correct second byte');
  assert.ok(!sourceBuffer.appendAudioInitSegment_, 'will not append init segment next');

  // rendition switch
  this.player.trigger('mediachange');
  assert.ok(sourceBuffer.appendAudioInitSegment_,
            'media change sets appendAudioInitSegment_');
  dataBuffer = new Uint8Array([10, 11]);
  sourceBuffer.transmuxer_.onmessage(createDataMessage('audio', dataBuffer, {
    initSegment: {
      data: initBuffer.buffer,
      byteOffset: initBuffer.byteOffset,
      byteLength: initBuffer.byteLength
    }
  }));
  sourceBuffer.transmuxer_.onmessage(doneMessage);
  assert.strictEqual(mp4Segments.length, 5, 'emitted the fragment');
  // contains init segment after audio track change
  assert.strictEqual(mp4Segments[4][0], 0, 'fragment contains the correct first byte');
  assert.strictEqual(mp4Segments[4][1], 1, 'fragment contains the correct second byte');
  assert.strictEqual(mp4Segments[4][2], 10, 'fragment contains the correct third byte');
  assert.strictEqual(mp4Segments[4][3], 11, 'fragment contains the correct fourth byte');
  assert.ok(!sourceBuffer.appendAudioInitSegment_, 'will not append init segment next');
});

// TODO move to segment-loader
QUnit.todo(
'appends video init segment for every segment',
function(assert) {
  let mp4Segments = [];
  let initBuffer = new Uint8Array([0, 1]);
  let dataBuffer = new Uint8Array([2, 3]);
  let mediaSource;
  let sourceBuffer;

  mediaSource = new window.MediaSource();
  sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');
  mediaSource.player_ = this.player;
  mediaSource.url_ = this.url;
  mediaSource.trigger('sourceopen');

  sourceBuffer.concatAndAppendSegments_ = function(segmentObj, destinationBuffer) {
    let segment = segmentObj.segments.reduce((seg, arr) => seg.concat(Array.from(arr)),
      []);

    mp4Segments.push(segment);
  };

  // an init segment
  sourceBuffer.transmuxer_.onmessage(createDataMessage('video', dataBuffer, {
    initSegment: {
      data: initBuffer.buffer,
      byteOffset: initBuffer.byteOffset,
      byteLength: initBuffer.byteLength
    }
  }));

  // Segments are concatenated
  assert.strictEqual(
    mp4Segments.length,
    0,
    'segments are not appended until after the `done` message'
  );

  // send `done` message
  sourceBuffer.transmuxer_.onmessage(doneMessage);

  // Segments are concatenated
  assert.strictEqual(mp4Segments.length, 1, 'emitted the fragment');
  // Contains init segment on first segment
  assert.strictEqual(mp4Segments[0][0], 0, 'fragment contains the correct first byte');
  assert.strictEqual(mp4Segments[0][1], 1, 'fragment contains the correct second byte');
  assert.strictEqual(mp4Segments[0][2], 2, 'fragment contains the correct third byte');
  assert.strictEqual(mp4Segments[0][3], 3, 'fragment contains the correct fourth byte');

  dataBuffer = new Uint8Array([4, 5]);
  sourceBuffer.transmuxer_.onmessage(createDataMessage('video', dataBuffer, {
    initSegment: {
      data: initBuffer.buffer,
      byteOffset: initBuffer.byteOffset,
      byteLength: initBuffer.byteLength
    }
  }));
  sourceBuffer.transmuxer_.onmessage(doneMessage);
  assert.strictEqual(mp4Segments.length, 2, 'emitted the fragment');
  assert.strictEqual(mp4Segments[1][0], 0, 'fragment contains the correct first byte');
  assert.strictEqual(mp4Segments[1][1], 1, 'fragment contains the correct second byte');
  assert.strictEqual(mp4Segments[1][2], 4, 'fragment contains the correct third byte');
  assert.strictEqual(mp4Segments[1][3], 5, 'fragment contains the correct fourth byte');

  dataBuffer = new Uint8Array([6, 7]);
  sourceBuffer.transmuxer_.onmessage(createDataMessage('video', dataBuffer, {
    initSegment: {
      data: initBuffer.buffer,
      byteOffset: initBuffer.byteOffset,
      byteLength: initBuffer.byteLength
    }
  }));
  sourceBuffer.transmuxer_.onmessage(doneMessage);
  assert.strictEqual(mp4Segments.length, 3, 'emitted the fragment');
  // contains init segment after audio track change
  assert.strictEqual(mp4Segments[2][0], 0, 'fragment contains the correct first byte');
  assert.strictEqual(mp4Segments[2][1], 1, 'fragment contains the correct second byte');
  assert.strictEqual(mp4Segments[2][2], 6, 'fragment contains the correct third byte');
  assert.strictEqual(mp4Segments[2][3], 7, 'fragment contains the correct fourth byte');
});

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
