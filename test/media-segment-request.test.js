import QUnit from 'qunit';
import videojs from 'video.js';
import {mediaSegmentRequest, REQUEST_ERRORS} from '../src/media-segment-request';
import xhrFactory from '../src/xhr';
import {
  useFakeEnvironment,
  standardXHRResponse
} from './test-helpers';
import {createTransmuxer as createTransmuxer_} from '../src/segment-transmuxer.js';
import Decrypter from 'worker!../src/decrypter-worker.js';
import {
  aacWithoutId3 as aacWithoutId3Segment,
  aacWithId3 as aacWithId3Segment,
  ac3WithId3 as ac3WithId3Segment,
  ac3WithoutId3 as ac3WithoutId3Segment,
  video as videoSegment,
  audio as audioSegment,
  mp4Audio,
  mp4AudioInit,
  mp4Video,
  mp4VideoInit,
  muxed as muxedSegment,
  webmVideo,
  webmVideoInit
} from 'create-test-data!segments';
// needed for plugin registration
import '../src/videojs-http-streaming';

const sharedHooks = {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.clock = this.env.clock;
    this.requests = this.env.requests;
    this.xhr = xhrFactory();
    this.realDecrypter = new Decrypter();
    this.mockDecrypter = {
      listeners: [],
      postMessage(message) {
        const newMessage = Object.create(message);

        newMessage.decrypted = message.encrypted;
        this.listeners.forEach((fn)=>fn({
          data: newMessage
        }));
      },
      addEventListener(event, listener) {
        this.listeners.push(listener);
      },
      removeEventListener(event, listener) {
        this.listeners = this.listeners.filter((fn)=>fn !== listener);
      }
    };
    this.xhrOptions = {
      timeout: 1000
    };
    this.noop = () => {};

    this.standardXHRResponse = (request, data) => {
      standardXHRResponse(request, data);

      // Because SegmentLoader#fillBuffer_ is now scheduled asynchronously
      // we have to use clock.tick to get the expected side effects of
      // SegmentLoader#handleAppendsDone_
      this.clock.tick(1);
    };

    this.transmuxers = [];
    this.createTransmuxer = () => {
      const transmuxer = createTransmuxer_({
        remux: false,
        keepOriginalTimestamps: true
      });

      this.transmuxers.push(transmuxer);

      return transmuxer;
    };
  },
  afterEach(assert) {
    this.realDecrypter.terminate();
    this.env.restore();

    this.transmuxers.forEach(function(transmuxer) {
      transmuxer.terminate();
    });
  }

};

QUnit.module('Media Segment Request - make it to transmuxer', {
  beforeEach(assert) {
    sharedHooks.beforeEach.call(this, assert);

    this.calls = {};
    this.options = {
      xhr: this.xhr,
      xhrOptions: this.xhrOptions,
      decryptionWorker: this.mockDecrypter,
      segment: {},
      onTransmuxerLog: () => {}
    };

    [
      'progress',
      'trackInfo',
      'timingInfo',
      'id3',
      'captions',
      'data',
      'videoSegmentTimingInfo',
      'audioSegmentTimingInfo'
    ].forEach((name) => {
      this.calls[name] = 0;
      this.options[`${name}Fn`] = () => this.calls[name]++;
    });

  },
  afterEach: sharedHooks.afterEach
});

QUnit.test('ac3 without id3 segments will not make it to the transmuxer', function(assert) {
  const done = assert.async();

  this.options.segment.transmuxer = this.createTransmuxer();
  this.options.segment.resolvedUri = 'foo.ac3';
  this.options.doneFn = () => {
    assert.deepEqual(this.calls, {
      data: 0,
      trackInfo: 1,
      progress: 1,
      timingInfo: 0,
      captions: 0,
      id3: 0,
      videoSegmentTimingInfo: 0,
      audioSegmentTimingInfo: 0
    }, 'calls as expected');
    done();
  };

  mediaSegmentRequest(this.options);

  assert.equal(this.requests[0].uri, 'foo.ac3', 'segment-request');
  this.standardXHRResponse(this.requests[0], ac3WithoutId3Segment());
});

QUnit.test('ac3 with id3 segments will not make it to the transmuxer', function(assert) {
  const done = assert.async();

  this.options.segment.transmuxer = this.createTransmuxer();
  this.options.segment.resolvedUri = 'foo.ac3';
  this.options.doneFn = () => {
    assert.deepEqual(this.calls, {
      data: 0,
      trackInfo: 1,
      progress: 1,
      timingInfo: 0,
      captions: 0,
      id3: 0,
      videoSegmentTimingInfo: 0,
      audioSegmentTimingInfo: 0
    }, 'calls as expected');
    done();
  };

  mediaSegmentRequest(this.options);

  assert.equal(this.requests[0].uri, 'foo.ac3', 'segment-request');
  this.standardXHRResponse(this.requests[0], ac3WithId3Segment());
});

QUnit.test('muxed ts segments will make it to the transmuxer', function(assert) {
  const done = assert.async();

  this.options.segment.transmuxer = this.createTransmuxer();
  this.options.segment.resolvedUri = 'foo.ts';
  this.options.doneFn = () => {
    assert.deepEqual(this.calls, {
      data: 2,
      trackInfo: 1,
      progress: 1,
      timingInfo: 4,
      captions: 0,
      id3: 0,
      videoSegmentTimingInfo: 1,
      audioSegmentTimingInfo: 1
    }, 'calls as expected');
    done();
  };

  mediaSegmentRequest(this.options);

  assert.equal(this.requests[0].uri, 'foo.ts', 'segment-request');
  this.standardXHRResponse(this.requests[0], muxedSegment());
});

QUnit.test('video ts segments will make it to the transmuxer', function(assert) {
  const done = assert.async();

  this.options.segment.transmuxer = this.createTransmuxer();
  this.options.segment.resolvedUri = 'foo.ts';
  this.options.doneFn = () => {
    assert.deepEqual(this.calls, {
      data: 1,
      trackInfo: 1,
      progress: 1,
      timingInfo: 2,
      captions: 0,
      id3: 0,
      videoSegmentTimingInfo: 1,
      audioSegmentTimingInfo: 0
    }, 'calls as expected');
    done();
  };

  mediaSegmentRequest(this.options);

  assert.equal(this.requests[0].uri, 'foo.ts', 'segment-request');
  this.standardXHRResponse(this.requests[0], videoSegment());
});

QUnit.test('audio ts segments will make it to the transmuxer', function(assert) {
  const done = assert.async();

  this.options.segment.transmuxer = this.createTransmuxer();
  this.options.segment.resolvedUri = 'foo.ts';
  this.options.doneFn = () => {
    assert.deepEqual(this.calls, {
      data: 1,
      trackInfo: 1,
      progress: 1,
      timingInfo: 2,
      captions: 0,
      id3: 0,
      videoSegmentTimingInfo: 0,
      audioSegmentTimingInfo: 1
    }, 'calls as expected');
    done();
  };

  mediaSegmentRequest(this.options);

  assert.equal(this.requests[0].uri, 'foo.ts', 'segment-request');
  this.standardXHRResponse(this.requests[0], audioSegment());
});

QUnit.test('aac with id3 will make it to the transmuxer', function(assert) {
  const done = assert.async();

  this.options.segment.transmuxer = this.createTransmuxer();
  this.options.segment.resolvedUri = 'foo.aac';
  this.options.doneFn = () => {
    assert.deepEqual(this.calls, {
      data: 1,
      trackInfo: 1,
      progress: 1,
      timingInfo: 2,
      captions: 0,
      id3: 0,
      videoSegmentTimingInfo: 0,
      audioSegmentTimingInfo: 0
    }, 'calls as expected');
    done();
  };

  mediaSegmentRequest(this.options);

  assert.equal(this.requests[0].uri, 'foo.aac', 'segment-request');
  this.standardXHRResponse(this.requests[0], aacWithId3Segment());
});

QUnit.test('aac without id3 will make it to the transmuxer', function(assert) {
  const done = assert.async();

  this.options.segment.transmuxer = this.createTransmuxer();
  this.options.segment.resolvedUri = 'foo.aac';
  this.options.doneFn = () => {
    assert.deepEqual(this.calls, {
      data: 1,
      trackInfo: 1,
      progress: 1,
      timingInfo: 2,
      captions: 0,
      id3: 0,
      videoSegmentTimingInfo: 0,
      audioSegmentTimingInfo: 0
    }, 'calls as expected');
    done();
  };

  mediaSegmentRequest(this.options);

  assert.equal(this.requests[0].uri, 'foo.aac', 'segment-request');
  this.standardXHRResponse(this.requests[0], aacWithoutId3Segment());
});

QUnit.test('cancels outstanding segment request on abort', function(assert) {
  let aborts = 0;

  const abort = mediaSegmentRequest({
    xhr: this.xhr,
    xhrOptions: this.xhrOptions,
    decryptionWorker: this.noop,
    segment: { resolvedUri: '0-test.ts' },
    abortFn: () => aborts++,
    progressFn: this.noop,
    doneFn: this.noop
  });

  // Simulate Firefox's handling of aborted segments -
  // Firefox sets the response to an empty array buffer if the xhr type is 'arraybuffer'
  // and no data was received
  this.requests[0].response = new ArrayBuffer();

  abort();
  this.clock.tick(1);

  assert.equal(this.requests.length, 1, 'there is only one request');
  assert.equal(this.requests[0].uri, '0-test.ts', 'the request is for a segment');
  assert.ok(this.requests[0].aborted, 'aborted the first request');
  assert.equal(aborts, 1, 'one abort');
});

QUnit.test('cancels outstanding key requests on abort', function(assert) {
  let aborts = 0;

  const abort = mediaSegmentRequest({
    xhr: this.xhr,
    xhrOptions: this.xhrOptions,
    decryptionWorker: this.noop,
    segment: {
      resolvedUri: '0-test.ts',
      key: {
        resolvedUri: '0-key.php'
      }
    },
    abortFn: () => aborts++,
    progressFn: this.noop,
    doneFn: this.noop
  });

  assert.equal(this.requests.length, 2, 'there are two requests');

  const keyReq = this.requests.shift();
  const segmentReq = this.requests.shift();

  assert.equal(keyReq.uri, '0-key.php', 'the first request is for a key');
  assert.equal(segmentReq.uri, '0-test.ts', 'the second request is for a segment');

  // Fulfill the segment request
  segmentReq.responseType = 'arraybuffer';
  segmentReq.respond(200, null, new Uint8Array(10).buffer);

  abort();
  this.clock.tick(1);

  assert.ok(keyReq.aborted, 'aborted the key request');
  assert.equal(aborts, 1, 'one abort');
});

QUnit.test('cancels outstanding key requests on failure', function(assert) {
  let keyReq;
  const done = assert.async();

  assert.expect(7);
  mediaSegmentRequest({
    xhr: this.xhr,
    xhrOptions: this.xhrOptions,
    decryptionWorker: this.noop,
    segment: {
      resolvedUri: '0-test.ts',
      key: {
        resolvedUri: '0-key.php'
      }
    },
    progressFn: this.noop,
    doneFn: (error, segmentData) => {
      assert.ok(keyReq.aborted, 'aborted the key request');
      assert.equal(error.code, REQUEST_ERRORS.FAILURE, 'segment request failed');

      done();
    }
  });

  assert.equal(this.requests.length, 2, 'there are two requests');

  keyReq = this.requests.shift();
  const segmentReq = this.requests.shift();

  assert.equal(keyReq.uri, '0-key.php', 'the first request is for a key');
  assert.equal(segmentReq.uri, '0-test.ts', 'the second request is for a segment');

  // Fulfill the segment request
  segmentReq.respond(500, null, '');
});

QUnit.test('cancels outstanding key requests on timeout', function(assert) {
  let keyReq;
  const done = assert.async();

  assert.expect(7);
  mediaSegmentRequest({
    xhr: this.xhr,
    xhrOptions: this.xhrOptions,
    decryptionWorker: this.noop,
    segment: {
      resolvedUri: '0-test.ts',
      key: {
        resolvedUri: '0-key.php'
      }
    },
    progressFn: this.noop,
    doneFn: (error, segmentData) => {
      assert.ok(keyReq.aborted, 'aborted the key request');
      assert.equal(error.code, REQUEST_ERRORS.TIMEOUT, 'key request failed');

      done();
    }
  });
  assert.equal(this.requests.length, 2, 'there are two requests');

  keyReq = this.requests.shift();
  const segmentReq = this.requests.shift();

  assert.equal(keyReq.uri, '0-key.php', 'the first request is for a key');
  assert.equal(segmentReq.uri, '0-test.ts', 'the second request is for a segment');

  // Timeout request
  this.clock.tick(2000);
});

QUnit.test(
  'does not wait for other requests to finish when one request errors',
  function(assert) {
    let keyReq;
    let abortedKeyReq = false;
    const done = assert.async();

    assert.expect(8);
    mediaSegmentRequest({
      xhr: this.xhr,
      xhrOptions: this.xhrOptions,
      decryptionWorker: this.noop,
      segment: {
        resolvedUri: '0-test.ts',
        key: {
          resolvedUri: '0-key.php'
        }
      },
      progressFn: this.noop,
      doneFn: (error, segmentData) => {
        assert.notOk(keyReq.aborted, 'did not run original abort function');
        assert.ok(abortedKeyReq, 'ran overridden abort function');
        assert.equal(error.code, REQUEST_ERRORS.FAILURE, 'request failed');

        done();
      }
    });
    assert.equal(this.requests.length, 2, 'there are two requests');

    keyReq = this.requests.shift();
    // Typically, an abort will run the error algorithm for an XHR, however, in certain
    // cases (e.g., if the request is unsent), the error algorithm will not be run and
    // the request will never "finish." In order to mimic this behavior, override the
    // default abort function so that it doesn't finish.
    keyReq.abort = () => {
      abortedKeyReq = true;
    };
    const segmentReq = this.requests.shift();

    assert.equal(keyReq.uri, '0-key.php', 'the first request is for a key');
    assert.equal(segmentReq.uri, '0-test.ts', 'the second request is for a segment');

    segmentReq.respond(500, null, '');
  }
);

QUnit.test('the key response is converted to the correct format', function(assert) {
  const done = assert.async();
  const postMessage = this.mockDecrypter.postMessage;

  assert.expect(9);
  this.mockDecrypter.postMessage = (message) => {
    const key = new Uint32Array(
      message.key.bytes,
      message.key.byteOffset,
      message.key.byteLength / 4
    );

    assert.deepEqual(
      key,
      new Uint32Array([0, 0x01000000, 0x02000000, 0x03000000]),
      'passed the specified segment key'
    );
    postMessage.call(this.mockDecrypter, message);
  };

  mediaSegmentRequest({
    xhr: this.xhr,
    xhrOptions: this.xhrOptions,
    decryptionWorker: this.mockDecrypter,
    segment: {
      resolvedUri: '0-test.ts',
      key: {
        resolvedUri: '0-key.php',
        IV: [0, 0, 0, 1]
      }
    },
    progressFn: this.noop,
    doneFn: (error, segmentData) => {
      assert.notOk(error, 'there are no errors');
      assert.equal(
        this.mockDecrypter.listeners.length,
        0,
        'all decryption webworker listeners are unbound'
      );
      // verify stats
      assert.equal(segmentData.stats.bytesReceived, 10, '10 bytes');
      done();
    }
  });

  assert.equal(this.requests.length, 2, 'there are two requests');

  const keyReq = this.requests.shift();
  const segmentReq = this.requests.shift();

  assert.equal(keyReq.uri, '0-key.php', 'the first request is for a key');
  assert.equal(segmentReq.uri, '0-test.ts', 'the second request is for a segment');

  segmentReq.responseType = 'arraybuffer';
  segmentReq.respond(200, null, new Uint8Array(10).buffer);
  keyReq.responseType = 'arraybuffer';
  keyReq.respond(200, null, new Uint32Array([0, 1, 2, 3]).buffer);
});

QUnit.test('segment with key has bytes decrypted', function(assert) {
  const done = assert.async();

  mediaSegmentRequest({
    xhr: this.xhr,
    xhrOptions: this.xhrOptions,
    decryptionWorker: this.realDecrypter,
    segment: {
      resolvedUri: '0-test.ts',
      key: {
        resolvedUri: '0-key.php',
        iv: {
          bytes: new Uint32Array([0, 0, 0, 1])
        }
      }
    },
    progressFn: this.noop,
    doneFn: (error, segmentData) => {
      assert.notOk(error, 'there are no errors');
      assert.ok(segmentData.bytes, 'decrypted bytes in segment');
      assert.ok(segmentData.key.bytes, 'key bytes in segment');
      assert.equal(
        segmentData.key.bytes.buffer.byteLength,
        16,
        'key bytes are readable'
      );

      // verify stats
      assert.equal(segmentData.stats.bytesReceived, 8, '8 bytes');
      done();
    }
  });

  assert.equal(this.requests.length, 2, 'there are two requests');

  const keyReq = this.requests.shift();
  const segmentReq = this.requests.shift();

  assert.equal(keyReq.uri, '0-key.php', 'the first request is for a key');
  assert.equal(segmentReq.uri, '0-test.ts', 'the second request is for a segment');

  segmentReq.responseType = 'arraybuffer';
  segmentReq.respond(200, null, new Uint8Array(8).buffer);
  keyReq.responseType = 'arraybuffer';
  keyReq.respond(200, null, new Uint32Array([0, 1, 2, 3]).buffer);

  // Allow the decrypter to decrypt
  this.clock.tick(100);
});

QUnit.test('segment with key bytes does not request key again', function(assert) {
  const done = assert.async();

  mediaSegmentRequest({xhr: this.xhr,
    xhrOptions: this.xhrOptions,
    decryptionWorker: this.realDecrypter,
    segment: {
      resolvedUri: '0-test.ts',
      key: {
        resolvedUri: '0-key.php',
        bytes: new Uint32Array([0, 2, 3, 1]),
        iv: {
          bytes: new Uint32Array([0, 0, 0, 1])
        }
      }
    },
    progressFn: this.noop,
    doneFn: (error, segmentData) => {
      assert.notOk(error, 'there are no errors');
      assert.ok(segmentData.bytes, 'decrypted bytes in segment');
      assert.ok(segmentData.key.bytes, 'key bytes in segment');
      assert.equal(
        segmentData.key.bytes.buffer.byteLength,
        16,
        'key bytes are readable'
      );

      // verify stats
      assert.equal(segmentData.stats.bytesReceived, 8, '8 bytes');
      done();
    }});

  assert.equal(this.requests.length, 1, 'there is one request');
  const segmentReq = this.requests.shift();

  assert.equal(segmentReq.uri, '0-test.ts', 'the second request is for a segment');

  segmentReq.responseType = 'arraybuffer';
  segmentReq.respond(200, null, new Uint8Array(8).buffer);

  // Allow the decrypter to decrypt
  this.clock.tick(100);
});

QUnit.test('key 404 calls back with error', function(assert) {
  const done = assert.async();
  let segmentReq;

  assert.expect(11);
  mediaSegmentRequest({
    xhr: this.xhr,
    xhrOptions: this.xhrOptions,
    decryptionWorker: this.realDecrypter,
    segment: {
      resolvedUri: '0-test.ts',
      key: {
        resolvedUri: '0-key.php',
        iv: {
          bytes: new Uint32Array([0, 0, 0, 1])
        }
      }
    },
    progressFn: this.noop,
    doneFn: (error, segmentData) => {
      assert.ok(segmentReq.aborted, 'segment request aborted');

      assert.ok(error, 'there is an error');
      assert.equal(error.status, 404, 'error status matches response code');
      assert.equal(error.code, REQUEST_ERRORS.FAILURE, 'error code set to FAILURE');
      assert.notOk(segmentData.bytes, 'no bytes in segment');
      done();
    }
  });

  assert.equal(this.requests.length, 2, 'there are two requests');

  const keyReq = this.requests.shift();

  segmentReq = this.requests.shift();

  assert.equal(keyReq.uri, '0-key.php', 'the first request is for a key');
  assert.equal(segmentReq.uri, '0-test.ts', 'the second request is for a segment');
  assert.notOk(segmentReq.aborted, 'segment request not aborted');

  keyReq.respond(404, null, '');
});

QUnit.test('key 500 calls back with error', function(assert) {
  const done = assert.async();
  let segmentReq;

  assert.expect(11);
  mediaSegmentRequest({
    xhr: this.xhr,
    xhrOptions: this.xhrOptions,
    decryptionWorker: this.realDecrypter,
    segment: {
      resolvedUri: '0-test.ts',
      key: {
        resolvedUri: '0-key.php',
        iv: {
          bytes: new Uint32Array([0, 0, 0, 1])
        }
      }
    },
    progressFn: this.noop,
    doneFn: (error, segmentData) => {
      assert.ok(segmentReq.aborted, 'segment request aborted');

      assert.ok(error, 'there is an error');
      assert.equal(error.status, 500, 'error status matches response code');
      assert.equal(error.code, REQUEST_ERRORS.FAILURE, 'error code set to FAILURE');
      assert.notOk(segmentData.bytes, 'no bytes in segment');
      done();
    }
  });

  assert.equal(this.requests.length, 2, 'there are two requests');

  const keyReq = this.requests.shift();

  segmentReq = this.requests.shift();

  assert.equal(keyReq.uri, '0-key.php', 'the first request is for a key');
  assert.equal(segmentReq.uri, '0-test.ts', 'the second request is for a segment');
  assert.notOk(segmentReq.aborted, 'segment request not aborted');

  keyReq.respond(500, null, '');
});

QUnit.test('init segment with key has bytes decrypted', function(assert) {
  const done = assert.async();
  const postMessage = this.mockDecrypter.postMessage;
  const transmuxer = this.createTransmuxer();

  // mock decrypting the init segment.
  this.mockDecrypter.postMessage = (message) => {
    message.encrypted.bytes = mp4VideoInit().buffer;
    message.encrypted.byteLength = message.encrypted.bytes.byteLength;
    message.encrypted.byteOffset = 0;

    return postMessage.call(this.mockDecrypter, message);
  };
  let trackInfo;
  const timingInfo = {};
  let data;

  mediaSegmentRequest({
    xhr: this.xhr,
    xhrOptions: this.xhrOptions,
    decryptionWorker: this.mockDecrypter,
    segment: {
      transmuxer,
      resolvedUri: '0-test.mp4',
      map: {
        resolvedUri: '0-map.mp4',
        key: {
          resolvedUri: '0-key.php',
          iv: {
            bytes: new Uint32Array([0, 0, 0, 1])
          }
        }
      }
    },
    trackInfoFn(segment, _trackInfo) {
      trackInfo = _trackInfo;
    },
    timingInfoFn(segment, type, prop, value) {
      timingInfo[type] = timingInfo[type] || {};
      timingInfo[type][prop] = value;
    },
    dataFn(segment, _data) {
      data = _data;
    },
    progressFn: this.noop,
    doneFn: (error, segmentData) => {
      assert.notOk(error, 'there are no errors');
      assert.ok(segmentData.map.bytes, 'decrypted bytes in map');
      assert.ok(segmentData.map.key.bytes, 'key bytes in map');
      assert.equal(
        segmentData.map.key.bytes.buffer.byteLength,
        16,
        'key bytes are readable'
      );

      // verify stats
      assert.equal(segmentData.stats.bytesReceived, 6198, '6198 bytes');

      assert.ok(data, 'got data');
      assert.ok(trackInfo, 'got track info');
      assert.ok(Object.keys(timingInfo).length, 'got timing info');
      done();
    }
  });

  assert.equal(this.requests.length, 3, 'there are three requests');

  const keyReq = this.requests.shift();
  const mapReq = this.requests.shift();
  const segmentReq = this.requests.shift();

  assert.equal(keyReq.uri, '0-key.php', 'the first request is for a key');
  assert.equal(mapReq.uri, '0-map.mp4', 'the second request is for a map');
  assert.equal(segmentReq.uri, '0-test.mp4', 'the third request is for a segment');

  segmentReq.responseType = 'arraybuffer';
  segmentReq.respond(200, null, mp4Video().buffer);
  mapReq.responseType = 'arraybuffer';
  mapReq.respond(200, null, new Uint8Array(8).buffer);
  keyReq.responseType = 'arraybuffer';
  keyReq.respond(200, null, new Uint32Array([0, 1, 2, 3]).buffer);

  // Allow the decrypter to decrypt
  this.clock.tick(100);
});

QUnit.test('segment/init segment share a key and get decrypted', function(assert) {
  const done = assert.async();
  const postMessage = this.mockDecrypter.postMessage;
  const transmuxer = this.createTransmuxer();

  // mock decrypting the init segment.
  this.mockDecrypter.postMessage = (message) => {
    // segment is 9, init is 8
    if (message.encrypted.byteLength === 8) {
      message.encrypted.bytes = mp4VideoInit().buffer;
    } else {
      message.encrypted.bytes = mp4Video();
    }
    message.encrypted.byteLength = message.encrypted.bytes.byteLength;
    message.encrypted.byteOffset = 0;

    return postMessage.call(this.mockDecrypter, message);
  };
  let trackInfo;
  const timingInfo = {};
  let data;

  mediaSegmentRequest({
    xhr: this.xhr,
    xhrOptions: this.xhrOptions,
    decryptionWorker: this.mockDecrypter,
    segment: {
      transmuxer,
      resolvedUri: '0-test.mp4',
      key: {
        resolvedUri: '0-key.php',
        iv: {
          bytes: new Uint32Array([0, 0, 0, 1])
        }
      },
      map: {
        resolvedUri: '0-map.mp4',
        key: {
          resolvedUri: '0-key.php',
          iv: {
            bytes: new Uint32Array([0, 0, 0, 1])
          }
        }
      }
    },
    trackInfoFn(segment, _trackInfo) {
      trackInfo = _trackInfo;
    },
    timingInfoFn(segment, type, prop, value) {
      timingInfo[type] = timingInfo[type] || {};
      timingInfo[type][prop] = value;
    },
    dataFn(segment, _data) {
      data = _data;
    },
    progressFn: this.noop,
    doneFn: (error, segmentData) => {
      assert.notOk(error, 'there are no errors');
      assert.ok(segmentData.map.bytes, 'decrypted bytes in map');
      assert.ok(segmentData.map.key.bytes, 'key bytes in map');
      assert.equal(
        segmentData.map.key.bytes.buffer.byteLength,
        16,
        'key bytes are readable'
      );

      assert.ok(segmentData.bytes, 'decrypted bytes in segment');
      assert.ok(segmentData.key.bytes, 'key bytes in segment');
      assert.equal(
        segmentData.key.bytes.buffer.byteLength,
        16,
        'key bytes are readable'
      );

      // verify stats
      assert.equal(segmentData.stats.bytesReceived, 9, '9 bytes');
      assert.equal(segmentData.key.bytes, segmentData.map.key.bytes, 'keys are the same');

      assert.ok(data, 'got data');
      assert.ok(trackInfo, 'got track info');
      assert.ok(Object.keys(timingInfo).length, 'got timing info');
      done();
    }
  });

  assert.equal(this.requests.length, 3, 'there are three requests');

  const keyReq = this.requests.shift();
  const mapReq = this.requests.shift();
  const segmentReq = this.requests.shift();

  assert.equal(keyReq.uri, '0-key.php', 'the first request is for a key');
  assert.equal(mapReq.uri, '0-map.mp4', 'the second request is for a map');
  assert.equal(segmentReq.uri, '0-test.mp4', 'the third request is for a segment');

  segmentReq.responseType = 'arraybuffer';
  segmentReq.respond(200, null, new Uint8Array(9).buffer);
  mapReq.responseType = 'arraybuffer';
  mapReq.respond(200, null, new Uint8Array(8).buffer);
  keyReq.responseType = 'arraybuffer';
  keyReq.respond(200, null, new Uint32Array([0, 1, 2, 3]).buffer);

  // Allow the decrypter to decrypt
  this.clock.tick(100);
});

QUnit.test('segment/init segment different key and get decrypted', function(assert) {
  const done = assert.async();
  const postMessage = this.mockDecrypter.postMessage;
  const transmuxer = this.createTransmuxer();

  // mock decrypting the init segment.
  this.mockDecrypter.postMessage = (message) => {
    // segment is 9, init is 8
    if (message.encrypted.byteLength === 8) {
      message.encrypted.bytes = mp4VideoInit().buffer;
    } else {
      message.encrypted.bytes = mp4Video();
    }
    message.encrypted.byteLength = message.encrypted.bytes.byteLength;
    message.encrypted.byteOffset = 0;

    return postMessage.call(this.mockDecrypter, message);
  };
  let trackInfo;
  const timingInfo = {};
  let data;

  mediaSegmentRequest({
    xhr: this.xhr,
    xhrOptions: this.xhrOptions,
    decryptionWorker: this.mockDecrypter,
    segment: {
      transmuxer,
      resolvedUri: '0-test.mp4',
      key: {
        resolvedUri: '0-key.php',
        iv: {
          bytes: new Uint32Array([0, 0, 0, 1])
        }
      },
      map: {
        resolvedUri: '0-map.mp4',
        key: {
          resolvedUri: '1-key.php',
          iv: {
            bytes: new Uint32Array([0, 0, 0, 1])
          }
        }
      }
    },
    trackInfoFn(segment, _trackInfo) {
      trackInfo = _trackInfo;
    },
    timingInfoFn(segment, type, prop, value) {
      timingInfo[type] = timingInfo[type] || {};
      timingInfo[type][prop] = value;
    },
    dataFn(segment, _data) {
      data = _data;
    },
    progressFn: this.noop,
    doneFn: (error, segmentData) => {
      assert.notOk(error, 'there are no errors');
      assert.ok(segmentData.map.bytes, 'decrypted bytes in map');
      assert.ok(segmentData.map.key.bytes, 'key bytes in map');
      assert.equal(
        segmentData.map.key.bytes.buffer.byteLength,
        16,
        'key bytes are readable'
      );

      assert.ok(segmentData.bytes, 'decrypted bytes in segment');
      assert.ok(segmentData.key.bytes, 'key bytes in segment');
      assert.equal(
        segmentData.key.bytes.buffer.byteLength,
        16,
        'key bytes are readable'
      );
      assert.notEqual(segmentData.key.bytes, segmentData.map.key.bytes, 'keys are different');

      // verify stats
      assert.equal(segmentData.stats.bytesReceived, 9, '9 bytes');

      assert.ok(data, 'got data');
      assert.ok(trackInfo, 'got track info');
      assert.ok(Object.keys(timingInfo).length, 'got timing info');
      done();
    }
  });

  assert.equal(this.requests.length, 4, 'there are four requests');

  const keyReq = this.requests.shift();
  const keyReq2 = this.requests.shift();
  const mapReq = this.requests.shift();
  const segmentReq = this.requests.shift();

  assert.equal(keyReq.uri, '0-key.php', 'the first request is for a key');
  assert.equal(keyReq2.uri, '1-key.php', 'the second request is for a key');
  assert.equal(mapReq.uri, '0-map.mp4', 'the third request is for a map');
  assert.equal(segmentReq.uri, '0-test.mp4', 'the forth request is for a segment');

  segmentReq.responseType = 'arraybuffer';
  segmentReq.respond(200, null, new Uint8Array(9).buffer);
  mapReq.responseType = 'arraybuffer';
  mapReq.respond(200, null, new Uint8Array(8).buffer);
  keyReq.responseType = 'arraybuffer';
  keyReq.respond(200, null, new Uint32Array([0, 1, 2, 3]).buffer);
  keyReq2.responseType = 'arraybuffer';
  keyReq2.respond(200, null, new Uint32Array([4, 5, 6, 7]).buffer);

  // Allow the decrypter to decrypt
  this.clock.tick(100);
});

QUnit.test('encrypted init segment parse error', function(assert) {
  const done = assert.async();
  const postMessage = this.mockDecrypter.postMessage;
  const transmuxer = this.createTransmuxer();

  // mock decrypting the init segment.
  this.mockDecrypter.postMessage = (message) => {
    // segment is 9, init is 8
    if (message.encrypted.byteLength === 8) {
      // Responding with a webm segment is something we do not
      // support. so this will be an error.
      message.encrypted.bytes = webmVideoInit().buffer;
    } else {
      message.encrypted.bytes = mp4Video();
    }
    message.encrypted.byteLength = message.encrypted.bytes.byteLength;
    message.encrypted.byteOffset = 0;

    return postMessage.call(this.mockDecrypter, message);
  };

  mediaSegmentRequest({
    xhr: this.xhr,
    xhrOptions: this.xhrOptions,
    decryptionWorker: this.mockDecrypter,
    segment: {
      transmuxer,
      resolvedUri: '0-test.mp4',
      key: {
        resolvedUri: '0-key.php',
        iv: {
          bytes: new Uint32Array([0, 0, 0, 1])
        }
      },
      map: {
        resolvedUri: '0-map.mp4',
        key: {
          resolvedUri: '1-key.php',
          iv: {
            bytes: new Uint32Array([0, 0, 0, 1])
          }
        }
      }
    },
    trackInfoFn: this.noop,
    timingInfoFn: this.noop,
    dataFn: this.noop,
    progressFn: this.noop,
    doneFn: (error, segmentData) => {
      // decrypted webm init segment caused this error.
      assert.ok(error, 'error for invalid init segment');
      done();
    }
  });

  assert.equal(this.requests.length, 4, 'there are four requests');

  const keyReq = this.requests.shift();
  const keyReq2 = this.requests.shift();
  const mapReq = this.requests.shift();
  const segmentReq = this.requests.shift();

  assert.equal(keyReq.uri, '0-key.php', 'the first request is for a key');
  assert.equal(keyReq2.uri, '1-key.php', 'the second request is for a key');
  assert.equal(mapReq.uri, '0-map.mp4', 'the third request is for a map');
  assert.equal(segmentReq.uri, '0-test.mp4', 'the forth request is for a segment');

  segmentReq.responseType = 'arraybuffer';
  segmentReq.respond(200, null, new Uint8Array(9).buffer);
  mapReq.responseType = 'arraybuffer';
  mapReq.respond(200, null, new Uint8Array(8).buffer);
  keyReq.responseType = 'arraybuffer';
  keyReq.respond(200, null, new Uint32Array([0, 1, 2, 3]).buffer);
  keyReq2.responseType = 'arraybuffer';
  keyReq2.respond(200, null, new Uint32Array([0, 1, 2, 3]).buffer);

  // Allow the decrypter to decrypt
  this.clock.tick(100);
});

QUnit.test('encrypted init segment request failure', function(assert) {
  const done = assert.async();
  const transmuxer = this.createTransmuxer();

  mediaSegmentRequest({
    xhr: this.xhr,
    xhrOptions: this.xhrOptions,
    decryptionWorker: this.mockDecrypter,
    segment: {
      transmuxer,
      resolvedUri: '0-test.mp4',
      key: {
        resolvedUri: '0-key.php',
        iv: {
          bytes: new Uint32Array([0, 0, 0, 1])
        }
      },
      map: {
        resolvedUri: '0-map.mp4',
        key: {
          resolvedUri: '1-key.php',
          iv: {
            bytes: new Uint32Array([0, 0, 0, 1])
          }
        }
      }
    },
    trackInfoFn: this.noop,
    timingInfoFn: this.noop,
    dataFn: this.noop,
    progressFn: this.noop,
    doneFn: (error, segmentData) => {
      assert.ok(error, 'errored');
      this.requests.forEach(function(request) {
        assert.ok(request.aborted, 'request aborted');
      });

      done();
    }
  });

  assert.equal(this.requests.length, 4, 'there are four requests');

  const keyReq = this.requests[0];
  const keyReq2 = this.requests[1];
  const mapReq = this.requests[2];
  const segmentReq = this.requests[3];

  assert.equal(keyReq.uri, '0-key.php', 'the first request is for a key');
  assert.equal(keyReq2.uri, '1-key.php', 'the second request is for a key');
  assert.equal(mapReq.uri, '0-map.mp4', 'the third request is for a map');
  assert.equal(segmentReq.uri, '0-test.mp4', 'the forth request is for a segment');

  mapReq.responseType = 'arraybuffer';
  mapReq.respond(500, null, new Uint8Array(8).buffer);

  // Allow the decrypter to decrypt
  this.clock.tick(100);
});

QUnit.test('encrypted init segment with decrypted bytes not re-requested', function(assert) {
  const done = assert.async();
  const postMessage = this.mockDecrypter.postMessage;
  const transmuxer = this.createTransmuxer();

  // mock decrypting the init segment.
  this.mockDecrypter.postMessage = (message) => {
    message.encrypted.bytes = mp4Video();
    message.encrypted.byteLength = message.encrypted.bytes.byteLength;
    message.encrypted.byteOffset = 0;

    return postMessage.call(this.mockDecrypter, message);
  };
  let trackInfo;
  const timingInfo = {};
  let data;

  mediaSegmentRequest({
    xhr: this.xhr,
    xhrOptions: this.xhrOptions,
    decryptionWorker: this.mockDecrypter,
    segment: {
      transmuxer,
      resolvedUri: '0-test.mp4',
      key: {
        resolvedUri: '0-key.php',
        iv: {
          bytes: new Uint32Array([0, 0, 0, 1])
        }
      },
      map: {
        resolvedUri: '0-map.mp4',
        bytes: mp4VideoInit().buffer,
        timescales: {
          1: 30000
        },
        tracks: {
          video: {
            id: 1,
            timescale: 30000,
            type: 'video',
            codec: 'avc1.64001e'
          }
        },
        key: {
          resolvedUri: '1-key.php',
          iv: {
            bytes: new Uint32Array([0, 0, 0, 1])
          }
        }
      }
    },
    trackInfoFn(segment, _trackInfo) {
      trackInfo = _trackInfo;
    },
    timingInfoFn(segment, type, prop, value) {
      timingInfo[type] = timingInfo[type] || {};
      timingInfo[type][prop] = value;
    },
    dataFn(segment, _data) {
      data = _data;
    },
    progressFn: this.noop,
    doneFn: (error, segmentData) => {
      assert.notOk(error, 'there are no errors');
      assert.ok(segmentData.bytes, 'decrypted bytes in segment');
      assert.ok(segmentData.key.bytes, 'key bytes in segment');
      assert.equal(
        segmentData.key.bytes.buffer.byteLength,
        16,
        'key bytes are readable'
      );

      // verify stats
      assert.equal(segmentData.stats.bytesReceived, 9, '9 bytes');

      assert.ok(data, 'got data');
      assert.ok(trackInfo, 'got track info');
      assert.ok(Object.keys(timingInfo).length, 'got timing info');
      done();
    }
  });

  assert.equal(this.requests.length, 2, 'there are two requests');

  const keyReq = this.requests.shift();
  const segmentReq = this.requests.shift();

  assert.equal(keyReq.uri, '0-key.php', 'the first request is for a key');
  assert.equal(segmentReq.uri, '0-test.mp4', 'the second request is for a segment');

  segmentReq.responseType = 'arraybuffer';
  segmentReq.respond(200, null, new Uint8Array(9).buffer);
  keyReq.responseType = 'arraybuffer';
  keyReq.respond(200, null, new Uint32Array([0, 1, 2, 3]).buffer);

  // Allow the decrypter to decrypt
  this.clock.tick(100);
});

QUnit.test(
  'waits for every request to finish before the callback is run',
  function(assert) {
    const done = assert.async();
    const transmuxer = this.createTransmuxer();

    assert.expect(10);
    mediaSegmentRequest({
      xhr: this.xhr,
      xhrOptions: this.xhrOptions,
      decryptionWorker: this.realDecrypter,
      segment: {
        resolvedUri: '0-test.ts',
        key: {
          resolvedUri: '0-key.php',
          iv: {
            bytes: new Uint32Array([0, 0, 0, 1])
          }
        },
        map: {
          resolvedUri: '0-init.dat'
        },
        transmuxer
      },
      progressFn: this.noop,
      trackInfoFn: this.noop,
      doneFn: (error, segmentData) => {
        assert.notOk(error, 'there are no errors');
        assert.ok(segmentData.bytes, 'decrypted bytes in segment');
        assert.ok(segmentData.map.bytes, 'init segment bytes in map');

        // verify stats
        assert.equal(segmentData.stats.bytesReceived, 8, '8 bytes');
        done();
      }
    });

    assert.equal(this.requests.length, 3, 'there are three requests');

    const keyReq = this.requests.shift();
    const initReq = this.requests.shift();
    const segmentReq = this.requests.shift();

    assert.equal(keyReq.uri, '0-key.php', 'the first request is for a key');
    assert.equal(initReq.uri, '0-init.dat', 'the second request is for the init segment');
    assert.equal(segmentReq.uri, '0-test.ts', 'the third request is for a segment');

    segmentReq.responseType = 'arraybuffer';
    segmentReq.respond(200, null, new Uint8Array(8).buffer);
    this.clock.tick(200);

    initReq.responseType = 'arraybuffer';
    initReq.respond(200, null, mp4VideoInit().buffer);
    this.clock.tick(200);

    keyReq.responseType = 'arraybuffer';
    keyReq.respond(200, null, new Uint32Array([0, 1, 2, 3]).buffer);

    // Allow the decrypter to decrypt
    this.clock.tick(100);
  }
);

QUnit.test('non-TS segment will get parsed for captions', function(assert) {
  const done = assert.async();
  let gotCaption = false;
  let gotData = false;
  const captions = [{foo: 'bar'}];
  const transmuxer = new videojs.EventTarget();

  transmuxer.postMessage = (event) => {
    if (event.action === 'pushMp4Captions') {
      transmuxer.trigger({
        type: 'message',
        data: {
          action: 'mp4Captions',
          data: event.data,
          captions,
          logs: []
        }
      });
    }

    if (event.action === 'probeMp4StartTime') {
      transmuxer.trigger({
        type: 'message',
        data: {
          action: 'probeMp4StartTime',
          data: event.data,
          timingInfo: {}
        }
      });
    }

    if (event.action === 'probeMp4Tracks') {
      transmuxer.trigger({
        type: 'message',
        data: {
          action: 'probeMp4Tracks',
          data: event.data,
          tracks: [{type: 'video', codec: 'avc1.4d400d'}]
        }
      });
    }

    if (event.action === 'probeEmsgID3') {
      transmuxer.trigger({
        type: 'message',
        data: {
          action: 'probeEmsgID3',
          emsgData: event.data,
          id3Frames: []
        }
      });
    }
  };

  mediaSegmentRequest({
    xhr: this.xhr,
    xhrOptions: this.xhrOptions,
    decryptionWorker: this.mockDecrypter,
    segment: {
      transmuxer,
      resolvedUri: 'mp4Video.mp4',
      map: {
        resolvedUri: 'mp4VideoInit.mp4'
      },
      isFmp4: true
    },
    progressFn: this.noop,
    trackInfoFn: this.noop,
    timingInfoFn: this.noop,
    id3Fn: this.noop,
    captionsFn: (segment, _captions) => {
      gotCaption = true;
      assert.equal(captions, _captions, 'captions as expected');
    },
    dataFn: (segment, segmentData) => {
      gotData = true;

      assert.ok(segment.map.bytes, 'init segment bytes in map');
      assert.ok(segment.map.tracks, 'added tracks');
      assert.ok(segment.map.tracks.video, 'added video track');
    },
    doneFn: () => {
      assert.ok(gotCaption, 'received caption event');
      assert.ok(gotData, 'received data event');
      transmuxer.off();
      done();
    }
  });

  assert.equal(this.requests.length, 2, 'there are two requests');

  const initReq = this.requests.shift();
  const segmentReq = this.requests.shift();

  assert.equal(initReq.uri, 'mp4VideoInit.mp4', 'the first request is for the init segment');
  assert.equal(segmentReq.uri, 'mp4Video.mp4', 'the second request is for a segment');

  this.standardXHRResponse(initReq, mp4VideoInit());
  this.standardXHRResponse(segmentReq, mp4Video());
});

QUnit.test('webm segment calls back with error', function(assert) {
  const done = assert.async();
  let gotData = false;

  mediaSegmentRequest({
    xhr: this.xhr,
    xhrOptions: this.xhrOptions,
    decryptionWorker: this.mockDecrypter,
    segment: {
      resolvedUri: 'webmVideo.mp4',
      map: {
        resolvedUri: 'webmVideoInit.mp4'
      },
      isFmp4: true
    },
    progressFn: this.noop,
    trackInfoFn: this.noop,
    timingInfoFn: this.noop,
    id3Fn: this.noop,
    captionsFn: this.noop,
    dataFn: (segment, segmentData) => {
      gotData = true;
    },
    doneFn: (error) => {
      assert.notOk(gotData, 'did not receive data event');
      assert.equal(error.code, REQUEST_ERRORS.FAILURE, 'receieved error status');
      assert.equal(
        error.message,
        'Found unsupported webm container for initialization segment at URL: webmVideoInit.mp4',
        'receieved error message'
      );
      done();
    }
  });

  assert.equal(this.requests.length, 2, 'there are two requests');

  const initReq = this.requests.shift();
  const segmentReq = this.requests.shift();

  assert.equal(
    initReq.uri,
    'webmVideoInit.mp4',
    'the first request is for the init segment'
  );
  assert.equal(segmentReq.uri, 'webmVideo.mp4', 'the second request is for a segment');

  this.standardXHRResponse(segmentReq, webmVideo());
  this.standardXHRResponse(initReq, webmVideoInit());
});

QUnit.test('non-TS segment will get parsed for captions on next segment request if init is late', function(assert) {
  const done = assert.async();
  let gotCaption = 0;
  let gotData = 0;
  const captions = [{foo: 'bar'}];
  const transmuxer = new videojs.EventTarget();

  transmuxer.postMessage = (event) => {
    if (event.action === 'pushMp4Captions') {
      transmuxer.trigger({
        type: 'message',
        data: {
          action: 'mp4Captions',
          data: event.data,
          captions,
          logs: []
        }
      });
    }

    if (event.action === 'probeMp4StartTime') {
      transmuxer.trigger({
        type: 'message',
        data: {
          action: 'probeMp4StartTime',
          data: event.data,
          timingInfo: {}
        }
      });
    }

    if (event.action === 'probeMp4Tracks') {
      transmuxer.trigger({
        type: 'message',
        data: {
          action: 'probeMp4Tracks',
          data: event.data,
          tracks: [{type: 'video', codec: 'avc1.4d400d'}]
        }
      });
    }

    if (event.action === 'probeEmsgID3') {
      transmuxer.trigger({
        type: 'message',
        data: {
          action: 'probeEmsgID3',
          emsgData: event.data,
          id3Frames: []
        }
      });
    }
  };

  mediaSegmentRequest({
    xhr: this.xhr,
    xhrOptions: this.xhrOptions,
    decryptionWorker: this.mockDecrypter,
    segment: {
      transmuxer,
      resolvedUri: 'mp4Video.mp4',
      map: {
        resolvedUri: 'mp4VideoInit.mp4'
      }
    },
    progressFn: this.noop,
    trackInfoFn: this.noop,
    timingInfoFn: this.noop,
    id3Fn: this.noop,
    captionsFn: (segment, _captions) => {
      gotCaption++;

      // verify the caption parser
      assert.deepEqual(
        captions,
        _captions,
        'the expected captions were received'
      );
    },
    dataFn: (segment, segmentData) => {
      gotData++;

      assert.ok(segmentData, 'init segment bytes in map');
      assert.ok(segment.map.tracks, 'added tracks');
      assert.ok(segment.map.tracks.video, 'added video track');
    },
    doneFn: () => {
      assert.equal(gotCaption, 1, 'received caption event');
      assert.equal(gotData, 1, 'received data event');
      transmuxer.off();
      done();
    }
  });

  assert.equal(this.requests.length, 2, 'there are two requests');

  const initReq = this.requests.shift();
  const segmentReq = this.requests.shift();

  assert.equal(initReq.uri, 'mp4VideoInit.mp4', 'the first request is for the init segment');
  assert.equal(segmentReq.uri, 'mp4Video.mp4', 'the second request is for a segment');

  // Simulate receiving the media first
  this.standardXHRResponse(segmentReq, mp4Video());
  // Simulate receiving the init segment after the media
  this.standardXHRResponse(initReq, mp4VideoInit());
});

QUnit.test('can get emsg ID3 frames from fmp4 video segment', function(assert) {
  const done = assert.async();
  let gotEmsgId3 = 0;
  let gotData = 0;
  // expected frame data
  const id3Frames = [{
    cueTime: 1,
    duration: 0,
    frames: [{
      id: 'TXXX',
      description: 'foo bar',
      data: { key: 'value' }
    },
    {
      id: 'PRIV',
      owner: 'priv-owner@foo.bar',
      // 'foo'
      data: new Uint8Array([0x66, 0x6F, 0x6F])
    }]
  },
  {
    cueTime: 3,
    duration: 0,
    frames: [{
      id: 'PRIV',
      owner: 'priv-owner@foo.bar',
      // 'bar'
      data: new Uint8Array([0x62, 0x61, 0x72])
    },
    {
      id: 'TXXX',
      description: 'bar foo',
      data: { key: 'value' }
    }]
  }];
  const transmuxer = new videojs.EventTarget();

  transmuxer.postMessage = (event) => {
    if (event.action === 'pushMp4Captions') {
      transmuxer.trigger({
        type: 'message',
        data: {
          action: 'mp4Captions',
          data: event.data,
          captions: 'foo bar',
          logs: []
        }
      });
    }

    if (event.action === 'probeMp4StartTime') {
      transmuxer.trigger({
        type: 'message',
        data: {
          action: 'probeMp4StartTime',
          data: event.data,
          timingInfo: {}
        }
      });
    }

    if (event.action === 'probeMp4Tracks') {
      transmuxer.trigger({
        type: 'message',
        data: {
          action: 'probeMp4Tracks',
          data: event.data,
          tracks: [{type: 'video', codec: 'avc1.4d400d'}]
        }
      });
    }

    if (event.action === 'probeEmsgID3') {
      transmuxer.trigger({
        type: 'message',
        data: {
          action: 'probeEmsgID3',
          emsgData: event.data,
          id3Frames
        }
      });
    }
  };

  mediaSegmentRequest({
    xhr: this.xhr,
    xhrOptions: this.xhrOptions,
    decryptionWorker: this.mockDecrypter,
    segment: {
      transmuxer,
      resolvedUri: 'mp4Video.mp4',
      map: {
        resolvedUri: 'mp4VideoInit.mp4'
      }
    },
    progressFn: this.noop,
    trackInfoFn: this.noop,
    timingInfoFn: this.noop,
    id3Fn: (segment, _id3Frames) => {
      gotEmsgId3++;
      assert.deepEqual(_id3Frames, id3Frames, 'got expected emsg id3 data.');
    },
    captionsFn: this.noop,
    dataFn: (segment, segmentData) => {
      gotData++;
      assert.ok(segmentData, 'init segment bytes in map');
      assert.ok(segment.map.tracks, 'added tracks');
      assert.ok(segment.map.tracks.video, 'added video track');
    },
    doneFn: () => {
      assert.equal(gotEmsgId3, 1, 'received emsg ID3 event');
      assert.equal(gotData, 1, 'received data event');
      transmuxer.off();
      done();
    }
  });
  assert.equal(this.requests.length, 2, 'there are two requests');

  const initReq = this.requests.shift();
  const segmentReq = this.requests.shift();

  assert.equal(initReq.uri, 'mp4VideoInit.mp4', 'the first request is for the init segment');
  assert.equal(segmentReq.uri, 'mp4Video.mp4', 'the second request is for a segment');

  // Simulate receiving the media first
  this.standardXHRResponse(segmentReq, mp4Video());
  // Simulate receiving the init segment after the media
  this.standardXHRResponse(initReq, mp4VideoInit());
});

QUnit.test('can get emsg ID3 frames from fmp4 audio segment', function(assert) {
  const done = assert.async();
  let gotEmsgId3 = 0;
  let gotData = 0;
  // expected frame data
  const id3Frames = [{
    cueTime: 1,
    duration: 0,
    frames: [{
      id: 'TXXX',
      description: 'foo bar',
      data: { key: 'value' }
    },
    {
      id: 'PRIV',
      owner: 'priv-owner@foo.bar',
      // 'foo'
      data: new Uint8Array([0x66, 0x6F, 0x6F])
    }]
  },
  {
    cueTime: 3,
    duration: 0,
    frames: [{
      id: 'PRIV',
      owner: 'priv-owner@foo.bar',
      // 'bar'
      data: new Uint8Array([0x62, 0x61, 0x72])
    },
    {
      id: 'TXXX',
      description: 'bar foo',
      data: { key: 'value' }
    }]
  }];
  const transmuxer = new videojs.EventTarget();

  transmuxer.postMessage = (event) => {
    if (event.action === 'pushMp4Captions') {
      transmuxer.trigger({
        type: 'message',
        data: {
          action: 'mp4Captions',
          data: event.data,
          captions: 'foo bar',
          logs: []
        }
      });
    }

    if (event.action === 'probeMp4StartTime') {
      transmuxer.trigger({
        type: 'message',
        data: {
          action: 'probeMp4StartTime',
          data: event.data,
          timingInfo: {}
        }
      });
    }

    if (event.action === 'probeMp4Tracks') {
      transmuxer.trigger({
        type: 'message',
        data: {
          action: 'probeMp4Tracks',
          data: event.data,
          tracks: [{type: 'audio', codec: 'mp4a.40.2'}]
        }
      });
    }

    if (event.action === 'probeEmsgID3') {
      transmuxer.trigger({
        type: 'message',
        data: {
          action: 'probeEmsgID3',
          emsgData: event.data,
          id3Frames
        }
      });
    }
  };

  mediaSegmentRequest({
    xhr: this.xhr,
    xhrOptions: this.xhrOptions,
    decryptionWorker: this.mockDecrypter,
    segment: {
      transmuxer,
      resolvedUri: 'mp4Audio.mp4',
      map: {
        resolvedUri: 'mp4AudioInit.mp4'
      }
    },
    progressFn: this.noop,
    trackInfoFn: this.noop,
    timingInfoFn: this.noop,
    id3Fn: (segment, _id3Frames) => {
      gotEmsgId3++;
      assert.deepEqual(_id3Frames, id3Frames, 'got expected emsg id3 data.');
    },
    captionsFn: this.noop,
    dataFn: (segment, segmentData) => {
      gotData++;
      assert.ok(segmentData, 'init segment bytes in map');
      assert.ok(segment.map.tracks, 'added tracks');
      assert.ok(segment.map.tracks.audio, 'added audio track');
    },
    doneFn: () => {
      assert.equal(gotEmsgId3, 1, 'received emsg ID3 event');
      assert.equal(gotData, 1, 'received data event');
      transmuxer.off();
      done();
    }
  });
  assert.equal(this.requests.length, 2, 'there are two requests');

  const initReq = this.requests.shift();
  const segmentReq = this.requests.shift();

  assert.equal(initReq.uri, 'mp4AudioInit.mp4', 'the first request is for the init segment');
  assert.equal(segmentReq.uri, 'mp4Audio.mp4', 'the second request is for a segment');

  // Simulate receiving the media first
  this.standardXHRResponse(segmentReq, mp4Audio());
  // Simulate receiving the init segment after the media
  this.standardXHRResponse(initReq, mp4AudioInit());
});
