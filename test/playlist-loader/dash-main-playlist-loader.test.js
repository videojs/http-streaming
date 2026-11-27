import QUnit from 'qunit';
import videojs from 'video.js';
import DashMainPlaylistLoader from '../../src/playlist-loader/dash-main-playlist-loader.js';
import {useFakeEnvironment} from '../test-helpers';
import xhrFactory from '../../src/xhr';
import testDataManifests from 'create-test-data!manifests';

QUnit.module('Dash Main Playlist Loader', function(hooks) {
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

  // Since playlists is mostly a wrapper around forEachPlaylists
  // most of the tests are located there.
  QUnit.module('#playlists()');

  QUnit.test('returns empty array without playlists', function(assert) {
    this.loader = new DashMainPlaylistLoader('dash-many-codecs.mpd', {
      vhs: this.fakeVhs
    });

    assert.deepEqual(this.loader.playlists(), [], 'no playlists');
  });

  QUnit.module('#setMediaRefreshTime_()/#getMediaRefreshTime_()');

  QUnit.test('used when minimumUpdatePeriod is zero', function(assert) {
    this.loader = new DashMainPlaylistLoader('dash-many-codecs.mpd', {
      vhs: this.fakeVhs
    });

    this.loader.manifest_ = {
      minimumUpdatePeriod: 0
    };

    this.loader.setMediaRefreshTimeout_ = () => {};
    this.loader.setMediaRefreshTime_(200);

    assert.equal(this.loader.getMediaRefreshTime_(), 200, 'as expected');
  });

  QUnit.test('ignored when minimumUpdatePeriod is set', function(assert) {
    this.loader = new DashMainPlaylistLoader('dash-many-codecs.mpd', {
      vhs: this.fakeVhs
    });

    this.loader.manifest_ = {
      minimumUpdatePeriod: 5
    };

    this.loader.setMediaRefreshTimeout_ = () => {};
    this.loader.setMediaRefreshTime_(200);

    assert.equal(this.loader.getMediaRefreshTime_(), 5, 'as expected');
  });

  QUnit.test('ignored when minimumUpdatePeriod invalid', function(assert) {
    this.loader = new DashMainPlaylistLoader('dash-many-codecs.mpd', {
      vhs: this.fakeVhs
    });

    this.loader.manifest_ = {
      minimumUpdatePeriod: -1
    };

    this.loader.setMediaRefreshTimeout_ = () => {};
    this.loader.setMediaRefreshTime_(200);

    assert.equal(this.loader.getMediaRefreshTime_(), null, 'as expected');
  });

  QUnit.module('#parseManifest_()');

  QUnit.test('parses given manifest', function(assert) {
    this.loader = new DashMainPlaylistLoader('dash-many-codecs.mpd', {
      vhs: this.fakeVhs
    });

    this.loader.parseManifest_(testDataManifests['dash-many-codecs'], function(manifest, updated) {
      assert.ok(manifest, 'manifest is valid');
      assert.true(updated, 'updated is always true');
    });
  });

  QUnit.test('merges manifests, but only uses new manifest playlists', function(assert) {
    this.loader = new DashMainPlaylistLoader('dash-many-codecs.mpd', {
      vhs: this.fakeVhs
    });
    let oldManifest;

    this.loader.parseManifest_(testDataManifests['dash-many-codecs'], (manifest, updated) => {
      this.loader.manifest_ = manifest;
      oldManifest = manifest;
    });

    this.loader.parseManifest_(testDataManifests['dash-many-codecs'], (manifest, updated) => {
      assert.notEqual(manifest.playlists, oldManifest.playlists, 'playlists not merged');
    });
  });

  QUnit.test('calls syncClientServerClock_()', function(assert) {
    this.loader = new DashMainPlaylistLoader('dash-many-codecs.mpd', {
      vhs: this.fakeVhs
    });
    let called = false;

    this.loader.syncClientServerClock_ = () => {
      called = true;
    };

    this.loader.parseManifest_(testDataManifests['dash-many-codecs'], () => {});

    assert.true(called, 'syncClientServerClock_ called');
  });

  QUnit.module('syncClientServerClock_', {
    beforeEach() {
      this.loader = new DashMainPlaylistLoader('dash-many-codecs.mpd', {
        vhs: this.fakeVhs
      });

      this.loader.started_ = true;
    }
  });

  QUnit.test('without utc timing returns a default', function(assert) {
    const manifestString = '<MPD><UTCTiming></UTCTiming></MPD>';

    this.loader.lastRequestTime = () => 100;
    this.clock.tick(50);

    this.loader.syncClientServerClock_(manifestString, function(value) {
      assert.equal(value, 50, 'as expected');
    });
  });

  QUnit.test('can use HEAD', function(assert) {
    const manifestString =
      '<MPD>' +
        '<UTCTiming schemeIdUri="urn:mpeg:dash:utc:http-head:2014" value="foo.uri">' +
        '</UTCTiming>' +
      '</MPD>';

    this.loader.syncClientServerClock_(manifestString, function(value) {
      assert.equal(value, 20000, 'client server clock is 20s (20000ms)');
    });

    assert.equal(this.requests.length, 1, 'has one sync request');
    assert.equal(this.requests[0].method, 'HEAD', 'head request');

    const date = new Date();

    date.setSeconds(date.getSeconds() + 20);

    this.requests[0].respond(200, {date: date.toString()});
  });

  QUnit.test('can use invalid HEAD', function(assert) {
    const manifestString =
      '<MPD>' +
        '<UTCTiming schemeIdUri="urn:mpeg:dash:utc:http-head:2014" value="foo.uri">' +
        '</UTCTiming>' +
      '</MPD>';

    this.loader.lastRequestTime = () => 55;
    this.loader.syncClientServerClock_(manifestString, function(value) {
      assert.equal(value, 55, 'is lastRequestTime');
    });

    assert.equal(this.requests.length, 1, 'has one sync request');
    assert.equal(this.requests[0].method, 'HEAD', 'head request');

    this.requests[0].respond(200);
  });

  QUnit.test('can use GET', function(assert) {
    const manifestString =
      '<MPD>' +
        '<UTCTiming schemeIdUri="urn:mpeg:dash:utc:http-iso:2012" value="foo.uri">' +
        '</UTCTiming>' +
      '</MPD>';

    this.loader.syncClientServerClock_(manifestString, function(value) {
      assert.equal(value, 20000, 'client server clock is 20s (20000ms)');
    });

    assert.equal(this.requests.length, 1, 'has one sync request');
    assert.equal(this.requests[0].method, 'GET', 'GET request');

    const date = new Date();

    date.setSeconds(date.getSeconds() + 20);

    this.requests[0].respond(200, null, date.toString());
  });

  QUnit.test('can use DIRECT', function(assert) {
    const date = new Date();

    date.setSeconds(date.getSeconds() + 20);

    const manifestString =
      '<MPD>' +
        '<UTCTiming schemeIdUri="urn:mpeg:dash:utc:direct:2012" value="' + date.toString() + '">' +
        '</UTCTiming>' +
      '</MPD>';

    this.loader.syncClientServerClock_(manifestString, function(value) {
      assert.equal(value, 20000, 'client server clock is 20s (20000ms)');
    });
  });

  QUnit.test('uses lastRequestTime on request failure', function(assert) {
    const manifestString =
      '<MPD>' +
        '<UTCTiming schemeIdUri="urn:mpeg:dash:utc:http-head:2014" value="foo.uri">' +
        '</UTCTiming>' +
      '</MPD>';

    this.loader.lastRequestTime = () => 100;
    this.clock.tick(50);

    this.loader.syncClientServerClock_(manifestString, function(value) {
      assert.equal(value, 50, 'as expected');
    });

    assert.equal(this.requests.length, 1, 'has one sync request');
    assert.equal(this.requests[0].method, 'HEAD', 'head request');

    this.requests[0].respond(404);
  });
});
