import QUnit from 'qunit';
import sinon from 'sinon';
import {
  muxed as muxedSegment,
  caption as captionSegment
} from 'create-test-data!segments';
import {
  transmux,
  reset,
  endTimeline,
  enqueueAction,
  dequeue,
  processAction,
  processTransmux,
  handleGopInfo_,
  handleDone_,
  handleData_,
  createTransmuxer as createTransmuxer_
} from '../src/segment-transmuxer';
// needed for plugin registration
import '../src/videojs-http-streaming';

const noop = () => {};

const createTransmuxer = () => {
  return createTransmuxer_({
    remux: false,
    keepOriginalTimestamps: true
  });
};

const mockTransmuxer = () => {
  const transmuxer = {
    postMessage(event) {},
    terminate() {},
    currentTransmux: null,
    transmuxQueue: []
  };

  return transmuxer;
};

QUnit.module('Segment Transmuxer', {
  beforeEach(assert) {
    this.transmuxer = null;
    assert.timeout(5000);
  },
  afterEach(assert) {
    if (this.transmuxer) {
      this.transmuxer.terminate();
    }
  }
});

QUnit.test('transmux returns data for full appends', function(assert) {
  const done = assert.async();
  const dataFn = sinon.spy();
  const trackInfoFn = sinon.spy();
  const audioTimingFn = sinon.spy();
  const videoTimingFn = sinon.spy();
  const videoSegmentTimingInfoFn = sinon.spy();
  const audioSegmentTimingInfoFn = sinon.spy();

  this.transmuxer = createTransmuxer();

  transmux({
    transmuxer: this.transmuxer,
    bytes: muxedSegment(),
    audioAppendStart: null,
    gopsToAlignWith: null,
    onData: dataFn,
    onTrackInfo: trackInfoFn,
    onAudioTimingInfo: audioTimingFn,
    onVideoTimingInfo: videoTimingFn,
    onVideoSegmentTimingInfo: videoSegmentTimingInfoFn,
    onAudioSegmentTimingInfo: audioSegmentTimingInfoFn,
    onId3: noop,
    onCaptions: noop,
    onDone: () => {
      assert.ok(dataFn.callCount, 'got data events');
      assert.ok(trackInfoFn.callCount, 'got trackInfo events');
      assert.ok(audioTimingFn.callCount, 'got audioTimingInfo events');
      assert.ok(videoTimingFn.callCount, 'got videoTimingInfo events');
      assert.ok(videoSegmentTimingInfoFn.callCount, 'got videoSegmentTimingInfo events');
      assert.ok(audioSegmentTimingInfoFn.callCount, 'got audioSegmentTimingInfo events');
      done();
    }
  });
});

QUnit.test('transmux returns captions for full appends', function(assert) {
  const done = assert.async();
  const dataFn = sinon.spy();
  const captionsFn = sinon.spy();

  this.transmuxer = createTransmuxer();

  transmux({
    transmuxer: this.transmuxer,
    bytes: captionSegment(),
    audioAppendStart: null,
    gopsToAlignWith: null,
    onData: dataFn,
    onTrackInfo: noop,
    onAudioTimingInfo: noop,
    onVideoTimingInfo: noop,
    onVideoSegmentTimingInfo: noop,
    onId3: noop,
    onCaptions: captionsFn,
    onDone: () => {
      assert.ok(dataFn.callCount, 'got data events');
      assert.ok(captionsFn.callCount, 'got captions');
      done();
    }
  });
});

QUnit.test('resets transmuxer on reset()', function(assert) {
  this.transmuxer = mockTransmuxer();
  this.transmuxer.postMessage = sinon.spy();

  reset(this.transmuxer);
  assert.deepEqual(
    this.transmuxer.postMessage.args[0][0],
    { action: 'reset' },
    'called reset on transmuxer'
  );
});

QUnit.test('passes endTimeline to transmuxer on endTimeline()', function(assert) {
  this.transmuxer = mockTransmuxer();
  this.transmuxer.postMessage = sinon.spy();

  endTimeline(this.transmuxer);
  assert.deepEqual(
    this.transmuxer.postMessage.args[0][0],
    { action: 'endTimeline' },
    'called endTimeline on transmuxer'
  );
});

QUnit.test('passes action to transmuxer on enqueueAction()', function(assert) {
  this.transmuxer = mockTransmuxer();
  this.transmuxer.postMessage = sinon.spy();

  enqueueAction('push', this.transmuxer);
  assert.deepEqual(
    this.transmuxer.postMessage.args[0][0],
    { action: 'push' },
    'called push on transmuxer'
  );
  assert.deepEqual(
    this.transmuxer.postMessage.callCount,
    1,
    'only posted one message'
  );
});

QUnit.test('dequeues and processes action on dequeue()', function(assert) {
  this.transmuxer = mockTransmuxer();
  this.transmuxer.postMessage = sinon.spy();

  assert.deepEqual(this.transmuxer.postMessage.callCount, 0, 'no actions yet');

  transmux({
    transmuxer: this.transmuxer,
    bytes: new Uint8Array(),
    audioAppendStart: null,
    gopsToAlignWith: null,
    onData: noop,
    onTrackInfo: noop,
    onAudioTimingInfo: noop,
    onVideoTimingInfo: noop,
    onId3: noop,
    onCaptions: noop,
    onDone: noop
  });
  enqueueAction('reset', this.transmuxer);
  // reset is in the queue instead of being processed
  assert.deepEqual(this.transmuxer.postMessage.callCount, 1, 'only one action is processed');
  assert.deepEqual(
    this.transmuxer.postMessage.args[0][0],
    { action: 'flush' },
    'the transmux() posted `flush` to the transmuxer'
  );

  dequeue(this.transmuxer);
  assert.deepEqual(this.transmuxer.postMessage.callCount, 2, 'two actions processed');
  assert.deepEqual(
    this.transmuxer.postMessage.args[1][0],
    { action: 'reset' },
    'the reset was posted to the transmuxer'
  );
});

QUnit.test('processAction posts a message to the transmuxer', function(assert) {
  this.transmuxer = mockTransmuxer();
  this.transmuxer.postMessage = sinon.spy();

  processAction(this.transmuxer, 'fakeaction');
  assert.deepEqual(
    this.transmuxer.postMessage.args[0][0],
    { action: 'fakeaction' },
    'the action was posted to the transmuxer'
  );
});

QUnit.test('processTransmux posts all actions', function(assert) {
  this.transmuxer = mockTransmuxer();
  this.transmuxer.onmessage = sinon.spy();
  this.transmuxer.postMessage = sinon.spy();

  processTransmux({
    transmuxer: this.transmuxer,
    bytes: muxedSegment(),
    audioAppendStart: [0],
    gopsToAlignWith: [0],
    onData: noop,
    onTrackInfo: noop,
    onAudioTimingInfo: noop,
    onVideoTimingInfo: noop,
    onId3: noop,
    onCaptions: noop,
    onDone: noop
  });

  assert.deepEqual(
    this.transmuxer.postMessage.args[0][0],
    {
      action: 'setAudioAppendStart',
      appendStart: [0]
    },
    'sends audio append start data to transmuxer'
  );
  assert.deepEqual(
    this.transmuxer.postMessage.args[1][0],
    {
      action: 'alignGopsWith',
      gopsToAlignWith: [0]
    },
    'sends gops to align with to transmuxer'
  );
  assert.deepEqual(
    this.transmuxer.postMessage.args[2][0].action,
    'push',
    'pushed data to transmuxer'
  );
  assert.deepEqual(
    this.transmuxer.postMessage.args[2][0].byteOffset,
    0,
    'pushed byteOffset to transmuxer'
  );
  assert.deepEqual(
    this.transmuxer.postMessage.args[2][0].byteLength,
    muxedSegment().length,
    'pushed byteLength to transmuxer'
  );
  assert.deepEqual(
    this.transmuxer.postMessage.args[3][0],
    { action: 'flush' },
    'calls flush on the transmuxer'
  );
});

QUnit.test('handleGopInfo_ attaches gopInfo from an event to the transmuxedData', function(assert) {
  const transmuxedData = {};

  handleGopInfo_(
    {
      data: {
        gopInfo: [{ a: 1 }]
      }
    },
    transmuxedData
  );
  assert.deepEqual(
    transmuxedData,
    {
      gopInfo: [{ a: 1 }]
    },
    'gopInfo is attached to transmuxed data'
  );
});

QUnit.test('handleDone_ modifies transmuxedData and passes it to the callback', function(assert) {
  const callback = sinon.spy();

  handleDone_({
    transmuxedData: { a: 1 },
    callback
  });

  assert.deepEqual(callback.callCount, 1, 'called the callback');
  assert.deepEqual(
    callback.args[0][0],
    {
      a: 1,
      buffer: []
    },
    'passes transmuxedData to callback'
  );
});

QUnit.test(
  'handleData_ passes initSegment and segment data to callback',
  function(assert) {
    const callback = sinon.spy();
    const event = {
      data: {
        segment: {
          type: 'video',
          initSegment: {
            data: [],
            byteOffset: 0,
            byteLength: 0
          },
          boxes: {
            data: [],
            byteOffset: 0,
            byteLength: 0
          },
          captions: [{
            text: 'a',
            startTime: 1,
            endTime: 2
          }],
          captionStreams: {
            CC1: true
          },
          metadata: [{
            cueTime: 1,
            frames: [{
              data: 'example'
            }]
          }],
          videoFrameDtsTime: 1
        }
      }
    };
    const transmuxedData = {
      buffer: []
    };

    handleData_(event, transmuxedData, callback);

    assert.deepEqual(
      transmuxedData,
      {
        buffer: [{
          captions: event.data.segment.captions,
          captionStreams: event.data.segment.captionStreams,
          metadata: event.data.segment.metadata
        }]
      },
      'captions and metadata are added to transmuxedData buffer'
    );
    assert.deepEqual(callback.callCount, 1, 'callback ran');
    assert.deepEqual(
      callback.args[0][0],
      {
        type: 'video',
        // cast ArrayBuffer to TypedArray
        data: new Uint8Array(new ArrayBuffer(0), 0, 0),
        initSegment: new Uint8Array(new ArrayBuffer(0), 0, 0),
        videoFrameDtsTime: 1
      },
      'callback passed the bytes for the segment and initSegment'
    );
  }
);

QUnit.test('transmux waits for endTimeline if isEndOfTimeline', function(assert) {
  const done = assert.async();
  const dataFn = sinon.spy();
  const trackInfoFn = sinon.spy();
  const audioTimingFn = sinon.spy();
  const videoTimingFn = sinon.spy();
  const videoSegmentTimingInfoFn = sinon.spy();
  const audioSegmentTimingInfoFn = sinon.spy();
  const onEndedTimelineFn = sinon.spy();

  this.transmuxer = createTransmuxer();

  transmux({
    transmuxer: this.transmuxer,
    bytes: muxedSegment(),
    audioAppendStart: null,
    gopsToAlignWith: null,
    onData: dataFn,
    onTrackInfo: trackInfoFn,
    onAudioTimingInfo: audioTimingFn,
    onVideoTimingInfo: videoTimingFn,
    onVideoSegmentTimingInfo: videoSegmentTimingInfoFn,
    onAudioSegmentTimingInfo: audioSegmentTimingInfoFn,
    onId3: noop,
    onCaptions: noop,
    isEndOfTimeline: true,
    onEndedTimeline: onEndedTimelineFn,
    onDone: () => {
      assert.ok(dataFn.callCount, 'got data events');
      assert.ok(trackInfoFn.callCount, 'got trackInfo events');
      assert.ok(audioTimingFn.callCount, 'got audioTimingInfo events');
      assert.ok(videoTimingFn.callCount, 'got videoTimingInfo events');
      assert.ok(videoSegmentTimingInfoFn.callCount, 'got videoSegmentTimingInfo events');
      assert.ok(audioSegmentTimingInfoFn.callCount, 'got audioSegmentTimingInfo events');
      assert.ok(onEndedTimelineFn.callCount, 'got onEndedTimeline event');
      done();
    }
  });
});

QUnit.test('transmux does not wait for endTimeline if not isEndOfTimeline', function(assert) {
  const done = assert.async();
  const dataFn = sinon.spy();
  const trackInfoFn = sinon.spy();
  const audioTimingFn = sinon.spy();
  const videoTimingFn = sinon.spy();
  const videoSegmentTimingInfoFn = sinon.spy();
  const audioSegmentTimingInfoFn = sinon.spy();
  const onEndedTimelineFn = sinon.spy();

  this.transmuxer = createTransmuxer();

  transmux({
    transmuxer: this.transmuxer,
    bytes: muxedSegment(),
    audioAppendStart: null,
    gopsToAlignWith: null,
    onData: dataFn,
    onTrackInfo: trackInfoFn,
    onAudioTimingInfo: audioTimingFn,
    onVideoTimingInfo: videoTimingFn,
    onVideoSegmentTimingInfo: videoSegmentTimingInfoFn,
    onAudioSegmentTimingInfo: audioSegmentTimingInfoFn,
    onId3: noop,
    onCaptions: noop,
    isEndOfTimeline: false,
    onEndedTimeline: onEndedTimelineFn,
    onDone: () => {
      assert.ok(dataFn.callCount, 'got data events');
      assert.ok(trackInfoFn.callCount, 'got trackInfo events');
      assert.ok(audioTimingFn.callCount, 'got audioTimingInfo events');
      assert.ok(videoTimingFn.callCount, 'got videoTimingInfo events');
      assert.ok(videoSegmentTimingInfoFn.callCount, 'got videoSegmentTimingInfo events');
      assert.ok(audioSegmentTimingInfoFn.callCount, 'got audioSegmentTimingInfo events');
      assert.notOk(onEndedTimelineFn.callCount, 'did not get onEndedTimeline event');
      done();
    }
  });
});
