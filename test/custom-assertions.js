import QUnit from 'qunit';
import { timeRangesToArray } from '../src/ranges';

QUnit.assert.timeRangesEqual = function(timeRange1, timeRange2, message) {
  this.deepEqual(timeRangesToArray(timeRange1), timeRangesToArray(timeRange2), message);
};
