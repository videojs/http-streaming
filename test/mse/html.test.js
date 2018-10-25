import document from 'global/document';
import window from 'global/window';
import QUnit from 'qunit';
import sinon from 'sinon';
import videojs from 'video.js';
import HtmlMediaSource from '../../src/mse/html-media-source';

// we disable this because browserify needs to include these files
// but the exports are not important
/* eslint-disable no-unused-vars */
import {MediaSource, URL} from '../../src/mse/index';
/* eslint-disable no-unused-vars */

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
        const buffer = new (videojs.extend(videojs.EventTarget, {
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

QUnit.test('constructs a native MediaSource', function(assert) {
  assert.ok(
    new videojs.MediaSource().nativeMediaSource_.isNative,
    'constructed a MediaSource'
  );
});

const createDataMessage = function(type, typedArray, extraObject) {
  const message = {
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

QUnit.test('creates mp4 source buffers for mp2t segments', function(assert) {
  const mediaSource = new videojs.MediaSource();
  const sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');

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
  assert.ok(sourceBuffer.transmuxer_, 'created a transmuxer');
});

QUnit.test(
  'the terminate is called on the transmuxer when the media source is killed',
  function(assert) {
    const mediaSource = new videojs.MediaSource();
    const sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');
    let terminates = 0;

    sourceBuffer.transmuxer_ = {
      terminate() {
        terminates++;
      }
    };

    mediaSource.trigger('sourceclose');

    assert.strictEqual(terminates, 1, 'called terminate on transmux web worker');
  }
);

QUnit.test('duration is faked when playing a live stream', function(assert) {
  const mediaSource = new videojs.MediaSource();
  const sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');

  mediaSource.duration = Infinity;
  mediaSource.nativeMediaSource_.duration = 100;
  assert.strictEqual(
    mediaSource.nativeMediaSource_.duration, 100,
    'native duration was not set to infinity'
  );
  assert.strictEqual(
    mediaSource.duration, Infinity,
    'the MediaSource wrapper pretends it has an infinite duration'
  );
});

QUnit.test('duration uses the underlying MediaSource\'s duration when not live', function(assert) {
  const mediaSource = new videojs.MediaSource();
  const sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');

  mediaSource.duration = 100;
  mediaSource.nativeMediaSource_.duration = 120;
  assert.strictEqual(
    mediaSource.duration, 120,
    'the MediaSource wrapper returns the native duration'
  );
});

QUnit.test('abort on the fake source buffer calls abort on the real ones', function(assert) {
  const mediaSource = new videojs.MediaSource();
  const sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');
  const messages = [];
  let aborts = 0;

  initializeNativeSourceBuffers(sourceBuffer);

  sourceBuffer.transmuxer_.postMessage = function(message) {
    messages.push(message);
  };
  sourceBuffer.bufferUpdating_ = true;
  sourceBuffer.videoBuffer_.abort = function() {
    aborts++;
  };
  sourceBuffer.audioBuffer_.abort = function() {
    aborts++;
  };

  sourceBuffer.abort();

  assert.strictEqual(aborts, 2, 'called abort on both');
  assert.strictEqual(
    sourceBuffer.bufferUpdating_,
    false,
    'set updating to false'
  );
  assert.strictEqual(messages.length, 1, 'has one message');
  assert.strictEqual(messages[0].action, 'reset', 'reset called on transmuxer');
});

QUnit.test(
  'calling remove deletes cues and invokes remove on any extant source buffers',
  function(assert) {
    const mediaSource = new videojs.MediaSource();
    const sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');
    const removedCue = [];
    let removes = 0;

    initializeNativeSourceBuffers(sourceBuffer);

    sourceBuffer.inbandTextTracks_ = {
      CC1: {
        removeCue(cue) {
          removedCue.push(cue);
          this.cues.splice(this.cues.indexOf(cue), 1);
        },
        cues: [
          {startTime: 10, endTime: 20, text: 'delete me'},
          {startTime: 0, endTime: 2, text: 'save me'}
        ]
      }
    };
    mediaSource.videoBuffer_.remove = function(start, end) {
      if (start === 3 && end === 10) {
        removes++;
      }
    };
    mediaSource.audioBuffer_.remove = function(start, end) {
      if (start === 3 && end === 10) {
        removes++;
      }
    };

    sourceBuffer.remove(3, 10);

    assert.strictEqual(removes, 2, 'called remove on both sourceBuffers');
    assert.strictEqual(
      sourceBuffer.inbandTextTracks_.CC1.cues.length,
      1,
      'one cue remains after remove'
    );
    assert.strictEqual(
      removedCue[0].text,
      'delete me',
      'the cue that overlapped the remove region was removed'
    );
  }
);

QUnit.test(
  'calling remove property handles absence of cues (null)',
  function(assert) {
    const mediaSource = new videojs.MediaSource();
    const sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');

    initializeNativeSourceBuffers(sourceBuffer);

    sourceBuffer.inbandTextTracks_ = {
      CC1: {
        cues: null
      }
    };

    mediaSource.videoBuffer_.remove = function(start, end) {
    // pass
    };
    mediaSource.audioBuffer_.remove = function(start, end) {
    // pass
    };

    // this call should not raise an exception
    sourceBuffer.remove(3, 10);

    assert.strictEqual(
      sourceBuffer.inbandTextTracks_.CC1.cues,
      null,
      'cues are still null'
    );
  }
);

QUnit.test('removing doesn\'t happen with audio disabled', function(assert) {
  const mediaSource = new videojs.MediaSource();
  const muxedBuffer = mediaSource.addSourceBuffer('video/mp2t');
  // creating this audio buffer disables audio in the muxed one
  const audioBuffer = mediaSource.addSourceBuffer('audio/mp2t; codecs="mp4a.40.2"');
  const removedCue = [];
  let removes = 0;

  initializeNativeSourceBuffers(muxedBuffer);

  muxedBuffer.inbandTextTracks_ = {
    CC1: {
      removeCue(cue) {
        removedCue.push(cue);
        this.cues.splice(this.cues.indexOf(cue), 1);
      },
      cues: [
        {startTime: 10, endTime: 20, text: 'delete me'},
        {startTime: 0, endTime: 2, text: 'save me'}
      ]
    }
  };
  mediaSource.videoBuffer_.remove = function(start, end) {
    if (start === 3 && end === 10) {
      removes++;
    }
  };
  mediaSource.audioBuffer_.remove = function(start, end) {
    if (start === 3 && end === 10) {
      removes++;
    }
  };

  muxedBuffer.remove(3, 10);

  assert.strictEqual(removes, 1, 'called remove on only one source buffer');
  assert.strictEqual(
    muxedBuffer.inbandTextTracks_.CC1.cues.length,
    1,
    'one cue remains after remove'
  );
  assert.strictEqual(
    removedCue[0].text,
    'delete me',
    'the cue that overlapped the remove region was removed'
  );
});

QUnit.test('readyState delegates to the native implementation', function(assert) {
  const mediaSource = new HtmlMediaSource();

  assert.strictEqual(
    mediaSource.readyState,
    mediaSource.nativeMediaSource_.readyState,
    'readyStates are equal'
  );

  mediaSource.nativeMediaSource_.readyState = 'nonsense stuff';
  assert.strictEqual(
    mediaSource.readyState,
    mediaSource.nativeMediaSource_.readyState,
    'readyStates are equal'
  );
});

QUnit.test('addSeekableRange_ throws an error for media with known duration', function(assert) {
  const mediaSource = new videojs.MediaSource();

  mediaSource.duration = 100;
  assert.throws(function() {
    mediaSource.addSeekableRange_(0, 100);
  }, 'cannot add seekable range');
});

QUnit.test('addSeekableRange_ adds to the native MediaSource duration', function(assert) {
  const mediaSource = new videojs.MediaSource();

  mediaSource.duration = Infinity;
  mediaSource.addSeekableRange_(120, 240);
  assert.strictEqual(mediaSource.nativeMediaSource_.duration, 240, 'set native duration');
  assert.strictEqual(mediaSource.duration, Infinity, 'emulated duration');

  mediaSource.addSeekableRange_(120, 220);
  assert.strictEqual(mediaSource.nativeMediaSource_.duration, 240, 'ignored the smaller range');
  assert.strictEqual(mediaSource.duration, Infinity, 'emulated duration');
});

QUnit.test('appendBuffer error triggers on the player', function(assert) {
  const mediaSource = new videojs.MediaSource();
  const sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');
  let error = false;

  mediaSource.player_ = this.player;

  initializeNativeSourceBuffers(sourceBuffer);

  sourceBuffer.videoBuffer_.appendBuffer = () => {
    throw new Error();
  };

  this.player.on('error', () => {
    error = true;
  });

  // send fake data to the source buffer from the transmuxer to append to native buffer
  // initializeNativeSourceBuffers does the same thing to trigger the creation of
  // native source buffers.
  const fakeTransmuxerMessage = initializeNativeSourceBuffers;

  fakeTransmuxerMessage(sourceBuffer);

  this.clock.tick(1);

  assert.ok(error, 'error triggered on player');
});

QUnit.test('transmuxes mp2t segments', function(assert) {
  const mp2tSegments = [];
  const mp4Segments = [];
  const data = new Uint8Array(1);

  const mediaSource = new videojs.MediaSource();
  const sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');

  sourceBuffer.transmuxer_.postMessage = function(segment) {
    if (segment.action === 'push') {
      const buffer = new Uint8Array(segment.data, segment.byteOffset, segment.byteLength);

      mp2tSegments.push(buffer);
    }
  };

  sourceBuffer.concatAndAppendSegments_ = function(segmentObj, destinationBuffer) {
    mp4Segments.push(segmentObj);
  };

  sourceBuffer.appendBuffer(data);
  assert.strictEqual(mp2tSegments.length, 1, 'transmuxed one segment');
  assert.strictEqual(mp2tSegments[0].length, 1, 'did not alter the segment');
  assert.strictEqual(mp2tSegments[0][0], data[0], 'did not alter the segment');

  // an init segment
  sourceBuffer.transmuxer_.onmessage(createDataMessage('video', new Uint8Array(1)));

  // a media segment
  sourceBuffer.transmuxer_.onmessage(createDataMessage('audio', new Uint8Array(1)));

  // Segments are concatenated
  assert.strictEqual(
    mp4Segments.length,
    0,
    'segments are not appended until after the `done` message'
  );

  // send `done` message
  sourceBuffer.transmuxer_.onmessage(doneMessage);

  // Segments are concatenated
  assert.strictEqual(mp4Segments.length, 2, 'appended the segments');
});

QUnit.test(
  'handles typed-arrays that are subsets of their underlying buffer',
  function(assert) {
    const mp2tSegments = [];
    const mp4Segments = [];
    const dataBuffer = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const data = dataBuffer.subarray(5, 7);

    const mediaSource = new videojs.MediaSource();
    const sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');

    sourceBuffer.transmuxer_.postMessage = function(segment) {
      if (segment.action === 'push') {
        const buffer = new Uint8Array(segment.data, segment.byteOffset, segment.byteLength);

        mp2tSegments.push(buffer);
      }
    };

    sourceBuffer.concatAndAppendSegments_ = function(segmentObj, destinationBuffer) {
      mp4Segments.push(segmentObj.segments[0]);
    };

    sourceBuffer.appendBuffer(data);

    assert.strictEqual(mp2tSegments.length, 1, 'emitted the fragment');
    assert.strictEqual(
      mp2tSegments[0].length,
      2,
      'correctly handled a typed-array that is a subset'
    );
    assert.strictEqual(mp2tSegments[0][0], 5, 'fragment contains the correct first byte');
    assert.strictEqual(mp2tSegments[0][1], 6, 'fragment contains the correct second byte');

    // an init segment
    sourceBuffer.transmuxer_.onmessage(createDataMessage('video', data));

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
    assert.strictEqual(
      mp4Segments[0].length,
      2,
      'correctly handled a typed-array that is a subset'
    );
    assert.strictEqual(mp4Segments[0][0], 5, 'fragment contains the correct first byte');
    assert.strictEqual(mp4Segments[0][1], 6, 'fragment contains the correct second byte');
  }
);

QUnit.test(
  'only appends audio init segment for first segment or on audio/media changes',
  function(assert) {
    const mp4Segments = [];
    const initBuffer = new Uint8Array([0, 1]);
    let dataBuffer = new Uint8Array([2, 3]);

    const mediaSource = new videojs.MediaSource();
    const sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');

    sourceBuffer.audioDisabled_ = false;
    mediaSource.player_ = this.player;
    mediaSource.url_ = this.url;
    mediaSource.trigger('sourceopen');

    sourceBuffer.concatAndAppendSegments_ = function(segmentObj, destinationBuffer) {
      const segment = segmentObj.segments.reduce(
        (seg, arr) => seg.concat(Array.from(arr)),
        []
      );

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
    assert.ok(sourceBuffer.appendAudioInitSegment_, 'audio change sets appendAudioInitSegment_');
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
    assert.ok(sourceBuffer.appendAudioInitSegment_, 'media change sets appendAudioInitSegment_');
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
  }
);

QUnit.test(
  'appends video init segment for every segment',
  function(assert) {
    const mp4Segments = [];
    const initBuffer = new Uint8Array([0, 1]);
    let dataBuffer = new Uint8Array([2, 3]);

    const mediaSource = new videojs.MediaSource();
    const sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');

    mediaSource.player_ = this.player;
    mediaSource.url_ = this.url;
    mediaSource.trigger('sourceopen');

    sourceBuffer.concatAndAppendSegments_ = function(segmentObj, destinationBuffer) {
      const segment = segmentObj.segments.reduce(
        (seg, arr) => seg.concat(Array.from(arr)),
        []
      );

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
  }
);

QUnit.test('handles empty codec string value', function(assert) {
  const mediaSource = new videojs.MediaSource();
  const sourceBuffer =
    mediaSource.addSourceBuffer('video/mp2t; codecs=""');

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

QUnit.test('can create an audio buffer by itself', function(assert) {
  const mediaSource = new videojs.MediaSource();
  const sourceBuffer =
    mediaSource.addSourceBuffer('video/mp2t; codecs="mp4a.40.2"');

  initializeNativeSourceBuffers(sourceBuffer);

  assert.ok(!mediaSource.videoBuffer_, 'did not create a video buffer');
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

QUnit.test('can create an video buffer by itself', function(assert) {
  const mediaSource = new videojs.MediaSource();
  const sourceBuffer =
    mediaSource.addSourceBuffer('video/mp2t; codecs="avc1.4d400d"');

  initializeNativeSourceBuffers(sourceBuffer);

  assert.ok(!mediaSource.audioBuffer_, 'did not create an audio buffer');
  assert.ok(mediaSource.videoBuffer_, 'created an video buffer');
  assert.strictEqual(
    mediaSource.videoBuffer_.type,
    'video/mp4;codecs="avc1.4d400d"',
    'video buffer has the codec that was passed'
  );
  assert.strictEqual(mediaSource.sourceBuffers.length, 1, 'created one virtual buffer');
  assert.strictEqual(
    mediaSource.sourceBuffers[0],
    sourceBuffer,
    'returned the virtual buffer'
  );
});

QUnit.test('handles invalid codec string', function(assert) {
  const mediaSource = new videojs.MediaSource();
  const sourceBuffer =
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

QUnit.test('handles codec strings in reverse order', function(assert) {
  const mediaSource = new videojs.MediaSource();
  const sourceBuffer =
    mediaSource.addSourceBuffer('video/mp2t; codecs="mp4a.40.5,avc1.64001f"');

  initializeNativeSourceBuffers(sourceBuffer);

  assert.ok(mediaSource.videoBuffer_, 'created a video buffer');

  assert.strictEqual(
    mediaSource.videoBuffer_.type,
    'video/mp4;codecs="avc1.64001f"',
    'video buffer has the passed codec'
  );

  assert.ok(mediaSource.audioBuffer_, 'created an audio buffer');
  assert.strictEqual(
    mediaSource.audioBuffer_.type,
    'audio/mp4;codecs="mp4a.40.5"',
    'audio buffer has the passed codec'
  );
  assert.strictEqual(mediaSource.sourceBuffers.length, 1, 'created one virtual buffer');
  assert.strictEqual(
    mediaSource.sourceBuffers[0],
    sourceBuffer,
    'returned the virtual buffer'
  );
  assert.ok(sourceBuffer.transmuxer_, 'created a transmuxer');
});

QUnit.test('forwards codec strings to native buffers when specified', function(assert) {
  const mediaSource = new videojs.MediaSource();
  const sourceBuffer =
    mediaSource.addSourceBuffer('video/mp2t; codecs="avc1.64001f,mp4a.40.5"');

  initializeNativeSourceBuffers(sourceBuffer);

  assert.ok(mediaSource.videoBuffer_, 'created a video buffer');
  assert.strictEqual(
    mediaSource.videoBuffer_.type,
    'video/mp4;codecs="avc1.64001f"',
    'passed the video codec along'
  );

  assert.ok(mediaSource.audioBuffer_, 'created a video buffer');
  assert.strictEqual(
    mediaSource.audioBuffer_.type,
    'audio/mp4;codecs="mp4a.40.5"',
    'passed the audio codec along'
  );
});

QUnit.test('parses old-school apple codec strings to the modern standard', function(assert) {
  const mediaSource = new videojs.MediaSource();
  const sourceBuffer =
    mediaSource.addSourceBuffer('video/mp2t; codecs="avc1.100.31,mp4a.40.5"');

  initializeNativeSourceBuffers(sourceBuffer);

  assert.ok(mediaSource.videoBuffer_, 'created a video buffer');
  assert.strictEqual(
    mediaSource.videoBuffer_.type,
    'video/mp4;codecs="avc1.64001f"',
    'passed the video codec along'
  );

  assert.ok(mediaSource.audioBuffer_, 'created a video buffer');
  assert.strictEqual(
    mediaSource.audioBuffer_.type,
    'audio/mp4;codecs="mp4a.40.5"',
    'passed the audio codec along'
  );

});

QUnit.test('specifies reasonable codecs if none are specified', function(assert) {
  const mediaSource = new videojs.MediaSource();
  const sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');

  initializeNativeSourceBuffers(sourceBuffer);

  assert.ok(mediaSource.videoBuffer_, 'created a video buffer');
  assert.strictEqual(
    mediaSource.videoBuffer_.type,
    'video/mp4;codecs="avc1.4d400d"',
    'passed the video codec along'
  );

  assert.ok(mediaSource.audioBuffer_, 'created a video buffer');
  assert.strictEqual(
    mediaSource.audioBuffer_.type,
    'audio/mp4;codecs="mp4a.40.2"',
    'passed the audio codec along'
  );
});

QUnit.test('virtual buffers are updating if either native buffer is', function(assert) {
  const mediaSource = new videojs.MediaSource();
  const sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');

  initializeNativeSourceBuffers(sourceBuffer);

  mediaSource.videoBuffer_.updating = true;
  mediaSource.audioBuffer_.updating = false;
  assert.strictEqual(sourceBuffer.updating, true, 'virtual buffer is updating');

  mediaSource.audioBuffer_.updating = true;
  assert.strictEqual(sourceBuffer.updating, true, 'virtual buffer is updating');

  mediaSource.videoBuffer_.updating = false;
  assert.strictEqual(sourceBuffer.updating, true, 'virtual buffer is updating');

  mediaSource.audioBuffer_.updating = false;
  assert.strictEqual(sourceBuffer.updating, false, 'virtual buffer is not updating');
});

QUnit.test(
  'virtual buffers have a position buffered if both native buffers do',
  function(assert) {
    const mediaSource = new videojs.MediaSource();
    const sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');

    initializeNativeSourceBuffers(sourceBuffer);

    mediaSource.videoBuffer_.buffered = videojs.createTimeRanges([
      [0, 10],
      [20, 30]
    ]);
    mediaSource.audioBuffer_.buffered = videojs.createTimeRanges([
      [0, 7],
      [11, 15],
      [16, 40]
    ]);

    assert.strictEqual(sourceBuffer.buffered.length, 2, 'two buffered ranges');
    assert.strictEqual(sourceBuffer.buffered.start(0), 0, 'first starts at zero');
    assert.strictEqual(sourceBuffer.buffered.end(0), 7, 'first ends at seven');
    assert.strictEqual(sourceBuffer.buffered.start(1), 20, 'second starts at twenty');
    assert.strictEqual(sourceBuffer.buffered.end(1), 30, 'second ends at 30');
  }
);

QUnit.test('disabled audio does not affect buffered property', function(assert) {
  const mediaSource = new videojs.MediaSource();
  const muxedBuffer = mediaSource.addSourceBuffer('video/mp2t');
  // creating a separate audio buffer disables audio on the muxed one
  const audioBuffer = mediaSource.addSourceBuffer('audio/mp2t; codecs="mp4a.40.2"');

  initializeNativeSourceBuffers(muxedBuffer);

  mediaSource.videoBuffer_.buffered = videojs.createTimeRanges([[1, 10]]);
  mediaSource.audioBuffer_.buffered = videojs.createTimeRanges([[2, 11]]);

  assert.strictEqual(audioBuffer.buffered.length, 1, 'one buffered range');
  assert.strictEqual(audioBuffer.buffered.start(0), 2, 'starts at two');
  assert.strictEqual(audioBuffer.buffered.end(0), 11, 'ends at eleven');
  assert.strictEqual(muxedBuffer.buffered.length, 1, 'one buffered range');
  assert.strictEqual(muxedBuffer.buffered.start(0), 1, 'starts at one');
  assert.strictEqual(muxedBuffer.buffered.end(0), 10, 'ends at ten');
});

QUnit.test('sets transmuxer baseMediaDecodeTime on appends', function(assert) {
  const mediaSource = new videojs.MediaSource();
  const sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');
  const resets = [];

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

QUnit.test('aggregates source buffer update events', function(assert) {
  const mediaSource = new videojs.MediaSource();
  const sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');
  let updates = 0;
  let updateends = 0;
  let updatestarts = 0;

  initializeNativeSourceBuffers(sourceBuffer);

  mediaSource.player_ = this.player;

  sourceBuffer.addEventListener('updatestart', function() {
    updatestarts++;
  });
  sourceBuffer.addEventListener('update', function() {
    updates++;
  });
  sourceBuffer.addEventListener('updateend', function() {
    updateends++;
  });

  assert.strictEqual(updatestarts, 0, 'no updatestarts before a `done` message is received');
  assert.strictEqual(updates, 0, 'no updates before a `done` message is received');
  assert.strictEqual(updateends, 0, 'no updateends before a `done` message is received');

  // the video buffer begins updating first:
  sourceBuffer.videoBuffer_.updating = true;
  sourceBuffer.audioBuffer_.updating = false;
  sourceBuffer.videoBuffer_.trigger('updatestart');
  assert.strictEqual(updatestarts, 1, 'aggregated updatestart');
  sourceBuffer.audioBuffer_.updating = true;
  sourceBuffer.audioBuffer_.trigger('updatestart');
  assert.strictEqual(updatestarts, 1, 'aggregated updatestart');

  // the audio buffer finishes first:
  sourceBuffer.audioBuffer_.updating = false;
  sourceBuffer.videoBuffer_.updating = true;
  sourceBuffer.audioBuffer_.trigger('update');
  assert.strictEqual(updates, 0, 'waited for the second update');
  sourceBuffer.videoBuffer_.updating = false;
  sourceBuffer.videoBuffer_.trigger('update');
  assert.strictEqual(updates, 1, 'aggregated update');

  // audio finishes first:
  sourceBuffer.videoBuffer_.updating = true;
  sourceBuffer.audioBuffer_.updating = false;
  sourceBuffer.audioBuffer_.trigger('updateend');
  assert.strictEqual(updateends, 0, 'waited for the second updateend');
  sourceBuffer.videoBuffer_.updating = false;
  sourceBuffer.videoBuffer_.trigger('updateend');
  assert.strictEqual(updateends, 1, 'aggregated updateend');
});

QUnit.test('translates caption events into WebVTT cues', function(assert) {
  const mediaSource = new videojs.MediaSource();
  const sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');
  const types = [];
  let hls608 = 0;

  mediaSource.player_ = {
    addRemoteTextTrack(options) {
      types.push(options.kind);
      return {
        track: {
          kind: options.kind,
          label: options.label,
          cues: [],
          addCue(cue) {
            this.cues.push(cue);
          }
        }
      };
    },
    textTracks() {
      return {
        getTrackById() {}
      };
    },
    remoteTextTracks() {
    },
    tech_: new videojs.EventTarget()
  };
  mediaSource.player_.tech_.on('usage', (event) => {
    if (event.name === 'hls-608') {
      hls608++;
    }
  });
  sourceBuffer.timestampOffset = 10;
  sourceBuffer.transmuxer_.onmessage(createDataMessage('video', new Uint8Array(1), {
    captions: [{
      startTime: 1,
      endTime: 3,
      text: 'This is an in-band caption in CC1',
      stream: 'CC1'
    }],
    captionStreams: {CC1: true}
  }));
  sourceBuffer.transmuxer_.onmessage(doneMessage);
  const cues = sourceBuffer.inbandTextTracks_.CC1.cues;

  assert.strictEqual(hls608, 1, 'one hls-608 event was triggered');
  assert.strictEqual(types.length, 1, 'created one text track');
  assert.strictEqual(types[0], 'captions', 'the type was captions');
  assert.strictEqual(cues.length, 1, 'created one cue');
  assert.strictEqual(cues[0].text, 'This is an in-band caption in CC1', 'included the text');
  assert.strictEqual(cues[0].startTime, 11, 'started at eleven');
  assert.strictEqual(cues[0].endTime, 13, 'ended at thirteen');
});

QUnit.test('captions use existing tracks with id equal to CC#', function(assert) {
  const mediaSource = new videojs.MediaSource();
  const sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');
  let addTrackCalled = 0;
  const tracks = {
    CC1: {
      kind: 'captions',
      label: 'CC1',
      id: 'CC1',
      cues: [],
      addCue(cue) {
        this.cues.push(cue);
      }
    },
    CC2: {
      kind: 'captions',
      label: 'CC2',
      id: 'CC2',
      cues: [],
      addCue(cue) {
        this.cues.push(cue);
      }
    }
  };

  mediaSource.player_ = {
    addRemoteTextTrack(options) {
      addTrackCalled++;
    },
    textTracks() {
      return {
        getTrackById(id) {
          return tracks[id];
        }
      };
    },
    remoteTextTracks() {
    },
    tech_: new videojs.EventTarget()
  };
  sourceBuffer.timestampOffset = 10;
  sourceBuffer.transmuxer_.onmessage(createDataMessage('video', new Uint8Array(1), {
    captions: [{
      stream: 'CC1',
      startTime: 1,
      endTime: 3,
      text: 'This is an in-band caption in CC1'
    }, {
      stream: 'CC2',
      startTime: 1,
      endTime: 3,
      text: 'This is an in-band caption in CC2'
    }],
    captionStreams: {CC1: true, CC2: true}
  }));

  sourceBuffer.transmuxer_.onmessage(doneMessage);
  const cues = sourceBuffer.inbandTextTracks_.CC1.cues;

  assert.strictEqual(addTrackCalled, 0, 'no tracks were created');
  assert.strictEqual(tracks.CC1.cues.length, 1, 'CC1 contains 1 cue');
  assert.strictEqual(tracks.CC2.cues.length, 1, 'CC2 contains 1 cue');

  assert.strictEqual(tracks.CC1.cues[0].text, 'This is an in-band caption in CC1', 'CC1 contains the right cue');
  assert.strictEqual(tracks.CC2.cues[0].text, 'This is an in-band caption in CC2', 'CC2 contains the right cue');
});

QUnit.test('translates metadata events into WebVTT cues', function(assert) {
  const mediaSource = new videojs.MediaSource();
  const sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');

  mediaSource.duration = Infinity;
  mediaSource.nativeMediaSource_.duration = 60;

  const types = [];
  const metadata = [{
    cueTime: 2,
    frames: [{
      url: 'This is a url tag'
    }, {
      value: 'This is a text tag'
    }]
  }, {
    cueTime: 12,
    frames: [{
      data: 'This is a priv tag'
    }]
  }];

  metadata.dispatchType = 0x10;
  mediaSource.player_ = {
    addRemoteTextTrack(options) {
      types.push(options.kind);
      return {
        track: {
          kind: options.kind,
          label: options.label,
          cues: [],
          addCue(cue) {
            this.cues.push(cue);
          }
        }
      };
    },
    remoteTextTracks() {
    }
  };
  sourceBuffer.timestampOffset = 10;

  sourceBuffer.transmuxer_.onmessage(createDataMessage('video', new Uint8Array(1), {
    metadata
  }));
  sourceBuffer.transmuxer_.onmessage(doneMessage);

  assert.strictEqual(
    sourceBuffer.metadataTrack_.inBandMetadataTrackDispatchType,
    16,
    'in-band metadata track dispatch type correctly set'
  );
  const cues = sourceBuffer.metadataTrack_.cues;

  assert.strictEqual(types.length, 1, 'created one text track');
  assert.strictEqual(types[0], 'metadata', 'the type was metadata');
  assert.strictEqual(cues.length, 3, 'created three cues');
  assert.strictEqual(cues[0].text, 'This is a url tag', 'included the text');
  assert.strictEqual(cues[0].startTime, 12, 'started at twelve');
  assert.strictEqual(cues[0].endTime, 22, 'ended at StartTime of next cue(22)');
  assert.strictEqual(cues[1].text, 'This is a text tag', 'included the text');
  assert.strictEqual(cues[1].startTime, 12, 'started at twelve');
  assert.strictEqual(cues[1].endTime, 22, 'ended at the startTime of next cue(22)');
  assert.strictEqual(cues[2].text, 'This is a priv tag', 'included the text');
  assert.strictEqual(cues[2].startTime, 22, 'started at twenty two');
  assert.strictEqual(cues[2].endTime, Number.MAX_VALUE, 'ended at the maximum value');
  mediaSource.duration = 100;
  mediaSource.trigger('sourceended');
  assert.strictEqual(cues[2].endTime, mediaSource.duration, 'sourceended is fired');
});

QUnit.test('does not wrap mp4 source buffers', function(assert) {
  const mediaSource = new videojs.MediaSource();

  mediaSource.addSourceBuffer('video/mp4;codecs=avc1.4d400d');
  mediaSource.addSourceBuffer('audio/mp4;codecs=mp4a.40.2');
  assert.strictEqual(
    mediaSource.sourceBuffers.length,
    mediaSource.nativeMediaSource_.sourceBuffers.length,
    'did not need virtual buffers'
  );
  assert.strictEqual(mediaSource.sourceBuffers.length, 2, 'created native buffers');
});

QUnit.test('can get activeSourceBuffers', function(assert) {
  const mediaSource = new videojs.MediaSource();

  // although activeSourceBuffers should technically be a SourceBufferList, we are
  // returning it as an array, and users may expect it to behave as such
  assert.ok(Array.isArray(mediaSource.activeSourceBuffers));
});

QUnit.test(
  'active source buffers are updated on each buffer\'s updateend',
  function(assert) {
    const mediaSource = new videojs.MediaSource();
    let updateCallCount = 0;
    let sourceBuffer;

    mediaSource.updateActiveSourceBuffers_ = () => {
      updateCallCount++;
    };

    sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');
    mediaSource.player_ = this.player;
    mediaSource.url_ = this.url;
    mediaSource.trigger('sourceopen');
    assert.strictEqual(
      updateCallCount, 0,
      'active source buffers not updated on adding source buffer'
    );

    mediaSource.player_.audioTracks().trigger('addtrack');
    assert.strictEqual(
      updateCallCount, 1,
      'active source buffers updated after addtrack'
    );

    sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');
    assert.strictEqual(
      updateCallCount, 1,
      'active source buffers not updated on adding second source buffer'
    );

    mediaSource.player_.audioTracks().trigger('removetrack');
    assert.strictEqual(
      updateCallCount, 2,
      'active source buffers updated after removetrack'
    );

    mediaSource.player_.audioTracks().trigger('change');
    assert.strictEqual(
      updateCallCount, 3,
      'active source buffers updated after change'
    );

  }
);

QUnit.test(
  'combined buffer is the only active buffer when main track enabled',
  function(assert) {
    const mediaSource = new videojs.MediaSource();
    const audioTracks = [{
      enabled: true,
      kind: 'main',
      label: 'main'
    }, {
      enabled: false,
      kind: 'alternative',
      label: 'English (UK)'
    }];

    this.player.audioTracks = () => audioTracks;

    mediaSource.player_ = this.player;

    const sourceBufferCombined = mediaSource.addSourceBuffer('video/m2pt');

    sourceBufferCombined.videoCodec_ = true;
    sourceBufferCombined.audioCodec_ = true;
    const sourceBufferAudio = mediaSource.addSourceBuffer('video/m2pt');

    sourceBufferAudio.videoCodec_ = false;
    sourceBufferAudio.audioCodec_ = true;

    mediaSource.updateActiveSourceBuffers_();

    assert.strictEqual(
      mediaSource.activeSourceBuffers.length, 1,
      'active source buffers starts with one source buffer'
    );
    assert.strictEqual(
      mediaSource.activeSourceBuffers[0], sourceBufferCombined,
      'active source buffers starts with combined source buffer'
    );
  }
);

QUnit.test(
  'combined & audio buffers are active when alternative track enabled',
  function(assert) {
    const mediaSource = new videojs.MediaSource();
    const audioTracks = [{
      enabled: false,
      kind: 'main',
      label: 'main'
    }, {
      enabled: true,
      kind: 'alternative',
      label: 'English (UK)'
    }];

    this.player.audioTracks = () => audioTracks;

    mediaSource.player_ = this.player;

    const sourceBufferCombined = mediaSource.addSourceBuffer('video/m2pt');

    sourceBufferCombined.videoCodec_ = true;
    sourceBufferCombined.audioCodec_ = true;
    const sourceBufferAudio = mediaSource.addSourceBuffer('video/m2pt');

    sourceBufferAudio.videoCodec_ = false;
    sourceBufferAudio.audioCodec_ = true;

    mediaSource.updateActiveSourceBuffers_();

    assert.strictEqual(
      mediaSource.activeSourceBuffers.length, 2,
      'active source buffers includes both source buffers'
    );
    // maintains same order as source buffers were created
    assert.strictEqual(
      mediaSource.activeSourceBuffers[0], sourceBufferCombined,
      'active source buffers starts with combined source buffer'
    );
    assert.strictEqual(
      mediaSource.activeSourceBuffers[1], sourceBufferAudio,
      'active source buffers ends with audio source buffer'
    );
  }
);

QUnit.test('main buffer is the only active buffer when combined is audio only and' +
'main track enabled', function(assert) {
  const mediaSource = new videojs.MediaSource();
  const audioTracks = [{
    enabled: true,
    kind: 'main',
    label: 'main'
  }, {
    enabled: false,
    kind: 'alternative',
    label: 'English'
  }];

  this.player.audioTracks = () => audioTracks;

  mediaSource.player_ = this.player;

  const sourceBufferCombined = mediaSource.addSourceBuffer('audio/m2pt');

  sourceBufferCombined.videoCodec_ = false;
  sourceBufferCombined.audioCodec_ = true;

  const sourceBufferAudio = mediaSource.addSourceBuffer('audio/m2pt');

  sourceBufferAudio.videoCodec_ = false;
  sourceBufferAudio.audioCodec_ = true;

  mediaSource.updateActiveSourceBuffers_();

  assert.strictEqual(
    mediaSource.activeSourceBuffers.length, 1,
    'active source buffers has only one buffer'
  );
  assert.strictEqual(
    mediaSource.activeSourceBuffers[0], sourceBufferCombined,
    'main buffer is the only active source buffer'
  );
});

QUnit.test('audio buffer is the only active buffer when combined is audio only and' +
'alternative track enabled', function(assert) {
  const mediaSource = new videojs.MediaSource();
  const audioTracks = [{
    enabled: false,
    kind: 'main',
    label: 'main'
  }, {
    enabled: true,
    kind: 'alternative',
    label: 'English'
  }];

  this.player.audioTracks = () => audioTracks;

  mediaSource.player_ = this.player;

  const sourceBufferCombined = mediaSource.addSourceBuffer('audio/m2pt');

  sourceBufferCombined.videoCodec_ = false;
  sourceBufferCombined.audioCodec_ = true;

  const sourceBufferAudio = mediaSource.addSourceBuffer('audio/m2pt');

  sourceBufferAudio.videoCodec_ = false;
  sourceBufferAudio.audioCodec_ = true;

  mediaSource.updateActiveSourceBuffers_();

  assert.strictEqual(
    mediaSource.activeSourceBuffers.length, 1,
    'active source buffers has only one buffer'
  );
  assert.strictEqual(
    mediaSource.activeSourceBuffers[0], sourceBufferAudio,
    'audio buffer is the only active source buffer'
  );
});

QUnit.test(
  'video only & audio only buffers are always active',
  function(assert) {
    const mediaSource = new videojs.MediaSource();
    const audioTracks = [{
      enabled: false,
      kind: 'main',
      label: 'main'
    }, {
      enabled: true,
      kind: 'alternative',
      label: 'English (UK)'
    }];

    this.player.audioTracks = () => audioTracks;

    mediaSource.player_ = this.player;

    const sourceBufferCombined = mediaSource.addSourceBuffer('video/m2pt');

    sourceBufferCombined.videoCodec_ = true;
    sourceBufferCombined.audioCodec_ = false;
    const sourceBufferAudio = mediaSource.addSourceBuffer('video/m2pt');

    sourceBufferAudio.videoCodec_ = false;
    sourceBufferAudio.audioCodec_ = true;

    mediaSource.updateActiveSourceBuffers_();

    assert.strictEqual(
      mediaSource.activeSourceBuffers.length, 2,
      'active source buffers includes both source buffers'
    );
    // maintains same order as source buffers were created
    assert.strictEqual(
      mediaSource.activeSourceBuffers[0], sourceBufferCombined,
      'active source buffers starts with combined source buffer'
    );
    assert.strictEqual(
      mediaSource.activeSourceBuffers[1], sourceBufferAudio,
      'active source buffers ends with audio source buffer'
    );

    audioTracks[0].enabled = true;
    audioTracks[1].enabled = false;
    mediaSource.updateActiveSourceBuffers_();

    assert.strictEqual(
      mediaSource.activeSourceBuffers.length, 2,
      'active source buffers includes both source buffers'
    );
    // maintains same order as source buffers were created
    assert.strictEqual(
      mediaSource.activeSourceBuffers[0], sourceBufferCombined,
      'active source buffers starts with combined source buffer'
    );
    assert.strictEqual(
      mediaSource.activeSourceBuffers[1], sourceBufferAudio,
      'active source buffers ends with audio source buffer'
    );
  }
);

QUnit.test(
  'Single buffer always active. Audio disabled depends on audio codec',
  function(assert) {
    const mediaSource = new videojs.MediaSource();
    const audioTracks = [{
      enabled: true,
      kind: 'main',
      label: 'main'
    }];

    this.player.audioTracks = () => audioTracks;

    mediaSource.player_ = this.player;

    const sourceBuffer = mediaSource.addSourceBuffer('video/m2pt');

    // video only
    sourceBuffer.videoCodec_ = true;
    sourceBuffer.audioCodec_ = false;

    mediaSource.updateActiveSourceBuffers_();

    assert.strictEqual(mediaSource.activeSourceBuffers.length, 1, 'sourceBuffer is active');
    assert.ok(
      mediaSource.activeSourceBuffers[0].audioDisabled_,
      'audio is disabled on video only active sourceBuffer'
    );

    // audio only
    sourceBuffer.videoCodec_ = false;
    sourceBuffer.audioCodec_ = true;

    mediaSource.updateActiveSourceBuffers_();

    assert.strictEqual(mediaSource.activeSourceBuffers.length, 1, 'sourceBuffer is active');
    assert.notOk(
      mediaSource.activeSourceBuffers[0].audioDisabled_,
      'audio not disabled on audio only active sourceBuffer'
    );
  }
);

QUnit.test('video segments with info trigger videooinfo event', function(assert) {
  const data = new Uint8Array(1);
  const infoEvents = [];
  const mediaSource = new videojs.MediaSource();
  const sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');
  const info = {width: 100};
  const newinfo = {width: 225};

  mediaSource.on('videoinfo', (e) => infoEvents.push(e));

  // send an audio segment with info, then send done
  sourceBuffer.transmuxer_.onmessage(createDataMessage('video', data, {info}));
  sourceBuffer.transmuxer_.onmessage(doneMessage);

  assert.strictEqual(infoEvents.length, 1, 'video info should trigger');
  assert.deepEqual(infoEvents[0].info, info, 'video info = muxed info');

  // send an audio segment with info, then send done
  sourceBuffer.transmuxer_.onmessage(createDataMessage('video', data, {info: newinfo}));
  sourceBuffer.transmuxer_.onmessage(doneMessage);

  assert.strictEqual(infoEvents.length, 2, 'video info should trigger');
  assert.deepEqual(infoEvents[1].info, newinfo, 'video info = muxed info');
});

QUnit.test('audio segments with info trigger audioinfo event', function(assert) {
  const data = new Uint8Array(1);
  const infoEvents = [];
  const mediaSource = new videojs.MediaSource();
  const sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');
  const info = {width: 100};
  const newinfo = {width: 225};

  mediaSource.on('audioinfo', (e) => infoEvents.push(e));

  // send an audio segment with info, then send done
  sourceBuffer.transmuxer_.onmessage(createDataMessage('audio', data, {info}));
  sourceBuffer.transmuxer_.onmessage(doneMessage);

  assert.strictEqual(infoEvents.length, 1, 'audio info should trigger');
  assert.deepEqual(infoEvents[0].info, info, 'audio info = muxed info');

  // send an audio segment with info, then send done
  sourceBuffer.transmuxer_.onmessage(createDataMessage('audio', data, {info: newinfo}));
  sourceBuffer.transmuxer_.onmessage(doneMessage);

  assert.strictEqual(infoEvents.length, 2, 'audio info should trigger');
  assert.deepEqual(infoEvents[1].info, newinfo, 'audio info = muxed info');
});

QUnit.test('creates native SourceBuffers immediately if a second ' +
           'VirtualSourceBuffer is created', function(assert) {
  const mediaSource = new videojs.MediaSource();
  const sourceBuffer =
    mediaSource.addSourceBuffer('video/mp2t; codecs="avc1.64001f,mp4a.40.5"');
  const sourceBuffer2 =
    mediaSource.addSourceBuffer('video/mp2t; codecs="mp4a.40.5"');

  assert.ok(mediaSource.videoBuffer_, 'created a video buffer');
  assert.strictEqual(
    mediaSource.videoBuffer_.type,
    'video/mp4;codecs="avc1.64001f"',
    'video buffer has the specified codec'
  );

  assert.ok(mediaSource.audioBuffer_, 'created an audio buffer');
  assert.strictEqual(
    mediaSource.audioBuffer_.type,
    'audio/mp4;codecs="mp4a.40.5"',
    'audio buffer has the specified codec'
  );
  assert.strictEqual(mediaSource.sourceBuffers.length, 2, 'created two virtual buffers');
  assert.strictEqual(
    mediaSource.sourceBuffers[0],
    sourceBuffer,
    'returned the virtual buffer'
  );
  assert.strictEqual(
    mediaSource.sourceBuffers[1],
    sourceBuffer2,
    'returned the virtual buffer'
  );
  assert.strictEqual(
    sourceBuffer.audioDisabled_,
    true,
    'first source buffer\'s audio is automatically disabled'
  );
  assert.ok(
    sourceBuffer2.audioBuffer_,
    'second source buffer has an audio source buffer'
  );
});
