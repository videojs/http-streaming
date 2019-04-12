import QUnit from 'qunit';
import videojs from 'video.js';
import document from 'global/document';
import '../src/videojs-http-streaming';

let when = function(element, type, cb, condition) {
  element.on(type, function func() {
    if (condition()) {
      element.off(type, func);
      cb();
    }
  });
};

let playFor = function(player, time, cb) {
  let targetTime = player.currentTime() + time;

  when(player, 'timeupdate', cb, () => player.currentTime() >= targetTime);
};

QUnit.module('Playback', {
  before() {
    this.fixture = document.createElement('div');
    document.body.appendChild(this.fixture);
  },
  beforeEach(assert) {
    let done = assert.async();
    let video = document.createElement('video-js');

    video.width = 600;
    video.height = 300;
    this.fixture.appendChild(video);
    this.player = videojs(video, {
      muted: true,
      autoplay: true
    });
    this.player.ready(done);
  },
  afterEach() {
    this.player.dispose();
  }
});

QUnit.test('Advanced Bip Bop', function(assert) {
  let done = assert.async();

  assert.expect(2);
  let player = this.player;

  playFor(player, 2, function() {
    assert.ok(true, 'played for at least two seconds');
    assert.equal(player.error(), null, 'has no player errors');

    done();
  });

  player.src({
    src: 'http://d2zihajmogu5jn.cloudfront.net/bipbop-advanced/bipbop_16x9_variant.m3u8',
    type: 'application/x-mpegURL'
  });
});

QUnit.test('replay', function(assert) {
  let done = assert.async();

  assert.expect(2);
  let player = this.player;

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
    src: 'http://d2zihajmogu5jn.cloudfront.net/bipbop-advanced/bipbop_16x9_variant.m3u8',
    type: 'application/x-mpegURL'
  });
});

QUnit.skip('playlist with fmp4 and ts segments', function(assert) {
  let done = assert.async();

  assert.expect(2);
  let player = this.player;

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

QUnit.test('Advanced Bip Bop preload=none', function(assert) {
  let done = assert.async();

  assert.expect(2);
  let player = this.player;

  player.preload('none');

  playFor(player, 2, function() {
    assert.ok(true, 'played for at least two seconds');
    assert.equal(player.error(), null, 'has no player errors');

    done();
  });

  player.src({
    src: 'http://d2zihajmogu5jn.cloudfront.net/bipbop-advanced/bipbop_16x9_variant.m3u8',
    type: 'application/x-mpegURL'
  });
});

QUnit.test('Big Buck Bunny', function(assert) {
  let done = assert.async();

  assert.expect(2);
  let player = this.player;

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

QUnit.test('Live DASH', function(assert) {
  let done = assert.async();

  assert.expect(2);
  let player = this.player;

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

QUnit.test('DASH sidx', function(assert) {
  let done = assert.async();
  let player = this.player;

  playFor(player, 2, function() {
    assert.ok(true, 'played for at least two seconds');
    assert.equal(player.error(), null, 'no errors');

    player.one('ended', () => {
      assert.ok(true, 'triggered ended event');
      done();
    });

    // Firefox sometimes won't loop if seeking directly to the duration, or to too close
    // to the duration (e.g., 10ms from duration). 100ms seems to work.
    player.currentTime(player.duration() - 0.1);
  });

  player.src({
    src: 'https://dash.akamaized.net/dash264/TestCases/10a/1/iis_forest_short_poem_multi_lang_480p_single_adapt_aaclc_sidx.mpd',
    type: 'application/dash+xml'
  });
});

// This is a potentially existing issue where a combination of things
// results in no ended event. We should fix this and start running this
// test with 100% pass rate after that.
QUnit.skip('DASH sidx with alt audio should end', function(assert) {
  assert.timeout(20000);

  let done = assert.async();
  let player = this.player;

  player.one('ended', () => {
    assert.ok(true, 'triggered ended');
    assert.equal(player.error(), null, 'no errors');
    done();
  });

  playFor(player, 1, () => {
    player.currentTime(18);

    playFor(player, 1, () => {
      player.currentTime(25);

      playFor(player, 1, () => {
        // switch audio playlist
        player.audioTracks()[1].enabled = true;

        playFor(player, 1, () => {
          player.currentTime(player.duration() - 5);
        });
      });
    });
  });

  player.src({
    src: 'https://dash.akamaized.net/dash264/TestCases/10a/1/iis_forest_short_poem_multi_lang_480p_single_adapt_aaclc_sidx.mpd',
    type: 'application/dash+xml'
  });
});

QUnit.test('loops', function(assert) {
  assert.timeout(5000);
  let done = assert.async();
  let player = this.player;

  player.loop(true);
  player.src({
    src: 'http://d2zihajmogu5jn.cloudfront.net/bipbop-advanced/bipbop_16x9_variant.m3u8',
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
    player.currentTime(player.duration() - 0.1);
  });
  player.play();
});
