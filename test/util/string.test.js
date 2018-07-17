import QUnit from 'qunit';
import { uintToString } from '../../src/util/string';

QUnit.module('uintToString');
QUnit.test('converts beyond Latin-1 characters', function(assert) {
  const expected = 'シ';
  const actual = uintToString(new Uint8Array([227, 130, 183]));

  assert.deepEqual(actual, expected);
});
