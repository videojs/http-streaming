import QUnit from 'qunit';
import { timeRangesToArray } from '../src/ranges';

// 1%
const BANDWIDTH_TOLERANCE = 0.01;

QUnit.assert.timeRangesEqual = function(timeRange1, timeRange2, message) {
  this.deepEqual(timeRangesToArray(timeRange1), timeRangesToArray(timeRange2), message);
};

QUnit.assert.bandwidthWithinTolerance = function(actual, expected, message) {
  this.ok(
    Math.abs(actual - expected) < (expected * BANDWIDTH_TOLERANCE),
    `${message}: expected ${actual} to be within ${BANDWIDTH_TOLERANCE} of ${expected}`);
};
