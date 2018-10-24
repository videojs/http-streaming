import QUnit from 'qunit';
import sinon from 'sinon';
import {
  getStreamTime
} from '../../src/util/time.js';

QUnit.module('Time: getStreamTime', {
  beforeEach(assert) {
    this.player = {
      currentTime() {
        return 1;
      }
    };
    this.playlist = {};
  },
  afterEach(assert) {
    delete this.player;
    delete this.playlist;
  }
});

QUnit.test('getStreamTime should return an object', function(assert) {
  assert.equal(
    typeof getStreamTime({
      player: this.player,
      playlist: this.playlist
    }),
    'object'
  );
});

QUnit.test('should return mediaSeconds and programDateTime', function(assert) {
  const streamTime = getStreamTime({
    player: this.player,
    playlist: this.playlist,
    time: 5
  });

  assert.ok(
    streamTime.mediaSeconds !== undefined,
    'mediaSeconds is returned'
  );
  assert.ok(
    streamTime.programDateTime !== undefined,
    'programDateTime is returned'
  );
});

QUnit.test('calls callback with mediaSeconds and programDateTime', function(assert) {
  const callbackSpy = sinon.spy();
  const callback = (args) => {
    callbackSpy(args);
    return 'callback';
  };
  const streamTime = getStreamTime({
    player: this.player,
    playlist: this.playlist,
    time: 0,
    callback
  });

  assert.deepEqual(
    callbackSpy.args[0][0],
    {
      mediaSeconds: 0,
      programDateTime: null
    },
    'callback is passed mediaSeconds and programDateTime'
  );
  assert.deepEqual(
    streamTime,
    'callback',
    'getStreamTime returns callback'
  );
});

QUnit.test('returns mediaSeconds and programDateTime if no callback', function(assert) {
  const streamTime = getStreamTime({
    player: this.player,
    playlist: this.playlist,
    time: 4
  });

  assert.deepEqual(
    streamTime,
    {
      mediaSeconds: 4,
      programDateTime: null
    },
    'mediaSeconds and programDateTime returned if no callback'
  );
});

QUnit.test('returns currentTime if no modifications and no time given', function(assert) {
  this.player.currentTime = () => {
    return 5;
  };

  const streamTime = getStreamTime({
    player: this.player,
    playlist: this.playlist
  });

  assert.equal(
    streamTime.mediaSeconds,
    5,
    'currentTime was used if no time provided'
  );
});

QUnit.test('returns time if no modifications', function(assert) {
  const streamTime = getStreamTime({
    player: this.player,
    playlist: this.playlist,
    time: 3
  });

  assert.equal(
    streamTime.mediaSeconds,
    3,
    'mediaSeconds is currentTime if no further modifications'
  );
});

QUnit.test('returns programDateTime parsed from media segment tags', function(assert) {
  const playlist = {
    segments: [{
      duration: 1,
      // UTC: Sun, 11 Nov 2018 00:00:00 GMT
      dateTimeObject: new Date(1541894400000),
      dateTimeString: '2018-11-11T00:00:00.000Z'
    }]
  };

  const streamTime = getStreamTime({
    player: this.player,
    playlist,
    time: 0
  });

  assert.equal(
    streamTime.programDateTime,
    playlist.segments[0].dateTimeString,
    'uses programDateTime found in media segments'
  );
});
