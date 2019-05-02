import QUnit from 'qunit';
import sinon from 'sinon';
import { default as DashPlaylistLoader, updateMaster } from '../src/dash-playlist-loader';
import xhrFactory from '../src/xhr';
import {
  useFakeEnvironment,
  standardXHRResponse,
  urlTo
} from './test-helpers';
// needed for plugin registration
import '../src/videojs-http-streaming';
import testDataManifests from './test-manifests.js';

QUnit.module('DASH Playlist Loader: unit', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.clock = this.env.clock;
    this.requests = this.env.requests;
    this.fakeHls = {
      xhr: xhrFactory()
    };
    this.standardXHRResponse = (request, data) => {
      standardXHRResponse(request, data);

      // Because SegmentLoader#fillBuffer_ is now scheduled asynchronously
      // we have to use clock.tick to get the expected side effects of
      // SegmentLoader#handleUpdateEnd_
      this.clock.tick(1);
    };
  },
  afterEach() {
    this.env.restore();
  }
});

QUnit.test('updateMaster: returns falsy when there are no changes', function(assert) {
  const master = {
    playlists: {
      length: 1,
      0: {
        uri: '0',
        segments: []
      }
    },
    mediaGroups: {
      AUDIO: {
        audio: {
          'audio-main': {
            attributes: {
              NAME: 'audio'
            },
            playlists: {
              length: 1,
              0: {
                playlists: {}
              }
            }
          }
        }
      },
      SUBTITLES: {}
    },
    duration: 0,
    minimumUpdatePeriod: 0
  };

  assert.deepEqual(updateMaster(master, master), null);
});

QUnit.test('updateMaster: updates playlists', function(assert) {
  const master = {
    playlists: {
      length: 1,
      0: { uri: '0' }
    },
    mediaGroups: {
      AUDIO: {},
      SUBTITLES: {}
    },
    duration: 0,
    minimumUpdatePeriod: 0
  };

  const update = {
    playlists: {
      length: 1,
      0: {
        uri: '0',
        segments: []
      }
    },
    mediaGroups: {
      AUDIO: {},
      SUBTITLES: {}
    },
    duration: 0,
    minimumUpdatePeriod: 0
  };

  assert.deepEqual(
    updateMaster(master, update),
    {
      playlists: {
        length: 1,
        0: {
          uri: '0',
          segments: []
        }
      },
      mediaGroups: {
        AUDIO: {},
        SUBTITLES: {}
      },
      duration: 0,
      minimumUpdatePeriod: 0
    }
  );
});

QUnit.test('updateMaster: updates mediaGroups', function(assert) {
  const master = {
    playlists: {
      length: 1,
      0: {
        uri: '0',
        segments: []
      }
    },
    mediaGroups: {
      AUDIO: {
        audio: {
          'audio-main': {
            playlists: [{
              uri: '0',
              test: 'old text',
              segments: []
            }]
          }
        }
      },
      SUBTITLES: {}
    },
    duration: 0,
    minimumUpdatePeriod: 0
  };

  const update = {
    playlists: {
      length: 1,
      0: {
        uri: '0',
        segments: []
      }
    },
    mediaGroups: {
      AUDIO: {
        audio: {
          'audio-main': {
            playlists: [{
              uri: '0',
              resolvedUri: '0',
              test: 'new text',
              segments: [{
                uri: 's'
              }]
            }]
          }
        }
      },
      SUBTITLES: {}
    },
    duration: 0,
    minimumUpdatePeriod: 0
  };

  assert.ok(
    updateMaster(master, update),
    'the mediaGroups were updated'
  );
});

QUnit.test('updateMaster: updates playlists and mediaGroups', function(assert) {
  const master = {
    duration: 10,
    minimumUpdatePeriod: 0,
    mediaGroups: {
      AUDIO: {
        audio: {
          main: {
            playlists: [{
              mediaSequence: 0,
              attributes: {},
              uri: 'audio-0-uri',
              resolvedUri: urlTo('audio-0-uri'),
              segments: [{
                duration: 10,
                uri: 'audio-segment-0-uri',
                resolvedUri: urlTo('audio-segment-0-uri')
              }]
            }]
          }
        }
      }
    },
    playlists: [{
      mediaSequence: 0,
      attributes: {
        BANDWIDTH: 9
      },
      uri: 'playlist-0-uri',
      resolvedUri: urlTo('playlist-0-uri'),
      segments: [{
        duration: 10,
        uri: 'segment-0-uri',
        resolvedUri: urlTo('segment-0-uri')
      }]
    }]
  };
  const update = {
    duration: 20,
    minimumUpdatePeriod: 0,
    mediaGroups: {
      AUDIO: {
        audio: {
          main: {
            playlists: [{
              mediaSequence: 1,
              attributes: {},
              uri: 'audio-0-uri',
              resolvedUri: urlTo('audio-0-uri'),
              segments: [{
                duration: 10,
                uri: 'audio-segment-0-uri',
                resolvedUri: urlTo('audio-segment-0-uri')
              }]
            }]
          }
        }
      }
    },
    playlists: [{
      mediaSequence: 1,
      attributes: {
        BANDWIDTH: 9
      },
      uri: 'playlist-0-uri',
      resolvedUri: urlTo('playlist-0-uri'),
      segments: [{
        duration: 10,
        uri: 'segment-0-uri',
        resolvedUri: urlTo('segment-0-uri')
      }]
    }]
  };

  master.playlists['playlist-0-uri'] = master.playlists[0];
  master.playlists['audio-0-uri'] = master.mediaGroups.AUDIO.audio.main.playlists[0];

  assert.deepEqual(
    updateMaster(master, update),
    {
      duration: 20,
      minimumUpdatePeriod: 0,
      mediaGroups: {
        AUDIO: {
          audio: {
            main: {
              playlists: [{
                mediaSequence: 1,
                attributes: {},
                uri: 'audio-0-uri',
                resolvedUri: urlTo('audio-0-uri'),
                segments: [{
                  duration: 10,
                  uri: 'audio-segment-0-uri',
                  resolvedUri: urlTo('audio-segment-0-uri')
                }]
              }]
            }
          }
        }
      },
      playlists: [{
        mediaSequence: 1,
        attributes: {
          BANDWIDTH: 9
        },
        uri: 'playlist-0-uri',
        resolvedUri: urlTo('playlist-0-uri'),
        segments: [{
          duration: 10,
          uri: 'segment-0-uri',
          resolvedUri: urlTo('segment-0-uri')
        }]
      }]
    },
    'updates playlists and media groups');
});

QUnit.test('constructor throws if the playlist url is empty or undefined', function(assert) {
  assert.throws(function() {
    DashPlaylistLoader();
  }, 'requires an argument');
  assert.throws(function() {
    DashPlaylistLoader('');
  }, 'does not accept the empty string');
});

QUnit.test('constructor sets srcUrl and other properties', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);

  assert.strictEqual(loader.state, 'HAVE_NOTHING', 'correct state');
  assert.deepEqual(loader.loadedPlaylists_, {}, 'correct loadedPlaylist state');
  assert.notOk(loader.masterPlaylistLoader_, 'should be no masterPlaylistLoader');
  assert.notOk(loader.childPlaylist_, 'should be no childPlaylist_');
  assert.strictEqual(loader.srcUrl, 'dash.mpd', 'set the srcUrl');

  const childLoader = new DashPlaylistLoader({}, this.fakeHls, false, loader);

  assert.strictEqual(childLoader.state, 'HAVE_NOTHING', 'correct state');
  assert.deepEqual(childLoader.loadedPlaylists_, {}, 'correct loadedPlaylist state');
  assert.ok(childLoader.masterPlaylistLoader_, 'should be a masterPlaylistLoader');
  assert.deepEqual(childLoader.childPlaylist_, {},
    'should be a childPlaylist_');
  assert.notOk(childLoader.srcUrl, 'should be no srcUrl');
});

QUnit.test('load: will start an unstarted loader', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);
  const origHasPendingRequest = loader.hasPendingRequest;
  let loadedPlaylists = 0;
  let loadedMetadata = 0;

  loader.on('loadedplaylist', () => {
    loadedPlaylists++;
  });
  loader.on('loadedmetadata', () => {
    loadedMetadata++;
  });
  assert.notOk(loader.started, 'begins unstarted');

  loader.load();
  assert.strictEqual(loader.started, true, 'load should start the loader');
  assert.strictEqual(this.requests.length, 1, 'should request the manifest');
  assert.strictEqual(loader.state, 'HAVE_NOTHING', 'state has not changed');

  // pretend there's a pending media request so
  // media isn't selected automatically
  loader.hasPendingRequest = () => true;
  this.standardXHRResponse(this.requests.shift());
  assert.strictEqual(loader.state, 'HAVE_MASTER', 'state is updated');
  assert.strictEqual(loadedPlaylists, 1, 'one loadedplaylist');
  assert.strictEqual(loadedMetadata, 0, 'no loadedmetadata');
  loader.hasPendingRequest = origHasPendingRequest;

  loader.load();
  assert.strictEqual(loader.started, true, 'still loaded');
  assert.strictEqual(loadedPlaylists, 2, 'two loadedplaylists');
  assert.strictEqual(loadedMetadata, 0, 'no loadedmetadata');
  assert.strictEqual(this.requests.length, 0, 'no request made');
  assert.strictEqual(loader.state, 'HAVE_MASTER', 'no state change');

  loader.media(loader.master.playlists[0]);
  this.clock.tick(1);
  assert.strictEqual(loadedPlaylists, 3, '3 loadedplaylists');
  assert.strictEqual(loadedMetadata, 1, 'one loadedmetadata');

  loader.load(true);
  assert.strictEqual(loadedPlaylists, 3, 'does not fire 4th loadedplaylist');
  assert.strictEqual(loadedMetadata, 1, 'does not fire 2nd loadedmetadata');

  const loadSpy = sinon.spy(loader, 'load');

  // half of one target duration = 1s
  this.clock.tick(1000);
  assert.strictEqual(loadSpy.callCount, 1, 'load was called again');
});

QUnit.test('load: will not request manifest when started', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);
  const origHasPendingRequest = loader.hasPendingRequest;
  let loadedPlaylists = 0;
  let loadedMetadata = 0;

  loader.on('loadedplaylist', () => {
    loadedPlaylists++;
  });
  loader.on('loadedmetadata', () => {
    loadedMetadata++;
  });

  loader.load();
  // pretend there's a pending media request so
  // media isn't selected automatically
  loader.hasPendingRequest = () => true;
  this.standardXHRResponse(this.requests.shift());
  assert.strictEqual(loader.state, 'HAVE_MASTER', 'state is updated');
  assert.strictEqual(loadedPlaylists, 1, 'one loadedplaylist');
  assert.strictEqual(loadedMetadata, 0, 'no loadedmetadata');
  loader.hasPendingRequest = origHasPendingRequest;

  loader.load();
  assert.strictEqual(loader.started, true, 'still loaded');
  assert.strictEqual(loadedPlaylists, 2, 'two loadedplaylists');
  assert.strictEqual(loadedMetadata, 0, 'no loadedmetadata');
  assert.strictEqual(this.requests.length, 0, 'no request made');
  assert.strictEqual(loader.state, 'HAVE_MASTER', 'no state change');
});

QUnit.test('load: will retry if this is the final rendition', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);
  let loadedPlaylists = 0;
  let loadedMetadata = 0;

  loader.on('loadedplaylist', () => {
    loadedPlaylists++;
  });
  loader.on('loadedmetadata', () => {
    loadedMetadata++;
  });
  assert.notOk(loader.started, 'begins unstarted');

  loader.load();
  this.standardXHRResponse(this.requests.shift());
  loader.media(loader.master.playlists[0]);
  this.clock.tick(1);

  assert.strictEqual(loadedPlaylists, 2, 'two loadedplaylists');
  assert.strictEqual(loadedMetadata, 1, 'one loadedmetadata');

  loader.load(true);
  assert.strictEqual(loadedPlaylists, 2, 'does not fire 3rd loadedplaylist');
  assert.strictEqual(loadedMetadata, 1, 'does not fire 2nd loadedmetadata');

  const loadSpy = sinon.spy(loader, 'load');

  // half of one target duration = 1s
  this.clock.tick(1000);
  assert.strictEqual(loadSpy.callCount, 1, 'load was called again');
});

QUnit.test('media: get returns currently active media playlist', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);
  const origHasPendingRequest = loader.hasPendingRequest;

  // setup loader
  loader.load();
  // pretend there's a pending media request so
  // media isn't selected automatically
  loader.hasPendingRequest = () => true;
  this.standardXHRResponse(this.requests.shift());
  assert.strictEqual(loader.state, 'HAVE_MASTER', 'state should be HAVE_MASTER');
  assert.strictEqual(loader.media(), undefined, 'no media set yet');
  loader.hasPendingRequest = origHasPendingRequest;

  loader.media(loader.master.playlists[0]);
  this.clock.tick(1);
  assert.strictEqual(
    loader.media().uri,
    loader.master.playlists[0].uri,
    'set the correct media playlist'
  );
});

QUnit.test('media: does not set media if getter is called', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);
  const origHasPendingRequest = loader.hasPendingRequest;
  let loadedPlaylists = 0;
  let loadedMetadata = 0;

  loader.on(['loadedplaylist', 'loadedmetadata'], (e) => {
    if (e.type === 'loadedplaylist') {
      loadedPlaylists++;
    } else if (e.type === 'loadedmetadata') {
      loadedMetadata++;
    }
  });

  loader.load();
  // pretend there's a pending media request so
  // media isn't selected automatically
  loader.hasPendingRequest = () => true;
  this.standardXHRResponse(this.requests.shift());
  assert.strictEqual(loader.state, 'HAVE_MASTER', 'state should be HAVE_MASTER');
  assert.strictEqual(loadedPlaylists, 1, 'one loadedplaylist');
  assert.strictEqual(loadedMetadata, 0, 'no loadedmetadata');
  loader.hasPendingRequest = origHasPendingRequest;

  loader.media(null);
  assert.strictEqual(loader.state, 'HAVE_MASTER', 'state should stay HAVE_MASTER');
  assert.strictEqual(loadedPlaylists, 1, 'still one loadedplaylist');
  assert.strictEqual(loadedMetadata, 0, 'still no loadedmetadata');

  loader.media(undefined);
  assert.strictEqual(loader.state, 'HAVE_MASTER', 'state should stay HAVE_MASTER');
  assert.strictEqual(loadedPlaylists, 1, 'still one loadedplaylist');
  assert.strictEqual(loadedMetadata, 0, 'still no loadedmetadata');
});

QUnit.test('media: errors if called in incorrect state', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);

  assert.strictEqual(loader.state, 'HAVE_NOTHING', 'state should be HAVE_NOTHING');
  assert.throws(
    () => loader.media('0'),
    /Cannot switch media playlist from HAVE_NOTHING/,
    'should throw an error if media is called without a master playlist'
  );
});

QUnit.test('media: setting media causes an asynchronous action', function(assert) {
  // TODO
});

QUnit.test('media: sets initial media playlist on master loader', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);
  const origHasPendingRequest = loader.hasPendingRequest;
  let loadedPlaylists = 0;
  let loadedMetadata = 0;

  loader.on(['loadedplaylist', 'loadedmetadata'], (e) => {
    if (e.type === 'loadedplaylist') {
      loadedPlaylists++;
    } else if (e.type === 'loadedmetadata') {
      loadedMetadata++;
    }
  });

  // setup loader
  loader.load();
  // pretend there's a pending media request so
  // media isn't selected automatically
  loader.hasPendingRequest = () => true;
  this.standardXHRResponse(this.requests.shift());
  assert.strictEqual(loader.state, 'HAVE_MASTER', 'state should be HAVE_MASTER');
  assert.strictEqual(loadedPlaylists, 1, 'one loadedplaylist');
  assert.strictEqual(loadedMetadata, 0, 'no loadedmetadata');
  loader.hasPendingRequest = origHasPendingRequest;

  // set initial media
  loader.media(loader.master.playlists[0]);
  this.clock.tick(1);
  assert.strictEqual(
    loader.media().uri,
    loader.master.playlists[0].uri,
    'media set correctly'
  );
  assert.deepEqual(
    Object.keys(loader.loadedPlaylists_),
    [loader.master.playlists[0].uri],
    'updated the loadedPlaylists_'
  );
  assert.strictEqual(loader.state, 'HAVE_METADATA', 'state should be HAVE_METADATA');
  assert.strictEqual(loadedPlaylists, 2, 'two loadedplaylists');
  assert.strictEqual(loadedMetadata, 1, 'one loadedmetadata');
});

QUnit.test('media: sets a playlist from a string reference', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);
  const origHasPendingRequest = loader.hasPendingRequest;
  let loadedPlaylists = 0;
  let loadedMetadata = 0;

  loader.on(['loadedplaylist', 'loadedmetadata'], (e) => {
    if (e.type === 'loadedplaylist') {
      loadedPlaylists++;
    } else if (e.type === 'loadedmetadata') {
      loadedMetadata++;
    }
  });

  loader.load();
  // pretend there's a pending media request so
  // media isn't selected automatically
  loader.hasPendingRequest = () => true;
  this.standardXHRResponse(this.requests.shift());
  assert.strictEqual(loader.state, 'HAVE_MASTER', 'state should be HAVE_MASTER');
  assert.strictEqual(loadedPlaylists, 1, 'one loadedplaylist');
  assert.strictEqual(loadedMetadata, 0, 'no loadedmetadata');
  loader.hasPendingRequest = origHasPendingRequest;

  loader.media('0');
  this.clock.tick(1);
  assert.strictEqual(
    loader.media().uri,
    loader.master.playlists[0].uri,
    'set media correctly'
  );
  assert.deepEqual(
    Object.keys(loader.loadedPlaylists_),
    [loader.master.playlists[0].uri],
    'updated the loadedPlaylists_'
  );
  assert.strictEqual(loader.state, 'HAVE_METADATA', 'state should be HAVE_METADATA');
  assert.strictEqual(loadedPlaylists, 2, 'two loadedplaylists');
  assert.strictEqual(loadedMetadata, 1, 'one loadedmetadata');
});

QUnit.test('media: switches to a new playlist from a loaded one', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);
  const origHasPendingRequest = loader.hasPendingRequest;
  let loadedPlaylists = 0;
  let loadedMetadata = 0;
  let mediaChange = 0;
  let mediaChanging = 0;

  loader.on([
    'loadedplaylist',
    'loadedmetadata',
    'mediachange',
    'mediachanging'
  ], (e) => {
    if (e.type === 'loadedplaylist') {
      loadedPlaylists++;
    } else if (e.type === 'loadedmetadata') {
      loadedMetadata++;
    } else if (e.type === 'mediachange') {
      mediaChange++;
    } else if (e.type === 'mediachanging') {
      mediaChanging++;
    }
  });

  loader.load();
  // pretend there's a pending media request so
  // media isn't selected automatically
  loader.hasPendingRequest = () => true;
  this.standardXHRResponse(this.requests.shift());
  assert.strictEqual(loader.state, 'HAVE_MASTER', 'state should be HAVE_MASTER');
  assert.strictEqual(loadedPlaylists, 1, 'one loadedplaylist');
  assert.strictEqual(loadedMetadata, 0, 'no loadedmetadata');
  loader.hasPendingRequest = origHasPendingRequest;

  // initial selection
  loader.media(loader.master.playlists[0]);
  this.clock.tick(1);
  assert.strictEqual(loader.state, 'HAVE_METADATA', 'state should be HAVE_METADATA');
  assert.strictEqual(loadedPlaylists, 2, 'two loadedplaylists');
  assert.strictEqual(loadedMetadata, 1, 'one loadedmetadata');
  assert.strictEqual(mediaChange, 0, 'no mediachanges');
  assert.strictEqual(mediaChanging, 0, 'no mediachangings');

  // different selection
  loader.media(loader.master.playlists[1]);
  this.clock.tick(1);
  assert.strictEqual(
    loader.media().uri,
    loader.master.playlists[1].uri,
    'media changed successfully'
  );
  assert.deepEqual(
    Object.keys(loader.loadedPlaylists_),
    [
      loader.master.playlists[0].uri,
      loader.master.playlists[1].uri
    ],
    'updated loadedPlaylists_'
  );
  assert.strictEqual(loader.state, 'HAVE_METADATA', 'state should be HAVE_METADATA');
  assert.strictEqual(loadedPlaylists, 3, '3 loadedplaylists');
  assert.strictEqual(loadedMetadata, 1, 'one loadedmetadata');
  assert.strictEqual(mediaChange, 1, 'one mediachanges');
  assert.strictEqual(mediaChanging, 1, 'one mediachangings');
});

QUnit.test('media: switches to a previously loaded playlist immediately', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);
  const origHasPendingRequest = loader.hasPendingRequest;
  let loadedPlaylists = 0;
  let loadedMetadata = 0;
  let mediaChange = 0;
  let mediaChanging = 0;

  loader.on([
    'loadedplaylist',
    'loadedmetadata',
    'mediachange',
    'mediachanging'
  ], (e) => {
    if (e.type === 'loadedplaylist') {
      loadedPlaylists++;
    } else if (e.type === 'loadedmetadata') {
      loadedMetadata++;
    } else if (e.type === 'mediachange') {
      mediaChange++;
    } else if (e.type === 'mediachanging') {
      mediaChanging++;
    }
  });

  loader.load();
  // pretend there's a pending media request so
  // media isn't selected automatically
  loader.hasPendingRequest = () => true;
  this.standardXHRResponse(this.requests.shift());
  assert.strictEqual(loader.state, 'HAVE_MASTER', 'state should be HAVE_MASTER');
  assert.strictEqual(loadedPlaylists, 1, 'one loadedplaylist');
  assert.strictEqual(loadedMetadata, 0, 'no loadedmetadata');
  loader.hasPendingRequest = origHasPendingRequest;

  // initial selection
  loader.media(loader.master.playlists[0]);
  this.clock.tick(1);
  assert.strictEqual(loader.state, 'HAVE_METADATA', 'state should be HAVE_METADATA');
  assert.strictEqual(loadedPlaylists, 2, 'two loadedplaylists');
  assert.strictEqual(loadedMetadata, 1, 'one loadedmetadata');
  assert.strictEqual(mediaChange, 0, 'no mediachanges');
  assert.strictEqual(mediaChanging, 0, 'no mediachangings');

  // different selection
  loader.media(loader.master.playlists[1]);
  this.clock.tick(1);
  assert.strictEqual(
    loader.media().uri,
    loader.master.playlists[1].uri,
    'switched to new playlist'
  );

  // previous selection
  loader.media(loader.master.playlists[0]);
  // no waiting for async action
  assert.strictEqual(
    loader.media().uri,
    loader.master.playlists[0].uri,
    'correct media set'
  );
  assert.deepEqual(
    Object.keys(loader.loadedPlaylists_),
    [
      loader.master.playlists[0].uri,
      loader.master.playlists[1].uri
    ],
    'loadedPlaylists_ only updated for new playlists'
  );
  assert.strictEqual(loader.state, 'HAVE_METADATA', 'state should be HAVE_METADATA');
  assert.strictEqual(loadedPlaylists, 3, '3 loadedplaylists');
  assert.strictEqual(loadedMetadata, 1,
    'still one loadedmetadata since this is a loadedPlaylist');
  assert.strictEqual(mediaChange, 2, 'two mediachanges');
  assert.strictEqual(mediaChanging, 2, 'two mediachangings');
});

QUnit.test('media: does not switch to same playlist', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);
  const origHasPendingRequest = loader.hasPendingRequest;
  let loadedPlaylists = 0;
  let loadedMetadata = 0;
  let mediaChange = 0;
  let mediaChanging = 0;

  loader.on([
    'loadedplaylist',
    'loadedmetadata',
    'mediachange',
    'mediachanging'
  ], (e) => {
    if (e.type === 'loadedplaylist') {
      loadedPlaylists++;
    } else if (e.type === 'loadedmetadata') {
      loadedMetadata++;
    } else if (e.type === 'mediachange') {
      mediaChange++;
    } else if (e.type === 'mediachanging') {
      mediaChanging++;
    }
  });

  loader.load();
  // pretend there's a pending media request so
  // media isn't selected automatically
  loader.hasPendingRequest = () => true;
  this.standardXHRResponse(this.requests.shift());
  assert.strictEqual(loader.state, 'HAVE_MASTER', 'state should be HAVE_MASTER');
  assert.strictEqual(loadedPlaylists, 1, 'one loadedplaylist');
  assert.strictEqual(loadedMetadata, 0, 'no loadedmetadata');
  loader.hasPendingRequest = origHasPendingRequest;

  // initial selection
  loader.media(loader.master.playlists[0]);
  this.clock.tick(1);
  assert.strictEqual(loader.state, 'HAVE_METADATA', 'state should be HAVE_METADATA');
  assert.strictEqual(loadedPlaylists, 2, 'two loadedplaylists');
  assert.strictEqual(loadedMetadata, 1, 'one loadedmetadata');
  assert.strictEqual(mediaChange, 0, 'no mediachanges');
  assert.strictEqual(mediaChanging, 0, 'no mediachangings');

  // to same playlist
  loader.media(loader.master.playlists[0]);
  this.clock.tick(1);
  assert.strictEqual(loader.state, 'HAVE_METADATA', 'state should be HAVE_METADATA');
  assert.strictEqual(loadedPlaylists, 2, 'two loadedplaylists');
  assert.strictEqual(loadedMetadata, 1, 'one loadedmetadata');
  assert.strictEqual(mediaChange, 0, 'no mediachanges');
  assert.strictEqual(mediaChanging, 0, 'no mediachangings');
});

QUnit.test('haveMetadata: triggers loadedplaylist if initial selection', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);
  let loadedPlaylists = 0;
  let loadedMetadata = 0;
  let mediaChanges = 0;
  let mediaChangings = 0;

  loader.load();
  this.standardXHRResponse(this.requests.shift());

  loader.on([
    'loadedplaylist',
    'loadedmetadata',
    'mediachange',
    'mediachanging'
  ], (e) => {
    const type = e.type;

    if (type === 'loadedplaylist') {
      loadedPlaylists++;
    } else if (type === 'loadedmetadata') {
      loadedMetadata++;
    } else if (type === 'mediachange') {
      mediaChanges++;
    } else if (type === 'mediachanging') {
      mediaChangings++;
    }
  });

  loader.haveMetadata({
    startingState: 'HAVE_MASTER',
    playlist: loader.master.playlists[0]
  });
  assert.strictEqual(loader.state, 'HAVE_METADATA', 'state should advance');
  assert.strictEqual(
    loader.media().uri,
    loader.master.playlists[0].uri,
    'media set correctly'
  );
  assert.deepEqual(
    Object.keys(loader.loadedPlaylists_),
    [loader.master.playlists[0].uri],
    'updated loadedPlaylists_'
  );
  assert.strictEqual(loadedPlaylists, 1, 'one loadedplaylists');
  assert.strictEqual(loadedMetadata, 1, 'one loadedmetadata');
  assert.strictEqual(mediaChanges, 0, 'no mediachange');
  assert.strictEqual(mediaChangings, 0, 'no mediachanging');
});

QUnit.test('haveMetadata: triggers mediachange if new selection', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);
  const origHasPendingRequest = loader.hasPendingRequest;
  let loadedPlaylists = 0;
  let loadedMetadata = 0;
  let mediaChanges = 0;
  let mediaChangings = 0;

  loader.load();
  // pretend there's a pending media request so
  // media isn't selected automatically
  loader.hasPendingRequest = () => true;
  this.standardXHRResponse(this.requests.shift());
  loader.media(loader.master.playlists[1]);
  this.clock.tick(1);
  loader.hasPendingRequest = origHasPendingRequest;

  loader.on([
    'loadedplaylist',
    'loadedmetadata',
    'mediachange',
    'mediachanging'
  ], (e) => {
    const type = e.type;

    if (type === 'loadedplaylist') {
      loadedPlaylists++;
    } else if (type === 'loadedmetadata') {
      loadedMetadata++;
    } else if (type === 'mediachange') {
      mediaChanges++;
    } else if (type === 'mediachanging') {
      mediaChangings++;
    }
  });

  loader.haveMetadata({
    startingState: 'HAVE_METADATA',
    playlist: loader.master.playlists[0]
  });
  assert.strictEqual(loader.state, 'HAVE_METADATA', 'state should stay the same');
  assert.strictEqual(
    loader.media().uri,
    loader.master.playlists[0].uri,
    'media set correctly'
  );
  assert.deepEqual(
    Object.keys(loader.loadedPlaylists_),
    [
      loader.master.playlists[1].uri,
      loader.master.playlists[0].uri
    ],
    'updated loadedPlaylists_'
  );
  assert.strictEqual(loadedPlaylists, 1, 'one loadedplaylists');
  assert.strictEqual(loadedMetadata, 0, 'no loadedmetadata');
  assert.strictEqual(mediaChanges, 1, 'one mediachange');
  assert.strictEqual(mediaChangings, 0, 'no mediachanging');
});

QUnit.test('parseMasterXml: setup phony playlists and resolves uris', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);

  loader.load();
  this.standardXHRResponse(this.requests.shift());

  const masterPlaylist = loader.parseMasterXml();

  assert.strictEqual(masterPlaylist.uri, loader.srcUrl, 'master playlist uri set correctly');
  assert.strictEqual(masterPlaylist.playlists[0].uri, 'placeholder-uri-0');
  assert.deepEqual(
    masterPlaylist.playlists['placeholder-uri-0'],
    masterPlaylist.playlists[0],
    'phony uri setup correctly for playlist'
  );
  assert.ok(
    Object.keys(masterPlaylist.mediaGroups.AUDIO).length,
    'has audio group'
  );
  assert.ok(masterPlaylist.playlists[0].resolvedUri, 'resolved playlist uris');
});

QUnit.test('refreshMedia: updates master and media playlists for master loader', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);
  let loadedPlaylists = 0;
  let playlistUnchanged = 0;

  loader.load();
  this.standardXHRResponse(this.requests.shift());
  loader.media(loader.master.playlists[0]);
  this.clock.tick(1);

  assert.strictEqual(
    loader.media().uri,
    loader.master.playlists[0].uri,
    'initial media set'
  );
  assert.ok(loader.master, 'master playlist set');

  loader.on('loadedplaylist', () => {
    loadedPlaylists++;
  });
  loader.on('playlistunchanged', () => {
    playlistUnchanged++;
  });

  const oldMaster = loader.master;
  const newMasterXml = testDataManifests['dash-live'];

  loader.masterXml_ = newMasterXml;
  loader.refreshMedia_();

  assert.notEqual(loader.master, oldMaster, 'new master set');
  assert.strictEqual(loadedPlaylists, 1, 'one loadedplaylist');
  assert.strictEqual(playlistUnchanged, 0, 'no playlistunchanged');
});

QUnit.test(
  'refreshMedia: triggers playlistunchanged for master loader' +
  ' if master stays the same', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);
  let loadedPlaylists = 0;
  let playlistUnchanged = 0;

  loader.load();
  this.standardXHRResponse(this.requests.shift());
  loader.media(loader.master.playlists[0]);
  this.clock.tick(1);

  assert.strictEqual(
    loader.media().uri,
    loader.master.playlists[0].uri,
    'initial media set'
  );
  assert.ok(loader.master, 'master playlist set');

  loader.on('loadedplaylist', () => {
    loadedPlaylists++;
  });
  loader.on('playlistunchanged', () => {
    playlistUnchanged++;
  });

  loader.refreshMedia_();
  assert.strictEqual(loadedPlaylists, 1, 'one loadedplaylists');
  assert.strictEqual(playlistUnchanged, 1, 'one playlistunchanged');
});

QUnit.test('refreshMedia: updates master and media playlists for child loader', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);
  let childLoader;
  let loadedPlaylists = 0;
  let playlistUnchanged = 0;

  loader.load();
  this.standardXHRResponse(this.requests.shift());
  loader.media(loader.master.playlists[0]);
  this.clock.tick(1);
  childLoader = new DashPlaylistLoader(loader.master.playlists[0], this.fakeHls, false, loader);
  childLoader.load();
  this.clock.tick(1);

  assert.ok(loader.master, 'master loader has master playlist');
  assert.ok(loader.media_, 'master loader has selected media');
  assert.notOk(childLoader.master, 'childLoader does not have master');
  assert.ok(childLoader.media_, 'childLoader media selected');

  childLoader.on('loadedplaylist', () => {
    loadedPlaylists++;
  });
  childLoader.on('playlistunchanged', () => {
    playlistUnchanged++;
  });

  const oldMaster = loader.master;
  const newMasterXml = testDataManifests['dash-live'];

  loader.masterXml_ = newMasterXml;
  childLoader.refreshMedia_();

  assert.notEqual(loader.master, oldMaster, 'new master set on master loader');
  assert.strictEqual(loadedPlaylists, 1, 'one loadedplaylist');
  assert.strictEqual(playlistUnchanged, 0, 'no playlistunchanged');
});

QUnit.test(
  'refreshMedia: triggers playlistunchanged for child loader' +
  ' if master stays the same', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);
  let childLoader;
  let loadedPlaylists = 0;
  let playlistUnchanged = 0;

  loader.load();
  this.standardXHRResponse(this.requests.shift());
  loader.media(loader.master.playlists[0]);
  this.clock.tick(1);
  childLoader = new DashPlaylistLoader(loader.master.playlists[0], this.fakeHls, false, loader);
  childLoader.load();
  this.clock.tick(1);

  assert.ok(loader.master, 'master loader has master playlist');
  assert.ok(loader.media_, 'master loader has selected media');
  assert.notOk(childLoader.master, 'childLoader does not have master');
  assert.ok(childLoader.media_, 'childLoader media selected');

  childLoader.on('loadedplaylist', () => {
    loadedPlaylists++;
  });
  childLoader.on('playlistunchanged', () => {
    playlistUnchanged++;
  });

  childLoader.refreshMedia_();

  assert.strictEqual(loadedPlaylists, 1, 'one loadedplaylist');
  assert.strictEqual(playlistUnchanged, 1, 'one playlistunchanged');
});

QUnit.module('DASH Playlist Loader: functional', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.clock = this.env.clock;
    this.requests = this.env.requests;
    this.fakeHls = {
      xhr: xhrFactory()
    };
    this.standardXHRResponse = (request, data) => {
      standardXHRResponse(request, data);

      // Because SegmentLoader#fillBuffer_ is now scheduled asynchronously
      // we have to use clock.tick to get the expected side effects of
      // SegmentLoader#handleUpdateEnd_
      this.clock.tick(1);
    };
  },
  afterEach() {
    this.env.restore();
  }
});

QUnit.test('requests the manifest immediately when given a URL', function(assert) {
  let loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);

  loader.load();
  assert.equal(this.requests.length, 1, 'made a request');
  assert.equal(this.requests[0].url, 'dash.mpd', 'requested the manifest');
});

QUnit.test('redirect manifest request when handleManifestRedirects is true', function(assert) {
  let loader = new DashPlaylistLoader('dash.mpd', this.fakeHls, { handleManifestRedirects: true });

  loader.load();

  let modifiedRequest = this.requests.shift();

  modifiedRequest.responseURL = 'http://differenturi.com/test.mpd';

  this.standardXHRResponse(modifiedRequest);

  assert.equal(loader.srcUrl, 'http://differenturi.com/test.mpd', 'url has redirected');
});

QUnit.test('redirect src request when handleManifestRedirects is true', function(assert) {
  let loader = new DashPlaylistLoader('dash.mpd', this.fakeHls, { handleManifestRedirects: true });

  loader.load();

  let modifiedRequest = this.requests.shift();

  modifiedRequest.responseURL = 'http://differenturi.com/test.mpd';
  this.standardXHRResponse(modifiedRequest);

  let childLoader = new DashPlaylistLoader(loader.master.playlists['placeholder-uri-0'], this.fakeHls, false, loader);

  childLoader.load();
  this.clock.tick(1);

  assert.equal(childLoader.media_.resolvedUri, 'http://differenturi.com/placeholder-uri-0', 'url has redirected');
});

QUnit.test('do not redirect src request when handleManifestRedirects is not set', function(assert) {
  let loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);

  loader.load();

  let modifiedRequest = this.requests.shift();

  modifiedRequest.responseURL = 'http://differenturi.com/test.mpd';

  this.standardXHRResponse(modifiedRequest);

  assert.equal(loader.srcUrl, 'dash.mpd', 'url has not redirected');
});

QUnit.test('starts without any metadata', function(assert) {
  let loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);

  assert.notOk(loader.started, 'not started');

  loader.load();
  assert.equal(loader.state, 'HAVE_NOTHING', 'no metadata has loaded yet');
  assert.ok(loader.started, 'started');
});

QUnit.test('moves to HAVE_MASTER after loading a master playlist', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);
  const origHasPendingRequest = loader.hasPendingRequest;

  loader.load();
  assert.strictEqual(loader.state, 'HAVE_NOTHING', 'the state at loadedplaylist correct');

  // pretend there's a pending media request so
  // media isn't selected automatically
  loader.hasPendingRequest = () => true;
  this.standardXHRResponse(this.requests.shift());
  assert.ok(loader.master, 'the master playlist is available');
  assert.strictEqual(loader.state, 'HAVE_MASTER', 'the state at loadedplaylist correct');
  loader.hasPendingRequest = origHasPendingRequest;
});

QUnit.test('moves to HAVE_METADATA after loading a media playlist', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);
  const origHasPendingRequest = loader.hasPendingRequest;
  let loadedPlaylist = 0;
  let loadedMetadata = 0;

  loader.on('loadedplaylist', function() {
    loadedPlaylist++;
  });
  loader.on('loadedmetadata', function() {
    loadedMetadata++;
  });

  loader.load();
  assert.strictEqual(loadedPlaylist, 0, 'loadedplaylist not fired');
  assert.strictEqual(loadedMetadata, 0, 'loadedmetadata not fired');

  // pretend there's a pending media request so
  // media isn't selected automatically
  loader.hasPendingRequest = () => true;
  this.standardXHRResponse(this.requests.shift());
  assert.strictEqual(loadedPlaylist, 1, 'fired loadedplaylist once');
  assert.strictEqual(loadedMetadata, 0, 'fired loadedmetadata once');
  assert.strictEqual(loader.state, 'HAVE_MASTER',
    'the loader state is correct before setting the media');
  assert.ok(loader.master, 'sets the master playlist');
  assert.strictEqual(this.requests.length, 0, 'no further requests are needed');
  loader.hasPendingRequest = origHasPendingRequest;

  // Initial media selection happens here as a result of calling load
  // and receiving the master xml
  loader.media(loader.master.playlists[0]);
  this.clock.tick(1);

  assert.strictEqual(loader.state, 'HAVE_METADATA', 'the loader state is correct');
  assert.strictEqual(loadedPlaylist, 2, 'fired loadedplaylist twice');
  assert.strictEqual(loadedMetadata, 1, 'fired loadedmetadata once');
  assert.ok(loader.media(), 'sets the media playlist');
});

QUnit.test('child loader moves to HAVE_METADATA when initialized with a master playlist', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);
  let loadedPlaylist = 0;
  let loadedMetadata = 0;
  let childLoader;
  let playlist;

  loader.load();
  this.standardXHRResponse(this.requests.shift());
  playlist = loader.master.playlists['placeholder-uri-AUDIO-audio-main'];
  childLoader = new DashPlaylistLoader(playlist, this.fakeHls, false, loader);

  childLoader.on('loadedplaylist', function() {
    loadedPlaylist++;
  });
  childLoader.on('loadedmetadata', function() {
    loadedMetadata++;
  });

  assert.strictEqual(loadedPlaylist, 0, 'childLoader creation does not fire loadedplaylist');
  assert.strictEqual(loadedMetadata, 0, 'childLoader creation should not fire loadedmetadata');
  assert.strictEqual(childLoader.state, 'HAVE_NOTHING', 'childLoader state is HAVE_NOTHING before load');
  assert.strictEqual(childLoader.media(), undefined, 'childLoader media not yet set');

  childLoader.load();
  this.clock.tick(1);

  assert.strictEqual(childLoader.started, true, 'childLoader has started');
  assert.strictEqual(childLoader.state, 'HAVE_METADATA', 'childLoader state is correct');
  assert.strictEqual(loadedPlaylist, 1, 'triggered loadedplaylist');
  assert.strictEqual(loadedMetadata, 1, 'triggered loadedmetadata');
  assert.ok(childLoader.media(), 'sets the childLoader media playlist');
  assert.ok(childLoader.media().attributes, 'sets the childLoader media attributes');
});

QUnit.test('child playlist moves to HAVE_METADATA when initialized with a live master playlist', function(assert) {
  const loader = new DashPlaylistLoader('dash-live.mpd', this.fakeHls);
  let loadedPlaylist = 0;
  let loadedMetadata = 0;
  let childLoader;
  let playlist;

  loader.load();
  this.standardXHRResponse(this.requests.shift());
  playlist = loader.master.playlists['placeholder-uri-AUDIO-audio-main'];
  childLoader = new DashPlaylistLoader(playlist, this.fakeHls, false, loader);

  childLoader.on('loadedplaylist', function() {
    loadedPlaylist++;
  });
  childLoader.on('loadedmetadata', function() {
    loadedMetadata++;
  });

  assert.strictEqual(loadedPlaylist, 0, 'childLoader creation does not fire loadedplaylist');
  assert.strictEqual(loadedMetadata, 0, 'childLoader creation should not fire loadedmetadata');
  assert.strictEqual(childLoader.state, 'HAVE_NOTHING', 'childLoader state is HAVE_NOTHING before load');
  assert.strictEqual(childLoader.media(), undefined, 'childLoader media not yet set');

  childLoader.load();
  this.clock.tick(1);

  assert.strictEqual(childLoader.started, true, 'childLoader has started');
  assert.strictEqual(childLoader.state, 'HAVE_METADATA', 'childLoader state is correct');
  assert.strictEqual(loadedPlaylist, 1, 'triggered loadedplaylist');
  assert.strictEqual(loadedMetadata, 1, 'triggered loadedmetadata');
  assert.ok(childLoader.media(), 'sets the childLoader media playlist');
  assert.ok(childLoader.media().attributes, 'sets the childLoader media attributes');
});

QUnit.test('returns to HAVE_METADATA after refreshing the playlist', function(assert) {
  let loader = new DashPlaylistLoader('dash-live.mpd', this.fakeHls);

  loader.load();
  this.standardXHRResponse(this.requests.shift());

  loader.media(loader.master.playlists[0]);
  this.clock.tick(1);

  // 10s, one target duration
  this.clock.tick(10 * 1000);
  assert.strictEqual(loader.state, 'HAVE_METADATA', 'the state is correct');
});

QUnit.test('triggers an event when the active media changes', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);
  const origHasPendingRequest = loader.hasPendingRequest;
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
  // pretend there's a pending media request so
  // media isn't selected automatically
  loader.hasPendingRequest = () => true;
  this.standardXHRResponse(this.requests.shift());
  assert.strictEqual(loadedPlaylists, 1, 'loadedplaylist triggered');
  assert.strictEqual(loadedMetadata, 0, 'no loadedmetadata');
  loader.hasPendingRequest = origHasPendingRequest;

  loader.media(loader.master.playlists[0]);
  this.clock.tick(1);
  assert.strictEqual(mediaChangings, 0, 'initial selection is not a media changing');
  assert.strictEqual(mediaChanges, 0, 'initial selection is not a media change');
  assert.strictEqual(loadedPlaylists, 2, 'loadedplaylist triggered twice');
  assert.strictEqual(loadedMetadata, 1, 'loadedmetadata triggered');

  // switching to a different playlist
  loader.media(loader.master.playlists[1]);
  this.clock.tick(1);
  assert.strictEqual(mediaChangings, 1, 'mediachanging fires immediately');
  // Note: does not match PlaylistLoader behavior
  assert.strictEqual(mediaChanges, 1, 'mediachange fires immediately');
  assert.strictEqual(loadedPlaylists, 3, 'three loadedplaylists');
  assert.strictEqual(loadedMetadata, 1, 'still one loadedmetadata');

  // switch back to an already loaded playlist
  loader.media(loader.master.playlists[0]);
  this.clock.tick(1);
  assert.strictEqual(mediaChangings, 2, 'mediachanging fires');
  assert.strictEqual(mediaChanges, 2, 'fired a mediachange');
  assert.strictEqual(loadedPlaylists, 3, 'still three loadedplaylists');
  assert.strictEqual(loadedMetadata, 1, 'still one loadedmetadata');

  // trigger a no-op switch
  loader.media(loader.master.playlists[0]);
  this.clock.tick(1);
  assert.strictEqual(mediaChangings, 2, 'mediachanging ignored the no-op');
  assert.strictEqual(mediaChanges, 2, 'ignored a no-op media change');
  assert.strictEqual(loadedPlaylists, 3, 'still three loadedplaylists');
  assert.strictEqual(loadedMetadata, 1, 'still one loadedmetadata');
});

QUnit.test('throws an error when initial manifest request fails', function(assert) {
  let errors = [];
  let loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);

  loader.load();
  this.clock.tick(1);

  loader.on('error', function() {
    errors.push(loader.error);
  });
  this.requests.pop().respond(500);

  assert.equal(errors.length, 1, 'threw an error');
  assert.equal(errors[0].status, 500, 'captured http status');
});

QUnit.test('throws an error if a media switch is initiated too early', function(assert) {
  let loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);

  loader.load();
  this.clock.tick(1);

  assert.throws(
    function() {
      loader.media('1080p');
    },
    new Error('Cannot switch media playlist from HAVE_NOTHING'),
    'threw an error from HAVE_NOTHING');
});

QUnit.test('throws an error if a switch to an unrecognized playlist is requested',
function(assert) {
  let loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);

  loader.load();
  this.standardXHRResponse(this.requests.shift());

  assert.throws(function() {
    loader.media('unrecognized');
  }, new Error('Unknown playlist URI: unrecognized'), 'throws an error');
});

QUnit.test('can switch playlists after the master is downloaded', function(assert) {
  const clock = this.clock;
  let loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);

  loader.load();

  this.standardXHRResponse(this.requests.shift());
  loader.media('placeholder-uri-0');
  clock.tick(1);

  assert.equal(loader.media().uri, 'placeholder-uri-0', 'changed to new playlist');
  loader.media('placeholder-uri-1');
  clock.tick(1);
  assert.equal(loader.media().uri, 'placeholder-uri-1', 'changed to new playlist');
});

QUnit.test('can switch playlists based on object or URI', function(assert) {
  let loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);

  loader.load();
  this.standardXHRResponse(this.requests.shift());

  loader.media('placeholder-uri-0');
  this.clock.tick(1);
  assert.equal(loader.media().uri, 'placeholder-uri-0', 'changed to playlist by uri');

  loader.media('placeholder-uri-1');
  this.clock.tick(1);
  assert.equal(loader.media().uri, 'placeholder-uri-1', 'changed to playlist by uri');

  loader.media(loader.master.playlists[0]);
  this.clock.tick(1);
  assert.equal(loader.media().uri, 'placeholder-uri-0', 'changed to playlist by object');
});

QUnit.test('dispose aborts pending manifest request', function(assert) {
  let loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);

  loader.load();
  this.clock.tick(1);
  assert.equal(this.requests.length, 1, 'one request');
  assert.notOk(this.requests[0].aborted, 'request not aborted');
  assert.ok(this.requests[0].onreadystatechange, 'onreadystatechange handler exists');
  loader.dispose();
  assert.equal(this.requests.length, 1, 'one request');
  assert.ok(this.requests[0].aborted, 'request aborted');
  assert.notOk(this.requests[0].onreadystatechange,
               'onreadystatechange handler does not exist');
});

QUnit.test('errors if requests take longer than 45s', function(assert) {
  let loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);
  let errors = 0;

  loader.load();
  this.clock.tick(1);

  loader.on('error', function() {
    errors++;
  });
  this.clock.tick(45 * 1000);

  assert.strictEqual(errors, 1, 'fired one error');
  assert.strictEqual(loader.error.code, 2, 'fired a network error');
});

QUnit.test('parseMasterXml parses master manifest and sets up uri references',
function(assert) {
  let loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);

  loader.load();

  this.standardXHRResponse(this.requests.shift());

  assert.equal(loader.master.playlists[0].uri, 'placeholder-uri-0',
    'setup phony uri for media playlist');
  assert.strictEqual(loader.master.playlists['placeholder-uri-0'],
    loader.master.playlists[0], 'set reference by uri for easy access');
  assert.equal(loader.master.playlists[1].uri, 'placeholder-uri-1',
    'setup phony uri for media playlist');
  assert.strictEqual(loader.master.playlists['placeholder-uri-1'],
    loader.master.playlists[1], 'set reference by uri for easy access');
  assert.equal(loader.master.mediaGroups.AUDIO.audio.main.playlists[0].uri,
    'placeholder-uri-AUDIO-audio-main', 'setup phony uri for media groups');
  assert.strictEqual(loader.master.playlists['placeholder-uri-AUDIO-audio-main'],
    loader.master.mediaGroups.AUDIO.audio.main.playlists[0],
    'set reference by uri for easy access');
});

QUnit.test('refreshes the xml if there is a minimumUpdatePeriod', function(assert) {
  let loader = new DashPlaylistLoader('dash-live.mpd', this.fakeHls);
  let minimumUpdatePeriods = 0;

  loader.on('minimumUpdatePeriod', () => minimumUpdatePeriods++);

  loader.load();
  assert.equal(minimumUpdatePeriods, 0, 'no refreshs to start');

  this.standardXHRResponse(this.requests.shift());
  assert.equal(minimumUpdatePeriods, 0, 'no refreshs immediately after response');

  this.clock.tick(4 * 1000);

  assert.equal(this.requests.length, 1, 'refreshed manifest');
  assert.equal(this.requests[0].uri, 'dash-live.mpd', 'refreshed manifest');
  assert.equal(minimumUpdatePeriods, 1, 'refreshed manifest');
});

QUnit.test('media playlists "refresh" by re-parsing master xml', function(assert) {
  let loader = new DashPlaylistLoader('dash-live.mpd', this.fakeHls);
  let refreshes = 0;

  loader.on('mediaupdatetimeout', () => refreshes++);

  loader.load();
  this.standardXHRResponse(this.requests.shift());
  loader.media(loader.master.playlists[0]);
  this.clock.tick(1);

  // 1s, half segment target duration, since the playlist didn't change
  this.clock.tick(2 * 500);

  assert.equal(refreshes, 1, 'refreshed playlist after last segment duration');
});

QUnit.test('delays load when on final rendition', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);
  const origHasPendingRequest = loader.hasPendingRequest;
  let loadedplaylistEvents = 0;

  loader.on('loadedplaylist', () => loadedplaylistEvents++);

  // do an initial load to start the loader
  loader.load();
  // pretend there's a pending media request so
  // media isn't selected automatically
  loader.hasPendingRequest = () => true;
  this.standardXHRResponse(this.requests.shift());
  assert.equal(loadedplaylistEvents, 1, 'one loadedplaylist event after first load');
  loader.hasPendingRequest = origHasPendingRequest;

  loader.media(loader.master.playlists[0]);
  this.clock.tick(1);
  assert.equal(loadedplaylistEvents, 2, 'one more loadedplaylist event after media selected');

  loader.load();
  this.clock.tick(1);
  assert.equal(loadedplaylistEvents, 3, 'one more loadedplaylist event after load');

  loader.load(false);
  this.clock.tick(1);
  assert.equal(
    loadedplaylistEvents,
    4,
    'one more loadedplaylist event after load with isFinalRendition false');

  loader.load(true);
  this.clock.tick(1);
  assert.equal(
    loadedplaylistEvents,
    4,
    'no loadedplaylist event after load with isFinalRendition false');

  this.clock.tick(loader.media().targetDuration / 2 * 1000);
  assert.equal(
    loadedplaylistEvents,
    5,
    'one more loadedplaylist event after final rendition delay');
});

// TODO: write a test that simulates a late XHR response
// and why we need async media setting
