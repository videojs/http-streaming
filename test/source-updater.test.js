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
  }
});

QUnit.test('initial video timestamp offset is set to 0', function(assert) {
  assert.equal(
    this.sourceUpdater.videoTimestampOffset(), 0, 'initial video timestamp offset is 0');
});

QUnit.test('initial audio timestamp offset is set to 0', function(assert) {
  assert.equal(
    this.sourceUpdater.audioTimestampOffset(), 0, 'initial audio timestamp offset is 0');
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

QUnit.test('not ready by default', function(assert) {
  assert.notOk(this.sourceUpdater.ready(), 'source updater is not ready');
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
  const mockMediaSource = {
    addEventListenerCalls: [],
    addSourceBufferCalls: [],
    // readyState starts as closed, source updater has to wait for it to open
    readyState: 'closed',
    addEventListener:
      (name, callback) => mockMediaSource.addEventListenerCalls.push({ name, callback }),
    addSourceBuffer: (mimeType) => {
      mockMediaSource.addSourceBufferCalls.push(mimeType);
      return {
        // source updater adds event listeners immediately after creation, mock out to
        // prevent errors
        addEventListener() {}
      };
    }
  };

  this.sourceUpdater = new SourceUpdater(mockMediaSource);

  assert.equal(
    mockMediaSource.addEventListenerCalls.length, 0, 'no event listener calls');
  assert.equal(
    mockMediaSource.addSourceBufferCalls.length, 0, 'no add source buffer calls');

  this.sourceUpdater.createSourceBuffers({
    video: 'avc1.4d400d',
    audio: 'mp4a.40.2'
  });

  assert.equal(
    mockMediaSource.addEventListenerCalls.length, 1, 'one event listener');
  assert.equal(
    mockMediaSource.addEventListenerCalls[0].name,
    'sourceopen',
    'listening on sourceopen');
  assert.equal(
    mockMediaSource.addSourceBufferCalls.length, 0, 'no add source buffer calls');

  mockMediaSource.readyState = 'open';
  mockMediaSource.addEventListenerCalls[0].callback();

  assert.equal(
    mockMediaSource.addEventListenerCalls.length, 1, 'one event listener');
  assert.equal(
    mockMediaSource.addSourceBufferCalls.length, 2, 'two add source buffer calls');
  assert.equal(
    mockMediaSource.addSourceBufferCalls[0],
    'audio/mp4;codecs="mp4a.40.2"',
    'added audio source buffer');
  assert.equal(
    mockMediaSource.addSourceBufferCalls[1],
    'video/mp4;codecs="avc1.4d400d"',
    'added video source buffer');
});

QUnit.test('audioBuffered can append to and get the audio buffer', function(assert) {
  const done = assert.async();

  assert.notOk(this.sourceUpdater.audioBuffered(), 'no buffered when no source buffer');

  this.sourceUpdater.createSourceBuffers({
    audio: 'mp4a.40.2'
  });

  assert.equal(this.sourceUpdater.audioBuffered().length, 0, 'no buffered time range');

  this.sourceUpdater.appendBuffer('audio', mp4Audio(), () => {
    assert.equal(this.sourceUpdater.audioBuffered().length, 1, 'has buffered time range');
    assert.ok(this.sourceUpdater.audioBuffered().end(0) > 0, 'buffered content');
    done();
  });
});

QUnit.test('videoBuffered can append to and gets the video buffer', function(assert) {
  const done = assert.async();

  assert.notOk(this.sourceUpdater.videoBuffered(), 'no buffered when no source buffer');

  this.sourceUpdater.createSourceBuffers({
    video: 'avc1.4D001E'
  });

  assert.equal(this.sourceUpdater.videoBuffered().length, 0, 'no buffered time range');

  this.sourceUpdater.appendBuffer('video', mp4Video(), () => {
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

  this.sourceUpdater.appendBuffer('audio', mp4Audio(), () => {
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

  this.sourceUpdater.appendBuffer('video', mp4Video(), () => {
    assert.equal(this.sourceUpdater.buffered().length, 1, 'has buffered time range');
    assert.ok(this.sourceUpdater.buffered().end(0) > 0, 'buffered content');
    done();
  });
});

QUnit.test('buffered returns intersection of audio and video buffers', function(assert) {
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
});

// DONE:
// audio/video timestampoffset
// ready
// createSourceBuffers
// audioBuffered
// videoBuffered
// appendBuffer
// buffered
// TODO:
// start_?
// removeAudio
// removeVideo
// updating
// audioQueueCallback
// videoQueueCallback
// dispose

QUnit.test('runs a callback when the source buffer is created', function(assert) {
  let updater = new SourceUpdater(this.mediaSource, 'video/mp2t');
  let sourceBuffer;

  updater.appendBuffer(new Uint8Array([0, 1, 2]));

  this.mediaSource.trigger('sourceopen');
  sourceBuffer = this.mediaSource.sourceBuffers[0];
  assert.equal(sourceBuffer.updates_.length, 1, 'called the source buffer once');
  assert.deepEqual(sourceBuffer.updates_[0].append, new Uint8Array([0, 1, 2]),
                  'appended the bytes');
});

QUnit.test('runs callback if a media source exists when passed source buffer emitter',
function(assert) {
  let sourceBufferEmitter = new videojs.EventTarget();
  let sourceBuffer;

  this.mediaSource.trigger('sourceopen');
  // create other media source
  this.mediaSource.addSourceBuffer('audio/mp2t');

  let updater = new SourceUpdater(this.mediaSource, 'video/mp2t', sourceBufferEmitter);

  updater.appendBuffer(new Uint8Array([0, 1, 2]));

  sourceBuffer = this.mediaSource.sourceBuffers[1];
  assert.equal(sourceBuffer.updates_.length, 1, 'called the source buffer once');
  assert.deepEqual(sourceBuffer.updates_[0].append, new Uint8Array([0, 1, 2]),
                  'appended the bytes');
});

QUnit.test('runs callback after source buffer emitter triggers if other source buffer ' +
'doesn\'t exist at creation',
function(assert) {
  let sourceBufferEmitter = new videojs.EventTarget();
  let updater =
    new SourceUpdater(this.mediaSource, 'video/mp2t', '', sourceBufferEmitter);
  let sourceBuffer;

  updater.appendBuffer(new Uint8Array([0, 1, 2]));

  this.mediaSource.trigger('sourceopen');
  sourceBuffer = this.mediaSource.sourceBuffers[0];
  assert.equal(sourceBuffer.updates_.length, 0, 'did not call the source buffer');

  // create other media source
  this.mediaSource.addSourceBuffer('audio/mp2t');
  sourceBufferEmitter.trigger('sourcebufferadded');

  assert.equal(sourceBuffer.updates_.length, 1, 'called the source buffer once');
  assert.deepEqual(sourceBuffer.updates_[0].append, new Uint8Array([0, 1, 2]),
                  'appended the bytes');
});

QUnit.test('runs the completion callback when updateend fires', function(assert) {
  let updater = new SourceUpdater(this.mediaSource, 'video/mp2t');
  let updateends = 0;
  let sourceBuffer;

  this.mediaSource.trigger('sourceopen');
  sourceBuffer = this.mediaSource.sourceBuffers[0];
  updater.appendBuffer(new Uint8Array([0, 1, 2]), function() {
    updateends++;
  });
  updater.appendBuffer(new Uint8Array([2, 3, 4]), function() {
    throw new Error('Wrong completion callback invoked!');
  });

  assert.equal(updateends, 0, 'no completions yet');
  sourceBuffer.trigger('updateend');
  assert.equal(updateends, 1, 'ran the completion callback');
});

QUnit.test('runs the next callback after updateend fires', function(assert) {
  let updater = new SourceUpdater(this.mediaSource, 'video/mp2t');
  let sourceBuffer;

  updater.appendBuffer(new Uint8Array([0, 1, 2]));
  this.mediaSource.trigger('sourceopen');
  sourceBuffer = this.mediaSource.sourceBuffers[0];

  updater.appendBuffer(new Uint8Array([2, 3, 4]));
  assert.equal(sourceBuffer.updates_.length, 1, 'delayed the update');

  sourceBuffer.trigger('updateend');
  assert.equal(sourceBuffer.updates_.length, 2, 'updated twice');
  assert.deepEqual(sourceBuffer.updates_[1].append, new Uint8Array([2, 3, 4]),
                  'appended the bytes');
});

QUnit.test('runs only one callback at a time', function(assert) {
  let updater = new SourceUpdater(this.mediaSource, 'video/mp2t');
  let sourceBuffer;

  updater.appendBuffer(new Uint8Array([0]));
  updater.appendBuffer(new Uint8Array([1]));
  this.mediaSource.trigger('sourceopen');
  sourceBuffer = this.mediaSource.sourceBuffers[0];

  updater.appendBuffer(new Uint8Array([2]));
  assert.equal(sourceBuffer.updates_.length, 1, 'queued some updates');
  assert.deepEqual(sourceBuffer.updates_[0].append, new Uint8Array([0]),
                  'ran the first update');

  sourceBuffer.trigger('updateend');
  assert.equal(sourceBuffer.updates_.length, 2, 'queued some updates');
  assert.deepEqual(sourceBuffer.updates_[1].append, new Uint8Array([1]),
                  'ran the second update');

  updater.appendBuffer(new Uint8Array([3]));
  sourceBuffer.trigger('updateend');
  assert.equal(sourceBuffer.updates_.length, 3, 'queued the updates');
  assert.deepEqual(sourceBuffer.updates_[2].append, new Uint8Array([2]),
                  'ran the third update');

  sourceBuffer.trigger('updateend');
  assert.equal(sourceBuffer.updates_.length, 4, 'finished the updates');
  assert.deepEqual(sourceBuffer.updates_[3].append, new Uint8Array([3]),
                  'ran the fourth update');
});

QUnit.test('runs updates immediately if possible', function(assert) {
  let updater = new SourceUpdater(this.mediaSource, 'video/mp2t');
  let sourceBuffer;

  this.mediaSource.trigger('sourceopen');
  sourceBuffer = this.mediaSource.sourceBuffers[0];
  updater.appendBuffer(new Uint8Array([0]));
  assert.equal(sourceBuffer.updates_.length, 1, 'ran an update');
  assert.deepEqual(sourceBuffer.updates_[0].append, new Uint8Array([0]),
                  'appended the bytes');
});

QUnit.test('supports removeBuffer', function(assert) {
  let updater = new SourceUpdater(this.mediaSource, 'video/mp2t');
  let sourceBuffer;

  this.mediaSource.trigger('sourceopen');
  sourceBuffer = this.mediaSource.sourceBuffers[0];

  updater.remove(1, 14);

  assert.equal(sourceBuffer.updates_.length,
               0,
               'remove not queued before sourceBuffers are appended to');

  updater.appendBuffer(new Uint8Array([0]));

  updater.remove(1, 14);

  sourceBuffer.trigger('updateend');
  assert.equal(sourceBuffer.updates_.length, 2, 'ran an update');
  assert.deepEqual(sourceBuffer.updates_[1].remove, [1, 14], 'removed the time range');
});
