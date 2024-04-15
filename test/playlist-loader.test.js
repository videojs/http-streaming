import QUnit from 'qunit';
import {
  default as PlaylistLoader,
  updateSegments,
  updateMain,
  refreshDelay
} from '../src/playlist-loader';
import xhrFactory from '../src/xhr';
import { useFakeEnvironment, urlTo } from './test-helpers';
import window from 'global/window';
// needed for plugin registration
import '../src/videojs-http-streaming';
import {
  createPlaylistID,
  parseManifest
} from '../src/manifest.js';
import manifests from 'create-test-data!manifests';
import sinon from 'sinon';

QUnit.module('Playlist Loader', function(hooks) {
  hooks.beforeEach(function(assert) {
    this.env = useFakeEnvironment(assert);
    this.clock = this.env.clock;
    this.requests = this.env.requests;
    this.fakeVhs = {
      xhr: xhrFactory()
    };
  });
  hooks.afterEach(function(assert) {
    this.env.restore();
  });

  QUnit.test('can getKeyIdSet from a playlist', function(assert) {
    const loader = new PlaylistLoader('variant.m3u8', this.fakeVhs);
    const keyId = '800AACAA522958AE888062B5695DB6BF';
    // We currently only pass keyId for widevine content protection.
    const playlist = {
      contentProtection: {
        'com.widevine.alpha': {
          attributes: {
            keyId
          }
        }
      }
    };
    const keyIdSet = loader.getKeyIdSet(playlist);

    assert.ok(keyIdSet.size);
    assert.ok(keyIdSet.has(keyId.toLowerCase()), 'keyId is expected hex string');
  });

  QUnit.test('updateSegments copies over properties', function(assert) {
    assert.deepEqual(
      [
        { uri: 'test-uri-0', startTime: 0, endTime: 10 },
        {
          uri: 'test-uri-1',
          startTime: 10,
          endTime: 20,
          map: { someProp: 99, uri: '4' }
        }
      ],
      updateSegments(
        [
          { uri: 'test-uri-0', startTime: 0, endTime: 10 },
          { uri: 'test-uri-1', startTime: 10, endTime: 20, map: { someProp: 1 } }
        ],
        [
          { uri: 'test-uri-0' },
          { uri: 'test-uri-1', map: { someProp: 99, uri: '4' } }
        ],
        0
      ),
      'retains properties from original segment'
    );

    assert.deepEqual(
      [
        { uri: 'test-uri-0', map: { someProp: 100 } },
        { uri: 'test-uri-1', map: { someProp: 99, uri: '4' } }
      ],
      updateSegments(
        [
          { uri: 'test-uri-0' },
          { uri: 'test-uri-1', map: { someProp: 1 } }
        ],
        [
          { uri: 'test-uri-0', map: { someProp: 100 } },
          { uri: 'test-uri-1', map: { someProp: 99, uri: '4' } }
        ],
        0
      ),
      'copies over/overwrites properties without offset'
    );

    assert.deepEqual(
      [
        { uri: 'test-uri-1', map: { someProp: 1 } },
        { uri: 'test-uri-2', map: { someProp: 100, uri: '2' } }
      ],
      updateSegments(
        [
          { uri: 'test-uri-0' },
          { uri: 'test-uri-1', map: { someProp: 1 } }
        ],
        [
          { uri: 'test-uri-1' },
          { uri: 'test-uri-2', map: { someProp: 100, uri: '2' } }
        ],
        1
      ),
      'copies over/overwrites properties with offset of 1'
    );

    assert.deepEqual(
      [
        { uri: 'test-uri-2' },
        { uri: 'test-uri-3', map: { someProp: 100, uri: '2' } }
      ],
      updateSegments(
        [
          { uri: 'test-uri-0' },
          { uri: 'test-uri-1', map: { someProp: 1 } }
        ],
        [
          { uri: 'test-uri-2' },
          { uri: 'test-uri-3', map: { someProp: 100, uri: '2' } }
        ],
        2
      ),
      'copies over/overwrites properties with offset of 2'
    );
  });

  QUnit.test('updateMain returns null when no playlists', function(assert) {
    const main = {
      playlists: []
    };
    const media = {};

    assert.deepEqual(updateMain(main, media), null, 'returns null when no playlists');
  });

  QUnit.test('updateMain returns null when no change', function(assert) {
    const main = {
      playlists: [{
        mediaSequence: 0,
        attributes: {
          BANDWIDTH: 9
        },
        uri: 'playlist-0-uri',
        id: 'playlist-0-uri',
        resolvedUri: urlTo('playlist-0-uri'),
        segments: [{
          duration: 10,
          uri: 'segment-0-uri',
          resolvedUri: urlTo('segment-0-uri')
        }]
      }]
    };
    const media = {
      mediaSequence: 0,
      attributes: {
        BANDWIDTH: 9
      },
      uri: 'playlist-0-uri',
      id: 'playlist-0-uri',
      segments: [{
        duration: 10,
        uri: 'segment-0-uri'
      }]
    };

    assert.deepEqual(updateMain(main, media), null, 'returns null');
  });

  QUnit.test('updateMain updates main when new media sequence', function(assert) {
    const main = {
      playlists: [{
        mediaSequence: 0,
        attributes: {
          BANDWIDTH: 9
        },
        uri: 'playlist-0-uri',
        id: 'playlist-0-uri',
        resolvedUri: urlTo('playlist-0-uri'),
        segments: [{
          duration: 10,
          uri: 'segment-0-uri',
          resolvedUri: urlTo('segment-0-uri')
        }]
      }]
    };

    const media = {
      mediaSequence: 1,
      attributes: {
        BANDWIDTH: 9
      },
      uri: 'playlist-0-uri',
      id: 'playlist-0-uri',
      segments: [{
        duration: 10,
        uri: 'segment-0-uri'
      }]
    };

    main.playlists[media.id] = main.playlists[0];

    assert.deepEqual(
      updateMain(main, media),
      {
        playlists: [{
          mediaSequence: 1,
          attributes: {
            BANDWIDTH: 9
          },
          uri: 'playlist-0-uri',
          id: 'playlist-0-uri',
          resolvedUri: urlTo('playlist-0-uri'),
          segments: [{
            duration: 10,
            uri: 'segment-0-uri',
            resolvedUri: urlTo('segment-0-uri')
          }]
        }]
      },
      'updates main when new media sequence'
    );
  });

  QUnit.test('updateMain updates main when endList changes', function(assert) {
    const main = {
      playlists: [{
        endList: false,
        mediaSequence: 0,
        attributes: {
          BANDWIDTH: 9
        },
        id: 'playlist-0-uri',
        uri: 'playlist-0-uri',
        resolvedUri: urlTo('playlist-0-uri'),
        segments: [{
          duration: 10,
          uri: 'segment-0-uri',
          resolvedUri: urlTo('segment-0-uri')
        }]
      }]
    };
    const media = {
      endList: true,
      mediaSequence: 0,
      attributes: {
        BANDWIDTH: 9
      },
      id: 'playlist-0-uri',
      uri: 'playlist-0-uri',
      segments: [{
        duration: 10,
        uri: 'segment-0-uri'
      }]
    };

    main.playlists[media.id] = main.playlists[0];

    assert.deepEqual(
      updateMain(main, media),
      {
        playlists: [{
          endList: true,
          mediaSequence: 0,
          attributes: {
            BANDWIDTH: 9
          },
          id: 'playlist-0-uri',
          uri: 'playlist-0-uri',
          resolvedUri: urlTo('playlist-0-uri'),
          segments: [{
            duration: 10,
            uri: 'segment-0-uri',
            resolvedUri: urlTo('segment-0-uri')
          }]
        }]
      },
      'updates main when endList changes'
    );
  });

  QUnit.test('updateMain retains top level values in main', function(assert) {
    const main = {
      mediaGroups: {
        AUDIO: {
          'GROUP-ID': {
            default: true,
            uri: 'audio-uri'
          }
        }
      },
      playlists: [{
        mediaSequence: 0,
        attributes: {
          BANDWIDTH: 9
        },
        id: 'playlist-0-uri',
        uri: 'playlist-0-uri',
        resolvedUri: urlTo('playlist-0-uri'),
        segments: [{
          duration: 10,
          uri: 'segment-0-uri',
          resolvedUri: urlTo('segment-0-uri')
        }]
      }]
    };
    const media = {
      mediaSequence: 1,
      attributes: {
        BANDWIDTH: 9
      },
      id: 'playlist-0-uri',
      uri: 'playlist-0-uri',
      segments: [{
        duration: 10,
        uri: 'segment-0-uri'
      }]
    };

    main.playlists[media.id] = main.playlists[0];

    assert.deepEqual(
      updateMain(main, media),
      {
        mediaGroups: {
          AUDIO: {
            'GROUP-ID': {
              default: true,
              uri: 'audio-uri'
            }
          }
        },
        playlists: [{
          mediaSequence: 1,
          attributes: {
            BANDWIDTH: 9
          },
          id: 'playlist-0-uri',
          uri: 'playlist-0-uri',
          resolvedUri: urlTo('playlist-0-uri'),
          segments: [{
            duration: 10,
            uri: 'segment-0-uri',
            resolvedUri: urlTo('segment-0-uri')
          }]
        }]
      },
      'retains top level values in main'
    );
  });

  QUnit.test('updateMain adds new segments to main', function(assert) {
    const main = {
      mediaGroups: {
        AUDIO: {
          'GROUP-ID': {
            default: true,
            uri: 'audio-uri'
          }
        }
      },
      playlists: [{
        mediaSequence: 0,
        attributes: {
          BANDWIDTH: 9
        },
        id: 'playlist-0-uri',
        uri: 'playlist-0-uri',
        resolvedUri: urlTo('playlist-0-uri'),
        segments: [{
          duration: 10,
          uri: 'segment-0-uri',
          resolvedUri: urlTo('segment-0-uri')
        }]
      }]
    };
    const media = {
      mediaSequence: 1,
      attributes: {
        BANDWIDTH: 9
      },
      id: 'playlist-0-uri',
      uri: 'playlist-0-uri',
      segments: [{
        duration: 10,
        uri: 'segment-0-uri'
      }, {
        duration: 9,
        uri: 'segment-1-uri'
      }]
    };

    main.playlists[media.id] = main.playlists[0];

    assert.deepEqual(
      updateMain(main, media),
      {
        mediaGroups: {
          AUDIO: {
            'GROUP-ID': {
              default: true,
              uri: 'audio-uri'
            }
          }
        },
        playlists: [{
          mediaSequence: 1,
          attributes: {
            BANDWIDTH: 9
          },
          id: 'playlist-0-uri',
          uri: 'playlist-0-uri',
          resolvedUri: urlTo('playlist-0-uri'),
          segments: [{
            duration: 10,
            uri: 'segment-0-uri',
            resolvedUri: urlTo('segment-0-uri')
          }, {
            duration: 9,
            uri: 'segment-1-uri',
            resolvedUri: urlTo('segment-1-uri')
          }]
        }]
      },
      'adds new segment to main'
    );
  });

  QUnit.test('updateMain changes old values', function(assert) {
    const main = {
      mediaGroups: {
        AUDIO: {
          'GROUP-ID': {
            default: true,
            uri: 'audio-uri'
          }
        }
      },
      playlists: [{
        mediaSequence: 0,
        attributes: {
          BANDWIDTH: 9
        },
        id: 'playlist-0-uri',
        uri: 'playlist-0-uri',
        resolvedUri: urlTo('playlist-0-uri'),
        segments: [{
          duration: 10,
          uri: 'segment-0-uri',
          resolvedUri: urlTo('segment-0-uri')
        }]
      }]
    };
    const media = {
      mediaSequence: 1,
      attributes: {
        BANDWIDTH: 8,
        newField: 1
      },
      id: 'playlist-0-uri',
      uri: 'playlist-0-uri',
      segments: [{
        duration: 8,
        uri: 'segment-0-uri'
      }, {
        duration: 10,
        uri: 'segment-1-uri'
      }]
    };

    main.playlists[media.id] = main.playlists[0];

    assert.deepEqual(
      updateMain(main, media),
      {
        mediaGroups: {
          AUDIO: {
            'GROUP-ID': {
              default: true,
              uri: 'audio-uri'
            }
          }
        },
        playlists: [{
          mediaSequence: 1,
          attributes: {
            BANDWIDTH: 8,
            newField: 1
          },
          id: 'playlist-0-uri',
          uri: 'playlist-0-uri',
          resolvedUri: urlTo('playlist-0-uri'),
          segments: [{
            duration: 8,
            uri: 'segment-0-uri',
            resolvedUri: urlTo('segment-0-uri')
          }, {
            duration: 10,
            uri: 'segment-1-uri',
            resolvedUri: urlTo('segment-1-uri')
          }]
        }]
      },
      'changes old values'
    );
  });

  QUnit.test('updateMain retains saved segment values', function(assert) {
    const main = {
      playlists: [{
        mediaSequence: 0,
        id: 'playlist-0-uri',
        uri: 'playlist-0-uri',
        resolvedUri: urlTo('playlist-0-uri'),
        segments: [{
          duration: 10,
          uri: 'segment-0-uri',
          resolvedUri: urlTo('segment-0-uri'),
          startTime: 0,
          endTime: 10
        }]
      }]
    };
    const media = {
      mediaSequence: 0,
      id: 'playlist-0-uri',
      uri: 'playlist-0-uri',
      segments: [{
        duration: 8,
        uri: 'segment-0-uri'
      }, {
        duration: 10,
        uri: 'segment-1-uri'
      }]
    };

    main.playlists[media.id] = main.playlists[0];

    assert.deepEqual(
      updateMain(main, media),
      {
        playlists: [{
          mediaSequence: 0,
          id: 'playlist-0-uri',
          uri: 'playlist-0-uri',
          resolvedUri: urlTo('playlist-0-uri'),
          segments: [{
            duration: 8,
            uri: 'segment-0-uri',
            resolvedUri: urlTo('segment-0-uri'),
            startTime: 0,
            endTime: 10
          }, {
            duration: 10,
            uri: 'segment-1-uri',
            resolvedUri: urlTo('segment-1-uri')
          }]
        }]
      },
      'retains saved segment values'
    );
  });

  QUnit.test('updateMain resolves key and map URIs', function(assert) {
    const main = {
      playlists: [{
        mediaSequence: 0,
        attributes: {
          BANDWIDTH: 9
        },
        id: 'playlist-0-uri',
        uri: 'playlist-0-uri',
        resolvedUri: urlTo('playlist-0-uri'),
        segments: [{
          duration: 10,
          uri: 'segment-0-uri',
          resolvedUri: urlTo('segment-0-uri')
        }, {
          duration: 10,
          uri: 'segment-1-uri',
          resolvedUri: urlTo('segment-1-uri')
        }]
      }]
    };
    const media = {
      mediaSequence: 3,
      attributes: {
        BANDWIDTH: 9
      },
      id: 'playlist-0-uri',
      uri: 'playlist-0-uri',
      segments: [{
        duration: 9,
        uri: 'segment-2-uri',
        key: {
          uri: 'key-2-uri'
        },
        map: {
          uri: 'map-2-uri',
          key: {
            uri: 'key-map-uri'
          }
        }
      }, {
        duration: 11,
        uri: 'segment-3-uri',
        key: {
          uri: 'key-3-uri'
        },
        map: {
          uri: 'map-3-uri'
        }
      }]
    };

    main.playlists[media.id] = main.playlists[0];

    assert.deepEqual(
      updateMain(main, media),
      {
        playlists: [{
          mediaSequence: 3,
          attributes: {
            BANDWIDTH: 9
          },
          uri: 'playlist-0-uri',
          id: 'playlist-0-uri',
          resolvedUri: urlTo('playlist-0-uri'),
          segments: [{
            duration: 9,
            uri: 'segment-2-uri',
            resolvedUri: urlTo('segment-2-uri'),
            key: {
              uri: 'key-2-uri',
              resolvedUri: urlTo('key-2-uri')
            },
            map: {
              uri: 'map-2-uri',
              key: {
                uri: 'key-map-uri',
                resolvedUri: urlTo('key-map-uri')
              },
              resolvedUri: urlTo('map-2-uri')
            }
          }, {
            duration: 11,
            uri: 'segment-3-uri',
            resolvedUri: urlTo('segment-3-uri'),
            key: {
              uri: 'key-3-uri',
              resolvedUri: urlTo('key-3-uri')
            },
            map: {
              uri: 'map-3-uri',
              resolvedUri: urlTo('map-3-uri')
            }
          }]
        }]
      },
      'resolves key and map URIs'
    );
  });

  QUnit.test('updateMain detects preload segment changes', function(assert) {
    const main = {
      playlists: [{
        mediaSequence: 0,
        attributes: {
          BANDWIDTH: 9
        },
        uri: 'playlist-0-uri',
        id: 'playlist-0-uri',
        resolvedUri: urlTo('playlist-0-uri'),
        segments: [{
          duration: 10,
          uri: 'segment-0-uri',
          resolvedUri: urlTo('segment-0-uri')
        }],
        preloadSegment: {
          parts: [
            {uri: 'part-0-uri'}
          ]
        }
      }]
    };
    const media = {
      mediaSequence: 0,
      attributes: {
        BANDWIDTH: 9
      },
      uri: 'playlist-0-uri',
      id: 'playlist-0-uri',
      segments: [{
        duration: 10,
        uri: 'segment-0-uri'
      }],
      preloadSegment: {
        parts: [
          {uri: 'part-0-uri'},
          {uri: 'part-1-uri'}
        ]
      }
    };

    main.playlists['playlist-0-uri'] = main.playlists[0];

    const result = updateMain(main, media);

    main.playlists[0].preloadSegment = media.preloadSegment;

    assert.deepEqual(result, main, 'playlist updated');
  });

  QUnit.test('updateMain detects preload segment addition', function(assert) {
    const main = {
      playlists: [{
        mediaSequence: 0,
        attributes: {
          BANDWIDTH: 9
        },
        uri: 'playlist-0-uri',
        id: 'playlist-0-uri',
        resolvedUri: urlTo('playlist-0-uri'),
        segments: [{
          duration: 10,
          uri: 'segment-0-uri',
          resolvedUri: urlTo('segment-0-uri')
        }]
      }]
    };

    const media = {
      mediaSequence: 0,
      attributes: {
        BANDWIDTH: 9
      },
      uri: 'playlist-0-uri',
      id: 'playlist-0-uri',
      segments: [{
        duration: 10,
        uri: 'segment-0-uri'
      }],
      preloadSegment: {
        parts: [
          {uri: 'part-0-uri'},
          {uri: 'part-1-uri'}
        ]
      }
    };

    main.playlists['playlist-0-uri'] = main.playlists[0];

    const result = updateMain(main, media);

    main.playlists[0].preloadSegment = media.preloadSegment;

    assert.deepEqual(result, main, 'playlist updated');
  });

  QUnit.test('updateMain detects preload segment removal', function(assert) {
    const main = {
      playlists: [{
        mediaSequence: 0,
        attributes: {
          BANDWIDTH: 9
        },
        uri: 'playlist-0-uri',
        id: 'playlist-0-uri',
        resolvedUri: urlTo('playlist-0-uri'),
        segments: [{
          duration: 10,
          uri: 'segment-0-uri',
          resolvedUri: urlTo('segment-0-uri')
        }],
        preloadSegment: {
          parts: [
            {uri: 'part-0-uri'},
            {uri: 'part-1-uri'}
          ]
        }
      }]
    };

    const media = {
      mediaSequence: 0,
      attributes: {
        BANDWIDTH: 9
      },
      uri: 'playlist-0-uri',
      id: 'playlist-0-uri',
      segments: [{
        duration: 10,
        uri: 'segment-1-uri',
        parts: [
          {uri: 'part-0-uri'},
          {uri: 'part-1-uri'}
        ]
      }]
    };

    main.playlists['playlist-0-uri'] = main.playlists[0];

    const result = updateMain(main, media);

    main.playlists[0].preloadSegment = media.preloadSegment;

    assert.deepEqual(result, main, 'playlist updated');
  });

  QUnit.test('updateMain retains mediaGroup attributes', function(assert) {
    const main = {
      mediaGroups: {
        AUDIO: {
          'GROUP-ID': {
            default: {
              default: true,
              playlists: [{
                mediaSequence: 0,
                attributes: {
                  BANDWIDTH: 9,
                  CODECS: 'mp4a.40.2'
                },
                id: 'playlist-0-uri',
                uri: 'playlist-0-uri',
                resolvedUri: urlTo('playlist-0-uri'),
                segments: [{
                  duration: 10,
                  uri: 'segment-0-uri',
                  resolvedUri: urlTo('segment-0-uri')
                }]
              }]
            }
          }
        }
      },
      playlists: [{
        mediaSequence: 0,
        attributes: {
          BANDWIDTH: 9,
          CODECS: 'mp4a.40.2'
        },
        id: 'playlist-0-uri',
        uri: 'playlist-0-uri',
        resolvedUri: urlTo('playlist-0-uri'),
        segments: [{
          duration: 10,
          uri: 'segment-0-uri',
          resolvedUri: urlTo('segment-0-uri')
        }]
      }]
    };
    const media = {
      mediaSequence: 1,
      attributes: {
        BANDWIDTH: 9
      },
      id: 'playlist-0-uri',
      uri: 'playlist-0-uri',
      segments: [{
        duration: 10,
        uri: 'segment-0-uri'
      }]
    };

    main.playlists[media.id] = main.playlists[0];

    assert.deepEqual(
      updateMain(main, media),
      {
        mediaGroups: {
          AUDIO: {
            'GROUP-ID': {
              default: {
                default: true,
                playlists: [{
                  mediaSequence: 1,
                  attributes: {
                    BANDWIDTH: 9,
                    CODECS: 'mp4a.40.2'
                  },
                  id: 'playlist-0-uri',
                  uri: 'playlist-0-uri',
                  resolvedUri: urlTo('playlist-0-uri'),
                  segments: [{
                    duration: 10,
                    uri: 'segment-0-uri',
                    resolvedUri: urlTo('segment-0-uri')
                  }]
                }]
              }
            }
          }
        },
        playlists: [{
          mediaSequence: 1,
          attributes: {
            BANDWIDTH: 9,
            CODECS: 'mp4a.40.2'
          },
          id: 'playlist-0-uri',
          uri: 'playlist-0-uri',
          resolvedUri: urlTo('playlist-0-uri'),
          segments: [{
            duration: 10,
            uri: 'segment-0-uri',
            resolvedUri: urlTo('segment-0-uri')
          }]
        }]
      },
      'updated playlist retains codec attribute'
    );
  });

  QUnit.test('uses last segment duration for refresh delay', function(assert) {
    const media = { targetDuration: 7, segments: [] };

    assert.equal(
      refreshDelay(media, true), 3500,
      'used half targetDuration when no segments'
    );

    media.segments = [ { duration: 6}, { duration: 4 }, { } ];
    assert.equal(
      refreshDelay(media, true), 3500,
      'used half targetDuration when last segment duration cannot be determined'
    );

    media.segments = [ { duration: 6}, { duration: 4}, { duration: 5 } ];
    assert.equal(refreshDelay(media, true), 5000, 'used last segment duration for delay');

    assert.equal(
      refreshDelay(media, false), 3500,
      'used half targetDuration when update is false'
    );
  });

  QUnit.test('throws if the playlist src is empty or undefined', function(assert) {
    assert.throws(
      () => new PlaylistLoader(),
      /A non-empty playlist URL or object is required/,
      'requires an argument'
    );
    assert.throws(
      () => new PlaylistLoader(''),
      /A non-empty playlist URL or object is required/,
      'does not accept the empty string'
    );
  });

  QUnit.test('can delay load', function(assert) {
    const loader = new PlaylistLoader('main.m3u8', this.fakeVhs);

    assert.notOk(loader.mediaUpdateTimeout, 'no media update timeout');

    loader.load(true);

    assert.ok(loader.mediaUpdateTimeout, 'have a media update timeout now');
    assert.strictEqual(this.requests.length, 0, 'have no requests');

    this.clock.tick(5000);

    assert.strictEqual(this.requests.length, 1, 'playlist request after delay');
  });

  QUnit.test('starts without any metadata', function(assert) {
    const loader = new PlaylistLoader('main.m3u8', this.fakeVhs);

    loader.load();

    assert.strictEqual(loader.state, 'HAVE_NOTHING', 'no metadata has loaded yet');
  });

  QUnit.test('requests the initial playlist immediately', function(assert) {
    const loader = new PlaylistLoader('main.m3u8', this.fakeVhs);

    loader.load();

    assert.strictEqual(this.requests.length, 1, 'made a request');
    assert.strictEqual(
      this.requests[0].url,
      'main.m3u8',
      'requested the initial playlist'
    );
  });

  QUnit.test('moves to HAVE_MAIN_MANIFEST after loading a main playlist', function(assert) {
    const loader = new PlaylistLoader('main.m3u8', this.fakeVhs);
    let state;

    loader.load();

    loader.on('loadedplaylist', function() {
      state = loader.state;
    });
    this.requests.pop().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
      'media.m3u8\n'
    );
    assert.ok(loader.main, 'the main playlist is available');
    assert.strictEqual(state, 'HAVE_MAIN_MANIFEST', 'the state at loadedplaylist correct');
  });

  QUnit.test('logs warning for main playlist with invalid STREAM-INF', function(assert) {
    const loader = new PlaylistLoader('main.m3u8', this.fakeVhs);

    loader.load();

    this.requests.pop().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
      'video1/media.m3u8\n' +
      '#EXT-X-STREAM-INF:\n' +
      'video2/media.m3u8\n'
    );

    assert.ok(loader.main, 'infers a main playlist');
    assert.equal(
      loader.main.playlists[1].uri, 'video2/media.m3u8',
      'parsed invalid stream'
    );
    assert.ok(loader.main.playlists[1].attributes, 'attached attributes property');
    assert.equal(this.env.log.warn.calls, 1, 'logged a warning');
    assert.equal(
      this.env.log.warn.args[0],
      'Invalid playlist STREAM-INF detected. Missing BANDWIDTH attribute.',
      'logged a warning'
    );
  });

  QUnit.test('executes custom parsers and mappers', function(assert) {
    const customTagParsers = [{
      expression: /#PARSER/,
      customType: 'test',
      segment: true
    }];
    const customTagMappers = [{
      expression: /#MAPPER/,
      map(line) {
        const regex = /#MAPPER:(\d+)/g;
        const match = regex.exec(line);
        const ISOdate = new Date(Number(match[1])).toISOString();

        return `#EXT-X-PROGRAM-DATE-TIME:${ISOdate}`;
      }
    }];

    this.fakeVhs.options_ = { customTagParsers, customTagMappers };

    const loader = new PlaylistLoader('main.m3u8', this.fakeVhs);

    loader.load();
    this.requests.pop().respond(
      200, null,
      '#EXTM3U\n' +
      '#PARSER:parsed\n' +
      '#MAPPER:1511816599485\n' +
      '#EXTINF:10,\n' +
      '0.ts\n' +
      '#EXT-X-ENDLIST\n'
    );

    const segment = loader.main.playlists[0].segments[0];

    assert.strictEqual(segment.custom.test, '#PARSER:parsed', 'parsed custom tag');
    assert.ok(segment.dateTimeObject, 'converted and parsed custom time');

    delete this.fakeVhs.options_;
  });

  QUnit.test(
    'adds properties to playlists array when given a main playlist object',
    function(assert) {
      const mainPlaylist = JSON.parse(JSON.stringify(parseManifest({
        manifestString: manifests.main
      })));
      const firstPlaylistId = createPlaylistID(0, mainPlaylist.playlists[0].uri);

      assert.notOk(
        firstPlaylistId in mainPlaylist.playlists,
        'parsed manifest playlists array does not contain playlist ID property'
      );

      const loader = new PlaylistLoader(mainPlaylist, this.fakeVhs);

      loader.load();
      // even for vhs-json manifest objects, load is an async operation
      this.clock.tick(1);

      assert.ok(
        firstPlaylistId in mainPlaylist.playlists,
        'parsed manifest playlists array contains playlist ID property'
      );
    }
  );

  QUnit.test(
    'jumps to HAVE_METADATA when initialized with a media playlist',
    function(assert) {
      let loadedmetadatas = 0;
      const loader = new PlaylistLoader('media.m3u8', this.fakeVhs);

      loader.load();

      loader.on('loadedmetadata', function() {
        loadedmetadatas++;
      });
      this.requests.pop().respond(
        200, null,
        '#EXTM3U\n' +
        '#EXTINF:10,\n' +
        '0.ts\n' +
        '#EXT-X-ENDLIST\n'
      );
      assert.ok(loader.main, 'infers a main playlist');
      assert.ok(loader.media(), 'sets the media playlist');
      assert.ok(loader.media().uri, 'sets the media playlist URI');
      assert.ok(loader.media().attributes, 'sets the media playlist attributes');
      assert.strictEqual(loader.state, 'HAVE_METADATA', 'the state is correct');
      assert.strictEqual(this.requests.length, 0, 'no more requests are made');
      assert.strictEqual(loadedmetadatas, 1, 'fired one loadedmetadata');
    }
  );

  QUnit.test(
    'moves to HAVE_METADATA without a request when initialized with a media playlist' +
    ' object',
    function(assert) {
      const mediaPlaylist = parseManifest({ manifestString: manifests.media });

      const loader = new PlaylistLoader(mediaPlaylist, this.fakeVhs);
      let loadedmetadataEvents = 0;

      loader.on('loadedmetadata', () => loadedmetadataEvents++);
      loader.load();

      assert.equal(this.requests.length, 0, 'no requests');
      assert.equal(loadedmetadataEvents, 0, 'no loadedmetadata events');
      assert.equal(loader.state, 'HAVE_NOTHING', 'state is HAVE_NOTHING');

      // preparing of manifest by playlist loader is still asynchronous for source objects
      this.clock.tick(1);

      assert.equal(this.requests.length, 0, 'no requests');
      assert.equal(loadedmetadataEvents, 1, 'one loadedmetadata event');
      assert.ok(loader.main, 'inferred a main playlist');
      assert.deepEqual(mediaPlaylist, loader.media(), 'set the media playlist');
      assert.equal(loader.state, 'HAVE_METADATA', 'state is HAVE_METADATA');
    }
  );

  QUnit.test(
    'stays at HAVE_MAIN_MANIFEST and makes a request when initialized with a main playlist ' +
    'without resolved media playlists',
    function(assert) {
      const mainPlaylist = parseManifest({ manifestString: manifests.main });

      const loader = new PlaylistLoader(mainPlaylist, this.fakeVhs);
      let loadedmetadataEvents = 0;

      loader.on('loadedmetadata', () => loadedmetadataEvents++);
      loader.load();

      assert.equal(this.requests.length, 0, 'no requests');
      assert.equal(loadedmetadataEvents, 0, 'no loadedmetadata events');
      assert.equal(loader.state, 'HAVE_NOTHING', 'state is HAVE_NOTHING');

      // preparing of manifest by playlist loader is still asynchronous for source objects
      this.clock.tick(1);

      assert.equal(this.requests.length, 1, 'one request');
      assert.equal(loadedmetadataEvents, 0, 'no loadedmetadata event');
      assert.deepEqual(loader.main, mainPlaylist, 'set the main playlist');
      assert.equal(loader.state, 'SWITCHING_MEDIA', 'state is SWITCHING_MEDIA');
    }
  );

  QUnit.test(
    'moves to HAVE_METADATA without a request when initialized with a main playlist ' +
    'object with resolved media playlists',
    function(assert) {
      const mainPlaylist = parseManifest({ manifestString: manifests.main });
      const mediaPlaylist = parseManifest({ manifestString: manifests.media });

      // since the playlist is getting overwritten in the main (to fake a resolved media
      // playlist), attributes should be copied over to prevent warnings or errors due to
      // a missing BANDWIDTH attribute
      mediaPlaylist.attributes = mainPlaylist.playlists[0].attributes;

      // If no playlist is selected after the first loadedplaylist event, then playlist loader
      // defaults to the first playlist. Here it's already resolved, so loadedmetadata should
      // fire immediately.
      mainPlaylist.playlists[0] = mediaPlaylist;

      const loader = new PlaylistLoader(mainPlaylist, this.fakeVhs);
      let loadedmetadataEvents = 0;

      loader.on('loadedmetadata', () => loadedmetadataEvents++);
      loader.load();

      assert.equal(this.requests.length, 0, 'no requests');
      assert.equal(loadedmetadataEvents, 0, 'no loadedmetadata events');
      assert.equal(loader.state, 'HAVE_NOTHING', 'state is HAVE_NOTHING');

      // preparing of manifest by playlist loader is still asynchronous for source objects
      this.clock.tick(1);

      assert.equal(this.requests.length, 0, 'no requests');
      assert.equal(loadedmetadataEvents, 1, 'one loadedmetadata event');
      assert.deepEqual(loader.main, mainPlaylist, 'set the main playlist');
      assert.deepEqual(mediaPlaylist, loader.media(), 'set the media playlist');
      assert.equal(loader.state, 'HAVE_METADATA', 'state is HAVE_METADATA');
    }
  );

  QUnit.test('resolves relative media playlist URIs', function(assert) {
    const loader = new PlaylistLoader('main.m3u8', this.fakeVhs);

    loader.load();

    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
      'video/media.m3u8\n'
    );
    assert.equal(
      loader.main.playlists[0].resolvedUri, urlTo('video/media.m3u8'),
      'resolved media URI'
    );
  });

  QUnit.test('resolves media initialization segment URIs', function(assert) {
    const loader = new PlaylistLoader('video/fmp4.m3u8', this.fakeVhs);

    loader.load();
    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-MAP:URI="main.mp4",BYTERANGE="720@0"\n' +
      '#EXTINF:10,\n' +
      '0.ts\n' +
      '#EXT-X-ENDLIST\n'
    );

    assert.equal(
      loader.media().segments[0].map.resolvedUri, urlTo('video/main.mp4'),
      'resolved init segment URI'
    );
  });

  QUnit.test('recognizes redirect, when media requested', function(assert) {
    const loader = new PlaylistLoader('manifest/media.m3u8', this.fakeVhs, {});

    loader.load();

    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
      '/media.m3u8\n'
    );
    assert.equal(
      loader.main.playlists[0].resolvedUri,
      window.location.protocol + '//' +
      window.location.host + '/media.m3u8',
      'resolved media URI'
    );

    const mediaRequest = this.requests.shift();

    mediaRequest.responseURL = window.location.protocol + '//' +
      'foo-bar.com/media.m3u8';
    mediaRequest.respond(
      200, null,
      '#EXTM3U\n' +
      '#EXTINF:10,\n' +
      '/00001.ts\n' +
      '#EXT-X-ENDLIST\n'
    );
    assert.equal(
      loader.media().segments[0].resolvedUri,
      window.location.protocol + '//' +
      'foo-bar.com/00001.ts',
      'resolved segment URI'
    );
  });

  QUnit.test('recognizes absolute URIs and requests them unmodified', function(assert) {
    const loader = new PlaylistLoader('manifest/media.m3u8', this.fakeVhs);

    loader.load();

    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
      'http://example.com/video/media.m3u8\n'
    );
    assert.equal(
      loader.main.playlists[0].resolvedUri,
      'http://example.com/video/media.m3u8', 'resolved media URI'
    );

    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXTINF:10,\n' +
      'http://example.com/00001.ts\n' +
      '#EXT-X-ENDLIST\n'
    );
    assert.equal(
      loader.media().segments[0].resolvedUri,
      'http://example.com/00001.ts', 'resolved segment URI'
    );
  });

  QUnit.test('recognizes domain-relative URLs', function(assert) {
    const loader = new PlaylistLoader('manifest/media.m3u8', this.fakeVhs);

    loader.load();

    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
      '/media.m3u8\n'
    );
    assert.equal(
      loader.main.playlists[0].resolvedUri,
      window.location.protocol + '//' +
      window.location.host + '/media.m3u8',
      'resolved media URI'
    );

    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXTINF:10,\n' +
      '/00001.ts\n' +
      '#EXT-X-ENDLIST\n'
    );
    assert.equal(
      loader.media().segments[0].resolvedUri,
      window.location.protocol + '//' +
      window.location.host + '/00001.ts',
      'resolved segment URI'
    );
  });

  QUnit.test('recognizes key URLs relative to main and playlist', function(assert) {
    const loader = new PlaylistLoader('/video/media-encrypted.m3u8', this.fakeVhs);

    loader.load();

    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=17\n' +
      'playlist/playlist.m3u8\n' +
      '#EXT-X-ENDLIST\n'
    );
    assert.equal(
      loader.main.playlists[0].resolvedUri,
      window.location.protocol + '//' +
      window.location.host + '/video/playlist/playlist.m3u8',
      'resolved media URI'
    );

    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-TARGETDURATION:15\n' +
      '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.php"\n' +
      '#EXTINF:2.833,\n' +
      'http://example.com/000001.ts\n' +
      '#EXT-X-ENDLIST\n'
    );
    assert.equal(
      loader.media().segments[0].key.resolvedUri,
      window.location.protocol + '//' +
      window.location.host + '/video/playlist/keys/key.php',
      'resolved multiple relative paths for key URI'
    );
  });

  QUnit.test('trigger an error event when a media playlist 404s', function(assert) {
    let count = 0;
    const loader = new PlaylistLoader('manifest/main.m3u8', this.fakeVhs);

    loader.load();

    loader.on('error', function() {
      count += 1;
    });

    // main
    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=17\n' +
      'playlist/playlist.m3u8\n' +
      '#EXT-X-STREAM-INF:PROGRAM-ID=2,BANDWIDTH=170\n' +
      'playlist/playlist2.m3u8\n' +
      '#EXT-X-ENDLIST\n'
    );
    assert.equal(
      count, 0,
      'error not triggered before requesting playlist'
    );

    // playlist
    this.requests.shift().respond(404);

    assert.equal(
      count, 1,
      'error triggered after playlist 404'
    );
  });

  QUnit.test('recognizes absolute key URLs', function(assert) {
    const loader = new PlaylistLoader('/video/media-encrypted.m3u8', this.fakeVhs);

    loader.load();

    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=17\n' +
      'playlist/playlist.m3u8\n' +
      '#EXT-X-ENDLIST\n'
    );
    assert.equal(
      loader.main.playlists[0].resolvedUri,
      window.location.protocol + '//' +
      window.location.host + '/video/playlist/playlist.m3u8',
      'resolved media URI'
    );

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
    assert.equal(
      loader.media().segments[0].key.resolvedUri,
      'http://example.com/keys/key.php', 'resolved absolute path for key URI'
    );
  });

  QUnit.test(
    'jumps to HAVE_METADATA when initialized with a live media playlist',
    function(assert) {
      const loader = new PlaylistLoader('media.m3u8', this.fakeVhs);

      loader.load();

      this.requests.pop().respond(
        200, null,
        '#EXTM3U\n' +
        '#EXTINF:10,\n' +
        '0.ts\n'
      );
      assert.ok(loader.main, 'infers a main playlist');
      assert.ok(loader.media(), 'sets the media playlist');
      assert.ok(loader.media().attributes, 'sets the media playlist attributes');
      assert.strictEqual(loader.state, 'HAVE_METADATA', 'the state is correct');
    }
  );

  QUnit.test('moves to HAVE_METADATA after loading a media playlist', function(assert) {
    let loadedPlaylist = 0;
    let loadedMetadata = 0;
    const loader = new PlaylistLoader('main.m3u8', this.fakeVhs);

    loader.load();

    loader.on('loadedplaylist', function() {
      loadedPlaylist++;
    });
    loader.on('loadedmetadata', function() {
      loadedMetadata++;
    });
    this.requests.pop().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
      'media.m3u8\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
      'alt.m3u8\n'
    );
    assert.strictEqual(loadedPlaylist, 1, 'fired loadedplaylist once');
    assert.strictEqual(loadedMetadata, 0, 'did not fire loadedmetadata');
    assert.strictEqual(this.requests.length, 1, 'requests the media playlist');
    assert.strictEqual(this.requests[0].method, 'GET', 'GETs the media playlist');
    assert.strictEqual(
      this.requests[0].url,
      urlTo('media.m3u8'),
      'requests the first playlist'
    );

    this.requests.pop().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXTINF:10,\n' +
      '0.ts\n'
    );
    assert.ok(loader.main, 'sets the main playlist');
    assert.ok(loader.media(), 'sets the media playlist');
    assert.strictEqual(loadedPlaylist, 2, 'fired loadedplaylist twice');
    assert.strictEqual(loadedMetadata, 1, 'fired loadedmetadata once');
    assert.strictEqual(loader.state, 'HAVE_METADATA', 'the state is correct');
  });

  QUnit.test('defaults missing media groups for a media playlist', function(assert) {
    const loader = new PlaylistLoader('main.m3u8', this.fakeVhs);

    loader.load();
    this.requests.pop().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXTINF:10,\n' +
      '0.ts\n'
    );

    assert.ok(loader.main.mediaGroups.AUDIO, 'defaulted audio');
    assert.ok(loader.main.mediaGroups.VIDEO, 'defaulted video');
    assert.ok(loader.main.mediaGroups['CLOSED-CAPTIONS'], 'defaulted closed captions');
    assert.ok(loader.main.mediaGroups.SUBTITLES, 'defaulted subtitles');
  });

  QUnit.test(
    'moves to HAVE_CURRENT_METADATA when refreshing the playlist',
    function(assert) {
      const loader = new PlaylistLoader('live.m3u8', this.fakeVhs);

      loader.load();

      this.requests.pop().respond(
        200, null,
        '#EXTM3U\n' +
        '#EXTINF:10,\n' +
        '0.ts\n'
      );
      // 10s, one target duration
      this.clock.tick(10 * 1000);
      assert.strictEqual(loader.state, 'HAVE_CURRENT_METADATA', 'the state is correct');
      assert.strictEqual(this.requests.length, 1, 'requested playlist');
      assert.strictEqual(
        this.requests[0].url,
        urlTo('live.m3u8'),
        'refreshes the media playlist'
      );
    }
  );

  QUnit.test('returns to HAVE_METADATA after refreshing the playlist', function(assert) {
    const loader = new PlaylistLoader('live.m3u8', this.fakeVhs);

    loader.load();

    this.requests.pop().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXTINF:10,\n' +
      '0.ts\n'
    );
    // 10s, one target duration
    this.clock.tick(10 * 1000);
    this.requests.pop().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXTINF:10,\n' +
      '1.ts\n'
    );
    assert.strictEqual(loader.state, 'HAVE_METADATA', 'the state is correct');
  });

  QUnit.test('refreshes the playlist after last segment duration', function(assert) {
    const loader = new PlaylistLoader('live.m3u8', this.fakeVhs);
    let refreshes = 0;

    loader.on('mediaupdatetimeout', () => refreshes++);

    loader.load();

    this.requests.pop().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-TARGETDURATION:10\n' +
      '#EXTINF:10,\n' +
      '0.ts\n' +
      '#EXTINF:4\n' +
      '1.ts\n'
    );
    // 4s, last segment duration
    this.clock.tick(4 * 1000);

    assert.equal(refreshes, 1, 'refreshed playlist after last segment duration');
  });

  QUnit.test('emits an error when an initial playlist request fails', function(assert) {
    const errors = [];
    const loader = new PlaylistLoader('main.m3u8', this.fakeVhs);

    loader.load();

    loader.on('error', function() {
      errors.push(loader.error);
    });
    this.requests.pop().respond(500);

    assert.strictEqual(errors.length, 1, 'emitted one error');
    assert.strictEqual(errors[0].status, 500, 'http status is captured');
  });

  QUnit.test('errors when an initial media playlist request fails', function(assert) {
    const errors = [];
    const loader = new PlaylistLoader('main.m3u8', this.fakeVhs);

    loader.load();

    loader.on('error', function() {
      errors.push(loader.error);
    });
    this.requests.pop().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
      'media.m3u8\n'
    );

    assert.strictEqual(errors.length, 0, 'emitted no errors');

    this.requests.pop().respond(500);

    assert.strictEqual(errors.length, 1, 'emitted one error');
    assert.strictEqual(errors[0].status, 500, 'http status is captured');
  });

  // http://tools.ietf.org/html/draft-pantos-http-live-streaming-12#section-6.3.4
  QUnit.test(
    'halves the refresh timeout if a playlist is unchanged since the last reload',
    function(assert) {
      const loader = new PlaylistLoader('live.m3u8', this.fakeVhs);

      loader.load();

      this.requests.pop().respond(
        200, null,
        '#EXTM3U\n' +
        '#EXT-X-MEDIA-SEQUENCE:0\n' +
        '#EXTINF:10,\n' +
        '0.ts\n'
      );
      // trigger a refresh
      this.clock.tick(10 * 1000);
      this.requests.pop().respond(
        200, null,
        '#EXTM3U\n' +
        '#EXT-X-MEDIA-SEQUENCE:0\n' +
        '#EXTINF:10,\n' +
        '0.ts\n'
      );
      // half the default target-duration
      this.clock.tick(5 * 1000);

      assert.strictEqual(this.requests.length, 1, 'sent a request');
      assert.strictEqual(
        this.requests[0].url,
        urlTo('live.m3u8'),
        'requested the media playlist'
      );
    }
  );

  QUnit.test('preserves segment metadata across playlist refreshes', function(assert) {
    const loader = new PlaylistLoader('live.m3u8', this.fakeVhs);

    loader.load();

    this.requests.pop().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n' +
      '#EXTINF:10,\n' +
      '0.ts\n' +
      '#EXTINF:10,\n' +
      '1.ts\n' +
      '#EXTINF:10,\n' +
      '2.ts\n'
    );
    // add PTS info to 1.ts
    const segment = loader.media().segments[1];

    segment.minVideoPts = 14;
    segment.maxAudioPts = 27;
    segment.preciseDuration = 10.045;

    // trigger a refresh
    this.clock.tick(10 * 1000);
    this.requests.pop().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-MEDIA-SEQUENCE:1\n' +
      '#EXTINF:10,\n' +
      '1.ts\n' +
      '#EXTINF:10,\n' +
      '2.ts\n'
    );

    assert.deepEqual(loader.media().segments[0], segment, 'preserved segment attributes');
  });

  QUnit.test('clears the update timeout when switching quality', function(assert) {
    const loader = new PlaylistLoader('live-main.m3u8', this.fakeVhs);
    let refreshes = 0;

    loader.load();

    // track the number of playlist refreshes triggered
    loader.on('mediaupdatetimeout', function() {
      refreshes++;
    });
    // deliver the main
    this.requests.pop().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
      'live-low.m3u8\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=2\n' +
      'live-high.m3u8\n'
    );
    // deliver the low quality playlist
    this.requests.pop().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n' +
      '#EXTINF:10,\n' +
      'low-0.ts\n'
    );
    // change to a higher quality playlist
    loader.media('1-live-high.m3u8');
    this.requests.pop().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n' +
      '#EXTINF:10,\n' +
      'high-0.ts\n'
    );
    // trigger a refresh
    this.clock.tick(10 * 1000);

    assert.equal(1, refreshes, 'only one refresh was triggered');
  });

  QUnit.test('media-sequence updates are considered a playlist change', function(assert) {
    const loader = new PlaylistLoader('live.m3u8', this.fakeVhs);

    loader.load();

    this.requests.pop().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n' +
      '#EXTINF:10,\n' +
      '0.ts\n'
    );
    // trigger a refresh
    this.clock.tick(10 * 1000);
    this.requests.pop().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-MEDIA-SEQUENCE:1\n' +
      '#EXTINF:10,\n' +
      '0.ts\n'
    );
    // half the default target-duration
    this.clock.tick(5 * 1000);

    assert.strictEqual(this.requests.length, 0, 'no request is sent');
  });

  QUnit.test('emits an error if a media refresh fails', function(assert) {
    let errors = 0;
    const errorResponseText = 'custom error message';
    const loader = new PlaylistLoader('live.m3u8', this.fakeVhs);

    loader.load();

    loader.on('error', function() {
      errors++;
    });
    this.requests.pop().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n' +
      '#EXTINF:10,\n' +
      '0.ts\n'
    );
    // trigger a refresh
    this.clock.tick(10 * 1000);
    this.requests.pop().respond(500, null, errorResponseText);

    assert.strictEqual(errors, 1, 'emitted an error');
    assert.strictEqual(loader.error.status, 500, 'captured the status code');
    assert.strictEqual(
      loader.error.responseText,
      errorResponseText,
      'captured the responseText'
    );
  });

  QUnit.test('switches media playlists when requested', function(assert) {
    const loader = new PlaylistLoader('main.m3u8', this.fakeVhs);

    loader.load();

    this.requests.pop().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
      'low.m3u8\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=2\n' +
      'high.m3u8\n'
    );
    this.requests.pop().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n' +
      '#EXTINF:10,\n' +
      'low-0.ts\n'
    );

    loader.media(loader.main.playlists[1]);
    assert.strictEqual(loader.state, 'SWITCHING_MEDIA', 'updated the state');

    this.requests.pop().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n' +
      '#EXTINF:10,\n' +
      'high-0.ts\n'
    );
    assert.strictEqual(loader.state, 'HAVE_METADATA', 'switched active media');
    assert.strictEqual(
      loader.media(),
      loader.main.playlists[1],
      'updated the active media'
    );
  });

  QUnit.test(
    'can switch playlists immediately after the main is downloaded',
    function(assert) {
      const loader = new PlaylistLoader('main.m3u8', this.fakeVhs);

      loader.load();

      loader.on('loadedplaylist', function() {
        loader.media('1-high.m3u8');
      });
      this.requests.pop().respond(
        200, null,
        '#EXTM3U\n' +
        '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
        'low.m3u8\n' +
        '#EXT-X-STREAM-INF:BANDWIDTH=2\n' +
        'high.m3u8\n'
      );
      assert.equal(this.requests[0].url, urlTo('high.m3u8'), 'switched variants immediately');
    }
  );

  QUnit.test('can switch media playlists based on ID', function(assert) {
    const loader = new PlaylistLoader('main.m3u8', this.fakeVhs);

    loader.load();

    this.requests.pop().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
      'low.m3u8\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=2\n' +
      'high.m3u8\n'
    );
    this.requests.pop().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n' +
      '#EXTINF:10,\n' +
      'low-0.ts\n'
    );

    loader.media('1-high.m3u8');
    assert.strictEqual(loader.state, 'SWITCHING_MEDIA', 'updated the state');

    this.requests.pop().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n' +
      '#EXTINF:10,\n' +
      'high-0.ts\n'
    );
    assert.strictEqual(loader.state, 'HAVE_METADATA', 'switched active media');
    assert.strictEqual(
      loader.media(),
      loader.main.playlists[1],
      'updated the active media'
    );
  });

  QUnit.test('aborts in-flight playlist refreshes when switching', function(assert) {
    const loader = new PlaylistLoader('main.m3u8', this.fakeVhs);

    loader.load();

    this.requests.pop().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
      'low.m3u8\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=2\n' +
      'high.m3u8\n'
    );
    this.requests.pop().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n' +
      '#EXTINF:10,\n' +
      'low-0.ts\n'
    );
    this.clock.tick(10 * 1000);
    loader.media('1-high.m3u8');
    assert.strictEqual(this.requests[0].aborted, true, 'aborted refresh request');
    assert.ok(
      !this.requests[0].onreadystatechange,
      'onreadystatechange handlers should be removed on abort'
    );
    assert.strictEqual(loader.state, 'SWITCHING_MEDIA', 'updated the state');
  });

  QUnit.test('switching to the active playlist is a no-op', function(assert) {
    const loader = new PlaylistLoader('main.m3u8', this.fakeVhs);

    loader.load();

    this.requests.pop().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
      'low.m3u8\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=2\n' +
      'high.m3u8\n'
    );
    this.requests.pop().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n' +
      '#EXTINF:10,\n' +
      'low-0.ts\n' +
      '#EXT-X-ENDLIST\n'
    );
    loader.media('0-low.m3u8');

    assert.strictEqual(this.requests.length, 0, 'no requests are sent');
  });

  QUnit.test('switching to the active live playlist is a no-op', function(assert) {
    const loader = new PlaylistLoader('main.m3u8', this.fakeVhs);

    loader.load();

    this.requests.pop().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
      'low.m3u8\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=2\n' +
      'high.m3u8\n'
    );
    this.requests.pop().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n' +
      '#EXTINF:10,\n' +
      'low-0.ts\n'
    );
    loader.media('0-low.m3u8');

    assert.strictEqual(this.requests.length, 0, 'no requests are sent');
  });

  QUnit.test(
    'switches back to loaded playlists without re-requesting them',
    function(assert) {
      const loader = new PlaylistLoader('main.m3u8', this.fakeVhs);

      loader.load();

      this.requests.pop().respond(
        200, null,
        '#EXTM3U\n' +
        '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
        'low.m3u8\n' +
        '#EXT-X-STREAM-INF:BANDWIDTH=2\n' +
        'high.m3u8\n'
      );
      this.requests.pop().respond(
        200, null,
        '#EXTM3U\n' +
        '#EXT-X-MEDIA-SEQUENCE:0\n' +
        '#EXTINF:10,\n' +
        'low-0.ts\n' +
        '#EXT-X-ENDLIST\n'
      );
      loader.media('1-high.m3u8');
      this.requests.pop().respond(
        200, null,
        '#EXTM3U\n' +
        '#EXT-X-MEDIA-SEQUENCE:0\n' +
        '#EXTINF:10,\n' +
        'high-0.ts\n' +
        '#EXT-X-ENDLIST\n'
      );
      loader.media('0-low.m3u8');

      assert.strictEqual(this.requests.length, 0, 'no outstanding requests');
      assert.strictEqual(loader.state, 'HAVE_METADATA', 'returned to loaded playlist');
    }
  );

  QUnit.test(
    'aborts outstanding requests if switching back to an already loaded playlist',
    function(assert) {
      const loader = new PlaylistLoader('main.m3u8', this.fakeVhs);

      loader.load();

      this.requests.pop().respond(
        200, null,
        '#EXTM3U\n' +
        '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
        'low.m3u8\n' +
        '#EXT-X-STREAM-INF:BANDWIDTH=2\n' +
        'high.m3u8\n'
      );
      this.requests.pop().respond(
        200, null,
        '#EXTM3U\n' +
        '#EXT-X-MEDIA-SEQUENCE:0\n' +
        '#EXTINF:10,\n' +
        'low-0.ts\n' +
        '#EXT-X-ENDLIST\n'
      );
      loader.media('1-high.m3u8');
      loader.media('0-low.m3u8');

      assert.strictEqual(
        this.requests.length,
        1,
        'requested high playlist'
      );
      assert.ok(
        this.requests[0].aborted,
        'aborted playlist request'
      );
      assert.ok(
        !this.requests[0].onreadystatechange,
        'onreadystatechange handlers should be removed on abort'
      );
      assert.strictEqual(
        loader.state,
        'HAVE_METADATA',
        'returned to loaded playlist'
      );
      assert.strictEqual(
        loader.media(),
        loader.main.playlists[0],
        'switched to loaded playlist'
      );
    }
  );

  QUnit.test(
    'does not abort requests when the same playlist is re-requested',
    function(assert) {
      const loader = new PlaylistLoader('main.m3u8', this.fakeVhs);

      loader.load();

      this.requests.pop().respond(
        200, null,
        '#EXTM3U\n' +
        '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
        'low.m3u8\n' +
        '#EXT-X-STREAM-INF:BANDWIDTH=2\n' +
        'high.m3u8\n'
      );
      this.requests.pop().respond(
        200, null,
        '#EXTM3U\n' +
        '#EXT-X-MEDIA-SEQUENCE:0\n' +
        '#EXTINF:10,\n' +
        'low-0.ts\n' +
        '#EXT-X-ENDLIST\n'
      );
      loader.media('1-high.m3u8');
      loader.media('1-high.m3u8');

      assert.strictEqual(this.requests.length, 1, 'made only one request');
      assert.ok(!this.requests[0].aborted, 'request not aborted');
    }
  );

  QUnit.test('throws an error if a media switch is initiated too early', function(assert) {
    const loader = new PlaylistLoader('main.m3u8', this.fakeVhs);

    loader.load();

    assert.throws(function() {
      loader.media('1-high.m3u8');
    }, 'threw an error from HAVE_NOTHING');

    this.requests.pop().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
      'low.m3u8\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=2\n' +
      'high.m3u8\n'
    );
  });

  QUnit.test(
    'throws an error if a switch to an unrecognized playlist is requested',
    function(assert) {
      const loader = new PlaylistLoader('main.m3u8', this.fakeVhs);

      loader.load();

      this.requests.pop().respond(
        200, null,
        '#EXTM3U\n' +
        '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
        'media.m3u8\n'
      );

      assert.throws(function() {
        loader.media('unrecognized.m3u8');
      }, 'throws an error');
    }
  );

  QUnit.test('dispose cancels the refresh timeout', function(assert) {
    const loader = new PlaylistLoader('live.m3u8', this.fakeVhs);

    loader.load();

    this.requests.pop().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n' +
      '#EXTINF:10,\n' +
      '0.ts\n'
    );
    loader.dispose();
    // a lot of time passes...
    this.clock.tick(15 * 1000);

    assert.strictEqual(this.requests.length, 0, 'no refresh request was made');
  });

  QUnit.test('dispose aborts pending refresh requests', function(assert) {
    const loader = new PlaylistLoader('live.m3u8', this.fakeVhs);

    loader.load();

    this.requests.pop().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n' +
      '#EXTINF:10,\n' +
      '0.ts\n'
    );
    this.clock.tick(10 * 1000);

    loader.dispose();
    assert.ok(this.requests[0].aborted, 'refresh request aborted');
    assert.ok(
      !this.requests[0].onreadystatechange,
      'onreadystatechange handler should not exist after dispose called'
    );
  });

  QUnit.test('errors if requests take longer than 45s', function(assert) {
    const loader = new PlaylistLoader('media.m3u8', this.fakeVhs);
    let errors = 0;

    loader.load();

    loader.on('error', function() {
      errors++;
    });
    this.clock.tick(45 * 1000);

    assert.strictEqual(errors, 1, 'fired one error');
    assert.strictEqual(loader.error.code, 2, 'fired a network error');
  });

  QUnit.test('triggers an event when the active media changes', function(assert) {
    const loader = new PlaylistLoader('main.m3u8', this.fakeVhs);
    let mediaChanges = 0;
    let mediaChangings = 0;
    let loadedPlaylists = 0;
    let loadedMetadata = 0;

    loader.on('mediachange', () => {
      mediaChanges++;
    });
    loader.on('mediachanging', () => {
      mediaChangings++;
    });
    loader.on('loadedplaylist', () => {
      loadedPlaylists++;
    });
    loader.on('loadedmetadata', () => {
      loadedMetadata++;
    });

    loader.load();
    this.requests.pop().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
      'low.m3u8\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=2\n' +
      'high.m3u8\n'
    );
    assert.strictEqual(loadedPlaylists, 1, 'trigger loadedplaylist');
    assert.strictEqual(loadedMetadata, 0, 'no loadedmetadata yet');

    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n' +
      '#EXTINF:10,\n' +
      'low-0.ts\n' +
      '#EXT-X-ENDLIST\n'
    );
    assert.strictEqual(mediaChangings, 0, 'initial selection is not a media changing');
    assert.strictEqual(mediaChanges, 0, 'initial selection is not a media change');
    assert.strictEqual(loadedPlaylists, 2, 'two loadedplaylists');
    assert.strictEqual(loadedMetadata, 1, 'fired loadedMetadata');

    loader.media('1-high.m3u8');
    assert.strictEqual(mediaChangings, 1, 'mediachanging fires immediately');
    assert.strictEqual(mediaChanges, 0, 'mediachange does not fire immediately');
    assert.strictEqual(loadedPlaylists, 2, 'still two loadedplaylists');
    assert.strictEqual(loadedMetadata, 1, 'still one loadedmetadata');

    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n' +
      '#EXTINF:10,\n' +
      'high-0.ts\n' +
      '#EXT-X-ENDLIST\n'
    );
    assert.strictEqual(mediaChangings, 1, 'still one mediachanging');
    assert.strictEqual(mediaChanges, 1, 'fired a mediachange');
    assert.strictEqual(loadedPlaylists, 3, 'three loadedplaylists');
    assert.strictEqual(loadedMetadata, 1, 'still one loadedmetadata');

    // switch back to an already loaded playlist
    loader.media('0-low.m3u8');
    assert.strictEqual(this.requests.length, 0, 'no requests made');
    assert.strictEqual(mediaChangings, 2, 'mediachanging fires');
    assert.strictEqual(mediaChanges, 2, 'fired a mediachange');
    assert.strictEqual(loadedPlaylists, 3, 'still three loadedplaylists');
    assert.strictEqual(loadedMetadata, 1, 'still one loadedmetadata');

    // trigger a no-op switch
    loader.media('0-low.m3u8');
    assert.strictEqual(this.requests.length, 0, 'no requests made');
    assert.strictEqual(mediaChangings, 2, 'mediachanging ignored the no-op');
    assert.strictEqual(mediaChanges, 2, 'ignored a no-op media change');
    assert.strictEqual(loadedPlaylists, 3, 'still three loadedplaylists');
    assert.strictEqual(loadedMetadata, 1, 'still one loadedmetadata');
  });

  QUnit.test('playlistErrors_ are reset on a successful response', function(assert) {
    const loader = new PlaylistLoader('manifest/main.m3u8', this.fakeVhs);

    loader.load();

    // main
    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=17\n' +
      'playlist/playlist.m3u8\n' +
      '#EXT-X-STREAM-INF:PROGRAM-ID=2,BANDWIDTH=170\n' +
      'playlist/playlist2.m3u8\n' +
      '#EXT-X-ENDLIST\n'
    );

    loader.main.playlists[0].playlistErrors_ = 3;

    // playlist
    this.requests.shift().respond(404);

    loader.media(loader.main.playlists[1]);
    loader.media(loader.main.playlists[0]);

    assert.equal(loader.main.playlists[0].playlistErrors_, 3, 'we have 3 playlistErrors_');

    this.requests[1].respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n' +
      '#EXTINF:10,\n' +
      '0.ts\n'
    );
    assert.equal(loader.main.playlists[0].playlistErrors_, 0, 'playlistErrors_ resets to zero when a playlist sucessfully loads');
  });

  QUnit.test(
    'does not misintrepret playlists missing newlines at the end',
    function(assert) {
      const loader = new PlaylistLoader('media.m3u8', this.fakeVhs);

      loader.load();

      this.requests.shift().respond(
        200, null,
        '#EXTM3U\n' +
        '#EXT-X-MEDIA-SEQUENCE:0\n' +
        '#EXTINF:10,\n' +
        'low-0.ts\n' +
        '#EXT-X-ENDLIST'
      );
      assert.ok(loader.media().endList, 'flushed the final line of input');
    }
  );

  QUnit.test('Supports multiple STREAM-INF with the same URI', function(assert) {
    const loader = new PlaylistLoader('main.m3u8', this.fakeVhs);

    loader.load();

    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=1,AUDIO="aud0"\n' +
      'video/media.m3u8\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=2,AUDIO="aud1"\n' +
      'video/media.m3u8\n'
    );
    assert.equal(
      loader.main.playlists['0-video/media.m3u8'].id,
      loader.main.playlists[0].id,
      'created key based on playlist id'
    );

    assert.equal(
      loader.main.playlists['1-video/media.m3u8'].id,
      loader.main.playlists[1].id,
      'created key based on playlist id'
    );
  });

  QUnit.test('mediaupdatetimeout works as expected for live playlists', function(assert) {
    const loader = new PlaylistLoader('main.m3u8', this.fakeVhs);
    let media =
      '#EXTM3U\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n' +
      '#EXTINF:5,\n' +
      'low-0.ts\n' +
      '#EXTINF:5,\n' +
      'low-1.ts\n';

    loader.load();

    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
      'media.m3u8\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
      'media2.m3u8\n'
    );

    this.requests.shift().respond(200, null, media);

    assert.ok(loader.mediaUpdateTimeout, 'has an initial media update timeout');

    this.clock.tick(5000);

    media += '#EXTINF:5\nlow-2.ts\n';

    this.requests.shift().respond(200, null, media);

    assert.ok(loader.mediaUpdateTimeout, 'media update timeout created another');

    loader.pause();
    assert.notOk(loader.mediaUpdateTimeout, 'media update timeout cleared');

    loader.media(loader.main.playlists[0]);

    assert.ok(loader.mediaUpdateTimeout, 'media update timeout created again');
    assert.equal(this.requests.length, 0, 'no request');

    loader.media(loader.main.playlists[1]);

    assert.ok(loader.mediaUpdateTimeout, 'media update timeout created');
    assert.equal(this.requests.length, 1, 'playlist requested');

    this.requests.shift().respond(500, null, 'fail');

    assert.ok(loader.mediaUpdateTimeout, 'media update timeout exists after request failure');

    this.clock.tick(5000);

    assert.ok(loader.mediaUpdateTimeout, 'media update timeout created again');
    assert.equal(this.requests.length, 1, 'playlist re-requested');
  });

  QUnit.module('llhls', {
    beforeEach() {
      this.fakeVhs.options_ = {llhls: true};
      this.loader = new PlaylistLoader('http://example.com/media.m3u8', this.fakeVhs);

      this.loader.load();

    },
    afterEach() {
      this.loader.dispose();
    }
  });

  QUnit.test('#EXT-X-SKIP does not add initial empty segments', function(assert) {
    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n' +
      '#EXT-X-SKIP:SKIPPED-SEGMENTS=10\n' +
      '#EXTINF:2\n' +
      'low-1.ts\n'
    );
    assert.equal(this.loader.media().segments.length, 1, 'only 1 segment');
  });

  QUnit.test('#EXT-X-SKIP merges skipped segments', function(assert) {
    let playlist =
      '#EXTM3U\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n';

    for (let i = 0; i < 10; i++) {
      playlist += '#EXTINF:2\n';
      playlist += `segment-${i}.ts\n`;
    }

    this.requests.shift().respond(200, null, playlist);
    assert.equal(this.loader.media().segments.length, 10, '10 segments');

    this.loader.trigger('mediaupdatetimeout');

    const skippedPlaylist =
      '#EXTM3U\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n' +
      '#EXT-X-SKIP:SKIPPED-SEGMENTS=10\n' +
      '#EXTINF:2\n' +
      'segment-10.ts\n';

    this.requests.shift().respond(200, null, skippedPlaylist);

    assert.equal(this.loader.media().segments.length, 11, '11 segments');

    this.loader.media().segments.forEach(function(s, i) {
      if (i < 10) {
        assert.ok(s.hasOwnProperty('skipped'), 'has skipped property');
        assert.false(s.skipped, 'skipped property is false');
      }

      assert.equal(s.uri, `segment-${i}.ts`, 'segment uri as expected');
    });

    this.loader.trigger('mediaupdatetimeout');

    const skippedPlaylist2 =
      '#EXTM3U\n' +
      '#EXT-X-MEDIA-SEQUENCE:1\n' +
      '#EXT-X-SKIP:SKIPPED-SEGMENTS=10\n' +
      '#EXTINF:2\n' +
      'segment-11.ts\n';

    this.requests.shift().respond(200, null, skippedPlaylist2);

    this.loader.media().segments.forEach(function(s, i) {
      if (i < 10) {
        assert.ok(s.hasOwnProperty('skipped'), 'has skipped property');
        assert.false(s.skipped, 'skipped property is false');
      }

      assert.equal(s.uri, `segment-${i + 1}.ts`, 'segment uri as expected');
    });
  });

  QUnit.test('#EXT-X-PRELOAD with parts to added to segment list', function(assert) {
    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-PART-INF:PART-TARGET=1\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n' +
      '#EXTINF:2\n' +
      'low-1.ts\n' +
      '#EXT-X-PART:URI="part1.ts",DURATION=1\n' +
      '#EXT-X-PART:URI="part2.ts",DURATION=1\n'
    );
    const media = this.loader.media();

    assert.equal(media.segments.length, 2, '2 segments');
    assert.deepEqual(
      media.preloadSegment,
      media.segments[media.segments.length - 1],
      'last segment is preloadSegment'
    );
  });

  QUnit.test('#EXT-X-PRELOAD without parts not added to segment list', function(assert) {
    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-PART-INF:PART-TARGET=1\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n' +
      '#EXTINF:2\n' +
      'low-1.ts\n' +
      '#EXT-X-PRELOAD-HINT:TYPE="PART",URI="part1.ts"\n'
    );
    const media = this.loader.media();

    assert.equal(media.segments.length, 1, '1 segment');
    assert.notDeepEqual(
      media.preloadSegment,
      media.segments[media.segments.length - 1],
      'last segment is not preloadSegment'
    );
  });

  QUnit.test('#EXT-X-PART added to segments', function(assert) {
    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-PART-INF:PART-TARGET=1\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n' +
      '#EXTINF:2\n' +
      'segment0.ts\n' +
      '#EXT-X-PART:URI="segment1-part1.ts",DURATION=1\n' +
      '#EXT-X-PART:URI="segment1-part2.ts",DURATION=1\n' +
      'segment1.ts\n' +
      '#EXT-X-PART:URI="segment2-part1.ts",DURATION=1\n' +
      '#EXT-X-PART:URI="segment2-part2.ts",DURATION=1\n' +
      'segment2.ts\n' +
      '#EXT-X-PART:URI="segment3-part1.ts",DURATION=1\n' +
      '#EXT-X-PART:URI="segment3-part2.ts",DURATION=1\n' +
      'segment3.ts\n'
    );
    const segments = this.loader.media().segments;

    assert.equal(segments.length, 4, '4 segments');
    assert.notOk(segments[0].parts, 'no parts for first segment');
    assert.equal(segments[1].parts.length, 2, 'parts for second segment');
    assert.equal(segments[2].parts.length, 2, 'parts for third segment');
    assert.equal(segments[3].parts.length, 2, 'parts for forth segment');
  });

  QUnit.test('Adds _HLS_skip=YES to url when CAN-SKIP-UNTIL is set', function(assert) {
    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-PART-INF:PART-TARGET=1\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n' +
      '#EXT-X-SERVER-CONTROL:CAN-SKIP-UNTIL=3\n' +
      '#EXTINF:2\n' +
      'segment0.ts\n' +
      '#EXTINF:2\n' +
      'segment1.ts\n' +
      '#EXTINF:2\n' +
      'segment2.ts\n' +
      '#EXTINF:2\n' +
      'segment3.ts\n' +
      '#EXTINF:2\n' +
      'segment4.ts\n' +
      '#EXTINF:2\n' +
      'segment5.ts\n' +
      '#EXT-X-PART:URI="segment6-part1.ts",DURATION=1\n' +
      '#EXT-X-PART:URI="segment6-part2.ts",DURATION=1\n' +
      'segment6.ts\n' +
      '#EXT-X-PART:URI="segment7-part1.ts",DURATION=1\n' +
      '#EXT-X-PART:URI="segment7-part2.ts",DURATION=1\n' +
      'segment7.ts\n' +
      '#EXT-X-PART:URI="segment8-part1.ts",DURATION=1\n' +
      '#EXT-X-PART:URI="segment8-part2.ts",DURATION=1\n' +
      'segment8.ts\n'
    );

    this.loader.trigger('mediaupdatetimeout');

    assert.equal(this.requests[0].uri, 'http://example.com/media.m3u8?_HLS_skip=YES');
  });

  QUnit.test('Adds _HLS_skip=v2 to url when CAN-SKIP-UNTIL/CAN-SKIP-DATERANGES is set', function(assert) {
    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-PART-INF:PART-TARGET=1\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n' +
      '#EXT-X-SERVER-CONTROL:CAN-SKIP-UNTIL=3,CAN-SKIP-DATERANGES=YES\n' +
      '#EXTINF:2\n' +
      'segment0.ts\n' +
      '#EXTINF:2\n' +
      'segment1.ts\n' +
      '#EXTINF:2\n' +
      'segment2.ts\n' +
      '#EXTINF:2\n' +
      'segment3.ts\n' +
      '#EXTINF:2\n' +
      'segment4.ts\n' +
      '#EXTINF:2\n' +
      'segment5.ts\n' +
      '#EXT-X-PART:URI="segment6-part1.ts",DURATION=1\n' +
      '#EXT-X-PART:URI="segment6-part2.ts",DURATION=1\n' +
      'segment6.ts\n' +
      '#EXT-X-PART:URI="segment7-part1.ts",DURATION=1\n' +
      '#EXT-X-PART:URI="segment7-part2.ts",DURATION=1\n' +
      'segment7.ts\n' +
      '#EXT-X-PART:URI="segment8-part1.ts",DURATION=1\n' +
      '#EXT-X-PART:URI="segment8-part2.ts",DURATION=1\n' +
      'segment8.ts\n'
    );

    this.loader.trigger('mediaupdatetimeout');

    assert.equal(this.requests[0].uri, 'http://example.com/media.m3u8?_HLS_skip=v2');
  });

  QUnit.test('Adds _HLS_part= and _HLS_msn= when we have a part preload hints and parts', function(assert) {
    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-PART-INF:PART-TARGET=1\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n' +
      '#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES\n' +
      '#EXTINF:2\n' +
      'segment0.ts\n' +
      '#EXTINF:2\n' +
      'segment1.ts\n' +
      '#EXTINF:2\n' +
      'segment2.ts\n' +
      '#EXTINF:2\n' +
      'segment3.ts\n' +
      '#EXTINF:2\n' +
      'segment4.ts\n' +
      '#EXTINF:2\n' +
      'segment5.ts\n' +
      '#EXT-X-PART:URI="segment6-part1.ts",DURATION=1\n' +
      '#EXT-X-PART:URI="segment6-part2.ts",DURATION=1\n' +
      'segment6.ts\n' +
      '#EXT-X-PART:URI="segment7-part1.ts",DURATION=1\n' +
      '#EXT-X-PART:URI="segment7-part2.ts",DURATION=1\n' +
      'segment7.ts\n' +
      '#EXT-X-PART:URI="segment8-part1.ts",DURATION=1\n' +
      '#EXT-X-PRELOAD-HINT:TYPE="PART",URI="segment8-part2.ts"\n'
    );

    this.loader.trigger('mediaupdatetimeout');

    assert.equal(this.requests[0].uri, 'http://example.com/media.m3u8?_HLS_msn=8&_HLS_part=1');
  });

  QUnit.test('Adds _HLS_part= and _HLS_msn= when we have only a part preload hint', function(assert) {
    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-PART-INF:PART-TARGET=1\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n' +
      '#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES\n' +
      '#EXTINF:2\n' +
      'segment0.ts\n' +
      '#EXTINF:2\n' +
      'segment1.ts\n' +
      '#EXTINF:2\n' +
      'segment2.ts\n' +
      '#EXTINF:2\n' +
      'segment3.ts\n' +
      '#EXTINF:2\n' +
      'segment4.ts\n' +
      '#EXTINF:2\n' +
      'segment5.ts\n' +
      '#EXT-X-PART:URI="segment6-part1.ts",DURATION=1\n' +
      '#EXT-X-PART:URI="segment6-part2.ts",DURATION=1\n' +
      'segment6.ts\n' +
      '#EXT-X-PART:URI="segment7-part1.ts",DURATION=1\n' +
      '#EXT-X-PART:URI="segment7-part2.ts",DURATION=1\n' +
      'segment7.ts\n' +
      '#EXT-X-PRELOAD-HINT:TYPE="PART",URI="segment8-part1.ts"\n'
    );

    this.loader.trigger('mediaupdatetimeout');

    assert.equal(this.requests[0].uri, 'http://example.com/media.m3u8?_HLS_msn=7&_HLS_part=0');
  });

  QUnit.test('does not add _HLS_part= when we have only a preload parts without preload hints', function(assert) {
    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-PART-INF:PART-TARGET=1\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n' +
      '#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES\n' +
      '#EXTINF:2\n' +
      'segment0.ts\n' +
      '#EXTINF:2\n' +
      'segment1.ts\n' +
      '#EXTINF:2\n' +
      'segment2.ts\n' +
      '#EXTINF:2\n' +
      'segment3.ts\n' +
      '#EXTINF:2\n' +
      'segment4.ts\n' +
      '#EXTINF:2\n' +
      'segment5.ts\n' +
      '#EXT-X-PART:URI="segment6-part1.ts",DURATION=1\n' +
      '#EXT-X-PART:URI="segment6-part2.ts",DURATION=1\n' +
      'segment6.ts\n' +
      '#EXT-X-PART:URI="segment7-part1.ts",DURATION=1\n' +
      '#EXT-X-PART:URI="segment7-part2.ts",DURATION=1\n' +
      'segment7.ts\n' +
      '#EXT-X-PART:URI="segment8-part1.ts",DURATION=1\n'
    );

    this.loader.trigger('mediaupdatetimeout');

    assert.equal(this.requests[0].uri, 'http://example.com/media.m3u8?_HLS_msn=8');
  });

  QUnit.test('Adds only _HLS_msn= when we have segment info', function(assert) {
    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-PART-INF:PART-TARGET=1\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n' +
      '#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES\n' +
      '#EXTINF:2\n' +
      'segment0.ts\n' +
      '#EXTINF:2\n' +
      'segment1.ts\n' +
      '#EXTINF:2\n' +
      'segment2.ts\n' +
      '#EXTINF:2\n' +
      'segment3.ts\n' +
      '#EXTINF:2\n' +
      'segment4.ts\n' +
      '#EXTINF:2\n' +
      'segment5.ts\n' +
      '#EXT-X-PART:URI="segment6-part1.ts",DURATION=1\n' +
      '#EXT-X-PART:URI="segment6-part2.ts",DURATION=1\n' +
      'segment6.ts\n' +
      '#EXT-X-PART:URI="segment7-part1.ts",DURATION=1\n' +
      '#EXT-X-PART:URI="segment7-part2.ts",DURATION=1\n' +
      'segment7.ts\n' +
      '#EXT-X-PART:URI="segment8-part1.ts",DURATION=1\n' +
      '#EXT-X-PART:URI="segment8-part2.ts",DURATION=1\n' +
      'segment8.ts\n'
    );

    this.loader.trigger('mediaupdatetimeout');

    assert.equal(this.requests[0].uri, 'http://example.com/media.m3u8?_HLS_msn=9');
  });

  QUnit.test('can add all query directives', function(assert) {
    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-PART-INF:PART-TARGET=1\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n' +
      '#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,CAN-SKIP-UNTIL=3\n' +
      '#EXTINF:2\n' +
      'segment0.ts\n' +
      '#EXTINF:2\n' +
      'segment1.ts\n' +
      '#EXTINF:2\n' +
      'segment2.ts\n' +
      '#EXTINF:2\n' +
      'segment3.ts\n' +
      '#EXTINF:2\n' +
      'segment4.ts\n' +
      '#EXTINF:2\n' +
      'segment5.ts\n' +
      '#EXT-X-PART:URI="segment6-part1.ts",DURATION=1\n' +
      '#EXT-X-PART:URI="segment6-part2.ts",DURATION=1\n' +
      'segment6.ts\n' +
      '#EXT-X-PART:URI="segment7-part1.ts",DURATION=1\n' +
      '#EXT-X-PART:URI="segment7-part2.ts",DURATION=1\n' +
      'segment7.ts\n' +
      '#EXT-X-PART:URI="segment8-part1.ts",DURATION=1\n' +
      '#EXT-X-PRELOAD-HINT:TYPE="PART",URI="segment8-part2.ts"\n'
    );

    this.loader.trigger('mediaupdatetimeout');

    assert.equal(this.requests[0].uri, 'http://example.com/media.m3u8?_HLS_skip=YES&_HLS_msn=8&_HLS_part=1');
  });

  QUnit.test('works with existing query directives', function(assert) {
    // clear existing requests
    this.requests.length = 0;

    this.loader.dispose();
    this.loader = new PlaylistLoader('http://example.com/media.m3u8?foo=test', this.fakeVhs);

    this.loader.load();

    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-PART-INF:PART-TARGET=1\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n' +
      '#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,CAN-SKIP-UNTIL=3\n' +
      '#EXTINF:2\n' +
      'segment0.ts\n' +
      '#EXTINF:2\n' +
      'segment1.ts\n' +
      '#EXTINF:2\n' +
      'segment2.ts\n' +
      '#EXTINF:2\n' +
      'segment3.ts\n' +
      '#EXTINF:2\n' +
      'segment4.ts\n' +
      '#EXTINF:2\n' +
      'segment5.ts\n' +
      '#EXT-X-PART:URI="segment6-part1.ts",DURATION=1\n' +
      '#EXT-X-PART:URI="segment6-part2.ts",DURATION=1\n' +
      'segment6.ts\n' +
      '#EXT-X-PART:URI="segment7-part1.ts",DURATION=1\n' +
      '#EXT-X-PART:URI="segment7-part2.ts",DURATION=1\n' +
      'segment7.ts\n' +
      '#EXT-X-PART:URI="segment8-part1.ts",DURATION=1\n' +
      '#EXT-X-PRELOAD-HINT:TYPE="PART",URI="segment8-part2.ts"\n'
    );

    this.loader.trigger('mediaupdatetimeout');

    assert.equal(this.requests[0].uri, 'http://example.com/media.m3u8?foo=test&_HLS_skip=YES&_HLS_msn=8&_HLS_part=1');
  });

  QUnit.module('DateRanges', {
    beforeEach() {
      this.fakeVhs = {
        xhr: xhrFactory()
      };
      this.loader = new PlaylistLoader('http://example.com/media.m3u8', this.fakeVhs, {addDateRangesToTextTrack: () => {}});

      this.loader.load();
    },
    afterEach() {
      this.loader.dispose();
    }
  });

  QUnit.test('addDateRangesToTextTrack called on loadedplaylist', function(assert) {
    this.loader.media = () => {
      return {
        segments: [{
          programDateTime: 2000,
          duration: 1
        }],
        dateRanges: [{
          startDate: new Date(2500),
          endDate: new Date(3000),
          plannedDuration: 40,
          id: 'testId'
        }]
      };
    };
    const addDateRangesToTextTrackSpy = sinon.spy(this.loader, 'addDateRangesToTextTrack_');

    this.loader.trigger('loadedplaylist');
    assert.strictEqual(addDateRangesToTextTrackSpy.callCount, 1);
  });
});

QUnit.module('Pathway Cloning', {
  before() {
    this.fakeVhs = {
      xhr: xhrFactory()
    };
    this.loader = new PlaylistLoader('http://example.com/media.m3u8', this.fakeVhs);

    this.loader.load();

    // Setup video playlists and media groups/playlists

    const videoUri = '//test.com/playlist.m3u8';
    const videoId = `0-${videoUri}`;
    const videoPlaylist = {
      attributes: {
        ['PATHWAY-ID']: 'cdn-a',
        AUDIO: 'cdn-a',
        BANDWIDTH: 9,
        CODECS: 'avc1.640028,mp4a.40.2'
      },
      id: videoId,
      uri: videoUri,
      resolvedUri: 'https://test.com/playlist.m3u8',
      segments: []
    };

    const audioUri = 'https://test.com/audio_128kbps/playlist.m3u8';
    const audioId = '0-placeholder-uri-AUDIO-cdn-a-English';
    const audioPlaylist = {
      attributes: {},
      autoselect: true,
      default: false,
      id: audioId,
      language: 'en',
      uri: audioUri,
      resolvedUri: audioUri
    };

    this.loader.main = {
      mediaGroups: {
        AUDIO: {
          'cdn-a': {
            English: {
              autoselect: true,
              default: false,
              language: 'en',
              resolvedUri: audioUri,
              uri: audioUri,
              playlists: [audioPlaylist]
            }
          },
          // Ensures we hit the code where we skip this.
          'cdn-other': {}
        }
      },
      playlists: [videoPlaylist]
    };

    // link all playlists by ID and URI
    this.loader.main.playlists[videoId] = videoPlaylist;
    this.loader.main.playlists[videoUri] = videoPlaylist;
    this.loader.main.playlists[audioId] = audioPlaylist;
    this.loader.main.playlists[audioUri] = audioPlaylist;
  },
  after() {
    this.loader.dispose();
  }
});

QUnit.test('add a new pathway clone', function(assert) {
  // The cloned pathway already exists due to the previous test.

  const clone = {
    ID: 'cdn-b',
    ['BASE-ID']: 'cdn-a',
    ['URI-REPLACEMENT']: {
      HOST: 'www.cdn-b.com',
      PARAMS: {
        test: 123
      }
    }
  };

  const videoUri = 'https://www.cdn-b.com/playlist.m3u8?test=123';
  const videoId = `cdn-b-${videoUri}`;
  const expectedVideoPlaylist = {
    attributes: {
      AUDIO: 'cdn-b',
      BANDWIDTH: 9,
      CODECS: 'avc1.640028,mp4a.40.2',
      ['PATHWAY-ID']: 'cdn-b'
    },
    id: videoId,
    resolvedUri: videoUri,
    segments: [],
    uri: videoUri
  };

  const audioUri = 'https://www.cdn-b.com/audio_128kbps/playlist.m3u8?test=123';
  const audioId = 'cdn-b-placeholder-uri-AUDIO-cdn-b-English';
  const expectedAudioPlaylist = {
    attributes: {},
    autoselect: true,
    default: false,
    id: audioId,
    language: 'en',
    resolvedUri: audioUri,
    uri: audioUri
  };

  const expectedMediaGroup = {
    English: {
      autoselect: true,
      default: false,
      language: 'en',
      playlists: [expectedAudioPlaylist],
      resolvedUri: audioUri,
      uri: audioUri
    }
  };

  this.loader.addClonePathway(clone, this.loader.main.playlists[0]);

  assert.deepEqual(this.loader.main.playlists[1], expectedVideoPlaylist);
  assert.deepEqual(this.loader.main.playlists[videoUri], expectedVideoPlaylist);
  assert.deepEqual(this.loader.main.playlists[videoId], expectedVideoPlaylist);

  assert.deepEqual(this.loader.main.playlists[audioId], expectedAudioPlaylist);
  assert.deepEqual(this.loader.main.playlists[audioUri], expectedAudioPlaylist);
  assert.deepEqual(this.loader.main.mediaGroups.AUDIO['cdn-b'], expectedMediaGroup);
});

QUnit.test('update the pathway clone', function(assert) {
  // The cloned pathway already exists due to the previous test.

  // The old clone to be deleted.
  const clone = {
    ID: 'cdn-b',
    ['BASE-ID']: 'cdn-a',
    ['URI-REPLACEMENT']: {
      HOST: 'www.newurl.com',
      PARAMS: {
        test: 'updatedValue'
      }
    }
  };

  // These values have been updated.
  const videoUri = 'https://www.newurl.com/playlist.m3u8?test=updatedValue';
  const videoId = `cdn-b-${videoUri}`;
  const expectedVideoPlaylist = {
    attributes: {
      AUDIO: 'cdn-b',
      BANDWIDTH: 9,
      CODECS: 'avc1.640028,mp4a.40.2',
      ['PATHWAY-ID']: 'cdn-b'
    },
    id: videoId,
    resolvedUri: videoUri,
    segments: [],
    uri: videoUri
  };

  // These values have been updated.
  const audioUri = 'https://www.newurl.com/audio_128kbps/playlist.m3u8?test=updatedValue';
  const audioId = 'cdn-b-placeholder-uri-AUDIO-cdn-b-English';
  const expectedAudioPlaylist = {
    attributes: {},
    autoselect: true,
    default: false,
    id: audioId,
    language: 'en',
    resolvedUri: audioUri,
    uri: audioUri
  };

  const expectedMediaGroup = {
    English: {
      autoselect: true,
      default: false,
      language: 'en',
      playlists: [expectedAudioPlaylist],
      resolvedUri: audioUri,
      uri: audioUri
    }
  };

  // set the flag to true to ensure we update.
  this.loader.updateOrDeleteClone(clone, true);

  assert.deepEqual(this.loader.main.playlists[1], expectedVideoPlaylist);
  assert.deepEqual(this.loader.main.playlists[videoUri], expectedVideoPlaylist);
  assert.deepEqual(this.loader.main.playlists[videoId], expectedVideoPlaylist);

  assert.deepEqual(this.loader.main.playlists[audioId], expectedAudioPlaylist);
  assert.deepEqual(this.loader.main.playlists[audioUri], expectedAudioPlaylist);
  assert.deepEqual(this.loader.main.mediaGroups.AUDIO['cdn-b'], expectedMediaGroup);
});

QUnit.test('delete the pathway clone', function(assert) {
  // The old clone to be deleted.
  const clone = {
    ID: 'cdn-b',
    ['BASE-ID']: 'cdn-a',
    ['URI-REPLACEMENT']: {
      HOST: 'www.cdn-b.com',
      PARAMS: {
        test: 123
      }
    }
  };

  // the playlist exists before the deletion.
  assert.deepEqual(this.loader.main.playlists[1].attributes['PATHWAY-ID'], 'cdn-b');

  const videoUri = 'https://www.cdn-b.com/playlist.m3u8?test=123';
  const videoId = `cdn-b-${videoUri}`;
  const audioUri = 'https://www.cdn-b.com/audio_128kbps/playlist.m3u8?test=123';
  const audioId = 'cdn-b-placeholder-uri-AUDIO-cdn-b-English';

  // set the flag to false to ensure we delete.
  this.loader.updateOrDeleteClone(clone, false);

  assert.deepEqual(this.loader.main.playlists[1], undefined);
  assert.deepEqual(this.loader.main.playlists[videoUri], undefined);
  assert.deepEqual(this.loader.main.playlists[videoId], undefined);

  assert.deepEqual(this.loader.main.playlists[audioId], undefined);
  assert.deepEqual(this.loader.main.playlists[audioUri], undefined);
  assert.deepEqual(this.loader.main.mediaGroups.AUDIO['cdn-b'], undefined);
});
