import Playlist from '../src/playlist';
import PlaylistLoader from '../src/playlist-loader';
import QUnit from 'qunit';
import xhrFactory from '../src/xhr';
import { useFakeEnvironment } from './test-helpers';
// needed for plugin registration
import '../src/videojs-http-streaming';
import {merge} from '../src/util/vjs-compat';

QUnit.module('Playlist', function() {
  QUnit.module('Duration');

  QUnit.test('total duration for live playlists is Infinity', function(assert) {
    const duration = Playlist.duration({
      segments: [{
        duration: 4,
        uri: '0.ts'
      }]
    });

    assert.equal(duration, Infinity, 'duration is infinity');
  });

  QUnit.module('Interval Duration');

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

  QUnit.test('accounts for preload segment part durations', function(assert) {
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
      }, {
        preload: true,
        parts: [
          {duration: 2},
          {duration: 2},
          {duration: 2}
        ]
      }]
    });

    assert.equal(duration, 46, 'includes segments and parts');
  });

  QUnit.test('accounts for preload segment part and preload hint durations', function(assert) {
    const duration = Playlist.duration({
      mediaSequence: 10,
      endList: true,
      partTargetDuration: 2,
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
      }, {
        preload: true,
        parts: [
          {duration: 2},
          {duration: 2},
          {duration: 2}
        ],
        preloadHints: [
          {type: 'PART'},
          {type: 'MAP'}
        ]
      }]
    });

    assert.equal(duration, 48, 'includes segments, parts, and hints');
  });

  QUnit.test('looks forward for llhls durations', function(assert) {
    const playlist = {
      mediaSequence: 12,
      partTargetDuration: 3,
      segments: [{
        duration: 10,
        uri: '0.ts'
      }, {
        duration: 9,
        uri: '1.ts'
      }, {
        end: 40,
        preload: true,
        parts: [
          {duration: 3}
        ],
        preloadHints: [
          {type: 'PART'}
        ]
      }]
    };
    const duration = Playlist.duration(playlist, playlist.mediaSequence);

    assert.equal(duration, 15, 'used llhls part/preload durations');
  });

  QUnit.module('Seekable');

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
    'main playlists have empty seekable ranges and no playlist end',
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

      assert.equal(seekable.length, 0, 'no seekable ranges from a main playlist');
      assert.equal(playlistEnd, null, 'no playlist end from a main playlist');
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
        (9 - (playlist.targetDuration * 3)),
        'three target durations behind live'
      );
      assert.equal(playlistEnd, 9, 'playlist end at the last segment');
    }
  );

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
        syncInfo: {
          time: 50,
          mediaSequence: 95
        },
        segments: [
          {
            duration: 9.01,
            uri: '0.ts'
          },
          {
            duration: 9.01,
            uri: '1.ts'
          },
          {
            duration: 9.01,
            uri: '2.ts'
          }
        ]
      };

      seekable = Playlist.seekable(playlist, 100);
      playlistEnd = Playlist.playlistEnd(playlist, 100);

      assert.ok(seekable.length, 'seekable range calculated');
      assert.equal(
        seekable.start(0),
        100,
        'estimated start time based on expired sync point'
      );
      assert.equal(
        seekable.end(0),
        100,
        'seekable end is clamped to start time'
      );
      assert.equal(playlistEnd, 127.03, 'playlist end at the last segment end');

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

  QUnit.test('playlistEnd uses default live edge padding with useSafeLiveEnd true', function(assert) {
    const playlist = {
      targetDuration: 10,
      mediaSequence: 0,
      segments: []
    };

    for (let i = 0; i < 20; i++) {
      playlist.segments.push({
        duration: 10,
        uri: `${i}.ts`
      });
    }

    const playlistEnd = Playlist.playlistEnd(playlist, 0, true);

    assert.equal(playlistEnd, 170, 'playlist end is 170');
  });

  QUnit.test('playlistEnd uses given live edge padding with useSafeLiveEnd true', function(assert) {
    const playlist = {
      targetDuration: 10,
      mediaSequence: 0,
      segments: []
    };

    for (let i = 0; i < 20; i++) {
      playlist.segments.push({
        duration: 10,
        uri: `${i}.ts`
      });
    }

    const playlistEnd = Playlist.playlistEnd(playlist, 0, true, 25);

    assert.equal(playlistEnd, 175, 'playlist end is 175');
  });

  QUnit.module('hasAttribute');

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

  QUnit.module('estimateSegmentRequestTime');

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

  QUnit.module('enabled states', {
    beforeEach(assert) {
      this.env = useFakeEnvironment(assert);
      this.clock = this.env.clock;
    },
    afterEach() {
      this.env.restore();
    }
  });

  QUnit.test('determines if a playlist is incompatible', function(assert) {
    // incompatible means that the playlist was excluded due to incompatible
    // configuration e.g. audio only stream when trying to playback audio and video.
    // incompatibility is denoted by an excludeUntil of Infinity.
    assert.notOk(
      Playlist.isIncompatible({}),
      'playlist not incompatible if no excludeUntil'
    );

    assert.notOk(
      Playlist.isIncompatible({ excludeUntil: 1 }),
      'playlist not incompatible if excludeUntil has expired'
    );

    assert.notOk(
      Playlist.isIncompatible({ excludeUntil: Date.now() + 9999 }),
      'playlist not incompatible if temporarily excluded'
    );

    assert.ok(
      Playlist.isIncompatible({ excludeUntil: Infinity }),
      'playlist is incompatible if excludeUntil is Infinity'
    );
  });

  QUnit.test('determines if a playlist is excluded', function(assert) {
    assert.notOk(
      Playlist.isExcluded({}),
      'playlist not excluded if no excludeUntil'
    );

    assert.notOk(
      Playlist.isExcluded({ excludeUntil: Date.now() - 1 }),
      'playlist not excluded if expired excludeUntil'
    );

    assert.ok(
      Playlist.isExcluded({ excludeUntil: Date.now() + 9999 }),
      'playlist is excluded'
    );

    assert.ok(
      Playlist.isExcluded({ excludeUntil: Infinity }),
      'playlist is excluded if excludeUntil is Infinity'
    );
  });

  QUnit.test('determines if a playlist is disabled', function(assert) {
    assert.notOk(Playlist.isDisabled({}), 'playlist not disabled');

    assert.ok(Playlist.isDisabled({ disabled: true }), 'playlist is disabled');
  });

  QUnit.test('playlists with no or expired excludeUntil are enabled', function(assert) {
    // enabled means not excluded and not disabled
    assert.ok(Playlist.isEnabled({}), 'playlist with no excludeUntil is enabled');
    assert.ok(
      Playlist.isEnabled({ excludeUntil: Date.now() - 1 }),
      'playlist with expired excludeUntil is enabled'
    );
  });

  QUnit.test('excluded playlists are not enabled', function(assert) {
    // enabled means not excluded and not disabled
    assert.notOk(
      Playlist.isEnabled({ excludeUntil: Date.now() + 9999 }),
      'playlist with temporary excludeUntil is not enabled'
    );
    assert.notOk(
      Playlist.isEnabled({ excludeUntil: Infinity }),
      'playlist with permanent is not enabled'
    );
  });

  QUnit.test(
    'manually disabled playlists are not enabled regardless of exclusion state',
    function(assert) {
      // enabled means not excluded and not disabled
      assert.notOk(
        Playlist.isEnabled({ disabled: true }),
        'disabled playlist with no excludeUntil is not enabled'
      );
      assert.notOk(
        Playlist.isEnabled({ disabled: true, excludeUntil: Date.now() - 1 }),
        'disabled playlist with expired excludeUntil is not enabled'
      );
      assert.notOk(
        Playlist.isEnabled({ disabled: true, excludeUntil: Date.now() + 9999 }),
        'disabled playlist with temporary excludeUntil is not enabled'
      );
      assert.notOk(
        Playlist.isEnabled({ disabled: true, excludeUntil: Infinity }),
        'disabled playlist with permanent excludeUntil is not enabled'
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

  QUnit.module('isAes', {
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

  ['exactManifestTimings', ''].forEach((key) => {
    QUnit.module(`Media Index For Time ${key}`, {
      beforeEach(assert) {
        this.env = useFakeEnvironment(assert);
        this.clock = this.env.clock;
        this.requests = this.env.requests;
        this.fakeVhs = {
          xhr: xhrFactory()
        };

        const experiment = {exactManifestTimings: key === 'exactManifestTimings'};

        this.getMediaInfoForTime = (overrides) => {
          return Playlist.getMediaInfoForTime(merge(this.defaults, overrides, experiment));
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

        this.defaults = {
          playlist: media,
          currentTime: -1,
          startingSegmentIndex: 0,
          startingPartIndex: null,
          startTime: 0
        };

        assert.deepEqual(
          this.getMediaInfoForTime({currentTime: -1}),
          {partIndex: null, segmentIndex: 0, startTime: -1},
          'the index is never less than zero'
        );

        assert.deepEqual(
          this.getMediaInfoForTime({currentTime: 0}),
          {partIndex: null, segmentIndex: 0, startTime: 0},
          'time zero is index zero'
        );

        assert.deepEqual(
          this.getMediaInfoForTime({currentTime: 3}),
          {partIndex: null, segmentIndex: 0, startTime: 0},
          'time three is index zero'
        );

        assert.deepEqual(
          this.getMediaInfoForTime({currentTime: 10}),
          {partIndex: null, segmentIndex: 2, startTime: 9},
          'time 10 is index 2'
        );

        assert.deepEqual(
          this.getMediaInfoForTime({currentTime: 22}),
          null,
          'null when out of boundaries'
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

      this.defaults = {
        playlist: media,
        currentTime: 2.1,
        startingSegmentIndex: 0,
        startingPartIndex: null,
        startTime: 0
      };

      // 1 segment away
      assert.deepEqual(
        this.getMediaInfoForTime({currentTime: 2.1}),
        {segmentIndex: 1, startTime: 2, partIndex: null},
        '1 away 2 is correct'
      );
      assert.deepEqual(
        this.getMediaInfoForTime({currentTime: 4.1, startingSegmentIndex: 1, startTime: 2}),
        {segmentIndex: 2, startTime: 4, partIndex: null},
        '1 away 3 is correct'
      );
      assert.deepEqual(
        this.getMediaInfoForTime({currentTime: 6.1, startingSegmentIndex: 2, startTime: 4}),
        {segmentIndex: 3, startTime: 6, partIndex: null},
        '1 away 4 is correct'
      );
      assert.deepEqual(
        this.getMediaInfoForTime({currentTime: 8.1, startingSegmentIndex: 3, startTime: 6}),
        {segmentIndex: 4, startTime: 8, partIndex: null},
        '1 away 5 is correct'
      );
      assert.deepEqual(
        this.getMediaInfoForTime({currentTime: 10.1, startingSegmentIndex: 4, startTime: 8}),
        {segmentIndex: 5, startTime: 10, partIndex: null},
        '1 away 6 is correct'
      );

      // 2 segments away
      assert.deepEqual(
        this.getMediaInfoForTime({currentTime: 4.1, startingSegmentIndex: 0, startTime: 0}),
        {segmentIndex: 2, startTime: 4, partIndex: null},
        '2 away 3 is correct'
      );
      assert.deepEqual(
        this.getMediaInfoForTime({currentTime: 6.1, startingSegmentIndex: 1, startTime: 2}),
        {segmentIndex: 3, startTime: 6, partIndex: null},
        '2 away 4 is correct'
      );
      assert.deepEqual(
        this.getMediaInfoForTime({currentTime: 8.1, startingSegmentIndex: 2, startTime: 4}),
        {segmentIndex: 4, startTime: 8, partIndex: null},
        '2 away 5 is correct'
      );
      assert.deepEqual(
        this.getMediaInfoForTime({currentTime: 10.1, startingSegmentIndex: 3, startTime: 6}),
        {segmentIndex: 5, startTime: 10, partIndex: null},
        '2 away 6 is correct'
      );

      // 3 segments away
      assert.deepEqual(
        this.getMediaInfoForTime({currentTime: 6.1, startingSegmentIndex: 0, startTime: 0}),
        {segmentIndex: 3, startTime: 6, partIndex: null},
        '3 away 4 is correct'
      );
      assert.deepEqual(
        this.getMediaInfoForTime({currentTime: 8.1, startingSegmentIndex: 1, startTime: 2}),
        {segmentIndex: 4, startTime: 8, partIndex: null},
        '3 away 5 is correct'
      );
      assert.deepEqual(
        this.getMediaInfoForTime({currentTime: 10.1, startingSegmentIndex: 2, startTime: 4}),
        {segmentIndex: 5, startTime: 10, partIndex: null},
        '3 away 6 is correct'
      );
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

      this.defaults = {
        playlist: media,
        currentTime: 2.1,
        startingSegmentIndex: 0,
        startingPartIndex: null,
        startTime: 0
      };

      // 1 segment away
      assert.deepEqual(
        this.getMediaInfoForTime({currentTime: 0, startingSegmentIndex: 1, startTime: 2}),
        {segmentIndex: 0, startTime: 0, partIndex: null},
        '1 away 1 is correct'
      );
      assert.deepEqual(
        this.getMediaInfoForTime({currentTime: 2.1, startingSegmentIndex: 2, startTime: 4}),
        {segmentIndex: 1, startTime: 2, partIndex: null},
        '1 away 2 is correct'
      );
      assert.deepEqual(
        this.getMediaInfoForTime({currentTime: 4.1, startingSegmentIndex: 3, startTime: 6}),
        {segmentIndex: 2, startTime: 4, partIndex: null},
        '1 away 3 is correct'
      );
      assert.deepEqual(
        this.getMediaInfoForTime({currentTime: 6.1, startingSegmentIndex: 4, startTime: 8}),
        {segmentIndex: 3, startTime: 6, partIndex: null},
        '1 away 4 is correct'
      );
      assert.deepEqual(
        this.getMediaInfoForTime({currentTime: 8.1, startingSegmentIndex: 5, startTime: 10}),
        {segmentIndex: 4, startTime: 8, partIndex: null},
        '1 away 5 is correct'
      );

      // 2 segments away
      assert.deepEqual(
        this.getMediaInfoForTime({currentTime: 0, startingSegmentIndex: 2, startTime: 4}),
        {segmentIndex: 0, startTime: 0, partIndex: null},
        '2 away 1 is correct'
      );
      assert.deepEqual(
        this.getMediaInfoForTime({currentTime: 2.1, startingSegmentIndex: 3, startTime: 6}),
        {segmentIndex: 1, startTime: 2, partIndex: null},
        '2 away 2 is correct'
      );
      assert.deepEqual(
        this.getMediaInfoForTime({currentTime: 4.1, startingSegmentIndex: 4, startTime: 8}),
        {segmentIndex: 2, startTime: 4, partIndex: null},
        '2 away 3 is correct'
      );
      assert.deepEqual(
        this.getMediaInfoForTime({currentTime: 6.1, startingSegmentIndex: 5, startTime: 10}),
        {segmentIndex: 3, startTime: 6, partIndex: null},
        '2 away 4 is correct'
      );

      // 3 segments away
      assert.deepEqual(
        this.getMediaInfoForTime({currentTime: 0, startingSegmentIndex: 3, startTime: 6}),
        {segmentIndex: 0, startTime: 0, partIndex: null},
        '3 away 1 is correct'
      );
      assert.deepEqual(
        this.getMediaInfoForTime({currentTime: 2.1, startingSegmentIndex: 4, startTime: 8}),
        {segmentIndex: 1, startTime: 2, partIndex: null},
        '3 away 2 is correct'
      );

      assert.deepEqual(
        this.getMediaInfoForTime({currentTime: 4.1, startingSegmentIndex: 5, startTime: 10}),
        {segmentIndex: 2, startTime: 4, partIndex: null},
        '3 away 3 is correct'
      );
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

        this.defaults = {
          playlist: media,
          currentTime: 0,
          startingSegmentIndex: 0,
          startingPartIndex: null,
          startTime: 0
        };

        assert.deepEqual(
          this.getMediaInfoForTime({currentTime: 4}),
          {segmentIndex: 1, startTime: 4, partIndex: null},
          'rounds up exact matches'
        );
        assert.deepEqual(
          this.getMediaInfoForTime({currentTime: 3.7}),
          {segmentIndex: 0, startTime: 0, partIndex: null},
          'rounds down'
        );

        assert.deepEqual(
          this.getMediaInfoForTime({currentTime: 4.5}),
          {segmentIndex: 1, startTime: 4, partIndex: null},
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

        this.defaults = {
          playlist: media,
          currentTime: 0,
          startingSegmentIndex: 0,
          startingPartIndex: null,
          startTime: 0
        };

        assert.deepEqual(
          this.getMediaInfoForTime({currentTime: 45, startTime: 150}),
          {segmentIndex: 0, startTime: 45, partIndex: null},
          'expired content returns 0 for earliest segment available'
        );
        assert.deepEqual(
          this.getMediaInfoForTime({currentTime: 75, startTime: 150}),
          {segmentIndex: 0, startTime: 75, partIndex: null},
          'expired content returns 0 for earliest segment available'
        );
        assert.deepEqual(
          this.getMediaInfoForTime({currentTime: 0, startTime: 150}),
          {segmentIndex: 0, startTime: 0, partIndex: null},
          'time of 0 with no expired time returns first segment'
        );
        assert.deepEqual(
          this.getMediaInfoForTime({currentTime: 150, startTime: 150}),
          {segmentIndex: 0, startTime: 150, partIndex: null},
          'calculates the earliest available position'
        );
        assert.deepEqual(
          this.getMediaInfoForTime({currentTime: 152, startTime: 150}),
          {segmentIndex: 0, startTime: 150, partIndex: null},
          'calculates within the first segment'
        );
        assert.deepEqual(
          this.getMediaInfoForTime({currentTime: 154, startTime: 150}),
          {segmentIndex: 1, startTime: 154, partIndex: null},
          'calculates earlier segment on exact boundary match'
        );
        assert.deepEqual(
          this.getMediaInfoForTime({currentTime: 154.5, startTime: 150}),
          {segmentIndex: 1, startTime: 154, partIndex: null},
          'calculates within the second segment'
        );
        assert.deepEqual(
          this.getMediaInfoForTime({currentTime: 156, startTime: 150}),
          {segmentIndex: 1, startTime: 154, partIndex: null},
          'calculates within the second segment'
        );

        assert.deepEqual(
          this.getMediaInfoForTime({currentTime: 159, startTime: 150}),
          null,
          'returns null when time is equal to end of last segment'
        );
        assert.deepEqual(
          this.getMediaInfoForTime({currentTime: 160, startTime: 150}),
          null,
          'returns null when time is past end of last segment'
        );
      }
    );

    QUnit.test('can return a partIndex', function(assert) {
      this.fakeVhs.options_ = {llhls: true};
      const loader = new PlaylistLoader('media.m3u8', this.fakeVhs);

      loader.load();

      this.requests.shift().respond(
        200, null,
        '#EXTM3U\n' +
        '#EXT-X-MEDIA-SEQUENCE:1001\n' +
        '#EXTINF:4,\n' +
        '1001.ts\n' +
        '#EXTINF:5,\n' +
        '1002.ts\n' +
        '#EXT-X-PART:URI="1003.part1.ts",DURATION=1\n' +
        '#EXT-X-PART:URI="1003.part2.ts",DURATION=1\n' +
        '#EXT-X-PART:URI="1003.part3.ts",DURATION=1\n' +
        '#EXT-X-PRELOAD-HINT:TYPE="PART",URI="1003.part4.ts"\n'
      );

      const media = loader.media();

      this.defaults = {
        playlist: media,
        currentTime: 0,
        startingSegmentIndex: 0,
        startingPartIndex: null,
        startTime: 0
      };

      assert.deepEqual(
        this.getMediaInfoForTime({currentTime: 10, startTime: 0}),
        {segmentIndex: 2, startTime: 10, partIndex: 1},
        'returns expected part/segment'
      );

      assert.deepEqual(
        this.getMediaInfoForTime({currentTime: 11, startTime: 0}),
        {segmentIndex: 2, startTime: 11, partIndex: 2},
        'returns expected part/segment'
      );

      assert.deepEqual(
        this.getMediaInfoForTime({currentTime: 11, segmentIndex: -15}),
        {segmentIndex: 2, startTime: 11, partIndex: 2},
        'returns expected part/segment'
      );
    });

    QUnit.test('liveEdgeDelay works as expected', function(assert) {
      const media = {
        endList: true,
        targetDuration: 5,
        partTargetDuration: 1.1,
        serverControl: {
          holdBack: 20,
          partHoldBack: 2
        },
        segments: [
          {duration: 3},
          {duration: 4, parts: [
            {duration: 1},
            {duration: 0.5}
          ]},
          {duration: 3, parts: [
            {duration: 1},
            {duration: 0.5}
          ]},
          {duration: 4, parts: [
            {duration: 1},
            {duration: 0.5}
          ]}
        ]
      };
      const main = {
        suggestedPresentationDelay: 10
      };

      assert.equal(
        Playlist.liveEdgeDelay(main, media),
        0,
        'returns 0 with endlist'
      );

      delete media.endList;
      assert.equal(
        Playlist.liveEdgeDelay(main, media),
        main.suggestedPresentationDelay,
        'uses suggestedPresentationDelay'
      );

      delete main.suggestedPresentationDelay;
      assert.equal(
        Playlist.liveEdgeDelay(main, media),
        media.serverControl.partHoldBack,
        'uses part hold back'
      );

      media.serverControl.partHoldBack = null;
      assert.equal(
        Playlist.liveEdgeDelay(main, media),
        media.partTargetDuration * 3,
        'uses part target duration * 3'
      );

      media.partTargetDuration = null;

      assert.equal(
        Playlist.liveEdgeDelay(main, media),
        media.serverControl.holdBack,
        'uses hold back'
      );

      media.serverControl.holdBack = null;
      assert.equal(
        Playlist.liveEdgeDelay(main, media),
        (media.targetDuration * 3),
        'uses (targetDuration * 3)'
      );

      media.targetDuration = null;
      assert.equal(
        Playlist.liveEdgeDelay(main, media),
        0,
        'no target duration delay cannot be calcluated'
      );

      media.segments = media.segments.map((s) => {
        s.duration = null;
        return s;
      });

      assert.equal(
        Playlist.liveEdgeDelay(main, media),
        0,
        'no segment durations, live delay can\'t be calculated'
      );

      media.segments.length = 0;

      assert.equal(
        Playlist.liveEdgeDelay(main, media),
        0,
        'no segments, live delay can\'t be calculated'
      );
    });

    QUnit.test('playlistMatch', function(assert) {
      assert.false(Playlist.playlistMatch(null, null), 'null playlists do not match');
      assert.false(Playlist.playlistMatch({}, null), 'a playlist without b');
      assert.false(Playlist.playlistMatch(null, {}), 'b playlist without a');

      const a = {id: 'foo', uri: 'foo.m3u8', resolvedUri: 'http://example.com/foo.m3u8'};
      const b = {id: 'foo', uri: 'foo.m3u8', resolvedUri: 'http://example.com/foo.m3u8'};

      assert.true(Playlist.playlistMatch(a, a), 'object signature match');

      assert.true(Playlist.playlistMatch(a, b), 'id match');

      a.id = 'bar';
      assert.true(Playlist.playlistMatch(a, b), 'resolved uri match');

      a.resolvedUri += '?nope';
      assert.true(Playlist.playlistMatch(a, b), 'uri match');

      a.uri += '?nope';

      assert.false(Playlist.playlistMatch(a, b), 'no match');
    });

    QUnit.test('isAudioOnly', function(assert) {
      assert.false(Playlist.isAudioOnly({
        playlists: [{attributes: {CODECS: 'mp4a.40.2,avc1.4d400d'}}]
      }), 'muxed playlist');

      assert.false(Playlist.isAudioOnly({
        playlists: [
          {attributes: {CODECS: 'mp4a.40.2,avc1.4d400d'}},
          {attributes: {CODECS: 'avc1.4d400d'}},
          {attributes: {CODECS: 'mp4a.40.2'}}
        ]
      }), 'muxed, audio only, and video only');

      assert.false(Playlist.isAudioOnly({
        mediaGroups: {
          AUDIO: {
            main: {
              en: {id: 'en', uri: 'en'},
              es: {id: 'es', uri: 'es'}
            }
          }
        },
        playlists: [{attributes: {CODECS: 'mp4a.40.2,avc1.4d400d'}}]
      }), 'muxed and alt audio');

      assert.true(Playlist.isAudioOnly({
        playlists: [
          {attributes: {CODECS: 'mp4a.40.2'}},
          {attributes: {CODECS: 'mp4a.40.2'}},
          {attributes: {CODECS: 'mp4a.40.2'}}
        ]
      }), 'audio only playlists');

      assert.true(Playlist.isAudioOnly({
        mediaGroups: {
          AUDIO: {
            main: {
              en: {id: 'en', uri: 'en'}
            }
          }
        }
      }), 'only audio groups, uri');

      assert.true(Playlist.isAudioOnly({
        mediaGroups: {
          AUDIO: {
            main: {
              en: {id: 'en', playlists: [{uri: 'foo'}]}
            }
          }
        }
      }), 'only audio groups, playlists');

      assert.true(Playlist.isAudioOnly({
        playlists: [
          {id: 'en'}
        ],
        mediaGroups: {
          AUDIO: {
            main: {
              en: {id: 'en'}
            }
          }
        }
      }), 'audio playlists that are also in groups, without codecs');

    });
  });

  QUnit.module('segmentDurationWithParts');

  QUnit.test('uses normal segment duration', function(assert) {
    const duration = Playlist.segmentDurationWithParts(
      {},
      {duration: 5}
    );

    assert.equal(duration, 5, 'duration as expected');
  });

  QUnit.test('preload segment without parts or preload hints', function(assert) {
    const duration = Playlist.segmentDurationWithParts(
      {partTargetDuration: 1},
      {preload: true}
    );

    assert.equal(duration, 0, 'duration as expected');
  });

  QUnit.test('preload segment with parts only', function(assert) {
    const duration = Playlist.segmentDurationWithParts(
      {partTargetDuration: 1},
      {preload: true, parts: [{duration: 1}, {duration: 1}]}
    );

    assert.equal(duration, 2, 'duration as expected');
  });

  QUnit.test('preload segment with preload hints only', function(assert) {
    const duration = Playlist.segmentDurationWithParts(
      {partTargetDuration: 1},
      {preload: true, preloadHints: [{type: 'PART'}, {type: 'PART'}, {type: 'MAP'}]}
    );

    assert.equal(duration, 2, 'duration as expected');
  });

  QUnit.test('preload segment with preload hints and parts', function(assert) {
    const duration = Playlist.segmentDurationWithParts(
      {partTargetDuration: 1},
      {preload: true, parts: [{duration: 1}], preloadHints: [{type: 'PART'}, {type: 'PART'}, {type: 'MAP'}]}
    );

    assert.equal(duration, 3, 'duration as expected');
  });
});
