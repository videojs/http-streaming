import videojs from 'video.js';
import QUnit from 'qunit';
import sinon from 'sinon';
import { concatenateVideos } from '../src/concatenate-videos';
import window from 'global/window';

const STANDARD_HEADERS = { 'Content-Type': 'text/plain' };

const hlsMediaPlaylist = ({
  numSegments,
  segmentPrefix = '',
  segmentDuration = 10,
  targetDuration = 10
}) => {
  const segments = [];

  for (let i = 0; i < numSegments; i++) {
    segments.push(`
      #EXTINF:${segmentDuration}
      ${segmentPrefix}${i}.ts
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
              timescale="10"
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
          uri: 'combined-playlist',
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
            resolvedUri: `0.ts`
          }, {
            duration: 10,
            discontinuity: true,
            timeline: 1,
            uri: 'm2s0.ts',
            resolvedUri: `m2s0.ts`
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
    [200, STANDARD_HEADERS, hlsMediaPlaylist({ numSegments: 1 })]
  );
  this.server.respondWith(
    'GET',
    manifests[1].url,
    [200, STANDARD_HEADERS, dashPlaylist({ numSegments: 1 })]
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
          uri: 'combined-playlist',
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
            resolvedUri: `0.ts`
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

QUnit.test('calls back with an error when a manifest doesn\'t include a URL',
function(assert) {
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

QUnit.test('calls back with an error when a manifest doesn\'t include a mime type',
function(assert) {
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
