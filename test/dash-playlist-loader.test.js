import QUnit from 'qunit';
import { default as DashPlaylistLoader, updateMaster } from '../src/dash-playlist-loader';
import xhrFactory from '../src/xhr';
import {
  useFakeEnvironment,
  standardXHRResponse,
  urlTo
} from './test-helpers';

QUnit.module('DASH Playlist Loader', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.clock = this.env.clock;
    this.requests = this.env.requests;
    this.fakeHls = {
      xhr: xhrFactory()
    };
  },
  afterEach() {
    this.env.restore();
  }
});

QUnit.test('throws if the playlist url is empty or undefined', function(assert) {
  assert.throws(function() {
    DashPlaylistLoader();
  }, 'requires an argument');
  assert.throws(function() {
    DashPlaylistLoader('');
  }, 'does not accept the empty string');
});

QUnit.test('starts with a manifest URL or playlist', function(assert) {
  let loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);

  assert.notOk(loader.started, 'not started');
  loader.load();
  assert.equal(loader.state, 'HAVE_NOTHING', 'no metadata has loaded yet');
  assert.ok(loader.started, 'started');

  loader.master = { playlists: { 'playlist-1': { endList: true } }, mediaGroups: {} };
  loader.parseMasterXml = () => {
    return { playlists: [], mediaGroups: {} };
  };

  let newLoader =
    new DashPlaylistLoader({ uri: 'playlist-1' }, this.fakeHls, false, loader);

  assert.equal(newLoader.state, 'HAVE_METADATA', 'has metadata');
  assert.ok(newLoader.started, 'started');
});

QUnit.test('requests the manifest immediately when given a URL', function(assert) {
  let loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);

  loader.load();
  assert.equal(this.requests.length, 1, 'made a request');
  assert.equal(this.requests[0].url, 'dash.mpd', 'requested the manifest');
});

QUnit.test('moves to HAVE_MASTER and HAVE_METADATA after loading the manifest',
function(assert) {
  let loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);
  let loadedPlaylistStates = [];

  loader.load();

  loader.on('loadedplaylist', function() {
    loadedPlaylistStates.push(loader.state);
  });
  standardXHRResponse(this.requests.shift());
  assert.ok(loader.master, 'the master playlist is available');
  // because DASH only has one manifest, it should go through two loadedplaylists
  // and end with HAVE_METADATA because it already has the first media ready
  assert.equal(loadedPlaylistStates.length, 2, 'triggered two loadedplaylist events');
  assert.equal(loadedPlaylistStates[0], 'HAVE_MASTER', 'got master first');
  assert.equal(loadedPlaylistStates[1], 'HAVE_METADATA', 'got media second');
});

QUnit.test('throws an error when initial manifest request fails', function(assert) {
  let errors = [];
  let loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);

  loader.load();

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
  standardXHRResponse(this.requests.shift());

  assert.throws(function() {
    loader.media('unrecognized');
  }, new Error('Unknown playlist URI: unrecognized'), 'throws an error');
});

QUnit.test('can switch playlists after the master is downloaded', function(assert) {
  let loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);

  loader.load();
  // first media will already be selected since DASH needs no media request, so change on
  // loadedmetadata
  loader.on('loadedmetadata', function() {
    loader.media('placeholder-uri-0');
  });
  standardXHRResponse(this.requests.shift());

  assert.equal(loader.media().uri, 'placeholder-uri-0', 'changed to new playlist');
  loader.media('placeholder-uri-1');
  assert.equal(loader.media().uri, 'placeholder-uri-1', 'changed to new playlist');
});

QUnit.test('can switch playlists based on object or URI', function(assert) {
  let loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);

  loader.load();
  standardXHRResponse(this.requests.shift());

  loader.media('placeholder-uri-0');
  assert.equal(loader.media().uri, 'placeholder-uri-0', 'changed to playlist by uri');
  loader.media('placeholder-uri-1');
  assert.equal(loader.media().uri, 'placeholder-uri-1', 'changed to playlist by uri');

  loader.media(loader.master.playlists[0]);
  assert.equal(loader.media().uri, 'placeholder-uri-0', 'changed to playlist by object');
});

QUnit.test('dispose aborts pending manifest request', function(assert) {
  let loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);

  loader.load();
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

  loader.on('error', function() {
    errors++;
  });
  this.clock.tick(45 * 1000);

  assert.strictEqual(errors, 1, 'fired one error');
  assert.strictEqual(loader.error.code, 2, 'fired a network error');
});

QUnit.test('triggers an event when the active media changes', function(assert) {
  let loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);
  let mediaChanges = 0;
  let mediaChangings = 0;

  loader.load();

  loader.on('mediachange', function() {
    mediaChanges++;
  });
  loader.on('mediachanging', function() {
    mediaChangings++;
  });

  standardXHRResponse(this.requests.shift());
  assert.strictEqual(mediaChangings, 0,
    'initial selection does not fire a mediachanging event');
  assert.strictEqual(mediaChanges, 0,
    'initial selection does not fire a mediachange event');

  loader.media(loader.master.playlists[1]);
  assert.strictEqual(mediaChangings, 1, 'fired a mediachanging event');
  assert.strictEqual(mediaChanges, 1, 'fired a mediachange event');

  loader.media(loader.master.playlists[0]);
  assert.strictEqual(mediaChangings, 2, 'fired a mediachanging event');
  assert.strictEqual(mediaChanges, 2, 'fired a mediachange');
  // no op switch
  loader.media(loader.master.playlists[0]);
  assert.strictEqual(mediaChangings, 2, 'ignored the no-op media change');
  assert.strictEqual(mediaChanges, 2, 'ignored the no-op media change');
});

QUnit.test('parseMasterXml parses master manifest and sets up uri references',
function(assert) {
  let loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);

  loader.load();

  standardXHRResponse(this.requests.shift());

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

QUnit.test('updateMaster updates playlists and mediaGroups', function(assert) {
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

QUnit.test('refreshes the xml if there is a minimumUpdatePeriod', function(assert) {
  let loader = new DashPlaylistLoader('dash-live.mpd', this.fakeHls);
  let minimumUpdatePeriods = 0;

  loader.on('minimumUpdatePeriod', () => minimumUpdatePeriods++);

  loader.load();

  assert.equal(minimumUpdatePeriods, 0, 'no refreshs to start');

  standardXHRResponse(this.requests.shift());

  assert.equal(minimumUpdatePeriods, 0, 'no refreshs immediately after response');

  this.clock.tick(4 * 1000);

  assert.equal(this.requests.length, 1, 'refreshed manifest');
  assert.equal(this.requests[0].uri, 'dash-live.mpd', 'refreshed manifest');
  assert.equal(minimumUpdatePeriods, 1, 'refreshed manifest');
});

QUnit.test('media playlists "refresh" by re-parsing master xml', function(assert) {
  let loader = new DashPlaylistLoader('dash-live.mpd', this.fakeHls);
  const parseMasterXml_ = loader.parseMasterXml.bind(loader);
  let refreshes = 0;

  loader.on('mediaupdatetimeout', () => refreshes++);

  loader.parseMasterXml = () => {
    const result = parseMasterXml_();

    // add segment to segment list for proper refresh delay functionality
    result.playlists[0].segments.push({ duration: 2, uri: 'segment-0' });

    return result;
  };

  loader.load();

  standardXHRResponse(this.requests.shift());

  // 2s, last segment duration
  this.clock.tick(2 * 1000);

  assert.equal(refreshes, 1, 'refreshed playlist after last segment duration');
});

QUnit.test('delays load when on final rendition', function(assert) {
  let loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);
  let loadedplaylistEvents = 0;

  loader.on('loadedplaylist', () => loadedplaylistEvents++);

  // do an initial load to start the loader
  loader.load();
  standardXHRResponse(this.requests.shift());

  assert.equal(loadedplaylistEvents, 2, 'two loadedplaylist events after first load');

  loader.load();

  assert.equal(loadedplaylistEvents, 3, 'one more loadedplaylist event after load');

  loader.load(false);

  assert.equal(
    loadedplaylistEvents,
    4,
    'one more loadedplaylist event after load with isFinalRendition false');

  loader.load(true);

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
