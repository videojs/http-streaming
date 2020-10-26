import QUnit from 'qunit';
import videojs from 'video.js';
import window from 'global/window';
import {
  useFakeEnvironment,
  useFakeMediaSource,
  createPlayer,
  standardXHRResponse,
  openMediaSource,
  requestAndAppendSegment,
  setupMediaSource,
  downloadProgress
} from './test-helpers.js';
import {
  DEFAULT_AUDIO_CODEC,
  DEFAULT_VIDEO_CODEC
} from '@videojs/vhs-utils/dist/codecs.js';
import manifests from 'create-test-data!manifests';
import {
  MasterPlaylistController
} from '../src/master-playlist-controller';
/* eslint-disable no-unused-vars */
// we need this so that it can register vhs with videojs
import { Vhs } from '../src/videojs-http-streaming';
/* eslint-enable no-unused-vars */
import Playlist from '../src/playlist';
import Config from '../src/config';
import PlaylistLoader from '../src/playlist-loader';
import DashPlaylistLoader from '../src/dash-playlist-loader';
import {
  parseManifest,
  addPropertiesToMaster
} from '../src/manifest.js';
import {
  muxed as muxedSegment,
  audio as audioSegment,
  video as videoSegment,
  mp4MuxedInit as mp4MuxedInitSegment,
  mp4Muxed as mp4MuxedSegment,
  mp4VideoInit as mp4VideoInitSegment,
  mp4Video as mp4VideoSegment,
  mp4AudioInit as mp4AudioInitSegment,
  mp4Audio as mp4AudioSegment
} from 'create-test-data!segments';
import {
  timeRangesEqual,
  bandwidthWithinTolerance
} from './custom-assertions.js';

const sharedHooks = {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.clock = this.env.clock;
    this.requests = this.env.requests;
    this.oldTypeSupported = window.MediaSource.isTypeSupported;
    this.mse = useFakeMediaSource();

    if (!videojs.browser.IE_VERSION) {
      this.oldDevicePixelRatio = window.devicePixelRatio;
      window.devicePixelRatio = 1;
    }

    this.oldChangeType = window.SourceBuffer.prototype.changeType;

    // force the HLS tech to run
    this.origSupportsNativeHls = videojs.Vhs.supportsNativeHls;
    videojs.Vhs.supportsNativeHls = false;
    this.oldBrowser = videojs.browser;
    videojs.browser = videojs.mergeOptions({}, videojs.browser);
    this.player = createPlayer(videojs.mergeOptions({}, this.playerOptions));
    this.player.src({
      src: 'manifest/master.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    this.clock.tick(1);

    this.standardXHRResponse = (request, data) => {
      standardXHRResponse(request, data);

      // Because SegmentLoader#fillBuffer_ is now scheduled asynchronously
      // we have to use clock.tick to get the expected side effects of
      // SegmentLoader#handleAppendsDone_
      this.clock.tick(1);
    };

    this.masterPlaylistController = this.player.tech_.vhs.masterPlaylistController_;

    // Make segment metadata noop since most test segments dont have real data
    this.masterPlaylistController.mainSegmentLoader_.addSegmentMetadataCue_ = () => {};
  },
  afterEach() {
    this.env.restore();
    this.mse.restore();
    videojs.Vhs.supportsNativeHls = this.origSupportsNativeHls;
    window.localStorage.clear();
    if (this.hasOwnProperty('oldDevicePixelRatio')) {
      window.devicePixelRatio = this.oldDevicePixelRatio;
    }
    videojs.browser = this.oldBrowser;
    this.player.dispose();
    window.MediaSource.isTypeSupported = this.oldTypeSupported;
    window.SourceBuffer.prototype.changeType = this.oldChangeType;
  }

};

QUnit.module('MasterPlaylistController', sharedHooks);

QUnit.test('throws error when given an empty URL', function(assert) {
  const options = {
    src: 'test',
    tech: this.player.tech_
  };

  const controller = new MasterPlaylistController(options);

  assert.ok(controller, 'can create with options');

  controller.dispose();

  options.src = '';
  assert.throws(
    () => {
      new MasterPlaylistController(options); // eslint-disable-line no-new
    },
    /A non-empty playlist URL or JSON manifest string is required/,
    'requires a non empty url or JSON manifest string'
  );
});

QUnit.test('obeys none preload option', function(assert) {
  this.player.preload('none');
  // master
  this.standardXHRResponse(this.requests.shift());
  // playlist
  this.standardXHRResponse(this.requests.shift());

  openMediaSource(this.player, this.clock);

  assert.equal(this.requests.length, 0, 'no segment requests');

  // verify stats
  assert.equal(this.player.tech_.vhs.stats.bandwidth, 4194304, 'default bandwidth');
});

QUnit.test('obeys auto preload option', function(assert) {
  this.player.preload('auto');
  // master
  this.standardXHRResponse(this.requests.shift());
  // playlist
  this.standardXHRResponse(this.requests.shift());

  openMediaSource(this.player, this.clock);

  assert.equal(this.requests.length, 1, '1 segment request');

  // verify stats
  assert.equal(this.player.tech_.vhs.stats.bandwidth, 4194304, 'default bandwidth');
});

QUnit.test('passes options to PlaylistLoader', function(assert) {
  const options = {
    src: 'test',
    tech: this.player.tech_
  };

  let controller = new MasterPlaylistController(options);

  assert.notOk(controller.masterPlaylistLoader_.withCredentials, 'credentials wont be sent by default');
  assert.notOk(controller.masterPlaylistLoader_.handleManifestRedirects, 'redirects are ignored by default');

  controller.dispose();

  controller = new MasterPlaylistController(Object.assign({
    withCredentials: true,
    handleManifestRedirects: true
  }, options));

  assert.ok(controller.masterPlaylistLoader_.withCredentials, 'withCredentials enabled');
  assert.ok(controller.masterPlaylistLoader_.handleManifestRedirects, 'handleManifestRedirects enabled');
  controller.dispose();
});

QUnit.test('obeys metadata preload option', function(assert) {
  this.player.preload('metadata');
  // master
  this.standardXHRResponse(this.requests.shift());
  // playlist
  this.standardXHRResponse(this.requests.shift());

  openMediaSource(this.player, this.clock);

  assert.equal(this.requests.length, 1, '1 segment request');

  // verify stats
  assert.equal(this.player.tech_.vhs.stats.bandwidth, 4194304, 'default bandwidth');
});

QUnit.test('creates appropriate PlaylistLoader for sourceType', function(assert) {
  const options = {
    src: 'test',
    tech: this.player.tech_,
    sourceType: 'hls'
  };

  let mpc = new MasterPlaylistController(options);

  assert.ok(
    mpc.masterPlaylistLoader_ instanceof PlaylistLoader,
    'created a standard playlist loader'
  );

  mpc.dispose();
  options.sourceType = 'dash';
  mpc = new MasterPlaylistController(options);

  assert.ok(
    mpc.masterPlaylistLoader_ instanceof DashPlaylistLoader,
    'created a dash playlist loader'
  );
  mpc.dispose();
  options.sourceType = 'vhs-json';
  mpc = new MasterPlaylistController(options);

  assert.ok(
    mpc.masterPlaylistLoader_ instanceof PlaylistLoader,
    'created a standard playlist loader for vhs-json source type'
  );

  mpc.dispose();
});

QUnit.test('passes options to SegmentLoader', function(assert) {
  const options = {
    src: 'test',
    tech: this.player.tech_
  };

  let controller = new MasterPlaylistController(options);

  assert.notOk(controller.mainSegmentLoader_.bandwidth, "bandwidth won't be set by default");
  assert.notOk(controller.mainSegmentLoader_.sourceType_, "sourceType won't be set by default");
  assert.notOk(controller.mainSegmentLoader_.cacheEncryptionKeys_, "cacheEncryptionKeys won't be set by default");

  controller.dispose();

  controller = new MasterPlaylistController(Object.assign({
    bandwidth: 3,
    cacheEncryptionKeys: true,
    sourceType: 'fake-type'
  }, options));

  assert.strictEqual(
    controller.mainSegmentLoader_.bandwidth,
    3,
    'bandwidth will be set'
  );
  assert.strictEqual(
    controller.mainSegmentLoader_.sourceType_,
    'fake-type',
    'sourceType will be set'
  );
  assert.strictEqual(
    controller.mainSegmentLoader_.cacheEncryptionKeys_,
    true,
    'cacheEncryptionKeys will be set'
  );

  controller.dispose();

});

QUnit.test(
  'resets SegmentLoader when seeking out of buffer',
  function(assert) {
    let resets = 0;

    // master
    this.standardXHRResponse(this.requests.shift());
    // media
    this.standardXHRResponse(this.requests.shift());
    this.masterPlaylistController.mediaSource.trigger('sourceopen');

    const mpc = this.masterPlaylistController;
    const segmentLoader = mpc.mainSegmentLoader_;

    segmentLoader.resetEverything = function() {
      resets++;
    };

    let buffered;

    mpc.tech_.buffered = function() {
      return buffered;
    };

    buffered = videojs.createTimeRanges([[0, 20]]);

    mpc.setCurrentTime(10);
    assert.equal(
      resets, 0,
      'does not reset loader when seeking into a buffered region'
    );

    mpc.setCurrentTime(21);
    assert.equal(
      resets, 1,
      'does reset loader when seeking outside of the buffered region'
    );
  }
);

QUnit.test(
  'selects lowest bitrate rendition when enableLowInitialPlaylist is set',
  function(assert) {
    // Set requests.length to 0, otherwise it will use the requests generated in the
    // beforeEach function
    this.requests.length = 0;
    this.player.dispose();
    this.player = createPlayer({ html5: { vhs: { enableLowInitialPlaylist: true } } });

    this.player.src({
      src: 'manifest/master.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    this.clock.tick(1);

    this.masterPlaylistController = this.player.tech_.vhs.masterPlaylistController_;

    let numCallsToSelectInitialPlaylistCalls = 0;
    let numCallsToSelectPlaylist = 0;

    this.masterPlaylistController.selectPlaylist = () => {
      numCallsToSelectPlaylist++;
      return this.masterPlaylistController.master().playlists[0];
    };

    this.masterPlaylistController.selectInitialPlaylist = () => {
      numCallsToSelectInitialPlaylistCalls++;
      return this.masterPlaylistController.master().playlists[0];
    };

    this.masterPlaylistController.mediaSource.trigger('sourceopen');
    // master
    this.standardXHRResponse(this.requests.shift());
    // media
    this.standardXHRResponse(this.requests.shift());

    this.clock.tick(1);

    assert.equal(numCallsToSelectInitialPlaylistCalls, 1, 'selectInitialPlaylist');
    assert.equal(numCallsToSelectPlaylist, 0, 'selectPlaylist');

    // Simulate a live reload
    this.masterPlaylistController.masterPlaylistLoader_.trigger('loadedplaylist');

    assert.equal(numCallsToSelectInitialPlaylistCalls, 1, 'selectInitialPlaylist');
    assert.equal(numCallsToSelectPlaylist, 0, 'selectPlaylist');
  }
);

QUnit.test('resyncs SegmentLoader for a smooth quality change', function(assert) {
  let resyncs = 0;

  this.masterPlaylistController.mediaSource.trigger('sourceopen');
  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  const segmentLoader = this.masterPlaylistController.mainSegmentLoader_;
  const originalResync = segmentLoader.resyncLoader;

  segmentLoader.resyncLoader = function() {
    resyncs++;
    originalResync.call(segmentLoader);
  };

  this.masterPlaylistController.selectPlaylist = () => {
    return this.masterPlaylistController.master().playlists[0];
  };

  this.masterPlaylistController.smoothQualityChange_();

  assert.equal(resyncs, 1, 'resynced the segmentLoader');

  // verify stats
  assert.equal(this.player.tech_.vhs.stats.bandwidth, 4194304, 'default bandwidth');
});

QUnit.test(
  'does not resync the segmentLoader when no smooth quality change occurs',
  function(assert) {
    let resyncs = 0;

    // master
    this.standardXHRResponse(this.requests.shift());
    // media
    this.standardXHRResponse(this.requests.shift());
    this.masterPlaylistController.mediaSource.trigger('sourceopen');

    const segmentLoader = this.masterPlaylistController.mainSegmentLoader_;
    const originalResync = segmentLoader.resyncLoader;

    segmentLoader.resyncLoader = function() {
      resyncs++;
      originalResync.call(segmentLoader);
    };

    this.masterPlaylistController.smoothQualityChange_();

    assert.equal(resyncs, 0, 'did not resync the segmentLoader');
    // verify stats
    assert.equal(this.player.tech_.vhs.stats.bandwidth, 4194304, 'default bandwidth');
  }
);

QUnit.test('smooth quality change resyncs audio segment loader', function(assert) {
  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'alternate-audio-multiple-groups.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  const masterPlaylistController = this.player.tech_.vhs.masterPlaylistController_;

  masterPlaylistController.selectPlaylist = () => {
    return masterPlaylistController.master().playlists[0];
  };

  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  masterPlaylistController.mediaSource.trigger('sourceopen');

  this.clock.tick(1);

  this.player.audioTracks()[0].enabled = true;

  let resyncs = 0;
  let resets = 0;
  const realReset = masterPlaylistController.audioSegmentLoader_.resetLoader;

  masterPlaylistController.audioSegmentLoader_.resetLoader = function() {
    resets++;
    realReset.call(this);
  };

  const originalResync = masterPlaylistController.audioSegmentLoader_.resyncLoader;

  masterPlaylistController.audioSegmentLoader_.resyncLoader = function() {
    resyncs++;
    originalResync.call(masterPlaylistController.audioSegmentLoader_);
  };

  masterPlaylistController.smoothQualityChange_();
  assert.equal(resyncs, 0, 'does not resync the audio segment loader when media same');

  // force different media
  masterPlaylistController.selectPlaylist = () => {
    return masterPlaylistController.master().playlists[1];
  };

  assert.equal(this.requests.length, 3, 'three requests');
  assert.ok(
    this.requests[0].url.endsWith('eng/prog_index.m3u8'),
    'requests eng playlist'
  );
  assert.ok(this.requests[1].url.endsWith('lo/main.mp4'), 'correct segment url');
  assert.equal(
    this.requests[1].requestHeaders.Range,
    'bytes=0-603',
    'requests init segment byte range'
  );
  assert.ok(this.requests[2].url.endsWith('lo/main.mp4'), 'correct segment url');
  assert.equal(
    this.requests[2].requestHeaders.Range,
    'bytes=604-118754',
    'requests segment byte range'
  );
  assert.notOk(this.requests[0].aborted, 'did not abort alt audio playlist request');
  assert.notOk(this.requests[1].aborted, 'did not abort init request');
  assert.notOk(this.requests[2].aborted, 'did not abort segment request');
  masterPlaylistController.smoothQualityChange_();
  assert.equal(this.requests.length, 4, 'added a request for new media');
  assert.notOk(this.requests[0].aborted, 'did not abort alt audio playlist request');
  assert.ok(this.requests[1].aborted, 'aborted init segment request');
  assert.ok(this.requests[2].aborted, 'aborted segment request');
  assert.equal(resyncs, 0, 'does not resync the audio segment loader yet');
  // new media request
  this.standardXHRResponse(this.requests[3]);
  assert.equal(resyncs, 1, 'resyncs the audio segment loader when media changes');
  assert.equal(resets, 0, 'does not reset the audio segment loader when media changes');
});

QUnit.test('resets everything for a fast quality change', function(assert) {
  let resyncs = 0;
  let resets = 0;
  let removeFuncArgs = {};

  this.masterPlaylistController.mediaSource.trigger('sourceopen');
  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  const segmentLoader = this.masterPlaylistController.mainSegmentLoader_;
  const originalResync = segmentLoader.resyncLoader;

  segmentLoader.resyncLoader = function() {
    resyncs++;
    originalResync.call(segmentLoader);
  };

  const origResetEverything = segmentLoader.resetEverything;
  const origRemove = segmentLoader.remove;

  segmentLoader.resetEverything = () => {
    resets++;
    origResetEverything.call(segmentLoader);
  };

  segmentLoader.remove = (start, end) => {
    assert.equal(end, Infinity, 'on a remove all, end should be Infinity');

    origRemove.call(segmentLoader, start, end);
  };

  segmentLoader.currentMediaInfo_ = { hasVideo: true };
  segmentLoader.audioDisabled_ = true;

  segmentLoader.sourceUpdater_.removeVideo = function(start, end) {
    removeFuncArgs = {
      start,
      end
    };
  };

  segmentLoader.duration_ = () => 60;

  // media is unchanged
  this.masterPlaylistController.fastQualityChange_();

  assert.equal(resyncs, 0, 'does not resync segment loader if media is unchanged');

  assert.equal(resets, 0, 'resetEverything not called if media is unchanged');

  assert.deepEqual(removeFuncArgs, {}, 'remove() not called if media is unchanged');

  // media is changed
  this.masterPlaylistController.selectPlaylist = () => {
    return this.masterPlaylistController.master().playlists[0];
  };

  this.masterPlaylistController.fastQualityChange_();

  assert.equal(resyncs, 1, 'resynced segment loader if media is changed');

  assert.equal(resets, 1, 'resetEverything called if media is changed');

  assert.deepEqual(removeFuncArgs, {start: 0, end: 60}, 'remove() called with correct arguments if media is changed');
});

QUnit.test('seeks in place for fast quality switch on non-IE/Edge browsers', function(assert) {
  let seeks = 0;

  this.masterPlaylistController.mediaSource.trigger('sourceopen');
  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  const segmentLoader = this.masterPlaylistController.mainSegmentLoader_;

  return requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader,
    clock: this.clock
  }).then(() => {
    // media is changed
    this.masterPlaylistController.selectPlaylist = () => {
      return this.masterPlaylistController.master().playlists[0];
    };

    this.player.tech_.on('seeking', function() {
      seeks++;
    });

    let timeBeforeSwitch = this.player.currentTime();

    // mock buffered values so removes are processed
    segmentLoader.sourceUpdater_.audioBuffer.buffered = videojs.createTimeRanges([[0, 10]]);
    segmentLoader.sourceUpdater_.videoBuffer.buffered = videojs.createTimeRanges([[0, 10]]);

    this.masterPlaylistController.fastQualityChange_();
    // trigger updateend to indicate the end of the remove operation
    segmentLoader.sourceUpdater_.audioBuffer.trigger('updateend');
    segmentLoader.sourceUpdater_.videoBuffer.trigger('updateend');
    this.clock.tick(1);

    // we seek an additional 0.04s on edge and ie
    if (videojs.browser.IS_EDGE || videojs.browser.IE_VERSION) {
      timeBeforeSwitch += 0.04;
    }
    assert.equal(
      this.player.currentTime(),
      timeBeforeSwitch,
      'current time remains the same on fast quality switch'
    );
    assert.equal(seeks, 1, 'seek event occurs on fast quality switch');
  });
});

QUnit.test('seeks forward 0.04 sec for fast quality switch on Edge', function(assert) {
  const oldIEVersion = videojs.browser.IE_VERSION;
  const oldIsEdge = videojs.browser.IS_EDGE;
  let seeks = 0;

  this.masterPlaylistController.mediaSource.trigger('sourceopen');
  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  const segmentLoader = this.masterPlaylistController.mainSegmentLoader_;

  return requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader,
    clock: this.clock
  }).then(() => {
    // media is changed
    this.masterPlaylistController.selectPlaylist = () => {
      return this.masterPlaylistController.master().playlists[0];
    };

    this.player.tech_.on('seeking', function() {
      seeks++;
    });

    const timeBeforeSwitch = this.player.currentTime();

    videojs.browser.IE_VERSION = null;
    videojs.browser.IS_EDGE = true;

    // mock buffered values so removes are processed
    segmentLoader.sourceUpdater_.audioBuffer.buffered = videojs.createTimeRanges([[0, 10]]);
    segmentLoader.sourceUpdater_.videoBuffer.buffered = videojs.createTimeRanges([[0, 10]]);

    this.masterPlaylistController.fastQualityChange_();
    // trigger updateend to indicate the end of the remove operation
    segmentLoader.sourceUpdater_.audioBuffer.trigger('updateend');
    segmentLoader.sourceUpdater_.videoBuffer.trigger('updateend');
    this.clock.tick(1);

    assert.equal(
      this.player.currentTime(),
      timeBeforeSwitch + 0.04,
      'seeks forward on fast quality switch'
    );
    assert.equal(seeks, 1, 'seek event occurs on fast quality switch');

    videojs.browser.IE_VERSION = oldIEVersion;
    videojs.browser.IS_EDGE = oldIsEdge;
  });
});

QUnit.test('seeks forward 0.04 sec for fast quality switch on IE', function(assert) {
  const oldIEVersion = videojs.browser.IE_VERSION;
  const oldIsEdge = videojs.browser.IS_EDGE;
  let seeks = 0;

  this.masterPlaylistController.mediaSource.trigger('sourceopen');
  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  const segmentLoader = this.masterPlaylistController.mainSegmentLoader_;

  return requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader,
    clock: this.clock
  }).then(() => {
    // media is changed
    this.masterPlaylistController.selectPlaylist = () => {
      return this.masterPlaylistController.master().playlists[0];
    };

    this.player.tech_.on('seeking', function() {
      seeks++;
    });

    const timeBeforeSwitch = this.player.currentTime();

    videojs.browser.IE_VERSION = 11;
    videojs.browser.IS_EDGE = false;

    // mock buffered values so removes are processed
    segmentLoader.sourceUpdater_.audioBuffer.buffered = videojs.createTimeRanges([[0, 10]]);
    segmentLoader.sourceUpdater_.videoBuffer.buffered = videojs.createTimeRanges([[0, 10]]);

    this.masterPlaylistController.fastQualityChange_();
    // trigger updateend to indicate the end of the remove operation
    segmentLoader.sourceUpdater_.audioBuffer.trigger('updateend');
    segmentLoader.sourceUpdater_.videoBuffer.trigger('updateend');
    this.clock.tick(1);

    assert.equal(
      this.player.currentTime(),
      timeBeforeSwitch + 0.04,
      'seeks forward on fast quality switch'
    );
    assert.equal(seeks, 1, 'seek event occurs on fast quality switch');

    videojs.browser.IE_VERSION = oldIEVersion;
    videojs.browser.IS_EDGE = oldIsEdge;
  });
});

QUnit.test('audio segment loader is reset on audio track change', function(assert) {
  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'alternate-audio-multiple-groups.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  const masterPlaylistController = this.player.tech_.vhs.masterPlaylistController_;

  masterPlaylistController.selectPlaylist = () => {
    return masterPlaylistController.master().playlists[0];
  };

  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  masterPlaylistController.mediaSource.trigger('sourceopen');

  let resyncs = 0;
  let resets = 0;
  const realReset = masterPlaylistController.audioSegmentLoader_.resetLoader;

  masterPlaylistController.audioSegmentLoader_.resetLoader = function() {
    resets++;
    realReset.call(this);
  };

  const originalResync = masterPlaylistController.audioSegmentLoader_.resyncLoader;

  masterPlaylistController.audioSegmentLoader_.resyncLoader = function() {
    resyncs++;
    originalResync.call(this);
  };

  assert.equal(this.requests.length, 3, 'three requests');
  assert.ok(
    this.requests[0].url.endsWith('eng/prog_index.m3u8'),
    'requests eng playlist'
  );
  assert.ok(this.requests[1].url.endsWith('lo/main.mp4'), 'correct segment url');
  assert.equal(
    this.requests[1].requestHeaders.Range,
    'bytes=0-603',
    'requests init segment byte range'
  );
  assert.ok(this.requests[2].url.endsWith('lo/main.mp4'), 'correct segment url');
  assert.equal(
    this.requests[2].requestHeaders.Range,
    'bytes=604-118754',
    'requests segment byte range'
  );
  assert.notOk(this.requests[0].aborted, 'did not abort alt audio playlist request');
  assert.notOk(this.requests[1].aborted, 'did not abort init request');
  assert.notOk(this.requests[2].aborted, 'did not abort segment request');
  assert.equal(resyncs, 0, 'does not resync the audio segment loader yet');

  this.player.audioTracks()[1].enabled = true;

  assert.equal(this.requests.length, 4, 'added a request for new media');
  assert.ok(this.requests[0].aborted, 'aborted old alt audio playlist request');
  assert.notOk(this.requests[1].aborted, 'did not abort init request');
  assert.notOk(this.requests[2].aborted, 'did not abort segment request');
  assert.ok(
    this.requests[3].url.endsWith('esp/prog_index.m3u8'),
    'requests esp playlist'
  );
  assert.equal(resyncs, 1, 'resyncs the audio segment loader when audio track changes');
  assert.equal(resets, 1, 'resets the audio segment loader when audio track changes');
});

QUnit.test('if buffered, will request second segment byte range', function(assert) {
  this.requests.length = 0;
  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.masterPlaylistController = this.player.tech_.vhs.masterPlaylistController_;
  // Make segment metadata noop since most test segments dont have real data
  this.masterPlaylistController.mainSegmentLoader_.addSegmentMetadataCue_ = () => {};

  // mock that the user has played the video before
  this.player.tech_.triggerReady();
  this.clock.tick(1);
  this.player.tech_.trigger('play');
  this.player.tech_.paused_ = false;
  this.player.tech_.played = () => videojs.createTimeRanges([[0, 20]]);

  openMediaSource(this.player, this.clock);
  // playlist
  this.standardXHRResponse(this.requests[0]);

  this.masterPlaylistController.mainSegmentLoader_.sourceUpdater_.buffered = () => {
    return videojs.createTimeRanges([[0, 20]]);
  };
  this.clock.tick(1);
  // segment
  this.standardXHRResponse(this.requests[1], muxedSegment());
  return new Promise((resolve, reject) => {
    this.masterPlaylistController.mainSegmentLoader_.on('appending', resolve);
  }).then(() => {
    this.masterPlaylistController.mainSegmentLoader_.fetchAtBuffer_ = true;
    // source buffers are mocked, so must manually trigger update ends on audio and video
    // buffers
    this.masterPlaylistController.mediaSource.sourceBuffers[0].trigger('updateend');
    this.masterPlaylistController.mediaSource.sourceBuffers[1].trigger('updateend');
    this.clock.tick(10 * 1000);
    this.clock.tick(1);
    assert.equal(this.requests[2].headers.Range, 'bytes=522828-1110327');
  });
});

QUnit.test(
  're-initializes the combined playlist loader when switching sources',
  function(assert) {
    openMediaSource(this.player, this.clock);
    // master
    this.standardXHRResponse(this.requests.shift());
    // playlist
    this.standardXHRResponse(this.requests.shift());
    // segment
    this.standardXHRResponse(this.requests.shift(), muxedSegment());
    // change the source
    this.player.src({
      src: 'manifest/master.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    this.clock.tick(1);

    this.masterPlaylistController = this.player.tech_.vhs.masterPlaylistController_;
    // Make segment metadata noop since most test segments dont have real data
    this.masterPlaylistController.mainSegmentLoader_.addSegmentMetadataCue_ = () => {};

    // maybe not needed if https://github.com/videojs/video.js/issues/2326 gets fixed
    this.clock.tick(1);
    assert.ok(
      !this.masterPlaylistController.masterPlaylistLoader_.media(),
      'no media playlist'
    );
    assert.equal(
      this.masterPlaylistController.masterPlaylistLoader_.state,
      'HAVE_NOTHING',
      'reset the playlist loader state'
    );
    assert.equal(this.requests.length, 1, 'requested the new src');

    // buffer check
    this.clock.tick(10 * 1000);
    assert.equal(this.requests.length, 1, 'did not request a stale segment');

    // sourceopen
    openMediaSource(this.player, this.clock);

    assert.equal(this.requests.length, 1, 'made one request');
    assert.ok(
      this.requests[0].url.indexOf('master.m3u8') >= 0,
      'requested only the new playlist'
    );
  }
);

QUnit.test('excludes playlists with unsupported codecs before initial selection', function(assert) {
  this.masterPlaylistController.selectPlaylist = () => {
    assert.equal(
      this.masterPlaylistController.master().playlists[0].excludeUntil,
      Infinity,
      'excludes unsupported playlist before initial selection'
    );
  };

  openMediaSource(this.player, this.clock);

  // master
  this.requests.shift().respond(
    200, null,
    '#EXTM3U\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="theora,mp4a.40.5"\n' +
    'media.m3u8\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=10000,CODECS="avc1.4d400d,mp4a.40.2"\n' +
    'media1.m3u8\n'
  );

  // media
  this.standardXHRResponse(this.requests.shift());
});

QUnit.test(
  'updates the combined segment loader on live playlist refreshes',
  function(assert) {
    const updates = [];

    openMediaSource(this.player, this.clock);
    // master
    this.standardXHRResponse(this.requests.shift());
    // media
    this.standardXHRResponse(this.requests.shift());

    this.masterPlaylistController.mainSegmentLoader_.playlist = function(update) {
      updates.push(update);
    };

    this.masterPlaylistController.masterPlaylistLoader_.trigger('loadedplaylist');
    assert.equal(updates.length, 1, 'updated the segment list');
    // verify stats
    assert.equal(this.player.tech_.vhs.stats.bandwidth, 4194304, 'default bandwidth');
  }
);

QUnit.test(
  'fires a progress event after downloading a segment from combined segment loader',
  function(assert) {
    let progressCount = 0;

    openMediaSource(this.player, this.clock);

    // master
    this.standardXHRResponse(this.requests.shift());
    // media
    this.standardXHRResponse(this.requests.shift());

    this.player.tech_.on('progress', function() {
      progressCount++;
    });

    // 1ms for request duration
    this.clock.tick(1);
    this.standardXHRResponse(this.requests.shift(), muxedSegment());

    this.masterPlaylistController.mainSegmentLoader_.trigger('progress');
    // note that there are two progress events as one is fired on finish
    assert.equal(progressCount, 2, 'fired a progress event');
  }
);

QUnit.test(
  'updates the active loader when switching from unmuxed to muxed audio group',
  function(assert) {
    openMediaSource(this.player, this.clock);
    // master
    this.requests.shift().respond(
      200, null,
      manifests.multipleAudioGroupsCombinedMain
    );
    // media
    this.standardXHRResponse(this.requests.shift());
    // init segment
    this.standardXHRResponse(this.requests.shift());
    // video segment
    this.standardXHRResponse(this.requests.shift(), mp4VideoInitSegment());
    // audio media
    this.standardXHRResponse(this.requests.shift());
    // ignore audio segment requests
    this.requests.length = 0;

    const mpc = this.masterPlaylistController;
    const combinedPlaylist = mpc.master().playlists[0];

    assert.ok(
      mpc.mediaTypes_.AUDIO.activePlaylistLoader,
      'starts with an active playlist loader'
    );

    mpc.masterPlaylistLoader_.media(combinedPlaylist);
    // updated media
    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
                                '#EXTINF:5.0\n' +
                                '0.ts\n' +
                                '#EXT-X-ENDLIST\n'
    );

    assert.notOk(
      mpc.mediaTypes_.AUDIO.activePlaylistLoader,
      'enabled a track in the new audio group'
    );
  }
);

QUnit.test('waits for both main and audio loaders to finish before calling endOfStream', function(assert) {
  openMediaSource(this.player, this.clock);

  const videoMedia = '#EXTM3U\n' +
                     '#EXT-X-VERSION:3\n' +
                     '#EXT-X-PLAYLIST-TYPE:VOD\n' +
                     '#EXT-X-MEDIA-SEQUENCE:0\n' +
                     '#EXT-X-TARGETDURATION:10\n' +
                     '#EXTINF:10,\n' +
                     'video-0.ts\n' +
                     '#EXT-X-ENDLIST\n';

  const audioMedia = '#EXTM3U\n' +
                     '#EXT-X-VERSION:3\n' +
                     '#EXT-X-PLAYLIST-TYPE:VOD\n' +
                     '#EXT-X-MEDIA-SEQUENCE:0\n' +
                     '#EXT-X-TARGETDURATION:10\n' +
                     '#EXTINF:10,\n' +
                     'audio-0.ts\n' +
                     '#EXT-X-ENDLIST\n';

  let videoEnded = 0;
  let audioEnded = 0;

  const MPC = this.masterPlaylistController;

  MPC.mainSegmentLoader_.on('ended', () => videoEnded++);
  MPC.audioSegmentLoader_.on('ended', () => audioEnded++);

  MPC.mainSegmentLoader_.currentMediaInfo_ = { hasVideo: true };
  MPC.audioSegmentLoader_.currentMediaInfo_ = { hasAudio: true };

  // master
  this.standardXHRResponse(this.requests.shift(), manifests.demuxed);

  // video media
  this.standardXHRResponse(this.requests.shift(), videoMedia);

  // audio media
  this.standardXHRResponse(this.requests.shift(), audioMedia);

  return Promise.all([requestAndAppendSegment({
    request: this.requests.shift(),
    segment: videoSegment(),
    isOnlyVideo: true,
    segmentLoader: MPC.mainSegmentLoader_,
    clock: this.clock
  }), requestAndAppendSegment({
    request: this.requests.shift(),
    segment: audioSegment(),
    isOnlyAudio: true,
    segmentLoader: MPC.audioSegmentLoader_,
    clock: this.clock
  })]).then(() => {
    assert.equal(videoEnded, 1, 'main segment loader did not trigger ended again');
    assert.equal(audioEnded, 1, 'audio segment loader triggered ended');
    assert.equal(MPC.mediaSource.readyState, 'ended', 'Media Source ended');
  });
});

// TODO once we have support for audio only with alternate audio, we should have a test
// for: "does not wait for main loader to finish before calling endOfStream with audio
// only stream and alternate audio active." This will require changes in segment loader to
// handle disabled audio on the main stream, as well as potential media group changes and
// master playlist controller changes to use measurements from the audio segment loader as
// the primary source when main is disabled.

QUnit.test('Segment loaders are unpaused when seeking after player has ended', function(assert) {
  openMediaSource(this.player, this.clock);

  const videoMedia = '#EXTM3U\n' +
                     '#EXT-X-VERSION:3\n' +
                     '#EXT-X-PLAYLIST-TYPE:VOD\n' +
                     '#EXT-X-MEDIA-SEQUENCE:0\n' +
                     '#EXT-X-TARGETDURATION:10\n' +
                     '#EXTINF:10,\n' +
                     'video-0.ts\n' +
                     '#EXT-X-ENDLIST\n';

  let ended = 0;

  this.masterPlaylistController.mainSegmentLoader_.on('ended', () => ended++);

  this.player.tech_.trigger('play');

  // master
  this.standardXHRResponse(this.requests.shift());

  // media
  this.standardXHRResponse(this.requests.shift(), videoMedia);

  // segment
  this.standardXHRResponse(this.requests.shift(), muxedSegment());

  return new Promise((resolve, reject) => {
    this.masterPlaylistController.mainSegmentLoader_.one('appending', resolve);
  }).then(() => {
    assert.notOk(
      this.masterPlaylistController.mainSegmentLoader_.paused(),
      'segment loader not yet paused'
    );

    // source buffers are mocked, so must manually trigger update ends on audio and video
    // buffers
    this.masterPlaylistController.mediaSource.sourceBuffers[0].trigger('updateend');
    this.masterPlaylistController.mediaSource.sourceBuffers[1].trigger('updateend');

    assert.ok(
      this.masterPlaylistController.mainSegmentLoader_.paused(),
      'segment loader is paused after ending'
    );
    assert.equal(ended, 1, 'segment loader triggered ended event');

    this.player.currentTime(5);

    this.clock.tick(1);

    assert.notOk(
      this.masterPlaylistController.mainSegmentLoader_.paused(),
      'segment loader unpaused after a seek'
    );
    assert.equal(ended, 1, 'segment loader did not trigger ended event again yet');
  });
});

QUnit.test('detects if the player is stuck at the playlist end', function(assert) {
  const playlistCopy = Vhs.Playlist.playlistEnd;

  this.masterPlaylistController.mediaSource.trigger('sourceopen');
  this.standardXHRResponse(this.requests.shift());
  const playlist = this.player.tech_.vhs.selectPlaylist();

  // not stuck at playlist end when no seekable, even if empty buffer
  // and positive currentTime
  this.masterPlaylistController.seekable = () => videojs.createTimeRange();
  this.player.tech_.buffered = () => videojs.createTimeRange();
  this.player.tech_.setCurrentTime(170);
  assert.ok(
    !this.masterPlaylistController.stuckAtPlaylistEnd_(playlist),
    'not stuck at playlist end'
  );

  // not stuck at playlist end when no seekable, even if empty buffer
  // and currentTime 0
  this.player.tech_.setCurrentTime(0);
  assert.ok(
    !this.masterPlaylistController.stuckAtPlaylistEnd_(playlist),
    'not stuck at playlist end'
  );

  // not stuck at playlist end when no seekable but current time is at
  // the end of the buffered range
  this.player.tech_.buffered = () => videojs.createTimeRange(0, 170);
  assert.ok(
    !this.masterPlaylistController.stuckAtPlaylistEnd_(playlist),
    'not stuck at playlist end'
  );

  // not stuck at playlist end when currentTime not at seekable end
  // even if the buffer is empty
  this.masterPlaylistController.seekable = () => videojs.createTimeRange(0, 130);
  this.masterPlaylistController.syncController_.getExpiredTime = () => 0;
  this.player.tech_.setCurrentTime(50);
  this.player.tech_.buffered = () => videojs.createTimeRange();
  Vhs.Playlist.playlistEnd = () => 130;
  assert.ok(
    !this.masterPlaylistController.stuckAtPlaylistEnd_(playlist),
    'not stuck at playlist end'
  );

  // not stuck at playlist end when buffer reached the absolute end of the playlist
  // and current time is in the buffered range
  this.player.tech_.setCurrentTime(159);
  this.player.tech_.buffered = () => videojs.createTimeRange(0, 160);
  Vhs.Playlist.playlistEnd = () => 160;
  assert.ok(
    !this.masterPlaylistController.stuckAtPlaylistEnd_(playlist),
    'not stuck at playlist end'
  );

  // stuck at playlist end when there is no buffer and playhead
  // reached absolute end of playlist
  this.player.tech_.setCurrentTime(160);
  assert.ok(
    this.masterPlaylistController.stuckAtPlaylistEnd_(playlist),
    'stuck at playlist end'
  );

  // stuck at playlist end when current time reached the buffer end
  // and buffer has reached absolute end of playlist
  this.masterPlaylistController.seekable = () => videojs.createTimeRange(90, 130);
  this.player.tech_.buffered = () => videojs.createTimeRange(0, 170);
  this.player.tech_.setCurrentTime(170);
  Vhs.Playlist.playlistEnd = () => 170;
  assert.ok(
    this.masterPlaylistController.stuckAtPlaylistEnd_(playlist),
    'stuck at playlist end'
  );

  Vhs.Playlist.playlistEnd = playlistCopy;
});

QUnit.test('blacklists switching from video+audio playlists to audio only', function(assert) {
  openMediaSource(this.player, this.clock);

  this.player.tech_.vhs.bandwidth = 1e10;

  // master
  this.requests.shift().respond(
    200, null,
    '#EXTM3U\n' +
                                '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="mp4a.40.2"\n' +
                                'media.m3u8\n' +
                                '#EXT-X-STREAM-INF:BANDWIDTH=10,RESOLUTION=1x1\n' +
                                'media1.m3u8\n'
  );
  // media1
  this.standardXHRResponse(this.requests.shift());

  const mpc = this.masterPlaylistController;
  let debugLogs = [];

  mpc.logger_ = (...logs) => {
    debugLogs = debugLogs.concat(logs);
  };
  // segment must be appended before the blacklist logic runs
  return requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock
  }).then(() => {
    assert.equal(
      mpc.masterPlaylistLoader_.media(),
      mpc.masterPlaylistLoader_.master.playlists[1],
      'selected video+audio'
    );

    const audioPlaylist = mpc.masterPlaylistLoader_.master.playlists[0];

    assert.equal(audioPlaylist.excludeUntil, Infinity, 'excluded incompatible playlist');
    assert.notEqual(
      debugLogs.indexOf('blacklisting 0-media.m3u8: codec count "1" !== "2"'),
      -1,
      'debug logs about codec count'
    );
  });
});

QUnit.test('blacklists switching from audio-only playlists to video+audio', function(assert) {
  openMediaSource(this.player, this.clock);

  this.player.tech_.vhs.bandwidth = 1;

  // master
  this.requests.shift().respond(
    200, null,
    '#EXTM3U\n' +
                                '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="mp4a.40.2"\n' +
                                'media.m3u8\n' +
                                '#EXT-X-STREAM-INF:BANDWIDTH=10,RESOLUTION=1x1\n' +
                                'media1.m3u8\n'
  );

  // media1
  this.standardXHRResponse(this.requests.shift());

  const mpc = this.masterPlaylistController;
  let debugLogs = [];

  mpc.logger_ = (...logs) => {
    debugLogs = debugLogs.concat(logs);
  };
  // segment must be appended before the blacklist logic runs
  return requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: mpc.mainSegmentLoader_,
    segment: audioSegment(),
    isOnlyAudio: true,
    clock: this.clock
  }).then(() => {
    assert.equal(
      mpc.masterPlaylistLoader_.media(),
      mpc.masterPlaylistLoader_.master.playlists[0],
      'selected audio only'
    );

    const videoAudioPlaylist = mpc.masterPlaylistLoader_.master.playlists[1];

    assert.equal(
      videoAudioPlaylist.excludeUntil,
      Infinity,
      'excluded incompatible playlist'
    );

    assert.notEqual(
      debugLogs.indexOf('blacklisting 1-media1.m3u8: codec count "2" !== "1"'),
      -1,
      'debug logs about codec count'
    );
  });
});

QUnit.test('blacklists switching from video-only playlists to video+audio', function(assert) {
  openMediaSource(this.player, this.clock);

  this.player.tech_.vhs.bandwidth = 1;

  // master
  this.requests.shift()
    .respond(
      200, null,
      '#EXTM3U\n' +
             '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d"\n' +
             'media.m3u8\n' +
             '#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400d,mp4a.40.2"\n' +
             'media1.m3u8\n'
    );

  // media
  this.standardXHRResponse(this.requests.shift());

  const mpc = this.masterPlaylistController;
  let debugLogs = [];

  mpc.logger_ = (...logs) => {
    debugLogs = debugLogs.concat(logs);
  };

  // segment must be appended before the blacklist logic runs
  return requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: mpc.mainSegmentLoader_,
    segment: videoSegment(),
    isOnlyVideo: true,
    clock: this.clock
  }).then(() => {
    assert.equal(
      mpc.masterPlaylistLoader_.media(),
      mpc.masterPlaylistLoader_.master.playlists[0],
      'selected video only'
    );

    const videoAudioPlaylist = mpc.masterPlaylistLoader_.master.playlists[1];

    assert.equal(
      videoAudioPlaylist.excludeUntil,
      Infinity,
      'excluded incompatible playlist'
    );
    assert.notEqual(
      debugLogs.indexOf('blacklisting 1-media1.m3u8: codec count "2" !== "1"'),
      -1,
      'debug logs about codec count'
    );
  });
});

QUnit.test('blacklists switching between playlists with different codecs', function(assert) {
  openMediaSource(this.player, this.clock);

  this.player.tech_.vhs.bandwidth = 1;

  const mpc = this.masterPlaylistController;

  // don't exclude unsupported variants now so we can
  // keep them until until later on.
  mpc.excludeUnsupportedVariants_ = () => {};
  mpc.sourceUpdater_.canChangeType = () => false;

  // master
  this.requests.shift()
    .respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.5"\n' +
      'media.m3u8\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="hvc1,mp4a"\n' +
      'media1.m3u8\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400d,ac-3"\n' +
      'media2.m3u8\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="hvc1,ac-3"\n' +
      'media3.m3u8\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400e,mp4a.40.7"\n' +
      'media4.m3u8\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="ac-3"\n' +
      'media5.m3u8\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="hvc1"\n' +
      'media6.m3u8\n'
    );

  // media
  this.standardXHRResponse(this.requests.shift());
  assert.equal(
    this.masterPlaylistController.masterPlaylistLoader_.media(),
    this.masterPlaylistController.masterPlaylistLoader_.master.playlists[0],
    'selected HE-AAC stream'
  );

  let debugLogs = [];

  mpc.logger_ = (...logs) => {
    debugLogs = debugLogs.concat(logs);
  };

  // segment must be appended before the blacklist logic runs
  return requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock
  }).then(() => {
    const playlists = mpc.masterPlaylistLoader_.master.playlists;

    assert.equal(typeof playlists[0].excludeUntil, 'undefined', 'did not blacklist first playlist');
    assert.equal(playlists[1].excludeUntil, Infinity, 'blacklistlisted second playlist');
    assert.equal(playlists[2].excludeUntil, Infinity, 'blacklistlisted third playlist');
    assert.equal(playlists[3].excludeUntil, Infinity, 'blacklistlisted forth playlist');
    assert.equal(typeof playlists[4].excludeUntil, 'undefined', 'did not blacklist fifth playlist');
    assert.equal(playlists[5].excludeUntil, Infinity, 'blacklistlisted sixth playlist');
    assert.equal(playlists[6].excludeUntil, Infinity, 'blacklistlisted seventh playlist');

    [
      'blacklisting 1-media1.m3u8: video codec "hvc1" !== "avc1"',
      'blacklisting 2-media2.m3u8: audio codec "ac-3" !== "mp4a"',
      'blacklisting 3-media3.m3u8: video codec "hvc1" !== "avc1" && audio codec "ac-3" !== "mp4a"',
      'blacklisting 5-media5.m3u8: codec count "1" !== "2" && audio codec "ac-3" !== "mp4a"',
      'blacklisting 6-media6.m3u8: codec count "1" !== "2" && video codec "hvc1" !== "avc1"'
    ].forEach(function(message) {
      assert.notEqual(
        debugLogs.indexOf(message),
        -1,
        `debug logs ${message}`
      );
    });
  });
});

QUnit.test('does not blacklist switching between playlists with different audio profiles', function(assert) {
  openMediaSource(this.player, this.clock);

  this.player.tech_.vhs.bandwidth = 1;

  // master
  this.requests.shift()
    .respond(
      200, null,
      '#EXTM3U\n' +
             '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.5"\n' +
             'media.m3u8\n' +
             '#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400d,mp4a.40.2"\n' +
             'media1.m3u8\n'
    );

  // media
  this.standardXHRResponse(this.requests.shift());
  assert.equal(
    this.masterPlaylistController.masterPlaylistLoader_.media(),
    this.masterPlaylistController.masterPlaylistLoader_.master.playlists[0],
    'selected HE-AAC stream'
  );

  const mpc = this.masterPlaylistController;

  // segment must be appended before the blacklist logic runs
  return requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock
  }).then(() => {
    const alternatePlaylist = mpc.masterPlaylistLoader_.master.playlists[1];

    assert.equal(alternatePlaylist.excludeUntil, undefined, 'did not exclude playlist');
  });
});

QUnit.test('updates the combined segment loader on media changes', function(assert) {
  const updates = [];

  this.masterPlaylistController.mediaSource.trigger('sourceopen');

  this.masterPlaylistController.mainSegmentLoader_.bandwidth = 1;

  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  this.masterPlaylistController.mainSegmentLoader_.playlist = function(update) {
    updates.push(update);
  };
  // 1ms has passed to upload 1kb
  // that gives us a bandwidth of 1024 / 1 * 8 * 1000 = 8192000
  this.clock.tick(1);

  this.masterPlaylistController.mainSegmentLoader_.mediaIndex = 0;

  const segment = muxedSegment();
  // copy the byte length since the segment bytes get cleared out
  const segmentByteLength = segment.byteLength;

  assert.ok(segmentByteLength, 'the segment has some number of bytes');

  // downloading the new segment will update bandwidth and cause a
  // playlist change
  // segment 0
  this.standardXHRResponse(this.requests.shift(), segment);
  // update the buffer to reflect the appended segment, and have enough buffer to
  // change playlist
  this.masterPlaylistController.tech_.buffered = () => {
    return videojs.createTimeRanges([[0, 30]]);
  };

  this.masterPlaylistController.mainSegmentLoader_.one('appending', () => {
    // source buffers are mocked, so must manually trigger update ends on audio and video
    // buffers
    this.masterPlaylistController.mediaSource.sourceBuffers[0].trigger('updateend');
    this.masterPlaylistController.mediaSource.sourceBuffers[1].trigger('updateend');
    // media
    this.standardXHRResponse(this.requests.shift());
    assert.ok(updates.length > 0, 'updated the segment list');

    // verify stats
    // request duration was 1ms, giving a bandwidth of bytes / 1 * 8 * 1000
    assert.equal(
      this.player.tech_.vhs.stats.bandwidth,
      segmentByteLength / 1 * 8 * 1000,
      'stats has the right bandwidth'
    );
    assert.equal(this.player.tech_.vhs.stats.mediaRequests, 1, '1 segment request');
    assert.equal(
      this.player.tech_.vhs.stats.mediaBytesTransferred,
      segmentByteLength,
      'stats has the right number of bytes transferred'
    );
  });
});

QUnit.test('selects a playlist after main/combined segment downloads', function(assert) {
  let calls = 0;

  this.masterPlaylistController.selectPlaylist = () => {
    calls++;
    return this.masterPlaylistController.masterPlaylistLoader_.master.playlists[0];
  };
  this.masterPlaylistController.mediaSource.trigger('sourceopen');

  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  // "downloaded" a segment
  this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
  assert.strictEqual(calls, 2, 'selects after the initial segment');

  // and another
  this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
  assert.strictEqual(calls, 3, 'selects after additional segments');
  // verify stats
  assert.equal(this.player.tech_.vhs.stats.bandwidth, 4194304, 'default bandwidth');
});

QUnit.test('does not select a playlist after segment downloads if only one playlist', function(assert) {
  const origWarn = videojs.log.warn;
  let calls = 0;
  const warnings = [];

  videojs.log.warn = (text) => warnings.push(text);
  this.masterPlaylistController.selectPlaylist = () => {
    calls++;
    return null;
  };
  this.masterPlaylistController.mediaSource.trigger('sourceopen');

  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  // "downloaded" a segment
  this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
  assert.strictEqual(calls, 2, 'selects after the initial segment');

  assert.equal(warnings.length, 1, 'one warning logged');
  assert.equal(
    warnings[0],
    'We received no playlist to switch to. Please check your stream.',
    'we logged the correct warning'
  );

  videojs.log.warn = origWarn;
});

QUnit.test('re-triggers bandwidthupdate events on the tech', function(assert) {
  this.masterPlaylistController.mediaSource.trigger('sourceopen');
  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  let bandwidthupdateEvents = 0;

  this.player.tech_.on('bandwidthupdate', () => bandwidthupdateEvents++);

  this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');

  assert.equal(bandwidthupdateEvents, 1, 'triggered bandwidthupdate');

  this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');

  assert.equal(bandwidthupdateEvents, 2, 'triggered bandwidthupdate');
});

QUnit.test(
  'switches to lower renditions immediately, higher dependent on buffer',
  function(assert) {
    this.masterPlaylistController.mediaSource.trigger('sourceopen');
    // master
    this.standardXHRResponse(this.requests.shift());
    // media
    this.standardXHRResponse(this.requests.shift());

    let buffered = [];
    let currentPlaylistBandwidth = 0;
    let nextPlaylistBandwidth = 0;
    const mediaChanges = [];
    let currentTime = 0;
    let endList = true;
    let duration = 100;
    let id = 0;

    this.masterPlaylistController.tech_.currentTime = () => currentTime;
    this.masterPlaylistController.tech_.buffered = () => videojs.createTimeRanges(buffered);
    this.masterPlaylistController.duration = () => duration;
    this.masterPlaylistController.selectPlaylist = () => {
      return {
        id: id++,
        attributes: {
          BANDWIDTH: nextPlaylistBandwidth
        },
        endList
      };
    };
    this.masterPlaylistController.masterPlaylistLoader_.media = (media) => {
      if (!media) {
        return {
          id: id++,
          attributes: {
            BANDWIDTH: currentPlaylistBandwidth
          },
          endList
        };
      }
      mediaChanges.push(media);
    };

    currentTime = 0;
    currentPlaylistBandwidth = 1000;
    nextPlaylistBandwidth = 1000;
    buffered = [];
    this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
    assert.equal(
      mediaChanges.length,
      1,
      'changes media when no buffer and equal bandwidth playlist'
    );
    buffered = [[0, 9]];
    this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
    assert.equal(
      mediaChanges.length,
      2,
      'changes media when sufficient forward buffer and equal ' +
               'bandwidth playlist'
    );
    buffered = [[0, 30]];
    this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
    assert.equal(
      mediaChanges.length,
      3,
      'changes media when sufficient forward buffer and equal ' +
               'bandwidth playlist'
    );

    mediaChanges.length = 0;

    currentTime = 10;
    currentPlaylistBandwidth = 1000;
    nextPlaylistBandwidth = 1001;
    buffered = [];
    this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
    assert.equal(
      mediaChanges.length,
      0,
      'did not change media when no buffer and and higher bandwidth playlist'
    );
    buffered = [[0, 19]];
    this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
    assert.equal(
      mediaChanges.length,
      0,
      'did not change media when insufficient forward buffer and higher ' +
               'bandwidth playlist'
    );
    buffered = [[0, 20]];
    this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
    assert.equal(
      mediaChanges.length,
      1,
      'changes media when sufficient forward buffer and higher ' +
               'bandwidth playlist'
    );
    buffered = [[0, 21]];
    this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
    assert.equal(
      mediaChanges.length,
      2,
      'changes media when sufficient forward buffer and higher ' +
               'bandwidth playlist'
    );

    mediaChanges.length = 0;

    currentTime = 100;
    currentPlaylistBandwidth = 1000;
    nextPlaylistBandwidth = 1001;
    buffered = [];
    this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
    assert.equal(
      mediaChanges.length,
      0,
      'did not change media when no buffer and higher bandwidth playlist'
    );
    buffered = [[0, 100], [100, 109]];
    this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
    assert.equal(
      mediaChanges.length,
      0,
      'did not change media when insufficient forward buffer and higher ' +
               'bandwidth playlist'
    );
    buffered = [[0, 100], [100, 130]];
    this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
    assert.equal(
      mediaChanges.length,
      1,
      'changes media when sufficient forward buffer and higher ' +
               'bandwidth playlist'
    );

    mediaChanges.length = 0;

    buffered = [];
    currentPlaylistBandwidth = 1000;
    nextPlaylistBandwidth = 999;
    this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
    assert.equal(
      mediaChanges.length,
      1,
      'changes media when no buffer but lower bandwidth playlist'
    );
    buffered = [[100, 109]];
    this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
    assert.equal(
      mediaChanges.length,
      2,
      'changes media when insufficient forward buffer but lower ' +
               'bandwidth playlist'
    );
    buffered = [[100, 110]];
    this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
    assert.equal(
      mediaChanges.length,
      3,
      'changes media when sufficient forward buffer and lower ' +
               'bandwidth playlist'
    );

    mediaChanges.length = 0;

    endList = false;
    currentTime = 100;
    currentPlaylistBandwidth = 1000;
    nextPlaylistBandwidth = 1001;
    buffered = [];
    this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
    assert.equal(
      mediaChanges.length,
      1,
      'changes live media when no buffer and higher bandwidth playlist'
    );
    buffered = [[0, 100], [100, 109]];
    this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
    assert.equal(
      mediaChanges.length,
      2,
      'changes live media when insufficient forward buffer and higher ' +
               'bandwidth playlist'
    );
    buffered = [[0, 100], [100, 130]];
    this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
    assert.equal(
      mediaChanges.length,
      3,
      'changes live media when sufficient forward buffer and higher ' +
               'bandwidth playlist'
    );

    mediaChanges.length = 0;

    endList = true;
    currentTime = 9;
    duration = 18;
    buffered = [];
    this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
    assert.equal(
      mediaChanges.length,
      1,
      'changes media when no buffer and duration less than low water line'
    );
    buffered = [[0, 10]];
    this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
    assert.equal(
      mediaChanges.length,
      2,
      'changes media when insufficient forward buffer and duration ' +
               'less than low water line'
    );
  }
);

QUnit.test('blacklists playlist on earlyabort', function(assert) {
  this.masterPlaylistController.mediaSource.trigger('sourceopen');
  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  const mediaChanges = [];
  const playlistLoader = this.masterPlaylistController.masterPlaylistLoader_;
  const currentMedia = playlistLoader.media();
  const origMedia = playlistLoader.media.bind(playlistLoader);
  const origWarn = videojs.log.warn;
  const warnings = [];

  this.masterPlaylistController.masterPlaylistLoader_.media = (media) => {
    if (media) {
      mediaChanges.push(media);
    }
    return origMedia(media);
  };

  videojs.log.warn = (text) => warnings.push(text);

  assert.notOk(currentMedia.excludeUntil > 0, 'playlist not blacklisted');
  assert.equal(mediaChanges.length, 0, 'no media change');

  this.masterPlaylistController.mainSegmentLoader_.trigger('earlyabort');

  assert.ok(currentMedia.excludeUntil > 0, 'playlist blacklisted');
  assert.equal(mediaChanges.length, 1, 'one media change');
  assert.equal(warnings.length, 1, 'one warning logged');
  assert.equal(
    warnings[0],
    `Problem encountered with playlist ${currentMedia.id}. ` +
                 'Aborted early because there isn\'t enough bandwidth to complete the ' +
                 `request without rebuffering. Switching to playlist ${mediaChanges[0].id}.`,
    'warning message is correct'
  );

  videojs.log.warn = origWarn;
});

QUnit.test('does not get stuck in a loop due to inconsistent network/caching', function(assert) {
  /*
   * This test is a long one, but it is meant to follow a true path to a possible loop.
   * The reason for the loop is due to inconsistent network bandwidth, often caused or
   * amplified by caching at the browser or edge server level.
   * The steps are as follows:
   *
   * 1) Request segment 0 from low bandwidth playlist
   * 2) Request segment 1 from low bandwidth playlist
   * 3) Switch up due to good bandwidth (2 segments are required before upswitching)
   * 4) Request segment 0 from high bandwidth playlist
   * 5) Abort request early due to low bandwidth
   * 6) Request segment 0 from low bandwidth playlist
   * 7) Request segment 1 from low bandwidth playlist
   * 8) Request segment 2 from low bandwidth playlist, despite enough bandwidth to
   *    upswitch. This part is the key, as the behavior we want to avoid is an upswitch
   *    back to the high bandwidth playlist (thus starting a potentially infinite loop).
   */

  const mediaContents =
    '#EXTM3U\n' +
    '#EXTINF:10\n' +
    '0.ts\n' +
    '#EXTINF:10\n' +
    '1.ts\n' +
    '#EXTINF:10\n' +
    '2.ts\n' +
    '#EXTINF:10\n' +
    '3.ts\n' +
    '#EXT-X-ENDLIST\n';
  const mpc = this.masterPlaylistController;
  const segmentLoader = mpc.mainSegmentLoader_;

  // start on lowest bandwidth rendition (will be media.m3u8)
  segmentLoader.bandwidth = 0;

  this.player.tech_.paused = () => false;
  mpc.mediaSource.trigger('sourceopen');
  // master
  this.requests.shift().respond(
    200, null,
    '#EXTM3U\n' +
                                '#EXT-X-STREAM-INF:BANDWIDTH=10\n' +
                                'media.m3u8\n' +
                                '#EXT-X-STREAM-INF:BANDWIDTH=100\n' +
                                'media1.m3u8\n'
  );
  // media.m3u8
  this.requests.shift().respond(200, null, mediaContents);

  const playlistLoader = mpc.masterPlaylistLoader_;
  const origMedia = playlistLoader.media.bind(playlistLoader);
  const mediaChanges = [];

  mpc.masterPlaylistLoader_.media = (media) => {
    if (media) {
      mediaChanges.push(media);
    }
    return origMedia(media);
  };

  this.clock.tick(1);

  let segmentRequest = this.requests[0];

  assert.equal(
    segmentRequest.uri.substring(segmentRequest.uri.length - 4),
    '0.ts',
    'requested first segment'
  );

  return requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock,
    bandwidth: 800
  }).then(() => {

    segmentRequest = this.requests[0];

    // should be walking forwards (need two segments before we can switch)
    assert.equal(segmentLoader.bandwidth, 800, 'bandwidth is correct');
    assert.equal(
      segmentRequest.uri.substring(segmentRequest.uri.length - 4),
      '1.ts',
      'requested second segment'
    );
    assert.equal(mediaChanges.length, 0, 'no media changes');

    return requestAndAppendSegment({
      request: this.requests.shift(),
      segmentLoader: mpc.mainSegmentLoader_,
      clock: this.clock,
      bandwidth: 880
    });
  }).then(() => {
    const mediaRequest = this.requests[0];

    // after two segments, bandwidth is high enough to switch up to media1.m3u8
    assert.equal(segmentLoader.bandwidth, 880, 'bandwidth is correct');
    assert.equal(mediaChanges.length, 1, 'changed media');
    assert.equal(mediaChanges[0].uri, 'media1.m3u8', 'changed to media1');
    assert.equal(
      mediaRequest.uri.substring(mediaRequest.uri.length - 'media1.m3u8'.length),
      'media1.m3u8',
      'requested media1'
    );

    // media1.m3u8
    this.requests.shift().respond(200, null, mediaContents);
    this.clock.tick(1);
    segmentRequest = this.requests[0];

    assert.equal(
      segmentLoader.playlist_.uri,
      'media1.m3u8',
      'segment loader playlist is media1'
    );

    const media1ResolvedPlaylist = segmentLoader.playlist_;

    assert.notOk(media1ResolvedPlaylist.excludeUntil, 'media1 not blacklisted');
    assert.equal(
      segmentRequest.uri.substring(segmentRequest.uri.length - 4),
      '0.ts',
      'requested first segment'
    );

    // needs a timeout for early abort to occur (we skip the function otherwise, since no
    // timeout means we are on the last rendition)
    segmentLoader.xhrOptions_.timeout = 60000;
    // we need to wait 1 second from first byte receieved in order to consider aborting
    downloadProgress(this.requests[0], '0');
    this.clock.tick(1000);
    // should abort request early because we don't have enough bandwidth
    downloadProgress(this.requests[0], '00');
    this.clock.tick(1);

    // aborted request, so switched back to lowest rendition
    assert.equal(
      segmentLoader.bandwidth,
      10 * Config.BANDWIDTH_VARIANCE + 1,
      'bandwidth is correct for abort'
    );
    assert.equal(mediaChanges.length, 2, 'changed media');
    assert.equal(mediaChanges[1].uri, 'media.m3u8', 'changed to media');
    assert.ok(media1ResolvedPlaylist.excludeUntil, 'blacklisted media1');
    assert.equal(
      segmentRequest.uri.substring(segmentRequest.uri.length - 4),
      '0.ts',
      'requested first segment'
    );

    // remove aborted request
    this.requests.shift();
    // 1ms for the cached segment response
    this.clock.tick(1);

    return requestAndAppendSegment({
      request: this.requests.shift(),
      segmentLoader: mpc.mainSegmentLoader_,
      clock: this.clock,
      bandwidth: 80000
    });
  }).then(() => {
    segmentRequest = this.requests[0];

    // walking forwards, still need two segments before trying to change rendition
    bandwidthWithinTolerance(segmentLoader.bandwidth, 80000, 'bandwidth is correct');
    assert.equal(mediaChanges.length, 2, 'did not change media');
    assert.equal(
      segmentRequest.uri.substring(segmentRequest.uri.length - 4),
      '1.ts',
      'requested second segment'
    );

    // 1ms for the cached segment response
    this.clock.tick(1);

    return requestAndAppendSegment({
      request: this.requests.shift(),
      segmentLoader: mpc.mainSegmentLoader_,
      clock: this.clock,
      bandwidth: 88000
    });
  }).then(() => {
    bandwidthWithinTolerance(segmentLoader.bandwidth, 88000, 'bandwidth is correct');
    assert.equal(mediaChanges.length, 2, 'did not change media');
    assert.equal(mediaChanges[1].uri, 'media.m3u8', 'media remains unchanged');

    segmentRequest = this.requests[0];
    assert.equal(
      segmentRequest.uri.substring(segmentRequest.uri.length - 4),
      '2.ts',
      'requested third segment'
    );

    assert.equal(this.env.log.warn.callCount, 1, 'logged a warning');
    this.env.log.warn.callCount = 0;
  });
});

QUnit.test('updates the duration after switching playlists', function(assert) {
  const segment = muxedSegment();
  // copy the byte length since the segment bytes get cleared out
  const segmentByteLength = segment.byteLength;
  let selectedPlaylist = false;

  this.masterPlaylistController.mediaSource.trigger('sourceopen');
  this.masterPlaylistController.bandwidth = 1e20;

  // master
  this.standardXHRResponse(this.requests[0]);
  // media
  this.standardXHRResponse(this.requests[1]);

  this.masterPlaylistController.selectPlaylist = () => {
    selectedPlaylist = true;

    // this duration should be overwritten by the playlist change
    this.masterPlaylistController.mediaSource.duration = 0;
    this.masterPlaylistController.mediaSource.readyState = 'open';

    return this.masterPlaylistController.masterPlaylistLoader_.master.playlists[1];
  };

  assert.ok(segmentByteLength, 'the segment has some number of bytes');

  // 1ms for request duration
  this.clock.tick(1);
  this.masterPlaylistController.mainSegmentLoader_.mediaIndex = 0;
  // segment 0
  this.standardXHRResponse(this.requests[2], segment);

  return new Promise((resolve, reject) => {
    this.masterPlaylistController.mainSegmentLoader_.on('appending', resolve);
  }).then(() => {
    // source buffers are mocked, so must manually trigger update ends on audio and video
    // buffers
    this.masterPlaylistController.mediaSource.sourceBuffers[0].trigger('updateend');
    this.masterPlaylistController.mediaSource.sourceBuffers[1].trigger('updateend');

    // media1
    this.standardXHRResponse(this.requests[3]);
    assert.ok(selectedPlaylist, 'selected playlist');
    assert.ok(
      this.masterPlaylistController.mediaSource.duration !== 0,
      'updates the duration'
    );

    // verify stats
    // request duration was 1ms, giving a bandwidth of bytes / 1 * 8 * 1000
    assert.equal(
      this.player.tech_.vhs.stats.bandwidth,
      segmentByteLength / 1 * 8 * 1000,
      'stats has the right bandwidth'
    );
    assert.equal(this.player.tech_.vhs.stats.mediaRequests, 1, '1 segment request');
    assert.equal(
      this.player.tech_.vhs.stats.mediaBytesTransferred,
      segmentByteLength,
      'stats has the right number of bytes transferred'
    );

  });
});

QUnit.test('playlist selection uses systemBandwidth', function(assert) {
  this.masterPlaylistController.mediaSource.trigger('sourceopen');
  this.player.width(1000);
  this.player.height(900);

  // master
  this.standardXHRResponse(this.requests[0]);
  // media
  this.standardXHRResponse(this.requests[1]);

  assert.ok(/media3\.m3u8/i.test(this.requests[1].url), 'Selected the highest rendition');

  return requestAndAppendSegment({
    request: this.requests[2],
    segment: muxedSegment(),
    segmentLoader: this.masterPlaylistController.mainSegmentLoader_,
    clock: this.clock,
    bandwidth: 8192000,
    throughput: 409600
  }).then(() => {
    // need two segments before a rendition change can happen
    return requestAndAppendSegment({
      request: this.requests[3],
      segment: muxedSegment(),
      segmentLoader: this.masterPlaylistController.mainSegmentLoader_,
      clock: this.clock,
      bandwidth: 8192000,
      throughput: 409600
    });
  }).then(() => {
    // systemBandwidth is 1 / (1 / 8192000 + 1 / 409600) = ~390095
    assert.ok(/media\.m3u8/i.test(this.requests[4].url), 'Selected the rendition < 390095');
  });
});

QUnit.test(
  'removes request timeout when segment timesout on lowest rendition',
  function(assert) {
    this.masterPlaylistController.mediaSource.trigger('sourceopen');

    // master
    this.standardXHRResponse(this.requests[0]);
    // media
    this.standardXHRResponse(this.requests[1]);

    assert.equal(
      this.masterPlaylistController.requestOptions_.timeout,
      this.masterPlaylistController.masterPlaylistLoader_.targetDuration * 1.5 *
              1000,
      'default request timeout'
    );

    assert.ok(
      !Playlist.isLowestEnabledRendition(
        this.masterPlaylistController.masterPlaylistLoader_.master,
        this.masterPlaylistController.masterPlaylistLoader_.media()
      ),
      'not on lowest rendition'
    );

    // Cause segment to timeout to force player into lowest rendition
    this.requests[2].timedout = true;

    // Downloading segment should cause media change and timeout removal
    // segment 0
    this.standardXHRResponse(this.requests[2]);
    // Download new segment after media change
    this.standardXHRResponse(this.requests[3]);

    assert.ok(
      Playlist.isLowestEnabledRendition(
        this.masterPlaylistController.masterPlaylistLoader_.master,
        this.masterPlaylistController.masterPlaylistLoader_.media()
      ),
      'on lowest rendition'
    );

    assert.equal(
      this.masterPlaylistController.requestOptions_.timeout, 0,
      'request timeout 0'
    );
  }
);

QUnit.test(
  'removes request timeout when the source is a media playlist and not master',
  function(assert) {
    this.requests.length = 0;

    this.player.src({
      src: 'manifest/media.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    this.clock.tick(1);

    this.masterPlaylistController = this.player.tech_.vhs.masterPlaylistController_;

    // media
    this.standardXHRResponse(this.requests.shift());

    assert.equal(
      this.masterPlaylistController.requestOptions_.timeout, 0,
      'request timeout set to 0 when loading a non master playlist'
    );
  }
);

QUnit.test(
  'seekable uses the intersection of alternate audio and combined tracks',
  function(assert) {
    const origSeekable = Playlist.seekable;
    const mpc = this.masterPlaylistController;
    const mainMedia = {};
    const audioMedia = {};
    let mainTimeRanges = [];
    let audioTimeRanges = [];

    this.masterPlaylistController.masterPlaylistLoader_.master = {};
    this.masterPlaylistController.masterPlaylistLoader_.media = () => mainMedia;
    this.masterPlaylistController.syncController_.getExpiredTime = () => 0;

    Playlist.seekable = (media) => {
      if (media === mainMedia) {
        return videojs.createTimeRanges(mainTimeRanges);
      }
      return videojs.createTimeRanges(audioTimeRanges);
    };

    timeRangesEqual(mpc.seekable(), videojs.createTimeRanges(), 'empty when main empty');
    mainTimeRanges = [[0, 10]];
    mpc.seekable_ = videojs.createTimeRanges();
    mpc.onSyncInfoUpdate_();
    timeRangesEqual(mpc.seekable(), videojs.createTimeRanges([[0, 10]]), 'main when no audio');

    mpc.mediaTypes_.AUDIO.activePlaylistLoader = {
      media: () => audioMedia,
      dispose() {},
      expired_: 0
    };
    mainTimeRanges = [];
    mpc.seekable_ = videojs.createTimeRanges();
    mpc.onSyncInfoUpdate_();

    timeRangesEqual(mpc.seekable(), videojs.createTimeRanges(), 'empty when both empty');
    mainTimeRanges = [[0, 10]];
    mpc.seekable_ = videojs.createTimeRanges();
    mpc.onSyncInfoUpdate_();
    timeRangesEqual(mpc.seekable(), videojs.createTimeRanges(), 'empty when audio empty');
    mainTimeRanges = [];
    audioTimeRanges = [[0, 10]];
    mpc.seekable_ = videojs.createTimeRanges();
    mpc.onSyncInfoUpdate_();
    timeRangesEqual(mpc.seekable(), videojs.createTimeRanges(), 'empty when main empty');
    mainTimeRanges = [[0, 10]];
    audioTimeRanges = [[0, 10]];
    mpc.seekable_ = videojs.createTimeRanges();
    mpc.onSyncInfoUpdate_();
    timeRangesEqual(mpc.seekable(), videojs.createTimeRanges([[0, 10]]), 'ranges equal');
    mainTimeRanges = [[5, 10]];
    mpc.seekable_ = videojs.createTimeRanges();
    mpc.onSyncInfoUpdate_();
    timeRangesEqual(mpc.seekable(), videojs.createTimeRanges([[5, 10]]), 'main later start');
    mainTimeRanges = [[0, 10]];
    audioTimeRanges = [[5, 10]];
    mpc.seekable_ = videojs.createTimeRanges();
    mpc.onSyncInfoUpdate_();
    timeRangesEqual(mpc.seekable(), videojs.createTimeRanges([[5, 10]]), 'audio later start');
    mainTimeRanges = [[0, 9]];
    audioTimeRanges = [[0, 10]];
    mpc.seekable_ = videojs.createTimeRanges();
    mpc.onSyncInfoUpdate_();
    timeRangesEqual(mpc.seekable(), videojs.createTimeRanges([[0, 9]]), 'main earlier end');
    mainTimeRanges = [[0, 10]];
    audioTimeRanges = [[0, 9]];
    mpc.seekable_ = videojs.createTimeRanges();
    mpc.onSyncInfoUpdate_();
    timeRangesEqual(mpc.seekable(), videojs.createTimeRanges([[0, 9]]), 'audio earlier end');
    mainTimeRanges = [[1, 10]];
    audioTimeRanges = [[0, 9]];
    mpc.seekable_ = videojs.createTimeRanges();
    mpc.onSyncInfoUpdate_();
    timeRangesEqual(
      mpc.seekable(),
      videojs.createTimeRanges([[1, 9]]),
      'main later start, audio earlier end'
    );
    mainTimeRanges = [[0, 9]];
    audioTimeRanges = [[1, 10]];
    mpc.seekable_ = videojs.createTimeRanges();
    mpc.onSyncInfoUpdate_();
    timeRangesEqual(
      mpc.seekable(),
      videojs.createTimeRanges([[1, 9]]),
      'audio later start, main earlier end'
    );
    mainTimeRanges = [[2, 9]];
    mpc.seekable_ = videojs.createTimeRanges();
    mpc.onSyncInfoUpdate_();
    timeRangesEqual(
      mpc.seekable(),
      videojs.createTimeRanges([[2, 9]]),
      'main later start, main earlier end'
    );
    mainTimeRanges = [[1, 10]];
    audioTimeRanges = [[2, 9]];
    mpc.seekable_ = videojs.createTimeRanges();
    mpc.onSyncInfoUpdate_();
    timeRangesEqual(
      mpc.seekable(),
      videojs.createTimeRanges([[2, 9]]),
      'audio later start, audio earlier end'
    );
    mainTimeRanges = [[1, 10]];
    audioTimeRanges = [[11, 20]];
    mpc.seekable_ = videojs.createTimeRanges();
    mpc.onSyncInfoUpdate_();
    timeRangesEqual(
      mpc.seekable(),
      videojs.createTimeRanges([[1, 10]]),
      'no intersection, audio later'
    );
    mainTimeRanges = [[11, 20]];
    audioTimeRanges = [[1, 10]];
    mpc.seekable_ = videojs.createTimeRanges();
    mpc.onSyncInfoUpdate_();
    timeRangesEqual(
      mpc.seekable(),
      videojs.createTimeRanges([[11, 20]]),
      'no intersection, main later'
    );

    Playlist.seekable = origSeekable;
  }
);

QUnit.test(
  'syncInfoUpdate triggers seekablechanged when seekable is updated',
  function(assert) {
    const origSeekable = Playlist.seekable;
    const mpc = this.masterPlaylistController;
    const tech = this.player.tech_;
    let mainTimeRanges = [];
    const media = {};
    let seekablechanged = 0;

    tech.on('seekablechanged', () => seekablechanged++);

    Playlist.seekable = () => {
      return videojs.createTimeRanges(mainTimeRanges);
    };
    this.masterPlaylistController.masterPlaylistLoader_.master = {};
    this.masterPlaylistController.masterPlaylistLoader_.media = () => media;
    this.masterPlaylistController.syncController_.getExpiredTime = () => 0;

    mainTimeRanges = [[0, 10]];
    mpc.seekable_ = videojs.createTimeRanges();
    mpc.onSyncInfoUpdate_();
    assert.equal(seekablechanged, 1, 'seekablechanged triggered');

    Playlist.seekable = origSeekable;
  }
);

QUnit.test('calls to update cues on new media', function(assert) {
  const origVhsOptions = videojs.options.vhs;

  videojs.options.vhs = {
    useCueTags: true
  };

  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.masterPlaylistController = this.player.tech_.vhs.masterPlaylistController_;

  let callCount = 0;

  this.masterPlaylistController.updateAdCues_ = (media) => {
    callCount++;
  };

  // master
  this.standardXHRResponse(this.requests.shift());

  assert.equal(callCount, 0, 'no call to update cues on master');

  // media
  this.standardXHRResponse(this.requests.shift());

  assert.equal(callCount, 1, 'calls to update cues on first media');

  this.masterPlaylistController.masterPlaylistLoader_.trigger('loadedplaylist');

  assert.equal(callCount, 2, 'calls to update cues on subsequent media');

  videojs.options.vhs = origVhsOptions;
});

QUnit.test('calls to update cues on media when no master', function(assert) {
  this.requests.length = 0;

  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.masterPlaylistController = this.player.tech_.vhs.masterPlaylistController_;
  this.masterPlaylistController.useCueTags_ = true;

  let callCount = 0;

  this.masterPlaylistController.updateAdCues_ = (media) => callCount++;

  // media
  this.standardXHRResponse(this.requests.shift());

  assert.equal(callCount, 1, 'calls to update cues on first media');

  this.masterPlaylistController.masterPlaylistLoader_.trigger('loadedplaylist');

  assert.equal(callCount, 2, 'calls to update cues on subsequent media');
});

QUnit.test('respects useCueTags option', function(assert) {
  const origVhsOptions = videojs.options.vhs;
  let vhsPlaylistCueTagsEvents = 0;
  let hlsPlaylistCueTagsEvents = 0;

  videojs.options.vhs = {
    useCueTags: true
  };

  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.tech_.on('usage', (event) => {
    if (event.name === 'vhs-playlist-cue-tags') {
      vhsPlaylistCueTagsEvents++;
    }
    if (event.name === 'hls-playlist-cue-tags') {
      hlsPlaylistCueTagsEvents++;
    }
  });
  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.masterPlaylistController = this.player.tech_.vhs.masterPlaylistController_;
  this.standardXHRResponse(this.requests.shift());
  this.standardXHRResponse(this.requests.shift());

  assert.equal(vhsPlaylistCueTagsEvents, 1, 'cue tags event has been triggered once');
  assert.equal(hlsPlaylistCueTagsEvents, 1, 'cue tags event has been triggered once');
  assert.ok(
    this.masterPlaylistController.cueTagsTrack_,
    'creates cueTagsTrack_ if useCueTags is truthy'
  );
  assert.equal(
    this.masterPlaylistController.cueTagsTrack_.label,
    'ad-cues',
    'cueTagsTrack_ has label of ad-cues'
  );
  assert.equal(
    this.player.textTracks()[0], this.masterPlaylistController.cueTagsTrack_,
    'adds cueTagsTrack as a text track if useCueTags is truthy'
  );

  videojs.options.vhs = origVhsOptions;
});

QUnit.test('correctly sets alternate audio track kinds', function(assert) {
  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/alternate-audio-accessibility.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  // master
  this.standardXHRResponse(this.requests.shift());
  // media - required for loadedmetadata
  this.standardXHRResponse(this.requests.shift());

  const audioTracks = this.player.tech_.audioTracks();

  assert.equal(audioTracks.length, 4, 'added 4 audio tracks');
  assert.equal(audioTracks[0].id, 'English', 'contains english track');
  assert.equal(audioTracks[0].kind, 'main', 'english track\'s kind is "main"');
  assert.equal(
    audioTracks[1].id,
    'English Descriptions',
    'contains english descriptions track'
  );
  assert.equal(
    audioTracks[1].kind,
    'main-desc',
    'english descriptions track\'s kind is "main-desc"'
  );
  assert.equal(audioTracks[2].id, 'Français', 'contains french track');
  assert.equal(
    audioTracks[2].kind,
    'alternative',
    'french track\'s kind is "alternative"'
  );
  assert.equal(audioTracks[3].id, 'Espanol', 'contains spanish track');
  assert.equal(
    audioTracks[3].kind,
    'alternative',
    'spanish track\'s kind is "alternative"'
  );
});

QUnit.test('trigger events when video and audio is demuxed by default', function(assert) {
  let vhsDemuxedEvents = 0;
  let hlsDemuxedEvents = 0;

  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/multipleAudioGroups.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.player.tech_.on('usage', (event) => {
    if (event.name === 'vhs-demuxed') {
      vhsDemuxedEvents++;
    }
    if (event.name === 'hls-demuxed') {
      hlsDemuxedEvents++;
    }
  });

  openMediaSource(this.player, this.clock);
  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  assert.equal(vhsDemuxedEvents, 1, 'video and audio is demuxed by default');
  assert.equal(hlsDemuxedEvents, 1, 'video and audio is demuxed by default');
});

QUnit.test('trigger events when an AES is detected', function(assert) {
  let vhsAesEvents = 0;
  let hlsAesEvents = 0;
  const isAesCopy = Vhs.Playlist.isAes;

  Vhs.Playlist.isAes = (media) => {
    return true;
  };

  this.player.tech_.on('usage', (event) => {
    if (event.name === 'vhs-aes') {
      vhsAesEvents++;
    }
    if (event.name === 'hls-aes') {
      hlsAesEvents++;
    }
  });

  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());
  this.masterPlaylistController.mediaSource.trigger('sourceopen');

  assert.equal(vhsAesEvents, 1, 'an AES HLS stream is detected');
  assert.equal(hlsAesEvents, 1, 'an AES HLS stream is detected');
  Vhs.Playlist.isAes = isAesCopy;
});

QUnit.test('trigger event when a video fMP4 stream is detected', function(assert) {
  // use real media sources to allow segment loader to naturally detect fmp4
  this.mse.restore();
  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'prog_index.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  let vhsFmp4Events = 0;
  let hlsFmp4Events = 0;

  this.player.tech_.on('usage', (event) => {
    if (event.name === 'vhs-fmp4') {
      vhsFmp4Events++;
    }
    if (event.name === 'hls-fmp4') {
      hlsFmp4Events++;
    }
  });

  const mpc = this.player.tech(true).vhs.masterPlaylistController_;
  const loader = mpc.mainSegmentLoader_;

  // media
  this.standardXHRResponse(this.requests.shift());

  return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_, {
    videoEl: this.player.tech_.el_,
    isVideoOnly: true
  }).then(() => {
    assert.equal(hlsFmp4Events, 0, 'an fMP4 stream is not detected');

    const initSegmentRequest = this.requests.shift();
    const segmentRequest = this.requests.shift();

    return requestAndAppendSegment({
      request: segmentRequest,
      initSegmentRequest,
      segmentLoader: mpc.mainSegmentLoader_,
      initSegment: mp4VideoInitSegment(),
      segment: mp4VideoSegment(),
      isOnlyVideo: true,
      clock: this.clock
    });
  }).then(() => {
    assert.equal(vhsFmp4Events, 1, 'an fMP4 stream is detected');
    assert.equal(hlsFmp4Events, 1, 'an fMP4 stream is detected');
  });
});

QUnit.test('only triggers a single fmp4 usage event', function(assert) {
  let vhsFmp4Events = 0;
  let hlsFmp4Events = 0;

  this.player.tech_.on('usage', (event) => {
    if (event.name === 'vhs-fmp4') {
      vhsFmp4Events++;
    }
    if (event.name === 'hls-fmp4') {
      hlsFmp4Events++;
    }
  });

  const mainSegmentLoader = this.player.tech(true).vhs.masterPlaylistController_.mainSegmentLoader_;

  mainSegmentLoader.trigger('fmp4');

  assert.equal(vhsFmp4Events, 1, 'fired fMP4 usage event');
  assert.equal(hlsFmp4Events, 1, 'fired fMP4 usage event');

  mainSegmentLoader.trigger('fmp4');

  assert.equal(vhsFmp4Events, 1, 'did not fire usage event');
  assert.equal(hlsFmp4Events, 1, 'did not fire usage event');

  const audioSegmentLoader =
    this.player.tech(true).vhs.masterPlaylistController_.audioSegmentLoader_;

  audioSegmentLoader.trigger('fmp4');

  assert.equal(vhsFmp4Events, 1, 'did not fire usage event');
  assert.equal(hlsFmp4Events, 1, 'did not fire usage event');
});

QUnit.test('trigger event when an audio fMP4 stream is detected', function(assert) {
  // use real media sources to allow segment loader to naturally detect fmp4
  this.mse.restore();
  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'prog_index.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  let vhsFmp4Events = 0;
  let hlsFmp4Events = 0;

  this.player.tech_.on('usage', (event) => {
    if (event.name === 'vhs-fmp4') {
      vhsFmp4Events++;
    }
    if (event.name === 'hls-fmp4') {
      hlsFmp4Events++;
    }
  });

  const mpc = this.player.tech(true).vhs.masterPlaylistController_;
  const loader = mpc.mainSegmentLoader_;

  // media
  this.standardXHRResponse(this.requests.shift());

  return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_, {
    videoEl: this.player.tech_.el_,
    isAudioOnly: true
  }).then(() => {
    assert.equal(vhsFmp4Events, 0, 'an fMP4 stream is not detected');
    assert.equal(hlsFmp4Events, 0, 'an fMP4 stream is not detected');

    const initSegmentRequest = this.requests.shift();
    const segmentRequest = this.requests.shift();

    return requestAndAppendSegment({
      request: segmentRequest,
      initSegmentRequest,
      segmentLoader: mpc.mainSegmentLoader_,
      initSegment: mp4AudioInitSegment(),
      segment: mp4AudioSegment(),
      isOnlyAudio: true,
      clock: this.clock
    });
  }).then(() => {
    assert.equal(vhsFmp4Events, 1, 'an fMP4 stream is detected');
    assert.equal(hlsFmp4Events, 1, 'an fMP4 stream is detected');
  });
});

QUnit.test('parses codec from audio only fmp4 init segment', function(assert) {
  // use real media sources to allow segment loader to naturally detect fmp4
  this.mse.restore();
  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'prog_index.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const mpc = this.player.tech(true).vhs.masterPlaylistController_;
  const origCreateSourceBuffers =
    mpc.sourceUpdater_.createSourceBuffers.bind(mpc.sourceUpdater_);

  mpc.sourceUpdater_.createSourceBuffers = (codecs) => {
    createSourceBufferCalls.push(codecs);
    origCreateSourceBuffers(codecs);
  };

  const loader = mpc.mainSegmentLoader_;

  return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_, {
    videoEl: this.player.tech_.el_,
    dontCreateSourceBuffers: true
  }).then(() => {
    // media
    this.standardXHRResponse(this.requests.shift());

    const initSegmentRequest = this.requests.shift();
    const segmentRequest = this.requests.shift();

    return requestAndAppendSegment({
      request: segmentRequest,
      initSegmentRequest,
      segmentLoader: mpc.mainSegmentLoader_,
      initSegment: mp4AudioInitSegment(),
      segment: mp4AudioSegment(),
      isOnlyAudio: true,
      clock: this.clock
    });
  }).then(() => {
    assert.equal(createSourceBufferCalls.length, 1, 'called to create source buffers');
    assert.deepEqual(
      createSourceBufferCalls[0],
      {
        audio: 'mp4a.40.2'
      },
      'parsed audio codec'
    );
    assert.deepEqual(loader.currentMediaInfo_, {
      audioCodec: 'mp4a.40.2',
      hasAudio: true,
      hasVideo: false,
      isFmp4: true
    }, 'starting media as expected');
  });
});

QUnit.test('parses codec from video only fmp4 init segment', function(assert) {
  // use real media sources to allow segment loader to naturally detect fmp4
  this.mse.restore();
  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'prog_index.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const mpc = this.player.tech(true).vhs.masterPlaylistController_;
  const origCreateSourceBuffers =
    mpc.sourceUpdater_.createSourceBuffers.bind(mpc.sourceUpdater_);

  mpc.sourceUpdater_.createSourceBuffers = (codecs) => {
    createSourceBufferCalls.push(codecs);
    origCreateSourceBuffers(codecs);
  };

  const loader = mpc.mainSegmentLoader_;

  return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_, {
    videoEl: this.player.tech_.el_,
    dontCreateSourceBuffers: true
  }).then(() => {
    // media
    this.standardXHRResponse(this.requests.shift());

    const initSegmentRequest = this.requests.shift();
    const segmentRequest = this.requests.shift();

    return requestAndAppendSegment({
      request: segmentRequest,
      initSegmentRequest,
      segmentLoader: mpc.mainSegmentLoader_,
      initSegment: mp4VideoInitSegment(),
      segment: mp4VideoSegment(),
      isOnlyVideo: true,
      clock: this.clock
    });
  }).then(() => {
    assert.equal(createSourceBufferCalls.length, 1, 'called to create source buffers');
    assert.deepEqual(
      createSourceBufferCalls[0],
      {
        video: 'avc1.64001e'
      },
      'parsed video codec'
    );
    assert.deepEqual(loader.currentMediaInfo_, {
      hasAudio: false,
      hasVideo: true,
      isFmp4: true,
      videoCodec: 'avc1.64001e'
    }, 'starting media as expected');
  });
});

QUnit.test('parses codec from muxed fmp4 init segment', function(assert) {
  // use real media sources to allow segment loader to naturally detect fmp4
  this.mse.restore();
  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'prog_index.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const mpc = this.player.tech(true).vhs.masterPlaylistController_;
  const origCreateSourceBuffers =
    mpc.sourceUpdater_.createSourceBuffers.bind(mpc.sourceUpdater_);

  mpc.sourceUpdater_.createSourceBuffers = (codecs) => {
    createSourceBufferCalls.push(codecs);
    origCreateSourceBuffers(codecs);
  };

  const loader = mpc.mainSegmentLoader_;

  return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_, {
    videoEl: this.player.tech_.el_,
    dontCreateSourceBuffers: true
  }).then(() => {
    // media
    this.standardXHRResponse(this.requests.shift());

    const initSegmentRequest = this.requests.shift();
    const segmentRequest = this.requests.shift();

    return requestAndAppendSegment({
      request: segmentRequest,
      initSegmentRequest,
      segmentLoader: mpc.mainSegmentLoader_,
      initSegment: mp4MuxedInitSegment(),
      segment: mp4MuxedSegment(),
      isOnlyVideo: true,
      clock: this.clock
    });
  }).then(() => {
    assert.equal(createSourceBufferCalls.length, 1, 'called to create source buffers');
    assert.deepEqual(
      createSourceBufferCalls[0],
      {
        video: 'avc1.42c00d,mp4a.40.2'
      },
      'parsed video codec'
    );
    assert.deepEqual(loader.currentMediaInfo_, {
      hasAudio: true,
      hasVideo: true,
      videoCodec: 'avc1.42c00d',
      audioCodec: 'mp4a.40.2',
      isMuxed: true,
      isFmp4: true
    }, 'starting media as expected');
  });
});

QUnit.test(
  'adds only CEA608 closed-caption tracks when a master playlist is loaded',
  function(assert) {
    this.requests.length = 0;
    this.player.dispose();
    this.player = createPlayer();
    this.player.src({
      src: 'manifest/master-captions.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    // wait for async player.src to complete
    this.clock.tick(1);

    const masterPlaylistController = this.player.tech_.vhs.masterPlaylistController_;

    assert.equal(this.player.textTracks().length, 1, 'one text track to start');
    assert.equal(
      this.player.textTracks()[0].label,
      'segment-metadata',
      'only segment-metadata text track'
    );

    // master, contains media groups for captions
    this.standardXHRResponse(this.requests.shift());

    // we wait for loadedmetadata before setting caption tracks, so we need to wait for a
    // media playlist
    assert.equal(this.player.textTracks().length, 1, 'only one text track after master');

    // media
    this.standardXHRResponse(this.requests.shift());

    const master = masterPlaylistController.masterPlaylistLoader_.master;
    const caps = master.mediaGroups['CLOSED-CAPTIONS'].CCs;
    const capsArr = Object.keys(caps).map(key => Object.assign({name: key}, caps[key]));
    const addedCaps = masterPlaylistController.mediaTypes_['CLOSED-CAPTIONS'].groups.CCs
      .map(cap => Object.assign({name: cap.id}, cap));

    assert.equal(capsArr.length, 4, '4 closed-caption tracks defined in playlist');
    assert.equal(addedCaps.length, 2, '2 CEA608 tracks added internally');
    assert.equal(addedCaps[0].instreamId, 'CC1', 'first 608 track is CC1');
    assert.equal(addedCaps[1].instreamId, 'CC3', 'second 608 track is CC3');

    const textTracks = this.player.textTracks();

    assert.equal(textTracks.length, 3, '2 text tracks were added');
    assert.equal(textTracks[1].mode, 'disabled', 'track starts disabled');
    assert.equal(textTracks[2].mode, 'disabled', 'track starts disabled');
    assert.equal(
      textTracks[1].id, addedCaps[0].instreamId,
      'text track 1\'s id is CC\'s instreamId'
    );
    assert.equal(
      textTracks[2].id, addedCaps[1].instreamId,
      'text track 2\'s id is CC\'s instreamId'
    );
    assert.equal(
      textTracks[1].label, addedCaps[0].name,
      'text track 1\'s label is CC\'s name'
    );
    assert.equal(
      textTracks[2].label, addedCaps[1].name,
      'text track 2\'s label is CC\'s name'
    );
  }
);

QUnit.test('adds subtitle tracks when a media playlist is loaded', function(assert) {
  let vhsWebvttEvents = 0;
  let hlsWebvttEvents = 0;

  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master-subtitles.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.player.tech_.on('usage', (event) => {
    if (event.name === 'vhs-webvtt') {
      vhsWebvttEvents++;
    }
    if (event.name === 'hls-webvtt') {
      hlsWebvttEvents++;
    }
  });

  const masterPlaylistController = this.player.tech_.vhs.masterPlaylistController_;

  assert.equal(vhsWebvttEvents, 0, 'there is no webvtt detected');
  assert.equal(hlsWebvttEvents, 0, 'there is no webvtt detected');
  assert.equal(this.player.textTracks().length, 1, 'one text track to start');
  assert.equal(
    this.player.textTracks()[0].label,
    'segment-metadata',
    'only segment-metadata text track'
  );

  // master, contains media groups for subtitles
  this.standardXHRResponse(this.requests.shift());

  // we wait for loadedmetadata before setting subtitle tracks, so we need to wait for a
  // media playlist
  assert.equal(this.player.textTracks().length, 1, 'only one text track after master');

  // media
  this.standardXHRResponse(this.requests.shift());

  const master = masterPlaylistController.masterPlaylistLoader_.master;
  const subs = master.mediaGroups.SUBTITLES.subs;
  const subsArr = Object.keys(subs).map(key => subs[key]);

  assert.equal(subsArr.length, 4, 'got 4 subtitles');
  assert.equal(subsArr.filter(sub => sub.forced === false).length, 2, '2 forced');
  assert.equal(subsArr.filter(sub => sub.forced === true).length, 2, '2 non-forced');

  const textTracks = this.player.textTracks();

  assert.equal(textTracks.length, 3, 'non-forced text tracks were added');
  assert.equal(textTracks[1].mode, 'disabled', 'track starts disabled');
  assert.equal(textTracks[2].mode, 'disabled', 'track starts disabled');
  assert.equal(vhsWebvttEvents, 1, 'there is webvtt detected in the rendition');
  assert.equal(hlsWebvttEvents, 1, 'there is webvtt detected in the rendition');

  // change source to make sure tracks are cleaned up
  this.player.src({
    src: 'http://example.com/media.mp4',
    type: 'video/mp4'
  });

  this.clock.tick(1);

  assert.equal(this.player.textTracks().length, 0, 'text tracks cleaned');
});

QUnit.test('switches off subtitles on subtitle errors', function(assert) {
  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master-subtitles.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  const masterPlaylistController = this.player.tech_.vhs.masterPlaylistController_;

  // sets up listener for text track changes
  masterPlaylistController.trigger('sourceopen');

  // master, contains media groups for subtitles
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());
  // media segment
  this.standardXHRResponse(this.requests.shift(), muxedSegment());

  const textTracks = this.player.textTracks();

  assert.equal(this.requests.length, 0, 'no outstanding requests');

  // enable first subtitle text track
  assert.notEqual(textTracks[0].kind, 'subtitles', 'kind is not subtitles');
  assert.equal(textTracks[1].kind, 'subtitles', 'kind is subtitles');
  textTracks[1].mode = 'showing';

  // Wait for VTT segment to be requested
  this.clock.tick(1);

  assert.equal(this.requests.length, 1, 'made a request');
  assert.equal(textTracks[1].mode, 'showing', 'text track still showing');

  // request failed
  this.requests.shift().respond(404, null, '');

  assert.equal(textTracks[1].mode, 'disabled', 'disabled text track');

  assert.equal(this.env.log.warn.callCount, 1, 'logged a warning');
  this.env.log.warn.callCount = 0;

  assert.equal(this.requests.length, 0, 'no outstanding requests');

  // re-enable first text track
  textTracks[1].mode = 'showing';

  // Wait for VTT segment request to be made
  this.clock.tick(1);

  assert.equal(this.requests.length, 1, 'made a request');
  assert.equal(textTracks[1].mode, 'showing', 'text track still showing');

  this.requests.shift().respond(200, null, `
    #EXTM3U
    #EXT-X-TARGETDURATION:10
    #EXT-X-MEDIA-SEQUENCE:0
    #EXTINF:10
    0.webvtt
    #EXT-X-ENDLIST
  `);

  const syncController = masterPlaylistController.subtitleSegmentLoader_.syncController_;

  // required for the vtt request to be made
  syncController.timestampOffsetForTimeline = () => 0;

  this.clock.tick(1);

  assert.equal(this.requests.length, 1, 'made a request');
  assert.ok(this.requests[0].url.endsWith('0.webvtt'), 'made a webvtt request');
  assert.equal(textTracks[1].mode, 'showing', 'text track still showing');

  this.requests.shift().respond(404, null, '');

  assert.equal(textTracks[1].mode, 'disabled', 'disabled text track');

  assert.equal(this.env.log.warn.callCount, 1, 'logged a warning');
  this.env.log.warn.callCount = 0;
});

QUnit.test('pauses subtitle segment loader on tech errors', function(assert) {
  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master-subtitles.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  const masterPlaylistController = this.player.tech_.vhs.masterPlaylistController_;

  // sets up listener for text track changes
  masterPlaylistController.trigger('sourceopen');

  // master, contains media groups for subtitles
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  const textTracks = this.player.textTracks();

  // enable first subtitle text track
  assert.notEqual(textTracks[0].kind, 'subtitles', 'kind is not subtitles');
  assert.equal(textTracks[1].kind, 'subtitles', 'kind is subtitles');
  textTracks[1].mode = 'showing';

  // Wait for VTT segment request to be made
  this.clock.tick(1);

  let pauseCount = 0;

  masterPlaylistController.subtitleSegmentLoader_.pause = () => pauseCount++;

  this.player.tech_.error = () => 'foo';
  this.player.tech_.trigger('error');

  assert.equal(pauseCount, 1, 'paused subtitle segment loader');

  assert.equal(this.env.log.error.calls, 1, '1 media error logged');
  this.env.log.error.reset();
});

QUnit.test('disposes subtitle loaders on dispose', function(assert) {
  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master-subtitles.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  let masterPlaylistController = this.player.tech_.vhs.masterPlaylistController_;

  assert.notOk(
    masterPlaylistController.mediaTypes_.SUBTITLES.activePlaylistLoader,
    'does not start with a subtitle playlist loader'
  );
  assert.ok(
    masterPlaylistController.subtitleSegmentLoader_,
    'starts with a subtitle segment loader'
  );

  let segmentLoaderDisposeCount = 0;

  masterPlaylistController.subtitleSegmentLoader_.dispose =
    () => segmentLoaderDisposeCount++;

  masterPlaylistController.dispose();

  assert.equal(segmentLoaderDisposeCount, 1, 'disposed the subtitle segment loader');

  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master-subtitles.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  masterPlaylistController = this.player.tech_.vhs.masterPlaylistController_;

  // sets up listener for text track changes
  masterPlaylistController.trigger('sourceopen');

  // master, contains media groups for subtitles
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  const textTracks = this.player.textTracks();

  // enable first subtitle text track
  assert.notEqual(textTracks[0].kind, 'subtitles', 'kind is not subtitles');
  assert.equal(textTracks[1].kind, 'subtitles', 'kind is subtitles');
  textTracks[1].mode = 'showing';

  // Wait for VTT segment request to be made
  this.clock.tick(1);

  assert.ok(
    masterPlaylistController.mediaTypes_.SUBTITLES.activePlaylistLoader,
    'has a subtitle playlist loader'
  );
  assert.ok(
    masterPlaylistController.subtitleSegmentLoader_,
    'has a subtitle segment loader'
  );

  let playlistLoaderDisposeCount = 0;

  segmentLoaderDisposeCount = 0;

  masterPlaylistController.mediaTypes_.SUBTITLES.activePlaylistLoader.dispose =
    () => playlistLoaderDisposeCount++;
  masterPlaylistController.subtitleSegmentLoader_.dispose =
    () => segmentLoaderDisposeCount++;

  masterPlaylistController.dispose();

  assert.equal(playlistLoaderDisposeCount, 1, 'disposed the subtitle playlist loader');
  assert.equal(segmentLoaderDisposeCount, 1, 'disposed the subtitle segment loader');
});

QUnit.test('subtitle segment loader resets on seeks', function(assert) {
  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master-subtitles.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  const masterPlaylistController = this.player.tech_.vhs.masterPlaylistController_;

  // sets up listener for text track changes
  masterPlaylistController.trigger('sourceopen');

  // master, contains media groups for subtitles
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  const textTracks = this.player.textTracks();

  // enable first subtitle text track
  assert.notEqual(textTracks[0].kind, 'subtitles', 'kind is not subtitles');
  assert.equal(textTracks[1].kind, 'subtitles', 'kind is subtitles');
  textTracks[1].mode = 'showing';

  // Wait for VTT segment request to be made
  this.clock.tick(1);

  let resetCount = 0;
  let abortCount = 0;
  let loadCount = 0;

  masterPlaylistController.subtitleSegmentLoader_.resetEverything = () => resetCount++;
  masterPlaylistController.subtitleSegmentLoader_.abort = () => abortCount++;
  masterPlaylistController.subtitleSegmentLoader_.load = () => loadCount++;

  this.player.pause();
  masterPlaylistController.setCurrentTime(5);

  assert.equal(resetCount, 1, 'reset subtitle segment loader');
  assert.equal(abortCount, 1, 'aborted subtitle segment loader');
  assert.equal(loadCount, 1, 'called load on subtitle segment loader');

  this.player.play();
  resetCount = 0;
  abortCount = 0;
  loadCount = 0;
  masterPlaylistController.setCurrentTime(10);

  assert.equal(resetCount, 1, 'reset subtitle segment loader');
  assert.equal(abortCount, 1, 'aborted subtitle segment loader');
  assert.equal(loadCount, 1, 'called load on subtitle segment loader');
});

QUnit.test('calculates dynamic GOAL_BUFFER_LENGTH', function(assert) {
  const configOld = {
    GOAL_BUFFER_LENGTH: Config.GOAL_BUFFER_LENGTH,
    MAX_GOAL_BUFFER_LENGTH: Config.MAX_GOAL_BUFFER_LENGTH,
    GOAL_BUFFER_LENGTH_RATE: Config.GOAL_BUFFER_LENGTH_RATE
  };
  const mpc = this.masterPlaylistController;

  let currentTime = 0;

  Config.GOAL_BUFFER_LENGTH = 30;
  Config.MAX_GOAL_BUFFER_LENGTH = 60;
  Config.GOAL_BUFFER_LENGTH_RATE = 0.5;

  mpc.tech_.currentTime = () => currentTime;

  assert.equal(mpc.goalBufferLength(), 30, 'dynamic GBL uses starting value at time 0');

  currentTime = 10;

  assert.equal(mpc.goalBufferLength(), 35, 'dynamic GBL increases by currentTime * rate');

  currentTime = 60;

  assert.equal(mpc.goalBufferLength(), 60, 'dynamic GBL uses max value');

  currentTime = 70;

  assert.equal(mpc.goalBufferLength(), 60, 'dynamic GBL continues to use max value');

  // restore config
  Object.keys(configOld).forEach((key) => {
    Config[key] = configOld[key];
  });
});

QUnit.test('calculates dynamic BUFFER_LOW_WATER_LINE', function(assert) {
  const configOld = {
    BUFFER_LOW_WATER_LINE: Config.BUFFER_LOW_WATER_LINE,
    MAX_BUFFER_LOW_WATER_LINE: Config.MAX_BUFFER_LOW_WATER_LINE,
    BUFFER_LOW_WATER_LINE_RATE: Config.BUFFER_LOW_WATER_LINE_RATE
  };
  const mpc = this.masterPlaylistController;

  let currentTime = 0;

  Config.BUFFER_LOW_WATER_LINE = 0;
  Config.MAX_BUFFER_LOW_WATER_LINE = 30;
  Config.BUFFER_LOW_WATER_LINE_RATE = 0.5;

  mpc.tech_.currentTime = () => currentTime;

  assert.equal(mpc.bufferLowWaterLine(), 0, 'dynamic BLWL uses starting value at time 0');

  currentTime = 10;

  assert.equal(
    mpc.bufferLowWaterLine(), 5,
    'dynamic BLWL increases by currentTime * rate'
  );

  currentTime = 60;

  assert.equal(mpc.bufferLowWaterLine(), 30, 'dynamic BLWL uses max value');

  currentTime = 70;

  assert.equal(mpc.bufferLowWaterLine(), 30, 'dynamic BLWL continues to use max value');

  // restore config
  Object.keys(configOld).forEach((key) => {
    Config[key] = configOld[key];
  });
});

QUnit.test('creates source buffers after first main segment if muxed content', function(assert) {
  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const mpc = this.player.tech(true).vhs.masterPlaylistController_;
  const origCreateSourceBuffers =
    mpc.sourceUpdater_.createSourceBuffers.bind(mpc.sourceUpdater_);

  mpc.sourceUpdater_.createSourceBuffers = (codecs) => {
    createSourceBufferCalls.push(codecs);
    origCreateSourceBuffers(codecs);
  };

  openMediaSource(this.player, this.clock);

  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  assert.equal(createSourceBufferCalls.length, 0, 'have not created source buffers yet');

  return requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock
  }).then(() => {
    assert.equal(createSourceBufferCalls.length, 1, 'called to create source buffers');
    assert.deepEqual(
      createSourceBufferCalls[0],
      {
        audio: DEFAULT_AUDIO_CODEC,
        video: DEFAULT_VIDEO_CODEC
      },
      'passed default codecs'
    );
  });
});

QUnit.test('creates source buffers after first main segment if audio only', function(assert) {
  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const mpc = this.player.tech(true).vhs.masterPlaylistController_;
  const origCreateSourceBuffers =
    mpc.sourceUpdater_.createSourceBuffers.bind(mpc.sourceUpdater_);

  mpc.sourceUpdater_.createSourceBuffers = (codecs) => {
    createSourceBufferCalls.push(codecs);
    origCreateSourceBuffers(codecs);
  };

  openMediaSource(this.player, this.clock);

  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  assert.equal(createSourceBufferCalls.length, 0, 'have not created source buffers yet');

  return requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: mpc.mainSegmentLoader_,
    segment: audioSegment(),
    isOnlyAudio: true,
    clock: this.clock
  }).then(() => {
    assert.equal(createSourceBufferCalls.length, 1, 'called to create source buffers');
    assert.deepEqual(
      createSourceBufferCalls[0],
      {
        audio: DEFAULT_AUDIO_CODEC
      },
      'passed default audio codec'
    );
  });
});

QUnit.test('creates source buffers after first main segment if video only', function(assert) {
  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const mpc = this.player.tech(true).vhs.masterPlaylistController_;
  const origCreateSourceBuffers =
    mpc.sourceUpdater_.createSourceBuffers.bind(mpc.sourceUpdater_);

  mpc.sourceUpdater_.createSourceBuffers = (codecs) => {
    createSourceBufferCalls.push(codecs);
    origCreateSourceBuffers(codecs);
  };

  openMediaSource(this.player, this.clock);

  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  assert.equal(createSourceBufferCalls.length, 0, 'have not created source buffers yet');

  return requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: mpc.mainSegmentLoader_,
    segment: videoSegment(),
    isOnlyVideo: true,
    clock: this.clock
  }).then(() => {
    assert.equal(createSourceBufferCalls.length, 1, 'called to create source buffers');
    assert.deepEqual(
      createSourceBufferCalls[0],
      {
        video: DEFAULT_VIDEO_CODEC
      },
      'passed default video codec'
    );
  });
});

QUnit.test('creates source buffers after second trackinfo if demuxed', function(assert) {
  const done = assert.async();

  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const mpc = this.player.tech(true).vhs.masterPlaylistController_;
  const origCreateSourceBuffers =
    mpc.sourceUpdater_.createSourceBuffers.bind(mpc.sourceUpdater_);

  mpc.sourceUpdater_.createSourceBuffers = (codecs) => {
    createSourceBufferCalls.push(codecs);
    origCreateSourceBuffers(codecs);
  };

  openMediaSource(this.player, this.clock);

  // master
  this.requests.shift().respond(
    200,
    null,
    '#EXTM3U\n' +
    '#EXT-X-VERSION:4\n' +
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="en",DEFAULT=YES,AUTOSELECT=YES,' +
      'LANGUAGE="en",URI="media-audio.m3u8"\n' +
    '#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=1,AUDIO="audio"\n' +
    'media.m3u8\n'
  );
  // video media
  this.standardXHRResponse(this.requests.shift());
  // audio media
  this.standardXHRResponse(this.requests.shift(), manifests.media);

  assert.equal(createSourceBufferCalls.length, 0, 'have not created source buffers yet');

  let trackinfo = 0;

  const onTrackInfo = function() {
    trackinfo++;
    if (trackinfo !== 2) {
      return;
    }
    assert.equal(createSourceBufferCalls.length, 1, 'called to create source buffers');
    assert.deepEqual(
      createSourceBufferCalls[0],
      {
        video: DEFAULT_VIDEO_CODEC,
        audio: DEFAULT_AUDIO_CODEC
      },
      'passed default codecs'
    );
    done();
  };

  mpc.mainSegmentLoader_.on('trackinfo', onTrackInfo);
  mpc.audioSegmentLoader_.on('trackinfo', onTrackInfo);

  this.standardXHRResponse(this.requests.shift(), videoSegment());
  this.standardXHRResponse(this.requests.shift(), audioSegment());

});

QUnit.test('Uses audio codec from audio playlist for demuxed content', function(assert) {
  const done = assert.async();
  const oldDebug = videojs.log.debug;
  const messages = [];

  videojs.log.debug = (...args) => messages.push(args.join(' '));

  window.MediaSource.isTypeSupported = (type) => (/(mp4a|avc1)/).test(type);

  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/dash-many-codecs.mpd',
    type: 'application/dash+xml'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const mpc = this.player.tech(true).vhs.masterPlaylistController_;
  const origCreateSourceBuffers =
    mpc.sourceUpdater_.createSourceBuffers.bind(mpc.sourceUpdater_);

  mpc.sourceUpdater_.createSourceBuffers = (codecs) => {
    createSourceBufferCalls.push(codecs);
    origCreateSourceBuffers(codecs);
  };

  openMediaSource(this.player, this.clock);

  // master
  this.standardXHRResponse(this.requests.shift());

  assert.equal(createSourceBufferCalls.length, 0, 'have not created source buffers yet');

  let trackinfo = 0;

  const onTrackInfo = function() {
    trackinfo++;
    if (trackinfo !== 2) {
      return;
    }
    assert.equal(createSourceBufferCalls.length, 1, 'called to create source buffers');
    assert.deepEqual(
      createSourceBufferCalls[0],
      {
        video: 'avc1.4d400d',
        audio: 'mp4a.40.2'
      },
      'passed codecs from playlist'
    );
    videojs.log.debug = oldDebug;
    done();
  };

  mpc.mainSegmentLoader_.on('trackinfo', onTrackInfo);
  mpc.audioSegmentLoader_.on('trackinfo', onTrackInfo);

  this.standardXHRResponse(this.requests.shift(), mp4VideoInitSegment());
  this.standardXHRResponse(this.requests.shift(), mp4VideoSegment());
  this.standardXHRResponse(this.requests.shift(), mp4AudioInitSegment());
  this.standardXHRResponse(this.requests.shift(), mp4AudioSegment());
});

QUnit.test('uses codec info from manifest for source buffer creation', function(assert) {
  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const mpc = this.player.tech(true).vhs.masterPlaylistController_;
  const origCreateSourceBuffers =
    mpc.sourceUpdater_.createSourceBuffers.bind(mpc.sourceUpdater_);

  mpc.sourceUpdater_.createSourceBuffers = (codecs) => {
    createSourceBufferCalls.push(codecs);
    origCreateSourceBuffers(codecs);
  };

  openMediaSource(this.player, this.clock);

  // master
  this.requests.shift().respond(
    200,
    null,
    '#EXTM3U\n' +
    '#EXT-X-VERSION:4\n' +
    '#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=1,CODECS="mp4a.40.e, avc1.deadbeef"\n' +
    'media.m3u8\n'
  );
  // media
  this.standardXHRResponse(this.requests.shift());
  return requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock
  }).then(() => {
    assert.equal(createSourceBufferCalls.length, 1, 'called to create source buffers');
    assert.deepEqual(
      createSourceBufferCalls[0],
      {
        audio: 'mp4a.40.e',
        video: 'avc1.deadbeef'
      },
      'passed manifest specified codecs'
    );
  });
});

QUnit.test('translates old-school apple codec strings from manifest to modern standard ' +
'for source buffer creation', function(assert) {
  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const mpc = this.player.tech(true).vhs.masterPlaylistController_;
  const origCreateSourceBuffers =
    mpc.sourceUpdater_.createSourceBuffers.bind(mpc.sourceUpdater_);

  mpc.sourceUpdater_.createSourceBuffers = (codecs) => {
    createSourceBufferCalls.push(codecs);
    origCreateSourceBuffers(codecs);
  };

  openMediaSource(this.player, this.clock);

  // master
  this.requests.shift().respond(
    200,
    null,
    '#EXTM3U\n' +
    '#EXT-X-VERSION:4\n' +
    '#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=1,CODECS="avc1.100.31,mp4a.40.5"\n' +
    'media.m3u8\n'
  );
  // media
  this.standardXHRResponse(this.requests.shift());
  return requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock
  }).then(() => {
    assert.equal(createSourceBufferCalls.length, 1, 'called to create source buffers');
    assert.deepEqual(
      createSourceBufferCalls[0],
      {
        audio: 'mp4a.40.5',
        video: 'avc1.64001f'
      },
      'translated to modern codec strings'
    );
  });
});

QUnit.test('uses default codec strings when provided are invalid', function(assert) {
  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const mpc = this.player.tech(true).vhs.masterPlaylistController_;
  const origCreateSourceBuffers =
    mpc.sourceUpdater_.createSourceBuffers.bind(mpc.sourceUpdater_);

  mpc.sourceUpdater_.createSourceBuffers = (codecs) => {
    createSourceBufferCalls.push(codecs);
    origCreateSourceBuffers(codecs);
  };

  openMediaSource(this.player, this.clock);

  // master
  this.requests.shift().respond(
    200,
    null,
    '#EXTM3U\n' +
    '#EXT-X-VERSION:4\n' +
    '#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=1,CODECS="nope"\n' +
    'media.m3u8\n'
  );
  // media
  this.standardXHRResponse(this.requests.shift());
  return requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock
  }).then(() => {
    assert.equal(createSourceBufferCalls.length, 1, 'called to create source buffers');
    assert.deepEqual(
      createSourceBufferCalls[0],
      {
        audio: 'mp4a.40.2',
        video: 'avc1.4d400d'
      },
      'used default codec strings'
    );
  });
});

QUnit.test('uses codec info from manifest for source buffer creation even when demuxed', function(assert) {
  const done = assert.async();

  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const mpc = this.player.tech(true).vhs.masterPlaylistController_;
  const origCreateSourceBuffers =
    mpc.sourceUpdater_.createSourceBuffers.bind(mpc.sourceUpdater_);

  mpc.sourceUpdater_.createSourceBuffers = (codecs) => {
    createSourceBufferCalls.push(codecs);
    origCreateSourceBuffers(codecs);
  };

  openMediaSource(this.player, this.clock);

  this.requests.shift().respond(
    200,
    null,
    '#EXTM3U\n' +
      '#EXT-X-VERSION:4\n' +
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="en",DEFAULT=YES,AUTOSELECT=YES,' +
        'LANGUAGE="en",URI="media-audio.m3u8"\n' +
      '#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=1,AUDIO="audio",' +
        'CODECS="mp4a.40.e, avc1.deadbeef"\n' +
      'media.m3u8\n'
  );

  // video media
  this.standardXHRResponse(this.requests.shift());
  // audio media
  this.standardXHRResponse(this.requests.shift(), manifests.media);

  assert.equal(createSourceBufferCalls.length, 0, 'have not created source buffers yet');

  let trackinfo = 0;

  const onTrackInfo = function() {
    trackinfo++;
    if (trackinfo !== 2) {
      return;
    }

    assert.equal(createSourceBufferCalls.length, 1, 'called to create source buffers');
    assert.deepEqual(
      createSourceBufferCalls[0],
      {
        audio: 'mp4a.40.e',
        video: 'avc1.deadbeef'
      },
      'passed manifest specified codecs'
    );
    done();
  };

  mpc.mainSegmentLoader_.on('trackinfo', onTrackInfo);
  mpc.audioSegmentLoader_.on('trackinfo', onTrackInfo);

  this.standardXHRResponse(this.requests.shift(), videoSegment());
  this.standardXHRResponse(this.requests.shift(), audioSegment());
});

QUnit.test('uses codec info from manifest for source buffer creation for audio only', function(assert) {
  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const mpc = this.player.tech(true).vhs.masterPlaylistController_;
  const origCreateSourceBuffers =
    mpc.sourceUpdater_.createSourceBuffers.bind(mpc.sourceUpdater_);

  mpc.sourceUpdater_.createSourceBuffers = (codecs) => {
    createSourceBufferCalls.push(codecs);
    origCreateSourceBuffers(codecs);
  };

  openMediaSource(this.player, this.clock);

  // master
  this.requests.shift().respond(
    200,
    null,
    '#EXTM3U\n' +
    '#EXT-X-VERSION:4\n' +
    '#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=1,CODECS="mp4a.40.e"\n' +
    'media.m3u8\n'
  );
  // media
  this.standardXHRResponse(this.requests.shift());
  return requestAndAppendSegment({
    request: this.requests.shift(),
    segment: audioSegment(),
    isOnlyAudio: true,
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock
  }).then(() => {
    assert.equal(createSourceBufferCalls.length, 1, 'called to create source buffers');
    assert.deepEqual(
      createSourceBufferCalls[0],
      {
        audio: 'mp4a.40.e'
      },
      'passed manifest specified audio codec'
    );
  });
});

QUnit.test('uses codec info from manifest for source buffer creation for video only', function(assert) {
  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const mpc = this.player.tech(true).vhs.masterPlaylistController_;
  const origCreateSourceBuffers =
    mpc.sourceUpdater_.createSourceBuffers.bind(mpc.sourceUpdater_);

  mpc.sourceUpdater_.createSourceBuffers = (codecs) => {
    createSourceBufferCalls.push(codecs);
    origCreateSourceBuffers(codecs);
  };

  openMediaSource(this.player, this.clock);

  // master
  this.requests.shift().respond(
    200,
    null,
    '#EXTM3U\n' +
    '#EXT-X-VERSION:4\n' +
    '#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=1,CODECS="avc1.deadbeef"\n' +
    'media.m3u8\n'
  );
  // media
  this.standardXHRResponse(this.requests.shift());
  return requestAndAppendSegment({
    request: this.requests.shift(),
    segment: videoSegment(),
    isOnlyVideo: true,
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock
  }).then(() => {
    assert.equal(createSourceBufferCalls.length, 1, 'called to create source buffers');
    assert.deepEqual(
      createSourceBufferCalls[0],
      {
        video: 'avc1.deadbeef'
      },
      'passed manifest specified video codec'
    );
  });
});

// Technically, the HLS spec at least requires that the user provide all codec info if
// they supply a CODEC attribute. However, we can be a little more flexible in some cases.
QUnit.test('uses available audio codec info from manifest plus video default for source' +
'buffer creation if content looks different from codec info', function(assert) {
  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const mpc = this.player.tech(true).vhs.masterPlaylistController_;
  const origCreateSourceBuffers =
    mpc.sourceUpdater_.createSourceBuffers.bind(mpc.sourceUpdater_);

  mpc.sourceUpdater_.createSourceBuffers = (codecs) => {
    createSourceBufferCalls.push(codecs);
    origCreateSourceBuffers(codecs);
  };

  openMediaSource(this.player, this.clock);

  // master
  this.requests.shift().respond(
    200,
    null,
    '#EXTM3U\n' +
    '#EXT-X-VERSION:4\n' +
    // CODECS specify audio only
    '#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=1,CODECS="mp4a.40.e"\n' +
    'media.m3u8\n'
  );
  // media
  this.standardXHRResponse(this.requests.shift());
  // segment with both audio and video
  return requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock
  }).then(() => {
    assert.equal(createSourceBufferCalls.length, 1, 'called to create source buffers');
    assert.deepEqual(
      createSourceBufferCalls[0],
      {
        audio: 'mp4a.40.e',
        video: DEFAULT_VIDEO_CODEC
      },
      'passed manifest specified codecs and used default'
    );
  });
});

// Technically, the HLS spec at least requires that the user provide all codec info if
// they supply a CODEC attribute. However, we can be a little more flexible in some cases.
QUnit.test('uses available video codec info from manifest plus audio default for source' +
'buffer creation if content looks different from codec info', function(assert) {
  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const mpc = this.player.tech(true).vhs.masterPlaylistController_;
  const origCreateSourceBuffers =
    mpc.sourceUpdater_.createSourceBuffers.bind(mpc.sourceUpdater_);

  mpc.sourceUpdater_.createSourceBuffers = (codecs) => {
    createSourceBufferCalls.push(codecs);
    origCreateSourceBuffers(codecs);
  };

  openMediaSource(this.player, this.clock);

  // master
  this.requests.shift().respond(
    200,
    null,
    '#EXTM3U\n' +
    '#EXT-X-VERSION:4\n' +
    // CODECS specify video only
    '#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=1,CODECS="avc1.deadbeef"\n' +
    'media.m3u8\n'
  );
  // media
  this.standardXHRResponse(this.requests.shift());
  // segment with both audio and video
  return requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock
  }).then(() => {
    assert.equal(createSourceBufferCalls.length, 1, 'called to create source buffers');
    assert.deepEqual(
      createSourceBufferCalls[0],
      {
        audio: DEFAULT_AUDIO_CODEC,
        video: 'avc1.deadbeef'
      },
      'passed manifest specified codecs and used default'
    );
  });
});

QUnit.test('Exception in play promise should be caught', function(assert) {
  const mpc = this.masterPlaylistController;

  mpc.setupSourceBuffers = () => true;
  mpc.tech_ = {
    autoplay: () => true,
    play: () => new Promise(function(resolve, reject) {
      reject(new window.DOMException());
    })
  };
  mpc.handleSourceOpen_();

  assert.ok(true, 'rejects dom exception');
});

QUnit.test(
  'when data URI is a resolved media playlist, ' +
  'state is updated without a playlist request',
  function(assert) {
    this.requests.length = 0;
    // must recreate player for new mock media source to open
    this.player.dispose();
    this.player = createPlayer();

    const manifestObject = parseManifest({ manifestString: manifests.media });

    this.player.src({
      src: `data:application/vnd.videojs.vhs+json,${JSON.stringify(manifestObject)}`,
      type: 'application/vnd.videojs.vhs+json'
    });
    // media source must be open for duration to be set
    openMediaSource(this.player, this.clock);
    // asynchronous setup of initial playlist in playlist loader for JSON sources
    this.clock.tick(1);

    this.masterPlaylistController = this.player.tech_.vhs.masterPlaylistController_;

    // a duration update indicates a master playlist controller state update from the media
    // playlist
    assert.equal(this.masterPlaylistController.duration(), 40, 'duration set');

    // segment loader has started, not waiting on any playlist requests
    assert.equal(this.requests.length, 1, 'one request');
    assert.equal(
      this.requests[0].uri,
      `${window.location.origin}/test/media-00001.ts`,
      'requested first segment'
    );
  }
);

QUnit.test(
  'when data URI is a master playlist with media playlists resolved, ' +
  'state is updated without a playlist request',
  function(assert) {
    this.requests.length = 0;
    // must recreate player for new mock media source to open
    this.player.dispose();
    this.player = createPlayer();

    const manifestObject = parseManifest({ manifestString: manifests.master });
    const mediaObject = parseManifest({ manifestString: manifests.media });

    // prevent warnings for no BANDWIDTH attribute as media playlists within a master
    // should always have the property
    mediaObject.attributes = { BANDWIDTH: 1000 };

    manifestObject.playlists = [mediaObject, mediaObject, mediaObject];
    // placeholder master URI
    addPropertiesToMaster(manifestObject, 'master.m3u8');

    this.player.src({
      src: `data:application/vnd.videojs.vhs+json,${JSON.stringify(manifestObject)}`,
      type: 'application/vnd.videojs.vhs+json'
    });
    // media source must be open for duration to be set
    openMediaSource(this.player, this.clock);
    // asynchronous setup of initial playlist in playlist loader for JSON sources
    this.clock.tick(1);

    this.masterPlaylistController = this.player.tech_.vhs.masterPlaylistController_;

    // a duration update indicates a master playlist controller state update from the media
    // playlist
    assert.equal(this.masterPlaylistController.duration(), 40, 'duration set');

    // segment loader has started, not waiting on any playlist requests
    assert.equal(this.requests.length, 1, 'one request');
    assert.equal(
      this.requests[0].uri,
      `${window.location.origin}/test/media-00001.ts`,
      'requested first segment'
    );
  }
);

QUnit.test(
  'when data URI is a master playlist without media playlists resolved, ' +
  'a media playlist request is the first request',
  function(assert) {
    this.requests.length = 0;
    // must recreate player for new mock media source to open
    this.player.dispose();
    this.player = createPlayer();

    const manifestObject = parseManifest({ manifestString: manifests.master });

    this.player.src({
      src: `data:application/vnd.videojs.vhs+json,${JSON.stringify(manifestObject)}`,
      type: 'application/vnd.videojs.vhs+json'
    });
    // media source must be open for duration to be set
    openMediaSource(this.player, this.clock);

    this.masterPlaylistController = this.player.tech_.vhs.masterPlaylistController_;

    assert.equal(this.requests.length, 1, 'one request');
    assert.equal(
      this.requests[0].uri,
      `${window.location.origin}/test/media2.m3u8`,
      'requested media playlist'
    );
  }
);

QUnit.test('adds duration to media source after loading playlist', function(assert) {
  openMediaSource(this.player, this.clock);
  const mpc = this.masterPlaylistController;

  // master
  this.standardXHRResponse(this.requests.shift());

  assert.notOk(mpc.mediaSource.duration, 'no duration set on media source');

  // playlist
  this.standardXHRResponse(this.requests.shift());

  assert.equal(mpc.mediaSource.duration, 40, 'duration set on media source');
});

QUnit.test('live playlist reports infinite duration', function(assert) {
  openMediaSource(this.player, this.clock);
  const mpc = this.masterPlaylistController;

  // master
  this.standardXHRResponse(this.requests.shift());

  assert.notOk(mpc.mediaSource.duration, 'no duration set on media source');

  this.requests.shift().respond(
    200, null,
    '#EXTM3U\n' +
                                '#EXTINF:5.0\n' +
                                '0.ts\n'
  );

  assert.equal(mpc.duration(), Infinity, 'duration reported as infinite');
});

QUnit.test(
  'live playlist sets duration of media source to seekable end',
  function(assert) {
    openMediaSource(this.player, this.clock);
    const mpc = this.masterPlaylistController;

    // master
    this.standardXHRResponse(this.requests.shift());

    assert.notOk(mpc.mediaSource.duration, 'no duration set on media source');

    // since the safe live end will be 3 target durations back, in order for there to be a
    // positive seekable end, there should be at least 4 segments
    this.requests.shift().respond(200, null, `
    #EXTM3U
    #EXT-X-TARGETDURATION:5
    #EXTINF:5
    0.ts
    #EXTINF:5
    1.ts
    #EXTINF:5
    2.ts
    #EXTINF:5
    3.ts
  `);

    assert.equal(mpc.seekable().end(0), 5, 'calculated seekable end');
    assert.equal(
      mpc.mediaSource.duration,
      5,
      'native media source duration set to seekable end'
    );
  }
);

QUnit.test(
  'VOD playlist sets duration of media source to calculated playlist duration',
  function(assert) {
    openMediaSource(this.player, this.clock);
    const mpc = this.masterPlaylistController;

    // master
    this.standardXHRResponse(this.requests.shift());

    assert.notOk(mpc.mediaSource.duration, 'no duration set on media source');

    this.requests.shift().respond(200, null, `
    #EXTM3U
    #EXT-X-TARGETDURATION:5
    #EXTINF:5
    0.ts
    #EXTINF:5
    1.ts
    #EXT-X-ENDLIST
  `);

    assert.equal(mpc.mediaSource.duration, 10, 'media source duration set to 10');
  }
);

QUnit.test(
  'VOD playlist sets duration of media source to buffered end if greater than calculated ' +
'playlist duration',
  function(assert) {
    openMediaSource(this.player, this.clock);
    const mpc = this.masterPlaylistController;

    this.player.tech_.buffered = () => videojs.createTimeRanges([[0, 11]]);

    // master
    this.standardXHRResponse(this.requests.shift());

    assert.notOk(mpc.mediaSource.duration, 'no duration set on media source');

    this.requests.shift().respond(200, null, `
    #EXTM3U
    #EXT-X-TARGETDURATION:5
    #EXTINF:5
    0.ts
    #EXTINF:5
    1.ts
    #EXT-X-ENDLIST
  `);

    assert.equal(mpc.mediaSource.duration, 11, 'media source duration set to 11');
  }
);

QUnit.test('disposes timeline change controller on dispose', function(assert) {
  let disposes = 0;

  this.masterPlaylistController.timelineChangeController_.on('dispose', () => {
    disposes++;
  });

  this.masterPlaylistController.dispose();

  assert.equal(disposes, 1, 'disposed timeline change controller');
});

QUnit.test('on error all segment and playlist loaders are paused and aborted', function(assert) {
  const mpc = this.masterPlaylistController;
  const calls = {};
  const expected = {};

  Object.keys(this.masterPlaylistController.mediaTypes_).forEach((type) => {
    const key = `${type.toLowerCase()}Playlist`;

    calls[`${key}Abort`] = 0;
    calls[`${key}Pause`] = 0;
    expected[`${key}Abort`] = 1;
    expected[`${key}Pause`] = 1;

    this.masterPlaylistController.mediaTypes_[type].activePlaylistLoader = {
      pause: () => calls[`${key}Pause`]++,
      abort: () => calls[`${key}Abort`]++
    };
  });

  [
    'audioSegmentLoader',
    'subtitleSegmentLoader',
    'mainSegmentLoader',
    'masterPlaylistLoader'
  ].forEach(function(key) {
    calls[`${key}Abort`] = 0;
    calls[`${key}Pause`] = 0;
    expected[`${key}Abort`] = 1;
    expected[`${key}Pause`] = 1;
    mpc[`${key}_`].pause = () => calls[`${key}Pause`]++;
    mpc[`${key}_`].abort = () => calls[`${key}Abort`]++;
  });

  this.masterPlaylistController.trigger('error');

  assert.deepEqual(calls, expected, 'calls as expected');
});

QUnit.test('can pass or select a playlist for fastQualityChange', function(assert) {
  const calls = {
    resetEverything: 0,
    resyncLoader: 0,
    media: 0,
    selectPlaylist: 0
  };

  const mpc = this.masterPlaylistController;

  mpc.mediaSource.trigger('sourceopen');
  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  // media is changed
  mpc.selectPlaylist = () => {
    calls.selectPlaylist++;
    return mpc.master().playlists[1];
  };
  mpc.masterPlaylistLoader_.media = (playlist) => {
    if (!playlist) {
      return mpc.master().playlists[0];
    }
    assert.equal(mpc.master().playlists[1], playlist, 'switching to passed in playlist');
    calls.media++;
  };

  mpc.mainSegmentLoader_.resyncLoader = function() {
    calls.resyncLoader++;
  };

  mpc.mainSegmentLoader_.resetEverything = () => {
    calls.resetEverything++;
  };

  mpc.fastQualityChange_(mpc.master().playlists[1]);
  assert.deepEqual(calls, {
    resetEverything: 1,
    media: 1,
    selectPlaylist: 0,
    resyncLoader: 0
  }, 'calls expected function when passed a playlist');

  mpc.fastQualityChange_();
  assert.deepEqual(calls, {
    resetEverything: 2,
    media: 2,
    selectPlaylist: 1,
    resyncLoader: 0
  }, 'calls expected function when not passed a playlist');
});

QUnit.test('can pass or select a playlist for smoothQualityChange_', function(assert) {
  const calls = {
    resetEverything: 0,
    resyncLoader: 0,
    media: 0,
    selectPlaylist: 0
  };

  const mpc = this.masterPlaylistController;

  mpc.mediaSource.trigger('sourceopen');
  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  // media is changed
  mpc.selectPlaylist = () => {
    calls.selectPlaylist++;
    return mpc.master().playlists[1];
  };
  mpc.masterPlaylistLoader_.media = (playlist) => {
    if (!playlist) {
      return mpc.master().playlists[0];
    }
    assert.equal(mpc.master().playlists[1], playlist, 'switching to passed in playlist');
    calls.media++;
  };

  mpc.mainSegmentLoader_.resyncLoader = function() {
    calls.resyncLoader++;
  };

  mpc.mainSegmentLoader_.resetEverything = () => {
    calls.resetEverything++;
  };

  mpc.smoothQualityChange_(mpc.master().playlists[1]);
  assert.deepEqual(calls, {
    resetEverything: 0,
    media: 1,
    selectPlaylist: 0,
    resyncLoader: 1
  }, 'calls expected function when passed a playlist');

  mpc.smoothQualityChange_();
  assert.deepEqual(calls, {
    resetEverything: 0,
    media: 2,
    selectPlaylist: 1,
    resyncLoader: 2
  }, 'calls expected function when not passed a playlist');
});

QUnit.module('MasterPlaylistController codecs', {
  beforeEach(assert) {
    sharedHooks.beforeEach.call(this, assert);
    this.mpc = this.masterPlaylistController;

    this.blacklists = [];
    this.mpc.blacklistCurrentPlaylist = (blacklist) => this.blacklists.push(blacklist);

    this.contentSetup = (options) => {
      const {
        audioStartingMedia,
        mainStartingMedia,
        audioPlaylist,
        mainPlaylist
      } = options;

      if (mainStartingMedia) {
        this.mpc.mainSegmentLoader_.currentMediaInfo_ = mainStartingMedia;
      }

      if (audioStartingMedia) {
        this.mpc.audioSegmentLoader_.currentMediaInfo_ = audioStartingMedia;
      }

      this.master = {mediaGroups: {AUDIO: {}}, playlists: []};

      this.mpc.master = () => this.master;

      if (mainPlaylist) {
        this.mpc.media = () => mainPlaylist;
        this.master.playlists.push(mainPlaylist);
      }

      if (audioPlaylist) {
        const mainAudioGroup = mainPlaylist && mainPlaylist.attributes.AUDIO;

        if (mainAudioGroup) {
          this.master.mediaGroups.AUDIO[mainAudioGroup] = {
            english: {
              default: true,
              playlists: [audioPlaylist]
            }
          };
        }
        this.master.playlists.push(audioPlaylist);
        this.mpc.mediaTypes_.AUDIO.activePlaylistLoader = {pause() {}};
      }
    };
  },
  afterEach(assert) {
    sharedHooks.afterEach.call(this, assert);
  }
});

QUnit.test('can get demuxed codecs from the video/main', function(assert) {
  this.contentSetup({
    audioStartingMedia: {hasAudio: true, hasVideo: false},
    mainStartingMedia: {hasVideo: true, hasAudio: false},
    audioPlaylist: {attributes: {}},
    mainPlaylist: {attributes: {CODECS: 'avc1.4c400d,mp4a.40.5', AUDIO: 'low-quality'}}
  });

  const codecs = this.mpc.getCodecsOrExclude_();

  assert.deepEqual(this.blacklists, [], 'did not blacklist anything');
  assert.deepEqual(codecs, {audio: 'mp4a.40.5', video: 'avc1.4c400d'}, 'codecs returned');
});

QUnit.test('can get demuxed codecs from the video/main playlist and audio playlist', function(assert) {
  this.contentSetup({
    audioStartingMedia: {hasAudio: true, hasVideo: false},
    mainStartingMedia: {hasVideo: true, hasAudio: false},
    audioPlaylist: {attributes: {CODECS: 'mp4a.40.5'}},
    mainPlaylist: {attributes: {CODECS: 'avc1.4c400d', AUDIO: 'low-quality'}}
  });

  const codecs = this.mpc.getCodecsOrExclude_();

  assert.deepEqual(this.blacklists, [], 'did not blacklist anything');
  assert.deepEqual(codecs, {audio: 'mp4a.40.5', video: 'avc1.4c400d'}, 'codecs returned');
});

QUnit.test('can get demuxed codecs from the main and audio loaders', function(assert) {
  this.contentSetup({
    audioStartingMedia: {hasAudio: true, hasVideo: false, audioCodec: 'mp4a.40.5'},
    mainStartingMedia: {hasVideo: true, hasAudio: false, videoCodec: 'avc1.4c400d'},
    audioPlaylist: {attributes: {}},
    mainPlaylist: {attributes: {}}
  });

  const codecs = this.mpc.getCodecsOrExclude_();

  assert.deepEqual(this.blacklists, [], 'did not blacklist anything');
  assert.deepEqual(codecs, {audio: 'mp4a.40.5', video: 'avc1.4c400d'}, 'codecs returned');
});

QUnit.test('can get demuxed codecs from the main loader', function(assert) {
  this.contentSetup({
    audioStartingMedia: {},
    mainStartingMedia: {hasVideo: true, hasAudio: true, videoCodec: 'avc1.4c400d', audioCodec: 'mp4a.40.5'},
    audioPlaylist: {attributes: {}},
    mainPlaylist: {attributes: {}}
  });

  const codecs = this.mpc.getCodecsOrExclude_();

  assert.deepEqual(this.blacklists, [], 'did not blacklist anything');
  assert.deepEqual(codecs, {audio: 'mp4a.40.5', video: 'avc1.4c400d'}, 'codecs returned');
});

QUnit.test('can get muxed codecs from video/main playlist', function(assert) {
  this.contentSetup({
    mainStartingMedia: {hasVideo: true, hasAudio: true, isMuxed: true},
    mainPlaylist: {attributes: {CODECS: 'avc1.4c400d,mp4a.40.5'}}
  });

  const codecs = this.mpc.getCodecsOrExclude_();

  assert.deepEqual(this.blacklists, [], 'did not blacklist anything');
  assert.deepEqual(codecs, {video: 'avc1.4c400d,mp4a.40.5'}, 'codecs returned');
});

QUnit.test('can get muxed codecs from video/main loader', function(assert) {
  this.contentSetup({
    mainStartingMedia: {
      hasVideo: true,
      hasAudio: true,
      isMuxed: true,
      videoCodec: 'avc1.4c400d',
      audioCodec: 'mp4a.40.5'
    },
    mainPlaylist: {attributes: {}}
  });

  const codecs = this.mpc.getCodecsOrExclude_();

  assert.deepEqual(this.blacklists, [], 'did not blacklist anything');
  assert.deepEqual(codecs, {video: 'avc1.4c400d,mp4a.40.5'}, 'codecs returned');
});

QUnit.test('can get audio only codecs from main playlist ', function(assert) {
  this.contentSetup({
    mainStartingMedia: {hasVideo: false, hasAudio: true},
    mainPlaylist: {attributes: {CODECS: 'mp4a.40.5'}}
  });

  const codecs = this.mpc.getCodecsOrExclude_();

  assert.deepEqual(this.blacklists, [], 'did not blacklist anything');
  assert.deepEqual(codecs, {audio: 'mp4a.40.5'}, 'codecs returned');
});

QUnit.test('can get audio only codecs from main loader ', function(assert) {
  this.contentSetup({
    mainStartingMedia: {hasVideo: false, hasAudio: true, audioCodec: 'mp4a.40.5'},
    mainPlaylist: {attributes: {}}
  });

  const codecs = this.mpc.getCodecsOrExclude_();

  assert.deepEqual(this.blacklists, [], 'did not blacklist anything');
  assert.deepEqual(codecs, {audio: 'mp4a.40.5'}, 'codecs returned');
});

QUnit.test('can get video only codecs from main playlist', function(assert) {
  this.contentSetup({
    mainStartingMedia: {hasVideo: true, hasAudio: false},
    mainPlaylist: {attributes: {CODECS: 'avc1.4c400d'}}
  });

  const codecs = this.mpc.getCodecsOrExclude_();

  assert.deepEqual(this.blacklists, [], 'did not blacklist anything');
  assert.deepEqual(codecs, {video: 'avc1.4c400d'}, 'codecs returned');
});

QUnit.test('can get video only codecs from main loader', function(assert) {
  this.contentSetup({
    mainStartingMedia: {hasVideo: true, hasAudio: false, videoCodec: 'avc1.4c400d'},
    mainPlaylist: {attributes: {}}
  });

  const codecs = this.mpc.getCodecsOrExclude_();

  assert.deepEqual(this.blacklists, [], 'did not blacklist anything');
  assert.deepEqual(codecs, {video: 'avc1.4c400d'}, 'codecs returned');
});

QUnit.test('can get codecs from startingMedia', function(assert) {
  this.contentSetup({
    mainStartingMedia: {videoCodec: 'avc1.4c400d', hasVideo: true, hasAudio: false},
    audioStartingMedia: {audioCodec: 'mp4a.40.5', hasVideo: false, hasAudio: true},
    mainPlaylist: {attributes: {}},
    audioPlaylist: {attributes: {}}
  });

  const codecs = this.mpc.getCodecsOrExclude_();

  assert.deepEqual(this.blacklists, [], 'did not blacklist anything');
  assert.deepEqual(codecs, {video: 'avc1.4c400d', audio: 'mp4a.40.5'}, 'codecs returned');
});

QUnit.test('playlist codecs take priority over others', function(assert) {
  this.contentSetup({
    mainStartingMedia: {videoCodec: 'avc1.4c400d', hasVideo: true, hasAudio: false},
    audioStartingMedia: {audioCodec: 'mp4a.40.5', hasVideo: false, hasAudio: true},
    mainPlaylist: {attributes: {CODECS: 'avc1.4b400d', AUDIO: 'low-quality'}},
    audioPlaylist: {attributes: {CODECS: 'mp4a.40.20'}}
  });

  const codecs = this.mpc.getCodecsOrExclude_();

  assert.deepEqual(this.blacklists, [], 'did not blacklist anything');
  assert.deepEqual(codecs, {video: 'avc1.4b400d', audio: 'mp4a.40.20'}, 'codecs returned');
});

QUnit.test('uses default codecs if no codecs are found', function(assert) {
  this.contentSetup({
    mainStartingMedia: {hasVideo: true, hasAudio: false},
    audioStartingMedia: {hasVideo: false, hasAudio: true},
    mainPlaylist: {attributes: {}},
    audioPlaylist: {attributes: {}}
  });

  const codecs = this.mpc.getCodecsOrExclude_();

  assert.deepEqual(this.blacklists, [], 'did not blacklist anything');
  assert.deepEqual(codecs, {video: 'avc1.4d400d', audio: 'mp4a.40.2'}, 'codecs returned');
});

QUnit.test('excludes playlist without detected audio/video', function(assert) {
  this.contentSetup({
    mainStartingMedia: {},
    audioStartingMedia: {},
    mainPlaylist: {attributes: {}}
  });

  const codecs = this.mpc.getCodecsOrExclude_();

  assert.deepEqual(this.blacklists, [{
    blacklistDuration: Infinity,
    message: 'Could not determine codecs for playlist.',
    playlist: {attributes: {}}
  }], 'blacklisted playlist');
  assert.deepEqual(codecs, void 0, 'no codecs returned');
});

QUnit.test('excludes unsupported muxer codecs for ts', function(assert) {
  this.contentSetup({
    mainStartingMedia: {
      videoCodec: 'hvc1.2.4.L123.B0',
      hasVideo: true,
      hasAudio: true,
      audioCodec: 'ac-3'
    },
    mainPlaylist: {attributes: {}}
  });

  const codecs = this.mpc.getCodecsOrExclude_();

  assert.deepEqual(this.blacklists, [{
    blacklistDuration: Infinity,
    playlist: {attributes: {}},
    internal: true,
    message: 'muxer does not support codec(s): "hvc1.2.4.L123.B0,ac-3".'
  }], 'blacklisted playlist');
  assert.deepEqual(codecs, void 0, 'codecs returned');
});

QUnit.test('excludes unsupported browser codecs for muxed fmp4', function(assert) {
  this.contentSetup({
    mainStartingMedia: {
      videoCodec: 'hvc1.2.4.L123.B0',
      hasVideo: true,
      hasAudio: true,
      isFmp4: true,
      isMuxed: true,
      audioCodec: 'ac-3'
    },
    mainPlaylist: {attributes: {}}
  });

  window.MediaSource.isTypeSupported = (type) => (/(mp4a|avc1)/).test(type);

  const codecs = this.mpc.getCodecsOrExclude_();

  assert.deepEqual(this.blacklists, [{
    blacklistDuration: Infinity,
    playlist: {attributes: {}},
    internal: true,
    message: 'browser does not support codec(s): "hvc1.2.4.L123.B0,ac-3".'
  }], 'blacklisted playlist');
  assert.deepEqual(codecs, void 0, 'codecs returned');
});

QUnit.test('excludes unsupported muxer codecs for muxed ts', function(assert) {
  this.contentSetup({
    mainStartingMedia: {
      videoCodec: 'hvc1.2.4.L123.B0',
      hasVideo: true,
      hasAudio: true,
      isMuxed: true,
      audioCodec: 'ac-3'
    },
    mainPlaylist: {attributes: {}}
  });

  const codecs = this.mpc.getCodecsOrExclude_();

  assert.deepEqual(this.blacklists, [{
    blacklistDuration: Infinity,
    playlist: {attributes: {}},
    internal: true,
    message: 'muxer does not support codec(s): "hvc1.2.4.L123.B0,ac-3".'
  }], 'blacklisted playlist');
  assert.deepEqual(codecs, void 0, 'codecs returned');
});

QUnit.test('excludes unsupported browser codecs for fmp4', function(assert) {
  this.contentSetup({
    mainStartingMedia: {
      videoCodec: 'hvc1.2.4.L123.B0',
      hasVideo: true,
      hasAudio: true,
      audioCodec: 'ac-3',
      isFmp4: true
    },
    mainPlaylist: {attributes: {}}
  });

  window.MediaSource.isTypeSupported = (type) => (/(mp4a|avc1)/).test(type);

  const codecs = this.mpc.getCodecsOrExclude_();

  assert.deepEqual(this.blacklists, [{
    blacklistDuration: Infinity,
    playlist: {attributes: {}},
    internal: true,
    message: 'browser does not support codec(s): "hvc1.2.4.L123.B0,ac-3".'
  }], 'blacklisted playlist');
  assert.deepEqual(codecs, void 0, 'codecs returned');
});

QUnit.test('excludes unsupported codecs video ts, audio fmp4', function(assert) {
  this.contentSetup({
    mainStartingMedia: {
      videoCodec: 'hvc1.2.4.L123.B0',
      hasVideo: true,
      hasAudio: false
    },
    audioStartingMedia: {
      hasVideo: false,
      hasAudio: true,
      audioCodec: 'ac-3',
      isFmp4: true
    },
    mainPlaylist: {attributes: {AUDIO: 'low-quality'}},
    audioPlaylist: {attributes: {}}
  });

  window.MediaSource.isTypeSupported = (type) => (/(mp4a|avc1)/).test(type);

  const codecs = this.mpc.getCodecsOrExclude_();

  assert.deepEqual(this.blacklists, [{
    blacklistDuration: Infinity,
    playlist: {attributes: {AUDIO: 'low-quality'}},
    internal: true,
    message: 'muxer does not support codec(s): "hvc1.2.4.L123.B0", browser does not support codec(s): "ac-3".'
  }], 'blacklisted playlist');
  assert.deepEqual(codecs, void 0, 'codecs returned');
});

QUnit.test('excludes unsupported codecs video fmp4, audio ts', function(assert) {
  this.contentSetup({
    mainStartingMedia: {
      videoCodec: 'hvc1.2.4.L123.B0',
      hasVideo: true,
      hasAudio: false,
      isFmp4: true
    },
    audioStartingMedia: {
      hasVideo: false,
      hasAudio: true,
      audioCodec: 'ac-3'
    },
    mainPlaylist: {attributes: {AUDIO: 'low-quality'}},
    audioPlaylist: {attributes: {}}
  });

  window.MediaSource.isTypeSupported = (type) => (/(mp4a|avc1)/).test(type);

  const codecs = this.mpc.getCodecsOrExclude_();

  assert.deepEqual(this.blacklists, [{
    blacklistDuration: Infinity,
    playlist: {attributes: {AUDIO: 'low-quality'}},
    internal: true,
    message: 'browser does not support codec(s): "hvc1.2.4.L123.B0", muxer does not support codec(s): "ac-3".'
  }], 'blacklisted playlist');
  assert.deepEqual(codecs, void 0, 'codecs returned');
});

QUnit.test('excludes all of audio group on unsupported audio', function(assert) {
  this.contentSetup({
    mainStartingMedia: {
      videoCodec: 'hvc1.2.4.L123.B0',
      hasVideo: true,
      hasAudio: false
    },
    audioStartingMedia: {
      hasVideo: false,
      hasAudio: true,
      audioCodec: 'ac-3'
    },
    mainPlaylist: {id: 'bar', attributes: {AUDIO: 'low-quality'}},
    audioPlaylist: {attributes: {}}
  });

  this.master.playlists.push({id: 'foo', attributes: {AUDIO: 'low-quality'}});
  this.master.playlists.push({id: 'baz', attributes: {AUDIO: 'low-quality'}});

  const codecs = this.mpc.getCodecsOrExclude_();

  assert.deepEqual(this.blacklists, [{
    blacklistDuration: Infinity,
    playlist: {attributes: {AUDIO: 'low-quality'}, id: 'bar'},
    internal: true,
    message: 'muxer does not support codec(s): "hvc1.2.4.L123.B0,ac-3".'
  }], 'blacklisted playlist');
  assert.deepEqual(codecs, void 0, 'codecs returned');
  assert.equal(this.master.playlists[2].id, 'foo', 'playlist 3 is the one we added');
  assert.equal(this.master.playlists[2].excludeUntil, Infinity, 'playlist 3 with same audio group excluded');
  assert.equal(this.master.playlists[3].id, 'baz', 'playlist 4 is the one we added');
  assert.equal(this.master.playlists[3].excludeUntil, Infinity, 'playlist 4 with same audio group excluded');
});

QUnit.test('excludes on codec switch if codec switching not supported', function(assert) {
  this.contentSetup({
    mainStartingMedia: {
      videoCodec: 'hvc1.2.4.L123.B0',
      hasVideo: true,
      hasAudio: false,
      isFmp4: true
    },
    audioStartingMedia: {
      hasVideo: false,
      hasAudio: true,
      audioCodec: 'ac-3',
      isFmp4: true
    },
    mainPlaylist: {attributes: {AUDIO: 'low-quality'}},
    audioPlaylist: {attributes: {}}
  });

  // sourceUpdater_ already setup
  this.mpc.sourceUpdater_.ready = () => true;
  this.mpc.sourceUpdater_.canChangeType = () => false;
  this.mpc.sourceUpdater_.codecs = {
    audio: 'mp4a.40.2',
    video: 'avc1.4c400d'
  };

  // support all types
  window.MediaSource.isTypeSupported = (type) => true;

  const codecs = this.mpc.getCodecsOrExclude_();

  assert.deepEqual(this.blacklists, [{
    blacklistDuration: Infinity,
    playlist: {attributes: {AUDIO: 'low-quality'}},
    internal: true,
    message: 'Codec switching not supported: "avc1.4c400d" -> "hvc1.2.4.L123.B0", "mp4a.40.2" -> "ac-3".'
  }], 'blacklisted playlist');
  assert.deepEqual(codecs, void 0, 'codecs returned');
});

QUnit.test('does not exclude on codec switch between the same base codec', function(assert) {
  this.contentSetup({
    mainStartingMedia: {
      videoCodec: 'avc1.4d400e',
      hasVideo: true,
      hasAudio: false,
      isFmp4: true
    },
    audioStartingMedia: {
      hasVideo: false,
      hasAudio: true,
      audioCodec: 'mp4a.40.5',
      isFmp4: true
    },
    mainPlaylist: {attributes: {AUDIO: 'low-quality'}},
    audioPlaylist: {attributes: {}}
  });

  // sourceUpdater_ already setup
  this.mpc.sourceUpdater_.ready = () => true;
  this.mpc.sourceUpdater_.canChangeType = () => false;
  this.mpc.sourceUpdater_.codecs = {
    audio: 'mp4a.40.2',
    video: 'avc1.4c400d'
  };

  // support all types
  window.MediaSource.isTypeSupported = (type) => true;

  const codecs = this.mpc.getCodecsOrExclude_();

  assert.deepEqual(this.blacklists, []);
  assert.deepEqual(codecs, {video: 'avc1.4d400e', audio: 'mp4a.40.5'}, 'codecs returned');
});

QUnit.test('main loader only trackinfo works as expected', function(assert) {
  this.mpc.mediaSource.readyState = 'open';
  let createBuffers = 0;
  let switchBuffers = 0;
  let expectedCodecs;

  this.mpc.sourceUpdater_.createSourceBuffers = (codecs) => {
    assert.deepEqual(codecs, expectedCodecs, 'create source buffers codecs as expected');
    createBuffers++;
  };
  this.mpc.sourceUpdater_.addOrChangeSourceBuffers = (codecs) => {
    assert.deepEqual(codecs, expectedCodecs, 'codec switch as expected');
    switchBuffers++;
  };

  this.contentSetup({
    mainStartingMedia: {
      videoCodec: 'avc1.4d400e',
      hasVideo: true,
      hasAudio: true,
      audioCodec: 'mp4a.40.2'
    },
    mainPlaylist: {attributes: {}}
  });

  expectedCodecs = {
    video: 'avc1.4d400e',
    audio: 'mp4a.40.2'
  };
  this.mpc.mainSegmentLoader_.trigger('trackinfo');

  assert.equal(createBuffers, 1, 'createSourceBuffers called');
  assert.equal(switchBuffers, 0, 'addOrChangeSourceBuffers not called');

  this.mpc.sourceUpdater_.ready = () => true;
  this.mpc.sourceUpdater_.canChangeType = () => true;

  this.contentSetup({
    mainStartingMedia: {
      videoCodec: 'avc1.4c400e',
      hasVideo: true,
      hasAudio: true,
      audioCodec: 'mp4a.40.5'
    },
    mainPlaylist: {attributes: {}}
  });

  expectedCodecs = {
    video: 'avc1.4c400e',
    audio: 'mp4a.40.5'
  };

  this.mpc.mainSegmentLoader_.trigger('trackinfo');

  assert.equal(createBuffers, 1, 'createBuffers not called');
  assert.equal(switchBuffers, 1, 'addOrChangeSourceBuffers called');
});

QUnit.test('main & audio loader only trackinfo works as expected', function(assert) {
  this.mpc.mediaSource.readyState = 'open';
  let createBuffers = 0;
  let switchBuffers = 0;
  let expectedCodecs;

  this.mpc.sourceUpdater_.createSourceBuffers = (codecs) => {
    assert.deepEqual(codecs, expectedCodecs, 'create source buffers codecs as expected');
    createBuffers++;
  };
  this.mpc.sourceUpdater_.addOrChangeSourceBuffers = (codecs) => {
    assert.deepEqual(codecs, expectedCodecs, 'codec switch as expected');
    switchBuffers++;
  };

  this.contentSetup({
    mainStartingMedia: {
      videoCodec: 'avc1.4d400e',
      hasVideo: true,
      hasAudio: false
    },
    mainPlaylist: {attributes: {}},
    audioPlaylist: {attributes: {}}
  });

  expectedCodecs = {
    video: 'avc1.4d400e',
    audio: 'mp4a.40.2'
  };

  this.mpc.mainSegmentLoader_.trigger('trackinfo');

  assert.equal(createBuffers, 0, 'createSourceBuffers not called');
  assert.equal(switchBuffers, 0, 'addOrChangeSourceBuffers not called');

  this.mpc.audioSegmentLoader_.currentMediaInfo_ = {
    hasVideo: false,
    hasAudio: true,
    audioCodec: 'mp4a.40.2'
  };

  this.mpc.audioSegmentLoader_.trigger('trackinfo');

  assert.equal(createBuffers, 1, 'createSourceBuffers called');
  assert.equal(switchBuffers, 0, 'addOrChangeSourceBuffers not called');

  this.mpc.sourceUpdater_.ready = () => true;
  this.mpc.sourceUpdater_.canChangeType = () => true;

  this.mpc.mainSegmentLoader_.currentMediaInfo_ = {
    videoCodec: 'avc1.4c400e',
    hasVideo: true,
    hasAudio: false
  };

  expectedCodecs = {
    video: 'avc1.4c400e',
    audio: 'mp4a.40.2'
  };

  this.mpc.mainSegmentLoader_.trigger('trackinfo');

  assert.equal(createBuffers, 1, 'createBuffers not called');
  assert.equal(switchBuffers, 1, 'addOrChangeSourceBuffers called');

  this.mpc.audioSegmentLoader_.currentMediaInfo_ = {
    hasVideo: false,
    hasAudio: true,
    audioCodec: 'mp4a.40.5'
  };

  expectedCodecs = {
    video: 'avc1.4c400e',
    audio: 'mp4a.40.5'
  };

  this.mpc.audioSegmentLoader_.trigger('trackinfo');

  assert.equal(createBuffers, 1, 'createBuffers not called');
  assert.equal(switchBuffers, 2, 'addOrChangeSourceBuffers called');
});

QUnit.module('MasterPlaylistController - exclusion behavior', {
  beforeEach(assert) {
    sharedHooks.beforeEach.call(this, assert);

    this.mpc = this.masterPlaylistController;

    openMediaSource(this.player, this.clock);

    this.player.tech_.vhs.bandwidth = 1;

    this.delegateLoaders = [];
    this.mpc.delegateLoaders_ = (filter, fnNames) => {
      this.delegateLoaders.push({filter, fnNames});
    };

    this.runTest = (master, expectedDelegates) => {
      // master
      this.requests.shift()
        .respond(200, null, master);

      // media
      this.standardXHRResponse(this.requests.shift());

      assert.equal(this.mpc.media(), this.mpc.master().playlists[0], 'selected first playlist');

      this.mpc.blacklistCurrentPlaylist({
        internal: true,
        playlist: this.mpc.master().playlists[0],
        blacklistDuration: Infinity
      });

      assert.equal(this.mpc.master().playlists[0].excludeUntil, Infinity, 'exclusion happened');
      assert.deepEqual(this.delegateLoaders, expectedDelegates, 'called delegateLoaders');
    };
  },
  afterEach(assert) {
    sharedHooks.afterEach.call(this, assert);
  }
});

QUnit.test('exclusions always pause/abort main/master loaders', function(assert) {
  const master = `
    #EXTM3U
    #EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.5"
    media.m3u8
    #EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400d,mp4a.40.2"
    media1.m3u8
  `;

  const expectedDelegates = [
    {filter: 'main', fnNames: ['abort', 'pause']}
  ];

  this.runTest(master, expectedDelegates);
});

QUnit.test('exclusions that remove audio group abort/pause main/audio loaders', function(assert) {
  const master = `
    #EXTM3U
    #EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.5",AUDIO="foo"
    media.m3u8'
    #EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400d,mp4a.40.2"
    media1.m3u8
  `;

  const expectedDelegates = [
    {filter: 'audio', fnNames: ['abort', 'pause']},
    {filter: 'main', fnNames: ['abort', 'pause']}
  ];

  this.runTest(master, expectedDelegates);
});

QUnit.test('exclusions that change audio group abort/pause main/audio loaders', function(assert) {
  const master = `
    #EXTM3U
    #EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.5",AUDIO="foo"
    media.m3u8'
    #EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400d,mp4a.40.2",AUDIO="bar"
    media1.m3u8
  `;

  const expectedDelegates = [
    {filter: 'audio', fnNames: ['abort', 'pause']},
    {filter: 'main', fnNames: ['abort', 'pause']}
  ];

  this.runTest(master, expectedDelegates);
});

QUnit.test('exclusions that add audio group abort/pause main/audio loaders', function(assert) {
  const master = `
    #EXTM3U
    #EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.5"
    media.m3u8'
    #EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400d,mp4a.40.2",AUDIO="bar"
    media1.m3u8
  `;

  const expectedDelegates = [
    {filter: 'audio', fnNames: ['abort', 'pause']},
    {filter: 'main', fnNames: ['abort', 'pause']}
  ];

  this.runTest(master, expectedDelegates);
});

QUnit.test('exclusions that add subtitles group abort/pause main/subtitles loaders', function(assert) {
  const master = `
    #EXTM3U
    #EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.5"
    media.m3u8'
    #EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400d,mp4a.40.2",SUBTITLES="foo
    media1.m3u8
  `;

  const expectedDelegates = [
    {filter: 'subtitle', fnNames: ['abort', 'pause']},
    {filter: 'main', fnNames: ['abort', 'pause']}
  ];

  this.runTest(master, expectedDelegates);
});

QUnit.test('exclusions that remove subtitles group abort/pause main/subtitles loaders', function(assert) {
  const master = `
    #EXTM3U
    #EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.5",SUBTITLES="foo"
    media.m3u8'
    #EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400d,mp4a.40.2"
    media1.m3u8
  `;

  const expectedDelegates = [
    {filter: 'subtitle', fnNames: ['abort', 'pause']},
    {filter: 'main', fnNames: ['abort', 'pause']}
  ];

  this.runTest(master, expectedDelegates);
});

QUnit.test('exclusions that change subtitles group abort/pause main/subtitles loaders', function(assert) {
  const master = `
    #EXTM3U
    #EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.5",SUBTITLES="foo"
    media.m3u8'
    #EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400d,mp4a.40.2",SUBTITLES="bar"
    media1.m3u8
  `;

  const expectedDelegates = [
    {filter: 'subtitle', fnNames: ['abort', 'pause']},
    {filter: 'main', fnNames: ['abort', 'pause']}
  ];

  this.runTest(master, expectedDelegates);
});

QUnit.test('exclusions that change all groups abort/pause all loaders', function(assert) {
  const master = `
    #EXTM3U
    #EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.5",AUDIO="foo",SUBTITLES="foo"
    media.m3u8'
    #EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400d,mp4a.40.2",AUDIO="bar",SUBTITLES="bar"
    media1.m3u8
  `;

  const expectedDelegates = [
    {filter: 'audio', fnNames: ['abort', 'pause']},
    {filter: 'subtitle', fnNames: ['abort', 'pause']},
    {filter: 'main', fnNames: ['abort', 'pause']}
  ];

  this.runTest(master, expectedDelegates);
});

QUnit.test('exclusions that remove all groups abort/pause all loaders', function(assert) {
  const master = `
    #EXTM3U
    #EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.5",AUDIO="foo",SUBTITLES="foo"
    media.m3u8'
    #EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400d,mp4a.40.2"
    media1.m3u8
  `;

  const expectedDelegates = [
    {filter: 'audio', fnNames: ['abort', 'pause']},
    {filter: 'subtitle', fnNames: ['abort', 'pause']},
    {filter: 'main', fnNames: ['abort', 'pause']}
  ];

  this.runTest(master, expectedDelegates);
});

QUnit.test('exclusions that add all groups abort/pause all loaders', function(assert) {
  const master = `
    #EXTM3U
    #EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.5"
    media.m3u8'
    #EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400d,mp4a.40.2",AUDIO="foo",SUBTITLES="foo"
    media1.m3u8
  `;

  const expectedDelegates = [
    {filter: 'audio', fnNames: ['abort', 'pause']},
    {filter: 'subtitle', fnNames: ['abort', 'pause']},
    {filter: 'main', fnNames: ['abort', 'pause']}
  ];

  this.runTest(master, expectedDelegates);
});

QUnit.module('MasterPlaylistController delegate loaders', {
  beforeEach(assert) {
    sharedHooks.beforeEach.call(this, assert);

    this.mpc = this.masterPlaylistController;
    this.calls = {};
    this.expected = {};

    Object.keys(this.mpc.mediaTypes_).forEach((type) => {
      const key = `${type.toLowerCase()}Playlist`;

      this.calls[`${key}Abort`] = 0;
      this.calls[`${key}Pause`] = 0;
      this.expected[`${key}Abort`] = 0;
      this.expected[`${key}Pause`] = 0;

      this.mpc.mediaTypes_[type].activePlaylistLoader = {
        abort: () => this.calls[`${key}Abort`]++,
        pause: () => this.calls[`${key}Pause`]++
      };
    });

    [
      'audioSegmentLoader',
      'subtitleSegmentLoader',
      'mainSegmentLoader',
      'masterPlaylistLoader'
    ].forEach((key) => {
      this.calls[`${key}Abort`] = 0;
      this.calls[`${key}Pause`] = 0;
      this.expected[`${key}Abort`] = 0;
      this.expected[`${key}Pause`] = 0;
      this.mpc[`${key}_`].abort = () => this.calls[`${key}Abort`]++;
      this.mpc[`${key}_`].pause = () => this.calls[`${key}Pause`]++;
    });
  },
  afterEach(assert) {
    sharedHooks.afterEach.call(this, assert);
  }
});

QUnit.test('filter all works', function(assert) {
  this.mpc.delegateLoaders_('all', ['abort', 'pause']);

  Object.keys(this.expected).forEach((key) => {
    this.expected[key] = 1;
  });

  assert.deepEqual(this.calls, this.expected, 'calls as expected');
});

QUnit.test('filter main works', function(assert) {
  this.mpc.delegateLoaders_('main', ['abort', 'pause']);

  Object.keys(this.expected).forEach((key) => {
    if ((/^(master|main)/).test(key)) {
      this.expected[key] = 1;
    }
  });

  assert.deepEqual(this.calls, this.expected, 'calls as expected');
});

QUnit.test('filter audio works', function(assert) {
  this.mpc.delegateLoaders_('audio', ['abort', 'pause']);

  Object.keys(this.expected).forEach((key) => {
    if ((/^audio/).test(key)) {
      this.expected[key] = 1;
    }
  });

  assert.deepEqual(this.calls, this.expected, 'calls as expected');
});

QUnit.test('filter subtitle works', function(assert) {
  this.mpc.delegateLoaders_('subtitle', ['abort', 'pause']);

  Object.keys(this.expected).forEach((key) => {
    if ((/^(subtitle|closed-captions)/).test(key)) {
      this.expected[key] = 1;
    }
  });

  assert.deepEqual(this.calls, this.expected, 'calls as expected');
});

QUnit.module('MasterPlaylistController experimentalBufferBasedABR', {
  beforeEach(assert) {
    this.playerOptions = {
      html5: {
        vhs: {
          experimentalBufferBasedABR: true
        }
      }
    };
    sharedHooks.beforeEach.call(this, assert);
    this.mpc = this.masterPlaylistController;

  },
  afterEach(assert) {
    sharedHooks.afterEach.call(this, assert);
  }
});

QUnit.test('Determines if playlist should change on bandwidthupdate/progress from segment loader', function(assert) {
  let calls = 0;

  this.masterPlaylistController.selectPlaylist = () => {
    calls++;
    return this.masterPlaylistController.masterPlaylistLoader_.master.playlists[0];
  };
  this.masterPlaylistController.mediaSource.trigger('sourceopen');

  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  // progress for a segment download
  this.masterPlaylistController.mainSegmentLoader_.trigger('progress');
  assert.strictEqual(calls, 1, 'does not select after segment progress');

  // "downloaded" a segment
  this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
  assert.strictEqual(calls, 1, 'does not select after segment download');

  this.clock.tick(250);
  assert.strictEqual(calls, 2, 'selects after clock tick');
  this.clock.tick(1000);
  assert.strictEqual(calls, 6, 'selects after clock tick, 1000 is 4x250');

  // verify stats
  assert.equal(this.player.tech_.vhs.stats.bandwidth, 4194304, 'default bandwidth');
});

QUnit.module('MasterPlaylistController shouldSwitchToMedia', sharedHooks);

QUnit.test('true if a no current playlist', function(assert) {
  const mpc = this.masterPlaylistController;

  mpc.masterPlaylistLoader_.media = () => null;
  const nextPlaylist = {id: 'foo', endList: true};

  assert.ok(mpc.shouldSwitchToMedia_(nextPlaylist), 'should switch without currentPlaylist');
});

QUnit.test('true if current playlist is live', function(assert) {
  const mpc = this.masterPlaylistController;

  mpc.masterPlaylistLoader_.media = () => ({endList: false, id: 'bar'});
  const nextPlaylist = {id: 'foo', endList: true};

  assert.ok(mpc.shouldSwitchToMedia_(nextPlaylist), 'should switch with live currentPlaylist');
});

QUnit.test('true if duration < 30', function(assert) {
  const mpc = this.masterPlaylistController;
  const nextPlaylist = {id: 'foo', endList: true};

  mpc.duration = () => 20;
  mpc.masterPlaylistLoader_.media = () => ({endList: true, id: 'bar'});

  assert.ok(mpc.shouldSwitchToMedia_(nextPlaylist), 'should switch');
});

QUnit.test('true duration < 16 with experimentalBufferBasedABR', function(assert) {
  const mpc = this.masterPlaylistController;
  const nextPlaylist = {id: 'foo', endList: true};

  mpc.experimentalBufferBasedABR = true;

  mpc.duration = () => 15;
  mpc.masterPlaylistLoader_.media = () => ({endList: true, id: 'bar'});

  assert.ok(mpc.shouldSwitchToMedia_(nextPlaylist), 'should switch');
});

QUnit.test('true if bandwidth decreases', function(assert) {
  const mpc = this.masterPlaylistController;
  const nextPlaylist = {id: 'foo', endList: true, attributes: {BANDWIDTH: 1}};

  mpc.duration = () => 40;
  mpc.masterPlaylistLoader_.media = () => ({endList: true, id: 'bar', attributes: {BANDWIDTH: 2}});

  assert.ok(mpc.shouldSwitchToMedia_(nextPlaylist), 'should switch');
});

QUnit.test('true if bandwidth decreases, experimentalBufferBasedABR, and forwardBuffer < bufferHighWaterLine', function(assert) {
  const mpc = this.masterPlaylistController;
  const nextPlaylist = {id: 'foo', endList: true, attributes: {BANDWIDTH: 1}};

  // 0 forward buffer
  mpc.tech_.buffered = () => videojs.createTimeRange();
  mpc.tech_.currentTime = () => 0;
  mpc.experimentalBufferBasedABR = true;
  mpc.duration = () => 40;
  mpc.masterPlaylistLoader_.media = () => ({endList: true, id: 'bar', attributes: {BANDWIDTH: 2}});

  assert.ok(mpc.shouldSwitchToMedia_(nextPlaylist), 'should switch');
});

QUnit.test('true if forwardBuffer >= bufferLowWaterLine', function(assert) {
  const mpc = this.masterPlaylistController;
  const nextPlaylist = {id: 'foo', endList: true, attributes: {BANDWIDTH: 2}};

  // zero forward buffer and zero buffer low water line
  mpc.tech_.buffered = () => videojs.createTimeRange();
  mpc.tech_.currentTime = () => 0;
  mpc.duration = () => 40;
  mpc.masterPlaylistLoader_.media = () => ({endList: true, id: 'bar', attributes: {BANDWIDTH: 2}});

  assert.ok(mpc.shouldSwitchToMedia_(nextPlaylist), 'should switch');
});

QUnit.test('true if forwardBuffer >= bufferLowWaterLine, experimentalBufferBasedABR, and bandwidth increase', function(assert) {
  const mpc = this.masterPlaylistController;
  const nextPlaylist = {id: 'foo', endList: true, attributes: {BANDWIDTH: 3}};

  // zero forward buffer and zero buffer low water line
  mpc.tech_.buffered = () => videojs.createTimeRange();
  mpc.tech_.currentTime = () => 0;
  mpc.experimentalBufferBasedABR = true;
  mpc.duration = () => 40;
  mpc.masterPlaylistLoader_.media = () => ({endList: true, id: 'bar', attributes: {BANDWIDTH: 2}});

  assert.ok(mpc.shouldSwitchToMedia_(nextPlaylist), 'should switch');
});

QUnit.test('false if nextPlaylist bandwidth lower, experimentalBufferBasedABR, and forwardBuffer > bufferHighWaterLine', function(assert) {
  const mpc = this.masterPlaylistController;
  const nextPlaylist = {id: 'foo', endList: true, attributes: {BANDWIDTH: 1}};

  // 31s forwardBuffer
  mpc.tech_.buffered = () => videojs.createTimeRange(0, 31);
  mpc.tech_.currentTime = () => 0;
  mpc.experimentalBufferBasedABR = true;
  mpc.duration = () => 40;
  mpc.masterPlaylistLoader_.media = () => ({endList: true, id: 'bar', attributes: {BANDWIDTH: 2}});

  assert.notOk(mpc.shouldSwitchToMedia_(nextPlaylist), 'should not switch');
});

QUnit.test('false if nextPlaylist bandwidth same, experimentalBufferBasedABR, and forwardBuffer >= bufferLowWaterLine', function(assert) {
  const mpc = this.masterPlaylistController;
  const nextPlaylist = {id: 'foo', endList: true, attributes: {BANDWIDTH: 2}};

  // 31s forwardBuffer
  mpc.tech_.buffered = () => videojs.createTimeRange();
  mpc.tech_.currentTime = () => 0;
  mpc.experimentalBufferBasedABR = true;
  mpc.duration = () => 40;
  mpc.masterPlaylistLoader_.media = () => ({endList: true, id: 'bar', attributes: {BANDWIDTH: 2}});

  assert.notOk(mpc.shouldSwitchToMedia_(nextPlaylist), 'should not switch');
});

QUnit.test('false if nextPlaylist is currentPlaylist', function(assert) {
  const mpc = this.masterPlaylistController;
  const nextPlaylist = {id: 'foo', endList: true};

  mpc.masterPlaylistLoader_.media = () => nextPlaylist;

  assert.notOk(mpc.shouldSwitchToMedia_(nextPlaylist), 'should not switch');
});

QUnit.test('false without nextPlaylist', function(assert) {
  const mpc = this.masterPlaylistController;

  mpc.masterPlaylistLoader_.media = () => ({endList: true, id: 'bar'});

  assert.notOk(mpc.shouldSwitchToMedia_(null), 'should not switch');

  assert.equal(this.env.log.warn.callCount, 1, 'logged a warning');

  this.env.log.warn.callCount = 0;
});
