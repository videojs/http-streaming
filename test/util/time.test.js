import QUnit from 'qunit';
import videojs from 'video.js';
import {
  getStreamTime,
  seekToStreamTime,
  verifyProgramDateTimeTags,
  findSegmentForPlayerTime,
  findSegmentForStreamTime,
  getOffsetFromTimestamp,
  timeWithinSegment
} from '../../src/util/time.js';

QUnit.module('Time');

QUnit.test('verifyProgramDateTimeTags only returns true when all segments have programDateTime tags',
  function(assert) {
    const emptyPlaylist = {};
    const emptySegments = {
      segments: []
    };
    const goodPlaylist = {
      segments: [{
        start: 0,
        end: 1,
        dateTimeObject: new Date()
      }]
    };
    const badPlaylist = {
      segments: [
        {
          start: 0,
          end: 1,
          dateTimeObject: new Date()
        },
        {
          start: 1,
          end: 2
        },
        {
          start: 2,
          end: 3,
          dateTimeObject: new Date()
        }
      ]
    };

    assert.equal(
      verifyProgramDateTimeTags(emptyPlaylist),
      false,
      'empty playlist will be false'
    );
    assert.equal(
      verifyProgramDateTimeTags(emptySegments),
      false,
      'empty segment list will be false'
    );
    assert.equal(
      verifyProgramDateTimeTags(badPlaylist),
      false,
      'false if any segment is missing a programDateTime tag'
    );
    assert.equal(
      verifyProgramDateTimeTags(goodPlaylist),
      true,
      'true if all segments have programDateTime'
    );
  });

QUnit.test('findSegmentForPlayerTime returns nothing if a match cannot be found', function(assert) {
  assert.equal(
    findSegmentForPlayerTime(0, {}),
    null,
    'returns nothing if empty playlist'
  );

  assert.equal(
    findSegmentForPlayerTime(0, {
      segments: []
    }),
    null,
    'returns nothing if empty segment list'
  );

  assert.equal(
    findSegmentForPlayerTime(10, {
      segments: [{
        start: 0,
        end: 1
      }]
    }),
    null,
    'returns nothing if time is outside available segments'
  );
});

QUnit.test('findSegmentForPlayerTime returns estimate if segment not buffered', function(assert) {
  const segment = {
    duration: 1
  };

  assert.deepEqual(
    findSegmentForPlayerTime(0, {
      segments: [segment]
    }),
    {
      type: 'estimate',
      segment,
      estimatedStart: 0
    },
    'returns the estimated match if time is within segment boundaries'
  );
});

QUnit.test('findSegmentForPlayerTime returns accurate if segment buffered', function(assert) {
  const segment = {
    start: 0,
    end: 1,
    duration: 1
  };

  assert.deepEqual(
    findSegmentForPlayerTime(0.1, {
      segments: [segment]
    }),
    {
      type: 'accurate',
      segment,
      estimatedStart: 0
    },
    'returns the accurate match if the segment has been buffered'
  );
});

QUnit.test('findSegmentForStreamTime returns nothing if a match cannot be found', function(assert) {
  assert.equal(
    findSegmentForStreamTime('2018-11-10T19:39:57.158Z', {}),
    null,
    'returns nothing if empty playlist'
  );
  assert.equal(
    findSegmentForStreamTime('2018-11-10T19:39:57.158Z', {
      segments: []
    }),
    null,
    'returns nothing if empty segment list'
  );
  assert.equal(
    findSegmentForStreamTime('2018-11-10T19:40:57.158Z', {
      segments: [{
        start: 0,
        end: 1,
        duration: 1,
        dateTimeObject: new Date('2018-11-10T19:39:57.158Z')
      }]
    }),
    null,
    'returns nothing if requested time is not available'
  );
});

QUnit.test('findSegmentForStreamTime returns estimate if segment not buffered', function(assert) {
  const segment = {
    duration: 1,
    dateTimeObject: new Date('2018-11-10T19:38:57.158Z')
  };

  assert.deepEqual(
    findSegmentForStreamTime('2018-11-10T19:38:57.200Z', {
      segments: [segment]
    }),
    {
      type: 'estimate',
      segment,
      estimatedStart: new Date('2018-11-10T19:38:57.158Z')
    },
    'returns estimated match if segment not buffered'
  );
});

QUnit.test('findSegmentForStreamTime returns accurate match if buffered', function(assert) {
  const segment = {
    start: 0,
    end: 1,
    duration: 1,
    dateTimeObject: new Date('2018-11-10T19:38:57.158Z')
  };

  assert.deepEqual(
    findSegmentForStreamTime('2018-11-10T19:38:57.200Z', {
      segments: [segment]
    }),
    {
      type: 'accurate',
      segment,
      estimatedStart: new Date('2018-11-10T19:38:57.158Z')
    },
    'returns accurate match if segment buffered'
  );
});

QUnit.test('getOffsetFromTimestamp', function(assert) {
  assert.equal(
    getOffsetFromTimestamp('2018-11-10T19:38:57.158Z', '2018-11-10T19:38:57.158Z'),
    0,
    'returns difference in timestamps'
  );

  assert.equal(
    getOffsetFromTimestamp('2018-11-10T19:38:57.158Z', '2018-11-10T19:38:58.158Z'),
    1,
    'returns offset in seconds'
  );

  assert.equal(
    getOffsetFromTimestamp('2018-11-10T19:38:57.158Z', '2018-11-10T19:38:56.158Z'),
    -1,
    'negative offset returned if streamTime is before comparison timestamp'
  );
});

QUnit.test('timeWithinSegment for streamTime', function(assert) {
  assert.equal(
    timeWithinSegment(
      new Date('2018-11-10T19:38:57.158'),
      'stream',
      new Date('2018-11-10T19:38:57.100'),
      1
    ),
    true,
    'true if requestedTime is within the segment duration'
  );

  assert.equal(
    timeWithinSegment(
      new Date('2018-11-10T19:38:59.158'),
      'stream',
      new Date('2018-11-10T19:38:57.158'),
      1
    ),
    false,
    'false if requestedTime is outside the segment duration'
  );

  assert.equal(
    timeWithinSegment(
      new Date('2018-11-10T19:38:57.158'),
      'stream',
      new Date('2018-11-10T19:38:59.158'),
      1
    ),
    false,
    'false if requestedTime is before segment start'
  );
});

QUnit.test('timeWithinSegment for player time', function(assert) {
  assert.equal(
    timeWithinSegment(
      4,
      'player',
      3,
      1
    ),
    true,
    'true if requestedTime is within the segment duration'
  );

  assert.equal(
    timeWithinSegment(
      5,
      'player',
      3,
      1
    ),
    false,
    'false if requestedTime is outside the segment duration'
  );

  assert.equal(
    timeWithinSegment(
      2,
      'player',
      3,
      1
    ),
    false,
    'false if requestedTime is before segment start'
  );
});

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

QUnit.module('Time: seekToStreamTime', {
  beforeEach(assert) {
    this.seekTo = () => {};
    this.ct = 0;
    this.tech = {
      paused() {
        return false;
      },
      pause() {},
      one() {},
      currentTime() {
        return this.ct;
      },
      hasStarted_: true
    };
    this.playlist = {};
  },
  afterEach(assert) {
    delete this.seekTo;
    delete this.tech;
    delete this.ct;
    delete this.playlist;
  }
});

QUnit.test('returns error if no playlist or streamTime provided', function(assert) {
  const done = assert.async();
  const done2 = assert.async();
  const done3 = assert.async();

  seekToStreamTime({
    streamTime: 0,
    seekTo: this.seekTo,
    tech: this.tech,
    callback: (err, newTime) => {
      assert.equal(
        err.message,
        'seekToStreamTime: streamTime, seekTo and playlist must be provided',
        'error message is returned when no playlist is provided'
      );
      done();
    }
  });

  seekToStreamTime({
    playlist: {},
    seekTo: this.seekTo,
    tech: this.tech,
    callback: (err, newTime) => {
      assert.equal(
        err.message,
        'seekToStreamTime: streamTime, seekTo and playlist must be provided',
        'error message is returned when no time is provided'
      );
      done2();
    }
  });

  seekToStreamTime({
    streamTime: 0,
    playlist: {},
    tech: this.tech,
    callback: (err, newTime) => {
      assert.equal(
        err.message,
        'seekToStreamTime: streamTime, seekTo and playlist must be provided',
        'error message is returned when no seekTo method is provided'
      );
      done3();
    }
  });
});

QUnit.test('throws error if no callback is provided', function(assert) {
  assert.throws(
    () => {
      return seekToStreamTime({
        streamTime: 1,
        playlist: {},
        seekTo: this.seekTo,
        tech: this.tech
      });
    },
    'throws an error if no callback is provided'
  );
});

QUnit.test('returns error if any playlist segments do not include programDateTime tags',
function(assert) {
  const done = assert.async();
  const done2 = assert.async();

  seekToStreamTime({
    streamTime: 1,
    playlist: {
      segments: [],
      resolvedUri: 'test'
    },
    seekTo: this.seekTo,
    tech: this.tech,
    callback: (err, newTime) => {
      assert.equal(
        err.message,
        'programDateTime tags must be provided in the manifest test',
        'returns error when there are no segments'
      );
      assert.equal(
        newTime,
        null,
        'valid newTime value is not returned'
      );
      done();
    }
  });

  seekToStreamTime({
    streamTime: 1,
    playlist: {
      segments: [
        {
          // UTC: Sun, 11 Nov 2018 00:00:00 GMT
          programDateTime: '2018-11-11T00:00:00.000Z',
          duration: 10
        },
        {
          duration: 10
        }
      ],
      resolvedUri: 'test2'
    },
    seekTo: this.seekTo,
    tech: this.tech,
    callback: (err, newTime) => {
      assert.equal(
        err.message,
        'programDateTime tags must be provided in the manifest test2',
        'returns error when there are any segments without a programDateTime tag'
      );
      assert.equal(
        newTime,
        null,
        'valid newTime value is not returned'
      );
      done2();
    }
  });
});

QUnit.test('returns error if live stream has not started', function(assert) {
  const done = assert.async();
  const tech = videojs.mergeOptions(this.tech, {
    hasStarted_: false
  });

  seekToStreamTime({
    streamTime: 1,
    playlist: {
      segments: [],
      resolvedUri: 'test'
    },
    seekTo: this.seekTo,
    // tech that hasn't started
    tech,
    callback: (err, newTime) => {
      assert.equal(
        err.message,
        'player must be playing a live stream to start buffering',
        'returns error when live stream has not started'
      );
      done();
    }
  });
});

QUnit.test('returns error if time does not exist in live stream', function(assert) {
  const done = assert.async();

  seekToStreamTime({
    streamTime: '2018-10-12T22:33:52.037+00:00',
    playlist: {
      segments: [{
        dateTimeString: '2018-10-12T22:33:49.037+00:00',
        dateTimeObject: new Date('2018-10-12T22:33:49.037+00:00'),
        start: 0,
        end: 1,
        duration: 1
      }],
      resolvedUri: 'test'
    },
    seekTo: this.seekTo,
    // tech that hasn't started
    tech: this.tech,
    callback: (err, newTime) => {
      assert.equal(
        err.message,
        '2018-10-12T22:33:52.037+00:00 was not found in the stream',
        'returns error when live stream has not started'
      );
      done();
    }
  });
});

QUnit.test('vod: returns error if we can only get estimates even with retries',
function(assert) {
  const done = assert.async();

  seekToStreamTime({
    streamTime: '2018-10-12T22:33:50.037+00:00',
    playlist: {
      segments: [
        {
          dateTimeString: '2018-10-12T22:33:49.037+00:00',
          dateTimeObject: new Date('2018-10-12T22:33:49.037+00:00'),
          duration: 1
        }, {
          dateTimeString: '2018-10-12T22:33:50.037+00:00',
          dateTimeObject: new Date('2018-10-12T22:33:50.037+00:00'),
          duration: 1
        }
      ],
      resolvedUri: 'test',
      endList: true
    },
    seekTo: this.seekTo,
    // tech that hasn't started
    tech: this.tech,
    callback: (err, newTime) => {
      assert.equal(
        err.message,
        '2018-10-12T22:33:50.037+00:00 is not buffered yet. Try again',
        'returns error when live stream has not started'
      );
      done();
    }
  });
});

QUnit.test('live: returns error if we can only get estimates even with retries',
function(assert) {
  const done = assert.async();

  seekToStreamTime({
    streamTime: '2018-10-12T22:33:50.037+00:00',
    playlist: {
      segments: [
        {
          dateTimeString: '2018-10-12T22:33:49.037+00:00',
          dateTimeObject: new Date('2018-10-12T22:33:49.037+00:00'),
          duration: 1
        }, {
          dateTimeString: '2018-10-12T22:33:50.037+00:00',
          dateTimeObject: new Date('2018-10-12T22:33:50.037+00:00'),
          duration: 1
        }
      ],
      resolvedUri: 'test'
    },
    seekTo: this.seekTo,
    // tech that hasn't started
    tech: this.tech,
    callback: (err, newTime) => {
      assert.equal(
        err.message,
        '2018-10-12T22:33:50.037+00:00 is not buffered yet. Try again',
        'returns error when live stream has not started'
      );
      done();
    }
  });
});

QUnit.test('vod: seeks and returns player time seeked to if buffered', function(assert) {
  let currentTime = 0;
  const done = assert.async();
  const handlers = {};
  const tech = videojs.mergeOptions(this.tech, {
    one(e, handler) {
      handlers[e] = handler;
    },
    currentTime(ct) {
      if (ct && handlers.seeked) {
        currentTime = ct;
        return handlers.seeked(ct);
      }

      return currentTime;
    }
  });
  const seekTo = (t) => {
    tech.currentTime(t);
  };

  seekToStreamTime({
    streamTime: '2018-10-12T22:33:50.037+00:00',
    playlist: {
      segments: [
        {
          dateTimeString: '2018-10-12T22:33:49.037+00:00',
          dateTimeObject: new Date('2018-10-12T22:33:49.037+00:00'),
          duration: 1,
          start: 0,
          end: 1
        }, {
          dateTimeString: '2018-10-12T22:33:50.037+00:00',
          dateTimeObject: new Date('2018-10-12T22:33:50.037+00:00'),
          duration: 1,
          start: 1,
          end: 2
        }
      ],
      resolvedUri: 'test',
      endList: true
    },
    seekTo,
    // tech that hasn't started
    tech,
    callback: (err, newTime) => {
      assert.notOk(err, 'no errors returned');
      assert.equal(
        newTime,
        1,
        'player time that has been seeked to is returned'
      );
      done();
    }
  });
});

QUnit.test('live: seeks and returns player time seeked to if buffered', function(assert) {
  let currentTime = 0;
  const done = assert.async();
  const handlers = {};
  const tech = videojs.mergeOptions(this.tech, {
    one(e, handler) {
      handlers[e] = handler;
    },
    currentTime(ct) {
      if (ct && handlers.seeked) {
        currentTime = ct;
        return handlers.seeked(ct);
      }

      return currentTime;
    }
  });
  const seekTo = (t) => {
    tech.currentTime(t);
  };

  seekToStreamTime({
    streamTime: '2018-10-12T22:33:50.037+00:00',
    playlist: {
      segments: [
        {
          dateTimeString: '2018-10-12T22:33:49.037+00:00',
          dateTimeObject: new Date('2018-10-12T22:33:49.037+00:00'),
          duration: 1,
          start: 0,
          end: 1
        }, {
          dateTimeString: '2018-10-12T22:33:50.037+00:00',
          dateTimeObject: new Date('2018-10-12T22:33:50.037+00:00'),
          duration: 1,
          start: 1,
          end: 2
        }
      ],
      resolvedUri: 'test'
    },
    seekTo,
    // tech that hasn't started
    tech,
    callback: (err, newTime) => {
      assert.notOk(err, 'no errors returned');
      assert.equal(
        newTime,
        1,
        'player time that has been seeked to is returned'
      );
      done();
    }
  });
});

QUnit.test('setting pauseAfterSeek to false seeks without pausing', function(assert) {
  let currentTime = 0;
  const done = assert.async();
  const handlers = {};
  const tech = videojs.mergeOptions(this.tech, {
    one(e, handler) {
      handlers[e] = handler;
    },
    currentTime(ct) {
      if (ct && handlers.seeked) {
        currentTime = ct;
        return handlers.seeked(ct);
      }

      return currentTime;
    }
  });
  const seekTo = (t) => {
    tech.currentTime(t);
  };

  seekToStreamTime({
    streamTime: '2018-10-12T22:33:50.037+00:00',
    playlist: {
      segments: [
        {
          dateTimeString: '2018-10-12T22:33:49.037+00:00',
          dateTimeObject: new Date('2018-10-12T22:33:49.037+00:00'),
          duration: 1,
          start: 0,
          end: 1
        }, {
          dateTimeString: '2018-10-12T22:33:50.037+00:00',
          dateTimeObject: new Date('2018-10-12T22:33:50.037+00:00'),
          duration: 1,
          start: 1,
          end: 2
        }
      ],
      resolvedUri: 'test',
      endList: true
    },
    pauseAfterSeek: false,
    seekTo,
    // tech that hasn't started
    tech,
    callback: (err, newTime) => {
      assert.notOk(err, 'no errors returned');
      assert.equal(
        newTime,
        1,
        'player time that has been seeked to is returned'
      );
      assert.equal(
        tech.paused(),
        false,
        'player should not be paused'
      );
      done();
    }
  });
});
