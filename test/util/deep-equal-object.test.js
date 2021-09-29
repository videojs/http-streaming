import QUnit from 'qunit';
import deepEqualObject from '../../src/util/deep-equal-object.js';

QUnit.module('Deep Equal Object');

QUnit.test('array', function(assert) {
  assert.true(deepEqualObject(['a'], ['a']), 'same keys same order equal');
  assert.false(deepEqualObject(['a', 'b'], ['b', 'a']), 'different val order');
  assert.false(deepEqualObject(['a', 'b', 'c'], ['a', 'b']), 'extra key a');
  assert.false(deepEqualObject(['a', 'b'], ['a', 'b', 'c']), 'extra key b');
});

QUnit.test('object', function(assert) {
  assert.true(deepEqualObject({a: 'b'}, {a: 'b'}), 'two objects are equal');
  assert.false(deepEqualObject({a: 'b', f: 'a'}, {a: 'b'}), 'extra key a');
  assert.false(deepEqualObject({a: 'b'}, {a: 'b', f: 'a'}), 'extra key b');
});

QUnit.test('complex', function(assert) {
  assert.true(deepEqualObject(
    {a: 5, b: 6, segments: [
      {uri: 'foo', attributes: {codecs: 'foo'}},
      {uri: 'bar', attributes: {codecs: 'bar'}}
    ]},
    {a: 5, b: 6, segments: [
      {uri: 'foo', attributes: {codecs: 'foo'}},
      {uri: 'bar', attributes: {codecs: 'bar'}}
    ]},
  ));

  assert.false(deepEqualObject(
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
