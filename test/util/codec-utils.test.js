import Qunit from 'qunit';
import {
  translateLegacyCodecs,
  parseMimeTypes
} from '../../src/util/codecs';

const { module, test } = Qunit;

module('Codec Utils');

test('translates legacy codecs', function(assert) {
  assert.deepEqual(translateLegacyCodecs(['avc1.66.30', 'avc1.66.30']),
            ['avc1.42001e', 'avc1.42001e'],
            'translates legacy avc1.66.30 codec');

  assert.deepEqual(translateLegacyCodecs(['avc1.42C01E', 'avc1.42C01E']),
            ['avc1.42C01E', 'avc1.42C01E'],
            'does not translate modern codecs');

  assert.deepEqual(translateLegacyCodecs(['avc1.42C01E', 'avc1.66.30']),
            ['avc1.42C01E', 'avc1.42001e'],
            'only translates legacy codecs when mixed');

  assert.deepEqual(translateLegacyCodecs(['avc1.4d0020', 'avc1.100.41', 'avc1.77.41',
                                   'avc1.77.32', 'avc1.77.31', 'avc1.77.30',
                                   'avc1.66.30', 'avc1.66.21', 'avc1.42C01e']),
            ['avc1.4d0020', 'avc1.640029', 'avc1.4d0029',
             'avc1.4d0020', 'avc1.4d001f', 'avc1.4d001e',
             'avc1.42001e', 'avc1.420015', 'avc1.42C01e'],
            'translates a whole bunch');
});

test('parses mime types', function(assert) {
  assert.deepEqual(
    parseMimeTypes('video/mp4; codecs="avc1.deadbeef"'),
    { video: 'avc1.deadbeef' },
    'parsed video codec');

  assert.deepEqual(
    parseMimeTypes('audio/mp4; codecs="mp4a.40.2"'),
    { audio: 'mp4a.40.2' },
    'parsed audio codec');

  assert.deepEqual(
    parseMimeTypes('video/mp4; codecs="avc1.deadbeef,mp4a.40.2"'),
    { video: 'avc1.deadbeef', audio: 'mp4a.40.2' },
    'parsed both codecs');
});
