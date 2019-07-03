import QUnit from 'qunit';
import videojs from 'video.js';
import window from 'global/window';
import document from 'global/document';
import '../src/videojs-http-streaming';

const playFor = function(player, time, cb) {
  if (player.paused()) {
    const playPromise = player.play();

    // Catch/silence error when a pause interrupts a play request
    // on browsers which return a promise
    if (typeof playPromise !== 'undefined' && typeof playPromise.then === 'function') {
      playPromise.then(null, (e) => {});
    }
  }
  const targetTime = player.currentTime() + time;

  const checkPlayerTime = function() {
    window.setTimeout(() => {
      if (player.currentTime() <= targetTime) {
        return checkPlayerTime();
      }
      cb();
    }, 10);
  };

  checkPlayerTime();
};

let testFn = 'test';

// TODO: get these tests working, right now we just one the one basic test
if (videojs.browser.IE_VERSION || videojs.browser.IS_EDGE) {
  testFn = 'skip';
}

QUnit.module('Playback', {
  beforeEach(assert) {
    assert.timeout(50000);

    this.fixture = document.getElementById('qunit-fixture');

    const done = assert.async();
    const video = document.createElement('video-js');

    // uncomment these lines when deugging
    // videojs.log.level('debug');
    // this.fixture.style.position = 'inherit';

    video.setAttribute('controls', '');
    video.setAttribute('muted', '');
    video.width = 600;
    video.height = 300;
    video.defaultPlaybackRate = 16;

    this.fixture.appendChild(video);
    this.player = videojs(video, {
      html5: {
        hls: {
          overrideNative: true
        }
      }
    });

    this.player.ready(done, true);
  },
  afterEach() {
    this.player.dispose();
  }
});

QUnit.test('Advanced Bip Bop default speed', function(assert) {
  const done = assert.async();

  this.player.defaultPlaybackRate(1);

  assert.expect(2);
  const player = this.player;

  playFor(player, 2, function() {
    assert.ok(true, 'played for at least two seconds');
    assert.equal(player.error(), null, 'has no player errors');

    done();
  });

  player.src({
    src: 'https://s3.amazonaws.com/_bc_dml/example-content/bipbop-advanced/bipbop_16x9_variant.m3u8',
    type: 'application/x-mpegURL'
  });
});

QUnit.test('Advanced Bip Bop', function(assert) {
  const done = assert.async();

  assert.expect(2);
  const player = this.player;

  playFor(player, 2, function() {
    assert.ok(true, 'played for at least two seconds');
    assert.equal(player.error(), null, 'has no player errors');

    done();
  });

  player.src({
    src: 'https://s3.amazonaws.com/_bc_dml/example-content/bipbop-advanced/bipbop_16x9_variant.m3u8',
    type: 'application/x-mpegURL'
  });
});

QUnit[testFn]('replay', function(assert) {
  const done = assert.async();

  assert.expect(2);
  const player = this.player;

  // seek to near the end of the video
  playFor(player, 1, function() {
    player.currentTime(player.duration() - 1);
  });

  player.one('ended', function() {
    player.one('timeupdate', function() {
      assert.ok(player.currentTime() < 10, 'played');
      assert.equal(player.error(), null, 'has no player errors');

      done();
    });

    player.play();
  });

  player.src({
    src: 'https://s3.amazonaws.com/_bc_dml/example-content/bipbop-advanced/bipbop_16x9_variant.m3u8',
    type: 'application/x-mpegURL'
  });
});

QUnit[testFn]('playlist with fmp4 segments', function(assert) {
  const done = assert.async();

  assert.expect(2);
  const player = this.player;

  playFor(player, 6, function() {
    assert.ok(true, 'played for at least six seconds to hit the change in container format');
    assert.equal(player.error(), null, 'has no player errors');

    done();
  });

  player.src({
    src: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_adv_example_hevc/master.m3u8',
    type: 'application/x-mpegURL'
  });
});

QUnit[testFn]('playlist with fmp4 and ts segments', function(assert) {
  const done = assert.async();

  assert.expect(2);
  const player = this.player;

  playFor(player, 6, function() {
    assert.ok(true, 'played for at least six seconds to hit the change in container format');
    assert.equal(player.error(), null, 'has no player errors');

    done();
  });

  player.src({
    src: 'https://d2zihajmogu5jn.cloudfront.net/ts-fmp4/index.m3u8',
    type: 'application/x-mpegURL'
  });
});

QUnit[testFn]('Advanced Bip Bop preload=none', function(assert) {
  const done = assert.async();

  assert.expect(2);
  const player = this.player;

  player.preload('none');

  playFor(player, 2, function() {
    assert.ok(true, 'played for at least two seconds');
    assert.equal(player.error(), null, 'has no player errors');

    done();
  });

  player.src({
    src: 'https://s3.amazonaws.com/_bc_dml/example-content/bipbop-advanced/bipbop_16x9_variant.m3u8',
    type: 'application/x-mpegURL'
  });
});

QUnit[testFn]('Big Buck Bunny', function(assert) {
  const done = assert.async();

  assert.expect(2);
  const player = this.player;

  playFor(player, 2, function() {
    assert.ok(true, 'played for at least two seconds');
    assert.equal(player.error(), null, 'has no player errors');

    done();
  });

  player.src({
    src: 'https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd',
    type: 'application/dash+xml'
  });
});

QUnit[testFn]('Live DASH', function(assert) {
  const done = assert.async();

  assert.expect(2);
  const player = this.player;

  playFor(player, 2, function() {
    assert.ok(true, 'played for at least two seconds');
    assert.equal(player.error(), null, 'has no player errors');

    done();
  });

  player.src({
    src: 'https://vm2.dashif.org/livesim/mup_30/testpic_2s/Manifest.mpd',
    type: 'application/dash+xml'
  });
});

QUnit[testFn]('DASH sidx', function(assert) {
  const done = assert.async();
  const player = this.player;

  playFor(player, 2, function() {
    assert.ok(true, 'played for at least two seconds');
    assert.equal(player.error(), null, 'no errors');

    player.one('ended', () => {
      assert.ok(true, 'triggered ended event');
      done();
    });

    // Firefox sometimes won't loop if seeking directly to the duration, or to too close
    // to the duration (e.g., 10ms from duration). 100ms seems to work.
    player.currentTime(player.duration() - 0.5);
  });

  player.src({
    src: 'https://dash.akamaized.net/dash264/TestCases/10a/1/iis_forest_short_poem_multi_lang_480p_single_adapt_aaclc_sidx.mpd',
    type: 'application/dash+xml'
  });
});

QUnit[testFn]('DASH sidx with alt audio should end', function(assert) {

  const done = assert.async();
  const player = this.player;

  player.one('ended', () => {
    assert.ok(true, 'triggered ended');
    assert.equal(player.error(), null, 'no errors');
    done();
  });

  /* eslint-disable max-nested-callbacks */
  playFor(player, 1, () => {
    // switch audio playlist
    player.audioTracks()[1].enabled = true;

    playFor(player, 1, () => {
      player.currentTime(player.duration() - 5);
    });
  });
  /* eslint-enable max-nested-callbacks */

  player.src({
    src: 'https://dash.akamaized.net/dash264/TestCases/10a/1/iis_forest_short_poem_multi_lang_480p_single_adapt_aaclc_sidx.mpd',
    type: 'application/dash+xml'
  });
});

QUnit[testFn]('loops', function(assert) {
  const done = assert.async();
  const player = this.player;

  player.loop(true);
  player.src({
    src: 'https://s3.amazonaws.com/_bc_dml/example-content/bipbop-advanced/bipbop_16x9_variant.m3u8',
    type: 'application/x-mpegURL'
  });
  player.one('playing', function() {
    player.vhs.mediaSource.addEventListener('sourceended', () => {
      player.vhs.mediaSource.addEventListener('sourceopen', () => {
        assert.ok(true, 'sourceopen triggered after ending stream');
        done();
      });
    });

    // Firefox sometimes won't loop if seeking directly to the duration, or to too close
    // to the duration (e.g., 10ms from duration). 100ms seems to work.
    player.currentTime(player.duration() - 0.5);
  });
  player.play();
});
