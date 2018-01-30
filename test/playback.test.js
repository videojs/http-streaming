import document from 'global/document';
import QUnit from 'qunit';
import videojs from 'video.js';
/* eslint-disable no-unused-vars */
import { Hls } from '../src/videojs-http-streaming';

const when = function(element, type, cb, condition) {
  element.on(type, function func() {
    if (condition()) {
      element.off(type, func);
      cb();
    }
  });
};

const playFor = function(player, time, cb) {
  const targetTime = player.currentTime() + time;

  when(player, 'timeupdate', cb, () => player.currentTime() >= targetTime);
};

QUnit.module('Playback', {
  before() {
    this.fixture = document.createElement('div');
    document.body.appendChild(this.fixture);
  },
  beforeEach(assert) {
    const done = assert.async();
    const video = document.createElement('video');

    video.width = 600;
    video.height = 300;
    this.fixture.appendChild(video);
    this.player = videojs(video);
    this.player.ready(done);
  },
  afterEach() {
    this.player.dispose();
  }
});

QUnit.test('Advanced Bip Bop', function(assert) {
  const done = assert.async();

  assert.expect(2);
  const player = this.player;

  player.autoplay(true);

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

QUnit.test('Advanced Bip Bop preload=none', function(assert) {
  const done = assert.async();

  assert.expect(2);
  const player = this.player;

  player.autoplay(true);
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

