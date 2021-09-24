import QUnit from 'qunit';
import videojs from 'video.js';
import PlaylistLoader from '../../src/playlist-loader/playlist-loader.js';
import {useFakeEnvironment, urlTo} from '../test-helpers';
import xhrFactory from '../../src/xhr';

QUnit.module('New Playlist Loader', function(hooks) {
  hooks.beforeEach(function(assert) {
    this.env = useFakeEnvironment(assert);
    this.clock = this.env.clock;
    this.requests = this.env.requests;
    this.fakeVhs = {
      xhr: xhrFactory()
    };
    this.logLines = [];
    this.oldDebugLog = videojs.log.debug;
    videojs.log.debug = (...args) => {
      this.logLines.push(args.join(' '));
    };
  });
  hooks.afterEach(function(assert) {
    this.env.restore();
    videojs.log.debug = this.oldDebugLog;
  });

  QUnit.module('sanity');

  QUnit.test('verify that constructor sets options and event handlers', function(assert) {

    const lastRequestTime = 15;
    const manifest = {foo: 'bar'};
    const manifestString = 'foo: bar';
    const loader = new PlaylistLoader('foo.uri', {
      vhs: this.fakeVhs,
      manifest,
      manifestString,
      lastRequestTime
    });

    assert.equal(loader.uri(), 'foo.uri', 'uri set');
    assert.equal(loader.manifest(), manifest, 'manifest set');
    assert.equal(loader.manifestString(), manifestString, 'manifestString set');
    assert.equal(loader.started(), false, 'not started');
    assert.equal(loader.request(), null, 'no request');
    assert.equal(loader.lastRequestTime(), lastRequestTime, 'last request time saved');
    assert.equal(loader.getMediaRefreshTime_(), null, 'no media refresh time');

    loader.logger_('foo');

    assert.equal(this.logLines[0], 'VHS: PlaylistLoader > foo', 'logger logs as expected');
  });

  QUnit.module('#start()');
  QUnit.test('sets started to true', function(assert) {
    const loader = new PlaylistLoader('foo.uri', {vhs: this.fakeVhs});

    assert.equal(this.requests.length, 0, 'no requests');

    loader.start();

    assert.equal(loader.started(), true, 'is started');
  });

  QUnit.test('does not request until start', function(assert) {
    const loader = new PlaylistLoader('foo.uri', {vhs: this.fakeVhs});

    assert.equal(this.requests.length, 0, 'no requests');

    loader.start();

    assert.equal(this.requests.length, 1, 'one request');
  });

  QUnit.test('requests relative uri', function(assert) {
    const loader = new PlaylistLoader('foo.uri', {vhs: this.fakeVhs});

    assert.equal(this.requests.length, 0, 'no requests');

    loader.start();

    assert.equal(this.requests.length, 1, 'one request');
    assert.equal(this.requests[0].uri, 'foo.uri');
  });

  QUnit.test('requests absolute uri', function(assert) {
    const loader = new PlaylistLoader(urlTo('foo.uri'), {vhs: this.fakeVhs});

    assert.equal(this.requests.length, 0, 'no requests');

    loader.start();
    assert.equal(this.requests.length, 1, 'one request');
    assert.equal(this.requests[0].uri, urlTo('foo.uri'), 'absolute uri');
  });

  QUnit.module('#refreshManifest()');
  QUnit.test('updates uri() with handleManifestRedirects', function(assert) {
    const loader = new PlaylistLoader('foo.uri', {
      vhs: this.fakeVhs,
      handleManifestRedirects: true
    });

    loader.refreshManifest();

    this.requests[0].respond(200, null, 'foo');

    assert.equal(loader.uri(), urlTo('foo.uri'), 'redirected to absolute');
  });

  QUnit.test('sets lastRequestTime to now after request', function(assert) {
    const loader = new PlaylistLoader('foo.uri', {
      vhs: this.fakeVhs
    });

    loader.refreshManifest();

    this.requests[0].respond(200, null, 'foo');

    assert.equal(loader.lastRequestTime(), 0, 'set last request time');
  });

  QUnit.test('sets lastRequestTime to date header after request', function(assert) {
    this.clock.restore();

    const loader = new PlaylistLoader('foo.uri', {
      vhs: this.fakeVhs
    });

    loader.refreshManifest();

    const date = new Date();

    this.requests[0].respond(200, {date: date.toString()}, 'foo');

    assert.equal(loader.lastRequestTime(), Date.parse(date.toString()), 'set last request time');
  });

  QUnit.test('lastRequestTime to date header after request', function(assert) {
    this.clock.restore();

    const loader = new PlaylistLoader('foo.uri', {
      vhs: this.fakeVhs
    });

    loader.refreshManifest();

    const date = new Date();

    this.requests[0].respond(200, {date: date.toString()}, 'foo');

    assert.equal(loader.lastRequestTime(), Date.parse(date.toString()), 'set last request time');
  });

  // TODO: parseManifest
  // TODO: makeRequest
  // TODO: stopRequest
  // TODO: stop
  // TODO: set/clear timeout
  // TODO: dispose
  // TODO: events
});

