import document from 'global/document';
import window from 'global/window';
import QUnit from 'qunit';
import sinon from 'sinon';
import videojs from 'video.js';

QUnit.module('videojs-contrib-media-sources - HTML', {
  beforeEach() {
    this.fixture = document.getElementById('qunit-fixture');
    this.video = document.createElement('video');
    this.fixture.appendChild(this.video);
    this.source = document.createElement('source');

    this.player = videojs(this.video);
    // add a fake source so that we can get this.player_ on sourceopen
    this.url = 'fake.ts';
    this.source.src = this.url;
    this.video.appendChild(this.source);

    // Mock the environment's timers because certain things - particularly
    // player readiness - are asynchronous in video.js 5.
    this.clock = sinon.useFakeTimers();
    this.oldMediaSource = window.MediaSource || window.WebKitMediaSource;
    window.MediaSource = videojs.extend(videojs.EventTarget, {
      constructor() {
        this.isNative = true;
        this.sourceBuffers = [];
        this.duration = NaN;
      },
      addSourceBuffer(type) {
        let buffer = new (videojs.extend(videojs.EventTarget, {
          type,
          appendBuffer() {}
        }))();

        this.sourceBuffers.push(buffer);
        return buffer;
      }
    });
    window.MediaSource.isTypeSupported = function(mime) {
      return true;
    };
    window.WebKitMediaSource = window.MediaSource;
  },
  afterEach() {
    this.clock.restore();
    this.player.dispose();
    window.MediaSource = this.oldMediaSource;
    window.WebKitMediaSource = window.MediaSource;
  }
});

// TODO move to segment loader
QUnit.todo('sets transmuxer baseMediaDecodeTime on appends', function(assert) {
  let mediaSource = new window.MediaSource();
  let sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');
  let resets = [];

  sourceBuffer.transmuxer_.postMessage = function(message) {
    if (message.action === 'setTimestampOffset') {
      resets.push(message.timestampOffset);
    }
  };

  sourceBuffer.timestampOffset = 42;

  assert.strictEqual(
    resets.length,
    1,
    'reset called'
  );
  assert.strictEqual(
    resets[0],
    42,
    'set the baseMediaDecodeTime based on timestampOffset'
  );
});
