import QUnit from 'qunit';
import {
  codecsForPlaylist
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
  const main = {
    mediaGroups: {},
    playlists: []
  };
  const media = {
    attributes: {}
  };

  if (isMaat) {
    main.mediaGroups.AUDIO = {
      test: {
        demuxed: {
          uri: 'foo.bar'
        }
      }
    };

    if (isMuxed) {
      main.mediaGroups.AUDIO.test.muxed = {};
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

  return [main, media];
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
    {},
    'no MAAT, codecs: none'
  );

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
    'no MAAT, codecs: video'
  );

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
    'no MAAT, codecs: audio'
  );

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
    'no MAAT, codecs: video, audio'
  );

  // MAAT, not muxed
  assert.deepEqual(
    codecsForPlaylist(...generateMedia({
      isMaat: true,
      isMuxed: false,
      hasVideoCodec: false,
      hasAudioCodec: false,
      isFMP4
    })),
    {},
    'MAAT, demuxed, codecs: none'
  );

  assert.deepEqual(
    codecsForPlaylist(...generateMedia({
      isMaat: true,
      isMuxed: false,
      hasVideoCodec: true,
      hasAudioCodec: false,
      isFMP4
    })),
    {
      video: 'avc1.deadbeef'
    },
    'MAAT, demuxed, codecs: video'
  );

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
    'MAAT, demuxed, codecs: audio'
  );

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
    'MAAT, demuxed, codecs: video, audio'
  );

  // MAAT, muxed
  assert.deepEqual(
    codecsForPlaylist(...generateMedia({
      isMaat: true,
      isMuxed: true,
      hasVideoCodec: false,
      hasAudioCodec: false,
      isFMP4
    })),
    {},
    'MAAT, muxed, codecs: none'
  );

  assert.deepEqual(
    codecsForPlaylist(...generateMedia({
      isMaat: true,
      isMuxed: true,
      hasVideoCodec: true,
      hasAudioCodec: false,
      isFMP4
    })),
    {
      video: 'avc1.deadbeef'
    },
    'MAAT, muxed, codecs: video'
  );

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
    'MAAT, muxed, codecs: audio'
  );

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
    'MAAT, muxed, codecs: video, audio'
  );
};

QUnit.test('recognizes muxed codec configurations', function(assert) {
  testMimeTypes(assert, false);
  testMimeTypes(assert, true);
});

// dash audio playlist won't have a URI but will have resolved playlists
QUnit.test(
  'content demuxed if alt audio URI not present but playlists present',
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
    const main = {
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
      codecsForPlaylist(main, media),
      {
        audio: 'mp4a.40.E',
        video: 'avc1.deadbeef'
      },
      'demuxed if URI'
    );

    // HLS case, no URI or alt audio playlist present, so no available alt audio
    delete main.mediaGroups.AUDIO.test.demuxed.uri;
    assert.deepEqual(
      codecsForPlaylist(main, media),
      {
        audio: 'mp4a.40.E',
        video: 'avc1.deadbeef'
      },
      'muxed if no URI and no playlists'
    );

    // DASH case, no URI but a playlist is available for alt audio
    main.mediaGroups.AUDIO.test.demuxed.playlists = [{}];
    assert.deepEqual(
      codecsForPlaylist(main, media),
      {
        audio: 'mp4a.40.E',
        video: 'avc1.deadbeef'
      },
      'demuxed if no URI but playlists'
    );
  }
);

QUnit.test(
  'uses audio codec from default group if not specified in media attributes',
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
    const main = {
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
      codecsForPlaylist(main, media),
      {
        audio: 'mp4a.40.E',
        video: 'avc1.deadbeef'
      },
      'uses audio codec from media group'
    );

    delete main.mediaGroups.AUDIO.test.demuxed.default;
    assert.deepEqual(
      codecsForPlaylist(main, media),
      {
        video: 'avc1.deadbeef'
      },
      'uses default audio codec'
    );
  }
);

QUnit.test('parses codecs regardless of codec order', function(assert) {
  const main = {
    mediaGroups: {},
    playlists: []
  };
  const media = {
    attributes: {
      CODECS: 'avc1.deadbeef, mp4a.40.e'
    }
  };

  assert.deepEqual(
    codecsForPlaylist(main, media),
    {
      audio: 'mp4a.40.e',
      video: 'avc1.deadbeef'
    },
    'parses video first'
  );

  media.attributes.CODECS = 'mp4a.40.e, avc1.deadbeef';

  assert.deepEqual(
    codecsForPlaylist(main, media),
    {
      audio: 'mp4a.40.e',
      video: 'avc1.deadbeef'
    },
    'parses audio first'
  );
});
