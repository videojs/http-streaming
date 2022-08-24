import * as Ranges from '../src/ranges';
import QUnit from 'qunit';
import {createTimeRanges} from '../src/util/vjs-compat';

const rangesEqual = (rangeOne, rangeTwo) => {
  if (!rangeOne || !rangeTwo) {
    return false;
  }

  if (rangeOne.length !== rangeTwo.length) {
    return false;
  }

  for (let i = 0; i < rangeOne.length; i++) {
    if (rangeOne.start(i) !== rangeTwo.start(i) ||
        rangeOne.end(i) !== rangeTwo.end(i)) {
      return false;
    }
  }

  return true;
};

QUnit.module('TimeRanges Utilities');

QUnit.test('finds the overlapping time range', function(assert) {
  let range = Ranges.findRange(createTimeRanges([[0, 5], [6, 12]]), 3);

  assert.equal(range.length, 1, 'found one range');
  assert.equal(range.end(0), 5, 'inside the first buffered region');

  range = Ranges.findRange(createTimeRanges([[0, 5], [6, 12]]), 6);
  assert.equal(range.length, 1, 'found one range');
  assert.equal(range.end(0), 12, 'inside the second buffered region');
});

QUnit.test('finds overlapping time ranges when off by SAFE_TIME_DELTA', function(assert) {
  let range = Ranges.findRange(createTimeRanges([[0 + Ranges.SAFE_TIME_DELTA, 5], [6, 12]]), 3);

  assert.equal(range.length, 1, 'found one range');
  assert.equal(range.end(0), 5, 'inside the first buffered region');

  range = Ranges.findRange(createTimeRanges([[0, 5], [6, 12]]), 12 + Ranges.SAFE_TIME_DELTA);
  assert.equal(range.length, 1, 'found one range');
  assert.equal(range.end(0), 12, 'inside the second buffered region');
});

QUnit.test('detects when time ranges differ', function(assert) {
  const isDifferent = Ranges.isRangeDifferent;
  const same = createTimeRanges([[0, 1]]);

  assert.notOk(isDifferent(same, same), 'same object is not different');
  assert.notOk(
    isDifferent(null, null),
    'null and null are not different'
  );
  assert.ok(
    isDifferent(createTimeRanges([[0, 1], [1, 2]]), null),
    'valid and null are different'
  );

  assert.ok(
    isDifferent(createTimeRanges([[0, 1]]), createTimeRanges([[0, 1], [1, 2]])),
    'objects with different length are different'
  );

  assert.ok(
    isDifferent(createTimeRanges([[1, 2], [1, 2]]), createTimeRanges([[0, 1], [1, 2]])),
    'objects with different values are different'
  );

  assert.ok(
    isDifferent(null, createTimeRanges([[0, 1], [1, 2]])),
    'null object and valid are different'
  );

  assert.ok(
    isDifferent(createTimeRanges([[0, 1], [1, 2]]), null),
    'valid and null are different'
  );
});

QUnit.module('Buffer Inpsection');

QUnit.test('detects time range end-point changed by updates', function(assert) {
  let edge;

  // Single-range changes
  edge = Ranges.findSoleUncommonTimeRangesEnd(
    createTimeRanges([[0, 10]]),
    createTimeRanges([[0, 11]])
  );
  assert.strictEqual(edge, 11, 'detected a forward addition');

  edge = Ranges.findSoleUncommonTimeRangesEnd(
    createTimeRanges([[5, 10]]),
    createTimeRanges([[0, 10]])
  );
  assert.strictEqual(edge, null, 'ignores backward addition');

  edge = Ranges.findSoleUncommonTimeRangesEnd(
    createTimeRanges([[5, 10]]),
    createTimeRanges([[0, 11]])
  );
  assert.strictEqual(
    edge, 11,
    'detected a forward addition & ignores a backward addition'
  );

  edge = Ranges.findSoleUncommonTimeRangesEnd(
    createTimeRanges([[0, 10]]),
    createTimeRanges([[0, 9]])
  );
  assert.strictEqual(
    edge, null,
    'ignores a backwards addition resulting from a shrinking range'
  );

  edge = Ranges.findSoleUncommonTimeRangesEnd(
    createTimeRanges([[0, 10]]),
    createTimeRanges([[2, 7]])
  );
  assert.strictEqual(
    edge, null,
    'ignores a forward & backwards addition resulting from a shrinking ' +
                    'range'
  );

  edge = Ranges.findSoleUncommonTimeRangesEnd(
    createTimeRanges([[2, 10]]),
    createTimeRanges([[0, 7]])
  );
  assert.strictEqual(
    edge,
    null,
    'ignores a forward & backwards addition resulting from a range shifted backward'
  );

  edge = Ranges.findSoleUncommonTimeRangesEnd(
    createTimeRanges([[2, 10]]),
    createTimeRanges([[5, 15]])
  );
  assert.strictEqual(
    edge, 15,
    'detected a forwards addition resulting from a range shifted foward'
  );

  // Multiple-range changes
  edge = Ranges.findSoleUncommonTimeRangesEnd(
    createTimeRanges([[0, 10]]),
    createTimeRanges([[0, 11], [12, 15]])
  );
  assert.strictEqual(edge, null, 'ignores multiple new forward additions');

  edge = Ranges.findSoleUncommonTimeRangesEnd(
    createTimeRanges([[0, 10], [20, 40]]),
    createTimeRanges([[20, 50]])
  );
  assert.strictEqual(edge, 50, 'detected a forward addition & ignores range removal');

  edge = Ranges.findSoleUncommonTimeRangesEnd(
    createTimeRanges([[0, 10], [20, 40]]),
    createTimeRanges([[0, 50]])
  );
  assert.strictEqual(edge, 50, 'detected a forward addition & ignores merges');

  edge = Ranges.findSoleUncommonTimeRangesEnd(
    createTimeRanges([[0, 10], [20, 40]]),
    createTimeRanges([[0, 40]])
  );
  assert.strictEqual(edge, null, 'ignores merges');

  // Empty input
  edge = Ranges.findSoleUncommonTimeRangesEnd(
    createTimeRanges(),
    createTimeRanges([[0, 11]])
  );
  assert.strictEqual(edge, 11, 'handle an empty original TimeRanges object');

  edge = Ranges.findSoleUncommonTimeRangesEnd(
    createTimeRanges([[0, 11]]),
    createTimeRanges()
  );
  assert.strictEqual(edge, null, 'handle an empty update TimeRanges object');

  // Null input
  edge = Ranges.findSoleUncommonTimeRangesEnd(null, createTimeRanges([[0, 11]]));
  assert.strictEqual(
    edge,
    11,
    'treat null original buffer as an empty TimeRanges object'
  );

  edge = Ranges.findSoleUncommonTimeRangesEnd(createTimeRanges([[0, 11]]), null);
  assert.strictEqual(
    edge,
    null,
    'treat null update buffer as an empty TimeRanges object'
  );
});

QUnit.test('properly calculates time left until player rebuffers', function(assert) {
  let buffered = createTimeRanges([]);
  let currentTime = 0;
  let playbackRate = 1;

  let time = Ranges.timeUntilRebuffer(buffered, currentTime, playbackRate);

  assert.equal(time, 0, 'calculates no time until rebuffer with empty buffer');

  buffered = createTimeRanges([[0, 30]]);
  currentTime = 15;

  time = Ranges.timeUntilRebuffer(buffered, currentTime, playbackRate);

  assert.equal(time, 15, 'calculates time until rebuffer');

  playbackRate = 0.5;

  time = Ranges.timeUntilRebuffer(buffered, currentTime, playbackRate);

  assert.equal(time, 30, 'takes into account playback rate');
});

QUnit.module('Segment Percent Buffered Calculations');

QUnit.test(
  'calculates the percent buffered for segments in the simple case',
  function(assert) {
    const segmentStart = 10;
    const segmentDuration = 10;
    const currentTime = 0;
    const buffered = createTimeRanges([[15, 19]]);
    const percentBuffered = Ranges.getSegmentBufferedPercent(
      segmentStart,
      segmentDuration,
      currentTime,
      buffered
    );

    assert.equal(percentBuffered, 40, 'calculated the buffered amount correctly');
  }
);

QUnit.test('consider the buffer before currentTime to be filled if the ' +
           'segement begins at or before the currentTime', function(assert) {
  const segmentStart = 10;
  const segmentDuration = 10;
  const currentTime = 15;
  const buffered = createTimeRanges([[15, 19]]);
  const percentBuffered = Ranges.getSegmentBufferedPercent(
    segmentStart,
    segmentDuration,
    currentTime,
    buffered
  );

  assert.equal(percentBuffered, 90, 'calculated the buffered amount correctly');
});

QUnit.test('does not consider the buffer before currentTime as filled if the segment ' +
           'begins after the currentTime', function(assert) {
  const segmentStart = 10;
  const segmentDuration = 10;
  const currentTime = 18;
  const buffered = createTimeRanges([[19, 30]]);
  const percentBuffered = Ranges.getSegmentBufferedPercent(
    segmentStart,
    segmentDuration,
    currentTime,
    buffered
  );

  assert.equal(percentBuffered, 10, 'calculated the buffered amount correctly');
});

QUnit.test('calculates the percent buffered for segments with multiple buffered ' +
           'regions', function(assert) {
  const segmentStart = 10;
  const segmentDuration = 10;
  const currentTime = 0;
  const buffered = createTimeRanges([[0, 11], [12, 19]]);
  const percentBuffered = Ranges.getSegmentBufferedPercent(
    segmentStart,
    segmentDuration,
    currentTime,
    buffered
  );

  assert.equal(percentBuffered, 80, 'calculated the buffered amount correctly');
});

QUnit.test('calculates the percent buffered for segments with multiple buffered ' +
           'regions taking into account currentTime', function(assert) {
  const segmentStart = 10;
  const segmentDuration = 10;
  const currentTime = 12;
  const buffered = createTimeRanges([[0, 11], [12, 19]]);
  const percentBuffered = Ranges.getSegmentBufferedPercent(
    segmentStart,
    segmentDuration,
    currentTime,
    buffered
  );

  assert.equal(percentBuffered, 90, 'calculated the buffered amount correctly');
});

QUnit.test(
  'calculates the percent buffered as 0 for zero-length segments',
  function(assert) {
    const segmentStart = 10;
    const segmentDuration = 0;
    const currentTime = 0;
    const buffered = createTimeRanges([[0, 19]]);
    const percentBuffered = Ranges.getSegmentBufferedPercent(
      segmentStart,
      segmentDuration,
      currentTime,
      buffered
    );

    assert.equal(percentBuffered, 0, 'calculated the buffered amount correctly');
  }
);

QUnit.test('calculates the percent buffered as 0 for segments that do not overlap ' +
           'buffered regions taking into account currentTime', function(assert) {
  const segmentStart = 10;
  const segmentDuration = 10;
  const currentTime = 19;
  const buffered = createTimeRanges([[20, 30]]);
  const percentBuffered = Ranges.getSegmentBufferedPercent(
    segmentStart,
    segmentDuration,
    currentTime,
    buffered
  );

  assert.equal(percentBuffered, 0, 'calculated the buffered amount correctly');
});

QUnit.test('calculates the percent buffered for segments ' +
           'that end before currentTime', function(assert) {
  const segmentStart = 10;
  const segmentDuration = 10;
  const currentTime = 19.6;
  const buffered = createTimeRanges([[0, 19.5]]);
  const percentBuffered = Ranges.getSegmentBufferedPercent(
    segmentStart,
    segmentDuration,
    currentTime,
    buffered
  );

  assert.equal(percentBuffered, 95, 'calculated the buffered amount correctly');
});

QUnit.test('finds next range', function(assert) {
  assert.equal(
    Ranges.findNextRange(createTimeRanges(), 10).length,
    0,
    'does not find next range in empty buffer'
  );
  assert.equal(
    Ranges.findNextRange(createTimeRanges([[0, 20]]), 10).length,
    0,
    'does not find next range when no next ranges'
  );
  assert.equal(
    Ranges.findNextRange(createTimeRanges([[0, 20]]), 30).length,
    0,
    'does not find next range when current time later than buffer'
  );
  assert.equal(
    Ranges.findNextRange(createTimeRanges([[10, 20]]), 10).length,
    0,
    'does not find next range when current time is at beginning of buffer'
  );
  assert.equal(
    Ranges.findNextRange(createTimeRanges([[10, 20]]), 11).length,
    0,
    'does not find next range when current time in middle of buffer'
  );
  assert.equal(
    Ranges.findNextRange(createTimeRanges([[10, 20]]), 20).length,
    0,
    'does not find next range when current time is at end of buffer'
  );

  assert.ok(
    rangesEqual(
      Ranges.findNextRange(createTimeRanges([[10, 20]]), 0),
      createTimeRanges([[10, 20]])
    ),
    'finds next range when buffer comes after time'
  );
  assert.ok(
    rangesEqual(
      Ranges.findNextRange(createTimeRanges([[10, 20], [25, 35]]), 22),
      createTimeRanges([[25, 35]])
    ),
    'finds next range when time between buffers'
  );
  assert.ok(
    rangesEqual(
      Ranges.findNextRange(createTimeRanges([[10, 20], [25, 35]]), 15),
      createTimeRanges([[25, 35]])
    ),
    'finds next range when time in previous buffer'
  );
});

QUnit.test('finds gaps within ranges', function(assert) {
  assert.equal(
    Ranges.findGaps(createTimeRanges()).length,
    0,
    'does not find gap in empty buffer'
  );
  assert.equal(
    Ranges.findGaps(createTimeRanges([[0, 10]])).length,
    0,
    'does not find gap in single buffer'
  );
  assert.equal(
    Ranges.findGaps(createTimeRanges([[1, 10]])).length,
    0,
    'does not find gap at start of buffer'
  );

  assert.ok(
    rangesEqual(
      Ranges.findGaps(createTimeRanges([[0, 10], [11, 20]])),
      createTimeRanges([[10, 11]])
    ),
    'finds a single gap'
  );
  assert.ok(
    rangesEqual(
      Ranges.findGaps(createTimeRanges([[0, 10], [11, 20], [22, 30]])),
      createTimeRanges([[10, 11], [20, 22]])
    ),
    'finds multiple gaps'
  );
});

QUnit.test('creates printable ranges', function(assert) {
  assert.equal(Ranges.printableRange(createTimeRanges()), '', 'empty range empty string');
  assert.equal(
    Ranges.printableRange(createTimeRanges([[0, 0]])),
    '0 => 0',
    'formats range correctly'
  );
  assert.equal(
    Ranges.printableRange(createTimeRanges([[0, 1]])),
    '0 => 1',
    'formats range correctly'
  );
  assert.equal(
    Ranges.printableRange(createTimeRanges([[1, -1]])),
    '1 => -1',
    'formats range correctly'
  );
  assert.equal(
    Ranges.printableRange(createTimeRanges([[10.2, 25.2]])),
    '10.2 => 25.2',
    'formats range correctly'
  );
  assert.equal(
    Ranges.printableRange(createTimeRanges([[10, 20], [30, 40]])),
    '10 => 20, 30 => 40',
    'formats ranges correctly'
  );
  assert.equal(
    Ranges.printableRange(createTimeRanges([[10, 25], [20, 40], [-1, -2]])),
    '10 => 25, 20 => 40, -1 => -2',
    'formats ranges correctly'
  );
});

QUnit.test('converts time ranges to an array', function(assert) {
  assert.deepEqual(
    Ranges.timeRangesToArray(createTimeRanges()), [],
    'empty range empty array'
  );
  assert.deepEqual(
    Ranges.timeRangesToArray(createTimeRanges([[0, 1]])),
    [{start: 0, end: 1}],
    'formats range correctly'
  );
  assert.deepEqual(
    Ranges.timeRangesToArray(createTimeRanges([[10, 20], [30, 40]])),
    [{start: 10, end: 20}, {start: 30, end: 40}],
    'formats ranges correctly'
  );
});

QUnit.module('bufferIntersection');

QUnit.test('returns intersection of two buffers', function(assert) {
  const a = createTimeRanges([[0, 5], [12, 100]]);
  const b = createTimeRanges([[4, 5], [10, 101]]);

  assert.ok(
    rangesEqual(Ranges.bufferIntersection(a, b), createTimeRanges([[4, 5], [12, 100]])),
    'returns intersection'
  );
});

QUnit.test('returns empty when no buffers', function(assert) {
  assert.ok(
    rangesEqual(Ranges.bufferIntersection(null, null), createTimeRanges()),
    'returns empty'
  );
});

QUnit.test('returns empty when buffers are empty', function(assert) {
  const a = createTimeRanges();
  const b = createTimeRanges();

  assert.ok(
    rangesEqual(Ranges.bufferIntersection(a, b), createTimeRanges()),
    'returns empty'
  );
});

QUnit.test('returns empty when one buffer is empty', function(assert) {
  const a = createTimeRanges([[0, 1], [2, 3]]);
  const b = createTimeRanges();

  assert.ok(
    rangesEqual(Ranges.bufferIntersection(a, b), createTimeRanges()),
    'returns empty'
  );
});

QUnit.test('returns empty when other buffer empty', function(assert) {
  const a = createTimeRanges();
  const b = createTimeRanges([[0, 1], [2, 3]]);

  assert.ok(
    rangesEqual(Ranges.bufferIntersection(a, b), createTimeRanges()),
    'returns empty'
  );
});

QUnit.module('timeAheadOf');

QUnit.test('empty range returns 0', function(assert) {
  const range = createTimeRanges();

  assert.equal(Ranges.timeAheadOf(range, 0), 0, 'empty range returns 0');
});

QUnit.test('returns the total amount of time ahead of 0', function(assert) {
  const range = createTimeRanges([[0, 10]]);

  assert.equal(Ranges.timeAheadOf(range, 0), 10, '10s of time starting at 0s');
});

QUnit.test('takes gaps into account', function(assert) {
  const range = createTimeRanges([[0, 10], [20, 40], [50, 60]]);

  assert.equal(Ranges.timeAheadOf(range, 0), 40, '40s of time starting at 0s');
});
QUnit.test('takes gaps into account with different time', function(assert) {
  const range = createTimeRanges([[0, 10], [20, 40], [50, 60]]);

  assert.equal(Ranges.timeAheadOf(range, 11), 30, '30s of time starting at 11s');
});
QUnit.test('takes partial time ranges into account', function(assert) {
  const range = createTimeRanges([[0, 10], [20, 40], [50, 60]]);

  assert.equal(Ranges.timeAheadOf(range, 5), 35, '35s of time starting at 5s');
});
QUnit.test('exact end of range', function(assert) {
  const range = createTimeRanges([[0, 10], [11, 20]]);

  assert.equal(Ranges.timeAheadOf(range, 10), 9, '9s of time starting at 10s');
});
QUnit.test('exact start of range', function(assert) {
  const range = createTimeRanges([[0, 9], [10, 20]]);

  assert.equal(Ranges.timeAheadOf(range, 10), 10, '10s of time starting at 10s');
});
QUnit.test('matching end and start', function(assert) {
  const range = createTimeRanges([[0, 10], [10, 20]]);

  assert.equal(Ranges.timeAheadOf(range, 10), 10, '10s of time starting at 10s');
});

