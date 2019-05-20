import Qunit from 'qunit';
import {
  addMetadata,
  addCaptionData
} from '../../src/util/text-tracks';

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

test('does nothing if no metadata is specified', function(assert) {
  addMetadata({
    inbandTextTracks: this.inbandTextTracks,
    timestampOffset: this.timestampOffset,
    videoDuration: this.videoDuration,
    metadataArray: []
  });
  assert.strictEqual(this.inbandTextTracks.metadataTrack_.cues.length,
                     0,
                     'added no metadata cues');
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

test('creates cues for timed metadata', function(assert) {
  addMetadata({
    inbandTextTracks: this.inbandTextTracks,
    timestampOffset: this.timestampOffset,
    videoDuration: 1,
    metadataArray: [{
      cueTime: 1,
      frames: [{}]
    }]
  });
  assert.strictEqual(this.inbandTextTracks.CC1.cues.length, 0, 'added no 608 cues');
  assert.strictEqual(this.inbandTextTracks.metadataTrack_.cues.length,
                     1,
                     'added one metadata cues');
});
