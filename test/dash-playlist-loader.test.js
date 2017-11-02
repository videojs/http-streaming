import QUnit from 'qunit';
import DashPlaylistLoader from '../src/dash-playlist-loader';
import xhrFactory from '../src/xhr';
import {
  useFakeEnvironment,
  standardXHRResponse
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

  loader = new DashPlaylistLoader({}, this.fakeHls);
  assert.equal(loader.state, 'HAVE_METADATA', 'has metadata');
  assert.ok(loader.started, 'started');
});

QUnit.test('requests the manifest immediately when given a URL', function(assert) {
  let loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);

  loader.load();
  assert.equal(this.requests.length, 1, 'made a request');
  assert.equal(this.requests[0].url, 'dash.mpd', 'requested the manifest');
});

QUnit.test('moves to HAVE_MASTER after loading the manifest', function(assert) {
  let loader = new DashPlaylistLoader('dash.mpd', this.fakeHls);
  let state;

  loader.load();

  loader.on('loadedplaylist', function() {
    state = loader.state;
  });
  standardXHRResponse(this.requests.shift());
  assert.ok(loader.master, 'the master playlist is available');
  assert.equal(state, 'HAVE_MASTER', 'has master');
  assert.equal(loader.state, 'HAVE_METADATA', 'ends up in HAVE_METADATA');
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
  loader.on('loadedplaylist', function() {
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
  assert.strictEqual(mediaChangings, 1, 'initial selection fired a mediachanging event');
  assert.strictEqual(mediaChanges, 1, 'initial selection fired a mediachange event');

  loader.media(loader.master.playlists[1]);
  assert.strictEqual(mediaChangings, 2, 'fired a mediachanging event');
  assert.strictEqual(mediaChanges, 2, 'fired a mediachange event');

  loader.media(loader.master.playlists[0]);
  assert.strictEqual(mediaChangings, 3, 'fired a mediachanging event');
  assert.strictEqual(mediaChanges, 3, 'fired a mediachange');
  // no op switch
  loader.media(loader.master.playlists[0]);
  assert.strictEqual(mediaChangings, 3, 'ignored the no-op media change');
  assert.strictEqual(mediaChanges, 3, 'ignored the no-op media change');
});
