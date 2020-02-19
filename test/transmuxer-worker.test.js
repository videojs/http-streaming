import QUnit from 'qunit';
import TransmuxWorker from 'worker!../src/transmuxer-worker.worker.js';
import {
  muxed as muxedSegment,
  oneSecond as oneSecondSegment,
  caption as captionSegment
} from 'create-test-data!segments';
// needed for plugin registration
import '../src/videojs-http-streaming';

const createTransmuxer = (isPartial) => {
  const transmuxer = new TransmuxWorker();

  transmuxer.postMessage({
    action: 'init',
    options: {
      remux: false,
      keepOriginalTimestamps: true,
      handlePartialData: isPartial
    }
  });

  return transmuxer;
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

  this.transmuxer = createTransmuxer(false);
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

  this.transmuxer = createTransmuxer(false);
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

  this.transmuxer = createTransmuxer(false);
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

  this.transmuxer = createTransmuxer(false);
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

  this.transmuxer = createTransmuxer(false);
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
        text: 'Bip!',
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

// Missing tests as these are not accessible to unit testing
// - setTimestampOffset
// - setAudioAppendStart
// - alignGopsWith

QUnit.test('push should result in a trackinfo event', function(assert) {
  const done = assert.async();

  this.transmuxer = createTransmuxer(true);
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
        'videoTimingInfo',
        'data',
        'data',
        'done',
        'audioTimingInfo',
        'data',
        'audioTimingInfo',
        'done',
        'done'
      ],
      'the events are received in the expected order'
    );

    const trackInfoEvent = messages.shift();
    const videoTimingInfoEvent = messages.shift();
    const data1 = messages.shift();
    const data2 = messages.shift();
    const done1 = messages.shift();
    const audioTimingInfoEvent = messages.shift();
    const data3 = messages.shift();
    const audioTimingInfoEvent2 = messages.shift();
    const done2 = messages.shift();

    assert.ok(
      trackInfoEvent.trackInfo,
      'returns trackInfo with trackinfo event'
    );
    assert.ok(
      videoTimingInfoEvent.videoTimingInfo,
      'returns timing information with videoTimingInfo event'
    );

    assert.ok(
      data1.segment.boxes.byteLength > 0,
      'returns data with the 1st data event'
    );
    assert.deepEqual(
      data1.segment.type,
      'video',
      'returns video data with the 1st data event'
    );
    assert.ok(
      data2.segment.boxes.byteLength > 0,
      'returns data with the 2nd data event'
    );
    assert.deepEqual(
      data2.segment.type,
      'video',
      'returns video bytes with the 2nd data event'
    );
    assert.deepEqual(
      done1,
      {
        action: 'done',
        type: 'video'
      },
      'got done event for video data only'
    );

    assert.ok(
      audioTimingInfoEvent.audioTimingInfo,
      'returns timing information with audioTimingInfo event'
    );
    assert.deepEqual(
      Object.keys(audioTimingInfoEvent.audioTimingInfo),
      ['start'],
      '1st audioTimingInfo only has startTime'
    );
    assert.ok(
      data3.segment.boxes.byteLength > 0,
      'returns data with audio data event'
    );
    assert.deepEqual(
      data3.segment.type,
      'audio',
      'returns audio bytes with the audio data event'
    );
    assert.ok(
      audioTimingInfoEvent2.audioTimingInfo,
      'returns timing information with 2nd audioTimingInfo event'
    );
    assert.deepEqual(
      Object.keys(audioTimingInfoEvent2.audioTimingInfo),
      ['start', 'end'],
      '2nd audioTimingInfo has startTime and endTime'
    );
    assert.deepEqual(
      done2,
      {
        action: 'done',
        type: 'audio'
      },
      'got done event for audio data only'
    );

    testDone();
  };

  this.transmuxer = createTransmuxer(true);
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

  this.transmuxer = createTransmuxer(true);
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
        // Note: the partial transmuxer differs in behavior
        // with the full transmuxer and will trigger this
        // event even without audio data
        'audioTimingInfo',
        'done',
        'done'
      ],
      'flush after a reset does not return data events'
    );
    assert.deepEqual(
      messages.filter((x) => x.action === 'audioTimingInfo')[0],
      {
        action: 'audioTimingInfo',
        audioTimingInfo: {
          start: null,
          end: null
        }
      },
      'gets invalid/reset data for audioTimingInfo after reset'
    );
    assert.deepEqual(
      messages.filter((x) => x.action === 'done'),
      [
        {
          action: 'done',
          type: 'video'
        },
        {
          action: 'done',
          type: 'audio'
        },
        {
          action: 'done',
          type: 'transmuxed'
        }
      ],
      'gets audio, video and transmuxed done events separately'
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

  this.transmuxer = createTransmuxer(true);
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

QUnit.test('partialFlush', function(assert) {
  const done = assert.async();
  const messages = [];
  const isFinalPartialDone = (e) => {
    return e.data.action === 'partialdone' &&
      e.data.type === 'transmuxed';
  };

  this.transmuxer = createTransmuxer(true);
  this.transmuxer.onmessage = (e) => {
    messages.push(e.data);

    if (!isFinalPartialDone(e)) {
      return;
    }

    assert.deepEqual(
      messages.map((x) => x.action),
      [
        'trackinfo', 'trackinfo', 'trackinfo',
        'trackinfo', 'trackinfo', 'trackinfo',
        'videoTimingInfo',
        'data', 'data', 'data', 'data', 'data', 'data',
        'data', 'data', 'data', 'data', 'data', 'data',
        'data', 'data', 'data', 'data', 'data', 'data',
        'data', 'data', 'data', 'data', 'data', 'data',
        'data', 'data', 'data', 'data',
        'partialdone',
        'audioTimingInfo',
        'data',
        'partialdone',
        'partialdone'
      ],
      'the events are received in the expected order'
    );

    const partialdones = [];

    messages.forEach(function(m) {
      const expected = {action: m.action};

      if (m.action === 'trackinfo') {
        expected.trackInfo = {hasAudio: true, hasVideo: true};
      } else if (m.action === 'videoTimingInfo') {
        expected.videoTimingInfo = {end: 2.300911111111111, start: 1.4};
      } else if (m.action === 'audioTimingInfo') {
        expected.audioTimingInfo = {start: 1.4};
      } else if (m.action === 'data') {
        assert.ok(m.segment.boxes.byteLength > 0, 'box has bytes');
        assert.ok(m.segment.initSegment.byteLength > 0, 'init segment has bytes');

        if (m.segment.type === 'video') {
          assert.ok(m.segment.videoFrameDtsTime > 0, 'has video frame dts time');
        }
        return;
      } else if (m.action === 'partialdone') {
        partialdones.push(m);
        return;
      }
      assert.deepEqual(m, expected, `${m.action} as expected`);
    });

    assert.deepEqual(partialdones, [
      {action: 'partialdone', type: 'video'},
      {action: 'partialdone', type: 'audio'},
      {action: 'partialdone', type: 'transmuxed'}
    ]);

    done();
  };

  this.transmuxer.postMessage({
    action: 'push',
    data: oneSecondSegment()
  });

  this.transmuxer.postMessage({
    action: 'partialFlush'
  });
});
