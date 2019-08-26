import videojs from 'video.js';
import QUnit from 'qunit';
import { buffered } from '../../src/util/buffer';
import {timeRangesEqual} from '../custom-assertions.js';

QUnit.module('buffer');

QUnit.test('buffered returns video buffered when no audio', function(assert) {
  const videoBuffered = videojs.createTimeRanges([[0, 1], [2, 3]]);

  timeRangesEqual(
    buffered({ buffered: videoBuffered }, null, false),
    videoBuffered,
    'returns video buffered'
  );
});

QUnit.test('buffered returns video buffered when audio disabled', function(assert) {
  const videoBuffered = videojs.createTimeRanges([[0, 1], [2, 3]]);
  const audioBuffered = videojs.createTimeRanges([[4, 5], [6, 7]]);

  timeRangesEqual(
    buffered({ buffered: videoBuffered }, { buffered: audioBuffered }, true),
    videoBuffered,
    'returns video buffered'
  );
});

QUnit.test('buffered returns audio buffered when no video', function(assert) {
  const audioBuffered = videojs.createTimeRanges([[4, 5], [6, 7]]);

  timeRangesEqual(
    buffered(null, { buffered: audioBuffered }, false),
    audioBuffered,
    'returns audio buffered'
  );
});

QUnit.test('buffered returns intersection of audio and video buffers', function(assert) {
  const videoBuffered = videojs.createTimeRanges([[0, 5], [12, 100]]);
  const audioBuffered = videojs.createTimeRanges([[4, 5], [10, 101]]);

  timeRangesEqual(
    buffered({ buffered: videoBuffered }, { buffered: audioBuffered }, false),
    videojs.createTimeRanges([[4, 5], [12, 100]]),
    'returns intersection'
  );
});

QUnit.test('buffered returns empty when no audio or video buffers', function(assert) {
  timeRangesEqual(
    buffered(null, null, false),
    videojs.createTimeRanges(),
    'returns empty'
  );
});

QUnit.test(
  'buffered returns empty when audio and video buffers are empty',
  function(assert) {
    const videoBuffered = videojs.createTimeRanges();
    const audioBuffered = videojs.createTimeRanges();

    timeRangesEqual(
      buffered({ buffered: videoBuffered }, { buffered: audioBuffered }, false),
      videojs.createTimeRanges(),
      'returns empty'
    );
  }
);

QUnit.test('buffered returns empty when audio buffer empty', function(assert) {
  const videoBuffered = videojs.createTimeRanges([[0, 1], [2, 3]]);
  const audioBuffered = videojs.createTimeRanges();

  timeRangesEqual(
    buffered({ buffered: videoBuffered }, { buffered: audioBuffered }, false),
    videojs.createTimeRanges(),
    'returns empty'
  );
});

QUnit.test('buffered returns empty when video buffer empty', function(assert) {
  const videoBuffered = videojs.createTimeRanges();
  const audioBuffered = videojs.createTimeRanges([[0, 1], [2, 3]]);

  timeRangesEqual(
    buffered({ buffered: videoBuffered }, { buffered: audioBuffered }, false),
    videojs.createTimeRanges(),
    'returns empty'
  );
});
