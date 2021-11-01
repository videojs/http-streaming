import QUnit from 'qunit';
import videojs from 'video.js';
import DashMainPlaylistLoader from '../../src/playlist-loader/dash-main-playlist-loader.js';
import DashMediaPlaylistLoader from '../../src/playlist-loader/dash-media-playlist-loader.js';
import {useFakeEnvironment, standardXHRResponse} from '../test-helpers';
import xhrFactory from '../../src/xhr';
import testDataManifests from 'create-test-data!manifests';
import {
  sidx as sidxResponse,
  mp4VideoInit as mp4VideoInitSegment,
  webmVideoInit
} from 'create-test-data!segments';

QUnit.module('Dash Media Playlist Loader', function(hooks) {
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

    this.mainPlaylistLoader = new DashMainPlaylistLoader('main-manifests.mpd', {
      vhs: this.fakeVhs
    });

    this.setMediaRefreshTimeCalls = [];

    this.mainPlaylistLoader.setMediaRefreshTime_ = (time) => {
      this.setMediaRefreshTimeCalls.push(time);
    };

    this.mainPlaylistLoader.start();

  });

  hooks.afterEach(function(assert) {
    if (this.mainPlaylistLoader) {
      this.mainPlaylistLoader.dispose();
    }
    if (this.loader) {
      this.loader.dispose();
    }
    this.env.restore();
    videojs.log.debug = this.oldDebugLog;
  });

  QUnit.module('#start()', {
    beforeEach() {
      this.requests.shift().respond(200, null, testDataManifests['dash-many-codecs']);
    }
  });

  QUnit.test('multiple calls do nothing', function(assert) {
    this.loader = new DashMediaPlaylistLoader(this.mainPlaylistLoader.playlists()[0].uri, {
      vhs: this.fakeVhs,
      mainPlaylistLoader: this.mainPlaylistLoader
    });

    let onMainUpdatedCalls = 0;

    this.loader.onMainUpdated_ = () => {
      onMainUpdatedCalls++;
    };

    this.loader.start();
    assert.equal(onMainUpdatedCalls, 1, 'one on main updated call');
    assert.true(this.loader.started_, 'started');

    this.loader.start();
    assert.equal(onMainUpdatedCalls, 1, 'still one on main updated call');
    assert.true(this.loader.started_, 'still started');
  });

  QUnit.module('#stop()', {
    beforeEach() {
      this.requests.shift().respond(200, null, testDataManifests['dash-many-codecs']);
    }
  });

  QUnit.test('multiple calls do nothing', function(assert) {
    this.loader = new DashMediaPlaylistLoader(this.mainPlaylistLoader.playlists()[0].uri, {
      vhs: this.fakeVhs,
      mainPlaylistLoader: this.mainPlaylistLoader
    });

    this.loader.manifest_ = {};
    this.loader.started_ = true;
    this.loader.stop();

    assert.equal(this.loader.manifest_, null, 'manifest cleared');
    assert.false(this.loader.started_, 'stopped');

    this.loader.manifest_ = {};
    this.loader.stop();

    assert.deepEqual(this.loader.manifest_, {}, 'manifest not cleared');
    assert.false(this.loader.started_, 'still stopped');
  });

  QUnit.module('#onMainUpdated_()', {
    beforeEach() {
      this.requests.shift().respond(200, null, testDataManifests['dash-many-codecs']);
    }
  });

  QUnit.test('called via updated event on mainPlaylistLoader', function(assert) {
    this.loader = new DashMediaPlaylistLoader(this.mainPlaylistLoader.playlists()[0].uri, {
      vhs: this.fakeVhs,
      mainPlaylistLoader: this.mainPlaylistLoader
    });

    let onMainUpdatedCalls = 0;

    this.loader.onMainUpdated_ = () => {
      onMainUpdatedCalls++;
    };

    this.mainPlaylistLoader.trigger('updated');

    assert.equal(onMainUpdatedCalls, 1, 'called on main updated');
  });

  QUnit.test('does nothing if not started', function(assert) {
    this.loader = new DashMediaPlaylistLoader(this.mainPlaylistLoader.playlists()[0].uri, {
      vhs: this.fakeVhs,
      mainPlaylistLoader: this.mainPlaylistLoader
    });

    this.loader.onMainUpdated_();

    assert.equal(this.loader.manifest_, null, 'still no manifest');
  });

  QUnit.test('triggers updated without oldManifest', function(assert) {
    const media = this.mainPlaylistLoader.playlists()[0];

    this.loader = new DashMediaPlaylistLoader(media.uri, {
      vhs: this.fakeVhs,
      mainPlaylistLoader: this.mainPlaylistLoader
    });

    let updatedTriggered = false;

    this.loader.on('updated', function() {
      updatedTriggered = true;
    });

    this.loader.started_ = true;
    this.loader.onMainUpdated_();
    assert.equal(this.loader.manifest(), this.mainPlaylistLoader.playlists()[0], 'manifest set as expected');
    assert.true(updatedTriggered, 'updatedTriggered');
    assert.deepEqual(
      this.setMediaRefreshTimeCalls,
      [media.targetDuration * 1000],
      'setMediaRefreshTime called on mainPlaylistLoader'
    );
  });

  QUnit.test('does not trigger updated if manifest is the same', function(assert) {
    const media = this.mainPlaylistLoader.playlists()[0];

    this.loader = new DashMediaPlaylistLoader(media.uri, {
      vhs: this.fakeVhs,
      mainPlaylistLoader: this.mainPlaylistLoader
    });

    let updatedTriggered = false;

    this.loader.on('updated', function() {
      updatedTriggered = true;
    });

    this.loader.manifest_ = media;
    this.loader.started_ = true;
    this.loader.onMainUpdated_();

    assert.equal(this.loader.manifest(), this.mainPlaylistLoader.playlists()[0], 'manifest set as expected');
    assert.false(updatedTriggered, 'updatedTriggered');
    assert.deepEqual(
      this.setMediaRefreshTimeCalls,
      [],
      'no set media refresh calls'
    );
  });

  QUnit.test('triggers updated if manifest properties changed', function(assert) {
    const media = this.mainPlaylistLoader.playlists()[0];

    this.loader = new DashMediaPlaylistLoader(media.uri, {
      vhs: this.fakeVhs,
      mainPlaylistLoader: this.mainPlaylistLoader
    });

    let updatedTriggered = false;

    this.loader.on('updated', function() {
      updatedTriggered = true;
    });

    this.loader.manifest_ = Object.assign({}, media);
    this.loader.started_ = true;
    media.targetDuration = 5;

    this.loader.onMainUpdated_();

    assert.equal(this.loader.manifest(), this.mainPlaylistLoader.playlists()[0], 'manifest set as expected');
    assert.true(updatedTriggered, 'updatedTriggered');
    assert.deepEqual(
      this.setMediaRefreshTimeCalls,
      [5000],
      'no set media refresh calls'
    );
  });

  QUnit.test('triggers updated if segment properties changed', function(assert) {
    const media = this.mainPlaylistLoader.playlists()[0];

    this.loader = new DashMediaPlaylistLoader(media.uri, {
      vhs: this.fakeVhs,
      mainPlaylistLoader: this.mainPlaylistLoader
    });

    let updatedTriggered = false;

    this.loader.on('updated', function() {
      updatedTriggered = true;
    });

    // clone proprety that we are going to change
    this.loader.manifest_ = Object.assign({}, media);
    this.loader.manifest_.segments = media.segments.slice();
    this.loader.manifest_.segments[0] = Object.assign({}, media.segments[0]);
    this.loader.manifest_.segments[0].map = Object.assign({}, media.segments[0].map);
    this.loader.started_ = true;

    media.segments[0].map.foo = 'bar';

    this.loader.onMainUpdated_();

    assert.equal(this.loader.manifest(), this.mainPlaylistLoader.playlists()[0], 'manifest set as expected');
    assert.true(updatedTriggered, 'updatedTriggered');
    assert.deepEqual(
      this.setMediaRefreshTimeCalls,
      [4000],
      'no set media refresh calls'
    );
  });

  QUnit.test('calls requestSidx_', function(assert) {
    const media = this.mainPlaylistLoader.playlists()[0];

    this.loader = new DashMediaPlaylistLoader(media.uri, {
      vhs: this.fakeVhs,
      mainPlaylistLoader: this.mainPlaylistLoader
    });

    let requestSidxCalled = false;

    this.loader.requestSidx_ = (callback) => {
      requestSidxCalled = true;
    };

    this.loader.manifest_ = Object.assign({}, media);
    this.loader.started_ = true;
    media.targetDuration = 5;

    this.loader.onMainUpdated_();

    assert.true(requestSidxCalled, 'requestSidx_ was called');
  });

  QUnit.module('#requestSidx_()', {
    beforeEach() {
      this.requests.shift().respond(200, null, testDataManifests['dash-sidx']);
    }
  });

  QUnit.test('does nothing if manifest has no sidx', function(assert) {
    const media = this.mainPlaylistLoader.playlists()[0];

    delete media.sidx;

    this.loader = new DashMediaPlaylistLoader(media.uri, {
      vhs: this.fakeVhs,
      mainPlaylistLoader: this.mainPlaylistLoader
    });
    this.loader.started_ = true;

    this.loader.onMainUpdated_();

    assert.equal(this.loader.manifest().segments.length, 0, 'no segments');
    assert.equal(this.requests.length, 0, 'no sidx request');
  });

  QUnit.test('requests container then sidx bytes', function(assert) {
    const media = this.mainPlaylistLoader.playlists()[0];

    this.loader = new DashMediaPlaylistLoader(media.uri, {
      vhs: this.fakeVhs,
      mainPlaylistLoader: this.mainPlaylistLoader
    });
    this.loader.started_ = true;

    this.loader.onMainUpdated_();

    assert.equal(this.loader.manifest().segments.length, 0, 'no segments');
    assert.equal(this.requests.length, 1, 'one request for container');
    assert.equal(this.loader.request(), this.requests[0], 'loader has a request');

    standardXHRResponse(this.requests.shift(), mp4VideoInitSegment().subarray(0, 10));

    assert.equal(this.requests.length, 1, 'one request for sidx bytes');
    assert.equal(this.loader.request(), this.requests[0], 'loader has a request');
    standardXHRResponse(this.requests.shift(), sidxResponse());

    assert.equal(this.loader.manifest().segments.length, 1, 'sidx segment added');
  });

  QUnit.test('can use sidx from container request', function(assert) {
    const media = this.mainPlaylistLoader.playlists()[0];

    this.loader = new DashMediaPlaylistLoader(media.uri, {
      vhs: this.fakeVhs,
      mainPlaylistLoader: this.mainPlaylistLoader
    });
    this.loader.started_ = true;

    this.loader.onMainUpdated_();

    assert.equal(this.loader.manifest().segments.length, 0, 'no segments');
    assert.equal(this.requests.length, 1, 'one request for container');
    assert.equal(this.loader.request(), this.requests[0], 'loader has a request');

    const sidxByterange = this.loader.manifest_.sidx.byterange;
    // container bytes + length + offset
    const response = new Uint8Array(10 + sidxByterange.length + sidxByterange.offset);

    response.set(mp4VideoInitSegment().subarray(0, 10), 0);
    response.set(sidxResponse(), sidxByterange.offset);

    standardXHRResponse(this.requests.shift(), response);

    assert.equal(this.requests.length, 0, 'no more requests ');
    assert.equal(this.loader.manifest().segments.length, 1, 'sidx segment added');
    assert.equal(this.loader.request(), null, 'loader has no request');
  });

  QUnit.test('container request failure reported', function(assert) {
    const media = this.mainPlaylistLoader.playlists()[0];

    this.loader = new DashMediaPlaylistLoader(media.uri, {
      vhs: this.fakeVhs,
      mainPlaylistLoader: this.mainPlaylistLoader
    });
    this.loader.started_ = true;

    let errorTriggered = false;

    this.loader.on('error', function() {
      errorTriggered = true;
    });
    this.loader.onMainUpdated_();

    assert.equal(this.loader.manifest().segments.length, 0, 'no segments');
    assert.equal(this.requests.length, 1, 'one request for container');
    assert.equal(this.loader.request(), this.requests[0], 'loader has a request');

    this.requests.shift().respond(404);
    assert.true(errorTriggered, 'error triggered');
    assert.equal(this.loader.request(), null, 'loader has no request');
  });

  QUnit.test('undefined container errors', function(assert) {
    const media = this.mainPlaylistLoader.playlists()[0];

    this.loader = new DashMediaPlaylistLoader(media.uri, {
      vhs: this.fakeVhs,
      mainPlaylistLoader: this.mainPlaylistLoader
    });
    this.loader.started_ = true;

    let errorTriggered = false;

    this.loader.on('error', function() {
      errorTriggered = true;
    });
    this.loader.onMainUpdated_();

    assert.equal(this.loader.manifest().segments.length, 0, 'no segments');
    assert.equal(this.requests.length, 1, 'one request for container');
    assert.equal(this.loader.request(), this.requests[0], 'loader has a request');

    standardXHRResponse(this.requests.shift(), new Uint8Array(200));
    assert.true(errorTriggered, 'error triggered');
    assert.equal(this.loader.request(), null, 'loader has no request');
  });

  QUnit.test('webm container errors', function(assert) {
    const media = this.mainPlaylistLoader.playlists()[0];

    this.loader = new DashMediaPlaylistLoader(media.uri, {
      vhs: this.fakeVhs,
      mainPlaylistLoader: this.mainPlaylistLoader
    });
    this.loader.started_ = true;

    let errorTriggered = false;

    this.loader.on('error', function() {
      errorTriggered = true;
    });
    this.loader.onMainUpdated_();

    assert.equal(this.loader.manifest().segments.length, 0, 'no segments');
    assert.equal(this.requests.length, 1, 'one request for container');
    assert.equal(this.loader.request(), this.requests[0], 'loader has a request');

    standardXHRResponse(this.requests.shift(), webmVideoInit());
    assert.true(errorTriggered, 'error triggered');
    assert.equal(this.loader.request(), null, 'loader has no request');
  });

  QUnit.test('sidx request failure reported', function(assert) {
    const media = this.mainPlaylistLoader.playlists()[0];

    this.loader = new DashMediaPlaylistLoader(media.uri, {
      vhs: this.fakeVhs,
      mainPlaylistLoader: this.mainPlaylistLoader
    });
    this.loader.started_ = true;

    let errorTriggered = false;

    this.loader.on('error', function() {
      errorTriggered = true;
    });
    this.loader.onMainUpdated_();

    assert.equal(this.loader.manifest().segments.length, 0, 'no segments');
    assert.equal(this.requests.length, 1, 'one request for container');
    assert.equal(this.loader.request(), this.requests[0], 'loader has a request');

    standardXHRResponse(this.requests.shift(), mp4VideoInitSegment().subarray(0, 10));

    assert.equal(this.requests.length, 1, 'one request for container');
    assert.equal(this.loader.request(), this.requests[0], 'loader has a request');
    assert.false(errorTriggered, 'error not triggered');

    this.requests.shift().respond(404);

    assert.true(errorTriggered, 'error triggered');
    assert.equal(this.loader.request(), null, 'loader has no request');
  });

  QUnit.test('sidx parse failure reported', function(assert) {
    const media = this.mainPlaylistLoader.playlists()[0];

    this.loader = new DashMediaPlaylistLoader(media.uri, {
      vhs: this.fakeVhs,
      mainPlaylistLoader: this.mainPlaylistLoader
    });
    this.loader.started_ = true;

    let errorTriggered = false;

    this.loader.on('error', function() {
      errorTriggered = true;
    });
    this.loader.onMainUpdated_();

    assert.equal(this.loader.manifest().segments.length, 0, 'no segments');
    assert.equal(this.requests.length, 1, 'one request for container');
    assert.equal(this.loader.request(), this.requests[0], 'loader has a request');

    standardXHRResponse(this.requests.shift(), mp4VideoInitSegment().subarray(0, 10));

    assert.equal(this.requests.length, 1, 'one request for container');
    assert.equal(this.loader.request(), this.requests[0], 'loader has a request');
    assert.false(errorTriggered, 'error not triggered');

    standardXHRResponse(this.requests.shift(), new Uint8Array(10));

    assert.true(errorTriggered, 'error triggered');
    assert.equal(this.loader.request(), null, 'loader has no request');
  });

});

