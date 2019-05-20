import Qunit from 'qunit';
import { addTextTrackData } from '../../src/util/text-tracks.js';

const { module, test } = Qunit;

class MockTextTrack {
  constructor() {
    this.cues = [];
  }
  addCue(cue) {
    this.cues.push(cue);
  }
}

module('Text Track Data', {
  beforeEach() {
    this.sourceHandler = {
      inbandTextTracks_: {
        CC1: new MockTextTrack(),
        CC2: new MockTextTrack(),
        CC3: new MockTextTrack(),
        CC4: new MockTextTrack()
      },
      metadataTrack_: new MockTextTrack(),
      mediaSource_: {
        duration: NaN
      },
      timestampOffset: 0
    };
  }
});

test('does nothing if no cues are specified', function(assert) {
  addTextTrackData(this.sourceHandler, [], []);
  assert.strictEqual(this.sourceHandler.inbandTextTracks_.CC1.cues.length, 0, 'added no 608 cues');
  assert.strictEqual(this.sourceHandler.metadataTrack_.cues.length, 0, 'added no metadata cues');
});

test('creates cues for 608 captions with "stream" property in ccX', function(assert) {
  addTextTrackData(this.sourceHandler, [{
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
  }], []);
  assert.strictEqual(this.sourceHandler.inbandTextTracks_.CC1.cues.length, 1, 'added one 608 cue to CC1');
  assert.strictEqual(this.sourceHandler.inbandTextTracks_.CC2.cues.length, 1, 'added one 608 cue to CC2');
  assert.strictEqual(this.sourceHandler.inbandTextTracks_.CC3.cues.length, 1, 'added one 608 cue to CC3');
  assert.strictEqual(this.sourceHandler.inbandTextTracks_.CC4.cues.length, 1, 'added one 608 cue to CC4');
  assert.strictEqual(this.sourceHandler.metadataTrack_.cues.length, 0, 'added no metadata cues');
});

test('creates cues for timed metadata', function(assert) {
  addTextTrackData(this.sourceHandler, [], [{
    cueTime: 1,
    frames: [{}]
  }]);
  assert.strictEqual(this.sourceHandler.inbandTextTracks_.CC1.cues.length, 0, 'added no 608 cues');
  assert.strictEqual(this.sourceHandler.metadataTrack_.cues.length, 1, 'added one metadata cues');
});
