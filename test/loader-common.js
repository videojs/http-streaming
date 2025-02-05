import QUnit from 'qunit';
import xhrFactory from '../src/xhr';
import Config from '../src/config';
import document from 'global/document';
import {
  playlistWithDuration,
  useFakeEnvironment,
  createResponseText,
  standardXHRResponse,
  setupMediaSource
} from './test-helpers.js';
import { PlaylistController } from '../src/playlist-controller';
import SourceUpdater from '../src/source-updater';
import SyncController from '../src/sync-controller';
import TimelineChangeController from '../src/timeline-change-controller';
import Decrypter from 'worker!../src/decrypter-worker.js';
import window from 'global/window';
/* eslint-disable no-unused-vars */
// we need this so that it can register VHS with videojs
import { Vhs } from '../src/videojs-http-streaming';
/* eslint-enable no-unused-vars */
import {
  muxed as muxedSegment,
  mp4Video as mp4VideoSegment,
  mp4VideoInit as mp4VideoInitSegment,
  videoOneSecond as tsVideoSegment
} from 'create-test-data!segments';
import {merge, createTimeRanges} from '../src/util/vjs-compat';

/**
 * beforeEach and afterEach hooks that should be run segment loader tests regardless of
 * the type of loader.
 */
export const LoaderCommonHooks = {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.clock = this.env.clock;
    this.requests = this.env.requests;
    this.currentTime = 0;
    this.seekable = {
      length: 0
    };
    this.seeking = false;
    this.hasPlayed = true;
    this.paused = false;
    this.playbackRate = 1;
    this.fakeVhs = {
      xhr: xhrFactory(),
      tech_: {
        options_: {},
        paused: () => this.paused,
        playbackRate: () => this.playbackRate,
        currentTime: () => this.currentTime,
        textTracks: () => {},
        addRemoteTextTrack: (track) => {
          return track;
        },
        trigger: () => {}
      }
    };
    this.tech_ = this.fakeVhs.tech_;
    this.goalBufferLength =
      PlaylistController.prototype.goalBufferLength.bind(this);
    this.mediaSource = new window.MediaSource();
    this.sourceUpdater_ = new SourceUpdater(this.mediaSource);
    this.inbandTextTracks_ = {
      metadataTrack_: {
        addCue: () => {}
      }
    };
    this.syncController = new SyncController();
    this.decrypter = new Decrypter();
    this.timelineChangeController = new TimelineChangeController();
    this.addMetadataToTextTrack = PlaylistController.prototype.addMetadataToTextTrack.bind(this);

    this.video = document.createElement('video');

    this.setupMediaSource = (mediaSource, sourceUpdater, options) => {
      return setupMediaSource(mediaSource, sourceUpdater, merge({
        videoEl: this.video
      }, options));
    };
  },
  afterEach(assert) {
    this.video.src = '';
    this.video.removeAttribute('src');
    this.video = null;

    this.env.restore();
    this.decrypter.terminate();
    this.sourceUpdater_.dispose();
    this.timelineChangeController.dispose();
  }
};

/**
 * Returns a settings object containing the custom settings provided merged with defaults
 * for use in constructing a segment loader. This function should be called with the QUnit
 * test environment the loader will be constructed in for proper this reference.
 *
 * @param {Object} settings
 *        custom settings for the loader
 * @return {Object}
 *         Settings object containing custom settings merged with defaults
 */
export const LoaderCommonSettings = function(settings) {
  return merge({
    vhs: this.fakeVhs,
    currentTime: () => this.currentTime,
    seekable: () => this.seekable,
    seeking: () => this.seeking,
    hasPlayed: () => this.hasPlayed,
    duration: () => this.mediaSource.duration,
    goalBufferLength: () => this.goalBufferLength(),
    mediaSource: this.mediaSource,
    sourceUpdater: this.sourceUpdater_,
    syncController: this.syncController,
    decrypter: this.decrypter,
    timelineChangeController: this.timelineChangeController,
    addMetadataToTextTrack: this.addMetadataToTextTrack
  }, settings);
};

/**
 * Sets up a QUnit module to run tests that should be run on all segment loader types.
 * Currently only two types, SegmentLoader and VTTSegmentLoader.
 *
 * @param {function(new:SegmentLoader|VTTLoader, Object)} LoaderConstructor
 *        Constructor for segment loader. Takes one parameter, a settings object
 * @param {Object} loaderSettings
 *        Custom settings to merge with defaults for the provided loader constructor
 * @param {function(SegmentLoader|VTTLoader)} loaderBeforeEach
 *        Function to be run in the beforeEach after loader creation. Takes one parameter,
 *        the loader for custom modifications to the loader object.
 */

export const LoaderCommonFactory = ({
  LoaderConstructor,
  loaderSettings,
  loaderBeforeEach,
  usesAsyncAppends = true,
  initSegments = true,
  testData = muxedSegment,
  // These need to be functions. If you use a value alone, the bytes may be cleared out
  // after decrypting, leaving an empty segment/key. This usage is consistent with other
  // segments used in tests.
  encryptedSegmentFn,
  encryptedSegmentKeyFn
}) => {
  let loader;

  const appendPart = function(segmentIndex, partIndex) {
    this.clock.tick(1);

    QUnit.assert.equal(
      this.requests[0].url,
      `segment${segmentIndex}.part${partIndex}.ts`,
      `requested mediaIndex #${segmentIndex} partIndex #${partIndex}`
    );
    standardXHRResponse(this.requests.shift(), testData());

    if (usesAsyncAppends) {
      return new Promise((resolve, reject) => {
        loader.one('appended', resolve);
        loader.one('error', reject);
      });
    }

    return Promise.resolve();
  };

  QUnit.module('Loader Common', function(hooks) {
    hooks.beforeEach(function(assert) {
      // Assume this module is nested and the parent module uses CommonHooks.beforeEach

      loader = new LoaderConstructor(LoaderCommonSettings.call(this, loaderSettings), {});

      if (loaderBeforeEach) {
        loaderBeforeEach(loader);
      }
    });

    hooks.afterEach(function(assert) {
      loader.dispose();
    });

    QUnit.test('fails without required initialization options', function(assert) {
      /* eslint-disable no-new */
      assert.throws(function() {
        new LoaderConstructor();
      }, 'requires options');
      assert.throws(function() {
        new LoaderConstructor({});
      }, 'requires a currentTime callback');
      assert.throws(function() {
        new LoaderConstructor({
          currentTime() {}
        });
      }, 'requires a media source');
      /* eslint-enable */
    });

    QUnit.test('calling load is idempotent', function(assert) {
      loader.playlist(playlistWithDuration(20));

      loader.load();
      this.clock.tick(1);

      assert.equal(loader.state, 'WAITING', 'moves to the ready state');
      assert.equal(this.requests.length, 1, 'made one request');

      loader.load();
      assert.equal(loader.state, 'WAITING', 'still in the ready state');
      assert.equal(this.requests.length, 1, 'still one request');

      // some time passes and a response is received
      this.clock.tick(100);
      this.requests[0].response = new Uint8Array(10).buffer;
      this.requests.shift().respond(200, null, createResponseText(10));
      loader.load();
      assert.equal(this.requests.length, 0, 'load has no effect');
    });

    QUnit.test('calling load should unpause', function(assert) {
      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.playlist(playlistWithDuration(20));
        loader.pause();

        loader.load();
        this.clock.tick(1);
        assert.equal(loader.paused(), false, 'loading unpauses');

        loader.pause();
        this.clock.tick(1);

        standardXHRResponse(this.requests.shift(), testData());

        assert.equal(loader.paused(), true, 'stayed paused');
        loader.load();
        assert.equal(loader.paused(), false, 'unpaused during processing');

        if (usesAsyncAppends) {
          return new Promise((resolve, reject) => {
            loader.one('appended', loader.pause);
            loader.one('appended', resolve);
            loader.one('error', reject);
          });
        }

        loader.pause();
        return Promise.resolve();
      }).then(() => {

        assert.equal(loader.state, 'READY', 'finished processing');
        assert.ok(loader.paused(), 'stayed paused');

        loader.load();
        assert.equal(loader.paused(), false, 'unpaused');
      });
    });

    QUnit.test('regularly checks the buffer while unpaused', function(assert) {
      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {

        loader.playlist(playlistWithDuration(90));

        loader.load();
        this.clock.tick(1);

        // fill the buffer
        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), testData());

        loader.buffered_ = () => createTimeRanges([[
          0, Config.GOAL_BUFFER_LENGTH
        ]]);

        if (usesAsyncAppends) {
          return new Promise((resolve, reject) => {
            loader.one('appended', resolve);
            loader.one('error', reject);
          });
        }

        return Promise.resolve();
      }).then(() => {
        assert.notOk(loader.error(), 'loader has no error');
        assert.equal(this.requests.length, 0, 'no outstanding requests');

        // play some video to drain the buffer
        this.currentTime = Config.GOAL_BUFFER_LENGTH;
        this.clock.tick(10 * 1000);
        assert.equal(this.requests.length, 1, 'requested another segment');
      });
    });

    QUnit.test('does not check the buffer while paused', function(assert) {
      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.playlist(playlistWithDuration(90));

        loader.load();
        this.clock.tick(1);

        loader.pause();
        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), testData());

        if (usesAsyncAppends) {
          return new Promise((resolve, reject) => {
            loader.one('appended', resolve);
            loader.one('error', reject);
          });
        }

        return Promise.resolve();
      }).then(() => {
        this.clock.tick(10 * 1000);
        assert.equal(this.requests.length, 0, 'did not make a request');
      });
    });

    QUnit.test('calculates bandwidth after downloading a segment', function(assert) {
      const segment = testData();
      const segmentBytes = segment.byteLength;

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {

        loader.playlist(playlistWithDuration(10));

        loader.load();
        this.clock.tick(1);

        // some time passes and a response is received
        this.clock.tick(100);
        standardXHRResponse(this.requests.shift(), segment);

        if (usesAsyncAppends) {
          return new Promise((resolve, reject) => {
            loader.one('appended', resolve);
            loader.one('error', reject);
          });
        }

        return Promise.resolve();
      }).then(() => {
        assert.equal(
          loader.bandwidth,
          (segmentBytes / 100) * 8 * 1000,
          'calculated bandwidth'
        );
        assert.equal(loader.roundTrip, 100, 'saves request round trip time');
        assert.equal(
          loader.mediaBytesTransferred,
          segmentBytes,
          'saved mediaBytesTransferred'
        );
        assert.equal(loader.mediaTransferDuration, 100, '100 ms (clock above)');
      });
    });

    QUnit.test('segment request timeouts reset bandwidth', function(assert) {
      loader.playlist(playlistWithDuration(10));

      loader.load();
      this.clock.tick(1);

      // a lot of time passes so the request times out
      this.requests[0].timedout = true;
      this.clock.tick(100 * 1000);

      assert.equal(loader.bandwidth, 1, 'reset bandwidth');
      assert.ok(isNaN(loader.roundTrip), 'reset round trip time');
    });

    QUnit.test('segment request timeout triggers timeout event', function(assert) {
      let timeoutEvents = 0;

      loader.on('timeout', () => timeoutEvents++);
      loader.playlist(playlistWithDuration(10));

      loader.load();
      this.clock.tick(1);

      this.requests[0].timedout = true;
      // arbitrary length of time that should lead to a timeout
      this.clock.tick(100 * 1000);

      assert.equal(timeoutEvents, 1, 'triggered timeout event');
    });

    QUnit.test('progress on segment requests are redispatched', function(assert) {
      let progressEvents = 0;

      loader.on('progress', function() {
        progressEvents++;
      });
      loader.playlist(playlistWithDuration(10));

      loader.load();
      this.clock.tick(1);

      this.requests[0].responseText = '';
      this.requests[0].dispatchEvent({ type: 'progress', target: this.requests[0] });
      assert.equal(progressEvents, 1, 'triggered progress');
    });

    QUnit.test(
      'triggers earlyabort at progress events if bandwidth is too low',
      function(assert) {
        const playlist1 = playlistWithDuration(10, { uri: 'playlist1.m3u8' });
        const playlist2 = playlistWithDuration(10, { uri: 'playlist2.m3u8' });
        const playlist3 = playlistWithDuration(10, { uri: 'playlist3.m3u8' });
        const playlist4 = playlistWithDuration(10, { uri: 'playlist4.m3u8' });
        const xhrOptions = {
          timeout: 15000
        };
        let bandwidthupdates = 0;
        let firstProgress = false;

        playlist1.attributes.BANDWIDTH = 18000;
        playlist2.attributes.BANDWIDTH = 10000;
        playlist3.attributes.BANDWIDTH = 8888;
        playlist4.attributes.BANDWIDTH = 7777;

        loader.vhs_.playlists = {
          main: {
            playlists: [
              playlist1,
              playlist2,
              playlist3,
              playlist4
            ]
          }
        };

        const oldHandleProgress = loader.handleProgress_.bind(loader);

        loader.handleProgress_ = (event, simpleSegment) => {
          if (!firstProgress) {
            firstProgress = true;
            assert.equal(
              simpleSegment.stats.firstBytesReceivedAt, Date.now(),
              'firstBytesReceivedAt timestamp added on first progress event with bytes'
            );
          }
          oldHandleProgress(event, simpleSegment);
        };

        let earlyAborts = 0;

        loader.on('earlyabort', () => earlyAborts++);

        loader.on('bandwidthupdate', () => bandwidthupdates++);
        loader.playlist(playlist1, xhrOptions);
        loader.load();

        this.clock.tick(1);

        this.requests[0].responseText = '';
        this.requests[0].dispatchEvent({
          type: 'progress',
          target: this.requests[0],
          loaded: 1
        });

        assert.equal(bandwidthupdates, 0, 'no bandwidth updates yet');
        assert.notOk(this.requests[0].aborted, 'request not prematurely aborted');
        assert.equal(earlyAborts, 0, 'no earlyabort events');

        this.clock.tick(999);

        this.requests[0].dispatchEvent({
          type: 'progress',
          target: this.requests[0],
          loaded: 2000
        });

        assert.equal(bandwidthupdates, 0, 'no bandwidth updates yet');
        assert.notOk(this.requests[0].aborted, 'request not prematurely aborted');
        assert.equal(earlyAborts, 0, 'no earlyabort events');

        this.clock.tick(2);

        this.requests[0].dispatchEvent({
          type: 'progress',
          target: this.requests[0],
          loaded: 2001
        });

        assert.equal(bandwidthupdates, 0, 'bandwidth not updated');
        assert.ok(!this.requests[0].aborted, 'request not aborted');
        assert.equal(earlyAborts, 1, 'earlyabort event triggered');
      }
    );

    QUnit.test(
      'appending a segment when loader is in walk-forward mode triggers bandwidthupdate',
      function(assert) {
        let progresses = 0;

        loader.on('bandwidthupdate', function() {
          progresses++;
        });

        return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {

          loader.playlist(playlistWithDuration(20));
          loader.load();

          this.clock.tick(1);

          standardXHRResponse(this.requests.shift(), testData());

          if (usesAsyncAppends) {
            return new Promise((resolve, reject) => {
              loader.one('appended', resolve);
              loader.one('error', reject);
            });
          }

          return Promise.resolve();
        }).then(() => {
          assert.equal(progresses, 0, 'no bandwidthupdate fired');

          this.clock.tick(2);
          // if mediaIndex is set, then the SegmentLoader is in walk-forward mode
          loader.mediaIndex = 1;

          standardXHRResponse(this.requests.shift(), testData());

          if (usesAsyncAppends) {
            return new Promise((resolve, reject) => {
              loader.one('appended', resolve);
              loader.one('error', reject);
            });
          }

          return Promise.resolve();
        }).then(function() {
          assert.equal(progresses, 1, 'fired bandwidthupdate');
        });
      }
    );

    QUnit.test('only requests one segment at a time', function(assert) {
      loader.playlist(playlistWithDuration(10));

      loader.load();
      this.clock.tick(1);

      // a bunch of time passes without recieving a response
      this.clock.tick(20 * 1000);
      assert.equal(this.requests.length, 1, 'only one request was made');
    });

    if (initSegments) {
      QUnit.test('downloads init segments if specified', function(assert) {
        return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_, {isVideoOnly: true}).then(() => {
          const playlist = playlistWithDuration(20);
          const map = {
            resolvedUri: 'mainInitSegment',
            byterange: {
              length: 20,
              offset: 0
            }
          };

          playlist.segments[0].map = map;
          playlist.segments[1].map = map;
          loader.playlist(playlist);

          loader.load();
          this.clock.tick(1);

          assert.equal(this.requests.length, 2, 'made requests');
          assert.equal(this.requests[0].url, 'mainInitSegment', 'requested the init segment');

          standardXHRResponse(this.requests.shift(), mp4VideoInitSegment());

          assert.equal(this.requests[0].url, '0.ts', 'requested the segment');

          standardXHRResponse(this.requests.shift(), mp4VideoSegment());

          if (usesAsyncAppends) {
            return new Promise((resolve, reject) => {
              loader.one('appended', resolve);
              loader.one('error', reject);
            });
          }

          return Promise.resolve();
        }).then(() => {
          this.clock.tick(1);

          assert.equal(this.requests.length, 1, 'made a request');
          assert.equal(
            this.requests[0].url, '1.ts',
            'did not re-request the init segment'
          );
        });
      });

      QUnit.test('detects init segment changes and downloads it', function(assert) {
        return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_, {isVideoOnly: true}).then(() => {
          const playlist = playlistWithDuration(20);
          const buffered = createTimeRanges();

          playlist.segments[0].map = {
            resolvedUri: 'init0',
            byterange: {
              length: 20,
              offset: 0
            }
          };
          playlist.segments[1].map = {
            resolvedUri: 'init0',
            byterange: {
              length: 20,
              offset: 20
            }
          };

          loader.buffered_ = () => buffered;
          loader.playlist(playlist);

          loader.load();
          this.clock.tick(1);

          assert.equal(this.requests.length, 2, 'made requests');

          assert.equal(this.requests[0].url, 'init0', 'requested the init segment');
          assert.equal(
            this.requests[0].headers.Range, 'bytes=0-19',
            'requested the init segment byte range'
          );
          standardXHRResponse(this.requests.shift(), mp4VideoInitSegment());
          assert.equal(
            this.requests[0].url, '0.ts',
            'requested the segment'
          );
          standardXHRResponse(this.requests.shift(), mp4VideoSegment());

          if (usesAsyncAppends) {
            return new Promise((resolve, reject) => {
              loader.one('appended', resolve);
              loader.one('error', reject);
            });
          }

          return Promise.resolve();
        }).then(() => {
          this.clock.tick(1);

          assert.equal(this.requests.length, 2, 'made requests');
          assert.equal(this.requests[0].url, 'init0', 'requested the init segment');
          assert.equal(
            this.requests[0].headers.Range, 'bytes=20-39',
            'requested the init segment byte range'
          );
          assert.equal(
            this.requests[1].url, '1.ts',
            'did not re-request the init segment'
          );
        });
      });
    }

    QUnit.test('request error increments mediaRequestsErrored stat', function(assert) {
      loader.playlist(playlistWithDuration(20));

      loader.load();
      this.clock.tick(1);

      this.requests.shift().respond(404, null, '');

      // verify stats
      assert.equal(loader.mediaRequests, 1, '1 request');
      assert.equal(loader.mediaRequestsErrored, 1, '1 errored request');
    });

    QUnit.test('request timeout increments mediaRequestsTimedout stat', function(assert) {
      loader.playlist(playlistWithDuration(20));

      loader.load();
      this.clock.tick(1);
      this.requests[0].timedout = true;
      this.clock.tick(100 * 1000);

      // verify stats
      assert.equal(loader.mediaRequests, 1, '1 request');
      assert.equal(loader.mediaRequestsTimedout, 1, '1 timed-out request');
    });

    QUnit.test('request abort increments mediaRequestsAborted stat', function(assert) {
      loader.playlist(playlistWithDuration(20));

      loader.load();
      this.clock.tick(1);

      loader.abort();
      this.clock.tick(1);

      // verify stats
      // right now, aborted requests are not counted in media requests, but this may be
      // changed in the future
      assert.equal(loader.mediaRequests, 0, '0 requests');
      assert.equal(loader.mediaRequestsAborted, 1, '1 aborted request');
    });

    QUnit.test('SegmentLoader.mediaIndex is adjusted when live playlist is updated', function(assert) {
      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {

        loader.playlist(playlistWithDuration(50, {
          mediaSequence: 0,
          endList: false
        }));

        loader.load();
        // Start at mediaIndex 2 which means that the next segment we request
        // should mediaIndex 3
        loader.mediaIndex = 2;
        this.clock.tick(1);

        assert.equal(loader.mediaIndex, 2, 'SegmentLoader.mediaIndex starts at 2');
        assert.equal(
          this.requests[0].url,
          '3.ts',
          'requesting the segment at mediaIndex 3'
        );
        standardXHRResponse(this.requests.shift(), testData());

        if (usesAsyncAppends) {
          return new Promise((resolve, reject) => {
            loader.one('appended', resolve);
            loader.one('error', reject);
          });
        }

        return Promise.resolve();
      }).then(() => {
        assert.equal(loader.mediaIndex, 3, 'mediaIndex ends at 3');

        this.clock.tick(1);

        assert.equal(loader.mediaIndex, 3, 'SegmentLoader.mediaIndex starts at 3');
        assert.equal(
          this.requests[0].url,
          '4.ts',
          'requesting the segment at mediaIndex 4'
        );

        // Update the playlist shifting the mediaSequence by 2 which will result
        // in a decrement of the mediaIndex by 2 to 1
        loader.playlist(playlistWithDuration(50, {
          mediaSequence: 2,
          endList: false
        }));

        assert.equal(loader.mediaIndex, 1, 'SegmentLoader.mediaIndex is updated to 1');

        standardXHRResponse(this.requests.shift(), testData());

        if (usesAsyncAppends) {
          return new Promise((resolve, reject) => {
            loader.one('appended', resolve);
            loader.one('error', reject);
          });
        }

        return Promise.resolve();
      }).then(() => {
        assert.equal(loader.mediaIndex, 2, 'SegmentLoader.mediaIndex ends at 2');
      });
    });

    QUnit.test('segmentInfo.mediaIndex is adjusted when live playlist is updated', function(assert) {
      let expectedLoaderIndex = 3;
      const handleAppendsDone_ = loader.handleAppendsDone_.bind(loader);

      loader.handleAppendsDone_ = function() {
        handleAppendsDone_();

        assert.equal(
          loader.mediaIndex,
          expectedLoaderIndex,
          'SegmentLoader.mediaIndex ends at ' + expectedLoaderIndex
        );
        loader.mediaIndex = null;
        loader.fetchAtBuffer_ = false;
        // remove empty flag that may be added by vtt loader
        loader.playlist_.segments.forEach(segment => {
          segment.empty = false;
        });
      };

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {

        // Setting currentTime to 31 so that we start requesting at segment #3
        this.currentTime = 31;
        loader.playlist(playlistWithDuration(50, {
          mediaSequence: 0,
          endList: false
        }));

        loader.load();
        // Start at mediaIndex null which means that the next segment we request
        // should be based on currentTime (mediaIndex 3)
        loader.mediaIndex = null;
        loader.syncPoint_ = {
          segmentIndex: 0,
          time: 0
        };
        this.clock.tick(1);

        const segmentInfo = loader.pendingSegment_;

        assert.equal(segmentInfo.mediaIndex, 3, 'segmentInfo.mediaIndex starts at 3');
        assert.equal(
          this.requests[0].url,
          '3.ts',
          'requesting the segment at mediaIndex 3'
        );
        standardXHRResponse(this.requests.shift(), testData());

        if (usesAsyncAppends) {
          return new Promise((resolve, reject) => {
            loader.one('appended', resolve);
            loader.one('error', reject);
          });
        }

        return Promise.resolve();
      }).then(() => {
        this.clock.tick(1);

        const segmentInfo = loader.pendingSegment_;

        assert.equal(segmentInfo.mediaIndex, 4, 'segmentInfo.mediaIndex starts at 4');
        assert.equal(
          this.requests[0].url,
          '4.ts',
          'requesting the segment at mediaIndex 4'
        );

        // Update the playlist shifting the mediaSequence by 2 which will result
        // in a decrement of the mediaIndex by 2 to 1
        loader.playlist(playlistWithDuration(50, {
          mediaSequence: 2,
          endList: false
        }));

        assert.equal(segmentInfo.mediaIndex, 2, 'segmentInfo.mediaIndex is updated to 2');
        expectedLoaderIndex = 2;

        standardXHRResponse(this.requests.shift(), testData());

        if (usesAsyncAppends) {
          return new Promise((resolve, reject) => {
            loader.one('appended', resolve);
            loader.one('error', reject);
          });
        }

        return Promise.resolve();
      });
    });

    QUnit.test('live LLHLS rendition switch uses resetLoader', function(assert) {
      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {

        loader.playlist(playlistWithDuration(50, {
          mediaSequence: 0,
          endList: false
        }));

        loader.load();
        loader.mediaIndex = 0;
        let resyncCalled = false;
        let resetCalled = false;
        const origReset = loader.resetLoader;
        const origResync = loader.resyncLoader;

        loader.resetLoader = function() {
          resetCalled = true;
          return origReset.call(loader);
        };

        loader.resyncLoader = function() {
          resyncCalled = true;
          return origResync.call(loader);
        };

        const newPlaylist = playlistWithDuration(50, {
          mediaSequence: 0,
          endList: false
        });

        newPlaylist.uri = 'playlist2.m3u8';
        newPlaylist.partTargetDuration = 1;

        loader.playlist(newPlaylist);

        assert.true(resetCalled, 'reset was called');
        assert.true(resyncCalled, 'resync was called');

        return Promise.resolve();
      });
    });

    QUnit.test('live rendition switch uses resyncLoader', function(assert) {
      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {

        loader.playlist(playlistWithDuration(50, {
          mediaSequence: 0,
          endList: false
        }));

        loader.load();
        loader.mediaIndex = 0;
        let resyncCalled = false;
        let resetCalled = false;
        const origReset = loader.resetLoader;
        const origResync = loader.resyncLoader;

        loader.resetLoader = function() {
          resetCalled = true;
          return origReset.call(loader);
        };

        loader.resyncLoader = function() {
          resyncCalled = true;
          return origResync.call(loader);
        };

        const newPlaylist = playlistWithDuration(50, {
          mediaSequence: 0,
          endList: false
        });

        newPlaylist.uri = 'playlist2.m3u8';

        loader.playlist(newPlaylist);

        assert.true(resyncCalled, 'resync was called');
        assert.false(resetCalled, 'reset was not called');

        return Promise.resolve();
      });
    });

    QUnit.test('vod rendition switch uses resyncLoader', function(assert) {
      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {

        loader.playlist(playlistWithDuration(50, {
          mediaSequence: 0,
          endList: true
        }));

        loader.load();
        loader.mediaIndex = 0;
        let resyncCalled = false;
        let resetCalled = false;
        const origReset = loader.resetLoader;
        const origResync = loader.resyncLoader;

        loader.resetLoader = function() {
          resetCalled = true;
          return origReset.call(loader);
        };

        loader.resyncLoader = function() {
          resyncCalled = true;
          return origResync.call(loader);
        };

        const newPlaylist = playlistWithDuration(50, {
          mediaSequence: 0,
          endList: true
        });

        newPlaylist.uri = 'playlist2.m3u8';

        loader.playlist(newPlaylist);

        assert.true(resyncCalled, 'resync was called');
        assert.false(resetCalled, 'reset was not called');

        return Promise.resolve();
      });
    });

    // only main/fmp4 segment loaders use async appends and parts/partIndex
    if (usesAsyncAppends) {
      QUnit.test('playlist change before any appends does not error', function(assert) {
        return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
          loader.playlist(playlistWithDuration(50, {
            uri: 'bar-720.m3u8',
            mediaSequence: 0,
            endList: true
          }));

          loader.load();
          this.clock.tick(1);
          return Promise.resolve();
        }).then(() => new Promise((resolve, reject) => {
          loader.on('trackinfo', () => {
            loader.on('playlistupdate', () => {
              this.clock.tick(1);
              resolve();
            });

            loader.playlist(playlistWithDuration(50, {
              uri: 'bar-1080.m3u8',
              mediaSequence: 0,
              endList: true
            }));
          });
          standardXHRResponse(this.requests.shift(), tsVideoSegment());

        })).then(() => {
          assert.equal(loader.pendingSegment_.playlist.uri, 'bar-720.m3u8', 'previous playlist segment');
        });
      });

      QUnit.test('mediaIndex and partIndex are used', function(assert) {
        return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
          loader.playlist(playlistWithDuration(50, {
            mediaSequence: 0,
            endList: false,
            llhls: true
          }));

          loader.load();
          loader.mediaIndex = 2;
          return Promise.resolve();
        }).then(() => appendPart.call(this, 2, 0))
          .then(() => appendPart.call(this, 2, 1))
          .then(() => appendPart.call(this, 2, 2))
          .then(() => appendPart.call(this, 2, 3))
          .then(() => appendPart.call(this, 2, 4))
          .then(() => appendPart.call(this, 3, 0));
      });

      QUnit.test('mediaIndex and partIndex survive playlist change', function(assert) {
        return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
          loader.playlist(playlistWithDuration(50, {
            mediaSequence: 0,
            endList: false,
            llhls: true
          }));

          loader.load();
          loader.mediaIndex = 4;
          return Promise.resolve();
        }).then(() => appendPart.call(this, 4, 0))
          .then(() => appendPart.call(this, 4, 1))
          .then(() => appendPart.call(this, 4, 2))
          .then(() => {

            // Update the playlist shifting the mediaSequence by 2 which will result
            // in a decrement of the mediaIndex by 2 to 1
            loader.playlist(playlistWithDuration(50, {
              mediaSequence: 2,
              endList: false,
              llhls: true
            }));
            // verify that we still try to append the next part for that segment.
            return appendPart.call(this, 2, 3);
          }).then(() => appendPart.call(this, 2, 4));
      });

      QUnit.test('drops partIndex if playlist update drops parts', function(assert) {
        loader.duration_ = () => Infinity;
        return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
          loader.playlist(playlistWithDuration(50, {
            mediaSequence: 0,
            endList: false,
            llhls: true
          }));

          loader.load();
          loader.mediaIndex = 4;
          return Promise.resolve();
        }).then(() => appendPart.call(this, 4, 0))
          .then(() => appendPart.call(this, 4, 1))
          .then(() => appendPart.call(this, 4, 2))
          .then(() => {

            // Update the playlist shifting the mediaSequence by 4 which will result
            // in a decrement of the mediaIndex by 4 to 0
            loader.playlist(playlistWithDuration(50, {
              mediaSequence: 4,
              endList: false,
              llhls: true
            }));

            assert.equal(loader.partIndex, null, 'partIndex was dropped');
            this.clock.tick(1);

            assert.equal(
              this.requests[0].url,
              '0.ts',
              'requested mediaIndex 0 only'
            );
          });
      });
    }

    QUnit.test('segment 404s should trigger an error', function(assert) {
      const errors = [];

      loader.playlist(playlistWithDuration(10));

      loader.load();
      this.clock.tick(1);

      loader.on('error', function(error) {
        errors.push(error);
      });
      this.requests.shift().respond(404, null, '');

      assert.equal(errors.length, 1, 'triggered an error');
      assert.equal(loader.error().code, 2, 'triggered MEDIA_ERR_NETWORK');
      assert.ok(loader.error().xhr, 'included the request object');
      assert.ok(loader.paused(), 'paused the loader');
      assert.equal(loader.state, 'READY', 'returned to the ready state');
    });

    QUnit.test('empty segments should trigger an error', function(assert) {
      const errors = [];

      loader.playlist(playlistWithDuration(10));

      loader.load();
      this.clock.tick(1);

      loader.on('error', function(error) {
        errors.push(error);
      });
      this.requests[0].response = new Uint8Array(0).buffer;
      this.requests.shift().respond(200, null, '');

      assert.equal(errors.length, 1, 'triggered an error');
      assert.equal(loader.error().code, 2, 'triggered MEDIA_ERR_NETWORK');
      assert.ok(loader.error().xhr, 'included the request object');
      assert.ok(loader.paused(), 'paused the loader');
      assert.equal(loader.state, 'READY', 'returned to the ready state');
    });

    QUnit.test('segment 5xx status codes trigger an error', function(assert) {
      const errors = [];

      loader.playlist(playlistWithDuration(10));

      loader.load();
      this.clock.tick(1);

      loader.on('error', function(error) {
        errors.push(error);
      });
      this.requests.shift().respond(500, null, '');

      assert.equal(errors.length, 1, 'triggered an error');
      assert.equal(loader.error().code, 2, 'triggered MEDIA_ERR_NETWORK');
      assert.ok(loader.error().xhr, 'included the request object');
      assert.ok(loader.paused(), 'paused the loader');
      assert.equal(loader.state, 'READY', 'returned to the ready state');
    });

    QUnit.test('remains ready if there are no segments', function(assert) {
      loader.playlist(playlistWithDuration(0));

      loader.load();
      this.clock.tick(1);

      assert.equal(loader.state, 'READY', 'in the ready state');
    });

    QUnit.test('dispose cleans up outstanding work', function(assert) {
      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {

        loader.playlist(playlistWithDuration(20));

        loader.load();
        this.clock.tick(1);
        loader.dispose();

        assert.ok(this.requests[0].aborted, 'aborted segment request');
        assert.equal(this.requests.length, 1, 'did not open another request');
      });
    });

    // ----------
    // Decryption
    // ----------

    QUnit.test(
      'calling load with an encrypted segment requests key and segment',
      function(assert) {
        assert.equal(loader.state, 'INIT', 'starts in the init state');
        loader.playlist(playlistWithDuration(10, {isEncrypted: true}));
        assert.equal(loader.state, 'INIT', 'starts in the init state');
        assert.ok(loader.paused(), 'starts paused');

        loader.load();
        this.clock.tick(1);

        assert.equal(loader.state, 'WAITING', 'moves to the ready state');
        assert.ok(!loader.paused(), 'loading is not paused');
        assert.equal(this.requests.length, 2, 'requested a segment and key');
        assert.equal(
          this.requests[0].url,
          '0-key.php',
          'requested the first segment\'s key'
        );
        assert.equal(this.requests[1].url, '0.ts', 'requested the first segment');
      }
    );

    QUnit.test('dispose cleans up key requests for encrypted segments', function(assert) {
      loader.playlist(playlistWithDuration(20, {isEncrypted: true}));

      loader.load();
      this.clock.tick(1);

      loader.dispose();
      assert.equal(this.requests.length, 2, 'requested a segment and key');
      assert.equal(
        this.requests[0].url,
        '0-key.php',
        'requested the first segment\'s key'
      );
      assert.ok(this.requests[0].aborted, 'aborted the first segment\s key request');
      assert.equal(this.requests.length, 2, 'did not open another request');
    });

    QUnit.test('key 404s pauses the loader and triggers error', function(assert) {
      const errors = [];

      loader.playlist(playlistWithDuration(10, {isEncrypted: true}));

      loader.load();
      this.clock.tick(1);

      loader.on('error', function(error) {
        errors.push(error);
      });
      this.requests.shift().respond(404, null, '');
      this.clock.tick(1);

      assert.equal(errors.length, 1, 'triggered an error');
      assert.equal(loader.error().code, 2, 'triggered MEDIA_ERR_NETWORK');
      assert.equal(
        loader.error().message, 'HLS request errored at URL: 0-key.php',
        'receieved a key error message'
      );
      assert.ok(loader.error().xhr, 'included the request object');
      assert.ok(loader.paused(), 'paused the loader');
      assert.equal(loader.state, 'READY', 'returned to the ready state');
    });

    QUnit.test('key 500 status code pauses loader and triggers error', function(assert) {
      const errors = [];

      loader.playlist(playlistWithDuration(10, {isEncrypted: true}));

      loader.load();
      this.clock.tick(1);

      loader.on('error', function(error) {
        errors.push(error);
      });
      this.requests.shift().respond(500, null, '');

      assert.equal(errors.length, 1, 'triggered an error');
      assert.equal(loader.error().code, 2, 'triggered MEDIA_ERR_NETWORK');
      assert.equal(
        loader.error().message, 'HLS request errored at URL: 0-key.php',
        'receieved a key error message'
      );
      assert.ok(loader.error().xhr, 'included the request object');
      assert.ok(loader.paused(), 'paused the loader');
      assert.equal(loader.state, 'READY', 'returned to the ready state');
    });

    QUnit.test('key request timeouts reset bandwidth', function(assert) {
      loader.playlist(playlistWithDuration(10, {isEncrypted: true}));

      loader.load();
      this.clock.tick(1);

      assert.equal(
        this.requests[0].url,
        '0-key.php',
        'requested the first segment\'s key'
      );
      assert.equal(this.requests[1].url, '0.ts', 'requested the first segment');
      // a lot of time passes so the request times out
      this.requests[0].timedout = true;
      this.clock.tick(100 * 1000);

      assert.equal(loader.bandwidth, 1, 'reset bandwidth');
      assert.ok(isNaN(loader.roundTrip), 'reset round trip time');
    });

    QUnit.test(
      'checks the goal buffer configuration every loading opportunity',
      function(assert) {
        loader.buffered_ = () => createTimeRanges([[0, 1]]);
        const playlist = playlistWithDuration(20);

        loader.mediaIndex = null;
        loader.hasPlayed_ = () => false;
        loader.currentTime_ = () => 0;
        loader.syncPoint_ = null;
        const defaultGoal = Config.GOAL_BUFFER_LENGTH;

        Config.GOAL_BUFFER_LENGTH = 1;

        loader.playlist(playlist);
        loader.load();

        const segmentInfo = loader.chooseNextRequest_();

        assert.ok(!segmentInfo, 'no request generated');
        Config.GOAL_BUFFER_LENGTH = defaultGoal;
      }
    );

    QUnit.test(
      'does not choose to request if next index is last, we have ended, and are not seeking',
      function(assert) {
        loader.buffered_ = () => createTimeRanges([[0, 1]]);
        const playlist = playlistWithDuration(20);

        loader.hasPlayed_ = () => true;
        loader.currentTime_ = () => 0;
        loader.syncPoint_ = null;
        loader.mediaSource_ = {readyState: 'ended'};

        loader.playlist(playlist);
        loader.load();
        loader.mediaIndex = playlist.segments.length - 2;

        const segmentInfo = loader.chooseNextRequest_();

        assert.ok(!segmentInfo, 'no request generated');
      }
    );
    QUnit.test(
      'does choose to request if next index is last, we have ended, and are seeking',
      function(assert) {
        loader.buffered_ = () => createTimeRanges([[0, 1]]);
        const playlist = playlistWithDuration(20);

        loader.hasPlayed_ = () => true;
        loader.currentTime_ = () => 0;
        loader.syncPoint_ = null;
        loader.mediaSource_ = {readyState: 'ended'};

        loader.playlist(playlist);
        loader.load();
        loader.mediaIndex = playlist.segments.length - 2;
        loader.seeking_ = () => true;

        const segmentInfo = loader.chooseNextRequest_();

        assert.ok(segmentInfo, 'request generated');
      }
    );

    QUnit.test(
      'does not skip over segment if live playlist update occurs while processing',
      function(assert) {
        return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
          const playlist = playlistWithDuration(40);

          playlist.endList = false;

          loader.playlist(playlist);

          loader.load();
          this.clock.tick(1);

          assert.equal(loader.pendingSegment_.uri, '0.ts', 'retrieving first segment');
          assert.equal(
            loader.pendingSegment_.segment.uri,
            '0.ts',
            'correct segment reference'
          );
          assert.equal(loader.state, 'WAITING', 'waiting for response');

          standardXHRResponse(this.requests.shift(), testData());
          // playlist updated during append
          const playlistUpdated = playlistWithDuration(40);

          playlistUpdated.segments.shift();
          playlistUpdated.mediaSequence++;
          loader.playlist(playlistUpdated);
          // finish append
          if (usesAsyncAppends) {
            return new Promise((resolve, reject) => {
              loader.one('appended', resolve);
              loader.one('error', reject);
            });
          }

          return Promise.resolve();
        }).then(() => {
          this.clock.tick(1);

          assert.equal(loader.pendingSegment_.uri, '1.ts', 'retrieving second segment');
          assert.equal(
            loader.pendingSegment_.segment.uri,
            '1.ts',
            'correct segment reference'
          );
          assert.equal(loader.state, 'WAITING', 'waiting for response');
        });
      }
    );

    QUnit.test('chooses the previous part if not buffered and current is not independent', function(assert) {
      loader.buffered_ = () => createTimeRanges();
      const playlist = playlistWithDuration(50, {llhls: true});

      loader.hasPlayed_ = () => true;
      loader.syncPoint_ = null;

      loader.playlist(playlist);
      loader.load();

      // force segmentIndex 4 and part 2 to be choosen
      loader.currentTime_ = () => 46;
      // make the previous part indepenent so we go back to it
      playlist.segments[4].parts[2].independent = true;
      // debugger;
      const segmentInfo = loader.chooseNextRequest_();

      assert.equal(segmentInfo.partIndex, 2, 'still chooses partIndex 2');
      assert.equal(segmentInfo.mediaIndex, 4, 'same segment');

      // force segmentIndex 4 and part 0 to be choosen
      loader.currentTime_ = () => 40;
      // make the previous part independent
      playlist.segments[3].parts[4].independent = true;
      const segmentInfo2 = loader.chooseNextRequest_();

      assert.equal(segmentInfo2.partIndex, 4, 'previous part');
      assert.equal(segmentInfo2.mediaIndex, 3, 'previous segment');
    });

    QUnit.test('chooses the correct next segment if independentSegments is true on the playlist', function(assert) {
      loader.buffered_ = () => createTimeRanges();
      const playlist = playlistWithDuration(50, {llhls: true});

      playlist.independentSegments = true;

      loader.hasPlayed_ = () => true;
      loader.syncPoint_ = null;

      loader.playlist(playlist);
      loader.load();

      loader.currentTime_ = () => 46;
      // make the previous part indepenent, ensure we don't go back to that part.
      playlist.segments[4].parts[1].independent = true;
      const segmentInfo = loader.chooseNextRequest_();

      assert.equal(segmentInfo.partIndex, 3, 'chooses part 3');
      assert.equal(segmentInfo.mediaIndex, 4, 'same segment');
    });

    QUnit.test('chooses the correct next segment if independentSegments is true on the main playlist', function(assert) {
      loader.buffered_ = () => createTimeRanges();
      const playlist = playlistWithDuration(50, {llhls: true});

      loader.vhs_.playlists = {
        main: {
          independentSegments: true
        }
      };

      loader.hasPlayed_ = () => true;
      loader.syncPoint_ = null;

      loader.playlist(playlist);
      loader.load();

      loader.currentTime_ = () => 46;
      // make the previous part indepenent, ensure we don't go back to that part.
      playlist.segments[4].parts[1].independent = true;
      const segmentInfo = loader.chooseNextRequest_();

      assert.equal(segmentInfo.partIndex, 3, 'chooses part 3');
      assert.equal(segmentInfo.mediaIndex, 4, 'same segment');
    });

    QUnit.test('processing segment reachable even after playlist update removes it', function(assert) {
      const handleAppendsDone_ = loader.handleAppendsDone_.bind(loader);
      let expectedURI = '0.ts';

      loader.handleAppendsDone_ = () => {
        // we need to check for the right state, as normally handleResponse would throw an
        // error under failing cases, but sinon swallows it as part of fake XML HTTP
        // request's response
        assert.equal(loader.state, 'APPENDING', 'moved to appending state');
        assert.equal(loader.pendingSegment_.uri, expectedURI, 'correct pending segment');
        assert.equal(
          loader.pendingSegment_.segment.uri,
          expectedURI,
          'correct segment reference'
        );

        handleAppendsDone_();
      };

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {

        const playlist = playlistWithDuration(40);

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
        standardXHRResponse(this.requests.shift(), testData());

        if (usesAsyncAppends) {
          return new Promise((resolve, reject) => {
            loader.one('appended', resolve);
            loader.one('error', reject);
          });
        }

        return Promise.resolve();
      }).then(() => {
        this.clock.tick(1);

        assert.equal(loader.state, 'WAITING', 'in waiting state');
        assert.equal(loader.pendingSegment_.uri, '1.ts', 'second segment pending');
        assert.equal(
          loader.pendingSegment_.segment.uri,
          '1.ts',
          'correct segment reference'
        );

        // playlist updated during waiting
        const playlistUpdated = playlistWithDuration(40);

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

        expectedURI = '1.ts';
        standardXHRResponse(this.requests.shift(), testData());

        if (usesAsyncAppends) {
          return new Promise((resolve, reject) => {
            loader.one('appended', resolve);
            loader.one('error', reject);
          });
        }

        return Promise.resolve();
      });
    });

    QUnit.test('new playlist always triggers syncinfoupdate', function(assert) {
      let playlist = playlistWithDuration(100, { endList: false });
      let syncInfoUpdates = 0;

      loader.on('syncinfoupdate', () => syncInfoUpdates++);

      loader.playlist(playlist);

      loader.load();

      assert.equal(syncInfoUpdates, 1, 'first playlist triggers an update');
      loader.playlist(playlist);
      assert.equal(syncInfoUpdates, 2, 'same playlist triggers an update');
      playlist = playlistWithDuration(100, { endList: false });
      loader.playlist(playlist);
      assert.equal(syncInfoUpdates, 3, 'new playlist with same info triggers an update');
      playlist.segments[0].start = 10;
      playlist = playlistWithDuration(100, { endList: false, mediaSequence: 1 });
      loader.playlist(playlist);
      assert.equal(
        syncInfoUpdates,
        5,
        'new playlist after expiring segment triggers two updates'
      );
    });

    QUnit.module('Segment Key Caching');

    QUnit.test('segmentKey will cache new encrypted keys with cacheEncryptionKeys true', function(assert) {
      loader.cacheEncryptionKeys_ = true;

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
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

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
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

    QUnit.test('segment requests use cached keys when available', function(assert) {
      loader.cacheEncryptionKeys_ = true;

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
          loader.playlist(playlistWithDuration(20, { isEncrypted: true }));

          // make the keys the same
          loader.playlist_.segments[1].key =
            merge({}, loader.playlist_.segments[0].key);
          // give 2nd key an iv
          loader.playlist_.segments[1].key.iv = new Uint32Array([0, 1, 2, 3]);

          loader.load();
          this.clock.tick(1);

          assert.strictEqual(this.requests.length, 2, 'one request');
          assert.strictEqual(this.requests[0].uri, '0-key.php', 'key request');
          assert.strictEqual(this.requests[1].uri, '0.ts', 'segment request');

          // key response
          standardXHRResponse(this.requests.shift(), encryptedSegmentKeyFn());
          this.clock.tick(1);

          // segment
          standardXHRResponse(this.requests.shift(), encryptedSegmentFn());
          this.clock.tick(1);

          // decryption tick for syncWorker
          this.clock.tick(1);

          // tick for web worker segment probe
          this.clock.tick(1);
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

    QUnit.test('segment requests make key requests when key isn\'t cached', function(assert) {
      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
          loader.playlist(playlistWithDuration(20, { isEncrypted: true }));

          loader.load();
          this.clock.tick(1);

          assert.strictEqual(this.requests.length, 2, 'one request');
          assert.strictEqual(this.requests[0].uri, '0-key.php', 'key request');
          assert.strictEqual(this.requests[1].uri, '0.ts', 'segment request');

          // key response
          standardXHRResponse(this.requests.shift(), encryptedSegmentKeyFn());
          this.clock.tick(1);

          // segment
          standardXHRResponse(this.requests.shift(), encryptedSegmentFn());
          this.clock.tick(1);

          // decryption tick for syncWorker
          this.clock.tick(1);
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

    QUnit.module('Loading Calculation');

    QUnit.test('requests the first segment with an empty buffer', function(assert) {
      loader.buffered_ = () => createTimeRanges();
      loader.playlist_ = playlistWithDuration(20);
      loader.mediaIndex = null;
      loader.hasPlayed_ = () => false;
      loader.currentTime_ = () => 0;
      loader.syncPoint_ = null;

      const segmentInfo = loader.chooseNextRequest_();

      assert.ok(segmentInfo, 'generated a request');
      assert.equal(segmentInfo.uri, '0.ts', 'requested the first segment');
    });

    QUnit.test(
      'no request if video not played and 1 segment is buffered',
      function(assert) {
        loader.buffered_ = () => createTimeRanges([[0, 1]]);
        loader.playlist_ = playlistWithDuration(20);
        loader.mediaIndex = 0;
        loader.hasPlayed_ = () => false;
        loader.currentTime_ = () => 0;
        loader.syncPoint_ = null;

        const segmentInfo = loader.chooseNextRequest_();

        assert.ok(!segmentInfo, 'no request generated');
      }
    );

    QUnit.test(
      'does not download the next segment if the buffer is full',
      function(assert) {
        loader.buffered_ = () => createTimeRanges([[0, 30 + Config.GOAL_BUFFER_LENGTH]]);
        loader.playlist_ = playlistWithDuration(30);
        loader.mediaIndex = null;
        loader.hasPlayed_ = () => true;
        loader.currentTime_ = () => 15;
        loader.syncPoint_ = {segmentIndex: 0, time: 0};

        const segmentInfo = loader.chooseNextRequest_();

        assert.ok(!segmentInfo, 'no segment request generated');
      }
    );

    QUnit.test(
      'downloads the next segment if the buffer is getting low',
      function(assert) {
        loader.buffered_ = () => createTimeRanges([[0, 19.999]]);
        loader.playlist_ = playlistWithDuration(30);
        loader.mediaIndex = 1;
        loader.hasPlayed_ = () => true;
        loader.currentTime_ = () => 15;
        loader.syncPoint_ = {segmentIndex: 0, time: 0};

        const segmentInfo = loader.chooseNextRequest_();

        assert.ok(segmentInfo, 'made a request');
        assert.equal(segmentInfo.uri, '2.ts', 'requested the third segment');
      }
    );

    QUnit.test('stops downloading segments at the end of the playlist', function(assert) {
      loader.buffered_ = () => createTimeRanges([[0, 60]]);
      loader.playlist_ = playlistWithDuration(60);
      loader.mediaIndex = null;
      loader.hasPlayed_ = () => true;
      loader.currentTime_ = () => 0;
      loader.syncPoint_ = null;
      const segmentInfo = loader.chooseNextRequest_();

      assert.ok(!segmentInfo, 'no request was made');
    });

    QUnit.test(
      'stops downloading segments if buffered past reported end of the playlist',
      function(assert) {
        loader.buffered_ = () => createTimeRanges([[0, 59.9]]);
        loader.playlist_ = playlistWithDuration(60);
        loader.mediaIndex = loader.playlist_.segments.length - 1;
        loader.hasPlayed_ = () => true;
        loader.currentTime_ = () => 50;
        loader.syncPoint_ = { segmentIndex: 0, time: 0 };
        loader.playlist_.segments[loader.playlist_.segments.length - 1].end = 59.9;

        const segmentInfo = loader.chooseNextRequest_();

        assert.ok(!segmentInfo, 'no request was made');
      }
    );

    QUnit.test(
      'doesn\'t allow more than one monitor buffer timer to be set',
      function(assert) {
        const timeoutCount = this.clock.methods.length;

        loader.monitorBuffer_();

        assert.equal(
          this.clock.methods.length,
          timeoutCount,
          'timeout count remains the same'
        );

        loader.monitorBuffer_();

        assert.equal(
          this.clock.methods.length,
          timeoutCount,
          'timeout count remains the same'
        );

        loader.monitorBuffer_();
        loader.monitorBuffer_();

        assert.equal(
          this.clock.methods.length,
          timeoutCount,
          'timeout count remains the same'
        );
      }
    );

    QUnit.test('maintains initial sync info if playlist is changed before playback starts', function(assert) {
      loader.playlist(playlistWithDuration(50, {
        mediaSequence: 1,
        endList: false
      }));

      assert.deepEqual(
        loader.playlist_.syncInfo,
        {
          mediaSequence: 1,
          time: 0
        },
        'updated sync info to start at media sequence 1 and time 0'
      );

      loader.playlist(playlistWithDuration(50, {
        mediaSequence: 2,
        endList: false
      }));

      assert.deepEqual(
        loader.playlist_.syncInfo,
        {
          mediaSequence: 2,
          time: 0
        },
        'updated sync info to start at media sequence 2 and time 0'
      );

      loader.load();

      loader.playlist(playlistWithDuration(50, {
        mediaSequence: 2,
        endList: false
      }));

      assert.notOk(loader.playlist_.syncInfo, 'did not set sync info on new playlist');
    });

    QUnit.test('maintains initial sync info if playlist is changed while segment in-flight', function(assert) {
      loader.playlist(playlistWithDuration(50, {
        mediaSequence: 1,
        endList: false
      }));

      assert.deepEqual(
        loader.playlist_.syncInfo,
        {
          mediaSequence: 1,
          time: 0
        },
        'updated sync info to start at media sequence 1 and time 0'
      );

      assert.equal(this.requests.length, 0, 'no in-flight requests');
      loader.load();
      this.clock.tick(1);
      assert.equal(this.requests.length, 1, 'one in-flight requests');

      loader.playlist(playlistWithDuration(50, {
        mediaSequence: 2,
        endList: false
      }));

      assert.notOk(loader.playlist_.syncInfo, 'did not set sync info on new playlist');
    });
  });
};
