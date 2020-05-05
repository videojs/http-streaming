import videojs from 'video.js';
import QUnit from 'qunit';
import {
  useFakeEnvironment,
  useFakeMediaSource,
  createPlayer,
  openMediaSource,
  standardXHRResponse
} from './test-helpers.js';
import {
  default as PlaybackWatcher,
  closeToBufferedContent
} from '../src/playback-watcher';
// needed for plugin registration
import '../src/videojs-http-streaming';
import sinon from 'sinon';

let monitorCurrentTime_;

QUnit.module('PlaybackWatcher', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.requests = this.env.requests;
    this.mse = useFakeMediaSource();
    this.clock = this.env.clock;
    this.old = {};

    // setup a player
    this.player = createPlayer({html5: {
      hls: {
        overrideNative: true
      }
    }});
    this.player.muted(true);
    this.player.autoplay(true);
  },

  afterEach() {
    this.env.restore();
    this.mse.restore();
    this.player.dispose();
  }
});

QUnit.test('skips over gap in firefox with waiting event', function(assert) {
  let hlsGapSkipEvents = 0;

  this.player.autoplay(true);

  this.player.tech_.on('usage', (event) => {
    if (event.name === 'hls-gap-skip') {
      hlsGapSkipEvents++;
    }
  });

  // create a buffer with a gap between 10 & 20 seconds
  this.player.tech_.buffered = function() {
    return videojs.createTimeRanges([[0, 10], [20, 30]]);
  };

  // set an arbitrary source
  this.player.src({
    src: 'master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  // start playback normally
  this.player.tech_.triggerReady();
  this.clock.tick(1);
  standardXHRResponse(this.requests.shift());
  openMediaSource(this.player, this.clock);
  this.player.tech_.trigger('canplay');
  this.player.tech_.trigger('play');
  this.player.tech_.trigger('playing');
  this.clock.tick(1);

  assert.equal(hlsGapSkipEvents, 0, 'there is no skipped gap');
  // seek to 10 seconds and wait 12 seconds
  this.player.currentTime(10);
  this.player.tech_.trigger('waiting');
  this.clock.tick(12000);

  // check that player jumped the gap
  assert.equal(
    Math.round(this.player.currentTime()),
    20, 'Player seeked over gap after timer'
  );
  assert.equal(hlsGapSkipEvents, 1, 'there is one skipped gap');
});

QUnit.test('skips over gap in chrome without waiting event', function(assert) {
  let hlsGapSkipEvents = 0;

  this.player.autoplay(true);

  this.player.tech_.on('usage', (event) => {
    if (event.name === 'hls-gap-skip') {
      hlsGapSkipEvents++;
    }
  });

  // create a buffer with a gap between 10 & 20 seconds
  this.player.tech_.buffered = function() {
    return videojs.createTimeRanges([[0, 10], [20, 30]]);
  };

  // set an arbitrary source
  this.player.src({
    src: 'master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  // start playback normally
  this.player.tech_.triggerReady();
  this.clock.tick(1);
  standardXHRResponse(this.requests.shift());
  openMediaSource(this.player, this.clock);
  this.player.tech_.trigger('canplay');
  this.player.tech_.trigger('play');
  this.player.tech_.trigger('playing');
  this.clock.tick(1);

  assert.equal(hlsGapSkipEvents, 0, 'there is no skipped gap');

  // seek to 10 seconds & simulate chrome waiting event
  this.player.currentTime(10);

  this.clock.tick(4000);

  // checks that player doesn't seek before timer expires
  assert.equal(this.player.currentTime(), 10, 'Player doesnt seek over gap pre-timer');
  this.clock.tick(10000);

  // check that player jumped the gap
  assert.equal(
    Math.round(this.player.currentTime()),
    20, 'Player seeked over gap after timer'
  );
  assert.equal(hlsGapSkipEvents, 1, 'there is one skipped gap');
});

QUnit.test('skips over gap in Chrome due to video underflow', function(assert) {
  let hlsVideoUnderflowEvents = 0;

  this.player.autoplay(true);

  this.player.tech_.on('usage', (event) => {
    if (event.name === 'hls-video-underflow') {
      hlsVideoUnderflowEvents++;
    }
  });

  this.player.tech_.buffered = () => {
    return videojs.createTimeRanges([[0, 10], [10.1, 20]]);
  };

  // set an arbitrary source
  this.player.src({
    src: 'master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  // start playback normally
  this.player.tech_.triggerReady();
  this.clock.tick(1);
  standardXHRResponse(this.requests.shift());
  openMediaSource(this.player, this.clock);
  this.player.tech_.trigger('play');
  this.player.tech_.trigger('playing');
  this.clock.tick(1);

  assert.equal(hlsVideoUnderflowEvents, 0, 'no video underflow event got triggered');

  this.player.currentTime(13);

  const seeks = [];

  this.player.vhs.setCurrentTime = (time) => seeks.push(time);

  this.player.tech_.trigger('waiting');

  assert.equal(seeks.length, 1, 'one seek');
  assert.equal(seeks[0], 13, 'player seeked to current time');
  assert.equal(hlsVideoUnderflowEvents, 1, 'triggered a video underflow event');
});

QUnit.test(
  'seek to live point if we fall off the end of a live playlist',
  function(assert) {
  // set an arbitrary live source
    this.player.src({
      src: 'liveStart30sBefore.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    // start playback normally
    this.player.tech_.triggerReady();
    this.clock.tick(1);
    standardXHRResponse(this.requests.shift());
    openMediaSource(this.player, this.clock);
    this.player.tech_.trigger('play');
    this.player.tech_.trigger('playing');
    this.clock.tick(1);

    this.player.currentTime(0);

    const seeks = [];

    this.player.tech_.setCurrentTime = (time) => {
      seeks.push(time);
    };

    this.player.tech_.hls.playbackWatcher_.seekable = () => {
      return videojs.createTimeRanges([[1, 45]]);
    };

    this.player.tech_.trigger('waiting');

    assert.equal(seeks.length, 1, 'one seek');
    assert.equal(seeks[0], 45, 'player seeked to live point');
  }
);

QUnit.test('seeks to current time when stuck inside buffered region', function(assert) {

  // set an arbitrary live source
  this.player.src({
    src: 'liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  // start playback normally
  this.player.tech_.triggerReady();
  this.clock.tick(1);
  standardXHRResponse(this.requests.shift());
  openMediaSource(this.player, this.clock);
  this.player.tech_.trigger('canplay');
  this.player.tech_.trigger('play');
  this.player.tech_.trigger('playing');
  this.clock.tick(1);

  this.player.currentTime(10);

  const seeks = [];

  this.player.tech_.setCurrentTime = (time) => {
    seeks.push(time);
  };

  this.player.tech_.seeking = () => false;
  this.player.tech_.buffered = () => videojs.createTimeRanges([[0, 30]]);
  this.player.tech_.seekable = () => videojs.createTimeRanges([[0, 30]]);
  this.player.tech_.paused = () => false;

  // Playback watcher loop runs on a 250ms clock
  this.clock.tick(250);

  // Loop has run through once, `lastRecordedTime` should have been recorded
  // and `consecutiveUpdates` set to 0 to begin count
  assert.equal(
    this.player.tech_.hls.playbackWatcher_.lastRecordedTime, 10,
    'Playback Watcher stored current time'
  );
  assert.equal(
    this.player.tech_.hls.playbackWatcher_.consecutiveUpdates, 0,
    'consecutiveUpdates set to 0'
  );

  // Playback watcher loop runs on a 250ms clock
  this.clock.tick(250);

  // Loop should increment consecutive updates until it is >= 5
  assert.equal(
    this.player.tech_.hls.playbackWatcher_.consecutiveUpdates, 1,
    'consecutiveUpdates incremented'
  );

  // Playback watcher loop runs on a 250ms clock
  this.clock.tick(250);

  // Loop should increment consecutive updates until it is >= 5
  assert.equal(
    this.player.tech_.hls.playbackWatcher_.consecutiveUpdates, 2,
    'consecutiveUpdates incremented'
  );

  // Playback watcher loop runs on a 250ms clock
  this.clock.tick(250);

  // Loop should increment consecutive updates until it is >= 5
  assert.equal(
    this.player.tech_.hls.playbackWatcher_.consecutiveUpdates, 3,
    'consecutiveUpdates incremented'
  );

  // Playback watcher loop runs on a 250ms clock
  this.clock.tick(250);

  // Loop should increment consecutive updates until it is >= 5
  assert.equal(
    this.player.tech_.hls.playbackWatcher_.consecutiveUpdates, 4,
    'consecutiveUpdates incremented'
  );

  // Playback watcher loop runs on a 250ms clock
  this.clock.tick(250);

  // Loop should increment consecutive updates until it is >= 5
  assert.equal(
    this.player.tech_.hls.playbackWatcher_.consecutiveUpdates, 5,
    'consecutiveUpdates incremented'
  );

  // Playback watcher loop runs on a 250ms clock
  this.clock.tick(250);

  // Loop should see consecutive updates >= 5, call `waiting_`
  assert.equal(
    this.player.tech_.hls.playbackWatcher_.consecutiveUpdates, 0,
    'consecutiveUpdates reset'
  );

  // Playback watcher seeked to currentTime in `waiting_` to correct the `unknownwaiting`
  assert.equal(seeks.length, 1, 'one seek');
  assert.equal(seeks[0], 10, 'player seeked to currentTime');
});

QUnit.test(
  'does not seek to current time when stuck near edge of buffered region',
  function(assert) {
    // set an arbitrary live source
    this.player.src({
      src: 'liveStart30sBefore.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    // start playback normally
    this.player.tech_.triggerReady();
    this.clock.tick(1);
    standardXHRResponse(this.requests.shift());
    openMediaSource(this.player, this.clock);
    this.player.tech_.trigger('canplay');
    this.player.tech_.trigger('play');
    this.player.tech_.trigger('playing');
    this.clock.tick(1);

    this.player.currentTime(29.98);

    const seeks = [];

    this.player.tech_.setCurrentTime = (time) => {
      seeks.push(time);
    };

    this.player.tech_.seeking = () => false;
    this.player.tech_.buffered = () => videojs.createTimeRanges([[0, 30]]);
    this.player.tech_.seekable = () => videojs.createTimeRanges([[0, 30]]);
    this.player.tech_.paused = () => false;

    // Playback watcher loop runs on a 250ms clock
    this.clock.tick(250);

    // Loop has run through once, `lastRecordedTime` should have been recorded
    // and `consecutiveUpdates` set to 0 to begin count
    assert.equal(
      this.player.tech_.hls.playbackWatcher_.lastRecordedTime, 29.98,
      'Playback Watcher stored current time'
    );
    assert.equal(
      this.player.tech_.hls.playbackWatcher_.consecutiveUpdates, 0,
      'consecutiveUpdates set to 0'
    );

    // Playback watcher loop runs on a 250ms clock
    this.clock.tick(250);

    // Loop has run through a second time, should detect that currentTime hasn't made
    // progress while at the end of the buffer. Since the currentTime is at the end of the
    // buffer, `consecutiveUpdates` should not be incremented
    assert.equal(
      this.player.tech_.hls.playbackWatcher_.lastRecordedTime, 29.98,
      'Playback Watcher stored current time'
    );
    assert.equal(
      this.player.tech_.hls.playbackWatcher_.consecutiveUpdates, 0,
      'consecutiveUpdates should still be 0'
    );

    // no corrective seek
    assert.equal(seeks.length, 0, 'no seek');
  }
);

QUnit.test('fires notifications when activated', function(assert) {
  let buffered = [[]];
  const seekable = [[]];
  let currentTime = 0;
  let hlsLiveResyncEvents = 0;
  let hlsVideoUnderflowEvents = 0;

  this.player.src({
    src: 'liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.player.tech_.triggerReady();
  this.clock.tick(1);
  this.player.tech_.currentTime = function() {
    return currentTime;
  };
  this.player.tech_.buffered = function() {
    return {
      length: buffered.length,
      start(i) {
        return buffered[i][0];
      },
      end(i) {
        return buffered[i][1];
      }
    };
  };
  const playbackWatcher = this.player.tech_.hls.playbackWatcher_;

  playbackWatcher.seekable = function() {
    return {
      length: seekable.length,
      start(i) {
        return seekable[i][0];
      },
      end(i) {
        return seekable[i][1];
      }
    };
  };
  this.player.tech_.on('usage', (event) => {
    if (event.name === 'hls-live-resync') {
      hlsLiveResyncEvents++;
    }
    if (event.name === 'hls-video-underflow') {
      hlsVideoUnderflowEvents++;
    }
  });

  currentTime = 19;
  seekable[0] = [20, 30];
  playbackWatcher.waiting_();
  assert.equal(hlsLiveResyncEvents, 1, 'triggered a liveresync event');

  currentTime = 12;
  seekable[0] = [0, 100];
  buffered = [[0, 9], [10, 20]];
  playbackWatcher.waiting_();
  assert.equal(hlsVideoUnderflowEvents, 1, 'triggered a videounderflow event');
  assert.equal(hlsLiveResyncEvents, 1, 'did not trigger an additional liveresync event');
});

QUnit.test('fixes bad seeks', function(assert) {
  // set an arbitrary live source
  this.player.src({
    src: 'liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  // start playback normally
  this.player.tech_.triggerReady();
  this.clock.tick(1);
  standardXHRResponse(this.requests.shift());
  openMediaSource(this.player, this.clock);
  this.player.tech_.trigger('play');
  this.player.tech_.trigger('playing');
  this.clock.tick(1);

  const playbackWatcher = this.player.tech_.hls.playbackWatcher_;
  const seeks = [];
  let seekable;
  let seeking;
  let currentTime;

  playbackWatcher.seekable = () => seekable;
  playbackWatcher.tech_ = {
    off: () => {},
    seeking: () => seeking,
    currentTime: () => currentTime,
    buffered: () => videojs.createTimeRanges()
  };
  this.player.vhs.setCurrentTime = (time) => seeks.push(time);

  currentTime = 50;
  seekable = videojs.createTimeRanges([[1, 45]]);
  seeking = false;
  assert.ok(!playbackWatcher.fixesBadSeeks_(), 'does nothing when not seeking');
  assert.equal(seeks.length, 0, 'did not seek');

  seeking = true;
  assert.ok(playbackWatcher.fixesBadSeeks_(), 'acts when seek past seekable range');
  assert.equal(seeks.length, 1, 'seeked');
  assert.equal(seeks[0], 45, 'player seeked to live point');

  currentTime = 0;
  assert.ok(playbackWatcher.fixesBadSeeks_(), 'acts when seek before seekable range');
  assert.equal(seeks.length, 2, 'seeked');
  assert.equal(seeks[1], 1.1, 'player seeked to start of the live window');

  currentTime = 30;
  assert.ok(!playbackWatcher.fixesBadSeeks_(), 'does nothing when time within range');
  assert.equal(seeks.length, 2, 'did not seek');
});

QUnit.test('corrects seek outside of seekable', function(assert) {
  // set an arbitrary live source
  this.player.src({
    src: 'liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  // start playback normally
  this.player.tech_.triggerReady();
  this.clock.tick(1);
  standardXHRResponse(this.requests.shift());
  openMediaSource(this.player, this.clock);
  this.player.tech_.trigger('play');
  this.player.tech_.trigger('playing');
  this.clock.tick(1);

  const playbackWatcher = this.player.tech_.hls.playbackWatcher_;
  const seeks = [];
  let seekable;
  let seeking;
  let currentTime;

  playbackWatcher.seekable = () => seekable;
  playbackWatcher.tech_ = {
    off: () => {},
    seeking: () => seeking,
    currentTime: () => currentTime,
    // mocked out
    paused: () => false,
    buffered: () => videojs.createTimeRanges()
  };
  this.player.vhs.setCurrentTime = (time) => seeks.push(time);

  // waiting

  currentTime = 50;
  seekable = videojs.createTimeRanges([[1, 45]]);
  seeking = true;
  this.player.tech_.trigger('waiting');
  assert.equal(seeks.length, 1, 'seeked');
  assert.equal(seeks[0], 45, 'player seeked to live point');

  currentTime = 0;
  this.player.tech_.trigger('waiting');
  assert.equal(seeks.length, 2, 'seeked');
  assert.equal(seeks[1], 1.1, 'player seeked to start of the live window');

  // inside of seekable range
  currentTime = 10;
  this.player.tech_.trigger('waiting');
  assert.equal(seeks.length, 2, 'did not seek');

  currentTime = 50;
  // if we're not seeking, the case shouldn't be handled here
  seeking = false;
  this.player.tech_.trigger('waiting');
  assert.equal(seeks.length, 2, 'did not seek');

  // no check for 0 with seeking false because that should be handled by live falloff

  // checkCurrentTime

  seeking = true;
  currentTime = 50;
  playbackWatcher.checkCurrentTime_();
  assert.equal(seeks.length, 3, 'seeked');
  assert.equal(seeks[2], 45, 'player seeked to live point');

  currentTime = 0;
  playbackWatcher.checkCurrentTime_();
  assert.equal(seeks.length, 4, 'seeked');
  assert.equal(seeks[3], 1.1, 'player seeked to live point');

  currentTime = 10;
  playbackWatcher.checkCurrentTime_();
  assert.equal(seeks.length, 4, 'did not seek');

  seeking = false;
  currentTime = 50;
  playbackWatcher.checkCurrentTime_();
  assert.equal(seeks.length, 4, 'did not seek');

  currentTime = 0;
  playbackWatcher.checkCurrentTime_();
  assert.equal(seeks.length, 4, 'did not seek');
});

QUnit.test(
  'corrected seeks respect allowSeeksWithinUnsafeLiveWindow flag',
  function(assert) {
  // set an arbitrary live source
    this.player.src({
      src: 'liveStart30sBefore.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    // start playback normally
    this.player.tech_.triggerReady();
    this.clock.tick(1);
    standardXHRResponse(this.requests.shift());
    openMediaSource(this.player, this.clock);
    this.player.tech_.trigger('play');
    this.player.tech_.trigger('playing');
    this.clock.tick(1);

    const playbackWatcher = this.player.tech_.hls.playbackWatcher_;
    const seeks = [];
    let seekable;
    let seeking;
    let currentTime;

    playbackWatcher.seekable = () => seekable;
    playbackWatcher.tech_ = {
      off: () => {},
      seeking: () => seeking,
      currentTime: () => currentTime,
      // mocked out
      paused: () => false,
      buffered: () => videojs.createTimeRanges()
    };
    this.player.vhs.setCurrentTime = (time) => seeks.push(time);

    playbackWatcher.allowSeeksWithinUnsafeLiveWindow = true;

    // waiting

    seekable = videojs.createTimeRanges([[1, 45]]);
    seeking = true;

    // target duration of 10, seekable end of 45
    // 45 + 3 * 10 = 75
    currentTime = 75;
    this.player.tech_.trigger('waiting');
    assert.equal(seeks.length, 0, 'did not seek');

    currentTime = 75.1;
    this.player.tech_.trigger('waiting');
    assert.equal(seeks.length, 1, 'seeked');
    assert.equal(seeks[0], 45, 'player seeked to live point');

    playbackWatcher.allowSeeksWithinUnsafeLiveWindow = true;

    currentTime = 75;
    this.player.tech_.trigger('waiting');
    assert.equal(seeks.length, 1, 'did not seek');
  }
);

QUnit.test('calls fixesBadSeeks_ on seekablechanged', function(assert) {
  // set an arbitrary live source
  this.player.src({
    src: 'liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  // start playback normally
  this.player.tech_.triggerReady();
  this.clock.tick(1);
  standardXHRResponse(this.requests.shift());
  openMediaSource(this.player, this.clock);
  this.player.tech_.trigger('play');
  this.player.tech_.trigger('playing');
  this.clock.tick(1);

  const playbackWatcher = this.player.tech_.hls.playbackWatcher_;
  let fixesBadSeeks_ = 0;

  playbackWatcher.fixesBadSeeks_ = () => fixesBadSeeks_++;

  this.player.tech_.trigger('seekablechanged');

  assert.equal(fixesBadSeeks_, 1, 'fixesBadSeeks_ was called');
});

QUnit.test('jumps to buffered content if seeking just before', function(assert) {
  // target duration is 10 for this manifest
  this.player.src({
    src: 'liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  // start playback normally
  this.player.tech_.triggerReady();
  this.clock.tick(1);
  standardXHRResponse(this.requests.shift());
  openMediaSource(this.player, this.clock);
  this.player.tech_.trigger('play');
  this.player.tech_.trigger('playing');
  this.clock.tick(1);

  const playbackWatcher = this.player.tech_.hls.playbackWatcher_;
  const seeks = [];
  let currentTime;
  let buffered;

  playbackWatcher.seekable = () => videojs.createTimeRanges([[10, 100]]);
  playbackWatcher.tech_ = {
    off: () => {},
    seeking: () => true,
    currentTime: () => currentTime,
    buffered: () => buffered
  };
  this.player.vhs.setCurrentTime = (time) => seeks.push(time);

  currentTime = 10;
  // target duration is 10
  buffered = videojs.createTimeRanges([[20, 39]]);
  assert.notOk(playbackWatcher.fixesBadSeeks_(), 'does nothing when too far from buffer');
  assert.equal(seeks.length, 0, 'did not seek');

  buffered = videojs.createTimeRanges([[19, 38.9]]);
  assert.notOk(playbackWatcher.fixesBadSeeks_(), 'does nothing when not enough buffer');
  assert.equal(seeks.length, 0, 'did not seek');

  buffered = videojs.createTimeRanges([[19, 39]]);
  assert.ok(
    playbackWatcher.fixesBadSeeks_(),
    'acts when close enough to, and enough, buffer'
  );
  assert.equal(seeks.length, 1, 'seeked');
  assert.equal(seeks[0], 19.1, 'player seeked to start of buffer');

  currentTime = 20;
  assert.notOk(
    playbackWatcher.fixesBadSeeks_(),
    'does nothing when current time after buffer start'
  );
  assert.equal(seeks.length, 1, 'did not seek');

  // defers to fixing the bad seek over seeking into the buffer when seeking outside of
  // seekable range
  currentTime = 10;
  playbackWatcher.seekable = () => videojs.createTimeRanges([[11, 100]]);
  assert.ok(playbackWatcher.fixesBadSeeks_(), 'fixed bad seek');
  assert.equal(seeks.length, 2, 'seeked');
  assert.equal(seeks[1], 11.1, 'seeked to seekable range');
});

const loaderTypes = ['audio', 'main', 'subtitle'];

QUnit.module('PlaybackWatcher download detection', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.requests = this.env.requests;
    this.mse = useFakeMediaSource();
    this.clock = this.env.clock;
    this.old = {};

    this.respondToPlaylists_ = () => {
      const regex = (/\.(m3u8|mpd)/i);

      while (this.requests.some((r) => regex.test(r.uri))) {
        for (let i = this.requests.length - 1; i >= 0; i--) {
          const r = this.requests[i];

          if (regex.test(r.uri)) {
            this.requests.splice(i, 1);
            standardXHRResponse(r);
          }
        }
      }
    };

    this.setup = function(src = {src: 'media.m3u8', type: 'application/vnd.apple.mpegurl'}) {
      // setup a player
      this.player = createPlayer({html5: {
        hls: {
          overrideNative: true
        }
      }});
      this.player.muted(true);
      this.player.autoplay(true);

      // set an arbitrary source
      this.player.src(src);

      // start playback normally
      this.player.tech_.triggerReady();
      this.clock.tick(1);
      standardXHRResponse(this.requests.shift());
      openMediaSource(this.player, this.clock);
      this.player.tech_.trigger('play');
      this.player.tech_.trigger('playing');
      this.clock.tick(1);

      this.respondToPlaylists_();

      this.usageEvents = {};
      this.mpcErrors = 0;

      this.playbackWatcher = this.player.vhs.playbackWatcher_;
      this.mpc = this.player.vhs.masterPlaylistController_;
      this.mpc.on('error', () => this.mpcErrors++);

      this.player.tech_.on('usage', (event) => {
        const name = event.name;

        this.usageEvents[name] = this.usageEvents[name] || 0;
        this.usageEvents[name]++;
      });

      this.setBuffered = (val) => {
        this.player.buffered = () => val;
        loaderTypes.forEach((type) => {
          this.mpc[`${type}SegmentLoader_`].buffered_ = () => val;
        });
      };

    };
  },

  afterEach() {
    this.env.restore();
    this.mse.restore();
    this.player.dispose();
  }
});

loaderTypes.forEach(function(type) {
  QUnit.test(`detects ${type} appends without buffer changes and excludes`, function(assert) {
    this.setup();
    const loader = this.mpc[`${type}SegmentLoader_`];
    const track = {label: 'foobar', mode: 'showing'};

    if (type === 'subtitle') {
      loader.track = () => track;
      sinon.stub(this.player.tech_.textTracks(), 'removeTrack');
    }

    this.setBuffered(videojs.createTimeRanges([[0, 30]]));
    loader.trigger('updateend');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 0, '1st append 0 stalled downloads');
    assert.deepEqual(this.usageEvents, {}, 'no usage events');

    loader.trigger('updateend');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 1, '2nd append 1 stalled downloads');
    assert.deepEqual(this.usageEvents, {}, 'no usage events');

    loader.trigger('updateend');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 2, '3rd append 2 stalled downloads');
    assert.deepEqual(this.usageEvents, {}, 'no usage events');

    loader.trigger('updateend');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 0, '4th append 0 stalled downloads');

    const expectedUsage = {};

    expectedUsage[`vhs-${type}-download-exclusion`] = 1;

    if (type !== 'subtitle') {
      expectedUsage['hls-rendition-blacklisted'] = 1;
    }

    assert.deepEqual(this.usageEvents, expectedUsage, 'usage as expected');

    if (type !== 'subtitle') {
      const message = 'Playback cannot continue. No available working or supported playlists.';

      assert.equal(this.mpcErrors, 1, 'one mpc error');
      assert.equal(this.mpc.error, message, 'mpc error set');
      assert.equal(this.player.error().message, message, 'player error set');
      assert.equal(this.env.log.error.callCount, 1, 'player error logged');
      assert.equal(this.env.log.error.args[0][1], message, 'error message as expected');

      this.env.log.error.resetHistory();
    } else {
      const message = 'Text track "foobar" is not working correctly. It will be disabled and excluded.';

      assert.equal(this.mpcErrors, 0, 'no mpc error set');
      assert.notOk(this.player.error(), 'no player error set');
      assert.equal(this.player.textTracks().removeTrack.callCount, 1, 'text track remove called');
      assert.equal(this.player.textTracks().removeTrack.args[0][0], track, 'text track remove called with expected');
      assert.equal(track.mode, 'disabled', 'mode set to disabled now');
      assert.equal(this.env.log.warn.callCount, 1, 'warning logged');
      assert.equal(this.env.log.warn.args[0][0], message, 'warning message as expected');

      this.env.log.warn.resetHistory();
    }
  });

  if (type !== 'subtitle') {
    QUnit.test(`detects ${type} appends without buffer changes and excludes many playlists`, function(assert) {
      this.setup({src: 'multipleAudioGroupsCombinedMain.m3u8', type: 'application/vnd.apple.mpegurl'});

      const loader = this.mpc[`${type}SegmentLoader_`];
      const playlists = this.mpc.master().playlists;
      const excludeAndVerify = () => {
        loader.trigger('updateend');
        assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 1, '1st append 1 stalled downloads');
        assert.deepEqual(this.usageEvents, {}, 'no usage events');

        loader.trigger('updateend');
        assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 2, '2nd append 1 stalled downloads');
        assert.deepEqual(this.usageEvents, {}, 'no usage events');

        const oldPlaylist = this.mpc.media();

        loader.trigger('updateend');
        assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 0, '3rd append 0 stalled downloads');

        const expectedUsage = {};

        expectedUsage[`vhs-${type}-download-exclusion`] = 1;
        expectedUsage['hls-rendition-blacklisted'] = 1;

        assert.deepEqual(this.usageEvents, expectedUsage, 'usage as expected');
        this.usageEvents = {};

        this.respondToPlaylists_();

        const otherPlaylistsLeft = this.mpc.master().playlists.some((p) => p.excludeUntil !== Infinity);

        if (otherPlaylistsLeft) {
          const message = `Problem encountered with playlist ${oldPlaylist.id}.` +
            ` Infinite ${type} segment downloading detected.` +
            ` Switching to playlist ${this.mpc.media().id}.`;

          assert.equal(this.mpcErrors, 0, 'no mpc error');
          assert.notOk(this.mpc.error, 'no mpc error set');
          assert.notOk(this.player.error(), 'player error not set');
          assert.equal(this.env.log.warn.callCount, 1, 'player warning logged');
          assert.equal(this.env.log.warn.args[0][0], message, 'warning message as expected');

          this.env.log.warn.resetHistory();
        } else {
          const message = 'Playback cannot continue. No available working or supported playlists.';

          assert.equal(this.mpcErrors, 1, 'one mpc error');
          assert.equal(this.mpc.error, message, 'mpc error set');
          assert.equal(this.player.error().message, message, 'player error set');
          assert.equal(this.env.log.error.callCount, 1, 'player error logged');
          assert.equal(this.env.log.error.args[0][1], message, 'error message as expected');

          this.env.log.error.resetHistory();
        }
      };

      this.setBuffered(videojs.createTimeRanges([[0, 30]]));
      loader.trigger('updateend');
      assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 0, 'initial append 0 stalled downloads');
      assert.deepEqual(this.usageEvents, {}, 'no usage events');
      let i = playlists.length;

      // exclude all playlists and verify
      while (i--) {
        excludeAndVerify();
      }

    });
  }

  QUnit.test(`resets ${type} exclusion on playlist-update, tech seeking, tech seeked`, function(assert) {
    this.setup();
    const loader = this.mpc[`${type}SegmentLoader_`];

    this.setBuffered(videojs.createTimeRanges([[0, 30]]));
    loader.trigger('updateend');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 0, '1st append 0 stalled downloads');
    assert.deepEqual(this.usageEvents, {}, 'no usage events');

    loader.trigger('updateend');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 1, '2nd append 1 stalled downloads');
    assert.deepEqual(this.usageEvents, {}, 'no usage events');

    loader.trigger('playlist-update');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 0, '0 stalled downloads after playlist-update');
    assert.deepEqual(this.usageEvents, {}, 'no usage events');

    loader.trigger('updateend');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 1, '1st append 1 stalled downloads');
    assert.deepEqual(this.usageEvents, {}, 'no usage events');

    loader.trigger('updateend');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 2, '2nd append 2 stalled downloads');
    assert.deepEqual(this.usageEvents, {}, 'no usage events');

    this.player.tech_.trigger('seeking');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 0, '0 stalled downloads after playlist-update');
    assert.deepEqual(this.usageEvents, {}, 'no usage events');

    loader.trigger('updateend');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 1, '1st append 1 stalled downloads');
    assert.deepEqual(this.usageEvents, {}, 'no usage events');

    loader.trigger('updateend');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 2, '2nd append 2 stalled downloads');
    assert.deepEqual(this.usageEvents, {}, 'no usage events');

    this.player.tech_.trigger('seeked');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 0, '0 stalled downloads after playlist-update');
    assert.deepEqual(this.usageEvents, {}, 'no usage events');

    loader.trigger('updateend');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 1, '1st append 1 stalled downloads');
    assert.deepEqual(this.usageEvents, {}, 'no usage events');

    loader.trigger('updateend');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 2, '2nd append 2 stalled downloads');
    assert.deepEqual(this.usageEvents, {}, 'no usage events');
  });

  QUnit.test(`Resets ${type} exclusion on buffered change`, function(assert) {
    this.setup();
    const loader = this.mpc[`${type}SegmentLoader_`];

    this.setBuffered(videojs.createTimeRanges([[0, 30]]));
    loader.trigger('updateend');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 0, '1st append 0 stalled downloads');
    assert.deepEqual(this.usageEvents, {}, 'no usage events');

    loader.trigger('updateend');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 1, '2nd append 1 stalled downloads');
    assert.deepEqual(this.usageEvents, {}, 'no usage events');

    this.setBuffered(videojs.createTimeRanges([[0, 31]]));
    loader.trigger('updateend');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 0, '1st append 0 stalled downloads');
    assert.deepEqual(this.usageEvents, {}, 'no usage events');

    loader.trigger('updateend');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 1, '2nd append 1 stalled downloads');
    assert.deepEqual(this.usageEvents, {}, 'no usage events');
  });
});

QUnit.module('PlaybackWatcher isolated functions', {
  beforeEach() {
    monitorCurrentTime_ = PlaybackWatcher.prototype.monitorCurrentTime_;
    PlaybackWatcher.prototype.monitorCurrentTime_ = () => {};
    this.playbackWatcher = new PlaybackWatcher({
      tech: {
        on: () => {},
        off: () => {},
        // needed to construct a playback watcher
        options_: {
          playerId: 'mock-player-id'
        }
      },
      masterPlaylistController: {
        mainSegmentLoader_: Object.assign(new videojs.EventTarget(), {buffered_: () => videojs.createTimeRanges()}),
        audioSegmentLoader_: Object.assign(new videojs.EventTarget(), {buffered_: () => videojs.createTimeRanges()}),
        subtitleSegmentLoader_: Object.assign(new videojs.EventTarget(), {buffered_: () => videojs.createTimeRanges()})
      }
    });
  },
  afterEach() {
    this.playbackWatcher.dispose();
    PlaybackWatcher.prototype.monitorCurrentTime_ = monitorCurrentTime_;
  }
});

QUnit.test('skips gap from video underflow', function(assert) {
  assert.equal(
    this.playbackWatcher.gapFromVideoUnderflow_(videojs.createTimeRanges(), 0),
    null,
    'returns null when buffer is empty'
  );
  assert.equal(
    this.playbackWatcher.gapFromVideoUnderflow_(videojs.createTimeRanges([[0, 10]]), 13),
    null,
    'returns null when there is only a previous buffer'
  );
  assert.equal(
    this.playbackWatcher.gapFromVideoUnderflow_(videojs.createTimeRanges([[0, 10], [10.1, 20]]), 15),
    null,
    'returns null when gap is too far from current time'
  );
  assert.equal(
    this.playbackWatcher.gapFromVideoUnderflow_(videojs.createTimeRanges([[0, 10], [10.1, 20]]), 9.9),
    null,
    'returns null when gap is after current time'
  );
  assert.equal(
    this.playbackWatcher.gapFromVideoUnderflow_(videojs.createTimeRanges([[0, 10.1], [10.2, 20]]), 12.1),
    null,
    'returns null when time is less than or equal to 2 seconds ahead'
  );
  assert.equal(
    this.playbackWatcher.gapFromVideoUnderflow_(videojs.createTimeRanges([[0, 10], [10.1, 20]]), 14.1),
    null,
    'returns null when time is greater than or equal to 4 seconds ahead'
  );
  assert.deepEqual(
    this.playbackWatcher.gapFromVideoUnderflow_(videojs.createTimeRanges([[0, 10], [10.1, 20]]), 12.2),
    {start: 10, end: 10.1},
    'returns gap when gap is small and time is greater than 2 seconds ahead in a buffer'
  );
  assert.deepEqual(
    this.playbackWatcher.gapFromVideoUnderflow_(videojs.createTimeRanges([[0, 10], [10.1, 20]]), 13),
    {start: 10, end: 10.1},
    'returns gap when gap is small and time is 3 seconds ahead in a buffer'
  );
  assert.deepEqual(
    this.playbackWatcher.gapFromVideoUnderflow_(videojs.createTimeRanges([[0, 10], [10.1, 20]]), 13.9),
    {start: 10, end: 10.1},
    'returns gap when gap is small and time is less than 4 seconds ahead in a buffer'
  );
  // In a case where current time is outside of the buffered range, something odd must've
  // happened, but we should still allow the player to try to continue from that spot.
  assert.deepEqual(
    this.playbackWatcher.gapFromVideoUnderflow_(videojs.createTimeRanges([[0, 10], [10.1, 12.9]]), 13),
    {start: 10, end: 10.1},
    'returns gap even when current time is not in buffered range'
  );
});

QUnit.test('detects live window falloff', function(assert) {
  const beforeSeekableWindow_ =
    this.playbackWatcher.beforeSeekableWindow_.bind(this.playbackWatcher);

  assert.ok(
    beforeSeekableWindow_(videojs.createTimeRanges([[11, 20]]), 10),
    'true if playlist live and current time before seekable'
  );

  assert.ok(
    !beforeSeekableWindow_(videojs.createTimeRanges([]), 10),
    'false if no seekable range'
  );
  assert.ok(
    !beforeSeekableWindow_(videojs.createTimeRanges([[0, 10]]), -1),
    'false if seekable range starts at 0'
  );
  assert.ok(
    !beforeSeekableWindow_(videojs.createTimeRanges([[11, 20]]), 11),
    'false if current time at seekable start'
  );
  assert.ok(
    !beforeSeekableWindow_(videojs.createTimeRanges([[11, 20]]), 20),
    'false if current time at seekable end'
  );
  assert.ok(
    !beforeSeekableWindow_(videojs.createTimeRanges([[11, 20]]), 15),
    'false if current time within seekable range'
  );
  assert.ok(
    !beforeSeekableWindow_(videojs.createTimeRanges([[11, 20]]), 21),
    'false if current time past seekable range'
  );
  assert.ok(
    beforeSeekableWindow_(videojs.createTimeRanges([[11, 20]]), 0),
    'true if current time is 0 and earlier than seekable range'
  );
});

QUnit.test('detects beyond seekable window for VOD', function(assert) {
  const playlist = {
    endList: true,
    targetDuration: 7
  };
  const afterSeekableWindow_ =
    this.playbackWatcher.afterSeekableWindow_.bind(this.playbackWatcher);

  assert.notOk(
    afterSeekableWindow_(videojs.createTimeRanges([[11, 20]]), 10.8, playlist),
    'false if before seekable range'
  );
  assert.ok(
    afterSeekableWindow_(videojs.createTimeRanges([[11, 20]]), 20.2, playlist),
    'true if after seekable range'
  );
  assert.notOk(
    afterSeekableWindow_(videojs.createTimeRanges([[11, 20]]), 10.9, playlist),
    'false if within starting seekable range buffer'
  );
  assert.notOk(
    afterSeekableWindow_(videojs.createTimeRanges([[11, 20]]), 20.1, playlist),
    'false if within ending seekable range buffer'
  );

  assert.notOk(
    afterSeekableWindow_(videojs.createTimeRanges(), 10, playlist),
    'false if no seekable range'
  );
  assert.notOk(
    afterSeekableWindow_(videojs.createTimeRanges([[0, 10]]), -0.2, playlist),
    'false if current time is negative'
  );
  assert.notOk(
    afterSeekableWindow_(videojs.createTimeRanges([[0, 10]]), 5, playlist),
    'false if within seekable range'
  );
  assert.notOk(
    afterSeekableWindow_(videojs.createTimeRanges([[0, 10]]), 0, playlist),
    'false if within seekable range'
  );
  assert.notOk(
    afterSeekableWindow_(videojs.createTimeRanges([[0, 10]]), 10, playlist),
    'false if within seekable range'
  );
});

QUnit.test('detects beyond seekable window for LIVE', function(assert) {
  // no endList means live
  const playlist = {
    targetDuration: 7
  };
  const afterSeekableWindow_ =
    this.playbackWatcher.afterSeekableWindow_.bind(this.playbackWatcher);

  assert.notOk(
    afterSeekableWindow_(videojs.createTimeRanges([[11, 20]]), 10.8, playlist),
    'false if before seekable range'
  );
  assert.ok(
    afterSeekableWindow_(videojs.createTimeRanges([[11, 20]]), 20.2, playlist),
    'true if after seekable range'
  );
  assert.notOk(
    afterSeekableWindow_(videojs.createTimeRanges([[11, 20]]), 10.9, playlist),
    'false if within starting seekable range buffer'
  );
  assert.notOk(
    afterSeekableWindow_(videojs.createTimeRanges([[11, 20]]), 20.1, playlist),
    'false if within ending seekable range buffer'
  );

  assert.notOk(
    afterSeekableWindow_(videojs.createTimeRanges(), 10, playlist),
    'false if no seekable range'
  );
  assert.notOk(
    afterSeekableWindow_(videojs.createTimeRanges([[0, 10]]), -0.2, playlist),
    'false if current time is negative'
  );
  assert.notOk(
    afterSeekableWindow_(videojs.createTimeRanges([[0, 10]]), 5, playlist),
    'false if within seekable range'
  );
  assert.notOk(
    afterSeekableWindow_(videojs.createTimeRanges([[0, 10]]), 0, playlist),
    'false if within seekable range'
  );
  assert.notOk(
    afterSeekableWindow_(videojs.createTimeRanges([[0, 10]]), 10, playlist),
    'false if within seekable range'
  );
});

QUnit.test('respects allowSeeksWithinUnsafeLiveWindow flag', function(assert) {
  // no endList means live
  const playlist = {
    targetDuration: 7
  };
  const afterSeekableWindow_ =
    this.playbackWatcher.afterSeekableWindow_.bind(this.playbackWatcher);

  assert.notOk(
    afterSeekableWindow_(videojs.createTimeRanges([[11, 20]]), 10.8, playlist, true),
    'false if before seekable range'
  );
  assert.notOk(
    afterSeekableWindow_(videojs.createTimeRanges([[11, 20]]), 20.2, playlist, true),
    'false if after seekable range but within unsafe live window'
  );
  assert.notOk(
    afterSeekableWindow_(videojs.createTimeRanges([[11, 20]]), 40.9, playlist, true),
    'false if after seekable range but within unsafe live window'
  );
  assert.ok(
    afterSeekableWindow_(videojs.createTimeRanges([[11, 20]]), 41.1, playlist, true),
    'true if after seekable range and unsafe live window'
  );
  assert.notOk(
    afterSeekableWindow_(videojs.createTimeRanges([[11, 20]]), 10.9, playlist, true),
    'false if within starting seekable range buffer'
  );
  assert.notOk(
    afterSeekableWindow_(videojs.createTimeRanges([[11, 20]]), 20.1, playlist, true),
    'false if within ending seekable range buffer'
  );

  assert.notOk(
    afterSeekableWindow_(videojs.createTimeRanges(), 10, playlist, true),
    'false if no seekable range'
  );
  assert.notOk(
    afterSeekableWindow_(videojs.createTimeRanges([[0, 10]]), -0.2, playlist, true),
    'false if current time is negative'
  );
  assert.notOk(
    afterSeekableWindow_(videojs.createTimeRanges([[0, 10]]), 5, playlist, true),
    'false if within seekable range'
  );
  assert.notOk(
    afterSeekableWindow_(videojs.createTimeRanges([[0, 10]]), 0, playlist, true),
    'false if within seekable range'
  );
  assert.notOk(
    afterSeekableWindow_(videojs.createTimeRanges([[0, 10]]), 10, playlist, true),
    'false if within seekable range'
  );

  playlist.endList = true;

  assert.notOk(
    afterSeekableWindow_(videojs.createTimeRanges([[11, 20]]), 10.8, playlist, true),
    'false if before seekable range'
  );
  assert.ok(
    afterSeekableWindow_(videojs.createTimeRanges([[11, 20]]), 20.2, playlist, true),
    'true if after seekable range'
  );
  assert.notOk(
    afterSeekableWindow_(videojs.createTimeRanges([[11, 20]]), 10.9, playlist, true),
    'false if within starting seekable range buffer'
  );
  assert.notOk(
    afterSeekableWindow_(videojs.createTimeRanges([[11, 20]]), 20.1, playlist, true),
    'false if within ending seekable range buffer'
  );

  assert.notOk(
    afterSeekableWindow_(videojs.createTimeRanges(), 10, playlist, true),
    'false if no seekable range'
  );
  assert.notOk(
    afterSeekableWindow_(videojs.createTimeRanges([[0, 10]]), -0.2, playlist, true),
    'false if current time is negative'
  );
  assert.notOk(
    afterSeekableWindow_(videojs.createTimeRanges([[0, 10]]), 5, playlist, true),
    'false if within seekable range'
  );
  assert.notOk(
    afterSeekableWindow_(videojs.createTimeRanges([[0, 10]]), 0, playlist, true),
    'false if within seekable range'
  );
  assert.notOk(
    afterSeekableWindow_(videojs.createTimeRanges([[0, 10]]), 10, playlist, true),
    'false if within seekable range'
  );
});

QUnit.module('closeToBufferedContent');

QUnit.test('false if no buffer', function(assert) {
  assert.notOk(
    closeToBufferedContent({
      buffered: videojs.createTimeRanges(),
      targetDuration: 4,
      currentTime: 10
    }),
    'returned false'
  );
});

QUnit.test('false if buffer less than two times target duration', function(assert) {
  assert.notOk(
    closeToBufferedContent({
      buffered: videojs.createTimeRanges([[11, 18.9]]),
      targetDuration: 4,
      currentTime: 10
    }),
    'returned false'
  );
});

QUnit.test('false if buffer is beyond target duration from current time', function(assert) {
  assert.notOk(
    closeToBufferedContent({
      buffered: videojs.createTimeRanges([[14.1, 30]]),
      targetDuration: 4,
      currentTime: 10
    }),
    'returned false'
  );
});

QUnit.test('true if enough buffer and close to current time', function(assert) {
  assert.ok(
    closeToBufferedContent({
      buffered: videojs.createTimeRanges([[13.9, 22]]),
      targetDuration: 4,
      currentTime: 10
    }),
    'returned true'
  );
});

QUnit.test('false if current time beyond buffer start', function(assert) {
  assert.notOk(
    closeToBufferedContent({
      buffered: videojs.createTimeRanges([[13.9, 22]]),
      targetDuration: 4,
      currentTime: 14
    }),
    'returned false'
  );
});
