import QUnit from 'qunit';
import videojs from 'video.js';
import DashMainPlaylistLoader from '../../src/playlist-loader/dash-main-playlist-loader.js';
import DashMediaPlaylistLoader from '../../src/playlist-loader/dash-media-playlist-loader.js';
import {useFakeEnvironment} from '../test-helpers';
import xhrFactory from '../../src/xhr';
import testDataManifests from 'create-test-data!manifests';

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

    this.mainPlaylistLoader = new DashMainPlaylistLoader('dash-many-codecs.mpd', {
      vhs: this.fakeVhs
    });

    this.setMediaRefreshTimeCalls = [];

    this.mainPlaylistLoader.setMediaRefreshTime_ = (time) => {
      this.setMediaRefreshTimeCalls.push(time);
    };

    this.mainPlaylistLoader.start();

    this.requests[0].respond(200, null, testDataManifests['dash-many-codecs']);
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

  QUnit.module('#start()');

  QUnit.test('multiple calls do nothing', function(assert) {
    this.loader = new DashMediaPlaylistLoader(this.mainPlaylistLoader.manifest().playlists[0].uri, {
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

  QUnit.module('#stop()');

  QUnit.test('multiple calls do nothing', function(assert) {
    this.loader = new DashMediaPlaylistLoader(this.mainPlaylistLoader.manifest().playlists[0].uri, {
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

  QUnit.module('#onMainUpdated_()');

  QUnit.test('called via updated event on mainPlaylistLoader', function(assert) {
    this.loader = new DashMediaPlaylistLoader(this.mainPlaylistLoader.manifest().playlists[0].uri, {
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
    this.loader = new DashMediaPlaylistLoader(this.mainPlaylistLoader.manifest().playlists[0].uri, {
      vhs: this.fakeVhs,
      mainPlaylistLoader: this.mainPlaylistLoader
    });

    this.loader.onMainUpdated_();

    assert.equal(this.loader.manifest_, null, 'still no manifest');
  });

  QUnit.test('triggers updated without oldManifest', function(assert) {
    const media = this.mainPlaylistLoader.manifest().playlists[0];

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
    assert.equal(this.loader.manifest_, media, 'manifest set as expected');
    assert.true(updatedTriggered, 'updatedTriggered');
    assert.deepEqual(
      this.setMediaRefreshTimeCalls,
      [media.targetDuration * 1000],
      'setMediaRefreshTime called on mainPlaylistLoader'
    );
  });

  QUnit.test('does not trigger updated if manifest is the same', function(assert) {
    const media = this.mainPlaylistLoader.manifest().playlists[0];

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

    assert.equal(this.loader.manifest_, media, 'manifest set as expected');
    assert.false(updatedTriggered, 'updatedTriggered');
    assert.deepEqual(
      this.setMediaRefreshTimeCalls,
      [],
      'no set media refresh calls'
    );
  });

  QUnit.test('triggers updated if manifest properties changed', function(assert) {
    const media = this.mainPlaylistLoader.manifest().playlists[0];

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

    assert.equal(this.loader.manifest_, media, 'manifest set as expected');
    assert.true(updatedTriggered, 'updatedTriggered');
    assert.deepEqual(
      this.setMediaRefreshTimeCalls,
      [5000],
      'no set media refresh calls'
    );
  });

  QUnit.test('triggers updated if segment properties changed', function(assert) {
    const media = this.mainPlaylistLoader.manifest().playlists[0];

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

    assert.equal(this.loader.manifest_, media, 'manifest set as expected');
    assert.true(updatedTriggered, 'updatedTriggered');
    assert.deepEqual(
      this.setMediaRefreshTimeCalls,
      [4000],
      'no set media refresh calls'
    );
  });

});

