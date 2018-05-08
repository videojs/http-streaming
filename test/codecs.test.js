/* eslint-disable prefer-const */
// TODO: fix above

import QUnit from 'qunit';
import {
  mimeTypesForPlaylist,
  mapLegacyAvcCodecs
} from '../src/util/codecs';

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
