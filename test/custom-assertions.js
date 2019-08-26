import QUnit from 'qunit';
import { timeRangesToArray } from '../src/ranges';

// 1%
const BANDWIDTH_TOLERANCE = 0.01;

export const timeRangesEqual = function(timeRange1, timeRange2, message) {
  QUnit.assert.deepEqual(timeRangesToArray(timeRange1), timeRangesToArray(timeRange2), message);
};

export const bandwidthWithinTolerance = function(actual, expected, message) {
  QUnit.assert.ok(
    Math.abs(actual - expected) < (expected * BANDWIDTH_TOLERANCE),
    `${message}: expected ${actual} to be within ${BANDWIDTH_TOLERANCE} of ${expected}`
  );
};
