import Playlist from '../src/playlist';
import PlaylistLoader from '../src/playlist-loader';
import QUnit from 'qunit';
import xhrFactory from '../src/xhr';
import { useFakeEnvironment } from './test-helpers';
// needed for plugin registration
import '../src/videojs-http-streaming';

QUnit.module('Playlist Duration');

QUnit.test('total duration for live playlists is Infinity', function(assert) {
  const duration = Playlist.duration({
    segments: [{
      duration: 4,
      uri: '0.ts'
    }]
  });

  assert.equal(duration, Infinity, 'duration is infinity');
});

QUnit.module('Playlist Interval Duration');

QUnit.test('accounts for non-zero starting VOD media sequences', function(assert) {
  const duration = Playlist.duration({
    mediaSequence: 10,
    endList: true,
    segments: [{
      duration: 10,
      uri: '0.ts'
    }, {
      duration: 10,
      uri: '1.ts'
    }, {
      duration: 10,
      uri: '2.ts'
    }, {
      duration: 10,
      uri: '3.ts'
    }]
  });

  assert.equal(duration, 4 * 10, 'includes only listed segments');
});

QUnit.test('uses timeline values when available', function(assert) {
  const duration = Playlist.duration({
    mediaSequence: 0,
    endList: true,
    segments: [{
      start: 0,
      uri: '0.ts'
    }, {
      duration: 10,
      end: 2 * 10 + 2,
      uri: '1.ts'
    }, {
      duration: 10,
      end: 3 * 10 + 2,
      uri: '2.ts'
    }, {
      duration: 10,
      end: 4 * 10 + 2,
      uri: '3.ts'
    }]
  }, 4);

  assert.equal(duration, 4 * 10 + 2, 'used timeline values');
});

QUnit.test('works when partial timeline information is available', function(assert) {
  const duration = Playlist.duration({
    mediaSequence: 0,
    endList: true,
    segments: [{
      start: 0,
      uri: '0.ts'
    }, {
      duration: 9,
      uri: '1.ts'
    }, {
      duration: 10,
      uri: '2.ts'
    }, {
      duration: 10,
      start: 30.007,
      end: 40.002,
      uri: '3.ts'
    }, {
      duration: 10,
      end: 50.0002,
      uri: '4.ts'
    }]
  }, 5);

  assert.equal(duration, 50.0002, 'calculated with mixed intervals');
});

QUnit.test(
  'uses timeline values for the expired duration of live playlists',
  function(assert) {
    const playlist = {
      mediaSequence: 12,
      segments: [{
        duration: 10,
        end: 120.5,
        uri: '0.ts'
      }, {
        duration: 9,
        uri: '1.ts'
      }]
    };
    let duration;

    duration = Playlist.duration(playlist, playlist.mediaSequence);
    assert.equal(duration, 110.5, 'used segment end time');
    duration = Playlist.duration(playlist, playlist.mediaSequence + 1);
    assert.equal(duration, 120.5, 'used segment end time');
    duration = Playlist.duration(playlist, playlist.mediaSequence + 2);
    assert.equal(duration, 120.5 + 9, 'used segment end time');
  }
);

QUnit.test(
  'looks outside the queried interval for live playlist timeline values',
  function(assert) {
    const playlist = {
      mediaSequence: 12,
      segments: [{
        duration: 10,
        uri: '0.ts'
      }, {
        duration: 9,
        end: 120.5,
        uri: '1.ts'
      }]
    };
    const duration = Playlist.duration(playlist, playlist.mediaSequence);

    assert.equal(duration, 120.5 - 9 - 10, 'used segment end time');
  }
);

QUnit.test('ignores discontinuity sequences later than the end', function(assert) {
  const duration = Playlist.duration({
    mediaSequence: 0,
    discontinuityStarts: [1, 3],
    segments: [{
      duration: 10,
      uri: '0.ts'
    }, {
      discontinuity: true,
      duration: 9,
      uri: '1.ts'
    }, {
      duration: 10,
      uri: '2.ts'
    }, {
      discontinuity: true,
      duration: 10,
      uri: '3.ts'
    }]
  }, 2);

  assert.equal(duration, 19, 'excluded the later segments');
});

QUnit.test('handles trailing segments without timeline information', function(assert) {
  let duration;
  const playlist = {
    mediaSequence: 0,
    endList: true,
    segments: [{
      start: 0,
      end: 10.5,
      uri: '0.ts'
    }, {
      duration: 9,
      uri: '1.ts'
    }, {
      duration: 10,
      uri: '2.ts'
    }, {
      start: 29.45,
      end: 39.5,
      uri: '3.ts'
    }]
  };

  duration = Playlist.duration(playlist, 3);
  assert.equal(duration, 29.45, 'calculated duration');

  duration = Playlist.duration(playlist, 2);
  assert.equal(duration, 19.5, 'calculated duration');
});

QUnit.test('uses timeline intervals when segments have them', function(assert) {
  let duration;
  const playlist = {
    mediaSequence: 0,
    segments: [{
      start: 0,
      end: 10,
      uri: '0.ts'
    }, {
      duration: 9,
      uri: '1.ts'
    }, {
      start: 20.1,
      end: 30.1,
      duration: 10,
      uri: '2.ts'
    }]
  };

  duration = Playlist.duration(playlist, 2);
  assert.equal(duration, 20.1, 'used the timeline-based interval');

  duration = Playlist.duration(playlist, 3);
  assert.equal(duration, 30.1, 'used the timeline-based interval');
});

QUnit.test(
  'counts the time between segments as part of the earlier segment\'s duration',
  function(assert) {
    const duration = Playlist.duration({
      mediaSequence: 0,
      endList: true,
      segments: [{
        start: 0,
        end: 10,
        uri: '0.ts'
      }, {
        start: 10.1,
        end: 20.1,
        duration: 10,
        uri: '1.ts'
      }]
    }, 1);

    assert.equal(duration, 10.1, 'included the segment gap');
  }
);

QUnit.test('accounts for discontinuities', function(assert) {
  const duration = Playlist.duration({
    mediaSequence: 0,
    endList: true,
    discontinuityStarts: [1],
    segments: [{
      duration: 10,
      uri: '0.ts'
    }, {
      discontinuity: true,
      duration: 10,
      uri: '1.ts'
    }]
  }, 2);

  assert.equal(duration, 10 + 10, 'handles discontinuities');
});

QUnit.test('a non-positive length interval has zero duration', function(assert) {
  const playlist = {
    mediaSequence: 0,
    discontinuityStarts: [1],
    segments: [{
      duration: 10,
      uri: '0.ts'
    }, {
      discontinuity: true,
      duration: 10,
      uri: '1.ts'
    }]
  };

  assert.equal(Playlist.duration(playlist, 0), 0, 'zero-length duration is zero');
  assert.equal(Playlist.duration(playlist, 0, false), 0, 'zero-length duration is zero');
  assert.equal(Playlist.duration(playlist, -1), 0, 'negative length duration is zero');
});

QUnit.module('Playlist Seekable');

QUnit.test('calculates seekable time ranges from available segments', function(assert) {
  const playlist = {
    mediaSequence: 0,
    segments: [{
      duration: 10,
      uri: '0.ts'
    }, {
      duration: 10,
      uri: '1.ts'
    }],
    endList: true
  };
  const seekable = Playlist.seekable(playlist);

  assert.equal(seekable.length, 1, 'there are seekable ranges');
  assert.equal(seekable.start(0), 0, 'starts at zero');
  assert.equal(seekable.end(0), Playlist.duration(playlist), 'ends at the duration');
});

QUnit.test('calculates playlist end time from the available segments', function(assert) {
  const playlistEnd = Playlist.playlistEnd({
    mediaSequence: 0,
    segments: [{
      duration: 10,
      uri: '0.ts'
    }, {
      duration: 10,
      uri: '1.ts'
    }],
    endList: true
  });

  assert.equal(playlistEnd, 20, 'paylist end at the duration');
});

QUnit.test(
  'master playlists have empty seekable ranges and no playlist end',
  function(assert) {
    const playlist = {
      playlists: [{
        uri: 'low.m3u8'
      }, {
        uri: 'high.m3u8'
      }]
    };
    const seekable = Playlist.seekable(playlist);
    const playlistEnd = Playlist.playlistEnd(playlist);

    assert.equal(seekable.length, 0, 'no seekable ranges from a master playlist');
    assert.equal(playlistEnd, null, 'no playlist end from a master playlist');
  }
);

QUnit.test(
  'seekable end is three target durations from the actual end of live playlists',
  function(assert) {
    const seekable = Playlist.seekable({
      mediaSequence: 0,
      syncInfo: {
        time: 0,
        mediaSequence: 0
      },
      targetDuration: 10,
      segments: [{
        duration: 7,
        uri: '0.ts'
      }, {
        duration: 10,
        uri: '1.ts'
      }, {
        duration: 10,
        uri: '2.ts'
      }, {
        duration: 10,
        uri: '3.ts'
      }]
    });

    assert.equal(seekable.length, 1, 'there are seekable ranges');
    assert.equal(seekable.start(0), 0, 'starts at zero');
    assert.equal(seekable.end(0), 7, 'ends three target durations from the last segment');
  }
);

QUnit.test(
  'seekable end and playlist end account for non-standard target durations',
  function(assert) {
    const playlist = {
      targetDuration: 2,
      mediaSequence: 0,
      syncInfo: {
        time: 0,
        mediaSequence: 0
      },
      segments: [{
        duration: 2,
        uri: '0.ts'
      }, {
        duration: 2,
        uri: '1.ts'
      }, {
        duration: 1,
        uri: '2.ts'
      }, {
        duration: 2,
        uri: '3.ts'
      }, {
        duration: 2,
        uri: '4.ts'
      }]
    };
    const seekable = Playlist.seekable(playlist);
    const playlistEnd = Playlist.playlistEnd(playlist);

    assert.equal(seekable.start(0), 0, 'starts at the earliest available segment');
    assert.equal(
      seekable.end(0),
      // Playlist duration is 9s. Target duration 2s. Seekable end should be at
      // least 6s from end. Adding segment durations starting from the end to get
      // that 6s target
      9 - (2 + 2 + 1 + 2),
      'allows seeking no further than the start of the segment 2 target' +
               'durations back from the beginning of the last segment'
    );
    assert.equal(playlistEnd, 9, 'playlist end at the last segment');
  }
);

QUnit.test('safeLiveIndex is correct for standard segment durations', function(assert) {
  const playlist = {
    targetDuration: 6,
    mediaSequence: 10,
    syncInfo: {
      time: 0,
      mediaSequence: 10
    },
    segments: [
      {
        duration: 6
      },
      {
        duration: 6
      },
      {
        duration: 6
      },
      {
        duration: 6
      },
      {
        duration: 6
      },
      {
        duration: 6
      }
    ]
  };

  assert.equal(
    Playlist.safeLiveIndex(playlist), 3,
    'correct media index for standard durations'
  );
});

QUnit.test('safeLiveIndex is correct for variable segment durations', function(assert) {
  const playlist = {
    targetDuration: 6,
    mediaSequence: 10,
    syncInfo: {
      time: 0,
      mediaSequence: 10
    },
    segments: [
      {
        duration: 6
      },
      {
        duration: 4
      },
      {
        duration: 5
      },
      {
        // this segment is 16 seconds from the end of playlist, the safe live point
        duration: 6
      },
      {
        duration: 3
      },
      {
        duration: 4
      },
      {
        duration: 3
      }
    ]
  };

  // safe live point is no less than 15 seconds (3s + 2 * 6s) from the end of the playlist
  assert.equal(
    Playlist.safeLiveIndex(playlist), 3,
    'correct media index for variable segment durations'
  );
});

QUnit.test('safeLiveIndex is 0 when no safe live point', function(assert) {
  const playlist = {
    targetDuration: 6,
    mediaSequence: 10,
    syncInfo: {
      time: 0,
      mediaSequence: 10
    },
    segments: [
      {
        duration: 6
      },
      {
        duration: 3
      },
      {
        duration: 3
      }
    ]
  };

  assert.equal(
    Playlist.safeLiveIndex(playlist), 0,
    'returns media index 0 when playlist has no safe live point'
  );
});

QUnit.test('safeLiveIndex accounts for liveEdgePadding in simple case', function(assert) {
  const playlist = {
    targetDuration: 6,
    mediaSequence: 10,
    syncInfo: {
      time: 0,
      mediaSequence: 10
    },
    segments: [
      {
        duration: 6
      },
      {
        duration: 6
      },
      {
        duration: 6
      },
      {
        duration: 6
      },
      {
        duration: 6
      },
      {
        duration: 6
      }
    ]
  };

  assert.equal(
    Playlist.safeLiveIndex(playlist, 36), 0,
    'returns 0 when liveEdgePadding is 30 and duration is 6'
  );

  assert.equal(
    Playlist.safeLiveIndex(playlist, 30), 1,
    'returns 1 when liveEdgePadding is 30 and duration is 6'
  );

  assert.equal(
    Playlist.safeLiveIndex(playlist, 24), 2,
    'returns 2 when liveEdgePadding is 24 and duration is 6'
  );

  assert.equal(
    Playlist.safeLiveIndex(playlist, 18), 3,
    'returns 3 when liveEdgePadding is 18 and duration is 6'
  );

  assert.equal(
    Playlist.safeLiveIndex(playlist, 12), 4,
    'returns 4 when liveEdgePadding is 12 and duration is 6'
  );

  assert.equal(
    Playlist.safeLiveIndex(playlist, 6), 5,
    'returns 5 when liveEdgePadding is 6 and duration is 6'
  );

  assert.equal(
    Playlist.safeLiveIndex(playlist, 0), 5,
    'returns 6 when liveEdgePadding is 0 and duration is 6'
  );
});

QUnit.test('safeLiveIndex accounts for liveEdgePadding in non-simple case', function(assert) {
  const playlist = {
    targetDuration: 6,
    mediaSequence: 10,
    syncInfo: {
      time: 0,
      mediaSequence: 10
    },
    segments: [
      {
        duration: 3
      },
      {
        duration: 6
      },
      {
        duration: 6
      },
      {
        duration: 3
      },
      {
        duration: 3
      },
      {
        duration: 0.5
      }
    ]
  };

  assert.equal(
    Playlist.safeLiveIndex(playlist, 24), 0,
    'returns 0 when liveEdgePadding is 24'
  );

  assert.equal(
    Playlist.safeLiveIndex(playlist, 18), 1,
    'returns 1 when liveEdgePadding is 18'
  );

  assert.equal(
    Playlist.safeLiveIndex(playlist, 12), 2,
    'returns 2 when liveEdgePadding is 12'
  );

  assert.equal(
    Playlist.safeLiveIndex(playlist, 6), 3,
    'returns 3 when liveEdgePadding is 6'
  );

  assert.equal(
    Playlist.safeLiveIndex(playlist, 4), 3,
    'returns 3 when liveEdgePadding is 4'
  );

  assert.equal(
    Playlist.safeLiveIndex(playlist, 1), 4,
    'returns 4 when liveEdgePadding is 1'
  );

  assert.equal(
    Playlist.safeLiveIndex(playlist, 0.5), 5,
    'returns 5 when liveEdgePadding is 0.5'
  );

  assert.equal(
    Playlist.safeLiveIndex(playlist, 0.25), 5,
    'returns 5 when liveEdgePadding is 0.25'
  );

  assert.equal(
    Playlist.safeLiveIndex(playlist, 0), 5,
    'returns 6 when liveEdgePadding is 0'
  );
});

QUnit.test('getHoldBack works as expected', function(assert) {
  const media = {
    endList: true,
    targetDuration: 5,
    partTargetDuration: 1.1,
    serverControl: {
      holdBack: 20,
      partHoldBack: 2
    },
    segments: [
      {duration: 4},
      {duration: 3},
      {duration: 4, parts: [
        {duration: 1},
        {duration: 1},
        {duration: 1},
        {duration: 0.5},
        {duration: 0.5}
      ]}
    ]
  };
  const master = {
    suggestedPresentationDelay: 10
  };

  assert.equal(
    Playlist.getHoldBack(master, media),
    0,
    'returns 0 with endlist'
  );

  delete media.endList;
  assert.equal(
    Playlist.getHoldBack(master, media),
    master.suggestedPresentationDelay,
    'uses suggestedPresentationDelay'
  );

  delete master.suggestedPresentationDelay;
  assert.equal(
    Playlist.getHoldBack(master, media),
    media.serverControl.partHoldBack,
    'uses part hold back'
  );

  media.serverControl.partHoldBack = null;
  assert.equal(
    Playlist.getHoldBack(master, media),
    media.partTargetDuration * 3,
    'uses part target duration * 3'
  );

  media.partTargetDuration = null;
  assert.equal(
    Playlist.getHoldBack(master, media),
    2,
    'uses last three part durations'
  );

  media.segments[media.segments.length - 1].parts = null;
  assert.equal(
    Playlist.getHoldBack(master, media),
    media.serverControl.holdBack,
    'uses hold back'
  );

  media.serverControl.holdBack = null;
  assert.equal(
    Playlist.getHoldBack(master, media),
    (media.targetDuration * 2) + media.segments[media.segments.length - 1].duration,
    'uses (targetDuration * 2) + last segment duration'
  );

  media.targetDuration = null;
  assert.equal(
    Playlist.getHoldBack(master, media),
    11,
    'uses last three segment durations'
  );

  media.segments.length = 0;

  assert.equal(
    Playlist.getHoldBack(master, media),
    0,
    'no possible holdback can be calculated'
  );
});

QUnit.test(
  'seekable end and playlist end account for non-zero starting VOD media sequence',
  function(assert) {
    const playlist = {
      targetDuration: 2,
      mediaSequence: 5,
      endList: true,
      segments: [{
        duration: 2,
        uri: '0.ts'
      }, {
        duration: 2,
        uri: '1.ts'
      }, {
        duration: 1,
        uri: '2.ts'
      }, {
        duration: 2,
        uri: '3.ts'
      }, {
        duration: 2,
        uri: '4.ts'
      }]
    };
    const seekable = Playlist.seekable(playlist);
    const playlistEnd = Playlist.playlistEnd(playlist);

    assert.equal(seekable.start(0), 0, 'starts at the earliest available segment');
    assert.equal(seekable.end(0), 9, 'seekable end is same as duration');
    assert.equal(playlistEnd, 9, 'playlist end at the last segment');
  }
);

QUnit.test(
  'playlist with no sync points has empty seekable range and empty playlist end',
  function(assert) {
    const playlist = {
      targetDuration: 10,
      mediaSequence: 0,
      segments: [{
        duration: 7,
        uri: '0.ts'
      }, {
        duration: 10,
        uri: '1.ts'
      }, {
        duration: 10,
        uri: '2.ts'
      }, {
        duration: 10,
        uri: '3.ts'
      }]
    };

    // seekable and playlistEnd take an optional expired parameter that is from
    // SyncController.getExpiredTime which returns null when there is no sync point, so
    // this test passes in null to simulate no sync points
    const seekable = Playlist.seekable(playlist, null);
    const playlistEnd = Playlist.playlistEnd(playlist, null);

    assert.equal(seekable.length, 0, 'no seekable range for playlist with no sync points');
    assert.equal(playlistEnd, null, 'no playlist end for playlist with no sync points');
  }
);

QUnit.test(
  'seekable and playlistEnd use available sync points for calculating',
  function(assert) {
    let playlist = {
      targetDuration: 10,
      mediaSequence: 100,
      syncInfo: {
        time: 50,
        mediaSequence: 95
      },
      segments: [
        {
          duration: 10,
          uri: '0.ts'
        },
        {
          duration: 10,
          uri: '1.ts'
        },
        {
          duration: 10,
          uri: '2.ts'
        },
        {
          duration: 10,
          uri: '3.ts'
        },
        {
          duration: 10,
          uri: '4.ts'
        }
      ]
    };

    // getExpiredTime would return 100 for this playlist
    let seekable = Playlist.seekable(playlist, 100);
    let playlistEnd = Playlist.playlistEnd(playlist, 100);

    assert.ok(seekable.length, 'seekable range calculated');
    assert.equal(
      seekable.start(0),
      100,
      'estimated start time based on expired sync point'
    );
    assert.equal(
      seekable.end(0),
      120,
      'allows seeking no further than three segments from the end'
    );
    assert.equal(playlistEnd, 150, 'playlist end at the last segment end');

    playlist = {
      targetDuration: 10,
      mediaSequence: 100,
      segments: [
        {
          duration: 10,
          uri: '0.ts'
        },
        {
          duration: 10,
          uri: '1.ts',
          start: 108.5,
          end: 118.4
        },
        {
          duration: 10,
          uri: '2.ts'
        },
        {
          duration: 10,
          uri: '3.ts'
        },
        {
          duration: 10,
          uri: '4.ts'
        }
      ]
    };

    // getExpiredTime would return 98.5
    seekable = Playlist.seekable(playlist, 98.5);
    playlistEnd = Playlist.playlistEnd(playlist, 98.5);

    assert.ok(seekable.length, 'seekable range calculated');
    assert.equal(seekable.start(0), 98.5, 'estimated start time using segmentSync');
    assert.equal(
      seekable.end(0),
      118.4,
      'allows seeking no further than three segments from the end'
    );
    assert.equal(playlistEnd, 148.4, 'playlist end at the last segment end');

    playlist = {
      targetDuration: 10,
      mediaSequence: 100,
      syncInfo: {
        time: 50,
        mediaSequence: 95
      },
      segments: [
        {
          duration: 10,
          uri: '0.ts'
        },
        {
          duration: 10,
          uri: '1.ts',
          start: 108.5,
          end: 118.5
        },
        {
          duration: 10,
          uri: '2.ts'
        },
        {
          duration: 10,
          uri: '3.ts'
        },
        {
          duration: 10,
          uri: '4.ts'
        }
      ]
    };

    // getExpiredTime would return 98.5
    seekable = Playlist.seekable(playlist, 98.5);
    playlistEnd = Playlist.playlistEnd(playlist, 98.5);

    assert.ok(seekable.length, 'seekable range calculated');
    assert.equal(
      seekable.start(0),
      98.5,
      'estimated start time using nearest sync point (segmentSync in this case)'
    );
    assert.equal(
      seekable.end(0),
      118.5,
      'allows seeking no further than three segments from the end'
    );
    assert.equal(playlistEnd, 148.5, 'playlist end at the last segment end');

    playlist = {
      targetDuration: 10,
      mediaSequence: 100,
      syncInfo: {
        time: 90.8,
        mediaSequence: 99
      },
      segments: [
        {
          duration: 10,
          uri: '0.ts'
        },
        {
          duration: 10,
          uri: '1.ts'
        },
        {
          duration: 10,
          uri: '2.ts',
          start: 118.5,
          end: 128.5
        },
        {
          duration: 10,
          uri: '3.ts'
        },
        {
          duration: 10,
          uri: '4.ts'
        }
      ]
    };

    // getExpiredTime would return 100.8
    seekable = Playlist.seekable(playlist, 100.8);
    playlistEnd = Playlist.playlistEnd(playlist, 100.8);

    assert.ok(seekable.length, 'seekable range calculated');
    assert.equal(
      seekable.start(0),
      100.8,
      'estimated start time using nearest sync point (expiredSync in this case)'
    );
    assert.equal(
      seekable.end(0),
      118.5,
      'allows seeking no further than three segments from the end'
    );
    assert.equal(playlistEnd, 148.5, 'playlist end at the last segment end');
  }
);

QUnit.module('Playlist hasAttribute');

QUnit.test('correctly checks for existence of playlist attribute', function(assert) {
  const playlist = {};

  assert.notOk(
    Playlist.hasAttribute('BANDWIDTH', playlist),
    'false for playlist with no attributes property'
  );

  playlist.attributes = {};

  assert.notOk(
    Playlist.hasAttribute('BANDWIDTH', playlist),
    'false for playlist with without specified attribute'
  );

  playlist.attributes.BANDWIDTH = 100;

  assert.ok(
    Playlist.hasAttribute('BANDWIDTH', playlist),
    'true for playlist with specified attribute'
  );
});

QUnit.module('Playlist estimateSegmentRequestTime');

QUnit.test('estimates segment request time based on bandwidth', function(assert) {
  const segmentDuration = 10;
  const bandwidth = 100;
  const playlist = { attributes: { } };
  let bytesReceived = 0;

  let estimate = Playlist.estimateSegmentRequestTime(
    segmentDuration,
    bandwidth,
    playlist,
    bytesReceived
  );

  assert.ok(isNaN(estimate), 'returns NaN when no BANDWIDTH information on playlist');

  playlist.attributes.BANDWIDTH = 100;

  estimate = Playlist.estimateSegmentRequestTime(
    segmentDuration,
    bandwidth,
    playlist,
    bytesReceived
  );

  assert.equal(estimate, 10, 'calculated estimated download time');

  bytesReceived = 25;

  estimate = Playlist.estimateSegmentRequestTime(
    segmentDuration,
    bandwidth,
    playlist,
    bytesReceived
  );

  assert.equal(estimate, 8, 'takes into account bytes already received from download');
});

QUnit.module('Playlist enabled states', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.clock = this.env.clock;
  },
  afterEach() {
    this.env.restore();
  }
});

QUnit.test('determines if a playlist is incompatible', function(assert) {
  // incompatible means that the playlist was blacklisted due to incompatible
  // configuration e.g. audio only stream when trying to playback audio and video.
  // incompaatibility is denoted by a blacklist of Infinity.
  assert.notOk(
    Playlist.isIncompatible({}),
    'playlist not incompatible if no excludeUntil'
  );

  assert.notOk(
    Playlist.isIncompatible({ excludeUntil: 1 }),
    'playlist not incompatible if expired blacklist'
  );

  assert.notOk(
    Playlist.isIncompatible({ excludeUntil: Date.now() + 9999 }),
    'playlist not incompatible if temporarily blacklisted'
  );

  assert.ok(
    Playlist.isIncompatible({ excludeUntil: Infinity }),
    'playlist is incompatible if excludeUntil is Infinity'
  );
});

QUnit.test('determines if a playlist is blacklisted', function(assert) {
  assert.notOk(
    Playlist.isBlacklisted({}),
    'playlist not blacklisted if no excludeUntil'
  );

  assert.notOk(
    Playlist.isBlacklisted({ excludeUntil: Date.now() - 1 }),
    'playlist not blacklisted if expired excludeUntil'
  );

  assert.ok(
    Playlist.isBlacklisted({ excludeUntil: Date.now() + 9999 }),
    'playlist is blacklisted'
  );

  assert.ok(
    Playlist.isBlacklisted({ excludeUntil: Infinity }),
    'playlist is blacklisted if excludeUntil is Infinity'
  );
});

QUnit.test('determines if a playlist is disabled', function(assert) {
  assert.notOk(Playlist.isDisabled({}), 'playlist not disabled');

  assert.ok(Playlist.isDisabled({ disabled: true }), 'playlist is disabled');
});

QUnit.test('playlists with no or expired blacklist are enabled', function(assert) {
  // enabled means not blacklisted and not disabled
  assert.ok(Playlist.isEnabled({}), 'playlist with no blacklist is enabled');
  assert.ok(
    Playlist.isEnabled({ excludeUntil: Date.now() - 1 }),
    'playlist with expired blacklist is enabled'
  );
});

QUnit.test('blacklisted playlists are not enabled', function(assert) {
  // enabled means not blacklisted and not disabled
  assert.notOk(
    Playlist.isEnabled({ excludeUntil: Date.now() + 9999 }),
    'playlist with temporary blacklist is not enabled'
  );
  assert.notOk(
    Playlist.isEnabled({ excludeUntil: Infinity }),
    'playlist with permanent is not enabled'
  );
});

QUnit.test(
  'manually disabled playlists are not enabled regardless of blacklist state',
  function(assert) {
  // enabled means not blacklisted and not disabled
    assert.notOk(
      Playlist.isEnabled({ disabled: true }),
      'disabled playlist with no blacklist is not enabled'
    );
    assert.notOk(
      Playlist.isEnabled({ disabled: true, excludeUntil: Date.now() - 1 }),
      'disabled playlist with expired blacklist is not enabled'
    );
    assert.notOk(
      Playlist.isEnabled({ disabled: true, excludeUntil: Date.now() + 9999 }),
      'disabled playlist with temporary blacklist is not enabled'
    );
    assert.notOk(
      Playlist.isEnabled({ disabled: true, excludeUntil: Infinity }),
      'disabled playlist with permanent blacklist is not enabled'
    );
  }
);

QUnit.test(
  'isLowestEnabledRendition detects if we are on lowest rendition',
  function(assert) {
    assert.ok(
      Playlist.isLowestEnabledRendition(
        {
          playlists: [
            {attributes: {BANDWIDTH: 10}},
            {attributes: {BANDWIDTH: 20}}
          ]
        },
        {attributes: {BANDWIDTH: 10}}
      ),
      'Detected on lowest rendition'
    );

    assert.ok(
      Playlist.isLowestEnabledRendition(
        {
          playlists: [
            {attributes: {BANDWIDTH: 10}},
            {attributes: {BANDWIDTH: 10}},
            {attributes: {BANDWIDTH: 10}},
            {attributes: {BANDWIDTH: 20}}
          ]
        },
        {attributes: {BANDWIDTH: 10}}
      ),
      'Detected on lowest rendition'
    );

    assert.notOk(
      Playlist.isLowestEnabledRendition(
        {
          playlists: [
            {attributes: {BANDWIDTH: 10}},
            {attributes: {BANDWIDTH: 20}}
          ]
        },
        {attributes: {BANDWIDTH: 20}}
      ),
      'Detected not on lowest rendition'
    );
  }
);

QUnit.module('Playlist isAes', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.clock = this.env.clock;
    this.requests = this.env.requests;
    this.fakeVhs = {
      xhr: xhrFactory()
    };
  },
  afterEach() {
    this.env.restore();
  }
});

QUnit.test('determine if playlist is an AES encrypted HLS stream', function(assert) {
  const loader = new PlaylistLoader('media.m3u8', this.fakeVhs);

  loader.load();
  this.requests.shift().respond(
    200,
    null,
    '#EXTM3U\n' +
    '#EXT-X-TARGETDURATION:15\n' +
    '#EXT-X-KEY:METHOD=AES-128,URI="http://example.com/keys/key.php"\n' +
    '#EXTINF:2.833,\n' +
    'http://example.com/000001.ts\n' +
    '#EXT-X-ENDLIST\n'
  );

  const media = loader.media();

  assert.ok(Playlist.isAes(media), 'media is an AES encrypted HLS stream');
});

QUnit.module('Playlist Media Index For Time', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.clock = this.env.clock;
    this.requests = this.env.requests;
    this.fakeVhs = {
      xhr: xhrFactory()
    };
  },
  afterEach() {
    this.env.restore();
  }
});

QUnit.test(
  'can get media index by playback position for non-live videos',
  function(assert) {
    const loader = new PlaylistLoader('media.m3u8', this.fakeVhs);

    loader.load();

    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
    '#EXT-X-MEDIA-SEQUENCE:0\n' +
    '#EXTINF:4,\n' +
    '0.ts\n' +
    '#EXTINF:5,\n' +
    '1.ts\n' +
    '#EXTINF:6,\n' +
    '2.ts\n' +
    '#EXT-X-ENDLIST\n'
    );

    const media = loader.media();

    assert.equal(
      Playlist.getMediaInfoForTime(media, -1, 0, 0).mediaIndex, 0,
      'the index is never less than zero'
    );
    assert.equal(
      Playlist.getMediaInfoForTime(media, 0, 0, 0).mediaIndex, 0,
      'time zero is index zero'
    );
    assert.equal(
      Playlist.getMediaInfoForTime(media, 3, 0, 0).mediaIndex, 0,
      'time three is index zero'
    );
    assert.equal(
      Playlist.getMediaInfoForTime(media, 10, 0, 0).mediaIndex, 2,
      'time 10 is index 2'
    );
    assert.equal(
      Playlist.getMediaInfoForTime(media, 22, 0, 0).mediaIndex, 2,
      'time greater than the length is index 2'
    );
  }
);

QUnit.test('rounding down works', function(assert) {
  const loader = new PlaylistLoader('media.m3u8', this.fakeVhs);

  loader.load();

  this.requests.shift().respond(
    200, null,
    '#EXTM3U\n' +
    '#EXT-X-MEDIA-SEQUENCE:0\n' +
    '#EXTINF:2,\n' +
    '0.ts\n' +
    '#EXTINF:2,\n' +
    '1.ts\n' +
    '#EXTINF:2,\n' +
    '2.ts\n' +
    '#EXTINF:2,\n' +
    '3.ts\n' +
    '#EXTINF:2,\n' +
    '4.ts\n' +
    '#EXTINF:2,\n' +
    '5.ts\n' +
    '#EXT-X-ENDLIST\n'
  );

  const media = loader.media();
  const fn = Playlist.getMediaInfoForTime;

  // 1 segment away
  assert.equal(fn(media, 2.1, 0, 0).mediaIndex, 1, '1 away 2 is correct');
  assert.equal(fn(media, 4.1, 1, 2).mediaIndex, 2, '1 away 3 is correct ');
  assert.equal(fn(media, 6.1, 2, 4).mediaIndex, 3, '1 away 4 is correct');
  assert.equal(fn(media, 8.1, 3, 6).mediaIndex, 4, '1 away 5 is correct');
  assert.equal(fn(media, 10.1, 4, 8).mediaIndex, 5, '1 away 6 is correct');

  // 2 segment away
  assert.equal(fn(media, 4.1, 0, 0).mediaIndex, 2, '2 away 3 is correct ');
  assert.equal(fn(media, 6.1, 1, 2).mediaIndex, 3, '2 away 4 is correct');
  assert.equal(fn(media, 8.1, 2, 4).mediaIndex, 4, '2 away 5 is correct');
  assert.equal(fn(media, 10.1, 3, 6).mediaIndex, 5, '2 away 6 is correct');

  // 3 segments away
  assert.equal(fn(media, 6.1, 0, 0).mediaIndex, 3, '3 away 4 is correct');
  assert.equal(fn(media, 8.1, 1, 2).mediaIndex, 4, '3 away 5 is correct');
  assert.equal(fn(media, 10.1, 2, 4).mediaIndex, 5, '3 away 6 is correct');
});

QUnit.test('rounding up works', function(assert) {
  const loader = new PlaylistLoader('media.m3u8', this.fakeVhs);

  loader.load();

  this.requests.shift().respond(
    200, null,
    '#EXTM3U\n' +
    '#EXT-X-MEDIA-SEQUENCE:0\n' +
    '#EXTINF:2,\n' +
    '0.ts\n' +
    '#EXTINF:2,\n' +
    '1.ts\n' +
    '#EXTINF:2,\n' +
    '2.ts\n' +
    '#EXTINF:2,\n' +
    '3.ts\n' +
    '#EXTINF:2,\n' +
    '4.ts\n' +
    '#EXTINF:2,\n' +
    '5.ts\n' +
    '#EXT-X-ENDLIST\n'
  );

  const media = loader.media();
  const fn = Playlist.getMediaInfoForTime;

  // 1 segment away
  assert.equal(fn(media, 0, 1, 2).mediaIndex, 0, '1 away 1 is correct');
  assert.equal(fn(media, 2.1, 2, 4).mediaIndex, 1, '1 away 2 is correct');
  assert.equal(fn(media, 4.1, 3, 6).mediaIndex, 2, '1 away 3 is correct');
  assert.equal(fn(media, 6.1, 4, 8).mediaIndex, 3, '1 away 4 is correct');
  assert.equal(fn(media, 8.1, 5, 10).mediaIndex, 4, '1 away 5 is correct');

  // 2 segment away
  assert.equal(fn(media, 0, 2, 4).mediaIndex, 0, '2 away 1 is correct');
  assert.equal(fn(media, 2.1, 3, 6).mediaIndex, 1, '2 away 2 is correct');
  assert.equal(fn(media, 4.1, 4, 8).mediaIndex, 2, '2 away 3 is correct');
  assert.equal(fn(media, 6.1, 5, 10).mediaIndex, 3, '2 away 4 is correct');

  // 3 segments away
  assert.equal(fn(media, 0, 3, 6).mediaIndex, 0, '3 away 1 is correct');
  assert.equal(fn(media, 2.1, 4, 8).mediaIndex, 1, '3 away 2 is correct');
  assert.equal(fn(media, 4.1, 5, 10).mediaIndex, 2, '3 away 3 is correct');
});

QUnit.test(
  'returns the lower index when calculating for a segment boundary',
  function(assert) {
    const loader = new PlaylistLoader('media.m3u8', this.fakeVhs);

    loader.load();

    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
    '#EXT-X-MEDIA-SEQUENCE:0\n' +
    '#EXTINF:4,\n' +
    '0.ts\n' +
    '#EXTINF:5,\n' +
    '1.ts\n' +
    '#EXT-X-ENDLIST\n'
    );

    const media = loader.media();

    assert.equal(
      Playlist.getMediaInfoForTime(media, 4, 0, 0).mediaIndex, 0,
      'rounds down exact matches'
    );
    assert.equal(
      Playlist.getMediaInfoForTime(media, 3.7, 0, 0).mediaIndex, 0,
      'rounds down'
    );
    assert.equal(
      Playlist.getMediaInfoForTime(media, 4.5, 0, 0).mediaIndex, 1,
      'rounds up at 0.5'
    );
  }
);

QUnit.test(
  'accounts for non-zero starting segment time when calculating media index',
  function(assert) {
    const loader = new PlaylistLoader('media.m3u8', this.fakeVhs);

    loader.load();

    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
    '#EXT-X-MEDIA-SEQUENCE:1001\n' +
    '#EXTINF:4,\n' +
    '1001.ts\n' +
    '#EXTINF:5,\n' +
    '1002.ts\n'
    );

    const media = loader.media();

    assert.equal(
      Playlist.getMediaInfoForTime(media, 45, 0, 150).mediaIndex,
      0,
      'expired content returns 0 for earliest segment available'
    );
    assert.equal(
      Playlist.getMediaInfoForTime(media, 75, 0, 150).mediaIndex,
      0,
      'expired content returns 0 for earliest segment available'
    );
    assert.equal(
      Playlist.getMediaInfoForTime(media, 0, 0, 150).mediaIndex,
      0,
      'time of 0 with no expired time returns first segment'
    );
    assert.equal(
      Playlist.getMediaInfoForTime(media, 50 + 100, 0, 150).mediaIndex,
      0,
      'calculates the earliest available position'
    );
    assert.equal(
      Playlist.getMediaInfoForTime(media, 50 + 100 + 2, 0, 150).mediaIndex,
      0,
      'calculates within the first segment'
    );
    assert.equal(
      Playlist.getMediaInfoForTime(media, 50 + 100 + 2, 0, 150).mediaIndex,
      0,
      'calculates within the first segment'
    );
    assert.equal(
      Playlist.getMediaInfoForTime(media, 50 + 100 + 4, 0, 150).mediaIndex,
      0,
      'calculates earlier segment on exact boundary match'
    );
    assert.equal(
      Playlist.getMediaInfoForTime(media, 50 + 100 + 4.5, 0, 150).mediaIndex,
      1,
      'calculates within the second segment'
    );
    assert.equal(
      Playlist.getMediaInfoForTime(media, 50 + 100 + 6, 0, 150).mediaIndex,
      1,
      'calculates within the second segment'
    );

    assert.equal(
      Playlist.getMediaInfoForTime(media, 159, 0, 150).mediaIndex,
      1,
      'returns last segment when time is equal to end of last segment'
    );
    assert.equal(
      Playlist.getMediaInfoForTime(media, 160, 0, 150).mediaIndex,
      1,
      'returns last segment when time is past end of last segment'
    );
  }
);
