import QUnit from 'qunit';
import sinon from 'sinon';
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
} from '@videojs/vhs-utils/es/codecs.js';
import manifests from 'create-test-data!manifests';
import {
  PlaylistController
} from '../src/playlist-controller';
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
  addPropertiesToMain
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
import {merge, createTimeRanges} from '../src/util/vjs-compat';

const sharedHooks = {
  beforeEach(assert) {
    this.oldTypeSupported = window.MediaSource.isTypeSupported;
    this.oldChangeType = window.SourceBuffer.prototype.changeType;

    this.env = useFakeEnvironment(assert);
    this.clock = this.env.clock;
    this.requests = this.env.requests;
    this.mse = useFakeMediaSource();

    this.oldDevicePixelRatio = window.devicePixelRatio;
    window.devicePixelRatio = 1;

    // force the HLS tech to run
    this.origSupportsNativeHls = videojs.Vhs.supportsNativeHls;
    videojs.Vhs.supportsNativeHls = false;
    this.oldBrowser = videojs.browser;
    videojs.browser = merge({}, videojs.browser);
    this.player = createPlayer(merge({}, this.playerOptions));
    this.player.src({
      src: 'manifest/main.m3u8',
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

    this.playlistController = this.player.tech_.vhs.playlistController_;

    // Make segment metadata noop since most test segments dont have real data
    this.playlistController.mainSegmentLoader_.addSegmentMetadataCue_ = () => {};
  },
  afterEach() {
    window.MediaSource.isTypeSupported = this.oldTypeSupported;
    window.SourceBuffer.prototype.changeType = this.oldChangeType;
    this.env.restore();
    this.mse.restore();
    videojs.Vhs.supportsNativeHls = this.origSupportsNativeHls;
    window.localStorage.clear();
    if (this.hasOwnProperty('oldDevicePixelRatio')) {
      window.devicePixelRatio = this.oldDevicePixelRatio;
    }
    videojs.browser = this.oldBrowser;
    this.player.dispose();
  }

};

QUnit.module('PlaylistController', sharedHooks);

QUnit.test('getAudioTrackPlaylists_ works', function(assert) {
  const pc = this.playlistController;
  const mainPlaylist = {playlists: [{uri: 'testing'}]};

  pc.main = () => mainPlaylist;

  assert.deepEqual(
    pc.getAudioTrackPlaylists_(),
    mainPlaylist.playlists,
    'no media groups, return main playlists'
  );

  mainPlaylist.mediaGroups = {
    AUDIO: {
      main: {
        en: {default: true, label: 'en', playlists: [{uri: 'foo'}, {uri: 'bar'}]},
        fr: {label: 'fr', playlists: [{uri: 'foo-fr'}, {uri: 'bar-fr'}]}
      },
      alt: {
        en: {default: true, label: 'en', playlists: [{uri: 'fizz'}, {uri: 'bazz'}]},
        fr: {label: 'fr', playlists: [{uri: 'fizz-fr'}, {uri: 'bazz-fr'}]}
      }
    }
  };

  assert.deepEqual(pc.getAudioTrackPlaylists_(), [
    {uri: 'foo'},
    {uri: 'bar'},
    {uri: 'fizz'},
    {uri: 'bazz'}
  ], 'returns all dash style en playlist');

  const main = [];
  const alt = [];

  Object.keys(mainPlaylist.mediaGroups.AUDIO.main).forEach(function(k) {
    main.push(mainPlaylist.mediaGroups.AUDIO.main[k]);
  });

  Object.keys(mainPlaylist.mediaGroups.AUDIO.alt).forEach(function(k) {
    alt.push(mainPlaylist.mediaGroups.AUDIO.alt[k]);
  });

  pc.mediaTypes_.AUDIO.groups = {
    main,
    alt
  };
  pc.mediaTypes_.AUDIO.activeTrack = () => ({label: 'fr'});

  assert.deepEqual(pc.getAudioTrackPlaylists_(), [
    {uri: 'foo-fr'},
    {uri: 'bar-fr'},
    {uri: 'fizz-fr'},
    {uri: 'bazz-fr'}
  ], 'returns all dash style fr playlists');

  delete mainPlaylist.mediaGroups.AUDIO.main.fr.playlists;
  mainPlaylist.mediaGroups.AUDIO.main.fr.uri = 'fizz-fr';

  delete mainPlaylist.mediaGroups.AUDIO.alt.fr.playlists;
  mainPlaylist.mediaGroups.AUDIO.alt.fr.uri = 'buzz-fr';

  assert.deepEqual(pc.getAudioTrackPlaylists_(), [
    {uri: 'fizz-fr', label: 'fr'},
    {uri: 'buzz-fr', label: 'fr'}
  ], 'returns all fr hls style playlists');

});

QUnit.test('getAudioTrackPlaylists_ without track', function(assert) {
  const pc = this.playlistController;
  const main = {playlists: [{uri: 'testing'}]};

  pc.main = () => main;

  main.mediaGroups = {
    AUDIO: {
      main: {
        en: {label: 'en', playlists: [{uri: 'foo'}, {uri: 'bar'}]},
        fr: {label: 'fr', playlists: [{uri: 'foo-fr'}, {uri: 'bar-fr'}]}
      }
    }
  };

  assert.deepEqual(
    pc.getAudioTrackPlaylists_(),
    main.playlists,
    'no default track, returns main playlists.'
  );

  pc.mediaTypes_.AUDIO.groups = {foo: [{}]};
  pc.mediaTypes_.AUDIO.activeTrack = () => null;

  assert.deepEqual(
    pc.getAudioTrackPlaylists_(),
    main.playlists,
    'no active track, returns main playlists.'
  );

});

QUnit.test('getAudioTrackPlaylists_ with track but groups are main playlists', function(assert) {
  const pc = this.playlistController;
  const main = {playlists: [
    {uri: '720-audio', attributes: {AUDIO: '720'}},
    {uri: '1080-audio', attributes: {AUDIO: '1080'}}
  ]};

  pc.main = () => main;

  main.mediaGroups = {
    AUDIO: {
      720: {
        audio: {default: true, label: 'audio'}
      },
      1080: {
        audio: {default: true, label: 'audio'}
      }
    }
  };

  pc.mediaTypes_.AUDIO.groups = {foo: [{}]};
  pc.mediaTypes_.AUDIO.activeTrack = () => ({label: 'audio'});

  assert.deepEqual(
    pc.getAudioTrackPlaylists_(),
    [main.playlists[0], main.playlists[1]],
    'returns all audio label playlists'
  );
});

QUnit.test('getAudioTrackPlaylists_ invalid audio groups', function(assert) {
  const pc = this.playlistController;
  const main = {playlists: [
    {uri: 'foo-playlist'},
    {uri: 'bar-playlist'}
  ]};

  pc.main = () => main;

  main.mediaGroups = {
    AUDIO: {
      720: {
        audio: {default: true, label: 'audio'}
      },
      1080: {
        audio: {default: true, label: 'audio'}
      }
    }
  };

  pc.mediaTypes_.AUDIO.groups = {foo: [{}]};
  pc.mediaTypes_.AUDIO.activeTrack = () => ({label: 'audio'});

  assert.deepEqual(
    pc.getAudioTrackPlaylists_(),
    main.playlists,
    'returns all main playlists'
  );
});

QUnit.test('throws error when given an empty URL', function(assert) {
  const options = {
    src: 'test',
    tech: this.player.tech_
  };

  const controller = new PlaylistController(options);

  assert.ok(controller, 'can create with options');

  controller.dispose();

  options.src = '';
  assert.throws(
    () => {
      new PlaylistController(options); // eslint-disable-line no-new
    },
    /A non-empty playlist URL or JSON manifest string is required/,
    'requires a non empty url or JSON manifest string'
  );
});

QUnit.test('obeys none preload option', function(assert) {
  this.player.preload('none');
  // main
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
  // main
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

  let controller = new PlaylistController(options);

  assert.notOk(controller.mainPlaylistLoader_.withCredentials, 'credentials wont be sent by default');

  controller.dispose();

  controller = new PlaylistController(Object.assign({
    withCredentials: true
  }, options));

  assert.ok(controller.mainPlaylistLoader_.withCredentials, 'withCredentials enabled');
  controller.dispose();
});

QUnit.test('addMetadataToTextTrack adds expected metadata to the metadataTrack', function(assert) {
  const options = {
    src: 'test.mpd',
    tech: this.player.tech_,
    sourceType: 'dash'
  };

  // Test messageData property manifest
  let expectedCueValues = [
    {
      startTime: 63857834.256000005,
      data: 'google_7617584398642699833'
    },
    {
      startTime: 63857835.056,
      data: 'google_gkmxVFMIdHz413g3pIgZtITUSFFQYDnQ421MGEkVnTA'
    },
    {
      startTime: 63857836.056,
      data: 'google_Yl7LFi1Fh-TD39nqQzIiGLDD1lx7tYRjjmYND7tEEjM'
    },
    {
      startTime: 63857836.650000006,
      data: 'google_5437877779805246002'
    },
    {
      startTime: 63857837.056,
      data: 'google_8X2eBAFbC2cUJmNNHkrcDKqSJQncj2nrVoB2eIu6lrc'
    },
    {
      startTime: 63857838.056,
      data: 'google_Qyxg2ZhKfBUls-J7oj0Re0_-gCQFviaaEMMDvIOTEWE'
    },
    {
      startTime: 63857838.894,
      data: 'google_7174574530630198647'
    },
    {
      startTime: 63857839.056,
      data: 'google_EFt2jovkcT9PqjuLLC5kH7gIIjWvc0iIhROFED6kqsg'
    },
    {
      startTime: 63857840.056,
      data: 'google_eUHx4vMmAikHojJZLOTR2XZdg1A9b9A8TY7F2CVC3cA'
    },
    {
      startTime: 63857841.056,
      data: 'google_gkmxVFMIdHz413g3pIgZtITUSFFQYDnQ421MGEkVnTA'
    },
    {
      startTime: 63857841.638000004,
      data: 'google_1443613685977331553'
    },
    {
      startTime: 63857842.056,
      data: 'google_Yl7LFi1Fh-TD39nqQzIiGLDD1lx7tYRjjmYND7tEEjM'
    },
    {
      startTime: 63857843.056,
      data: 'google_8X2eBAFbC2cUJmNNHkrcDKqSJQncj2nrVoB2eIu6lrc'
    },
    {
      startTime: 63857843.13200001,
      data: 'google_5822903356700578162'
    }
  ];

  let controller = new PlaylistController(options);

  controller.mainPlaylistLoader_.mainXml_ = manifests.eventStreamMessageData;
  controller.mainPlaylistLoader_.handleMain_();
  // Gather actual cues.
  let actualCueValues = controller.inbandTextTracks_.metadataTrack_.cues_.map((cue) => {
    return {
      startTime: cue.startTime,
      data: cue.value.data
    };
  });

  assert.ok(controller.mainPlaylistLoader_.addMetadataToTextTrack, 'addMetadataToTextTrack is passed to the DASH mainPlaylistLoader');
  assert.deepEqual(actualCueValues, expectedCueValues, 'expected cue values are added to the metadataTrack');
  controller.dispose();

  // Test <Event> content manifest
  expectedCueValues = [
    {
      startTime: 63857834.256000005,
      data: 'foo'
    },
    {
      startTime: 63857835.056,
      data: 'bar'
    },
    {
      startTime: 63857836.056,
      data: 'foo_bar'
    },
    {
      startTime: 63857836.650000006,
      data: 'bar_foo'
    }
  ];

  controller = new PlaylistController(options);
  controller.mainPlaylistLoader_.mainXml_ = manifests.eventStream;
  controller.mainPlaylistLoader_.handleMain_();
  actualCueValues = controller.inbandTextTracks_.metadataTrack_.cues_.map((cue) => {
    return {
      startTime: cue.startTime,
      data: cue.value.data
    };
  });

  assert.deepEqual(actualCueValues, expectedCueValues, 'expected cue values are added to the metadataTrack');
  controller.dispose();
});

QUnit.test('addDateRangesToTextTrack adds expected metadata to the metadataTrack', function(assert) {
  const options = {
    src: 'manifest/daterange.m3u8',
    tech: this.player.tech_,
    sourceType: 'hls'
  };
  const controller = new PlaylistController(options);
  const dateRanges = [{
    endDate: new Date(5000),
    endTime: 3,
    plannedDuration: 5,
    scte35Out: '0xFC30200FFF00F0500D00E4612424',
    startDate: new Date(3000),
    startTime: 1,
    id: 'testId',
    processDateRange: () => {}
  }];
  const expectedCueValues = [{
    endTime: 3,
    id: 'testId',
    startTime: 1,
    value: {data: 5, key: 'PLANNED-DURATION'}
  }, {
    endTime: 3,
    id: 'testId',
    startTime: 1,
    value: {data: new ArrayBuffer(), key: 'SCTE35-OUT'}
  }];

  controller.mainPlaylistLoader_.addDateRangesToTextTrack_(dateRanges);
  const actualCueValues = controller.inbandTextTracks_.metadataTrack_.cues_.map((cue)=>{
    return {
      startTime: cue.startTime,
      endTime: cue.endTime,
      id: cue.id,
      value: {
        data: cue.value.data,
        key: cue.value.key
      }
    };
  });

  assert.deepEqual(actualCueValues, expectedCueValues, 'expected cue values are added to the metadataTrack');
  controller.dispose();
});

QUnit.test('obeys metadata preload option', function(assert) {
  this.player.preload('metadata');
  // main
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

  let pc = new PlaylistController(options);

  assert.ok(
    pc.mainPlaylistLoader_ instanceof PlaylistLoader,
    'created a standard playlist loader'
  );

  pc.dispose();
  options.sourceType = 'dash';
  pc = new PlaylistController(options);

  assert.ok(
    pc.mainPlaylistLoader_ instanceof DashPlaylistLoader,
    'created a dash playlist loader'
  );
  pc.dispose();
  options.sourceType = 'vhs-json';
  pc = new PlaylistController(options);

  assert.ok(
    pc.mainPlaylistLoader_ instanceof PlaylistLoader,
    'created a standard playlist loader for vhs-json source type'
  );

  pc.dispose();
});

QUnit.test('passes options to SegmentLoader', function(assert) {
  const options = {
    src: 'test',
    tech: this.player.tech_
  };

  let controller = new PlaylistController(options);

  assert.notOk(controller.mainSegmentLoader_.bandwidth, "bandwidth won't be set by default");
  assert.notOk(controller.mainSegmentLoader_.sourceType_, "sourceType won't be set by default");
  assert.notOk(controller.mainSegmentLoader_.cacheEncryptionKeys_, "cacheEncryptionKeys won't be set by default");

  controller.dispose();

  controller = new PlaylistController(Object.assign({
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

    // main
    this.standardXHRResponse(this.requests.shift());
    // media
    this.standardXHRResponse(this.requests.shift());
    this.playlistController.mediaSource.trigger('sourceopen');

    const pc = this.playlistController;
    const segmentLoader = pc.mainSegmentLoader_;

    segmentLoader.resetEverything = function() {
      resets++;
    };

    let buffered;

    pc.tech_.buffered = function() {
      return buffered;
    };

    buffered = createTimeRanges([[0, 20]]);

    pc.setCurrentTime(10);
    assert.equal(
      resets, 0,
      'does not reset loader when seeking into a buffered region'
    );

    pc.setCurrentTime(21);
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
      src: 'manifest/main.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    this.clock.tick(1);

    this.playlistController = this.player.tech_.vhs.playlistController_;

    let numCallsToSelectInitialPlaylistCalls = 0;
    let numCallsToSelectPlaylist = 0;

    this.playlistController.selectPlaylist = () => {
      numCallsToSelectPlaylist++;
      return this.playlistController.main().playlists[0];
    };

    this.playlistController.selectInitialPlaylist = () => {
      numCallsToSelectInitialPlaylistCalls++;
      return this.playlistController.main().playlists[0];
    };

    this.playlistController.mediaSource.trigger('sourceopen');
    // main
    this.standardXHRResponse(this.requests.shift());
    // media
    this.standardXHRResponse(this.requests.shift());

    this.clock.tick(1);

    assert.equal(numCallsToSelectInitialPlaylistCalls, 1, 'selectInitialPlaylist');
    assert.equal(numCallsToSelectPlaylist, 0, 'selectPlaylist');

    // Simulate a live reload
    this.playlistController.mainPlaylistLoader_.trigger('loadedplaylist');

    assert.equal(numCallsToSelectInitialPlaylistCalls, 1, 'selectInitialPlaylist');
    assert.equal(numCallsToSelectPlaylist, 0, 'selectPlaylist');
  }
);

QUnit.test('resets everything for a fast quality change', function(assert) {
  let resyncs = 0;
  let resets = 0;
  let removeFuncArgs = {};

  this.player.tech_.buffered = () => createTimeRanges(0, 1);

  this.playlistController.mediaSource.trigger('sourceopen');
  // main
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  const segmentLoader = this.playlistController.mainSegmentLoader_;
  const originalResync = segmentLoader.resyncLoader;

  segmentLoader.resyncLoader = function() {
    resyncs++;
    originalResync.call(segmentLoader);
  };

  const origResetLoaderProperties = segmentLoader.resetLoaderProperties;

  segmentLoader.resetLoaderProperties = () => {
    resets++;
    origResetLoaderProperties.call(segmentLoader);
  };

  segmentLoader.startingMediaInfo_ = { hasVideo: true };
  segmentLoader.audioDisabled_ = true;

  segmentLoader.sourceUpdater_.removeVideo = function(start, end) {
    removeFuncArgs = {
      start,
      end
    };
  };

  segmentLoader.duration_ = () => 60;

  // media is unchanged
  this.playlistController.fastQualityChange_();

  assert.equal(resyncs, 0, 'does not resync segment loader if media is unchanged');

  assert.equal(resets, 0, 'resetEverything not called if media is unchanged');

  assert.deepEqual(removeFuncArgs, {}, 'remove() not called if media is unchanged');

  // media is changed
  this.playlistController.selectPlaylist = () => {
    const playlists = this.playlistController.main().playlists;
    const currentPlaylist = this.playlistController.media();

    return playlists.find((playlist) => playlist !== currentPlaylist);
  };

  this.playlistController.fastQualityChange_();

  assert.equal(resyncs, 1, 'resynced segment loader if media is changed');

  assert.equal(resets, 1, 'resetLoaderProperties called if media is changed');
});

QUnit.test('loadVttJs should be passed to the vttSegmentLoader and resolved on vttjsloaded', function(assert) {
  const stub = sinon.stub(this.player.tech_, 'addWebVttScript_').callsFake(() => this.player.tech_.trigger('vttjsloaded'));
  const controller = new PlaylistController({ src: 'test', tech: this.player.tech_});

  controller.subtitleSegmentLoader_.loadVttJs().then(() => {
    assert.equal(stub.callCount, 1, 'tech addWebVttScript called once');
  });
});

QUnit.test('loadVttJs should be passed to the vttSegmentLoader and rejected on vttjserror', function(assert) {
  const stub = sinon.stub(this.player.tech_, 'addWebVttScript_').callsFake(() => this.player.tech_.trigger('vttjserror'));
  const controller = new PlaylistController({ src: 'test', tech: this.player.tech_});

  controller.subtitleSegmentLoader_.loadVttJs().catch(() => {
    assert.equal(stub.callCount, 1, 'tech addWebVttScript called once');
  });
});

QUnit.test('basic timeToLoadedData, mediaAppends, appendsToLoadedData stats', function(assert) {
  this.player.tech_.trigger('loadstart');
  this.playlistController.mediaSource.trigger('sourceopen');
  // main
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  const segmentLoader = this.playlistController.mainSegmentLoader_;

  return requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader,
    clock: this.clock
  }).then(() => {
    this.player.tech_.trigger('loadeddata');
    const vhs = this.player.tech_.vhs;

    assert.equal(vhs.stats.mediaAppends, 1, 'one media append');
    assert.equal(vhs.stats.appendsToLoadedData, 1, 'appends to first frame is also 1');
    assert.equal(vhs.stats.mainAppendsToLoadedData, 1, 'main appends to first frame is also 1');
    assert.equal(vhs.stats.audioAppendsToLoadedData, 0, 'audio appends to first frame is 0');
    assert.ok(vhs.stats.timeToLoadedData > 0, 'time to first frame is valid');
  });
});

QUnit.test('timeToLoadedData, mediaAppends, appendsToLoadedData stats with 0 length appends', function(assert) {
  this.player.tech_.trigger('loadstart');
  this.playlistController.mediaSource.trigger('sourceopen');
  // main
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  const segmentLoader = this.playlistController.mainSegmentLoader_;

  return requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader,
    clock: this.clock
  }).then(() => {
    // mock a zero length segment, by setting hasAppendedData_ to false.
    segmentLoader.one('appendsdone', () => {
      segmentLoader.pendingSegment_.hasAppendedData_ = false;
    });
    return requestAndAppendSegment({
      request: this.requests.shift(),
      segmentLoader,
      clock: this.clock
    });
  }).then(() => {

    this.player.tech_.trigger('loadeddata');
    const vhs = this.player.tech_.vhs;

    // only one media append as the second was zero length.
    assert.equal(vhs.stats.mediaAppends, 1, 'one media append');
    assert.equal(vhs.stats.appendsToLoadedData, 1, 'appends to first frame is also 1');
    assert.equal(vhs.stats.mainAppendsToLoadedData, 1, 'main appends to first frame is also 1');
    assert.equal(vhs.stats.audioAppendsToLoadedData, 0, 'audio appends to first frame is 0');
    assert.ok(vhs.stats.timeToLoadedData > 0, 'time to first frame is valid');
  });
});

QUnit.test('preload none timeToLoadedData, mediaAppends, appendsToLoadedData stats', function(assert) {
  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.tech_.preload = () => 'none';

  this.player.src({
    src: 'manifest/main.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);
  const vhs = this.player.tech_.vhs;

  this.playlistController = vhs.playlistController_;
  this.playlistController.mediaSource.trigger('sourceopen');

  assert.equal(this.requests.length, 0, 'no requests request');
  assert.equal(vhs.stats.mediaAppends, 0, 'one media append');
  assert.equal(vhs.stats.appendsToLoadedData, -1, 'appends to first frame is -1');
  assert.equal(vhs.stats.mainAppendsToLoadedData, -1, 'main appends to first frame is -1');
  assert.equal(vhs.stats.audioAppendsToLoadedData, -1, 'audio appends to first frame is -1');
  assert.equal(vhs.stats.timeToLoadedData, -1, 'time to first frame is -1');

  this.player.tech_.paused = () => false;
  this.player.tech_.trigger('play');

  // main
  this.standardXHRResponse(this.requests.shift());

  // media
  this.standardXHRResponse(this.requests.shift());

  const segmentLoader = this.playlistController.mainSegmentLoader_;

  return requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader,
    clock: this.clock
  }).then(() => {
    this.player.tech_.trigger('loadeddata');

    assert.equal(vhs.stats.mediaAppends, 1, 'one media append');
    assert.equal(vhs.stats.appendsToLoadedData, 1, 'appends to first frame is also 1');
    assert.equal(vhs.stats.mainAppendsToLoadedData, 1, 'main appends to first frame is also 1');
    assert.equal(vhs.stats.audioAppendsToLoadedData, 0, 'audio appends to first frame is 0');
    assert.ok(vhs.stats.timeToLoadedData > 0, 'time to first frame is valid');
  });
});

QUnit.test('demuxed timeToLoadedData, mediaAppends, appendsToLoadedData stats', function(assert) {
  this.player.tech_.trigger('loadstart');
  const pc = this.playlistController;

  const videoMedia = '#EXTM3U\n' +
                     '#EXT-X-VERSION:3\n' +
                     '#EXT-X-PLAYLIST-TYPE:VOD\n' +
                     '#EXT-X-MEDIA-SEQUENCE:0\n' +
                     '#EXT-X-TARGETDURATION:10\n' +
                     '#EXTINF:10,\n' +
                     'video-0.ts\n' +
                     '#EXTINF:10,\n' +
                     'video-1.ts\n' +
                     '#EXT-X-ENDLIST\n';

  const audioMedia = '#EXTM3U\n' +
                     '#EXT-X-VERSION:3\n' +
                     '#EXT-X-PLAYLIST-TYPE:VOD\n' +
                     '#EXT-X-MEDIA-SEQUENCE:0\n' +
                     '#EXT-X-TARGETDURATION:10\n' +
                     '#EXTINF:10,\n' +
                     'audio-0.ts\n' +
                     '#EXTINF:10,\n' +
                     'audio-1.ts\n' +
                     '#EXT-X-ENDLIST\n';

  pc.mediaSource.trigger('sourceopen');
  // main
  this.standardXHRResponse(this.requests.shift(), manifests.demuxed);

  // video media
  this.standardXHRResponse(this.requests.shift(), videoMedia);

  // audio media
  this.standardXHRResponse(this.requests.shift(), audioMedia);
  return Promise.all([requestAndAppendSegment({
    request: this.requests.shift(),
    segment: videoSegment(),
    isOnlyVideo: true,
    segmentLoader: pc.mainSegmentLoader_,
    clock: this.clock
  }), requestAndAppendSegment({
    request: this.requests.shift(),
    segment: audioSegment(),
    isOnlyAudio: true,
    segmentLoader: pc.audioSegmentLoader_,
    clock: this.clock
  })]).then(() => {
    this.player.tech_.trigger('loadeddata');
    const vhs = this.player.tech_.vhs;

    assert.equal(vhs.stats.mediaAppends, 2, 'two media append');
    assert.equal(vhs.stats.appendsToLoadedData, 2, 'appends to first frame is also 2');
    assert.equal(vhs.stats.mainAppendsToLoadedData, 1, 'main appends to first frame is 1');
    assert.equal(vhs.stats.audioAppendsToLoadedData, 1, 'audio appends to first frame is 1');
    assert.ok(vhs.stats.timeToLoadedData > 0, 'time to first frame is valid');
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

  const playlistController = this.player.tech_.vhs.playlistController_;

  playlistController.selectPlaylist = () => {
    return playlistController.main().playlists[0];
  };

  // main
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  playlistController.mediaSource.trigger('sourceopen');

  let resyncs = 0;
  let resets = 0;
  const realReset = playlistController.audioSegmentLoader_.resetEverything;

  playlistController.audioSegmentLoader_.resetEverything = function(done) {
    resets++;
    realReset.call(this, done);
  };

  const originalResync = playlistController.audioSegmentLoader_.resyncLoader;

  playlistController.audioSegmentLoader_.resyncLoader = function() {
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
  this.clock.tick(1);

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

  this.playlistController = this.player.tech_.vhs.playlistController_;
  // Make segment metadata noop since most test segments dont have real data
  this.playlistController.mainSegmentLoader_.addSegmentMetadataCue_ = () => {};

  // mock that the user has played the video before
  this.player.tech_.triggerReady();
  this.clock.tick(1);
  this.player.tech_.trigger('play');
  this.player.tech_.paused_ = false;
  this.player.tech_.played = () => createTimeRanges([[0, 20]]);

  openMediaSource(this.player, this.clock);
  // playlist
  this.standardXHRResponse(this.requests[0]);

  this.playlistController.mainSegmentLoader_.sourceUpdater_.buffered = () => {
    return createTimeRanges([[0, 20]]);
  };
  this.clock.tick(1);
  // segment
  return new Promise((resolve, reject) => {
    this.playlistController.mainSegmentLoader_.on('appending', resolve);
    this.standardXHRResponse(this.requests[1], muxedSegment());
  }).then(() => {
    this.playlistController.mainSegmentLoader_.fetchAtBuffer_ = true;
    // source buffers are mocked, so must manually trigger update ends on audio and video
    // buffers
    this.playlistController.mediaSource.sourceBuffers[0].trigger('updateend');
    this.playlistController.mediaSource.sourceBuffers[1].trigger('updateend');
    this.clock.tick(10 * 1000);
    this.clock.tick(1);
    assert.equal(this.requests[2].headers.Range, 'bytes=522828-1110327');
  });
});

QUnit.test(
  're-initializes the combined playlist loader when switching sources',
  function(assert) {
    openMediaSource(this.player, this.clock);
    // main
    this.standardXHRResponse(this.requests.shift());
    // playlist
    this.standardXHRResponse(this.requests.shift());
    // segment
    this.standardXHRResponse(this.requests.shift(), muxedSegment());
    // change the source
    this.player.src({
      src: 'manifest/main.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    this.clock.tick(1);

    this.playlistController = this.player.tech_.vhs.playlistController_;
    // Make segment metadata noop since most test segments dont have real data
    this.playlistController.mainSegmentLoader_.addSegmentMetadataCue_ = () => {};

    // maybe not needed if https://github.com/videojs/video.js/issues/2326 gets fixed
    this.clock.tick(1);
    assert.ok(
      !this.playlistController.mainPlaylistLoader_.media(),
      'no media playlist'
    );
    assert.equal(
      this.playlistController.mainPlaylistLoader_.state,
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
      this.requests[0].url.indexOf('main.m3u8') >= 0,
      'requested only the new playlist'
    );
  }
);

QUnit.test('excludes playlists with unsupported codecs before initial selection', function(assert) {
  // only support mp4a/avc1 for testing, this is restored in afterEach
  window.MediaSource.isTypeSupported = (type) => (/(mp4a|avc1)/).test(type);

  this.playlistController.selectPlaylist = () => {
    const playlists = this.playlistController.main().playlists;

    assert.equal(playlists[0].excludeUntil, Infinity, 'theora excluded');
    assert.equal(playlists[1].excludeUntil, undefined, 'avc/mp4a not excluded');
    assert.equal(playlists[2].excludeUntil, Infinity, 'ec-3 excluded');
    assert.equal(playlists[3].excludeUntil, Infinity, 'stpp.ttml.im1t excluded');
  };

  openMediaSource(this.player, this.clock);

  // main
  this.requests.shift().respond(
    200, null,
    '#EXTM3U\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="theora,mp4a.40.5"\n' +
    'media.m3u8\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=10000,CODECS="avc1.4d400d,mp4a.40.2"\n' +
    'media1.m3u8\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=10000,CODECS="avc1.4d400d,ec-3"\n' +
    'media2.m3u8\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=10000,CODECS="stpp.ttml.im1t"\n' +
    'media3.m3u8\n'
  );

  // media
  this.standardXHRResponse(this.requests.shift());
});

QUnit.test(
  'updates the combined segment loader on live playlist refreshes',
  function(assert) {
    const updates = [];

    openMediaSource(this.player, this.clock);
    // main
    this.standardXHRResponse(this.requests.shift());
    // media
    this.standardXHRResponse(this.requests.shift());

    this.playlistController.mainSegmentLoader_.playlist = function(update) {
      updates.push(update);
    };

    this.playlistController.mainPlaylistLoader_.trigger('loadedplaylist');
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

    // main
    this.standardXHRResponse(this.requests.shift());
    // media
    this.standardXHRResponse(this.requests.shift());

    this.player.tech_.on('progress', function() {
      progressCount++;
    });

    // 1ms for request duration
    this.clock.tick(1);
    this.standardXHRResponse(this.requests.shift(), muxedSegment());

    this.playlistController.mainSegmentLoader_.trigger('progress');
    // note that there are two progress events as one is fired on finish
    assert.equal(progressCount, 2, 'fired a progress event');
  }
);

QUnit.test(
  'updates the active loader when switching from unmuxed to muxed audio group',
  function(assert) {
    openMediaSource(this.player, this.clock);
    // main
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

    const pc = this.playlistController;
    const combinedPlaylist = pc.main().playlists[0];

    assert.ok(
      pc.mediaTypes_.AUDIO.activePlaylistLoader,
      'starts with an active playlist loader'
    );

    pc.mainPlaylistLoader_.media(combinedPlaylist);
    // updated media
    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
                                '#EXTINF:5.0\n' +
                                '0.ts\n' +
                                '#EXT-X-ENDLIST\n'
    );

    assert.notOk(
      pc.mediaTypes_.AUDIO.activePlaylistLoader,
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

  const pc = this.playlistController;

  pc.mainSegmentLoader_.on('ended', () => videoEnded++);
  pc.audioSegmentLoader_.on('ended', () => audioEnded++);

  pc.mainSegmentLoader_.currentMediaInfo_ = { hasVideo: true };
  pc.audioSegmentLoader_.currentMediaInfo_ = { hasAudio: true };

  // main
  this.standardXHRResponse(this.requests.shift(), manifests.demuxed);

  // video media
  this.standardXHRResponse(this.requests.shift(), videoMedia);

  // audio media
  this.standardXHRResponse(this.requests.shift(), audioMedia);

  return Promise.all([requestAndAppendSegment({
    request: this.requests.shift(),
    segment: videoSegment(),
    isOnlyVideo: true,
    segmentLoader: pc.mainSegmentLoader_,
    clock: this.clock
  }), requestAndAppendSegment({
    request: this.requests.shift(),
    segment: audioSegment(),
    isOnlyAudio: true,
    segmentLoader: pc.audioSegmentLoader_,
    clock: this.clock
  })]).then(() => {
    assert.equal(videoEnded, 1, 'main segment loader did not trigger ended again');
    assert.equal(audioEnded, 1, 'audio segment loader triggered ended');
    assert.equal(pc.mediaSource.readyState, 'ended', 'Media Source ended');
  });
});

// TODO once we have support for audio only with alternate audio, we should have a test
// for: "does not wait for main loader to finish before calling endOfStream with audio
// only stream and alternate audio active." This will require changes in segment loader to
// handle disabled audio on the main stream, as well as potential media group changes and
// main playlist controller changes to use measurements from the audio segment loader as
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

  this.playlistController.mainSegmentLoader_.on('ended', () => ended++);

  this.player.tech_.trigger('play');

  // main
  this.standardXHRResponse(this.requests.shift());

  // media
  this.standardXHRResponse(this.requests.shift(), videoMedia);

  return new Promise((resolve, reject) => {
    this.playlistController.mainSegmentLoader_.one('appending', resolve);

    // segment
    this.standardXHRResponse(this.requests.shift(), muxedSegment());
  }).then(() => {
    assert.notOk(
      this.playlistController.mainSegmentLoader_.paused(),
      'segment loader not yet paused'
    );

    // source buffers are mocked, so must manually trigger update ends on audio and video
    // buffers
    this.playlistController.mediaSource.sourceBuffers[0].trigger('updateend');
    this.playlistController.mediaSource.sourceBuffers[1].trigger('updateend');

    assert.ok(
      this.playlistController.mainSegmentLoader_.paused(),
      'segment loader is paused after ending'
    );
    assert.equal(ended, 1, 'segment loader triggered ended event');

    this.player.currentTime(5);

    this.clock.tick(1);

    assert.notOk(
      this.playlistController.mainSegmentLoader_.paused(),
      'segment loader unpaused after a seek'
    );
    assert.equal(ended, 1, 'segment loader did not trigger ended event again yet');
  });
});

QUnit.test('detects if the player is stuck at the playlist end', function(assert) {
  const playlistCopy = Vhs.Playlist.playlistEnd;

  this.playlistController.mediaSource.trigger('sourceopen');
  this.standardXHRResponse(this.requests.shift());
  const playlist = this.player.tech_.vhs.selectPlaylist();

  // not stuck at playlist end when no seekable, even if empty buffer
  // and positive currentTime
  this.playlistController.seekable = () => createTimeRanges();
  this.player.tech_.buffered = () => createTimeRanges();
  this.player.tech_.setCurrentTime(170);
  assert.ok(
    !this.playlistController.stuckAtPlaylistEnd_(playlist),
    'not stuck at playlist end'
  );

  // not stuck at playlist end when no seekable, even if empty buffer
  // and currentTime 0
  this.player.tech_.setCurrentTime(0);
  assert.ok(
    !this.playlistController.stuckAtPlaylistEnd_(playlist),
    'not stuck at playlist end'
  );

  // not stuck at playlist end when no seekable but current time is at
  // the end of the buffered range
  this.player.tech_.buffered = () => createTimeRanges(0, 170);
  assert.ok(
    !this.playlistController.stuckAtPlaylistEnd_(playlist),
    'not stuck at playlist end'
  );

  // not stuck at playlist end when currentTime not at seekable end
  // even if the buffer is empty
  this.playlistController.seekable = () => createTimeRanges(0, 130);
  this.playlistController.syncController_.getExpiredTime = () => 0;
  this.player.tech_.setCurrentTime(50);
  this.player.tech_.buffered = () => createTimeRanges();
  Vhs.Playlist.playlistEnd = () => 130;
  assert.ok(
    !this.playlistController.stuckAtPlaylistEnd_(playlist),
    'not stuck at playlist end'
  );

  // not stuck at playlist end when buffer reached the absolute end of the playlist
  // and current time is in the buffered range
  this.player.tech_.setCurrentTime(159);
  this.player.tech_.buffered = () => createTimeRanges(0, 160);
  Vhs.Playlist.playlistEnd = () => 160;
  assert.ok(
    !this.playlistController.stuckAtPlaylistEnd_(playlist),
    'not stuck at playlist end'
  );

  // stuck at playlist end when there is no buffer and playhead
  // reached absolute end of playlist
  this.player.tech_.setCurrentTime(160);
  assert.ok(
    this.playlistController.stuckAtPlaylistEnd_(playlist),
    'stuck at playlist end'
  );

  // stuck at playlist end when current time reached the buffer end
  // and buffer has reached absolute end of playlist
  this.playlistController.seekable = () => createTimeRanges(90, 130);
  this.player.tech_.buffered = () => createTimeRanges(0, 170);
  this.player.tech_.setCurrentTime(170);
  Vhs.Playlist.playlistEnd = () => 170;
  assert.ok(
    this.playlistController.stuckAtPlaylistEnd_(playlist),
    'stuck at playlist end'
  );

  Vhs.Playlist.playlistEnd = playlistCopy;
});

QUnit.test('excludes switching from video+audio playlists to audio only', function(assert) {
  openMediaSource(this.player, this.clock);

  this.player.tech_.vhs.bandwidth = 1e10;

  // main
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

  const pc = this.playlistController;
  let debugLogs = [];

  pc.logger_ = (...logs) => {
    debugLogs = debugLogs.concat(logs);
  };
  // segment must be appended before the exclusion logic runs
  return requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: pc.mainSegmentLoader_,
    clock: this.clock
  }).then(() => {
    assert.equal(
      pc.mainPlaylistLoader_.media(),
      pc.mainPlaylistLoader_.main.playlists[1],
      'selected video+audio'
    );

    const audioPlaylist = pc.mainPlaylistLoader_.main.playlists[0];

    assert.equal(audioPlaylist.excludeUntil, Infinity, 'excluded incompatible playlist');
    assert.notEqual(
      debugLogs.indexOf('excluding 0-media.m3u8: codec count "1" !== "2"'),
      -1,
      'debug logs about codec count'
    );
  });
});

QUnit.test('excludes switching from audio-only playlists to video+audio', function(assert) {
  openMediaSource(this.player, this.clock);

  this.player.tech_.vhs.bandwidth = 1;
  const pc = this.playlistController;

  // main
  this.requests.shift().respond(
    200, null,
    '#EXTM3U\n' +
                                '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="mp4a.40.2"\n' +
                                'media.m3u8\n' +
                                '#EXT-X-STREAM-INF:BANDWIDTH=10,RESOLUTION=1x1,CODECS="avc1.4d400d,mp4a.40.2"\n' +
                                'media1.m3u8\n'
  );

  // media1
  this.standardXHRResponse(this.requests.shift());

  let debugLogs = [];

  pc.logger_ = (...logs) => {
    debugLogs = debugLogs.concat(logs);
  };
  // segment must be appended before the exclusion logic runs
  return requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: pc.mainSegmentLoader_,
    segment: audioSegment(),
    isOnlyAudio: true,
    clock: this.clock
  }).then(() => {
    assert.equal(
      pc.mainPlaylistLoader_.media(),
      pc.mainPlaylistLoader_.main.playlists[0],
      'selected audio only'
    );

    const videoAudioPlaylist = pc.mainPlaylistLoader_.main.playlists[1];

    assert.equal(
      videoAudioPlaylist.excludeUntil,
      Infinity,
      'excluded incompatible playlist'
    );

    assert.notEqual(
      debugLogs.indexOf('excluding 1-media1.m3u8: codec count "2" !== "1"'),
      -1,
      'debug logs about codec count'
    );
  });
});

QUnit.test('excludes switching from video-only playlists to video+audio', function(assert) {
  openMediaSource(this.player, this.clock);

  this.player.tech_.vhs.bandwidth = 1;

  // main
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

  const pc = this.playlistController;
  let debugLogs = [];

  pc.logger_ = (...logs) => {
    debugLogs = debugLogs.concat(logs);
  };

  // segment must be appended before the exclusion logic runs
  return requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: pc.mainSegmentLoader_,
    segment: videoSegment(),
    isOnlyVideo: true,
    clock: this.clock
  }).then(() => {
    assert.equal(
      pc.mainPlaylistLoader_.media(),
      pc.mainPlaylistLoader_.main.playlists[0],
      'selected video only'
    );

    const videoAudioPlaylist = pc.mainPlaylistLoader_.main.playlists[1];

    assert.equal(
      videoAudioPlaylist.excludeUntil,
      Infinity,
      'excluded incompatible playlist'
    );
    assert.notEqual(
      debugLogs.indexOf('excluding 1-media1.m3u8: codec count "2" !== "1"'),
      -1,
      'debug logs about codec count'
    );
  });
});

QUnit.test('excludes switching between playlists with different codecs', function(assert) {
  openMediaSource(this.player, this.clock);

  this.player.tech_.vhs.bandwidth = 1;

  const pc = this.playlistController;

  // don't exclude unsupported variants now so we can
  // keep them until until later on.
  pc.excludeUnsupportedVariants_ = () => {};
  pc.sourceUpdater_.canChangeType = () => false;

  // main
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
    this.playlistController.mainPlaylistLoader_.media(),
    this.playlistController.mainPlaylistLoader_.main.playlists[0],
    'selected HE-AAC stream'
  );

  let debugLogs = [];

  pc.logger_ = (...logs) => {
    debugLogs = debugLogs.concat(logs);
  };

  // segment must be appended before the exclusion logic runs
  return requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: pc.mainSegmentLoader_,
    clock: this.clock
  }).then(() => {
    const playlists = pc.mainPlaylistLoader_.main.playlists;

    assert.equal(typeof playlists[0].excludeUntil, 'undefined', 'did not exclude first playlist');
    assert.equal(playlists[1].excludeUntil, Infinity, 'excluded second playlist');
    assert.equal(playlists[2].excludeUntil, Infinity, 'excluded third playlist');
    assert.equal(playlists[3].excludeUntil, Infinity, 'excluded forth playlist');
    assert.equal(typeof playlists[4].excludeUntil, 'undefined', 'did not exclude fifth playlist');
    assert.equal(playlists[5].excludeUntil, Infinity, 'excluded sixth playlist');
    assert.equal(playlists[6].excludeUntil, Infinity, 'excluded seventh playlist');

    [
      'excluding 1-media1.m3u8: video codec "hvc1" !== "avc1"',
      'excluding 2-media2.m3u8: audio codec "ac-3" !== "mp4a"',
      'excluding 3-media3.m3u8: video codec "hvc1" !== "avc1" && audio codec "ac-3" !== "mp4a"',
      'excluding 5-media5.m3u8: codec count "1" !== "2" && audio codec "ac-3" !== "mp4a"',
      'excluding 6-media6.m3u8: codec count "1" !== "2" && video codec "hvc1" !== "avc1"'
    ].forEach(function(message) {
      assert.notEqual(
        debugLogs.indexOf(message),
        -1,
        `debug logs ${message}`
      );
    });
  });
});

QUnit.test('does not exclude switching between playlists with different audio profiles', function(assert) {
  openMediaSource(this.player, this.clock);

  this.player.tech_.vhs.bandwidth = 1;

  // main
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
    this.playlistController.mainPlaylistLoader_.media(),
    this.playlistController.mainPlaylistLoader_.main.playlists[0],
    'selected HE-AAC stream'
  );

  const pc = this.playlistController;

  // segment must be appended before the exclusion logic runs
  return requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: pc.mainSegmentLoader_,
    clock: this.clock
  }).then(() => {
    const alternatePlaylist = pc.mainPlaylistLoader_.main.playlists[1];

    assert.equal(alternatePlaylist.excludeUntil, undefined, 'did not exclude playlist');
  });
});

QUnit.test('updates the combined segment loader on media changes', function(assert) {
  const updates = [];

  this.playlistController.mediaSource.trigger('sourceopen');

  this.playlistController.mainSegmentLoader_.bandwidth = 1;

  // main
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  this.playlistController.mainSegmentLoader_.playlist = function(update) {
    updates.push(update);
  };
  // 1ms has passed to upload 1kb
  // that gives us a bandwidth of 1024 / 1 * 8 * 1000 = 8192000
  this.clock.tick(1);

  this.playlistController.mainSegmentLoader_.mediaIndex = 0;

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
  this.playlistController.tech_.buffered = () => {
    return createTimeRanges([[0, 30]]);
  };

  this.playlistController.mainSegmentLoader_.one('appending', () => {
    // source buffers are mocked, so must manually trigger update ends on audio and video
    // buffers
    this.playlistController.mediaSource.sourceBuffers[0].trigger('updateend');
    this.playlistController.mediaSource.sourceBuffers[1].trigger('updateend');
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

  this.playlistController.selectPlaylist = () => {
    calls++;
    return this.playlistController.mainPlaylistLoader_.main.playlists[0];
  };
  this.playlistController.mediaSource.trigger('sourceopen');

  // main
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  // "downloaded" a segment
  this.playlistController.mainSegmentLoader_.trigger('bandwidthupdate');
  assert.strictEqual(calls, 2, 'selects after the initial segment');

  // and another
  this.playlistController.mainSegmentLoader_.trigger('bandwidthupdate');
  assert.strictEqual(calls, 3, 'selects after additional segments');
  // verify stats
  assert.equal(this.player.tech_.vhs.stats.bandwidth, 4194304, 'default bandwidth');
});

QUnit.test('does not select a playlist after segment downloads if only one playlist', function(assert) {
  let calls = 0;

  this.playlistController.selectPlaylist = () => {
    calls++;
    return null;
  };
  this.playlistController.mediaSource.trigger('sourceopen');

  // main
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  // "downloaded" a segment
  this.playlistController.mainSegmentLoader_.trigger('bandwidthupdate');
  assert.strictEqual(calls, 2, 'selects after the initial segment');
});

QUnit.test('re-triggers bandwidthupdate events on the tech', function(assert) {
  this.playlistController.mediaSource.trigger('sourceopen');
  // main
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  let bandwidthupdateEvents = 0;

  this.player.tech_.on('bandwidthupdate', () => bandwidthupdateEvents++);

  this.playlistController.mainSegmentLoader_.trigger('bandwidthupdate');

  assert.equal(bandwidthupdateEvents, 1, 'triggered bandwidthupdate');

  this.playlistController.mainSegmentLoader_.trigger('bandwidthupdate');

  assert.equal(bandwidthupdateEvents, 2, 'triggered bandwidthupdate');
});

QUnit.test(
  'switches to lower renditions immediately, higher dependent on buffer',
  function(assert) {
    this.playlistController.mediaSource.trigger('sourceopen');
    // main
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

    this.playlistController.tech_.currentTime = () => currentTime;
    this.playlistController.tech_.buffered = () => createTimeRanges(buffered);
    this.playlistController.duration = () => duration;
    this.playlistController.selectPlaylist = () => {
      return {
        id: id++,
        attributes: {
          BANDWIDTH: nextPlaylistBandwidth
        },
        endList
      };
    };
    this.playlistController.mainPlaylistLoader_.media = (media) => {
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
    this.playlistController.mainSegmentLoader_.trigger('bandwidthupdate');
    assert.equal(
      mediaChanges.length,
      1,
      'changes media when no buffer and equal bandwidth playlist'
    );
    buffered = [[0, 9]];
    this.playlistController.mainSegmentLoader_.trigger('bandwidthupdate');
    assert.equal(
      mediaChanges.length,
      2,
      'changes media when sufficient forward buffer and equal ' +
               'bandwidth playlist'
    );
    buffered = [[0, 30]];
    this.playlistController.mainSegmentLoader_.trigger('bandwidthupdate');
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
    this.playlistController.mainSegmentLoader_.trigger('bandwidthupdate');
    assert.equal(
      mediaChanges.length,
      0,
      'did not change media when no buffer and and higher bandwidth playlist'
    );
    buffered = [[0, 19]];
    this.playlistController.mainSegmentLoader_.trigger('bandwidthupdate');
    assert.equal(
      mediaChanges.length,
      0,
      'did not change media when insufficient forward buffer and higher ' +
               'bandwidth playlist'
    );
    buffered = [[0, 20]];
    this.playlistController.mainSegmentLoader_.trigger('bandwidthupdate');
    assert.equal(
      mediaChanges.length,
      1,
      'changes media when sufficient forward buffer and higher ' +
               'bandwidth playlist'
    );
    buffered = [[0, 21]];
    this.playlistController.mainSegmentLoader_.trigger('bandwidthupdate');
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
    this.playlistController.mainSegmentLoader_.trigger('bandwidthupdate');
    assert.equal(
      mediaChanges.length,
      0,
      'did not change media when no buffer and higher bandwidth playlist'
    );
    buffered = [[0, 100], [100, 109]];
    this.playlistController.mainSegmentLoader_.trigger('bandwidthupdate');
    assert.equal(
      mediaChanges.length,
      0,
      'did not change media when insufficient forward buffer and higher ' +
               'bandwidth playlist'
    );
    buffered = [[0, 100], [100, 130]];
    this.playlistController.mainSegmentLoader_.trigger('bandwidthupdate');
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
    this.playlistController.mainSegmentLoader_.trigger('bandwidthupdate');
    assert.equal(
      mediaChanges.length,
      1,
      'changes media when no buffer but lower bandwidth playlist'
    );
    buffered = [[100, 109]];
    this.playlistController.mainSegmentLoader_.trigger('bandwidthupdate');
    assert.equal(
      mediaChanges.length,
      2,
      'changes media when insufficient forward buffer but lower ' +
               'bandwidth playlist'
    );
    buffered = [[100, 110]];
    this.playlistController.mainSegmentLoader_.trigger('bandwidthupdate');
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
    this.playlistController.mainSegmentLoader_.trigger('bandwidthupdate');
    assert.equal(
      mediaChanges.length,
      1,
      'changes live media when no buffer and higher bandwidth playlist'
    );
    buffered = [[0, 100], [100, 109]];
    this.playlistController.mainSegmentLoader_.trigger('bandwidthupdate');
    assert.equal(
      mediaChanges.length,
      2,
      'changes live media when insufficient forward buffer and higher ' +
               'bandwidth playlist'
    );
    buffered = [[0, 100], [100, 130]];
    this.playlistController.mainSegmentLoader_.trigger('bandwidthupdate');
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
    this.playlistController.mainSegmentLoader_.trigger('bandwidthupdate');
    assert.equal(
      mediaChanges.length,
      1,
      'changes media when no buffer and duration less than low water line'
    );
    buffered = [[0, 10]];
    this.playlistController.mainSegmentLoader_.trigger('bandwidthupdate');
    assert.equal(
      mediaChanges.length,
      2,
      'changes media when insufficient forward buffer and duration ' +
               'less than low water line'
    );
  }
);

QUnit.test('excludes playlist on earlyabort', function(assert) {
  this.playlistController.mediaSource.trigger('sourceopen');
  // main
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  const mediaChanges = [];
  const playlistLoader = this.playlistController.mainPlaylistLoader_;
  const currentMedia = playlistLoader.media();
  const origMedia = playlistLoader.media.bind(playlistLoader);
  const origWarn = videojs.log.warn;
  const warnings = [];

  this.playlistController.mainPlaylistLoader_.media = (media) => {
    if (media) {
      mediaChanges.push(media);
    }
    return origMedia(media);
  };

  videojs.log.warn = (text) => warnings.push(text);

  assert.notOk(currentMedia.excludeUntil > 0, 'playlist not excluded');
  assert.equal(mediaChanges.length, 0, 'no media change');

  this.playlistController.mainSegmentLoader_.trigger('earlyabort');

  assert.ok(currentMedia.excludeUntil > 0, 'playlist excluded');
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
  const pc = this.playlistController;
  const segmentLoader = pc.mainSegmentLoader_;

  // start on lowest bandwidth rendition (will be media.m3u8)
  segmentLoader.bandwidth = 0;

  this.player.tech_.paused = () => false;
  pc.mediaSource.trigger('sourceopen');
  // main
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

  const playlistLoader = pc.mainPlaylistLoader_;
  const origMedia = playlistLoader.media.bind(playlistLoader);
  const mediaChanges = [];

  pc.switchMedia_ = (media) => {
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
    segmentLoader: pc.mainSegmentLoader_,
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
      segmentLoader: pc.mainSegmentLoader_,
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

    assert.notOk(media1ResolvedPlaylist.excludeUntil, 'media1 not excluded');
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
    assert.ok(media1ResolvedPlaylist.excludeUntil, 'excluded media1');
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
      segmentLoader: pc.mainSegmentLoader_,
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
      segmentLoader: pc.mainSegmentLoader_,
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

  this.playlistController.mediaSource.trigger('sourceopen');
  this.playlistController.bandwidth = 1e20;

  // main
  this.standardXHRResponse(this.requests[0]);
  // media
  this.standardXHRResponse(this.requests[1]);

  this.playlistController.selectPlaylist = () => {
    selectedPlaylist = true;

    // this duration should be overwritten by the playlist change
    this.playlistController.mediaSource.duration = 0;
    this.playlistController.mediaSource.readyState = 'open';

    return this.playlistController.mainPlaylistLoader_.main.playlists[1];
  };

  assert.ok(segmentByteLength, 'the segment has some number of bytes');

  // 1ms for request duration
  this.clock.tick(1);
  this.playlistController.mainSegmentLoader_.mediaIndex = 0;

  return new Promise((resolve, reject) => {
    this.playlistController.mainSegmentLoader_.on('appending', resolve);

    // segment 0
    this.standardXHRResponse(this.requests[2], segment);
  }).then(() => {
    // source buffers are mocked, so must manually trigger update ends on audio and video
    // buffers
    this.playlistController.mediaSource.sourceBuffers[0].trigger('updateend');
    this.playlistController.mediaSource.sourceBuffers[1].trigger('updateend');

    // media1
    this.standardXHRResponse(this.requests[3]);
    assert.ok(selectedPlaylist, 'selected playlist');
    assert.ok(
      this.playlistController.mediaSource.duration !== 0,
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
  this.playlistController.mediaSource.trigger('sourceopen');
  this.player.width(1000);
  this.player.height(900);

  // main
  this.standardXHRResponse(this.requests[0]);
  // media
  this.standardXHRResponse(this.requests[1]);

  assert.ok(/media3\.m3u8/i.test(this.requests[1].url), 'Selected the highest rendition');

  return requestAndAppendSegment({
    request: this.requests[2],
    segment: muxedSegment(),
    segmentLoader: this.playlistController.mainSegmentLoader_,
    clock: this.clock,
    bandwidth: 8192000,
    throughput: 409600
  }).then(() => {
    // need two segments before a rendition change can happen
    return requestAndAppendSegment({
      request: this.requests[3],
      segment: muxedSegment(),
      segmentLoader: this.playlistController.mainSegmentLoader_,
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
    this.playlistController.mediaSource.trigger('sourceopen');

    // main
    this.standardXHRResponse(this.requests[0]);
    // media
    this.standardXHRResponse(this.requests[1]);

    assert.equal(
      this.playlistController.requestOptions_.timeout,
      this.playlistController.mainPlaylistLoader_.targetDuration * 1.5 *
              1000,
      'default request timeout'
    );

    assert.ok(
      !Playlist.isLowestEnabledRendition(
        this.playlistController.mainPlaylistLoader_.main,
        this.playlistController.mainPlaylistLoader_.media()
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
        this.playlistController.mainPlaylistLoader_.main,
        this.playlistController.mainPlaylistLoader_.media()
      ),
      'on lowest rendition'
    );

    assert.equal(
      this.playlistController.requestOptions_.timeout, 0,
      'request timeout 0'
    );
  }
);

QUnit.test(
  'removes request timeout when the source is a media playlist and not main',
  function(assert) {
    this.requests.length = 0;

    this.player.src({
      src: 'manifest/media.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    this.clock.tick(1);

    this.playlistController = this.player.tech_.vhs.playlistController_;

    // media
    this.standardXHRResponse(this.requests.shift());

    assert.equal(
      this.playlistController.requestOptions_.timeout, 0,
      'request timeout set to 0 when loading a non main playlist'
    );
  }
);

QUnit.test(
  'seekable uses the intersection of alternate audio and combined tracks',
  function(assert) {
    const origSeekable = Playlist.seekable;
    const pc = this.playlistController;
    const mainMedia = {};
    const audioMedia = {};
    let mainTimeRanges = [];
    let audioTimeRanges = [];

    this.playlistController.mainPlaylistLoader_.main = {};
    this.playlistController.mainPlaylistLoader_.media = () => mainMedia;
    this.playlistController.syncController_.getExpiredTime = () => 0;

    Playlist.seekable = (media) => {
      if (media === mainMedia) {
        return createTimeRanges(mainTimeRanges);
      }
      return createTimeRanges(audioTimeRanges);
    };

    timeRangesEqual(pc.seekable(), createTimeRanges(), 'empty when main empty');
    mainTimeRanges = [[0, 10]];
    pc.seekable_ = createTimeRanges();
    pc.onSyncInfoUpdate_();
    timeRangesEqual(pc.seekable(), createTimeRanges([[0, 10]]), 'main when no audio');

    pc.mediaTypes_.AUDIO.activePlaylistLoader = {
      media: () => audioMedia,
      dispose() {},
      expired_: 0
    };
    mainTimeRanges = [];
    pc.seekable_ = createTimeRanges();
    pc.onSyncInfoUpdate_();

    timeRangesEqual(pc.seekable(), createTimeRanges(), 'empty when both empty');
    mainTimeRanges = [[0, 10]];
    pc.seekable_ = createTimeRanges();
    pc.onSyncInfoUpdate_();
    timeRangesEqual(pc.seekable(), createTimeRanges(), 'empty when audio empty');
    mainTimeRanges = [];
    audioTimeRanges = [[0, 10]];
    pc.seekable_ = createTimeRanges();
    pc.onSyncInfoUpdate_();
    timeRangesEqual(pc.seekable(), createTimeRanges(), 'empty when main empty');
    mainTimeRanges = [[0, 10]];
    audioTimeRanges = [[0, 10]];
    pc.seekable_ = createTimeRanges();
    pc.onSyncInfoUpdate_();
    timeRangesEqual(pc.seekable(), createTimeRanges([[0, 10]]), 'ranges equal');
    mainTimeRanges = [[5, 10]];
    pc.seekable_ = createTimeRanges();
    pc.onSyncInfoUpdate_();
    timeRangesEqual(pc.seekable(), createTimeRanges([[5, 10]]), 'main later start');
    mainTimeRanges = [[0, 10]];
    audioTimeRanges = [[5, 10]];
    pc.seekable_ = createTimeRanges();
    pc.onSyncInfoUpdate_();
    timeRangesEqual(pc.seekable(), createTimeRanges([[5, 10]]), 'audio later start');
    mainTimeRanges = [[0, 9]];
    audioTimeRanges = [[0, 10]];
    pc.seekable_ = createTimeRanges();
    pc.onSyncInfoUpdate_();
    timeRangesEqual(pc.seekable(), createTimeRanges([[0, 9]]), 'main earlier end');
    mainTimeRanges = [[0, 10]];
    audioTimeRanges = [[0, 9]];
    pc.seekable_ = createTimeRanges();
    pc.onSyncInfoUpdate_();
    timeRangesEqual(pc.seekable(), createTimeRanges([[0, 9]]), 'audio earlier end');
    mainTimeRanges = [[1, 10]];
    audioTimeRanges = [[0, 9]];
    pc.seekable_ = createTimeRanges();
    pc.onSyncInfoUpdate_();
    timeRangesEqual(
      pc.seekable(),
      createTimeRanges([[1, 9]]),
      'main later start, audio earlier end'
    );
    mainTimeRanges = [[0, 9]];
    audioTimeRanges = [[1, 10]];
    pc.seekable_ = createTimeRanges();
    pc.onSyncInfoUpdate_();
    timeRangesEqual(
      pc.seekable(),
      createTimeRanges([[1, 9]]),
      'audio later start, main earlier end'
    );
    mainTimeRanges = [[2, 9]];
    pc.seekable_ = createTimeRanges();
    pc.onSyncInfoUpdate_();
    timeRangesEqual(
      pc.seekable(),
      createTimeRanges([[2, 9]]),
      'main later start, main earlier end'
    );
    mainTimeRanges = [[1, 10]];
    audioTimeRanges = [[2, 9]];
    pc.seekable_ = createTimeRanges();
    pc.onSyncInfoUpdate_();
    timeRangesEqual(
      pc.seekable(),
      createTimeRanges([[2, 9]]),
      'audio later start, audio earlier end'
    );
    mainTimeRanges = [[1, 10]];
    audioTimeRanges = [[11, 20]];
    pc.seekable_ = createTimeRanges();
    pc.onSyncInfoUpdate_();
    timeRangesEqual(
      pc.seekable(),
      createTimeRanges([[1, 10]]),
      'no intersection, audio later'
    );
    mainTimeRanges = [[11, 20]];
    audioTimeRanges = [[1, 10]];
    pc.seekable_ = createTimeRanges();
    pc.onSyncInfoUpdate_();
    timeRangesEqual(
      pc.seekable(),
      createTimeRanges([[11, 20]]),
      'no intersection, main later'
    );

    Playlist.seekable = origSeekable;
  }
);

QUnit.test(
  'syncInfoUpdate triggers seekablechanged when seekable is updated',
  function(assert) {
    const origSeekable = Playlist.seekable;
    const pc = this.playlistController;
    const tech = this.player.tech_;
    let mainTimeRanges = [];
    const media = {};
    let seekablechanged = 0;

    tech.on('seekablechanged', () => seekablechanged++);

    Playlist.seekable = () => {
      return createTimeRanges(mainTimeRanges);
    };
    this.playlistController.mainPlaylistLoader_.main = {};
    this.playlistController.mainPlaylistLoader_.media = () => media;
    this.playlistController.syncController_.getExpiredTime = () => 0;

    mainTimeRanges = [[0, 10]];
    pc.seekable_ = createTimeRanges();
    pc.onSyncInfoUpdate_();
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
    src: 'manifest/main.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.playlistController = this.player.tech_.vhs.playlistController_;

  let callCount = 0;

  this.playlistController.updateAdCues_ = (media) => {
    callCount++;
  };

  // main
  this.standardXHRResponse(this.requests.shift());

  assert.equal(callCount, 0, 'no call to update cues on main');

  // media
  this.standardXHRResponse(this.requests.shift());

  assert.equal(callCount, 1, 'calls to update cues on first media');

  this.playlistController.mainPlaylistLoader_.trigger('loadedplaylist');

  assert.equal(callCount, 2, 'calls to update cues on subsequent media');

  videojs.options.vhs = origVhsOptions;
});

QUnit.test('calls to update cues on media when no main', function(assert) {
  this.requests.length = 0;

  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.playlistController = this.player.tech_.vhs.playlistController_;
  this.playlistController.useCueTags_ = true;

  let callCount = 0;

  this.playlistController.updateAdCues_ = (media) => callCount++;

  // media
  this.standardXHRResponse(this.requests.shift());

  assert.equal(callCount, 1, 'calls to update cues on first media');

  this.playlistController.mainPlaylistLoader_.trigger('loadedplaylist');

  assert.equal(callCount, 2, 'calls to update cues on subsequent media');
});

QUnit.test('respects useCueTags option', function(assert) {
  const origVhsOptions = videojs.options.vhs;
  let vhsPlaylistCueTagsEvents = 0;

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
  });
  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.playlistController = this.player.tech_.vhs.playlistController_;
  this.standardXHRResponse(this.requests.shift());
  this.standardXHRResponse(this.requests.shift());

  assert.equal(vhsPlaylistCueTagsEvents, 1, 'cue tags event has been triggered once');
  assert.ok(
    this.playlistController.cueTagsTrack_,
    'creates cueTagsTrack_ if useCueTags is truthy'
  );
  assert.equal(
    this.playlistController.cueTagsTrack_.label,
    'ad-cues',
    'cueTagsTrack_ has label of ad-cues'
  );
  assert.equal(
    this.player.textTracks()[0], this.playlistController.cueTagsTrack_,
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

  // main
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
  });

  openMediaSource(this.player, this.clock);
  // main
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  assert.equal(vhsDemuxedEvents, 1, 'video and audio is demuxed by default');
});

QUnit.test('trigger events when an AES is detected', function(assert) {
  let vhsAesEvents = 0;
  const isAesCopy = Vhs.Playlist.isAes;

  Vhs.Playlist.isAes = (media) => {
    return true;
  };

  this.player.tech_.on('usage', (event) => {
    if (event.name === 'vhs-aes') {
      vhsAesEvents++;
    }
  });

  // main
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());
  this.playlistController.mediaSource.trigger('sourceopen');

  assert.equal(vhsAesEvents, 1, 'an AES HLS stream is detected');
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

  this.player.tech_.on('usage', (event) => {
    if (event.name === 'vhs-fmp4') {
      vhsFmp4Events++;
    }
  });

  const pc = this.player.tech(true).vhs.playlistController_;
  const loader = pc.mainSegmentLoader_;

  // media
  this.standardXHRResponse(this.requests.shift());

  return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_, {
    videoEl: this.player.tech_.el_,
    isVideoOnly: true
  }).then(() => {
    assert.equal(vhsFmp4Events, 0, 'an fMP4 stream is not detected');

    const initSegmentRequest = this.requests.shift();
    const segmentRequest = this.requests.shift();

    return requestAndAppendSegment({
      request: segmentRequest,
      initSegmentRequest,
      segmentLoader: pc.mainSegmentLoader_,
      initSegment: mp4VideoInitSegment(),
      segment: mp4VideoSegment(),
      isOnlyVideo: true,
      clock: this.clock
    });
  }).then(() => {
    assert.equal(vhsFmp4Events, 1, 'an fMP4 stream is detected');
  });
});

QUnit.test('only triggers a single fmp4 usage event', function(assert) {
  let vhsFmp4Events = 0;

  this.player.tech_.on('usage', (event) => {
    if (event.name === 'vhs-fmp4') {
      vhsFmp4Events++;
    }
  });

  const mainSegmentLoader = this.player.tech(true).vhs.playlistController_.mainSegmentLoader_;

  mainSegmentLoader.trigger('fmp4');

  assert.equal(vhsFmp4Events, 1, 'fired fMP4 usage event');

  mainSegmentLoader.trigger('fmp4');

  assert.equal(vhsFmp4Events, 1, 'did not fire usage event');

  const audioSegmentLoader =
    this.player.tech(true).vhs.playlistController_.audioSegmentLoader_;

  audioSegmentLoader.trigger('fmp4');

  assert.equal(vhsFmp4Events, 1, 'did not fire usage event');
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

  this.player.tech_.on('usage', (event) => {
    if (event.name === 'vhs-fmp4') {
      vhsFmp4Events++;
    }
  });

  const pc = this.player.tech(true).vhs.playlistController_;
  const loader = pc.mainSegmentLoader_;

  // media
  this.standardXHRResponse(this.requests.shift());

  return setupMediaSource(loader.mediaSource_, loader.sourceUpdater_, {
    videoEl: this.player.tech_.el_,
    isAudioOnly: true
  }).then(() => {
    assert.equal(vhsFmp4Events, 0, 'an fMP4 stream is not detected');

    const initSegmentRequest = this.requests.shift();
    const segmentRequest = this.requests.shift();

    return requestAndAppendSegment({
      request: segmentRequest,
      initSegmentRequest,
      segmentLoader: pc.mainSegmentLoader_,
      initSegment: mp4AudioInitSegment(),
      segment: mp4AudioSegment(),
      isOnlyAudio: true,
      clock: this.clock
    });
  }).then(() => {
    assert.equal(vhsFmp4Events, 1, 'an fMP4 stream is detected');
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
  const pc = this.player.tech(true).vhs.playlistController_;
  const origCreateSourceBuffers =
    pc.sourceUpdater_.createSourceBuffers.bind(pc.sourceUpdater_);

  pc.sourceUpdater_.createSourceBuffers = (codecs) => {
    createSourceBufferCalls.push(codecs);
    origCreateSourceBuffers(codecs);
  };

  const loader = pc.mainSegmentLoader_;

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
      segmentLoader: pc.mainSegmentLoader_,
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
  const pc = this.player.tech(true).vhs.playlistController_;
  const origCreateSourceBuffers =
    pc.sourceUpdater_.createSourceBuffers.bind(pc.sourceUpdater_);

  pc.sourceUpdater_.createSourceBuffers = (codecs) => {
    createSourceBufferCalls.push(codecs);
    origCreateSourceBuffers(codecs);
  };

  const loader = pc.mainSegmentLoader_;

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
      segmentLoader: pc.mainSegmentLoader_,
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
  const pc = this.player.tech(true).vhs.playlistController_;
  const origCreateSourceBuffers =
    pc.sourceUpdater_.createSourceBuffers.bind(pc.sourceUpdater_);

  pc.sourceUpdater_.createSourceBuffers = (codecs) => {
    createSourceBufferCalls.push(codecs);
    origCreateSourceBuffers(codecs);
  };

  const loader = pc.mainSegmentLoader_;

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
      segmentLoader: pc.mainSegmentLoader_,
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
  'adds CEA608 closed-caption tracks when a main playlist is loaded',
  function(assert) {
    this.requests.length = 0;
    this.player.dispose();
    this.player = createPlayer();
    this.player.src({
      src: 'manifest/main-captions.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    // wait for async player.src to complete
    this.clock.tick(1);

    const playlistController = this.player.tech_.vhs.playlistController_;

    assert.equal(this.player.textTracks().length, 1, 'one text track to start');
    assert.equal(
      this.player.textTracks()[0].label,
      'segment-metadata',
      'only segment-metadata text track'
    );

    // main, contains media groups for captions
    this.standardXHRResponse(this.requests.shift());

    // we wait for loadedmetadata before setting caption tracks, so we need to wait for a
    // media playlist
    assert.equal(this.player.textTracks().length, 1, 'only one text track after main');

    // media
    this.standardXHRResponse(this.requests.shift());

    const main = playlistController.mainPlaylistLoader_.main;
    const caps = main.mediaGroups['CLOSED-CAPTIONS'].CCs;
    const capsArr = Object.keys(caps).map(key => Object.assign({name: key}, caps[key]));
    const addedCaps = playlistController.mediaTypes_['CLOSED-CAPTIONS'].groups.CCs
      .map(cap => Object.assign({name: cap.id}, cap));

    assert.equal(capsArr.length, 4, '4 closed-caption tracks defined in playlist');
    assert.equal(addedCaps.length, 4, '4 tracks, 2 608 and 2 708 tracks, added internally');
    assert.equal(addedCaps[0].instreamId, 'CC1', 'first 608 track is CC1');
    assert.equal(addedCaps[2].instreamId, 'CC3', 'second 608 track is CC3');

    const textTracks = this.player.textTracks();

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

QUnit.test(
  'adds CEA708 closed-caption tracks when a main playlist is loaded',
  function(assert) {
    this.requests.length = 0;
    this.player.dispose();
    this.player = createPlayer();
    this.player.src({
      src: 'manifest/main-captions.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    // wait for async player.src to complete
    this.clock.tick(1);

    const playlistController = this.player.tech_.vhs.playlistController_;

    assert.equal(this.player.textTracks().length, 1, 'one text track to start');
    assert.equal(
      this.player.textTracks()[0].label,
      'segment-metadata',
      'only segment-metadata text track'
    );

    // main, contains media groups for captions
    this.standardXHRResponse(this.requests.shift());

    // we wait for loadedmetadata before setting caption tracks, so we need to wait for a
    // media playlist
    assert.equal(this.player.textTracks().length, 1, 'only one text track after main');

    // media
    this.standardXHRResponse(this.requests.shift());

    const main = playlistController.mainPlaylistLoader_.main;
    const caps = main.mediaGroups['CLOSED-CAPTIONS'].CCs;
    const capsArr = Object.keys(caps).map(key => Object.assign({name: key}, caps[key]));
    const addedCaps = playlistController.mediaTypes_['CLOSED-CAPTIONS'].groups.CCs
      .map(cap => Object.assign({name: cap.id}, cap));

    assert.equal(capsArr.length, 4, '4 closed-caption tracks defined in playlist');
    assert.equal(addedCaps.length, 4, '4 tracks, 2 608 and 2 708 tracks, added internally');
    assert.equal(addedCaps[1].instreamId, 'SERVICE1', 'first 708 track is SERVICE1');
    assert.equal(addedCaps[3].instreamId, 'SERVICE3', 'second 708 track is SERVICE3');

    const textTracks = this.player.textTracks();

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

  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/main-subtitles.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.player.tech_.on('usage', (event) => {
    if (event.name === 'vhs-webvtt') {
      vhsWebvttEvents++;
    }
  });

  const playlistController = this.player.tech_.vhs.playlistController_;

  assert.equal(vhsWebvttEvents, 0, 'there is no webvtt detected');
  assert.equal(this.player.textTracks().length, 1, 'one text track to start');
  assert.equal(
    this.player.textTracks()[0].label,
    'segment-metadata',
    'only segment-metadata text track'
  );

  // main, contains media groups for subtitles
  this.standardXHRResponse(this.requests.shift());

  // we wait for loadedmetadata before setting subtitle tracks, so we need to wait for a
  // media playlist
  assert.equal(this.player.textTracks().length, 1, 'only one text track after main');

  // media
  this.standardXHRResponse(this.requests.shift());

  const main = playlistController.mainPlaylistLoader_.main;
  const subs = main.mediaGroups.SUBTITLES.subs;
  const subsArr = Object.keys(subs).map(key => subs[key]);

  assert.equal(subsArr.length, 4, 'got 4 subtitles');
  assert.equal(subsArr.filter(sub => sub.forced === false).length, 2, '2 forced');
  assert.equal(subsArr.filter(sub => sub.forced === true).length, 2, '2 non-forced');

  const textTracks = this.player.textTracks();

  assert.equal(textTracks.length, 3, 'non-forced text tracks were added');
  assert.equal(textTracks[1].mode, 'disabled', 'track starts disabled');
  assert.equal(textTracks[2].mode, 'disabled', 'track starts disabled');
  assert.equal(vhsWebvttEvents, 1, 'there is webvtt detected in the rendition');

  // change source to make sure tracks are cleaned up
  this.player.src({
    src: 'http://example.com/media.mp4',
    type: 'video/mp4'
  });

  this.clock.tick(1);

  assert.equal(this.player.textTracks().length, 0, 'text tracks cleaned');
});

QUnit.test('adds subtitle tracks including forced subtitles when a media playlist is loaded', function(assert) {
  let vhsWebvttEvents = 0;

  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer({
    html5: {
      vhs: { useForcedSubtitles: true }
    }
  });
  this.player.src({
    src: 'manifest/main-subtitles.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.player.tech_.on('usage', (event) => {
    if (event.name === 'vhs-webvtt') {
      vhsWebvttEvents++;
    }
  });

  const playlistController = this.player.tech_.vhs.playlistController_;

  assert.equal(vhsWebvttEvents, 0, 'there is no webvtt detected');
  assert.equal(this.player.textTracks().length, 1, 'one text track to start');
  assert.equal(
    this.player.textTracks()[0].label,
    'segment-metadata',
    'only segment-metadata text track'
  );

  // main, contains media groups for subtitles
  this.standardXHRResponse(this.requests.shift());

  // we wait for loadedmetadata before setting subtitle tracks, so we need to wait for a
  // media playlist
  assert.equal(this.player.textTracks().length, 1, 'only one text track after main');

  // media
  this.standardXHRResponse(this.requests.shift());

  const main = playlistController.mainPlaylistLoader_.main;
  const subs = main.mediaGroups.SUBTITLES.subs;
  const subsArr = Object.keys(subs).map(key => subs[key]);

  assert.equal(subsArr.length, 4, 'got 4 subtitles');
  assert.equal(subsArr.filter(sub => sub.forced === false).length, 2, '2 forced');
  assert.equal(subsArr.filter(sub => sub.forced === true).length, 2, '2 non-forced');

  const textTracks = this.player.textTracks();

  assert.equal(textTracks.length, 5, 'forced text tracks were added');
  assert.equal(textTracks[1].mode, 'disabled', 'track starts disabled');
  assert.equal(textTracks[2].mode, 'disabled', 'track starts disabled');
  assert.equal(vhsWebvttEvents, 1, 'there is webvtt detected in the rendition');

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
    src: 'manifest/main-subtitles.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  const playlistController = this.player.tech_.vhs.playlistController_;

  // sets up listener for text track changes
  playlistController.trigger('sourceopen');

  // main, contains media groups for subtitles
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

  const syncController = playlistController.subtitleSegmentLoader_.syncController_;

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
    src: 'manifest/main-subtitles.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  const playlistController = this.player.tech_.vhs.playlistController_;

  // sets up listener for text track changes
  playlistController.trigger('sourceopen');

  // main, contains media groups for subtitles
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

  playlistController.subtitleSegmentLoader_.pause = () => pauseCount++;

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
    src: 'manifest/main-subtitles.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  let playlistController = this.player.tech_.vhs.playlistController_;

  assert.notOk(
    playlistController.mediaTypes_.SUBTITLES.activePlaylistLoader,
    'does not start with a subtitle playlist loader'
  );
  assert.ok(
    playlistController.subtitleSegmentLoader_,
    'starts with a subtitle segment loader'
  );

  let segmentLoaderDisposeCount = 0;

  playlistController.subtitleSegmentLoader_.dispose =
    () => segmentLoaderDisposeCount++;

  playlistController.dispose();

  assert.equal(segmentLoaderDisposeCount, 1, 'disposed the subtitle segment loader');

  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/main-subtitles.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  playlistController = this.player.tech_.vhs.playlistController_;

  // sets up listener for text track changes
  playlistController.trigger('sourceopen');

  // main, contains media groups for subtitles
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
    playlistController.mediaTypes_.SUBTITLES.activePlaylistLoader,
    'has a subtitle playlist loader'
  );
  assert.ok(
    playlistController.subtitleSegmentLoader_,
    'has a subtitle segment loader'
  );

  let playlistLoaderDisposeCount = 0;

  segmentLoaderDisposeCount = 0;

  playlistController.mediaTypes_.SUBTITLES.activePlaylistLoader.dispose =
    () => playlistLoaderDisposeCount++;
  playlistController.subtitleSegmentLoader_.dispose =
    () => segmentLoaderDisposeCount++;

  playlistController.dispose();

  assert.equal(playlistLoaderDisposeCount, 1, 'disposed the subtitle playlist loader');
  assert.equal(segmentLoaderDisposeCount, 1, 'disposed the subtitle segment loader');
});

QUnit.test('subtitle segment loader resets on seeks', function(assert) {
  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/main-subtitles.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  const playlistController = this.player.tech_.vhs.playlistController_;

  // sets up listener for text track changes
  playlistController.trigger('sourceopen');

  // main, contains media groups for subtitles
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
  let loadCount = 0;

  playlistController.subtitleSegmentLoader_.resetEverything = () => resetCount++;
  playlistController.subtitleSegmentLoader_.load = () => loadCount++;

  this.player.pause();
  playlistController.setCurrentTime(5);

  assert.equal(resetCount, 1, 'reset subtitle segment loader');
  assert.equal(loadCount, 1, 'called load on subtitle segment loader');

  this.player.play();
  resetCount = 0;
  loadCount = 0;
  playlistController.setCurrentTime(10);

  assert.equal(resetCount, 1, 'reset subtitle segment loader');
  assert.equal(loadCount, 1, 'called load on subtitle segment loader');
});

QUnit.test('calculates dynamic GOAL_BUFFER_LENGTH', function(assert) {
  const configOld = {
    GOAL_BUFFER_LENGTH: Config.GOAL_BUFFER_LENGTH,
    MAX_GOAL_BUFFER_LENGTH: Config.MAX_GOAL_BUFFER_LENGTH,
    GOAL_BUFFER_LENGTH_RATE: Config.GOAL_BUFFER_LENGTH_RATE
  };
  const pc = this.playlistController;

  let currentTime = 0;

  Config.GOAL_BUFFER_LENGTH = 30;
  Config.MAX_GOAL_BUFFER_LENGTH = 60;
  Config.GOAL_BUFFER_LENGTH_RATE = 0.5;

  pc.tech_.currentTime = () => currentTime;

  assert.equal(pc.goalBufferLength(), 30, 'dynamic GBL uses starting value at time 0');

  currentTime = 10;

  assert.equal(pc.goalBufferLength(), 35, 'dynamic GBL increases by currentTime * rate');

  currentTime = 60;

  assert.equal(pc.goalBufferLength(), 60, 'dynamic GBL uses max value');

  currentTime = 70;

  assert.equal(pc.goalBufferLength(), 60, 'dynamic GBL continues to use max value');

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
  const pc = this.playlistController;

  let currentTime = 0;

  Config.BUFFER_LOW_WATER_LINE = 0;
  Config.MAX_BUFFER_LOW_WATER_LINE = 30;
  Config.BUFFER_LOW_WATER_LINE_RATE = 0.5;

  pc.tech_.currentTime = () => currentTime;

  assert.equal(pc.bufferLowWaterLine(), 0, 'dynamic BLWL uses starting value at time 0');

  currentTime = 10;

  assert.equal(
    pc.bufferLowWaterLine(), 5,
    'dynamic BLWL increases by currentTime * rate'
  );

  currentTime = 60;

  assert.equal(pc.bufferLowWaterLine(), 30, 'dynamic BLWL uses max value');

  currentTime = 70;

  assert.equal(pc.bufferLowWaterLine(), 30, 'dynamic BLWL continues to use max value');

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
    src: 'manifest/main.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const pc = this.player.tech(true).vhs.playlistController_;
  const origCreateSourceBuffers =
    pc.sourceUpdater_.createSourceBuffers.bind(pc.sourceUpdater_);

  pc.sourceUpdater_.createSourceBuffers = (codecs) => {
    createSourceBufferCalls.push(codecs);
    origCreateSourceBuffers(codecs);
  };

  openMediaSource(this.player, this.clock);

  // main
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  assert.equal(createSourceBufferCalls.length, 0, 'have not created source buffers yet');

  return requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: pc.mainSegmentLoader_,
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
    src: 'manifest/main.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const pc = this.player.tech(true).vhs.playlistController_;
  const origCreateSourceBuffers =
    pc.sourceUpdater_.createSourceBuffers.bind(pc.sourceUpdater_);

  pc.sourceUpdater_.createSourceBuffers = (codecs) => {
    createSourceBufferCalls.push(codecs);
    origCreateSourceBuffers(codecs);
  };

  openMediaSource(this.player, this.clock);

  // main
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  assert.equal(createSourceBufferCalls.length, 0, 'have not created source buffers yet');

  return requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: pc.mainSegmentLoader_,
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
    src: 'manifest/main.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const pc = this.player.tech(true).vhs.playlistController_;
  const origCreateSourceBuffers =
    pc.sourceUpdater_.createSourceBuffers.bind(pc.sourceUpdater_);

  pc.sourceUpdater_.createSourceBuffers = (codecs) => {
    createSourceBufferCalls.push(codecs);
    origCreateSourceBuffers(codecs);
  };

  openMediaSource(this.player, this.clock);

  // main
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  assert.equal(createSourceBufferCalls.length, 0, 'have not created source buffers yet');

  return requestAndAppendSegment({
    request: this.requests.shift(),
    segmentLoader: pc.mainSegmentLoader_,
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
    src: 'manifest/main.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const pc = this.player.tech(true).vhs.playlistController_;
  const origCreateSourceBuffers =
    pc.sourceUpdater_.createSourceBuffers.bind(pc.sourceUpdater_);

  pc.sourceUpdater_.createSourceBuffers = (codecs) => {
    createSourceBufferCalls.push(codecs);
    origCreateSourceBuffers(codecs);
  };

  openMediaSource(this.player, this.clock);

  // main
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

  pc.mainSegmentLoader_.on('trackinfo', onTrackInfo);
  pc.audioSegmentLoader_.on('trackinfo', onTrackInfo);

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
  const pc = this.player.tech(true).vhs.playlistController_;
  const origCreateSourceBuffers =
    pc.sourceUpdater_.createSourceBuffers.bind(pc.sourceUpdater_);

  pc.sourceUpdater_.createSourceBuffers = (codecs) => {
    createSourceBufferCalls.push(codecs);
    origCreateSourceBuffers(codecs);
  };

  openMediaSource(this.player, this.clock);

  // main
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

  pc.mainSegmentLoader_.on('trackinfo', onTrackInfo);
  pc.audioSegmentLoader_.on('trackinfo', onTrackInfo);

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
    src: 'manifest/main.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const pc = this.player.tech(true).vhs.playlistController_;
  const origCreateSourceBuffers =
    pc.sourceUpdater_.createSourceBuffers.bind(pc.sourceUpdater_);

  pc.sourceUpdater_.createSourceBuffers = (codecs) => {
    createSourceBufferCalls.push(codecs);
    origCreateSourceBuffers(codecs);
  };

  openMediaSource(this.player, this.clock);

  // main
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
    segmentLoader: pc.mainSegmentLoader_,
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
    src: 'manifest/main.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const pc = this.player.tech(true).vhs.playlistController_;
  const origCreateSourceBuffers =
    pc.sourceUpdater_.createSourceBuffers.bind(pc.sourceUpdater_);

  pc.sourceUpdater_.createSourceBuffers = (codecs) => {
    createSourceBufferCalls.push(codecs);
    origCreateSourceBuffers(codecs);
  };

  openMediaSource(this.player, this.clock);

  // main
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
    segmentLoader: pc.mainSegmentLoader_,
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
    src: 'manifest/main.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const pc = this.player.tech(true).vhs.playlistController_;
  const origCreateSourceBuffers =
    pc.sourceUpdater_.createSourceBuffers.bind(pc.sourceUpdater_);

  pc.sourceUpdater_.createSourceBuffers = (codecs) => {
    createSourceBufferCalls.push(codecs);
    origCreateSourceBuffers(codecs);
  };

  openMediaSource(this.player, this.clock);

  // main
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
    segmentLoader: pc.mainSegmentLoader_,
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
    src: 'manifest/main.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const pc = this.player.tech(true).vhs.playlistController_;
  const origCreateSourceBuffers =
    pc.sourceUpdater_.createSourceBuffers.bind(pc.sourceUpdater_);

  pc.sourceUpdater_.createSourceBuffers = (codecs) => {
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

  pc.mainSegmentLoader_.on('trackinfo', onTrackInfo);
  pc.audioSegmentLoader_.on('trackinfo', onTrackInfo);

  this.standardXHRResponse(this.requests.shift(), videoSegment());
  this.standardXHRResponse(this.requests.shift(), audioSegment());
});

QUnit.test('uses codec info from manifest for source buffer creation for audio only', function(assert) {
  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/main.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const pc = this.player.tech(true).vhs.playlistController_;
  const origCreateSourceBuffers =
    pc.sourceUpdater_.createSourceBuffers.bind(pc.sourceUpdater_);

  pc.sourceUpdater_.createSourceBuffers = (codecs) => {
    createSourceBufferCalls.push(codecs);
    origCreateSourceBuffers(codecs);
  };

  openMediaSource(this.player, this.clock);

  // main
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
    segmentLoader: pc.mainSegmentLoader_,
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
    src: 'manifest/main.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const pc = this.player.tech(true).vhs.playlistController_;
  const origCreateSourceBuffers =
    pc.sourceUpdater_.createSourceBuffers.bind(pc.sourceUpdater_);

  pc.sourceUpdater_.createSourceBuffers = (codecs) => {
    createSourceBufferCalls.push(codecs);
    origCreateSourceBuffers(codecs);
  };

  openMediaSource(this.player, this.clock);

  // main
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
    segmentLoader: pc.mainSegmentLoader_,
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
    src: 'manifest/main.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const pc = this.player.tech(true).vhs.playlistController_;
  const origCreateSourceBuffers =
    pc.sourceUpdater_.createSourceBuffers.bind(pc.sourceUpdater_);

  pc.sourceUpdater_.createSourceBuffers = (codecs) => {
    createSourceBufferCalls.push(codecs);
    origCreateSourceBuffers(codecs);
  };

  openMediaSource(this.player, this.clock);

  // main
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
    segmentLoader: pc.mainSegmentLoader_,
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
    src: 'manifest/main.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const createSourceBufferCalls = [];
  const pc = this.player.tech(true).vhs.playlistController_;
  const origCreateSourceBuffers =
    pc.sourceUpdater_.createSourceBuffers.bind(pc.sourceUpdater_);

  pc.sourceUpdater_.createSourceBuffers = (codecs) => {
    createSourceBufferCalls.push(codecs);
    origCreateSourceBuffers(codecs);
  };

  openMediaSource(this.player, this.clock);

  // main
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
    segmentLoader: pc.mainSegmentLoader_,
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
  const pc = this.playlistController;

  pc.setupSourceBuffers = () => true;
  pc.tech_ = {
    autoplay: () => true,
    play: () => new Promise(function(resolve, reject) {
      reject(new window.DOMException());
    })
  };
  pc.handleSourceOpen_();

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

    this.playlistController = this.player.tech_.vhs.playlistController_;

    // a duration update indicates a main playlist controller state update from the media
    // playlist
    assert.equal(this.playlistController.duration(), 40, 'duration set');

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
  'when data URI is a main playlist with media playlists resolved, ' +
  'state is updated without a playlist request',
  function(assert) {
    this.requests.length = 0;
    // must recreate player for new mock media source to open
    this.player.dispose();
    this.player = createPlayer();

    const manifestObject = parseManifest({ manifestString: manifests.main });
    const mediaObject = parseManifest({ manifestString: manifests.media });

    // prevent warnings for no BANDWIDTH attribute as media playlists within a main
    // should always have the property
    mediaObject.attributes = { BANDWIDTH: 1000 };

    manifestObject.playlists = [mediaObject, mediaObject, mediaObject];
    // placeholder main URI
    addPropertiesToMain(manifestObject, 'main.m3u8');

    this.player.src({
      src: `data:application/vnd.videojs.vhs+json,${JSON.stringify(manifestObject)}`,
      type: 'application/vnd.videojs.vhs+json'
    });
    // media source must be open for duration to be set
    openMediaSource(this.player, this.clock);
    // asynchronous setup of initial playlist in playlist loader for JSON sources
    this.clock.tick(1);

    this.playlistController = this.player.tech_.vhs.playlistController_;

    // a duration update indicates a main playlist controller state update from the media
    // playlist
    assert.equal(this.playlistController.duration(), 40, 'duration set');

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
  'when data URI is a main playlist without media playlists resolved, ' +
  'a media playlist request is the first request',
  function(assert) {
    this.requests.length = 0;
    // must recreate player for new mock media source to open
    this.player.dispose();
    this.player = createPlayer();

    const manifestObject = parseManifest({ manifestString: manifests.main });

    this.player.src({
      src: `data:application/vnd.videojs.vhs+json,${JSON.stringify(manifestObject)}`,
      type: 'application/vnd.videojs.vhs+json'
    });
    // media source must be open for duration to be set
    openMediaSource(this.player, this.clock);

    this.playlistController = this.player.tech_.vhs.playlistController_;

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
  const pc = this.playlistController;

  // main
  this.standardXHRResponse(this.requests.shift());

  assert.notOk(pc.mediaSource.duration, 'no duration set on media source');

  // playlist
  this.standardXHRResponse(this.requests.shift());

  assert.equal(pc.mediaSource.duration, 40, 'duration set on media source');
});

QUnit.test('live playlist reports infinite duration', function(assert) {
  openMediaSource(this.player, this.clock);
  const pc = this.playlistController;

  // main
  this.standardXHRResponse(this.requests.shift());

  assert.notOk(pc.mediaSource.duration, 'no duration set on media source');

  this.requests.shift().respond(
    200, null,
    '#EXTM3U\n' +
                                '#EXTINF:5.0\n' +
                                '0.ts\n'
  );

  assert.equal(pc.duration(), Infinity, 'duration reported as infinite');
});

QUnit.test(
  'live playlist sets duration of media source to seekable end',
  function(assert) {
    openMediaSource(this.player, this.clock);
    const pc = this.playlistController;

    // main
    this.standardXHRResponse(this.requests.shift());

    assert.notOk(pc.mediaSource.duration, 'no duration set on media source');

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

    assert.equal(pc.seekable().end(0), 5, 'calculated seekable end');
    assert.equal(
      pc.mediaSource.duration,
      5,
      'native media source duration set to seekable end'
    );
  }
);

QUnit.test(
  'VOD playlist sets duration of media source to calculated playlist duration',
  function(assert) {
    openMediaSource(this.player, this.clock);
    const pc = this.playlistController;

    // main
    this.standardXHRResponse(this.requests.shift());

    assert.notOk(pc.mediaSource.duration, 'no duration set on media source');

    this.requests.shift().respond(200, null, `
    #EXTM3U
    #EXT-X-TARGETDURATION:5
    #EXTINF:5
    0.ts
    #EXTINF:5
    1.ts
    #EXT-X-ENDLIST
  `);

    assert.equal(pc.mediaSource.duration, 10, 'media source duration set to 10');
  }
);

QUnit.test(
  'VOD playlist sets duration of media source to buffered end if greater than calculated ' +
'playlist duration',
  function(assert) {
    openMediaSource(this.player, this.clock);
    const pc = this.playlistController;

    this.player.tech_.buffered = () => createTimeRanges([[0, 11]]);

    // main
    this.standardXHRResponse(this.requests.shift());

    assert.notOk(pc.mediaSource.duration, 'no duration set on media source');

    this.requests.shift().respond(200, null, `
    #EXTM3U
    #EXT-X-TARGETDURATION:5
    #EXTINF:5
    0.ts
    #EXTINF:5
    1.ts
    #EXT-X-ENDLIST
  `);

    assert.equal(pc.mediaSource.duration, 11, 'media source duration set to 11');
  }
);

QUnit.test('disposes timeline change controller on dispose', function(assert) {
  let disposes = 0;

  this.playlistController.timelineChangeController_.on('dispose', () => {
    disposes++;
  });

  this.playlistController.dispose();

  assert.equal(disposes, 1, 'disposed timeline change controller');
});

QUnit.test('on error all segment and playlist loaders are paused and aborted', function(assert) {
  const pc = this.playlistController;
  const calls = {};
  const expected = {};

  Object.keys(this.playlistController.mediaTypes_).forEach((type) => {
    const key = `${type.toLowerCase()}Playlist`;

    calls[`${key}Abort`] = 0;
    calls[`${key}Pause`] = 0;
    expected[`${key}Abort`] = 1;
    expected[`${key}Pause`] = 1;

    this.playlistController.mediaTypes_[type].activePlaylistLoader = {
      pause: () => calls[`${key}Pause`]++,
      abort: () => calls[`${key}Abort`]++
    };
  });

  [
    'audioSegmentLoader',
    'subtitleSegmentLoader',
    'mainSegmentLoader',
    'mainPlaylistLoader'
  ].forEach(function(key) {
    calls[`${key}Abort`] = 0;
    calls[`${key}Pause`] = 0;
    expected[`${key}Abort`] = 1;
    expected[`${key}Pause`] = 1;
    pc[`${key}_`].pause = () => calls[`${key}Pause`]++;
    pc[`${key}_`].abort = () => calls[`${key}Abort`]++;
  });

  this.playlistController.trigger('error');

  assert.deepEqual(calls, expected, 'calls as expected');
});

QUnit.test('can pass or select a playlist for fastQualityChange', function(assert) {
  const calls = {
    resyncLoader: 0,
    media: 0,
    selectPlaylist: 0
  };

  const pc = this.playlistController;

  this.player.tech_.buffered = () => createTimeRanges(0, 1);

  pc.mediaSource.trigger('sourceopen');
  // main
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  // media is changed
  pc.selectPlaylist = () => {
    calls.selectPlaylist++;
    return pc.main().playlists[1];
  };
  pc.mainPlaylistLoader_.media = (playlist) => {
    if (!playlist) {
      return pc.main().playlists[0];
    }
    assert.equal(pc.main().playlists[1], playlist, 'switching to passed in playlist');
    calls.media++;
  };

  pc.mainSegmentLoader_.resyncLoader = function() {
    calls.resyncLoader++;
  };

  pc.fastQualityChange_(pc.main().playlists[1]);
  assert.deepEqual(calls, {
    media: 1,
    selectPlaylist: 0,
    resyncLoader: 1
  }, 'calls expected function when passed a playlist');

  pc.fastQualityChange_();
  assert.deepEqual(calls, {
    media: 2,
    selectPlaylist: 1,
    resyncLoader: 2
  }, 'calls expected function when not passed a playlist');
});

QUnit.module('PlaylistController codecs', {
  beforeEach(assert) {
    sharedHooks.beforeEach.call(this, assert);
    this.pc = this.playlistController;

    this.exclusionList = [];
    this.pc.excludePlaylist = (options) => this.exclusionList.push(options);

    this.contentSetup = (options) => {
      const {
        audioStartingMedia,
        mainStartingMedia,
        audioPlaylist,
        mainPlaylist
      } = options;

      if (mainStartingMedia) {
        this.pc.mainSegmentLoader_.currentMediaInfo_ = mainStartingMedia;
      }

      if (audioStartingMedia) {
        this.pc.audioSegmentLoader_.currentMediaInfo_ = audioStartingMedia;
      }

      this.main = {mediaGroups: {AUDIO: {}}, playlists: []};

      this.pc.main = () => this.main;

      if (mainPlaylist) {
        this.pc.media = () => mainPlaylist;
        this.main.playlists.push(mainPlaylist);
      }

      if (audioPlaylist) {
        const mainAudioGroup = mainPlaylist && mainPlaylist.attributes.AUDIO;

        if (mainAudioGroup) {
          this.main.mediaGroups.AUDIO[mainAudioGroup] = {
            english: {
              default: true,
              playlists: [audioPlaylist]
            }
          };
        }
        this.main.playlists.push(audioPlaylist);
        this.pc.mediaTypes_.AUDIO.activePlaylistLoader = {pause() {}};
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

  const codecs = this.pc.getCodecsOrExclude_();

  assert.deepEqual(this.exclusionList, [], 'did not exclude anything');
  assert.deepEqual(codecs, {audio: 'mp4a.40.5', video: 'avc1.4c400d'}, 'codecs returned');
});

QUnit.test('can get demuxed codecs from the video/main playlist and audio playlist', function(assert) {
  this.contentSetup({
    audioStartingMedia: {hasAudio: true, hasVideo: false},
    mainStartingMedia: {hasVideo: true, hasAudio: false},
    audioPlaylist: {attributes: {CODECS: 'mp4a.40.5'}},
    mainPlaylist: {attributes: {CODECS: 'avc1.4c400d', AUDIO: 'low-quality'}}
  });

  const codecs = this.pc.getCodecsOrExclude_();

  assert.deepEqual(this.exclusionList, [], 'did not exclude anything');
  assert.deepEqual(codecs, {audio: 'mp4a.40.5', video: 'avc1.4c400d'}, 'codecs returned');
});

QUnit.test('can get demuxed codecs from the main and audio loaders', function(assert) {
  this.contentSetup({
    audioStartingMedia: {hasAudio: true, hasVideo: false, audioCodec: 'mp4a.40.5'},
    mainStartingMedia: {hasVideo: true, hasAudio: false, videoCodec: 'avc1.4c400d'},
    audioPlaylist: {attributes: {}},
    mainPlaylist: {attributes: {}}
  });

  const codecs = this.pc.getCodecsOrExclude_();

  assert.deepEqual(this.exclusionList, [], 'did not exclude anything');
  assert.deepEqual(codecs, {audio: 'mp4a.40.5', video: 'avc1.4c400d'}, 'codecs returned');
});

QUnit.test('can get demuxed codecs from the main loader', function(assert) {
  this.contentSetup({
    audioStartingMedia: {},
    mainStartingMedia: {hasVideo: true, hasAudio: true, videoCodec: 'avc1.4c400d', audioCodec: 'mp4a.40.5'},
    audioPlaylist: {attributes: {}},
    mainPlaylist: {attributes: {}}
  });

  const codecs = this.pc.getCodecsOrExclude_();

  assert.deepEqual(this.exclusionList, [], 'did not exclude anything');
  assert.deepEqual(codecs, {audio: 'mp4a.40.5', video: 'avc1.4c400d'}, 'codecs returned');
});

QUnit.test('can get muxed codecs from video/main playlist', function(assert) {
  this.contentSetup({
    mainStartingMedia: {hasVideo: true, hasAudio: true, isMuxed: true},
    mainPlaylist: {attributes: {CODECS: 'avc1.4c400d,mp4a.40.5'}}
  });

  const codecs = this.pc.getCodecsOrExclude_();

  assert.deepEqual(this.exclusionList, [], 'did not exclude anything');
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

  const codecs = this.pc.getCodecsOrExclude_();

  assert.deepEqual(this.exclusionList, [], 'did not exclude anything');
  assert.deepEqual(codecs, {video: 'avc1.4c400d,mp4a.40.5'}, 'codecs returned');
});

QUnit.test('can get audio only codecs from main playlist ', function(assert) {
  this.contentSetup({
    mainStartingMedia: {hasVideo: false, hasAudio: true},
    mainPlaylist: {attributes: {CODECS: 'mp4a.40.5'}}
  });

  const codecs = this.pc.getCodecsOrExclude_();

  assert.deepEqual(this.exclusionList, [], 'did not exclude anything');
  assert.deepEqual(codecs, {audio: 'mp4a.40.5'}, 'codecs returned');
});

QUnit.test('can get audio only codecs from main loader ', function(assert) {
  this.contentSetup({
    mainStartingMedia: {hasVideo: false, hasAudio: true, audioCodec: 'mp4a.40.5'},
    mainPlaylist: {attributes: {}}
  });

  const codecs = this.pc.getCodecsOrExclude_();

  assert.deepEqual(this.exclusionList, [], 'did not exclude anything');
  assert.deepEqual(codecs, {audio: 'mp4a.40.5'}, 'codecs returned');
});

QUnit.test('can get video only codecs from main playlist', function(assert) {
  this.contentSetup({
    mainStartingMedia: {hasVideo: true, hasAudio: false},
    mainPlaylist: {attributes: {CODECS: 'avc1.4c400d'}}
  });

  const codecs = this.pc.getCodecsOrExclude_();

  assert.deepEqual(this.exclusionList, [], 'did not exclude anything');
  assert.deepEqual(codecs, {video: 'avc1.4c400d'}, 'codecs returned');
});

QUnit.test('can get video only codecs from main loader', function(assert) {
  this.contentSetup({
    mainStartingMedia: {hasVideo: true, hasAudio: false, videoCodec: 'avc1.4c400d'},
    mainPlaylist: {attributes: {}}
  });

  const codecs = this.pc.getCodecsOrExclude_();

  assert.deepEqual(this.exclusionList, [], 'did not exclude anything');
  assert.deepEqual(codecs, {video: 'avc1.4c400d'}, 'codecs returned');
});

QUnit.test('can get codecs from startingMedia', function(assert) {
  this.contentSetup({
    mainStartingMedia: {videoCodec: 'avc1.4c400d', hasVideo: true, hasAudio: false},
    audioStartingMedia: {audioCodec: 'mp4a.40.5', hasVideo: false, hasAudio: true},
    mainPlaylist: {attributes: {}},
    audioPlaylist: {attributes: {}}
  });

  const codecs = this.pc.getCodecsOrExclude_();

  assert.deepEqual(this.exclusionList, [], 'did not exclude anything');
  assert.deepEqual(codecs, {video: 'avc1.4c400d', audio: 'mp4a.40.5'}, 'codecs returned');
});

QUnit.test('playlist codecs take priority over others', function(assert) {
  this.contentSetup({
    mainStartingMedia: {videoCodec: 'avc1.4c400d', hasVideo: true, hasAudio: false},
    audioStartingMedia: {audioCodec: 'mp4a.40.5', hasVideo: false, hasAudio: true},
    mainPlaylist: {attributes: {CODECS: 'avc1.4b400d', AUDIO: 'low-quality'}},
    audioPlaylist: {attributes: {CODECS: 'mp4a.40.20'}}
  });

  const codecs = this.pc.getCodecsOrExclude_();

  assert.deepEqual(this.exclusionList, [], 'did not exclude anything');
  assert.deepEqual(codecs, {video: 'avc1.4b400d', audio: 'mp4a.40.20'}, 'codecs returned');
});

QUnit.test('Current pending segment\'s playlist codecs take priority over others', function(assert) {
  this.contentSetup({
    mainStartingMedia: {videoCodec: 'avc1.4c400d', hasVideo: true, hasAudio: false},
    audioStartingMedia: {audioCodec: 'mp4a.40.5', hasVideo: false, hasAudio: true},
    mainPlaylist: {attributes: {CODECS: 'avc1.4b400d', AUDIO: 'low-quality'}},
    audioPlaylist: {attributes: {CODECS: 'mp4a.40.20'}}
  });

  const originalGetPendingSegmentPlaylist = this.pc.mainSegmentLoader_.getPendingSegmentPlaylist.bind(this.pc.mainSegmentLoader_);

  this.pc.mainSegmentLoader_.getPendingSegmentPlaylist = () => ({attributes: {CODECS: 'avc1.64001f', AUDIO: 'low-quality'}});

  const codecs = this.pc.getCodecsOrExclude_();

  assert.deepEqual(this.exclusionList, [], 'did not blacklist anything');
  assert.deepEqual(codecs, {video: 'avc1.64001f', audio: 'mp4a.40.20'}, 'codecs returned');
  this.pc.mainSegmentLoader_.getPendingSegmentPlaylist = originalGetPendingSegmentPlaylist;
});

QUnit.test('uses default codecs if no codecs are found', function(assert) {
  this.contentSetup({
    mainStartingMedia: {hasVideo: true, hasAudio: false},
    audioStartingMedia: {hasVideo: false, hasAudio: true},
    mainPlaylist: {attributes: {}},
    audioPlaylist: {attributes: {}}
  });

  const codecs = this.pc.getCodecsOrExclude_();

  assert.deepEqual(this.exclusionList, [], 'did not exclude anything');
  assert.deepEqual(codecs, {video: 'avc1.4d400d', audio: 'mp4a.40.2'}, 'codecs returned');
});

QUnit.test('excludes playlist without detected audio/video', function(assert) {
  this.contentSetup({
    mainStartingMedia: {},
    audioStartingMedia: {},
    mainPlaylist: {attributes: {}}
  });

  const codecs = this.pc.getCodecsOrExclude_();

  assert.deepEqual(this.exclusionList, [{
    playlistExclusionDuration: Infinity,
    playlistToExclude: { attributes: {} },
    error: { message: 'Could not determine codecs for playlist.' }
  }], 'excluded playlist');
  assert.deepEqual(codecs, void 0, 'no codecs returned');
});

QUnit.test('excludes current pending segment\'s playlist without detected audio/video', function(assert) {
  this.contentSetup({
    mainStartingMedia: {},
    audioStartingMedia: {},
    mainPlaylist: {attributes: {}}
  });

  const originalGetPendingSegmentPlaylist = this.pc.mainSegmentLoader_.getPendingSegmentPlaylist.bind(this.pc.mainSegmentLoader_);

  this.pc.mainSegmentLoader_.getPendingSegmentPlaylist = () => ({attributes: {CODECS: ''}});
  const codecs = this.pc.getCodecsOrExclude_();

  assert.deepEqual(this.exclusionList, [{
    playlistExclusionDuration: Infinity,
    playlistToExclude: {attributes: {CODECS: ''}},
    error: { message: 'Could not determine codecs for playlist.' }
  }], 'excluded playlist');
  assert.deepEqual(codecs, void 0, 'no codecs returned');
  this.pc.mainSegmentLoader_.getPendingSegmentPlaylist = originalGetPendingSegmentPlaylist;
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

  const codecs = this.pc.getCodecsOrExclude_();

  assert.deepEqual(this.exclusionList, [{
    playlistExclusionDuration: Infinity,
    playlistToExclude: {attributes: {}},
    error: {
      internal: true,
      message: 'muxer does not support codec(s): "hvc1.2.4.L123.B0,ac-3".'
    }
  }], 'excluded playlist');
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

  const codecs = this.pc.getCodecsOrExclude_();

  assert.deepEqual(this.exclusionList, [{
    playlistExclusionDuration: Infinity,
    playlistToExclude: {attributes: {}},
    error: {
      internal: true,
      message: 'browser does not support codec(s): "hvc1.2.4.L123.B0,ac-3".'
    }
  }], 'excluded playlist');
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

  const codecs = this.pc.getCodecsOrExclude_();

  assert.deepEqual(this.exclusionList, [{
    playlistExclusionDuration: Infinity,
    playlistToExclude: {attributes: {}},
    error: {
      internal: true,
      message: 'muxer does not support codec(s): "hvc1.2.4.L123.B0,ac-3".'
    }
  }], 'excluded playlist');
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

  const codecs = this.pc.getCodecsOrExclude_();

  assert.deepEqual(this.exclusionList, [{
    playlistExclusionDuration: Infinity,
    playlistToExclude: {attributes: {}},
    error: {
      internal: true,
      message: 'browser does not support codec(s): "hvc1.2.4.L123.B0,ac-3".'
    }
  }], 'excluded playlist');
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

  const codecs = this.pc.getCodecsOrExclude_();

  assert.deepEqual(this.exclusionList, [{
    playlistExclusionDuration: Infinity,
    playlistToExclude: {attributes: {AUDIO: 'low-quality'}},
    error: {
      internal: true,
      message: 'muxer does not support codec(s): "hvc1.2.4.L123.B0", ' +
        'browser does not support codec(s): "ac-3".'
    }
  }], 'excluded playlist');
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

  const codecs = this.pc.getCodecsOrExclude_();

  assert.deepEqual(this.exclusionList, [{
    playlistExclusionDuration: Infinity,
    playlistToExclude: {attributes: {AUDIO: 'low-quality'}},
    error: {
      internal: true,
      message: 'browser does not support codec(s): "hvc1.2.4.L123.B0", ' +
        'muxer does not support codec(s): "ac-3".'
    }
  }], 'excluded playlist');
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

  this.main.playlists.push({id: 'foo', attributes: {AUDIO: 'low-quality'}});
  this.main.playlists.push({id: 'baz', attributes: {AUDIO: 'low-quality'}});

  const codecs = this.pc.getCodecsOrExclude_();

  assert.deepEqual(this.exclusionList, [{
    playlistExclusionDuration: Infinity,
    playlistToExclude: {attributes: {AUDIO: 'low-quality'}, id: 'bar'},
    error: {
      internal: true,
      message: 'muxer does not support codec(s): "hvc1.2.4.L123.B0,ac-3".'
    }
  }], 'excluded playlist');
  assert.deepEqual(codecs, void 0, 'codecs returned');
  assert.equal(this.main.playlists[2].id, 'foo', 'playlist 3 is the one we added');
  assert.equal(this.main.playlists[2].excludeUntil, Infinity, 'playlist 3 with same audio group excluded');
  assert.equal(this.main.playlists[3].id, 'baz', 'playlist 4 is the one we added');
  assert.equal(this.main.playlists[3].excludeUntil, Infinity, 'playlist 4 with same audio group excluded');
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
  this.pc.sourceUpdater_.initializedEme();
  this.pc.sourceUpdater_.createdSourceBuffers_ = () => true;
  this.pc.sourceUpdater_.canChangeType = () => false;
  this.pc.sourceUpdater_.codecs = {
    audio: 'mp4a.40.2',
    video: 'avc1.4c400d'
  };

  // support all types
  window.MediaSource.isTypeSupported = (type) => true;

  const codecs = this.pc.getCodecsOrExclude_();

  assert.deepEqual(this.exclusionList, [{
    playlistExclusionDuration: Infinity,
    playlistToExclude: {attributes: {AUDIO: 'low-quality'}},
    error: {
      internal: true,
      message: 'Codec switching not supported: "avc1.4c400d" -> "hvc1.2.4.L123.B0", "mp4a.40.2" -> "ac-3".'
    }
  }], 'excluded playlist');
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
  this.pc.sourceUpdater_.initializedEme();
  this.pc.sourceUpdater_.createdSourceBuffers_ = () => true;
  this.pc.sourceUpdater_.canChangeType = () => false;
  this.pc.sourceUpdater_.codecs = {
    audio: 'mp4a.40.2',
    video: 'avc1.4c400d'
  };

  // support all types
  window.MediaSource.isTypeSupported = (type) => true;

  const codecs = this.pc.getCodecsOrExclude_();

  assert.deepEqual(this.exclusionList, []);
  assert.deepEqual(codecs, {video: 'avc1.4d400e', audio: 'mp4a.40.5'}, 'codecs returned');
});

QUnit.test('main loader only trackinfo works as expected', function(assert) {
  this.pc.mediaSource.readyState = 'open';
  let createBuffers = 0;
  let switchBuffers = 0;
  let expectedCodecs;

  this.pc.sourceUpdater_.createSourceBuffers = (codecs) => {
    assert.deepEqual(codecs, expectedCodecs, 'create source buffers codecs as expected');
    createBuffers++;
  };
  this.pc.sourceUpdater_.addOrChangeSourceBuffers = (codecs) => {
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
  this.pc.mainSegmentLoader_.trigger('trackinfo');

  assert.equal(createBuffers, 1, 'createSourceBuffers called');
  assert.equal(switchBuffers, 0, 'addOrChangeSourceBuffers not called');

  this.pc.sourceUpdater_.initializedEme();
  this.pc.sourceUpdater_.createdSourceBuffers_ = () => true;
  this.pc.sourceUpdater_.canChangeType = () => true;

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

  this.pc.mainSegmentLoader_.trigger('trackinfo');

  assert.equal(createBuffers, 1, 'createBuffers not called');
  assert.equal(switchBuffers, 1, 'addOrChangeSourceBuffers called');
});

QUnit.test('main & audio loader only trackinfo works as expected', function(assert) {
  this.pc.mediaSource.readyState = 'open';
  let createBuffers = 0;
  let switchBuffers = 0;
  let expectedCodecs;

  this.pc.sourceUpdater_.createSourceBuffers = (codecs) => {
    assert.deepEqual(codecs, expectedCodecs, 'create source buffers codecs as expected');
    createBuffers++;
  };
  this.pc.sourceUpdater_.addOrChangeSourceBuffers = (codecs) => {
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

  this.pc.mainSegmentLoader_.trigger('trackinfo');

  assert.equal(createBuffers, 0, 'createSourceBuffers not called');
  assert.equal(switchBuffers, 0, 'addOrChangeSourceBuffers not called');

  this.pc.audioSegmentLoader_.currentMediaInfo_ = {
    hasVideo: false,
    hasAudio: true,
    audioCodec: 'mp4a.40.2'
  };

  this.pc.audioSegmentLoader_.trigger('trackinfo');

  assert.equal(createBuffers, 1, 'createSourceBuffers called');
  assert.equal(switchBuffers, 0, 'addOrChangeSourceBuffers not called');

  this.pc.sourceUpdater_.initializedEme();
  this.pc.sourceUpdater_.createdSourceBuffers_ = () => true;
  this.pc.sourceUpdater_.canChangeType = () => true;

  this.pc.mainSegmentLoader_.currentMediaInfo_ = {
    videoCodec: 'avc1.4c400e',
    hasVideo: true,
    hasAudio: false
  };

  expectedCodecs = {
    video: 'avc1.4c400e',
    audio: 'mp4a.40.2'
  };

  this.pc.mainSegmentLoader_.trigger('trackinfo');

  assert.equal(createBuffers, 1, 'createBuffers not called');
  assert.equal(switchBuffers, 1, 'addOrChangeSourceBuffers called');

  this.pc.audioSegmentLoader_.currentMediaInfo_ = {
    hasVideo: false,
    hasAudio: true,
    audioCodec: 'mp4a.40.5'
  };

  expectedCodecs = {
    video: 'avc1.4c400e',
    audio: 'mp4a.40.5'
  };

  this.pc.audioSegmentLoader_.trigger('trackinfo');

  assert.equal(createBuffers, 1, 'createBuffers not called');
  assert.equal(switchBuffers, 2, 'addOrChangeSourceBuffers called');
});

QUnit.module('PlaylistController - exclusion behavior', {
  beforeEach(assert) {
    sharedHooks.beforeEach.call(this, assert);

    this.pc = this.playlistController;

    openMediaSource(this.player, this.clock);

    this.player.tech_.vhs.bandwidth = 1;

    this.delegateLoaders = [];
    this.pc.delegateLoaders_ = (filter, fnNames) => {
      this.delegateLoaders.push({filter, fnNames});
    };

    this.runTest = (main, expectedDelegates) => {
      // main
      this.requests.shift()
        .respond(200, null, main);

      // media
      this.standardXHRResponse(this.requests.shift());

      assert.equal(this.pc.media(), this.pc.main().playlists[0], 'selected first playlist');

      this.pc.excludePlaylist({
        playlistToExclude: this.pc.main().playlists[0],
        error: { internal: true },
        playlistExclusionDuration: Infinity
      });

      assert.equal(this.pc.main().playlists[0].excludeUntil, Infinity, 'exclusion happened');
      assert.deepEqual(this.delegateLoaders, expectedDelegates, 'called delegateLoaders');
    };
  },
  afterEach(assert) {
    sharedHooks.afterEach.call(this, assert);
  }
});

QUnit.test('exclusions always pause/abort main loaders', function(assert) {
  const main = `
    #EXTM3U
    #EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.5"
    media.m3u8
    #EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400d,mp4a.40.2"
    media1.m3u8
  `;

  const expectedDelegates = [
    {filter: 'main', fnNames: ['abort', 'pause']}
  ];

  this.runTest(main, expectedDelegates);
});

QUnit.test('exclusions that remove audio group abort/pause main/audio loaders', function(assert) {
  const main = `
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

  this.runTest(main, expectedDelegates);
});

QUnit.test('exclusions that change audio group abort/pause main/audio loaders', function(assert) {
  const main = `
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

  this.runTest(main, expectedDelegates);
});

QUnit.test('exclusions that add audio group abort/pause main/audio loaders', function(assert) {
  const main = `
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

  this.runTest(main, expectedDelegates);
});

QUnit.test('exclusions that add subtitles group abort/pause main/subtitles loaders', function(assert) {
  const main = `
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

  this.runTest(main, expectedDelegates);
});

QUnit.test('exclusions that remove subtitles group abort/pause main/subtitles loaders', function(assert) {
  const main = `
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

  this.runTest(main, expectedDelegates);
});

QUnit.test('exclusions that change subtitles group abort/pause main/subtitles loaders', function(assert) {
  const main = `
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

  this.runTest(main, expectedDelegates);
});

QUnit.test('exclusions that change all groups abort/pause all loaders', function(assert) {
  const main = `
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

  this.runTest(main, expectedDelegates);
});

QUnit.test('exclusions that remove all groups abort/pause all loaders', function(assert) {
  const main = `
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

  this.runTest(main, expectedDelegates);
});

QUnit.test('exclusions that add all groups abort/pause all loaders', function(assert) {
  const main = `
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

  this.runTest(main, expectedDelegates);
});

QUnit.module('PlaylistController delegate loaders', {
  beforeEach(assert) {
    sharedHooks.beforeEach.call(this, assert);

    this.pc = this.playlistController;
    this.calls = {};
    this.expected = {};

    Object.keys(this.pc.mediaTypes_).forEach((type) => {
      const key = `${type.toLowerCase()}Playlist`;

      this.calls[`${key}Abort`] = 0;
      this.calls[`${key}Pause`] = 0;
      this.expected[`${key}Abort`] = 0;
      this.expected[`${key}Pause`] = 0;

      this.pc.mediaTypes_[type].activePlaylistLoader = {
        abort: () => this.calls[`${key}Abort`]++,
        pause: () => this.calls[`${key}Pause`]++
      };
    });

    [
      'audioSegmentLoader',
      'subtitleSegmentLoader',
      'mainSegmentLoader',
      'mainPlaylistLoader'
    ].forEach((key) => {
      this.calls[`${key}Abort`] = 0;
      this.calls[`${key}Pause`] = 0;
      this.expected[`${key}Abort`] = 0;
      this.expected[`${key}Pause`] = 0;
      this.pc[`${key}_`].abort = () => this.calls[`${key}Abort`]++;
      this.pc[`${key}_`].pause = () => this.calls[`${key}Pause`]++;
    });
  },
  afterEach(assert) {
    sharedHooks.afterEach.call(this, assert);
  }
});

QUnit.test('filter all works', function(assert) {
  this.pc.delegateLoaders_('all', ['abort', 'pause']);

  Object.keys(this.expected).forEach((key) => {
    this.expected[key] = 1;
  });

  assert.deepEqual(this.calls, this.expected, 'calls as expected');
});

QUnit.test('filter main works', function(assert) {
  this.pc.delegateLoaders_('main', ['abort', 'pause']);

  Object.keys(this.expected).forEach((key) => {
    if ((/^(main)/).test(key)) {
      this.expected[key] = 1;
    }
  });

  assert.deepEqual(this.calls, this.expected, 'calls as expected');
});

QUnit.test('filter audio works', function(assert) {
  this.pc.delegateLoaders_('audio', ['abort', 'pause']);

  Object.keys(this.expected).forEach((key) => {
    if ((/^audio/).test(key)) {
      this.expected[key] = 1;
    }
  });

  assert.deepEqual(this.calls, this.expected, 'calls as expected');
});

QUnit.test('filter subtitle works', function(assert) {
  this.pc.delegateLoaders_('subtitle', ['abort', 'pause']);

  Object.keys(this.expected).forEach((key) => {
    if ((/^(subtitle|closed-captions)/).test(key)) {
      this.expected[key] = 1;
    }
  });

  assert.deepEqual(this.calls, this.expected, 'calls as expected');
});

QUnit.module('PlaylistController bufferBasedABR', {
  beforeEach(assert) {
    this.playerOptions = {
      html5: {
        vhs: {
          bufferBasedABR: true
        }
      }
    };
    sharedHooks.beforeEach.call(this, assert);
    this.pc = this.playlistController;

  },
  afterEach(assert) {
    sharedHooks.afterEach.call(this, assert);
  }
});

QUnit.test('Determines if playlist should change on bandwidthupdate/progress from segment loader', function(assert) {
  let calls = 0;

  this.playlistController.selectPlaylist = () => {
    calls++;
    return this.playlistController.mainPlaylistLoader_.main.playlists[0];
  };
  this.playlistController.mediaSource.trigger('sourceopen');

  // main
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  // progress for a segment download
  this.playlistController.mainSegmentLoader_.trigger('progress');
  assert.strictEqual(calls, 1, 'does not select after segment progress');

  // "downloaded" a segment
  this.playlistController.mainSegmentLoader_.trigger('bandwidthupdate');
  assert.strictEqual(calls, 2, 'selects after segment download');

  this.clock.tick(250);
  assert.strictEqual(calls, 3, 'selects after clock tick');
  this.clock.tick(1000);
  assert.strictEqual(calls, 7, 'selects after clock tick, 1000 is 4x250');

  // verify stats
  assert.equal(this.player.tech_.vhs.stats.bandwidth, 4194304, 'default bandwidth');
});

QUnit.test('loads main segment loader on timeout', function(assert) {
  const mainSegmentLoader = this.playlistController.mainSegmentLoader_;

  this.playlistController.mediaSource.trigger('sourceopen');

  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  let loadCalls = 0;

  mainSegmentLoader.load = () => loadCalls++;

  this.playlistController.mainSegmentLoader_.trigger('bandwidthupdate');

  assert.equal(loadCalls, 0, 'does not call load');

  this.playlistController.mainSegmentLoader_.trigger('timeout');

  assert.equal(loadCalls, 1, 'calls load');
});

QUnit.module('PlaylistController shouldSwitchToMedia', sharedHooks);

QUnit.test('true if a no current playlist', function(assert) {
  const pc = this.playlistController;

  pc.mainPlaylistLoader_.media = () => null;
  const nextPlaylist = {id: 'foo', endList: true};

  assert.ok(pc.shouldSwitchToMedia_(nextPlaylist), 'should switch without currentPlaylist');
});

QUnit.test('true if current playlist is live', function(assert) {
  const pc = this.playlistController;

  pc.mainPlaylistLoader_.media = () => ({endList: false, id: 'bar'});
  const nextPlaylist = {id: 'foo', endList: true};

  assert.ok(pc.shouldSwitchToMedia_(nextPlaylist), 'should switch with live currentPlaylist');
});

QUnit.test('true if duration < 30', function(assert) {
  const pc = this.playlistController;
  const nextPlaylist = {id: 'foo', endList: true};

  pc.duration = () => 20;
  pc.mainPlaylistLoader_.media = () => ({endList: true, id: 'bar'});

  assert.ok(pc.shouldSwitchToMedia_(nextPlaylist), 'should switch');
});

QUnit.test('maxPlaylistRetries defaults to Infinity when no value or null/undefined is provided', function(assert) {
  const playerNull = createPlayer({
    html5: {
      vhs: {
        maxPlaylistRetries: null
      }
    }
  });

  const playerUndefined = createPlayer({
    html5: {
      vhs: {
        maxPlaylistRetries: undefined
      }
    }
  });

  const playerNoValue = createPlayer();

  playerNull.src({
    src: 'manifest/main.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  playerUndefined.src({
    src: 'manifest/main.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  playerNoValue.src({
    src: 'manifest/main.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  assert.equal(playerNull.tech_.vhs.playlistController_.maxPlaylistRetries, Infinity, 'maxPlaylistRetries defaults to Infinity when null is provided as the option value');
  assert.equal(playerUndefined.tech_.vhs.playlistController_.maxPlaylistRetries, Infinity, 'maxPlaylistRetries defaults to Infinity when undefined is provided as the option value');
  assert.equal(playerNoValue.tech_.vhs.playlistController_.maxPlaylistRetries, Infinity, 'maxPlaylistRetries defaults to Infinity when no value is provided');

  playerNoValue.dispose();
  playerUndefined.dispose();
  playerNull.dispose();
});

QUnit.test('maxPlaylistRetries is set when zero is passed as the option\'s value', function(assert) {
  const player = createPlayer({
    html5: {
      vhs: {
        maxPlaylistRetries: 0
      }
    }
  });

  player.src({
    src: 'manifest/main.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  assert.equal(player.tech_.vhs.playlistController_.maxPlaylistRetries, 0, 'maxPlaylistRetries was set to zero');

  player.dispose();
});

QUnit.test('true duration < 16 with bufferBasedABR', function(assert) {
  const pc = this.playlistController;
  const nextPlaylist = {id: 'foo', endList: true};

  pc.bufferBasedABR = true;

  pc.duration = () => 15;
  pc.mainPlaylistLoader_.media = () => ({endList: true, id: 'bar'});

  assert.ok(pc.shouldSwitchToMedia_(nextPlaylist), 'should switch');
});

QUnit.test('true if bandwidth decreases', function(assert) {
  const pc = this.playlistController;
  const nextPlaylist = {id: 'foo', endList: true, attributes: {BANDWIDTH: 1}};

  pc.duration = () => 40;
  pc.mainPlaylistLoader_.media = () => ({endList: true, id: 'bar', attributes: {BANDWIDTH: 2}});

  assert.ok(pc.shouldSwitchToMedia_(nextPlaylist), 'should switch');
});

QUnit.test('true if bandwidth decreases, bufferBasedABR, and forwardBuffer < bufferHighWaterLine', function(assert) {
  const pc = this.playlistController;
  const nextPlaylist = {id: 'foo', endList: true, attributes: {BANDWIDTH: 1}};

  // 0 forward buffer
  pc.tech_.buffered = () => createTimeRanges();
  pc.tech_.currentTime = () => 0;
  pc.bufferBasedABR = true;
  pc.duration = () => 40;
  pc.mainPlaylistLoader_.media = () => ({endList: true, id: 'bar', attributes: {BANDWIDTH: 2}});

  assert.ok(pc.shouldSwitchToMedia_(nextPlaylist), 'should switch');
});

QUnit.test('true if forwardBuffer >= bufferLowWaterLine', function(assert) {
  const pc = this.playlistController;
  const nextPlaylist = {id: 'foo', endList: true, attributes: {BANDWIDTH: 2}};

  // zero forward buffer and zero buffer low water line
  pc.tech_.buffered = () => createTimeRanges();
  pc.tech_.currentTime = () => 0;
  pc.duration = () => 40;
  pc.mainPlaylistLoader_.media = () => ({endList: true, id: 'bar', attributes: {BANDWIDTH: 2}});

  assert.ok(pc.shouldSwitchToMedia_(nextPlaylist), 'should switch');
});

QUnit.test('true if forwardBuffer >= bufferLowWaterLine, bufferBasedABR, and bandwidth increase', function(assert) {
  const pc = this.playlistController;
  const nextPlaylist = {id: 'foo', endList: true, attributes: {BANDWIDTH: 3}};

  // zero forward buffer and zero buffer low water line
  pc.tech_.buffered = () => createTimeRanges();
  pc.tech_.currentTime = () => 0;
  pc.bufferBasedABR = true;
  pc.duration = () => 40;
  pc.mainPlaylistLoader_.media = () => ({endList: true, id: 'bar', attributes: {BANDWIDTH: 2}});

  assert.ok(pc.shouldSwitchToMedia_(nextPlaylist), 'should switch');
});

QUnit.test('false if nextPlaylist bandwidth lower, bufferBasedABR, and forwardBuffer > bufferHighWaterLine', function(assert) {
  const pc = this.playlistController;
  const nextPlaylist = {id: 'foo', endList: true, attributes: {BANDWIDTH: 1}};

  // 31s forwardBuffer
  pc.tech_.buffered = () => createTimeRanges(0, 31);
  pc.tech_.currentTime = () => 0;
  pc.bufferBasedABR = true;
  pc.duration = () => 40;
  pc.mainPlaylistLoader_.media = () => ({endList: true, id: 'bar', attributes: {BANDWIDTH: 2}});

  assert.notOk(pc.shouldSwitchToMedia_(nextPlaylist), 'should not switch');
});

QUnit.test('false if nextPlaylist bandwidth same, bufferBasedABR, and forwardBuffer >= bufferLowWaterLine', function(assert) {
  const pc = this.playlistController;
  const nextPlaylist = {id: 'foo', endList: true, attributes: {BANDWIDTH: 2}};

  // 31s forwardBuffer
  pc.tech_.buffered = () => createTimeRanges();
  pc.tech_.currentTime = () => 0;
  pc.bufferBasedABR = true;
  pc.duration = () => 40;
  pc.mainPlaylistLoader_.media = () => ({endList: true, id: 'bar', attributes: {BANDWIDTH: 2}});

  assert.notOk(pc.shouldSwitchToMedia_(nextPlaylist), 'should not switch');
});

QUnit.test('false if nextPlaylist is currentPlaylist', function(assert) {
  const pc = this.playlistController;
  const nextPlaylist = {id: 'foo', endList: true};

  pc.mainPlaylistLoader_.media = () => nextPlaylist;

  assert.notOk(pc.shouldSwitchToMedia_(nextPlaylist), 'should not switch');
});

QUnit.test('false without nextPlaylist', function(assert) {
  const pc = this.playlistController;

  pc.mainPlaylistLoader_.media = () => ({endList: true, id: 'bar'});

  assert.notOk(pc.shouldSwitchToMedia_(null), 'should not switch');

  assert.equal(this.env.log.warn.callCount, 1, 'logged a warning');

  this.env.log.warn.callCount = 0;
});

QUnit.test('false if llhls playlist and no buffered', function(assert) {
  const pc = this.playlistController;

  pc.mainPlaylistLoader_.media = () => ({id: 'foo', endList: false, partTargetDuration: 5});
  const nextPlaylist = {id: 'bar', endList: false, partTargetDuration: 5};

  assert.notOk(pc.shouldSwitchToMedia_(nextPlaylist), 'should not switch when nothing is buffered');
});

QUnit.test('true if llhls playlist and we have buffered', function(assert) {
  const pc = this.playlistController;

  pc.tech_.buffered = () => createTimeRanges([[0, 10]]);
  pc.mainPlaylistLoader_.media = () => ({id: 'foo', endList: false, partTargetDuration: 5});
  const nextPlaylist = {id: 'bar', endList: false, partTargetDuration: 5};

  assert.ok(pc.shouldSwitchToMedia_(nextPlaylist), 'should switch if buffered');
});

QUnit.module('PlaylistController excludePlaylist', sharedHooks);

QUnit.test("don't exclude only playlist unless it was excluded forever", function(assert) {
  // expect 9 because we have a failing assertion that shouldn't run unless something is broken
  assert.expect(9);

  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/one-rendition.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.playlistController = this.player.tech_.vhs.playlistController_;

  // main
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  let pc = this.playlistController;
  let mpl = pc.mainPlaylistLoader_;
  let playlist = mpl.main.playlists[0];
  let shouldDelay = false;

  mpl.load = (delay) => (shouldDelay = delay);

  pc.excludePlaylist({});

  assert.notOk('excludeUntil' in playlist, 'playlist was not excluded since excludeDuration was finite');
  assert.ok(shouldDelay, 'we delay retry since it is the final rendition');
  assert.equal(this.env.log.warn.callCount, 1, 'logged a warning');

  this.requests.length = 0;
  // reload source to exclude forever
  this.player.src({
    src: 'manifest/one-rendition.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.playlistController = this.player.tech_.vhs.playlistController_;

  // main
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  pc = this.playlistController;
  mpl = pc.mainPlaylistLoader_;
  playlist = mpl.main.playlists[0];
  shouldDelay = false;

  mpl.load = (delay) => {
    shouldDelay = delay;
    assert.ok(false, 'load should not be called in this case');
  };
  pc.on('error', () => {
    assert.ok(true, 'we triggered a playback error');
  });

  // exclude forever
  pc.excludePlaylist({
    playlistExclusionDuration: Infinity
  });

  assert.ok('excludeUntil' in playlist, 'playlist was excluded');
  assert.notOk(shouldDelay, 'value was not changed');
  assert.equal(this.env.log.error.callCount, 1, 'logged an error');

  this.env.log.warn.callCount = 0;
  this.env.log.error.callCount = 0;
});

QUnit.test('switch playlists if current playlist gets excluded and re-include if final rendition', function(assert) {
  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/two-renditions.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.playlistController = this.player.tech_.vhs.playlistController_;

  // main
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  const pc = this.playlistController;
  const mpl = pc.mainPlaylistLoader_;
  const playlist = mpl.main.playlists[0];
  let playlist2 = mpl.main.playlists[1];
  let shouldDelay = false;

  mpl.load = (delay) => (shouldDelay = delay);

  pc.excludePlaylist({});

  assert.ok('excludeUntil' in playlist, 'playlist was excluded since there is another playlist');
  assert.notOk(shouldDelay, 'we do not delay retry since it is not the final rendition');
  assert.equal(this.env.log.warn.callCount, 1, 'logged a warning');

  // ignore segment request
  this.requests.shift();
  // media1
  this.standardXHRResponse(this.requests.shift());
  playlist2 = mpl.main.playlists[1];

  pc.excludePlaylist({});

  assert.ok('excludeUntil' in playlist2, 'playlist2 was excluded');
  assert.notOk('excludeUntil' in playlist, 'playlist was re-included');
  assert.equal(this.env.log.warn.callCount, 3, 'logged another warning');
  assert.ok(
    this.env.log.warn.calledWith('Removing other playlists from the exclusion list because the last rendition is about to be excluded.'),
    'we logged a warning that we reincluded playlists'
  );

  this.env.log.warn.callCount = 0;
});

QUnit.test('Playlist is excluded indefinitely if number of playlistErrors_ exceeds maxPlaylistRetries', function(assert) {
  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer({ html5: { vhs: { maxPlaylistRetries: 1 } } });
  this.player.src({
    src: 'manifest/two-renditions.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.playlistController = this.player.tech_.vhs.playlistController_;

  // main
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  const pc = this.playlistController;
  const mpl = pc.mainPlaylistLoader_;
  const playlist = mpl.main.playlists[0];

  assert.equal(playlist.playlistErrors_, 0, 'playlistErrors_ starts at zero');

  pc.excludePlaylist({});

  assert.ok('excludeUntil' in playlist, 'playlist was excluded');
  assert.equal(playlist.playlistErrors_, 1, 'we incremented playlistErrors_');
  assert.notEqual(playlist.excludeUntil, Infinity, 'The playlist was not excluded indefinitely');

  pc.excludePlaylist({});

  assert.equal(playlist.playlistErrors_, 2, 'we incremented playlistErrors_');
  assert.equal(playlist.excludeUntil, Infinity, 'The playlist was excluded indefinitely');
  assert.equal(this.env.log.warn.callCount, 2, 'logged a warning each time a playlist was excluded');

  this.env.log.warn.callCount = 0;
});

QUnit.test('should delay loading of new playlist if lastRequest was less than half target duration', function(assert) {
  this.requests.length = 0;
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'manifest/two-renditions.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.playlistController = this.player.tech_.vhs.playlistController_;

  // main
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  const pc = this.playlistController;
  const mpl = pc.mainPlaylistLoader_;
  const oldMplMedia = mpl.media;
  const playlist = mpl.main.playlists[0];
  const playlist2 = mpl.main.playlists[1];
  let shouldDelay = false;

  mpl.media = (nextPlaylist, delay) => {
    shouldDelay = delay;
    return oldMplMedia.call(mpl, nextPlaylist, delay);
  };
  playlist2.lastRequest = Date.now() - 1000;

  pc.excludePlaylist({});

  assert.ok('excludeUntil' in playlist, 'playlist was excluded since there is another playlist');
  assert.ok(shouldDelay, 'we delay retry since second rendition was loaded less than half target duration ago');
  assert.equal(this.env.log.warn.callCount, 1, 'logged a warning');

  this.env.log.warn.callCount = 0;
});

// Content Steering
QUnit.module('PlaylistController contentSteering', {
  beforeEach(assert) {
    sharedHooks.beforeEach.call(this, assert);

    this.controllerOptions = {
      src: 'test',
      tech: this.player.tech_,
      sourceType: 'dash'
    };

    this.csMainPlaylist = {
      contentSteering: {
        defaultServiceLocation: 'cdn-a',
        serverURL: 'https://www.server.test'
      },
      playlists: [
        {
          attributes: {
            NAME: 'video_1920x1080_4531kbps',
            serviceLocation: 'cdn-a'
          },
          endList: true,
          id: '0-placeholder-uri-0',
          resolvedUri: 'https://fastly.content-steering.com/bbb/placeholder-uri-0',
          uri: 'placeholder-uri-0'
        },
        {
          attributes: {
            NAME: 'video_1280x720_2445kbps',
            serviceLocation: 'cdn-b'
          },
          endList: true,
          id: '1-placeholder-uri-1',
          resolvedUri: 'https://fastly.content-steering.com/bbb/placeholder-uri-1',
          uri: 'placeholder-uri-1'
        }
      ]
    };

  },
  afterEach(assert) {
    sharedHooks.afterEach.call(this, assert);
  }
});

QUnit.test('initContentSteeringController_ for HLS', function(assert) {
  const options = {
    src: 'test',
    tech: this.player.tech_,
    sourceType: 'hls'
  };

  const pc = new PlaylistController(options);

  const mainPlaylist = {
    contentSteering: {
      ['PATHWAY-ID']: 'cdn-a',
      serverUri: 'https://www.server.test/hls'
    },
    playlists: [
      {
        attributes: {
          ['PATHWAY-ID']: 'cdn-a'
        },
        endList: true,
        id: '0-placeholder-uri-0',
        resolvedUri: 'https://fastly.content-steering.com/bbb/placeholder-uri-0',
        uri: 'placeholder-uri-0'
      },
      {
        attributes: {
          ['PATHWAY-ID']: 'cdn-b'
        },
        endList: true,
        id: '1-placeholder-uri-1',
        resolvedUri: 'https://fastly.content-steering.com/bbb/placeholder-uri-1',
        uri: 'placeholder-uri-1'
      }
    ]
  };

  pc.main = () => mainPlaylist;

  pc.initContentSteeringController_();

  const steering = pc.contentSteeringController_;
  const pathways = [...steering.availablePathways_];

  assert.deepEqual(pathways[0], 'cdn-a');
  assert.deepEqual(pathways[1], 'cdn-b');
  assert.deepEqual(steering.manifestType_, 'HLS');
  assert.deepEqual(steering.steeringManifest.reloadUri, mainPlaylist.contentSteering.serverUri);
});

QUnit.test('initContentSteeringController_ for DASH with queryBeforeStart', function(assert) {
  const pc = new PlaylistController(this.controllerOptions);
  const requestSteeringManifestSpy = sinon.spy(pc.contentSteeringController_, 'requestSteeringManifest');

  const mainPlaylist = Object.assign({}, this.csMainPlaylist);

  mainPlaylist.contentSteering.queryBeforeStart = true;

  pc.main = () => mainPlaylist;

  pc.initContentSteeringController_();

  // requestManifest is called, which means a request to the steering server is made.
  assert.ok(requestSteeringManifestSpy.called);

  const steering = pc.contentSteeringController_;
  const pathways = [...steering.availablePathways_];

  assert.deepEqual(pathways[0], 'cdn-a');
  assert.deepEqual(pathways[1], 'cdn-b');
  assert.deepEqual(steering.manifestType_, 'DASH');
  assert.deepEqual(steering.steeringManifest.reloadUri, mainPlaylist.contentSteering.serverURL);
});

QUnit.test('initContentSteeringController_ for DASH without queryBeforeStart', function(assert) {
  const pc = new PlaylistController(this.controllerOptions);
  const requestSteeringManifestSpy = sinon.spy(pc.contentSteeringController_, 'requestSteeringManifest');

  pc.main = () => this.csMainPlaylist;

  pc.initContentSteeringController_();

  // requestManifest is NOT called yet without queryBeforeStart
  assert.notOk(requestSteeringManifestSpy.called);

  // Now the playlist should make the request to the content steering server
  // This event means the media should already be loaded.
  this.player.tech_.trigger('canplay');

  // requestManifest is called, which means a request to the steering server is made.
  assert.ok(requestSteeringManifestSpy.called);

  const steering = pc.contentSteeringController_;
  const pathways = [...steering.availablePathways_];

  assert.deepEqual(pathways[0], 'cdn-a');
  assert.deepEqual(pathways[1], 'cdn-b');
  assert.deepEqual(steering.manifestType_, 'DASH');
  assert.deepEqual(steering.steeringManifest.reloadUri, this.csMainPlaylist.contentSteering.serverURL);
});

QUnit.test('Test Live DASH update with content steering', function(assert) {
  const done = assert.async();
  const pc = new PlaylistController(this.controllerOptions);
  const resetContentSteeringControllerSpy = sinon.spy(pc, 'resetContentSteeringController_');

  // Stub the steering request functionality and the resetting of media.
  sinon.stub(pc.contentSteeringController_, 'requestSteeringManifest');
  sinon.stub(pc.mainPlaylistLoader_, 'refreshMedia_');

  // Second manifest after live update just changes the queryBeforeStartParam
  const mainPlaylistAfter = Object.assign({}, this.csMainPlaylist);

  pc.main = () => this.csMainPlaylist;
  pc.mainPlaylistLoader_.media = () => this.csMainPlaylist.playlists[0];

  pc.attachContentSteeringListeners_();
  pc.initContentSteeringController_();

  // The initial manifest did not have queryBeforeStart set
  assert.equal(pc.contentSteeringController_.queryBeforeStart, undefined);

  // mimics refreshMedia_, resetting main with the new manifest
  mainPlaylistAfter.contentSteering.queryBeforeStart = true;
  pc.main = () => mainPlaylistAfter;

  pc.mainPlaylistLoader_.on('loadedplaylist', () => {
    // The content steering controller was updated with the new information.
    assert.true(resetContentSteeringControllerSpy.called);
    assert.true(pc.contentSteeringController_.queryBeforeStart);
    done();
  });
  // mimic a live DASH manifest update
  pc.mainPlaylistLoader_.trigger('loadedplaylist');
});

QUnit.test('Test Live DASH content steering adding a steering tag', function(assert) {
  const done = assert.async();
  const pc = new PlaylistController(this.controllerOptions);
  const resetContentSteeringControllerSpy = sinon.spy(pc, 'resetContentSteeringController_');

  // Stub the steering request functionality and the resetting of media.
  sinon.stub(pc.contentSteeringController_, 'requestSteeringManifest');
  sinon.stub(pc.mainPlaylistLoader_, 'refreshMedia_');

  // Second manifest after live update just changes the queryBeforeStartParam
  const mainPlaylistBefore = Object.assign({}, this.csMainPlaylist);

  delete mainPlaylistBefore.contentSteering;

  pc.main = () => mainPlaylistBefore;
  pc.mainPlaylistLoader_.media = () => mainPlaylistBefore.playlists[0];

  pc.attachContentSteeringListeners_();
  pc.initContentSteeringController_();

  pc.main = () => this.csMainPlaylist;

  this.csMainPlaylist.contentSteering.queryBeforeStart = true;
  pc.mainPlaylistLoader_.on('loadedplaylist', () => {
    // The content steering controller was updated with the new information.
    assert.true(resetContentSteeringControllerSpy.called);
    assert.equal(pc.contentSteeringController_.steeringManifest.reloadUri, 'https://www.server.test', 'reloadUri added');
    assert.true(pc.contentSteeringController_.queryBeforeStart, 'queryBeforeStart is true');
    assert.equal(pc.contentSteeringController_.getPathway(), 'cdn-a', 'pathway is expected value');
    done();
  });
  // mimic a live DASH manifest update
  pc.mainPlaylistLoader_.trigger('loadedplaylist');
});

QUnit.test('Test Live DASH content steering removing a steering tag', function(assert) {
  const done = assert.async();
  const pc = new PlaylistController(this.controllerOptions);
  const resetContentSteeringControllerSpy = sinon.spy(pc, 'resetContentSteeringController_');

  // Stub the steering request functionality and the resetting of media.
  sinon.stub(pc.contentSteeringController_, 'requestSteeringManifest');
  sinon.stub(pc.mainPlaylistLoader_, 'refreshMedia_');
  const mainPlaylistAfter = Object.assign({}, this.csMainPlaylist);

  // remove the content steering tag.
  delete mainPlaylistAfter.contentSteering;

  pc.main = () => this.csMainPlaylist;

  pc.attachContentSteeringListeners_();
  pc.initContentSteeringController_();

  pc.main = () => mainPlaylistAfter;
  pc.mainPlaylistLoader_.media = () => mainPlaylistAfter.playlists[0];

  this.csMainPlaylist.contentSteering.queryBeforeStart = true;
  pc.mainPlaylistLoader_.on('loadedplaylist', () => {
    // The content steering controller was updated with the new information.
    assert.true(resetContentSteeringControllerSpy.called);
    assert.equal(pc.contentSteeringController_.steeringManifest.reloadUri, undefined, 'reloadUri removed');
    assert.equal(pc.contentSteeringController_.queryBeforeStart, undefined, 'queryBeforeStart is undefined');
    assert.equal(pc.contentSteeringController_.getPathway(), null, 'pathway is expected value');
    done();
  });
  // mimic a live DASH manifest update
  pc.mainPlaylistLoader_.trigger('loadedplaylist');
});

QUnit.test('Test Live DASH content steering updating serviceLocation', function(assert) {
  const done = assert.async();
  const pc = new PlaylistController(this.controllerOptions);
  const resetContentSteeringControllerSpy = sinon.spy(pc, 'resetContentSteeringController_');
  const newPathways = new Set(['cdn-c', 'cdn-d']);

  // Stub the steering request functionality and the resetting of media.
  sinon.stub(pc.contentSteeringController_, 'requestSteeringManifest');
  sinon.stub(pc.mainPlaylistLoader_, 'refreshMedia_');
  const mainPlaylistAfter = Object.assign({}, this.csMainPlaylist);

  pc.main = () => this.csMainPlaylist;
  pc.attachContentSteeringListeners_();
  pc.initContentSteeringController_();

  pc.main = () => mainPlaylistAfter;
  mainPlaylistAfter.playlists = [
    {
      attributes: {
        NAME: 'video_1920x1080_4531kbps',
        serviceLocation: 'cdn-c'
      },
      endList: true,
      id: '0-placeholder-uri-0',
      resolvedUri: 'https://fastly.content-steering.com/bbb/placeholder-uri-0',
      uri: 'placeholder-uri-0'
    },
    {
      attributes: {
        NAME: 'video_1280x720_2445kbps',
        serviceLocation: 'cdn-d'
      },
      endList: true,
      id: '1-placeholder-uri-1',
      resolvedUri: 'https://fastly.content-steering.com/bbb/placeholder-uri-1',
      uri: 'placeholder-uri-1'
    }
  ];
  pc.mainPlaylistLoader_.media = () => mainPlaylistAfter.playlists[0];

  pc.mainPlaylistLoader_.on('loadedplaylist', () => {
    // The content steering controller was updated with the new pathways
    assert.true(resetContentSteeringControllerSpy.called);
    assert.deepEqual(pc.contentSteeringController_.availablePathways_, newPathways);
    done();
  });
  // mimic a live DASH manifest update
  pc.mainPlaylistLoader_.trigger('loadedplaylist');
});

QUnit.test('Test Live DASH content steering removing serviceLocation', function(assert) {
  const done = assert.async();
  const pc = new PlaylistController(this.controllerOptions);
  const resetContentSteeringControllerSpy = sinon.spy(pc, 'resetContentSteeringController_');
  const newPathways = new Set();

  // Stub the steering request functionality and the resetting of media.
  sinon.stub(pc.contentSteeringController_, 'requestSteeringManifest');
  sinon.stub(pc.mainPlaylistLoader_, 'refreshMedia_');
  const mainPlaylistAfter = Object.assign({}, this.csMainPlaylist);

  pc.main = () => this.csMainPlaylist;
  pc.attachContentSteeringListeners_();
  pc.initContentSteeringController_();

  pc.main = () => mainPlaylistAfter;
  mainPlaylistAfter.playlists = [
    {
      attributes: {
        NAME: 'video_1920x1080_4531kbps'
      },
      endList: true,
      id: '0-placeholder-uri-0',
      resolvedUri: 'https://fastly.content-steering.com/bbb/placeholder-uri-0',
      uri: 'placeholder-uri-0'
    },
    {
      attributes: {
        NAME: 'video_1280x720_2445kbps'
      },
      endList: true,
      id: '1-placeholder-uri-1',
      resolvedUri: 'https://fastly.content-steering.com/bbb/placeholder-uri-1',
      uri: 'placeholder-uri-1'
    }
  ];
  pc.mainPlaylistLoader_.media = () => mainPlaylistAfter.playlists[0];

  pc.mainPlaylistLoader_.on('loadedplaylist', () => {
    // The content steering controller was updated with the new pathways
    assert.true(resetContentSteeringControllerSpy.called);
    assert.deepEqual(pc.contentSteeringController_.availablePathways_, newPathways);
    done();
  });
  // mimic a live DASH manifest update
  pc.mainPlaylistLoader_.trigger('loadedplaylist');
});

QUnit.test('Exclude and reinclude pathway after timeout for content steering', function(assert) {
  const pc = new PlaylistController(this.controllerOptions);

  const mainPlaylist = Object.assign({}, this.csMainPlaylist);

  // playlist for cdn-b is currently excluded
  mainPlaylist.playlists[1].excludeUntil = Infinity;
  mainPlaylist.playlists[1].lastExcludeReason_ = 'content-steering';

  // Set up playlists
  pc.main = () => mainPlaylist;
  pc.media = () => mainPlaylist.playlists[0];
  pc.mainPlaylistLoader_.main = mainPlaylist;
  pc.mainPlaylistLoader_.media = () => mainPlaylist.playlists[0];
  pc.selectPlaylist = () => pc.main().playlists[0];

  pc.initContentSteeringController_();

  // The content steering controller has the pathway available.
  assert.ok(pc.contentSteeringController_.availablePathways_.has('cdn-a'));

  pc.excludePlaylist({
    playlistToExclude: pc.main().playlists[0],
    error: { internal: true }
  });

  // The pathway was removed from the available pathways.
  assert.notOk(pc.contentSteeringController_.availablePathways_.has('cdn-a'));

  // A timeout was set, to fast forward to when the pathway should be included again.
  this.clock.tick(4);

  // The pathway was added back to the available pathways.
  assert.ok(pc.contentSteeringController_.availablePathways_.has('cdn-a'));
});

QUnit.test('switch media on priority change for content steering', function(assert) {
  const pc = new PlaylistController(this.controllerOptions);

  const mainPlaylist = Object.assign({}, this.csMainPlaylist);

  // playlist for cdn-b is currently excluded
  mainPlaylist.playlists[1].excludeUntil = Infinity;
  mainPlaylist.playlists[1].lastExcludeReason_ = 'content-steering';

  // Set up playlists
  pc.main = () => mainPlaylist;
  pc.media = () => mainPlaylist.playlists[0];
  pc.selectPlaylist = () => pc.main().playlists[0];

  const switchMediaStub = sinon.stub(pc, 'switchMedia_');

  pc.attachContentSteeringListeners_();
  pc.initContentSteeringController_();

  // Initially, cdn-a should be selected and there should be no media switch
  assert.deepEqual(pc.contentSteeringController_.getPathway(), 'cdn-a');
  assert.notOk(switchMediaStub.called);
  // The playlist for cdn-b is excluded
  assert.deepEqual(pc.main().playlists[1].excludeUntil, Infinity);

  // selectPlaylist has to be mocked
  pc.selectPlaylist = () => pc.main().playlists[1];

  const steeringManifestJson = {
    VERSION: 1,
    TTL: 10,
    ['RELOAD-URI']: 'https://fastly-server.content-steering.com/dash.dcsm',
    ['PATHWAY-PRIORITY']: [
      'cdn-b',
      'cdn-a'
    ]
  };

  // mimic a response from the content server
  pc.contentSteeringController_.assignSteeringProperties_(steeringManifestJson);

  // When the priority changes in the manifest, the media should switch to cdn-b
  assert.deepEqual(switchMediaStub.getCall(0).args[0].attributes.serviceLocation, 'cdn-b');
  assert.deepEqual(pc.contentSteeringController_.getPathway(), 'cdn-b');
  // The playlist for cdn-b is no longer excluded
  assert.deepEqual(pc.main().playlists[1].excludeUntil, undefined);
});

QUnit.test('media group playlists should switch on steering change', function(assert) {
  const pc = new PlaylistController(this.controllerOptions);

  const mainPlaylist = Object.assign({}, this.csMainPlaylist);

  // playlist for cdn-b is currently excluded
  mainPlaylist.playlists[1].excludeUntil = Infinity;
  mainPlaylist.playlists[1].lastExcludeReason_ = 'content-steering';

  mainPlaylist.mediaGroups = {
    AUDIO: {
      audio: {
        und: {
          language: 'und',
          default: true,
          autoselect: true,
          playlists: [
            {
              attributes: {
                NAME: 'audio_128kbps',
                CODECS: 'mp4a.40.2',
                serviceLocation: 'cdn-a'
              },
              endList: true,
              id: '0-placeholder-uri-AUDIO-audio-audio_128kbps',
              uri: 'placeholder-uri-AUDIO-audio-audio_128kbps',
              resolvedUri: 'placeholder-uri-AUDIO-audio-audio_128kbps'
            },
            {
              attributes: {
                NAME: 'audio_128kbps',
                CODECS: 'mp4a.40.2',
                serviceLocation: 'cdn-b'
              },
              endList: true,
              id: '1-placeholder-uri-AUDIO-audio-audio_128kbps',
              uri: '1-placeholder-uri-AUDIO-audio-audio_128kbps',
              resolvedUri: '1-placeholder-uri-AUDIO-audio-audio_128kbps'
            }
          ]
        }
      }
    },
    ['CLOSED_CAPTIONS']: {},
    SUBTITLES: {},
    VIDEO: {}
  };

  // Set up playlists
  pc.main = () => mainPlaylist;
  pc.media = () => mainPlaylist.playlists[0];
  pc.mainPlaylistLoader_.main = mainPlaylist;
  pc.mainPlaylistLoader_.media = () => mainPlaylist.playlists[0];
  pc.selectPlaylist = () => pc.main().playlists[0];

  // Set up mediaTypes_ groups
  pc.mediaTypes_.AUDIO.groups = [{
    audio: [mainPlaylist.mediaGroups.AUDIO.audio.und]
  }];
  pc.mediaTypes_.AUDIO.activeGroup = () => [
    mainPlaylist.mediaGroups.AUDIO.audio.und
  ];
  pc.mediaTypes_.AUDIO.activeTrack = () => ({label: 'und'});

  const audioPlaylist = mainPlaylist.mediaGroups.AUDIO.audio.und.playlists[0];

  pc.mediaTypes_.AUDIO.activePlaylistLoader = {
    media: () => audioPlaylist,
    media_: audioPlaylist
  };

  // Set up stubs
  sinon.stub(pc, 'switchMedia_');
  const mediaSpy = sinon.spy(pc.mediaTypes_.AUDIO.activePlaylistLoader, 'media');

  pc.attachContentSteeringListeners_();
  pc.initContentSteeringController_();

  const steeringManifestJson = {
    VERSION: 1,
    TTL: 10,
    ['RELOAD-URI']: 'https://fastly-server.content-steering.com/dash.dcsm',
    ['PATHWAY-PRIORITY']: [
      'cdn-b',
      'cdn-a'
    ]
  };

  // mimic a response from the content server
  pc.contentSteeringController_.assignSteeringProperties_(steeringManifestJson);

  // the audio media() is called with the playlist for cdn-b
  assert.deepEqual(mediaSpy.getCall(0).args[0].attributes.serviceLocation, 'cdn-b');
});

QUnit.test('playlists should not change when there is no currentPathway', function(assert) {
  const pc = new PlaylistController(this.controllerOptions);

  const switchMediaSpy = sinon.spy(pc, 'switchMedia_');

  // Set up playlists
  pc.main = () => this.csMainPlaylist;

  pc.attachContentSteeringListeners_();
  pc.initContentSteeringController_();

  // mimic there being no current pathway
  pc.contentSteeringController_.getPathway = () => null;

  const steeringManifestJson = {
    VERSION: 1,
    TTL: 10,
    ['RELOAD-URI']: 'https://fastly-server.content-steering.com/dash.dcsm',
    ['PATHWAY-PRIORITY']: [
      'cdn-b',
      'cdn-a'
    ]
  };

  // mimic a response from the content server
  pc.contentSteeringController_.assignSteeringProperties_(steeringManifestJson);

  // media is never switched
  assert.notOk(switchMediaSpy.called);
});

QUnit.test('Pathway cloning - add a new pathway when the clone has not existed', function(assert) {
  const options = {
    src: 'test',
    tech: this.player.tech_,
    sourceType: 'hls'
  };

  const pc = new PlaylistController(options);

  this.csMainPlaylist.playlists.forEach(p => {
    p.attributes['PATHWAY-ID'] = p.attributes.serviceLocation;
    p.attributes.serviceLocation = undefined;
  });

  pc.main = () => this.csMainPlaylist;
  pc.initContentSteeringController_();

  const addCloneStub = sinon.stub(pc.mainPlaylistLoader_, 'addClonePathway');

  const clone = {
    ID: 'cdn-z',
    ['BASE-ID']: 'cdn-a',
    ['URI-REPLACEMENT']: {
      HOST: 'www.cdn-z.com',
      PARAMS: {
        test: 123
      }
    }
  };

  const steeringManifestJson = {
    VERSION: 1,
    TTL: 10,
    ['RELOAD-URI']: 'https://fastly-server.content-steering.com/dash.dcsm',
    ['PATHWAY-PRIORITY']: [
      'cdn-b',
      'cdn-a',
      'cdn-z'
    ],
    ['PATHWAY-CLONES']: [clone]
  };

  // This triggers `handlePathwayClones_()`
  pc.contentSteeringController_.assignSteeringProperties_(steeringManifestJson);

  // Assert that we add a clone and it is added to the available pathways If not already.
  assert.equal(addCloneStub.getCall(0).args[0], clone);
  assert.equal(pc.contentSteeringController_.availablePathways_.has('cdn-z'), true);

  const cloneMap = new Map();

  cloneMap.set(clone.ID, clone);

  // Ensure we set the current pathway clones from next.
  assert.deepEqual(pc.contentSteeringController_.currentPathwayClones.get('cdn-z'), cloneMap.get('cdn-z'));
});

QUnit.test('Pathway cloning - update the pathway when the BASE-ID does not match', function(assert) {
  const options = {
    src: 'test',
    tech: this.player.tech_,
    sourceType: 'hls'
  };

  const pc = new PlaylistController(options);

  this.csMainPlaylist.playlists.forEach(p => {
    p.attributes['PATHWAY-ID'] = p.attributes.serviceLocation;
    p.attributes.serviceLocation = undefined;
  });

  pc.main = () => this.csMainPlaylist;
  pc.initContentSteeringController_();

  const updateCloneStub = sinon.stub(pc.mainPlaylistLoader_, 'updateOrDeleteClone');

  const pastClone = {
    ID: 'cdn-z',
    ['BASE-ID']: 'cdn-a',
    ['URI-REPLACEMENT']: {
      HOST: 'www.cdn-z.com',
      PARAMS: {
        test: 123
      }
    }
  };

  const nextClone = {
    ID: 'cdn-z',
    ['BASE-ID']: 'cdn-b',
    ['URI-REPLACEMENT']: {
      HOST: 'www.cdn-b.com',
      PARAMS: {
        test: 123
      }
    }
  };

  pc.contentSteeringController_.currentPathwayClones = new Map();
  pc.contentSteeringController_.currentPathwayClones.set(pastClone.ID, pastClone);

  const steeringManifestJson = {
    VERSION: 1,
    TTL: 10,
    ['RELOAD-URI']: 'https://fastly-server.content-steering.com/dash.dcsm',
    ['PATHWAY-PRIORITY']: [
      'cdn-b',
      'cdn-a'
    ],
    ['PATHWAY-CLONES']: [nextClone]
  };

  // This triggers `handlePathwayClones()`.
  pc.contentSteeringController_.assignSteeringProperties_(steeringManifestJson);

  // Assert that we update the clone and it is still in the available pathways.
  assert.equal(updateCloneStub.getCall(0).args[0], nextClone);
  assert.equal(updateCloneStub.getCall(0).args[1], true);
  assert.equal(pc.contentSteeringController_.availablePathways_.has('cdn-z'), true);

  const nextClonesMap = new Map();

  nextClonesMap.set(nextClone.ID, nextClone);

  // Ensure we set the current pathway clones from next.
  assert.deepEqual(pc.contentSteeringController_.currentPathwayClones, nextClonesMap);
});

QUnit.test('Pathway cloning - update the pathway when there is a new param', function(assert) {
  const options = {
    src: 'test',
    tech: this.player.tech_,
    sourceType: 'hls'
  };

  const pc = new PlaylistController(options);

  this.csMainPlaylist.playlists.forEach(p => {
    p.attributes['PATHWAY-ID'] = p.attributes.serviceLocation;
    p.attributes.serviceLocation = undefined;
  });

  pc.main = () => this.csMainPlaylist;
  pc.initContentSteeringController_();

  const updateCloneStub = sinon.stub(pc.mainPlaylistLoader_, 'updateOrDeleteClone');

  const pastClone = {
    ID: 'cdn-z',
    ['BASE-ID']: 'cdn-a',
    ['URI-REPLACEMENT']: {
      HOST: 'www.cdn-z.com',
      PARAMS: {
        test: 123
      }
    }
  };

  const nextClone = {
    ID: 'cdn-z',
    ['BASE-ID']: 'cdn-b',
    ['URI-REPLACEMENT']: {
      HOST: 'www.cdn-b.com',
      PARAMS: {
        test: 123,
        newParam: 456
      }
    }
  };

  pc.contentSteeringController_.currentPathwayClones = new Map();
  pc.contentSteeringController_.currentPathwayClones.set(pastClone.ID, pastClone);

  const steeringManifestJson = {
    VERSION: 1,
    TTL: 10,
    ['RELOAD-URI']: 'https://fastly-server.content-steering.com/dash.dcsm',
    ['PATHWAY-PRIORITY']: [
      'cdn-b',
      'cdn-a',
      'cdn-z'
    ],
    ['PATHWAY-CLONES']: [nextClone]
  };

  // This triggers `handlePathwayClones()`.
  pc.contentSteeringController_.assignSteeringProperties_(steeringManifestJson);

  // Assert that we update the clone and it is still in the available pathways.
  assert.equal(updateCloneStub.getCall(0).args[0], nextClone);
  assert.equal(updateCloneStub.getCall(0).args[1], true);
  assert.equal(pc.contentSteeringController_.availablePathways_.has('cdn-z'), true);

  const nextClonesMap = new Map();

  nextClonesMap.set(nextClone.ID, nextClone);

  // Ensure we set the current pathway clones from next.
  assert.deepEqual(pc.contentSteeringController_.currentPathwayClones, nextClonesMap);
});

QUnit.test('Pathway cloning - update the pathway when a param is missing', function(assert) {
  const options = {
    src: 'test',
    tech: this.player.tech_,
    sourceType: 'hls'
  };

  const pc = new PlaylistController(options);

  this.csMainPlaylist.playlists.forEach(p => {
    p.attributes['PATHWAY-ID'] = p.attributes.serviceLocation;
    p.attributes.serviceLocation = undefined;
  });

  pc.main = () => this.csMainPlaylist;
  pc.initContentSteeringController_();

  const updateCloneStub = sinon.stub(pc.mainPlaylistLoader_, 'updateOrDeleteClone');

  const pastClone = {
    ID: 'cdn-z',
    ['BASE-ID']: 'cdn-a',
    ['URI-REPLACEMENT']: {
      HOST: 'www.cdn-z.com',
      PARAMS: {
        test: 123
      }
    }
  };

  const nextClone = {
    ID: 'cdn-z',
    ['BASE-ID']: 'cdn-b',
    ['URI-REPLACEMENT']: {
      HOST: 'www.cdn-b.com',
      PARAMS: {}
    }
  };

  pc.contentSteeringController_.currentPathwayClones = new Map();
  pc.contentSteeringController_.currentPathwayClones.set(pastClone.ID, pastClone);

  const steeringManifestJson = {
    VERSION: 1,
    TTL: 10,
    ['RELOAD-URI']: 'https://fastly-server.content-steering.com/dash.dcsm',
    ['PATHWAY-PRIORITY']: [
      'cdn-b',
      'cdn-a',
      'cdn-z'
    ],
    ['PATHWAY-CLONES']: [nextClone]
  };

  // This triggers `handlePathwayClones()`.
  pc.contentSteeringController_.assignSteeringProperties_(steeringManifestJson);

  // Assert that we update the clone and it is still in the available pathways.
  assert.equal(updateCloneStub.getCall(0).args[0], nextClone);
  assert.equal(updateCloneStub.getCall(0).args[1], true);
  assert.equal(pc.contentSteeringController_.availablePathways_.has('cdn-z'), true);

  const nextClonesMap = new Map();

  nextClonesMap.set(nextClone.ID, nextClone);

  // Ensure we set the current pathway clones from next.
  assert.deepEqual(pc.contentSteeringController_.currentPathwayClones, nextClonesMap);
});

QUnit.test('Pathway cloning - delete the pathway when it is no longer in the steering response', function(assert) {
  const options = {
    src: 'test',
    tech: this.player.tech_,
    sourceType: 'hls'
  };

  const pc = new PlaylistController(options);

  this.csMainPlaylist.playlists.forEach(p => {
    p.attributes['PATHWAY-ID'] = p.attributes.serviceLocation;
    p.attributes.serviceLocation = undefined;
  });

  pc.main = () => this.csMainPlaylist;
  pc.initContentSteeringController_();

  const updateCloneStub = sinon.stub(pc.mainPlaylistLoader_, 'updateOrDeleteClone');

  const pastClone = {
    ID: 'cdn-z',
    ['BASE-ID']: 'cdn-a',
    ['URI-REPLACEMENT']: {
      HOST: 'www.cdn-z.com',
      PARAMS: {
        test: 123
      }
    }
  };

  pc.contentSteeringController_.currentPathwayClones = new Map();
  pc.contentSteeringController_.currentPathwayClones.set(pastClone.ID, pastClone);

  const steeringManifestJson = {
    VERSION: 1,
    TTL: 10,
    ['RELOAD-URI']: 'https://fastly-server.content-steering.com/dash.dcsm',
    ['PATHWAY-PRIORITY']: [
      'cdn-b',
      'cdn-a'
    ],
    // empty response
    ['PATHWAY-CLONES']: []
  };

  // This triggers `handlePathwayClones()`.
  pc.contentSteeringController_.assignSteeringProperties_(steeringManifestJson);

  // Assert that we update the clone and it is still in the available pathways.
  assert.equal(updateCloneStub.getCall(0).args[0], pastClone);
  // undefined means we are deleting.
  assert.equal(updateCloneStub.getCall(0).args[1], undefined);
  // The value is no longer in the available pathways.
  assert.equal(!pc.contentSteeringController_.availablePathways_.has('cdn-z'), true);

  assert.deepEqual(pc.contentSteeringController_.currentPathwayClones, new Map());
});

QUnit.test('Pathway cloning - do nothing when next and past clones are the same', function(assert) {
  const options = {
    src: 'test',
    tech: this.player.tech_,
    sourceType: 'hls'
  };

  const pc = new PlaylistController(options);

  this.csMainPlaylist.playlists.forEach(p => {
    p.attributes['PATHWAY-ID'] = p.attributes.serviceLocation;
    p.attributes.serviceLocation = undefined;
  });

  pc.main = () => this.csMainPlaylist;
  pc.initContentSteeringController_();

  const addCloneStub = sinon.stub(pc.mainPlaylistLoader_, 'addClonePathway');
  const updateCloneStub = sinon.stub(pc.mainPlaylistLoader_, 'updateOrDeleteClone');

  const clone = {
    ID: 'cdn-z',
    ['BASE-ID']: 'cdn-a',
    ['URI-REPLACEMENT']: {
      HOST: 'www.cdn-z.com',
      PARAMS: {
        test: 123
      }
    }
  };

  pc.contentSteeringController_.currentPathwayClones = new Map();
  pc.contentSteeringController_.currentPathwayClones.set(clone.ID, clone);

  const steeringManifestJson = {
    VERSION: 1,
    TTL: 10,
    ['RELOAD-URI']: 'https://fastly-server.content-steering.com/dash.dcsm',
    ['PATHWAY-PRIORITY']: [
      'cdn-b',
      'cdn-a',
      'cdn-z'
    ],
    ['PATHWAY-CLONES']: [clone]
  };

  // By adding this we are saying that the pathway was previously available.
  pc.contentSteeringController_.addAvailablePathway('cdn-z');

  // This triggers `handlePathwayClones()`.
  pc.contentSteeringController_.assignSteeringProperties_(steeringManifestJson);

  // Assert that we do not add, update, or delete any pathway clones.
  assert.equal(addCloneStub.callCount, 0);
  assert.equal(updateCloneStub.callCount, 0);

  // The value is still in the available pathways.
  assert.equal(pc.contentSteeringController_.availablePathways_.has('cdn-z'), true);

  const clonesMap = new Map();

  clonesMap.set(clone.ID, clone);

  assert.deepEqual(pc.contentSteeringController_.currentPathwayClones, clonesMap);
});
