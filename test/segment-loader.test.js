import QUnit from 'qunit';
import {
  default as SegmentLoader,
  illegalMediaSwitch,
  safeBackBufferTrimTime
} from '../src/segment-loader';
import segmentTransmuxer from '../src/segment-transmuxer';
import videojs from 'video.js';
import mp4probe from 'mux.js/lib/mp4/probe';
import {
  playlistWithDuration,
  standardXHRResponse,
  setupMediaSource
} from './test-helpers.js';
import {
  LoaderCommonHooks,
  LoaderCommonSettings,
  LoaderCommonFactory
} from './loader-common.js';
import {
  muxed as muxedSegment,
  audio as audioSegment,
  video as videoSegment,
  mp4Video as mp4VideoSegment,
  mp4VideoInit as mp4VideoInitSegment,
  mp4Audio as mp4AudioSegment,
  mp4AudioInit as mp4AudioInitSegment
} from './test-segments';
import sinon from 'sinon';

/* TODO
// noop addSegmentMetadataCue_ since most test segments dont have real timing information
// save the original function to a variable to patch it back in for the metadata cue
// specific tests
const ogAddSegmentMetadataCue_ = SegmentLoader.prototype.addSegmentMetadataCue_;

SegmentLoader.prototype.addSegmentMetadataCue_ = function() {};
*/

QUnit.module('SegmentLoader Isolated Functions');

QUnit.test('illegalMediaSwitch detects illegal media switches', function(assert) {
  let startingMedia = { hasAudio: true, hasVideo: true };
  let newSegmentMedia = { hasAudio: true, hasVideo: true };

  assert.notOk(illegalMediaSwitch('main', startingMedia, newSegmentMedia),
               'no error when muxed to muxed');

  startingMedia = { hasAudio: true, hasVideo: true };
  newSegmentMedia = { hasAudio: false, hasVideo: false };
  assert.notOk(illegalMediaSwitch('audio', startingMedia, newSegmentMedia),
               'no error when not main loader type');

  startingMedia = { hasAudio: true, hasVideo: false };
  newSegmentMedia = { hasAudio: true, hasVideo: false };
  assert.notOk(illegalMediaSwitch('main', startingMedia, newSegmentMedia),
               'no error when audio only to audio only');

  startingMedia = { hasAudio: false, hasVideo: true };
  newSegmentMedia = { hasAudio: false, hasVideo: true };
  assert.notOk(illegalMediaSwitch('main', startingMedia, newSegmentMedia),
               'no error when video only to video only');

  startingMedia = { hasAudio: false, hasVideo: true };
  newSegmentMedia = { hasAudio: true, hasVideo: true };
  assert.notOk(illegalMediaSwitch('main', startingMedia, newSegmentMedia),
               'no error when video only to muxed');

  startingMedia = { hasAudio: true, hasVideo: true };
  newSegmentMedia = { hasAudio: false, hasVideo: false };
  assert.equal(illegalMediaSwitch('main', startingMedia, newSegmentMedia),
               'Neither audio nor video found in segment.',
               'error when neither audio nor video');

  startingMedia = { hasAudio: true, hasVideo: false };
  newSegmentMedia = { hasAudio: false, hasVideo: false };
  assert.equal(illegalMediaSwitch('main', startingMedia, newSegmentMedia),
               'Neither audio nor video found in segment.',
               'error when audio only to neither audio nor video');

  startingMedia = { hasAudio: false, hasVideo: true };
  newSegmentMedia = { hasAudio: false, hasVideo: false };
  assert.equal(illegalMediaSwitch('main', startingMedia, newSegmentMedia),
               'Neither audio nor video found in segment.',
               'error when video only to neither audio nor video');

  startingMedia = { hasAudio: true, hasVideo: false };
  newSegmentMedia = { hasAudio: true, hasVideo: true };
  assert.equal(illegalMediaSwitch('main', startingMedia, newSegmentMedia),
               'Video found in segment when we expected only audio.' +
               ' We can\'t switch to a stream with video from an audio only stream.' +
               ' To get rid of this message, please add codec information to the' +
               ' manifest.',
               'error when audio only to muxed');

  startingMedia = { hasAudio: true, hasVideo: true };
  newSegmentMedia = { hasAudio: true, hasVideo: false };
  assert.equal(illegalMediaSwitch('main', startingMedia, newSegmentMedia),
               'Only audio found in segment when we expected video.' +
               ' We can\'t switch to audio only from a stream that had video.' +
               ' To get rid of this message, please add codec information to the' +
               ' manifest.',
               'error when muxed to audio only');

  startingMedia = { hasAudio: true, hasVideo: false };
  newSegmentMedia = { hasAudio: false, hasVideo: true };
  assert.equal(illegalMediaSwitch('main', startingMedia, newSegmentMedia),
               'Video found in segment when we expected only audio.' +
               ' We can\'t switch to a stream with video from an audio only stream.' +
               ' To get rid of this message, please add codec information to the' +
               ' manifest.',
               'error when audio only to video only');

  startingMedia = { hasAudio: false, hasVideo: true };
  newSegmentMedia = { hasAudio: true, hasVideo: false };
  assert.equal(illegalMediaSwitch('main', startingMedia, newSegmentMedia),
               'Only audio found in segment when we expected video.' +
               ' We can\'t switch to audio only from a stream that had video.' +
               ' To get rid of this message, please add codec information to the' +
               ' manifest.',
               'error when video only to audio only');
});

QUnit.test('safeBackBufferTrimTime determines correct safe removeToTime',
function(assert) {
  let seekable = videojs.createTimeRanges([[75, 120]]);
  let targetDuration = 10;
  let currentTime = 70;

  assert.equal(safeBackBufferTrimTime(seekable, currentTime, targetDuration), 40,
    'uses 30s before current time if currentTime is before seekable start');

  currentTime = 110;

  assert.equal(safeBackBufferTrimTime(seekable, currentTime, targetDuration), 75,
    'uses seekable start if currentTime is after seekable start');

  currentTime = 80;

  assert.equal(safeBackBufferTrimTime(seekable, currentTime, targetDuration), 70,
    'uses target duration before currentTime if currentTime is after seekable but' +
    'within target duration');
});

QUnit.module('SegmentLoader', function(hooks) {
  hooks.beforeEach(LoaderCommonHooks.beforeEach);
  hooks.afterEach(LoaderCommonHooks.afterEach);

  LoaderCommonFactory(SegmentLoader, {loaderType: 'main'});

  // Tests specific to the main segment loader go in this module
  QUnit.module('Main', function(nestedHooks) {
    let loader;

    nestedHooks.beforeEach(function(assert) {
      this.startTime = sinon.stub(mp4probe, 'startTime');
      loader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'main',
        segmentMetadataTrack: this.segmentMetadataTrack
      }), {});
    });

    nestedHooks.afterEach(function(assert) {
      this.startTime.restore();
    });

    QUnit.test('load waits until a playlist is specified to proceed', function(assert) {
      loader.load();

      assert.equal(loader.state, 'INIT', 'waiting in init');
      assert.equal(loader.paused(), false, 'not paused');
      assert.equal(this.requests.length, 0, 'have not made a request yet');

      loader.playlist(playlistWithDuration(10));
      this.clock.tick(1);

      assert.equal(this.requests.length, 1, 'made a request');
      assert.equal(loader.state, 'WAITING', 'transitioned states');
    });

    QUnit.test('only appends one segment at a time', async function(assert) {
      await setupMediaSource(loader.mediaSource_, loader.sourceUpdater_);
      loader.playlist(playlistWithDuration(10));
      loader.load();
      this.clock.tick(1);

      // some time passes and a segment is received
      this.clock.tick(100);
      standardXHRResponse(this.requests.shift(), muxedSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });
      assert.equal(this.requests.length, 0, 'only made one request');
    });

    QUnit.test('updates timestamps when segments do not start at zero',
    async function(assert) {
      await setupMediaSource(
        loader.mediaSource_, loader.sourceUpdater_, { isVideoOnly: true });
      let playlist = playlistWithDuration(10);

      playlist.segments.forEach((segment) => {
        segment.map = {
          resolvedUri: 'init.mp4',
          byterange: { length: Infinity, offset: 0 }
        };
      });
      loader.playlist(playlist);
      loader.load();

      this.startTime.returns(11);

      this.clock.tick(100);
      // init
      standardXHRResponse(this.requests.shift(), mp4VideoInitSegment());
      // segment
      standardXHRResponse(this.requests.shift(), mp4VideoSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });

      assert.equal(
        loader.sourceUpdater_.videoTimestampOffset(), -11, 'set timestampOffset');
      assert.equal(playlist.segments[0].start,
                   0,
                   'segment start time not shifted by mp4 start time');
      assert.equal(playlist.segments[0].end,
                   10,
                   'segment end time not shifted by mp4 start time');
    });

     QUnit.test('segmentKey will cache new encrypted keys with cacheEncryptionKeys true', function(assert) {
      const newLoader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'main',
        segmentMetadataTrack: this.segmentMetadataTrack,
        cacheEncryptionKeys: true
      }), {});

      newLoader.playlist(playlistWithDuration(10), { isEncrypted: true });
      newLoader.mimeType(this.mimeType);
      newLoader.load();
      this.clock.tick(1);

      assert.strictEqual(
        Object.keys(newLoader.keyCache_).length,
        0,
        'no keys have been cached'
      );

      const result = newLoader.segmentKey({
        resolvedUri: 'key.php',
        bytes: new Uint32Array([1, 2, 3, 4])
      });

      assert.deepEqual(
        result,
        { resolvedUri: 'key.php' },
        'gets by default'
      );

      newLoader.segmentKey(
        {
          resolvedUri: 'key.php',
          bytes: new Uint32Array([1, 2, 3, 4])
        },
        true
      );

      assert.deepEqual(
        newLoader.keyCache_['key.php'].bytes,
        new Uint32Array([1, 2, 3, 4]),
        'key has been cached'
      );
    });

    QUnit.test('segmentKey will not cache encrypted keys with cacheEncryptionKeys false', function(assert) {
      const newLoader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'main',
        segmentMetadataTrack: this.segmentMetadataTrack,
        cacheEncryptionKeys: false
      }), {});

      newLoader.playlist(playlistWithDuration(10), { isEncrypted: true });
      newLoader.mimeType(this.mimeType);
      newLoader.load();
      this.clock.tick(1);

      assert.strictEqual(
        Object.keys(newLoader.keyCache_).length,
        0,
        'no keys have been cached'
      );

      newLoader.segmentKey(
        {
          resolvedUri: 'key.php',
          bytes: new Uint32Array([1, 2, 3, 4])
        },
        // set = true
        true
      );

      assert.strictEqual(
        Object.keys(newLoader.keyCache_).length,
        0,
        'no keys have been cached since cacheEncryptionKeys is false'
      );
    });

    QUnit.test('new segment requests will use cached keys', function(assert) {
      const done = assert.async();
      const newLoader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'main',
        segmentMetadataTrack: this.segmentMetadataTrack,
        cacheEncryptionKeys: true
      }), {});

      newLoader.playlist(playlistWithDuration(20, { isEncrypted: true }));
      // make the keys the same
      newLoader.playlist_.segments[1].key =
        videojs.mergeOptions({}, newLoader.playlist_.segments[0].key);
      // give 2nd key an iv
      newLoader.playlist_.segments[1].key.iv = new Uint32Array([0, 1, 2, 3]);

      newLoader.mimeType(this.mimeType);
      newLoader.load();
      this.clock.tick(1);

      assert.strictEqual(this.requests.length, 2, 'two requests');
      assert.strictEqual(this.requests[0].uri, '0-key.php', 'key request');
      assert.strictEqual(this.requests[1].uri, '0.ts', 'segment request');

      // key response
      standardXHRResponse(this.requests.shift(), new Uint32Array([1, 1, 1, 1]));
      this.clock.tick(1);
      // segment
      standardXHRResponse(this.requests.shift(), new Uint32Array([1, 5, 0, 1]));
      this.clock.tick(1);

      // As the Decrypter is in a web worker, the last function in SegmentLoader is
      // the easiest way to listen for the decrypted response
      const origHandleSegment = newLoader.handleSegment_.bind(newLoader);

      newLoader.handleSegment_ = () => {
        origHandleSegment();
        this.updateend();
        assert.deepEqual(
          newLoader.keyCache_['0-key.php'],
          {
            resolvedUri: '0-key.php',
            bytes: new Uint32Array([16777216, 16777216, 16777216, 16777216])
          },
        'previous key was cached');

        this.clock.tick(1);
        assert.deepEqual(
          newLoader.pendingSegment_.segment.key,
          {
            resolvedUri: '0-key.php',
            uri: '0-key.php',
            iv: new Uint32Array([0, 1, 2, 3])
          },
          'used cached key for request and own initialization vector'
        );

        assert.strictEqual(this.requests.length, 1, 'one request');
        assert.strictEqual(this.requests[0].uri, '1.ts', 'only segment request');
        done();
      };
    });

    QUnit.test('triggers syncinfoupdate before attempting a resync',
    async function(assert) {
      await setupMediaSource(loader.mediaSource_, loader.sourceUpdater_);
      let syncInfoUpdates = 0;

      loader.playlist(playlistWithDuration(20));
      loader.load();
      this.clock.tick(1);

      this.seekable = videojs.createTimeRanges([[0, 10]]);
      loader.on('syncinfoupdate', () => {
        syncInfoUpdates++;
        // Simulate the seekable window updating
        this.seekable = videojs.createTimeRanges([[200, 210]]);
        // Simulate the seek to live that should happen in playback-watcher
        this.currentTime = 210;
      });

      standardXHRResponse(this.requests.shift(), muxedSegment());
      // the appended event will not fire, as segment-loader will realize that its guess
      // was off and will reset everything to load at the new point, therefore, wait for
      // the syncinfoupdate event rather than the appended event
      await new Promise((accept, reject) => {
        loader.on('syncinfoupdate', accept);
      });
      this.clock.tick(1);

      assert.equal(loader.mediaIndex, null, 'mediaIndex reset by seek to seekable');
      assert.equal(syncInfoUpdates, 1, 'syncinfoupdate was triggered');
    });

    // This test case used to test that we didn't stop all segment processing (including
    // transmuxing), however, that case has changed, such that segment processing will
    // not stop during appends, but will stop if in the middle of processing.
    QUnit.test('abort does not cancel segment appends in progress',
    async function(assert) {
      await setupMediaSource(loader.mediaSource_, loader.sourceUpdater_);
      loader.playlist(playlistWithDuration(20));
      loader.load();
      this.clock.tick(1);

      standardXHRResponse(this.requests.shift(), muxedSegment());
      await new Promise((accept, reject) => {
        loader.on('appending', accept);
      });
      loader.abort();
      this.clock.tick(1);

      assert.equal(loader.state, 'APPENDING', 'still appending');
    });

    QUnit.test('sets the timestampOffset on timeline change', async function(assert) {
      await setupMediaSource(
        loader.mediaSource_, loader.sourceUpdater_, { isVideoOnly: true });
      let timestampOffsetEvents = 0;

      // timestampoffset events are triggered when the source buffer's timestamp offset is
      // set
      loader.on('timestampoffset', () => {
        timestampOffsetEvents++;
      });
      // The transmuxer's timestamp offset is set at different times than the source
      // buffers' timestamp offsets. Since keepOriginalTimestamps is set to true, the
      // timestampOffset value in the transmuxer is used for content alignment
      // modifications, rather than changing time values to match a timeline.
      const origPostMessage = loader.transmuxer_.postMessage.bind(loader.transmuxer_);
      const setTimestampOffsetMessages = [];

      loader.transmuxer_.postMessage = (config) => {
        if (config.action === 'setTimestampOffset') {
          setTimestampOffsetMessages.push(config);
        }

        origPostMessage(config);
      };

      let videoSegmentStartTime = 3;
      let videoSegmentEndTime = 13;
      const origHandleTimingInfo = loader.handleTimingInfo_.bind(loader);

      // The source buffer timestamp offset is offset by the start of the segment. In
      // order to account for this, use a fixed value.
      loader.handleTimingInfo_ = (simpleSegment, mediaType, timeType, time) => {
        if (mediaType === 'video') {
          time = timeType === 'start' ? videoSegmentStartTime : videoSegmentEndTime;
        }
        origHandleTimingInfo(simpleSegment, mediaType, timeType, time);
      };

      let buffered = videojs.createTimeRanges();

      loader.buffered_ = () => buffered;

      const playlist = playlistWithDuration(40);

      playlist.discontinuityStarts = [2];
      playlist.segments[2].timeline = 1;
      loader.playlist(playlist);
      loader.load();
      this.clock.tick(1);

      // segment 0
      standardXHRResponse(this.requests.shift(), videoSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });

      assert.equal(timestampOffsetEvents, 1, 'timestampoffset event was fired');
      assert.equal(
        loader.sourceUpdater_.videoBuffer.timestampOffset,
        0 - 3,
        'timestampoffset set on source buffer');
      assert.equal(
        setTimestampOffsetMessages.length,
        0,
        'timestampoffset was not set in transmuxer');

      buffered = videojs.createTimeRanges([[0, 10]]);
      playlist.segments[0].end = 10;
      // start request for segment 1
      this.clock.tick(1);

      assert.equal(timestampOffsetEvents, 1, 'timestampoffset event was not fired again');
      assert.equal(
        loader.sourceUpdater_.videoBuffer.timestampOffset,
        0 - 3,
        'timestampoffset not changed on source buffer');
      // still at 0
      assert.equal(
        setTimestampOffsetMessages.length,
        0,
        'timestampoffset was not set in transmuxer');

      // video start time changed for the next segment (1), but the timestamp offset on
      // the source buffer shouldn't change
      videoSegmentStartTime = 13;
      videoSegmentEndTime = 23;
      // segment 1
      standardXHRResponse(this.requests.shift(), videoSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });

      assert.equal(timestampOffsetEvents, 1, 'timestampoffset event was not fired again');
      assert.equal(
        loader.sourceUpdater_.videoBuffer.timestampOffset,
        0 - 3,
        'timestampoffset not changed on source buffer');
      assert.equal(
        setTimestampOffsetMessages.length,
        0,
        'timestampoffset was not set in transmuxer');

      buffered = videojs.createTimeRanges([[10, 20]]);
      playlist.segments[1].end = 20;
      // start request for segment 2, which has a discontinuity (new timeline)
      this.clock.tick(1);

      assert.equal(timestampOffsetEvents, 1, 'timestampoffset event was not fired again');
      assert.equal(
        loader.sourceUpdater_.videoBuffer.timestampOffset,
        0 - 3,
        'timestampoffset not changed on source buffer');
      assert.equal(
        setTimestampOffsetMessages.length,
        1,
        'timestampoffset was set in transmuxer');
      assert.equal(
        setTimestampOffsetMessages[0].timestampOffset,
        20,
        'transmuxer timestampoffset set to 20');

      videoSegmentStartTime = 101;
      videoSegmentEndTime = 111;
      // segment 2
      standardXHRResponse(this.requests.shift(), videoSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });

      assert.equal(timestampOffsetEvents, 2, 'timestampoffset event was fired');
      assert.equal(
        loader.sourceUpdater_.videoBuffer.timestampOffset,
        20 - 101,
        'timestampoffset changed on source buffer');
      assert.equal(
        setTimestampOffsetMessages.length,
        1,
        'timestampoffset unchanged in transmuxer');
    });

    QUnit.test('tracks segment end times as they are buffered', async function(assert) {
      await setupMediaSource(loader.mediaSource_, loader.sourceUpdater_);
      let playlist = playlistWithDuration(20);

      loader.playlist(playlist);
      loader.load();
      this.clock.tick(1);

      assert.notOk(playlist.segments[0].end, 'does not start with duration');

      standardXHRResponse(this.requests.shift(), muxedSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });
      this.clock.tick(1);

      assert.ok(playlist.segments[0].end, 'updated duration');
    });

    QUnit.test('adds cues with segment information to the segment-metadata' +
               ' track as they are buffered', async function(assert) {
      const addCueSpy = sinon.spy();

      loader.segmentMetadataTrack_ = {
        addCue: addCueSpy
      };

      await setupMediaSource(loader.mediaSource_, loader.sourceUpdater_);
      loader.playlist(playlistWithDuration(50));
      loader.load();

      this.clock.tick(1);

      // Respond with a segment, and wait until it is appended
      standardXHRResponse(this.requests.shift(), muxedSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });

      assert.strictEqual(
        addCueSpy.callCount,
        1,
        'appending segment should have added a new cue to the segmentMetadataTrack'
      );
      this.clock.tick(1);

      standardXHRResponse(this.requests.shift(), muxedSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });

      assert.strictEqual(
        addCueSpy.callCount,
        2,
        'another append adds to segmentMetadataTrack'
      );
    });

    QUnit.test('does not add cue for invalid segment timing info', async function(assert) {
      const addCueSpy = sinon.spy();

      loader.segmentMetadataTrack_ = {
        addCue: addCueSpy
      };

      await setupMediaSource(loader.mediaSource_, loader.sourceUpdater_);
      loader.playlist(playlistWithDuration(50));
      loader.load();

      this.clock.tick(1);

      // Respond with a segment, and wait until it is appended
      standardXHRResponse(this.requests.shift(), muxedSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });

      assert.equal(addCueSpy.callCount, 1, 'cue added for appended segment');

      loader.addSegmentMetadataCue_({
        segment: {},
        start: 0,
        end: undefined
      });

      assert.equal(addCueSpy.callCount, 1, 'no cue added for invalid segment');
    });

    QUnit.test('translates metadata events into WebVTT cues', async function(assert) {
      const dispatchType = 0x10;
      const metadataCues = [{
        cueTime: 14,
        frames: [{
          data: 'This is a priv tag'
        }]
      }];
      const addCueSpy = sinon.spy();

      await setupMediaSource(loader.mediaSource_, loader.sourceUpdater_);
      loader.inbandTextTracks_ = {};
      loader.playlist(playlistWithDuration(20));
      loader.load();
      // set the mediaSource duration as it is usually set by
      // master playlist controller, which is not present here
      loader.mediaSource_.duration = 20;

      this.clock.tick(1);

      // Mock text tracks and addRemoteTextTrack on the mock tech
      sinon.stub(loader.hls_.tech_, 'addRemoteTextTrack')
        .returns({
          track: {
            addCue: addCueSpy
          }
        });

      standardXHRResponse(this.requests.shift(), muxedSegment());

      // Simulate an id3Frame event happening that will call handleId3_
      const handleId3 = () => {
        loader.handleId3_(loader.pendingSegment_, metadataCues, dispatchType);
      };

      await new Promise((accept, reject) => {
        // we needed some data to be appended first,
        // but the append is not yet finished
        loader.on('appending', handleId3);
        loader.on('appended', accept);
      });
      this.clock.tick(1);

      assert.strictEqual(
        loader.inbandTextTracks_.metadataTrack_.inBandMetadataTrackDispatchType,
        dispatchType,
        'in-band metadata track dispatch type correctly set'
      );
      assert.strictEqual(
        addCueSpy.callCount,
        1,
        'created 1 metadataTrack.cue from the frames'
      );
    });

    QUnit.test('translates caption events into WebVTT cues', async function(assert) {
      const textTrackStub = sinon.stub(loader.hls_.tech_, 'textTracks');
      const captions = [{
        startTime: 0,
        endTime: 1,
        text: 'text',
        stream: 'CC1'
      }];
      const addCueSpy = sinon.spy();

      await setupMediaSource(loader.mediaSource_, loader.sourceUpdater_);
      loader.playlist(playlistWithDuration(20));
      loader.load();

      this.clock.tick(1);

      // Mock text tracks on the mock tech and setup the inbandTextTracks
      loader.inbandTextTracks_ = {};
      textTrackStub.returns({
        getTrackById: () => null
      });
      sinon.stub(loader.hls_.tech_, 'addRemoteTextTrack')
        .returns({
          track: {
            addCue: addCueSpy
          }
        });

      standardXHRResponse(this.requests.shift(), muxedSegment());

      // Simulate a caption event happening that will call handleCaptions_
      const handleCaptions = () => {
        loader.handleCaptions_(loader.pendingSegment_, captions);
      };

      await new Promise((accept, reject) => {
        // we needed some data appended first,
        // but we haven't finished the append yet
        loader.on('appending', handleCaptions);
        loader.on('appended', accept);
      });

      assert.ok(
        Object.keys(loader.inbandTextTracks_.CC1),
        'created one text track with the caption stream as the id'
      );
      assert.strictEqual(addCueSpy.callCount, 1, 'created one cue');
    });

    QUnit.test('translates metadata events from audio-only stream into WebVTT cues',
    async function(assert) {
      const textTrackStub = sinon.stub(loader.hls_.tech_, 'textTracks');
      const metadata = [{
        cueTime: 12,
        frames: [{
          data: 'This is a priv tag'
        }]
      }];

      const addCueSpy = sinon.spy();

      await setupMediaSource(loader.mediaSource_, loader.sourceUpdater_);
      loader.playlist(playlistWithDuration(20));
      loader.load();

      this.clock.tick(1);

      // Mock text tracks on the mock tech and setup the inbandTextTracks
      loader.inbandTextTracks_ = {};
      textTrackStub.returns({
        getTrackById: () => null
      });
      sinon.stub(loader.hls_.tech_, 'addRemoteTextTrack')
        .returns({
          track: {
            addCue: addCueSpy
          }
        });

      standardXHRResponse(this.requests.shift(), audioSegment());

      const dispatchType = 0x10;
      // Simulate a caption event happening that will call handleCaptions_
      const handleId3 = () => {
        loader.handleId3_(loader.pendingSegment_, metadata, dispatchType);
      };

      await new Promise((accept, reject) => {
        // we needed some data appended first,
        // but we haven't finished the append yet
        loader.on('appending', handleId3);
        loader.on('appended', accept);
      });

      assert.ok(
        Object.keys(loader.inbandTextTracks_.metadataTrack_), 'created a metadata track');
      assert.strictEqual(addCueSpy.callCount, 1, 'created one cue');

      assert.strictEqual(
        loader.inbandTextTracks_.metadataTrack_.inBandMetadataTrackDispatchType,
        16,
        'in-band metadata track dispatch type correctly set'
      );

      let cue = addCueSpy.getCall(0).args[0];

      assert.strictEqual(cue.value.data, 'This is a priv tag', 'included the text');
    });

    QUnit.test('fires ended at the end of a playlist', async function(assert) {
      await setupMediaSource(loader.mediaSource_, loader.sourceUpdater_);
      let endOfStreams = 0;

      loader.on('ended', () => endOfStreams++);
      loader.playlist(playlistWithDuration(10));
      loader.load();
      this.clock.tick(1);

      standardXHRResponse(this.requests.shift(), muxedSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });
      this.clock.tick(1);

      assert.equal(endOfStreams, 1, 'triggered ended');
    });

    QUnit.test('endOfStream happens even after a rendition switch',
    async function(assert) {
      await setupMediaSource(loader.mediaSource_, loader.sourceUpdater_);
      let endOfStreams = 0;
      let bandwidthupdates = 0;

      loader.on('ended', () => endOfStreams++);

      loader.on('bandwidthupdate', () => {
        bandwidthupdates++;
        // Simulate a rendition switch
        loader.resetEverything();
      });

      loader.playlist(playlistWithDuration(20));
      loader.load();
      this.clock.tick(1);

      standardXHRResponse(this.requests.shift(), muxedSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });
      this.clock.tick(10);

      standardXHRResponse(this.requests.shift(), muxedSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });

      assert.equal(bandwidthupdates, 1, 'triggered bandwidthupdate');
      assert.equal(endOfStreams, 1, 'triggered ended');
    });

    QUnit.test('endOfStream does not happen while sourceUpdater is updating', function(assert) {
      let endOfStreams = 0;
      let bandwidthupdates = 0;
      let buffered = videojs.createTimeRanges();

      loader.buffered_ = () => buffered;

      loader.playlist(playlistWithDuration(20));
      loader.mimeType(this.mimeType);
      loader.load();
      this.clock.tick(1);

      loader.mediaSource_ = {
        readyState: 'open',
        sourceBuffers: this.mediaSource.sourceBuffers
      };

      loader.on('ended', () => endOfStreams++);

      loader.on('bandwidthupdate', () => {
        bandwidthupdates++;
        // Simulate a rendition switch
        loader.resetEverything();
      });

      this.requests[0].response = new Uint8Array(10).buffer;
      this.requests.shift().respond(200, null, '');
      buffered = videojs.createTimeRanges([[0, 10]]);
      this.updateend();
      this.clock.tick(10);

      loader.sourceUpdater_.updating = () => true;
      this.requests[0].response = new Uint8Array(10).buffer;
      this.requests.shift().respond(200, null, '');
      buffered = videojs.createTimeRanges([[0, 10]]);

      this.updateend();

      assert.equal(bandwidthupdates, 0, 'did not trigger bandwidthupdate');
      assert.equal(endOfStreams, 0, 'did not trigger trigger ended');
    });

    QUnit.test('live playlists do not trigger ended', async function(assert) {
      await setupMediaSource(loader.mediaSource_, loader.sourceUpdater_);
      let endOfStreams = 0;
      let playlist = playlistWithDuration(10);

      loader.on('ended', () => endOfStreams++);

      playlist.endList = false;
      loader.playlist(playlist);
      loader.load();
      this.clock.tick(1);

      standardXHRResponse(this.requests.shift(), muxedSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });
      this.clock.tick(1);

      assert.equal(endOfStreams, 0, 'did not trigger ended');
    });

    QUnit.test('saves segment info to new segment after playlist refresh',
    async function(assert) {
      await setupMediaSource(loader.mediaSource_, loader.sourceUpdater_);
      let playlist = playlistWithDuration(40);

      playlist.endList = false;

      loader.playlist(playlist);
      loader.load();
      this.clock.tick(1);

      assert.equal(loader.state, 'WAITING', 'in waiting state');
      assert.equal(loader.pendingSegment_.uri, '0.ts', 'first segment pending');
      assert.equal(loader.pendingSegment_.segment.uri,
                   '0.ts',
                   'correct segment reference');

      // wrap up the first request to set mediaIndex and start normal live streaming
      standardXHRResponse(this.requests.shift(), muxedSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });
      this.clock.tick(1);

      assert.equal(loader.state, 'WAITING', 'in waiting state');
      assert.equal(loader.pendingSegment_.uri, '1.ts', 'second segment pending');
      assert.equal(loader.pendingSegment_.segment.uri,
                   '1.ts',
                   'correct segment reference');

      // playlist updated during waiting
      let playlistUpdated = playlistWithDuration(40);

      playlistUpdated.segments.shift();
      playlistUpdated.mediaSequence++;
      loader.playlist(playlistUpdated);

      assert.equal(loader.pendingSegment_.uri, '1.ts', 'second segment still pending');
      assert.equal(loader.pendingSegment_.segment.uri,
                   '1.ts',
                   'correct segment reference');

      standardXHRResponse(this.requests.shift(), muxedSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });

      assert.equal(
        playlistUpdated.segments[0].start, 0, 'set start on segment of new playlist');
      assert.ok(
        playlistUpdated.segments[0].end, 'set end on segment of new playlist');
      assert.notOk(
        playlist.segments[1].start, 'did not set start on segment of old playlist');
      assert.notOk(
        playlist.segments[1].end, 'did not set end on segment of old playlist');
    });

    QUnit.test(
      'saves segment info to old segment after playlist refresh if segment fell off',
    async function(assert) {
      await setupMediaSource(loader.mediaSource_, loader.sourceUpdater_);
      let playlist = playlistWithDuration(40);

      playlist.endList = false;

      loader.playlist(playlist);
      loader.load();
      this.clock.tick(1);

      assert.equal(loader.state, 'WAITING', 'in waiting state');
      assert.equal(loader.pendingSegment_.uri, '0.ts', 'first segment pending');
      assert.equal(loader.pendingSegment_.segment.uri,
                   '0.ts',
                   'correct segment reference');

      // wrap up the first request to set mediaIndex and start normal live streaming
      standardXHRResponse(this.requests.shift(), muxedSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });
      this.clock.tick(1);

      assert.equal(loader.state, 'WAITING', 'in waiting state');
      assert.equal(loader.pendingSegment_.uri, '1.ts', 'second segment pending');
      assert.equal(loader.pendingSegment_.segment.uri,
                   '1.ts',
                   'correct segment reference');

      // playlist updated during waiting
      let playlistUpdated = playlistWithDuration(40);

      playlistUpdated.segments.shift();
      playlistUpdated.segments.shift();
      playlistUpdated.mediaSequence += 2;
      loader.playlist(playlistUpdated);

      assert.equal(loader.pendingSegment_.uri, '1.ts', 'second segment still pending');
      assert.equal(loader.pendingSegment_.segment.uri,
                   '1.ts',
                   'correct segment reference');

      standardXHRResponse(this.requests.shift(), muxedSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });

      assert.equal(playlist.segments[1].start, 0, 'set start on segment of old playlist');
      assert.ok(playlist.segments[1].end, 'set end on segment of old playlist');
      assert.notOk(
        playlistUpdated.segments[0].start,
        'no start info for first segment of new playlist');
      assert.notOk(
        playlistUpdated.segments[0].end,
        'no end info for first segment of new playlist');
    });

    QUnit.test('errors when trying to switch from audio and video to audio only',
    async function(assert) {
      await setupMediaSource(loader.mediaSource_, loader.sourceUpdater_);
      const playlist = playlistWithDuration(40);
      const errors = [];

      loader.on('error', () => errors.push(loader.error()));

      loader.playlist(playlist);
      loader.load();
      this.clock.tick(1);

      standardXHRResponse(this.requests.shift(), muxedSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });
      this.clock.tick(1);

      assert.equal(errors.length, 0, 'no errors');

      standardXHRResponse(this.requests.shift(), audioSegment());

      assert.equal(errors.length, 1, 'one error');
      assert.equal(errors[0].message,
                   'Only audio found in segment when we expected video.' +
                   ' We can\'t switch to audio only from a stream that had video.' +
                   ' To get rid of this message, please add codec information to the' +
                   ' manifest.',
                   'correct error message');
    });

    QUnit.test('errors when trying to switch from audio only to audio and video',
    async function(assert) {
      await setupMediaSource(loader.mediaSource_, loader.sourceUpdater_);
      const playlist = playlistWithDuration(40);
      const errors = [];

      loader.on('error', () => errors.push(loader.error()));

      loader.playlist(playlist);
      loader.load();
      this.clock.tick(1);

      standardXHRResponse(this.requests.shift(), audioSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });
      this.clock.tick(1);

      assert.equal(errors.length, 0, 'no errors');

      standardXHRResponse(this.requests.shift(), muxedSegment());

      assert.equal(errors.length, 1, 'one error');
      assert.equal(errors[0].message,
                   'Video found in segment when we expected only audio.' +
                   ' We can\'t switch to a stream with video from an audio only stream.' +
                   ' To get rid of this message, please add codec information to the' +
                   ' manifest.',
                   'correct error message');
    });

    QUnit.test('no error when not switching from audio and video',
    async function(assert) {
      await setupMediaSource(loader.mediaSource_, loader.sourceUpdater_);
      const playlist = playlistWithDuration(40);
      const errors = [];

      loader.on('error', () => errors.push(loader.error()));

      loader.playlist(playlist);
      loader.load();
      this.clock.tick(1);

      standardXHRResponse(this.requests.shift(), muxedSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });
      this.clock.tick(1);

      assert.equal(errors.length, 0, 'no errors');

      standardXHRResponse(this.requests.shift(), muxedSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });

      assert.equal(errors.length, 0, 'no errors');
    });

    QUnit.test('dispose cleans up transmuxer', async function(assert) {
      await setupMediaSource(loader.mediaSource_, loader.sourceUpdater_);
      loader.playlist(playlistWithDuration(20));

      const origTransmuxerTerminate =
        loader.transmuxer_.terminate.bind(loader.transmuxer_);
      let transmuxerTerminateCount = 0;
      const origSegmentTransmuxerDispose =
        segmentTransmuxer.dispose.bind(segmentTransmuxer);
      let segmentTransmuxerDisposeCalls = 0;

      loader.transmuxer_.terminate = () => {
        transmuxerTerminateCount++;
        origTransmuxerTerminate();
      };
      segmentTransmuxer.dispose = () => {
        origSegmentTransmuxerDispose();
        segmentTransmuxerDisposeCalls++;
      };

      loader.load();
      this.clock.tick(1);
      loader.dispose();

      assert.equal(transmuxerTerminateCount, 1, 'terminated transmuxer');
      assert.equal(segmentTransmuxerDisposeCalls, 1, 'disposed segment transmuxer');
    });

    QUnit.test('calling remove removes cues', async function(assert) {
      await setupMediaSource(loader.mediaSource_, loader.sourceUpdater_);
      const playlist = playlistWithDuration(40);

      loader.playlist(playlist);
      loader.load();
      this.clock.tick(1);

      // load a segment as we can't remove if nothing's been appended
      standardXHRResponse(this.requests.shift(), muxedSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });
      this.clock.tick(1);

      let removedCues = [];

      loader.inbandTextTracks_ = {
        CC1: {
          removeCue(cue) {
            removedCues.push(cue);
            this.cues.splice(this.cues.indexOf(cue), 1);
          },
          cues: [
            {startTime: 10, endTime: 20, text: 'delete me'},
            {startTime: 0, endTime: 2, text: 'save me'}
          ]
        }
      };

      loader.remove(3, 10);

      assert.strictEqual(
        loader.inbandTextTracks_.CC1.cues.length,
        1,
        'one cue remains after remove'
      );
      assert.strictEqual(
        removedCues[0].text,
        'delete me',
        'the cue that overlapped the remove region was removed'
      );
    });

    QUnit.test('calling remove handles absence of cues (null)', async function(assert) {
      await setupMediaSource(loader.mediaSource_, loader.sourceUpdater_);
      const playlist = playlistWithDuration(40);

      loader.playlist(playlist);
      loader.load();
      this.clock.tick(1);

      // load a segment as we can't remove if nothing's been appended
      standardXHRResponse(this.requests.shift(), muxedSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });
      this.clock.tick(1);

      loader.inbandTextTracks_ = {
        CC1: {
          cues: null
        }
      };

      // this call should not raise an exception
      loader.remove(3, 10);

      assert.strictEqual(loader.inbandTextTracks_.CC1.cues, null, 'cues are still null');
    });

    QUnit.test('only removes video when audio disabled', async function(assert) {
      await setupMediaSource(loader.mediaSource_, loader.sourceUpdater_);
      const playlist = playlistWithDuration(40);

      loader.playlist(playlist);
      loader.load();
      this.clock.tick(1);

      // load a segment as we can't remove if nothing's been appended
      standardXHRResponse(this.requests.shift(), muxedSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });
      this.clock.tick(1);

      loader.setAudio(false);

      let audioRemoves = [];
      let videoRemoves = [];

      loader.sourceUpdater_.removeAudio = (start, end) => {
        audioRemoves.push({start, end});
      };
      loader.sourceUpdater_.removeVideo = (start, end) => {
        videoRemoves.push({start, end});
      };

      loader.remove(3, 10);

      assert.equal(audioRemoves, 0, 'did not remove from audio buffer');
      assert.equal(videoRemoves.length, 1, 'removed from video buffer');
      assert.deepEqual(videoRemoves[0], {start: 3, end: 10}, 'removed the right range');
    });

    QUnit.test('triggers appenderror when append errors', async function(assert) {
      await setupMediaSource(loader.mediaSource_, loader.sourceUpdater_);
      const playlist = playlistWithDuration(40);

      loader.playlist(playlist);
      loader.load();
      this.clock.tick(1);

      const error = { message: 'this is an error' };

      // mocking in this case because it's hard to find a good append error that will
      // 1) work across browsers
      // 2) won't cause an error in the transmuxer first
      loader.sourceUpdater_.appendBuffer = (type, bytes, callback) => {
        callback(error);
      };

      standardXHRResponse(this.requests.shift(), muxedSegment());

      await new Promise((accept, reject) => {
        loader.on('appenderror', () => {
          assert.deepEqual(
            loader.error_, error,
            'loader triggered and saved the appenderror');
          accept();
        });
      });
    });

    QUnit.test('appends init segments initially', async function(assert) {
      await setupMediaSource(loader.mediaSource_, loader.sourceUpdater_);

      const origAppendToSourceBuffer = loader.appendToSourceBuffer_.bind(loader);
      const appends = [];

      loader.appendToSourceBuffer_ = (config) => {
        appends.push(config);
        origAppendToSourceBuffer(config);
      };

      loader.playlist(playlistWithDuration(20));
      loader.load();
      this.clock.tick(1);
      standardXHRResponse(this.requests.shift(), muxedSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });
      this.clock.tick(1);

      assert.equal(appends.length, 2, 'two appends');
      assert.equal(appends[0].type, 'video', 'appended to video buffer');
      assert.ok(appends[0].initSegment, 'appended video init segment');
      assert.equal(appends[1].type, 'audio', 'appended to audio buffer');
      assert.ok(appends[1].initSegment, 'appended audio init segment');
    });

    QUnit.test('does not append init segments after first', async function(assert) {
      await setupMediaSource(loader.mediaSource_, loader.sourceUpdater_);

      const origAppendToSourceBuffer = loader.appendToSourceBuffer_.bind(loader);
      const appends = [];

      loader.appendToSourceBuffer_ = (config) => {
        appends.push(config);
        origAppendToSourceBuffer(config);
      };

      loader.playlist(playlistWithDuration(20));
      loader.load();
      this.clock.tick(1);
      standardXHRResponse(this.requests.shift(), muxedSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });
      this.clock.tick(1);

      assert.equal(appends.length, 2, 'two appends');
      assert.equal(appends[0].type, 'video', 'appended to video buffer');
      assert.ok(appends[0].initSegment, 'appended video init segment');
      assert.equal(appends[1].type, 'audio', 'appended to audio buffer');
      assert.ok(appends[1].initSegment, 'appended audio init segment');

      standardXHRResponse(this.requests.shift(), muxedSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });
      this.clock.tick(1);

      assert.equal(appends.length, 4, 'two more appends');
      assert.equal(appends[2].type, 'video', 'appended to video buffer');
      assert.notOk(appends[2].initSegment, 'did not append video init segment');
      assert.equal(appends[3].type, 'audio', 'appended to audio buffer');
      assert.notOk(appends[3].initSegment, 'did not append audio init segment');
    });

    QUnit.test('does not re-append audio init segment when audio only',
    async function(assert) {
      await setupMediaSource(
        loader.mediaSource_, loader.sourceUpdater_, { isAudioOnly: true });

      const origAppendToSourceBuffer = loader.appendToSourceBuffer_.bind(loader);
      const appends = [];

      loader.appendToSourceBuffer_ = (config) => {
        appends.push(config);
        origAppendToSourceBuffer(config);
      };

      loader.playlist(playlistWithDuration(20));
      loader.load();
      this.clock.tick(1);
      standardXHRResponse(this.requests.shift(), audioSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });
      this.clock.tick(1);

      assert.equal(appends.length, 1, 'one append');
      assert.equal(appends[0].type, 'audio', 'appended to audio buffer');
      assert.ok(appends[0].initSegment, 'appended audio init segment');

      standardXHRResponse(this.requests.shift(), audioSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });
      this.clock.tick(1);

      assert.equal(appends.length, 2, 'one more append');
      assert.equal(appends[1].type, 'audio', 'appended to audio buffer');
      assert.notOk(appends[1].initSegment, 'did not append audio init segment');
    });

    QUnit.test('re-appends audio init segment on playlist changes',
    async function(assert) {
      await setupMediaSource(
        loader.mediaSource_, loader.sourceUpdater_, { isAudioOnly: true });

      const origAppendToSourceBuffer = loader.appendToSourceBuffer_.bind(loader);
      const appends = [];

      loader.appendToSourceBuffer_ = (config) => {
        appends.push(config);
        origAppendToSourceBuffer(config);
      };

      loader.playlist(playlistWithDuration(20));
      loader.load();
      this.clock.tick(1);
      standardXHRResponse(this.requests.shift(), audioSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });
      this.clock.tick(1);

      assert.equal(appends.length, 1, 'one append');
      assert.equal(appends[0].type, 'audio', 'appended to audio buffer');
      assert.ok(appends[0].initSegment, 'appended audio init segment');

      // new playlist for an audio only loader would mean an audio track change
      loader.playlist(playlistWithDuration(20, { uri: 'new-playlist.m3u8' }));
      // remove old aborted request
      this.requests.shift();
      // get the new request
      this.clock.tick(1);
      standardXHRResponse(this.requests.shift(), audioSegment());
      // since it's a sync request, wait for the syncinfoupdate event (we won't get the
      // appended event)
      await new Promise((accept, reject) => {
        loader.on('syncinfoupdate', accept);
      });
      this.clock.tick(1);

      assert.equal(appends.length, 2, 'one more appends');
      assert.equal(appends[1].type, 'audio', 'appended to audio buffer');
      assert.ok(appends[1].initSegment, 'appended audio init segment');
    });

    QUnit.test('re-appends video init segment on playlist changes', async function(assert) {
      await setupMediaSource(
        loader.mediaSource_, loader.sourceUpdater_, { isVideoOnly: true });

      const origAppendToSourceBuffer = loader.appendToSourceBuffer_.bind(loader);
      const appends = [];

      loader.appendToSourceBuffer_ = (config) => {
        appends.push(config);
        origAppendToSourceBuffer(config);
      };

      loader.playlist(playlistWithDuration(20));
      loader.load();
      this.clock.tick(1);
      standardXHRResponse(this.requests.shift(), videoSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });
      this.clock.tick(1);

      assert.equal(appends.length, 1, 'one append');
      assert.equal(appends[0].type, 'video', 'appended to video buffer');
      assert.ok(appends[0].initSegment, 'appended video init segment');

      loader.playlist(playlistWithDuration(20, { uri: 'new-playlist.m3u8' }));
      // remove old aborted request
      this.requests.shift();
      // get the new request
      this.clock.tick(1);
      standardXHRResponse(this.requests.shift(), videoSegment());
      // since it's a sync request, wait for the syncinfoupdate event (we won't get the
      // appended event)
      await new Promise((accept, reject) => {
        loader.on('syncinfoupdate', accept);
      });
      this.clock.tick(1);

      assert.equal(appends.length, 2, 'one more append');
      assert.equal(appends[1].type, 'video', 'appended to video buffer');
      assert.ok(appends[1].initSegment, 'appended video init segment');
    });

    QUnit.test('re-appends init segments on discontinuity', async function(assert) {
      await setupMediaSource(loader.mediaSource_, loader.sourceUpdater_);

      const origAppendToSourceBuffer = loader.appendToSourceBuffer_.bind(loader);
      const appends = [];

      loader.appendToSourceBuffer_ = (config) => {
        appends.push(config);
        origAppendToSourceBuffer(config);
      };

      loader.playlist(playlistWithDuration(20, { discontinuityStarts: [1] }));
      loader.load();
      this.clock.tick(1);
      standardXHRResponse(this.requests.shift(), muxedSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });
      this.clock.tick(1);

      assert.equal(appends.length, 2, 'two appends');
      assert.equal(appends[0].type, 'video', 'appended to video buffer');
      assert.ok(appends[0].initSegment, 'appended video init segment');
      assert.equal(appends[1].type, 'audio', 'appended to audio buffer');
      assert.ok(appends[1].initSegment, 'appended audio init segment');

      standardXHRResponse(this.requests.shift(), muxedSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });
      this.clock.tick(1);

      assert.equal(appends.length, 4, 'two more appends');
      assert.equal(appends[2].type, 'video', 'appended to video buffer');
      assert.ok(appends[2].initSegment, 'appended video init segment');
      assert.equal(appends[3].type, 'audio', 'appended to audio buffer');
      assert.ok(appends[3].initSegment, 'appended audio init segment');
    });

    QUnit.test('stores and reuses audio init segments from map tag',
    async function(assert) {
      loader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'audio',
        segmentMetadataTrack: this.segmentMetadataTrack
      }), {});

      await setupMediaSource(
        loader.mediaSource_, loader.sourceUpdater_, { isAudioOnly: true });

      const origAppendToSourceBuffer = loader.appendToSourceBuffer_.bind(loader);
      const appends = [];

      loader.appendToSourceBuffer_ = (config) => {
        appends.push(config);
        origAppendToSourceBuffer(config);
      };

      const playlist = playlistWithDuration(30);

      playlist.segments[0].map = {
        resolvedUri: 'init.mp4',
        byterange: { length: Infinity, offset: 0 }
      };
      // change the map tag as we won't re-append the init segment if it hasn't changed
      playlist.segments[1].map = {
        resolvedUri: 'init2.mp4',
        byterange: { length: 100, offset: 10 }
      };
      // reuse the initial map to see if it was cached
      playlist.segments[2].map = {
        resolvedUri: 'init.mp4',
        byterange: { length: Infinity, offset: 0 }
      };

      loader.playlist(playlist);
      loader.load();
      this.clock.tick(1);

      // init
      standardXHRResponse(this.requests.shift(), mp4AudioInitSegment());
      // segment
      standardXHRResponse(this.requests.shift(), mp4AudioSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });
      this.clock.tick(1);

      assert.equal(appends.length, 1, 'one append');
      assert.equal(appends[0].type, 'audio', 'appended to audio buffer');
      assert.ok(appends[0].initSegment, 'appended audio init segment');

      // init
      standardXHRResponse(this.requests.shift(), mp4AudioInitSegment());
      // segment
      standardXHRResponse(this.requests.shift(), mp4AudioSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });
      this.clock.tick(1);

      assert.equal(appends.length, 2, 'one more append');
      assert.equal(appends[1].type, 'audio', 'appended to audio buffer');
      assert.ok(appends[1].initSegment, 'appended audio init segment');
      assert.notEqual(
        appends[0].initSegment,
        appends[1].initSegment,
        'appended a different init segment');

      // no init segment request, as it should be the same (and cached) segment
      standardXHRResponse(this.requests.shift(), mp4AudioSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });

      assert.equal(appends.length, 3, 'one more append');
      assert.equal(appends[2].type, 'audio', 'appended to audio buffer');
      assert.ok(appends[2].initSegment, 'appended audio init segment');
      assert.equal(
        appends[0].initSegment,
        appends[2].initSegment,
        'reused the init segment');
    });

    QUnit.test('stores and reuses video init segments from map tag',
    async function(assert) {
      await setupMediaSource(
        loader.mediaSource_, loader.sourceUpdater_, { isVideoOnly: true });

      const origAppendToSourceBuffer = loader.appendToSourceBuffer_.bind(loader);
      const appends = [];

      loader.appendToSourceBuffer_ = (config) => {
        appends.push(config);
        origAppendToSourceBuffer(config);
      };

      const playlist = playlistWithDuration(30);

      playlist.segments[0].map = {
        resolvedUri: 'init.mp4',
        byterange: { length: Infinity, offset: 0 }
      };
      // change the map tag as we won't re-append the init segment if it hasn't changed
      playlist.segments[1].map = {
        resolvedUri: 'init2.mp4',
        byterange: { length: 100, offset: 10 }
      };
      // reuse the initial map to see if it was cached
      playlist.segments[2].map = {
        resolvedUri: 'init.mp4',
        byterange: { length: Infinity, offset: 0 }
      };

      loader.playlist(playlist);
      loader.load();
      this.clock.tick(1);

      // init
      standardXHRResponse(this.requests.shift(), mp4VideoInitSegment());
      // segment
      standardXHRResponse(this.requests.shift(), mp4VideoSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });
      this.clock.tick(1);

      assert.equal(appends.length, 1, 'one append');
      assert.equal(appends[0].type, 'video', 'appended to video buffer');
      assert.ok(appends[0].initSegment, 'appended video init segment');

      // init
      standardXHRResponse(this.requests.shift(), mp4VideoInitSegment());
      // segment
      standardXHRResponse(this.requests.shift(), mp4VideoSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });
      this.clock.tick(1);

      assert.equal(appends.length, 2, 'one more append');
      assert.equal(appends[1].type, 'video', 'appended to audio buffer');
      assert.ok(appends[1].initSegment, 'appended video init segment');
      assert.notEqual(
        appends[0].initSegment,
        appends[1].initSegment,
        'appended a different init segment');

      // no init segment request, as it should be the same (and cached) segment
      standardXHRResponse(this.requests.shift(), mp4VideoSegment());
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });

      assert.equal(appends.length, 3, 'one more append');
      assert.equal(appends[2].type, 'video', 'appended to video buffer');
      assert.ok(appends[2].initSegment, 'appended video init segment');
      assert.equal(
        appends[0].initSegment,
        appends[2].initSegment,
        'reused the init segment');
    });
  });
});

/* TODO
QUnit.module('SegmentLoader: FMP4', function(hooks) {
  hooks.beforeEach(LoaderCommonHooks.beforeEach);
  hooks.afterEach(LoaderCommonHooks.afterEach);

  LoaderCommonFactory(SegmentLoader, { loaderType: 'main' });

  // Tests specific to the main segment loader go in this module
  QUnit.module('Loader Main', function(nestedHooks) {
    let loader;

    nestedHooks.beforeEach(function(assert) {
      this.segmentMetadataTrack = new MockTextTrack();
      this.inbandTextTracks = {
        CC1: new MockTextTrack()
      };
      this.startTime = sinon.stub(mp4probe, 'startTime');
      this.mimeType = 'video/mp4';

      loader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'main',
        segmentMetadataTrack: this.segmentMetadataTrack,
        inbandTextTracks: this.inbandTextTracks
      }), {});

      // shim updateend trigger to be a noop if the loader has no media source
      this.updateend = function() {
        if (loader.mediaSource_) {
          loader.mediaSource_.sourceBuffers[0].trigger('updateend');
        }
      };
    });

    nestedHooks.afterEach(function(assert) {
      this.startTime.restore();
    });

    QUnit.skip('CaptionParser is handled as expected',
    function(assert) {
      let mockCaptionParserReset;
      let mockCaptionParserClear;
      let mockCaptionParserClearParsedCaptions;
      let originalCurrentTimeline;
      let originalPendingSegment;
      let segment;

      assert.ok(loader.captionParser_, 'there is a captions parser');

      mockCaptionParserReset = sinon.stub(loader.captionParser_, 'reset');
      mockCaptionParserClear = sinon.stub(loader.captionParser_, 'clearAllCaptions');
      mockCaptionParserClearParsedCaptions = sinon.stub(loader.captionParser_, 'clearParsedCaptions');

      loader.load();
      loader.playlist(playlistWithDuration(10, 'm4s'));
      assert.equal(this.requests.length, 0, 'have not made a request yet');

      loader.mimeType(this.mimeType);
      this.clock.tick(1);
      assert.equal(this.requests.length, 1, 'made a request');
      assert.equal(mockCaptionParserClear.callCount, 2, 'captions cleared on load and mimeType');

      // Simulate a rendition switch
      loader.resetEverything();
      assert.equal(mockCaptionParserClear.callCount, 3, 'captions cleared on rendition switch');

      // Simulate a discontinuity
      originalCurrentTimeline = loader.currentTimeline_;
      loader.currentTimeline_ = originalCurrentTimeline + 1;
      assert.equal(mockCaptionParserClear.callCount, 3, 'captions cleared on discontinuity');
      loader.currentTimeline_ = originalCurrentTimeline;

      // Add to the inband text track, then call remove
      this.inbandTextTracks.CC1.addCue({
        startTime: 1,
        endTime: 2,
        text: 'test'
      });
      loader.remove(0, 2);
      assert.equal(this.inbandTextTracks.CC1.cues.length, 0, 'all cues have been removed');

      // Check that captions are added to track when found in the segment
      // and then captionParser is cleared
      segment = {
        resolvedUri: '0.m4s',
        bytes: new Uint8Array([0, 0, 1]),
        map: {
          bytes: new Uint8Array([0, 0, 1])
        },
        endOfAllRequests: 0,
        fmp4Captions: [{
          startTime: 1,
          endTime: 2,
          text: 'test',
          stream: 'CC1'
        }],
        captionStreams: {
          CC1: true
        }
      };
      originalPendingSegment = loader.pendingSegment_;
      loader.pendingSegment_ = {
        segment,
        playlist: {
          syncInfo: null
        }
      };
      loader.processSegmentResponse_(segment);
      assert.ok(this.inbandTextTracks.CC1, 'text track created');
      assert.ok(this.inbandTextTracks.CC1.cues.length, 1, 'cue added');
      assert.equal(mockCaptionParserClearParsedCaptions.callCount, 1, 'captions cleared after adding to text track');
      loader.pendingSegment_ = originalPendingSegment;

      // Dispose the loader
      loader.dispose();
      assert.equal(mockCaptionParserReset.callCount, 1, 'CaptionParser reset');
    });
  });
});
*/
