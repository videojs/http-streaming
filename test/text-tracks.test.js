import Qunit from 'qunit';
import sinon from 'sinon';
import {
  createCaptionsTrackIfNotExists,
  addCaptionData,
  createMetadataTrackIfNotExists,
  addMetadata,
  removeDuplicateCuesFromTrack,
  addDateRangeMetadata
} from '../src/util/text-tracks';

const { module, test } = Qunit;

class MockTextTrack {
  constructor(opts = {}) {
    Object.keys(opts).forEach((opt) => (this[opt] = opts[opt]));
    this.cues = [];
  }
  addCue(cue) {
    this.cues.push(cue);
  }
  removeCue(cue) {
    const cueIndex = this.cues.map(c => c.text).indexOf(cue.text);

    this.cues.splice(cueIndex, 1);
  }
}

class MockTech {
  constructor() {
    this.options_ = {};
    this.tracks = {
      getTrackById(id) {
        return this[id];
      }
    };
  }
  addRemoteTextTrack(opts) {
    this.tracks[opts.id] = new MockTextTrack(opts);
    return { track: this.tracks[opts.id] };
  }
  trigger() {}
  textTracks() {
    return this.tracks;
  }
}

module('Text Tracks', {
  beforeEach() {
    this.inbandTextTracks = {
      CC1: new MockTextTrack(),
      CC2: new MockTextTrack(),
      CC3: new MockTextTrack(),
      CC4: new MockTextTrack(),
      metadataTrack_: new MockTextTrack()
    };
    this.timestampOffset = 0;
  }
});

test('creates a track if it does not exist yet', function(assert) {
  const inbandTracks = {};
  const tech = new MockTech();

  createCaptionsTrackIfNotExists(inbandTracks, tech, 'CC1');
  assert.ok(inbandTracks.CC1, 'CC1 track was added');
});

test('creates a 708 track if it does not exist yet', function(assert) {
  const inbandTracks = {};
  const tech = new MockTech();

  createCaptionsTrackIfNotExists(inbandTracks, tech, 'cc708_1');
  assert.ok(inbandTracks.cc708_1, 'cc708_1 track was added');
});

test('maps mux.js 708 track name to HLS and DASH service name', function(assert) {
  const inbandTracks = {};
  const tech = new MockTech();

  createCaptionsTrackIfNotExists(inbandTracks, tech, 'cc708_1');
  assert.ok(inbandTracks.cc708_1, 'cc708_1 track was added');
  assert.equal(inbandTracks.cc708_1.id, 'SERVICE1', 'SERVICE1 created from cc708_1');
  createCaptionsTrackIfNotExists(inbandTracks, tech, 'cc708_3');
  assert.ok(inbandTracks.cc708_3, 'cc708_3 track was added');
  assert.equal(inbandTracks.cc708_3.id, 'SERVICE3', 'SERVICE3 created from cc708_3');
});

test('can override caption services settings', function(assert) {
  const inbandTracks = {};
  const tech = new MockTech();

  tech.options_ = {
    vhs: {
      captionServices: {
        SERVICE1: {
          label: 'hello'
        },
        CC1: {
          label: 'goodbye'
        }
      }
    }
  };

  createCaptionsTrackIfNotExists(inbandTracks, tech, 'cc708_1');
  assert.equal(inbandTracks.cc708_1.label, 'hello', 'we set a custom label for SERVICE1');
  createCaptionsTrackIfNotExists(inbandTracks, tech, 'CC1');
  assert.equal(inbandTracks.CC1.label, 'goodbye', 'we set a custom label for CC1');
});

test('fills inbandTextTracks if a track already exists', function(assert) {
  const inbandTracks = {};
  const tech = new MockTech();
  const track = tech.addRemoteTextTrack({kind: 'captions', id: 'CC1', label: 'CC1'});

  createCaptionsTrackIfNotExists(inbandTracks, tech, 'CC1');
  assert.ok(inbandTracks.CC1, 'CC1 track is now available on inbandTextTracks');
  assert.strictEqual(inbandTracks.CC1, track.track);
});

test('does nothing if no captions are specified', function(assert) {
  addCaptionData({
    inbandTextTracks: this.inbandTextTracks,
    timestampOffset: this.timestampOffset,
    captionArray: []
  });
  assert.strictEqual(this.inbandTextTracks.CC1.cues.length, 0, 'added no 608 cues');
});

test('creates cues for 608 captions with "stream" property in ccX', function(assert) {
  addCaptionData({
    inbandTextTracks: this.inbandTextTracks,
    timestampOffset: this.timestampOffset,
    captionArray: [{
      startTime: 0,
      endTime: 1,
      text: 'CC1 text',
      stream: 'CC1'
    }, {
      startTime: 0,
      endTime: 1,
      text: 'CC2 text',
      stream: 'CC2'
    }, {
      startTime: 0,
      endTime: 1,
      text: 'CC3 text',
      stream: 'CC3'
    }, {
      startTime: 0,
      endTime: 1,
      text: 'CC4 text',
      stream: 'CC4'
    }]
  });
  assert.strictEqual(
    this.inbandTextTracks.CC1.cues.length,
    1,
    'added one 608 cue to CC1'
  );
  assert.strictEqual(
    this.inbandTextTracks.CC2.cues.length,
    1,
    'added one 608 cue to CC2'
  );
  assert.strictEqual(
    this.inbandTextTracks.CC3.cues.length,
    1,
    'added one 608 cue to CC3'
  );
  assert.strictEqual(
    this.inbandTextTracks.CC4.cues.length,
    1,
    'added one 608 cue to CC4'
  );
  assert.strictEqual(
    this.inbandTextTracks.metadataTrack_.cues.length,
    0,
    'added no metadata cues'
  );
});

test('creates cues for 608 captions with "content" property for positioning', function(assert) {
  addCaptionData({
    inbandTextTracks: this.inbandTextTracks,
    timestampOffset: this.timestampOffset,
    captionArray: [
      {
        startTime: 0,
        endTime: 1,
        content: [
          {
            text: 'CC1',
            position: 10,
            line: 15
          },
          {
            text: 'text',
            position: 15,
            line: 14
          }
        ],
        stream: 'CC1'
      },
      {
        startTime: 0,
        endTime: 1,
        content: [{
          text: 'CC2 text',
          position: 80,
          line: 1
        }],
        stream: 'CC2'
      }
    ]
  });

  // CC1
  assert.strictEqual(this.inbandTextTracks.CC1.cues.length, 2, 'added two 608 cues to CC1');

  // CC1 cue 1
  assert.strictEqual(this.inbandTextTracks.CC1.cues[0].text, 'CC1', 'added text to first cue in CC1');
  assert.strictEqual(this.inbandTextTracks.CC1.cues[0].line, 15, 'added line to first cue in CC1');
  assert.strictEqual(this.inbandTextTracks.CC1.cues[0].position, 10, 'added position to first cue in CC1');

  // CC1 cue 2
  assert.strictEqual(this.inbandTextTracks.CC1.cues[1].text, 'text', 'added text to second cue in CC1');
  assert.strictEqual(this.inbandTextTracks.CC1.cues[1].line, 14, 'added line to second cue in CC1');
  assert.strictEqual(this.inbandTextTracks.CC1.cues[1].position, 15, 'added position to second cue in CC1');

  // CC2
  assert.strictEqual(this.inbandTextTracks.CC2.cues.length, 1, 'added one 608 cue to CC2');
  assert.strictEqual(this.inbandTextTracks.CC2.cues[0].text, 'CC2 text', 'added text to CC2');
  assert.strictEqual(this.inbandTextTracks.CC2.cues[0].line, 1, 'added line to CC2');
  assert.strictEqual(this.inbandTextTracks.CC2.cues[0].position, 80, 'added position to CC2');
  assert.strictEqual(this.inbandTextTracks.CC2.cues[0].align, 'left', 'left align 608 cues');
  assert.strictEqual(this.inbandTextTracks.CC2.cues[0].positionAlign, 'line-left', 'left align position on 608 cues');
});

test('use existing tracks with id equal to CC#', function(assert) {
  const tech = new MockTech();
  const inbandTextTracks = {};
  const CC2 = tech.addRemoteTextTrack({
    kind: 'captions',
    label: 'CC2',
    id: 'CC2'
  });
  const captionArray = [{
    stream: 'CC2',
    startTime: 1,
    endTime: 3,
    text: 'This is an in-band caption in CC2'
  }];

  this.timestampOffset = 10;

  // Wrap the addRemoteTextTrack method after adding tracks
  // to the tech to ensure that any calls on the spy are the
  // result of createCaptionsTrackIfNotExists
  const addRemoteTextTrackSpy = sinon.spy(tech, 'addRemoteTextTrack');

  createCaptionsTrackIfNotExists(inbandTextTracks, tech, 'CC2');
  assert.strictEqual(inbandTextTracks.CC2, CC2.track);
  assert.strictEqual(addRemoteTextTrackSpy.callCount, 0);

  addCaptionData({
    inbandTextTracks,
    timestampOffset: this.timestampOffset,
    captionArray
  });

  assert.strictEqual(addRemoteTextTrackSpy.callCount, 0, 'no tracks were created');
  assert.strictEqual(CC2.track.cues.length, 1, 'CC2 contains 1 cue');
  assert.strictEqual(
    CC2.track.cues[0].text,
    'This is an in-band caption in CC2',
    'CC2 contains the right cue'
  );
});

test('creates a track if it does not exist yet', function(assert) {
  const tech = new MockTech();
  const inbandTextTracks = {};
  const dispatchType = 0x10;

  this.timestampOffset = 10;
  createMetadataTrackIfNotExists(inbandTextTracks, dispatchType, tech);

  assert.ok(inbandTextTracks.metadataTrack_, 'created the metadataTrack');
});

test('does nothing if there is no metadataTrack or no metadata cues given', function(assert) {
  const tech = new MockTech();
  const inbandTextTracks = {};
  const dispatchType = 0x10;
  const videoDuration = 20;

  this.timestampOffset = 10;
  addMetadata({
    inbandTextTracks,
    metadataArray: [{
      cueTime: 14,
      frames: [{
        data: 'This is a priv tag'
      }]
    }],
    timestampOffset: this.timestampOffset,
    videoDuration
  });

  assert.strictEqual(
    Object.keys(inbandTextTracks).length,
    0,
    'no metadata track'
  );

  createMetadataTrackIfNotExists(inbandTextTracks, dispatchType, tech);
  addMetadata({
    inbandTextTracks,
    metadataArray: [],
    timestampOffset: this.timestampOffset,
    videoDuration
  });

  assert.ok(inbandTextTracks.metadataTrack_, 'metadataTrack exists');
  assert.strictEqual(
    inbandTextTracks.metadataTrack_.cues.length,
    0,
    'no metadata cues are added'
  );
});

test('daterange text track cues', function(assert) {
  const inbandTextTracks = {
    metadataTrack_: new MockTextTrack()
  };
  const dateRanges = [{
    endDate: new Date(5000).toString(),
    endTime: 3,
    id: 'testId',
    plannedDuration: 5,
    processDateRange: () => {},
    scte35Out: '0xFC30200FFF00F0500D00E4612424',
    startDate: new Date(2500),
    startTime: 0.5
  }];

  inbandTextTracks.metadataTrack_.cues_ = [];
  addDateRangeMetadata({
    inbandTextTracks,
    dateRanges
  });

  const expectedCues = [{
    type: 'com.apple.quicktime.HLS',
    value: {key: 'PLANNED-DURATION', data: 5},
    endTime: 3,
    id: 'testId',
    startTime: 0.5
  }, {
    type: 'com.apple.quicktime.HLS',
    value: {key: 'SCTE35-OUT', data: new Uint8Array((dateRanges[0].scte35Out).match(/[\dA-F]{2}/gi)).buffer},
    endTime: 3,
    id: 'testId',
    startTime: 0.5
  }];
  const actualCues = inbandTextTracks.metadataTrack_.cues.map((cue)=>{
    return {
      type: cue.type,
      value: {key: cue.value.key, data: cue.value.data},
      endTime: cue.endTime,
      id: cue.id,
      startTime: cue.startTime
    };
  });

  assert.ok(inbandTextTracks.metadataTrack_, 'metadataTrack exists');
  assert.equal(inbandTextTracks.metadataTrack_.cues.length, 2, '2 daterange cues are created');
  assert.deepEqual(actualCues, expectedCues);
});

test('daterange text track cues -scte35Out/scte35In', function(assert) {
  const inbandTextTracks = {
    metadataTrack_: new MockTextTrack()
  };
  const dateRanges = [{
    endDate: new Date(5000).toString(),
    endTime: 3,
    id: 'testId',
    processDateRange: () => {},
    scte35Out: '0xFC30200FFF1',
    startDate: new Date(2500),
    startTime: 0.5
  }, {
    endDate: new Date(5000).toString(),
    endTime: 3,
    id: 'testId',
    processDateRange: () => {},
    scte35In: '0xFC30200FFF2',
    startDate: new Date(2500),
    startTime: 0.5
  }];

  inbandTextTracks.metadataTrack_.cues_ = [];
  addDateRangeMetadata({
    inbandTextTracks,
    dateRanges
  });

  const expectedCues = [{
    type: 'com.apple.quicktime.HLS',
    value: {key: 'SCTE35-OUT', data: new Uint8Array((dateRanges[0].scte35Out).match(/[\dA-F]{2}/gi)).buffer},
    endTime: 3,
    id: 'testId',
    startTime: 0.5
  }, {
    type: 'com.apple.quicktime.HLS',
    value: {key: 'SCTE35-IN', data: new Uint8Array((dateRanges[1].scte35In).match(/[\dA-F]{2}/gi)).buffer},
    endTime: 3,
    id: 'testId',
    startTime: 0.5
  }];
  const actualCues = inbandTextTracks.metadataTrack_.cues.map((cue)=>{
    return {
      type: cue.type,
      value: {key: cue.value.key, data: cue.value.data},
      endTime: cue.endTime,
      id: cue.id,
      startTime: cue.startTime
    };
  });

  assert.ok(inbandTextTracks.metadataTrack_, 'metadataTrack exists');
  assert.equal(inbandTextTracks.metadataTrack_.cues.length, 2, '2 daterange cues are created');
  assert.deepEqual(actualCues, expectedCues);
});

test('adds cues for each metadata frame seen', function(assert) {
  const tech = new MockTech();
  const inbandTextTracks = {};
  const dispatchType = 0x10;
  const videoDuration = 20;
  const metadataArray = [
    {
      cueTime: 2,
      frames: [
        { url: 'This is a url tag' },
        { value: 'This is a text tag' }
      ]
    },
    {
      cueTime: 14,
      frames: [{
        data: 'This is a priv tag'
      }]
    }
  ];

  this.timestampOffset = 10;
  createMetadataTrackIfNotExists(inbandTextTracks, dispatchType, tech);
  addMetadata({
    inbandTextTracks,
    metadataArray,
    timestampOffset: this.timestampOffset,
    videoDuration
  });

  const metadataTrack = inbandTextTracks.metadataTrack_;

  assert.strictEqual(
    metadataTrack.cues[0].text,
    'This is a url tag',
    'included the text'
  );
  assert.strictEqual(
    metadataTrack.cues[0].startTime,
    2 + 10,
    'started at 12'
  );
  assert.strictEqual(
    metadataTrack.cues[0].endTime,
    14 + 10,
    'ended at StartTime of next cue(24)'
  );

  assert.strictEqual(
    metadataTrack.cues[1].text,
    'This is a text tag',
    'included the text'
  );
  assert.strictEqual(
    metadataTrack.cues[1].startTime,
    2 + 10,
    'started at 12'
  );
  assert.strictEqual(
    metadataTrack.cues[1].endTime,
    14 + 10,
    'ended at the startTime of next cue(24)'
  );

  assert.strictEqual(
    metadataTrack.cues[2].text,
    'This is a priv tag',
    'included the text'
  );
  assert.strictEqual(
    metadataTrack.cues[2].startTime,
    14 + 10,
    'started at 24'
  );
  assert.strictEqual(
    metadataTrack.cues[2].endTime,
    videoDuration,
    'ended at duration 20'
  );
});

test('removeDuplicateCuesFromTrack removes all but one cue with identical startTime, endTime, and text', function(assert) {
  const track = new MockTextTrack();

  [{
    startTime: 0,
    endTime: 1,
    text: 'CC1 text'
  }, {
    startTime: 1,
    endTime: 2,
    text: 'Identical'
  }, {
    startTime: 1,
    endTime: 2,
    text: 'Identical'
  }, {
    startTime: 1,
    endTime: 2,
    text: 'Identical'
  }, {
    startTime: 1,
    endTime: 2,
    text: 'Identical'
  }, {
    startTime: 2,
    endTime: 3,
    text: 'CC3 text'
  }].forEach((mockCue) => {
    track.addCue(mockCue);
  });

  assert.equal(track.cues.length, 6, '6 cues present initially');

  removeDuplicateCuesFromTrack(track);

  assert.equal(track.cues.length, 3, '3 cue remains after duplicates removed');
});

test('removeDuplicateCuesFromTrack leaves in cues with the same startTime and endTime, but different text-- or vice-versa', function(assert) {
  const track = new MockTextTrack();

  [{
    startTime: 0,
    endTime: 1,
    text: 'Identical'
  }, {
    startTime: 0,
    endTime: 1,
    text: 'Identical'
  }, {
    startTime: 0,
    endTime: 1,
    text: 'CC2 text'
  }, {
    startTime: 0,
    endTime: 1,
    text: 'CC3 text'
  }, {
    startTime: 1,
    endTime: 2,
    text: 'Also identical'
  }, {
    startTime: 1,
    endTime: 2,
    text: 'Also identical'
  }].forEach((mockCue) => {
    track.addCue(mockCue);
  });

  assert.equal(track.cues.length, 6, '6 cues present initially');

  removeDuplicateCuesFromTrack(track);

  assert.equal(track.cues.length, 4, '4 cues remain after duplicates removed');
});
