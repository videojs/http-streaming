import QUnit from 'qunit';
import { stringToArrayBuffer } from '../../src/util/string-to-array-buffer';

QUnit.test('array buffer created from string contains the correct codes',
function(assert) {
  const text = 'test';
  const arrayBuffer = stringToArrayBuffer(text);
  const view = new Uint8Array(arrayBuffer);

  assert.strictEqual(
    typeof arrayBuffer,
    typeof new ArrayBuffer(0),
    'created an array buffer');
  assert.strictEqual(String.fromCharCode(view[0]), 't');
  assert.strictEqual(String.fromCharCode(view[1]), 'e');
  assert.strictEqual(String.fromCharCode(view[2]), 's');
  assert.strictEqual(String.fromCharCode(view[3]), 't');
});
