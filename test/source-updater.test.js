import document from 'global/document';
import window from 'global/window';
import QUnit from 'qunit';
import videojs from 'video.js';
import SourceUpdater from '../src/source-updater';
import { mp4Video, mp4Audio } from './test-segments';

QUnit.module('Source Updater', {
  beforeEach() {
    const video = document.createElement('video');

    this.mediaSource = new window.MediaSource();
    // need to attach the real media source to a video element for the media source to
    // change to an open ready state
    video.src = URL.createObjectURL(this.mediaSource);
    this.sourceUpdater = new SourceUpdater(this.mediaSource);

    // wait for the source to open (or error) before running through tests
    return new Promise((accept, reject) => {
      this.mediaSource.addEventListener('sourceopen', accept);
      this.mediaSource.addEventListener('error', reject);
    });
  },

  afterEach() {
    this.sourceUpdater.dispose();
  }
});

QUnit.test('waits for sourceopen to createSourceBuffers', function(assert) {
  this.sourceUpdater.dispose();
  const video = document.createElement('video');

  this.mediaSource = new window.MediaSource();
  // need to attach the real media source to a video element for the media source to
  // change to an open ready state
  video.src = URL.createObjectURL(this.mediaSource);
  this.sourceUpdater = new SourceUpdater(this.mediaSource);

  this.sourceUpdater.createSourceBuffers({
    audio: 'mp4a.40.2',
    video: 'avc1.4d400d'
  });

  assert.notOk(this.sourceUpdater.audioBuffer, 'no audio buffer');
  assert.notOk(this.sourceUpdater.videoBuffer, 'no video buffer');

  // wait for the source to open (or error) before running through tests
  return new Promise((accept, reject) => {
    this.mediaSource.addEventListener('sourceopen', () => {
      assert.ok(this.sourceUpdater.audioBuffer, 'audio buffer created');
      assert.ok(this.sourceUpdater.videoBuffer, 'video buffer created');

      accept();
    });
    this.mediaSource.addEventListener('error', reject);
  });
});

QUnit.test('runs callback when source buffer is created', function(assert) {
  this.sourceUpdater.dispose();
  const video = document.createElement('video');

  this.mediaSource = new window.MediaSource();
  // need to attach the real media source to a video element for the media source to
  // change to an open ready state
  video.src = URL.createObjectURL(this.mediaSource);
  this.sourceUpdater = new SourceUpdater(this.mediaSource);

  this.sourceUpdater.createSourceBuffers({
    audio: 'mp4a.40.2',
    video: 'avc1.4d400d'
  });

  this.sourceUpdater.appendBuffer({type: 'video', bytes: mp4Video()});

  // wait for the source to open (or error) before running through tests
  return new Promise((accept, reject) => {
    this.mediaSource.addEventListener('sourceopen', () => {
      assert.equal(this.sourceUpdater.queue.length, 0, 'nothing in queue');
      assert.equal(this.sourceUpdater.pendingQueue, null, 'nothing in pendingQueue');
      accept();
    });
    this.mediaSource.addEventListener('error', reject);
  });
});

QUnit.test('initial values', function(assert) {
  const videoOffset = this.sourceUpdater.videoTimestampOffset();
  const audioOffset = this.sourceUpdater.audioTimestampOffset();

  assert.equal(videoOffset, 0, 'initial video timestamp offset is 0');
  assert.equal(audioOffset, 0, 'initial audio timestamp offset is 0');
  assert.equal(this.sourceUpdater.ready(), false, 'not ready by default');
  assert.equal(this.sourceUpdater.updating(), false, 'not updating by default');
});

QUnit.test('can set audio timestamp offset', function(assert) {
  this.sourceUpdater.createSourceBuffers({
    audio: 'mp4a.40.2'
  });
  this.sourceUpdater.audioTimestampOffset(999);

  assert.equal(
    this.sourceUpdater.audioTimestampOffset(), 999, 'set audio timestamp offset');
});

QUnit.test('can set video timestamp offset', function(assert) {
  this.sourceUpdater.createSourceBuffers({
    video: 'avc1.4d400d'
  });
  this.sourceUpdater.videoTimestampOffset(999);

  assert.equal(
    this.sourceUpdater.videoTimestampOffset(), 999, 'set video timestamp offset');
});

QUnit.test('can set audio and video timestamp offsets independently', function(assert) {
  this.sourceUpdater.createSourceBuffers({
    audio: 'mp4a.40.2',
    video: 'avc1.4d400d'
  });
  this.sourceUpdater.audioTimestampOffset(111);
  this.sourceUpdater.videoTimestampOffset(999);

  assert.equal(
    this.sourceUpdater.audioTimestampOffset(), 111, 'set audio timestamp offset');
  assert.equal(
    this.sourceUpdater.videoTimestampOffset(), 999, 'set video timestamp offset');
});

QUnit.test('setting video timestamp offset without buffer is a noop', function(assert) {
  // only create the audio buffer
  this.sourceUpdater.createSourceBuffers({
    audio: 'mp4a.40.2'
  });
  this.sourceUpdater.videoTimestampOffset(999);

  assert.equal(
    this.sourceUpdater.videoTimestampOffset(), 0, 'offset stays at initial value');
});

QUnit.test('setting audio timestamp offset without buffer is a noop', function(assert) {
  // only create the video buffer
  this.sourceUpdater.createSourceBuffers({
    video: 'avc1.4d400d'
  });
  this.sourceUpdater.audioTimestampOffset(999);

  assert.equal(
    this.sourceUpdater.audioTimestampOffset(), 0, 'offset stays at initial value');
});

QUnit.test('ready with a video buffer', function(assert) {
  this.sourceUpdater.createSourceBuffers({
    video: 'avc1.4d400d'
  });
  assert.ok(this.sourceUpdater.ready(), 'source updater is ready');
});

QUnit.test('ready with an audio buffer', function(assert) {
  this.sourceUpdater.createSourceBuffers({
    audio: 'mp4a.40.2'
  });
  assert.ok(this.sourceUpdater.ready(), 'source updater is ready');
});

QUnit.test('ready with both an audio and video buffer', function(assert) {
  this.sourceUpdater.createSourceBuffers({
    video: 'avc1.4d400d',
    audio: 'mp4a.40.2'
  });
  assert.ok(this.sourceUpdater.ready(), 'source updater is ready');
});

QUnit.test('waits for sourceopen to create source buffers', function(assert) {
  const addEventListeners = [];
  const addSourceBuffers = [];
  const mockMediaSource = {
    // readyState starts as closed, source updater has to wait for it to open
    readyState: 'closed',
    addEventListener:
      (name, callback) => addEventListeners.push({ name, callback }),
    removeEventListener() {},
    addSourceBuffer: (mimeType) => {
      addSourceBuffers.push(mimeType);
      return {
        // source updater adds event listeners immediately after creation, mock out to
        // prevent errors
        addEventListener() {},
        removeEventListener() {},
        abort() {}
      };
    }
  };

  // create new source update instance to allow for mocked media source
  const sourceUpdater = new SourceUpdater(mockMediaSource);

  assert.equal(addEventListeners.length, 0, 'no event listener calls');
  assert.equal(addSourceBuffers.length, 0, 'no add source buffer calls');

  sourceUpdater.createSourceBuffers({
    video: 'avc1.4d400d',
    audio: 'mp4a.40.2'
  });

  assert.equal(addEventListeners.length, 1, 'one event listener');
  assert.equal(addEventListeners[0].name, 'sourceopen', 'listening on sourceopen');
  assert.equal(addSourceBuffers.length, 0, 'no add source buffer calls');

  mockMediaSource.readyState = 'open';
  addEventListeners[0].callback();

  assert.equal(addEventListeners.length, 1, 'one event listener');
  assert.equal(addSourceBuffers.length, 2, 'two add source buffer calls');
  assert.equal(addSourceBuffers[0], 'audio/mp4;codecs="mp4a.40.2"', 'added audio source buffer');
  assert.equal(addSourceBuffers[1], 'video/mp4;codecs="avc1.4d400d"', 'added video source buffer');

  sourceUpdater.dispose();
});

QUnit.test('audioBuffered can append to and get the audio buffer', function(assert) {
  const done = assert.async();

  assert.equal(this.sourceUpdater.audioBuffered().length, 0, 'no buffered time range');

  this.sourceUpdater.createSourceBuffers({
    audio: 'mp4a.40.2'
  });

  assert.equal(this.sourceUpdater.audioBuffered().length, 0, 'no buffered time range');

  this.sourceUpdater.appendBuffer({type: 'audio', bytes: mp4Audio()}, () => {
    assert.equal(this.sourceUpdater.audioBuffered().length, 1, 'has buffered time range');
    assert.ok(this.sourceUpdater.audioBuffered().end(0) > 0, 'buffered content');
    done();
  });
});

QUnit.test('videoBuffered can append to and gets the video buffer', function(assert) {
  const done = assert.async();

  assert.equal(this.sourceUpdater.videoBuffered().length, 0, 'no buffered time range');

  this.sourceUpdater.createSourceBuffers({
    video: 'avc1.4D001E'
  });

  assert.equal(this.sourceUpdater.videoBuffered().length, 0, 'no buffered time range');

  this.sourceUpdater.appendBuffer({type: 'video', bytes: mp4Video()}, () => {
    assert.equal(this.sourceUpdater.videoBuffered().length, 1, 'has buffered time range');
    assert.ok(this.sourceUpdater.videoBuffered().end(0) > 0, 'buffered content');
    done();
  });
});

QUnit.test('buffered returns audio buffer when only audio', function(assert) {
  const done = assert.async();

  assert.equal(this.sourceUpdater.buffered().length, 0, 'no buffered time range');

  this.sourceUpdater.createSourceBuffers({
    audio: 'mp4a.40.2'
  });

  assert.equal(this.sourceUpdater.buffered().length, 0, 'no buffered time range');

  this.sourceUpdater.appendBuffer({type: 'audio', bytes: mp4Audio()}, () => {
    assert.equal(this.sourceUpdater.buffered().length, 1, 'has buffered time range');
    assert.ok(this.sourceUpdater.buffered().end(0) > 0, 'buffered content');
    done();
  });
});

QUnit.test('buffered returns video buffer when only video', function(assert) {
  const done = assert.async();

  assert.equal(this.sourceUpdater.buffered().length, 0, 'no buffered time range');

  this.sourceUpdater.createSourceBuffers({
    video: 'avc1.4D001E'
  });

  assert.equal(this.sourceUpdater.buffered().length, 0, 'no buffered time range');

  this.sourceUpdater.appendBuffer({type: 'video', bytes: mp4Video()}, () => {
    assert.equal(this.sourceUpdater.buffered().length, 1, 'has buffered time range');
    assert.ok(this.sourceUpdater.buffered().end(0) > 0, 'buffered content');
    done();
  });
});

QUnit.test('buffered returns intersection of audio and video buffers', function(assert) {
  const origAudioBuffer = this.sourceUpdater.audioBuffer;
  const origVideoBuffer = this.sourceUpdater.videoBuffer;

  // mocking the buffered ranges in this test because it's tough to know how much each
  // browser will actually buffer
  this.sourceUpdater.audioBuffer = {
    buffered: videojs.createTimeRanges([[1, 2], [5.5, 5.6], [10.5, 11]])
  };
  this.sourceUpdater.videoBuffer = {
    buffered: videojs.createTimeRanges([[1.25, 1.5], [5.1, 6.1], [10.5, 10.9]])
  };

  assert.timeRangesEqual(
   this.sourceUpdater.buffered(),
   videojs.createTimeRanges([[1.25, 1.5], [5.5, 5.6], [10.5, 10.9]]),
   'buffered is intersection');

  this.sourceUpdater.audioBuffer = origAudioBuffer;
  this.sourceUpdater.videoBuffer = origVideoBuffer;
});

QUnit.test('removeAudio removes audio buffer', function(assert) {
  const done = assert.async();

  this.sourceUpdater.createSourceBuffers({
    audio: 'mp4a.40.2'
  });

  this.sourceUpdater.appendBuffer({type: 'audio', bytes: mp4Audio()}, () => {
    assert.equal(this.sourceUpdater.buffered().length, 1, 'has buffered time range');
    assert.ok(this.sourceUpdater.buffered().end(0) > 0, 'buffered content');
    this.sourceUpdater.removeAudio(0, Infinity, () => {
      assert.equal(this.sourceUpdater.buffered().length, 0, 'no buffered conent');
      done();
    });
  });
});

QUnit.test('removeVideo removes video buffer', function(assert) {
  const done = assert.async();

  this.sourceUpdater.createSourceBuffers({
    video: 'avc1.4D001E'
  });

  this.sourceUpdater.appendBuffer({type: 'video', bytes: mp4Video()}, () => {
    assert.equal(this.sourceUpdater.buffered().length, 1, 'has buffered time range');
    assert.ok(this.sourceUpdater.buffered().end(0) > 0, 'buffered content');
    this.sourceUpdater.removeVideo(0, Infinity, () => {
      assert.equal(this.sourceUpdater.buffered().length, 0, 'no buffered content');
      done();
    });
  });
});

QUnit.test('removeAudio does not remove video buffer', function(assert) {
  const done = assert.async();

  this.sourceUpdater.createSourceBuffers({
    audio: 'mp4a.40.2',
    video: 'avc1.4D001E'
  });

  this.sourceUpdater.appendBuffer({type: 'video', bytes: mp4Video()}, () => {
    assert.ok(this.sourceUpdater.videoBuffered().end(0) > 0, 'buffered audio content');
    this.sourceUpdater.appendBuffer({type: 'audio', bytes: mp4Audio()}, () => {
      assert.ok(this.sourceUpdater.audioBuffered().end(0) > 0, 'buffered video content');
      this.sourceUpdater.removeAudio(0, Infinity, () => {
        assert.equal(
          this.sourceUpdater.audioBuffered().length, 0, 'removed audio content');
        assert.equal(
          this.sourceUpdater.videoBuffered().length, 1, 'has buffered video time range');
        assert.ok(
          this.sourceUpdater.videoBuffered().end(0) > 0, 'did not remove video content');
        done();
      });
    });
  });
});

QUnit.test('removeVideo does not remove audio buffer', function(assert) {
  const done = assert.async();

  this.sourceUpdater.createSourceBuffers({
    audio: 'mp4a.40.2',
    video: 'avc1.4D001E'
  });

  this.sourceUpdater.appendBuffer({type: 'video', bytes: mp4Video()}, () => {
    assert.ok(this.sourceUpdater.videoBuffered().end(0) > 0, 'buffered audio content');
    this.sourceUpdater.appendBuffer({type: 'audio', bytes: mp4Audio()}, () => {
      assert.ok(this.sourceUpdater.audioBuffered().end(0) > 0, 'buffered video content');
      this.sourceUpdater.removeVideo(0, Infinity, () => {
        assert.equal(
          this.sourceUpdater.videoBuffered().length, 0, 'removed video content');
        assert.equal(
          this.sourceUpdater.audioBuffered().length, 1, 'has buffered audio time range');
        assert.ok(
          this.sourceUpdater.audioBuffered().end(0) > 0, 'did not remove audio content');
        done();
      });
    });
  });
});

QUnit.test('audioQueueCallback calls callback immediately if queue is empty',
function(assert) {
  // Source buffer must exist for the callback to run. This case isn't tested, as it isn't
  // required behavior (at the moment), but is necessary to know for this test.
  this.sourceUpdater.createSourceBuffers({
    audio: 'mp4a.40.2'
  });

  let executedCallback = false;

  this.sourceUpdater.audioQueueCallback(() => {
    executedCallback = true;
  });

  assert.ok(executedCallback, 'executed callback');
});

QUnit.test('videoQueueCallback calls callback immediately if queue is empty',
function(assert) {
  // Source buffer must exist for the callback to run. This case isn't tested, as it isn't
  // required behavior (at the moment), but is necessary to know for this test.
  this.sourceUpdater.createSourceBuffers({
    video: 'avc1.4D001E'
  });

  let executedCallback = false;

  this.sourceUpdater.videoQueueCallback(() => {
    executedCallback = true;
  });

  assert.ok(executedCallback, 'executed callback');
});

QUnit.test('audioQueueCallback calls callback after queue empties if queue is not empty',
function(assert) {
  const done = assert.async();

  // Source buffer must exist for the callback to run. This case isn't tested, as it isn't
  // required behavior (at the moment), but is necessary to know for this test.
  this.sourceUpdater.createSourceBuffers({
    audio: 'mp4a.40.2'
  });

  let executedCallback = false;
  let appendedAudio = false;

  this.sourceUpdater.appendBuffer({type: 'audio', bytes: mp4Audio()}, () => {
    appendedAudio = true;
    assert.notOk(executedCallback, 'haven\'t executed callback');
    setTimeout(() => {
      assert.ok(executedCallback, 'executed callback');
      done();
    }, 1);
  });

  assert.notOk(appendedAudio, 'haven\'t appended audio before callback is queued');

  this.sourceUpdater.audioQueueCallback(() => {
    executedCallback = true;
  });
});

QUnit.test('videoQueueCallback calls callback after queue empties if queue is not empty',
  function(assert) {
    const done = assert.async();

    // Source buffer must exist for the callback to run. This case isn't tested, as it isn't
    // required behavior (at the moment), but is necessary to know for this test.
    this.sourceUpdater.createSourceBuffers({
      video: 'avc1.4D001E'
    });

    let executedCallback = false;
    let appendedVideo = false;

    this.sourceUpdater.appendBuffer({type: 'video', bytes: mp4Video()}, () => {
      appendedVideo = true;
      assert.notOk(executedCallback, 'haven\'t executed callback');
      setTimeout(() => {
        assert.ok(executedCallback, 'executed callback');
        done();
      }, 1);
    });

    assert.notOk(appendedVideo, 'haven\'t appended video before callback is queued');

    this.sourceUpdater.videoQueueCallback(() => {
      executedCallback = true;
    });
  });

QUnit.test('audioQueueCallback does not call video queue callback after queue empties',
function(assert) {
  const done = assert.async();

  // Source buffer must exist for the callback to run. This case isn't tested, as it isn't
  // required behavior (at the moment), but is necessary to know for this test.
  this.sourceUpdater.createSourceBuffers({
    audio: 'mp4a.40.2',
    video: 'avc1.4D001E'
  });

  let executedVideoCallback = false;
  let appendedAudio = false;

  // we have to append video
  this.sourceUpdater.appendBuffer({type: 'video', bytes: mp4Video()}, () => {
    this.sourceUpdater.appendBuffer({type: 'audio', bytes: mp4Audio()}, () => {
      appendedAudio = true;
      assert.notOk(executedVideoCallback, 'haven\'t executed callback');
      setTimeout(() => {
        assert.notOk(executedVideoCallback, 'haven\'t executed callback');
        done();
      }, 0);
    });

    // add a video queue entry so that the video queue callback doesn't immediately run
    this.sourceUpdater.queuePending.video = {};

    assert.notOk(appendedAudio, 'haven\'t appended audio before callback is queued');

    this.sourceUpdater.videoQueueCallback(() => {
      executedVideoCallback = true;
    });
  });
});

QUnit.test('videoQueueCallback does not call audio queue callback after queue empties',
function(assert) {
  const done = assert.async();

  // Source buffer must exist for the callback to run. This case isn't tested, as it isn't
  // required behavior (at the moment), but is necessary to know for this test.
  this.sourceUpdater.createSourceBuffers({
    audio: 'mp4a.40.2',
    video: 'avc1.4D001E'
  });

  let executedAudioCallback = false;
  let appendedVideo = false;

  this.sourceUpdater.appendBuffer({type: 'video', bytes: mp4Video()}, () => {
    appendedVideo = true;
    assert.notOk(executedAudioCallback, 'haven\'t executed callback');
    setTimeout(() => {
      assert.notOk(executedAudioCallback, 'haven\'t executed callback');
      done();
    }, 0);
  });

  // add a video queue entry so that the video queue callback doesn't immediately run
  this.sourceUpdater.queuePending.audio = {};

  assert.notOk(appendedVideo, 'haven\'t appended video before callback is queued');

  this.sourceUpdater.audioQueueCallback(() => {
    executedAudioCallback = true;
  });
});

QUnit.test('updating returns true if audio buffer is updating', function(assert) {
  const done = assert.async();

  this.sourceUpdater.createSourceBuffers({
    audio: 'mp4a.40.2'
  });

  assert.notOk(this.sourceUpdater.updating(), 'not updating by default');

  this.sourceUpdater.appendBuffer({type: 'audio', bytes: mp4Audio()}, () => {
    assert.notOk(this.sourceUpdater.updating(), 'not updating after append');
    done();
  });

  assert.ok(this.sourceUpdater.updating(), 'updating during audio append');

});

QUnit.test('updating returns true if video buffer is updating', function(assert) {
  const done = assert.async();

  this.sourceUpdater.createSourceBuffers({
    video: 'avc1.4D001E'
  });

  assert.notOk(this.sourceUpdater.updating(), 'not updating by default');

  this.sourceUpdater.appendBuffer({type: 'video', bytes: mp4Video()}, () => {
    assert.notOk(this.sourceUpdater.updating(), 'not updating after append');
    done();
  });

  assert.ok(this.sourceUpdater.updating(), 'updating during append');
});

QUnit.test('updating returns true if either audio or video buffer is updating',
function(assert) {
  const done = assert.async();

  this.sourceUpdater.createSourceBuffers({
    audio: 'mp4a.40.2',
    video: 'avc1.4D001E'
  });

  assert.notOk(this.sourceUpdater.updating(), 'not updating by default');

  this.sourceUpdater.appendBuffer({type: 'video', bytes: mp4Video()}, () => {
    assert.notOk(this.sourceUpdater.updating(), 'not updating after append');
    this.sourceUpdater.appendBuffer({type: 'audio', bytes: mp4Audio()}, () => {
      assert.notOk(this.sourceUpdater.updating(), 'not updating after append');
      done();
    });
    assert.ok(this.sourceUpdater.updating(), 'updating during append');
  });

  assert.ok(this.sourceUpdater.updating(), 'updating during append');
});

QUnit.test('dispose aborts and clears out audio and video buffers', function(assert) {
  this.sourceUpdater.createSourceBuffers({
    audio: 'mp4a.40.2',
    video: 'avc1.4D001E'
  });

  // while this maintains internal logic of source updater (knowing the properties), it is
  // good for this test to verify that those properties are cleared out
  assert.ok(this.sourceUpdater.audioBuffer, 'have an audio buffer');
  assert.ok(this.sourceUpdater.videoBuffer, 'have a video buffer');

  // Let the original aborts run so that we don't mock out any behaviors.
  const origAudioAbort =
    this.sourceUpdater.audioBuffer.abort.bind(this.sourceUpdater.audioBuffer);
  const origVideoAbort =
    this.sourceUpdater.videoBuffer.abort.bind(this.sourceUpdater.videoBuffer);
  let abortedAudio = false;
  let abortedVideo = false;

  this.sourceUpdater.audioBuffer.abort = () => {
    abortedAudio = true;
    origAudioAbort();
  };
  this.sourceUpdater.videoBuffer.abort = () => {
    abortedVideo = true;
    origVideoAbort();
  };

  this.sourceUpdater.dispose();

  assert.ok(abortedAudio, 'aborted audio');
  assert.ok(abortedVideo, 'aborted video');
  assert.notOk(this.sourceUpdater.audioBuffer, 'removed audioBuffer reference');
  assert.notOk(this.sourceUpdater.videoBuffer, 'removed videoBuffer reference');
});

QUnit.test('no error passed by default in done callback', function(assert) {
  const done = assert.async();

  this.sourceUpdater.createSourceBuffers({
    audio: 'mp4a.40.2'
  });

  this.sourceUpdater.appendBuffer({type: 'audio', bytes: mp4Audio()}, (error) => {
    assert.notOk(error, 'no error');
    done();
  });
});

QUnit.test('audio source buffer error passed in done callback', function(assert) {
  const done = assert.async();

  this.sourceUpdater.createSourceBuffers({
    audio: 'mp4a.40.2'
  });

  const corruptVideoSegment = mp4Video();

  // throw some bad data in the segment
  corruptVideoSegment.fill(5, 100, 500);

  // errors when appending video to an audio buffer
  this.sourceUpdater.appendBuffer({type: 'audio', bytes: corruptVideoSegment}, (error) => {
    assert.ok(error, 'error passed back');
    done();
  });
});

QUnit.test('video source buffer error passed in done callback', function(assert) {
  const done = assert.async();

  this.sourceUpdater.createSourceBuffers({
    video: 'avc1.4D001E'
  });

  const corruptAudioSegment = mp4Audio();

  // throw some bad data in the segment
  corruptAudioSegment.fill(5, 100, 500);

  // errors when appending audio to a video buffer
  this.sourceUpdater.appendBuffer({type: 'video', bytes: corruptAudioSegment}, (error) => {
    assert.ok(error, 'error passed back');
    done();
  });
});

QUnit.test('setDuration processes immediately if not waiting on source buffers',
function(assert) {
  this.sourceUpdater.createSourceBuffers({
    audio: 'mp4a.40.2',
    video: 'avc1.4D001E'
  });

  assert.ok(Number.isNaN(this.mediaSource.duration), 'duration set to NaN at start');
  this.sourceUpdater.setDuration(11);
  assert.equal(this.mediaSource.duration, 11, 'set duration on media source');
});

QUnit.test('setDuration waits for audio buffer to finish updating', function(assert) {
  const done = assert.async();

  assert.expect(5);

  this.sourceUpdater.createSourceBuffers({
    audio: 'mp4a.40.2'
  });

  assert.notOk(this.sourceUpdater.updating(), 'not updating by default');

  this.sourceUpdater.appendBuffer({type: 'audio', bytes: mp4Audio()}, () => {
    // duration is set to infinity if content is appended before an explicit duration is
    // set https://w3c.github.io/media-source/#sourcebuffer-init-segment-received
    assert.equal(this.mediaSource.duration, Infinity, 'duration not set on media source');
  });
  this.sourceUpdater.setDuration(11, () => {
    assert.equal(this.mediaSource.duration, 11, 'set duration on media source');
    done();
  });

  assert.ok(Number.isNaN(this.mediaSource.duration), 'duration set to NaN at start');
  assert.ok(this.sourceUpdater.updating(), 'updating during appends');
});

QUnit.test('setDuration waits for video buffer to finish updating', function(assert) {
  const done = assert.async();

  assert.expect(5);

  this.sourceUpdater.createSourceBuffers({
    audio: 'mp4a.40.2',
    video: 'avc1.4D001E'
  });

  assert.notOk(this.sourceUpdater.updating(), 'not updating by default');

  this.sourceUpdater.appendBuffer({type: 'video', bytes: mp4Video()}, () => {
    // duration is set to infinity if content is appended before an explicit duration is
    // set https://w3c.github.io/media-source/#sourcebuffer-init-segment-received
    assert.equal(this.mediaSource.duration, Infinity, 'duration not set on media source');
  });
  this.sourceUpdater.setDuration(11, () => {
    assert.equal(this.mediaSource.duration, 11, 'set duration on media source');
    done();
  });

  assert.ok(Number.isNaN(this.mediaSource.duration), 'duration set to NaN at start');
  assert.ok(this.sourceUpdater.updating(), 'updating during appends');
});

QUnit.test('setDuration waits for both audio and video buffers to finish updating',
function(assert) {
  const done = assert.async();
  let appendsFinished = 0;

  assert.expect(7);

  this.sourceUpdater.createSourceBuffers({
    audio: 'mp4a.40.2',
    video: 'avc1.4D001E'
  });

  assert.notOk(this.sourceUpdater.updating(), 'not updating by default');

  const checkDuration = () => {
    // duration is set to infinity if content is appended before an explicit duration is
    // set https://w3c.github.io/media-source/#sourcebuffer-init-segment-received
    assert.equal(this.mediaSource.duration, Infinity, 'duration not set on media source');

    if (appendsFinished === 0) {
      // try to set the duration while one of the buffers is still updating, this should
      // happen after the other setDuration call
      this.sourceUpdater.setDuration(12, () => {
        assert.equal(this.mediaSource.duration, 12, 'set duration on media source');
        done();
      });
    }

    appendsFinished++;
  };

  this.sourceUpdater.appendBuffer({type: 'video', bytes: mp4Video()}, checkDuration);
  this.sourceUpdater.appendBuffer({type: 'audio', bytes: mp4Audio()}, checkDuration);
  this.sourceUpdater.setDuration(11, () => {
    assert.equal(this.mediaSource.duration, 11, 'set duration on media source');
  });

  assert.ok(Number.isNaN(this.mediaSource.duration), 'duration set to NaN at start');
  assert.ok(this.sourceUpdater.updating(), 'updating during appends');
});

QUnit.test('setDuration blocks audio and video queue entries until it finishes',
function(assert) {
  const done = assert.async(2);

  assert.expect(6);

  this.sourceUpdater.createSourceBuffers({
    audio: 'mp4a.40.2',
    video: 'avc1.4D001E'
  });

  const checkDurationPreSet = () => {
    // duration is set to infinity if content is appended before an explicit duration is
    // set https://w3c.github.io/media-source/#sourcebuffer-init-segment-received
    assert.equal(this.mediaSource.duration, Infinity, 'duration not set on media source');
  };

  this.sourceUpdater.appendBuffer({type: 'video', bytes: mp4Video()}, checkDurationPreSet);
  this.sourceUpdater.appendBuffer({type: 'audio', bytes: mp4Audio()}, checkDurationPreSet);
  this.sourceUpdater.setDuration(11, () => {
    assert.equal(this.mediaSource.duration, 11, 'set duration on media source');
  });
  this.sourceUpdater.appendBuffer({type: 'video', bytes: mp4Video()}, () => {
    assert.equal(
      this.mediaSource.duration,
      11,
      'video append processed post duration set');
    done();
  });
  this.sourceUpdater.appendBuffer({type: 'audio', bytes: mp4Audio()}, () => {
    assert.equal(
      this.mediaSource.duration,
      11,
      'audio append processed post duration set');
    done();
  });

  assert.ok(Number.isNaN(this.mediaSource.duration), 'duration set to NaN at start');
});

QUnit.test('endOfStream processes immediately if not waiting on source buffers',
function(assert) {
  this.sourceUpdater.createSourceBuffers({
    audio: 'mp4a.40.2',
    video: 'avc1.4D001E'
  });

  assert.equal(this.mediaSource.readyState, 'open', 'media source is open');
  this.sourceUpdater.endOfStream();
  assert.equal(this.mediaSource.readyState, 'ended', 'media source is ended');
});

QUnit.test('endOfStream can be called with an error string',
function(assert) {
  this.sourceUpdater.createSourceBuffers({
    audio: 'mp4a.40.2',
    video: 'avc1.4D001E'
  });

  assert.equal(this.mediaSource.readyState, 'open', 'media source is open');
  this.sourceUpdater.endOfStream('network');
  // some browsers mark it as ended, others as closed
  assert.ok((/^ended|closed$/).test(this.mediaSource.readyState), 'media source is ended');
});

QUnit.test('endOfStream waits for audio buffer to finish updating', function(assert) {
  const done = assert.async();

  assert.expect(5);

  this.sourceUpdater.createSourceBuffers({
    audio: 'mp4a.40.2'
  });

  assert.notOk(this.sourceUpdater.updating(), 'not updating by default');

  this.sourceUpdater.appendBuffer({type: 'audio', bytes: mp4Audio()}, () => {
    assert.equal(this.mediaSource.readyState, 'open', 'media source is open');
  });
  this.sourceUpdater.endOfStream(null, () => {
    assert.equal(this.mediaSource.readyState, 'ended', 'media source is ended');
    done();
  });

  assert.equal(this.mediaSource.readyState, 'open', 'media source is open');
  assert.ok(this.sourceUpdater.updating(), 'updating during appends');
});

QUnit.test('endOfStream waits for video buffer to finish updating', function(assert) {
  const done = assert.async();

  assert.expect(5);

  this.sourceUpdater.createSourceBuffers({
    audio: 'mp4a.40.2',
    video: 'avc1.4D001E'
  });

  assert.notOk(this.sourceUpdater.updating(), 'not updating by default');

  this.sourceUpdater.appendBuffer({type: 'video', bytes: mp4Video()}, () => {
    assert.equal(this.mediaSource.readyState, 'open', 'media source is open');
  });
  this.sourceUpdater.endOfStream(null, () => {
    assert.equal(this.mediaSource.readyState, 'ended', 'media source is ended');
    done();
  });

  assert.equal(this.mediaSource.readyState, 'open', 'media source is open');
  assert.ok(this.sourceUpdater.updating(), 'updating during appends');
});

QUnit.test('endOfStream waits for both audio and video buffers to finish updating',
function(assert) {
  const done = assert.async();
  let appendsFinished = 0;

  assert.expect(7);

  this.sourceUpdater.createSourceBuffers({
    audio: 'mp4a.40.2',
    video: 'avc1.4D001E'
  });

  assert.notOk(this.sourceUpdater.updating(), 'not updating by default');

  const checkDuration = () => {
    assert.equal(this.mediaSource.readyState, 'open', 'media source is open');

    if (appendsFinished === 0) {
      this.sourceUpdater.endOfStream(null, () => {
        assert.equal(this.mediaSource.readyState, 'ended', 'media source is ended');
        done();
      });
    }

    appendsFinished++;
  };

  this.sourceUpdater.appendBuffer({type: 'video', bytes: mp4Video()}, checkDuration);
  this.sourceUpdater.appendBuffer({type: 'audio', bytes: mp4Audio()}, checkDuration);
  this.sourceUpdater.endOfStream(null, () => {
    assert.equal(this.mediaSource.readyState, 'ended', 'media source is ended');
  });

  assert.equal(this.mediaSource.readyState, 'open', 'media source is open');
  assert.ok(this.sourceUpdater.updating(), 'updating during appends');
});

QUnit.test('dispose removes sourceopen listener', function(assert) {
  // create fake media source so we can detect event listeners being added and removed
  const addEventListenerCalls = [];
  const removeEventListenerCalls = [];
  const mediaSource = {
    // native media source ready state starts as closed
    readyState: 'closed',
    addEventListener(type, callback) {
      addEventListenerCalls.push({ type, callback });
    },
    removeEventListener(type, callback) {
      removeEventListenerCalls.push({ type, callback });
    }
  };
  const sourceUpdater = new SourceUpdater(mediaSource);

  // need to call createSourceBuffers before the source updater will check that the media
  // source is opened
  sourceUpdater.createSourceBuffers({});

  assert.equal(addEventListenerCalls.length, 1, 'added one event listener');
  assert.equal(addEventListenerCalls[0].type, 'sourceopen', 'added sourceopen listener');
  assert.equal(typeof addEventListenerCalls[0].callback, 'function', 'added callback');
  assert.equal(removeEventListenerCalls.length, 0, 'no remove event listener calls');

  sourceUpdater.dispose();

  assert.equal(addEventListenerCalls.length, 1, 'no event listener added');
  assert.equal(removeEventListenerCalls.length, 1, 'removed an event listener');
  assert.equal(
    removeEventListenerCalls[0].type, 'sourceopen', 'removed sourceopen listener');
  assert.equal(
    removeEventListenerCalls[0].callback,
    addEventListenerCalls[0].callback,
    'removed sourceopen listener with correct callback');
});

['audio', 'video'].forEach(function(type) {
  QUnit.test(`runs next in queue after calling ${type}timestampOffset`, function(assert) {
    let bytes;
    const options = {};

    if (type === 'video') {
      options.video = 'avc1.4d400d';
      bytes = mp4Video();
    } else {
      options.audio = 'mp4a.40.2';
      bytes = mp4Audio();
    }
    let appendBufferCalled = false;

    this.sourceUpdater.createSourceBuffers(options);
    this.sourceUpdater[`${type}Buffer`].appendBuffer = () => appendBufferCalled = true;

    this.sourceUpdater[`${type}TimestampOffset`](10);
    this.sourceUpdater.appendBuffer({type, bytes});

    assert.equal(this.sourceUpdater[`${type}TimestampOffset`](), 10, 'offset correctly set');
    assert.equal(this.sourceUpdater.queue.length, 0, 'append not in queue');
    assert.equal(this.sourceUpdater.pendingQueue, null, 'append not in pending Queue');
    assert.equal(appendBufferCalled, true, 'appendBuffer called on source buffer');
  });

  QUnit.test(`${type} abort on dispose waits until after a remove has finished`, function(assert) {
    const done = assert.async();
    const options = {};
    let bytes;
    const capitalType = type.charAt(0).toUpperCase() + type.slice(1);

    if (type === 'video') {
      options.video = 'avc1.4d400d';
      bytes = mp4Video();
    } else {
      options.audio = 'mp4a.40.2';
      bytes = mp4Audio();
    }
    let abort = false;

    this.sourceUpdater.createSourceBuffers(options);
    this.sourceUpdater[`${type}Buffer`].abort = () => {
      abort = true;
    };

    this.sourceUpdater.appendBuffer({type, bytes}, () => {
      this.sourceUpdater[`remove${capitalType}`](0, Infinity, () => {
        assert.ok(!abort, 'abort not called right after remove');
      });

      assert.ok(this.sourceUpdater[`${type}Buffer`].removing, true, 'removing is set');
      this.sourceUpdater.dispose();

      this.sourceUpdater[`${type}Buffer`].addEventListener('updateend', () => {
        assert.ok(abort, 'abort called after updateend');
        done();
      });
      assert.equal(abort, false, 'abort not called right away');
    });
  });
});

QUnit.test('audio appends are delayed until video append for the first append', function(assert) {
  const done = assert.async();

  assert.timeout(5000);

  let audioAppend = false;
  let videoAppend = false;

  this.sourceUpdater.createSourceBuffers({
    audio: 'mp4a.40.2',
    video: 'avc1.4D001E'
  });
  this.sourceUpdater.appendBuffer({type: 'audio', bytes: mp4Audio()}, () => {
    assert.ok(videoAppend, 'video appended first');
    audioAppend = true;
    this.sourceUpdater.appendBuffer({type: 'audio', bytes: mp4Audio()}, () => {
      assert.ok(true, 'second audio append happens right away');
      done();
    });
  });
  this.sourceUpdater.appendBuffer({type: 'video', bytes: mp4Video()}, () => {
    videoAppend = true;
    assert.ok(!audioAppend, 'audio has not appended yet');
  });
});
