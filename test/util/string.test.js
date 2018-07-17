import QUnit from 'qunit';
import { uint8ToUtf8 } from '../../src/util/string';

QUnit.module('uint8ToUtf8');

QUnit.test('converts beyond Latin-1 characters', function(assert) {
  const expected = 'シ';
  const actual = uint8ToUtf8(new Uint8Array([227, 130, 183]));

  assert.deepEqual(actual, expected);
});
