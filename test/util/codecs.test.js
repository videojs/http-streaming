import QUnit from 'qunit';
import {
  mimeTypesForPlaylist,
  mapLegacyAvcCodecs,
  translateLegacyCodecs,
  parseContentType,
  isAudioCodec,
  isVideoCodec
} from '../../src/util/codecs';

const generateMedia = function(isMaat, isMuxed, hasVideoCodec, hasAudioCodec, isFMP4) {
  const codec = (hasVideoCodec ? 'avc1.deadbeef' : '') +
    (hasVideoCodec && hasAudioCodec ? ',' : '') +
    (hasAudioCodec ? 'mp4a.40.E' : '');
  const master = {
    mediaGroups: {},
    playlists: []
  };
  const media = {
    attributes: {}
  };

  if (isMaat) {
    master.mediaGroups.AUDIO = {
      test: {
        demuxed: {
          uri: 'foo.bar'
        }
      }
    };

    if (isMuxed) {
      master.mediaGroups.AUDIO.test.muxed = {};
    }
    media.attributes.AUDIO = 'test';
  }

  if (isFMP4) {
    // This is not a great way to signal that the playlist is fmp4 but
    // this is how we currently detect it in HLS so let's emulate it here
    media.segments = [
      {
        map: 'test'
      }
    ];
  }

  if (hasVideoCodec || hasAudioCodec) {
    media.attributes.CODECS = codec;
  }

  return [master, media];
};

QUnit.module('Codec to MIME Type Conversion');

const testMimeTypes = function(assert, isFMP4) {
  let container = isFMP4 ? 'mp4' : 'mp2t';

  let videoMime = `video/${container}`;
  let audioMime = `audio/${container}`;

  // no MAAT
  assert.deepEqual(mimeTypesForPlaylist.apply(null,
      generateMedia(false, true, false, false, isFMP4)),
    [`${videoMime}; codecs="avc1.4d400d, mp4a.40.2"`],
    `no MAAT, container: ${container}, codecs: none`);

  assert.deepEqual(mimeTypesForPlaylist.apply(null,
      generateMedia(false, true, true, false, isFMP4)),
    [`${videoMime}; codecs="avc1.deadbeef"`],
    `no MAAT, container: ${container}, codecs: video`);

  assert.deepEqual(mimeTypesForPlaylist.apply(null,
      generateMedia(false, true, false, true, isFMP4)),
    [`${audioMime}; codecs="mp4a.40.E"`],
    `no MAAT, container: ${container}, codecs: audio`);

  assert.deepEqual(mimeTypesForPlaylist.apply(null,
      generateMedia(false, true, true, true, isFMP4)),
    [`${videoMime}; codecs="avc1.deadbeef, mp4a.40.E"`],
    `no MAAT, container: ${container}, codecs: video, audio`);

  // MAAT, not muxed
  assert.deepEqual(mimeTypesForPlaylist.apply(null,
      generateMedia(true, false, false, false, isFMP4)),
    [`${videoMime}; codecs="avc1.4d400d"`,
     `${audioMime}; codecs="mp4a.40.2"`],
    `MAAT, demuxed, container: ${container}, codecs: none`);

  assert.deepEqual(mimeTypesForPlaylist.apply(null,
      generateMedia(true, false, true, false, isFMP4)),
    [`${videoMime}; codecs="avc1.deadbeef"`,
     `${audioMime}; codecs="mp4a.40.2"`],
    `MAAT, demuxed, container: ${container}, codecs: video`);

  assert.deepEqual(mimeTypesForPlaylist.apply(null,
      generateMedia(true, false, false, true, isFMP4)),
    [`${audioMime}; codecs="mp4a.40.E"`,
     `${audioMime}; codecs="mp4a.40.E"`],
    `MAAT, demuxed, container: ${container}, codecs: audio`);

  assert.deepEqual(mimeTypesForPlaylist.apply(null,
      generateMedia(true, false, true, true, isFMP4)),
    [`${videoMime}; codecs="avc1.deadbeef"`,
     `${audioMime}; codecs="mp4a.40.E"`],
    `MAAT, demuxed, container: ${container}, codecs: video, audio`);

  // MAAT, muxed
  assert.deepEqual(mimeTypesForPlaylist.apply(null,
      generateMedia(true, true, false, false, isFMP4)),
    [`${videoMime}; codecs="avc1.4d400d, mp4a.40.2"`,
     `${audioMime}; codecs="mp4a.40.2"`],
    `MAAT, muxed, container: ${container}, codecs: none`);

  assert.deepEqual(mimeTypesForPlaylist.apply(null,
      generateMedia(true, true, true, false, isFMP4)),
    [`${videoMime}; codecs="avc1.deadbeef, mp4a.40.2"`,
     `${audioMime}; codecs="mp4a.40.2"`],
    `MAAT, muxed, container: ${container}, codecs: video`);

  assert.deepEqual(mimeTypesForPlaylist.apply(null,
      generateMedia(true, true, false, true, isFMP4)),
    [`${videoMime}; codecs="mp4a.40.E"`,
     `${audioMime}; codecs="mp4a.40.E"`],
    `MAAT, muxed, container: ${container}, codecs: audio`);

  assert.deepEqual(mimeTypesForPlaylist.apply(null,
      generateMedia(true, true, true, true, isFMP4)),
    [`${videoMime}; codecs="avc1.deadbeef, mp4a.40.E"`,
     `${audioMime}; codecs="mp4a.40.E"`],
    `MAAT, muxed, container: ${container}, codecs: video, audio`);
};

QUnit.test('recognizes muxed codec configurations', function(assert) {
  testMimeTypes(assert, false);
  testMimeTypes(assert, true);
});

// dash audio playlist won't have a URI but will have resolved playlists
QUnit.test('content demuxed if alt audio URI not present but playlists present',
function(assert) {
  const media = {
    attributes: {
      AUDIO: 'test',
      CODECS: 'avc1.deadbeef, mp4a.40.E'
    },
    segments: [
      // signal fmp4
      { map: 'test' }
    ]
  };
  const master = {
    mediaGroups: {
      AUDIO: {
        test: {
          demuxed: {
            uri: 'foo.bar'
          }
        }
      }
    },
    playlists: [media]
  };

  assert.deepEqual(mimeTypesForPlaylist(master, media),
                   ['video/mp4; codecs="avc1.deadbeef"', 'audio/mp4; codecs="mp4a.40.E"'],
                   'demuxed if URI');

  delete master.mediaGroups.AUDIO.test.demuxed.uri;
  assert.deepEqual(
    mimeTypesForPlaylist(master, media),
    ['video/mp4; codecs="avc1.deadbeef, mp4a.40.E"', 'audio/mp4; codecs="mp4a.40.E"'],
    'muxed if no URI and no playlists');

  master.mediaGroups.AUDIO.test.demuxed.playlists = [{}];
  assert.deepEqual(mimeTypesForPlaylist(master, media),
                   ['video/mp4; codecs="avc1.deadbeef"', 'audio/mp4; codecs="mp4a.40.E"'],
                   'demuxed if no URI but playlists');
});

QUnit.test('uses audio codec from default group if not specified in media attributes',
function(assert) {
  const media = {
    attributes: {
      AUDIO: 'test',
      CODECS: 'avc1.deadbeef'
    },
    segments: [
      // signal fmp4
      { map: 'test' }
    ]
  };
  // dash audio playlist won't have a URI but will have resolved playlists
  const master = {
    mediaGroups: {
      AUDIO: {
        test: {
          demuxed: {
            default: true,
            playlists: [{
              attributes: {
                CODECS: 'mp4a.40.E'
              }
            }]
          }
        }
      }
    },
    playlists: [media]
  };

  assert.deepEqual(
    mimeTypesForPlaylist(master, media),
    ['video/mp4; codecs="avc1.deadbeef"', 'audio/mp4; codecs="mp4a.40.E"'],
    'uses audio codec from media group');

  delete master.mediaGroups.AUDIO.test.demuxed.default;
  assert.deepEqual(
    mimeTypesForPlaylist(master, media),
    ['video/mp4; codecs="avc1.deadbeef"', 'audio/mp4; codecs="mp4a.40.2"'],
    'uses default audio codec');
});

QUnit.module('Map Legacy AVC Codec');

QUnit.test('maps legacy AVC codecs', function(assert) {
  assert.equal(mapLegacyAvcCodecs('avc1.deadbeef'),
               'avc1.deadbeef',
               'does nothing for non legacy pattern');
  assert.equal(mapLegacyAvcCodecs('avc1.dead.beef, mp4a.something'),
               'avc1.dead.beef, mp4a.something',
               'does nothing for non legacy pattern');
  assert.equal(mapLegacyAvcCodecs('avc1.dead.beef,mp4a.something'),
               'avc1.dead.beef,mp4a.something',
               'does nothing for non legacy pattern');
  assert.equal(mapLegacyAvcCodecs('mp4a.something,avc1.dead.beef'),
               'mp4a.something,avc1.dead.beef',
               'does nothing for non legacy pattern');
  assert.equal(mapLegacyAvcCodecs('mp4a.something, avc1.dead.beef'),
               'mp4a.something, avc1.dead.beef',
               'does nothing for non legacy pattern');
  assert.equal(mapLegacyAvcCodecs('avc1.42001e'),
               'avc1.42001e',
               'does nothing for non legacy pattern');
  assert.equal(mapLegacyAvcCodecs('avc1.4d0020,mp4a.40.2'),
               'avc1.4d0020,mp4a.40.2',
               'does nothing for non legacy pattern');
  assert.equal(mapLegacyAvcCodecs('mp4a.40.2,avc1.4d0020'),
               'mp4a.40.2,avc1.4d0020',
               'does nothing for non legacy pattern');
  assert.equal(mapLegacyAvcCodecs('mp4a.40.40'),
               'mp4a.40.40',
               'does nothing for non video codecs');

  assert.equal(mapLegacyAvcCodecs('avc1.66.30'),
               'avc1.42001e',
               'translates legacy video codec alone');
  assert.equal(mapLegacyAvcCodecs('avc1.66.30, mp4a.40.2'),
               'avc1.42001e, mp4a.40.2',
               'translates legacy video codec when paired with audio');
  assert.equal(mapLegacyAvcCodecs('mp4a.40.2, avc1.66.30'),
               'mp4a.40.2, avc1.42001e',
               'translates video codec when specified second');
});

QUnit.module('Codec Utils');

QUnit.test('translates legacy codecs', function(assert) {
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

QUnit.test('parseContentType parses content type', function(assert) {
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
    'parses content type and parameters');
});

QUnit.test('isAudioCodec detects audio codecs', function(assert) {
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

QUnit.test('isVideoCodec detects video codecs', function(assert) {
  assert.ok(isVideoCodec('avc1.4d400d'), 'avc1.4d400d is a valid video codec');
  assert.ok(isVideoCodec('avc1.4d400'), 'avc1.4d400 is a valid video codec');
  assert.ok(isVideoCodec('avc1.4'), 'avc1.4 is a valid video codec');
  assert.ok(isVideoCodec('avc1.d'), 'avc1.d is a valid video codec');
  assert.ok(isVideoCodec('avc1.4d400d0000009999993333333333333333'),
            'avc1.4d400d0000009999993333333333333333 is a valid video codec');

  assert.notOk(isVideoCodec('avc2.4d400d'), 'avc2.4d400d is not a valid video codec');
  assert.notOk(isVideoCodec('avc.4d400d'), 'avc.4d400d is not a valid video codec');
  assert.notOk(isVideoCodec('4d400d'), '4d400d is not a valid video codec');
  assert.notOk(isVideoCodec('d'), 'd is not a valid video codec');
  assert.notOk(isVideoCodec('4'), '4 is not a valid video codec');
  assert.notOk(isVideoCodec(''), '\'\' is not a valid video codec');
});
