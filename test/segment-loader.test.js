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
  standardXHRResponse
} from './test-helpers.js';
import {
  LoaderCommonHooks,
  LoaderCommonSettings,
  LoaderCommonFactory,
  setupMediaSource
} from './loader-common.js';
import {
  muxed as muxedSegment,
  audio as audioSegment,
  mp4Video as mp4VideoSegment,
  mp4VideoInit as mp4VideoInitSegment
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

    // TODO
    QUnit.skip('sets the timestampOffset on timeline change', async function(assert) {
      await setupMediaSource(
        loader.mediaSource_, loader.sourceUpdater_, { isVideoOnly: true });
      let playlist = playlistWithDuration(40);
      let buffered = videojs.createTimeRanges();
      let timestampOffsetEvents = 0;

      loader.on('timestampoffset', () => {
        timestampOffsetEvents++;
      });

      loader.buffered_ = () => buffered;

      playlist.discontinuityStarts = [2];
      playlist.segments[2].timeline = 1;
      loader.playlist(playlist);
      loader.load();
      this.clock.tick(1);

      // segment 0
      standardXHRResponse(this.requests.shift(), mp4VideoSegment());
      buffered = videojs.createTimeRanges([[0, 10]]);
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });
      this.clock.tick(1);

      assert.equal(timestampOffsetEvents, 1, 'timestamp-offset event was fired');

      // segment 1
      standardXHRResponse(this.requests.shift(), mp4VideoSegment());
      buffered = videojs.createTimeRanges([[10, 20]]);
      await new Promise((accept, reject) => {
        loader.on('appended', accept);
      });
      this.clock.tick(1);

      assert.equal(
        timestampOffsetEvents, 1, 'no additional timestamp-offset event was fired');

      // segment 2, discontinuity
      standardXHRResponse(this.requests.shift(), muxedSegment());
      assert.equal(timestampOffsetEvents, 2, 'timestamp-offset event was fired');
      assert.equal(loader.mediaSource_.sourceBuffers[0].timestampOffset,
                   10,
                   'set timestampOffset');
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

    // TODO
    QUnit.skip('adds cues with segment information to the segment-metadata track ' +
               'as they are buffered',
      function(assert) {
        const track = loader.segmentMetadataTrack_;
        const attributes = {
          BANDWIDTH: 3500000,
          RESOLUTION: '1920x1080',
          CODECS: 'mp4a.40.5,avc1.42001e'
        };
        let playlist = playlistWithDuration(50, {attributes});
        let probeResponse;
        let expectedCue;

        // loader.addSegmentMetadataCue_ = ogAddSegmentMetadataCue_;
        loader.syncController_.probeTsSegment_ = function(segmentInfo) {
          return probeResponse;
        };

        loader.playlist(playlist);
        loader.mimeType(this.mimeType);
        loader.load();
        this.clock.tick(1);

        assert.ok(!track.cues.length,
                  'segment-metadata track empty when no segments appended');

        // Start appending some segments
        probeResponse = { start: 0, end: 9.5 };
        this.requests[0].response = new Uint8Array(10).buffer;
        this.requests.shift().respond(200, null, '');
        this.updateend();
        this.clock.tick(1);
        expectedCue = {
          uri: '0.ts',
          timeline: 0,
          playlist: 'playlist.m3u8',
          start: 0,
          end: 9.5,
          bandwidth: 3500000,
          resolution: '1920x1080',
          codecs: 'mp4a.40.5,avc1.42001e',
          byteLength: 10
        };

        assert.equal(track.cues.length, 1, 'one cue added for segment');
        assert.deepEqual(track.cues[0].value, expectedCue,
          'added correct segment info to cue');

        probeResponse = { start: 9.56, end: 19.2 };
        this.requests[0].response = new Uint8Array(10).buffer;
        this.requests.shift().respond(200, null, '');
        this.updateend();
        this.clock.tick(1);
        expectedCue = {
          uri: '1.ts',
          timeline: 0,
          playlist: 'playlist.m3u8',
          start: 9.56,
          end: 19.2,
          bandwidth: 3500000,
          resolution: '1920x1080',
          codecs: 'mp4a.40.5,avc1.42001e',
          byteLength: 10
        };

        assert.equal(track.cues.length, 2, 'one cue added for segment');
        assert.deepEqual(track.cues[1].value, expectedCue,
          'added correct segment info to cue');

        probeResponse = { start: 19.24, end: 28.99 };
        this.requests[0].response = new Uint8Array(10).buffer;
        this.requests.shift().respond(200, null, '');
        this.updateend();
        this.clock.tick(1);
        expectedCue = {
          uri: '2.ts',
          timeline: 0,
          playlist: 'playlist.m3u8',
          start: 19.24,
          end: 28.99,
          bandwidth: 3500000,
          resolution: '1920x1080',
          codecs: 'mp4a.40.5,avc1.42001e',
          byteLength: 10
        };

        assert.equal(track.cues.length, 3, 'one cue added for segment');
        assert.deepEqual(track.cues[2].value, expectedCue,
          'added correct segment info to cue');

        // append overlapping segment, emmulating segment-loader fetching behavior on
        // rendtion switch
        probeResponse = { start: 19.21, end: 28.98 };
        this.requests[0].response = new Uint8Array(10).buffer;
        this.requests.shift().respond(200, null, '');
        this.updateend();
        this.clock.tick(1);
        expectedCue = {
          uri: '3.ts',
          timeline: 0,
          playlist: 'playlist.m3u8',
          start: 19.21,
          end: 28.98,
          bandwidth: 3500000,
          resolution: '1920x1080',
          codecs: 'mp4a.40.5,avc1.42001e',
          byteLength: 10
        };

        assert.equal(track.cues.length, 3, 'overlapped cue removed, new one added');
        assert.deepEqual(track.cues[2].value, expectedCue,
          'added correct segment info to cue');

        // does not add cue for invalid segment timing info
        probeResponse = { start: 30, end: void 0 };
        this.requests[0].response = new Uint8Array(10).buffer;
        this.requests.shift().respond(200, null, '');
        this.updateend();
        this.clock.tick(1);

        assert.equal(track.cues.length, 3, 'no cue added');

        // verify stats
        assert.equal(loader.mediaBytesTransferred, 50, '50 bytes');
        assert.equal(loader.mediaRequests, 5, '5 requests');
      });

    QUnit.test('translates caption events into WebVTT cues', async function(assert) {
      const timestampOffsetStub = sinon.stub(loader.sourceUpdater_, 'videoTimestampOffset');
      const textTrackStub = sinon.stub(loader.hls_.tech_, 'textTracks');
      const captions = [{
        startTime: 0,
        endTime: 1,
        text: 'text',
        stream: 'CC1'
      }];
      let addCueSpy;
      let segmentInfo;

      await setupMediaSource(loader.mediaSource_, loader.sourceUpdater_);
      let playlist = playlistWithDuration(20);

      loader.playlist(playlist);
      loader.load();

      this.clock.tick(1);

      // Setup the inbandTextTracks and tech textTracks
      loader.inbandTextTracks_ = {};
      textTrackStub.returns({
        getTrackById: () => null
      });
      addCueSpy = sinon.spy();
      sinon.stub(loader.hls_.tech_, 'addRemoteTextTrack')
        .returns({
          track: {
            addCue: addCueSpy
          }
        });

      // Pretend to have appended data
      segmentInfo = videojs.mergeOptions({}, loader.pendingSegment_);

      loader.pendingSegment_.hasAppendedData_ = true;
      timestampOffsetStub.returns(10);

      // This will be called on a caption event
      loader.handleCaptions_(segmentInfo, captions);

      assert.strictEqual(
        Object.keys(loader.inbandTextTracks_).length,
        1,
        'created one text track'
      );
      assert.strictEqual(addCueSpy.callCount, 1, 'created one cue');
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
