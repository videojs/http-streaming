import QUnit from 'qunit';
import window from 'global/window';
import VTTSegmentLoader from '../src/vtt-segment-loader';
import {
  playlistWithDuration as oldPlaylistWithDuration,
  MockTextTrack
} from './test-helpers.js';
import {
  LoaderCommonHooks,
  LoaderCommonSettings,
  LoaderCommonFactory
} from './loader-common.js';
import { encryptionKey, subtitlesEncrypted } from 'create-test-data!segments';
import {merge, createTimeRanges} from '../src/util/vjs-compat';
import sinon from 'sinon';

const oldVTT = window.WebVTT;

const playlistWithDuration = function(time, conf) {
  return oldPlaylistWithDuration(time, merge({ extension: '.vtt' }, conf));
};

const testData = `
  WEBVTT

  00:00:05.000 --> 00:00:06.000
  <b>GOOD CUE</b>
`;

QUnit.module('VTTSegmentLoader', function(hooks) {
  hooks.beforeEach(function(assert) {
    LoaderCommonHooks.beforeEach.call(this);

    this.parserCreated = false;

    window.WebVTT = () => {};
    window.WebVTT.StringDecoder = () => {};
    window.WebVTT.Parser = function() {
      this.parserCreated = true;
      return {
        oncue() {},
        onparsingerror() {},
        onflush() {},
        parse() {},
        flush() {}
      };
    };

    // mock an initial timeline sync point on the SyncController
    this.syncController.timelines[0] = { time: 0, mapping: 0 };
  });

  hooks.afterEach(function(assert) {
    LoaderCommonHooks.afterEach.call(this);

    window.WebVTT = oldVTT;
  });

  LoaderCommonFactory({
    LoaderConstructor: VTTSegmentLoader,
    loaderSettings: {loaderType: 'vtt'},
    loaderBeforeEach: (loader) => loader.track(new MockTextTrack()),
    usesAsyncAppends: false,
    initSegments: false,
    testData: () => new Uint8Array(testData.split('').map(char => char.charCodeAt(0))),
    encryptedSegmentFn: subtitlesEncrypted,
    encryptedSegmentKeyFn: encryptionKey
  });

  // Tests specific to the vtt loader go in this module
  QUnit.module('Loader VTT', function(nestedHooks) {
    let loader;

    nestedHooks.beforeEach(function(assert) {
      loader = new VTTSegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'vtt'
      }), {});

      this.track = new MockTextTrack();
    });

    nestedHooks.afterEach(function(assert) {
      loader.dispose();
    });

    QUnit.test(
      'load waits until a playlist and track are specified to proceed',
      function(assert) {
        loader.load();

        assert.equal(loader.state, 'INIT', 'waiting in init');
        assert.equal(loader.paused(), false, 'not paused');

        loader.playlist(playlistWithDuration(10));
        assert.equal(this.requests.length, 0, 'have not made a request yet');
        loader.track(this.track);
        this.clock.tick(1);

        assert.equal(this.requests.length, 1, 'made a request');
        assert.equal(loader.state, 'WAITING', 'transitioned states');
      }
    );

    QUnit.test('calling track and load begins buffering', function(assert) {
      assert.equal(loader.state, 'INIT', 'starts in the init state');
      loader.playlist(playlistWithDuration(10));
      assert.equal(loader.state, 'INIT', 'starts in the init state');
      assert.ok(loader.paused(), 'starts paused');

      loader.track(this.track);
      assert.equal(loader.state, 'INIT', 'still in the init state');
      loader.load();
      this.clock.tick(1);

      assert.equal(loader.state, 'WAITING', 'moves to the ready state');
      assert.ok(!loader.paused(), 'loading is not paused');
      assert.equal(this.requests.length, 1, 'requested a segment');
    });

    QUnit.test(
      'saves segment info to new segment after playlist refresh',
      function(assert) {
        const playlist = playlistWithDuration(40);
        let buffered = createTimeRanges();

        loader.buffered_ = () => buffered;

        playlist.endList = false;

        loader.playlist(playlist);
        loader.track(this.track);
        loader.load();
        this.clock.tick(1);

        assert.equal(loader.state, 'WAITING', 'in waiting state');
        assert.equal(loader.pendingSegment_.uri, '0.vtt', 'first segment pending');
        assert.equal(
          loader.pendingSegment_.segment.uri,
          '0.vtt',
          'correct segment reference'
        );

        // wrap up the first request to set mediaIndex and start normal live streaming
        this.requests[0].responseType = 'arraybuffer';
        this.requests.shift().respond(200, null, new Uint8Array(10).buffer);
        buffered = createTimeRanges([[0, 10]]);
        this.clock.tick(1);

        assert.equal(loader.state, 'WAITING', 'in waiting state');
        assert.equal(loader.pendingSegment_.uri, '1.vtt', 'second segment pending');
        assert.equal(
          loader.pendingSegment_.segment.uri,
          '1.vtt',
          'correct segment reference'
        );

        // playlist updated during waiting
        const playlistUpdated = playlistWithDuration(40);

        playlistUpdated.segments.shift();
        playlistUpdated.mediaSequence++;
        loader.playlist(playlistUpdated);

        assert.equal(loader.pendingSegment_.uri, '1.vtt', 'second segment still pending');
        assert.equal(
          loader.pendingSegment_.segment.uri,
          '1.vtt',
          'correct segment reference'
        );

        // mock parseVttCues_ to respond empty cue array
        loader.parseVTTCues_ = (segmentInfo) => {
          segmentInfo.cues = [];
          segmentInfo.timestampmap = { MPEGTS: 0, LOCAL: 0 };
        };

        this.requests[0].responseType = 'arraybuffer';
        this.requests.shift().respond(200, null, new Uint8Array(10).buffer);

        assert.ok(
          playlistUpdated.segments[0].empty,
          'set empty on segment of new playlist'
        );
        assert.ok(
          !playlist.segments[1].empty,
          'did not set empty on segment of old playlist'
        );
      }
    );

    QUnit.test(
      'saves segment info to old segment after playlist refresh if segment fell off',
      function(assert) {
        const playlist = playlistWithDuration(40);
        let buffered = createTimeRanges();

        loader.buffered_ = () => buffered;

        playlist.endList = false;

        loader.playlist(playlist);
        loader.track(this.track);
        loader.load();
        this.clock.tick(1);

        assert.equal(loader.state, 'WAITING', 'in waiting state');
        assert.equal(loader.pendingSegment_.uri, '0.vtt', 'first segment pending');
        assert.equal(
          loader.pendingSegment_.segment.uri,
          '0.vtt',
          'correct segment reference'
        );

        // wrap up the first request to set mediaIndex and start normal live streaming
        this.requests[0].responseType = 'arraybuffer';
        this.requests.shift().respond(200, null, new Uint8Array(10).buffer);
        buffered = createTimeRanges([[0, 10]]);
        this.clock.tick(1);

        assert.equal(loader.state, 'WAITING', 'in waiting state');
        assert.equal(loader.pendingSegment_.uri, '1.vtt', 'second segment pending');
        assert.equal(
          loader.pendingSegment_.segment.uri,
          '1.vtt',
          'correct segment reference'
        );

        // playlist updated during waiting
        const playlistUpdated = playlistWithDuration(40);

        playlistUpdated.segments.shift();
        playlistUpdated.segments.shift();
        playlistUpdated.mediaSequence += 2;
        loader.playlist(playlistUpdated);

        assert.equal(loader.pendingSegment_.uri, '1.vtt', 'second segment still pending');
        assert.equal(
          loader.pendingSegment_.segment.uri,
          '1.vtt',
          'correct segment reference'
        );

        // mock parseVttCues_ to respond empty cue array
        loader.parseVTTCues_ = (segmentInfo) => {
          segmentInfo.cues = [];
          segmentInfo.timestampmap = { MPEGTS: 0, LOCAL: 0 };
        };

        this.requests[0].responseType = 'arraybuffer';
        this.requests.shift().respond(200, null, new Uint8Array(10).buffer);

        assert.ok(
          playlist.segments[1].empty,
          'set empty on segment of old playlist'
        );
        assert.ok(
          !playlistUpdated.segments[0].empty,
          'no empty info for first segment of new playlist'
        );
      }
    );

    QUnit.test('waits for syncController to have sync info for the timeline of the vtt' +
      'segment being requested before loading', function(assert) {
      const playlist = playlistWithDuration(40);
      let loadedSegment = false;

      loader.loadSegment_ = () => {
        loader.state = 'WAITING';
        loadedSegment = true;
      };
      loader.chooseNextRequest_ = () => {
        return { mediaIndex: 2, timeline: 2, segment: { } };
      };

      loader.playlist(playlist);
      loader.track(this.track);
      loader.load();

      assert.equal(loader.state, 'READY', 'loader is ready at start');
      assert.ok(!loadedSegment, 'no segment requests made yet');

      this.clock.tick(1);

      assert.equal(
        loader.state,
        'WAITING_ON_TIMELINE',
        'loader waiting for timeline info'
      );
      assert.ok(!loadedSegment, 'no segment requests made yet');

      // simulate the main segment loader finding timeline info for the new timeline
      loader.syncController_.timelines[2] = { time: 20, mapping: -10 };
      loader.syncController_.trigger('timestampoffset');

      assert.equal(
        loader.state,
        'READY',
        'ready after sync controller reports timeline info'
      );
      assert.ok(!loadedSegment, 'no segment requests made yet');

      this.clock.tick(1);

      assert.equal(loader.state, 'WAITING', 'loader waiting on segment request');
      assert.ok(loadedSegment, 'made call to load segment on new timeline');
    });

    QUnit.test(
      'waits for vtt.js to be loaded before attempting to parse cues',
      function(assert) {
        let promiseLoadVttJs; let resolveLoadVttJs;

        loader = new VTTSegmentLoader(LoaderCommonSettings.call(this, {
          loaderType: 'vtt',
          loadVttJs: () => {
            promiseLoadVttJs = new Promise((resolve) => {
              resolveLoadVttJs = resolve;
            });

            return promiseLoadVttJs;
          }
        }), {});

        const vttjs = window.WebVTT;
        const playlist = playlistWithDuration(40);
        let parsedCues = false;

        delete window.WebVTT;

        loader.handleAppendsDone_ = () => {
          parsedCues = true;
          loader.state = 'READY';
        };

        loader.playlist(playlist);
        loader.track(this.track);
        loader.load();

        assert.equal(loader.state, 'READY', 'loader is ready at start');
        assert.ok(!parsedCues, 'no cues parsed yet');

        this.clock.tick(1);

        assert.equal(loader.state, 'WAITING', 'loader is waiting on segment request');
        assert.ok(!parsedCues, 'no cues parsed yet');

        this.requests[0].responseType = 'arraybuffer';
        this.requests.shift().respond(200, null, new Uint8Array(10).buffer);

        this.clock.tick(1);

        assert.equal(
          loader.state,
          'WAITING_ON_VTTJS',
          'loader is waiting for vttjs to be loaded'
        );
        assert.ok(!parsedCues, 'no cues parsed yet');

        window.WebVTT = vttjs;

        promiseLoadVttJs.then(() => {
          assert.equal(loader.state, 'READY', 'loader is ready to load next segment');
          assert.ok(parsedCues, 'parsed cues');
        });

        resolveLoadVttJs();
      }
    );

    QUnit.test(
      'parse should throw if no vtt.js is loaded for any reason',
      function(assert) {
        const vttjs = window.WebVTT;
        const playlist = playlistWithDuration(40);
        let errors = 0;

        const originalParse = loader.parseVTTCues_.bind(loader);

        loader.parseVTTCues_ = (...args) => {
          delete window.WebVTT;
          return originalParse(...args);
        };

        const spy = sinon.spy(loader, 'error');

        loader.on('error', () => errors++);

        loader.playlist(playlist);
        loader.track(this.track);
        loader.load();

        assert.equal(errors, 0, 'no error at loader start');

        this.clock.tick(1);

        // state WAITING for segment response
        this.requests[0].responseType = 'arraybuffer';
        this.requests.shift().respond(200, null, new Uint8Array(10).buffer);

        this.clock.tick(1);

        assert.equal(errors, 1, 'triggered error when parser emmitts fatal error');
        assert.ok(loader.paused(), 'loader paused when encountering fatal error');
        assert.equal(loader.state, 'READY', 'loader reset after error');
        assert.ok(
          spy.withArgs(sinon.match({
            message: 'Trying to parse received VTT cues, but there is no WebVTT. Make sure vtt.js is loaded.'
          })).calledOnce,
          'error method called once with instance of NoVttJsError'
        );

        window.WebVTT = vttjs;
      }
    );

    QUnit.test(
      'uses timestampmap from vtt header to set cue and segment timing',
      function(assert) {
        const cues = [
          { startTime: 10, endTime: 12 },
          { startTime: 14, endTime: 16 },
          { startTime: 15, endTime: 19 }
        ];
        const expectedCueTimes = [
          { startTime: 14, endTime: 16 },
          { startTime: 18, endTime: 20 },
          { startTime: 19, endTime: 23 }
        ];
        const expectedSegment = {
          duration: 10
        };
        const expectedPlaylist = {
          mediaSequence: 100,
          syncInfo: { mediaSequence: 102, time: 9 }
        };
        const mappingObj = {
          time: 0,
          mapping: -10
        };
        const playlist = { mediaSequence: 100 };
        const segment = { duration: 10 };
        const segmentInfo = {
          timestampmap: { MPEGTS: 1260000, LOCAL: 0 },
          mediaIndex: 2,
          cues,
          segment
        };

        loader.updateTimeMapping_(segmentInfo, mappingObj, playlist);

        assert.deepEqual(
          cues,
          expectedCueTimes,
          'adjusted cue timing based on timestampmap'
        );
        assert.deepEqual(
          segment,
          expectedSegment,
          'set segment start and end based on cue content'
        );
        assert.deepEqual(
          playlist,
          expectedPlaylist,
          'set syncInfo for playlist based on learned segment start'
        );
      }
    );

    QUnit.test(
      'should handle rollover when MPEGTS is not equal to 0',
      function(assert) {
        const cues = [
          {
            startTime: 0,
            endTime: 2
          },
          {
            startTime: 2,
            endTime: 4
          },
          {
            startTime: 4,
            endTime: 6
          }
        ];
        const expectedCueTimes = [
          {
            startTime: 107.59999175347222,
            endTime: 109.59999175347222
          },
          {
            startTime: 109.59999175347222,
            endTime: 111.59999175347222
          },
          {
            startTime: 111.59999175347222,
            endTime: 113.59999175347222
          }
        ];
        const expectedSegment = {
          duration: 6
        };
        const expectedPlaylist = {
          mediaSequence: 100,
          syncInfo: { mediaSequence: 102, time: 105.59999175347222 }
        };
        const mappingObj = { time: 103.68000000000006, mapping: -405994299.533186 };

        const playlist = { mediaSequence: 100 };
        const segment = { duration: 6 };
        const segmentInfo = {
          timestampmap: { MPEGTS: 6504822210, LOCAL: 0 },
          mediaIndex: 2,
          cues,
          segment
        };

        loader.updateTimeMapping_(segmentInfo, mappingObj, playlist);

        assert.deepEqual(
          cues,
          expectedCueTimes,
          'adjusted cue timing based on timestampmap'
        );
        assert.deepEqual(
          segment,
          expectedSegment,
          'set segment start and end based on cue content'
        );
        assert.deepEqual(
          playlist,
          expectedPlaylist,
          'set syncInfo for playlist based on learned segment start'
        );
      }
    );

    QUnit.test(
      'loader logs vtt.js ParsingErrors and does not trigger an error event',
      function(assert) {
        const playlist = playlistWithDuration(40);

        window.WebVTT.Parser = function() {
          this.parserCreated = true;
          return {
            oncue() {},
            onparsingerror() {},
            onflush() {},
            parse() {
            // MOCK parsing the cues below
              this.onparsingerror({ message: 'BAD CUE'});
              this.oncue({ startTime: 5, endTime: 6});
              this.onparsingerror({ message: 'BAD --> CUE' });
            },
            flush() {}
          };
        };

        loader.playlist(playlist);
        loader.track(this.track);
        loader.load();

        this.clock.tick(1);

        const vttString = `
        WEBVTT

        00:00:03.000 -> 00:00:05.000
        <i>BAD CUE</i>

        00:00:05.000 --> 00:00:06.000
        <b>GOOD CUE</b>

        00:00:07.000 --> 00:00:10.000
        <i>BAD --> CUE</i>
      `;

        // state WAITING for segment response
        this.requests[0].responseType = 'arraybuffer';
        this.requests.shift().respond(
          200,
          null,
          new Uint8Array(vttString.split('').map(char => char.charCodeAt(0))).buffer
        );

        this.clock.tick(1);

        assert.equal(
          loader.subtitlesTrack_.cues.length,
          1,
          'only appended the one good cue'
        );
        assert.equal(
          this.env.log.warn.callCount,
          2,
          'logged two warnings, one for each invalid cue'
        );
        this.env.log.warn.callCount = 0;
      }
    );

    QUnit.test(
      'remove() removes all cues if duration_() === end and we have cues beyond duration',
      function(assert) {
        loader.dispose();

        loader = new VTTSegmentLoader(LoaderCommonSettings.call(this, {
          duration() {
            return 10;
          },
          loaderType: 'vtt'
        }), {});

        const playlist = playlistWithDuration(10);

        window.WebVTT.Parser = function() {
          this.parserCreated = true;
          return {
            oncue() {},
            onparsingerror() {},
            onflush() {},
            parse() {
            },
            flush() {}
          };
        };

        window.WebVTT = oldVTT;

        loader.playlist(playlist);
        loader.track(this.track);
        loader.load();

        this.clock.tick(1);

        const vttString = `
        WEBVTT
        X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:0

        00:00:03.000 --> 00:00:05.000
        first cue

        00:00:05.000 --> 00:00:06.000
        second cue

        00:00:07.000 --> 00:00:10.000
        third cue

        00:00:11.000 --> 00:00:15.000
        fourth cue

        00:00:16.000 --> 00:00:20.000
        fifth cue
      `;

        // state WAITING for segment response
        this.requests[0].responseType = 'arraybuffer';
        this.requests.shift().respond(
          200,
          null,
          new Uint8Array(vttString.trim().split('').map(char => char.charCodeAt(0))).buffer
        );

        this.clock.tick(1);

        assert.equal(
          loader.subtitlesTrack_.cues.length,
          5,
          'appended 5 cues'
        );

        loader.resetEverything();
        assert.equal(
          loader.subtitlesTrack_.cues.length,
          0,
          'all 5 cues have been removed'
        );

      }
    );

    QUnit.test(
      'Cues that overlap segment boundaries',
      function(assert) {
        const playlist = playlistWithDuration(20);

        loader.parseVTTCues_ = (segmentInfo) => {
          segmentInfo.cues = [{ startTime: 0, endTime: 5}, { startTime: 5, endTime: 15}];
          segmentInfo.timestampmap = { MPEGTS: 0, LOCAL: 0 };
        };

        loader.playlist(playlist);
        loader.track(this.track);
        loader.load();

        this.clock.tick(1);

        this.requests[0].responseType = 'arraybuffer';
        this.requests.shift().respond(200, null, new Uint8Array(10).buffer);

        this.clock.tick(1);

        assert.equal(this.track.cues.length, 2, 'segment length should be 2');

        loader.parseVTTCues_ = (segmentInfo) => {
          segmentInfo.cues = [{ startTime: 5, endTime: 15}, { startTime: 15, endTime: 20}];
          segmentInfo.timestampmap = { MPEGTS: 0, LOCAL: 0 };
        };

        this.clock.tick(1);

        this.requests[0].responseType = 'arraybuffer';
        this.requests.shift().respond(200, null, new Uint8Array(10).buffer);

        this.clock.tick(1);

        assert.equal(this.track.cues.length, 3, 'segment length should be 3');
        assert.equal(this.track.cues[0].startTime, 0, 'First cue starttime should be 0');
        assert.equal(this.track.cues[1].startTime, 5, 'Second cue starttime should be 5');
        assert.equal(this.track.cues[2].startTime, 15, 'Third cue starttime should be 15');
      }
    );

    QUnit.test(
      'adds native VTTCues when featuresNativeTextTracks option is enabled',
      function(assert) {
        loader = new VTTSegmentLoader(LoaderCommonSettings.call(this, {
          loaderType: 'vtt',
          featuresNativeTextTracks: true
        }), {});

        this.track = new MockTextTrack();

        const playlist = playlistWithDuration(20);

        loader.parseVTTCues_ = (segmentInfo) => {
          segmentInfo.cues = [{ startTime: 0, endTime: 5}, { startTime: 5, endTime: 15}];
          segmentInfo.timestampmap = { MPEGTS: 0, LOCAL: 0 };
        };

        loader.playlist(playlist);
        loader.track(this.track);
        loader.load();

        this.clock.tick(1);

        this.requests[0].responseType = 'arraybuffer';
        this.requests.shift().respond(200, null, new Uint8Array(10).buffer);

        this.clock.tick(1);

        loader.parseVTTCues_ = (segmentInfo) => {
          segmentInfo.cues = [{ startTime: 5, endTime: 15}, { startTime: 15, endTime: 20}];
          segmentInfo.timestampmap = { MPEGTS: 0, LOCAL: 0 };
        };

        this.clock.tick(1);

        this.requests[0].responseType = 'arraybuffer';
        this.requests.shift().respond(200, null, new Uint8Array(10).buffer);

        this.clock.tick(1);

        assert.ok(loader.subtitlesTrack_.cues.every(c => c instanceof window.VTTCue), 'added native VTTCues');
      }
    );

    QUnit.test(
      'loader does not re-request segments that contain no subtitles',
      function(assert) {
        const playlist = playlistWithDuration(40);

        playlist.endList = false;

        loader.parseVTTCues_ = (segmentInfo) => {
        // mock empty segment
          segmentInfo.cues = [];
        };

        loader.currentTime_ = () => {
          return 20;
        };

        loader.playlist(playlist);
        loader.track(this.track);
        loader.load();

        this.clock.tick(1);

        assert.equal(
          loader.pendingSegment_.mediaIndex,
          2,
          'requesting initial segment guess'
        );

        // set the pending segment to mediaIndex 1
        // so that the next request will attempt to grab this empty segment.
        loader.pendingSegment_.mediaIndex = 1;

        this.requests[0].responseType = 'arraybuffer';
        this.requests.shift().respond(200, null, new Uint8Array(10).buffer);

        this.clock.tick(1);

        assert.ok(playlist.segments[2].empty, 'marked empty segment as empty');

        assert.equal(
          loader.pendingSegment_.mediaIndex,
          3,
          'walked forward skipping requesting empty segment'
        );

        // set the pending segment to mediaIndex 1 again
        // so that the next request will attempt to grab the next two empty segments.
        loader.pendingSegment_.mediaIndex = 1;

        this.requests[0].responseType = 'arraybuffer';
        this.requests.shift().respond(200, null, new Uint8Array(10).buffer);

        this.clock.tick(1);

        assert.ok(playlist.segments[3].empty, 'marked empty segment as empty');

        assert.ok(
          !loader.pendingSegment_,
          'no pending segment, with two empty segments'
        );

        assert.ok(
          !loader.error_,
          'no error, with last two empty segments'
        );
      }
    );

    QUnit.test('loader triggers error event on fatal vtt.js errors', function(assert) {
      const playlist = playlistWithDuration(40);
      let errors = 0;

      loader.parseVTTCues_ = () => {
        throw new Error('fatal error');
      };
      loader.on('error', () => errors++);

      loader.playlist(playlist);
      loader.track(this.track);
      loader.load();

      assert.equal(errors, 0, 'no error at loader start');

      this.clock.tick(1);

      // state WAITING for segment response
      this.requests[0].responseType = 'arraybuffer';
      this.requests.shift().respond(200, null, new Uint8Array(10).buffer);

      this.clock.tick(1);

      assert.equal(errors, 1, 'triggered error when parser emmitts fatal error');
      assert.ok(loader.paused(), 'loader paused when encountering fatal error');
      assert.equal(loader.state, 'READY', 'loader reset after error');
    });

    QUnit.test('loader triggers error event when vtt.js fails to load', function(assert) {
      let promiseLoadVttJs; let rejectLoadVttJs;

      loader = new VTTSegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'vtt',
        loadVttJs: () => {
          promiseLoadVttJs = new Promise((resolve, reject) => {
            rejectLoadVttJs = reject;
          });

          return promiseLoadVttJs;
        }
      }), {});
      const playlist = playlistWithDuration(40);
      let errors = 0;

      delete window.WebVTT;

      loader.on('error', () => errors++);

      loader.playlist(playlist);
      loader.track(this.track);
      loader.load();

      assert.equal(loader.state, 'READY', 'loader is ready at start');
      assert.equal(errors, 0, 'no errors yet');

      this.clock.tick(1);

      assert.equal(loader.state, 'WAITING', 'loader is waiting on segment request');
      assert.equal(errors, 0, 'no errors yet');

      this.requests[0].responseType = 'arraybuffer';
      this.requests.shift().respond(200, null, new Uint8Array(10).buffer);

      this.clock.tick(1);

      assert.equal(
        loader.state,
        'WAITING_ON_VTTJS',
        'loader is waiting for vttjs to be loaded'
      );
      assert.equal(errors, 0, 'no errors yet');

      promiseLoadVttJs.catch(() => {
        assert.equal(loader.state, 'READY', 'loader is reset to ready');
        assert.ok(loader.paused(), 'loader is paused after error');
        assert.equal(errors, 1, 'loader triggered error when vtt.js load triggers error');
      });

      rejectLoadVttJs();
    });

    QUnit.test('does not save segment timing info', function(assert) {
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

      loader.playlist(playlist);
      loader.track(this.track);
      loader.load();

      this.clock.tick(1);

      this.requests[0].responseType = 'arraybuffer';
      this.requests.shift().respond(200, null, new Uint8Array(10).buffer);

      this.clock.tick(1);

      assert.equal(saveSegmentTimingInfoCalls, 0, 'no calls to save timing info');
    });

    QUnit.test('segmentRequestFinished_ adds mp4VttCues', function(assert) {
      const done = assert.async();
      const mockSimpleSegment = {};
      const firstMockCue = {
        start: 0,
        end: 1,
        cueText: 'foo',
        settings: 'align:start line:8'
      };
      const secondMockCue = {
        start: 1,
        end: 2,
        cueText: 'bar',
        settings: 'align:end line:10'
      };
      const mockResult = {
        mp4VttCues: [firstMockCue, secondMockCue]
      };

      loader.track(this.track);
      loader.pendingSegment_ = {
        segment: { },
        mp4VttCues: undefined,
        // for early return.
        isSyncRequest: true,
        cues: []
      };
      loader.parseMp4VttCues_ = (segmentInfo) => {
        assert.ok(segmentInfo.mp4VttCues.length, 'there are mp4VttCues');
        assert.equal(segmentInfo.mp4VttCues[0], firstMockCue, 'first cue is expected value');
        assert.equal(segmentInfo.mp4VttCues[1], secondMockCue, 'second cue is expected value');
        done();
      };
      loader.saveBandwidthRelatedStats_ = () => { };
      loader.segmentRequestFinished_(null, mockSimpleSegment, mockResult);
    });

    QUnit.test('parseMp4VttCues_ adds parsed mp4VttCues to the segmentInfo object', function(assert) {
      const mockSegmentInfo = {
        mp4VttCues: [{
          start: 0,
          end: 2,
          cueText: 'foo.bar',
          settings: 'align:start line:9'
        }],
        cues: []
      };

      // add an offset
      loader.sourceUpdater_.videoTimestampOffset = () => {
        return 1;
      };
      loader.parseMp4VttCues_(mockSegmentInfo);
      assert.ok(mockSegmentInfo.cues.length, 'there are parsed cues');
      assert.equal(mockSegmentInfo.cues[0].text, 'foo.bar', 'text is expected string');
      assert.equal(mockSegmentInfo.cues[0].line, 9, 'line is expected number');
      assert.equal(mockSegmentInfo.cues[0].align, 'start', 'align is correct value');
      assert.equal(mockSegmentInfo.cues[0].startTime, 1, 'startTime is correct value');
      assert.equal(mockSegmentInfo.cues[0].endTime, 3, 'startTime is correct value');
    });

    QUnit.test('parseMp4VttCues_ adds parsed mp4VttCues to the segmentInfo object using audioTimestamp', function(assert) {
      const mockSegmentInfo = {
        mp4VttCues: [{
          start: 1,
          end: 3,
          cueText: 'bar.foo',
          settings: 'align:end line:10'
        }],
        cues: []
      };

      loader.sourceUpdater_.videoTimestampOffset = () => {
        return null;
      };
      loader.sourceUpdater_.audioTimestampOffset = () => {
        return 0;
      };
      loader.parseMp4VttCues_(mockSegmentInfo);
      assert.ok(mockSegmentInfo.cues.length, 'there are parsed cues');
      assert.equal(mockSegmentInfo.cues[0].text, 'bar.foo', 'text is expected string');
      assert.equal(mockSegmentInfo.cues[0].line, 10, 'line is expected number');
      assert.equal(mockSegmentInfo.cues[0].align, 'end', 'align is correct value');
      assert.equal(mockSegmentInfo.cues[0].startTime, 1, 'startTime is correct value');
      assert.equal(mockSegmentInfo.cues[0].endTime, 3, 'startTime is correct value');
    });

    QUnit.test('handleData_ passes fmp4 vtt segment data to parent loader', function(assert) {
      const done = assert.async();
      const mockSimpleSegment = {
        type: 'vtt',
        stats: 'fake.stats'
      };
      const mockResult = {
        type: 'text'
      };

      // mock this function to spy the super handleData call.
      loader.earlyAbortWhenNeeded_ = (stats) => {
        assert.equal(stats, 'fake.stats', 'expected stats value is passed.');
        done();
      };
      loader.handleData_(mockSimpleSegment, mockResult);
    });
  });
});
