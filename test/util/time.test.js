import QUnit from 'qunit';
import {
  getProgramTime,
  seekToProgramTime,
  verifyProgramDateTimeTags,
  findSegmentForPlayerTime,
  findSegmentForProgramTime,
  getOffsetFromTimestamp,
  originalSegmentVideoDuration,
  playerTimeToProgramTime
} from '../../src/util/time.js';
import {merge} from '../../src/util/vjs-compat';

QUnit.module('Time');

QUnit.test(
  'verifyProgramDateTimeTags only returns true when all segments have programDateTime tags',
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
  }
);

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
    mediaSequence: 0,
    segments: [{
      videoTimingInfo: {
        transmuxerPrependedSeconds: 0,
        transmuxedPresentationStart: 0,
        transmuxedPresentationEnd: 1
      },
      duration: 1
    }, {
      videoTimingInfo: {
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
      mediaSequence: 0,
      segments: [{
        videoTimingInfo: {
          transmuxerPrependedSeconds: 0,
          transmuxedPresentationStart: 0,
          transmuxedPresentationEnd: 1
        },
        duration: 1
      }, {
        videoTimingInfo: {
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
  }
);

QUnit.test('findSegmentForPlayerTime returns estimated last segment', function(assert) {
  const playlist = {
    mediaSequence: 0,
    segments: [{
      videoTimingInfo: {
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
      mediaSequence: 0,
      segments: [{
        videoTimingInfo: {
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
  }
);

QUnit.test(
  'findSegmentForProgramTime returns nothing if a match cannot be found',
  function(assert) {
    assert.equal(
      findSegmentForProgramTime('2018-11-10T19:39:57.158Z', {}),
      null,
      'returns nothing if empty playlist'
    );
    assert.equal(
      findSegmentForProgramTime('2018-11-10T19:39:57.158Z', {
        segments: [],
        targetDuration: 1
      }),
      null,
      'returns nothing if empty segment list'
    );
    assert.equal(
      findSegmentForProgramTime('2018-11-10T19:40:57.158Z', {
        segments: [{
          videoTimingInfo: {
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
  }
);

QUnit.test(
  'findSegmentForProgramTime returns estimate if last segment and not buffered',
  function(assert) {
    const segment = {
      duration: 1,
      dateTimeObject: new Date('2018-11-10T19:38:57.158Z')
    };

    assert.deepEqual(
      findSegmentForProgramTime('2018-11-10T19:38:57.200Z', {
        segments: [segment]
      }),
      {
        type: 'estimate',
        segment,
        estimatedStart: 0
      },
      'returns estimate'
    );
  }
);

QUnit.test(
  'findSegmentForProgramTime returns estimate if not buffered',
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
      findSegmentForProgramTime('2018-11-10T19:38:57.200Z', {
        segments: [segment1, segment2]
      }),
      {
        type: 'estimate',
        segment: segment1,
        estimatedStart: 0
      },
      'returns estimate'
    );
  }
);

QUnit.test(
  'findSegmentForProgramTime returns accurate match if buffered',
  function(assert) {
    const segment = {
      videoTimingInfo: {
        transmuxerPrependedSeconds: 0,
        transmuxedPresentationStart: 0,
        transmuxedPresentationEnd: 1
      },
      duration: 1,
      dateTimeObject: new Date('2018-11-10T19:38:57.158Z')
    };

    assert.deepEqual(
      findSegmentForProgramTime('2018-11-10T19:38:57.200Z', {
        segments: [segment]
      }),
      {
        type: 'accurate',
        segment,
        estimatedStart: 0
      },
      'returns accurate match if segment buffered'
    );
  }
);

QUnit.test('findSegmentForProgramTime returns accurate last segment', function(assert) {
  const playlist = {
    mediaSequence: 0,
    segments: [{
      videoTimingInfo: {
        transmuxerPrependedSeconds: 0,
        transmuxedPresentationStart: 0,
        transmuxedPresentationEnd: 1
      },
      duration: 1,
      dateTimeObject: new Date('2018-11-10T19:38:57.158Z')
    }, {
      videoTimingInfo: {
        transmuxerPrependedSeconds: 0,
        transmuxedPresentationStart: 1,
        transmuxedPresentationEnd: 2
      },
      duration: 1,
      dateTimeObject: new Date('2018-11-10T19:38:58.158Z')
    }]
  };

  assert.deepEqual(
    findSegmentForProgramTime('2018-11-10T19:38:58.200Z', playlist),
    {
      type: 'accurate',
      segment: playlist.segments[1],
      estimatedStart: 1
    },
    'returns accurate match if segment buffered'
  );
});

QUnit.test(
  'findSegmentForProgramTime returns null if beyond last segment and segment transmuxed',
  function(assert) {
    const playlist = {
      mediaSequence: 0,
      segments: [{
        videoTimingInfo: {
          transmuxerPrependedSeconds: 0,
          transmuxedPresentationStart: 0,
          transmuxedPresentationEnd: 1
        },
        duration: 1,
        dateTimeObject: new Date('2018-11-10T19:38:57.158Z')
      }, {
        videoTimingInfo: {
          transmuxerPrependedSeconds: 0,
          transmuxedPresentationStart: 1,
          transmuxedPresentationEnd: 2
        },
        duration: 1,
        dateTimeObject: new Date('2018-11-10T19:38:58.158Z')
      }]
    };

    assert.deepEqual(
      findSegmentForProgramTime('2018-11-10T19:38:59.200Z', playlist),
      null,
      'returns null if beyond the transmuxed last segment'
    );
  }
);

QUnit.test('findSegmentForProgramTime returns estimated last segment', function(assert) {
  const playlist = {
    mediaSequence: 0,
    segments: [{
      videoTimingInfo: {
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
  const programTime =
    new Date(playlist.segments[1].dateTimeObject.getTime() + 1.25 * 1000);

  assert.deepEqual(
    findSegmentForProgramTime(programTime.toISOString(), playlist),
    {
      type: 'estimate',
      segment: playlist.segments[1],
      estimatedStart: 1
    },
    'returns the estimated last segment match if the segment has not been transmuxed'
  );
});

QUnit.test(
  'findSegmentForProgramTime returns null if beyond last segment and' +
' segment not transmuxed',
  function(assert) {
    const playlist = {
      mediaSequence: 0,
      segments: [{
        videoTimingInfo: {
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
    const programTime =
    new Date(playlist.segments[1].dateTimeObject.getTime() + 1.26 * 1000);

    assert.equal(
      findSegmentForProgramTime(programTime.toISOString(), playlist),
      null,
      'returns null if beyond the non transmuxed last segment'
    );
  }
);

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
    'negative offset returned if programTime is before comparison timestamp'
  );
});

QUnit.test(
  'originalSegmentVideoDuration uses transmuxed end and start to determine duration',
  function(assert) {
    assert.equal(
      originalSegmentVideoDuration({
        transmuxedPresentationEnd: 11,
        transmuxedPresentationStart: 4,
        transmuxerPrependedSeconds: 0
      }),
      7,
      'determined original segment video duration'
    );
  }
);

QUnit.test('playerTimeToProgramTime returns null if no dateTimeObject', function(assert) {
  assert.equal(
    playerTimeToProgramTime(7, {
      videoTimingInfo: {
        transmuxedPresentationEnd: 11,
        transmuxedPresentationStart: 4,
        transmuxerPrependedSeconds: 0
      }
    }),
    null,
    'returns null'
  );
});

QUnit.test(
  'playerTimeToProgramTime converts a player time to a stream time based on segment' +
' program date time',
  function(assert) {
  // UTC: Sun, 11 Nov 2018 00:00:00 GMT
    const dateTimeObject = new Date(1541894400000);

    assert.deepEqual(
      playerTimeToProgramTime(7, {
        dateTimeObject,
        videoTimingInfo: {
          transmuxedPresentationEnd: 11,
          transmuxedPresentationStart: 4,
          transmuxerPrependedSeconds: 0
        }
      }).toISOString(),
      // 7 seconds into the stream, segment starts at 4 seconds
      (new Date(dateTimeObject.getTime() + 3 * 1000)).toISOString(),
      'returns stream time based on segment program date time'
    );
  }
);

QUnit.test('playerTimeToProgramTime accounts for prepended content', function(assert) {
  // UTC: Sun, 11 Nov 2018 00:00:00 GMT
  const dateTimeObject = new Date(1541894400000);

  assert.deepEqual(
    playerTimeToProgramTime(7, {
      dateTimeObject,
      videoTimingInfo: {
        transmuxedPresentationEnd: 11,
        transmuxedPresentationStart: 4,
        transmuxerPrependedSeconds: 2
      }
    }).toISOString(),
    // 7 seconds into the stream, segment starts at 4 seconds, but after accounting for
    // prepended content of 2 seconds, the original segment starts at 6 seconds
    (new Date(dateTimeObject.getTime() + 1 * 1000)).toISOString(),
    'returns stream time based on segment program date time'
  );
});

QUnit.test(
  'originalSegmentVideoDuration accounts for prepended content',
  function(assert) {
    assert.equal(
      originalSegmentVideoDuration({
        transmuxedPresentationEnd: 11,
        transmuxedPresentationStart: 4,
        transmuxerPrependedSeconds: 3
      }),
      4,
      'determined original segment video duration'
    );
  }
);

QUnit.module('Time: getProgramTime', {
  beforeEach(assert) {
    this.playlist = {
      mediaSequence: 0,
      segments: [{
        duration: 4,
        // UTC: Sun, 11 Nov 2018 00:00:00 GMT
        dateTimeObject: new Date(1541894400000),
        dateTimeString: '2018-11-11T00:00:00.000Z',
        start: 5,
        videoTimingInfo: {
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

  getProgramTime({
    time: 1,
    callback: (err, programTime) => {
      assert.equal(
        err.message,
        'getProgramTime: playlist and time must be provided',
        'error message is returned when no playlist provided'
      );
      done();
    }
  });

  getProgramTime({
    playlist: this.playlist,
    callback: (err, programTime) => {
      assert.equal(
        err.message,
        'getProgramTime: playlist and time must be provided',
        'error message is returned when no playlist provided'
      );
      done2();
    }
  });
});

QUnit.test('throws error if no callback is provided', function(assert) {
  assert.throws(
    () => {
      return getProgramTime({
        time: 1,
        playlist: this.playlist
      });
    },
    /getProgramTime: callback must be provided/,
    'throws error if callback is not provided'
  );
});

QUnit.test(
  'returns info to accept callback if accurate value can be returned',
  function(assert) {
    const done = assert.async();

    getProgramTime({
      playlist: this.playlist,
      time: 6,
      callback: (err, programTime) => {
        assert.notOk(
          err,
          'should not fail when accurate segment times are available'
        );
        assert.equal(
          typeof programTime,
          'object',
          'should return an object to onsuccess callback'
        );
        assert.ok(
          programTime.mediaSeconds !== undefined,
          'mediaSeconds is passed to onsuccess'
        );
        assert.ok(
          programTime.programDateTime !== undefined,
          'programDateTime is passed to onsuccess'
        );

        // offset into start of stream by time passed in
        const expectedDateTime =
        new Date(this.playlist.segments[0].dateTimeObject.getTime() + 6 * 1000);

        assert.equal(
          programTime.programDateTime,
          expectedDateTime.toISOString(),
          'uses programDateTime found in media segments'
        );
        done();
      }
    });
  }
);

QUnit.test(
  'return a seek time to reject callback if accurate value cannot be returned',
  function(assert) {
    const done = assert.async();
    const playlist = {
      mediaSequence: 0,
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

    getProgramTime({
      playlist,
      time: 2,
      callback: (err, programTime) => {
        assert.equal(
          err.message,
          'Accurate programTime could not be determined.' +
        ' Please seek to e.seekTime and try again',
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
  }
);

QUnit.test('returns time if no modifications', function(assert) {
  const done = assert.async();
  const segment = merge(this.playlist.segments[0], {
    duration: 2,
    start: 3,
    end: 5
  });
  const playlist = {
    mediaSequence: 0,
    segments: [
      segment
    ]
  };

  getProgramTime({
    playlist,
    time: 3,
    callback: (err, programTime) => {
      assert.equal(err, null, 'no error');
      assert.equal(
        programTime.mediaSeconds,
        3,
        'mediaSeconds is currentTime if no further modifications'
      );
      done();
    }
  });
});

QUnit.test('returns programDateTime parsed from media segment tags', function(assert) {
  const done = assert.async();
  const segment = merge(this.playlist.segments[0], {
    duration: 1,
    start: 0,
    end: 1
  });
  const playlist = {
    mediaSequence: 0,
    segments: [
      segment
    ]
  };

  getProgramTime({
    playlist,
    time: 0,
    callback: (err, programTime) => {
      assert.equal(err, null, 'no error');
      assert.equal(
        programTime.programDateTime,
        playlist.segments[0].dateTimeString,
        'uses programDateTime found in media segments'
      );
      done();
    }
  });
});

QUnit.module('Time: seekToProgramTime', {
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

QUnit.test('returns error if no playlist or programTime provided', function(assert) {
  const done = assert.async();
  const done2 = assert.async();
  const done3 = assert.async();

  seekToProgramTime({
    programTime: 0,
    seekTo: this.seekTo,
    tech: this.tech,
    callback: (err, newTime) => {
      assert.equal(
        err.message,
        'seekToProgramTime: programTime, seekTo and playlist must be provided',
        'error message is returned when no playlist is provided'
      );
      done();
    }
  });

  seekToProgramTime({
    playlist: {},
    seekTo: this.seekTo,
    tech: this.tech,
    callback: (err, newTime) => {
      assert.equal(
        err.message,
        'seekToProgramTime: programTime, seekTo and playlist must be provided',
        'error message is returned when no time is provided'
      );
      done2();
    }
  });

  seekToProgramTime({
    programTime: 0,
    playlist: {},
    tech: this.tech,
    callback: (err, newTime) => {
      assert.equal(
        err.message,
        'seekToProgramTime: programTime, seekTo and playlist must be provided',
        'error message is returned when no seekTo method is provided'
      );
      done3();
    }
  });
});

QUnit.test('throws error if no callback is provided', function(assert) {
  assert.throws(
    () => {
      return seekToProgramTime({
        programTime: 1,
        playlist: {},
        seekTo: this.seekTo,
        tech: this.tech
      });
    },
    'throws an error if no callback is provided'
  );
});

QUnit.test(
  'returns error if any playlist segments do not include programDateTime tags',
  function(assert) {
    const done = assert.async();
    const done2 = assert.async();

    seekToProgramTime({
      programTime: 1,
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

    seekToProgramTime({
      programTime: 1,
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
  }
);

QUnit.test('returns error if live stream has not started', function(assert) {
  const done = assert.async();
  const tech = merge(this.tech, {
    hasStarted_: false
  });

  seekToProgramTime({
    programTime: 1,
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

  seekToProgramTime({
    programTime: '2018-10-12T22:33:52.037+00:00',
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
  const tech = merge(this.tech, {
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

  seekToProgramTime({
    programTime: '2018-10-12T22:33:50.037+00:00',
    playlist: {
      segments: [
        {
          dateTimeString: '2018-10-12T22:33:49.037+00:00',
          dateTimeObject: new Date('2018-10-12T22:33:49.037+00:00'),
          duration: 1,
          start: 0,
          videoTimingInfo: {
            transmuxerPrependedSeconds: 0,
            transmuxedPresentationStart: 0,
            transmuxedPresentationEnd: 1
          }
        }, {
          dateTimeString: '2018-10-12T22:33:50.037+00:00',
          dateTimeObject: new Date('2018-10-12T22:33:50.037+00:00'),
          duration: 1,
          start: 1,
          videoTimingInfo: {
            transmuxerPrependedSeconds: 0,
            transmuxedPresentationStart: 1,
            transmuxedPresentationEnd: 2
          }
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

QUnit.test('vod: does not account for prepended content duration', function(assert) {
  let currentTime = 0;
  const done = assert.async();
  const handlers = {};
  const tech = merge(this.tech, {
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

  seekToProgramTime({
    programTime: '2018-10-12T22:33:51.037+00:00',
    playlist: {
      segments: [
        {
          dateTimeString: '2018-10-12T22:33:48.037+00:00',
          dateTimeObject: new Date('2018-10-12T22:33:48.037+00:00'),
          duration: 2,
          start: 0,
          videoTimingInfo: {
            transmuxerPrependedSeconds: 0,
            transmuxedPresentationStart: 0,
            transmuxedPresentationEnd: 2
          }
        }, {
          dateTimeString: '2018-10-12T22:33:50.037+00:00',
          dateTimeObject: new Date('2018-10-12T22:33:50.037+00:00'),
          duration: 2,
          start: 2,
          videoTimingInfo: {
            transmuxerPrependedSeconds: 1,
            transmuxedPresentationStart: 1,
            transmuxedPresentationEnd: 4
          }
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
        3,
        'did not offset seek time by transmuxer modifications'
      );
      done();
    }
  });
});

QUnit.test('live: seeks and returns player time seeked to if buffered', function(assert) {
  let currentTime = 0;
  const done = assert.async();
  const handlers = {};
  const tech = merge(this.tech, {
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

  seekToProgramTime({
    programTime: '2018-10-12T22:33:50.037+00:00',
    playlist: {
      segments: [
        {
          dateTimeString: '2018-10-12T22:33:49.037+00:00',
          dateTimeObject: new Date('2018-10-12T22:33:49.037+00:00'),
          duration: 1,
          start: 0,
          videoTimingInfo: {
            transmuxerPrependedSeconds: 0,
            transmuxedPresentationStart: 0,
            transmuxedPresentationEnd: 1
          }
        }, {
          dateTimeString: '2018-10-12T22:33:50.037+00:00',
          dateTimeObject: new Date('2018-10-12T22:33:50.037+00:00'),
          duration: 1,
          start: 1,
          videoTimingInfo: {
            transmuxerPrependedSeconds: 0,
            transmuxedPresentationStart: 1,
            transmuxedPresentationEnd: 2
          }
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
  const tech = merge(this.tech, {
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

  seekToProgramTime({
    programTime: '2018-10-12T22:33:50.037+00:00',
    playlist: {
      segments: [
        {
          dateTimeString: '2018-10-12T22:33:49.037+00:00',
          dateTimeObject: new Date('2018-10-12T22:33:49.037+00:00'),
          duration: 1,
          start: 0,
          videoTimingInfo: {
            transmuxerPrependedSeconds: 0,
            transmuxedPresentationStart: 0,
            transmuxedPresentationEnd: 1
          }
        }, {
          dateTimeString: '2018-10-12T22:33:50.037+00:00',
          dateTimeObject: new Date('2018-10-12T22:33:50.037+00:00'),
          duration: 1,
          start: 1,
          videoTimingInfo: {
            transmuxerPrependedSeconds: 0,
            transmuxedPresentationStart: 1,
            transmuxedPresentationEnd: 2
          }
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
