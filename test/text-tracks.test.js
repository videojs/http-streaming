import Qunit from 'qunit';
import {
  createCaptionsTrackIfNotExists,
  addCaptionData
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
    this.videoDuration = NaN;
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
    videoDuration: this.videoDuration,
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
