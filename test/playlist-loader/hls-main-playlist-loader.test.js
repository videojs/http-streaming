import QUnit from 'qunit';
import videojs from 'video.js';
import HlsMainPlaylistLoader from '../../src/playlist-loader/hls-main-playlist-loader.js';
import {useFakeEnvironment} from '../test-helpers';
import xhrFactory from '../../src/xhr';
import testDataManifests from 'create-test-data!manifests';

QUnit.module('HLS Main Playlist Loader', function(hooks) {
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

  QUnit.module('#start()');

  QUnit.test('requests and parses a manifest', function(assert) {
    assert.expect(8);
    this.loader = new HlsMainPlaylistLoader('master.m3u8', {
      vhs: this.fakeVhs
    });

    let updatedTriggered = false;

    this.loader.on('updated', function() {
      updatedTriggered = true;
    });
    this.loader.start();

    assert.true(this.loader.started_, 'was started');
    assert.ok(this.loader.request_, 'has request');

    this.requests[0].respond(200, null, testDataManifests.master);

    assert.equal(this.loader.request_, null, 'request is done');
    assert.ok(this.loader.manifest(), 'manifest was set');
    assert.equal(this.loader.manifestString(), testDataManifests.master, 'manifest string set');
    assert.true(updatedTriggered, 'updated was triggered');
  });

  QUnit.test('does not re-request a manifest if it has one.', function(assert) {
    assert.expect(4);
    this.loader = new HlsMainPlaylistLoader('master.m3u8', {
      vhs: this.fakeVhs
    });

    this.loader.manifest_ = {};
    this.loader.start();

    assert.true(this.loader.started_, 'was started');
    assert.equal(this.loader.request_, null, 'has no request');
  });

  QUnit.test('forced manifest refresh is not updated with the same response', function(assert) {
    assert.expect(11);
    this.loader = new HlsMainPlaylistLoader('master.m3u8', {
      vhs: this.fakeVhs
    });
    let updatedTriggers = 0;

    this.loader.on('updated', function() {
      updatedTriggers++;
    });
    this.loader.start();

    assert.true(this.loader.started_, 'was started');
    assert.ok(this.loader.request_, 'has request');

    this.requests[0].respond(200, null, testDataManifests.master);

    assert.equal(this.loader.request_, null, 'request is done');
    assert.ok(this.loader.manifest(), 'manifest was set');
    assert.equal(this.loader.manifestString(), testDataManifests.master, 'manifest string set');
    assert.equal(updatedTriggers, 1, 'one updated trigger');

    this.loader.refreshManifest_();
    assert.ok(this.loader.request_, 'has request');
    this.requests[1].respond(200, null, testDataManifests.master);

    assert.equal(this.loader.request_, null, 'request is done');
    assert.equal(updatedTriggers, 1, 'not updated again');
  });

  QUnit.test('forced manifest refresh is updated with new response', function(assert) {
    assert.expect(13);
    this.loader = new HlsMainPlaylistLoader('master.m3u8', {
      vhs: this.fakeVhs
    });
    let updatedTriggers = 0;

    this.loader.on('updated', function() {
      updatedTriggers++;
    });
    this.loader.start();

    assert.true(this.loader.started_, 'was started');
    assert.ok(this.loader.request_, 'has request');

    this.requests[0].respond(200, null, testDataManifests.master);

    assert.equal(this.loader.request_, null, 'request is done');
    assert.ok(this.loader.manifest(), 'manifest was set');
    assert.equal(this.loader.manifestString(), testDataManifests.master, 'manifest string set');
    assert.equal(updatedTriggers, 1, 'one updated trigger');

    this.loader.refreshManifest_();
    assert.ok(this.loader.request_, 'has request');
    this.requests[1].respond(200, null, testDataManifests['master-captions']);

    assert.equal(this.loader.request_, null, 'request is done');
    assert.ok(this.loader.manifest(), 'manifest was set');
    assert.equal(this.loader.manifestString(), testDataManifests['master-captions'], 'manifest string set');
    assert.equal(updatedTriggers, 2, 'updated again');
  });
});

