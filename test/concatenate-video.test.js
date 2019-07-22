import videojs from 'video.js';
import QUnit from 'qunit';
import sinon from 'sinon';
import { concatenateVideos } from '../src/concatenate-videos';
import window from 'global/window';

const STANDARD_HEADERS = { 'Content-Type': 'text/plain' };

const hlsMasterPlaylist = ({
  numPlaylists = 1,
  playlistPrefix = 'playlist',
  includeDemuxedAudio = false
}) => {
  const playlists = [];

  for (let i = 0; i < numPlaylists; i++) {
    const playlistPath = `${playlistPrefix}${i}.m3u8`;
    const audioAttribute = includeDemuxedAudio ? ',AUDIO="audio"' : '';

    playlists.push(`
      #EXT-X-STREAM-INF:BANDWIDTH=${i}${audioAttribute}
      ${playlistPath}
    `);
  }

  const audioGroup = includeDemuxedAudio ?
    '#EXT-X-MEDIA:TYPE=AUDIO' +
      ',GROUP-ID="audio",LANGUAGE="en",NAME="English"' +
      ',AUTOSELECT=YES,DEFAULT=YES' +
      `,URI="${playlistPrefix}-audio.m3u8"` :
    '';

  return `
    #EXTM3U
    #EXT-X-VERSION:3
    ${audioGroup}

    ${playlists.join('\n')}
  `;
};

const hlsMediaPlaylist = ({
  numSegments,
  segmentPrefix = '',
  segmentDuration = 10,
  targetDuration = 10
}) => {
  const segments = [];

  for (let i = 0; i < numSegments; i++) {
    const segmentPath = `${segmentPrefix}${i}.ts`;

    segments.push(`
      #EXTINF:${segmentDuration}
      ${segmentPath}
    `);
  }

  return `
    #EXTM3U
    #EXT-X-VERSION:3
    #EXT-X-PLAYLIST-TYPE:VOD
    #EXT-X-MEDIA-SEQUENCE:0
    #EXT-X-TARGETDURATION:${targetDuration}
    ${segments.join('\n')}
    #EXT-X-ENDLIST
  `;
};

const dashPlaylist = ({
  numSegments,
  segmentDuration = 10
}) => {
  return `<?xml version="1.0"?>
    <MPD
      xmlns="urn:mpeg:dash:schema:mpd:2011"
      profiles="urn:mpeg:dash:profile:full:2011"
      minBufferTime="1.5"
      mediaPresentationDuration="PT${numSegments * segmentDuration}S">
      <Period>
        <BaseURL>main/</BaseURL>
        <AdaptationSet mimeType="video/mp4">
          <BaseURL>video/</BaseURL>
          <Representation
            id="1080p"
            bandwidth="6800000"
            width="1920"
            height="1080"
            codecs="avc1.420015">
            <BaseURL>1080/</BaseURL>
            <SegmentTemplate
              media="$RepresentationID$-segment-$Number$.mp4"
              initialization="$RepresentationID$-init.mp4"
              duration="${segmentDuration}"
              timescale="1"
              startNumber="0" />
          </Representation>
          <Representation
            id="720p"
            bandwidth="2400000"
            width="1280"
            height="720"
            codecs="avc1.420015">
            <BaseURL>720/</BaseURL>
            <SegmentTemplate
              media="$RepresentationID$-segment-$Number$.mp4"
              initialization="$RepresentationID$-init.mp4"
              duration="${segmentDuration}"
              timescale="1"
              startNumber="0" />
          </Representation>
        </AdaptationSet>
        <AdaptationSet mimeType="audio/mp4">
          <BaseURL>audio/</BaseURL>
          <Representation id="audio" bandwidth="128000" codecs="mp4a.40.2">
            <BaseURL>720/</BaseURL>
            <SegmentTemplate
              media="segment-$Number$.mp4"
              initialization="$RepresentationID$-init.mp4"
              duration="${segmentDuration}"
              timescale="1"
              startNumber="0" />
          </Representation>
        </AdaptationSet>
      </Period>
    </MPD>`;
};

const concatenateVideosPromise = ({ manifests, targetVerticalResolution }) => {
  return new Promise((accept, reject) => {
    concatenateVideos({
      manifests,
      targetVerticalResolution,
      callback: (err, sourceObject) => {
        if (err) {
          reject(err);
          return;
        }

        accept(sourceObject);
      }
    });
  });
};

QUnit.module('concatenate-videos', {
  beforeEach() {
    this.realXhr = videojs.xhr.XMLHttpRequest;
    this.server = sinon.fakeServer.create();
    videojs.xhr.XMLHttpRequest = this.server.xhr;
    this.server.autoRespond = true;
  },

  afterEach() {
    this.server.restore();
    videojs.xhr.XMLHttpRequest = this.realXhr;
  }
});

QUnit.test('concatenates multiple videos into one', function(assert) {
  const done = assert.async();
  const manifests = [{
    url: '/manifest1.m3u8',
    mimeType: 'application/vnd.apple.mpegurl'
  }, {
    url: '/manifest2.m3u8',
    mimeType: 'application/x-mpegurl'
  }];

  this.server.respondWith(
    'GET',
    manifests[0].url,
    [200, STANDARD_HEADERS, hlsMediaPlaylist({ numSegments: 1 })]
  );
  this.server.respondWith(
    'GET',
    manifests[1].url,
    [200, STANDARD_HEADERS, hlsMediaPlaylist({ segmentPrefix: 'm2s', numSegments: 1 })]
  );

  concatenateVideosPromise({
    manifests,
    targetVideoResolution: 720
  }).then((sourceObject) => {
    assert.deepEqual(
      sourceObject,
      {
        uri: window.location.href,
        mediaGroups: {
          'AUDIO': {},
          'VIDEO': {},
          'CLOSED-CAPTIONS': {},
          'SUBTITLES': {}
        },
        playlists: [{
          attributes: {},
          uri: 'combined-playlist',
          resolvedUri: 'combined-playlist',
          endList: true,
          mediaSequence: 0,
          discontinuitySequence: 0,
          playlistType: 'VOD',
          targetDuration: 10,
          discontinuityStarts: [1],
          segments: [{
            duration: 10,
            timeline: 0,
            uri: '0.ts',
            resolvedUri: `${window.location.origin}/0.ts`
          }, {
            duration: 10,
            discontinuity: true,
            timeline: 1,
            uri: 'm2s0.ts',
            resolvedUri: `${window.location.origin}/m2s0.ts`
          }]
        }]
      },
      'created concatenated video object'
    );
    done();
  });
});

QUnit.test('concatenates HLS and DASH sources together', function(assert) {
  const done = assert.async();
  const manifests = [{
    url: '/manifest1.m3u8',
    mimeType: 'application/vnd.apple.mpegurl'
  }, {
    url: '/dash.mpd',
    mimeType: 'application/dash+xml'
  }];

  this.server.respondWith(
    'GET',
    manifests[0].url,
    [
      200,
      STANDARD_HEADERS,
      hlsMasterPlaylist({
        includeDemuxedAudio: true
      })
    ]
  );
  this.server.respondWith(
    'GET',
    manifests[0].url,
    [200, STANDARD_HEADERS, hlsMasterPlaylist({ includeDemuxedAudio: true })]
  );
  this.server.respondWith(
    'GET',
    '/playlist0.m3u8',
    [200, STANDARD_HEADERS, hlsMediaPlaylist({ numSegments: 1 })]
  );
  this.server.respondWith(
    'GET',
    '/playlist-audio.m3u8',
    [200, STANDARD_HEADERS, hlsMediaPlaylist({ numSegments: 1, segmentPrefix: 'audio' })]
  );
  this.server.respondWith(
    'GET',
    manifests[1].url,
    [200, STANDARD_HEADERS, dashPlaylist({ numSegments: 1 })]
  );

  const expectedAudioPlaylist = {
    attributes: {},
    discontinuitySequence: 0,
    discontinuityStarts: [1],
    endList: true,
    mediaSequence: 0,
    playlistType: 'VOD',
    uri: 'combined-playlist-audio',
    resolvedUri: 'combined-playlist-audio',
    targetDuration: 10,
    segments: [{
      duration: 10,
      resolvedUri: `${window.location.origin}/audio0.ts`,
      timeline: 0,
      uri: 'audio0.ts'
    }, {
      discontinuity: true,
      duration: 10,
      map: {
        uri: 'audio-init.mp4',
        resolvedUri: `${window.location.origin}/main/audio/720/audio-init.mp4`
      },
      number: 0,
      timeline: 1,
      uri: 'segment-0.mp4',
      resolvedUri: `${window.location.origin}/main/audio/720/segment-0.mp4`
    }]
  };
  const expectedAudioPlaylists = [expectedAudioPlaylist];

  expectedAudioPlaylists['combined-playlist-audio'] = expectedAudioPlaylist;

  concatenateVideosPromise({
    manifests,
    targetVideoResolution: 720
  }).then((sourceObject) => {
    assert.deepEqual(
      sourceObject,
      {
        uri: window.location.href,
        mediaGroups: {
          'AUDIO': {
            audio: {
              default: {
                autoselect: true,
                default: true,
                language: '',
                playlists: expectedAudioPlaylists,
                uri: 'combined-audio-playlists'
              }
            }
          },
          'VIDEO': {},
          'CLOSED-CAPTIONS': {},
          'SUBTITLES': {}
        },
        playlists: [{
          attributes: {
            AUDIO: 'audio',
            // TODO?
            BANDWIDTH: 0
          },
          uri: 'combined-playlist',
          resolvedUri: 'combined-playlist',
          endList: true,
          mediaSequence: 0,
          discontinuitySequence: 0,
          playlistType: 'VOD',
          targetDuration: 10,
          discontinuityStarts: [1],
          segments: [{
            duration: 10,
            timeline: 0,
            uri: '0.ts',
            resolvedUri: `${window.location.origin}/0.ts`
          }, {
            duration: 10,
            discontinuity: true,
            timeline: 1,
            number: 0,
            map: {
              uri: '1080p-init.mp4',
              resolvedUri: `${window.location.origin}/main/video/1080/1080p-init.mp4`
            },
            uri: '1080p-segment-0.mp4',
            resolvedUri: `${window.location.origin}/main/video/1080/1080p-segment-0.mp4`
          }]
        }]
      },
      'created concatenated video object'
    );
    done();
  });
});

QUnit.test('calls back with an error when no manifests passed in', function(assert) {
  const done = assert.async();

  concatenateVideosPromise({
    manifests: [],
    targetVideoResolution: 720
  }).catch((error) => {
    assert.equal(
      error.message,
      'No sources provided',
      'called back with correct error message'
    );
    done();
  });
});

QUnit.test('calls back with error when a manifest doesn\'t include a URL', function(assert) {
  const done = assert.async();

  concatenateVideosPromise({
    manifests: [{
      url: '/manifest1.m3u8',
      mimeType: 'application/vnd.apple.mpegurl'
    }, {
      mimeType: 'application/x-mpegurl'
    }],
    targetVideoResolution: 720
  }).catch((error) => {
    assert.equal(
      error.message,
      'All manifests must include a URL',
      'called back with correct error message'
    );
    done();
  });
});

QUnit.test('calls back with an error when a manifest doesn\'t include a mime type', function(assert) {
  const done = assert.async();

  concatenateVideosPromise({
    manifests: [{
      url: '/manifest1.m3u8',
      mimeType: 'application/vnd.apple.mpegurl'
    }, {
      url: '/manifest2.m3u8'
    }],
    targetVideoResolution: 720
  }).catch((error) => {
    assert.equal(
      error.message,
      'All manifests must include a mime type',
      'called back with correct error message'
    );
    done();
  });
});

QUnit.test('calls back with an error on request failure', function(assert) {
  const done = assert.async();
  const manifests = [{
    url: '/manifest1.m3u8',
    mimeType: 'application/vnd.apple.mpegurl'
  }, {
    url: '/manifest2.m3u8',
    mimeType: 'application/x-mpegurl'
  }];

  this.server.respondWith(
    'GET',
    manifests[0].url,
    [200, STANDARD_HEADERS, hlsMediaPlaylist({ numSegments: 1 })]
  );
  this.server.respondWith('GET', manifests[1].url, [500, STANDARD_HEADERS, '']);

  concatenateVideosPromise({
    manifests,
    targetVideoResolution: 720
  }).catch((error) => {
    assert.equal(
      error.message,
      'Request failed',
      'called back with correct error message'
    );
    assert.equal(error.request.status, 500, 'called back with correct error status');
    done();
  });
});

// TODO
// Includes codec info
// Calls back with an error when incompatible playlists
// Falls back to config.INITIAL_BANDWIDTH when no resolution information
