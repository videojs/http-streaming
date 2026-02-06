import QUnit from 'qunit';
import videojs from 'video.js';
import {
  default as HlsMediaPlaylistLoader,
  getAllSegments,
  timeBeforeRefresh
} from '../../src/playlist-loader/hls-media-playlist-loader.js';
import {useFakeEnvironment} from '../test-helpers';
import xhrFactory from '../../src/xhr';
import testDataManifests from 'create-test-data!manifests';

QUnit.module('HLS Media Playlist Loader', function(hooks) {
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
    this.loader = new HlsMediaPlaylistLoader('media.m3u8', {
      vhs: this.fakeVhs
    });

    let updatedTriggered = false;

    this.loader.on('updated', function() {
      updatedTriggered = true;
    });
    this.loader.start();

    assert.true(this.loader.started_, 'was started');
    assert.ok(this.loader.request_, 'has request');

    this.requests[0].respond(200, null, testDataManifests.media);

    assert.equal(this.loader.request_, null, 'request is done');
    assert.ok(this.loader.manifest(), 'manifest was set');
    assert.equal(this.loader.manifestString_, testDataManifests.media, 'manifest string set');
    assert.true(updatedTriggered, 'updated was triggered');
  });

  QUnit.test('does not re-request when we have a vod manifest already', function(assert) {
    assert.expect(5);
    this.loader = new HlsMediaPlaylistLoader('media.m3u8', {
      vhs: this.fakeVhs
    });

    let updatedTriggered = false;

    this.loader.manifest = () => {
      return {endList: true};
    };

    this.loader.on('updated', function() {
      updatedTriggered = true;
    });
    this.loader.start();

    assert.true(this.loader.started_, 'was started');
    assert.equal(this.loader.request_, null, 'no request');
    assert.false(updatedTriggered, 'updated was not triggered');
  });

  QUnit.module('#parseManifest_()');

  QUnit.test('works as expected', function(assert) {
    assert.expect(8);
    this.loader = new HlsMediaPlaylistLoader('media.m3u8', {
      vhs: this.fakeVhs
    });
    const media =
      '#EXTM3U\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n' +
      '#EXTINF:10\n' +
      '0.ts\n' +
      '#EXTINF:10\n' +
      '1.ts\n';

    // first media
    this.loader.parseManifest_(media, (mergedMedia, updated) => {
      assert.ok(mergedMedia, 'media returned');
      assert.true(updated, 'was updated');
      this.loader.manifest_ = mergedMedia;
      this.loader.manifestString_ = testDataManifests.media;
    });

    // same media
    this.loader.parseManifest_(media, (mergedMedia, updated) => {
      assert.ok(mergedMedia, 'media returned');
      assert.false(updated, 'was not updated');
    });

    const mediaUpdate = media +
      '#EXTINF:10\n' +
      '2.ts\n';

    // media updated
    this.loader.parseManifest_(mediaUpdate, (mergedMedia, updated) => {
      assert.ok(mergedMedia, 'media returned');
      assert.true(updated, 'was updated for media update');
    });
  });

  QUnit.module('timeBeforeRefresh');

  QUnit.test('defaults to 5000ms without target duration or segments', function(assert) {
    const manifest = {};

    assert.equal(timeBeforeRefresh(manifest), 5000, 'as expected');
    assert.equal(timeBeforeRefresh(manifest, true), 5000, 'as expected');
  });

  QUnit.test('uses last segment duration when update is true', function(assert) {
    const manifest = {targetDuration: 5, segments: [
      {duration: 4.9},
      {duration: 5.1}
    ]};

    assert.equal(timeBeforeRefresh(manifest, true), 5100, 'as expected');
  });

  QUnit.test('uses last part duration if it exists when update is true', function(assert) {
    const manifest = {targetDuration: 5, segments: [
      {duration: 4.9},
      {duration: 5.1, parts: [
        {duration: 0.9},
        {duration: 1.1},
        {duration: 0.8},
        {duration: 1.2},
        {duration: 1}
      ]}
    ]};

    assert.equal(timeBeforeRefresh(manifest, true), 1000, 'as expected');
  });

  QUnit.test('uses half of target duration without updated', function(assert) {
    const manifest = {targetDuration: 5, segments: [
      {duration: 4.9},
      {duration: 5.1, parts: [
        {duration: 0.9},
        {duration: 1.1},
        {duration: 0.8},
        {duration: 1.2},
        {duration: 1}
      ]}
    ]};

    assert.equal(timeBeforeRefresh(manifest), 2500, 'as expected');
  });

  QUnit.test('uses half of part target duration without updated', function(assert) {
    const manifest = {partTargetDuration: 1, targetDuration: 5, segments: [
      {duration: 4.9},
      {duration: 5.1, parts: [
        {duration: 0.9},
        {duration: 1.1},
        {duration: 0.8},
        {duration: 1.2},
        {duration: 1}
      ]}
    ]};

    assert.equal(timeBeforeRefresh(manifest), 500, 'as expected');
  });

  QUnit.module('getAllSegments');

  QUnit.test('handles preloadSegments', function(assert) {
    const manifest = {
      targetDuration: 5,
      segments: [{duration: 5}],
      preloadSegment: {
        parts: [{duration: 1}]
      }
    };

    assert.deepEqual(
      getAllSegments(manifest),
      [{duration: 5}, {duration: 5, preload: true, parts: [{duration: 1}]}],
      'has one segment from preloadSegment',
    );
  });

  QUnit.test('handles preloadSegments with PART preloadHints', function(assert) {
    const manifest = {
      targetDuration: 5,
      segments: [{duration: 5}],
      preloadSegment: {
        parts: [{duration: 1}],
        preloadHints: [{type: 'PART'}]
      }
    };

    assert.deepEqual(
      getAllSegments(manifest),
      [
        {duration: 5},
        {duration: 5, preload: true, parts: [{duration: 1}], preloadHints: [{type: 'PART'}]}
      ],
      'has one segment from preloadSegment',
    );
  });

  QUnit.test('skips preloadSegments with MAP preloadHints', function(assert) {
    const manifest = {
      targetDuration: 5,
      segments: [{duration: 5}],
      preloadSegment: {
        parts: [{duration: 1}],
        preloadHints: [{type: 'MAP'}]
      }
    };

    assert.deepEqual(
      getAllSegments(manifest),
      [{duration: 5}],
      'has nothing',
    );
  });

  QUnit.test('adds skip segments before all others', function(assert) {
    const manifest = {
      targetDuration: 5,
      segments: [{duration: 5}],
      preloadSegment: {parts: [{duration: 1}]},
      skip: {skippedSegments: 2}
    };

    assert.deepEqual(
      getAllSegments(manifest),
      [
        {skipped: true},
        {skipped: true},
        {duration: 5},
        {duration: 5, preload: true, parts: [{duration: 1}]}
      ],
      'has nothing',
    );
  });

});

