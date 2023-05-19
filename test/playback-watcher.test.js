import videojs from 'video.js';
import QUnit from 'qunit';
import {
  useFakeEnvironment,
  useFakeMediaSource,
  createPlayer,
  openMediaSource,
  standardXHRResponse
} from './test-helpers.js';
import {default as PlaybackWatcher} from '../src/playback-watcher';
// needed for plugin registration
import '../src/videojs-http-streaming';
import { SAFE_TIME_DELTA } from '../src/ranges';
import {createTimeRanges} from '../src/util/vjs-compat';

let monitorCurrentTime_;

QUnit.module('PlaybackWatcher', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.requests = this.env.requests;
    this.mse = useFakeMediaSource();
    this.clock = this.env.clock;
    this.old = {};

    // setup a player
    this.player = createPlayer({
      html5: {
        vhs: {
          overrideNative: true
        }
      }
    });
    this.player.muted(true);
    this.player.autoplay(true);
  },

  afterEach() {
    this.env.restore();
    this.mse.restore();
    this.player.dispose();
  }
});

QUnit.test('skips over gap at beginning of stream if played before content is buffered', function(assert) {
  let vhsGapSkipEvents = 0;

  this.player.tech_.on('usage', (event) => {
    if (event.name === 'vhs-gap-skip') {
      vhsGapSkipEvents++;
    }
  });

  // set an arbitrary source
  this.player.src({
    src: 'main.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  // start playback normally
  this.player.tech_.triggerReady();
  this.clock.tick(1);
  standardXHRResponse(this.requests.shift());
  openMediaSource(this.player, this.clock);
  this.player.tech_.trigger('play');
  this.player.tech_.trigger('waiting');
  // create a buffer with a gap of 2 seconds at beginning of stream
  this.player.tech_.buffered = () => createTimeRanges([[2, 10]]);
  // Playback watcher loop runs on a 250ms clock and needs 6 consecutive stall checks before skipping the gap
  this.clock.tick(250 * 6);

  assert.equal(vhsGapSkipEvents, 1, 'there is one skipped gap');

  // check that player jumped the gap
  assert.equal(
    Math.round(this.player.currentTime()),
    2,
    'Player seeked over gap after timer'
  );
});

QUnit.test('multiple play events do not cause the gap-skipping logic to be called sooner than expected', function(assert) {
  let vhsGapSkipEvents = 0;

  this.player.tech_.on('usage', (event) => {
    if (event.name === 'vhs-gap-skip') {
      vhsGapSkipEvents++;
    }
  });

  // set an arbitrary source
  this.player.src({
    src: 'main.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.player.tech_.triggerReady();
  this.clock.tick(1);
  standardXHRResponse(this.requests.shift());
  openMediaSource(this.player, this.clock);
  // create a buffer with a gap of 2 seconds at beginning of stream
  this.player.tech_.buffered = () => createTimeRanges([[2, 10]]);
  // Playback watcher loop runs on a 250ms clock and needs 6 consecutive stall checks before skipping the gap
  this.clock.tick(250 * 6);
  // and then simulate the playback monitor being called 'manually' by a new play event
  this.player.tech_.trigger('play');

  assert.equal(vhsGapSkipEvents, 1, 'there is one skipped gap');

  // check that player skipped the gap
  assert.equal(
    Math.round(this.player.currentTime()),
    2,
    'Player did skip the gap'
  );
});

QUnit.test('changing sources does not break ability to skip gap at beginning of stream on first play', function(assert) {
  let vhsGapSkipEvents = 0;

  this.player.dispose();

  this.player = createPlayer({
    html5: {
      vhs: {
        overrideNative: true
      }
    },
    enableSourceset: true
  });

  this.player.autoplay(true);

  this.player.tech_.on('usage', (event) => {
    if (event.name === 'vhs-gap-skip') {
      vhsGapSkipEvents++;
    }
  });

  // set an arbitrary source
  this.player.src({
    src: 'main.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  // start playback normally
  this.player.tech_.triggerReady();
  this.clock.tick(1);
  standardXHRResponse(this.requests.shift());
  openMediaSource(this.player, this.clock);
  this.player.play();
  this.player.tech_.trigger('waiting');
  // create a buffer with a gap of 2 seconds at beginning of stream
  this.player.tech_.buffered = () => createTimeRanges([[2, 10]]);
  // Playback watcher loop runs on a 250ms clock and needs 6 consecutive stall checks before skipping the gap
  this.clock.tick(250 * 6);

  assert.equal(vhsGapSkipEvents, 1, 'there is one skipped gap');

  // check that player jumped the gap
  assert.equal(
    Math.round(this.player.currentTime()),
    2,
    'Player seeked over gap after timer'
  );

  // Simulate the source changing while the player is in a `playing` state
  vhsGapSkipEvents = 0;
  this.player.currentTime(0);

  this.player.src({
    src: 'new-main.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.clock.tick(1);

  // Playback watcher loop runs on a 250ms clock and needs 6 consecutive stall checks before skipping the gap
  this.clock.tick(250 * 6);

  assert.equal(vhsGapSkipEvents, 1, 'there is one skipped gap');

  // check that player jumped the gap
  assert.equal(
    Math.round(this.player.currentTime()),
    2,
    'Player seeked over gap after source changed'
  );
});

QUnit.test('skips over gap in firefox with waiting event', function(assert) {
  let vhsGapSkipEvents = 0;

  this.player.autoplay(true);

  this.player.tech_.on('usage', (event) => {
    if (event.name === 'vhs-gap-skip') {
      vhsGapSkipEvents++;
    }
  });

  // create a buffer with a gap between 10 & 20 seconds
  this.player.tech_.buffered = function() {
    return createTimeRanges([[0, 10], [20, 30]]);
  };

  // set an arbitrary source
  this.player.src({
    src: 'main.m3u8',
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

  assert.equal(vhsGapSkipEvents, 0, 'there is no skipped gap');
  // seek to 10 seconds
  this.player.currentTime(10);
  this.player.tech_.trigger('waiting');

  // check that player jumped the gap
  assert.equal(
    Math.round(this.player.currentTime()),
    20, 'Player seeked over gap after timer'
  );
  assert.equal(vhsGapSkipEvents, 1, 'there is one skipped gap');
});

QUnit.test('skips over gap in chrome without waiting event', function(assert) {
  let vhsGapSkipEvents = 0;

  this.player.autoplay(true);

  this.player.tech_.on('usage', (event) => {
    if (event.name === 'vhs-gap-skip') {
      vhsGapSkipEvents++;
    }
  });

  // create a buffer with a gap between 10 & 20 seconds
  this.player.tech_.buffered = function() {
    return createTimeRanges([[0, 10], [20, 30]]);
  };

  // set an arbitrary source
  this.player.src({
    src: 'main.m3u8',
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

  assert.equal(vhsGapSkipEvents, 0, 'there is no skipped gap');

  // seek to 10 seconds & simulate chrome waiting event
  this.player.currentTime(10);

  this.clock.tick(4000);

  // check that player jumped the gap
  assert.equal(
    Math.round(this.player.currentTime()),
    20, 'Player seeked over gap'
  );
  assert.equal(vhsGapSkipEvents, 1, 'there is one skipped gap');
});

QUnit.test('skips over gap in Chrome due to muxed video underflow', function(assert) {
  let vhsVideoUnderflowEvents = 0;

  this.player.autoplay(true);

  this.player.tech_.on('usage', (event) => {
    if (event.name === 'vhs-video-underflow') {
      vhsVideoUnderflowEvents++;
    }
  });

  // set an arbitrary source
  this.player.src({
    src: 'main.m3u8',
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

  assert.equal(vhsVideoUnderflowEvents, 0, 'no video underflow event got triggered');

  const pc = this.player.tech_.vhs.playlistController_;

  pc.sourceUpdater_.videoBuffered = () => {
    return createTimeRanges([[0, 10], [10.1, 20]]);
  };

  this.player.currentTime(13);

  const seeks = [];

  this.player.tech_.setCurrentTime = (time) => {
    seeks.push(time);
  };

  this.player.tech_.trigger('waiting');

  assert.equal(seeks.length, 1, 'one seek');
  assert.equal(seeks[0], 13, 'player seeked to current time');
  assert.equal(vhsVideoUnderflowEvents, 1, 'triggered a video underflow event');
});

QUnit.test('skips over gap in Chrome due to demuxed video underflow', function(assert) {
  let vhsVideoUnderflowEvents = 0;

  this.player.autoplay(true);

  this.player.tech_.on('usage', (event) => {
    if (event.name === 'vhs-video-underflow') {
      vhsVideoUnderflowEvents++;
    }
  });

  // set an arbitrary source
  this.player.src({
    src: 'main.m3u8',
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

  assert.equal(vhsVideoUnderflowEvents, 0, 'no video underflow event got triggered');

  const pc = this.player.tech_.vhs.playlistController_;

  pc.sourceUpdater_.videoBuffered = () => {
    return createTimeRanges([[0, 15]]);
  };

  pc.sourceUpdater_.audioBuffered = () => {
    return createTimeRanges([[0, 20]]);
  };

  this.player.currentTime(18);

  const seeks = [];

  this.player.tech_.setCurrentTime = (time) => {
    seeks.push(time);
  };

  this.player.tech_.trigger('waiting');

  assert.equal(seeks.length, 1, 'one seek');
  assert.equal(seeks[0], 18, 'player seeked to current time');
  assert.equal(vhsVideoUnderflowEvents, 1, 'triggered a video underflow event');
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

    this.player.tech_.vhs.playbackWatcher_.seekable = () => {
      return createTimeRanges([[1, 45]]);
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
  this.player.tech_.buffered = () => createTimeRanges([[0, 30]]);
  this.player.tech_.seekable = () => createTimeRanges([[0, 30]]);
  this.player.tech_.paused = () => false;

  // Playback watcher loop runs on a 250ms clock
  this.clock.tick(250);

  // Loop has run through once, `lastRecordedTime` should have been recorded
  // and `consecutiveUpdates` set to 0 to begin count
  assert.equal(
    this.player.tech_.vhs.playbackWatcher_.lastRecordedTime, 10,
    'Playback Watcher stored current time'
  );
  assert.equal(
    this.player.tech_.vhs.playbackWatcher_.consecutiveUpdates, 0,
    'consecutiveUpdates set to 0'
  );

  // Playback watcher loop runs on a 250ms clock
  this.clock.tick(250);

  // Loop should increment consecutive updates until it is >= 5
  assert.equal(
    this.player.tech_.vhs.playbackWatcher_.consecutiveUpdates, 1,
    'consecutiveUpdates incremented'
  );

  // Playback watcher loop runs on a 250ms clock
  this.clock.tick(250);

  // Loop should increment consecutive updates until it is >= 5
  assert.equal(
    this.player.tech_.vhs.playbackWatcher_.consecutiveUpdates, 2,
    'consecutiveUpdates incremented'
  );

  // Playback watcher loop runs on a 250ms clock
  this.clock.tick(250);

  // Loop should increment consecutive updates until it is >= 5
  assert.equal(
    this.player.tech_.vhs.playbackWatcher_.consecutiveUpdates, 3,
    'consecutiveUpdates incremented'
  );

  // Playback watcher loop runs on a 250ms clock
  this.clock.tick(250);

  // Loop should increment consecutive updates until it is >= 5
  assert.equal(
    this.player.tech_.vhs.playbackWatcher_.consecutiveUpdates, 4,
    'consecutiveUpdates incremented'
  );

  // Playback watcher loop runs on a 250ms clock
  this.clock.tick(250);

  // Loop should increment consecutive updates until it is >= 5
  assert.equal(
    this.player.tech_.vhs.playbackWatcher_.consecutiveUpdates, 5,
    'consecutiveUpdates incremented'
  );

  // Playback watcher loop runs on a 250ms clock
  this.clock.tick(250);

  // Loop should see consecutive updates >= 5, call `waiting_`
  assert.equal(
    this.player.tech_.vhs.playbackWatcher_.consecutiveUpdates, 0,
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
    this.player.tech_.buffered = () => createTimeRanges([[0, 30]]);
    this.player.tech_.seekable = () => createTimeRanges([[0, 30]]);
    this.player.tech_.paused = () => false;

    // Playback watcher loop runs on a 250ms clock
    this.clock.tick(250);

    // Loop has run through once, `lastRecordedTime` should have been recorded
    // and `consecutiveUpdates` set to 0 to begin count
    assert.equal(
      this.player.tech_.vhs.playbackWatcher_.lastRecordedTime, 29.98,
      'Playback Watcher stored current time'
    );
    assert.equal(
      this.player.tech_.vhs.playbackWatcher_.consecutiveUpdates, 0,
      'consecutiveUpdates set to 0'
    );

    // Playback watcher loop runs on a 250ms clock
    this.clock.tick(250);

    // Loop has run through a second time, should detect that currentTime hasn't made
    // progress while at the end of the buffer. Since the currentTime is at the end of the
    // buffer, `consecutiveUpdates` should not be incremented
    assert.equal(
      this.player.tech_.vhs.playbackWatcher_.lastRecordedTime, 29.98,
      'Playback Watcher stored current time'
    );
    assert.equal(
      this.player.tech_.vhs.playbackWatcher_.consecutiveUpdates, 0,
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
  let vhsLiveResyncEvents = 0;
  let vhsVideoUnderflowEvents = 0;

  this.player.src({
    src: 'liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.player.tech_.triggerReady();
  this.clock.tick(1);
  this.player.tech_.currentTime = function() {
    return currentTime;
  };
  this.player.tech_.vhs.playlistController_.sourceUpdater_.videoBuffered = function() {
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
  const playbackWatcher = this.player.tech_.vhs.playbackWatcher_;

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
    if (event.name === 'vhs-live-resync') {
      vhsLiveResyncEvents++;
    }
    if (event.name === 'vhs-video-underflow') {
      vhsVideoUnderflowEvents++;
    }
  });

  currentTime = 19;
  seekable[0] = [20, 30];
  playbackWatcher.waiting_();
  assert.equal(vhsLiveResyncEvents, 1, 'triggered a liveresync event');

  currentTime = 12;
  seekable[0] = [0, 100];
  buffered = [[0, 9], [10, 20]];
  playbackWatcher.waiting_();
  assert.equal(vhsVideoUnderflowEvents, 1, 'triggered a videounderflow event');
  assert.equal(vhsLiveResyncEvents, 1, 'did not trigger an additional liveresync event');
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

  const playbackWatcher = this.player.tech_.vhs.playbackWatcher_;
  const seeks = [];
  let seekable;
  let seeking;
  let currentTime;

  playbackWatcher.seekable = () => seekable;
  playbackWatcher.tech_ = {
    off: () => {},
    seeking: () => seeking,
    currentTime: () => currentTime,
    setCurrentTime: (time) => {
      seeks.push(time);
    },
    buffered: () => createTimeRanges()
  };

  currentTime = 50;
  seekable = createTimeRanges([[1, 45]]);
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

  const playbackWatcher = this.player.tech_.vhs.playbackWatcher_;
  const seeks = [];
  let seekable;
  let seeking;
  let currentTime;

  playbackWatcher.seekable = () => seekable;
  playbackWatcher.tech_ = {
    off: () => {},
    seeking: () => seeking,
    setCurrentTime: (time) => {
      seeks.push(time);
    },
    currentTime: () => currentTime,
    // mocked out
    paused: () => false,
    buffered: () => createTimeRanges(),
    trigger: () => {},
    vhs: {
      playlistController_: {
        sourceUpdater_: {
          videoBuffered: () => {},
          audioBuffered: () => {}
        }
      }
    }
  };

  // waiting

  currentTime = 50;
  seekable = createTimeRanges([[1, 45]]);
  seeking = true;
  playbackWatcher.fixesBadSeeks_();
  assert.equal(seeks.length, 1, 'seeked');
  assert.equal(seeks[0], 45, 'player seeked to live point');

  currentTime = 0;
  playbackWatcher.fixesBadSeeks_();
  assert.equal(seeks.length, 2, 'seeked');
  assert.equal(seeks[1], 1.1, 'player seeked to start of the live window');

  // inside of seekable range
  currentTime = 10;
  playbackWatcher.fixesBadSeeks_();
  assert.equal(seeks.length, 2, 'did not seek');

  currentTime = 50;
  // if we're not seeking, the case shouldn't be handled here
  seeking = false;
  playbackWatcher.fixesBadSeeks_();
  assert.equal(seeks.length, 2, 'did not seek');

  // no check for 0 with seeking false because that should be handled by live falloff

  // checkCurrentTime

  seeking = true;
  currentTime = 50;
  playbackWatcher.fixesBadSeeks_();
  assert.equal(seeks.length, 3, 'seeked');
  assert.equal(seeks[2], 45, 'player seeked to live point');

  currentTime = 0;
  playbackWatcher.fixesBadSeeks_();
  assert.equal(seeks.length, 4, 'seeked');
  assert.equal(seeks[3], 1.1, 'player seeked to live point');

  currentTime = 10;
  playbackWatcher.fixesBadSeeks_();
  assert.equal(seeks.length, 4, 'did not seek');

  seeking = false;
  currentTime = 50;
  playbackWatcher.fixesBadSeeks_();
  assert.equal(seeks.length, 4, 'did not seek');

  currentTime = 0;
  playbackWatcher.fixesBadSeeks_();
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

    const playbackWatcher = this.player.tech_.vhs.playbackWatcher_;
    const seeks = [];
    let seekable;
    let seeking;
    let currentTime;

    playbackWatcher.seekable = () => seekable;
    playbackWatcher.tech_ = {
      off: () => {},
      seeking: () => seeking,
      setCurrentTime: (time) => {
        seeks.push(time);
      },

      currentTime: () => currentTime,
      // mocked out
      paused: () => false,
      buffered: () => createTimeRanges()
    };

    playbackWatcher.allowSeeksWithinUnsafeLiveWindow = true;

    // waiting

    seekable = createTimeRanges([[1, 45]]);
    seeking = true;

    // target duration of 10, seekable end of 45
    // 45 + 3 * 10 = 75
    currentTime = 75;
    playbackWatcher.fixesBadSeeks_();
    assert.equal(seeks.length, 0, 'did not seek');

    currentTime = 75.1;
    playbackWatcher.fixesBadSeeks_();
    assert.equal(seeks.length, 1, 'seeked');
    assert.equal(seeks[0], 45, 'player seeked to live point');

    playbackWatcher.allowSeeksWithinUnsafeLiveWindow = true;

    currentTime = 75;
    playbackWatcher.fixesBadSeeks_();
    assert.equal(seeks.length, 1, 'did not seek');
  }
);

QUnit.test(
  'low latency streams can seek closer to the live edge',
  function(assert) {
  // set an arbitrary live source
    this.player.src({
      src: 'llHLS.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    // start playback normally
    this.player.tech_.triggerReady();
    this.clock.tick(1);
    this.requests.shift().respond(
      200, null,
      '#EXTM3U\n' +
      '#EXT-X-PART-INF:PART-TARGET=1\n' +
      '#EXT-X-MEDIA-SEQUENCE:0\n' +
      '#EXTINF:2\n' +
      'low-1.ts\n' +
      '#EXT-X-PART:URI="part1.ts",DURATION=1\n' +
      '#EXT-X-PART:URI="part2.ts",DURATION=1\n'
    );
    openMediaSource(this.player, this.clock);
    this.player.tech_.trigger('play');
    this.player.tech_.trigger('playing');
    this.clock.tick(1);

    const playbackWatcher = this.player.tech_.vhs.playbackWatcher_;
    const seeks = [];
    let seekable;
    let seeking;
    let currentTime;

    playbackWatcher.seekable = () => seekable;
    playbackWatcher.tech_ = {
      off: () => {},
      seeking: () => seeking,
      setCurrentTime: (time) => {
        seeks.push(time);
      },

      currentTime: () => currentTime,
      // mocked out
      paused: () => false,
      buffered: () => createTimeRanges()
    };

    // waiting

    seekable = createTimeRanges([[1, 45]]);
    seeking = true;

    // target duration of 2, seekable end of 45
    // 45 + 3 * 2 = 51
    currentTime = 51;
    playbackWatcher.fixesBadSeeks_();
    assert.equal(seeks.length, 0, 'did not seek');

    currentTime = 51.1;
    playbackWatcher.fixesBadSeeks_();
    assert.equal(seeks.length, 1, 'seeked');
    assert.equal(seeks[0], 45, 'player seeked to live point');

    currentTime = 51;
    playbackWatcher.fixesBadSeeks_();
    assert.equal(seeks.length, 1, 'did not seek');
  }
);

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

  const playbackWatcher = this.player.tech_.vhs.playbackWatcher_;
  const seeks = [];
  let currentTime;
  let buffered;

  playbackWatcher.seekable = () => createTimeRanges([[10, 100]]);
  playbackWatcher.tech_ = {
    off: () => {},
    seeking: () => true,
    setCurrentTime: (time) => {
      seeks.push(time);
    },
    currentTime: () => currentTime,
    buffered: () => buffered
  };

  Object.assign(playbackWatcher.playlistController_.sourceUpdater_, {
    videoBuffer: true,
    videoBuffered: () => buffered
  });

  this.player.tech(true).vhs.setCurrentTime = (time) => seeks.push(time);

  currentTime = 10;
  // target duration is 10
  buffered = createTimeRanges([[20, 39]]);
  assert.notOk(playbackWatcher.fixesBadSeeks_(), 'does nothing when too far from buffer');
  assert.equal(seeks.length, 0, 'did not seek');

  buffered = createTimeRanges([[19, 38.9]]);
  assert.notOk(playbackWatcher.fixesBadSeeks_(), 'does nothing when not enough buffer');
  assert.equal(seeks.length, 0, 'did not seek');

  buffered = createTimeRanges([[19, 39]]);
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
  playbackWatcher.seekable = () => createTimeRanges([[11, 100]]);
  assert.ok(playbackWatcher.fixesBadSeeks_(), 'fixed bad seek');
  assert.equal(seeks.length, 2, 'seeked');
  assert.equal(seeks[1], 11.1, 'seeked to seekable range');
});

QUnit.test('jumps to correct range with gaps', function(assert) {
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

  const playbackWatcher = this.player.tech_.vhs.playbackWatcher_;
  const seeks = [];
  let currentTime;
  let buffered;

  playbackWatcher.seekable = () => createTimeRanges([[10, 100]]);
  playbackWatcher.tech_ = {
    off: () => {},
    seeking: () => true,
    setCurrentTime: (time) => {
      seeks.push(time);
    },
    currentTime: () => currentTime,
    buffered: () => buffered
  };

  Object.assign(playbackWatcher.playlistController_.sourceUpdater_, {
    videoBuffer: true,
    videoBuffered: () => buffered
  });

  this.player.tech(true).vhs.setCurrentTime = (time) => seeks.push(time);

  currentTime = 40;
  buffered = createTimeRanges([[19, 39], [41, 70]]);
  assert.ok(
    playbackWatcher.fixesBadSeeks_(),
    'acts when close enough to, and enough, buffer'
  );
  assert.equal(seeks.length, 1, 'seeked');
  assert.equal(seeks[0], 41.1, 'player seeked to the start of the closer buffer');
});

QUnit.test('two seekings skips a gap only once', function(assert) {
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

  const mainSegmentLoader = this.player.tech_.vhs.playlistController_.mainSegmentLoader_;
  const playbackWatcher = this.player.tech_.vhs.playbackWatcher_;
  const seeks = [];
  let currentTime;
  let buffered;

  playbackWatcher.seekable = () => createTimeRanges([[10, 100]]);
  playbackWatcher.tech_ = {
    off: () => {},
    seeking: () => true,
    setCurrentTime: (time) => {
      seeks.push(time);
    },
    currentTime: () => currentTime,
    buffered: () => buffered
  };

  Object.assign(playbackWatcher.playlistController_.sourceUpdater_, {
    videoBuffer: true,
    videoBuffered: () => buffered
  });

  currentTime = 40;
  buffered = createTimeRanges([[19, 39], [41, 70]]);
  this.player.tech_.trigger('seeking');
  this.player.tech_.trigger('seeking');
  mainSegmentLoader.trigger('appended');
  assert.equal(seeks.length, 1, 'seeked');
  assert.equal(seeks[0], 41.1, 'player seeked to the start of the next buffer');
});

QUnit.test('seeking followed by seeked will not skip gaps', function(assert) {
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

  const mainSegmentLoader = this.player.tech_.vhs.playlistController_.mainSegmentLoader_;
  const playbackWatcher = this.player.tech_.vhs.playbackWatcher_;
  const seeks = [];
  let currentTime;
  let buffered;

  playbackWatcher.seekable = () => createTimeRanges([[10, 100]]);
  playbackWatcher.tech_ = {
    off: () => {},
    seeking: () => true,
    setCurrentTime: (time) => {
      seeks.push(time);
    },
    currentTime: () => currentTime,
    buffered: () => buffered
  };

  Object.assign(playbackWatcher.playlistController_.sourceUpdater_, {
    videoBuffer: true,
    videoBuffered: () => buffered
  });

  currentTime = 40;
  buffered = createTimeRanges([[19, 39], [41, 70]]);
  this.player.tech_.trigger('seeking');
  this.player.tech_.trigger('seeked');
  mainSegmentLoader.trigger('appended');
  assert.equal(seeks.length, 0, 'no seeks');
});

QUnit.test('dispose stops bad seek handling', function(assert) {
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

  const mainSegmentLoader = this.player.tech_.vhs.playlistController_.mainSegmentLoader_;
  const playbackWatcher = this.player.tech_.vhs.playbackWatcher_;
  const seeks = [];
  let currentTime;
  let buffered;

  playbackWatcher.seekable = () => createTimeRanges([[10, 100]]);
  playbackWatcher.tech_ = {
    off: () => {},
    seeking: () => true,
    setCurrentTime: (time) => {
      seeks.push(time);
    },
    currentTime: () => currentTime,
    buffered: () => buffered
  };

  Object.assign(playbackWatcher.playlistController_.sourceUpdater_, {
    videoBuffer: true,
    videoBuffered: () => buffered
  });

  currentTime = 40;
  buffered = createTimeRanges([[19, 39], [41, 70]]);
  this.player.tech_.trigger('seeking');
  playbackWatcher.dispose();
  mainSegmentLoader.trigger('appended');
  assert.equal(seeks.length, 0, 'no seeks');
});

QUnit.test('part target duration is used for append verification', function(assert) {
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

  const playbackWatcher = this.player.tech_.vhs.playbackWatcher_;
  const seeks = [];
  let currentTime;
  let buffered;

  playbackWatcher.seekable = () => createTimeRanges([[10, 100]]);
  playbackWatcher.tech_ = {
    off: () => {},
    seeking: () => true,
    setCurrentTime: (time) => {
      seeks.push(time);
    },
    currentTime: () => currentTime,
    buffered: () => buffered
  };

  Object.assign(playbackWatcher.playlistController_.sourceUpdater_, {
    videoBuffer: true,
    videoBuffered: () => buffered
  });

  this.player.tech(true).vhs.setCurrentTime = (time) => seeks.push(time);

  const media = playbackWatcher.media();

  media.partTargetDuration = 1.1;

  playbackWatcher.media = () => media;

  currentTime = 40;
  buffered = createTimeRanges([[41, 42.1]]);
  assert.ok(
    playbackWatcher.fixesBadSeeks_(),
    'acts when close enough to, and enough, buffer'
  );
  assert.equal(seeks.length, 1, 'seeked');
  assert.equal(seeks[0], 41.1, 'player seeked to the start of the closer buffer');
});

const loaderTypes = ['audio', 'main', 'subtitle'];

const EXCLUDE_APPEND_COUNT = 10;

QUnit.module('PlaybackWatcher download detection', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.requests = this.env.requests;
    this.mse = useFakeMediaSource();
    this.clock = this.env.clock;
    this.old = {};

    this.respondToPlaylists_ = () => {
      const regex = (/\.(m3u8|mpd)/i);

      for (let i = 0; i < this.requests.length; i++) {
        const r = this.requests[i];

        if (regex.test(r.uri)) {
          this.requests.splice(i, 1);
          standardXHRResponse(r);
          i--;
        }
      }
    };

    this.setup = function(src = {src: 'media.m3u8', type: 'application/vnd.apple.mpegurl'}) {
      // setup a player
      this.player = createPlayer({html5: {
        vhs: {
          overrideNative: true
        }
      }});

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
      this.pcErrors = 0;

      this.playbackWatcher = this.player.tech(true).vhs.playbackWatcher_;
      this.pc = this.player.tech(true).vhs.playlistController_;
      this.pc.on('error', () => this.pcErrors++);

      this.player.tech_.on('usage', (event) => {
        const name = event.name;

        this.usageEvents[name] = this.usageEvents[name] || 0;
        this.usageEvents[name]++;
      });

      this.setBuffered = (val) => {
        this.player.buffered = () => val;
        loaderTypes.forEach((type) => {
          this.pc[`${type}SegmentLoader_`].buffered_ = () => val;
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
  QUnit.test(`resets ${type} exclusion on playlistupdate, tech seeking, tech seeked`, function(assert) {
    this.setup();
    const loader = this.pc[`${type}SegmentLoader_`];

    this.setBuffered(createTimeRanges([[0, 30]]));
    loader.trigger('appendsdone');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 0, '1st append 0 stalled downloads');

    loader.trigger('appendsdone');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 1, '2nd append 1 stalled downloads');

    loader.trigger('playlistupdate');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 0, '0 stalled downloads after playlistupdate');

    loader.trigger('appendsdone');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 1, '1st append 1 stalled downloads');

    loader.trigger('appendsdone');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 2, '2nd append 2 stalled downloads');

    this.player.tech_.trigger('seeking');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 0, '0 stalled downloads after seeking');

    loader.trigger('appendsdone');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 1, '1st append 1 stalled downloads');

    loader.trigger('appendsdone');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 2, '2nd append 2 stalled downloads');

    this.player.tech_.trigger('seeked');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 0, '0 stalled downloads after seeked');

    loader.trigger('appendsdone');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 1, '1st append 1 stalled downloads');

    loader.trigger('appendsdone');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 2, '2nd append 2 stalled downloads');

    assert.deepEqual(this.usageEvents, {}, 'no usage events');
  });

  QUnit.test(`Resets ${type} exclusion on buffered change`, function(assert) {
    this.setup();
    const loader = this.pc[`${type}SegmentLoader_`];

    this.setBuffered(createTimeRanges([[0, 30]]));
    loader.trigger('appendsdone');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 0, '1st append 0 stalled downloads');

    loader.trigger('appendsdone');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 1, '2nd append 1 stalled downloads');

    this.setBuffered(createTimeRanges([[0, 31]]));
    loader.trigger('appendsdone');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 0, '1st append 0 stalled downloads');

    loader.trigger('appendsdone');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 1, '2nd append 1 stalled downloads');
  });

  // the following two tests do not apply to the subtitle loader
  if (type === 'subtitle') {
    return;
  }

  QUnit.test(`detects ${type} appends without buffer changes and excludes`, function(assert) {
    this.setup();
    const loader = this.pc[`${type}SegmentLoader_`];

    this.setBuffered(createTimeRanges([[0, 30]]));

    for (let i = 0; i <= EXCLUDE_APPEND_COUNT; i++) {
      loader.trigger('appendsdone');
      if (i === EXCLUDE_APPEND_COUNT) {
        assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 0, `append #${i} resets stalled downloads to 0`);
      } else {
        assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], i, `append #${i + 1} ${i} stalled downloads`);
      }
    }

    const expectedUsage = {};

    expectedUsage[`vhs-${type}-download-exclusion`] = 1;

    expectedUsage['vhs-rendition-excluded'] = 1;
    // expectedUsage['vhs-rendition-change-exclude'] = 1;

    assert.deepEqual(this.usageEvents, expectedUsage, 'usage as expected');

    const message = 'Playback cannot continue. No available working or supported playlists.';

    assert.equal(this.pcErrors, 1, 'one pc error');
    assert.equal(this.pc.error, message, 'pc error set');
    assert.equal(this.player.error().message, message, 'player error set');
    assert.equal(this.env.log.error.callCount, 1, 'player error logged');
    assert.equal(this.env.log.error.args[0][1], message, 'error message as expected');

    this.env.log.error.resetHistory();
  });

  QUnit.test(`detects ${type} appends without buffer changes and excludes many playlists`, function(assert) {
    this.setup({src: 'multipleAudioGroupsCombinedMain.m3u8', type: 'application/vnd.apple.mpegurl'});

    const loader = this.pc[`${type}SegmentLoader_`];
    const playlists = this.pc.main().playlists;
    const excludeAndVerify = (last) => {
      let oldPlaylist;
      // this test only needs 9 appends, since we do an intial append

      for (let i = 0; i < EXCLUDE_APPEND_COUNT; i++) {
        oldPlaylist = this.pc.media();
        loader.trigger('appendsdone');
        if (i === EXCLUDE_APPEND_COUNT - 1) {
          assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 0, `append #${i} resets stalled downloads to 0`);
        } else {
          assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], i + 1, `append #${i + 1} ${i + 1} stalled downloads`);
        }
      }

      const expectedUsage = {};

      expectedUsage[`vhs-${type}-download-exclusion`] = 1;
      expectedUsage['vhs-rendition-excluded'] = 1;
      if (!last) {
        expectedUsage['vhs-rendition-change-exclude'] = 1;
      }

      assert.deepEqual(this.usageEvents, expectedUsage, 'usage as expected');
      this.usageEvents = {};

      this.respondToPlaylists_();

      const otherPlaylistsLeft = this.pc.main().playlists.some((p) => p.excludeUntil !== Infinity);

      if (otherPlaylistsLeft) {
        const message = `Problem encountered with playlist ${oldPlaylist.id}.` +
          ` Excessive ${type} segment downloading detected.` +
          ` Switching to playlist ${this.pc.media().id}.`;

        assert.equal(this.pcErrors, 0, 'no pc error');
        assert.notOk(this.pc.error, 'no pc error set');
        assert.notOk(this.player.error(), 'player error not set');
        assert.equal(this.env.log.warn.callCount, 1, 'player warning logged');
        assert.equal(this.env.log.warn.args[0][0], message, 'warning message as expected');

        this.env.log.warn.resetHistory();
      } else {
        const message = 'Playback cannot continue. No available working or supported playlists.';

        assert.equal(this.pcErrors, 1, 'one pc error');
        assert.equal(this.pc.error, message, 'pc error set');
        assert.equal(this.player.error().message, message, 'player error set');
        assert.equal(this.env.log.error.callCount, 1, 'player error logged');
        assert.equal(this.env.log.error.args[0][1], message, 'error message as expected');

        this.env.log.error.resetHistory();
      }
    };

    this.setBuffered(createTimeRanges([[0, 30]]));
    loader.trigger('appendsdone');
    assert.equal(this.playbackWatcher[`${type}StalledDownloads_`], 0, 'initial append 0 stalled downloads');
    let i = playlists.length;

    // exclude all playlists and verify
    while (i--) {
      excludeAndVerify((i === 0));
    }

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
        one: () => {},
        paused: () => false,
        // needed to construct a playback watcher
        options_: {
          playerId: 'mock-player-id'
        }
      },
      playlistController: {
        mainSegmentLoader_: Object.assign(new videojs.EventTarget(), {buffered_: () => createTimeRanges()}),
        audioSegmentLoader_: Object.assign(new videojs.EventTarget(), {buffered_: () => createTimeRanges()}),
        subtitleSegmentLoader_: Object.assign(new videojs.EventTarget(), {buffered_: () => createTimeRanges()})
      }
    });
  },
  afterEach() {
    this.playbackWatcher.dispose();
    PlaybackWatcher.prototype.monitorCurrentTime_ = monitorCurrentTime_;
  }
});

QUnit.test('skips gap from muxed video underflow', function(assert) {
  assert.equal(
    this.playbackWatcher.gapFromVideoUnderflow_(createTimeRanges(), 0),
    null,
    'returns null when buffer is empty'
  );
  assert.equal(
    this.playbackWatcher.gapFromVideoUnderflow_(createTimeRanges([[0, 10]]), 13),
    null,
    'returns null when there is only a previous buffer'
  );
  assert.equal(
    this.playbackWatcher.gapFromVideoUnderflow_(createTimeRanges([[0, 10], [10.1, 20]]), 15),
    null,
    'returns null when gap is too far from current time'
  );
  assert.equal(
    this.playbackWatcher.gapFromVideoUnderflow_(createTimeRanges([[0, 10], [10.1, 20]]), 9.9),
    null,
    'returns null when gap is after current time'
  );
  assert.equal(
    this.playbackWatcher.gapFromVideoUnderflow_(createTimeRanges([[0, 10.1], [10.2, 20]]), 12.1),
    null,
    'returns null when time is less than or equal to 2 seconds ahead'
  );
  assert.equal(
    this.playbackWatcher.gapFromVideoUnderflow_(createTimeRanges([[0, 10], [10.1, 20]]), 14.1),
    null,
    'returns null when time is greater than or equal to 4 seconds ahead'
  );
  assert.deepEqual(
    this.playbackWatcher.gapFromVideoUnderflow_(createTimeRanges([[0, 10], [10.1, 20]]), 12.2),
    {start: 10, end: 10.1},
    'returns gap when gap is small and time is greater than 2 seconds ahead in a buffer'
  );
  assert.deepEqual(
    this.playbackWatcher.gapFromVideoUnderflow_(createTimeRanges([[0, 10], [10.1, 20]]), 13),
    {start: 10, end: 10.1},
    'returns gap when gap is small and time is 3 seconds ahead in a buffer'
  );
  assert.deepEqual(
    this.playbackWatcher.gapFromVideoUnderflow_(createTimeRanges([[0, 10], [10.1, 20]]), 13.9),
    {start: 10, end: 10.1},
    'returns gap when gap is small and time is less than 4 seconds ahead in a buffer'
  );
  // In a case where current time is outside of the buffered range, something odd must've
  // happened, but we should still allow the player to try to continue from that spot.
  assert.deepEqual(
    this.playbackWatcher.gapFromVideoUnderflow_(createTimeRanges([[0, 10], [10.1, 12.9]]), 13),
    {start: 10, end: 10.1},
    'returns gap even when current time is not in buffered range'
  );
});

QUnit.test('detects live window falloff', function(assert) {
  this.playbackWatcher.liveRangeSafeTimeDelta = SAFE_TIME_DELTA;

  const beforeSeekableWindow_ =
    this.playbackWatcher.beforeSeekableWindow_.bind(this.playbackWatcher);

  assert.ok(
    beforeSeekableWindow_(createTimeRanges([[11, 20]]), 10),
    'true if playlist live and current time before seekable'
  );

  assert.ok(
    !beforeSeekableWindow_(createTimeRanges([]), 10),
    'false if no seekable range'
  );
  assert.ok(
    !beforeSeekableWindow_(createTimeRanges([[0, 10]]), -1),
    'false if seekable range starts at 0'
  );
  assert.ok(
    !beforeSeekableWindow_(createTimeRanges([[11, 20]]), 11),
    'false if current time at seekable start'
  );
  assert.ok(
    !beforeSeekableWindow_(createTimeRanges([[11, 20]]), 20),
    'false if current time at seekable end'
  );
  assert.ok(
    !beforeSeekableWindow_(createTimeRanges([[11, 20]]), 15),
    'false if current time within seekable range'
  );
  assert.ok(
    !beforeSeekableWindow_(createTimeRanges([[11, 20]]), 21),
    'false if current time past seekable range'
  );
  assert.ok(
    beforeSeekableWindow_(createTimeRanges([[11, 20]]), 0),
    'true if current time is 0 and earlier than seekable range'
  );
});

QUnit.test('respects liveRangeSafeTimeDelta flag', function(assert) {
  this.playbackWatcher.liveRangeSafeTimeDelta = 1;

  const beforeSeekableWindow_ =
    this.playbackWatcher.beforeSeekableWindow_.bind(this.playbackWatcher);

  assert.ok(
    beforeSeekableWindow_(createTimeRanges([[12, 20]]), 10),
    'true if playlist live and current time before seekable'
  );

  assert.ok(
    !beforeSeekableWindow_(createTimeRanges([]), 10),
    'false if no seekable range'
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
    afterSeekableWindow_(createTimeRanges([[11, 20]]), 10.8, playlist),
    'false if before seekable range'
  );
  assert.ok(
    afterSeekableWindow_(createTimeRanges([[11, 20]]), 20.2, playlist),
    'true if after seekable range'
  );
  assert.notOk(
    afterSeekableWindow_(createTimeRanges([[11, 20]]), 10.9, playlist),
    'false if within starting seekable range buffer'
  );
  assert.notOk(
    afterSeekableWindow_(createTimeRanges([[11, 20]]), 20.1, playlist),
    'false if within ending seekable range buffer'
  );

  assert.notOk(
    afterSeekableWindow_(createTimeRanges(), 10, playlist),
    'false if no seekable range'
  );
  assert.notOk(
    afterSeekableWindow_(createTimeRanges([[0, 10]]), -0.2, playlist),
    'false if current time is negative'
  );
  assert.notOk(
    afterSeekableWindow_(createTimeRanges([[0, 10]]), 5, playlist),
    'false if within seekable range'
  );
  assert.notOk(
    afterSeekableWindow_(createTimeRanges([[0, 10]]), 0, playlist),
    'false if within seekable range'
  );
  assert.notOk(
    afterSeekableWindow_(createTimeRanges([[0, 10]]), 10, playlist),
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
    afterSeekableWindow_(createTimeRanges([[11, 20]]), 10.8, playlist),
    'false if before seekable range'
  );
  assert.ok(
    afterSeekableWindow_(createTimeRanges([[11, 20]]), 20.2, playlist),
    'true if after seekable range'
  );
  assert.notOk(
    afterSeekableWindow_(createTimeRanges([[11, 20]]), 10.9, playlist),
    'false if within starting seekable range buffer'
  );
  assert.notOk(
    afterSeekableWindow_(createTimeRanges([[11, 20]]), 20.1, playlist),
    'false if within ending seekable range buffer'
  );

  assert.notOk(
    afterSeekableWindow_(createTimeRanges(), 10, playlist),
    'false if no seekable range'
  );
  assert.notOk(
    afterSeekableWindow_(createTimeRanges([[0, 10]]), -0.2, playlist),
    'false if current time is negative'
  );
  assert.notOk(
    afterSeekableWindow_(createTimeRanges([[0, 10]]), 5, playlist),
    'false if within seekable range'
  );
  assert.notOk(
    afterSeekableWindow_(createTimeRanges([[0, 10]]), 0, playlist),
    'false if within seekable range'
  );
  assert.notOk(
    afterSeekableWindow_(createTimeRanges([[0, 10]]), 10, playlist),
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
    afterSeekableWindow_(createTimeRanges([[11, 20]]), 10.8, playlist, true),
    'false if before seekable range'
  );
  assert.notOk(
    afterSeekableWindow_(createTimeRanges([[11, 20]]), 20.2, playlist, true),
    'false if after seekable range but within unsafe live window'
  );
  assert.notOk(
    afterSeekableWindow_(createTimeRanges([[11, 20]]), 40.9, playlist, true),
    'false if after seekable range but within unsafe live window'
  );
  assert.ok(
    afterSeekableWindow_(createTimeRanges([[11, 20]]), 41.1, playlist, true),
    'true if after seekable range and unsafe live window'
  );
  assert.notOk(
    afterSeekableWindow_(createTimeRanges([[11, 20]]), 10.9, playlist, true),
    'false if within starting seekable range buffer'
  );
  assert.notOk(
    afterSeekableWindow_(createTimeRanges([[11, 20]]), 20.1, playlist, true),
    'false if within ending seekable range buffer'
  );

  assert.notOk(
    afterSeekableWindow_(createTimeRanges(), 10, playlist, true),
    'false if no seekable range'
  );
  assert.notOk(
    afterSeekableWindow_(createTimeRanges([[0, 10]]), -0.2, playlist, true),
    'false if current time is negative'
  );
  assert.notOk(
    afterSeekableWindow_(createTimeRanges([[0, 10]]), 5, playlist, true),
    'false if within seekable range'
  );
  assert.notOk(
    afterSeekableWindow_(createTimeRanges([[0, 10]]), 0, playlist, true),
    'false if within seekable range'
  );
  assert.notOk(
    afterSeekableWindow_(createTimeRanges([[0, 10]]), 10, playlist, true),
    'false if within seekable range'
  );

  playlist.endList = true;

  assert.notOk(
    afterSeekableWindow_(createTimeRanges([[11, 20]]), 10.8, playlist, true),
    'false if before seekable range'
  );
  assert.ok(
    afterSeekableWindow_(createTimeRanges([[11, 20]]), 20.2, playlist, true),
    'true if after seekable range'
  );
  assert.notOk(
    afterSeekableWindow_(createTimeRanges([[11, 20]]), 10.9, playlist, true),
    'false if within starting seekable range buffer'
  );
  assert.notOk(
    afterSeekableWindow_(createTimeRanges([[11, 20]]), 20.1, playlist, true),
    'false if within ending seekable range buffer'
  );

  assert.notOk(
    afterSeekableWindow_(createTimeRanges(), 10, playlist, true),
    'false if no seekable range'
  );
  assert.notOk(
    afterSeekableWindow_(createTimeRanges([[0, 10]]), -0.2, playlist, true),
    'false if current time is negative'
  );
  assert.notOk(
    afterSeekableWindow_(createTimeRanges([[0, 10]]), 5, playlist, true),
    'false if within seekable range'
  );
  assert.notOk(
    afterSeekableWindow_(createTimeRanges([[0, 10]]), 0, playlist, true),
    'false if within seekable range'
  );
  assert.notOk(
    afterSeekableWindow_(createTimeRanges([[0, 10]]), 10, playlist, true),
    'false if within seekable range'
  );
});
