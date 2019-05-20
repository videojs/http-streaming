import QUnit from 'qunit';
import {
  codecsForPlaylist,
  mapLegacyAvcCodecs,
  translateLegacyCodecs
} from '../../src/util/codecs';

const generateMedia = function({
  isMaat,
  isMuxed,
  hasVideoCodec,
  hasAudioCodec,
  isFMP4
}) {
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
  // no MAAT
  assert.deepEqual(
    codecsForPlaylist(...generateMedia({
      isMaat: false,
      isMuxed: true,
      hasVideoCodec: false,
      hasAudioCodec: false,
      isFMP4
    })),
    {
      audio: 'mp4a.40.2',
      video: 'avc1.4d400d'
    },
    'no MAAT, codecs: none');

  assert.deepEqual(
    codecsForPlaylist(...generateMedia({
      isMaat: false,
      isMuxed: true,
      hasVideoCodec: true,
      hasAudioCodec: false,
      isFMP4
    })),
    {
      video: 'avc1.deadbeef'
    },
    'no MAAT, codecs: video');

  assert.deepEqual(
    codecsForPlaylist(...generateMedia({
      isMaat: false,
      isMuxed: true,
      hasVideoCodec: false,
      hasAudioCodec: true,
      isFMP4
    })),
    {
      audio: 'mp4a.40.E'
    },
    'no MAAT, codecs: audio');

  assert.deepEqual(
    codecsForPlaylist(...generateMedia({
      isMaat: false,
      isMuxed: true,
      hasVideoCodec: true,
      hasAudioCodec: true,
      isFMP4
    })),
    {
      audio: 'mp4a.40.E',
      video: 'avc1.deadbeef'
    },
    'no MAAT, codecs: video, audio');

  // MAAT, not muxed
  assert.deepEqual(
    codecsForPlaylist(...generateMedia({
      isMaat: true,
      isMuxed: false,
      hasVideoCodec: false,
      hasAudioCodec: false,
      isFMP4
    })),
    {
      audio: 'mp4a.40.2',
      video: 'avc1.4d400d'
    },
    'MAAT, demuxed, codecs: none');

  assert.deepEqual(
    codecsForPlaylist(...generateMedia({
      isMaat: true,
      isMuxed: false,
      hasVideoCodec: true,
      hasAudioCodec: false,
      isFMP4
    })),
    {
      audio: 'mp4a.40.2',
      video: 'avc1.deadbeef'
    },
    'MAAT, demuxed, codecs: video');

  assert.deepEqual(
    codecsForPlaylist(...generateMedia({
      isMaat: true,
      isMuxed: false,
      hasVideoCodec: false,
      hasAudioCodec: true,
      isFMP4
    })),
    {
      audio: 'mp4a.40.E'
    },
    'MAAT, demuxed, codecs: audio');

  assert.deepEqual(
    codecsForPlaylist(...generateMedia({
      isMaat: true,
      isMuxed: false,
      hasVideoCodec: true,
      hasAudioCodec: true,
      isFMP4
    })),
    {
      audio: 'mp4a.40.E',
      video: 'avc1.deadbeef'
    },
    'MAAT, demuxed, codecs: video, audio');

  // MAAT, muxed
  assert.deepEqual(
    codecsForPlaylist(...generateMedia({
      isMaat: true,
      isMuxed: true,
      hasVideoCodec: false,
      hasAudioCodec: false,
      isFMP4
    })),
    {
      audio: 'mp4a.40.2',
      video: 'avc1.4d400d'
    },
    'MAAT, muxed, codecs: none');

  assert.deepEqual(
    codecsForPlaylist(...generateMedia({
      isMaat: true,
      isMuxed: true,
      hasVideoCodec: true,
      hasAudioCodec: false,
      isFMP4
    })),
    {
      audio: 'mp4a.40.2',
      video: 'avc1.deadbeef'
    },
    'MAAT, muxed, codecs: video');

  assert.deepEqual(
    codecsForPlaylist(...generateMedia({
      isMaat: true,
      isMuxed: true,
      hasVideoCodec: false,
      hasAudioCodec: true,
      isFMP4
    })),
    {
      audio: 'mp4a.40.E'
    },
    'MAAT, muxed, codecs: audio');

  assert.deepEqual(
    codecsForPlaylist(...generateMedia({
      isMaat: true,
      isMuxed: true,
      hasVideoCodec: true,
      hasAudioCodec: true,
      isFMP4
    })),
    {
      audio: 'mp4a.40.E',
      video: 'avc1.deadbeef'
    },
    'MAAT, muxed, codecs: video, audio');
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

  // HLS case, URI present for the alt audio playlist
  assert.deepEqual(
    codecsForPlaylist(master, media),
    {
      audio: 'mp4a.40.E',
      video: 'avc1.deadbeef'
    },
    'demuxed if URI');

  // HLS case, no URI or alt audio playlist present, so no available alt audio
  delete master.mediaGroups.AUDIO.test.demuxed.uri;
  assert.deepEqual(
    codecsForPlaylist(master, media),
    {
      audio: 'mp4a.40.E',
      video: 'avc1.deadbeef'
    },
    'muxed if no URI and no playlists');

  // DASH case, no URI but a playlist is available for alt audio
  master.mediaGroups.AUDIO.test.demuxed.playlists = [{}];
  assert.deepEqual(
    codecsForPlaylist(master, media),
    {
      audio: 'mp4a.40.E',
      video: 'avc1.deadbeef'
    },
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
    codecsForPlaylist(master, media),
    {
      audio: 'mp4a.40.E',
      video: 'avc1.deadbeef'
    },
    'uses audio codec from media group');

  delete master.mediaGroups.AUDIO.test.demuxed.default;
  assert.deepEqual(
    codecsForPlaylist(master, media),
    {
      audio: 'mp4a.40.2',
      video: 'avc1.deadbeef'
    },
    'uses default audio codec');
});

QUnit.test('parses codecs regardless of codec order', function(assert) {
  const master = {
    mediaGroups: {},
    playlists: []
  };
  const media = {
    attributes: {
      CODECS: 'avc1.deadbeef, mp4a.40.e'
    }
  };

  assert.deepEqual(
    codecsForPlaylist(master, media),
    {
      audio: 'mp4a.40.e',
      video: 'avc1.deadbeef'
    },
    'parses video first');

  media.attributes.CODECS = 'mp4a.40.e, avc1.deadbeef';

  assert.deepEqual(
    codecsForPlaylist(master, media),
    {
      audio: 'mp4a.40.e',
      video: 'avc1.deadbeef'
    },
    'parses audio first');
});

QUnit.module('Legacy Codecs');

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
