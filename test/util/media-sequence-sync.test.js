import QUnit from 'qunit';
import { MediaSequenceSync } from '../../src/util/media-sequence-sync';

QUnit.module('MediaSequenceSync: update', function(hooks) {
  let mediaSequenceSync;

  hooks.beforeEach(function() {
    mediaSequenceSync = new MediaSequenceSync();
  });

  QUnit.test('update calculates correct base time based on mediaSequence of new playlist', function(assert) {
    const initialMediaSequence = 10;
    const initialSegments = [
      // Segment 10 with duration 5
      { duration: 5 },
      // Segment 11 with duration 6
      { duration: 6 },
      // Segment 12 with duration 7
      { duration: 7 }
    ];

    // Initial update with starting playlist
    mediaSequenceSync.update(
      {
        mediaSequence: initialMediaSequence,
        segments: initialSegments
      },
      // Current time, value is used for fallback and not significant here
      20
    );

    // Confirm that the initial update set the correct start and end times
    assert.strictEqual(
      mediaSequenceSync.start,
      0,
      'The start time is set to the initial value of 0.'
    );

    // Confirm the end time is the correct sum of the segment durations
    // = 18
    const expectedInitialEndTime = 0 + 5 + 6 + 7;

    assert.strictEqual(
      mediaSequenceSync.end,
      expectedInitialEndTime,
      'The end time is calculated correctly after the initial update.'
    );

    // New playlist with higher mediaSequence
    let newMediaSequence = 11;
    let newSegments = [
      // Segment 11 with duration 4
      { duration: 4 },
      // Segment 12 with duration 5
      { duration: 5 },
      // Segment 13 with duration 6
      { duration: 6 }
    ];

    // Update with the new playlist
    mediaSequenceSync.update(
      {
        mediaSequence: newMediaSequence,
        segments: newSegments
      },
      30
    );

    // Segment 10 with duration 5 has fallen off the start of the playlist
    let expectedStartTime = 5;

    assert.strictEqual(
      mediaSequenceSync.start,
      expectedStartTime,
      'The base time is calculated correctly when a new playlist with a higher mediaSequence is loaded.'
    );

    // New playlist with lower mediaSequence
    newMediaSequence = 10;
    newSegments = [
      // Segment 10 with duration 5
      { duration: 5 },
      // Segment 11 with duration 6
      { duration: 6 },
      // Segment 12 with duration 7
      { duration: 7 }
    ];

    // Update with the new playlist
    mediaSequenceSync.update(
      {
        mediaSequence: newMediaSequence,
        segments: newSegments
      },
      40
    );

    // Expected base time is calculated by extrapolating backwards:
    // Segment 11 start time: 5
    // Segment 10 start time: Segment 11 start time (5) - Segment 10 duration (5) = 0
    expectedStartTime = 0;

    assert.strictEqual(
      mediaSequenceSync.start,
      expectedStartTime,
      'The base time is calculated correctly when a new playlist with a lower mediaSequence is loaded.'
    );
  });
});
