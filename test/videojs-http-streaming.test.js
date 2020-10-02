import document from 'global/document';
import videojs from 'video.js';
import Events from 'video.js';
import QUnit from 'qunit';
import testDataManifests from 'create-test-data!manifests';
import {
  muxed as muxedSegment,
  encryptionKey,
  encrypted as encryptedSegment,
  audio as audioSegment,
  video as videoSegment,
  mp4VideoInit as mp4VideoInitSegment,
  mp4Video as mp4VideoSegment,
  mp4AudioInit as mp4AudioInitSegment,
  mp4Audio as mp4AudioSegment
} from 'create-test-data!segments';
import {
  useFakeEnvironment,
  useFakeMediaSource,
  createPlayer,
  openMediaSource,
  standardXHRResponse,
  absoluteUrl,
  requestAndAppendSegment,
  disposePlaybackWatcher
} from './test-helpers.js';
import {
  createPlaylistID,
  parseManifest
} from '../src/manifest.js';
/* eslint-disable no-unused-vars */
// we need this so that it can register vhs with videojs
import {
  VhsSourceHandler,
  VhsHandler,
  Vhs,
  emeKeySystems,
  LOCAL_STORAGE_KEY,
  expandDataUri,
  setupEmeOptions,
  getAllPsshKeySystemsOptions
} from '../src/videojs-http-streaming';
import window from 'global/window';
// we need this so the plugin registers itself
import 'videojs-contrib-quality-levels';

import {version as vhsVersion} from '../package.json';
import {version as muxVersion} from 'mux.js/package.json';
import {version as mpdVersion} from 'mpd-parser/package.json';
import {version as m3u8Version} from 'm3u8-parser/package.json';
import {version as aesVersion} from 'aes-decrypter/package.json';

let testOrSkip = 'test';

// some tests just don't work reliably on ie11 or edge
if (videojs.browser.IS_EDGE || videojs.browser.IE_VERSION) {
  testOrSkip = 'skip';
}

const ogVhsHandlerSetupQualityLevels = videojs.VhsHandler.prototype.setupQualityLevels_;

// do a shallow copy of the properties of source onto the target object
const merge = function(target, source) {
  let name;

  for (name in source) {
    target[name] = source[name];
  }
};

QUnit.module('VHS', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.requests = this.env.requests;
    this.mse = useFakeMediaSource();
    this.clock = this.env.clock;
    this.old = {};
    if (!videojs.browser.IE_VERSION) {
      this.old.devicePixelRatio = window.devicePixelRatio;
      window.devicePixelRatio = 1;
    }
    // store functionality that some tests need to mock
    this.old.GlobalOptions = videojs.mergeOptions(videojs.options);

    // force the HLS tech to run
    this.old.NativeHlsSupport = videojs.Vhs.supportsNativeHls;
    videojs.Vhs.supportsNativeHls = false;

    this.old.NativeDashSupport = videojs.Vhs.supportsNativeDash;
    videojs.Vhs.supportsNativeDash = false;

    this.old.Decrypt = videojs.Vhs.Decrypter;
    videojs.Vhs.Decrypter = function() {};

    // save and restore browser detection for the Firefox-specific tests
    this.old.browser = videojs.browser;
    videojs.browser = videojs.mergeOptions({}, videojs.browser);

    this.standardXHRResponse = (request, data) => {
      standardXHRResponse(request, data);

      // Because SegmentLoader#fillBuffer_ is now scheduled asynchronously
      // we have to use clock.tick to get the expected side effects of
      // SegmentLoader#handleAppendsDone_
      this.clock.tick(1);
    };

    // setup a player
    this.player = createPlayer();
    this.clock.tick(1);
  },

  afterEach() {
    this.env.restore();
    this.mse.restore();

    if (this.old.hasOwnProperty('devicePixelRatio')) {
      window.devicePixelRatio = this.old.devicePixelRatio;
    }

    merge(videojs.options, this.old.GlobalOptions);

    videojs.Vhs.supportsNativeHls = this.old.NativeHlsSupport;
    videojs.Vhs.supportsNativeDash = this.old.NativeDashSupport;
    videojs.Vhs.Decrypter = this.old.Decrypt;
    videojs.browser = this.old.browser;

    window.localStorage.clear();

    this.player.dispose();
  }
});

QUnit.test('mse urls are created and revoked', function(assert) {
  const old = {
    createObjectURL: window.URL.createObjectURL,
    revokeObjectURL: window.URL.revokeObjectURL
  };
  const ids = [];

  window.URL.createObjectURL = (...args) => {
    const id = old.createObjectURL.apply(window.URL, args);

    ids.push(id);
    return id;
  };

  window.URL.revokeObjectURL = (...args) => {
    const index = ids.indexOf(args[0]);

    if (index !== -1) {
      ids.splice(index, 1);
    }
    return old.revokeObjectURL.apply(window.URL, args);
  };

  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  assert.ok(ids.length > 0, 'object urls created');

  this.player.dispose();

  assert.equal(ids.length, 0, 'all object urls removed');

  window.URL.createObjectURL = old.createObjectURL;
  window.URL.revokeObjectURL = old.revokeObjectURL;
});

QUnit.test('version is exported', function(assert) {
  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  assert.ok(this.player.tech(true).vhs.version, 'version function');
  assert.ok(videojs.VhsHandler.version, 'version function');

  assert.deepEqual(this.player.tech(true).vhs.version(), {
    '@videojs/http-streaming': vhsVersion,
    'mux.js': muxVersion,
    'mpd-parser': mpdVersion,
    'm3u8-parser': m3u8Version,
    'aes-decrypter': aesVersion
  }, 'version is correct');

});

QUnit.test('canChangeType is exported', function(assert) {
  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  assert.ok(this.player.tech(true).vhs.canChangeType, 'canChangeType function');

  const canChangeType = window.SourceBuffer &&
        window.SourceBuffer.prototype &&
        typeof window.SourceBuffer.prototype.changeType === 'function';
  const assertion = canChangeType ? 'ok' : 'notOk';

  assert[assertion](this.player.tech(true).vhs.canChangeType(), 'canChangeType is correct');
});

QUnit.test('deprecation warning is show when using player.hls', function(assert) {
  const oldWarn = videojs.log.warn;
  let warning = '';
  let vhsPlayerAccessEvents = 0;
  let hlsPlayerAccessEvents = 0;

  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.player.tech_.on('usage', (event) => {
    if (event.name === 'vhs-player-access') {
      vhsPlayerAccessEvents++;
    }
    if (event.name === 'hls-player-access') {
      hlsPlayerAccessEvents++;
    }
  });

  videojs.log.warn = (text) => {
    warning = text;
  };
  assert.equal(vhsPlayerAccessEvents, 0, 'no vhs-player-access event was fired');
  assert.equal(hlsPlayerAccessEvents, 0, 'no hls-player-access event was fired');
  const hls = this.player.hls;

  assert.equal(vhsPlayerAccessEvents, 0, 'no vhs-player-access event was fired');
  assert.equal(hlsPlayerAccessEvents, 1, 'an hls-player-access event was fired');
  assert.equal(
    warning,
    'player.hls is deprecated. Use player.tech().vhs instead.',
    'warning would have been shown'
  );
  assert.ok(hls, 'an instance of hls is returned by player.hls');
  videojs.log.warn = oldWarn;
});

QUnit.test('deprecation warning is show when using player.vhs', function(assert) {
  const oldWarn = videojs.log.warn;
  let warning = '';
  let vhsPlayerAccessEvents = 0;
  let hlsPlayerAccessEvents = 0;

  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.player.tech_.on('usage', (event) => {
    if (event.name === 'vhs-player-access') {
      vhsPlayerAccessEvents++;
    }
    if (event.name === 'hls-player-access') {
      hlsPlayerAccessEvents++;
    }
  });

  videojs.log.warn = (text) => {
    warning = text;
  };
  assert.equal(vhsPlayerAccessEvents, 0, 'no vhs-player-access event was fired');
  assert.equal(hlsPlayerAccessEvents, 0, 'no hls-player-access event was fired');
  const vhs = this.player.vhs;

  assert.equal(vhsPlayerAccessEvents, 1, 'a vhs-player-access event was fired');
  assert.equal(hlsPlayerAccessEvents, 0, 'no hls-player-access event was fired');
  assert.equal(
    warning,
    'player.vhs is deprecated. Use player.tech().vhs instead.',
    'warning would have been shown'
  );
  assert.ok(vhs, 'an instance of vhs is returned by player.vhs');
  videojs.log.warn = oldWarn;
});

QUnit.test('the VhsHandler instance is referenced by player.vhs', function(assert) {
  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const vhs = this.player.vhs;

  assert.ok(vhs instanceof VhsHandler, 'player.vhs references an instance of VhsHandler');

  assert.equal(this.env.log.warn.calls, 1, 'warning logged');
});

QUnit.test('tech error may pause loading', function(assert) {
  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  const vhs = this.player.tech_.vhs;
  const mpc = vhs.masterPlaylistController_;
  let pauseCalled = false;

  mpc.pauseLoading = () => {
    pauseCalled = true;
  };

  this.player.tech_.error = () => null;
  this.player.tech_.trigger('error');

  assert.notOk(pauseCalled, 'no video el error attribute, no pause loading');

  this.player.tech_.error = () => 'foo';
  this.player.tech_.trigger('error');

  assert.ok(pauseCalled, 'video el error and trigger pauses loading');

  assert.equal(this.env.log.error.calls, 1, '1 media error logged');
  this.env.log.error.reset();

});

QUnit.test('a deprecation notice is shown when using player.dash', function(assert) {
  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  assert.ok(
    this.player.dash instanceof VhsHandler,
    'player.dash references an instance of VhsHandler'
  );
  assert.equal(this.env.log.warn.calls, 1, 'warning logged');
  assert.equal(
    this.env.log.warn.args[0][0],
    'player.dash is deprecated. Use player.tech().vhs instead.',
    'logged deprecation'
  );
});

QUnit.test('VhsHandler is referenced by player.tech().vhs', function(assert) {
  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  assert.ok(
    this.player.tech().vhs instanceof VhsHandler,
    'player.tech().vhs references an instance of VhsHandler'
  );

  assert.equal(this.env.log.warn.calls, 1, 'warning logged');
  assert.equal(
    this.env.log.warn.args[0][0],
    'Using the tech directly can be dangerous. I hope you know what you\'re doing.\n' +
    'See https://github.com/videojs/video.js/issues/2617 for more info.\n',
    'logged warning'
  );
});

QUnit.test('logs deprecation notice when using player.tech().hls', function(assert) {
  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  assert.ok(
    this.player.tech().hls instanceof VhsHandler,
    'player.tech().hls references an instance of VhsHandler'
  );
  assert.equal(this.env.log.warn.calls, 2, 'warning logged');
  assert.equal(
    this.env.log.warn.args[0][0],
    'Using the tech directly can be dangerous. I hope you know what you\'re doing.\n' +
    'See https://github.com/videojs/video.js/issues/2617 for more info.\n',
    'logged warning'
  );
  assert.equal(
    this.env.log.warn.args[1][0],
    'player.tech().hls is deprecated. Use player.tech().vhs instead.',
    'logged deprecation'
  );
});

QUnit.test('logs deprecation notice when using hls for options', function(assert) {
  this.player.dispose();
  this.player = createPlayer({ html5: { hls: { bandwidth: 0 } } });

  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);
  openMediaSource(this.player, this.clock);

  assert.equal(this.player.tech_.vhs.bandwidth, 0, 'set bandwidth to 0');
  assert.equal(this.env.log.warn.calls, 1, 'warning logged');
  assert.equal(
    this.env.log.warn.args[0][0],
    'Using hls options is deprecated. Use vhs instead.',
  );
});

QUnit.test('logs deprecation notice when using hls for global options', function(assert) {
  const origHlsOptions = videojs.options.hls;

  this.player.dispose();
  videojs.options.hls = {
    bandwidth: 0
  };
  this.player = createPlayer();

  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);
  openMediaSource(this.player, this.clock);

  assert.equal(this.player.tech_.vhs.bandwidth, 0, 'set bandwidth to 0');
  assert.equal(this.env.log.warn.calls, 1, 'warning logged');
  assert.equal(
    this.env.log.warn.args[0][0],
    'Using hls options is deprecated. Use vhs instead.',
  );

  videojs.options.hls = origHlsOptions;
});

QUnit.test('logs deprecation notice when using videojs.Hls', function(assert) {
  assert.equal(videojs.Hls, Vhs, 'can get Vhs object from videojs.Hls');

  assert.equal(this.env.log.warn.calls, 1, 'warning logged');
  assert.equal(
    this.env.log.warn.args[0][0],
    'videojs.Hls is deprecated. Use videojs.Vhs instead.'
  );
});

QUnit.test('logs deprecation notice when using videojs.HlsHandler', function(assert) {
  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  assert.equal(
    videojs.HlsHandler,
    VhsHandler,
    'can get VhsHandler from videojs.HlsHandler'
  );

  assert.equal(this.env.log.warn.calls, 1, 'warning logged');
  assert.equal(
    this.env.log.warn.args[0][0],
    'videojs.HlsHandler is deprecated. Use videojs.VhsHandler instead.'
  );
});

QUnit.test('logs deprecation notice when using videojs.HlsSourceHandler', function(assert) {
  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  assert.equal(
    videojs.HlsSourceHandler,
    VhsSourceHandler,
    'can get VhsSourceHandler from videojs.HlsSourceHandler'
  );

  assert.equal(this.env.log.warn.calls, 1, 'warning logged');
  assert.equal(
    this.env.log.warn.args[0][0],
    'videojs.HlsSourceHandler is deprecated. Use videojs.VhsSourceHandler instead.'
  );
});
QUnit.test('starts playing if autoplay is specified', function(assert) {
  this.player.autoplay(true);
  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  // make sure play() is called *after* the media source opens
  openMediaSource(this.player, this.clock);

  this.standardXHRResponse(this.requests[0]);
  assert.ok(!this.player.paused(), 'not paused');
});

QUnit.test('stats are reset on each new source', function(assert) {
  const done = assert.async();

  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  // make sure play() is called *after* the media source opens
  openMediaSource(this.player, this.clock);

  const segment = muxedSegment();
  // copy the byte length since the segment bytes get cleared out
  const segmentByteLength = segment.byteLength;

  assert.ok(segmentByteLength, 'the segment has some number of bytes');

  // media
  this.standardXHRResponse(this.requests.shift());
  // segment 0
  this.standardXHRResponse(this.requests.shift(), segment);

  this.player.tech(true).vhs.masterPlaylistController_.mainSegmentLoader_.one('appending', () => {
    assert.equal(
      this.player.tech_.vhs.stats.mediaBytesTransferred,
      segmentByteLength,
      'stat is set'
    );

    this.player.src({
      src: 'manifest/master.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });
    this.clock.tick(1);

    assert.equal(this.player.tech_.vhs.stats.mediaBytesTransferred, 0, 'stat is reset');
    done();
  });
});

QUnit.test('XHR requests first byte range on play', function(assert) {
  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.player.tech_.triggerReady();
  this.clock.tick(1);
  this.player.tech_.trigger('play');
  openMediaSource(this.player, this.clock);
  this.standardXHRResponse(this.requests[0]);
  assert.equal(this.requests[1].headers.Range, 'bytes=0-522827');
});

QUnit.test('Seeking requests correct byte range', function(assert) {
  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.player.tech_.trigger('play');
  openMediaSource(this.player, this.clock);
  this.standardXHRResponse(this.requests[0]);
  this.clock.tick(1);
  this.player.currentTime(41);
  this.clock.tick(2);
  assert.equal(this.requests[2].headers.Range, 'bytes=2299992-2835603');
});

QUnit.test('autoplay seeks to the live point after playlist load', function(assert) {
  let currentTime = 0;

  this.player.autoplay(true);
  this.player.tech_.currentTime = (ct) => {
    currentTime = ct;
  };
  this.player.src({
    src: 'liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.player.tech_.readyState = () => 4;
  this.player.tech_.trigger('play');
  this.standardXHRResponse(this.requests.shift());
  this.clock.tick(1);

  assert.notEqual(currentTime, 0, 'seeked on autoplay');
});

QUnit.test('autoplay seeks to the live point after media source open', function(assert) {
  let currentTime = 0;

  this.player.autoplay(true);
  this.player.tech_.setCurrentTime = (ct) => {
    currentTime = ct;
  };
  this.player.src({
    src: 'liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.player.tech_.readyState = () => 4;

  this.clock.tick(1);

  this.player.tech_.triggerReady();
  this.clock.tick(1);
  this.standardXHRResponse(this.requests.shift());
  openMediaSource(this.player, this.clock);
  this.player.tech_.trigger('play');
  this.clock.tick(1);

  assert.notEqual(currentTime, 0, 'seeked on autoplay');
});

QUnit.test(
  'autoplay seeks to the live point after tech fires loadedmetadata in ie11',
  function(assert) {
    videojs.browser.IE_VERSION = 11;
    let currentTime = 0;

    this.player.autoplay(true);
    this.player.on('seeking', () => {
      currentTime = this.player.currentTime();
    });
    this.player.src({
      src: 'liveStart30sBefore.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    this.clock.tick(1);

    openMediaSource(this.player, this.clock);
    this.player.tech_.trigger('play');
    this.standardXHRResponse(this.requests.shift());
    this.clock.tick(1);

    assert.equal(currentTime, 0, 'have not played yet');

    this.player.tech_.trigger('loadedmetadata');
    this.clock.tick(1);

    assert.notEqual(currentTime, 0, 'seeked after tech is ready');
  }
);

QUnit.test(
  'duration is set when the source opens after the playlist is loaded',
  function(assert) {
    this.player.src({
      src: 'media.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    this.clock.tick(1);

    this.player.tech_.triggerReady();
    this.clock.tick(1);
    this.standardXHRResponse(this.requests.shift());
    openMediaSource(this.player, this.clock);

    assert.equal(
      this.player.tech_.vhs.mediaSource.duration,
      40,
      'set the duration'
    );
  }
);

QUnit.test('codecs are passed to the source buffer', function(assert) {
  const done = assert.async();
  const codecs = [];

  this.player.src({
    src: 'custom-codecs.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);
  openMediaSource(this.player, this.clock);

  const addSourceBuffer = this.player.tech_.vhs.mediaSource.addSourceBuffer;

  this.player.tech_.vhs.mediaSource.addSourceBuffer = function(codec) {
    codecs.push(codec);
    return addSourceBuffer.call(this, codec);
  };

  // master
  this.requests.shift().respond(
    200, null,
    '#EXTM3U\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.dd00dd, mp4a.40.9"\n' +
    'media.m3u8\n'
  );
  // media
  this.standardXHRResponse(this.requests.shift());

  // segment 0
  this.standardXHRResponse(this.requests.shift(), muxedSegment());

  // source buffer won't be created until we have our first segment
  this.player.tech(true).vhs.masterPlaylistController_.mainSegmentLoader_.one('appending', () => {
    // always create separate audio and video source buffers
    assert.equal(codecs.length, 2, 'created two source buffers');
    assert.notEqual(
      codecs.indexOf('audio/mp4;codecs="mp4a.40.9"'),
      -1,
      'specified the audio codec'
    );
    assert.notEqual(
      codecs.indexOf('video/mp4;codecs="avc1.dd00dd"'),
      -1,
      'specified the video codec'
    );
    done();
  });
});

QUnit.test('including HLS as a tech does not error', function(assert) {
  const player = createPlayer({
    techOrder: ['vhs', 'html5']
  });

  this.clock.tick(1);

  assert.ok(player, 'created the player');
  assert.equal(this.env.log.warn.calls, 2, 'logged two warnings for deprecations');
});

QUnit.test('creates a PlaylistLoader on init', function(assert) {
  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  assert.equal(this.requests[0].aborted, true, 'aborted previous src');
  this.standardXHRResponse(this.requests[1]);
  assert.ok(
    this.player.tech_.vhs.playlists.master,
    'set the master playlist'
  );
  assert.ok(
    this.player.tech_.vhs.playlists.media(),
    'set the media playlist'
  );
  assert.ok(
    this.player.tech_.vhs.playlists.media().segments,
    'the segment entries are parsed'
  );
  assert.strictEqual(
    this.player.tech_.vhs.playlists.master.playlists[0],
    this.player.tech_.vhs.playlists.media(),
    'the playlist is selected'
  );
});

QUnit.test('sets the duration if one is available on the playlist', function(assert) {
  let events = 0;

  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.player.tech_.on('durationchange', function() {
    events++;
  });

  this.standardXHRResponse(this.requests[0]);
  assert.equal(
    this.player.tech_.vhs.mediaSource.duration,
    40,
    'set the duration'
  );
  assert.equal(events, 1, 'durationchange is fired');
});

QUnit.test('estimates individual segment durations if needed', function(assert) {
  let changes = 0;

  this.player.src({
    src: 'http://example.com/manifest/missingExtinf.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.player.tech_.vhs.mediaSource.duration = NaN;
  this.player.tech_.on('durationchange', function() {
    changes++;
  });

  this.standardXHRResponse(this.requests[0]);
  assert.strictEqual(
    this.player.tech_.vhs.mediaSource.duration,
    this.player.tech_.vhs.playlists.media().segments.length * 10,
    'duration is updated'
  );
  assert.strictEqual(changes, 1, 'one durationchange fired');
});

QUnit.test(
  'translates seekable by the starting time for live playlists',
  function(assert) {
    this.player.src({
      src: 'media.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    this.clock.tick(1);

    openMediaSource(this.player, this.clock);
    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
                                '#EXT-X-MEDIA-SEQUENCE:15\n' +
                                '#EXT-X-TARGETDURATION:10\n' +
                                '#EXTINF:10,\n' +
                                '0.ts\n' +
                                '#EXTINF:10,\n' +
                                '1.ts\n' +
                                '#EXTINF:10,\n' +
                                '2.ts\n' +
                                '#EXTINF:10,\n' +
                                '3.ts\n'
    );

    const seekable = this.player.seekable();

    assert.equal(seekable.length, 1, 'one seekable range');
    assert.equal(seekable.start(0), 0, 'the earliest possible position is at zero');
    assert.equal(seekable.end(0), 10, 'end is relative to the start');
  }
);

QUnit.test('starts downloading a segment on loadedmetadata', function(assert) {
  const done = assert.async();

  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.player.buffered = function() {
    return videojs.createTimeRange(0, 0);
  };
  openMediaSource(this.player, this.clock);

  const segment = muxedSegment();
  // copy the byte length since the segment bytes get cleared out
  const segmentByteLength = segment.byteLength;

  assert.ok(segmentByteLength, 'the segment has some number of bytes');

  // media
  this.standardXHRResponse(this.requests[0]);
  // segment 0
  this.standardXHRResponse(this.requests[1], segment);

  assert.strictEqual(
    this.requests[1].url,
    absoluteUrl('manifest/media-00001.ts'),
    'the first segment is requested'
  );

  this.player.tech(true).vhs.masterPlaylistController_.mainSegmentLoader_.one('appending', () => {
    // verify stats
    assert.equal(
      this.player.tech_.vhs.stats.mediaBytesTransferred,
      segmentByteLength,
      'transferred the segment byte length'
    );
    assert.equal(this.player.tech_.vhs.stats.mediaRequests, 1, '1 request');
    done();
  });
});

QUnit.test('re-initializes the handler for each source', function(assert) {
  let secondPlaylists;
  let secondMSE;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  const firstPlaylists = this.player.tech_.vhs.playlists;
  const firstMSE = this.player.tech_.vhs.mediaSource;

  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  const mpc = this.player.tech_.vhs.masterPlaylistController_;

  // need a segment request to complete for the source buffers to be created
  return requestAndAppendSegment({
    request: this.requests.shift(),
    mediaSource: mpc.mediaSource,
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock,
    tickClock: false
  }).then(() => {
    let audioBufferAborts = 0;
    let videoBufferAborts = 0;

    mpc.mainSegmentLoader_.sourceUpdater_.audioBuffer.abort = () => audioBufferAborts++;
    mpc.mainSegmentLoader_.sourceUpdater_.videoBuffer.abort = () => videoBufferAborts++;

    // allow timeout for making another request
    this.clock.tick(1);

    assert.equal(this.requests.length, 1, 'made another request');

    this.player.src({
      src: 'manifest/master.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    this.clock.tick(1);

    openMediaSource(this.player, this.clock);
    secondPlaylists = this.player.tech_.vhs.playlists;
    secondMSE = this.player.tech_.vhs.mediaSource;

    assert.equal(audioBufferAborts, 1, 'aborted the old audio source buffer');
    assert.equal(videoBufferAborts, 1, 'aborted the old video source buffer');
    assert.ok(this.requests[0].aborted, 'aborted the old segment request');
    assert.notStrictEqual(
      firstPlaylists,
      secondPlaylists,
      'the playlist object is not reused'
    );
    assert.notStrictEqual(firstMSE, secondMSE, 'the media source object is not reused');
  });
});

QUnit.test(
  'triggers a media source error when an initial playlist request errors',
  function(assert) {
    this.player.src({
      src: 'manifest/master.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    this.clock.tick(1);

    openMediaSource(this.player, this.clock);
    this.requests.pop().respond(500);

    assert.equal(
      this.player.tech_.vhs.mediaSource.error_,
      'network',
      'a network error is triggered'
    );
  }
);

QUnit.test(
  'triggers a player error when an initial playlist request errors and the media source ' +
'isn\'t open',
  function(assert) {
    const done = assert.async();
    const origError = videojs.log.error;
    const errLogs = [];
    const endOfStreams = [];

    videojs.log.error = (log) => errLogs.push(log);

    this.player.src({
      src: 'manifest/master.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });
    openMediaSource(this.player, this.clock);

    this.player.tech_.vhs.masterPlaylistController_.mediaSource.readyState = 'closed';

    this.player.on('error', () => {
      const error = this.player.error();

      assert.equal(error.code, 2, 'error has correct code');
      assert.equal(
        error.message,
        'HLS playlist request error at URL: manifest/master.m3u8.',
        'error has correct message'
      );
      assert.equal(errLogs.length, 1, 'logged an error');

      videojs.log.error = origError;

      assert.notOk(this.player.tech_.vhs.mediaSource.error_, 'no media source error');

      done();
    });

    this.requests.pop().respond(500);
  }
);

QUnit.test('downloads media playlists after loading the master', function(assert) {
  const done = assert.async();

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);
  openMediaSource(this.player, this.clock);

  this.player.tech_.vhs.bandwidth = 20e10;
  // master
  this.standardXHRResponse(this.requests[0]);
  // media
  this.standardXHRResponse(this.requests[1]);

  const segment = muxedSegment();
  // copy the byte length since the segment bytes get cleared out
  const segmentByteLength = segment.byteLength;

  assert.ok(segmentByteLength, 'the segment has some number of bytes');

  // segment 0
  this.standardXHRResponse(this.requests[2], segment);

  assert.strictEqual(
    this.requests[0].url,
    'manifest/master.m3u8',
    'master playlist requested'
  );
  assert.strictEqual(
    this.requests[1].url,
    absoluteUrl('manifest/media2.m3u8'),
    'media playlist requested'
  );
  assert.strictEqual(
    this.requests[2].url,
    absoluteUrl('manifest/media2-00001.ts'),
    'first segment requested'
  );

  this.player.tech(true).vhs.masterPlaylistController_.mainSegmentLoader_.one('appending', () => {
    // verify stats
    assert.equal(
      this.player.tech_.vhs.stats.mediaBytesTransferred,
      segmentByteLength,
      'transferred the segment byte length'
    );
    assert.equal(this.player.tech_.vhs.stats.mediaRequests, 1, '1 request');
    done();
  });
});

QUnit.test('setting bandwidth resets throughput', function(assert) {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.player.tech_.vhs.throughput = 1000;
  assert.strictEqual(
    this.player.tech_.vhs.throughput,
    1000,
    'throughput is set'
  );
  this.player.tech_.vhs.bandwidth = 20e10;
  assert.strictEqual(
    this.player.tech_.vhs.throughput,
    0,
    'throughput is reset when bandwidth is specified'
  );
});

QUnit.test('a thoughput of zero is ignored in systemBandwidth', function(assert) {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.player.tech_.vhs.bandwidth = 20e10;
  assert.strictEqual(
    this.player.tech_.vhs.throughput,
    0,
    'throughput is reset when bandwidth is specified'
  );
  assert.strictEqual(
    this.player.tech_.vhs.systemBandwidth,
    20e10,
    'systemBandwidth is the same as bandwidth'
  );
});

QUnit.test(
  'systemBandwidth is a combination of thoughput and bandwidth',
  function(assert) {
    this.player.src({
      src: 'manifest/master.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    this.clock.tick(1);

    this.player.tech_.vhs.bandwidth = 20e10;
    this.player.tech_.vhs.throughput = 20e10;
    // 1 / ( 1 / 20e10 + 1 / 20e10) = 10e10
    assert.strictEqual(
      this.player.tech_.vhs.systemBandwidth,
      10e10,
      'systemBandwidth is the combination of bandwidth and throughput'
    );
  }
);

QUnit.test('requests a reasonable rendition to start', function(assert) {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.standardXHRResponse(
    this.requests[0],
    '#EXTM3U\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=50\n' +
    'mediaLow.m3u8\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=240000\n' +
    'mediaNormal.m3u8\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=19280000000\n' +
    'mediaHigh.m3u8\n'
  );

  assert.strictEqual(
    this.requests[0].url,
    'manifest/master.m3u8',
    'master playlist requested'
  );
  assert.strictEqual(
    this.requests[1].url,
    absoluteUrl('manifest/mediaNormal.m3u8'),
    'reasonable bandwidth media playlist requested'
  );
});

QUnit.test('upshifts if the initial bandwidth hint is high', function(assert) {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.player.tech_.vhs.bandwidth = 10e20;
  this.standardXHRResponse(
    this.requests[0],
    '#EXTM3U\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=50\n' +
    'mediaLow.m3u8\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=240000\n' +
    'mediaNormal.m3u8\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=19280000000\n' +
    'mediaHigh.m3u8\n'
  );

  assert.strictEqual(
    this.requests[0].url,
    'manifest/master.m3u8',
    'master playlist requested'
  );
  assert.strictEqual(
    this.requests[1].url,
    absoluteUrl('manifest/mediaHigh.m3u8'),
    'high bandwidth media playlist requested'
  );
});

QUnit.test('downshifts if the initial bandwidth hint is low', function(assert) {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.player.tech_.vhs.bandwidth = 100;
  this.standardXHRResponse(
    this.requests[0],
    '#EXTM3U\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=50\n' +
    'mediaLow.m3u8\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=240000\n' +
    'mediaNormal.m3u8\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=19280000000\n' +
    'mediaHigh.m3u8\n'
  );

  assert.strictEqual(
    this.requests[0].url,
    'manifest/master.m3u8',
    'master playlist requested'
  );
  assert.strictEqual(
    this.requests[1].url,
    absoluteUrl('manifest/mediaLow.m3u8'),
    'low bandwidth media playlist requested'
  );
});

QUnit.test('buffer checks are noops until a media playlist is ready', function(assert) {
  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.clock.tick(10 * 1000);

  assert.strictEqual(1, this.requests.length, 'one request was made');
  assert.strictEqual(
    this.requests[0].url,
    'manifest/media.m3u8',
    'media playlist requested'
  );
});

QUnit.test('buffer checks are noops when only the master is ready', function(assert) {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());
  // ignore any outstanding segment requests
  this.requests.length = 0;

  // load in a new playlist which will cause playlists.media() to be
  // undefined while it is being fetched
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  // respond with the master playlist but don't send the media playlist yet
  // force media1 to be requested
  this.player.tech_.vhs.bandwidth = 1;
  // master
  this.standardXHRResponse(this.requests.shift());
  this.clock.tick(10 * 1000);

  assert.strictEqual(this.requests.length, 1, 'one request was made');
  assert.strictEqual(
    this.requests[0].url,
    absoluteUrl('manifest/media1.m3u8'),
    'media playlist requested'
  );

  // verify stats
  assert.equal(this.player.tech_.vhs.stats.bandwidth, 1, 'bandwidth set above');
});

QUnit.test('selects a playlist below the current bandwidth', function(assert) {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.standardXHRResponse(this.requests[0]);

  // the default playlist has a really high bitrate
  this.player.tech_.vhs.playlists.master.playlists[0].attributes.BANDWIDTH = 9e10;
  // playlist 1 has a very low bitrate
  this.player.tech_.vhs.playlists.master.playlists[1].attributes.BANDWIDTH = 1;
  // but the detected client bandwidth is really low
  this.player.tech_.vhs.bandwidth = 10;

  const playlist = this.player.tech_.vhs.selectPlaylist();

  assert.strictEqual(
    playlist,
    this.player.tech_.vhs.playlists.master.playlists[1],
    'the low bitrate stream is selected'
  );

  // verify stats
  assert.equal(this.player.tech_.vhs.stats.bandwidth, 10, 'bandwidth set above');
});

QUnit.test(
  'selects a primary rendtion when there are multiple rendtions share same attributes',
  function(assert) {
    let playlist;

    this.player.src({
      src: 'manifest/master.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });
    openMediaSource(this.player, this.clock);
    standardXHRResponse(this.requests[0]);

    // covers playlists with same bandwidth but different resolution and different bandwidth
    // but same resolution
    this.player.tech_.vhs.playlists.master.playlists[0].attributes.BANDWIDTH = 528;
    this.player.tech_.vhs.playlists.master.playlists[1].attributes.BANDWIDTH = 528;
    this.player.tech_.vhs.playlists.master.playlists[2].attributes.BANDWIDTH = 728;
    this.player.tech_.vhs.playlists.master.playlists[3].attributes.BANDWIDTH = 728;

    this.player.tech_.vhs.bandwidth = 1000;

    playlist = this.player.tech_.vhs.selectPlaylist();
    assert.strictEqual(
      playlist,
      this.player.tech_.vhs.playlists.master.playlists[2],
      'select the rendition with largest bandwidth and just-larger-than video player'
    );

    // verify stats
    assert.equal(this.player.tech_.vhs.stats.bandwidth, 1000, 'bandwidth set above');

    // covers playlists share same bandwidth and resolutions
    this.player.tech_.vhs.playlists.master.playlists[0].attributes.BANDWIDTH = 728;
    this.player.tech_.vhs.playlists.master.playlists[0].attributes.RESOLUTION.width = 960;
    this.player.tech_.vhs.playlists.master.playlists[0].attributes.RESOLUTION.height = 540;
    this.player.tech_.vhs.playlists.master.playlists[1].attributes.BANDWIDTH = 728;
    this.player.tech_.vhs.playlists.master.playlists[2].attributes.BANDWIDTH = 728;
    this.player.tech_.vhs.playlists.master.playlists[2].attributes.RESOLUTION.width = 960;
    this.player.tech_.vhs.playlists.master.playlists[2].attributes.RESOLUTION.height = 540;
    this.player.tech_.vhs.playlists.master.playlists[3].attributes.BANDWIDTH = 728;

    this.player.tech_.vhs.bandwidth = 1000;

    playlist = this.player.tech_.vhs.selectPlaylist();
    assert.strictEqual(
      playlist,
      this.player.tech_.vhs.playlists.master.playlists[0],
      'the primary rendition is selected'
    );
  }
);

QUnit.test('allows initial bandwidth to be provided', function(assert) {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.player.tech_.vhs.bandwidth = 500;

  this.requests[0].bandwidth = 1;
  this.requests.shift().respond(
    200, null,
    '#EXTM3U\n' +
                                '#EXT-X-PLAYLIST-TYPE:VOD\n' +
                                '#EXT-X-TARGETDURATION:10\n'
  );
  assert.equal(
    this.player.tech_.vhs.bandwidth,
    500,
    'prefers user-specified initial bandwidth'
  );

  // verify stats
  assert.equal(this.player.tech_.vhs.stats.bandwidth, 500, 'bandwidth set above');
});

QUnit.test('raises the minimum bitrate for a stream proportionially', function(assert) {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.standardXHRResponse(this.requests[0]);

  // the default playlist's bandwidth + 10% is assert.equal to the current bandwidth
  this.player.tech_.vhs.playlists.master.playlists[0].attributes.BANDWIDTH = 10;
  this.player.tech_.vhs.bandwidth = 11;

  // 9.9 * 1.1 < 11
  this.player.tech_.vhs.playlists.master.playlists[1].attributes.BANDWIDTH = 9.9;
  const playlist = this.player.tech_.vhs.selectPlaylist();

  assert.strictEqual(
    playlist,
    this.player.tech_.vhs.playlists.master.playlists[1],
    'a lower bitrate stream is selected'
  );

  // verify stats
  assert.equal(this.player.tech_.vhs.stats.bandwidth, 11, 'bandwidth set above');
});

QUnit.test('uses the lowest bitrate if no other is suitable', function(assert) {

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.standardXHRResponse(this.requests[0]);

  // the lowest bitrate playlist is much greater than 1b/s
  this.player.tech_.vhs.bandwidth = 1;
  const playlist = this.player.tech_.vhs.selectPlaylist();

  // playlist 1 has the lowest advertised bitrate
  assert.strictEqual(
    playlist,
    this.player.tech_.vhs.playlists.master.playlists[1],
    'the lowest bitrate stream is selected'
  );

  // verify stats
  assert.equal(this.player.tech_.vhs.stats.bandwidth, 1, 'bandwidth set above');
});

QUnit.test('selects the correct rendition by tech dimensions', function(assert) {
  let playlist;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.standardXHRResponse(this.requests[0]);

  const vhs = this.player.tech_.vhs;

  this.player.width(640);
  this.player.height(360);
  vhs.bandwidth = 3000000;

  playlist = vhs.selectPlaylist();

  assert.deepEqual(
    playlist.attributes.RESOLUTION,
    {width: 960, height: 540},
    'should return the correct resolution by tech dimensions'
  );
  assert.equal(
    playlist.attributes.BANDWIDTH,
    1928000,
    'should have the expected bandwidth in case of multiple'
  );

  this.player.width(1920);
  this.player.height(1080);
  vhs.bandwidth = 3000000;

  playlist = vhs.selectPlaylist();

  assert.deepEqual(
    playlist.attributes.RESOLUTION,
    {width: 960, height: 540},
    'should return the correct resolution by tech dimensions'
  );
  assert.equal(
    playlist.attributes.BANDWIDTH,
    1928000,
    'should have the expected bandwidth in case of multiple'
  );

  this.player.width(396);
  this.player.height(224);
  playlist = vhs.selectPlaylist();

  assert.deepEqual(
    playlist.attributes.RESOLUTION,
    {width: 396, height: 224},
    'should return the correct resolution by ' +
                   'tech dimensions, if exact match'
  );
  assert.equal(
    playlist.attributes.BANDWIDTH,
    440000,
    'should have the expected bandwidth in case of multiple, if exact match'
  );

  this.player.width(395);
  this.player.height(222);
  playlist = this.player.tech_.vhs.selectPlaylist();

  assert.deepEqual(
    playlist.attributes.RESOLUTION,
    {width: 396, height: 224},
    'should return the next larger resolution by tech dimensions, ' +
                   'if no exact match exists'
  );
  assert.equal(
    playlist.attributes.BANDWIDTH,
    440000,
    'should have the expected bandwidth in case of multiple, if exact match'
  );

  // verify stats
  assert.equal(this.player.tech_.vhs.stats.bandwidth, 3000000, 'bandwidth set above');
});

QUnit.test('selects the highest bitrate playlist when the player dimensions are ' +
     'larger than any of the variants', function(assert) {

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  // master
  this.requests.shift().respond(
    200, null,
    '#EXTM3U\n' +
                                '#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=2x1\n' +
                                'media.m3u8\n' +
                                '#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1x1\n' +
                                'media1.m3u8\n'
  );
  // media
  this.standardXHRResponse(this.requests.shift());
  this.player.tech_.vhs.bandwidth = 1e10;

  this.player.width(1024);
  this.player.height(768);

  const playlist = this.player.tech_.vhs.selectPlaylist();

  assert.equal(
    playlist.attributes.BANDWIDTH,
    1000,
    'selected the highest bandwidth variant'
  );

  // verify stats
  assert.equal(this.player.tech_.vhs.stats.bandwidth, 1e10, 'bandwidth set above');
});

QUnit.test('filters playlists that are currently excluded', function(assert) {
  let playlist;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.player.tech_.vhs.bandwidth = 1e10;
  // master
  this.requests.shift().respond(
    200, null,
    '#EXTM3U\n' +
                                '#EXT-X-STREAM-INF:BANDWIDTH=1000\n' +
                                'media.m3u8\n' +
                                '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
                                'media1.m3u8\n'
  );
  // media
  this.standardXHRResponse(this.requests.shift());

  // exclude the current playlist
  this.player.tech_.vhs.playlists.master.playlists[0].excludeUntil = +new Date() + 1000;
  playlist = this.player.tech_.vhs.selectPlaylist();
  assert.equal(
    playlist,
    this.player.tech_.vhs.playlists.master.playlists[1],
    'respected exclusions'
  );

  // timeout the exclusion
  this.clock.tick(1000);
  playlist = this.player.tech_.vhs.selectPlaylist();
  assert.equal(
    playlist,
    this.player.tech_.vhs.playlists.master.playlists[0],
    'expired the exclusion'
  );

  // verify stats
  assert.equal(this.player.tech_.vhs.stats.bandwidth, 1e10, 'bandwidth set above');
});

QUnit.test('does not blacklist compatible H.264 codec strings', function(assert) {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.player.tech_.vhs.bandwidth = 1;
  // master
  this.requests.shift()
    .respond(
      200, null,
      '#EXTM3U\n' +
             '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.5"\n' +
             'media.m3u8\n' +
             '#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400f,mp4a.40.5"\n' +
             'media1.m3u8\n'
    );

  // media
  this.standardXHRResponse(this.requests.shift());
  const master = this.player.tech_.vhs.playlists.master;
  const loader = this.player.tech_.vhs.masterPlaylistController_.mainSegmentLoader_;

  loader.currentMediaInfo_ = {hasVideo: true, hasAudio: true};
  loader.trigger('trackinfo');

  assert.strictEqual(
    typeof master.playlists[0].excludeUntil,
    'undefined',
    'did not blacklist'
  );
  assert.strictEqual(
    typeof master.playlists[1].excludeUntil,
    'undefined',
    'did not blacklist'
  );

  // verify stats
  assert.equal(this.player.tech_.vhs.stats.bandwidth, 1, 'bandwidth set above');
});

QUnit.test('does not blacklist compatible AAC codec strings', function(assert) {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  // master
  this.requests.shift()
    .respond(
      200, null,
      '#EXTM3U\n' +
             '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.2"\n' +
             'media.m3u8\n' +
             '#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400d,not-an-audio-codec"\n' +
             'media1.m3u8\n'
    );

  // media
  this.standardXHRResponse(this.requests.shift());

  const loader = this.player.tech_.vhs.masterPlaylistController_.mainSegmentLoader_;
  const master = this.player.tech_.vhs.playlists.master;

  loader.currentMediaInfo_ = {hasVideo: true, hasAudio: true};
  loader.trigger('trackinfo');

  assert.strictEqual(
    typeof master.playlists[0].excludeUntil,
    'undefined',
    'did not blacklist mp4a.40.2'
  );
  assert.strictEqual(
    master.playlists[1].excludeUntil,
    Infinity,
    'blacklisted invalid audio codec'
  );
});

QUnit.test('blacklists incompatible playlists by codec, without codec switching', function(assert) {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  const playlistString =
    '#EXTM3U\n' +
    // selected playlist
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.2"\n' +
    'media.m3u8\n' +
    // compatible with selected playlist
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.2"\n' +
    'media1.m3u8\n' +
    // incompatible by audio codec difference
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,ac-3"\n' +
    'media2.m3u8\n' +
    // incompatible by video codec difference
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="hvc1.4d400d,mp4a.40.2"\n' +
    'media3.m3u8\n' +
    // incompatible, only audio codec
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="mp4a.40.2"\n' +
    'media4.m3u8\n' +
    // incompatible, only video codec
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d"\n' +
    'media5.m3u8\n' +
    // compatible with selected playlist
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1,mp4a"\n' +
    'media6.m3u8\n';

  // master
  this.requests.shift().respond(200, null, playlistString);

  // media
  this.standardXHRResponse(this.requests.shift());

  const mpc = this.player.tech_.vhs.masterPlaylistController_;
  const loader = mpc.mainSegmentLoader_;
  const master = this.player.tech_.vhs.playlists.master;

  mpc.sourceUpdater_.canChangeType = () => false;

  loader.currentMediaInfo_ = {hasVideo: true, hasAudio: true};
  loader.trigger('trackinfo');
  const playlists = master.playlists;

  assert.strictEqual(playlists.length, 7, 'six playlists total');
  assert.strictEqual(typeof playlists[0].excludeUntil, 'undefined', 'did not blacklist first playlist');
  assert.strictEqual(typeof playlists[1].excludeUntil, 'undefined', 'did not blacklist second playlist');
  assert.strictEqual(playlists[2].excludeUntil, Infinity, 'blacklisted incompatible audio playlist');
  assert.strictEqual(playlists[3].excludeUntil, Infinity, 'blacklisted incompatible video playlist');
  assert.strictEqual(playlists[4].excludeUntil, Infinity, 'blacklisted audio only playlist');
  assert.strictEqual(playlists[5].excludeUntil, Infinity, 'blacklisted video only playlist');
  assert.strictEqual(typeof playlists[6].excludeUntil, 'undefined', 'did not blacklist seventh playlist');
});

QUnit.test('does not blacklist incompatible codecs with codec switching', function(assert) {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  const playlistString =
    '#EXTM3U\n' +
    // selected playlist
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.2"\n' +
    'media.m3u8\n' +
    // compatible with selected playlist
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.2"\n' +
    'media1.m3u8\n' +
    // incompatible by audio codec difference
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,ac-3"\n' +
    'media2.m3u8\n' +
    // incompatible by video codec difference
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="hvc1.4d400d,mp4a.40.2"\n' +
    'media3.m3u8\n' +
    // incompatible, only audio codec
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="mp4a.40.2"\n' +
    'media4.m3u8\n' +
    // incompatible, only video codec
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d"\n' +
    'media5.m3u8\n' +
    // compatible with selected playlist
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1,mp4a"\n' +
    'media6.m3u8\n';

  // master
  this.requests.shift().respond(200, null, playlistString);

  // media
  this.standardXHRResponse(this.requests.shift());

  const mpc = this.player.tech_.vhs.masterPlaylistController_;
  const loader = mpc.mainSegmentLoader_;
  const master = this.player.tech_.vhs.playlists.master;

  mpc.sourceUpdater_.canChangeType = () => true;

  loader.currentMediaInfo_ = {hasVideo: true, hasAudio: true};
  loader.trigger('trackinfo');
  const playlists = master.playlists;

  assert.strictEqual(playlists.length, 7, 'six playlists total');
  assert.strictEqual(typeof playlists[0].excludeUntil, 'undefined', 'did not blacklist first playlist');
  assert.strictEqual(typeof playlists[1].excludeUntil, 'undefined', 'did not blacklist second playlist');
  assert.strictEqual(typeof playlists[2].excludeUntil, 'undefined', 'blacklisted incompatible audio playlist');
  assert.strictEqual(typeof playlists[3].excludeUntil, 'undefined', 'blacklisted incompatible video playlist');
  assert.strictEqual(playlists[4].excludeUntil, Infinity, 'blacklisted audio only playlist');
  assert.strictEqual(playlists[5].excludeUntil, Infinity, 'blacklisted video only playlist');
  assert.strictEqual(typeof playlists[6].excludeUntil, 'undefined', 'did not blacklist seventh playlist');
});

QUnit.test('blacklists fmp4 playlists by browser support', function(assert) {
  const oldIsTypeSupported = window.MediaSource.isTypeSupported;

  window.MediaSource.isTypeSupported = (t) => (/avc1|mp4a/).test(t);
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  const playlistString =
    '#EXTM3U\n' +
    // video not supported
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="hvc1,mp4a.40.2"\n' +
    'media.m3u8\n' +
    // audio not supported
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,ac-3"\n' +
    'media.m3u8\n' +
    // supported!
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.2"\n' +
    'media1.m3u8\n';

  const mpc = this.player.tech_.vhs.masterPlaylistController_;

  // do not exclude incompatible so that we can run this test.
  mpc.excludeUnsupportedVariants_ = () => {};

  // master
  this.requests.shift().respond(200, null, playlistString);

  // media
  this.standardXHRResponse(this.requests.shift());

  const playlistLoader = mpc.masterPlaylistLoader_;
  const loader = mpc.mainSegmentLoader_;
  const master = this.player.tech_.vhs.playlists.master;

  let debugLogs = [];

  mpc.logger_ = (...logs) => {
    debugLogs = debugLogs.concat(logs);
  };

  const playlists = master.playlists;

  playlistLoader.media = () => playlists[0];
  loader.mainStartingMedia_ = playlists[0];
  loader.currentMediaInfo_ = {hasVideo: true, hasAudio: true, isFmp4: true};
  loader.trigger('trackinfo');

  playlistLoader.media = () => playlists[1];
  loader.mainStartingMedia_ = playlists[1];
  loader.currentMediaInfo_ = {hasVideo: true, hasAudio: true, isFmp4: true};
  loader.trigger('trackinfo');

  playlistLoader.media = () => playlists[2];
  loader.mainStartingMedia_ = playlists[2];
  loader.currentMediaInfo_ = {hasVideo: true, hasAudio: true, isFmp4: true};
  loader.trigger('trackinfo');

  assert.strictEqual(playlists.length, 3, 'three playlists total');
  assert.strictEqual(playlists[0].excludeUntil, Infinity, 'blacklisted first playlist');
  assert.strictEqual(playlists[1].excludeUntil, Infinity, 'blacklisted second playlist');
  assert.strictEqual(typeof playlists[2].excludeUntil, 'undefined', 'did not blacklist second playlist');
  assert.deepEqual(debugLogs, [
    `Internal problem encountered with playlist ${playlists[0].id}. browser does not support codec(s): "hvc1". Switching to playlist ${playlists[1].id}.`,
    `Internal problem encountered with playlist ${playlists[1].id}. browser does not support codec(s): "ac-3". Switching to playlist ${playlists[2].id}.`
  ], 'debug log as expected');

  window.MediaSource.isTypeSupported = oldIsTypeSupported;
});

QUnit.test('blacklists ts playlists by muxer support', function(assert) {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  const playlistString =
    '#EXTM3U\n' +
    // video not supported
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="hvc1,mp4a.40.2"\n' +
    'media.m3u8\n' +
    // audio not supported
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,ac-3"\n' +
    'media.m3u8\n' +
    // supported!
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.2"\n' +
    'media1.m3u8\n';

  // master
  this.requests.shift().respond(200, null, playlistString);

  // media
  this.standardXHRResponse(this.requests.shift());

  const mpc = this.player.tech_.vhs.masterPlaylistController_;
  const playlistLoader = mpc.masterPlaylistLoader_;
  const loader = mpc.mainSegmentLoader_;
  const master = this.player.tech_.vhs.playlists.master;

  let debugLogs = [];

  mpc.logger_ = (...logs) => {
    debugLogs = debugLogs.concat(logs);
  };

  const playlists = master.playlists;

  playlistLoader.media = () => playlists[0];
  loader.mainStartingMedia_ = playlists[0];
  loader.currentMediaInfo_ = {hasVideo: true, hasAudio: true};
  loader.trigger('trackinfo');

  playlistLoader.media = () => playlists[1];
  loader.mainStartingMedia_ = playlists[1];
  loader.currentMediaInfo_ = {hasVideo: true, hasAudio: true};
  loader.trigger('trackinfo');

  playlistLoader.media = () => playlists[2];
  loader.mainStartingMedia_ = playlists[2];
  loader.currentMediaInfo_ = {hasVideo: true, hasAudio: true};
  loader.trigger('trackinfo');

  assert.strictEqual(playlists.length, 3, 'three playlists total');
  assert.strictEqual(playlists[0].excludeUntil, Infinity, 'blacklisted first playlist');
  assert.strictEqual(playlists[1].excludeUntil, Infinity, 'blacklisted second playlist');
  assert.strictEqual(typeof playlists[2].excludeUntil, 'undefined', 'did not blacklist third playlist');
  assert.deepEqual(debugLogs, [
    `Internal problem encountered with playlist ${playlists[0].id}. muxer does not support codec(s): "hvc1". Switching to playlist ${playlists[1].id}.`,
    `Internal problem encountered with playlist ${playlists[1].id}. muxer does not support codec(s): "ac-3". Switching to playlist ${playlists[2].id}.`
  ], 'debug log as expected');

});

QUnit.test('cancels outstanding XHRs when seeking', function(assert) {
  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.standardXHRResponse(this.requests[0]);
  this.player.tech_.vhs.media = {
    segments: [{
      uri: '0.ts',
      duration: 10
    }, {
      uri: '1.ts',
      duration: 10
    }]
  };

  // attempt to seek while the download is in progress
  this.player.currentTime(7);
  this.clock.tick(2);

  assert.ok(this.requests[1].aborted, 'XHR aborted');
  assert.strictEqual(this.requests.length, 3, 'opened new XHR');
});

QUnit.test('does not abort segment loading for in-buffer seeking', function(assert) {
  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.standardXHRResponse(this.requests.shift());
  this.player.tech_.buffered = function() {
    return videojs.createTimeRange(0, 20);
  };

  this.player.tech_.setCurrentTime(11);
  this.clock.tick(1);
  assert.equal(this.requests.length, 1, 'did not abort the outstanding request');
});

QUnit.test('unsupported playlist should not be re-included when excluding last playlist', function(assert) {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.player.tech_.vhs.bandwidth = 1;
  // master
  this.requests.shift()
    .respond(
      200, null,
      '#EXTM3U\n' +
             '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.2"\n' +
             'media.m3u8\n' +
             '#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400d,not-an-audio-codec"\n' +
             'media1.m3u8\n'
    );
  // media
  this.standardXHRResponse(this.requests.shift());

  const master = this.player.tech_.vhs.playlists.master;
  const media = this.player.tech_.vhs.playlists.media_;
  const mpc = this.player.tech_.vhs.masterPlaylistController_;

  return requestAndAppendSegment({
    request: this.requests.shift(),
    mediaSource: mpc.mediaSource,
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock
  }).then(() => {
    assert.strictEqual(
      master.playlists[1].excludeUntil,
      Infinity,
      'blacklisted invalid audio codec'
    );
    const requri = this.requests[0].uri;

    this.requests.shift().respond(400);

    assert.ok(master.playlists[0].excludeUntil > 0, 'original media excluded for some time');
    assert.strictEqual(
      master.playlists[1].excludeUntil,
      Infinity,
      'audio codec still blacklisted'
    );

    assert.equal(this.env.log.warn.calls, 1, 'warning logged for blacklist');
    assert.equal(
      this.env.log.warn.args[0][0],
      `Problem encountered with playlist ${master.playlists[0].id}. HLS request errored at URL: ${requri} Switching to playlist 0-media.m3u8.`,
      'log generic error message'
    );
  });
});

QUnit.test('segment 404 should trigger blacklisting of media', function(assert) {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.player.tech_.vhs.bandwidth = 20000;
  // master
  this.standardXHRResponse(this.requests[0]);
  // media
  this.standardXHRResponse(this.requests[1]);

  const media = this.player.tech_.vhs.playlists.media_;

  // segment
  this.requests[2].respond(400);
  assert.ok(media.excludeUntil > 0, 'original media blacklisted for some time');
  assert.equal(this.env.log.warn.calls, 1, 'warning logged for blacklist');

  // verify stats
  assert.equal(this.player.tech_.vhs.stats.bandwidth, 20000, 'bandwidth set above');
});

QUnit.test('playlist 404 should blacklist media', function(assert) {
  let media;
  let url;
  let index;
  let blacklistplaylist = 0;
  let retryplaylist = 0;
  let vhsRenditionBlacklistedEvents = 0;
  let hlsRenditionBlacklistedEvents = 0;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.player.tech_.on('blacklistplaylist', () => blacklistplaylist++);
  this.player.tech_.on('retryplaylist', () => retryplaylist++);
  this.player.tech_.on('usage', (event) => {
    if (event.name === 'vhs-rendition-blacklisted') {
      vhsRenditionBlacklistedEvents++;
    }
    if (event.name === 'hls-rendition-blacklisted') {
      hlsRenditionBlacklistedEvents++;
    }
  });

  this.player.tech_.vhs.bandwidth = 1e10;
  // master
  this.requests[0].respond(
    200, null,
    '#EXTM3U\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=1000\n' +
                           'media.m3u8\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
                           'media1.m3u8\n'
  );
  assert.equal(
    typeof this.player.tech_.vhs.playlists.media_,
    'undefined',
    'no media is initially set'
  );

  assert.equal(blacklistplaylist, 0, 'there is no blacklisted playlist');
  assert.equal(
    vhsRenditionBlacklistedEvents,
    0,
    'no vhs-rendition-blacklisted event was fired'
  );
  assert.equal(
    hlsRenditionBlacklistedEvents,
    0,
    'no hls-rendition-blacklisted event was fired'
  );
  // media
  this.requests[1].respond(404);
  url = this.requests[1].url.slice(this.requests[1].url.lastIndexOf('/') + 1);

  if (url === 'media.m3u8') {
    index = 0;
  } else {
    index = 1;
  }
  media = this.player.tech_.vhs.playlists.master.playlists[createPlaylistID(index, url)];

  assert.ok(media.excludeUntil > 0, 'original media blacklisted for some time');
  assert.equal(this.env.log.warn.calls, 1, 'warning logged for blacklist');
  assert.equal(
    this.env.log.warn.args[0],
    `Problem encountered with playlist ${media.id}. HLS playlist request error at URL: media.m3u8. Switching to playlist 1-media1.m3u8.`,
    'log generic error message'
  );
  assert.equal(blacklistplaylist, 1, 'there is one blacklisted playlist');
  assert.equal(
    vhsRenditionBlacklistedEvents,
    1,
    'a vhs-rendition-blacklisted event was fired'
  );
  assert.equal(
    hlsRenditionBlacklistedEvents,
    1,
    'an hls-rendition-blacklisted event was fired'
  );
  assert.equal(retryplaylist, 0, 'haven\'t retried any playlist');

  // request for the final available media
  this.requests[2].respond(404);
  url = this.requests[2].url.slice(this.requests[2].url.lastIndexOf('/') + 1);
  if (url === 'media.m3u8') {
    index = 0;
  } else {
    index = 1;
  }

  media = this.player.tech_.vhs.playlists.master.playlists[createPlaylistID(index, url)];

  assert.ok(media.excludeUntil > 0, 'second media was blacklisted after playlist 404');
  assert.equal(this.env.log.warn.calls, 2, 'warning logged for blacklist');
  assert.equal(
    this.env.log.warn.args[1],
    'Removing other playlists from the exclusion list because the last rendition is about to be excluded.',
    'log generic error message'
  );
  assert.equal(
    this.env.log.warn.args[2],
    `Problem encountered with playlist ${media.id}. HLS playlist request error at URL: media1.m3u8. ` +
              'Switching to playlist 0-media.m3u8.',
    'log generic error message'
  );
  assert.equal(retryplaylist, 1, 'fired a retryplaylist event');
  assert.equal(blacklistplaylist, 2, 'media1 is blacklisted');

  this.clock.tick(2 * 1000);
  // no new request was made since it hasn't been half the segment duration
  assert.strictEqual(3, this.requests.length, 'no new request was made');

  this.clock.tick(3 * 1000);
  // loading the first playlist since the blacklist duration was cleared
  // when half the segment duaration passed

  assert.strictEqual(4, this.requests.length, 'one more request was made');
  url = this.requests[3].url.slice(this.requests[3].url.lastIndexOf('/') + 1);
  if (url === 'media.m3u8') {
    index = 0;
  } else {
    index = 1;
  }
  media = this.player.tech_.vhs.playlists.master.playlists[createPlaylistID(index, url)];

  // the first media was unblacklisted after a refresh delay
  assert.ok(!media.excludeUntil, 'removed first media from blacklist');

  assert.strictEqual(
    this.requests[3].url,
    absoluteUrl('manifest/media.m3u8'),
    'media playlist requested'
  );

  // verify stats
  assert.equal(this.player.tech_.vhs.stats.bandwidth, 1e10, 'bandwidth set above');
});

QUnit.test('blacklists playlist if it has stopped being updated', function(assert) {
  let playliststuck = 0;

  this.player.src({
    src: 'master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.tech_.triggerReady();

  this.standardXHRResponse(this.requests.shift());

  this.player.tech_.vhs.masterPlaylistController_.seekable = function() {
    return videojs.createTimeRange(90, 130);
  };
  this.player.tech_.setCurrentTime(170);
  this.player.tech_.buffered = function() {
    return videojs.createTimeRange(0, 170);
  };
  Vhs.Playlist.playlistEnd = function() {
    return 170;
  };

  this.player.tech_.on('playliststuck', () => playliststuck++);
  this.requests.shift().respond(
    200, null,
    '#EXTM3U\n' +
                           '#EXT-X-MEDIA-SEQUENCE:16\n' +
                           '#EXTINF:10,\n' +
                           '16.ts\n'
  );

  assert.ok(
    !this.player.tech_.vhs.playlists.media().excludeUntil,
    'playlist was not blacklisted'
  );
  assert.equal(this.env.log.warn.calls, 0, 'no warning logged for blacklist');
  assert.equal(playliststuck, 0, 'there is no stuck playlist');

  this.player.tech_.trigger('play');
  this.player.tech_.trigger('playing');
  // trigger a refresh
  this.clock.tick(10 * 1000);

  this.requests.shift().respond(
    200, null,
    '#EXTM3U\n' +
                           '#EXT-X-MEDIA-SEQUENCE:16\n' +
                           '#EXTINF:10,\n' +
                           '16.ts\n'
  );

  const media = this.player.tech_.vhs.playlists.media();

  assert.ok(
    media.excludeUntil > 0,
    'playlist blacklisted for some time'
  );
  assert.equal(this.env.log.warn.calls, 1, 'warning logged for blacklist');
  assert.equal(
    this.env.log.warn.args[0],
    `Problem encountered with playlist ${media.id}. ` +
                'Playlist no longer updating. Switching to playlist 0-media.m3u8.',
    'log specific error message for not updated playlist'
  );
  assert.equal(playliststuck, 1, 'there is one stuck playlist');
});

QUnit.test('never blacklist the playlist if it is the only playlist', function(assert) {
  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  this.requests.shift().respond(
    200, null,
    '#EXTM3U\n' +
                                '#EXTINF:10,\n' +
                                '0.ts\n'
  );

  this.clock.tick(10 * 1000);
  this.requests.shift().respond(404);
  const media = this.player.tech_.vhs.playlists.media();

  // media wasn't blacklisted because it's the only rendition
  assert.ok(!media.excludeUntil, 'media was not blacklisted after playlist 404');
  assert.equal(this.env.log.warn.calls, 1, 'warning logged for blacklist');
  assert.equal(
    this.env.log.warn.args[0],
    `Problem encountered with playlist ${media.id}. ` +
                'Trying again since it is the only playlist.',
    'log specific error message for the only playlist'
  );
});

QUnit.test(
  'error on the first playlist request does not trigger an error when there is master ' +
  'playlist with only one media playlist',
  function(assert) {
    this.player.src({
      src: 'manifest/master.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });
    openMediaSource(this.player, this.clock);

    this.requests[0]
      .respond(
        200, null,
        '#EXTM3U\n' +
              '#EXT-X-STREAM-INF:BANDWIDTH=1000\n' +
              'media.m3u8\n'
      );

    this.requests[1].respond(404);

    const url = this.requests[1].url.slice(this.requests[1].url.lastIndexOf('/') + 1);
    const media = this.player.tech_.vhs.playlists.master.playlists[createPlaylistID(0, url)];

    // media wasn't blacklisted because it's the only rendition
    assert.ok(!media.excludeUntil, 'media was not blacklisted after playlist 404');
    assert.equal(this.env.log.warn.calls, 1, 'warning logged for blacklist');
    assert.equal(
      this.env.log.warn.args[0],
      `Problem encountered with playlist ${media.id}. ` +
                'Trying again since it is the only playlist.',
      'log specific error message for the onlyplaylist'
    );
  }
);

QUnit.test('seeking in an empty playlist is a non-erroring noop', function(assert) {
  this.player.src({
    src: 'manifest/empty-live.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.requests.shift().respond(200, null, '#EXTM3U\n');

  const requestsLength = this.requests.length;

  this.player.tech_.setCurrentTime(183);
  this.clock.tick(1);

  assert.equal(this.requests.length, requestsLength, 'made no additional requests');
});

QUnit.test('fire loadedmetadata once we successfully load a playlist', function(assert) {
  let count = 0;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  const vhs = this.player.tech_.vhs;

  vhs.bandwidth = 20000;
  vhs.masterPlaylistController_.masterPlaylistLoader_.on('loadedmetadata', function() {
    count += 1;
  });
  // masters
  this.standardXHRResponse(this.requests.shift());
  assert.equal(
    count, 0,
    'loadedMedia not triggered before requesting playlist'
  );
  // media
  this.requests.shift().respond(404);
  assert.equal(
    count, 0,
    'loadedMedia not triggered after playlist 404'
  );
  assert.equal(this.env.log.warn.calls, 1, 'warning logged for blacklist');

  // media
  this.standardXHRResponse(this.requests.shift());
  assert.equal(
    count, 1,
    'loadedMedia triggered after successful recovery from 404'
  );

  // verify stats
  assert.equal(this.player.tech_.vhs.stats.bandwidth, 20000, 'bandwidth set above');
});

QUnit.test('sets seekable and duration for live playlists', function(assert) {
  this.player.src({
    src: 'http://example.com/manifest/missingEndlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

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

  assert.equal(this.player.tech(true).vhs.seekable().length, 1, 'set one seekable range');
  assert.equal(this.player.tech(true).vhs.seekable().start(0), 0, 'set seekable start');
  assert.equal(this.player.tech(true).vhs.seekable().end(0), 5, 'set seekable end');

  assert.strictEqual(
    this.player.tech(true).vhs.duration(),
    Infinity,
    'duration reported by VHS is infinite'
  );
  assert.strictEqual(
    this.player.tech(true).vhs.mediaSource.duration,
    this.player.tech(true).vhs.seekable().end(0),
    'duration on the mediaSource is seekable end'
  );
});

QUnit.test('live playlist starts with correct currentTime value', function(assert) {
  this.player.src({
    src: 'http://example.com/manifest/liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.standardXHRResponse(this.requests[0]);
  let currentTime = 0;

  this.player.tech_.setCurrentTime = (ct) => {
    currentTime = ct;
  };
  this.player.tech_.readyState = () => 4;
  this.player.tech_.vhs.playlists.trigger('loadedmetadata');

  this.player.tech_.paused = function() {
    return false;
  };
  this.player.tech_.trigger('play');
  this.clock.tick(1);

  const media = this.player.tech_.vhs.playlists.media();

  assert.strictEqual(
    currentTime,
    Vhs.Playlist.seekable(media).end(0),
    'currentTime is updated at playback'
  );
});

QUnit.test(
  'estimates seekable ranges for live streams that have been paused for a long time',
  function(assert) {
    this.player.src({
      src: 'http://example.com/manifest/liveStart30sBefore.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    this.clock.tick(1);

    openMediaSource(this.player, this.clock);

    this.standardXHRResponse(this.requests.shift());
    this.player.tech_.vhs.playlists.media().mediaSequence = 172;
    this.player.tech_.vhs.playlists.media().syncInfo = {
      mediaSequence: 130,
      time: 80
    };
    this.player.tech_.vhs.masterPlaylistController_.onSyncInfoUpdate_();
    assert.equal(
      this.player.seekable().start(0),
      500,
      'offset the seekable start'
    );
  }
);

QUnit.test('resets the time to the live point when resuming a live stream after a ' +
           'long break', function(assert) {
  let seekTarget;

  this.player.src({
    src: 'live0.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.requests.shift().respond(
    200, null,
    '#EXTM3U\n' +
                                '#EXT-X-MEDIA-SEQUENCE:16\n' +
                                '#EXTINF:10,\n' +
                                '16.ts\n'
  );
  // mock out the player to simulate a live stream that has been
  // playing for awhile
  this.player.tech_.vhs.seekable = function() {
    return videojs.createTimeRange(160, 170);
  };
  this.player.tech_.setCurrentTime = function(time) {
    if (typeof time !== 'undefined') {
      seekTarget = time;
    }
  };
  this.player.tech_.played = function() {
    return videojs.createTimeRange(120, 170);
  };
  this.player.tech_.trigger('playing');

  const seekable = this.player.seekable();

  this.player.tech_.trigger('play');
  assert.equal(seekTarget, seekable.end(seekable.length - 1), 'seeked to live point');
  this.player.tech_.trigger('seeked');
});

QUnit.test(
  'reloads out-of-date live playlists when switching variants',
  function(assert) {
    const oldManifest = testDataManifests['variant-update'];

    this.player.src({
      src: 'http://example.com/master.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    this.clock.tick(1);

    openMediaSource(this.player, this.clock);

    this.player.tech_.vhs.master = {
      playlists: [{
        mediaSequence: 15,
        segments: [1, 1, 1]
      }, {
        uri: 'http://example.com/variant-update.m3u8',
        mediaSequence: 0,
        segments: [1, 1]
      }]
    };
    // playing segment 15 on playlist zero
    this.player.tech_.vhs.media = this.player.tech_.vhs.master.playlists[0];
    this.player.mediaIndex = 1;

    testDataManifests['variant-update'] = '#EXTM3U\n' +
    '#EXT-X-MEDIA-SEQUENCE:16\n' +
    '#EXTINF:10,\n' +
    '16.ts\n' +
    '#EXTINF:10,\n' +
    '17.ts\n';

    // switch playlists
    this.player.tech_.vhs.selectPlaylist = function() {
      return this.player.tech_.vhs.master.playlists[1];
    };
    // timeupdate downloads segment 16 then switches playlists
    this.player.trigger('timeupdate');

    assert.strictEqual(this.player.mediaIndex, 1, 'mediaIndex points at the next segment');
    testDataManifests['variant-update'] = oldManifest;
  }
);

QUnit.test(
  'if withCredentials global option is used, withCredentials is set on the XHR object',
  function(assert) {
    const vhsOptions = videojs.options.vhs;

    this.player.dispose();
    videojs.options.vhs = {
      withCredentials: true
    };
    this.player.dispose();
    this.player = createPlayer();
    this.player.src({
      src: 'http://example.com/media.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    this.clock.tick(1);

    openMediaSource(this.player, this.clock);
    assert.ok(
      this.requests[0].withCredentials,
      'with credentials should be set to true if that option is passed in'
    );
    videojs.options.vhs = vhsOptions;
  }
);

QUnit.test('if handleManifestRedirects global option is used, it should be passed to PlaylistLoader', function(assert) {
  const vhsOptions = videojs.options.vhs;

  this.player.dispose();
  videojs.options.vhs = {
    handleManifestRedirects: true
  };
  this.player = createPlayer();
  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  assert.ok(
    this.player.tech_.vhs.masterPlaylistController_.masterPlaylistLoader_.handleManifestRedirects,
    'handleManifestRedirects is set correctly'
  );

  videojs.options.vhs = vhsOptions;
});

QUnit.test(
  'if handlePartialData global option is used, it is set on audio/main loader but not subtitle',
  function(assert) {
    const vhsOptions = videojs.options.vhs;

    this.player.dispose();
    videojs.options.vhs = {
      handlePartialData: true
    };
    this.player = createPlayer();
    this.player.src({
      src: 'http://example.com/media.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    this.clock.tick(1);

    openMediaSource(this.player, this.clock);
    const {mainSegmentLoader_, subtitleSegmentLoader_, audioSegmentLoader_} =
    this.player.tech(true).vhs.masterPlaylistController_;

    assert.equal(mainSegmentLoader_.handlePartialData_, true, 'is set on main');
    assert.equal(audioSegmentLoader_.handlePartialData_, true, 'is set on audio');
    assert.equal(subtitleSegmentLoader_.handlePartialData_, false, 'is not set on subtitle');
    videojs.options.vhs = vhsOptions;
  }
);

QUnit.test(
  'if handlePartialData source option is used, it is set on audio/main loader but not subtitle',
  function(assert) {
    const vhsOptions = videojs.options.vhs;

    this.player.dispose();
    this.player = createPlayer();
    this.player.src({
      src: 'http://example.com/media.m3u8',
      type: 'application/vnd.apple.mpegurl',
      handlePartialData: true
    });

    this.clock.tick(1);

    openMediaSource(this.player, this.clock);
    const {mainSegmentLoader_, subtitleSegmentLoader_, audioSegmentLoader_} =
    this.player.tech(true).vhs.masterPlaylistController_;

    assert.equal(mainSegmentLoader_.handlePartialData_, true, 'is set on main');
    assert.equal(audioSegmentLoader_.handlePartialData_, true, 'is set on audio');
    assert.equal(subtitleSegmentLoader_.handlePartialData_, false, 'is not set on subtitle');
    videojs.options.vhs = vhsOptions;
  }
);

QUnit.test('the handlePartialData source option overrides the global default', function(assert) {
  const vhsOptions = videojs.options.vhs;

  this.player.dispose();
  videojs.options.vhs = {
    handlePartialData: true
  };
  this.player = createPlayer();
  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl',
    handlePartialData: false
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  const {mainSegmentLoader_, subtitleSegmentLoader_, audioSegmentLoader_} =
    this.player.tech(true).vhs.masterPlaylistController_;

  assert.equal(mainSegmentLoader_.handlePartialData_, false, 'is set on main');
  assert.equal(audioSegmentLoader_.handlePartialData_, false, 'is set on audio');
  assert.equal(subtitleSegmentLoader_.handlePartialData_, false, 'is not set on subtitle');
  videojs.options.vhs = vhsOptions;
});

QUnit.test('the handleManifestRedirects source option overrides the global default', function(assert) {
  const vhsOptions = videojs.options.vhs;

  this.player.dispose();
  videojs.options.vhs = {
    handleManifestRedirects: true
  };
  this.player = createPlayer();
  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl',
    handleManifestRedirects: false
  });

  this.clock.tick(1);

  assert.notOk(
    this.player.tech_.vhs.masterPlaylistController_.masterPlaylistLoader_.handleManifestRedirects,
    'handleManifestRedirects is set correctly'
  );

  videojs.options.vhs = vhsOptions;
});

QUnit.test('if handleManifestRedirects global option is used, it should be passed to DashPlaylistLoader', function(assert) {
  const vhsOptions = videojs.options.vhs;

  this.player.dispose();
  videojs.options.vhs = {
    handleManifestRedirects: true
  };
  this.player = createPlayer();
  this.player.src({
    src: 'http://example.com/media.mpd',
    type: 'application/dash+xml'
  });

  this.clock.tick(1);

  assert.ok(this.player.tech_.vhs.masterPlaylistController_.masterPlaylistLoader_.handleManifestRedirects);

  videojs.options.vhs = vhsOptions;
});

QUnit.test('the handleManifestRedirects in DashPlaylistLoader option overrides the global default', function(assert) {
  const vhsOptions = videojs.options.vhs;

  this.player.dispose();
  videojs.options.vhs = {
    handleManifestRedirects: true
  };
  this.player = createPlayer();
  this.player.src({
    src: 'http://example.com/media.mpd',
    type: 'application/dash+xml',
    handleManifestRedirects: false
  });

  this.clock.tick(1);

  assert.notOk(this.player.tech_.vhs.masterPlaylistController_.masterPlaylistLoader_.handleManifestRedirects);

  videojs.options.vhs = vhsOptions;
});

QUnit.test('the withCredentials option overrides the global default', function(assert) {
  const vhsOptions = videojs.options.vhs;

  this.player.dispose();
  videojs.options.vhs = {
    withCredentials: true
  };
  this.player = createPlayer();
  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl',
    withCredentials: false
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  assert.ok(
    !this.requests[0].withCredentials,
    'with credentials should be set to false if if overrode global option'
  );
  videojs.options.vhs = vhsOptions;
});

QUnit.test('playlist blacklisting duration is set through options', function(assert) {
  const vhsOptions = videojs.options.vhs;

  this.player.dispose();
  videojs.options.vhs = {
    blacklistDuration: 3 * 60
  };
  this.player = createPlayer();
  this.player.src({
    src: 'http://example.com/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.player.tech_.triggerReady();
  openMediaSource(this.player, this.clock);
  this.requests[0].respond(
    200, null,
    '#EXTM3U\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=1000\n' +
                           'media.m3u8\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
                           'media1.m3u8\n'
  );
  this.requests[1].respond(404);
  // media
  const url = this.requests[1].url.slice(this.requests[1].url.lastIndexOf('/') + 1);
  let index;

  if (url === 'media.m3u8') {
    index = 0;
  } else {
    index = 1;
  }
  const media = this.player.tech_.vhs.playlists.master.playlists[createPlaylistID(index, url)];

  assert.ok(media.excludeUntil > 0, 'original media blacklisted for some time');
  assert.equal(this.env.log.warn.calls, 1, 'warning logged for blacklist');
  assert.equal(
    this.env.log.warn.args[0],
    `Problem encountered with playlist ${media.id}. ` +
                'HLS playlist request error at URL: media.m3u8. ' +
                'Switching to playlist 1-media1.m3u8.',
    'log generic error message'
  );

  // this takes one millisecond
  this.standardXHRResponse(this.requests[2]);

  this.clock.tick(2 * 60 * 1000 - 1);
  assert.ok(media.excludeUntil - Date.now() > 0, 'original media still be blacklisted');

  this.clock.tick(1 * 60 * 1000);
  assert.equal(
    media.excludeUntil,
    Date.now(),
    'media\'s exclude time reach to the current time'
  );

  videojs.options.vhs = vhsOptions;
});

QUnit.test('respects bandwidth option of 0', function(assert) {
  this.player.dispose();
  this.player = createPlayer({ html5: { vhs: { bandwidth: 0 } } });

  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  assert.equal(this.player.tech_.vhs.bandwidth, 0, 'set bandwidth to 0');
});

QUnit.test(
  'uses default bandwidth option if non-numerical value provided',
  function(assert) {
    this.player.dispose();
    this.player = createPlayer({ html5: { vhs: { bandwidth: 'garbage' } } });

    this.player.src({
      src: 'http://example.com/media.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    this.clock.tick(1);

    openMediaSource(this.player, this.clock);
    assert.equal(this.player.tech_.vhs.bandwidth, 4194304, 'set bandwidth to default');
  }
);

QUnit.test('uses default bandwidth if browser is Android', function(assert) {
  this.player.dispose();

  const origIsAndroid = videojs.browser.IS_ANDROID;

  videojs.browser.IS_ANDROID = false;

  this.player = createPlayer();
  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  assert.equal(
    this.player.tech_.vhs.bandwidth,
    4194304,
    'set bandwidth to desktop default'
  );

  this.player.dispose();

  videojs.browser.IS_ANDROID = true;

  this.player = createPlayer();
  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  assert.equal(
    this.player.tech_.vhs.bandwidth,
    4194304,
    'set bandwidth to mobile default'
  );

  videojs.browser.IS_ANDROID = origIsAndroid;
});

QUnit.test('does not break if the playlist has no segments', function(assert) {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  try {
    openMediaSource(this.player, this.clock);
    this.requests[0].respond(
      200, null,
      '#EXTM3U\n' +
                        '#EXT-X-PLAYLIST-TYPE:VOD\n' +
                        '#EXT-X-TARGETDURATION:10\n'
    );
  } catch (e) {
    assert.ok(false, 'an error was thrown');
    throw e;
  }
  assert.ok(true, 'no error was thrown');
  assert.strictEqual(
    this.requests.length,
    1,
    'no this.requestsfor non-existent segments were queued'
  );
});

QUnit.test('can seek before the source buffer opens', function(assert) {
  this.player.src({
    src: 'media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.player.tech_.triggerReady();
  this.clock.tick(1);
  this.standardXHRResponse(this.requests.shift());
  this.player.triggerReady();

  this.player.currentTime(1);
  assert.equal(this.player.currentTime(), 1, 'seeked');
});

QUnit.test('resets the switching algorithm if a request times out', function(assert) {
  this.player.src({
    src: 'master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.player.tech_.vhs.bandwidth = 1e20;

  // master
  this.standardXHRResponse(this.requests.shift());
  // media.m3u8
  this.standardXHRResponse(this.requests.shift());

  const segmentRequest = this.requests.shift();

  assert.notOk(segmentRequest.timedout, 'request not timed out');
  // simulate a segment timeout
  this.clock.tick(45001);
  assert.ok(segmentRequest.timedout, 'request timed out');

  // new media
  this.standardXHRResponse(this.requests.shift());

  assert.strictEqual(
    this.player.tech_.vhs.playlists.media(),
    this.player.tech_.vhs.playlists.master.playlists[1],
    'reset to the lowest bitrate playlist'
  );

  // verify stats
  assert.equal(this.player.tech_.vhs.stats.bandwidth, 1, 'bandwidth is reset too');
});

QUnit.test('disposes the playlist loader', function(assert) {
  let disposes = 0;

  const player = createPlayer();

  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(player, this.clock);
  const loaderDispose = player.tech_.vhs.playlists.dispose;

  player.tech_.vhs.playlists.dispose = function() {
    disposes++;
    loaderDispose.call(player.tech_.vhs.playlists);
  };

  player.dispose();
  assert.strictEqual(disposes, 1, 'disposed playlist loader');
});

QUnit.test('remove event handlers on dispose', function(assert) {
  let unscoped = 0;

  const player = createPlayer();

  const origPlayerOn = player.on.bind(player);
  const origPlayerOff = player.off.bind(player);

  player.on = function(...args) {
    if (typeof args[0] !== 'object') {
      unscoped++;
    }
    origPlayerOn(...args);
  };
  player.off = function(...args) {
    if (typeof args[0] !== 'object') {
      unscoped--;
    }
    origPlayerOff(...args);
  };
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(player, this.clock);

  this.standardXHRResponse(this.requests[0]);
  this.standardXHRResponse(this.requests[1]);

  assert.ok(unscoped > 0, 'has unscoped handlers');

  player.dispose();

  assert.ok(unscoped <= 0, 'no unscoped handlers');
});

QUnit.test('the source handler supports HLS mime types', function(assert) {
  assert.ok(VhsSourceHandler.canHandleSource({
    type: 'aPplicatiOn/x-MPegUrl'
  }), 'supports x-mpegurl');
  assert.ok(VhsSourceHandler.canHandleSource({
    type: 'aPplicatiOn/VnD.aPPle.MpEgUrL'
  }), 'supports vnd.apple.mpegurl');
  assert.ok(
    VhsSourceHandler.canPlayType('aPplicatiOn/VnD.aPPle.MpEgUrL'),
    'supports vnd.apple.mpegurl'
  );
  assert.ok(
    VhsSourceHandler.canPlayType('aPplicatiOn/x-MPegUrl'),
    'supports x-mpegurl'
  );
});

QUnit.test('the source handler supports DASH mime types', function(assert) {
  assert.ok(VhsSourceHandler.canHandleSource({
    type: 'aPplication/dAsh+xMl'
  }), 'supports application/dash+xml');
  assert.ok(
    VhsSourceHandler.canPlayType('aPpLicAtion/DaSh+XmL'),
    'supports application/dash+xml'
  );
});

QUnit.test(
  'the source handler does not support non HLS/DASH mime types',
  function(assert) {
    assert.ok(!(VhsSourceHandler.canHandleSource({
      type: 'video/mp4'
    }) instanceof VhsHandler), 'does not support mp4');
    assert.ok(!(VhsSourceHandler.canHandleSource({
      type: 'video/x-flv'
    }) instanceof VhsHandler), 'does not support flv');
    assert.ok(
      !(VhsSourceHandler.canPlayType('video/mp4')),
      'does not support mp4'
    );
    assert.ok(
      !(VhsSourceHandler.canPlayType('video/x-flv')),
      'does not support flv'
    );
  }
);

QUnit.test('has no effect if native HLS is available and browser is Safari', function(assert) {
  const Html5 = videojs.getTech('Html5');
  const oldHtml5CanPlaySource = Html5.canPlaySource;
  const origIsAnySafari = videojs.browser.IS_ANY_SAFARI;

  videojs.browser.IS_ANY_SAFARI = true;
  Html5.canPlaySource = () => true;
  Vhs.supportsNativeHls = true;
  const player = createPlayer();

  player.src({
    src: 'http://example.com/manifest/master.m3u8',
    type: 'application/x-mpegURL'
  });

  this.clock.tick(1);

  assert.ok(!player.tech_.vhs, 'did not load vhs tech');
  player.dispose();
  Html5.canPlaySource = oldHtml5CanPlaySource;
  videojs.browser.IS_ANY_SAFARI = origIsAnySafari;
});

QUnit.test('loads if native HLS is available but browser is not Safari', function(assert) {
  const Html5 = videojs.getTech('Html5');
  const oldHtml5CanPlaySource = Html5.canPlaySource;
  const origIsAnySafari = videojs.browser.IS_ANY_SAFARI;

  videojs.browser.IS_ANY_SAFARI = false;
  Html5.canPlaySource = () => true;
  Vhs.supportsNativeHls = true;
  const player = createPlayer();

  player.src({
    src: 'http://example.com/manifest/master.m3u8',
    type: 'application/x-mpegURL'
  });

  this.clock.tick(1);

  assert.ok(player.tech_.vhs, 'loaded VHS tech');
  player.dispose();
  Html5.canPlaySource = oldHtml5CanPlaySource;
  videojs.browser.IS_ANY_SAFARI = origIsAnySafari;
});

QUnit.test(
  'loads if native HLS is available and override is set locally',
  function(assert) {
    let player;

    Vhs.supportsNativeHls = true;
    player = createPlayer({html5: {vhs: {overrideNative: true}}});
    this.clock.tick(1);
    player.tech_.featuresNativeVideoTracks = true;
    player.src({
      src: 'http://example.com/manifest/master.m3u8',
      type: 'application/x-mpegURL'
    });
    this.clock.tick(1);

    assert.ok(player.tech_.vhs, 'did load vhs tech');
    player.dispose();

    player = createPlayer({html5: {vhs: {overrideNative: true}}});
    this.clock.tick(1);
    player.tech_.featuresNativeVideoTracks = false;
    player.tech_.featuresNativeAudioTracks = false;
    player.src({
      src: 'http://example.com/manifest/master.m3u8',
      type: 'application/x-mpegURL'
    });
    this.clock.tick(1);

    assert.ok(player.tech_.vhs, 'did load vhs tech');
    player.dispose();
  }
);

QUnit.test(
  'loads if native HLS is available and override is set globally',
  function(assert) {
    videojs.options.vhs.overrideNative = true;
    let player;

    Vhs.supportsNativeHls = true;
    player = createPlayer();
    player.tech_.featuresNativeVideoTracks = true;
    player.src({
      src: 'http://example.com/manifest/master.m3u8',
      type: 'application/x-mpegURL'
    });
    this.clock.tick(1);
    assert.ok(player.tech_.vhs, 'did load vhs tech');
    player.dispose();

    player = createPlayer();
    player.tech_.featuresNativeVideoTracks = false;
    player.tech_.featuresNativeAudioTracks = false;
    player.src({
      src: 'http://example.com/manifest/master.m3u8',
      type: 'application/x-mpegURL'
    });

    this.clock.tick(1);

    assert.ok(player.tech_.vhs, 'did load vhs tech');
    player.dispose();
  }
);

QUnit.test('re-emits mediachange events', function(assert) {
  let mediaChanges = 0;

  this.player.on('mediachange', function() {
    mediaChanges++;
  });

  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.standardXHRResponse(this.requests.shift());

  this.player.tech_.vhs.playlists.trigger('mediachange');
  assert.strictEqual(mediaChanges, 1, 'fired mediachange');
});

QUnit.test('can be disposed before finishing initialization', function(assert) {
  const readyHandlers = [];

  this.player.ready = function(callback) {
    readyHandlers.push(callback);
  };
  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);
  readyHandlers.shift().call(this.player);

  this.player.src({
    src: 'http://example.com/media.mp4',
    type: 'video/mp4'
  });

  assert.ok(readyHandlers.length > 0, 'registered a ready handler');
  try {
    while (readyHandlers.length) {
      readyHandlers.shift().call(this.player);
      openMediaSource(this.player, this.clock);
    }
    assert.ok(true, 'did not throw an exception');
  } catch (e) {
    assert.ok(false, 'threw an exception');
  }
});

QUnit.test('calling play() at the end of a video replays', function(assert) {
  const done = assert.async();
  let seekTime = -1;

  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.player.tech_.setCurrentTime = function(time) {
    if (typeof time !== 'undefined') {
      seekTime = time;
    }
    return 0;
  };
  this.requests.shift().respond(
    200, null,
    '#EXTM3U\n' +
                                '#EXTINF:10,\n' +
                                '0.ts\n' +
                                '#EXT-X-ENDLIST\n'
  );
  this.clock.tick(1);

  const segment = muxedSegment();
  // copy the byte length since the segment bytes get cleared out
  const segmentByteLength = segment.byteLength;

  assert.ok(segmentByteLength, 'the segment has some number of bytes');

  // segment 0
  this.standardXHRResponse(this.requests.shift(), segment);

  this.player.tech(true).vhs.masterPlaylistController_.mainSegmentLoader_.one('appending', () => {
    this.player.tech_.ended = function() {
      return true;
    };

    this.player.tech_.trigger('play');
    this.clock.tick(1);
    assert.equal(seekTime, 0, 'seeked to the beginning');

    // verify stats
    assert.equal(
      this.player.tech_.vhs.stats.mediaBytesTransferred,
      segmentByteLength,
      'transferred segment bytes'
    );
    assert.equal(this.player.tech_.vhs.stats.mediaRequests, 1, '1 request');
    done();
  });
});

QUnit.test('keys are resolved relative to the master playlist', function(assert) {
  this.player.src({
    src: 'video/master-encrypted.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.requests.shift().respond(
    200, null,
    '#EXTM3U\n' +
                                '#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=17\n' +
                                'playlist/playlist.m3u8\n' +
                                '#EXT-X-ENDLIST\n'
  );
  this.clock.tick(1);

  this.requests.shift().respond(
    200, null,
    '#EXTM3U\n' +
                                '#EXT-X-TARGETDURATION:15\n' +
                                '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.php"\n' +
                                '#EXTINF:2.833,\n' +
                                'http://media.example.com/fileSequence1.ts\n' +
                                '#EXT-X-ENDLIST\n'
  );
  this.clock.tick(1);

  assert.equal(this.requests.length, 2, 'requested the key');
  assert.equal(
    this.requests[0].url,
    absoluteUrl('video/playlist/keys/key.php'),
    'resolves multiple relative paths'
  );

  // verify stats
  assert.equal(this.player.tech_.vhs.stats.bandwidth, 4194304, 'default');
});

QUnit.test('keys are resolved relative to their containing playlist', function(assert) {
  this.player.src({
    src: 'video/media-encrypted.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.requests.shift().respond(
    200, null,
    '#EXTM3U\n' +
                                '#EXT-X-TARGETDURATION:15\n' +
                                '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.php"\n' +
                                '#EXTINF:2.833,\n' +
                                'http://media.example.com/fileSequence1.ts\n' +
                                '#EXT-X-ENDLIST\n'
  );
  this.clock.tick(1);

  assert.equal(this.requests.length, 2, 'requested a key');
  assert.equal(
    this.requests[0].url,
    absoluteUrl('video/keys/key.php'),
    'resolves multiple relative paths'
  );
});

QUnit.test('keys are not requested when cached key available, cacheEncryptionKeys:true', function(assert) {
  this.player.src({
    src: 'video/media-encrypted.m3u8',
    type: 'application/vnd.apple.mpegurl',
    cacheEncryptionKeys: true
  });
  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.requests.shift().respond(
    200, null,
    '#EXTM3U\n' +
    '#EXT-X-TARGETDURATION:15\n' +
    '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.php",IV=0x00000000000000000000000000000000\n' +
    '#EXTINF:2.833,\n' +
    'http://media.example.com/fileSequence1.ts\n' +
    '#EXTINF:2.833,\n' +
    'http://media.example.com/fileSequence2.ts\n' +
    '#EXT-X-ENDLIST\n'
  );
  this.clock.tick(1);

  assert.equal(this.requests.length, 2, 'requested a key');
  assert.equal(
    this.requests[0].url,
    absoluteUrl('video/keys/key.php'),
    'requested the key'
  );
  assert.equal(
    this.requests[1].url,
    'http://media.example.com/fileSequence1.ts',
    'requested the segment'
  );

  // key response
  this.standardXHRResponse(this.requests.shift(), encryptionKey());

  const mpc = this.player.tech_.vhs.masterPlaylistController_;

  return requestAndAppendSegment({
    request: this.requests.shift(),
    mediaSource: mpc.mediaSource,
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock,
    segment: encryptedSegment()
  }).then(() => {
    assert.equal(this.requests.length, 1, 'requested a segment, not a key');
    assert.equal(
      this.requests[0].url,
      absoluteUrl('http://media.example.com/fileSequence2.ts'),
      'requested the segment only'
    );
  });
});

QUnit.test('keys are requested per segment, cacheEncryptionKeys:false', function(assert) {
  this.player.src({
    src: 'video/media-encrypted.m3u8',
    type: 'application/vnd.apple.mpegurl',
    cacheEncryptionKeys: false
  });
  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.requests.shift().respond(
    200, null,
    '#EXTM3U\n' +
    '#EXT-X-TARGETDURATION:15\n' +
    '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.php",IV=0x00000000000000000000000000000000\n' +
    '#EXTINF:2.833,\n' +
    'http://media.example.com/fileSequence1.ts\n' +
    '#EXTINF:2.833,\n' +
    'http://media.example.com/fileSequence2.ts\n' +
    '#EXT-X-ENDLIST\n'
  );
  this.clock.tick(1);

  assert.equal(this.requests.length, 2, 'requested a key');
  assert.equal(
    this.requests[0].url,
    absoluteUrl('video/keys/key.php'),
    'requested the key'
  );
  assert.equal(
    this.requests[1].url,
    'http://media.example.com/fileSequence1.ts',
    'requested the segment'
  );

  // key response
  this.standardXHRResponse(this.requests.shift(), encryptionKey());

  const mpc = this.player.tech_.vhs.masterPlaylistController_;

  return requestAndAppendSegment({
    request: this.requests.shift(),
    mediaSource: mpc.mediaSource,
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock,
    segment: encryptedSegment()
  }).then(() => {
    assert.equal(this.requests.length, 2, 'requested a segment and a key');
    assert.equal(
      this.requests[0].url,
      absoluteUrl('video/keys/key.php'),
      'requested the segment only'
    );
    assert.equal(
      this.requests[1].url,
      'http://media.example.com/fileSequence2.ts',
      'requested the segment'
    );
  });
});

QUnit.test(
  'seeking should abort an outstanding key request and create a new one',
  function(assert) {
    this.player.src({
      src: 'https://example.com/encrypted.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    this.clock.tick(1);

    openMediaSource(this.player, this.clock);

    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
                                '#EXT-X-TARGETDURATION:15\n' +
                                '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.php"\n' +
                                '#EXTINF:9,\n' +
                                'http://media.example.com/fileSequence1.ts\n' +
                                '#EXT-X-KEY:METHOD=AES-128,URI="keys/key2.php"\n' +
                                '#EXTINF:9,\n' +
                                'http://media.example.com/fileSequence2.ts\n' +
                                '#EXT-X-ENDLIST\n'
    );
    this.clock.tick(1);

    // segment 1
    this.standardXHRResponse(this.requests.pop());

    this.player.currentTime(11);
    this.clock.tick(2);
    assert.ok(this.requests[0].aborted, 'the key XHR should be aborted');
    // aborted key 1
    this.requests.shift();

    assert.equal(this.requests.length, 2, 'requested the new key');
    assert.equal(
      this.requests[0].url,
      'https://example.com/' +
               this.player.tech_.vhs.playlists.media().segments[1].key.uri,
      'urls should match'
    );
  }
);

QUnit.test('switching playlists with an outstanding key request aborts request and ' +
           'loads segment', function(assert) {
  const media = '#EXTM3U\n' +
      '#EXT-X-MEDIA-SEQUENCE:5\n' +
      '#EXT-X-KEY:METHOD=AES-128,URI="https://priv.example.com/key.php?r=52"\n' +
      '#EXTINF:2.833,\n' +
      'http://media.example.com/fileSequence52-A.ts\n' +
      '#EXTINF:15.0,\n' +
      'http://media.example.com/fileSequence52-B.ts\n' +
      '#EXT-X-ENDLIST\n';

  this.player.src({
    src: 'https://example.com/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.player.tech_.trigger('play');
  this.clock.tick(1);

  // master playlist
  this.standardXHRResponse(this.requests.shift());
  // media playlist
  this.requests.shift().respond(200, null, media);
  this.clock.tick(1);

  // first segment of the original media playlist
  this.standardXHRResponse(this.requests.pop());

  assert.equal(this.requests.length, 1, 'key request only one outstanding');
  const keyXhr = this.requests.shift();

  assert.ok(!keyXhr.aborted, 'key request outstanding');

  this.player.tech_.vhs.playlists.trigger('mediachanging');
  this.player.tech_.vhs.playlists.trigger('mediachange');
  this.clock.tick(1);

  assert.ok(keyXhr.aborted, 'key request aborted');
  assert.equal(this.requests.length, 2, 'loaded key and segment');
  assert.equal(
    this.requests[0].url,
    'https://priv.example.com/key.php?r=52',
    'requested the key'
  );
  assert.equal(
    this.requests[1].url,
    'http://media.example.com/fileSequence52-A.ts',
    'requested the segment'
  );
});

QUnit.test('does not download segments if preload option set to none', function(assert) {
  this.player.preload('none');
  this.player.src({
    src: 'master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());
  this.clock.tick(10 * 1000);

  this.requests = this.requests.filter(function(request) {
    return !(/m3u8$/).test(request.uri);
  });
  assert.equal(this.requests.length, 0, 'did not download any segments');

  // verify stats
  assert.equal(this.player.tech_.vhs.stats.bandwidth, 4194304, 'default');
});

// workaround https://bugzilla.mozilla.org/show_bug.cgi?id=548397
QUnit.test(
  'selectPlaylist does not fail if getComputedStyle returns null',
  function(assert) {
    const oldGetComputedStyle = window.getComputedStyle;

    window.getComputedStyle = function() {
      return null;
    };

    this.player.src({
      src: 'master.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    this.clock.tick(1);

    openMediaSource(this.player, this.clock);
    // master
    this.standardXHRResponse(this.requests.shift());
    // media
    this.standardXHRResponse(this.requests.shift());

    this.player.tech_.vhs.selectPlaylist();
    assert.ok(true, 'should not throw');
    window.getComputedStyle = oldGetComputedStyle;

    // verify stats
    assert.equal(this.player.tech_.vhs.stats.bandwidth, 4194304, 'default');
  }
);

QUnit.test('resolves relative key URLs against the playlist', function(assert) {
  this.player.src({
    src: 'https://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.requests.shift()
    .respond(
      200, null,
      '#EXTM3U\n' +
             '#EXT-X-MEDIA-SEQUENCE:5\n' +
             '#EXT-X-KEY:METHOD=AES-128,URI="key.php?r=52"\n' +
             '#EXTINF:2.833,\n' +
             'http://media.example.com/fileSequence52-A.ts\n' +
             '#EXT-X-ENDLIST\n'
    );
  this.clock.tick(1);

  assert.equal(
    this.requests[0].url,
    'https://example.com/key.php?r=52',
    'resolves the key URL'
  );
});

QUnit.test(
  'adds 1 default audio track if we have not parsed any and the playlist is loaded',
  function(assert) {
    this.player.src({
      src: 'manifest/master.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    this.clock.tick(1);

    assert.equal(this.player.audioTracks().length, 0, 'zero audio tracks at load time');

    openMediaSource(this.player, this.clock);

    // master
    this.standardXHRResponse(this.requests.shift());
    // media
    this.standardXHRResponse(this.requests.shift());

    assert.equal(this.player.audioTracks().length, 1, 'one audio track after load');
    assert.equal(this.player.audioTracks()[0].label, 'default', 'set the label');
  }
);

QUnit.test('adds audio tracks if we have parsed some from a playlist', function(assert) {
  this.player.src({
    src: 'manifest/multipleAudioGroups.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  assert.equal(this.player.audioTracks().length, 0, 'zero audio tracks at load time');

  openMediaSource(this.player, this.clock);

  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());
  const vjsAudioTracks = this.player.audioTracks();

  assert.equal(vjsAudioTracks.length, 3, '3 active vjs tracks');

  assert.equal(vjsAudioTracks[0].enabled, true, 'default track is enabled');

  vjsAudioTracks[1].enabled = true;
  assert.equal(vjsAudioTracks[1].enabled, true, 'new track is enabled on vjs');
  assert.equal(vjsAudioTracks[0].enabled, false, 'main track is disabled');
});

QUnit.test('cleans up the buffer when loading live segments', function(assert) {
  const seekable = videojs.createTimeRanges([[0, 70]]);

  this.player.src({
    src: 'liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.player.tech_.vhs.masterPlaylistController_.seekable = function() {
    return seekable;
  };

  this.player.tech_.vhs.bandwidth = 20e10;
  this.player.tech_.readyState = () => 4;
  this.player.tech_.triggerReady();
  // media
  this.standardXHRResponse(this.requests[0]);

  this.player.tech_.vhs.playlists.trigger('loadedmetadata');
  this.player.tech_.trigger('canplay');
  this.player.tech_.paused = function() {
    return false;
  };
  this.player.tech_.trigger('play');
  this.clock.tick(1);

  const mpc = this.player.tech_.vhs.masterPlaylistController_;

  const audioRemoves = [];
  const videoRemoves = [];

  // request first playable segment
  return requestAndAppendSegment({
    request: this.requests[1],
    mediaSource: mpc.mediaSource,
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock
  }).then(() => {

    const audioBuffer = mpc.sourceUpdater_.audioBuffer;
    const videoBuffer = mpc.sourceUpdater_.videoBuffer;
    const origAudioRemove = audioBuffer.remove.bind(audioBuffer);
    const origVideoRemove = videoBuffer.remove.bind(videoBuffer);

    audioBuffer.remove = (start, end) => {
      audioRemoves.push({start, end});
      origAudioRemove();
    };
    videoBuffer.remove = (start, end) => {
      videoRemoves.push({start, end});
      origVideoRemove();
    };

    // since source buffers are mocked, must fake that there's buffered data, or else we
    // don't bother processing removes
    audioBuffer.buffered = videojs.createTimeRanges([[10, 20]]);
    videoBuffer.buffered = videojs.createTimeRanges([[15, 25]]);

    // request second segment, and give enough time for the source buffer to process removes
    return requestAndAppendSegment({
      request: this.requests[2],
      mediaSource: mpc.mediaSource,
      segmentLoader: mpc.mainSegmentLoader_,
      clock: this.clock
    });
  }).then(() => {
    assert.equal(audioRemoves.length, 1, 'one audio remove');
    assert.equal(videoRemoves.length, 1, 'one video remove');
    // segment-loader removes at currentTime - 30
    assert.deepEqual(
      audioRemoves[0],
      { start: 0, end: 40 },
      'removed from audio buffer with right range'
    );
    assert.deepEqual(
      videoRemoves[0],
      { start: 0, end: 40 },
      'removed from video buffer with right range'
    );
  });
});

QUnit.test('cleans up buffer by removing targetDuration from currentTime when loading a ' +
           'live segment if seekable start is after currentTime', function(assert) {
  let seekable = videojs.createTimeRanges([[0, 80]]);

  this.player.src({
    src: 'liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.tech_.vhs.masterPlaylistController_.seekable = function() {
    return seekable;
  };

  this.player.tech_.readyState = () => 4;
  this.player.tech_.vhs.bandwidth = 20e10;
  this.player.tech_.triggerReady();
  // media
  this.standardXHRResponse(this.requests.shift());
  this.player.tech_.vhs.playlists.trigger('loadedmetadata');
  this.player.tech_.trigger('canplay');

  this.player.tech_.paused = function() {
    return false;
  };

  this.player.tech_.trigger('play');
  this.clock.tick(1);

  const mpc = this.player.tech_.vhs.masterPlaylistController_;
  const audioRemoves = [];
  const videoRemoves = [];

  // request first playable segment
  return requestAndAppendSegment({
    request: this.requests.shift(),
    mediaSource: mpc.mediaSource,
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock
  }).then(() => {

    // Change seekable so that it starts *after* the currentTime which was set
    // based on the previous seekable range (the end of 80)
    seekable = videojs.createTimeRanges([[110, 120]]);
    this.clock.tick(1);

    const audioBuffer = mpc.sourceUpdater_.audioBuffer;
    const videoBuffer = mpc.sourceUpdater_.videoBuffer;
    const origAudioRemove = audioBuffer.remove.bind(audioBuffer);
    const origVideoRemove = videoBuffer.remove.bind(videoBuffer);

    audioBuffer.remove = (start, end) => {
      audioRemoves.push({start, end});
      origAudioRemove();
    };
    videoBuffer.remove = (start, end) => {
      videoRemoves.push({start, end});
      origVideoRemove();
    };

    // since source buffers are mocked, must fake that there's buffered data, or else we
    // don't bother processing removes
    audioBuffer.buffered = videojs.createTimeRanges([[10, 20]]);
    videoBuffer.buffered = videojs.createTimeRanges([[15, 25]]);

    // prevent trying to correct live time
    disposePlaybackWatcher(this.player);

    // request second segment, and give enough time for the source buffer to process removes
    return requestAndAppendSegment({
      request: this.requests.shift(),
      mediaSource: mpc.mediaSource,
      segmentLoader: mpc.mainSegmentLoader_,
      clock: this.clock
    });
  }).then(() => {
    assert.equal(audioRemoves.length, 1, 'one audio remove');
    assert.equal(videoRemoves.length, 1, 'one video remove');
    // segment-loader removes at currentTime - 30
    assert.deepEqual(
      audioRemoves[0],
      { start: 0, end: 80 - 10 },
      'removed from audio buffer with right range'
    );
    assert.deepEqual(
      videoRemoves[0],
      { start: 0, end: 80 - 10 },
      'removed from video buffer with right range'
    );
  });
});

QUnit.test('cleans up the buffer when loading VOD segments', function(assert) {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.player.width(640);
  this.player.height(360);
  this.player.tech_.vhs.bandwidth = 20e10;
  // master
  this.standardXHRResponse(this.requests[0]);
  // media
  this.standardXHRResponse(this.requests[1]);

  const mpc = this.player.tech_.vhs.masterPlaylistController_;
  const audioRemoves = [];
  const videoRemoves = [];

  // first segment request will set up all of the source buffers we need
  return requestAndAppendSegment({
    request: this.requests[2],
    mediaSource: mpc.mediaSource,
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock
  }).then(() => {
    const audioBuffer = mpc.sourceUpdater_.audioBuffer;
    const videoBuffer = mpc.sourceUpdater_.videoBuffer;
    const origAudioRemove = audioBuffer.remove.bind(audioBuffer);
    const origVideoRemove = videoBuffer.remove.bind(videoBuffer);

    audioBuffer.remove = (start, end) => {
      audioRemoves.push({start, end});
      window.setTimeout(() => audioBuffer.trigger('updateend'), 1);
      origAudioRemove();
    };
    videoBuffer.remove = (start, end) => {
      videoRemoves.push({start, end});
      window.setTimeout(() => videoBuffer.trigger('updateend'), 1);
      origVideoRemove();
    };

    // the seek will have removed everything to the duration of the video, so we want to
    // only start tracking removes after the seek, once the next segment request is made
    this.player.currentTime(120);

    // since source buffers are mocked, must fake that there's buffered data, or else we
    // don't bother processing removes
    audioBuffer.buffered = videojs.createTimeRanges([[0, 10]]);
    videoBuffer.buffered = videojs.createTimeRanges([[1, 11]]);

    // This requires 2 clock ticks because after updateend monitorBuffer_ is called
    // to setup fillBuffer on the next tick, but the seek also causes monitorBuffer_ to be
    // called, which cancels the previously set timeout and sets a new one for the following
    // tick.
    this.clock.tick(2);

    assert.ok(this.requests[3].aborted, 'request aborted during seek');

    // request second segment, and give enough time for the source buffer to process removes
    return requestAndAppendSegment({
      request: this.requests[4],
      mediaSource: mpc.mediaSource,
      segmentLoader: mpc.mainSegmentLoader_,
      clock: this.clock
    });
  }).then(() => {

    assert.ok(audioRemoves.length, 'audio removes');
    assert.ok(videoRemoves.length, 'video removes');
    // the default manifest is 4 segments that are 10s each.
    assert.deepEqual(audioRemoves, [
      // The first remove comes from the setCurrentTime call,
      // caused by player.currentTime(120)
      { start: 0, end: 40 },
      // The second remove comes from trimBackBuffer_ and is based on currentTime
      { start: 0, end: 120 - 30 },
      // the final remove comes after our final requestAndAppendSegment
      // and happens because our guess to append to a buffered ranged near
      // currentTime is incorrect.
      { start: 0, end: 40 }
    ], 'removed from audio buffer with right range');
    assert.deepEqual(videoRemoves, [
      { start: 0, end: 40 },
      { start: 0, end: 120 - 30 },
      { start: 0, end: 40 }
    ], 'removed from audio buffer with right range');
  });
});

QUnit.test('when mediaGroup changes enabled track should not change', function(assert) {
  let vhsAudioChangeEvents = 0;
  let hlsAudioChangeEvents = 0;

  this.player.src({
    src: 'manifest/multipleAudioGroups.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.player.tech_.on('usage', (event) => {
    if (event.name === 'vhs-audio-change') {
      vhsAudioChangeEvents++;
    }
    if (event.name === 'hls-audio-change') {
      hlsAudioChangeEvents++;
    }
  });

  // master
  this.standardXHRResponse(this.requests.shift());
  // video media
  this.standardXHRResponse(this.requests.shift());
  const vhs = this.player.tech_.vhs;
  const mpc = vhs.masterPlaylistController_;
  let audioTracks = this.player.audioTracks();

  assert.equal(vhsAudioChangeEvents, 0, 'no vhs-audio-change event was fired');
  assert.equal(hlsAudioChangeEvents, 0, 'no hls-audio-change event was fired');
  assert.equal(audioTracks.length, 3, 'three audio tracks after load');
  assert.equal(audioTracks[0].enabled, true, 'track one enabled after load');

  let oldMediaGroup = vhs.playlists.media().attributes.AUDIO;

  // clear out any outstanding requests
  this.requests.length = 0;
  // force mpc to select a playlist from a new media group
  mpc.masterPlaylistLoader_.media(mpc.master().playlists[0]);
  this.clock.tick(1);

  // video media
  this.standardXHRResponse(this.requests.shift());

  assert.notEqual(
    oldMediaGroup,
    vhs.playlists.media().attributes.AUDIO,
    'selected a new playlist'
  );
  audioTracks = this.player.audioTracks();
  const activeGroup = mpc.mediaTypes_.AUDIO.activeGroup(audioTracks[0]);

  assert.equal(audioTracks.length, 3, 'three audio tracks after changing mediaGroup');
  assert.ok(activeGroup.default, 'track one should be the default');
  assert.ok(audioTracks[0].enabled, 'enabled the default track');
  assert.notOk(audioTracks[1].enabled, 'disabled track two');
  assert.notOk(audioTracks[2].enabled, 'disabled track three');

  audioTracks[1].enabled = true;
  assert.notOk(audioTracks[0].enabled, 'disabled track one');
  assert.ok(audioTracks[1].enabled, 'enabled track two');
  assert.notOk(audioTracks[2].enabled, 'disabled track three');

  oldMediaGroup = vhs.playlists.media().attributes.AUDIO;
  // clear out any outstanding requests
  this.requests.length = 0;
  // swap back to the old media group
  // this playlist is already loaded so no new requests are made
  mpc.masterPlaylistLoader_.media(mpc.master().playlists[3]);
  this.clock.tick(1);

  assert.notEqual(
    oldMediaGroup,
    vhs.playlists.media().attributes.AUDIO,
    'selected a new playlist'
  );
  audioTracks = this.player.audioTracks();

  assert.equal(vhsAudioChangeEvents, 1, 'a vhs-audio-change event was fired');
  assert.equal(hlsAudioChangeEvents, 1, 'an hls-audio-change event was fired');
  assert.equal(audioTracks.length, 3, 'three audio tracks after reverting mediaGroup');
  assert.notOk(audioTracks[0].enabled, 'the default track is still disabled');
  assert.ok(audioTracks[1].enabled, 'track two is still enabled');
  assert.notOk(audioTracks[2].enabled, 'track three is still disabled');
});

QUnit.test(
  'Allows specifying the beforeRequest function on the player',
  function(assert) {
    let beforeRequestCalled = false;

    this.player.src({
      src: 'master.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    this.clock.tick(1);

    openMediaSource(this.player, this.clock);

    this.player.tech_.vhs.xhr.beforeRequest = function() {
      beforeRequestCalled = true;
    };
    // master
    this.standardXHRResponse(this.requests.shift());
    // media
    this.standardXHRResponse(this.requests.shift());

    assert.ok(beforeRequestCalled, 'beforeRequest was called');

    // verify stats
    assert.equal(this.player.tech_.vhs.stats.bandwidth, 4194304, 'default');
  }
);

QUnit.test('Allows specifying the beforeRequest function globally', function(assert) {
  let beforeRequestCalled = false;

  videojs.Vhs.xhr.beforeRequest = function() {
    beforeRequestCalled = true;
  };

  this.player.src({
    src: 'master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  // master
  this.standardXHRResponse(this.requests.shift());

  assert.ok(beforeRequestCalled, 'beforeRequest was called');

  delete videojs.Vhs.xhr.beforeRequest;

  // verify stats
  assert.equal(this.player.tech_.vhs.stats.bandwidth, 4194304, 'default');
});

QUnit.test('Allows overriding the global beforeRequest function', function(assert) {
  let beforeGlobalRequestCalled = 0;
  let beforeLocalRequestCalled = 0;

  videojs.Vhs.xhr.beforeRequest = function() {
    beforeGlobalRequestCalled++;
  };

  this.player.src({
    src: 'master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.player.tech_.vhs.xhr.beforeRequest = function() {
    beforeLocalRequestCalled++;
  };
  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());
  // ts
  this.standardXHRResponse(this.requests.shift(), muxedSegment());

  assert.equal(beforeLocalRequestCalled, 2, 'local beforeRequest was called twice ' +
                                           'for the media playlist and media');
  assert.equal(beforeGlobalRequestCalled, 1, 'global beforeRequest was called once ' +
                                            'for the master playlist');

  delete videojs.Vhs.xhr.beforeRequest;
});

QUnit.test(
  'passes useCueTags vhs option to master playlist controller',
  function(assert) {
    this.player.src({
      src: 'master.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    this.clock.tick(1);

    assert.ok(
      !this.player.tech_.vhs.masterPlaylistController_.useCueTags_,
      'useCueTags is falsy by default'
    );

    const origVhsOptions = videojs.options.vhs;

    videojs.options.vhs = {
      useCueTags: true
    };

    this.player.dispose();
    this.player = createPlayer();
    this.player.src({
      src: 'http://example.com/media.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    this.clock.tick(1);

    assert.ok(
      this.player.tech_.vhs.masterPlaylistController_.useCueTags_,
      'useCueTags passed to master playlist controller'
    );

    videojs.options.vhs = origVhsOptions;
  }
);

QUnit.test('populates quality levels list when available', function(assert) {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  assert.ok(this.player.tech_.vhs.qualityLevels_, 'added quality levels');

  const qualityLevels = this.player.qualityLevels();
  let addCount = 0;
  let changeCount = 0;

  qualityLevels.on('addqualitylevel', () => {
    addCount++;
  });

  qualityLevels.on('change', () => {
    changeCount++;
  });

  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  assert.equal(addCount, 4, 'four levels added from master');
  assert.equal(changeCount, 1, 'selected initial quality level');

  this.player.dispose();
  this.player = createPlayer({}, {
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  }, this.clock);
  openMediaSource(this.player, this.clock);

  assert.ok(
    this.player.tech_.vhs.qualityLevels_,
    'added quality levels from video with source'
  );
});

QUnit.test('configures eme for DASH if present on sourceUpdater ready', function(assert) {
  this.player.eme = {
    options: {
      previousSetting: 1
    }
  };
  this.player.src({
    src: 'manifest/master.mpd',
    type: 'application/dash+xml',
    keySystems: {
      keySystem1: {
        url: 'url1'
      }
    }
  });

  this.clock.tick(1);

  const media = {
    attributes: {
      CODECS: 'avc1.420015'
    },
    contentProtection: {
      keySystem1: {
        pssh: 'test'
      }
    }
  };

  this.player.tech_.vhs.playlists = {
    master: { playlists: [media] },
    media: () => media
  };

  this.player.tech_.vhs.masterPlaylistController_.mediaTypes_ = {
    SUBTITLES: {},
    AUDIO: {
      activePlaylistLoader: {
        media: () => {
          return {
            attributes: {
              CODECS: 'mp4a.40.2c'
            }
          };
        }
      }
    }
  };

  this.player.tech_.vhs.masterPlaylistController_.sourceUpdater_.trigger('ready');

  assert.deepEqual(this.player.eme.options, {
    previousSetting: 1
  }, 'did not modify plugin options');

  assert.deepEqual(this.player.currentSource(), {
    src: 'manifest/master.mpd',
    type: 'application/dash+xml',
    keySystems: {
      keySystem1: {
        url: 'url1',
        audioContentType: 'audio/mp4;codecs="mp4a.40.2c"',
        videoContentType: 'video/mp4;codecs="avc1.420015"',
        pssh: 'test'
      }
    }
  }, 'set source eme options');
});

QUnit.test('configures eme for HLS if present on sourceUpdater ready', function(assert) {
  this.player.eme = {
    options: {
      previousSetting: 1
    }
  };
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/x-mpegURL',
    keySystems: {
      keySystem1: {
        url: 'url1'
      }
    }
  });

  this.clock.tick(1);

  const media = {
    attributes: {
      CODECS: 'avc1.420015, mp4a.40.2c'
    },
    contentProtection: {
      keySystem1: {
        pssh: 'test'
      }
    }
  };

  this.player.tech_.vhs.playlists = {
    master: { playlists: [media] },
    media: () => media
  };

  this.player.tech_.vhs.masterPlaylistController_.sourceUpdater_.trigger('ready');

  assert.deepEqual(this.player.eme.options, {
    previousSetting: 1
  }, 'did not modify plugin options');

  assert.deepEqual(this.player.currentSource(), {
    src: 'manifest/master.m3u8',
    type: 'application/x-mpegURL',
    keySystems: {
      keySystem1: {
        url: 'url1',
        audioContentType: 'audio/mp4;codecs="mp4a.40.2c"',
        videoContentType: 'video/mp4;codecs="avc1.420015"',
        pssh: 'test'
      }
    }
  }, 'set source eme options');
});

QUnit.test('integration: configures eme for DASH if present on sourceUpdater ready', function(assert) {
  assert.timeout(3000);
  const done = assert.async();

  this.player.eme = {
    options: {
      previousSetting: 1
    }
  };
  this.player.src({
    src: 'dash.mpd',
    type: 'application/dash+xml',
    keySystems: {
      keySystem1: {
        url: 'url1'
      }
    }
  });
  openMediaSource(this.player, this.clock);

  this.player.tech_.vhs.masterPlaylistController_.sourceUpdater_.on('ready', () => {
    assert.deepEqual(this.player.eme.options, {
      previousSetting: 1
    }, 'did not modify plugin options');

    assert.deepEqual(this.player.currentSource(), {
      src: 'dash.mpd',
      type: 'application/dash+xml',
      keySystems: {
        keySystem1: {
          url: 'url1',
          audioContentType: 'audio/mp4;codecs="mp4a.40.2"',
          videoContentType: 'video/mp4;codecs="avc1.420015"'
        }
      }
    }, 'set source eme options');

    done();
  });

  this.standardXHRResponse(this.requests[0]);
  // this allows the audio playlist loader to load
  this.clock.tick(1);

  // respond to segement request to get trackinfo
  this.standardXHRResponse(this.requests[1], mp4VideoInitSegment());
  this.standardXHRResponse(this.requests[2], mp4VideoSegment());
  this.standardXHRResponse(this.requests[3], mp4AudioInitSegment());
  this.standardXHRResponse(this.requests[4], mp4AudioSegment());
});

QUnit.test('integration: configures eme for HLS if present on sourceUpdater ready', function(assert) {
  assert.timeout(3000);
  const done = assert.async();

  this.player.eme = {
    options: {
      previousSetting: 1
    }
  };
  this.player.src({
    src: 'demuxed-two.m3u8',
    type: 'application/x-mpegURL',
    keySystems: {
      keySystem1: {
        url: 'url1'
      }
    }
  });
  openMediaSource(this.player, this.clock);

  this.player.tech_.vhs.masterPlaylistController_.sourceUpdater_.on('ready', () => {
    assert.deepEqual(this.player.eme.options, {
      previousSetting: 1
    }, 'did not modify plugin options');

    assert.deepEqual(this.player.currentSource(), {
      src: 'demuxed-two.m3u8',
      type: 'application/x-mpegURL',
      keySystems: {
        keySystem1: {
          url: 'url1',
          audioContentType: 'audio/mp4;codecs="mp4a.40.2"',
          videoContentType: 'video/mp4;codecs="avc1.420015"'
        }
      }
    }, 'set source eme options');

    done();
  });

  // master manifest
  this.standardXHRResponse(this.requests.shift());

  // video manifest
  this.standardXHRResponse(this.requests.shift());

  // audio manifest
  this.standardXHRResponse(this.requests.shift());

  // this allows the audio playlist loader to load
  this.clock.tick(1);

  // respond to segement request to get trackinfo
  this.standardXHRResponse(this.requests.shift(), videoSegment());
  this.standardXHRResponse(this.requests.shift(), audioSegment());
});

QUnit.test(
  'does not set source keySystems if keySystems not provided by source',
  function(assert) {
    this.player.src({
      src: 'manifest/master.mpd',
      type: 'application/dash+xml'
    });

    this.clock.tick(1);

    this.player.tech_.vhs.playlists = {
      media: () => {
        return {
          attributes: {
            CODECS: 'video-codec'
          },
          contentProtection: {
            keySystem1: {
              pssh: 'test'
            }
          }
        };
      },
      // mocked for renditions mixin
      master: {
        playlists: []
      }
    };
    this.player.tech_.vhs.masterPlaylistController_.mediaTypes_ = {
      SUBTITLES: {},
      AUDIO: {
        activePlaylistLoader: {
          media: () => {
            return {
              attributes: {
                CODECS: 'audio-codec'
              }
            };
          }
        }
      }
    };
    this.player.tech_.vhs.masterPlaylistController_.sourceUpdater_.trigger('ready');

    assert.deepEqual(this.player.currentSource(), {
      src: 'manifest/master.mpd',
      type: 'application/dash+xml'
    }, 'does not set source eme options');
  }
);

QUnit[testOrSkip](
  'stores bandwidth and throughput in localStorage when global option is true',
  function(assert) {
    videojs.options.vhs = {
      useBandwidthFromLocalStorage: true
    };
    this.player.src({
      src: 'manifest/master.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });
    openMediaSource(this.player, this.clock);
    // master
    this.standardXHRResponse(this.requests.shift());
    // media
    this.standardXHRResponse(this.requests.shift());

    assert.notOk(window.localStorage.getItem(LOCAL_STORAGE_KEY), 'nothing in local storage');

    this.player.tech_.vhs.masterPlaylistController_.mainSegmentLoader_.bandwidth = 11;
    this.player.tech_.vhs.masterPlaylistController_.mainSegmentLoader_.throughput.rate = 22;
    this.player.tech_.trigger('bandwidthupdate');

    const storedObject = JSON.parse(window.localStorage.getItem(LOCAL_STORAGE_KEY));

    assert.equal(parseInt(storedObject.bandwidth, 10), 11, 'set bandwidth');
    assert.equal(parseInt(storedObject.throughput, 10), 22, 'set throughput');
  }
);

QUnit[testOrSkip](
  'stores bandwidth and throughput in localStorage when player option is true',
  function(assert) {
    this.player.dispose();
    this.player = createPlayer({
      html5: {
        vhs: {
          useBandwidthFromLocalStorage: true
        }
      }
    });
    this.player.src({
      src: 'manifest/master.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });
    openMediaSource(this.player, this.clock);

    // master
    this.standardXHRResponse(this.requests.shift());
    // media
    this.standardXHRResponse(this.requests.shift());

    assert.notOk(window.localStorage.getItem(LOCAL_STORAGE_KEY), 'nothing in local storage');

    this.player.tech_.vhs.masterPlaylistController_.mainSegmentLoader_.bandwidth = 11;
    this.player.tech_.vhs.masterPlaylistController_.mainSegmentLoader_.throughput.rate = 22;
    this.player.tech_.trigger('bandwidthupdate');

    const storedObject = JSON.parse(window.localStorage.getItem(LOCAL_STORAGE_KEY));

    assert.equal(parseInt(storedObject.bandwidth, 10), 11, 'set bandwidth');
    assert.equal(parseInt(storedObject.throughput, 10), 22, 'set throughput');
  }
);

QUnit[testOrSkip](
  'stores bandwidth and throughput in localStorage when source option is true',
  function(assert) {
    this.player.dispose();
    this.player = createPlayer();
    this.player.src({
      src: 'manifest/master.m3u8',
      type: 'application/vnd.apple.mpegurl',
      useBandwidthFromLocalStorage: true
    });
    openMediaSource(this.player, this.clock);

    // master
    this.standardXHRResponse(this.requests.shift());
    // media
    this.standardXHRResponse(this.requests.shift());

    assert.notOk(window.localStorage.getItem(LOCAL_STORAGE_KEY), 'nothing in local storage');

    this.player.tech_.vhs.masterPlaylistController_.mainSegmentLoader_.bandwidth = 11;
    this.player.tech_.vhs.masterPlaylistController_.mainSegmentLoader_.throughput.rate = 22;
    this.player.tech_.trigger('bandwidthupdate');

    const storedObject = JSON.parse(window.localStorage.getItem(LOCAL_STORAGE_KEY));

    assert.equal(parseInt(storedObject.bandwidth, 10), 11, 'set bandwidth');
    assert.equal(parseInt(storedObject.throughput, 10), 22, 'set throughput');
  }
);

QUnit[testOrSkip](
  'source localStorage option takes priority over player option',
  function(assert) {
    this.player.dispose();
    this.player = createPlayer({
      html5: {
        vhs: {
          useBandwidthFromLocalStorage: false
        }
      }
    });
    this.player.src({
      src: 'manifest/master.m3u8',
      type: 'application/vnd.apple.mpegurl',
      useBandwidthFromLocalStorage: true
    });
    openMediaSource(this.player, this.clock);

    // master
    this.standardXHRResponse(this.requests.shift());
    // media
    this.standardXHRResponse(this.requests.shift());

    assert.notOk(window.localStorage.getItem(LOCAL_STORAGE_KEY), 'nothing in local storage');

    this.player.tech_.vhs.masterPlaylistController_.mainSegmentLoader_.bandwidth = 11;
    this.player.tech_.vhs.masterPlaylistController_.mainSegmentLoader_.throughput.rate = 22;
    this.player.tech_.trigger('bandwidthupdate');

    const storedObject = JSON.parse(window.localStorage.getItem(LOCAL_STORAGE_KEY));

    assert.equal(parseInt(storedObject.bandwidth, 10), 11, 'set bandwidth');
    assert.equal(parseInt(storedObject.throughput, 10), 22, 'set throughput');
  }
);

QUnit[testOrSkip](
  'does not store bandwidth and throughput in localStorage by default',
  function(assert) {
    this.player.dispose();
    this.player = createPlayer();
    this.player.src({
      src: 'manifest/master.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });
    openMediaSource(this.player, this.clock);

    // master
    this.standardXHRResponse(this.requests.shift());
    // media
    this.standardXHRResponse(this.requests.shift());

    assert.notOk(window.localStorage.getItem(LOCAL_STORAGE_KEY), 'nothing in local storage');

    this.player.tech_.vhs.masterPlaylistController_.mainSegmentLoader_.bandwidth = 11;
    this.player.tech_.vhs.masterPlaylistController_.mainSegmentLoader_.throughput.rate = 22;
    this.player.tech_.trigger('bandwidthupdate');

    assert.notOk(window.localStorage.getItem(LOCAL_STORAGE_KEY), 'nothing in local storage');
  }
);

QUnit[testOrSkip]('retrieves bandwidth and throughput from localStorage', function(assert) {
  window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
    bandwidth: 33,
    throughput: 44
  }));

  let vhsBandwidthUsageEvents = 0;
  let vhsThroughputUsageEvents = 0;
  let hlsBandwidthUsageEvents = 0;
  let hlsThroughputUsageEvents = 0;
  const usageListener = (event) => {
    if (event.name === 'vhs-bandwidth-from-local-storage') {
      vhsBandwidthUsageEvents++;
    }
    if (event.name === 'vhs-throughput-from-local-storage') {
      vhsThroughputUsageEvents++;
    }
    if (event.name === 'hls-bandwidth-from-local-storage') {
      hlsBandwidthUsageEvents++;
    }
    if (event.name === 'hls-throughput-from-local-storage') {
      hlsThroughputUsageEvents++;
    }
  };

  // values must be stored before player is created, otherwise defaults are provided
  this.player.dispose();
  this.player = createPlayer();
  this.player.tech_.on('usage', usageListener);
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  assert.equal(
    this.player.tech_.vhs.bandwidth,
    4194304,
    'uses default bandwidth when no option to use stored bandwidth'
  );
  assert.notOk(
    this.player.tech_.vhs.throughput,
    'no throughput when no option to use stored throughput'
  );

  assert.equal(vhsBandwidthUsageEvents, 0, 'no bandwidth usage event');
  assert.equal(vhsThroughputUsageEvents, 0, 'no throughput usage event');
  assert.equal(hlsBandwidthUsageEvents, 0, 'no bandwidth usage event');
  assert.equal(hlsThroughputUsageEvents, 0, 'no throughput usage event');

  const origVhsOptions = videojs.options.vhs;

  videojs.options.vhs = {
    useBandwidthFromLocalStorage: true
  };
  this.player.dispose();
  this.player = createPlayer();
  this.player.tech_.on('usage', usageListener);
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  assert.equal(this.player.tech_.vhs.bandwidth, 33, 'retrieved stored bandwidth');
  assert.equal(this.player.tech_.vhs.throughput, 44, 'retrieved stored throughput');
  assert.equal(vhsBandwidthUsageEvents, 1, 'one bandwidth usage event');
  assert.equal(vhsThroughputUsageEvents, 1, 'one throughput usage event');
  assert.equal(hlsBandwidthUsageEvents, 1, 'one bandwidth usage event');
  assert.equal(hlsThroughputUsageEvents, 1, 'one throughput usage event');

  videojs.options.vhs = origVhsOptions;
});

QUnit[testOrSkip](
  'does not retrieve bandwidth and throughput from localStorage when stored value is not as expected',
  function(assert) {
  // bad value
    window.localStorage.setItem(LOCAL_STORAGE_KEY, 'a');

    let vhsBandwidthUsageEvents = 0;
    let vhsThroughputUsageEvents = 0;
    let hlsBandwidthUsageEvents = 0;
    let hlsThroughputUsageEvents = 0;
    const usageListener = (event) => {
      if (event.name === 'vhs-bandwidth-from-local-storage') {
        vhsBandwidthUsageEvents++;
      }
      if (event.name === 'vhs-throughput-from-local-storage') {
        vhsThroughputUsageEvents++;
      }
      if (event.name === 'hls-bandwidth-from-local-storage') {
        hlsBandwidthUsageEvents++;
      }
      if (event.name === 'hls-throughput-from-local-storage') {
        hlsThroughputUsageEvents++;
      }
    };

    const origVhsOptions = videojs.options.vhs;

    videojs.options.vhs = {
      useBandwidthFromLocalStorage: true
    };
    // values must be stored before player is created, otherwise defaults are provided
    this.player = createPlayer();
    this.player.tech_.on('usage', usageListener);
    this.player.src({
      src: 'manifest/master.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });
    openMediaSource(this.player, this.clock);

    assert.equal(
      this.player.tech_.vhs.bandwidth,
      4194304,
      'uses default bandwidth when bandwidth value retrieved'
    );
    assert.notOk(this.player.tech_.vhs.throughput, 'no throughput value retrieved');

    assert.equal(vhsBandwidthUsageEvents, 0, 'no bandwidth usage event');
    assert.equal(vhsThroughputUsageEvents, 0, 'no throughput usage event');
    assert.equal(hlsBandwidthUsageEvents, 0, 'no bandwidth usage event');
    assert.equal(hlsThroughputUsageEvents, 0, 'no throughput usage event');

    videojs.options.vhs = origVhsOptions;
  }
);

QUnit.test(
  'convertToProgramTime will return error if time is not buffered',
  function(assert) {
    const done = assert.async();

    this.player.src({
      src: 'manifest/playlist.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });
    this.clock.tick(1);

    openMediaSource(this.player, this.clock);

    // media
    this.standardXHRResponse(this.requests.shift());
    // ts
    this.standardXHRResponse(this.requests.shift(), muxedSegment());

    this.player.tech(true).vhs.convertToProgramTime(3, (err, programTime) => {
      assert.deepEqual(
        err,
        {
          message:
          'Accurate programTime could not be determined.' +
          ' Please seek to e.seekTime and try again',
          seekTime: 0
        },
        'error is returned as time is not buffered'
      );
      done();
    });
  }
);

QUnit.test('convertToProgramTime will return stream time if buffered', function(assert) {
  const done = assert.async();

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.player.tech_.vhs.bandwidth = 20e10;
  // master
  this.standardXHRResponse(this.requests[0]);
  // media.m3u8
  this.standardXHRResponse(this.requests[1]);

  const mpc = this.player.tech(true).vhs.masterPlaylistController_;
  const mainSegmentLoader_ = mpc.mainSegmentLoader_;

  mainSegmentLoader_.one('appending', () => {
    // since we don't run through the transmuxer, we have to manually trigger the timing
    // info callback
    mainSegmentLoader_.handleVideoSegmentTimingInfo_(mainSegmentLoader_.pendingSegment_.requestId, {
      prependedGopDuration: 0,
      start: {
        presentation: 0
      },
      end: {
        presentation: 1
      }
    });
  });

  return requestAndAppendSegment({
    request: this.requests[2],
    mediaSource: mpc.mediaSource,
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock
  }).then(() => {
    // ts
    this.standardXHRResponse(this.requests[3], muxedSegment());

    this.player.tech(true).vhs.convertToProgramTime(0.01, (err, programTime) => {
      assert.notOk(err, 'no errors');
      assert.equal(
        programTime.mediaSeconds,
        0.01,
        'returned the stream time of the source'
      );
      done();
    });
  });
});

QUnit.test(
  'seekToProgramTime will error if live stream has not started',
  function(assert) {
    this.player.src({
      src: 'manifest/program-date-time.m3u8',
      type: 'application/x-mpegurl'
    });
    this.clock.tick(1);

    openMediaSource(this.player, this.clock);
    // media
    this.standardXHRResponse(this.requests.shift());

    this.player.tech(true).vhs.seekToProgramTime(
      '2018-10-12T22:33:49.037+00:00',
      (err, newTime) => {
        assert.equal(
          err.message,
          'player must be playing a live stream to start buffering',
          'error is returned when live stream has not started'
        );
      }
    );
    // allows ie to start loading segments, from setupFirstPlay
    this.player.tech_.readyState = () => 4;

    this.player.play();
    // trigger playing with non-existent content
    this.player.tech_.trigger('playing');
    // wait for playlist refresh
    this.clock.tick(4 * 1000 + 1);
    // ts
    this.standardXHRResponse(this.requests.shift(), muxedSegment());

    this.player.tech(true).vhs.seekToProgramTime(
      '2018-10-12T22:33:49.037+00:00',
      (err, newTime) => {
        assert.equal(
          err.message,
          '2018-10-12T22:33:49.037+00:00 is not buffered yet. Try again',
          'error returned if time has not been buffered'
        );
      }
    );
  }
);

QUnit.test('seekToProgramTime seek to time if buffered', function(assert) {
  const done = assert.async();

  this.player.src({
    src: 'manifest/program-date-time.m3u8',
    type: 'application/x-mpegurl'
  });
  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  // media
  this.standardXHRResponse(this.requests.shift());

  // allows ie to start loading segments, from setupFirstPlay
  this.player.tech_.readyState = () => 4;

  this.player.play();
  // trigger playing with non-existent content
  this.player.tech_.trigger('playing');
  // wait for playlist refresh
  this.clock.tick(2 * 1000 + 1);

  const mpc = this.player.tech(true).vhs.masterPlaylistController_;

  mpc.mainSegmentLoader_.one('appending', () => {
    const videoBuffer = mpc.sourceUpdater_.videoBuffer;

    // must fake the call to videoTimingInfo as the segment isn't transmuxed in the test
    videoBuffer.trigger({
      type: 'videoSegmentTimingInfo',
      videoSegmentTimingInfo: {
        start: {
          presentation: 0
        },
        end: {
          presentation: 0.3333
        },
        baseMediaDecodeTime: 0,
        prependedContentDuration: 0
      }
    });
  });

  return requestAndAppendSegment({
    request: this.requests.shift(),
    mediaSource: mpc.mediaSource,
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock
  }).then(() => {
    this.player.tech(true).vhs.seekToProgramTime(
      '2018-10-12T22:33:49.037+00:00',
      (err, newTime) => {
        assert.notOk(
          err,
          'no error returned'
        );
        assert.equal(
          newTime,
          0,
          'newTime is returned as the time the player seeked to'
        );
        done();
      }
    );

    // This allows seek to take affect
    this.clock.tick(2);
  });
});

QUnit.test('manifest object used as source if provided as data URI', function(assert) {
  this.player.src({
    src: 'placeholder-source',
    type: 'application/x-mpegurl'
  });
  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  // asynchronous setup of initial playlist in playlist loader for JSON sources
  this.clock.tick(1);

  // no manifestObject was provided, so a request is made for the source manifest
  assert.equal(this.requests.length, 1, 'one request');
  assert.equal(this.requests[0].url, 'placeholder-source', 'requested src url');

  this.requests.length = 0;

  const manifestString = testDataManifests.playlist;
  const manifestObject = parseManifest({ manifestString });

  this.player.src({
    src: `data:application/vnd.videojs.vhs+json,${JSON.stringify(manifestObject)}`,
    type: 'application/vnd.videojs.vhs+json'
  });

  openMediaSource(this.player, this.clock);
  // asynchronous setup of initial playlist in playlist loader for JSON sources
  this.clock.tick(1);

  // manifestObject was provided, so a request is made for the segment
  assert.equal(this.requests.length, 1, 'one request');
  assert.equal(
    this.requests[0].uri,
    `${window.location.origin}/test/hls_450k_video.ts`,
    'requested first segment'
  );
});

QUnit.module('HLS Integration', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.requests = this.env.requests;
    this.mse = useFakeMediaSource();
    this.player = createPlayer();
    this.tech = this.player.tech_;
    this.clock = this.env.clock;

    this.standardXHRResponse = (request, data) => {
      standardXHRResponse(request, data);

      // Because SegmentLoader#fillBuffer_ is now scheduled asynchronously
      // we have to use clock.tick to get the expected side effects of
      // SegmentLoader#handleAppendsDone_
      this.clock.tick(1);
    };

    videojs.VhsHandler.prototype.setupQualityLevels_ = () => {};
  },
  afterEach() {
    this.env.restore();
    this.mse.restore();
    window.localStorage.clear();
    this.player.dispose();
    videojs.VhsHandler.prototype.setupQualityLevels_ = ogVhsHandlerSetupQualityLevels;
  }
});

QUnit.test('aborts all in-flight work when disposed', function(assert) {
  const vhs = VhsSourceHandler.handleSource({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  }, this.tech);

  vhs.mediaSource.trigger('sourceopen');
  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  vhs.dispose();
  assert.ok(this.requests[0].aborted, 'aborted the old segment request');
  vhs.mediaSource.sourceBuffers.forEach(sourceBuffer => {
    const lastUpdate = sourceBuffer.updates_[sourceBuffer.updates_.length - 1];

    assert.ok(lastUpdate.abort, 'aborted the source buffer');
  });
});

QUnit.test('stats are reset on dispose', function(assert) {
  const done = assert.async();
  const vhs = VhsSourceHandler.handleSource({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  }, this.tech);

  vhs.mediaSource.trigger('sourceopen');
  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  const segment = muxedSegment();
  // copy the byte length since the segment bytes get cleared out
  const segmentByteLength = segment.byteLength;

  assert.ok(segmentByteLength, 'the segment has some number of bytes');

  // segment 0
  this.standardXHRResponse(this.requests.shift(), segment);

  vhs.masterPlaylistController_.mainSegmentLoader_.on('appending', () => {
    assert.equal(vhs.stats.mediaBytesTransferred, segmentByteLength, 'stat is set');
    vhs.dispose();
    assert.equal(vhs.stats.mediaBytesTransferred, 0, 'stat is reset');
    done();
  });
});

// mocking the fullscreenElement no longer works, find another way to mock
// fullscreen behavior(without user gesture)
QUnit.skip('detects fullscreen and triggers a smooth quality change', function(assert) {
  const vhs = VhsSourceHandler.handleSource({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  }, this.tech);

  let qualityChanges = 0;
  let fullscreenElementName;

  ['fullscreenElement', 'webkitFullscreenElement',
    'mozFullScreenElement', 'msFullscreenElement'].forEach((name) => {
    if (!fullscreenElementName && !document.hasOwnProperty(name)) {
      fullscreenElementName = name;
    }
  });

  vhs.masterPlaylistController_.smoothQualityChange_ = function() {
    qualityChanges++;
  };

  // take advantage of capability detection to mock fullscreen activation
  document[fullscreenElementName] = this.tech.el();
  Events.trigger(document, 'fullscreenchange');

  assert.equal(qualityChanges, 1, 'made a fast quality change');

  // don't do a fast quality change when returning from fullscreen;
  // allow the video element to rescale the already buffered video
  document[fullscreenElementName] = null;
  Events.trigger(document, 'fullscreenchange');

  assert.equal(qualityChanges, 1, 'did not make another quality change');
  vhs.dispose();
});

QUnit.test('downloads additional playlists if required', function(assert) {
  const vhs = VhsSourceHandler.handleSource({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  }, this.tech);

  // Make segment metadata noop since most test segments dont have real data
  vhs.masterPlaylistController_.mainSegmentLoader_.addSegmentMetadataCue_ = () => {};

  vhs.mediaSource.trigger('sourceopen');
  vhs.bandwidth = 1;
  // master
  this.standardXHRResponse(this.requests[0]);
  // media
  this.standardXHRResponse(this.requests[1]);

  const originalPlaylist = vhs.playlists.media();
  const mpc = vhs.masterPlaylistController_;

  mpc.mainSegmentLoader_.mediaIndex = 0;

  return requestAndAppendSegment({
    request: this.requests[2],
    mediaSource: mpc.mediaSource,
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock,
    // the playlist selection is revisited after a new segment is downloaded
    bandwidth: 3000000,
    tickClock: false
  }).then(() => {

    // update the buffer to reflect the appended segment, and have enough buffer to
    // change playlist
    this.tech.buffered = () => videojs.createTimeRanges([[0, 30]]);
    this.clock.tick(1);

    // new media
    this.standardXHRResponse(this.requests[3]);

    assert.ok(
      (/manifest\/media\d+.m3u8$/).test(this.requests[3].url),
      'made a playlist request'
    );
    assert.notEqual(
      originalPlaylist.resolvedUri,
      vhs.playlists.media().resolvedUri,
      'a new playlists was selected'
    );
    assert.ok(vhs.playlists.media().segments, 'segments are now available');

    vhs.dispose();
  });
});

QUnit.test('waits to download new segments until the media playlist is stable', function(assert) {
  const vhs = VhsSourceHandler.handleSource({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  }, this.tech);
  const mpc = vhs.masterPlaylistController_;

  mpc.mainSegmentLoader_.addSegmentMetadataCue_ = () => {};

  vhs.mediaSource.trigger('sourceopen');

  // make sure we stay on the lowest variant
  vhs.bandwidth = 1;
  // master
  this.standardXHRResponse(this.requests.shift());
  // media1
  this.standardXHRResponse(this.requests.shift());

  // put segment loader in walking forward mode
  mpc.mainSegmentLoader_.mediaIndex = 0;

  return requestAndAppendSegment({
    request: this.requests.shift(),
    mediaSource: mpc.mediaSource,
    segmentLoader: mpc.mainSegmentLoader_,
    clock: this.clock,
    // bandwidth is high enough to switch playlists
    bandwidth: Number.MAX_VALUE,
    tickClock: false
  }).then(() => {

    // update the buffer to reflect the appended segment, and have enough buffer to
    // change playlist
    this.tech.buffered = () => videojs.createTimeRanges([[0, 30]]);

    this.clock.tick(1);

    assert.equal(this.requests.length, 1, 'only the playlist request outstanding');
    this.clock.tick(10 * 1000);
    assert.equal(this.requests.length, 1, 'delays segment fetching');

    // another media playlist
    this.standardXHRResponse(this.requests.shift());
    this.clock.tick(10 * 1000);
    assert.equal(this.requests.length, 1, 'resumes segment fetching');

    // verify stats
    assert.equal(vhs.stats.bandwidth, Infinity, 'bandwidth is set to infinity');
    vhs.dispose();
  });
});

QUnit.test('live playlist starts three target durations before live', function(assert) {
  const vhs = VhsSourceHandler.handleSource({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  }, this.tech);

  vhs.mediaSource.trigger('sourceopen');
  this.requests.shift().respond(
    200, null,
    '#EXTM3U\n' +
                                '#EXT-X-MEDIA-SEQUENCE:101\n' +
                                '#EXT-X-TARGETDURATION:10\n' +
                                '#EXTINF:10,\n' +
                                '0.ts\n' +
                                '#EXTINF:10,\n' +
                                '1.ts\n' +
                                '#EXTINF:10,\n' +
                                '2.ts\n' +
                                '#EXTINF:10,\n' +
                                '3.ts\n' +
                                '#EXTINF:10,\n' +
                                '4.ts\n'
  );

  assert.equal(this.requests.length, 0, 'no outstanding segment request');

  this.tech.paused = function() {
    return false;
  };
  let techCurrentTime = 0;

  this.tech.setCurrentTime = function(ct) {
    techCurrentTime = ct;
  };

  this.tech.readyState = () => 4;
  this.tech.trigger('play');
  this.clock.tick(1);

  assert.equal(
    vhs.seekable().end(0),
    20,
    'seekable end is three target durations from playlist end'
  );
  assert.equal(
    techCurrentTime,
    vhs.seekable().end(0),
    'seeked to the seekable end'
  );
  assert.equal(this.requests.length, 1, 'begins buffering');
  vhs.dispose();
});

QUnit.test(
  'uses user defined selectPlaylist from VhsHandler if specified',
  function(assert) {
    const origStandardPlaylistSelector = Vhs.STANDARD_PLAYLIST_SELECTOR;
    let defaultSelectPlaylistCount = 0;

    Vhs.STANDARD_PLAYLIST_SELECTOR = () => defaultSelectPlaylistCount++;

    let vhs = VhsSourceHandler.handleSource({
      src: 'manifest/master.m3u8',
      type: 'application/vnd.apple.mpegurl'
    }, this.tech);

    vhs.masterPlaylistController_.selectPlaylist();
    assert.equal(defaultSelectPlaylistCount, 1, 'uses default playlist selector');

    defaultSelectPlaylistCount = 0;

    let newSelectPlaylistCount = 0;
    const newSelectPlaylist = () => newSelectPlaylistCount++;

    VhsHandler.prototype.selectPlaylist = newSelectPlaylist;

    vhs.dispose();

    vhs = VhsSourceHandler.handleSource({
      src: 'manifest/master.m3u8',
      type: 'application/vnd.apple.mpegurl'
    }, this.tech);

    vhs.masterPlaylistController_.selectPlaylist();
    assert.equal(defaultSelectPlaylistCount, 0, 'standard playlist selector not run');
    assert.equal(newSelectPlaylistCount, 1, 'uses overridden playlist selector');

    newSelectPlaylistCount = 0;

    let setSelectPlaylistCount = 0;

    vhs.selectPlaylist = () => setSelectPlaylistCount++;

    vhs.masterPlaylistController_.selectPlaylist();
    assert.equal(defaultSelectPlaylistCount, 0, 'standard playlist selector not run');
    assert.equal(newSelectPlaylistCount, 0, 'overridden playlist selector not run');
    assert.equal(setSelectPlaylistCount, 1, 'uses set playlist selector');

    Vhs.STANDARD_PLAYLIST_SELECTOR = origStandardPlaylistSelector;
    delete VhsHandler.prototype.selectPlaylist;
    vhs.dispose();
  }
);

QUnit.module('HLS - Encryption', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.requests = this.env.requests;
    this.mse = useFakeMediaSource();
    this.tech = new (videojs.getTech('Html5'))({});
    this.clock = this.env.clock;

    this.standardXHRResponse = (request, data) => {
      standardXHRResponse(request, data);

      // Because SegmentLoader#fillBuffer_ is now scheduled asynchronously
      // we have to use clock.tick to get the expected side effects of
      // SegmentLoader#handleAppendsDone_
      this.clock.tick(1);
    };

    videojs.VhsHandler.prototype.setupQualityLevels_ = () => {};
  },
  afterEach() {
    this.env.restore();
    this.mse.restore();
    window.localStorage.clear();
    videojs.VhsHandler.prototype.setupQualityLevels_ = ogVhsHandlerSetupQualityLevels;
  }
});

QUnit.test('blacklists playlist if key requests fail', function(assert) {
  const vhs = VhsSourceHandler.handleSource({
    src: 'manifest/encrypted-master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  }, this.tech);

  vhs.mediaSource.trigger('sourceopen');
  this.requests.shift()
    .respond(
      200, null,
      '#EXTM3U\n' +
              '#EXT-X-STREAM-INF:BANDWIDTH=1000\n' +
              'media.m3u8\n' +
              '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
              'media1.m3u8\n'
    );
  this.requests.shift()
    .respond(
      200, null,
      '#EXTM3U\n' +
             '#EXT-X-KEY:METHOD=AES-128,URI="htts://priv.example.com/key.php?r=52"\n' +
             '#EXTINF:2.833,\n' +
             'http://media.example.com/fileSequence52-A.ts\n' +
             '#EXT-X-KEY:METHOD=AES-128,URI="htts://priv.example.com/key.php?r=53"\n' +
             '#EXTINF:15.0,\n' +
             'http://media.example.com/fileSequence53-A.ts\n' +
             '#EXT-X-ENDLIST\n'
    );
  this.clock.tick(1);

  // segment 1
  if (/key\.php/i.test(this.requests[0].url)) {
    this.standardXHRResponse(this.requests.pop());
  } else {
    this.standardXHRResponse(this.requests.shift());
  }
  // fail key
  this.requests.shift().respond(404);

  assert.ok(
    vhs.playlists.media().excludeUntil > 0,
    'playlist blacklisted'
  );
  assert.equal(this.env.log.warn.calls, 1, 'logged warning for blacklist');
  vhs.dispose();
});

QUnit.test(
  'treats invalid keys as a key request failure and blacklists playlist',
  function(assert) {
    const vhs = VhsSourceHandler.handleSource({
      src: 'manifest/encrypted-master.m3u8',
      type: 'application/vnd.apple.mpegurl'
    }, this.tech);

    vhs.mediaSource.trigger('sourceopen');
    this.requests.shift()
      .respond(
        200, null,
        '#EXTM3U\n' +
              '#EXT-X-STREAM-INF:BANDWIDTH=1000\n' +
              'media.m3u8\n' +
              '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
              'media1.m3u8\n'
      );
    this.requests.shift()
      .respond(
        200, null,
        '#EXTM3U\n' +
             '#EXT-X-MEDIA-SEQUENCE:5\n' +
             '#EXT-X-KEY:METHOD=AES-128,URI="https://priv.example.com/key.php?r=52"\n' +
             '#EXTINF:2.833,\n' +
             'http://media.example.com/fileSequence52-A.ts\n' +
             '#EXT-X-KEY:METHOD=NONE\n' +
             '#EXTINF:15.0,\n' +
             'http://media.example.com/fileSequence52-B.ts\n' +
             '#EXT-X-ENDLIST\n'
      );
    this.clock.tick(1);

    // segment request
    this.standardXHRResponse(this.requests.pop());

    assert.equal(
      this.requests[0].url,
      'https://priv.example.com/key.php?r=52',
      'requested the key'
    );
    // keys *should* be 16 bytes long -- this one is too small
    this.requests[0].response = new Uint8Array(1).buffer;
    this.requests.shift().respond(200, null, '');
    this.clock.tick(1);

    // blacklist this playlist
    assert.ok(
      vhs.playlists.media().excludeUntil > 0,
      'blacklisted playlist'
    );
    assert.equal(this.env.log.warn.calls, 1, 'logged warning for blacklist');

    // verify stats
    assert.equal(vhs.stats.mediaBytesTransferred, 1024, '1024 bytes');
    assert.equal(vhs.stats.mediaRequests, 1, '1 request');
    vhs.dispose();
  }
);

QUnit.module('videojs-http-streaming isolated functions');

QUnit.test('emeKeySystems adds content types for all keySystems', function(assert) {
  // muxed content
  assert.deepEqual(
    emeKeySystems(
      { keySystem1: {}, keySystem2: {} },
      { attributes: { CODECS: 'avc1.420015, mp4a.40.2c' } },
    ),
    {
      keySystem1: {
        audioContentType: 'audio/mp4;codecs="mp4a.40.2c"',
        videoContentType: 'video/mp4;codecs="avc1.420015"'
      },
      keySystem2: {
        audioContentType: 'audio/mp4;codecs="mp4a.40.2c"',
        videoContentType: 'video/mp4;codecs="avc1.420015"'
      }
    },
    'added content types'
  );

  // unmuxed content
  assert.deepEqual(
    emeKeySystems(
      { keySystem1: {}, keySystem2: {} },
      { attributes: { CODECS: 'avc1.420015' } },
      { attributes: { CODECS: 'mp4a.40.2c' } },
    ),
    {
      keySystem1: {
        audioContentType: 'audio/mp4;codecs="mp4a.40.2c"',
        videoContentType: 'video/mp4;codecs="avc1.420015"'
      },
      keySystem2: {
        audioContentType: 'audio/mp4;codecs="mp4a.40.2c"',
        videoContentType: 'video/mp4;codecs="avc1.420015"'
      }
    },
    'added content types'
  );
});

QUnit.test('emeKeySystems retains non content type properties', function(assert) {
  assert.deepEqual(
    emeKeySystems(
      { keySystem1: { url: '1' }, keySystem2: { url: '2'} },
      { attributes: { CODECS: 'avc1.420015, mp4a.40.2c' } },
    ),
    {
      keySystem1: {
        url: '1',
        audioContentType: 'audio/mp4;codecs="mp4a.40.2c"',
        videoContentType: 'video/mp4;codecs="avc1.420015"'
      },
      keySystem2: {
        url: '2',
        audioContentType: 'audio/mp4;codecs="mp4a.40.2c"',
        videoContentType: 'video/mp4;codecs="avc1.420015"'
      }
    },
    'retained options'
  );
});

QUnit.test('emeKeySystems overwrites content types', function(assert) {
  assert.deepEqual(
    emeKeySystems(
      {
        keySystem1: {
          audioContentType: 'a',
          videoContentType: 'b'
        },
        keySystem2: {
          audioContentType: 'c',
          videoContentType: 'd'
        }
      },
      { attributes: { CODECS: 'avc1.420015, mp4a.40.2c' } },
    ),
    {
      keySystem1: {
        audioContentType: 'audio/mp4;codecs="mp4a.40.2c"',
        videoContentType: 'video/mp4;codecs="avc1.420015"'
      },
      keySystem2: {
        audioContentType: 'audio/mp4;codecs="mp4a.40.2c"',
        videoContentType: 'video/mp4;codecs="avc1.420015"'
      }
    },
    'overwrote content types'
  );
});

QUnit.test('expandDataUri parses JSON for VHS media type', function(assert) {
  const manifestObject = {
    test: 'manifest',
    object: ['here']
  };
  const xMpegDataUriString =
    `data:application/x-mpegURL,${JSON.stringify(manifestObject)}`;

  assert.deepEqual(
    expandDataUri(xMpegDataUriString),
    xMpegDataUriString,
    'does not parse JSON for non VHS media type'
  );

  assert.deepEqual(
    expandDataUri(`data:application/vnd.videojs.vhs+json,${JSON.stringify(manifestObject)}`),
    manifestObject,
    'parsed JSON from data URI for VHS media type'
  );
});

QUnit.test('expandDataUri is case insensitive', function(assert) {
  const manifestObject = {
    test: 'manifest',
    object: ['here']
  };

  assert.deepEqual(
    expandDataUri(`DaTa:ApPlIcAtIoN/VnD.ViDeOjS.VhS+JsOn,${JSON.stringify(manifestObject)}`),
    manifestObject,
    'parsed JSON from data URI for VHS media type'
  );
});

QUnit.test('expandDataUri requires comma to parse', function(assert) {
  assert.deepEqual(
    expandDataUri('data:application/vnd.videojs.vhs+json'),
    'data:application/vnd.videojs.vhs+json',
    'did not parse when no comma after data URI'
  );
});

QUnit.module('setupEmeOptions', {
  beforeEach() {
    this.origBrowser = videojs.browser;
    // IE11 is a special case and should be tested separately
    videojs.browser = videojs.mergeOptions(videojs.browser, { IE_VERSION: null });
  },
  afterEach() {
    videojs.browser = this.origBrowser;
  }
});

QUnit.test('no error if no eme and no key systems', function(assert) {
  const player = {};
  const sourceKeySystems = null;
  const media = {};
  const audioMedia = {};
  const mainPlaylists = [];

  setupEmeOptions({ player, sourceKeySystems, media, audioMedia, mainPlaylists });

  assert.ok(true, 'no exception');
});

QUnit.test('log error if no eme and we have key systems', function(assert) {
  const sourceKeySystems = {};
  const media = {};
  const audioMedia = {};
  const mainPlaylists = [];
  const src = {};
  const player = {currentSource: () => src};

  let logWarn;
  const origWarn = videojs.log.warn;

  videojs.log.warn = (line) => {
    logWarn = line;
  };

  setupEmeOptions({ player, sourceKeySystems, media, audioMedia, mainPlaylists });

  assert.equal(logWarn, 'DRM encrypted source cannot be decrypted without a DRM plugin', 'logs expected error');
  assert.ok(src.hasOwnProperty('keySystems'), 'source key systems was set');

  videojs.log.warn = origWarn;
});

QUnit.test('no initialize calls if no source key systems', function(assert) {
  let numInitializeCalls = 0;
  const player = { eme: { initializeMediaKeys: () => numInitializeCalls++ } };
  const sourceKeySystems = null;
  const media = {
    attributes: { CODECS: 'avc1.4d400d,mp4a.40.2' },
    contentProtection: { 'com.widevine.alpha': { pssh: new Uint8Array() } }
  };
  const audioMedia = null;
  const mainPlaylists = [media];

  setupEmeOptions({ player, sourceKeySystems, media, audioMedia, mainPlaylists });

  assert.equal(numInitializeCalls, 0, 'no initialize calls');
});

QUnit.test('initializes for muxed playlist', function(assert) {
  let numInitializeCalls = 0;
  const player = {
    eme: { initializeMediaKeys: () => numInitializeCalls++ },
    currentSource: () => {
      return {};
    }
  };
  const sourceKeySystems = {
    'com.widevine.alpha': {
      url: 'license-url'
    }
  };
  const media = {
    attributes: { CODECS: 'avc1.4d400d,mp4a.40.2' },
    contentProtection: { 'com.widevine.alpha': { pssh: new Uint8Array() } }
  };
  const audioMedia = null;
  const mainPlaylists = [media];

  setupEmeOptions({ player, sourceKeySystems, media, audioMedia, mainPlaylists });

  assert.equal(numInitializeCalls, 1, 'one initialize call');
});

QUnit.test('initializes for each playlist for demuxed playlist', function(assert) {
  let numInitializeCalls = 0;
  const player = {
    eme: { initializeMediaKeys: () => numInitializeCalls++ },
    currentSource: () => {
      return {};
    }
  };
  const sourceKeySystems = {
    'com.widevine.alpha': {
      url: 'license-url'
    }
  };
  const media = {
    attributes: { CODECS: 'avc1.4d400d,mp4a.40.2' },
    contentProtection: { 'com.widevine.alpha': { pssh: new Uint8Array() } }
  };
  const audioMedia = {
    attributes: {},
    contentProtection: { 'com.widevine.alpha': { pssh: new Uint8Array() } }
  };
  const mainPlaylists = [media];

  setupEmeOptions({ player, sourceKeySystems, media, audioMedia, mainPlaylists });

  assert.equal(numInitializeCalls, 2, 'two initialize calls');
});

QUnit.test('does not initialize if IE11', function(assert) {
  videojs.browser.IE_VERSION = 11;
  let numInitializeCalls = 0;
  const player = {
    eme: { initializeMediaKeys: () => numInitializeCalls++ },
    currentSource: () => {
      return {};
    }
  };
  const sourceKeySystems = {
    'com.widevine.alpha': {
      url: 'license-url'
    }
  };
  const media = {
    attributes: { CODECS: 'avc1.4d400d,mp4a.40.2' },
    contentProtection: { 'com.widevine.alpha': { pssh: new Uint8Array() } }
  };
  const audioMedia = {
    attributes: {},
    contentProtection: { 'com.widevine.alpha': { pssh: new Uint8Array() } }
  };
  const mainPlaylists = [media];

  setupEmeOptions({ player, sourceKeySystems, media, audioMedia, mainPlaylists });

  assert.equal(numInitializeCalls, 0, 'no initialize calls');
});

QUnit.test('initializes for each playlist', function(assert) {
  let numInitializeCalls = 0;
  const player = {
    eme: { initializeMediaKeys: () => numInitializeCalls++ },
    currentSource: () => {
      return {};
    }
  };
  const sourceKeySystems = {
    'com.widevine.alpha': {
      url: 'license-url'
    }
  };
  const media = {
    attributes: { CODECS: 'avc1.4d400d,mp4a.40.2' },
    contentProtection: { 'com.widevine.alpha': { pssh: new Uint8Array() } }
  };
  const media1 = {
    attributes: { CODECS: 'avc1.4d400d,mp4a.40.2' },
    contentProtection: { 'com.widevine.alpha': { pssh: new Uint8Array() } }
  };
  const audioMedia = {
    attributes: {},
    contentProtection: { 'com.widevine.alpha': { pssh: new Uint8Array() } }
  };
  const mainPlaylists = [media, media1];

  setupEmeOptions({ player, sourceKeySystems, media, audioMedia, mainPlaylists });

  assert.equal(numInitializeCalls, 3, 'three initialize calls');
});

QUnit.test('initializes with correct options for each playlist', function(assert) {
  const initializeCallOptions = [];
  const player = {
    eme: { initializeMediaKeys: (options) => initializeCallOptions.push(options) },
    currentSource: () => {
      return {};
    }
  };
  const sourceKeySystems = {
    'com.widevine.alpha': {
      url: 'license-url'
    },
    'com.microsoft.playready': {
      url: 'license-url'
    }
  };
  const media = {
    attributes: { CODECS: 'avc1.4d400d,mp4a.40.2' },
    contentProtection: {
      'com.widevine.alpha': { pssh: new Uint8Array([0]) },
      'com.microsoft.playready': { pssh: new Uint8Array([1]) }
    }
  };
  const media1 = {
    attributes: { CODECS: 'avc1.4d400d,mp4a.40.2' },
    contentProtection: {
      'com.widevine.alpha': { pssh: new Uint8Array([2]) },
      'com.microsoft.playready': { pssh: new Uint8Array([3]) }
    }
  };
  const audioMedia = {
    attributes: {},
    contentProtection: {
      'com.widevine.alpha': { pssh: new Uint8Array([4]) },
      'com.microsoft.playready': { pssh: new Uint8Array([5]) }
    }
  };
  const mainPlaylists = [media, media1];

  setupEmeOptions({ player, sourceKeySystems, media, audioMedia, mainPlaylists });

  assert.deepEqual(
    initializeCallOptions,
    [{
      keySystems: media.contentProtection
    }, {
      keySystems: media1.contentProtection
    }, {
      keySystems: audioMedia.contentProtection
    }],
    'called with correct values'
  );
});

QUnit.module('getAllPsshKeySystemsOptions');

QUnit.test('empty array if no content proteciton in playlists', function(assert) {
  assert.deepEqual(
    getAllPsshKeySystemsOptions(
      [{}, {}],
      ['com.widevine.alpha', 'com.microsoft.playready']
    ),
    [],
    'returned an empty array'
  );
});

QUnit.test('empty array if no matching key systems in playlists', function(assert) {
  assert.deepEqual(
    getAllPsshKeySystemsOptions(
      [{
        contentProtection: { 'com.widevine.alpha': { pssh: new Uint8Array() } }
      }, {
        contentProtection: { 'com.widevine.alpha': { pssh: new Uint8Array() } }
      }],
      ['com.microsoft.playready']
    ),
    [],
    'returned an empty array'
  );
});

QUnit.test('empty array if no pssh in playlist contentProtection', function(assert) {
  assert.deepEqual(
    getAllPsshKeySystemsOptions(
      [{
        contentProtection: {
          'com.widevine.alpha': {},
          'com.microsoft.playready': {}
        }
      }, {
        contentProtection: {
          'com.widevine.alpha': {},
          'com.microsoft.playready': {}
        }
      }],
      ['com.widevine.alpha', 'com.microsoft.playready']
    ),
    [],
    'returned an empty array'
  );
});

QUnit.test('returns all key systems and pssh values', function(assert) {
  assert.deepEqual(
    getAllPsshKeySystemsOptions(
      [{
        contentProtection: {
          'com.widevine.alpha': {
            pssh: new Uint8Array([0]),
            otherProperty: true
          },
          'com.microsoft.playready': {
            pssh: new Uint8Array([1]),
            otherProperty: true
          }
        }
      }, {
        contentProtection: {
          'com.widevine.alpha': {
            pssh: new Uint8Array([2]),
            otherProperty: true
          },
          'com.microsoft.playready': {
            pssh: new Uint8Array([3]),
            otherProperty: true
          }
        }
      }],
      ['com.widevine.alpha', 'com.microsoft.playready']
    ),
    [{
      'com.widevine.alpha': { pssh: new Uint8Array([0]) },
      'com.microsoft.playready': { pssh: new Uint8Array([1]) }
    }, {
      'com.widevine.alpha': { pssh: new Uint8Array([2]) },
      'com.microsoft.playready': { pssh: new Uint8Array([3]) }
    }],
    'returned key systems and pssh values without other properties'
  );
});
