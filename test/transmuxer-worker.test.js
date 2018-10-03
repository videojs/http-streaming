import QUnit from 'qunit';
import TransmuxWorker from 'worker!../src/transmuxer-worker.worker.js';
import {
  muxed as muxedSegment
} from './test-segments';
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

QUnit.module('Transmuxer Worker', {
  beforeEach(assert) {
    this.transmuxer = null;
  },
  afterEach(assert) {
    if (this.transmuxer) {
      this.transmuxer.terminate();
    }
  }
});

/**
 * Full Transmuxer
 **/

// Missing tests as these are not accessible to unit testing
// - setTimestampOffset
// - setAudioAppendStart
// - alignGopsWith

QUnit.test('full: push should result in a trackinfo event', function(assert) {
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

QUnit.test('full: flush should return data from transmuxer',
  function(assert) {
  const testDone = assert.async();
  const messages = [];
  const handleMessages = (e) => {
    messages.push(e.data);

    if (!isFinalDone(e)) {
      return;
    }

    let data1;
    let data2;

    assert.deepEqual(
      messages.map((x) => x.action),
      [
        'trackinfo',
        'gopInfo',
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
      messages.shift().videoTimingInfo,
      'returns timing information with videoTimingInfo event'
    );

    data1 = messages.shift();

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

    data2 = messages.shift();

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

QUnit.test('full: reset will clear transmuxer', function(assert) {
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

QUnit.test('full: endTimeline will return unflushed data',
  function(assert) {
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

/**
 * Partial Transmuxer
 **/

// Missing tests as these are not accessible to unit testing
// - setTimestampOffset
// - setAudioAppendStart
// - alignGopsWith

QUnit.test('partial: push should result in a trackinfo event', function(assert) {
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

QUnit.test('partial: flush should return data from transmuxer',
  function(assert) {
  const testDone = assert.async();
  const messages = [];

  const handleMessages = (e) => {
    messages.push(e.data);

    if (!isFinalDone(e)) {
      return;
    }

    let trackInfoEvent;
    let videoTimingInfoEvent;
    let data1;
    let data2;
    let done1;
    let audioTimingInfoEvent;
    let data3;
    let audioTimingInfoEvent2;
    let done2;

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

    trackInfoEvent = messages.shift();
    videoTimingInfoEvent = messages.shift();
    data1 = messages.shift();
    data2 = messages.shift();
    done1 = messages.shift();
    audioTimingInfoEvent = messages.shift();
    data3 = messages.shift();
    audioTimingInfoEvent2 = messages.shift();
    done2 = messages.shift();

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

QUnit.test('partial: reset will clear transmuxer', function(assert) {
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

QUnit.test('partial: endTimeline will return unflushed data',
  function(assert) {
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

// This test should pass but potentially does not have enough data?
// Often needs at least 3 video frames, and potentially needs up to
// 13 audio frames to return respective timingInfo
QUnit.skip('partial: partialFlush', function(assert) {
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

    let trackInfoEvent;
    let videoTimingInfoEvent;
    let data1;
    let partialdone1;
    let audioTimingInfoEvent;
    let data2;
    let audioTimingInfoEvent2;
    let partialdone2;

    assert.deepEqual(
      messages.map((x) => x.action),
      [
        'trackinfo',
        'videoTimingInfo',
        'data',
        'partialdone',
        'audioTimingInfo',
        'data',
        'audioTimingInfo',
        'partialdone',
        'done'
      ],
      'the events are received in the expected order'
    );

    trackInfoEvent = messages.shift();
    videoTimingInfoEvent = messages.shift();
    data1 = messages.shift();
    partialdone1 = messages.shift();
    audioTimingInfoEvent = messages.shift();
    data2 = messages.shift();
    audioTimingInfoEvent2 = messages.shift();
    partialdone2 = messages.shift();

    assert.deepEqual(
      trackInfoEvent,
      {
        action: 'trackinfo',
        trackInfo: {
          hasAudio: true,
          hasVideo: true
        }
      },
      'trackInfo is returned for partialFlush'
    );
    assert.deepEqual(
      videoTimingInfoEvent,
      {
        action: 'videoTimingInfo',
        videoTimingInfo: 3
      },
      'video timing data is returned with videoTimingInfo event'
    );
    assert.ok(
      data1.segment.boxes.byteLength > 0,
      '1st data event has data'
    );
    assert.equal(
      data1.segment.type,
      'video',
      '1st data event is for video'
    );
    assert.deepEqual(
      partialdone1,
      {
        action: 'partialdone',
        type: 'video'
      },
      'video partialdone is received separately'
    );
    assert.deepEqual(
      Object.keys(audioTimingInfoEvent.audioTimingInfo),
      ['start'],
      '1st audioTimingInfo event only has startTime'
    );
    assert.ok(
      data2.segment.boxes.byteLength > 0,
      '2nd data event has data'
    );
    assert.equal(
      data2.segment.type,
      'audio',
      '2nd data event is for audio'
    );
    assert.deepEqual(
      Object.keys(audioTimingInfoEvent2.audioTimingInfo),
      ['start', 'end'],
      '2nd audioTimingInfo event has startTime and endTime'
    );
    assert.deepEqual(
      partialdone2,
      {
        action: 'partialdone',
        type: 'audio'
      },
      'audio partialdone is received separately'
    );
    assert.deepEqual(
      messages.shift(),
      {
        action: 'partialdone',
        type: 'transmuxed'
      },
      'final partialdone event is received from transmuxer'
    );

    done();
  };

  this.transmuxer.postMessage({
    action: 'push',
    data: muxedSegment()
  });

  this.transmuxer.postMessage({
    action: 'partialFlush'
  });
});
