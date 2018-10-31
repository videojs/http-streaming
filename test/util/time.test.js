import QUnit from 'qunit';
import videojs from 'video.js';
import {
  getStreamTime
} from '../../src/util/time.js';

QUnit.module('Time: getStreamTime', {
  beforeEach(assert) {
    this.playlist = {
      segments: [{
        duration: 4,
        // UTC: Sun, 11 Nov 2018 00:00:00 GMT
        dateTimeObject: new Date(1541894400000),
        dateTimeString: '2018-11-11T00:00:00.000Z',
        start: 5,
        end: 9
      }]
    };
  },
  afterEach(assert) {
    delete this.playlist;
  }
});

QUnit.test('returns error if playlist or time is not provided', function(assert) {
  const done = assert.async();
  const done2 = assert.async();

  getStreamTime({
    time: 1,
    callback: (err, streamTime) => {
      assert.equal(
        err.message,
        'getStreamTime: playlist and time must be provided',
        'error message is returned when no playlist provided'
      );
      done();
    }
  });

  getStreamTime({
    playlist: this.playlist,
    callback: (err, streamTime) => {
      assert.equal(
        err.message,
        'getStreamTime: playlist and time must be provided',
        'error message is returned when no playlist provided'
      );
      done2();
    }
  });
});

QUnit.test('throws error if no callback is provided', function(assert) {
  assert.throws(
    () => {
      return getStreamTime({
        time: 1,
        playlist: this.playlist
      });
    },
    /getStreamTime: callback must be provided/,
    'throws error if callback is not provided'
  );
});

QUnit.test('returns info to accept callback if accurate value can be returned',
function(assert) {
  const done = assert.async();

  getStreamTime({
    playlist: this.playlist,
    time: 6,
    callback: (err, streamTime) => {
      assert.notOk(
        err,
        'should not fail when accurate segment times are available'
      );
      assert.equal(
        typeof streamTime,
        'object',
        'should return an object to onsuccess callback'
      );
      assert.ok(
        streamTime.mediaSeconds !== undefined,
        'mediaSeconds is passed to onsuccess'
      );
      assert.ok(
        streamTime.programDateTime !== undefined,
        'programDateTime is passed to onsuccess'
      );

      assert.equal(
        streamTime.programDateTime,
        this.playlist.segments[0].dateTimeString,
        'uses programDateTime found in media segments'
      );
      done();
    }
  });
});

QUnit.test('return a seek time to reject callback if accurate value cannot be returned',
function(assert) {
  const done = assert.async();
  const playlist = {
    segments: [
      {
        duration: 1,
        // UTC: Sun, 11 Nov 2018 00:00:00 GMT
        dateTimeObject: new Date(1541894400000),
        dateTimeString: '2018-11-11T00:00:00.000Z'
      },
      {
        duration: 2,
        // UTC: Sun, 11 Nov 2018 00:00:00 GMT
        dateTimeObject: new Date(1541894400000),
        dateTimeString: '2018-11-11T00:00:00.000Z'
      }
    ]
  };

  getStreamTime({
    playlist,
    time: 2,
    callback: (err, streamTime) => {
      assert.equal(
        err.message,
        'Accurate streamTime could not be determined. Please seek to e.seekTime and try again',
        'error message is returned for seekTime'
      );
      assert.equal(
        err.seekTime,
        1,
        'returns the approximate start time of the segment containing the time requested'
      );
      done();
    }
  });
});

QUnit.test('returns time if no modifications', function(assert) {
  const done = assert.async();
  const segment = videojs.mergeOptions(this.playlist.segments[0], {
    duration: 2,
    start: 3,
    end: 5
  });
  const playlist = {
    segments: [
      segment
    ]
  };

  getStreamTime({
    playlist,
    time: 3,
    callback: (err, streamTime) => {
      assert.equal(err, null, 'no error');
      assert.equal(
        streamTime.mediaSeconds,
        3,
        'mediaSeconds is currentTime if no further modifications'
      );
      done();
    }
  });
});

QUnit.test('returns programDateTime parsed from media segment tags', function(assert) {
  const done = assert.async();
  const segment = videojs.mergeOptions(this.playlist.segments[0], {
    duration: 1,
    start: 0,
    end: 1
  });
  const playlist = {
    segments: [
      segment
    ]
  };

  getStreamTime({
    playlist,
    time: 0,
    callback: (err, streamTime) => {
      assert.equal(err, null, 'no error');
      assert.equal(
        streamTime.programDateTime,
        playlist.segments[0].dateTimeString,
        'uses programDateTime found in media segments'
      );
      done();
    }
  });
});
