import QUnit from 'qunit';
import {
  setupMediaPlaylists,
  resolveMediaGroupUris
} from '../src/manifest';
import {
  useFakeEnvironment,
  urlTo
} from './test-helpers';

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
    uri: 'uri-0',
    id: '0-uri-0'
  };
  const expectedPlaylist1 = {
    attributes: {},
    resolvedUri: urlTo('uri-1'),
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
