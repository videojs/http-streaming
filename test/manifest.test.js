import QUnit from 'qunit';
import window from 'global/window';
import {
  setupMediaPlaylists,
  resolveMediaGroupUris,
  masterForMedia,
  addPropertiesToMaster,
  parseManifest
} from '../src/manifest';
import {
  useFakeEnvironment,
  urlTo
} from './test-helpers';

QUnit.module('manifest', function() {
  QUnit.module('parseManifest');

  QUnit.test('sets target duration to largest segment duration', function(assert) {
    let manifestString = '#EXTM3U\n' +
      '#EXT-X-VERSION:3\n' +
      '#EXT-X-PLAYLIST-TYPE:VOD\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n';

    for (let i = 0; i < 100; i++) {
      manifestString += `#EXTINF:${i + 1},\n`;
      manifestString += `segment-${i + 1}.ts\n`;
    }

    manifestString += '#EXT-X-ENDLIST\n';

    const manifest = parseManifest({manifestString});

    assert.equal(manifest.targetDuration, 100, 'target duration is 100');
  });

  QUnit.test('sets target duration to 10 without segments', function(assert) {
    let manifestString = '#EXTM3U\n' +
      '#EXT-X-VERSION:3\n' +
      '#EXT-X-PLAYLIST-TYPE:VOD\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n';

    manifestString += '#EXT-X-ENDLIST\n';

    const manifest = parseManifest({manifestString});

    assert.equal(manifest.targetDuration, 10, 'target duration is 10');
  });

  QUnit.module('setupMediaPlaylists', {
    beforeEach(assert) {
      this.env = useFakeEnvironment(assert);
    },
    afterEach() {
      this.env.restore();
    }
  });

  QUnit.test('setupMediaPlaylists does nothing if no playlists', function(assert) {
    const master = {
      playlists: []
    };

    setupMediaPlaylists(master);

    assert.deepEqual(master, {
      playlists: []
    }, 'master remains unchanged');
  });

  QUnit.test('setupMediaPlaylists adds URI keys for each playlist', function(assert) {
    const master = {
      uri: 'master-uri',
      playlists: [{
        uri: 'uri-0'
      }, {
        uri: 'uri-1'
      }]
    };
    const expectedPlaylist0 = {
      attributes: {},
      resolvedUri: urlTo('uri-0'),
      playlistErrors_: 0,
      uri: 'uri-0',
      id: '0-uri-0'
    };
    const expectedPlaylist1 = {
      attributes: {},
      resolvedUri: urlTo('uri-1'),
      playlistErrors_: 0,
      uri: 'uri-1',
      id: '1-uri-1'
    };

    setupMediaPlaylists(master);

    assert.deepEqual(master.playlists[0], expectedPlaylist0, 'retained playlist indices');
    assert.deepEqual(master.playlists[1], expectedPlaylist1, 'retained playlist indices');
    assert.deepEqual(master.playlists['0-uri-0'], expectedPlaylist0, 'added playlist key');
    assert.deepEqual(master.playlists['1-uri-1'], expectedPlaylist1, 'added playlist key');

    assert.equal(this.env.log.warn.calls, 2, 'logged two warnings');
    assert.equal(
      this.env.log.warn.args[0],
      'Invalid playlist STREAM-INF detected. Missing BANDWIDTH attribute.',
      'logged a warning'
    );
    assert.equal(
      this.env.log.warn.args[1],
      'Invalid playlist STREAM-INF detected. Missing BANDWIDTH attribute.',
      'logged a warning'
    );
  });

  QUnit.test('setupMediaPlaylists adds attributes objects if missing', function(assert) {
    const master = {
      uri: 'master-uri',
      playlists: [{
        uri: 'uri-0'
      }, {
        uri: 'uri-1'
      }]
    };

    setupMediaPlaylists(master);

    assert.ok(master.playlists[0].attributes, 'added attributes object');
    assert.ok(master.playlists[1].attributes, 'added attributes object');

    assert.equal(this.env.log.warn.calls, 2, 'logged two warnings');
    assert.equal(
      this.env.log.warn.args[0],
      'Invalid playlist STREAM-INF detected. Missing BANDWIDTH attribute.',
      'logged a warning'
    );
    assert.equal(
      this.env.log.warn.args[1],
      'Invalid playlist STREAM-INF detected. Missing BANDWIDTH attribute.',
      'logged a warning'
    );
  });

  QUnit.test('setupMediaPlaylists resolves playlist URIs', function(assert) {
    const master = {
      uri: 'master-uri',
      playlists: [{
        attributes: { BANDWIDTH: 10 },
        uri: 'uri-0'
      }, {
        attributes: { BANDWIDTH: 100 },
        uri: 'uri-1'
      }]
    };

    setupMediaPlaylists(master);

    assert.equal(master.playlists[0].resolvedUri, urlTo('uri-0'), 'resolves URI');
    assert.equal(master.playlists[1].resolvedUri, urlTo('uri-1'), 'resolves URI');
  });

  QUnit.module('resolveMediaGroupUris');

  QUnit.test('resolveMediaGroupUris does nothing when no media groups', function(assert) {
    const master = {
      uri: 'master-uri',
      playlists: [],
      mediaGroups: []
    };

    resolveMediaGroupUris(master);
    assert.deepEqual(master, {
      uri: 'master-uri',
      playlists: [],
      mediaGroups: []
    }, 'does nothing when no media groups');
  });

  QUnit.test('resolveMediaGroupUris resolves media group URIs', function(assert) {
    const master = {
      uri: 'master-uri',
      playlists: [{
        attributes: { BANDWIDTH: 10 },
        id: 'playlist-0',
        uri: 'playlist-0'
      }],
      mediaGroups: {
        // CLOSED-CAPTIONS will never have a URI
        'CLOSED-CAPTIONS': {
          cc1: {
            English: {}
          }
        },
        'AUDIO': {
          low: {
            // audio doesn't need a URI if it is a label for muxed
            main: {},
            commentary: {
              uri: 'audio-low-commentary-uri'
            }
          },
          high: {
            main: {},
            commentary: {
              uri: 'audio-high-commentary-uri'
            }
          }
        },
        'SUBTITLES': {
          sub1: {
            english: {
              uri: 'subtitles-1-english-uri'
            },
            spanish: {
              uri: 'subtitles-1-spanish-uri'
            }
          },
          sub2: {
            english: {
              uri: 'subtitles-2-english-uri'
            },
            spanish: {
              uri: 'subtitles-2-spanish-uri'
            }
          },
          sub3: {
            english: {
              uri: 'subtitles-3-english-uri'
            },
            spanish: {
              uri: 'subtitles-3-spanish-uri'
            }
          }
        }
      }
    };

    resolveMediaGroupUris(master);

    assert.deepEqual(master, {
      uri: 'master-uri',
      playlists: [{
        attributes: { BANDWIDTH: 10 },
        id: 'playlist-0',
        uri: 'playlist-0'
      }],
      mediaGroups: {
        // CLOSED-CAPTIONS will never have a URI
        'CLOSED-CAPTIONS': {
          cc1: {
            English: {}
          }
        },
        'AUDIO': {
          low: {
            // audio doesn't need a URI if it is a label for muxed
            main: {},
            commentary: {
              uri: 'audio-low-commentary-uri',
              resolvedUri: urlTo('audio-low-commentary-uri')
            }
          },
          high: {
            main: {},
            commentary: {
              uri: 'audio-high-commentary-uri',
              resolvedUri: urlTo('audio-high-commentary-uri')
            }
          }
        },
        'SUBTITLES': {
          sub1: {
            english: {
              uri: 'subtitles-1-english-uri',
              resolvedUri: urlTo('subtitles-1-english-uri')
            },
            spanish: {
              uri: 'subtitles-1-spanish-uri',
              resolvedUri: urlTo('subtitles-1-spanish-uri')
            }
          },
          sub2: {
            english: {
              uri: 'subtitles-2-english-uri',
              resolvedUri: urlTo('subtitles-2-english-uri')
            },
            spanish: {
              uri: 'subtitles-2-spanish-uri',
              resolvedUri: urlTo('subtitles-2-spanish-uri')
            }
          },
          sub3: {
            english: {
              uri: 'subtitles-3-english-uri',
              resolvedUri: urlTo('subtitles-3-english-uri')
            },
            spanish: {
              uri: 'subtitles-3-spanish-uri',
              resolvedUri: urlTo('subtitles-3-spanish-uri')
            }
          }
        }
      }
    }, 'resolved URIs of certain media groups');
  });

  QUnit.module('masterForMedia');

  QUnit.test('creates a skeleton of a master playlist', function(assert) {
    const master = masterForMedia({}, 'some-uri');

    assert.deepEqual(
      master,
      {
        mediaGroups: {
          'AUDIO': {},
          'VIDEO': {},
          'CLOSED-CAPTIONS': {},
          'SUBTITLES': {}
        },
        uri: window.location.href,
        resolvedUri: window.location.href,
        playlists: [{
          uri: 'some-uri',
          id: '0-some-uri',
          resolvedUri: 'some-uri',
          attributes: {}
        }]
      },
      'created master playlist skeleton'
    );
  });

  QUnit.test('adds by ID reference to playlists array', function(assert) {
    const master = masterForMedia({}, 'some-uri');

    assert.equal(
      master.playlists['0-some-uri'],
      master.playlists[0],
      'added by ID reference to playlists array'
    );
  });

  QUnit.module('addPropertiesToMaster');

  QUnit.test('adds uri to master', function(assert) {
    const master = {
      mediaGroups: {},
      playlists: []
    };

    addPropertiesToMaster(master, 'some-uri');

    assert.equal(master.uri, 'some-uri', 'added uri to master');
  });

  QUnit.test('adds placeholder URIs to playlists if necessary', function(assert) {
    const master = {
      mediaGroups: {},
      playlists: [{
        uri: 'playlist-0-uri',
        attributes: {}
      }, {
        attributes: {}
      }]
    };

    addPropertiesToMaster(master, 'some-uri');

    assert.equal(master.playlists[0].uri, 'playlist-0-uri', 'did not overwrite uri');
    assert.equal(master.playlists[1].uri, 'placeholder-uri-1', 'added placeholder uri');
  });

  QUnit.test('adds placeholder URIs to media groups if necessary', function(assert) {
    const master = {
      mediaGroups: {
        AUDIO: {
          default: {
            en: {
              playlists: [{
                uri: 'audio-default-uri'
              }, {}]
            },
            es: {
              playlists: [{}, {}]
            }
          }
        }
      },
      playlists: []
    };

    addPropertiesToMaster(master, 'some-uri');

    const groups = master.mediaGroups.AUDIO.default;

    assert.equal(
      groups.en.playlists[0].uri,
      'audio-default-uri',
      'did not overwrite uri'
    );
    assert.equal(
      groups.en.playlists[1].uri,
      '1-placeholder-uri-AUDIO-default-en',
      'added placeholder uri with index'
    );
    assert.equal(
      groups.es.playlists[0].uri,
      'placeholder-uri-AUDIO-default-es',
      'added placeholder uri without index'
    );
    assert.equal(
      groups.es.playlists[1].uri,
      '1-placeholder-uri-AUDIO-default-es',
      'added placeholder with index uri'
    );

    assert.equal(
      groups.en.playlists[0].id,
      '0-placeholder-uri-AUDIO-default-en',
      'added placeholder id with index'
    );
    assert.equal(
      groups.en.playlists[1].id,
      '1-placeholder-uri-AUDIO-default-en',
      'added placeholder id with index'
    );
    assert.equal(
      groups.es.playlists[0].id,
      '0-placeholder-uri-AUDIO-default-es',
      'added placeholder id with index'
    );
    assert.equal(
      groups.es.playlists[1].id,
      '1-placeholder-uri-AUDIO-default-es',
      'added placeholder with index id'
    );
  });

  QUnit.test('adds resolvedUri for media group URIs', function(assert) {
    const master = {
      mediaGroups: {
        AUDIO: {
          default: {
            en: { uri: 'audio-default-uri' },
            es: {}
          }
        }
      },
      playlists: []
    };

    addPropertiesToMaster(master, 'some-uri');

    assert.equal(
      master.mediaGroups.AUDIO.default.en.resolvedUri,
      urlTo('audio-default-uri'),
      'added resolvedUri'
    );
    assert.notOk(
      master.mediaGroups.AUDIO.default.es.resolvedUri,
      'did not add resolvedUri when no uri'
    );
  });
});
