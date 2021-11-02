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
    if (this.loader) {
      this.loader.dispose();
    }
    this.env.restore();
    videojs.log.debug = this.oldDebugLog;
  });

  QUnit.module('sanity');

  QUnit.test('verify that constructor sets options and event handlers', function(assert) {
    const lastRequestTime = 15;
    const manifest = {foo: 'bar'};
    const manifestString = 'foo: bar';

    this.loader = new PlaylistLoader('foo.uri', {
      vhs: this.fakeVhs,
      manifest,
      manifestString,
      lastRequestTime
    });

    assert.equal(this.loader.uri(), 'foo.uri', 'uri set');
    assert.equal(this.loader.manifest(), manifest, 'manifest set');
    assert.equal(this.loader.manifestString_, manifestString, 'manifestString set');
    assert.equal(this.loader.started(), false, 'not started');
    assert.equal(this.loader.request(), null, 'no request');
    assert.equal(this.loader.error(), null, 'no error');
    assert.equal(this.loader.lastRequestTime(), lastRequestTime, 'last request time saved');
    assert.equal(this.loader.getMediaRefreshTime_(), null, 'no media refresh time');

    this.loader.logger_('foo');

    assert.equal(this.logLines[0], 'VHS: PlaylistLoader > foo', 'logger logs as expected');
  });

  QUnit.module('#start()');

  QUnit.test('only starts if not started', function(assert) {
    this.loader = new PlaylistLoader('foo.uri', {
      vhs: this.fakeVhs
    });

    const calls = {};
    const fns = ['refreshManifest_'];

    fns.forEach((name) => {
      calls[name] = 0;

      this.loader[name] = () => {
        calls[name]++;
      };
    });
    assert.false(this.loader.started(), 'not started');

    this.loader.start();
    assert.true(this.loader.started(), 'still started');

    fns.forEach(function(name) {
      assert.equal(calls[name], 1, `called ${name}`);
    });

    this.loader.start();
    fns.forEach(function(name) {
      assert.equal(calls[name], 1, `still 1 call to ${name}`);
    });

    assert.true(this.loader.started(), 'still started');
  });

  QUnit.test('sets started to true', function(assert) {
    this.loader = new PlaylistLoader('foo.uri', {vhs: this.fakeVhs});

    assert.equal(this.requests.length, 0, 'no requests');

    this.loader.start();

    assert.equal(this.loader.started(), true, 'is started');
    assert.equal(this.requests.length, 1, 'added request');
  });

  QUnit.test('does not request until start', function(assert) {
    this.loader = new PlaylistLoader('foo.uri', {vhs: this.fakeVhs});

    assert.equal(this.requests.length, 0, 'no requests');

    this.loader.start();

    assert.equal(this.requests.length, 1, 'one request');
  });

  QUnit.test('requests relative uri', function(assert) {
    this.loader = new PlaylistLoader('foo.uri', {vhs: this.fakeVhs});

    assert.equal(this.requests.length, 0, 'no requests');

    this.loader.start();

    assert.equal(this.requests.length, 1, 'one request');
    assert.equal(this.requests[0].uri, 'foo.uri');
  });

  QUnit.test('requests absolute uri', function(assert) {
    this.loader = new PlaylistLoader(urlTo('foo.uri'), {vhs: this.fakeVhs});

    assert.equal(this.requests.length, 0, 'no requests');

    this.loader.start();
    assert.equal(this.requests.length, 1, 'one request');
    assert.equal(this.requests[0].uri, urlTo('foo.uri'), 'absolute uri');
  });

  QUnit.module('#refreshManifest_()');

  QUnit.test('updates uri() with handleManifestRedirects', function(assert) {
    this.loader = new PlaylistLoader('foo.uri', {
      vhs: this.fakeVhs,
      handleManifestRedirects: true
    });

    this.loader.started_ = true;
    this.loader.refreshManifest_();

    this.requests[0].respond(200, null, 'foo');

    assert.equal(this.loader.uri(), urlTo('foo.uri'), 'redirected to absolute');
  });

  QUnit.test('called by refresh trigger', function(assert) {
    this.loader = new PlaylistLoader('foo.uri', {
      vhs: this.fakeVhs,
      handleManifestRedirects: true
    });

    this.loader.started_ = true;
    this.loader.trigger('refresh');

    this.requests[0].respond(200, null, 'foo');

    assert.equal(this.loader.uri(), urlTo('foo.uri'), 'redirected to absolute');
  });

  QUnit.test('sets lastRequestTime to now after request', function(assert) {
    this.loader = new PlaylistLoader('foo.uri', {
      vhs: this.fakeVhs
    });

    this.loader.started_ = true;
    this.loader.refreshManifest_();

    this.requests[0].respond(200, null, 'foo');

    assert.equal(this.loader.lastRequestTime(), 0, 'set last request time');
  });

  QUnit.test('sets lastRequestTime set to date header after request', function(assert) {
    this.clock.restore();

    this.loader = new PlaylistLoader('foo.uri', {
      vhs: this.fakeVhs
    });

    this.loader.started_ = true;
    this.loader.refreshManifest_();

    const date = new Date();

    this.requests[0].respond(200, {date: date.toString()}, 'foo');

    assert.equal(this.loader.lastRequestTime(), Date.parse(date.toString()), 'set last request time');
  });

  QUnit.test('lastRequestTime set to now without date header', function(assert) {
    this.loader = new PlaylistLoader('foo.uri', {
      vhs: this.fakeVhs
    });

    this.loader.started_ = true;
    this.loader.refreshManifest_();

    // set "now" to 20
    this.clock.tick(20);

    this.requests[0].respond(200, null, 'foo');

    assert.equal(this.loader.lastRequestTime(), 20, 'set last request time');
  });

  QUnit.module('#parseManifest_()');

  QUnit.test('sets variables and triggers updated in callback', function(assert) {
    assert.expect(6);

    this.loader = new PlaylistLoader('foo.uri', {
      vhs: this.fakeVhs
    });

    const manifest = {foo: 'bar'};
    const manifestString = '{foo: "bar"}';
    let updatedCalled = false;

    this.loader.on('updated', function() {
      updatedCalled = true;
    });

    this.loader.parseManifest_ = (manifestString_, callback) => {
      assert.equal(manifestString, manifestString_, 'manifestString passed in');
      callback(manifest, true);
    };

    this.loader.started_ = true;
    this.loader.refreshManifest_();

    this.requests[0].respond(200, null, manifestString);

    assert.equal(this.loader.manifest(), manifest, 'manifest added to loader');
    assert.equal(this.loader.manifestString_, manifestString, 'manifestString added to loader');
    assert.true(updatedCalled, 'updated was called');
  });

  QUnit.test('does not set anything if not updated', function(assert) {
    assert.expect(6);

    this.loader = new PlaylistLoader('foo.uri', {
      vhs: this.fakeVhs
    });

    const manifestString = '{foo: "bar"}';
    let updatedCalled = false;

    this.loader.on('updated', function() {
      updatedCalled = true;
    });

    this.loader.parseManifest_ = (manifestString_, callback) => {
      assert.equal(manifestString, manifestString_, 'manifestString passed in');
      callback(null, false);
    };

    this.loader.started_ = true;
    this.loader.refreshManifest_();

    this.requests[0].respond(200, null, manifestString);

    assert.equal(this.loader.manifest(), null, 'manifest not added to loader');
    assert.equal(this.loader.manifestString_, null, 'manifestString not added to loader');
    assert.false(updatedCalled, 'updated was not called');
  });

  QUnit.module('#makeRequest_()');

  QUnit.test('can request any url', function(assert) {
    assert.expect(5);
    this.loader = new PlaylistLoader('foo.uri', {
      vhs: this.fakeVhs
    });

    // fake started
    this.loader.started_ = true;

    this.loader.makeRequest_({uri: 'bar.uri'}, function(request, wasRedirected) {
      assert.equal(wasRedirected, false, 'not redirected');
      assert.equal(request.responseText, 'bar', 'got correct response');
    });

    assert.equal(this.requests[0], this.loader.request_, 'set request on loader');

    this.requests[0].respond(200, null, 'bar');
  });

  QUnit.test('uses withCredentials from loader options', function(assert) {
    assert.expect(4);
    this.loader = new PlaylistLoader('foo.uri', {
      vhs: this.fakeVhs,
      withCredentials: true
    });

    // fake started
    this.loader.started_ = true;

    this.loader.makeRequest_({uri: 'bar.uri'}, function(request, wasRedirected) {
      assert.equal(wasRedirected, false, 'not redirected');
      assert.equal(request.responseText, 'bar', 'got correct response');
    });

    assert.equal(this.requests[0], this.loader.request_, 'set request on loader');
    assert.true(this.loader.request_.withCredentials, 'set with credentials');
  });

  QUnit.test('wasRedirected is true with handleManifestRedirects and different uri', function(assert) {
    assert.expect(5);
    this.loader = new PlaylistLoader('foo.uri', {
      vhs: this.fakeVhs,
      handleManifestRedirects: true
    });

    // fake started
    this.loader.started_ = true;

    this.loader.makeRequest_({uri: 'bar.uri'}, function(request, wasRedirected) {
      assert.equal(wasRedirected, true, 'was redirected');
      assert.equal(request.responseText, 'bar', 'got correct response');
    });

    assert.equal(this.requests[0], this.loader.request_, 'set request on loader');

    this.requests[0].responseURL = urlTo('foo.uri');
    this.requests[0].respond(200, null, 'bar');
  });

  QUnit.test('does not complete request after dispose', function(assert) {
    assert.expect(3);
    this.loader = new PlaylistLoader('foo.uri', {
      vhs: this.fakeVhs
    });

    // fake started
    this.loader.started_ = true;

    this.loader.makeRequest_({uri: 'bar.uri'}, function(request, wasRedirected) {
      assert.false(true, 'we do not get into callback');
    });

    assert.equal(this.requests[0], this.loader.request_, 'set request on loader');

    // fake disposed
    this.loader.isDisposed_ = true;

    this.requests[0].respond(200, null, 'bar');
  });

  QUnit.test('triggers error if not started', function(assert) {
    assert.expect(5);
    this.loader = new PlaylistLoader('foo.uri', {
      vhs: this.fakeVhs
    });
    let errorTriggered = false;

    this.loader.on('error', function() {
      errorTriggered = true;
    });

    this.loader.makeRequest_({uri: 'bar.uri'}, function(request, wasRedirected) {
      assert.false(true, 'we do not get into callback');
    });

    const expectedError = {
      message: 'makeRequest_ cannot be called before started!'
    };

    assert.deepEqual(this.loader.error(), expectedError, 'expected error');
    assert.equal(this.loader.request(), null, 'no request');
    assert.true(errorTriggered, 'error was triggered');
  });

  QUnit.test('triggers error with code 4 if http request error code above 500', function(assert) {
    assert.expect(5);
    this.loader = new PlaylistLoader('foo.uri', {
      vhs: this.fakeVhs
    });
    let errorTriggered = false;

    this.loader.on('error', function() {
      errorTriggered = true;
    });

    this.loader.started_ = true;
    this.loader.makeRequest_({uri: 'bar.uri'}, function(request, wasRedirected) {
      assert.false(true, 'we do not get into callback');
    });

    this.requests[0].respond(505, null, 'bad request foo bar');

    const expectedError = {
      code: 4,
      message: 'Playlist request error at URI bar.uri',
      response: 'bad request foo bar',
      status: 505
    };

    assert.deepEqual(this.loader.error(), expectedError, 'expected error');
    assert.equal(this.loader.request(), null, 'no request');
    assert.true(errorTriggered, 'error was triggered');
  });

  QUnit.test('triggers error with code 2 if http request error code below 500', function(assert) {
    assert.expect(5);
    this.loader = new PlaylistLoader('foo.uri', {
      vhs: this.fakeVhs
    });
    let errorTriggered = false;

    this.loader.on('error', function() {
      errorTriggered = true;
    });

    this.loader.started_ = true;
    this.loader.makeRequest_({uri: 'bar.uri'}, function(request, wasRedirected) {
      assert.false(true, 'we do not get into callback');
    });

    this.requests[0].respond(404, null, 'bad request foo bar');

    const expectedError = {
      code: 2,
      message: 'Playlist request error at URI bar.uri',
      response: 'bad request foo bar',
      status: 404
    };

    assert.deepEqual(this.loader.error(), expectedError, 'expected error');
    assert.equal(this.loader.request(), null, 'no request');
    assert.true(errorTriggered, 'error was triggered');
  });

  QUnit.test('handleErrors: false causes errors to be passed along, not triggered', function(assert) {
    assert.expect(5);
    this.loader = new PlaylistLoader('foo.uri', {
      vhs: this.fakeVhs
    });
    let errorTriggered = false;

    this.loader.on('error', function() {
      errorTriggered = true;
    });

    this.loader.started_ = true;
    this.loader.makeRequest_({uri: 'bar.uri', handleErrors: false}, function(request, wasRedirected, error) {
      assert.ok(error, 'error was passed in');
    });

    this.requests[0].respond(404, null, 'bad request foo bar');

    const expectedError = {
      code: 2,
      message: 'Playlist request error at URI bar.uri',
      response: 'bad request foo bar',
      status: 404
    };

    assert.deepEqual(this.loader.error(), expectedError, 'expected error');
    assert.equal(this.loader.request(), null, 'no request');
    assert.true(errorTriggered, 'error was triggered');
  });

  QUnit.module('#stop()');

  QUnit.test('only stops things if started', function(assert) {
    this.loader = new PlaylistLoader('foo.uri', {
      vhs: this.fakeVhs
    });

    const calls = {};
    const fns = ['stopRequest', 'clearMediaRefreshTimeout_'];

    fns.forEach((name) => {
      calls[name] = 0;

      this.loader[name] = () => {
        calls[name]++;
      };
    });

    this.loader.stop();
    fns.forEach(function(name) {
      assert.equal(calls[name], 0, `no calls to ${name}`);
    });

    this.loader.started_ = true;

    this.loader.stop();
    fns.forEach(function(name) {
      assert.equal(calls[name], 1, `1 call to ${name}`);
    });

    assert.false(this.loader.started(), 'not started');
  });

  QUnit.module('#dispose()');

  QUnit.test('works as expected', function(assert) {
    this.loader = new PlaylistLoader('foo.uri', {
      vhs: this.fakeVhs
    });

    let stopCalled = false;
    let disposeTriggered = false;

    this.loader.on('dispose', function() {
      disposeTriggered = true;
    });

    this.loader.stop = function() {
      stopCalled = true;
    };

    this.loader.dispose();

    assert.true(stopCalled, 'stop was called');
    assert.true(disposeTriggered, 'dispose was triggered');
    assert.true(this.loader.isDisposed_, 'is disposed was set');
  });

  QUnit.module('#stopRequest()');

  QUnit.test('does not error without a request', function(assert) {
    this.loader = new PlaylistLoader('foo.uri', {
      vhs: this.fakeVhs
    });

    try {
      this.loader.stopRequest();
      assert.true(true, 'did not throw');
    } catch (e) {
      assert.false(true, `threw an error ${e}`);
    }
  });

  QUnit.test('calls abort, clears this.request_, and clears onreadystatechange', function(assert) {
    this.loader = new PlaylistLoader('foo.uri', {
      vhs: this.fakeVhs
    });

    this.loader.start();

    const oldRequest = this.loader.request();
    let abortCalled = false;

    oldRequest.abort = function() {
      abortCalled = true;
    };

    assert.ok(oldRequest, 'have a request in flight');

    oldRequest.onreadystatechange = function() {};

    this.loader.stopRequest();

    assert.equal(oldRequest.onreadystatechange, null, 'no onreadystatechange');
    assert.true(abortCalled, 'abort was called');
    assert.equal(this.loader.request(), null, 'no current request anymore');
  });

  QUnit.module('#setMediaRefreshTime_()');

  QUnit.test('sets media refresh time with getMediaRefreshTime_() by default', function(assert) {
    this.loader = new PlaylistLoader('foo.uri', {
      vhs: this.fakeVhs
    });
    let refreshTriggered = false;

    this.loader.on('refresh', function() {
      refreshTriggered = true;
    });

    this.loader.getMediaRefreshTime_ = () => 20;
    this.loader.setMediaRefreshTimeout_();

    assert.ok(this.loader.refreshTimeout_, 'has a refreshTimeout_');

    this.clock.tick(20);
    assert.true(refreshTriggered, 'refresh was triggered');
    assert.ok(this.loader.refreshTimeout_, 'refresh timeout added again');

    this.loader.clearMediaRefreshTimeout_();
  });

  QUnit.test('sets media refresh time on updated', function(assert) {
    this.loader = new PlaylistLoader('foo.uri', {
      vhs: this.fakeVhs
    });
    let refreshTriggered = false;

    this.loader.on('refresh', function() {
      refreshTriggered = true;
    });

    this.loader.getMediaRefreshTime_ = () => 20;
    this.loader.trigger('updated');

    assert.ok(this.loader.refreshTimeout_, 'has a refreshTimeout_');

    this.clock.tick(20);
    assert.true(refreshTriggered, 'refresh was triggered');
    assert.ok(this.loader.refreshTimeout_, 'refresh timeout added again');

    this.loader.clearMediaRefreshTimeout_();
  });

  QUnit.test('not re-added if getMediaRefreshTime_ returns null', function(assert) {
    this.loader = new PlaylistLoader('foo.uri', {
      vhs: this.fakeVhs
    });
    let refreshTriggered = false;

    this.loader.on('refresh', function() {
      refreshTriggered = true;
    });

    this.loader.getMediaRefreshTime_ = () => 20;
    this.loader.setMediaRefreshTimeout_();

    assert.ok(this.loader.refreshTimeout_, 'has a refreshTimeout_');

    this.loader.getMediaRefreshTime_ = () => null;

    this.clock.tick(20);
    assert.true(refreshTriggered, 'refresh was triggered');
    assert.equal(this.loader.refreshTimeout_, null, 'refresh timeout not added again');

  });

  QUnit.test('does nothing when disposed', function(assert) {
    this.loader = new PlaylistLoader('foo.uri', {
      vhs: this.fakeVhs
    });

    this.loader.isDisposed_ = true;
    this.loader.getMediaRefreshTime_ = () => 20;
    this.loader.setMediaRefreshTimeout_();

    assert.equal(this.loader.refreshTimeout_, null, 'no refreshTimeout_');
  });

  QUnit.module('#clearMediaRefreshTime_()');

  QUnit.test('not re-added if getMediaRefreshTime_ returns null', function(assert) {
    this.loader = new PlaylistLoader('foo.uri', {
      vhs: this.fakeVhs
    });
    let refreshTriggered = false;

    this.loader.on('refresh', function() {
      refreshTriggered = true;
    });

    this.loader.getMediaRefreshTime_ = () => 20;
    this.loader.setMediaRefreshTimeout_();

    assert.ok(this.loader.refreshTimeout_, 'has a refreshTimeout_');

    this.loader.clearMediaRefreshTimeout_();

    assert.equal(this.loader.refreshTimeout_, null, 'refreshTimeout_ removed');
    this.clock.tick(20);
    assert.false(refreshTriggered, 'refresh not triggered as timeout was cleared');
  });

  QUnit.test('does not throw if we have no refreshTimeout_', function(assert) {
    this.loader = new PlaylistLoader('foo.uri', {
      vhs: this.fakeVhs
    });
    try {
      this.loader.clearMediaRefreshTimeout_();
      assert.true(true, 'did not throw an error');
    } catch (e) {
      assert.true(false, `threw an error ${e}`);
    }
  });
});

