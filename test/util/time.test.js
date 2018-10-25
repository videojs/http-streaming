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

QUnit.test('returns info to accept callback if accurate value can be returned',
function(assert) {
  const done = assert.async();

  getStreamTime({
    playlist: this.playlist,
    time: 6,
    onsuccess: (streamTime) => {
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
    },
    onreject: (e) => {
      assert.notOk(
        true,
        'should not fail when accurate segment times are available'
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
    onsuccess: (streamTime) => {
      assert.notOk(
        true,
        'should not succeed when accurate segment times are not available'
      );
      done();
    },
    onreject: (e) => {
      assert.equal(
        e.message,
        'Accurate streamTime could not be determined. Please seek to e.seekTime and try again',
        'error message is returned for seekTime'
      );
      assert.equal(
        e.seekTime,
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
    onsuccess: (streamTime) => {
      assert.equal(
        streamTime.mediaSeconds,
        3,
        'mediaSeconds is currentTime if no further modifications'
      );
      done();
    },
    onreject: () => {}
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
    onsuccess: (streamTime) => {
      assert.equal(
        streamTime.programDateTime,
        playlist.segments[0].dateTimeString,
        'uses programDateTime found in media segments'
      );
      done();
    },
    onreject: () => {}
  });
});
