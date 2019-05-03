import QUnit from 'qunit';
import { concatSegments } from '../../src/util/segment';

QUnit.module('util/segment');

QUnit.test('concats Uint8Array bytes of segments together', function(assert) {
  const arr1 = new Uint8Array(1);
  const arr2 = new Uint8Array(2);
  const arr3 = new Uint8Array(1);
  let result;

  arr1[0] = 12;
  arr2[0] = 4;
  arr2[1] = 7;
  arr3[0] = 15;

  result = concatSegments({
    bytes: arr1.length + arr2.length + arr3.length,
    segments: [arr1, arr2, arr3]
  });

  assert.strictEqual(result.length, 4);
  assert.strictEqual(result[0], 12);
  assert.strictEqual(result[1], 4);
  assert.strictEqual(result[2], 7);
  assert.strictEqual(result[3], 15);
});

