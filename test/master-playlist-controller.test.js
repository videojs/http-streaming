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
  setupMediaSource
} from './test-helpers.js';
import manifests from './test-manifests.js';
import {
  MasterPlaylistController,
  DEFAULT_AUDIO_CODEC,
  DEFAULT_VIDEO_CODEC
} from '../src/master-playlist-controller';
/* eslint-disable no-unused-vars */
// we need this so that it can register hls with videojs
import { Hls } from '../src/videojs-http-streaming';
/* eslint-enable no-unused-vars */
import Playlist from '../src/playlist';
import Config from '../src/config';
import PlaylistLoader from '../src/playlist-loader';
import DashPlaylistLoader from '../src/dash-playlist-loader';
import {
  muxed as muxedSegment,
  audio as audioSegment,
  video as videoSegment,
  mp4VideoInit as mp4VideoInitSegment,
  mp4Video as mp4VideoSegment,
  mp4AudioInit as mp4AudioInitSegment,
  mp4Audio as mp4AudioSegment
} from './test-segments';

QUnit.module('MasterPlaylistController', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.clock = this.env.clock;
    this.requests = this.env.requests;
    this.mse = useFakeMediaSource();

    // force the HLS tech to run
    this.origSupportsNativeHls = videojs.Hls.supportsNativeHls;
    videojs.Hls.supportsNativeHls = false;
    this.oldBrowser = videojs.browser;
    videojs.browser = videojs.mergeOptions({}, videojs.browser);
    this.player = createPlayer();
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

    this.masterPlaylistController = this.player.tech_.hls.masterPlaylistController_;

    // Make segment metadata noop since most test segments dont have real data
    this.masterPlaylistController.mainSegmentLoader_.addSegmentMetadataCue_ = () => {};
  },
  afterEach() {
    this.env.restore();
    this.mse.restore();
    videojs.Hls.supportsNativeHls = this.origSupportsNativeHls;
    window.localStorage.clear();
    videojs.browser = this.oldBrowser;
    this.player.dispose();
  }
});

QUnit.test('throws error when given an empty URL', function(assert) {
  let options = {
    url: 'test',
    tech: this.player.tech_
  };

  assert.ok(new MasterPlaylistController(options), 'can create with options');

  options.url = '';
  assert.throws(() => {
    new MasterPlaylistController(options); // eslint-disable-line no-new
  }, /A non-empty playlist URL is required/, 'requires a non empty url');
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
  assert.equal(this.player.tech_.hls.stats.bandwidth, 4194304, 'default bandwidth');
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
  assert.equal(this.player.tech_.hls.stats.bandwidth, 4194304, 'default bandwidth');
});

QUnit.test('passes options to PlaylistLoader', function(assert) {
  const options = {
    url: 'test',
    tech: this.player.tech_
  };

  let controller = new MasterPlaylistController(options);

  assert.notOk(controller.masterPlaylistLoader_.withCredentials, 'credentials wont be sent by default');
  assert.notOk(controller.masterPlaylistLoader_.handleManifestRedirects, 'redirects are ignored by default');

  controller = new MasterPlaylistController(Object.assign({
    withCredentials: true,
    handleManifestRedirects: true
  }, options));

  assert.ok(controller.masterPlaylistLoader_.withCredentials, 'withCredentials enabled');
  assert.ok(controller.masterPlaylistLoader_.handleManifestRedirects, 'handleManifestRedirects enabled');
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
  assert.equal(this.player.tech_.hls.stats.bandwidth, 4194304, 'default bandwidth');
});

QUnit.test('creates appropriate PlaylistLoader for sourceType', function(assert) {
  let options = {
    url: 'test',
    tech: this.player.tech_,
    sourceType: 'hls'
  };

  let mpc = new MasterPlaylistController(options);

  assert.ok(mpc.masterPlaylistLoader_ instanceof PlaylistLoader,
            'created a standard playlist loader');

  options.sourceType = 'dash';
  mpc = new MasterPlaylistController(options);

  assert.ok(mpc.masterPlaylistLoader_ instanceof DashPlaylistLoader,
            'created a dash playlist loader');
});

QUnit.test('passes options to SegmentLoader', function(assert) {
  const options = {
    url: 'test',
    tech: this.player.tech_
  };

  let controller = new MasterPlaylistController(options);

  assert.notOk(controller.mainSegmentLoader_.bandwidth, "bandwidth won't be set by default");
  assert.notOk(controller.mainSegmentLoader_.sourceType_, "sourceType won't be set by default");
  assert.notOk(controller.mainSegmentLoader_.cacheEncryptionKeys_, "cacheEncryptionKeys won't be set by default");

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
});

QUnit.test('resets SegmentLoader when seeking out of buffer',
  function(assert) {
    let resets = 0;

    // master
    this.standardXHRResponse(this.requests.shift());
    // media
    this.standardXHRResponse(this.requests.shift());
    this.masterPlaylistController.mediaSource.trigger('sourceopen');

    let mpc = this.masterPlaylistController;
    let segmentLoader = mpc.mainSegmentLoader_;

    segmentLoader.resetEverything = function() {
      resets++;
    };

    let buffered;

    mpc.tech_.buffered = function() {
      return buffered;
    };

    buffered = videojs.createTimeRanges([[0, 20]]);

    mpc.setCurrentTime(10);
    assert.equal(resets, 0,
      'does not reset loader when seeking into a buffered region');

    mpc.setCurrentTime(21);
    assert.equal(resets, 1,
      'does reset loader when seeking outside of the buffered region');
  });

QUnit.test('selects lowest bitrate rendition when enableLowInitialPlaylist is set',
  function(assert) {
    // Set requests.length to 0, otherwise it will use the requests generated in the
    // beforeEach function
    this.requests.length = 0;
    this.player = createPlayer({ html5: { hls: { enableLowInitialPlaylist: true } } });

    this.player.src({
      src: 'manifest/master.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    this.clock.tick(1);

    this.masterPlaylistController = this.player.tech_.hls.masterPlaylistController_;

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
  });

QUnit.test('resyncs SegmentLoader for a smooth quality change', function(assert) {
  let resyncs = 0;

  this.masterPlaylistController.mediaSource.trigger('sourceopen');
  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  let segmentLoader = this.masterPlaylistController.mainSegmentLoader_;

  segmentLoader.resyncLoader = function() {
    resyncs++;
  };

  this.masterPlaylistController.selectPlaylist = () => {
    return this.masterPlaylistController.master().playlists[0];
  };

  this.masterPlaylistController.smoothQualityChange_();

  assert.equal(resyncs, 1, 'resynced the segmentLoader');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 4194304, 'default bandwidth');
});

QUnit.test('does not resync the segmentLoader when no smooth quality change occurs',
  function(assert) {
    let resyncs = 0;

    // master
    this.standardXHRResponse(this.requests.shift());
    // media
    this.standardXHRResponse(this.requests.shift());
    this.masterPlaylistController.mediaSource.trigger('sourceopen');

    let segmentLoader = this.masterPlaylistController.mainSegmentLoader_;

    segmentLoader.resyncLoader = function() {
      resyncs++;
    };

    this.masterPlaylistController.smoothQualityChange_();

    assert.equal(resyncs, 0, 'did not resync the segmentLoader');
    // verify stats
    assert.equal(this.player.tech_.hls.stats.bandwidth, 4194304, 'default bandwidth');
  });

QUnit.test('smooth quality change resyncs audio segment loader', function(assert) {
  this.requests.length = 0;
  this.player = createPlayer();
  this.player.src({
    src: 'alternate-audio-multiple-groups.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  const masterPlaylistController = this.player.tech_.hls.masterPlaylistController_;

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
  let realReset = masterPlaylistController.audioSegmentLoader_.resetLoader;

  masterPlaylistController.audioSegmentLoader_.resetLoader = function() {
    resets++;
    realReset.call(this);
  };

  masterPlaylistController.audioSegmentLoader_.resyncLoader = () => resyncs++;
  masterPlaylistController.smoothQualityChange_();
  assert.equal(resyncs, 0, 'does not resync the audio segment loader when media same');

  // force different media
  masterPlaylistController.selectPlaylist = () => {
    return masterPlaylistController.master().playlists[1];
  };

  assert.equal(this.requests.length, 3, 'three requests');
  assert.ok(this.requests[0].url.endsWith('eng/prog_index.m3u8'),
            'requests eng playlist');
  assert.ok(this.requests[1].url.endsWith('lo/main.mp4'), 'correct segment url');
  assert.equal(this.requests[1].requestHeaders.Range,
               'bytes=0-603',
               'requests init segment byte range');
  assert.ok(this.requests[2].url.endsWith('lo/main.mp4'), 'correct segment url');
  assert.equal(this.requests[2].requestHeaders.Range,
               'bytes=604-118754',
               'requests segment byte range');
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

  let segmentLoader = this.masterPlaylistController.mainSegmentLoader_;

  segmentLoader.resyncLoader = () => resyncs++;

  const origResetEverything = segmentLoader.resetEverything.bind(segmentLoader);

  segmentLoader.resetEverything = () => {
    resets++;
    origResetEverything();
  };

  segmentLoader.remove = function(start, end) {
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

QUnit.test('seeks in place for fast quality switch on non-IE/Edge browsers',
async function(assert) {
  let seeks = 0;

  this.masterPlaylistController.mediaSource.trigger('sourceopen');
  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  const segmentLoader = this.masterPlaylistController.mainSegmentLoader_;

  await requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader,
    clock: this.clock
  });

  // media is changed
  this.masterPlaylistController.selectPlaylist = () => {
    return this.masterPlaylistController.master().playlists[0];
  };

  this.player.tech_.on('seeking', function() {
    seeks++;
  });

  const timeBeforeSwitch = this.player.currentTime();

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
    timeBeforeSwitch,
    'current time remains the same on fast quality switch');
  assert.equal(seeks, 1, 'seek event occurs on fast quality switch');
});

QUnit.test('seeks forward 0.04 sec for fast quality switch on Edge',
async function(assert) {
  let oldIEVersion = videojs.browser.IE_VERSION;
  let oldIsEdge = videojs.browser.IS_EDGE;
  let seeks = 0;

  this.masterPlaylistController.mediaSource.trigger('sourceopen');
  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  const segmentLoader = this.masterPlaylistController.mainSegmentLoader_;

  await requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader,
    clock: this.clock
  });

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
    'seeks forward on fast quality switch');
  assert.equal(seeks, 1, 'seek event occurs on fast quality switch');

  videojs.browser.IE_VERSION = oldIEVersion;
  videojs.browser.IS_EDGE = oldIsEdge;
});

QUnit.test('seeks forward 0.04 sec for fast quality switch on IE',
async function(assert) {
  let oldIEVersion = videojs.browser.IE_VERSION;
  let oldIsEdge = videojs.browser.IS_EDGE;
  let seeks = 0;

  this.masterPlaylistController.mediaSource.trigger('sourceopen');
  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  const segmentLoader = this.masterPlaylistController.mainSegmentLoader_;

  await requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader,
    clock: this.clock
  });

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
    'seeks forward on fast quality switch');
  assert.equal(seeks, 1, 'seek event occurs on fast quality switch');

  videojs.browser.IE_VERSION = oldIEVersion;
  videojs.browser.IS_EDGE = oldIsEdge;
});

QUnit.test('audio segment loader is reset on audio track change', function(assert) {
  this.requests.length = 0;
  this.player = createPlayer();
  this.player.src({
    src: 'alternate-audio-multiple-groups.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  const masterPlaylistController = this.player.tech_.hls.masterPlaylistController_;

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
  let realReset = masterPlaylistController.audioSegmentLoader_.resetLoader;

  masterPlaylistController.audioSegmentLoader_.resetLoader = function() {
    resets++;
    realReset.call(this);
  };
  masterPlaylistController.audioSegmentLoader_.resyncLoader = () => resyncs++;

  assert.equal(this.requests.length, 3, 'three requests');
  assert.ok(this.requests[0].url.endsWith('eng/prog_index.m3u8'),
            'requests eng playlist');
  assert.ok(this.requests[1].url.endsWith('lo/main.mp4'), 'correct segment url');
  assert.equal(this.requests[1].requestHeaders.Range,
               'bytes=0-603',
               'requests init segment byte range');
  assert.ok(this.requests[2].url.endsWith('lo/main.mp4'), 'correct segment url');
  assert.equal(this.requests[2].requestHeaders.Range,
               'bytes=604-118754',
               'requests segment byte range');
  assert.notOk(this.requests[0].aborted, 'did not abort alt audio playlist request');
  assert.notOk(this.requests[1].aborted, 'did not abort init request');
  assert.notOk(this.requests[2].aborted, 'did not abort segment request');
  assert.equal(resyncs, 0, 'does not resync the audio segment loader yet');

  this.player.audioTracks()[1].enabled = true;

  assert.equal(this.requests.length, 4, 'added a request for new media');
  assert.ok(this.requests[0].aborted, 'aborted old alt audio playlist request');
  assert.notOk(this.requests[1].aborted, 'did not abort init request');
  assert.notOk(this.requests[2].aborted, 'did not abort segment request');
  assert.ok(this.requests[3].url.endsWith('esp/prog_index.m3u8'),
            'requests esp playlist');
  assert.equal(resyncs, 1, 'resyncs the audio segment loader when audio track changes');
  assert.equal(resets, 1, 'resets the audio segment loader when audio track changes');
});

QUnit.test('if buffered, will request second segment byte range', async function(assert) {
  this.requests.length = 0;
  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.masterPlaylistController = this.player.tech_.hls.masterPlaylistController_;
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
  await new Promise((accept, reject) => {
    this.masterPlaylistController.mainSegmentLoader_.on('appending', accept);
  });
  this.masterPlaylistController.mainSegmentLoader_.fetchAtBuffer_ = true;
  // source buffers are mocked, so must manually trigger update ends on audio and video
  // buffers
  this.masterPlaylistController.mediaSource.sourceBuffers[0].trigger('updateend');
  this.masterPlaylistController.mediaSource.sourceBuffers[1].trigger('updateend');
  this.clock.tick(10 * 1000);
  this.clock.tick(1);
  assert.equal(this.requests[2].headers.Range, 'bytes=522828-1110327');
});

QUnit.test('re-initializes the combined playlist loader when switching sources',
function(assert) {
  openMediaSource(this.player, this.clock);
  // master
  this.standardXHRResponse(this.requests.shift());
  // playlist
  this.standardXHRResponse(this.requests.shift());
  // segment
  this.standardXHRResponse(this.requests.shift());
  // change the source
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.masterPlaylistController = this.player.tech_.hls.masterPlaylistController_;
  // Make segment metadata noop since most test segments dont have real data
  this.masterPlaylistController.mainSegmentLoader_.addSegmentMetadataCue_ = () => {};

  // maybe not needed if https://github.com/videojs/video.js/issues/2326 gets fixed
  this.clock.tick(1);
  assert.ok(!this.masterPlaylistController.masterPlaylistLoader_.media(),
           'no media playlist');
  assert.equal(this.masterPlaylistController.masterPlaylistLoader_.state,
              'HAVE_NOTHING',
              'reset the playlist loader state');
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
});

QUnit.test('updates the combined segment loader on live playlist refreshes',
function(assert) {
  let updates = [];

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
  assert.equal(this.player.tech_.hls.stats.bandwidth, 4194304, 'default bandwidth');
});

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
  assert.equal(progressCount, 1, 'fired a progress event');
});

QUnit.test('updates the active loader when switching from unmuxed to muxed audio group',
function(assert) {
  openMediaSource(this.player, this.clock);
  // master
  this.requests.shift().respond(200, null,
                                manifests.multipleAudioGroupsCombinedMain);
  // media
  this.standardXHRResponse(this.requests.shift());
  // init segment
  this.standardXHRResponse(this.requests.shift());
  // video segment
  this.standardXHRResponse(this.requests.shift());
  // audio media
  this.standardXHRResponse(this.requests.shift());
  // ignore audio segment requests
  this.requests.length = 0;

  let mpc = this.masterPlaylistController;
  let combinedPlaylist = mpc.master().playlists[0];

  assert.ok(mpc.mediaTypes_.AUDIO.activePlaylistLoader,
    'starts with an active playlist loader');

  mpc.masterPlaylistLoader_.media(combinedPlaylist);
  // updated media
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXTINF:5.0\n' +
                                '0.ts\n' +
                                '#EXT-X-ENDLIST\n');

  assert.notOk(mpc.mediaTypes_.AUDIO.activePlaylistLoader,
    'enabled a track in the new audio group');
});

QUnit.test('waits for both main and audio loaders to finish before calling endOfStream',
async function(assert) {
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

  MPC.mainSegmentLoader_.startingMedia_ = { hasVideo: true };
  MPC.audioSegmentLoader_.startingMedia_ = { hasAudio: true };

  // master
  this.standardXHRResponse(this.requests.shift(), manifests.demuxed);

  // video media
  this.standardXHRResponse(this.requests.shift(), videoMedia);

  // audio media
  this.standardXHRResponse(this.requests.shift(), audioMedia);

  await requestAndAppendSegment({
    request: this.requests.shift(),
    segment: videoSegment(),
    isOnlyVideo: true,
    segmentLoader: MPC.mainSegmentLoader_,
    clock: this.clock
  });

  assert.equal(videoEnded, 1, 'main segment loader triggered ended');
  assert.equal(audioEnded, 0, 'audio segment loader did not trigger ended');
  assert.equal(MPC.mediaSource.readyState, 'open', 'Media Source not yet ended');

  await requestAndAppendSegment({
    request: this.requests.shift(),
    segment: audioSegment(),
    isOnlyAudio: true,
    segmentLoader: MPC.audioSegmentLoader_,
    clock: this.clock
  });

  assert.equal(videoEnded, 1, 'main segment loader did not trigger ended again');
  assert.equal(audioEnded, 1, 'audio segment loader triggered ended');
  assert.equal(MPC.mediaSource.readyState, 'ended', 'Media Source ended');
});

// TODO once we have support for audio only with alternate audio, we should have a test
// for: "does not wait for main loader to finish before calling endOfStream with audio
// only stream and alternate audio active." This will require changes in segment loader to
// handle disabled audio on the main stream, as well as potential media group changes and
// master playlist controller changes to use measurements from the audio segment loader as
// the primary source when main is disabled.

QUnit.test('Segment loaders are unpaused when seeking after player has ended',
async function(assert) {
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

  await new Promise((accept, reject) => {
    this.masterPlaylistController.mainSegmentLoader_.on('appending', accept);
  });

  assert.notOk(this.masterPlaylistController.mainSegmentLoader_.paused(),
    'segment loader not yet paused');

  // source buffers are mocked, so must manually trigger update ends on audio and video
  // buffers
  this.masterPlaylistController.mediaSource.sourceBuffers[0].trigger('updateend');
  this.masterPlaylistController.mediaSource.sourceBuffers[1].trigger('updateend');

  assert.ok(this.masterPlaylistController.mainSegmentLoader_.paused(),
    'segment loader is paused after ending');
  assert.equal(ended, 1, 'segment loader triggered ended event');

  this.player.currentTime(5);

  this.clock.tick(1);

  assert.notOk(this.masterPlaylistController.mainSegmentLoader_.paused(),
    'segment loader unpaused after a seek');
  assert.equal(ended, 1, 'segment loader did not trigger ended event again yet');
});

QUnit.test('detects if the player is stuck at the playlist end', function(assert) {
  let playlistCopy = Hls.Playlist.playlistEnd;

  this.masterPlaylistController.mediaSource.trigger('sourceopen');
  this.standardXHRResponse(this.requests.shift());
  let playlist = this.player.tech_.hls.selectPlaylist();

  // not stuck at playlist end when no seekable, even if empty buffer
  // and positive currentTime
  this.masterPlaylistController.seekable = () => videojs.createTimeRange();
  this.player.tech_.buffered = () => videojs.createTimeRange();
  this.player.tech_.setCurrentTime(170);
  assert.ok(!this.masterPlaylistController.stuckAtPlaylistEnd_(playlist),
            'not stuck at playlist end');

  // not stuck at playlist end when no seekable, even if empty buffer
  // and currentTime 0
  this.player.tech_.setCurrentTime(0);
  assert.ok(!this.masterPlaylistController.stuckAtPlaylistEnd_(playlist),
            'not stuck at playlist end');

  // not stuck at playlist end when no seekable but current time is at
  // the end of the buffered range
  this.player.tech_.buffered = () => videojs.createTimeRange(0, 170);
  assert.ok(!this.masterPlaylistController.stuckAtPlaylistEnd_(playlist),
            'not stuck at playlist end');

  // not stuck at playlist end when currentTime not at seekable end
  // even if the buffer is empty
  this.masterPlaylistController.seekable = () => videojs.createTimeRange(0, 130);
  this.masterPlaylistController.syncController_.getExpiredTime = () => 0;
  this.player.tech_.setCurrentTime(50);
  this.player.tech_.buffered = () => videojs.createTimeRange();
  Hls.Playlist.playlistEnd = () => 130;
  assert.ok(!this.masterPlaylistController.stuckAtPlaylistEnd_(playlist),
            'not stuck at playlist end');

  // not stuck at playlist end when buffer reached the absolute end of the playlist
  // and current time is in the buffered range
  this.player.tech_.setCurrentTime(159);
  this.player.tech_.buffered = () => videojs.createTimeRange(0, 160);
  Hls.Playlist.playlistEnd = () => 160;
  assert.ok(!this.masterPlaylistController.stuckAtPlaylistEnd_(playlist),
            'not stuck at playlist end');

  // stuck at playlist end when there is no buffer and playhead
  // reached absolute end of playlist
  this.player.tech_.setCurrentTime(160);
  assert.ok(this.masterPlaylistController.stuckAtPlaylistEnd_(playlist),
            'stuck at playlist end');

  // stuck at playlist end when current time reached the buffer end
  // and buffer has reached absolute end of playlist
  this.masterPlaylistController.seekable = () => videojs.createTimeRange(90, 130);
  this.player.tech_.buffered = () => videojs.createTimeRange(0, 170);
  this.player.tech_.setCurrentTime(170);
  Hls.Playlist.playlistEnd = () => 170;
  assert.ok(this.masterPlaylistController.stuckAtPlaylistEnd_(playlist),
            'stuck at playlist end');

  Hls.Playlist.playlistEnd = playlistCopy;
});

QUnit.test('blacklists switching from video+audio playlists to audio only',
async function(assert) {
  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 1e10;

  // master
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="mp4a.40.2"\n' +
                                'media.m3u8\n' +
                                '#EXT-X-STREAM-INF:BANDWIDTH=10,RESOLUTION=1x1\n' +
                                'media1.m3u8\n');
  // media1
  this.standardXHRResponse(this.requests.shift());

  const mpc = this.masterPlaylistController;

  // segment must be appended before the blacklist logic runs
  await requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock
  });

  assert.equal(mpc.masterPlaylistLoader_.media(),
               mpc.masterPlaylistLoader_.master.playlists[1],
               'selected video+audio');

  const audioPlaylist = mpc.masterPlaylistLoader_.master.playlists[0];

  assert.equal(audioPlaylist.excludeUntil, Infinity, 'excluded incompatible playlist');
});

QUnit.test('blacklists switching from audio-only playlists to video+audio',
async function(assert) {
  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 1;

  // master
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="mp4a.40.2"\n' +
                                'media.m3u8\n' +
                                '#EXT-X-STREAM-INF:BANDWIDTH=10,RESOLUTION=1x1\n' +
                                'media1.m3u8\n');

  // media1
  this.standardXHRResponse(this.requests.shift());

  const mpc = this.masterPlaylistController;

  // segment must be appended before the blacklist logic runs
  await requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: mpc.mainSegmentLoader_,
    segment: audioSegment(),
    isOnlyAudio: true,
    clock: this.clock
  });

  assert.equal(mpc.masterPlaylistLoader_.media(),
               mpc.masterPlaylistLoader_.master.playlists[0],
               'selected audio only');

  const videoAudioPlaylist = mpc.masterPlaylistLoader_.master.playlists[1];

  assert.equal(videoAudioPlaylist.excludeUntil,
              Infinity,
              'excluded incompatible playlist');
});

QUnit.test('blacklists switching from video-only playlists to video+audio',
async function(assert) {
  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 1;

  // master
  this.requests.shift()
    .respond(200, null,
             '#EXTM3U\n' +
             '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d"\n' +
             'media.m3u8\n' +
             '#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400d,mp4a.40.2"\n' +
             'media1.m3u8\n');

  // media
  this.standardXHRResponse(this.requests.shift());

  const mpc = this.masterPlaylistController;

  // segment must be appended before the blacklist logic runs
  await requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: mpc.mainSegmentLoader_,
    segment: videoSegment(),
    isOnlyVideo: true,
    clock: this.clock
  });

  assert.equal(mpc.masterPlaylistLoader_.media(),
               mpc.masterPlaylistLoader_.master.playlists[0],
               'selected video only');

  const videoAudioPlaylist = mpc.masterPlaylistLoader_.master.playlists[1];

  assert.equal(videoAudioPlaylist.excludeUntil,
              Infinity,
              'excluded incompatible playlist');
});

QUnit.test('does not blacklist switching between playlists with different audio profiles',
async function(assert) {
  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 1;

  // master
  this.requests.shift()
    .respond(200, null,
             '#EXTM3U\n' +
             '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.5"\n' +
             'media.m3u8\n' +
             '#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400d,mp4a.40.2"\n' +
             'media1.m3u8\n');

  // media
  this.standardXHRResponse(this.requests.shift());
  assert.equal(this.masterPlaylistController.masterPlaylistLoader_.media(),
              this.masterPlaylistController.masterPlaylistLoader_.master.playlists[0],
              'selected HE-AAC stream');

  const mpc = this.masterPlaylistController;

  // segment must be appended before the blacklist logic runs
  await requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock
  });

  const alternatePlaylist = mpc.masterPlaylistLoader_.master.playlists[1];

  assert.equal(alternatePlaylist.excludeUntil, undefined, 'did not exclude playlist');
});

QUnit.test('blacklists playlists with unsupported codecs before initial selection',
function(assert) {
  this.masterPlaylistController.selectPlaylist = () => {
    assert.equal(
      this.masterPlaylistController.master().playlists[0].excludeUntil,
      Infinity,
      'Blacklists unsupported playlist before initial selection');
  };

  openMediaSource(this.player, this.clock);

  // master
  this.requests.shift().respond(200, null,
    '#EXTM3U\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="unsupporte.dc0dec,mp4a.40.5"\n' +
    'media.m3u8\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=10000,CODECS="avc1.4d400d,mp4a.40.2"\n' +
    'media1.m3u8\n');

  // media
  this.standardXHRResponse(this.requests.shift());
});

QUnit.test('updates the combined segment loader on media changes',
async function(assert) {
  let updates = [];

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

  await new Promise((accept, reject) => {
    this.masterPlaylistController.mainSegmentLoader_.on('appending', accept);
  });

  // source buffers are mocked, so must manually trigger update ends on audio and video
  // buffers
  this.masterPlaylistController.mediaSource.sourceBuffers[0].trigger('updateend');
  this.masterPlaylistController.mediaSource.sourceBuffers[1].trigger('updateend');
  // media
  this.standardXHRResponse(this.requests.shift());
  assert.ok(updates.length > 0, 'updated the segment list');

  // verify stats
  // request duration was 1ms, giving a bandwidth of bytes / 1 * 8 * 1000
  assert.equal(this.player.tech_.hls.stats.bandwidth,
               segmentByteLength / 1 * 8 * 1000,
               'stats has the right bandwidth');
  assert.equal(this.player.tech_.hls.stats.mediaRequests, 1, '1 segment request');
  assert.equal(this.player.tech_.hls.stats.mediaBytesTransferred,
               segmentByteLength,
               'stats has the right number of bytes transferred');
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
  assert.equal(this.player.tech_.hls.stats.bandwidth, 4194304, 'default bandwidth');
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

QUnit.test('switches to lower renditions immediately, higher dependent on buffer',
function(assert) {
  this.masterPlaylistController.mediaSource.trigger('sourceopen');
  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  let buffered = [];
  let currentPlaylistBandwidth = 0;
  let nextPlaylistBandwidth = 0;
  let mediaChanges = [];
  let currentTime = 0;
  let endList = true;
  let duration = 100;

  this.masterPlaylistController.tech_.currentTime = () => currentTime;
  this.masterPlaylistController.tech_.buffered = () => videojs.createTimeRanges(buffered);
  this.masterPlaylistController.duration = () => duration;
  this.masterPlaylistController.selectPlaylist = () => {
    return {
      attributes: {
        BANDWIDTH: nextPlaylistBandwidth
      },
      endList
    };
  };
  this.masterPlaylistController.masterPlaylistLoader_.media = (media) => {
    if (!media) {
      return {
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
  assert.equal(mediaChanges.length,
               1,
               'changes media when no buffer and equal bandwidth playlist');
  buffered = [[0, 9]];
  this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
  assert.equal(mediaChanges.length,
               2,
               'changes media when sufficient forward buffer and equal ' +
               'bandwidth playlist');
  buffered = [[0, 30]];
  this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
  assert.equal(mediaChanges.length,
               3,
               'changes media when sufficient forward buffer and equal ' +
               'bandwidth playlist');

  mediaChanges.length = 0;

  currentTime = 10;
  currentPlaylistBandwidth = 1000;
  nextPlaylistBandwidth = 1001;
  buffered = [];
  this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
  assert.equal(mediaChanges.length,
               0,
               'did not change media when no buffer and and higher bandwidth playlist');
  buffered = [[0, 19]];
  this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
  assert.equal(mediaChanges.length,
               0,
               'did not change media when insufficient forward buffer and higher ' +
               'bandwidth playlist');
  buffered = [[0, 20]];
  this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
  assert.equal(mediaChanges.length,
               1,
               'changes media when sufficient forward buffer and higher ' +
               'bandwidth playlist');
  buffered = [[0, 21]];
  this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
  assert.equal(mediaChanges.length,
               2,
               'changes media when sufficient forward buffer and higher ' +
               'bandwidth playlist');

  mediaChanges.length = 0;

  currentTime = 100;
  currentPlaylistBandwidth = 1000;
  nextPlaylistBandwidth = 1001;
  buffered = [];
  this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
  assert.equal(mediaChanges.length,
               0,
               'did not change media when no buffer and higher bandwidth playlist');
  buffered = [[0, 100], [100, 109]];
  this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
  assert.equal(mediaChanges.length,
               0,
               'did not change media when insufficient forward buffer and higher ' +
               'bandwidth playlist');
  buffered = [[0, 100], [100, 130]];
  this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
  assert.equal(mediaChanges.length,
               1,
               'changes media when sufficient forward buffer and higher ' +
               'bandwidth playlist');

  mediaChanges.length = 0;

  buffered = [];
  currentPlaylistBandwidth = 1000;
  nextPlaylistBandwidth = 999;
  this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
  assert.equal(mediaChanges.length,
               1,
               'changes media when no buffer but lower bandwidth playlist');
  buffered = [[100, 109]];
  this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
  assert.equal(mediaChanges.length,
               2,
               'changes media when insufficient forward buffer but lower ' +
               'bandwidth playlist');
  buffered = [[100, 110]];
  this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
  assert.equal(mediaChanges.length,
               3,
               'changes media when sufficient forward buffer and lower ' +
               'bandwidth playlist');

  mediaChanges.length = 0;

  endList = false;
  currentTime = 100;
  currentPlaylistBandwidth = 1000;
  nextPlaylistBandwidth = 1001;
  buffered = [];
  this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
  assert.equal(mediaChanges.length,
               1,
               'changes live media when no buffer and higher bandwidth playlist');
  buffered = [[0, 100], [100, 109]];
  this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
  assert.equal(mediaChanges.length,
               2,
               'changes live media when insufficient forward buffer and higher ' +
               'bandwidth playlist');
  buffered = [[0, 100], [100, 130]];
  this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
  assert.equal(mediaChanges.length,
               3,
               'changes live media when sufficient forward buffer and higher ' +
               'bandwidth playlist');

  mediaChanges.length = 0;

  endList = true;
  currentTime = 9;
  duration = 18;
  buffered = [];
  this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
  assert.equal(mediaChanges.length,
               1,
               'changes media when no buffer and duration less than low water line');
  buffered = [[0, 10]];
  this.masterPlaylistController.mainSegmentLoader_.trigger('bandwidthupdate');
  assert.equal(mediaChanges.length,
               2,
               'changes media when insufficient forward buffer and duration ' +
               'less than low water line');
});

QUnit.test('blacklists playlist on earlyabort', function(assert) {
  this.masterPlaylistController.mediaSource.trigger('sourceopen');
  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  let mediaChanges = [];
  const playlistLoader = this.masterPlaylistController.masterPlaylistLoader_;
  const currentMedia = playlistLoader.media();
  const origMedia = playlistLoader.media.bind(playlistLoader);
  const origWarn = videojs.log.warn;
  let warnings = [];

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
  assert.equal(warnings[0],
               'Problem encountered with the current playlist. ' +
                 'Aborted early because there isn\'t enough bandwidth to complete the ' +
                 'request without rebuffering. Switching to another playlist.',
               'warning message is correct');

  videojs.log.warn = origWarn;
});

QUnit.test('does not get stuck in a loop due to inconsistent network/caching',
async function(assert) {
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
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-STREAM-INF:BANDWIDTH=10\n' +
                                'media.m3u8\n' +
                                '#EXT-X-STREAM-INF:BANDWIDTH=100\n' +
                                'media1.m3u8\n');
  // media.m3u8
  this.requests.shift().respond(200, null, mediaContents);

  let playlistLoader = mpc.masterPlaylistLoader_;
  let origMedia = playlistLoader.media.bind(playlistLoader);
  let mediaChanges = [];

  mpc.masterPlaylistLoader_.media = (media) => {
    if (media) {
      mediaChanges.push(media);
    }
    return origMedia(media);
  };

  this.clock.tick(1);

  let segmentRequest = this.requests[0];

  assert.equal(segmentRequest.uri.substring(segmentRequest.uri.length - 4),
               '0.ts',
               'requested first segment');

  await requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock,
    bandwidth: 800
  });

  segmentRequest = this.requests[0];

  // should be walking forwards (need two segments before we can switch)
  assert.equal(segmentLoader.bandwidth, 800, 'bandwidth is correct');
  assert.equal(segmentRequest.uri.substring(segmentRequest.uri.length - 4),
               '1.ts',
               'requested second segment');
  assert.equal(mediaChanges.length, 0, 'no media changes');

  await requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock,
    bandwidth: 880
  });

  let mediaRequest = this.requests[0];

  // after two segments, bandwidth is high enough to switch up to media1.m3u8
  assert.equal(segmentLoader.bandwidth, 880, 'bandwidth is correct');
  assert.equal(mediaChanges.length, 1, 'changed media');
  assert.equal(mediaChanges[0].uri, 'media1.m3u8', 'changed to media1');
  assert.equal(mediaRequest.uri.substring(mediaRequest.uri.length - 'media1.m3u8'.length),
               'media1.m3u8',
               'requested media1');

  // media1.m3u8
  this.requests.shift().respond(200, null, mediaContents);
  this.clock.tick(1);
  segmentRequest = this.requests[0];

  assert.equal(segmentLoader.playlist_.uri,
               'media1.m3u8',
               'segment loader playlist is media1');

  const media1ResolvedPlaylist = segmentLoader.playlist_;

  assert.notOk(media1ResolvedPlaylist.excludeUntil, 'media1 not blacklisted');
  assert.equal(segmentRequest.uri.substring(segmentRequest.uri.length - 4),
               '0.ts',
               'requested first segment');

  // needs a timeout for early abort to occur (we skip the function otherwise, since no
  // timeout means we are on the last rendition)
  segmentLoader.xhrOptions_.timeout = 60000;
  // we need to wait 1 second from first byte receieved in order to consider aborting
  this.requests[0].downloadProgress({
    target: this.requests[0],
    total: 100,
    loaded: 1
  });
  this.clock.tick(1000);
  // should abort request early because we don't have enough bandwidth
  this.requests[0].downloadProgress({
    target: this.requests[0],
    total: 100,
    // 1 bit per second
    loaded: 2
  });
  this.clock.tick(1);

  // aborted request, so switched back to lowest rendition
  assert.equal(segmentLoader.bandwidth,
               10 * Config.BANDWIDTH_VARIANCE + 1,
               'bandwidth is correct for abort');
  assert.equal(mediaChanges.length, 2, 'changed media');
  assert.equal(mediaChanges[1].uri, 'media.m3u8', 'changed to media');
  assert.ok(media1ResolvedPlaylist.excludeUntil, 'blacklisted media1');
  assert.equal(segmentRequest.uri.substring(segmentRequest.uri.length - 4),
               '0.ts',
               'requested first segment');

  // remove aborted request
  this.requests.shift();
  // 1ms for the cached segment response
  this.clock.tick(1);

  await requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock,
    bandwidth: 80000
  });

  segmentRequest = this.requests[0];

  // walking forwards, still need two segments before trying to change rendition
  assert.bandwidthWithinTolerance(segmentLoader.bandwidth, 80000, 'bandwidth is correct');
  assert.equal(mediaChanges.length, 2, 'did not change media');
  assert.equal(segmentRequest.uri.substring(segmentRequest.uri.length - 4),
               '1.ts',
               'requested second segment');

  // 1ms for the cached segment response
  this.clock.tick(1);

  await requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock,
    bandwidth: 88000
  });

  // Media may be changed, but it should be changed to the same media. In the future, this
  // can safely not be changed.
  assert.bandwidthWithinTolerance(segmentLoader.bandwidth, 88000, 'bandwidth is correct');
  assert.equal(mediaChanges.length, 3, 'changed media');
  assert.equal(mediaChanges[2].uri, 'media.m3u8', 'media remains unchanged');

  segmentRequest = this.requests[0];
  assert.equal(segmentRequest.uri.substring(segmentRequest.uri.length - 4),
               '2.ts',
               'requested third segment');

  assert.equal(this.env.log.warn.callCount, 1, 'logged a warning');
  this.env.log.warn.callCount = 0;
});

QUnit.test('updates the duration after switching playlists', async function(assert) {
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

  await new Promise((accept, reject) => {
    this.masterPlaylistController.mainSegmentLoader_.on('appending', accept);
  });

  // source buffers are mocked, so must manually trigger update ends on audio and video
  // buffers
  this.masterPlaylistController.mediaSource.sourceBuffers[0].trigger('updateend');
  this.masterPlaylistController.mediaSource.sourceBuffers[1].trigger('updateend');

  // media1
  this.standardXHRResponse(this.requests[3]);
  assert.ok(selectedPlaylist, 'selected playlist');
  assert.ok(this.masterPlaylistController.mediaSource.duration !== 0,
           'updates the duration');

  // verify stats
  // request duration was 1ms, giving a bandwidth of bytes / 1 * 8 * 1000
  assert.equal(this.player.tech_.hls.stats.bandwidth,
               segmentByteLength / 1 * 8 * 1000,
               'stats has the right bandwidth');
  assert.equal(this.player.tech_.hls.stats.mediaRequests, 1, '1 segment request');
  assert.equal(this.player.tech_.hls.stats.mediaBytesTransferred,
               segmentByteLength,
               'stats has the right number of bytes transferred');
});

QUnit.test('playlist selection uses systemBandwidth', async function(assert) {
  this.masterPlaylistController.mediaSource.trigger('sourceopen');
  this.player.width(1000);
  this.player.height(900);

  // master
  this.standardXHRResponse(this.requests[0]);
  // media
  this.standardXHRResponse(this.requests[1]);

  assert.ok(/media3\.m3u8/i.test(this.requests[1].url), 'Selected the highest rendition');

  await requestAndAppendSegment({
    request: this.requests[2],
    segment: muxedSegment(),
    segmentLoader: this.masterPlaylistController.mainSegmentLoader_,
    clock: this.clock,
    bandwidth: 8192000,
    throughput: 409600
  });
  // need two segments before a rendition change can happen
  await requestAndAppendSegment({
    request: this.requests[3],
    segment: muxedSegment(),
    segmentLoader: this.masterPlaylistController.mainSegmentLoader_,
    clock: this.clock,
    bandwidth: 8192000,
    throughput: 409600
  });

  // systemBandwidth is 1 / (1 / 8192000 + 1 / 409600) = ~390095
  assert.ok(/media\.m3u8/i.test(this.requests[4].url), 'Selected the rendition < 390095');
});

QUnit.test('removes request timeout when segment timesout on lowest rendition',
function(assert) {
  this.masterPlaylistController.mediaSource.trigger('sourceopen');

  // master
  this.standardXHRResponse(this.requests[0]);
  // media
  this.standardXHRResponse(this.requests[1]);

  assert.equal(this.masterPlaylistController.requestOptions_.timeout,
              this.masterPlaylistController.masterPlaylistLoader_.targetDuration * 1.5 *
              1000,
              'default request timeout');

  assert.ok(!Playlist.isLowestEnabledRendition(
              this.masterPlaylistController.masterPlaylistLoader_.master,
              this.masterPlaylistController.masterPlaylistLoader_.media()),
            'not on lowest rendition');

  // Cause segment to timeout to force player into lowest rendition
  this.requests[2].timedout = true;

  // Downloading segment should cause media change and timeout removal
  // segment 0
  this.standardXHRResponse(this.requests[2]);
  // Download new segment after media change
  this.standardXHRResponse(this.requests[3]);

  assert.ok(Playlist.isLowestEnabledRendition(
              this.masterPlaylistController.masterPlaylistLoader_.master,
              this.masterPlaylistController.masterPlaylistLoader_.media()),
            'on lowest rendition');

  assert.equal(this.masterPlaylistController.requestOptions_.timeout, 0,
              'request timeout 0');
});

QUnit.test('removes request timeout when the source is a media playlist and not master',
  function(assert) {
    this.requests.length = 0;

    this.player.src({
      src: 'manifest/media.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    this.clock.tick(1);

    this.masterPlaylistController = this.player.tech_.hls.masterPlaylistController_;

    // media
    this.standardXHRResponse(this.requests.shift());

    assert.equal(this.masterPlaylistController.requestOptions_.timeout, 0,
              'request timeout set to 0 when loading a non master playlist');
  });

QUnit.test('seekable uses the intersection of alternate audio and combined tracks',
function(assert) {
  let origSeekable = Playlist.seekable;
  let mpc = this.masterPlaylistController;
  let mainMedia = {};
  let audioMedia = {};
  let mainTimeRanges = [];
  let audioTimeRanges = [];

  this.masterPlaylistController.masterPlaylistLoader_.media = () => mainMedia;
  this.masterPlaylistController.syncController_.getExpiredTime = () => 0;

  Playlist.seekable = (media) => {
    if (media === mainMedia) {
      return videojs.createTimeRanges(mainTimeRanges);
    }
    return videojs.createTimeRanges(audioTimeRanges);
  };

  assert.timeRangesEqual(
    mpc.seekable(), videojs.createTimeRanges(), 'empty when main empty');
  mainTimeRanges = [[0, 10]];
  mpc.seekable_ = videojs.createTimeRanges();
  mpc.onSyncInfoUpdate_();
  assert.timeRangesEqual(
    mpc.seekable(), videojs.createTimeRanges([[0, 10]]), 'main when no audio');

  mpc.mediaTypes_.AUDIO.activePlaylistLoader = {
    media: () => audioMedia,
    dispose() {},
    expired_: 0
  };
  mainTimeRanges = [];
  mpc.seekable_ = videojs.createTimeRanges();
  mpc.onSyncInfoUpdate_();

  assert.timeRangesEqual(
    mpc.seekable(), videojs.createTimeRanges(), 'empty when both empty');
  mainTimeRanges = [[0, 10]];
  mpc.seekable_ = videojs.createTimeRanges();
  mpc.onSyncInfoUpdate_();
  assert.timeRangesEqual(
    mpc.seekable(), videojs.createTimeRanges(), 'empty when audio empty');
  mainTimeRanges = [];
  audioTimeRanges = [[0, 10]];
  mpc.seekable_ = videojs.createTimeRanges();
  mpc.onSyncInfoUpdate_();
  assert.timeRangesEqual(
    mpc.seekable(), videojs.createTimeRanges(), 'empty when main empty');
  mainTimeRanges = [[0, 10]];
  audioTimeRanges = [[0, 10]];
  mpc.seekable_ = videojs.createTimeRanges();
  mpc.onSyncInfoUpdate_();
  assert.timeRangesEqual(
    mpc.seekable(), videojs.createTimeRanges([[0, 10]]), 'ranges equal');
  mainTimeRanges = [[5, 10]];
  mpc.seekable_ = videojs.createTimeRanges();
  mpc.onSyncInfoUpdate_();
  assert.timeRangesEqual(
    mpc.seekable(), videojs.createTimeRanges([[5, 10]]), 'main later start');
  mainTimeRanges = [[0, 10]];
  audioTimeRanges = [[5, 10]];
  mpc.seekable_ = videojs.createTimeRanges();
  mpc.onSyncInfoUpdate_();
  assert.timeRangesEqual(
    mpc.seekable(), videojs.createTimeRanges([[5, 10]]), 'audio later start');
  mainTimeRanges = [[0, 9]];
  audioTimeRanges = [[0, 10]];
  mpc.seekable_ = videojs.createTimeRanges();
  mpc.onSyncInfoUpdate_();
  assert.timeRangesEqual(
    mpc.seekable(), videojs.createTimeRanges([[0, 9]]), 'main earlier end');
  mainTimeRanges = [[0, 10]];
  audioTimeRanges = [[0, 9]];
  mpc.seekable_ = videojs.createTimeRanges();
  mpc.onSyncInfoUpdate_();
  assert.timeRangesEqual(
    mpc.seekable(), videojs.createTimeRanges([[0, 9]]), 'audio earlier end');
  mainTimeRanges = [[1, 10]];
  audioTimeRanges = [[0, 9]];
  mpc.seekable_ = videojs.createTimeRanges();
  mpc.onSyncInfoUpdate_();
  assert.timeRangesEqual(
    mpc.seekable(),
    videojs.createTimeRanges([[1, 9]]),
    'main later start, audio earlier end');
  mainTimeRanges = [[0, 9]];
  audioTimeRanges = [[1, 10]];
  mpc.seekable_ = videojs.createTimeRanges();
  mpc.onSyncInfoUpdate_();
  assert.timeRangesEqual(
    mpc.seekable(),
    videojs.createTimeRanges([[1, 9]]),
    'audio later start, main earlier end');
  mainTimeRanges = [[2, 9]];
  mpc.seekable_ = videojs.createTimeRanges();
  mpc.onSyncInfoUpdate_();
  assert.timeRangesEqual(
    mpc.seekable(),
    videojs.createTimeRanges([[2, 9]]),
    'main later start, main earlier end');
  mainTimeRanges = [[1, 10]];
  audioTimeRanges = [[2, 9]];
  mpc.seekable_ = videojs.createTimeRanges();
  mpc.onSyncInfoUpdate_();
  assert.timeRangesEqual(
    mpc.seekable(),
    videojs.createTimeRanges([[2, 9]]),
    'audio later start, audio earlier end');
  mainTimeRanges = [[1, 10]];
  audioTimeRanges = [[11, 20]];
  mpc.seekable_ = videojs.createTimeRanges();
  mpc.onSyncInfoUpdate_();
  assert.timeRangesEqual(
    mpc.seekable(),
    videojs.createTimeRanges([[1, 10]]),
    'no intersection, audio later');
  mainTimeRanges = [[11, 20]];
  audioTimeRanges = [[1, 10]];
  mpc.seekable_ = videojs.createTimeRanges();
  mpc.onSyncInfoUpdate_();
  assert.timeRangesEqual(
    mpc.seekable(),
    videojs.createTimeRanges([[11, 20]]),
    'no intersection, main later');

  Playlist.seekable = origSeekable;
});

QUnit.test('syncInfoUpdate triggers seekablechanged when seekable is updated',
function(assert) {
  let origSeekable = Playlist.seekable;
  let mpc = this.masterPlaylistController;
  let tech = this.player.tech_;
  let mainTimeRanges = [];
  let media = {};
  let seekablechanged = 0;

  tech.on('seekablechanged', () => seekablechanged++);

  Playlist.seekable = () => {
    return videojs.createTimeRanges(mainTimeRanges);
  };
  this.masterPlaylistController.masterPlaylistLoader_.media = () => media;
  this.masterPlaylistController.syncController_.getExpiredTime = () => 0;

  mainTimeRanges = [[0, 10]];
  mpc.seekable_ = videojs.createTimeRanges();
  mpc.onSyncInfoUpdate_();
  assert.equal(seekablechanged, 1, 'seekablechanged triggered');

  Playlist.seekable = origSeekable;
});

QUnit.test('calls to update cues on new media', function(assert) {
  let origHlsOptions = videojs.options.hls;

  videojs.options.hls = {
    useCueTags: true
  };

  this.player = createPlayer();
  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.masterPlaylistController = this.player.tech_.hls.masterPlaylistController_;

  let callCount = 0;

  this.masterPlaylistController.updateAdCues_ = (media) => callCount++;

  // master
  this.standardXHRResponse(this.requests.shift());

  assert.equal(callCount, 0, 'no call to update cues on master');

  // media
  this.standardXHRResponse(this.requests.shift());

  assert.equal(callCount, 1, 'calls to update cues on first media');

  this.masterPlaylistController.masterPlaylistLoader_.trigger('loadedplaylist');

  assert.equal(callCount, 2, 'calls to update cues on subsequent media');

  videojs.options.hls = origHlsOptions;
});

QUnit.test('calls to update cues on media when no master', function(assert) {
  this.requests.length = 0;

  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.masterPlaylistController = this.player.tech_.hls.masterPlaylistController_;
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
  let origHlsOptions = videojs.options.hls;
  let hlsPlaylistCueTagsEvents = 0;

  videojs.options.hls = {
    useCueTags: true
  };

  this.player = createPlayer();
  this.player.tech_.on('usage', (event) => {
    if (event.name === 'hls-playlist-cue-tags') {
      hlsPlaylistCueTagsEvents++;
    }
  });
  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.masterPlaylistController = this.player.tech_.hls.masterPlaylistController_;
  this.standardXHRResponse(this.requests.shift());
  this.standardXHRResponse(this.requests.shift());

  assert.equal(hlsPlaylistCueTagsEvents, 1, 'cue tags event has been triggered once');
  assert.ok(this.masterPlaylistController.cueTagsTrack_,
           'creates cueTagsTrack_ if useCueTags is truthy');
  assert.equal(this.masterPlaylistController.cueTagsTrack_.label,
              'ad-cues',
              'cueTagsTrack_ has label of ad-cues');
  assert.equal(this.player.textTracks()[0], this.masterPlaylistController.cueTagsTrack_,
           'adds cueTagsTrack as a text track if useCueTags is truthy');

  videojs.options.hls = origHlsOptions;
});

QUnit.test('correctly sets alternate audio track kinds', function(assert) {
  this.requests.length = 0;
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
  assert.equal(audioTracks[1].id,
               'English Descriptions',
               'contains english descriptions track');
  assert.equal(audioTracks[1].kind,
               'main-desc',
               'english descriptions track\'s kind is "main-desc"');
  assert.equal(audioTracks[2].id, 'Français', 'contains french track');
  assert.equal(audioTracks[2].kind,
               'alternative',
               'french track\'s kind is "alternative"');
  assert.equal(audioTracks[3].id, 'Espanol', 'contains spanish track');
  assert.equal(audioTracks[3].kind,
               'alternative',
               'spanish track\'s kind is "alternative"');
});

QUnit.test('trigger events when video and audio is demuxed by default', function(assert) {
  let hlsDemuxedEvents = 0;

  this.requests.length = 0;
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/multipleAudioGroups.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.player.tech_.on('usage', (event) => {
    if (event.name === 'hls-demuxed') {
      hlsDemuxedEvents++;
    }
  });

  openMediaSource(this.player, this.clock);
  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  assert.equal(hlsDemuxedEvents, 1, 'video and audio is demuxed by default');
});

QUnit.test('trigger events when an AES is detected', function(assert) {
  let hlsAesEvents = 0;
  let isAesCopy = Hls.Playlist.isAes;

  Hls.Playlist.isAes = (media) => {
    return true;
  };

  this.player.tech_.on('usage', (event) => {
    if (event.name === 'hls-aes') {
      hlsAesEvents++;
    }
  });

  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());
  this.masterPlaylistController.mediaSource.trigger('sourceopen');

  assert.equal(hlsAesEvents, 1, 'an AES HLS stream is detected');
  Hls.Playlist.isAes = isAesCopy;
});

QUnit.test('trigger event when a video fMP4 stream is detected', async function(assert) {
  // use real media sources to allow segment loader to naturally detect fmp4
  this.mse.restore();
  this.requests.length = 0;
  this.player = createPlayer();
  this.player.src({
    src: 'prog_index.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  let hlsFmp4Events = 0;

  this.player.tech_.on('usage', (event) => {
    if (event.name === 'hls-fmp4') {
      hlsFmp4Events++;
    }
  });

  const mpc = this.player.vhs.masterPlaylistController_;

  await setupMediaSource(
    mpc.mainSegmentLoader_.mediaSource_,
    mpc.mainSegmentLoader_.sourceUpdater_,
    {
      videoEl: this.player.tech_.el_,
      isVideoOnly: true
    }
  );

  // media
  this.standardXHRResponse(this.requests.shift());

  assert.equal(hlsFmp4Events, 0, 'an fMP4 stream is not detected');

  const initSegmentRequest = this.requests.shift();
  const segmentRequest = this.requests.shift();

  await requestAndAppendSegment({
    request: segmentRequest,
    initSegmentRequest,
    segmentLoader: mpc.mainSegmentLoader_,
    initSegment: mp4VideoInitSegment(),
    segment: mp4VideoSegment(),
    isOnlyVideo: true,
    clock: this.clock
  });

  assert.equal(hlsFmp4Events, 1, 'an fMP4 stream is detected');
});

QUnit.test('only triggers a single fmp4 usage event', async function(assert) {
  let hlsFmp4Events = 0;

  this.player.tech_.on('usage', (event) => {
    if (event.name === 'hls-fmp4') {
      hlsFmp4Events++;
    }
  });

  const mainSegmentLoader = this.player.vhs.masterPlaylistController_.mainSegmentLoader_;

  mainSegmentLoader.trigger('fmp4');

  assert.equal(hlsFmp4Events, 1, 'fired fMP4 usage event');

  mainSegmentLoader.trigger('fmp4');

  assert.equal(hlsFmp4Events, 1, 'did not fire usage event');

  const audioSegmentLoader =
    this.player.vhs.masterPlaylistController_.audioSegmentLoader_;

  audioSegmentLoader.trigger('fmp4');

  assert.equal(hlsFmp4Events, 1, 'did not fire usage event');
});

// TODO currently this test is skipped because audio only fmp4 isn't supported. Once
// support is added, this test can be unskipped.
QUnit.skip('trigger event when an audio fMP4 stream is detected', async function(assert) {
  // use real media sources to allow segment loader to naturally detect fmp4
  this.mse.restore();
  this.requests.length = 0;
  this.player = createPlayer();
  this.player.src({
    src: 'prog_index.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  let hlsFmp4Events = 0;

  this.player.tech_.on('usage', (event) => {
    if (event.name === 'hls-fmp4') {
      hlsFmp4Events++;
    }
  });

  const mpc = this.player.vhs.masterPlaylistController_;

  await setupMediaSource(
    mpc.mainSegmentLoader_.mediaSource_,
    mpc.mainSegmentLoader_.sourceUpdater_,
    {
      videoEl: this.player.tech_.el_,
      isAudioOnly: true
    }
  );

  // media
  this.standardXHRResponse(this.requests.shift());

  assert.equal(hlsFmp4Events, 0, 'an fMP4 stream is not detected');

  const initSegmentRequest = this.requests.shift();
  const segmentRequest = this.requests.shift();

  await requestAndAppendSegment({
    request: segmentRequest,
    initSegmentRequest,
    segmentLoader: mpc.mainSegmentLoader_,
    initSegment: mp4AudioInitSegment(),
    segment: mp4AudioSegment(),
    isOnlyAudio: true,
    clock: this.clock
  });

  assert.equal(hlsFmp4Events, 1, 'an fMP4 stream is detected');
});

QUnit.test('adds only CEA608 closed-caption tracks when a master playlist is loaded',
function(assert) {
  this.requests.length = 0;
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master-captions.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  // wait for async player.src to complete
  this.clock.tick(1);

  const masterPlaylistController = this.player.tech_.hls.masterPlaylistController_;

  assert.equal(this.player.textTracks().length, 1, 'one text track to start');
  assert.equal(this.player.textTracks()[0].label,
               'segment-metadata',
               'only segment-metadata text track');

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
  assert.equal(textTracks[1].id, addedCaps[0].instreamId,
    'text track 1\'s id is CC\'s instreamId');
  assert.equal(textTracks[2].id, addedCaps[1].instreamId,
    'text track 2\'s id is CC\'s instreamId');
  assert.equal(textTracks[1].label, addedCaps[0].name,
    'text track 1\'s label is CC\'s name');
  assert.equal(textTracks[2].label, addedCaps[1].name,
    'text track 2\'s label is CC\'s name');
});

QUnit.test('adds subtitle tracks when a media playlist is loaded', function(assert) {
  let hlsWebvttEvents = 0;

  this.requests.length = 0;
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master-subtitles.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.player.tech_.on('usage', (event) => {
    if (event.name === 'hls-webvtt') {
      hlsWebvttEvents++;
    }
  });

  const masterPlaylistController = this.player.tech_.hls.masterPlaylistController_;

  assert.equal(hlsWebvttEvents, 0, 'there is no webvtt detected');
  assert.equal(this.player.textTracks().length, 1, 'one text track to start');
  assert.equal(this.player.textTracks()[0].label,
               'segment-metadata',
               'only segment-metadata text track');

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
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master-subtitles.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  const masterPlaylistController = this.player.tech_.hls.masterPlaylistController_;

  // sets up listener for text track changes
  masterPlaylistController.trigger('sourceopen');

  // master, contains media groups for subtitles
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());
  // media segment
  this.standardXHRResponse(this.requests.shift());

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
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master-subtitles.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  const masterPlaylistController = this.player.tech_.hls.masterPlaylistController_;

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

  this.player.tech_.trigger('error');

  assert.equal(pauseCount, 1, 'paused subtitle segment loader');
});

QUnit.test('disposes subtitle loaders on dispose', function(assert) {
  this.requests.length = 0;
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master-subtitles.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  let masterPlaylistController = this.player.tech_.hls.masterPlaylistController_;

  assert.notOk(masterPlaylistController.mediaTypes_.SUBTITLES.activePlaylistLoader,
               'does not start with a subtitle playlist loader');
  assert.ok(masterPlaylistController.subtitleSegmentLoader_,
            'starts with a subtitle segment loader');

  let segmentLoaderDisposeCount = 0;

  masterPlaylistController.subtitleSegmentLoader_.dispose =
    () => segmentLoaderDisposeCount++;

  masterPlaylistController.dispose();

  assert.equal(segmentLoaderDisposeCount, 1, 'disposed the subtitle segment loader');

  this.requests.length = 0;
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master-subtitles.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  masterPlaylistController = this.player.tech_.hls.masterPlaylistController_;

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

  assert.ok(masterPlaylistController.mediaTypes_.SUBTITLES.activePlaylistLoader,
            'has a subtitle playlist loader');
  assert.ok(masterPlaylistController.subtitleSegmentLoader_,
            'has a subtitle segment loader');

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
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master-subtitles.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  const masterPlaylistController = this.player.tech_.hls.masterPlaylistController_;

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

  assert.equal(mpc.bufferLowWaterLine(), 5,
    'dynamic BLWL increases by currentTime * rate');

  currentTime = 60;

  assert.equal(mpc.bufferLowWaterLine(), 30, 'dynamic BLWL uses max value');

  currentTime = 70;

  assert.equal(mpc.bufferLowWaterLine(), 30, 'dynamic BLWL continues to use max value');

  // restore config
  Object.keys(configOld).forEach((key) => {
    Config[key] = configOld[key];
  });
});

QUnit.test('creates source buffers after first main segment if muxed content',
async function(assert) {
  this.requests.length = 0;
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const mpc = this.player.vhs.masterPlaylistController_;
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

  await requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock
  });

  assert.equal(createSourceBufferCalls.length, 1, 'called to create source buffers');
  assert.deepEqual(
    createSourceBufferCalls[0],
    {
      audio: DEFAULT_AUDIO_CODEC,
      video: DEFAULT_VIDEO_CODEC
    },
    'passed default codecs');
});

QUnit.test('creates source buffers after first main segment if audio only',
async function(assert) {
  this.requests.length = 0;
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const mpc = this.player.vhs.masterPlaylistController_;
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

  await requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: mpc.mainSegmentLoader_,
    segment: audioSegment(),
    isOnlyAudio: true,
    clock: this.clock
  });

  assert.equal(createSourceBufferCalls.length, 1, 'called to create source buffers');
  assert.deepEqual(
    createSourceBufferCalls[0],
    {
      audio: DEFAULT_AUDIO_CODEC
    },
    'passed default audio codec');
});

QUnit.test('creates source buffers after first main segment if video only',
async function(assert) {
  this.requests.length = 0;
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const mpc = this.player.vhs.masterPlaylistController_;
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

  await requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: mpc.mainSegmentLoader_,
    segment: videoSegment(),
    isOnlyVideo: true,
    clock: this.clock
  });

  assert.equal(createSourceBufferCalls.length, 1, 'called to create source buffers');
  assert.deepEqual(
    createSourceBufferCalls[0],
    {
      video: DEFAULT_VIDEO_CODEC
    },
    'passed default video codec');
});

// Right now we only get codec information from the manifest, not the content itself. As
// such, if there's alternate audio, we know it'll either use the manifest provided codec
// info or the default. Either way, we don't need to wait for the audio segment to create
// the source buffers.
QUnit.test('creates source buffers after first main segment if demuxed',
async function(assert) {
  this.requests.length = 0;
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const mpc = this.player.vhs.masterPlaylistController_;
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
      'LANGUAGE="en",URI="audio.m3u8"\n' +
    '#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=1,AUDIO="audio"\n' +
    'media.m3u8\n');
  // video media
  this.standardXHRResponse(this.requests.shift());
  // audio media
  this.standardXHRResponse(this.requests.shift());

  assert.equal(createSourceBufferCalls.length, 0, 'have not created source buffers yet');

  await requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: mpc.mainSegmentLoader_,
    segment: videoSegment(),
    isOnlyVideo: true,
    clock: this.clock
  });

  assert.equal(createSourceBufferCalls.length, 1, 'called to create source buffers');
  assert.deepEqual(
    createSourceBufferCalls[0],
    {
      video: DEFAULT_VIDEO_CODEC,
      audio: DEFAULT_AUDIO_CODEC
    },
    'passed default codecs');
});

QUnit.test('uses codec info from manifest for source buffer creation',
async function(assert) {
  this.requests.length = 0;
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const mpc = this.player.vhs.masterPlaylistController_;
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
    'media.m3u8\n');
  // media
  this.standardXHRResponse(this.requests.shift());
  await requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock
  });

  assert.equal(createSourceBufferCalls.length, 1, 'called to create source buffers');
  assert.deepEqual(
    createSourceBufferCalls[0],
    {
      audio: 'mp4a.40.e',
      video: 'avc1.deadbeef'
    },
    'passed manifest specified codecs');
});

QUnit.test('translates old-school apple codec strings from manifest to modern standard ' +
'for source buffer creation',
async function(assert) {
  this.requests.length = 0;
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const mpc = this.player.vhs.masterPlaylistController_;
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
    'media.m3u8\n');
  // media
  this.standardXHRResponse(this.requests.shift());
  await requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock
  });

  assert.equal(createSourceBufferCalls.length, 1, 'called to create source buffers');
  assert.deepEqual(
    createSourceBufferCalls[0],
    {
      audio: 'mp4a.40.5',
      video: 'avc1.64001f'
    },
    'translated to modern codec strings');
});

QUnit.test('uses default codec strings when provided are invalid',
async function(assert) {
  this.requests.length = 0;
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const mpc = this.player.vhs.masterPlaylistController_;
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
    'media.m3u8\n');
  // media
  this.standardXHRResponse(this.requests.shift());
  await requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock
  });

  assert.equal(createSourceBufferCalls.length, 1, 'called to create source buffers');
  assert.deepEqual(
    createSourceBufferCalls[0],
    {
      audio: 'mp4a.40.2',
      video: 'avc1.4d400d'
    },
    'used default codec strings');
});

QUnit.test('uses codec info from manifest for source buffer creation even when demuxed',
async function(assert) {
  this.requests.length = 0;
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const mpc = this.player.vhs.masterPlaylistController_;
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
      'LANGUAGE="en",URI="audio.m3u8"\n' +
    '#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=1,AUDIO="audio",' +
      'CODECS="mp4a.40.e, avc1.deadbeef"\n' +
    'media.m3u8\n');
  // video media
  this.standardXHRResponse(this.requests.shift());
  // audio media
  this.standardXHRResponse(this.requests.shift());
  await requestAndAppendSegment({
    request: this.requests.shift(),
    segment: videoSegment(),
    isOnlyVideo: true,
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock
  });

  assert.equal(createSourceBufferCalls.length, 1, 'called to create source buffers');
  assert.deepEqual(
    createSourceBufferCalls[0],
    {
      audio: 'mp4a.40.e',
      video: 'avc1.deadbeef'
    },
    'passed manifest specified codecs');
});

QUnit.test('uses codec info from manifest for source buffer creation for audio only',
async function(assert) {
  this.requests.length = 0;
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const mpc = this.player.vhs.masterPlaylistController_;
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
    'media.m3u8\n');
  // media
  this.standardXHRResponse(this.requests.shift());
  await requestAndAppendSegment({
    request: this.requests.shift(),
    segment: audioSegment(),
    isOnlyAudio: true,
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock
  });

  assert.equal(createSourceBufferCalls.length, 1, 'called to create source buffers');
  assert.deepEqual(
    createSourceBufferCalls[0],
    {
      audio: 'mp4a.40.e'
    },
    'passed manifest specified audio codec');
});

QUnit.test('uses codec info from manifest for source buffer creation for video only',
async function(assert) {
  this.requests.length = 0;
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const mpc = this.player.vhs.masterPlaylistController_;
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
    'media.m3u8\n');
  // media
  this.standardXHRResponse(this.requests.shift());
  await requestAndAppendSegment({
    request: this.requests.shift(),
    segment: videoSegment(),
    isOnlyVideo: true,
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock
  });

  assert.equal(createSourceBufferCalls.length, 1, 'called to create source buffers');
  assert.deepEqual(
    createSourceBufferCalls[0],
    {
      video: 'avc1.deadbeef'
    },
    'passed manifest specified video codec');
});

// Technically, the HLS spec at least requires that the user provide all codec info if
// they supply a CODEC attribute. However, we can be a little more flexible in some cases.
QUnit.test('uses available audio codec info from manifest plus video default for source' +
'buffer creation if content looks different from codec info', async function(assert) {
  this.requests.length = 0;
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const mpc = this.player.vhs.masterPlaylistController_;
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
    'media.m3u8\n');
  // media
  this.standardXHRResponse(this.requests.shift());
  // segment with both audio and video
  await requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock
  });

  assert.equal(createSourceBufferCalls.length, 1, 'called to create source buffers');
  assert.deepEqual(
    createSourceBufferCalls[0],
    {
      audio: 'mp4a.40.e',
      video: DEFAULT_VIDEO_CODEC
    },
    'passed manifest specified codecs and used default');
});

// Technically, the HLS spec at least requires that the user provide all codec info if
// they supply a CODEC attribute. However, we can be a little more flexible in some cases.
QUnit.test('uses available video codec info from manifest plus audio default for source' +
'buffer creation if content looks different from codec info', async function(assert) {
  this.requests.length = 0;
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const mpc = this.player.vhs.masterPlaylistController_;
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
    'media.m3u8\n');
  // media
  this.standardXHRResponse(this.requests.shift());
  // segment with both audio and video
  await requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock
  });

  assert.equal(createSourceBufferCalls.length, 1, 'called to create source buffers');
  assert.deepEqual(
    createSourceBufferCalls[0],
    {
      audio: DEFAULT_AUDIO_CODEC,
      video: 'avc1.deadbeef'
    },
    'passed manifest specified codecs and used default');
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

  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXTINF:5.0\n' +
                                '0.ts\n');

  assert.equal(mpc.duration(), Infinity, 'duration reported as infinite');
});

QUnit.test('live playlist sets duration of media source to seekable end',
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
    'native media source duration set to seekable end');
});

QUnit.test('VOD playlist sets duration of media source to calculated playlist duration',
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
});

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
});
