import QUnit from 'qunit';
import {createTransmuxer as createTransmuxer_} from '../src/segment-transmuxer.js';
import {
  mp4Captions as mp4CaptionsSegment,
  muxed as muxedSegment,
  caption as captionSegment,
  mp4WebVttInit as webVttInit,
  mp4WebVtt as webVttSegment
} from 'create-test-data!segments';
// needed for plugin registration
import '../src/videojs-http-streaming';

const createTransmuxer = () => {
  return createTransmuxer_({
    remux: false,
    keepOriginalTimestamps: true
  });
};

// The final done message from the Transmux worker
// will have type `transmuxed`
const isFinalDone = (event) => {
  return event.data.action === 'done' &&
    event.data.type === 'transmuxed';
};

QUnit.module('Transmuxer Worker: Full Transmuxer', {
  beforeEach(assert) {
    assert.timeout(5000);
  },
  afterEach(assert) {
    if (this.transmuxer) {
      this.transmuxer.terminate();
    }
  }
});

// Missing tests as these are not accessible to unit testing
// - setTimestampOffset
// - setAudioAppendStart
// - alignGopsWith

QUnit.test('push should result in a trackinfo event', function(assert) {
  const done = assert.async();

  this.transmuxer = createTransmuxer();
  this.transmuxer.onmessage = (e) => {
    assert.equal(
      e.data.action,
      'trackinfo',
      'pushing data should get trackinfo as the first event'
    );
    assert.deepEqual(
      e.data.trackInfo,
      {
        hasVideo: true,
        hasAudio: true
      },
      'should have video and audio'
    );

    done();
  };

  this.transmuxer.postMessage({
    action: 'push',
    data: muxedSegment()
  });
});

QUnit.test('flush should return data from transmuxer', function(assert) {
  const testDone = assert.async();
  const messages = [];
  const handleMessages = (e) => {
    messages.push(e.data);

    if (!isFinalDone(e)) {
      return;
    }

    assert.deepEqual(
      messages.map((x) => x.action),
      [
        'trackinfo',
        'gopInfo',
        'videoSegmentTimingInfo',
        'videoTimingInfo',
        'data',
        'audioSegmentTimingInfo',
        'audioTimingInfo',
        'data',
        'done',
        'done'
      ],
      'the events are received in the expected order'
    );
    assert.ok(
      messages.shift().trackInfo,
      'returns trackInfo with trackinfo event'
    );
    assert.ok(
      messages.shift().gopInfo,
      'returns gopInfo with gopInfo event'
    );
    assert.ok(
      messages.shift().videoSegmentTimingInfo,
      'returns timing information with videoSegmentTimingInfo event'
    );
    assert.ok(
      messages.shift().videoTimingInfo,
      'returns timing information with videoTimingInfo event'
    );

    const data1 = messages.shift();

    assert.ok(
      data1.segment.data.byteLength > 0,
      'returns data with the 1st data event'
    );
    assert.ok(
      data1.segment.type,
      'video',
      'returns video data with the 1st data event'
    );
    assert.ok(
      messages.shift().audioSegmentTimingInfo,
      'returns timing information with audioSegmentTimingInfo event'
    );
    assert.ok(
      messages.shift().audioTimingInfo,
      'returns timing information with audioTimingInfo event'
    );

    const data2 = messages.shift();

    assert.ok(
      data2.segment.data.byteLength > 0,
      'returns data with the 2nd data event'
    );
    assert.ok(
      data2.segment.type,
      'returns audio bytes with the 2nd data event'
    );

    testDone();
  };

  this.transmuxer = createTransmuxer();
  this.transmuxer.onmessage = handleMessages;

  this.transmuxer.postMessage({
    action: 'push',
    data: muxedSegment()
  });

  this.transmuxer.postMessage({
    action: 'flush'
  });
});

QUnit.test('reset will clear transmuxer', function(assert) {
  const done = assert.async();
  const messages = [];

  this.transmuxer = createTransmuxer();
  this.transmuxer.onmessage = (e) => {
    messages.push(e.data);

    if (!isFinalDone(e)) {
      return;
    }

    assert.deepEqual(
      messages.map((x) => x.action),
      [
        'trackinfo',
        'done',
        'done'
      ],
      'flush after a reset does not return data events'
    );

    done();
  };

  this.transmuxer.postMessage({
    action: 'push',
    data: muxedSegment()
  });
  this.transmuxer.postMessage({
    action: 'reset'
  });
  this.transmuxer.postMessage({
    action: 'flush'
  });
});

QUnit.test('endTimeline will return unflushed data', function(assert) {
  const done = assert.async();
  const messages = [];

  this.transmuxer = createTransmuxer();
  this.transmuxer.onmessage = (e) => {
    messages.push(e.data);

    if (e.data.action !== 'endedtimeline') {
      return;
    }

    assert.deepEqual(
      e.data,
      {
        action: 'endedtimeline',
        type: 'transmuxed'
      },
      'endedtimeline event is received from worker'
    );
    assert.ok(
      messages.filter((x) => x.action === 'data'),
      'data event was returned on endedtimeline'
    );

    done();
  };

  this.transmuxer.postMessage({
    action: 'push',
    data: muxedSegment()
  });

  this.transmuxer.postMessage({
    action: 'endTimeline'
  });
});

QUnit.test('caption events are returned', function(assert) {
  const done = assert.async();
  const messages = [];

  this.transmuxer = createTransmuxer();
  this.transmuxer.onmessage = (e) => {
    messages.push(e.data);

    if (!isFinalDone(e)) {
      return;
    }

    assert.deepEqual(
      messages
        .map((x) => x.action)
        .filter((y) => y === 'trackinfo')
        .length,
      25,
      'expected amount of trackinfo events returned'
    );

    assert.deepEqual(
      messages
        .map((x) => x.action)
        .filter((y) => y !== 'trackinfo'),
      [
        'gopInfo',
        'videoSegmentTimingInfo',
        'videoTimingInfo',
        'data',
        'caption',
        'done',
        'done'
      ],
      'events are returned in expected order'
    );

    assert.deepEqual(
      messages.shift().trackInfo,
      {
        hasVideo: true,
        hasAudio: false
      },
      'trackinfo should have video only'
    );
    assert.ok(
      messages[24].gopInfo,
      'gopInfo event has gopInfo'
    );

    assert.ok(
      messages[25].videoSegmentTimingInfo,
      'videoSegmentTimingInfo event has timing info'
    );
    assert.ok(
      messages[26].videoTimingInfo,
      'videoTimingInfo event has timing info'
    );
    assert.ok(
      messages[27].segment.data.byteLength > 0,
      'data event returns data'
    );
    assert.deepEqual(
      messages[28].caption,
      {
        content: [{
          line: 15,
          position: 45,
          text: 'Bip!'
        }],
        stream: 'CC1',
        startPts: 157500,
        endPts: 175500,
        startTime: 1.75,
        endTime: 1.95
      },
      'caption event returns expected caption'
    );

    done();
  };

  this.transmuxer.postMessage({
    action: 'push',
    data: captionSegment()
  });
  this.transmuxer.postMessage({
    action: 'flush'
  });
});

QUnit.test('can parse mp4 captions', function(assert) {
  const done = assert.async();
  const data = mp4CaptionsSegment();

  this.transmuxer = createTransmuxer();
  this.transmuxer.onmessage = (e) => {
    const message = e.data;

    assert.equal(message.action, 'mp4Captions', 'returned mp4Captions event');
    assert.deepEqual(message.captions.length, 2, 'two captions');
    assert.deepEqual(message.logs.length, 0, 'no logs returned');
    assert.deepEqual(
      new Uint8Array(message.data),
      data,
      'data returned to main thread'
    );

    done();
  };

  this.transmuxer.postMessage({
    action: 'pushMp4Captions',
    data,
    timescales: 30000,
    trackIds: [1],
    byteLength: data.byteLength,
    byteOffset: 0
  });
});

QUnit.test('returns empty array without mp4 captions', function(assert) {
  const done = assert.async();
  const data = muxedSegment();

  this.transmuxer = createTransmuxer();
  this.transmuxer.onmessage = (e) => {
    const message = e.data;

    assert.equal(message.action, 'mp4Captions', 'returned mp4Captions event');
    assert.deepEqual(message.captions, [], 'no captions');
    assert.deepEqual(
      new Uint8Array(message.data),
      data,
      'data returned to main thread'
    );

    done();
  };

  this.transmuxer.postMessage({
    action: 'pushMp4Captions',
    data,
    timescales: 30000,
    trackIds: [1],
    byteLength: data.byteLength,
    byteOffset: 0
  });
});

QUnit.test('can parse mp4 webvtt segments', function(assert) {
  const done = assert.async();
  const initSegment = webVttInit();
  const segment = webVttSegment();

  this.transmuxer = createTransmuxer();
  this.transmuxer.onmessage = (e) => {
    const message = e.data;
    const expectedCues = [
      {
        cueText: '2024-10-16T05:13:50Z\nen # 864527815',
        end: 1729055630.9,
        settings: undefined,
        start: 1729055630
      },
      {
        cueText: '2024-10-16T05:13:51Z\nen # 864527815',
        end: 1729055631.9,
        settings: undefined,
        start: 1729055631
      }
    ];

    assert.equal(message.action, 'getMp4WebVttText', 'returned getMp4WebVttText event');
    assert.deepEqual(message.mp4VttCues, expectedCues, 'mp4 vtt cues are expected values');

    done();
  };

  this.transmuxer.postMessage({
    action: 'initMp4WebVttParser',
    data: initSegment
  });

  this.transmuxer.postMessage({
    action: 'getMp4WebVttText',
    data: segment
  });
});

QUnit.test('returns empty webVttCues array if segment is empty', function(assert) {
  const done = assert.async();
  const initSegment = webVttInit();
  const segment = new Uint8Array();
  const secondSegment = webVttSegment();
  let callCount = 0;

  this.transmuxer = createTransmuxer();
  this.transmuxer.onmessage = (e) => {
    const message = e.data;

    callCount++;
    if (callCount === 2) {
      const secondExpectedCues = [
        {
          cueText: '2024-10-16T05:13:50Z\nen # 864527815',
          end: 1729055630.9,
          settings: undefined,
          start: 1729055630
        },
        {
          cueText: '2024-10-16T05:13:51Z\nen # 864527815',
          end: 1729055631.9,
          settings: undefined,
          start: 1729055631
        }
      ];

      assert.deepEqual(message.mp4VttCues, secondExpectedCues, 'mp4 vtt cues are expected values');
      done();
    } else {
      const expectedCues = [];

      assert.equal(message.action, 'getMp4WebVttText', 'returned getMp4WebVttText event');
      assert.deepEqual(message.mp4VttCues, expectedCues, 'mp4 vtt cues are expected values');

      this.transmuxer.postMessage({
        action: 'getMp4WebVttText',
        data: secondSegment
      });
    }
  };

  this.transmuxer.postMessage({
    action: 'initMp4WebVttParser',
    data: initSegment
  });

  this.transmuxer.postMessage({
    action: 'getMp4WebVttText',
    data: segment
  });
});

QUnit.module('Transmuxer Worker: Partial Transmuxer', {
  beforeEach(assert) {
    assert.timeout(5000);
  },
  afterEach(assert) {
    if (this.transmuxer) {
      this.transmuxer.terminate();
      delete this.transmuxer;
    }
  }
});
