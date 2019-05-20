import Qunit from 'qunit';
import sinon from 'sinon';
import {
  createCaptionsTrackIfNotExists,
  addCaptionData,
  createMetadataTrackIfNotExists,
  addMetadata
} from '../src/util/text-tracks';

const { module, test } = Qunit;

class MockTextTrack {
  constructor() {
    this.cues = [];
  }
  addCue(cue) {
    this.cues.push(cue);
  }
}

class MockTech {
  constructor() {
    this.tracks = {
      getTrackById(id) {
        return this[id];
      }
    };
  }
  addRemoteTextTrack({kind, id, label}) {
    this.tracks[id] = new MockTextTrack();
    return { track: this.tracks[id] };
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
  assert.strictEqual(this.inbandTextTracks.CC1.cues.length,
                     1,
                     'added one 608 cue to CC1');
  assert.strictEqual(this.inbandTextTracks.CC2.cues.length,
                     1,
                     'added one 608 cue to CC2');
  assert.strictEqual(this.inbandTextTracks.CC3.cues.length,
                     1,
                     'added one 608 cue to CC3');
  assert.strictEqual(this.inbandTextTracks.CC4.cues.length,
                     1,
                     'added one 608 cue to CC4');
  assert.strictEqual(this.inbandTextTracks.metadataTrack_.cues.length,
                     0,
                     'added no metadata cues');
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
  let addRemoteTextTrackSpy;

  this.timestampOffset = 10;

  // Wrap the addRemoteTextTrack method after adding tracks
  // to the tech to ensure that any calls on the spy are the
  // result of createCaptionsTrackIfNotExists
  addRemoteTextTrackSpy = sinon.spy(tech, 'addRemoteTextTrack');

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
    'included the text');
  assert.strictEqual(
    metadataTrack.cues[1].startTime,
    2 + 10,
    'started at 12');
  assert.strictEqual(
    metadataTrack.cues[1].endTime,
    14 + 10,
    'ended at the startTime of next cue(24)');

  assert.strictEqual(
    metadataTrack.cues[2].text,
    'This is a priv tag',
    'included the text');
  assert.strictEqual(
    metadataTrack.cues[2].startTime,
    14 + 10,
    'started at 24');
  assert.strictEqual(
    metadataTrack.cues[2].endTime,
    videoDuration,
    'ended at duration 20');
});
