import QUnit from 'qunit';
import videojs from 'video.js';
import {
  getStreamTime,
  seekToStreamTime,
  verifyProgramDateTimeTags,
  findSegmentForPlayerTime,
  findSegmentForStreamTime,
  getOffsetFromTimestamp
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
        videoTimingInfo: {
          originalPresentationStart: 0,
          transmuxerPrependedSeconds: 0,
          transmuxedPresentationStart: 0,
          transmuxedPresentationEnd: 1
        }
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
    videoTimingInfo: {
      originalPresentationStart: 0,
      transmuxerPrependedSeconds: 0,
      transmuxedPresentationStart: 0,
      transmuxedPresentationEnd: 1
    },
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

QUnit.test('findSegmentForPlayerTime returns accurate last segment', function(assert) {
  const playlist = {
    segments: [{
      videoTimingInfo: {
        originalPresentationStart: 0,
        transmuxerPrependedSeconds: 0,
        transmuxedPresentationStart: 0,
        transmuxedPresentationEnd: 1
      },
      duration: 1
    }, {
      videoTimingInfo: {
        originalPresentationStart: 1,
        transmuxerPrependedSeconds: 0,
        transmuxedPresentationStart: 1,
        transmuxedPresentationEnd: 2
      },
      duration: 1
    }]
  };

  assert.deepEqual(
    findSegmentForPlayerTime(1.1, playlist),
    {
      type: 'accurate',
      segment: playlist.segments[1],
      estimatedStart: 1
    },
    'returns the accurate last segment match if the segment has been transmuxed'
  );
});

QUnit.test(
'findSegmentForPlayerTime returns null if beyond last segment and segment transmuxed',
function(assert) {
  const playlist = {
    segments: [{
      videoTimingInfo: {
        originalPresentationStart: 0,
        transmuxerPrependedSeconds: 0,
        transmuxedPresentationStart: 0,
        transmuxedPresentationEnd: 1
      },
      duration: 1
    }, {
      videoTimingInfo: {
        originalPresentationStart: 1,
        transmuxerPrependedSeconds: 0,
        transmuxedPresentationStart: 1,
        transmuxedPresentationEnd: 2
      },
      duration: 1
    }]
  };

  assert.equal(
    findSegmentForPlayerTime(2.1, playlist),
    null,
    'returns null if beyond the transmuxed last segment'
  );
});

QUnit.test('findSegmentForPlayerTime returns estimated last segment', function(assert) {
  const playlist = {
    segments: [{
      videoTimingInfo: {
        originalPresentationStart: 0,
        transmuxerPrependedSeconds: 0,
        transmuxedPresentationStart: 0,
        transmuxedPresentationEnd: 1
      },
      duration: 1
    }, {
      duration: 1
    }]
  };

  assert.deepEqual(
    // technically this is beyond the end of the playlist, but it should allow for a fudge
    // factor when the last segment hasn't been transmuxed
    findSegmentForPlayerTime(2.25, playlist),
    {
      type: 'estimate',
      segment: playlist.segments[1],
      estimatedStart: 1
    },
    'returns the estimated last segment match if the segment has not been transmuxed'
  );
});

QUnit.test(
'findSegmentForPlayerTime returns null if beyond last segment and segment not transmuxed',
function(assert) {
  const playlist = {
    segments: [{
      videoTimingInfo: {
        originalPresentationStart: 0,
        transmuxerPrependedSeconds: 0,
        transmuxedPresentationStart: 0,
        transmuxedPresentationEnd: 1
      },
      duration: 1
    }, {
      duration: 1
    }]
  };

  assert.equal(
    // must account for fudge factor for estimated timing
    findSegmentForPlayerTime(2.26, playlist),
    null,
    'returns null if beyond the non transmuxed last segment'
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
      segments: [],
      targetDuration: 1
    }),
    null,
    'returns nothing if empty segment list'
  );
  assert.equal(
    findSegmentForStreamTime('2018-11-10T19:40:57.158Z', {
      segments: [{
        videoTimingInfo: {
          originalPresentationStart: 0,
          transmuxerPrependedSeconds: 0,
          transmuxedPresentationStart: 0,
          transmuxedPresentationEnd: 1
        },
        duration: 1,
        dateTimeObject: new Date('2018-11-10T19:39:57.158Z')
      }],
      targetDuration: 1
    }),
    null,
    'returns nothing if requested time is not available'
  );
});

QUnit.test('findSegmentForStreamTime returns estimate if last segment and not buffered',
function(assert) {
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
    'returns estimate'
  );
});

QUnit.test('findSegmentForStreamTime returns accurate even if not buffered',
function(assert) {
  const segment1 = {
    duration: 1,
    dateTimeObject: new Date('2018-11-10T19:38:57.158Z')
  };
  const segment2 = {
    duration: 1,
    dateTimeObject: new Date('2018-11-10T19:38:58.158Z')
  };

  assert.deepEqual(
    findSegmentForStreamTime('2018-11-10T19:38:57.200Z', {
      segments: [segment1, segment2]
    }),
    {
      type: 'accurate',
      segment: segment1,
      estimatedStart: new Date('2018-11-10T19:38:57.158Z')
    },
    'returns accurate'
  );
});

QUnit.test('findSegmentForStreamTime returns accurate match if buffered', function(assert) {
  const segment = {
    videoTimingInfo: {
      originalPresentationStart: 0,
      transmuxerPrependedSeconds: 0,
      transmuxedPresentationStart: 0,
      transmuxedPresentationEnd: 1
    },
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

QUnit.test('findSegmentForStreamTime returns accurate last segment', function(assert) {
  const playlist = {
    segments: [{
      videoTimingInfo: {
        originalPresentationStart: 0,
        transmuxerPrependedSeconds: 0,
        transmuxedPresentationStart: 0,
        transmuxedPresentationEnd: 1
      },
      duration: 1,
      dateTimeObject: new Date('2018-11-10T19:38:57.158Z')
    }, {
      videoTimingInfo: {
        originalPresentationStart: 1,
        transmuxerPrependedSeconds: 0,
        transmuxedPresentationStart: 1,
        transmuxedPresentationEnd: 2
      },
      duration: 1,
      dateTimeObject: new Date('2018-11-10T19:38:58.158Z')
    }]
  };

  assert.deepEqual(
    findSegmentForStreamTime('2018-11-10T19:38:58.200Z', playlist),
    {
      type: 'accurate',
      segment: playlist.segments[1],
      estimatedStart: new Date('2018-11-10T19:38:58.158Z')
    },
    'returns accurate match if segment buffered'
  );
});

QUnit.test(
'findSegmentForStreamTime returns null if beyond last segment and segment transmuxed',
function(assert) {
  const playlist = {
    segments: [{
      videoTimingInfo: {
        originalPresentationStart: 0,
        transmuxerPrependedSeconds: 0,
        transmuxedPresentationStart: 0,
        transmuxedPresentationEnd: 1
      },
      duration: 1,
      dateTimeObject: new Date('2018-11-10T19:38:57.158Z')
    }, {
      videoTimingInfo: {
        originalPresentationStart: 1,
        transmuxerPrependedSeconds: 0,
        transmuxedPresentationStart: 1,
        transmuxedPresentationEnd: 2
      },
      duration: 1,
      dateTimeObject: new Date('2018-11-10T19:38:58.158Z')
    }]
  };

  assert.deepEqual(
    findSegmentForStreamTime('2018-11-10T19:38:59.200Z', playlist),
    null,
    'returns null if beyond the transmuxed last segment'
  );
});

QUnit.test('findSegmentForStreamTime returns estimated last segment', function(assert) {
  const playlist = {
    segments: [{
      videoTimingInfo: {
        originalPresentationStart: 0,
        transmuxerPrependedSeconds: 0,
        transmuxedPresentationStart: 0,
        transmuxedPresentationEnd: 1
      },
      duration: 1,
      dateTimeObject: new Date('2018-11-10T19:38:57.158Z')
    }, {
      duration: 1,
      dateTimeObject: new Date('2018-11-10T19:38:58.158Z')
    }]
  };

  // 25% of last segment duration + last segment duration on top of last segment start
  // to test allowed fudge
  const streamTime =
    new Date(playlist.segments[1].dateTimeObject.getTime() + 1.25 * 1000);

  assert.deepEqual(
    findSegmentForStreamTime(streamTime.toISOString(), playlist),
    {
      type: 'estimate',
      segment: playlist.segments[1],
      estimatedStart: playlist.segments[1].dateTimeObject
    },
    'returns the estimated last segment match if the segment has not been transmuxed'
  );
});

QUnit.test(
'findSegmentForStreamTime returns null if beyond last segment and segment not transmuxed',
function(assert) {
  const playlist = {
    segments: [{
      videoTimingInfo: {
        originalPresentationStart: 0,
        transmuxerPrependedSeconds: 0,
        transmuxedPresentationStart: 0,
        transmuxedPresentationEnd: 1
      },
      duration: 1,
      dateTimeObject: new Date('2018-11-10T19:38:57.158Z')
    }, {
      duration: 1,
      dateTimeObject: new Date('2018-11-10T19:38:58.158Z')
    }]
  };

  // just over allowed fudge of 25%
  const streamTime =
    new Date(playlist.segments[1].dateTimeObject.getTime() + 1.26 * 1000);

  assert.equal(
    findSegmentForStreamTime(streamTime.toISOString(), playlist),
    null,
    'returns null if beyond the non transmuxed last segment'
  );
});

QUnit.test('getOffsetFromTimestamp will calculate second differences in timestamps', function(assert) {
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

QUnit.module('Time: getStreamTime', {
  beforeEach(assert) {
    this.playlist = {
      segments: [{
        duration: 4,
        // UTC: Sun, 11 Nov 2018 00:00:00 GMT
        dateTimeObject: new Date(1541894400000),
        dateTimeString: '2018-11-11T00:00:00.000Z',
        start: 5,
        videoTimingInfo: {
          originalPresentationStart: 5,
          transmuxerPrependedSeconds: 0,
          transmuxedPresentationStart: 0,
          transmuxedPresentationEnd: 9
        }
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

      // offset into start of stream by time passed in
      const expectedDateTime =
        new Date(this.playlist.segments[0].dateTimeObject.getTime() + 6 * 1000);

      assert.equal(
        streamTime.programDateTime,
        expectedDateTime.toISOString(),
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
        duration: 1,
        start: 0
      }],
      targetDuration: 1,
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
          start: 0
        }, {
          dateTimeString: '2018-10-12T22:33:50.037+00:00',
          dateTimeObject: new Date('2018-10-12T22:33:50.037+00:00'),
          duration: 1,
          start: 1
        }
      ],
      targetDuration: 1,
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
          start: 0
        }, {
          dateTimeString: '2018-10-12T22:33:50.037+00:00',
          dateTimeObject: new Date('2018-10-12T22:33:50.037+00:00'),
          duration: 1,
          start: 1
        }
      ],
      targetDuration: 1,
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
          start: 0
        }, {
          dateTimeString: '2018-10-12T22:33:50.037+00:00',
          dateTimeObject: new Date('2018-10-12T22:33:50.037+00:00'),
          duration: 1,
          start: 1
        }
      ],
      targetDuration: 1,
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
