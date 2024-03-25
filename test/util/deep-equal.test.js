import QUnit from 'qunit';
import deepEqual from '../../src/util/deep-equal.js';

QUnit.module('Deep Equal');

QUnit.test('values', function(assert) {
  assert.true(deepEqual('a', 'a'));
  assert.true(deepEqual(1, 1));
  assert.false(deepEqual({}, null));
});

QUnit.test('array', function(assert) {
  assert.true(deepEqual(['a'], ['a']), 'same keys same order equal');
  assert.false(deepEqual(['a', 'b'], ['b', 'a']), 'different val order');
  assert.false(deepEqual(['a', 'b', 'c'], ['a', 'b']), 'extra key a');
  assert.false(deepEqual(['a', 'b'], ['a', 'b', 'c']), 'extra key b');
});

QUnit.test('object', function(assert) {
  assert.true(deepEqual({a: 'b'}, {a: 'b'}), 'two objects are equal');
  assert.false(deepEqual({a: 'b', f: 'a'}, {a: 'b'}), 'extra key a');
  assert.false(deepEqual({a: 'b'}, {a: 'b', f: 'a'}), 'extra key b');
});

QUnit.test('complex', function(assert) {
  assert.true(deepEqual(
    {a: 5, b: 6, segments: [
      {uri: 'foo', attributes: {codecs: 'foo'}},
      {uri: 'bar', attributes: {codecs: 'bar'}}
    ]},
    {a: 5, b: 6, segments: [
      {uri: 'foo', attributes: {codecs: 'foo'}},
      {uri: 'bar', attributes: {codecs: 'bar'}}
    ]},
  ));

  assert.false(deepEqual(
    {a: 5, b: 6, segments: [
      {uri: 'foo', attributes: {codecs: 'foo'}},
      {uri: 'bar', attributes: {codecs: 'bar'}}
    ]},
    {a: 5, b: 6, segments: [
      {uri: 'foo', attributes: {codecs: 'foo'}},
      {uri: 'jar', attributes: {codecs: 'bar'}}
    ]},
  ));
});
