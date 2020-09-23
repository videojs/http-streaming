import QUnit from 'qunit';
import {
  default as SegmentLoader,
  illegalMediaSwitch,
  safeBackBufferTrimTime,
  timestampOffsetForSegment,
  shouldWaitForTimelineChange
} from '../src/segment-loader';
import segmentTransmuxer from '../src/segment-transmuxer';
import videojs from 'video.js';
import mp4probe from 'mux.js/lib/mp4/probe';
import {
  playlistWithDuration,
  standardXHRResponse,
  setupMediaSource,
  MockTextTrack
} from './test-helpers.js';
import {
  LoaderCommonHooks,
  LoaderCommonSettings,
  LoaderCommonFactory
} from './loader-common.js';
import {
  muxed as muxedSegment,
  oneSecond as oneSecondSegment,
  audio as audioSegment,
  video as videoSegment,
  mp4Video as mp4VideoSegment,
  mp4VideoInit as mp4VideoInitSegment,
  mp4Audio as mp4AudioSegment,
  mp4AudioInit as mp4AudioInitSegment,
  encrypted as encryptedSegment,
  encryptionKey,
  zeroLength as zeroLengthSegment
} from 'create-test-data!segments';
import sinon from 'sinon';
import { timeRangesEqual } from './custom-assertions.js';

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

  assert.notOk(
    illegalMediaSwitch('main', startingMedia, newSegmentMedia),
    'no error when muxed to muxed'
  );

  startingMedia = { hasAudio: true, hasVideo: true };
  newSegmentMedia = { hasAudio: false, hasVideo: false };
  assert.notOk(
    illegalMediaSwitch('audio', startingMedia, newSegmentMedia),
    'no error when not main loader type'
  );

  startingMedia = { hasAudio: true, hasVideo: false };
  newSegmentMedia = { hasAudio: true, hasVideo: false };
  assert.notOk(
    illegalMediaSwitch('main', startingMedia, newSegmentMedia),
    'no error when audio only to audio only'
  );

  startingMedia = { hasAudio: false, hasVideo: true };
  newSegmentMedia = { hasAudio: false, hasVideo: true };
  assert.notOk(
    illegalMediaSwitch('main', startingMedia, newSegmentMedia),
    'no error when video only to video only'
  );

  startingMedia = { hasAudio: false, hasVideo: true };
  newSegmentMedia = { hasAudio: true, hasVideo: true };
  assert.notOk(
    illegalMediaSwitch('main', startingMedia, newSegmentMedia),
    'no error when video only to muxed'
  );

  startingMedia = { hasAudio: true, hasVideo: true };
  newSegmentMedia = { hasAudio: false, hasVideo: false };
  assert.equal(
    illegalMediaSwitch('main', startingMedia, newSegmentMedia),
    'Neither audio nor video found in segment.',
    'error when neither audio nor video'
  );

  startingMedia = { hasAudio: true, hasVideo: false };
  newSegmentMedia = { hasAudio: false, hasVideo: false };
  assert.equal(
    illegalMediaSwitch('main', startingMedia, newSegmentMedia),
    'Neither audio nor video found in segment.',
    'error when audio only to neither audio nor video'
  );

  startingMedia = { hasAudio: false, hasVideo: true };
  newSegmentMedia = { hasAudio: false, hasVideo: false };
  assert.equal(
    illegalMediaSwitch('main', startingMedia, newSegmentMedia),
    'Neither audio nor video found in segment.',
    'error when video only to neither audio nor video'
  );

  startingMedia = { hasAudio: true, hasVideo: false };
  newSegmentMedia = { hasAudio: true, hasVideo: true };
  assert.equal(
    illegalMediaSwitch('main', startingMedia, newSegmentMedia),
    'Video found in segment when we expected only audio.' +
               ' We can\'t switch to a stream with video from an audio only stream.' +
               ' To get rid of this message, please add codec information to the' +
               ' manifest.',
    'error when audio only to muxed'
  );

  startingMedia = { hasAudio: true, hasVideo: true };
  newSegmentMedia = { hasAudio: true, hasVideo: false };
  assert.equal(
    illegalMediaSwitch('main', startingMedia, newSegmentMedia),
    'Only audio found in segment when we expected video.' +
               ' We can\'t switch to audio only from a stream that had video.' +
               ' To get rid of this message, please add codec information to the' +
               ' manifest.',
    'error when muxed to audio only'
  );

  startingMedia = { hasAudio: true, hasVideo: false };
  newSegmentMedia = { hasAudio: false, hasVideo: true };
  assert.equal(
    illegalMediaSwitch('main', startingMedia, newSegmentMedia),
    'Video found in segment when we expected only audio.' +
               ' We can\'t switch to a stream with video from an audio only stream.' +
               ' To get rid of this message, please add codec information to the' +
               ' manifest.',
    'error when audio only to video only'
  );

  startingMedia = { hasAudio: false, hasVideo: true };
  newSegmentMedia = { hasAudio: true, hasVideo: false };
  assert.equal(
    illegalMediaSwitch('main', startingMedia, newSegmentMedia),
    'Only audio found in segment when we expected video.' +
               ' We can\'t switch to audio only from a stream that had video.' +
               ' To get rid of this message, please add codec information to the' +
               ' manifest.',
    'error when video only to audio only'
  );
});

QUnit.module('timestampOffsetForSegment');

QUnit.test('returns startOfSegment when timeline changes and the buffer is empty', function(assert) {
  assert.equal(
    timestampOffsetForSegment({
      segmentTimeline: 1,
      currentTimeline: 0,
      startOfSegment: 3,
      buffered: videojs.createTimeRanges()
    }),
    3,
    'returned startOfSegment'
  );
});

QUnit.test('returns buffered end when timeline changes and there exists buffered content', function(assert) {
  assert.equal(
    timestampOffsetForSegment({
      segmentTimeline: 1,
      currentTimeline: 0,
      startOfSegment: 3,
      buffered: videojs.createTimeRanges([[1, 5], [7, 8]])
    }),
    8,
    'returned buffered end'
  );
});

QUnit.test('returns null when timeline does not change', function(assert) {
  assert.ok(
    timestampOffsetForSegment({
      segmentTimeline: 0,
      currentTimeline: 0,
      startOfSegment: 3,
      buffered: videojs.createTimeRanges([[1, 5], [7, 8]])
    }) === null,
    'returned null'
  );

  assert.ok(
    timestampOffsetForSegment({
      segmentTimeline: 1,
      currentTimeline: 1,
      startOfSegment: 3,
      buffered: videojs.createTimeRanges([[1, 5], [7, 8]])
    }) === null,
    'returned null'
  );
});

QUnit.test('returns value when overrideCheck is true', function(assert) {
  assert.equal(
    timestampOffsetForSegment({
      segmentTimeline: 0,
      currentTimeline: 0,
      startOfSegment: 3,
      buffered: videojs.createTimeRanges([[1, 5], [7, 8]]),
      overrideCheck: true
    }),
    8,
    'returned buffered end'
  );
});

QUnit.module('shouldWaitForTimelineChange');

QUnit.test('should not wait if timelines are the same', function(assert) {
  assert.notOk(
    shouldWaitForTimelineChange({ currentTimeline: 1, segmentTimeline: 1 }),
    'should not wait'
  );
});

QUnit.test('audio loader waits if no main timeline change', function(assert) {
  assert.ok(
    shouldWaitForTimelineChange({
      currentTimeline: 1,
      segmentTimeline: 2,
      loaderType: 'audio',
      timelineChangeController: {
        lastTimelineChange({ type }) {
          return void 0;
        }
      }
    }),
    'should wait'
  );
});

QUnit.test('audio loader waits if last main timeline change not on audio segment\'s timeline', function(assert) {
  assert.ok(
    shouldWaitForTimelineChange({
      currentTimeline: 1,
      segmentTimeline: 2,
      loaderType: 'audio',
      timelineChangeController: {
        lastTimelineChange({ type }) {
          if (type === 'main') {
            return { from: 0, to: 1 };
          }
        }
      }
    }),
    'should wait'
  );
});

QUnit.test('audio loader does not wait if last main timeline matches audio segment\'s timeline', function(assert) {
  assert.notOk(
    shouldWaitForTimelineChange({
      currentTimeline: 1,
      segmentTimeline: 2,
      loaderType: 'audio',
      timelineChangeController: {
        lastTimelineChange({ type }) {
          if (type === 'main') {
            return { from: 1, to: 2 };
          }
        }
      }
    }),
    'should not wait'
  );
});

QUnit.test('audio loader does not wait if last main timeline matches audio segment\'s timeline', function(assert) {
  assert.notOk(
    shouldWaitForTimelineChange({
      currentTimeline: 1,
      segmentTimeline: 2,
      loaderType: 'audio',
      timelineChangeController: {
        lastTimelineChange({ type }) {
          if (type === 'main') {
            return { from: 1, to: 2 };
          }
        }
      }
    }),
    'should not wait'
  );
});

QUnit.test('main loader does not wait if audio enabled', function(assert) {
  assert.notOk(
    shouldWaitForTimelineChange({
      currentTimeline: 1,
      segmentTimeline: 2,
      loaderType: 'main'
    }),
    'should not wait'
  );
});

QUnit.test('main loader does not wait if no audio timeline change', function(assert) {
  assert.notOk(
    shouldWaitForTimelineChange({
      currentTimeline: 1,
      segmentTimeline: 2,
      loaderType: 'main',
      timelineChangeController: {
        lastTimelineChange({ type }) {
          return void 0;
        }
      }
    }),
    'should not wait'
  );
});

QUnit.test('main loader waits if no pending audio timeline change', function(assert) {
  assert.notOk(
    shouldWaitForTimelineChange({
      currentTimeline: 1,
      segmentTimeline: 2,
      loaderType: 'main',
      timelineChangeController: {
        pendingTimelineChange({ type }) {
          return void 0;
        },
        lastTimelineChange({ type }) {
          return void 0;
        }
      }
    }),
    'should wait'
  );
});

QUnit.test('main loader waits if pending audio timeline change doesn\'t match segment timeline', function(assert) {
  assert.notOk(
    shouldWaitForTimelineChange({
      currentTimeline: 1,
      segmentTimeline: 2,
      loaderType: 'main',
      timelineChangeController: {
        pendingTimelineChange({ type }) {
          if (type === 'audio') {
            return { from: 0, to: 1 };
          }
        },
        lastTimelineChange({ type }) {
          return void 0;
        }
      }
    }),
    'should wait'
  );
});

QUnit.test('main loader does not wait if pending audio timeline change matches segment timeline', function(assert) {
  assert.notOk(
    shouldWaitForTimelineChange({
      currentTimeline: 1,
      segmentTimeline: 2,
      loaderType: 'main',
      timelineChangeController: {
        pendingTimelineChange({ type }) {
          if (type === 'audio') {
            return { from: 1, to: 2 };
          }
        },
        lastTimelineChange({ type }) {
          return void 0;
        }
      }
    }),
    'should not wait'
  );
});

QUnit.module('safeBackBufferTrimTime');

QUnit.test('uses 30s before playhead when seekable start is 0', function(assert) {
  const seekable = videojs.createTimeRanges([[0, 120]]);
  const targetDuration = 10;
  const currentTime = 70;

  assert.equal(
    safeBackBufferTrimTime(seekable, currentTime, targetDuration),
    40,
    'returned 30 seconds before playhead'
  );
});

QUnit.test('uses 30s before playhead when seekable start is earlier', function(assert) {
  const seekable = videojs.createTimeRanges([[30, 120]]);
  const targetDuration = 10;
  const currentTime = 70;

  assert.equal(
    safeBackBufferTrimTime(seekable, currentTime, targetDuration),
    40,
    'returned 30 seconds before playhead'
  );
});

QUnit.test('uses seekable start when within 30s of playhead', function(assert) {
  const seekable = videojs.createTimeRanges([[41, 120]]);
  const targetDuration = 10;
  const currentTime = 70;

  assert.equal(
    safeBackBufferTrimTime(seekable, currentTime, targetDuration),
    41,
    'returned 29 seconds before playhead'
  );
});

QUnit.test('uses target duration when seekable range is within target duration', function(assert) {
  let seekable = videojs.createTimeRanges([[0, 120]]);
  const targetDuration = 10;
  let currentTime = 9;

  assert.equal(
    safeBackBufferTrimTime(seekable, currentTime, targetDuration),
    -1,
    'returned 10 seconds before playhead'
  );

  seekable = videojs.createTimeRanges([[40, 120]]);
  currentTime = 41;

  assert.equal(
    safeBackBufferTrimTime(seekable, currentTime, targetDuration),
    31,
    'returned 10 seconds before playhead'
  );
});

QUnit.test('uses target duration when seekable range is after current time', function(assert) {
  const seekable = videojs.createTimeRanges([[110, 120]]);
  const targetDuration = 10;
  const currentTime = 80;

  assert.equal(
    safeBackBufferTrimTime(seekable, currentTime, targetDuration),
    70,
    'returned 10 seconds before playhead'
  );
});

QUnit.test('uses current time when seekable range is well before current time', function(assert) {
  const seekable = videojs.createTimeRanges([[10, 20]]);
  const targetDuration = 10;
  const currentTime = 140;

  assert.equal(
    safeBackBufferTrimTime(seekable, currentTime, targetDuration),
    110,
    'returned 30 seconds before playhead'
  );
});

QUnit.module('SegmentLoader', function(hooks) {
  hooks.beforeEach(LoaderCommonHooks.beforeEach);
  hooks.afterEach(LoaderCommonHooks.afterEach);

  LoaderCommonFactory({
    LoaderConstructor: SegmentLoader,
    loaderSettings: {loaderType: 'main'}
  });

  // Tests specific to the main segment loader go in this module
  QUnit.module('Main', function(nestedHooks) {
    let loader;

    nestedHooks.beforeEach(function(assert) {
      this.startTime = sinon.stub(mp4probe, 'startTime');
      loader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'main',
        segmentMetadataTrack: this.segmentMetadataTrack
      }), {});

      this.fakeMainTimelineChange = () => {
        // Fake the last timeline change for main so audio loader has enough info to
        // append the first segment.
        this.timelineChangeController.lastTimelineChange({
          type: 'main',
          from: -1,
          to: 0
        });
      };
    });

    nestedHooks.afterEach(function(assert) {
      this.startTime.restore();
      loader.dispose();
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

    QUnit.test('only appends one segment at a time', function(assert) {
      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {

        loader.playlist(playlistWithDuration(10));
        loader.load();
        this.clock.tick(1);

        // some time passes and a segment is received
        this.clock.tick(100);
        standardXHRResponse(this.requests.shift(), muxedSegment());

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.equal(this.requests.length, 0, 'only made one request');
      });
    });

    QUnit.test('updates timestamps when segments do not start at zero', function(assert) {
      const playlist = playlistWithDuration(10);

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_, {isVideoOnly: true}).then(() => {

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

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {

        assert.equal(loader.sourceUpdater_.videoTimestampOffset(), -11, 'set timestampOffset');
        assert.equal(
          playlist.segments[0].start,
          0,
          'segment start time not shifted by mp4 start time'
        );
        assert.equal(
          playlist.segments[0].end,
          10,
          'segment end time not shifted by mp4 start time'
        );
      });
    });

    QUnit.test('segmentKey will cache new encrypted keys with cacheEncryptionKeys true', function(assert) {
      loader.cacheEncryptionKeys_ = true;

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.playlist(playlistWithDuration(10, { isEncrypted: true }));
        loader.load();
        this.clock.tick(1);

        const keyCache = loader.keyCache_;
        const bytes = new Uint32Array([1, 2, 3, 4]);

        assert.strictEqual(Object.keys(keyCache).length, 0, 'no keys have been cached');

        const result = loader.segmentKey({resolvedUri: 'key.php', bytes});

        assert.deepEqual(result, {resolvedUri: 'key.php'}, 'gets by default');
        loader.segmentKey({resolvedUri: 'key.php', bytes}, true);
        assert.deepEqual(keyCache['key.php'].bytes, bytes, 'key has been cached');
      });
    });

    QUnit.test('segmentKey will not cache encrypted keys with cacheEncryptionKeys false', function(assert) {
      loader.cacheEncryptionKeys_ = false;

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.playlist(playlistWithDuration(10, { isEncrypted: true }));
        loader.load();
        this.clock.tick(1);

        const keyCache = loader.keyCache_;
        const bytes = new Uint32Array([1, 2, 3, 4]);

        assert.strictEqual(Object.keys(keyCache).length, 0, 'no keys have been cached');
        loader.segmentKey({resolvedUri: 'key.php', bytes}, true);

        assert.strictEqual(Object.keys(keyCache).length, 0, 'no keys have been cached');
      });
    });

    QUnit.test('new segment requests will use cached keys', function(assert) {
      loader.cacheEncryptionKeys_ = true;

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.playlist(playlistWithDuration(20, { isEncrypted: true }));

        // make the keys the same
        loader.playlist_.segments[1].key =
          videojs.mergeOptions({}, loader.playlist_.segments[0].key);
        // give 2nd key an iv
        loader.playlist_.segments[1].key.iv = new Uint32Array([0, 1, 2, 3]);

        loader.load();
        this.clock.tick(1);

        assert.strictEqual(this.requests.length, 2, 'one request');
        assert.strictEqual(this.requests[0].uri, '0-key.php', 'key request');
        assert.strictEqual(this.requests[1].uri, '0.ts', 'segment request');

        // key response
        standardXHRResponse(this.requests.shift(), encryptionKey());
        this.clock.tick(1);

        // segment
        standardXHRResponse(this.requests.shift(), encryptedSegment());
        this.clock.tick(1);

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.deepEqual(loader.keyCache_['0-key.php'], {
          resolvedUri: '0-key.php',
          bytes: new Uint32Array([609867320, 2355137646, 2410040447, 480344904])
        }, 'previous key was cached');

        this.clock.tick(1);
        assert.deepEqual(loader.pendingSegment_.segment.key, {
          resolvedUri: '0-key.php',
          uri: '0-key.php',
          iv: new Uint32Array([0, 1, 2, 3])
        }, 'used cached key for request and own initialization vector');

        assert.strictEqual(this.requests.length, 1, 'one request');
        assert.strictEqual(this.requests[0].uri, '1.ts', 'only segment request');
      });
    });

    QUnit.test('new segment request keys every time', function(assert) {
      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.playlist(playlistWithDuration(20, { isEncrypted: true }));

        loader.load();
        this.clock.tick(1);

        assert.strictEqual(this.requests.length, 2, 'one request');
        assert.strictEqual(this.requests[0].uri, '0-key.php', 'key request');
        assert.strictEqual(this.requests[1].uri, '0.ts', 'segment request');

        // key response
        standardXHRResponse(this.requests.shift(), encryptionKey());
        this.clock.tick(1);

        // segment
        standardXHRResponse(this.requests.shift(), encryptedSegment());
        this.clock.tick(1);

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.notOk(loader.keyCache_['0-key.php'], 'not cached');

        assert.deepEqual(loader.pendingSegment_.segment.key, {
          resolvedUri: '1-key.php',
          uri: '1-key.php'
        }, 'used cached key for request and own initialization vector');

        assert.strictEqual(this.requests.length, 2, 'two requests');
        assert.strictEqual(this.requests[0].uri, '1-key.php', 'key request');
        assert.strictEqual(this.requests[1].uri, '1.ts', 'segment request');
      });
    });

    QUnit.test('triggers syncinfoupdate before attempting a resync', function(assert) {
      let syncInfoUpdates = 0;

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
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

        standardXHRResponse(this.requests.shift(), oneSecondSegment());
        // the appended event will not fire, as segment-loader will realize that its guess
        // was off and will reset everything to load at the new point, therefore, wait for
        // the syncinfoupdate event rather than the appended event
        return new Promise((resolve, reject) => {
          loader.one('syncinfoupdate', resolve);
          loader.one('error', reject);
        });
      }).then(() => {

        this.clock.tick(1);

        assert.equal(loader.mediaIndex, null, 'mediaIndex reset by seek to seekable');
        assert.equal(syncInfoUpdates, 1, 'syncinfoupdate was triggered');
      });
    });

    // This test case used to test that we didn't stop all segment processing (including
    // transmuxing), however, that case has changed, such that segment processing will
    // not stop during appends, but will stop if in the middle of processing.
    QUnit.test('abort does not cancel segment appends in progress', function(assert) {
      const done = assert.async();

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.playlist(playlistWithDuration(20));
        loader.load();
        this.clock.tick(1);

        standardXHRResponse(this.requests.shift(), muxedSegment());

        loader.one('appending', () => {
          loader.abort();
          this.clock.tick(1);
          assert.equal(loader.state, 'APPENDING', 'still appending');
          done();

        });
      });
    });

    QUnit.test('appendsdone happens after appends complete', function(assert) {
      const done = assert.async();

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.playlist(playlistWithDuration(20));
        loader.load();
        this.clock.tick(1);

        standardXHRResponse(this.requests.shift(), muxedSegment());
        loader.one('appendsdone', () => {
          assert.ok(true, 'appendsdone triggered');
          done();
        });
      });
    });

    QUnit.test('appendsdone does not happen after abort during append', function(assert) {
      const done = assert.async();

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        let appendsdone = false;

        loader.playlist(playlistWithDuration(20));
        loader.load();
        this.clock.tick(1);

        standardXHRResponse(this.requests.shift(), muxedSegment());
        loader.one('appendsdone', () => {
          appendsdone = true;
        });

        let appends = 0;

        const finish = function() {
          appends++;

          if (appends < 2) {
            return;
          }

          assert.notOk(appendsdone, 'appendsdone not triggered');
          done();
        };

        loader.one('appending', () => {
          loader.abort();
          loader.sourceUpdater_.videoQueueCallback(finish);
          loader.sourceUpdater_.audioQueueCallback(finish);
        });
      });
    });

    QUnit.test('audio loader waits to request segment until it has enough info', function(assert) {
      loader.dispose();
      loader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'audio'
      }), {});

      // Second segment will involve the test, as that will have a timeline change for
      // audio before the main loader has reached the change itself.
      this.fakeMainTimelineChange();

      const playlist = playlistWithDuration(20);

      playlist.discontinuityStarts = [1];
      playlist.segments[1].timeline = 1;

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        // segment 0
        standardXHRResponse(this.requests.shift(), audioSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(loader.state, 'WAITING', 'state is waiting on segment');
        assert.equal(this.requests.length, 0, 'no requests because not enough info to load');
        assert.equal(loader.loadQueue_.length, 1, 'one entry in load queue');
      });
    });

    QUnit.test('audio loader does not wait to request segment even if timestamp offset is nonzero', function(assert) {
      loader.dispose();
      loader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'audio'
      }), {});

      const playlist = playlistWithDuration(100);

      // The normal case this test represents is live, but seeking before start also
      // represents the same (and a valid) case.
      loader.currentTime_ = () => 70;

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        assert.equal(
          loader.pendingSegment_.timestampOffset,
          60,
          'timestamp offset is nonzero'
        );
        assert.equal(loader.state, 'WAITING', 'state is waiting on segment');
        assert.equal(this.requests.length, 1, 'one request');
        assert.equal(loader.loadQueue_.length, 0, 'no entries in load queue');
      });
    });

    // In the event that the loader doesn't have enough info to load, the segment request
    // will be part of the load queue until there's enough info. This test ensures that
    // these calls can be successfully aborted.
    QUnit.test('abort works when waiting to load', function(assert) {
      loader.dispose();
      loader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'audio'
      }), {});

      // Second segment will involve the test, as that will have a timeline change for
      // audio before the main loader has reached the change itself.
      this.fakeMainTimelineChange();

      const playlist = playlistWithDuration(20);

      playlist.discontinuityStarts = [1];
      playlist.segments[1].timeline = 1;

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        // segment 0
        standardXHRResponse(this.requests.shift(), audioSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(loader.state, 'WAITING', 'state is waiting on segment');
        assert.equal(this.requests.length, 0, 'no requests because not enough info to load');
        assert.equal(loader.loadQueue_.length, 1, 'one entry in load queue');

        loader.abort();
        assert.equal(loader.state, 'READY', 'aborted load');
        assert.equal(loader.loadQueue_.length, 0, 'cleared load queue');
      });
    });

    QUnit.test('processLoadQueue processes the load queue', function(assert) {
      loader.dispose();
      loader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'audio'
      }), {});

      // Second segment will involve the test, as that will have a timeline change for
      // audio before the main loader has reached the change itself.
      this.fakeMainTimelineChange();

      const playlist = playlistWithDuration(20);

      playlist.discontinuityStarts = [1];
      playlist.segments[1].timeline = 1;

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        // segment 0
        standardXHRResponse(this.requests.shift(), audioSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(loader.state, 'WAITING', 'state is waiting on segment');
        assert.equal(this.requests.length, 0, 'no requests because not enough info to load');
        assert.equal(loader.loadQueue_.length, 1, 'one entry in load queue');

        loader.processLoadQueue_();

        assert.equal(loader.state, 'WAITING', 'state is waiting on segment');
        assert.equal(this.requests.length, 1, 'made a request');
        assert.equal(loader.loadQueue_.length, 0, 'load queue is empty');
      });
    });

    QUnit.test('audio loader checks to process load queue on timeline change', function(assert) {
      loader.dispose();
      loader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'audio'
      }), {});

      // Second segment will involve the test, as that will have a timeline change for
      // audio before the main loader has reached the change itself.
      this.fakeMainTimelineChange();

      const playlist = playlistWithDuration(20);

      playlist.discontinuityStarts = [1];
      playlist.segments[1].timeline = 1;

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        // segment 0
        standardXHRResponse(this.requests.shift(), audioSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(loader.state, 'WAITING', 'state is waiting on segment');
        assert.equal(
          this.requests.length,
          0,
          'no requests because not enough info to load'
        );
        assert.equal(loader.loadQueue_.length, 1, 'one entry in load queue');

        this.timelineChangeController.lastTimelineChange({
          type: 'main',
          from: 0,
          to: 1
        });

        assert.equal(loader.state, 'WAITING', 'state is waiting on segment');
        assert.equal(this.requests.length, 1, 'made a request');
        assert.equal(
          loader.loadQueue_.length,
          0,
          'load queue is empty after main timeline caught up'
        );
      });
    });

    QUnit.test('audio loader checks to process append queue on timeline change', function(assert) {
      const done = assert.async();

      assert.expect(3);
      loader.dispose();
      loader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'audio'
      }), {});

      let ranFinish = false;

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        const origFinish = loader.segmentRequestFinished_.bind(loader);

        // Although overriding the internal function isn't the cleanest way to test, it's
        // difficult to try to catch the moment where the segment is finished and in the
        // queue, but not yet processed and appending.
        loader.segmentRequestFinished_ = (error, simpleSegment, result) => {
          origFinish(error, simpleSegment, result);

          // call queue should have an entry for this function, but only want to run
          // through this logic once
          if (ranFinish) {
            return;
          }

          ranFinish = true;

          // segment request finished, but the loader is waiting on main to have a
          // timeline change
          assert.equal(loader.state, 'WAITING', 'state is waiting');

          // the timeline change should trigger an append
          loader.on('appending', () => {
            done();
          });

          this.timelineChangeController.lastTimelineChange({
            type: 'main',
            from: -1,
            to: 0
          });
        };

        loader.playlist(playlistWithDuration(20));
        loader.load();
        this.clock.tick(1);
        // segment 0
        standardXHRResponse(this.requests.shift(), audioSegment());
      });
    });

    QUnit.test('main loader checks to process append queue on timeline change', function(assert) {
      const done = assert.async();

      assert.expect(3);

      let ranFinish = false;

      const playlist = playlistWithDuration(20);

      // add a discontinuity so that the main loader will wait for audio to append before
      // changing timelines
      playlist.discontinuityStarts = [1];
      playlist.segments[1].timeline = 1;

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.playlist(playlist);
        // demuxed
        loader.setAudio(false);
        loader.load();
        this.clock.tick(1);

        // Main loader won't load the first segment until the audio loader is ready to
        // load the first segment.
        this.timelineChangeController.pendingTimelineChange({
          type: 'audio',
          from: -1,
          to: 0
        });

        // segment 0
        standardXHRResponse(this.requests.shift(), videoSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        const origFinish = loader.segmentRequestFinished_.bind(loader);

        // Although overriding the internal function isn't the cleanest way to test, it's
        // difficult to try to catch the moment where the segment is finished and in the
        // queue, but not yet processed and appending.
        loader.segmentRequestFinished_ = (error, simpleSegment, result) => {
          origFinish(error, simpleSegment, result);

          // call queue should have an entry for this function, but only want to run
          // through this logic once
          if (ranFinish) {
            return;
          }

          ranFinish = true;

          assert.equal(loader.state, 'WAITING', 'state is waiting on segment');

          // the timeline change should trigger an append
          loader.on('appending', () => {
            done();
          });

          this.timelineChangeController.pendingTimelineChange({
            type: 'audio',
            from: 0,
            to: 1
          });
        };

        this.clock.tick(1);
        // segment 1
        standardXHRResponse(this.requests.shift(), videoSegment());
      });
    });

    QUnit.test('main loader updates main and audio timeline changes on appends when muxed', function(assert) {
      const playlist = playlistWithDuration(20);

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        assert.deepEqual(
          this.timelineChangeController.pendingTimelineChange({ type: 'main' }),
          {
            type: 'main',
            from: -1,
            to: 0
          },
          'added pending timeline change for main'
        );
        assert.notOk(
          this.timelineChangeController.lastTimelineChange({ type: 'audio' }),
          'no timeline change for audio yet'
        );
        assert.notOk(
          this.timelineChangeController.lastTimelineChange({ type: 'main' }),
          'no timeline change for main yet'
        );

        // segment 0
        standardXHRResponse(this.requests.shift(), videoSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.deepEqual(
          this.timelineChangeController.lastTimelineChange({ type: 'main' }),
          {
            type: 'main',
            from: -1,
            to: 0
          },
          'added last timeline change for main'
        );
        // main loader, when content is muxed, will update both the main and audio
        // timeline changes
        assert.deepEqual(
          this.timelineChangeController.lastTimelineChange({ type: 'audio' }),
          {
            type: 'audio',
            from: -1,
            to: 0
          },
          'added last timeline change for audio'
        );
      });
    });

    QUnit.test('main loader updates only main timeline changes on appends when demuxed', function(assert) {
      const playlist = playlistWithDuration(20);

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.playlist(playlist);
        // demuxed
        loader.setAudio(false);
        loader.load();
        this.clock.tick(1);

        assert.deepEqual(
          this.timelineChangeController.pendingTimelineChange({ type: 'main' }),
          {
            type: 'main',
            from: -1,
            to: 0
          },
          'added pending timeline change for main'
        );

        // Main loader won't load the first segment until the audio loader is ready to
        // load the first segment.
        this.timelineChangeController.pendingTimelineChange({
          type: 'audio',
          from: -1,
          to: 0
        });
        assert.notOk(
          this.timelineChangeController.lastTimelineChange({ type: 'audio' }),
          'no timeline change for audio yet'
        );
        assert.notOk(
          this.timelineChangeController.lastTimelineChange({ type: 'main' }),
          'no timeline change for main yet'
        );

        // segment 0
        standardXHRResponse(this.requests.shift(), videoSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.deepEqual(
          this.timelineChangeController.lastTimelineChange({ type: 'main' }),
          {
            type: 'main',
            from: -1,
            to: 0
          },
          'added last timeline change for main'
        );
        // main loader, when content is demuxed, will not update audio timeline changes
        assert.notOk(
          this.timelineChangeController.lastTimelineChange({ type: 'audio' }),
          'did not add last timeline change for audio'
        );
      });
    });

    QUnit.test('audio loader updates timeline changes on appends', function(assert) {
      loader.dispose();
      loader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'audio'
      }), {});

      this.fakeMainTimelineChange();

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.playlist(playlistWithDuration(20));
        loader.load();
        this.clock.tick(1);

        assert.deepEqual(
          this.timelineChangeController.pendingTimelineChange({ type: 'audio' }),
          {
            type: 'audio',
            from: -1,
            to: 0
          },
          'added pending timeline change for audio'
        );
        assert.notOk(
          this.timelineChangeController.lastTimelineChange({ type: 'audio' }),
          'no timeline change for audio yet'
        );

        // segment 0
        standardXHRResponse(this.requests.shift(), audioSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.deepEqual(
          this.timelineChangeController.lastTimelineChange({ type: 'audio' }),
          {
            type: 'audio',
            from: -1,
            to: 0
          },
          'added last timeline change for audio'
        );
      });
    });

    QUnit.test('sets the timestampOffset on timeline change', function(assert) {
      const setTimestampOffsetMessages = [];
      let timestampOffsetEvents = 0;
      let buffered = videojs.createTimeRanges();
      const playlist = playlistWithDuration(40);
      let videoSegmentStartTime = 3;
      let videoSegmentEndTime = 13;

      // timestampoffset events are triggered when the source buffer's timestamp offset is
      // set
      loader.on('timestampoffset', () => {
        timestampOffsetEvents++;
      });

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_, { isVideoOnly: true }).then(() => {

        // The transmuxer's timestamp offset is set at different times than the source
        // buffers' timestamp offsets. Since keepOriginalTimestamps is set to true, the
        // timestampOffset value in the transmuxer is used for content alignment
        // modifications, rather than changing time values to match a timeline.
        const origPostMessage = loader.transmuxer_.postMessage.bind(loader.transmuxer_);

        loader.transmuxer_.postMessage = (config) => {
          if (config.action === 'setTimestampOffset') {
            setTimestampOffsetMessages.push(config);
          }

          origPostMessage(config);
        };

        const origHandleTimingInfo = loader.handleTimingInfo_.bind(loader);

        // The source buffer timestamp offset is offset by the start of the segment. In
        // order to account for this, use a fixed value.
        loader.handleTimingInfo_ = (simpleSegment, mediaType, timeType, time) => {
          if (mediaType === 'video') {
            time = timeType === 'start' ? videoSegmentStartTime : videoSegmentEndTime;
          }
          origHandleTimingInfo(simpleSegment, mediaType, timeType, time);
        };

        loader.buffered_ = () => buffered;

        playlist.discontinuityStarts = [2];
        playlist.segments[2].timeline = 1;
        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        // segment 0
        standardXHRResponse(this.requests.shift(), videoSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {

        assert.equal(timestampOffsetEvents, 1, 'timestampoffset event was fired');
        assert.equal(
          loader.sourceUpdater_.videoBuffer.timestampOffset,
          0 - 3,
          'timestampoffset set on source buffer'
        );
        assert.equal(
          setTimestampOffsetMessages.length,
          0,
          'timestampoffset was not set in transmuxer'
        );

        buffered = videojs.createTimeRanges([[0, 10]]);
        playlist.segments[0].end = 10;
        // start request for segment 1
        this.clock.tick(1);

        assert.equal(timestampOffsetEvents, 1, 'timestampoffset event was not fired again');
        assert.equal(
          loader.sourceUpdater_.videoBuffer.timestampOffset,
          0 - 3,
          'timestampoffset not changed on source buffer'
        );
        // still at 0
        assert.equal(
          setTimestampOffsetMessages.length,
          0,
          'timestampoffset was not set in transmuxer'
        );

        // video start time changed for the next segment (1), but the timestamp offset on
        // the source buffer shouldn't change
        videoSegmentStartTime = 13;
        videoSegmentEndTime = 23;
        // segment 1
        standardXHRResponse(this.requests.shift(), videoSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.equal(timestampOffsetEvents, 1, 'timestampoffset event was not fired again');
        assert.equal(
          loader.sourceUpdater_.videoBuffer.timestampOffset,
          0 - 3,
          'timestampoffset not changed on source buffer'
        );
        assert.equal(
          setTimestampOffsetMessages.length,
          0,
          'timestampoffset was not set in transmuxer'
        );

        buffered = videojs.createTimeRanges([[10, 20]]);
        playlist.segments[1].end = 20;
        // start request for segment 2, which has a discontinuity (new timeline)
        this.clock.tick(1);

        assert.equal(timestampOffsetEvents, 1, 'timestampoffset event was not fired again');
        assert.equal(
          loader.sourceUpdater_.videoBuffer.timestampOffset,
          0 - 3,
          'timestampoffset not changed on source buffer'
        );
        assert.equal(
          setTimestampOffsetMessages.length,
          1,
          'timestampoffset was set in transmuxer'
        );
        assert.equal(
          setTimestampOffsetMessages[0].timestampOffset,
          20,
          'transmuxer timestampoffset set to 20'
        );

        videoSegmentStartTime = 101;
        videoSegmentEndTime = 111;
        // segment 2
        standardXHRResponse(this.requests.shift(), videoSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {

        assert.equal(timestampOffsetEvents, 2, 'timestampoffset event was fired');
        assert.equal(
          loader.sourceUpdater_.videoBuffer.timestampOffset,
          20 - 101,
          'timestampoffset changed on source buffer'
        );
        assert.equal(
          setTimestampOffsetMessages.length,
          1,
          'timestampoffset unchanged in transmuxer'
        );
      });
    });

    QUnit.test('saves segment timing info', function(assert) {
      const playlist = playlistWithDuration(20);
      const syncController = loader.syncController_;
      let saveSegmentTimingInfoCalls = 0;
      const origSaveSegmentTimingInfo =
        syncController.saveSegmentTimingInfo.bind(syncController);

      syncController.saveSegmentTimingInfo = ({
        segmentInfo,
        shouldSaveTimelineMapping
      }) => {
        saveSegmentTimingInfoCalls++;
        origSaveSegmentTimingInfo({ segmentInfo, shouldSaveTimelineMapping });
      };

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), muxedSegment());

        assert.equal(saveSegmentTimingInfoCalls, 0, 'no calls to save timing info');

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.equal(saveSegmentTimingInfoCalls, 1, 'called to save timing info');
      });
    });

    QUnit.test('main loader saves timeline mapping', function(assert) {
      const syncController = loader.syncController_;

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.playlist(playlistWithDuration(20));
        loader.load();
        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), muxedSegment());

        assert.notOk(syncController.mappingForTimeline(0), 'no mapping for timeline 0');

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.ok(syncController.mappingForTimeline(0), 'saved mapping for timeline 0');
      });
    });

    QUnit.test('audio loader doesn\'t save timeline mapping', function(assert) {
      loader.dispose();
      loader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'audio'
      }), {});

      this.fakeMainTimelineChange();

      const syncController = loader.syncController_;

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.playlist(playlistWithDuration(20));
        loader.load();
        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), audioSegment());

        assert.notOk(syncController.mappingForTimeline(0), 'no mapping for timeline 0');

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.notOk(syncController.mappingForTimeline(0), 'no mapping for timeline 0');
      });
    });

    QUnit.test('tracks segment end times as they are buffered', function(assert) {
      const playlist = playlistWithDuration(20);

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {

        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        assert.notOk(playlist.segments[0].end, 'does not start with duration');

        standardXHRResponse(this.requests.shift(), oneSecondSegment());

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.ok(playlist.segments[0].end, 'updated duration');
      });
    });

    QUnit.test('adds cues with segment information to the segment-metadata' +
               ' track as they are buffered', function(assert) {
      const addCueSpy = sinon.spy();

      loader.segmentMetadataTrack_ = {
        addCue: addCueSpy
      };

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {

        loader.playlist(playlistWithDuration(50));
        loader.load();

        this.clock.tick(1);

        // Respond with a segment, and wait until it is appended
        standardXHRResponse(this.requests.shift(), muxedSegment());

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.strictEqual(
          addCueSpy.callCount,
          1,
          'appending segment should have added a new cue to the segmentMetadataTrack'
        );
        this.clock.tick(1);

        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {

        assert.strictEqual(
          addCueSpy.callCount,
          2,
          'another append adds to segmentMetadataTrack'
        );
      });
    });

    QUnit.test('does not add cue for invalid segment timing info', function(assert) {
      const addCueSpy = sinon.spy();

      loader.segmentMetadataTrack_ = {
        addCue: addCueSpy
      };

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.playlist(playlistWithDuration(50));
        loader.load();

        this.clock.tick(1);

        // Respond with a segment, and wait until it is appended
        standardXHRResponse(this.requests.shift(), muxedSegment());

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.equal(addCueSpy.callCount, 1, 'cue added for appended segment');

        loader.addSegmentMetadataCue_({
          segment: {},
          start: 0,
          end: undefined
        });

        assert.equal(addCueSpy.callCount, 1, 'no cue added for invalid segment');
      });
    });

    QUnit.test('translates metadata events into WebVTT cues', function(assert) {
      const done = assert.async();
      const dispatchType = 0x10;
      const metadataCues = [{
        cueTime: 14,
        frames: [{
          data: 'This is a priv tag'
        }]
      }];
      const addCueSpy = sinon.spy();

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.inbandTextTracks_ = {};
        loader.playlist(playlistWithDuration(20));
        loader.load();
        // set the mediaSource duration as it is usually set by
        // master playlist controller, which is not present here
        loader.mediaSource_.duration = 20;

        this.clock.tick(1);

        // Mock text tracks and addRemoteTextTrack on the mock tech
        sinon.stub(loader.vhs_.tech_, 'addRemoteTextTrack')
          .returns({
            track: {
              addCue: addCueSpy
            }
          });

        standardXHRResponse(this.requests.shift(), muxedSegment());

        loader.on('appending', () => {
          // Simulate an id3Frame event happening that will call handleId3_
          loader.handleId3_(loader.pendingSegment_, metadataCues, dispatchType);
        });

        loader.on('appended', () => {
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
          done();
        });
      });
    });

    QUnit.test('translates caption events into WebVTT cues', function(assert) {
      const done = assert.async();
      const textTrackStub = sinon.stub(loader.vhs_.tech_, 'textTracks');
      const captions = [{
        startTime: 0,
        endTime: 1,
        text: 'text',
        stream: 'CC1'
      }];
      const addCueSpy = sinon.spy();

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.playlist(playlistWithDuration(20));
        loader.load();

        this.clock.tick(1);

        // Mock text tracks on the mock tech and setup the inbandTextTracks
        loader.inbandTextTracks_ = {};
        textTrackStub.returns({
          getTrackById: () => null
        });
        sinon.stub(loader.vhs_.tech_, 'addRemoteTextTrack')
          .returns({
            track: {
              addCue: addCueSpy
            }
          });

        standardXHRResponse(this.requests.shift(), muxedSegment());

        loader.on('appending', () => {
          // Simulate a caption event happening that will call handleCaptions_
          loader.handleCaptions_(loader.pendingSegment_, captions);
        });

        loader.on('appended', () => {
          assert.ok(
            Object.keys(loader.inbandTextTracks_.CC1),
            'created one text track with the caption stream as the id'
          );
          assert.strictEqual(addCueSpy.callCount, 1, 'created one cue');
          done();
        });
      });
    });

    QUnit.test('translates metadata events from audio-only stream into WebVTT cues', function(assert) {
      const done = assert.async();
      const textTrackStub = sinon.stub(loader.vhs_.tech_, 'textTracks');
      const metadata = [{
        cueTime: 12,
        frames: [{
          data: 'This is a priv tag'
        }]
      }];

      const addCueSpy = sinon.spy();

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.playlist(playlistWithDuration(20));
        loader.load();

        this.clock.tick(1);

        // Mock text tracks on the mock tech and setup the inbandTextTracks
        loader.inbandTextTracks_ = {};
        textTrackStub.returns({
          getTrackById: () => null
        });
        sinon.stub(loader.vhs_.tech_, 'addRemoteTextTrack')
          .returns({
            track: {
              addCue: addCueSpy
            }
          });

        standardXHRResponse(this.requests.shift(), audioSegment());

        loader.on('appending', () => {
          // Simulate a caption event happening that will call handleCaptions_
          const dispatchType = 0x10;

          loader.handleId3_(loader.pendingSegment_, metadata, dispatchType);
        });

        loader.on('appended', () => {

          assert.ok(Object.keys(loader.inbandTextTracks_.metadataTrack_), 'created a metadata track');
          assert.strictEqual(addCueSpy.callCount, 1, 'created one cue');

          assert.strictEqual(
            loader.inbandTextTracks_.metadataTrack_.inBandMetadataTrackDispatchType,
            16,
            'in-band metadata track dispatch type correctly set'
          );

          const cue = addCueSpy.getCall(0).args[0];

          assert.strictEqual(cue.value.data, 'This is a priv tag', 'included the text');
          done();
        });

      });
    });

    QUnit.test('fires ended at the end of a playlist', function(assert) {
      let endOfStreams = 0;

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.on('ended', () => endOfStreams++);
        loader.playlist(playlistWithDuration(10));
        loader.load();
        this.clock.tick(1);

        standardXHRResponse(this.requests.shift(), muxedSegment());

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(endOfStreams, 1, 'triggered ended');
      });
    });

    QUnit.test('endOfStream happens even after a rendition switch', function(assert) {
      let endOfStreams = 0;
      let bandwidthupdates = 0;

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
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
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(10);

        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.equal(bandwidthupdates, 1, 'triggered bandwidthupdate');
        assert.equal(endOfStreams, 1, 'triggered ended');
      });
    });

    QUnit.test('live playlists do not trigger ended', function(assert) {
      let endOfStreams = 0;

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        const playlist = playlistWithDuration(10);

        loader.on('ended', () => endOfStreams++);

        playlist.endList = false;
        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(endOfStreams, 0, 'did not trigger ended');
      });
    });

    QUnit.test('saves segment info to new segment after playlist refresh', function(assert) {
      // playlist updated during waiting
      const playlistUpdated = playlistWithDuration(40);
      const playlist = playlistWithDuration(40);

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {

        playlist.endList = false;

        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        assert.equal(loader.state, 'WAITING', 'in waiting state');
        assert.equal(loader.pendingSegment_.uri, '0.ts', 'first segment pending');
        assert.equal(
          loader.pendingSegment_.segment.uri,
          '0.ts',
          'correct segment reference'
        );

        // wrap up the first request to set mediaIndex and start normal live streaming
        standardXHRResponse(this.requests.shift(), oneSecondSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {

        this.clock.tick(1);

        assert.equal(loader.state, 'WAITING', 'in waiting state');
        assert.equal(loader.pendingSegment_.uri, '1.ts', 'second segment pending');
        assert.equal(
          loader.pendingSegment_.segment.uri,
          '1.ts',
          'correct segment reference'
        );

        playlistUpdated.segments.shift();
        playlistUpdated.mediaSequence++;
        loader.playlist(playlistUpdated);

        assert.equal(loader.pendingSegment_.uri, '1.ts', 'second segment still pending');
        assert.equal(
          loader.pendingSegment_.segment.uri,
          '1.ts',
          'correct segment reference'
        );

        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.equal(playlistUpdated.segments[0].start, 0.11072222222222239, 'set start on segment of new playlist');
        assert.ok(playlistUpdated.segments[0].end, 'set end on segment of new playlist');
        assert.notOk(playlist.segments[1].start, 'did not set start on segment of old playlist');
        assert.notOk(playlist.segments[1].end, 'did not set end on segment of old playlist');
      });
    });

    QUnit.test('saves segment info to old segment after playlist refresh if segment fell off', function(assert) {
      const playlist = playlistWithDuration(40);
      // playlist updated during waiting
      const playlistUpdated = playlistWithDuration(40);

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        playlist.endList = false;

        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        assert.equal(loader.state, 'WAITING', 'in waiting state');
        assert.equal(loader.pendingSegment_.uri, '0.ts', 'first segment pending');
        assert.equal(
          loader.pendingSegment_.segment.uri,
          '0.ts',
          'correct segment reference'
        );

        // wrap up the first request to set mediaIndex and start normal live streaming
        standardXHRResponse(this.requests.shift(), oneSecondSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(loader.state, 'WAITING', 'in waiting state');
        assert.equal(loader.pendingSegment_.uri, '1.ts', 'second segment pending');
        assert.equal(
          loader.pendingSegment_.segment.uri,
          '1.ts',
          'correct segment reference'
        );

        playlistUpdated.segments.shift();
        playlistUpdated.segments.shift();
        playlistUpdated.mediaSequence += 2;
        loader.playlist(playlistUpdated);

        assert.equal(loader.pendingSegment_.uri, '1.ts', 'second segment still pending');
        assert.equal(
          loader.pendingSegment_.segment.uri,
          '1.ts',
          'correct segment reference'
        );

        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.equal(playlist.segments[1].start, 0.11072222222222239, 'set start on segment of old playlist');
        assert.ok(playlist.segments[1].end, 'set end on segment of old playlist');
        assert.notOk(
          playlistUpdated.segments[0].start,
          'no start info for first segment of new playlist'
        );
        assert.notOk(
          playlistUpdated.segments[0].end,
          'no end info for first segment of new playlist'
        );
      });
    });

    QUnit.test('errors when trying to switch from audio and video to audio only', function(assert) {
      const errors = [];

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {

        const playlist = playlistWithDuration(40);

        loader.on('error', () => errors.push(loader.error()));

        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(errors.length, 0, 'no errors');

        standardXHRResponse(this.requests.shift(), audioSegment());

        assert.equal(errors.length, 1, 'one error');
        assert.equal(
          errors[0].message,
          'Only audio found in segment when we expected video.' +
          ' We can\'t switch to audio only from a stream that had video.' +
          ' To get rid of this message, please add codec information to the' +
          ' manifest.',
          'correct error message'
        );
      });
    });

    QUnit.test('errors when trying to switch from audio only to audio and video', function(assert) {
      const errors = [];

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {

        const playlist = playlistWithDuration(40);

        loader.on('error', () => errors.push(loader.error()));

        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        standardXHRResponse(this.requests.shift(), audioSegment());

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(errors.length, 0, 'no errors');

        standardXHRResponse(this.requests.shift(), muxedSegment());

        assert.equal(errors.length, 1, 'one error');
        assert.equal(
          errors[0].message,
          'Video found in segment when we expected only audio.' +
          ' We can\'t switch to a stream with video from an audio only stream.' +
          ' To get rid of this message, please add codec information to the' +
          ' manifest.',
          'correct error message'
        );
      });
    });

    QUnit.test('no error when not switching from audio and video', function(assert) {
      const errors = [];

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {

        const playlist = playlistWithDuration(40);

        loader.on('error', () => errors.push(loader.error()));

        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {

        this.clock.tick(1);

        assert.equal(errors.length, 0, 'no errors');

        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.equal(errors.length, 0, 'no errors');
      });
    });

    QUnit.test('dispose cleans up transmuxer', function(assert) {
      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
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
    });

    QUnit.test('calling remove removes cues', function(assert) {
      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {

        const playlist = playlistWithDuration(40);

        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        // load a segment as we can't remove if nothing's been appended
        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        const removedCues = [];

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

        loader.remove(10, 20);

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
    });

    QUnit.test('calling remove handles absence of cues (null)', function(assert) {
      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        const playlist = playlistWithDuration(40);

        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        // load a segment as we can't remove if nothing's been appended
        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
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
    });

    QUnit.test('only removes video when audio disabled', function(assert) {
      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {

        const playlist = playlistWithDuration(40);

        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        // load a segment as we can't remove if nothing's been appended
        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        loader.setAudio(false);

        const audioRemoves = [];
        const videoRemoves = [];

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

    QUnit.test('removes audio when audio disabled', function(assert) {
      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {

        const playlist = playlistWithDuration(40);

        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        // load a segment as we can't remove if nothing's been appended
        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        const audioRemoves = [];
        const videoRemoves = [];

        loader.sourceUpdater_.removeAudio = (start, end) => {
          audioRemoves.push({start, end});
        };
        loader.sourceUpdater_.removeVideo = (start, end) => {
          videoRemoves.push({start, end});
        };

        loader.setAudio(false);
        assert.equal(videoRemoves.length, 0, 'no video removes');
        assert.equal(audioRemoves.length, 1, 'removed audio from the buffer');
        assert.deepEqual(audioRemoves[0], {start: 0, end: loader.duration_()}, 'removed the right range');

      });
    });

    QUnit.test('triggers appenderror when append errors', function(assert) {

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        const playlist = playlistWithDuration(40);

        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        // mocking in this case because it's hard to find a good append error that will
        // 1) work across browsers
        // 2) won't cause an error in the transmuxer first
        loader.sourceUpdater_.appendBuffer = ({type, bytes}, callback) => {
          callback({type: 'error'});
        };

        standardXHRResponse(this.requests.shift(), muxedSegment());

        return new Promise((resolve, reject) => {
          loader.one('appenderror', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.deepEqual(
          loader.error_,
          'video append of 2960b failed for segment #0 in playlist playlist.m3u8',
          'loader triggered and saved the appenderror'
        );
      });
    });

    QUnit.test('appends init segments initially', function(assert) {
      const appends = [];

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        const origAppendToSourceBuffer = loader.appendToSourceBuffer_.bind(loader);

        loader.appendToSourceBuffer_ = (config) => {
          appends.push(config);
          origAppendToSourceBuffer(config);
        };

        loader.playlist(playlistWithDuration(20));
        loader.load();
        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), muxedSegment());

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(appends.length, 2, 'two appends');
        assert.equal(appends[0].type, 'video', 'appended to video buffer');
        assert.ok(appends[0].initSegment, 'appended video init segment');
        assert.equal(appends[1].type, 'audio', 'appended to audio buffer');
        assert.ok(appends[1].initSegment, 'appended audio init segment');
      });
    });

    QUnit.test('does not append init segments after first', function(assert) {
      const appends = [];

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        const origAppendToSourceBuffer = loader.appendToSourceBuffer_.bind(loader);

        loader.appendToSourceBuffer_ = (config) => {
          appends.push(config);
          origAppendToSourceBuffer(config);
        };

        loader.playlist(playlistWithDuration(20));
        loader.load();
        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {

        this.clock.tick(1);

        assert.equal(appends.length, 2, 'two appends');
        assert.equal(appends[0].type, 'video', 'appended to video buffer');
        assert.ok(appends[0].initSegment, 'appended video init segment');
        assert.equal(appends[1].type, 'audio', 'appended to audio buffer');
        assert.ok(appends[1].initSegment, 'appended audio init segment');

        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(appends.length, 4, 'two more appends');
        assert.equal(appends[2].type, 'video', 'appended to video buffer');
        assert.notOk(appends[2].initSegment, 'did not append video init segment');
        assert.equal(appends[3].type, 'audio', 'appended to audio buffer');
        assert.notOk(appends[3].initSegment, 'did not append audio init segment');
      });
    });

    QUnit.test('does not re-append audio init segment when audio only', function(assert) {
      const appends = [];

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_, { isAudioOnly: true }).then(() => {
        const origAppendToSourceBuffer = loader.appendToSourceBuffer_.bind(loader);

        loader.appendToSourceBuffer_ = (config) => {
          appends.push(config);
          origAppendToSourceBuffer(config);
        };

        loader.playlist(playlistWithDuration(20));
        loader.load();
        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), audioSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(appends.length, 1, 'one append');
        assert.equal(appends[0].type, 'audio', 'appended to audio buffer');
        assert.ok(appends[0].initSegment, 'appended audio init segment');

        standardXHRResponse(this.requests.shift(), audioSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(appends.length, 2, 'one more append');
        assert.equal(appends[1].type, 'audio', 'appended to audio buffer');
        assert.notOk(appends[1].initSegment, 'did not append audio init segment');
      });
    });

    QUnit.test('re-appends audio init segment on playlist changes', function(assert) {
      const appends = [];

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_, {isAudioOnly: true}).then(() => {
        const origAppendToSourceBuffer = loader.appendToSourceBuffer_.bind(loader);

        loader.appendToSourceBuffer_ = (config) => {
          appends.push(config);
          origAppendToSourceBuffer(config);
        };

        loader.playlist(playlistWithDuration(20));
        loader.load();
        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), audioSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {

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
        return new Promise((resolve, reject) => {
          loader.one('syncinfoupdate', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(appends.length, 2, 'one more appends');
        assert.equal(appends[1].type, 'audio', 'appended to audio buffer');
        assert.ok(appends[1].initSegment, 'appended audio init segment');
      });
    });

    QUnit.test('re-appends video init segment on playlist changes', function(assert) {
      const appends = [];

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_, {isVideoOnly: true}).then(() => {
        const origAppendToSourceBuffer = loader.appendToSourceBuffer_.bind(loader);

        loader.appendToSourceBuffer_ = (config) => {
          appends.push(config);
          origAppendToSourceBuffer(config);
        };

        loader.playlist(playlistWithDuration(20));
        loader.load();
        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), videoSegment());

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
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
        return new Promise((resolve, reject) => {
          loader.one('syncinfoupdate', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(appends.length, 2, 'one more append');
        assert.equal(appends[1].type, 'video', 'appended to video buffer');
        assert.ok(appends[1].initSegment, 'appended video init segment');
      });
    });

    QUnit.test('re-appends init segments on discontinuity', function(assert) {
      const appends = [];

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        const origAppendToSourceBuffer = loader.appendToSourceBuffer_.bind(loader);

        loader.appendToSourceBuffer_ = (config) => {
          appends.push(config);
          origAppendToSourceBuffer(config);
        };

        loader.playlist(playlistWithDuration(20, { discontinuityStarts: [1] }));
        loader.load();
        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {

        this.clock.tick(1);

        assert.equal(appends.length, 2, 'two appends');
        assert.equal(appends[0].type, 'video', 'appended to video buffer');
        assert.ok(appends[0].initSegment, 'appended video init segment');
        assert.equal(appends[1].type, 'audio', 'appended to audio buffer');
        assert.ok(appends[1].initSegment, 'appended audio init segment');

        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(appends.length, 4, 'two more appends');
        assert.equal(appends[2].type, 'video', 'appended to video buffer');
        assert.ok(appends[2].initSegment, 'appended video init segment');
        assert.equal(appends[3].type, 'audio', 'appended to audio buffer');
        assert.ok(appends[3].initSegment, 'appended audio init segment');
      });
    });

    QUnit.test('re-appends init segments after different trackinfo', function(assert) {
      const appends = [];
      const oldTrackInfo = loader.handleTrackInfo_;

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        const origAppendToSourceBuffer = loader.appendToSourceBuffer_.bind(loader);

        loader.appendToSourceBuffer_ = (config) => {
          appends.push(config);
          origAppendToSourceBuffer(config);
        };

        loader.playlist(playlistWithDuration(20));
        loader.load();
        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), muxedSegment());

        loader.handleTrackInfo_ = (simpleSegment, trackInfo) => {
          trackInfo.foo = true;
          return oldTrackInfo.call(loader, simpleSegment, trackInfo);
        };

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(appends.length, 2, 'two appends');
        assert.equal(appends[0].type, 'video', 'appended to video buffer');
        assert.ok(appends[0].initSegment, 'appended video init segment');
        assert.equal(appends[1].type, 'audio', 'appended to audio buffer');
        assert.ok(appends[1].initSegment, 'appended audio init segment');

        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(appends.length, 4, 'two more appends');
        assert.equal(appends[2].type, 'video', 'appended to video buffer');
        assert.ok(appends[2].initSegment, 'appended video init segment');
        assert.equal(appends[3].type, 'audio', 'appended to audio buffer');
        assert.ok(appends[3].initSegment, 'appended audio init segment');
      });
    });

    QUnit.test('stores and reuses audio init segments from map tag', function(assert) {
      loader.dispose();
      loader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'audio',
        segmentMetadataTrack: this.segmentMetadataTrack
      }), {});
      const appends = [];

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_, {isAudioOnly: true}).then(() => {
        const origAppendToSourceBuffer = loader.appendToSourceBuffer_.bind(loader);

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

        // The main loader has to be the first to load a segment, so fake a main timeline
        // change.
        this.timelineChangeController.lastTimelineChange({
          type: 'main',
          from: -1,
          to: 0
        });

        // init
        standardXHRResponse(this.requests.shift(), mp4AudioInitSegment());
        // segment
        standardXHRResponse(this.requests.shift(), mp4AudioSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(appends.length, 1, 'one append');
        assert.equal(appends[0].type, 'audio', 'appended to audio buffer');
        assert.ok(appends[0].initSegment, 'appended audio init segment');

        // init
        standardXHRResponse(this.requests.shift(), mp4AudioInitSegment());
        // segment
        standardXHRResponse(this.requests.shift(), mp4AudioSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(appends.length, 2, 'one more append');
        assert.equal(appends[1].type, 'audio', 'appended to audio buffer');
        assert.ok(appends[1].initSegment, 'appended audio init segment');
        assert.notEqual(
          appends[0].initSegment,
          appends[1].initSegment,
          'appended a different init segment'
        );

        // no init segment request, as it should be the same (and cached) segment
        standardXHRResponse(this.requests.shift(), mp4AudioSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {

        assert.equal(appends.length, 3, 'one more append');
        assert.equal(appends[2].type, 'audio', 'appended to audio buffer');
        assert.ok(appends[2].initSegment, 'appended audio init segment');
        assert.equal(
          appends[0].initSegment,
          appends[2].initSegment,
          'reused the init segment'
        );
      });
    });

    QUnit.test('stores and reuses video init segments from map tag', function(assert) {
      const appends = [];

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_, {isVideoOnly: true}).then(() => {
        const origAppendToSourceBuffer = loader.appendToSourceBuffer_.bind(loader);

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
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(appends.length, 1, 'one append');
        assert.equal(appends[0].type, 'video', 'appended to video buffer');
        assert.ok(appends[0].initSegment, 'appended video init segment');

        // init
        standardXHRResponse(this.requests.shift(), mp4VideoInitSegment());
        // segment
        standardXHRResponse(this.requests.shift(), mp4VideoSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(appends.length, 2, 'one more append');
        assert.equal(appends[1].type, 'video', 'appended to audio buffer');
        assert.ok(appends[1].initSegment, 'appended video init segment');
        assert.notEqual(
          appends[0].initSegment,
          appends[1].initSegment,
          'appended a different init segment'
        );

        // no init segment request, as it should be the same (and cached) segment
        standardXHRResponse(this.requests.shift(), mp4VideoSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {

        assert.equal(appends.length, 3, 'one more append');
        assert.equal(appends[2].type, 'video', 'appended to video buffer');
        assert.ok(appends[2].initSegment, 'appended video init segment');
        assert.equal(
          appends[0].initSegment,
          appends[2].initSegment,
          'reused the init segment'
        );
      });
    });

    QUnit.test('waits to set source buffer timestamp offsets if zero data segment', function(assert) {
      const appends = [];
      const audioTimestampOffsets = [];
      const videoTimestampOffsets = [];
      const transmuxerTimestampOffsets = [];
      const sourceUpdater = loader.sourceUpdater_;

      // Mock text tracks on the mock tech because the segment contains text track data
      loader.inbandTextTracks_ = {};
      loader.vhs_.tech_.addRemoteTextTrack = () => {
        return { track: { addCue: () => {} } };
      };

      return setupMediaSource(loader.mediaSource_, sourceUpdater).then(() => {
        const origAppendToSourceBuffer = loader.appendToSourceBuffer_.bind(loader);
        const origAudioTimestampOffset =
          sourceUpdater.audioTimestampOffset.bind(sourceUpdater);
        const origVideoTimestampOffset =
          sourceUpdater.videoTimestampOffset.bind(sourceUpdater);
        const origTransmuxerPostMessage =
          loader.transmuxer_.postMessage.bind(loader.transmuxer_);

        // Keep track of appends and changes in timestamp offset to verify the right
        // number of each were set.
        loader.appendToSourceBuffer_ = (config) => {
          appends.push(config);
          origAppendToSourceBuffer(config);
        };
        sourceUpdater.audioTimestampOffset = (offset) => {
          if (!offset) {
            return audioTimestampOffsets.length ?
              audioTimestampOffsets[audioTimestampOffsets.length - 1] : -1;
          }
          audioTimestampOffsets.push(offset);
          origAudioTimestampOffset(offset);
        };
        sourceUpdater.videoTimestampOffset = (offset) => {
          if (!offset) {
            return videoTimestampOffsets.length ?
              videoTimestampOffsets[videoTimestampOffsets.length - 1] : -1;
          }
          videoTimestampOffsets.push(offset);
          origVideoTimestampOffset(offset);
        };
        loader.transmuxer_.postMessage = (message) => {
          if (message.action === 'setTimestampOffset') {
            transmuxerTimestampOffsets.push(message.timestampOffset);
          }
          origTransmuxerPostMessage(message);
        };

        // Load the playlist and the zero length segment. Note that the zero length
        // segment is the first loaded segment, as it's an easy case for when a timestamp
        // offset should be set, except in this case, when the first segment has no audio
        // or video data.
        loader.playlist(playlistWithDuration(20));
        loader.load();
        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), zeroLengthSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.equal(appends.length, 0, 'zero appends');
        assert.equal(
          audioTimestampOffsets.length,
          0,
          'zero audio source buffer timestamp offsets'
        );
        assert.equal(
          videoTimestampOffsets.length,
          0,
          'zero video source buffer timestamp offsets'
        );
        // unlike the source buffer, which won't have data appended yet, the transmuxer
        // timestamp offset should be updated since there may be ID3 data or metadata
        assert.equal(
          transmuxerTimestampOffsets.length,
          1,
          'one transmuxer timestamp offset'
        );

        // Load the second segment, this time with audio and video data, and ensure that
        // after its append the timestamp offset values are set.
        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(appends.length, 2, 'two appends');
        assert.equal(
          audioTimestampOffsets.length,
          1,
          'one audio source buffer timestamp offset'
        );
        assert.equal(
          videoTimestampOffsets.length,
          1,
          'one video source buffer timestamp offset'
        );
        assert.equal(
          transmuxerTimestampOffsets.length,
          2,
          'another transmuxer timestamp offset'
        );
      });
    });

    QUnit.test('sets timestamp offset on timeline changes but not if segment start is early', function(assert) {
      const audioTimestampOffsets = [];
      const videoTimestampOffsets = [];
      const transmuxerTimestampOffsets = [];
      const sourceUpdater = loader.sourceUpdater_;
      let buffered = videojs.createTimeRanges();
      let timestampOffsetOverride;

      loader.buffered_ = () => buffered;

      return setupMediaSource(loader.mediaSource_, sourceUpdater).then(() => {
        const origAudioTimestampOffset =
          sourceUpdater.audioTimestampOffset.bind(sourceUpdater);
        const origVideoTimestampOffset =
          sourceUpdater.videoTimestampOffset.bind(sourceUpdater);
        const origTransmuxerPostMessage =
          loader.transmuxer_.postMessage.bind(loader.transmuxer_);

        // Keep track of timestamp offsets change to verify the right number were set.
        sourceUpdater.audioTimestampOffset = (offset) => {
          if (!offset) {
            if (timestampOffsetOverride) {
              return timestampOffsetOverride;
            }
            return audioTimestampOffsets.length ?
              audioTimestampOffsets[audioTimestampOffsets.length - 1] : -1;
          }
          audioTimestampOffsets.push(offset);
          origAudioTimestampOffset(offset);
        };
        sourceUpdater.videoTimestampOffset = (offset) => {
          if (!offset) {
            if (timestampOffsetOverride) {
              return timestampOffsetOverride;
            }
            return videoTimestampOffsets.length ?
              videoTimestampOffsets[videoTimestampOffsets.length - 1] : -1;
          }
          videoTimestampOffsets.push(offset);
          origVideoTimestampOffset(offset);
        };
        loader.transmuxer_.postMessage = (message) => {
          if (message.action === 'setTimestampOffset') {
            transmuxerTimestampOffsets.push(message.timestampOffset);
          }
          origTransmuxerPostMessage(message);
        };

        // Load the playlist and the first segment, as normal.
        loader.playlist(playlistWithDuration(20));
        loader.load();
        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.equal(
          audioTimestampOffsets.length,
          1,
          'one audio source buffer timestamp offset'
        );
        assert.equal(
          videoTimestampOffsets.length,
          1,
          'one video source buffer timestamp offset'
        );
        assert.equal(
          transmuxerTimestampOffsets.length,
          1,
          'one transmuxer timestamp offset'
        );

        // Mock the buffer and timestamp offset to pretend the first segment had data from
        // 11 to 21 seconds, normalized to 0 to 10 seconds in player time via a timestamp
        // offset of 11.
        //
        // The next segment will use the buffered end of 10 seconds as its starting value,
        // which starts before the timestamp offset of 11. However, even though the segment
        // start is before the timestamp offset, it should be appended without changing the
        // timestamp offset, as issues were seen when the timestamp offset was changed
        // without an actual timeline change.
        buffered = videojs.createTimeRanges([[0, 10]]);
        timestampOffsetOverride = 11;

        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.equal(
          audioTimestampOffsets.length,
          1,
          'no extra audio source buffer timestamp offset'
        );
        assert.equal(
          videoTimestampOffsets.length,
          1,
          'no extra video source buffer timestamp offset'
        );
        assert.equal(
          transmuxerTimestampOffsets.length,
          1,
          'no extra transmuxer timestamp offset'
        );
      });
    });

    QUnit.test('main buffered uses video buffer when audio disabled', function(assert) {
      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        const playlist = playlistWithDuration(40);

        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        // need to load content to have starting media
        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        // mock the buffered values (easiest solution to test that segment-loader is
        // calling the correct functions)
        loader.sourceUpdater_.audioBuffered =
          () => videojs.createTimeRanges([[2, 3], [5, 7]]);
        loader.sourceUpdater_.videoBuffered =
          () => videojs.createTimeRanges([[2, 6]]);
        loader.sourceUpdater_.buffered =
          () => videojs.createTimeRanges([[2, 3], [5, 6]]);

        timeRangesEqual(
          loader.buffered_(),
          videojs.createTimeRanges([[2, 3], [5, 6]]),
          'buffered reports intersection of audio and video buffers'
        );
        loader.setAudio(false);
        timeRangesEqual(
          loader.buffered_(),
          videojs.createTimeRanges([[2, 6]]),
          'buffered reports video buffered'
        );
      });
    });

    QUnit.test('main buffered uses video buffer when video only', function(assert) {
      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        const playlist = playlistWithDuration(40);

        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        // need to load content to have starting media
        standardXHRResponse(this.requests.shift(), videoSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        // mock the buffered values (easiest solution to test that segment-loader is
        // calling the correct functions)
        loader.sourceUpdater_.audioBuffered =
          () => videojs.createTimeRanges([[2, 3], [5, 7]]);
        loader.sourceUpdater_.videoBuffered =
          () => videojs.createTimeRanges([[2, 6]]);
        loader.sourceUpdater_.buffered =
          () => videojs.createTimeRanges([[2, 3], [5, 6]]);

        timeRangesEqual(
          loader.buffered_(),
          videojs.createTimeRanges([[2, 6]]),
          'buffered reports video buffered'
        );
        loader.setAudio(false);
        timeRangesEqual(
          loader.buffered_(),
          videojs.createTimeRanges([[2, 6]]),
          'buffered reports video buffered'
        );
      });
    });

    QUnit.test('main buffered uses audio buffer when audio only', function(assert) {
      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        const playlist = playlistWithDuration(40);

        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        // need to load content to have starting media
        standardXHRResponse(this.requests.shift(), audioSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        // mock the buffered values (easiest solution to test that segment-loader is
        // calling the correct functions)
        loader.sourceUpdater_.audioBuffered =
          () => videojs.createTimeRanges([[2, 3], [5, 7]]);
        loader.sourceUpdater_.videoBuffered =
          () => videojs.createTimeRanges([[2, 6]]);
        loader.sourceUpdater_.buffered =
          () => videojs.createTimeRanges([[2, 3], [5, 6]]);

        timeRangesEqual(
          loader.buffered_(),
          videojs.createTimeRanges([[2, 3], [5, 7]]),
          'buffered reports audio buffered'
        );
        // note that there currently is no proper support for audio only with alt audio,
        // so the setAudio(false) test can be skipped
      });
    });

    QUnit.test('audio buffered uses audio buffer', function(assert) {
      loader.dispose();
      loader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'audio'
      }), {});

      this.fakeMainTimelineChange();

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        const playlist = playlistWithDuration(40);

        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        // need to load content to have starting media
        standardXHRResponse(this.requests.shift(), audioSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        // mock the buffered values (easiest solution to test that segment-loader is
        // calling the correct functions)
        loader.sourceUpdater_.audioBuffered =
          () => videojs.createTimeRanges([[2, 3], [5, 7]]);
        loader.sourceUpdater_.videoBuffered =
          () => videojs.createTimeRanges([[2, 6]]);
        loader.sourceUpdater_.buffered =
          () => videojs.createTimeRanges([[2, 3], [5, 6]]);

        timeRangesEqual(
          loader.buffered_(),
          videojs.createTimeRanges([[2, 3], [5, 7]]),
          'buffered reports audio buffered'
        );
      });
    });

    QUnit.test('audio buffered uses audio buffer even when muxed', function(assert) {
      loader.dispose();
      loader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'audio'
      }), {});

      this.fakeMainTimelineChange();

      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        const playlist = playlistWithDuration(40);

        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        // need to load content to have starting media
        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        // mock the buffered values (easiest solution to test that segment-loader is
        // calling the correct functions)
        loader.sourceUpdater_.audioBuffered =
          () => videojs.createTimeRanges([[2, 3], [5, 7]]);
        loader.sourceUpdater_.videoBuffered =
          () => videojs.createTimeRanges([[2, 6]]);
        loader.sourceUpdater_.buffered =
          () => videojs.createTimeRanges([[2, 3], [5, 6]]);

        timeRangesEqual(
          loader.buffered_(),
          videojs.createTimeRanges([[2, 3], [5, 7]]),
          'buffered reports audio buffered'
        );
      });
    });

    QUnit.test('can get buffered between playlists', function(assert) {
      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        const playlist = playlistWithDuration(40);

        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        // need to load content to have starting media
        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        // mock the buffered values (easiest solution to test that segment-loader is
        // calling the correct functions)
        loader.sourceUpdater_.audioBuffered =
          () => videojs.createTimeRanges([[2, 3], [5, 7]]);
        loader.sourceUpdater_.videoBuffered =
          () => videojs.createTimeRanges([[2, 6]]);
        loader.sourceUpdater_.buffered =
          () => videojs.createTimeRanges([[2, 3], [5, 6]]);

        timeRangesEqual(
          loader.buffered_(),
          videojs.createTimeRanges([[2, 3], [5, 6]]),
          'buffered reports intersection of audio and video buffers'
        );
        const playlist2 = playlistWithDuration(40, {uri: 'playlist2.m3u8'});

        loader.playlist(playlist2);

        timeRangesEqual(
          loader.buffered_(),
          videojs.createTimeRanges([[2, 3], [5, 6]]),
          'buffered reports intersection of audio and video buffers'
        );

        loader.load();

        timeRangesEqual(
          loader.buffered_(),
          videojs.createTimeRanges([[2, 3], [5, 6]]),
          'buffered reports intersection of audio and video buffers'
        );
      });
    });
  });
});

QUnit.module('SegmentLoader: FMP4', function(hooks) {
  hooks.beforeEach(LoaderCommonHooks.beforeEach);
  hooks.afterEach(LoaderCommonHooks.afterEach);

  LoaderCommonFactory({
    LoaderConstructor: SegmentLoader,
    loaderSettings: {loaderType: 'main'}
  });

  // Tests specific to the main segment loader go in this module
  QUnit.module('Loader Main', function(nestedHooks) {
    let loader;

    nestedHooks.beforeEach(function(assert) {
      this.segmentMetadataTrack = new MockTextTrack();
      this.inbandTextTracks = {
        CC1: new MockTextTrack()
      };
      this.startTime = sinon.stub(mp4probe, 'startTime');

      loader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'main',
        segmentMetadataTrack: this.segmentMetadataTrack,
        inbandTextTracks: this.inbandTextTracks
      }), {});
    });

    nestedHooks.afterEach(function(assert) {
      this.startTime.restore();
      loader.dispose();
    });

    QUnit.test('CaptionParser messages sent as expected', function(assert) {
      return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        const actions = {};

        loader.transmuxer_.postMessage = ({action}) => {
          if (/Mp4Captions/.test(action)) {
            actions[action] = actions[action] || 0;
            actions[action]++;
          }
        };

        loader.load();
        loader.playlist(playlistWithDuration(10, 'm4s'));
        assert.equal(this.requests.length, 0, 'have not made a request yet');

        this.clock.tick(1);
        assert.equal(this.requests.length, 1, 'made a request');
        assert.deepEqual(actions, {
          clearParsedMp4Captions: 1,
          clearAllMp4Captions: 2
        }, 'caption parser cleared as expected on load');

        // Simulate a rendition switch
        loader.resetEverything();
        assert.deepEqual(actions, {
          clearParsedMp4Captions: 2,
          clearAllMp4Captions: 3
        }, 'caption parser cleared as expected on resetEverything');

        // Simulate a discontinuity
        const originalCurrentTimeline = loader.currentTimeline_;

        loader.currentTimeline_ = originalCurrentTimeline + 1;
        assert.deepEqual(actions, {
          clearParsedMp4Captions: 2,
          clearAllMp4Captions: 3
        }, 'caption parser cleared as expected after timeline change');
        loader.currentTimeline_ = originalCurrentTimeline;

        // Add to the inband text track, then call remove
        this.inbandTextTracks.CC1.addCue({
          startTime: 1,
          endTime: 2,
          text: 'test'
        });
        // set currentMediaInfo_
        loader.currentMediaInfo_ = {hasVideo: true, hasAudio: true};
        loader.remove(0, 2);
        assert.equal(this.inbandTextTracks.CC1.cues.length, 0, 'all cues have been removed');

        // Check that captions are added to track when found in the segment
        // and then captionParser is cleared
        const segment = {
          resolvedUri: '0.m4s',
          bytes: new Uint8Array([0, 0, 1]),
          map: {
            bytes: new Uint8Array([0, 0, 1])
          },
          endOfAllRequests: 0,
          captionStreams: {
            CC1: true
          }
        };
        const originalPendingSegment = loader.pendingSegment_;

        loader.pendingSegment_ = {
          segment,
          playlist: {
            syncInfo: null
          }
        };
        // prevent request from being made
        loader.loadSegment_ = (simpleSegment) => {
          // mock request finish
          loader.pendingSegment_.requestId = simpleSegment.requestId;
          loader.pendingSegment_.hasAppendedData_ = true;
          // captions were found in the request
          loader.handleCaptions_(simpleSegment, [{
            startTime: 1,
            endTime: 2,
            text: 'test',
            stream: 'CC1'
          }]);
        };
        loader.fillBuffer_();
        assert.ok(this.inbandTextTracks.CC1, 'text track created');
        assert.equal(this.inbandTextTracks.CC1.cues.length, 1, 'cue added');
        assert.deepEqual(actions, {
          clearParsedMp4Captions: 3,
          clearAllMp4Captions: 3
        }, 'caption parser cleared as expected after load');
        loader.pendingSegment_ = originalPendingSegment;

        // Dispose the loader
        loader.dispose();
      });
    });
  });
});
