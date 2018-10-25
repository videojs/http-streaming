import Qunit from 'qunit';
import {
  translateLegacyCodecs,
  parseContentType,
  isAudioCodec,
  isVideoCodec
} from '../../src/util/codecs';

const { module, test } = Qunit;

module('Codec Utils');

test('translates legacy codecs', function(assert) {
  assert.deepEqual(
    translateLegacyCodecs(['avc1.66.30', 'avc1.66.30']),
    ['avc1.42001e', 'avc1.42001e'],
    'translates legacy avc1.66.30 codec'
  );

  assert.deepEqual(
    translateLegacyCodecs(['avc1.42C01E', 'avc1.42C01E']),
    ['avc1.42C01E', 'avc1.42C01E'],
    'does not translate modern codecs'
  );

  assert.deepEqual(
    translateLegacyCodecs(['avc1.42C01E', 'avc1.66.30']),
    ['avc1.42C01E', 'avc1.42001e'],
    'only translates legacy codecs when mixed'
  );

  assert.deepEqual(
    translateLegacyCodecs(['avc1.4d0020', 'avc1.100.41', 'avc1.77.41',
      'avc1.77.32', 'avc1.77.31', 'avc1.77.30',
      'avc1.66.30', 'avc1.66.21', 'avc1.42C01e']),
    ['avc1.4d0020', 'avc1.640029', 'avc1.4d0029',
      'avc1.4d0020', 'avc1.4d001f', 'avc1.4d001e',
      'avc1.42001e', 'avc1.420015', 'avc1.42C01e'],
    'translates a whole bunch'
  );
});

test('parseContentType parses content type', function(assert) {
  assert.deepEqual(
    parseContentType('video/mp2t; param1=value1;param2="value2" ;param3=\'val3\''),
    {
      type: 'video/mp2t',
      parameters: {
        param1: 'value1',
        param2: 'value2',
        param3: "'val3'"
      }
    },
    'parses content type and parameters'
  );
});

test('isAudioCodec detects audio codecs', function(assert) {
  assert.ok(isAudioCodec('mp4a.40.2'), 'mp4a.40.2 is a valid audio codec');
  assert.ok(isAudioCodec('mp4a.99.9'), 'mp4a.99.9 is a valid audio codec');
  assert.ok(isAudioCodec('mp4a.99.99'), 'mp4a.99.99 is a valid audio codec');
  assert.ok(isAudioCodec('mp4a.0.0'), 'mp4a.99.99 is a valid audio codec');

  assert.notOk(isAudioCodec('mp4.40.2'), 'mp4.40.2 is not a valid audio codec');
  assert.notOk(isAudioCodec('p4a.40.2'), 'p4a.40.2 is not a valid audio codec');
  assert.notOk(isAudioCodec('mp4a402'), 'mp4a402 is not a valid audio codec');
  assert.notOk(isAudioCodec('mp4a,40,2'), 'mp4a,40,2 is not a valid audio codec');
  assert.notOk(isAudioCodec('mp4a.40'), 'mp4a.40 is not a valid audio codec');
  assert.notOk(isAudioCodec('mp4a'), 'mp4a is not a valid audio codec');
  assert.notOk(isAudioCodec(''), '\'\' is not a valid audio codec');
  assert.notOk(isAudioCodec('mp4a.40.e'), 'mp4a.40.e is not a valid audio codec');
  assert.notOk(isAudioCodec('mp4a.e.2'), 'mp4a.e.2 is not a valid audio codec');
});

test('isVideoCodec detects video codecs', function(assert) {
  assert.ok(isVideoCodec('avc1.4d400d'), 'avc1.4d400d is a valid video codec');
  assert.ok(isVideoCodec('avc1.4d400'), 'avc1.4d400 is a valid video codec');
  assert.ok(isVideoCodec('avc1.4'), 'avc1.4 is a valid video codec');
  assert.ok(isVideoCodec('avc1.d'), 'avc1.d is a valid video codec');
  assert.ok(
    isVideoCodec('avc1.4d400d0000009999993333333333333333'),
    'avc1.4d400d0000009999993333333333333333 is a valid video codec'
  );

  assert.notOk(isVideoCodec('avc2.4d400d'), 'avc2.4d400d is not a valid video codec');
  assert.notOk(isVideoCodec('avc.4d400d'), 'avc.4d400d is not a valid video codec');
  assert.notOk(isVideoCodec('4d400d'), '4d400d is not a valid video codec');
  assert.notOk(isVideoCodec('d'), 'd is not a valid video codec');
  assert.notOk(isVideoCodec('4'), '4 is not a valid video codec');
  assert.notOk(isVideoCodec(''), '\'\' is not a valid video codec');
});
