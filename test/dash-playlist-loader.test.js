import QUnit from 'qunit';
import sinon from 'sinon';
import window from 'global/window';
import {
  default as DashPlaylistLoader,
  updateMain,
  compareSidxEntry,
  filterChangedSidxMappings,
  parseMainXml
} from '../src/dash-playlist-loader';
import parseSidx from 'mux.js/lib/tools/parse-sidx';
import xhrFactory from '../src/xhr';
import {generateSidxKey} from 'mpd-parser';
import {
  useFakeEnvironment,
  standardXHRResponse,
  urlTo
} from './test-helpers';
// needed for plugin registration
import '../src/videojs-http-streaming';
import testDataManifests from 'create-test-data!manifests';
import { sidx as sidxResponse } from 'create-test-data!segments';
import {mp4VideoInit as mp4VideoInitSegment} from 'create-test-data!segments';

QUnit.module('DASH Playlist Loader: unit', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.clock = this.env.clock;
    this.requests = this.env.requests;
    this.fakeVhs = {
      xhr: xhrFactory()
    };
    this.standardXHRResponse = (request, data) => {
      standardXHRResponse(request, data);

      // Because SegmentLoader#fillBuffer_ is now scheduled asynchronously
      // we have to use clock.tick to get the expected side effects of
      // SegmentLoader#handleUpdateEnd_
      this.clock.tick(1);
    };
  },
  afterEach() {
    this.env.restore();
  }
});

QUnit.test('can getKeyIdSet from a playlist', function(assert) {
  const loader = new DashPlaylistLoader('variant.mpd', this.fakeVhs);
  const keyId = '188743e1-bd62-400e-92d9-748f8c753d1a';
  // Test uppercase keyId from playlist.
  const uppercaseKeyId = '800AACAA-5229-58AE-8880-62B5695DB6BF';
  // We currently only pass keyId for widevine content protection.
  const playlist = {
    contentProtection: {
      mp4protection: {
        attributes: {
          'cenc:default_KID': keyId
        }
      }
    }
  };
  let keyIdSet = loader.getKeyIdSet(playlist);

  assert.ok(keyIdSet.size);
  assert.ok(keyIdSet.has(keyId.replace(/-/g, '')), 'keyId is expected hex string');

  playlist.contentProtection.mp4protection.attributes['cenc:default_KID'] = uppercaseKeyId;
  keyIdSet = loader.getKeyIdSet(playlist);

  assert.ok(keyIdSet.has(uppercaseKeyId.replace(/-/g, '').toLowerCase()), 'keyId is expected lowercase hex string');
});

QUnit.test('updateMain: returns falsy when there are no changes', function(assert) {
  const main = {
    playlists: {
      length: 1,
      0: {
        uri: '0',
        id: '0',
        segments: []
      }
    },
    mediaGroups: {
      AUDIO: {
        audio: {
          'audio-main': {
            attributes: {
              NAME: 'audio'
            },
            playlists: {
              length: 1,
              0: {
                playlists: {}
              }
            }
          }
        }
      },
      SUBTITLES: {}
    },
    duration: 0,
    minimumUpdatePeriod: 0,
    timelineStarts: []
  };

  assert.deepEqual(updateMain(main, main), null);
});

QUnit.test('updateMain: updates playlists', function(assert) {
  const main = {
    playlists: [{
      uri: '0',
      id: '0'
    },
    {
      uri: '1',
      id: '1',
      segments: []
    }],
    mediaGroups: {
      AUDIO: {},
      SUBTITLES: {}
    },
    duration: 0,
    minimumUpdatePeriod: 0,
    timelineStarts: []
  };

  // Only the first playlist is changed
  const update = {
    playlists: [{
      id: '0',
      uri: '0',
      segments: []
    },
    {
      uri: '1',
      id: '1',
      segments: []
    }],
    mediaGroups: {
      AUDIO: {},
      SUBTITLES: {}
    },
    duration: 0,
    minimumUpdatePeriod: 0,
    timelineStarts: []
  };

  assert.deepEqual(
    updateMain(main, update),
    {
      playlists: [{
        id: '0',
        uri: '0',
        segments: []
      },
      {
        uri: '1',
        id: '1',
        segments: []
      }],
      mediaGroups: {
        AUDIO: {},
        SUBTITLES: {}
      },
      duration: 0,
      minimumUpdatePeriod: 0,
      timelineStarts: []
    }
  );
});

QUnit.test('updateMain: updates mediaGroups', function(assert) {
  const main = {
    playlists: {
      length: 1,
      0: {
        id: '0',
        uri: '0',
        segments: []
      }
    },
    mediaGroups: {
      AUDIO: {
        audio: {
          'audio-main': {
            playlists: [{
              id: '0',
              uri: '0',
              test: 'old text',
              segments: []
            }]
          }
        }
      },
      SUBTITLES: {}
    },
    duration: 0,
    minimumUpdatePeriod: 0
  };

  const update = {
    playlists: {
      length: 1,
      0: {
        uri: '0',
        segments: []
      }
    },
    mediaGroups: {
      AUDIO: {
        audio: {
          'audio-main': {
            playlists: [{
              id: '0',
              uri: '0',
              resolvedUri: '0',
              test: 'new text',
              segments: [{
                uri: 's'
              }]
            }]
          }
        }
      },
      SUBTITLES: {}
    },
    duration: 0,
    minimumUpdatePeriod: 0
  };

  assert.ok(
    updateMain(main, update),
    'the mediaGroups were updated'
  );
});

QUnit.test('updateMain: updates playlists and mediaGroups', function(assert) {
  const main = {
    duration: 10,
    minimumUpdatePeriod: 0,
    timelineStarts: [],
    mediaGroups: {
      AUDIO: {
        audio: {
          main: {
            playlists: [{
              mediaSequence: 0,
              attributes: {},
              id: 'audio-0-uri',
              uri: 'audio-0-uri',
              resolvedUri: urlTo('audio-0-uri'),
              segments: [{
                duration: 10,
                uri: 'audio-segment-0-uri',
                resolvedUri: urlTo('audio-segment-0-uri')
              }]
            }]
          }
        }
      }
    },
    playlists: [{
      mediaSequence: 0,
      attributes: {
        BANDWIDTH: 9
      },
      id: 'playlist-0-uri',
      uri: 'playlist-0-uri',
      resolvedUri: urlTo('playlist-0-uri'),
      segments: [{
        duration: 10,
        uri: 'segment-0-uri',
        resolvedUri: urlTo('segment-0-uri')
      }]
    }]
  };
  const update = {
    duration: 20,
    minimumUpdatePeriod: 0,
    timelineStarts: [],
    mediaGroups: {
      AUDIO: {
        audio: {
          main: {
            playlists: [{
              mediaSequence: 1,
              attributes: {},
              id: 'audio-0-uri',
              uri: 'audio-0-uri',
              resolvedUri: urlTo('audio-0-uri'),
              segments: [{
                duration: 10,
                uri: 'audio-segment-0-uri',
                resolvedUri: urlTo('audio-segment-0-uri')
              }]
            }]
          }
        }
      }
    },
    playlists: [{
      mediaSequence: 1,
      attributes: {
        BANDWIDTH: 9
      },
      id: 'playlist-0-uri',
      uri: 'playlist-0-uri',
      resolvedUri: urlTo('playlist-0-uri'),
      segments: [{
        duration: 10,
        uri: 'segment-0-uri',
        resolvedUri: urlTo('segment-0-uri')
      }]
    }]
  };

  main.playlists['playlist-0-uri'] = main.playlists[0];
  main.playlists['audio-0-uri'] = main.mediaGroups.AUDIO.audio.main.playlists[0];

  assert.deepEqual(
    updateMain(main, update),
    {
      duration: 20,
      minimumUpdatePeriod: 0,
      timelineStarts: [],
      mediaGroups: {
        AUDIO: {
          audio: {
            main: {
              playlists: [{
                mediaSequence: 1,
                attributes: {},
                id: 'audio-0-uri',
                uri: 'audio-0-uri',
                resolvedUri: urlTo('audio-0-uri'),
                segments: [{
                  duration: 10,
                  uri: 'audio-segment-0-uri',
                  resolvedUri: urlTo('audio-segment-0-uri')
                }]
              }]
            }
          }
        }
      },
      playlists: [{
        mediaSequence: 1,
        attributes: {
          BANDWIDTH: 9
        },
        id: 'playlist-0-uri',
        uri: 'playlist-0-uri',
        resolvedUri: urlTo('playlist-0-uri'),
        segments: [{
          duration: 10,
          uri: 'segment-0-uri',
          resolvedUri: urlTo('segment-0-uri')
        }]
      }]
    },
    'updates playlists and media groups'
  );
});

QUnit.test('updateMain: updates minimumUpdatePeriod', function(assert) {
  const main = {
    playlists: {
      length: 1,
      0: {
        uri: '0',
        id: '0',
        segments: []
      }
    },
    mediaGroups: {
      AUDIO: {},
      SUBTITLES: {}
    },
    duration: 0,
    minimumUpdatePeriod: 0,
    timelineStarts: []
  };

  const update = {
    playlists: {
      length: 1,
      0: {
        uri: '0',
        id: '0',
        segments: []
      }
    },
    mediaGroups: {
      AUDIO: {},
      SUBTITLES: {}
    },
    duration: 0,
    minimumUpdatePeriod: 2,
    timelineStarts: []
  };

  assert.deepEqual(
    updateMain(main, update),
    {
      playlists: {
        length: 1,
        0: {
          uri: '0',
          id: '0',
          segments: []
        }
      },
      mediaGroups: {
        AUDIO: {},
        SUBTITLES: {}
      },
      duration: 0,
      minimumUpdatePeriod: 2,
      timelineStarts: []
    }
  );
});

QUnit.test('updateMain: requires sidxMapping.sidx to add sidx segments', function(assert) {
  const prev = {
    playlists: [{
      uri: '0',
      id: 0,
      segments: [],
      sidx: {
        resolvedUri: 'https://example.com/foo.mp4',
        uri: 'foo.mp4',
        duration: 10,
        byterange: {
          offset: 2,
          length: 4
        }
      }
    }],
    mediaGroups: {
      AUDIO: {},
      SUBTITLES: {}
    }
  };
  const next = {
    playlists: [{
      uri: '0',
      id: 0,
      segments: [],
      sidx: {
        resolvedUri: 'https://example.com/foo.mp4',
        uri: 'foo.mp4',
        duration: 10,
        byterange: {
          offset: 2,
          length: 4
        }
      }
    }],
    mediaGroups: {
      AUDIO: {},
      SUBTITLES: {}
    }
  };
  const sidxMapping = {};
  const key = generateSidxKey(prev.playlists[0].sidx);

  sidxMapping[key] = {sidxInfo: {uri: 'foo', key}};

  assert.deepEqual(
    updateMain(prev, next, sidxMapping),
    null,
    'no update'
  );

  sidxMapping[key].sidx = parseSidx(sidxResponse().subarray(8));

  const result = updateMain(prev, next, sidxMapping);

  assert.ok(result, 'result returned');
  assert.equal(result.playlists[0].segments.length, 1, 'added one segment from sidx');

});

QUnit.test('compareSidxEntry: will not add new sidx info to a mapping', function(assert) {
  const playlists = {
    0: {
      sidx: {
        byterange: {
          offset: 0,
          length: 10
        },
        uri: '0'
      }
    },
    1: {
      sidx: {
        byterange: {
          offset: 10,
          length: 29
        },
        uri: '1'
      }
    }
  };
  const oldSidxMapping = {
    '0-0-9': {
      sidx: new Uint8Array(),
      sidxInfo: playlists[0].sidx
    }
  };
  const result = compareSidxEntry(playlists, oldSidxMapping);

  assert.notOk(result['1-10-29'], 'new playlists are not returned');
  assert.ok(result['0-0-9'], 'matching playlists are returned');
  assert.strictEqual(Object.keys(result).length, 1, 'only one sidx');
});

QUnit.test('compareSidxEntry: will remove non-matching sidxes from a mapping', function(assert) {
  const playlists = [
    {
      uri: '0',
      id: '0',
      sidx: {
        byterange: {
          offset: 0,
          length: 10
        }
      }
    }
  ];
  const oldSidxMapping = {
    '0-0-9': {
      sidx: new Uint8Array(),
      sidxInfo: {
        byterange: {
          offset: 1,
          length: 3
        }
      }
    }
  };
  const result = compareSidxEntry(playlists, oldSidxMapping);

  assert.strictEqual(Object.keys(result).length, 0, 'no sidxes in mapping');
});

QUnit.test('filterChangedSidxMappings: removes change sidx info from mapping', function(assert) {
  const loader = new DashPlaylistLoader('dash-sidx.mpd', this.fakeVhs);

  loader.load();
  // main
  this.standardXHRResponse(this.requests.shift());

  // container request
  this.standardXHRResponse(this.requests.shift(), mp4VideoInitSegment().subarray(0, 10));
  // sidx byterange request
  this.standardXHRResponse(this.requests.shift(), sidxResponse());
  const childPlaylist = loader.main.mediaGroups.AUDIO.audio.en.playlists[0];

  const childLoader = new DashPlaylistLoader(childPlaylist, this.fakeVhs, false, loader);

  childLoader.load();
  this.clock.tick(1);

  // audio playlist container request
  this.standardXHRResponse(this.requests.shift(), mp4VideoInitSegment().subarray(0, 10));
  // audio sidx byterange request
  this.standardXHRResponse(this.requests.shift(), sidxResponse());

  const oldSidxMapping = loader.sidxMapping_;
  let newSidxMapping = filterChangedSidxMappings(
    loader.main,
    loader.sidxMapping_
  );

  assert.deepEqual(
    newSidxMapping,
    oldSidxMapping,
    'if no sidx info changed, return the same object'
  );
  const playlists = loader.main.playlists;
  const oldVideoKey = generateSidxKey(playlists['0-placeholder-uri-0'].sidx);
  const oldAudioEnKey = generateSidxKey(playlists['0-placeholder-uri-AUDIO-audio-audio'].sidx);

  let mainXml = loader.mainXml_.replace(/(indexRange)=\"\d+-\d+\"/, '$1="201-400"');
  // should change the video playlist
  let newMain = parseMainXml({
    mainXml,
    srcUrl: loader.srcUrl,
    clientOffset: loader.clientOffset_
  });

  newSidxMapping = filterChangedSidxMappings(
    newMain,
    loader.sidxMapping_
  );
  const newVideoKey = `${playlists['0-placeholder-uri-0'].sidx.uri}-201-400`;

  assert.notOk(
    newSidxMapping[oldVideoKey],
    'old video playlist mapping is not returned'
  );
  assert.notOk(
    newSidxMapping[newVideoKey],
    'new video playlists are not returned'
  );
  assert.ok(
    newSidxMapping[oldAudioEnKey],
    'audio group mapping is returned as it is unchanged'
  );

  // should change the English audio group
  mainXml = loader.mainXml_.replace(/(indexRange)=\"\d+-\d+\"/g, '$1="201-400"');
  newMain = parseMainXml({
    mainXml,
    srcUrl: loader.srcUrl,
    clientOffset: loader.clientOffset_
  });
  newSidxMapping = filterChangedSidxMappings(
    newMain,
    loader.sidxMapping_
  );
  assert.notOk(
    newSidxMapping[oldAudioEnKey],
    'audio group English is removed'
  );
});

QUnit.test('addSidxSegments_: creates an XHR request for a sidx range', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);
  const sidxInfo = {
    resolvedUri: 'sidx.mp4',
    byterange: {
      offset: 10,
      length: 10
    }
  };
  const playlist = {
    uri: 'fakeplaylist',
    id: 'fakeplaylist',
    segments: [sidxInfo],
    sidx: sidxInfo
  };
  const callback = sinon.stub();

  loader.addSidxSegments_(playlist, loader.state, callback);

  assert.strictEqual(this.requests[0].uri, sidxInfo.resolvedUri, 'uri requested is correct');
  this.standardXHRResponse(this.requests.shift(), mp4VideoInitSegment().subarray(0, 10));

  assert.strictEqual(this.requests[0].uri, sidxInfo.resolvedUri, 'uri requested is correct');
  this.standardXHRResponse(this.requests.shift());
  assert.strictEqual(callback.callCount, 1, 'callback was called');
});

QUnit.test('addSidxSegments_: does not re-request bytes from container request', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);
  const sidxInfo = {
    resolvedUri: 'sidx.mp4',
    byterange: {
      offset: 0,
      length: 600
    }
  };
  const playlist = {
    uri: 'fakeplaylist',
    id: 'fakeplaylist',
    segments: [sidxInfo],
    sidx: sidxInfo
  };
  const callback = sinon.stub();

  loader.addSidxSegments_(playlist, loader.state, callback);
  assert.strictEqual(this.requests[0].uri, sidxInfo.resolvedUri, 'uri requested is correct');
  assert.strictEqual(this.requests.length, 1, 'one xhr request');

  const data = new Uint8Array(600);

  data.set(mp4VideoInitSegment().subarray(0, 10));

  this.standardXHRResponse(this.requests.shift(), data);

  assert.equal(this.requests.length, 0, 'no more requests');
  assert.strictEqual(callback.callCount, 1, 'callback was called');
});

QUnit.test('addSidxSegments_: adds/triggers error on invalid container', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);
  const sidxInfo = {
    resolvedUri: 'sidx.mp4',
    byterange: {
      offset: 0,
      length: 10
    }
  };
  const playlist = {
    uri: 'fakeplaylist',
    id: 'fakeplaylist',
    segments: [sidxInfo],
    sidx: sidxInfo
  };
  let triggeredError = false;
  const callback = sinon.stub();

  loader.on('error', () => {
    triggeredError = true;
  });
  loader.addSidxSegments_(playlist, loader.state, callback);

  assert.strictEqual(this.requests[0].uri, sidxInfo.resolvedUri, 'uri requested is correct');
  assert.strictEqual(this.requests.length, 1, 'one xhr request');

  this.standardXHRResponse(this.requests.shift());

  assert.equal(this.requests.length, 0, 'no more requests');
  assert.ok(triggeredError, 'triggered an error');

  assert.deepEqual(loader.error, {
    playlistExclusionDuration: Infinity,
    code: 2,
    internal: true,
    message: 'Unsupported unknown container type for sidx segment at URL: sidx.mp4',
    playlist,
    response: '',
    status: 200
  }, 'error as expected');
});

QUnit.test('constructor throws if the playlist url is empty or undefined', function(assert) {
  assert.throws(function() {
    DashPlaylistLoader();
  }, 'requires an argument');
  assert.throws(function() {
    DashPlaylistLoader('');
  }, 'does not accept the empty string');
});

QUnit.test('constructor sets srcUrl and other properties', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);

  assert.strictEqual(loader.state, 'HAVE_NOTHING', 'correct state');
  assert.deepEqual(loader.loadedPlaylists_, {}, 'correct loadedPlaylist state');
  assert.equal(loader.mainPlaylistLoader_, loader, 'mainPlaylistLoader should be self');
  assert.ok(loader.isMain_, 'should be set as main');
  assert.notOk(loader.childPlaylist_, 'should be no childPlaylist_');
  assert.strictEqual(loader.srcUrl, 'dash.mpd', 'set the srcUrl');

  const childLoader = new DashPlaylistLoader({}, this.fakeVhs, false, loader);

  assert.strictEqual(childLoader.state, 'HAVE_NOTHING', 'correct state');
  assert.deepEqual(childLoader.loadedPlaylists_, {}, 'correct loadedPlaylist state');
  assert.ok(childLoader.mainPlaylistLoader_, 'should be a mainPlaylistLoader');
  assert.notEqual(childLoader.mainPlaylistLoader_, childLoader, 'should not be a mainPlaylistLoader');
  assert.notOk(childLoader.isMain_, 'should not be main');
  assert.deepEqual(
    childLoader.childPlaylist_, {},
    'should be a childPlaylist_'
  );
  assert.notOk(childLoader.srcUrl, 'should be no srcUrl');
});

QUnit.test('dispose: aborts pending manifest request', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);

  loader.load();
  this.clock.tick(1);
  assert.equal(this.requests.length, 1, 'one request');
  assert.notOk(this.requests[0].aborted, 'request not aborted');
  assert.ok(this.requests[0].onreadystatechange, 'onreadystatechange handler exists');
  loader.dispose();
  assert.equal(this.requests.length, 1, 'one request');
  assert.ok(this.requests[0].aborted, 'request aborted');
  assert.notOk(
    this.requests[0].onreadystatechange,
    'onreadystatechange handler does not exist'
  );
});

QUnit.test('load: will start an unstarted loader', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);
  const origHasPendingRequest = loader.hasPendingRequest;
  let loadedPlaylists = 0;
  let loadedMetadata = 0;

  loader.on('loadedplaylist', () => {
    loadedPlaylists++;
  });
  loader.on('loadedmetadata', () => {
    loadedMetadata++;
  });
  assert.notOk(loader.started, 'begins unstarted');

  loader.load();
  assert.strictEqual(loader.started, true, 'load should start the loader');
  assert.strictEqual(this.requests.length, 1, 'should request the manifest');
  assert.strictEqual(loader.state, 'HAVE_NOTHING', 'state has not changed');

  // pretend there's a pending media request so
  // media isn't selected automatically
  loader.hasPendingRequest = () => true;
  this.standardXHRResponse(this.requests.shift());
  assert.strictEqual(loader.state, 'HAVE_MAIN_MANIFEST', 'state is updated');
  assert.strictEqual(loadedPlaylists, 1, 'one loadedplaylist');
  assert.strictEqual(loadedMetadata, 0, 'no loadedmetadata');
  loader.hasPendingRequest = origHasPendingRequest;

  loader.load();
  assert.strictEqual(loader.started, true, 'still loaded');
  assert.strictEqual(loadedPlaylists, 2, 'two loadedplaylists');
  assert.strictEqual(loadedMetadata, 0, 'no loadedmetadata');
  assert.strictEqual(this.requests.length, 0, 'no request made');
  assert.strictEqual(loader.state, 'HAVE_MAIN_MANIFEST', 'no state change');

  loader.media(loader.main.playlists[0]);
  this.clock.tick(1);
  assert.strictEqual(loadedPlaylists, 3, '3 loadedplaylists');
  assert.strictEqual(loadedMetadata, 1, 'one loadedmetadata');

  loader.load(true);
  assert.strictEqual(loadedPlaylists, 3, 'does not fire 4th loadedplaylist');
  assert.strictEqual(loadedMetadata, 1, 'does not fire 2nd loadedmetadata');

  const loadSpy = sinon.spy(loader, 'load');

  // half of one target duration = 1s
  this.clock.tick(1000);
  assert.strictEqual(loadSpy.callCount, 1, 'load was called again');
});

QUnit.test('load: will not request manifest when started', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);
  const origHasPendingRequest = loader.hasPendingRequest;
  let loadedPlaylists = 0;
  let loadedMetadata = 0;

  loader.on('loadedplaylist', () => {
    loadedPlaylists++;
  });
  loader.on('loadedmetadata', () => {
    loadedMetadata++;
  });

  loader.load();
  // pretend there's a pending media request so
  // media isn't selected automatically
  loader.hasPendingRequest = () => true;
  this.standardXHRResponse(this.requests.shift());
  assert.strictEqual(loader.state, 'HAVE_MAIN_MANIFEST', 'state is updated');
  assert.strictEqual(loadedPlaylists, 1, 'one loadedplaylist');
  assert.strictEqual(loadedMetadata, 0, 'no loadedmetadata');
  loader.hasPendingRequest = origHasPendingRequest;

  loader.load();
  assert.strictEqual(loader.started, true, 'still loaded');
  assert.strictEqual(loadedPlaylists, 2, 'two loadedplaylists');
  assert.strictEqual(loadedMetadata, 0, 'no loadedmetadata');
  assert.strictEqual(this.requests.length, 0, 'no request made');
  assert.strictEqual(loader.state, 'HAVE_MAIN_MANIFEST', 'no state change');
});

QUnit.test('load: will retry if this is the final rendition', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);
  let loadedPlaylists = 0;
  let loadedMetadata = 0;

  loader.on('loadedplaylist', () => {
    loadedPlaylists++;
  });
  loader.on('loadedmetadata', () => {
    loadedMetadata++;
  });
  assert.notOk(loader.started, 'begins unstarted');

  loader.load();
  this.standardXHRResponse(this.requests.shift());
  loader.media(loader.main.playlists[0]);
  this.clock.tick(1);

  assert.strictEqual(loadedPlaylists, 2, 'two loadedplaylists');
  assert.strictEqual(loadedMetadata, 1, 'one loadedmetadata');

  loader.load(true);
  assert.strictEqual(loadedPlaylists, 2, 'does not fire 3rd loadedplaylist');
  assert.strictEqual(loadedMetadata, 1, 'does not fire 2nd loadedmetadata');

  const loadSpy = sinon.spy(loader, 'load');

  // half of one target duration = 1s
  this.clock.tick(1000);
  assert.strictEqual(loadSpy.callCount, 1, 'load was called again');
});

QUnit.test('media: get returns currently active media playlist', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);
  const origHasPendingRequest = loader.hasPendingRequest;

  // setup loader
  loader.load();
  // pretend there's a pending media request so
  // media isn't selected automatically
  loader.hasPendingRequest = () => true;
  this.standardXHRResponse(this.requests.shift());
  assert.strictEqual(loader.state, 'HAVE_MAIN_MANIFEST', 'state should be HAVE_MAIN_MANIFEST');
  assert.strictEqual(loader.media(), undefined, 'no media set yet');
  loader.hasPendingRequest = origHasPendingRequest;

  loader.media(loader.main.playlists[0]);
  this.clock.tick(1);
  assert.strictEqual(
    loader.media().uri,
    loader.main.playlists[0].uri,
    'set the correct media playlist'
  );
});

QUnit.test('media: does not set media if getter is called', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);
  const origHasPendingRequest = loader.hasPendingRequest;
  let loadedPlaylists = 0;
  let loadedMetadata = 0;

  loader.on(['loadedplaylist', 'loadedmetadata'], (e) => {
    if (e.type === 'loadedplaylist') {
      loadedPlaylists++;
    } else if (e.type === 'loadedmetadata') {
      loadedMetadata++;
    }
  });

  loader.load();
  // pretend there's a pending media request so
  // media isn't selected automatically
  loader.hasPendingRequest = () => true;
  this.standardXHRResponse(this.requests.shift());
  assert.strictEqual(loader.state, 'HAVE_MAIN_MANIFEST', 'state should be HAVE_MAIN_MANIFEST');
  assert.strictEqual(loadedPlaylists, 1, 'one loadedplaylist');
  assert.strictEqual(loadedMetadata, 0, 'no loadedmetadata');
  loader.hasPendingRequest = origHasPendingRequest;

  loader.media(null);
  assert.strictEqual(loader.state, 'HAVE_MAIN_MANIFEST', 'state should stay HAVE_MAIN_MANIFEST');
  assert.strictEqual(loadedPlaylists, 1, 'still one loadedplaylist');
  assert.strictEqual(loadedMetadata, 0, 'still no loadedmetadata');

  loader.media(undefined);
  assert.strictEqual(loader.state, 'HAVE_MAIN_MANIFEST', 'state should stay HAVE_MAIN_MANIFEST');
  assert.strictEqual(loadedPlaylists, 1, 'still one loadedplaylist');
  assert.strictEqual(loadedMetadata, 0, 'still no loadedmetadata');
});

QUnit.test('media: errors if called in incorrect state', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);

  assert.strictEqual(loader.state, 'HAVE_NOTHING', 'state should be HAVE_NOTHING');
  assert.throws(
    () => loader.media('0'),
    /Cannot switch media playlist from HAVE_NOTHING/,
    'should throw an error if media is called without a main playlist'
  );
});

QUnit.test('media: setting media causes an asynchronous action', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);
  const origHasPendingRequest = loader.hasPendingRequest;
  let loadedPlaylists = 0;
  let loadedMetadata = 0;

  loader.on(['loadedplaylist', 'loadedmetadata'], (e) => {
    if (e.type === 'loadedplaylist') {
      loadedPlaylists++;
    } else if (e.type === 'loadedmetadata') {
      loadedMetadata++;
    }
  });

  // setup loader
  loader.load();
  // pretend there's a pending media request so
  // media isn't selected automatically
  loader.hasPendingRequest = () => true;
  this.standardXHRResponse(this.requests.shift());
  loader.hasPendingRequest = origHasPendingRequest;

  assert.strictEqual(loader.state, 'HAVE_MAIN_MANIFEST', 'correct state before media call');
  assert.strictEqual(loadedPlaylists, 1, 'one loadedplaylist before media is loaded');
  assert.strictEqual(loadedMetadata, 0, 'no loadedmetadata before media is loaded');
  assert.notOk(loader.hasPendingRequest(), 'no pending asynchronous actions');

  // set initial media
  loader.media(loader.main.playlists[0]);
  assert.ok(loader.hasPendingRequest(), 'has asynchronous action pending');
  assert.strictEqual(loader.state, 'HAVE_MAIN_MANIFEST', 'state is still HAVE_MAIN_MANIFEST');
  assert.strictEqual(loadedPlaylists, 1, 'still one loadedplaylist');
  assert.strictEqual(loadedMetadata, 0, 'still no loadedmetadata');

  // runs any pending async actions
  this.clock.tick(0);
  assert.notOk(loader.hasPendingRequest(), 'no asynchronous action pending');
  assert.strictEqual(loader.state, 'HAVE_METADATA', 'state is now HAVE_METADATA');
  assert.strictEqual(loadedPlaylists, 2, 'two loadedplaylist');
  assert.strictEqual(loadedMetadata, 1, 'one loadedmetadata');
});

QUnit.test('media: sets initial media playlist on main loader', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);
  const origHasPendingRequest = loader.hasPendingRequest;
  let loadedPlaylists = 0;
  let loadedMetadata = 0;

  loader.on(['loadedplaylist', 'loadedmetadata'], (e) => {
    if (e.type === 'loadedplaylist') {
      loadedPlaylists++;
    } else if (e.type === 'loadedmetadata') {
      loadedMetadata++;
    }
  });

  // setup loader
  loader.load();
  // pretend there's a pending media request so
  // media isn't selected automatically
  loader.hasPendingRequest = () => true;
  this.standardXHRResponse(this.requests.shift());
  assert.strictEqual(loader.state, 'HAVE_MAIN_MANIFEST', 'state should be HAVE_MAIN_MANIFEST');
  assert.strictEqual(loadedPlaylists, 1, 'one loadedplaylist');
  assert.strictEqual(loadedMetadata, 0, 'no loadedmetadata');
  loader.hasPendingRequest = origHasPendingRequest;

  // set initial media
  loader.media(loader.main.playlists[0]);
  this.clock.tick(1);
  assert.strictEqual(
    loader.media().uri,
    loader.main.playlists[0].uri,
    'media set correctly'
  );
  assert.deepEqual(
    Object.keys(loader.loadedPlaylists_),
    [loader.main.playlists[0].id],
    'updated the loadedPlaylists_'
  );
  assert.strictEqual(loader.state, 'HAVE_METADATA', 'state should be HAVE_METADATA');
  assert.strictEqual(loadedPlaylists, 2, 'two loadedplaylists');
  assert.strictEqual(loadedMetadata, 1, 'one loadedmetadata');
});

QUnit.test('media: sets a playlist from a string reference', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);
  const origHasPendingRequest = loader.hasPendingRequest;
  let loadedPlaylists = 0;
  let loadedMetadata = 0;

  loader.on(['loadedplaylist', 'loadedmetadata'], (e) => {
    if (e.type === 'loadedplaylist') {
      loadedPlaylists++;
    } else if (e.type === 'loadedmetadata') {
      loadedMetadata++;
    }
  });

  loader.load();
  // pretend there's a pending media request so
  // media isn't selected automatically
  loader.hasPendingRequest = () => true;
  this.standardXHRResponse(this.requests.shift());
  assert.strictEqual(loader.state, 'HAVE_MAIN_MANIFEST', 'state should be HAVE_MAIN_MANIFEST');
  assert.strictEqual(loadedPlaylists, 1, 'one loadedplaylist');
  assert.strictEqual(loadedMetadata, 0, 'no loadedmetadata');
  loader.hasPendingRequest = origHasPendingRequest;

  loader.media('0');
  this.clock.tick(1);
  assert.strictEqual(
    loader.media().uri,
    loader.main.playlists[0].uri,
    'set media correctly'
  );
  assert.deepEqual(
    Object.keys(loader.loadedPlaylists_),
    [loader.main.playlists[0].id],
    'updated the loadedPlaylists_'
  );
  assert.strictEqual(loader.state, 'HAVE_METADATA', 'state should be HAVE_METADATA');
  assert.strictEqual(loadedPlaylists, 2, 'two loadedplaylists');
  assert.strictEqual(loadedMetadata, 1, 'one loadedmetadata');
});

QUnit.test('media: switches to a new playlist from a loaded one', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);
  const origHasPendingRequest = loader.hasPendingRequest;
  let loadedPlaylists = 0;
  let loadedMetadata = 0;
  let mediaChange = 0;
  let mediaChanging = 0;

  loader.on([
    'loadedplaylist',
    'loadedmetadata',
    'mediachange',
    'mediachanging'
  ], (e) => {
    if (e.type === 'loadedplaylist') {
      loadedPlaylists++;
    } else if (e.type === 'loadedmetadata') {
      loadedMetadata++;
    } else if (e.type === 'mediachange') {
      mediaChange++;
    } else if (e.type === 'mediachanging') {
      mediaChanging++;
    }
  });

  loader.load();
  // pretend there's a pending media request so
  // media isn't selected automatically
  loader.hasPendingRequest = () => true;
  this.standardXHRResponse(this.requests.shift());
  assert.strictEqual(loader.state, 'HAVE_MAIN_MANIFEST', 'state should be HAVE_MAIN_MANIFEST');
  assert.strictEqual(loadedPlaylists, 1, 'one loadedplaylist');
  assert.strictEqual(loadedMetadata, 0, 'no loadedmetadata');
  loader.hasPendingRequest = origHasPendingRequest;

  // initial selection
  loader.media(loader.main.playlists[0]);
  this.clock.tick(1);
  assert.strictEqual(loader.state, 'HAVE_METADATA', 'state should be HAVE_METADATA');
  assert.strictEqual(loadedPlaylists, 2, 'two loadedplaylists');
  assert.strictEqual(loadedMetadata, 1, 'one loadedmetadata');
  assert.strictEqual(mediaChange, 0, 'no mediachanges');
  assert.strictEqual(mediaChanging, 0, 'no mediachangings');

  // different selection
  loader.media(loader.main.playlists[1]);
  this.clock.tick(1);
  assert.strictEqual(
    loader.media().uri,
    loader.main.playlists[1].uri,
    'media changed successfully'
  );
  assert.deepEqual(
    Object.keys(loader.loadedPlaylists_),
    [
      loader.main.playlists[0].id,
      loader.main.playlists[1].id
    ],
    'updated loadedPlaylists_'
  );
  assert.strictEqual(loader.state, 'HAVE_METADATA', 'state should be HAVE_METADATA');
  assert.strictEqual(loadedPlaylists, 3, '3 loadedplaylists');
  assert.strictEqual(loadedMetadata, 1, 'one loadedmetadata');
  assert.strictEqual(mediaChange, 1, 'one mediachanges');
  assert.strictEqual(mediaChanging, 1, 'one mediachangings');
});

QUnit.test('media: switches to a previously loaded playlist immediately', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);
  const origHasPendingRequest = loader.hasPendingRequest;
  let loadedPlaylists = 0;
  let loadedMetadata = 0;
  let mediaChange = 0;
  let mediaChanging = 0;

  loader.on([
    'loadedplaylist',
    'loadedmetadata',
    'mediachange',
    'mediachanging'
  ], (e) => {
    if (e.type === 'loadedplaylist') {
      loadedPlaylists++;
    } else if (e.type === 'loadedmetadata') {
      loadedMetadata++;
    } else if (e.type === 'mediachange') {
      mediaChange++;
    } else if (e.type === 'mediachanging') {
      mediaChanging++;
    }
  });

  loader.load();
  // pretend there's a pending media request so
  // media isn't selected automatically
  loader.hasPendingRequest = () => true;
  this.standardXHRResponse(this.requests.shift());
  assert.strictEqual(loader.state, 'HAVE_MAIN_MANIFEST', 'state should be HAVE_MAIN_MANIFEST');
  assert.strictEqual(loadedPlaylists, 1, 'one loadedplaylist');
  assert.strictEqual(loadedMetadata, 0, 'no loadedmetadata');
  loader.hasPendingRequest = origHasPendingRequest;

  // initial selection
  loader.media(loader.main.playlists[0]);
  this.clock.tick(1);
  assert.strictEqual(loader.state, 'HAVE_METADATA', 'state should be HAVE_METADATA');
  assert.strictEqual(loadedPlaylists, 2, 'two loadedplaylists');
  assert.strictEqual(loadedMetadata, 1, 'one loadedmetadata');
  assert.strictEqual(mediaChange, 0, 'no mediachanges');
  assert.strictEqual(mediaChanging, 0, 'no mediachangings');

  // different selection
  loader.media(loader.main.playlists[1]);
  this.clock.tick(1);
  assert.strictEqual(
    loader.media().uri,
    loader.main.playlists[1].uri,
    'switched to new playlist'
  );

  // previous selection
  loader.media(loader.main.playlists[0]);
  // no waiting for async action
  assert.strictEqual(
    loader.media().uri,
    loader.main.playlists[0].uri,
    'correct media set'
  );
  assert.deepEqual(
    Object.keys(loader.loadedPlaylists_),
    [
      loader.main.playlists[0].id,
      loader.main.playlists[1].id
    ],
    'loadedPlaylists_ only updated for new playlists'
  );
  assert.strictEqual(loader.state, 'HAVE_METADATA', 'state should be HAVE_METADATA');
  assert.strictEqual(loadedPlaylists, 3, '3 loadedplaylists');
  assert.strictEqual(
    loadedMetadata, 1,
    'still one loadedmetadata since this is a loadedPlaylist'
  );
  assert.strictEqual(mediaChange, 2, 'two mediachanges');
  assert.strictEqual(mediaChanging, 2, 'two mediachangings');
});

QUnit.test('media: does not switch to same playlist', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);
  const origHasPendingRequest = loader.hasPendingRequest;
  let loadedPlaylists = 0;
  let loadedMetadata = 0;
  let mediaChange = 0;
  let mediaChanging = 0;

  loader.on([
    'loadedplaylist',
    'loadedmetadata',
    'mediachange',
    'mediachanging'
  ], (e) => {
    if (e.type === 'loadedplaylist') {
      loadedPlaylists++;
    } else if (e.type === 'loadedmetadata') {
      loadedMetadata++;
    } else if (e.type === 'mediachange') {
      mediaChange++;
    } else if (e.type === 'mediachanging') {
      mediaChanging++;
    }
  });

  loader.load();
  // pretend there's a pending media request so
  // media isn't selected automatically
  loader.hasPendingRequest = () => true;
  this.standardXHRResponse(this.requests.shift());
  assert.strictEqual(loader.state, 'HAVE_MAIN_MANIFEST', 'state should be HAVE_MAIN_MANIFEST');
  assert.strictEqual(loadedPlaylists, 1, 'one loadedplaylist');
  assert.strictEqual(loadedMetadata, 0, 'no loadedmetadata');
  loader.hasPendingRequest = origHasPendingRequest;

  // initial selection
  loader.media(loader.main.playlists[0]);
  this.clock.tick(1);
  assert.strictEqual(loader.state, 'HAVE_METADATA', 'state should be HAVE_METADATA');
  assert.strictEqual(loadedPlaylists, 2, 'two loadedplaylists');
  assert.strictEqual(loadedMetadata, 1, 'one loadedmetadata');
  assert.strictEqual(mediaChange, 0, 'no mediachanges');
  assert.strictEqual(mediaChanging, 0, 'no mediachangings');

  // to same playlist
  loader.media(loader.main.playlists[0]);
  this.clock.tick(1);
  assert.strictEqual(loader.state, 'HAVE_METADATA', 'state should be HAVE_METADATA');
  assert.strictEqual(loadedPlaylists, 2, 'two loadedplaylists');
  assert.strictEqual(loadedMetadata, 1, 'one loadedmetadata');
  assert.strictEqual(mediaChange, 0, 'no mediachanges');
  assert.strictEqual(mediaChanging, 0, 'no mediachangings');
});

QUnit.test('haveMetadata: triggers loadedplaylist if initial selection', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);
  let loadedPlaylists = 0;
  let loadedMetadata = 0;
  let mediaChanges = 0;
  let mediaChangings = 0;

  loader.load();
  this.standardXHRResponse(this.requests.shift());

  loader.on([
    'loadedplaylist',
    'loadedmetadata',
    'mediachange',
    'mediachanging'
  ], (e) => {
    const type = e.type;

    if (type === 'loadedplaylist') {
      loadedPlaylists++;
    } else if (type === 'loadedmetadata') {
      loadedMetadata++;
    } else if (type === 'mediachange') {
      mediaChanges++;
    } else if (type === 'mediachanging') {
      mediaChangings++;
    }
  });

  loader.haveMetadata({
    startingState: 'HAVE_MAIN_MANIFEST',
    playlist: loader.main.playlists[0]
  });
  assert.strictEqual(loader.state, 'HAVE_METADATA', 'state should advance');
  assert.strictEqual(
    loader.media().uri,
    loader.main.playlists[0].uri,
    'media set correctly'
  );
  assert.deepEqual(
    Object.keys(loader.loadedPlaylists_),
    [loader.main.playlists[0].id],
    'updated loadedPlaylists_'
  );
  assert.strictEqual(loadedPlaylists, 1, 'one loadedplaylists');
  assert.strictEqual(loadedMetadata, 1, 'one loadedmetadata');
  assert.strictEqual(mediaChanges, 0, 'no mediachange');
  assert.strictEqual(mediaChangings, 0, 'no mediachanging');
});

QUnit.test('haveMetadata: triggers mediachange if new selection', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);
  const origHasPendingRequest = loader.hasPendingRequest;
  let loadedPlaylists = 0;
  let loadedMetadata = 0;
  let mediaChanges = 0;
  let mediaChangings = 0;

  loader.load();
  // pretend there's a pending media request so
  // media isn't selected automatically
  loader.hasPendingRequest = () => true;
  this.standardXHRResponse(this.requests.shift());
  loader.media(loader.main.playlists[1]);
  this.clock.tick(1);
  loader.hasPendingRequest = origHasPendingRequest;

  loader.on([
    'loadedplaylist',
    'loadedmetadata',
    'mediachange',
    'mediachanging'
  ], (e) => {
    const type = e.type;

    if (type === 'loadedplaylist') {
      loadedPlaylists++;
    } else if (type === 'loadedmetadata') {
      loadedMetadata++;
    } else if (type === 'mediachange') {
      mediaChanges++;
    } else if (type === 'mediachanging') {
      mediaChangings++;
    }
  });

  loader.haveMetadata({
    startingState: 'HAVE_METADATA',
    playlist: loader.main.playlists[0]
  });
  assert.strictEqual(loader.state, 'HAVE_METADATA', 'state should stay the same');
  assert.strictEqual(
    loader.media().uri,
    loader.main.playlists[0].uri,
    'media set correctly'
  );
  assert.deepEqual(
    Object.keys(loader.loadedPlaylists_),
    [
      loader.main.playlists[1].id,
      loader.main.playlists[0].id
    ],
    'updated loadedPlaylists_'
  );
  assert.strictEqual(loadedPlaylists, 1, 'one loadedplaylists');
  assert.strictEqual(loadedMetadata, 0, 'no loadedmetadata');
  assert.strictEqual(mediaChanges, 1, 'one mediachange');
  assert.strictEqual(mediaChangings, 0, 'no mediachanging');
});

QUnit.test('haveMain: triggers loadedplaylist for loader', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);
  const origMediaFn = loader.media;
  let loadedPlaylists = 0;

  loader.on('loadedplaylist', () => {
    loadedPlaylists++;
  });

  // fake already having main XML loaded
  loader.mainXml_ = testDataManifests.dash;
  loader.haveMain_();
  assert.strictEqual(loadedPlaylists, 1, 'one loadedplaylist triggered');

  loader.media = origMediaFn;
});

QUnit.test('haveMain: sets media on child loader', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);

  loader.load();
  this.standardXHRResponse(this.requests.shift());
  const childPlaylist = loader.main.playlists['0-placeholder-uri-AUDIO-audio-audio'];
  const childLoader = new DashPlaylistLoader(childPlaylist, this.fakeVhs, false, loader);

  const mediaStub = sinon.stub(childLoader, 'media');

  childLoader.haveMain_();
  assert.strictEqual(mediaStub.callCount, 1, 'calls media on childLoader');
  assert.deepEqual(
    mediaStub.getCall(0).args[0],
    childPlaylist,
    'sets media to passed in playlist object'
  );
});

QUnit.test('parseMainXml: setup phony playlists and resolves uris', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);

  loader.load();
  this.standardXHRResponse(this.requests.shift());

  const mainPlaylist = parseMainXml({
    mainXml: loader.mainXml_,
    srcUrl: loader.srcUrl,
    clientOffset: loader.clientOffset_,
    sidxMapping: loader.sidxMapping_
  });

  assert.strictEqual(mainPlaylist.uri, loader.srcUrl, 'main playlist uri set correctly');
  assert.strictEqual(mainPlaylist.playlists[0].uri, 'placeholder-uri-0');
  assert.strictEqual(mainPlaylist.playlists[0].id, '0-placeholder-uri-0');
  assert.deepEqual(
    mainPlaylist.playlists['0-placeholder-uri-0'],
    mainPlaylist.playlists[0],
    'phony id setup correctly for playlist'
  );
  assert.ok(
    Object.keys(mainPlaylist.mediaGroups.AUDIO).length,
    'has audio group'
  );
  assert.ok(mainPlaylist.playlists[0].resolvedUri, 'resolved playlist uris');
});

QUnit.test('parseMainXml: includes sidx info if available and matches playlist', function(assert) {
  const loader = new DashPlaylistLoader('dash-sidx.mpd', this.fakeVhs);

  loader.load();
  this.standardXHRResponse(this.requests.shift());
  const origParsedMain = parseMainXml({
    mainXml: loader.mainXml_,
    srcUrl: loader.srcUrl,
    clientOffset: loader.clientOffset_,
    sidxMapping: loader.sidxMapping_
  });

  loader.sidxMapping_ = {};

  let newParsedMain = parseMainXml({
    mainXml: loader.mainXml_,
    srcUrl: loader.srcUrl,
    clientOffset: loader.clientOffset_,
    sidxMapping: loader.sidxMapping_
  });

  assert.deepEqual(
    newParsedMain,
    origParsedMain,
    'empty sidxMapping will not affect main xml parsing'
  );

  // Allow sidx request to finish
  this.standardXHRResponse(this.requests.shift(), mp4VideoInitSegment().subarray(0, 10));
  this.standardXHRResponse(this.requests.shift());
  const key = generateSidxKey(loader.media().sidx);

  loader.sidxMapping_[key] = {
    sidxInfo: loader.media().sidx,
    sidx: {
      timescale: 90000,
      firstOffset: 0,
      references: [{
        referenceType: 0,
        referencedSize: 10,
        subSegmentDuration: 90000
      }]
    }
  };
  newParsedMain = parseMainXml({
    mainXml: loader.mainXml_,
    srcUrl: loader.srcUrl,
    clientOffset: loader.clientOffset_,
    sidxMapping: loader.sidxMapping_
  });

  assert.deepEqual(
    newParsedMain.playlists[0].segments[0].byterange,
    {
      length: 10,
      offset: 400
    },
    'byte range from sidx is applied to playlist segment'
  );
  assert.deepEqual(
    newParsedMain.playlists[0].segments[0].map.byterange,
    {
      length: 200,
      offset: 0
    },
    'init segment is included in updated segment'
  );
});

QUnit.test('refreshMedia: updates main and media playlists for main loader', function(assert) {
  // start at 4 seconds past epoch for 2x 2 second segments
  this.clock.tick(4 * 1000);
  const loader = new DashPlaylistLoader('dash-live.mpd', this.fakeVhs);
  let loadedPlaylists = 0;
  let playlistUnchanged = 0;

  loader.load();
  this.standardXHRResponse(this.requests.shift());
  loader.media(loader.main.playlists[0]);
  this.clock.tick(1);

  assert.strictEqual(
    loader.media().uri,
    loader.main.playlists[0].uri,
    'initial media set'
  );
  assert.ok(loader.main, 'main playlist set');

  loader.on('loadedplaylist', () => {
    loadedPlaylists++;
  });
  loader.on('playlistunchanged', () => {
    playlistUnchanged++;
  });

  const oldMain = loader.main;

  // Two seconds later in wall clock should mean one more segment added to ensure the
  // refresh represents a change. Although four seconds is the minimumUpdatePeriod, since
  // segments are two seconds in duration, the refreshDelay will be calculated as two
  // seconds.
  this.clock.tick(2 * 1000);

  assert.notEqual(loader.main, oldMain, 'new main set');
  assert.strictEqual(loadedPlaylists, 1, 'one loadedplaylist');
  assert.strictEqual(playlistUnchanged, 0, 'no playlistunchanged');
});

QUnit.test('refreshMedia: triggers playlistunchanged for main loader' +
  ' if main stays the same', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);
  let loadedPlaylists = 0;
  let playlistUnchanged = 0;

  loader.load();
  this.standardXHRResponse(this.requests.shift());
  loader.media(loader.main.playlists[0]);
  this.clock.tick(1);

  assert.strictEqual(
    loader.media().uri,
    loader.main.playlists[0].uri,
    'initial media set'
  );
  assert.ok(loader.main, 'main playlist set');

  loader.on('loadedplaylist', () => {
    loadedPlaylists++;
  });
  loader.on('playlistunchanged', () => {
    playlistUnchanged++;
  });

  const main = loader.main;
  const media = loader.media();

  loader.refreshMedia_(loader.media().id);
  assert.strictEqual(loadedPlaylists, 1, 'one loadedplaylists');
  assert.strictEqual(playlistUnchanged, 1, 'one playlistunchanged');

  const newMain = loader.main;
  const newMedia = loader.media();

  assert.equal(main, newMain, 'main is unchanged');
  assert.equal(media, newMedia, 'media is unchanged');
});

QUnit.test('refreshMedia: updates main and media playlists for child loader', function(assert) {
  // start at 4 seconds past epoch for 2x 2 second segments
  this.clock.tick(4 * 1000);
  const loader = new DashPlaylistLoader('dash-live.mpd', this.fakeVhs);
  let loadedPlaylists = 0;
  let playlistUnchanged = 0;

  loader.load();
  this.standardXHRResponse(this.requests.shift());
  loader.media(loader.main.playlists[0]);
  this.clock.tick(1);
  const childLoader = new DashPlaylistLoader(loader.main.playlists[0], this.fakeVhs, false, loader);

  childLoader.load();
  this.clock.tick(1);

  assert.ok(loader.main, 'main loader has main playlist');
  assert.ok(loader.media_, 'main loader has selected media');
  assert.notOk(childLoader.main, 'childLoader does not have main');
  assert.ok(childLoader.media_, 'childLoader media selected');

  childLoader.on('loadedplaylist', () => {
    loadedPlaylists++;
  });
  childLoader.on('playlistunchanged', () => {
    playlistUnchanged++;
  });

  const oldMain = loader.main;

  // Two seconds later in wall clock should mean one more segment added to ensure the
  // refresh represents a change. Although four seconds is the minimumUpdatePeriod, since
  // segments are two seconds in duration, the refreshDelay will be calculated as two
  // seconds.
  this.clock.tick(2 * 1000);

  assert.notEqual(loader.main, oldMain, 'new main set on main loader');
  assert.strictEqual(loadedPlaylists, 1, 'one loadedplaylist');
  assert.strictEqual(playlistUnchanged, 0, 'no playlistunchanged');
});

QUnit.test('refreshMedia: triggers playlistunchanged for child loader' +
  ' if main stays the same', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);
  let loadedPlaylists = 0;
  let playlistUnchanged = 0;

  loader.load();
  this.standardXHRResponse(this.requests.shift());
  loader.media(loader.main.playlists[0]);
  this.clock.tick(1);
  const childLoader = new DashPlaylistLoader(loader.main.playlists[0], this.fakeVhs, false, loader);

  childLoader.load();
  this.clock.tick(1);

  assert.ok(loader.main, 'main loader has main playlist');
  assert.ok(loader.media_, 'main loader has selected media');
  assert.notOk(childLoader.main, 'childLoader does not have main');
  assert.ok(childLoader.media_, 'childLoader media selected');

  childLoader.on('loadedplaylist', () => {
    loadedPlaylists++;
  });
  childLoader.on('playlistunchanged', () => {
    playlistUnchanged++;
  });

  childLoader.refreshMedia_(loader.media().id);

  assert.strictEqual(loadedPlaylists, 1, 'one loadedplaylist');
  assert.strictEqual(playlistUnchanged, 1, 'one playlistunchanged');
});

QUnit.test('refreshXml_: re-requests the MPD', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);

  assert.strictEqual(this.requests.length, 0, 'no requests');
  loader.refreshXml_();
  assert.strictEqual(this.requests.length, 1, 'made a request');
  const spy = sinon.spy(loader, 'refreshXml_');

  loader.trigger('minimumUpdatePeriod');
  assert.strictEqual(this.requests.length, 2, 'minimumUpdatePeriod event make a request');
  assert.strictEqual(spy.callCount, 1, 'refreshXml_ was called due to minimumUpdatePeriod event');
});

QUnit.test('refreshXml_: requests the sidx if it changed', function(assert) {
  const loader = new DashPlaylistLoader('dash-sidx.mpd', this.fakeVhs);

  loader.load();
  // initial manifest
  this.standardXHRResponse(this.requests.shift());
  assert.strictEqual(this.requests.length, 1, 'made a sidx request');

  const oldMain = parseMainXml({
    mainXml: loader.mainXml_,
    srcUrl: loader.srcUrl,
    clientOffset: loader.clientOffset_,
    sidxMapping: loader.sidxMapping_
  });
  const newMainXml = loader.mainXml_.replace(/(indexRange)=\"\d+-\d+\"/g, '$1="400-599"');

  loader.mainXml_ = newMainXml;
  assert.deepEqual(
    oldMain.playlists[0].sidx.byterange, {
      offset: 200,
      length: 200
    },
    'sidx is the original in the xml'
  );
  let newMain = parseMainXml({
    mainXml: loader.mainXml_,
    srcUrl: loader.srcUrl,
    clientOffset: loader.clientOffset_,
    sidxMapping: loader.sidxMapping_
  });

  assert.notEqual(
    newMain.playlists[0].sidx.byterange.offset,
    oldMain.playlists[0].sidx.byterange.offset,
    'the sidx has been changed'
  );
  loader.refreshXml_();

  assert.strictEqual(this.requests.length, 2, 'manifest is being requested');
  newMain = parseMainXml({
    mainXml: loader.mainXml_,
    srcUrl: loader.srcUrl,
    clientOffset: loader.clientOffset_,
    sidxMapping: loader.sidxMapping_
  });
  assert.deepEqual(
    newMain.playlists[0].sidx.byterange,
    {
      offset: 400,
      length: 200
    },
    'the sidx byterange has changed to reflect the new manifest'
  );
});

QUnit.test('refreshXml_: updates media playlist reference if main changed', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);

  loader.load();
  this.standardXHRResponse(this.requests.shift());

  const oldMain = loader.main;
  const oldMedia = loader.media();
  const newMainXml = loader.mainXml_.replace(
    'mediaPresentationDuration="PT4S"',
    'mediaPresentationDuration="PT5S"'
  );

  loader.refreshXml_();

  assert.strictEqual(this.requests.length, 1, 'manifest is being requested');

  this.requests.shift().respond(200, null, newMainXml);

  const newMain = loader.main;
  const newMedia = loader.media();

  assert.notEqual(newMain, oldMain, 'main changed');
  assert.notEqual(newMedia, oldMedia, 'media changed');
  assert.equal(
    newMedia,
    newMain.playlists[newMedia.id],
    'media from updated main'
  );
});

QUnit.test('refreshXml_: updates playlists if segment uri changed, but media sequence did not', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);

  loader.load();
  this.standardXHRResponse(this.requests.shift());

  const oldMain = loader.main;
  const oldMedia = loader.media();

  // change segment uris
  const newMainXml = loader.mainXml_
    .replace(/\$RepresentationID\$/g, '$RepresentationID$-foo')
    .replace('media="segment-$Number$.mp4"', 'media="segment-foo$Number$.mp4"');

  loader.refreshXml_();

  assert.strictEqual(this.requests.length, 1, 'manifest is being requested');

  this.requests.shift().respond(200, null, newMainXml);

  const newMain = loader.main;
  const newMedia = loader.media();

  assert.notEqual(newMain, oldMain, 'main changed');
  assert.notEqual(newMedia, oldMedia, 'media changed');
  assert.equal(
    newMedia,
    newMain.playlists[newMedia.id],
    'media from updated main'
  );
});

// As of this writing, live SIDX where the SIDX value changes is not supported
// Also note that the test uses a VOD SIDX playlist that is refreshed with a live one
QUnit.skip('refreshXml_: updates playlists if sidx changed', function(assert) {
  const loader = new DashPlaylistLoader('dash-sidx.mpd', this.fakeVhs);

  loader.load();
  this.standardXHRResponse(this.requests.shift());
  this.standardXHRResponse(this.requests.shift(), mp4VideoInitSegment().subarray(0, 10));
  this.standardXHRResponse(this.requests.shift(), sidxResponse());

  const oldMain = loader.main;
  const oldMedia = loader.media();

  const newMainXml = loader.mainXml_
    .replace(/indexRange="200-399"/g, 'indexRange="500-699"');

  loader.refreshXml_();

  assert.strictEqual(this.requests.length, 1, 'manifest is being requested');

  this.standardXHRResponse(this.requests.shift(), newMainXml);

  const newMain = loader.main;
  const newMedia = loader.media();

  assert.notEqual(newMain, oldMain, 'main changed');
  assert.notEqual(newMedia, oldMedia, 'media changed');
  assert.equal(
    newMedia,
    newMain.playlists[newMedia.id],
    'media from updated main'
  );
});

QUnit.test('refreshXml_: updates playlists if sidx removed', function(assert) {
  const loader = new DashPlaylistLoader('dash-sidx.mpd', this.fakeVhs);

  loader.load();
  this.standardXHRResponse(this.requests.shift());
  this.standardXHRResponse(this.requests.shift(), mp4VideoInitSegment().subarray(0, 10));
  this.standardXHRResponse(this.requests.shift(), sidxResponse());

  const oldMain = loader.main;
  const oldMedia = loader.media();

  const newMainXml = loader.mainXml_
    .replace(/indexRange="200-399"/g, '');

  loader.refreshXml_();

  assert.strictEqual(this.requests.length, 1, 'manifest is being requested');

  this.standardXHRResponse(this.requests.shift(), newMainXml);

  const newMain = loader.main;
  const newMedia = loader.media();

  assert.notEqual(newMain, oldMain, 'main changed');
  assert.notEqual(newMedia, oldMedia, 'media changed');
  assert.equal(
    newMedia,
    newMain.playlists[newMedia.id],
    'media from updated main'
  );
});

QUnit.test('refreshXml_: updates playlists if only segment byteranges change', function(assert) {
  const loader = new DashPlaylistLoader('dashByterange.mpd', this.fakeVhs);

  loader.load();
  this.standardXHRResponse(this.requests.shift());

  const oldMain = loader.main;
  const oldMedia = loader.media();

  const newMainXml = loader.mainXml_
    .replace('mediaRange="12883295-13124492"', 'mediaRange="12883296-13124492"');

  loader.refreshXml_();

  assert.strictEqual(this.requests.length, 1, 'manifest is being requested');

  this.standardXHRResponse(this.requests.shift(), newMainXml);

  const newMain = loader.main;
  const newMedia = loader.media();

  assert.notEqual(newMain, oldMain, 'main changed');
  assert.notEqual(newMedia, oldMedia, 'media changed');
  assert.equal(
    newMedia,
    newMain.playlists[newMedia.id],
    'media from updated main'
  );
});

QUnit.test('refreshXml_: updates playlists if sidx removed', function(assert) {
  const loader = new DashPlaylistLoader('dash-sidx.mpd', this.fakeVhs);

  loader.load();
  this.standardXHRResponse(this.requests.shift());
  this.standardXHRResponse(this.requests.shift(), mp4VideoInitSegment().subarray(0, 10));
  this.standardXHRResponse(this.requests.shift(), sidxResponse());

  const oldMain = loader.main;
  const oldMedia = loader.media();

  const newMainXml = loader.mainXml_
    .replace(/indexRange="200-399"/g, '');

  loader.refreshXml_();

  assert.strictEqual(this.requests.length, 1, 'manifest is being requested');

  this.standardXHRResponse(this.requests.shift(), newMainXml);

  const newMain = loader.main;
  const newMedia = loader.media();

  assert.notEqual(newMain, oldMain, 'main changed');
  assert.notEqual(newMedia, oldMedia, 'media changed');
  assert.equal(
    newMedia,
    newMain.playlists[newMedia.id],
    'media from updated main'
  );
});

QUnit.test('addSidxSegments_: updates main with sidx information', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);
  const sidxData = sidxResponse();
  const fakePlaylist = {
    segments: [],
    id: 'fakeplaylist',
    uri: 'fakeplaylist',
    sidx: {
      uri: 'sidx.mp4',
      byterange: {
        offset: 0,
        length: sidxData.byteLength
      },
      duration: 1024,
      resolvedUri: 'sidx.mp4'
    }
  };

  loader.mainPlaylistLoader_.main = {
    playlists: {
      0: fakePlaylist,
      fakeplaylist: fakePlaylist
    }
  };
  const stubDone = sinon.stub();
  const sidxMapping = loader.mainPlaylistLoader_.sidxMapping_;

  assert.deepEqual(sidxMapping, {}, 'no sidx mapping');
  loader.addSidxSegments_(fakePlaylist, 'HAVE_MAIN_MANIFEST', stubDone);

  this.standardXHRResponse(this.requests.shift(), mp4VideoInitSegment().subarray(0, 10));
  this.standardXHRResponse(this.requests.shift(), sidxData);

  assert.strictEqual(stubDone.callCount, 1, 'callback was called');
  assert.ok(stubDone.getCall(0).args[0], 'sidx segments were added');
  assert.ok(fakePlaylist.segments.length, 'added a parsed sidx segment to playlist');

  assert.deepEqual(
    sidxMapping['sidx.mp4-0-43'].sidx.references[0].referencedSize,
    13001,
    'sidx box returned has been parsed'
  );
});

QUnit.test('addSidxSegments_: errors if request for sidx fails', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);
  const fakePlaylist = {
    segments: [{
      uri: 'fake-segment',
      duration: 15360
    }],
    id: 'fakeplaylist',
    uri: 'fakeplaylist',
    sidx: {
      byterange: {
        offset: 0,
        length: sidxResponse().byteLength
      },
      resolvedUri: 'sidx.mp4'
    }
  };
  const stubDone = sinon.stub();
  const sidxMapping = loader.mainPlaylistLoader_.sidxMapping_;
  let errors = 0;

  assert.deepEqual(sidxMapping, {}, 'no sidx mapping');
  loader.addSidxSegments_(fakePlaylist, 'HAVE_MAIN_MANIFEST', stubDone);

  loader.on('error', () => {
    errors++;
  });

  this.requests.shift().respond(500, null, 'bad request');

  assert.strictEqual(loader.state, 'HAVE_MAIN_MANIFEST', 'state is returned to state passed in');
  assert.deepEqual(
    loader.error,
    {
      status: 500,
      message: 'DASH request error at URL: sidx.mp4',
      response: '',
      code: 2
    },
    'error object is filled out correctly'
  );
  assert.strictEqual(errors, 1, 'triggered an error event');
});

QUnit.test('hasPendingRequest: returns true if async code is running in main loader', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);

  assert.notOk(loader.hasPendingRequest(), 'no requests on construction');

  loader.load();
  assert.ok(loader.hasPendingRequest(), 'should make a request after loading');
  assert.ok(loader.request, 'xhr request is being made');

  this.standardXHRResponse(this.requests.shift());
  assert.notOk(loader.hasPendingRequest(), 'no pending request before setting media');

  loader.media(loader.main.playlists[1]);
  assert.ok(loader.hasPendingRequest(), 'pending request while loading media playlist');
  assert.ok(loader.mediaRequest_, 'media request is being made');
  assert.notOk(loader.request, 'xhr request is not being made');

  this.clock.tick(1);
  assert.ok(loader.state, 'HAVE_METADATA', 'in HAVE_METADATA state once media is loaded');
  assert.notOk(loader.hasPendingRequest(), 'no pending request once media is loaded');
});

QUnit.test('hasPendingRequest: returns true if async code is running in child loader', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);

  loader.load();
  this.standardXHRResponse(this.requests.shift());
  const childPlaylist = loader.main.playlists['0-placeholder-uri-AUDIO-audio-audio'];
  const childLoader = new DashPlaylistLoader(childPlaylist, this.fakeVhs, false, loader);

  assert.notOk(childLoader.hasPendingRequest(), 'no pending requests on construction');

  childLoader.load();
  assert.ok(childLoader.hasPendingRequest(), 'pending request while loading main playlist');
  assert.ok(childLoader.mediaRequest_, 'media request is being made');
  assert.notOk(childLoader.request, 'xhr request is not being made');

  // this starts a request for the media playlist
  childLoader.haveMain_();
  assert.ok(childLoader.hasPendingRequest(), 'pending request while loading media playlist');
  assert.ok(childLoader.mediaRequest_, 'media request is being made');
  assert.notOk(childLoader.request, 'xhr request is not being made');

  childLoader.haveMetadata({
    startingState: 'HAVE_MAIN_MANIFEST',
    playlist: childLoader.childPlaylist_
  });
  assert.strictEqual(childLoader.state, 'HAVE_METADATA', 'state is in HAVE_METADATA');
  assert.notOk(childLoader.hasPendingRequest(), 'no pending requests once media is loaded');
});

QUnit.module('DASH Playlist Loader: functional', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.clock = this.env.clock;
    this.requests = this.env.requests;
    this.fakeVhs = {
      xhr: xhrFactory()
    };
    this.standardXHRResponse = (request, data) => {
      standardXHRResponse(request, data);

      // Because SegmentLoader#fillBuffer_ is now scheduled asynchronously
      // we have to use clock.tick to get the expected side effects of
      // SegmentLoader#handleUpdateEnd_
      this.clock.tick(1);
    };
  },
  afterEach() {
    this.env.restore();
  }
});

QUnit.test('requests the manifest immediately when given a URL', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);

  loader.load();
  assert.equal(this.requests.length, 1, 'made a request');
  assert.equal(this.requests[0].url, 'dash.mpd', 'requested the manifest');
});

QUnit.test('redirect manifest request', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs, {});

  loader.load();

  const modifiedRequest = this.requests.shift();

  modifiedRequest.responseURL = 'http://differenturi.com/test.mpd';

  this.standardXHRResponse(modifiedRequest);

  assert.equal(loader.srcUrl, 'http://differenturi.com/test.mpd', 'url has redirected');
});

QUnit.test('redirect src request', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs, {});

  loader.load();

  const modifiedRequest = this.requests.shift();

  modifiedRequest.responseURL = 'http://differenturi.com/test.mpd';
  this.standardXHRResponse(modifiedRequest);

  const childLoader = new DashPlaylistLoader(loader.main.playlists['0-placeholder-uri-0'], this.fakeVhs, false, loader);

  childLoader.load();
  this.clock.tick(1);

  assert.equal(childLoader.media_.resolvedUri, 'http://differenturi.com/placeholder-uri-0', 'url has redirected');
});

QUnit.test('starts without any metadata', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);

  assert.notOk(loader.started, 'not started');

  loader.load();
  assert.equal(loader.state, 'HAVE_NOTHING', 'no metadata has loaded yet');
  assert.ok(loader.started, 'started');
});

QUnit.test('moves to HAVE_MAIN_MANIFEST after loading a main playlist', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);
  const origHasPendingRequest = loader.hasPendingRequest;

  loader.load();
  assert.strictEqual(loader.state, 'HAVE_NOTHING', 'the state at loadedplaylist correct');

  // pretend there's a pending media request so
  // media isn't selected automatically
  loader.hasPendingRequest = () => true;
  this.standardXHRResponse(this.requests.shift());
  assert.ok(loader.main, 'the main playlist is available');
  assert.strictEqual(loader.state, 'HAVE_MAIN_MANIFEST', 'the state at loadedplaylist correct');
  loader.hasPendingRequest = origHasPendingRequest;
});

QUnit.test('moves to HAVE_METADATA after loading a media playlist', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);
  const origHasPendingRequest = loader.hasPendingRequest;
  let loadedPlaylist = 0;
  let loadedMetadata = 0;

  loader.on('loadedplaylist', function() {
    loadedPlaylist++;
  });
  loader.on('loadedmetadata', function() {
    loadedMetadata++;
  });

  loader.load();
  assert.strictEqual(loadedPlaylist, 0, 'loadedplaylist not fired');
  assert.strictEqual(loadedMetadata, 0, 'loadedmetadata not fired');

  // pretend there's a pending media request so
  // media isn't selected automatically
  loader.hasPendingRequest = () => true;
  this.standardXHRResponse(this.requests.shift());
  assert.strictEqual(loadedPlaylist, 1, 'fired loadedplaylist once');
  assert.strictEqual(loadedMetadata, 0, 'fired loadedmetadata once');
  assert.strictEqual(
    loader.state, 'HAVE_MAIN_MANIFEST',
    'the loader state is correct before setting the media'
  );
  assert.ok(loader.main, 'sets the main playlist');
  assert.strictEqual(this.requests.length, 0, 'no further requests are needed');
  loader.hasPendingRequest = origHasPendingRequest;

  // Initial media selection happens here as a result of calling load
  // and receiving the main xml
  loader.media(loader.main.playlists[0]);
  this.clock.tick(1);

  assert.strictEqual(loader.state, 'HAVE_METADATA', 'the loader state is correct');
  assert.strictEqual(loadedPlaylist, 2, 'fired loadedplaylist twice');
  assert.strictEqual(loadedMetadata, 1, 'fired loadedmetadata once');
  assert.ok(loader.media(), 'sets the media playlist');
});

QUnit.test('child loader moves to HAVE_METADATA when initialized with a main playlist', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);
  let loadedPlaylist = 0;
  let loadedMetadata = 0;

  loader.load();
  this.standardXHRResponse(this.requests.shift());
  const playlist = loader.main.playlists['0-placeholder-uri-AUDIO-audio-audio'];
  const childLoader = new DashPlaylistLoader(playlist, this.fakeVhs, false, loader);

  childLoader.on('loadedplaylist', function() {
    loadedPlaylist++;
  });
  childLoader.on('loadedmetadata', function() {
    loadedMetadata++;
  });

  assert.strictEqual(loadedPlaylist, 0, 'childLoader creation does not fire loadedplaylist');
  assert.strictEqual(loadedMetadata, 0, 'childLoader creation should not fire loadedmetadata');
  assert.strictEqual(childLoader.state, 'HAVE_NOTHING', 'childLoader state is HAVE_NOTHING before load');
  assert.strictEqual(childLoader.media(), undefined, 'childLoader media not yet set');

  childLoader.load();
  this.clock.tick(1);

  assert.strictEqual(childLoader.started, true, 'childLoader has started');
  assert.strictEqual(childLoader.state, 'HAVE_METADATA', 'childLoader state is correct');
  assert.strictEqual(loadedPlaylist, 1, 'triggered loadedplaylist');
  assert.strictEqual(loadedMetadata, 1, 'triggered loadedmetadata');
  assert.ok(childLoader.media(), 'sets the childLoader media playlist');
  assert.ok(childLoader.media().attributes, 'sets the childLoader media attributes');
});

QUnit.test('child playlist moves to HAVE_METADATA when initialized with a live main playlist', function(assert) {
  const loader = new DashPlaylistLoader('dash-live.mpd', this.fakeVhs);
  let loadedPlaylist = 0;
  let loadedMetadata = 0;

  loader.load();
  this.standardXHRResponse(this.requests.shift());
  const playlist = loader.main.playlists['0-placeholder-uri-AUDIO-audio-audio'];
  const childLoader = new DashPlaylistLoader(playlist, this.fakeVhs, false, loader);

  childLoader.on('loadedplaylist', function() {
    loadedPlaylist++;
  });
  childLoader.on('loadedmetadata', function() {
    loadedMetadata++;
  });

  assert.strictEqual(loadedPlaylist, 0, 'childLoader creation does not fire loadedplaylist');
  assert.strictEqual(loadedMetadata, 0, 'childLoader creation should not fire loadedmetadata');
  assert.strictEqual(childLoader.state, 'HAVE_NOTHING', 'childLoader state is HAVE_NOTHING before load');
  assert.strictEqual(childLoader.media(), undefined, 'childLoader media not yet set');

  childLoader.load();
  this.clock.tick(1);

  assert.strictEqual(childLoader.started, true, 'childLoader has started');
  assert.strictEqual(childLoader.state, 'HAVE_METADATA', 'childLoader state is correct');
  assert.strictEqual(loadedPlaylist, 1, 'triggered loadedplaylist');
  assert.strictEqual(loadedMetadata, 1, 'triggered loadedmetadata');
  assert.ok(childLoader.media(), 'sets the childLoader media playlist');
  assert.ok(childLoader.media().attributes, 'sets the childLoader media attributes');
});

QUnit.test('returns to HAVE_METADATA after refreshing the playlist', function(assert) {
  // start at 4 seconds past epoch for 2x 2 second segments
  this.clock.tick(4 * 1000);
  const loader = new DashPlaylistLoader('dash-live.mpd', this.fakeVhs);

  loader.load();
  this.standardXHRResponse(this.requests.shift());

  loader.media(loader.main.playlists[0]);
  this.clock.tick(1);

  // 2s, one segment duration
  this.clock.tick(2 * 1000);
  assert.strictEqual(loader.state, 'HAVE_METADATA', 'the state is correct');
});

QUnit.test('triggers an event when the active media changes', function(assert) {
  // NOTE: this test relies upon calls to media behaving as though they are
  // asynchronous operations.
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);
  const origHasPendingRequest = loader.hasPendingRequest;
  let mediaChanges = 0;
  let mediaChangings = 0;
  let loadedPlaylists = 0;
  let loadedMetadata = 0;

  loader.on('mediachange', () => {
    mediaChanges++;
  });
  loader.on('mediachanging', () => {
    mediaChangings++;
  });
  loader.on('loadedplaylist', () => {
    loadedPlaylists++;
  });
  loader.on('loadedmetadata', () => {
    loadedMetadata++;
  });

  loader.load();
  // pretend there's a pending media request so
  // media isn't selected automatically
  loader.hasPendingRequest = () => true;
  this.standardXHRResponse(this.requests.shift());
  assert.strictEqual(loadedPlaylists, 1, 'loadedplaylist triggered');
  assert.strictEqual(loadedMetadata, 0, 'no loadedmetadata');
  loader.hasPendingRequest = origHasPendingRequest;

  loader.media(loader.main.playlists[0]);
  this.clock.tick(1);
  assert.strictEqual(mediaChangings, 0, 'initial selection is not a media changing');
  assert.strictEqual(mediaChanges, 0, 'initial selection is not a media change');
  assert.strictEqual(loadedPlaylists, 2, 'loadedplaylist triggered twice');
  assert.strictEqual(loadedMetadata, 1, 'loadedmetadata triggered');

  // switching to a different playlist
  loader.media(loader.main.playlists[1]);
  this.clock.tick(1);
  assert.strictEqual(mediaChangings, 1, 'mediachanging fires immediately');
  // Note: does not match PlaylistLoader behavior
  assert.strictEqual(mediaChanges, 1, 'mediachange fires immediately');
  assert.strictEqual(loadedPlaylists, 3, 'three loadedplaylists');
  assert.strictEqual(loadedMetadata, 1, 'still one loadedmetadata');

  // switch back to an already loaded playlist
  loader.media(loader.main.playlists[0]);
  this.clock.tick(1);
  assert.strictEqual(mediaChangings, 2, 'mediachanging fires');
  assert.strictEqual(mediaChanges, 2, 'fired a mediachange');
  assert.strictEqual(loadedPlaylists, 3, 'still three loadedplaylists');
  assert.strictEqual(loadedMetadata, 1, 'still one loadedmetadata');

  // trigger a no-op switch
  loader.media(loader.main.playlists[0]);
  this.clock.tick(1);
  assert.strictEqual(mediaChangings, 2, 'mediachanging ignored the no-op');
  assert.strictEqual(mediaChanges, 2, 'ignored a no-op media change');
  assert.strictEqual(loadedPlaylists, 3, 'still three loadedplaylists');
  assert.strictEqual(loadedMetadata, 1, 'still one loadedmetadata');
});

QUnit.test('throws an error when initial manifest request fails', function(assert) {
  const errors = [];
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);

  loader.load();
  this.clock.tick(1);

  loader.on('error', function() {
    errors.push(loader.error);
  });
  this.requests.pop().respond(500);

  assert.equal(errors.length, 1, 'threw an error');
  assert.equal(errors[0].status, 500, 'captured http status');
});

QUnit.test('throws an error if a media switch is initiated too early', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);

  loader.load();
  this.clock.tick(1);

  assert.throws(
    function() {
      loader.media('1080p');
    },
    new Error('Cannot switch media playlist from HAVE_NOTHING'),
    'threw an error from HAVE_NOTHING'
  );
});

QUnit.test(
  'throws an error if a switch to an unrecognized playlist is requested',
  function(assert) {
    const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);

    loader.load();
    this.standardXHRResponse(this.requests.shift());

    assert.throws(function() {
      loader.media('unrecognized');
    }, new Error('Unknown playlist URI: unrecognized'), 'throws an error');
  }
);

QUnit.test('can switch playlists after the main is downloaded', function(assert) {
  const clock = this.clock;
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);

  loader.load();

  this.standardXHRResponse(this.requests.shift());
  loader.media('0-placeholder-uri-0');
  clock.tick(1);

  assert.equal(loader.media().uri, 'placeholder-uri-0', 'changed to new playlist');
  loader.media('1-placeholder-uri-1');
  clock.tick(1);
  assert.equal(loader.media().uri, 'placeholder-uri-1', 'changed to new playlist');
});

QUnit.test('can switch playlists based on object or URI', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);

  loader.load();
  this.standardXHRResponse(this.requests.shift());

  loader.media('0-placeholder-uri-0');
  this.clock.tick(1);
  assert.equal(loader.media().uri, 'placeholder-uri-0', 'changed to playlist by uri');

  loader.media('1-placeholder-uri-1');
  this.clock.tick(1);
  assert.equal(loader.media().uri, 'placeholder-uri-1', 'changed to playlist by uri');

  loader.media(loader.main.playlists[0]);
  this.clock.tick(1);
  assert.equal(loader.media().uri, 'placeholder-uri-0', 'changed to playlist by object');
});

QUnit.test('errors if requests take longer than 45s', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);
  let errors = 0;

  loader.load();
  this.clock.tick(1);

  loader.on('error', function() {
    errors++;
  });
  this.clock.tick(45 * 1000);

  assert.strictEqual(errors, 1, 'fired one error');
  assert.strictEqual(loader.error.code, 2, 'fired a network error');
});

QUnit.test(
  'parseMainXml parses main manifest and sets up uri references',
  function(assert) {
    const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);

    loader.load();

    this.standardXHRResponse(this.requests.shift());

    assert.equal(
      loader.main.playlists[0].uri, 'placeholder-uri-0',
      'setup phony uri for media playlist'
    );
    assert.equal(
      loader.main.playlists[0].id, '0-placeholder-uri-0',
      'setup phony id for media playlist'
    );
    assert.strictEqual(
      loader.main.playlists['0-placeholder-uri-0'],
      loader.main.playlists[0], 'set reference by uri for easy access'
    );
    assert.equal(
      loader.main.playlists[1].uri, 'placeholder-uri-1',
      'setup phony uri for media playlist'
    );
    assert.equal(
      loader.main.playlists[1].id, '1-placeholder-uri-1',
      'setup phony id for media playlist'
    );
    assert.strictEqual(
      loader.main.playlists['1-placeholder-uri-1'],
      loader.main.playlists[1], 'set reference by uri for easy access'
    );
    assert.equal(
      loader.main.mediaGroups.AUDIO.audio.main.playlists[0].uri,
      'placeholder-uri-AUDIO-audio-audio', 'setup phony uri for media groups'
    );
    assert.equal(
      loader.main.mediaGroups.AUDIO.audio.main.playlists[0].id,
      '0-placeholder-uri-AUDIO-audio-audio', 'setup phony id for media groups'
    );
    assert.strictEqual(
      loader.main.playlists['0-placeholder-uri-AUDIO-audio-audio'],
      loader.main.mediaGroups.AUDIO.audio.main.playlists[0],
      'set reference by uri for easy access'
    );
  }
);

QUnit.test('use MPD.Location when refreshing the xml', function(assert) {
  const loader = new DashPlaylistLoader('location.mpd', this.fakeVhs);

  loader.load();
  this.standardXHRResponse(this.requests.shift());

  this.clock.tick(4 * 1000);

  assert.equal(this.requests.length, 1, 'refreshed manifest');
  assert.equal(this.requests[0].uri, 'newlocation/', 'refreshed manifest');
});

QUnit.test('refreshes the xml if there is a minimumUpdatePeriod', function(assert) {
  // start at 4 seconds past epoch for 2x 2 second segments
  this.clock.tick(4 * 1000);
  const loader = new DashPlaylistLoader('dash-live.mpd', this.fakeVhs);
  let minimumUpdatePeriods = 0;

  loader.on('minimumUpdatePeriod', () => minimumUpdatePeriods++);

  loader.load();
  assert.equal(minimumUpdatePeriods, 0, 'no refreshes to start');

  this.standardXHRResponse(this.requests.shift());
  assert.equal(minimumUpdatePeriods, 0, 'no refreshes immediately after response');

  this.clock.tick(4 * 1000);

  assert.equal(this.requests.length, 1, 'refreshed manifest');
  assert.equal(this.requests[0].uri, window.location.href.split('/').slice(0, -1).join('/') + '/dash-live.mpd', 'refreshed manifest');
  assert.equal(minimumUpdatePeriods, 1, 'refreshed manifest');
});

QUnit.test('stop xml refresh if minimumUpdatePeriod is removed', function(assert) {
  // start at 4 seconds past epoch for 2x 2 second segments
  this.clock.tick(4 * 1000);
  const loader = new DashPlaylistLoader('dash-live.mpd', this.fakeVhs);
  let minimumUpdatePeriods = 0;

  loader.on('minimumUpdatePeriod', () => minimumUpdatePeriods++);

  loader.load();

  // Start Request
  assert.equal(minimumUpdatePeriods, 0, 'no refreshes to start');
  this.standardXHRResponse(this.requests.shift());
  assert.equal(minimumUpdatePeriods, 0, 'no refreshes immediately after response');

  // First Refresh Tick: MPD loaded
  this.clock.tick(4 * 1000);
  assert.equal(this.requests.length, 1, 'refreshed manifest');
  assert.equal(this.requests[0].uri, window.location.href.split('/').slice(0, -1).join('/') + '/dash-live.mpd', 'refreshed manifest');
  assert.equal(minimumUpdatePeriods, 1, 'total minimumUpdatePeriods');

  this.standardXHRResponse(this.requests[0], loader.mainXml_.replace('minimumUpdatePeriod="PT4S"', ''));

  // Second Refresh Tick: MUP removed
  this.clock.tick(4 * 1000);
  assert.equal(this.requests.length, 1, 'no more manifest refreshes');
  assert.equal(minimumUpdatePeriods, 1, 'no more minimumUpdatePeriods');
});

QUnit.test('continue xml refresh every targetDuration if minimumUpdatePeriod is 0', function(assert) {
  // start at 4 seconds past epoch for 2x 2 second segments
  this.clock.tick(4 * 1000);
  const loader = new DashPlaylistLoader('dash-live.mpd', this.fakeVhs);
  let minimumUpdatePeriods = 0;

  loader.on('minimumUpdatePeriod', () => minimumUpdatePeriods++);

  loader.load();

  // Start Request
  assert.equal(minimumUpdatePeriods, 0, 'no refreshes to start');
  this.standardXHRResponse(this.requests.shift());
  assert.equal(minimumUpdatePeriods, 0, 'no refreshes immediately after response');

  // First Refresh Tick
  this.clock.tick(4 * 1000);
  assert.equal(this.requests.length, 1, 'refreshed manifest');
  assert.equal(this.requests[0].uri, window.location.href.split('/').slice(0, -1).join('/') + '/dash-live.mpd', 'refreshed manifest');
  assert.equal(minimumUpdatePeriods, 1, 'total minimumUpdatePeriods');

  this.standardXHRResponse(this.requests[0], loader.mainXml_.replace('minimumUpdatePeriod="PT4S"', 'minimumUpdatePeriod="PT0S"'));

  // Second Refresh Tick: MinimumUpdatePeriod set to 0
  // The manifest should refresh after one target duration, in this case 2 seconds. At this point
  // it should not have occurred.
  this.clock.tick(1 * 1000);
  assert.equal(this.requests.length, 1, 'no 3rd manifest refresh yet');
  assert.equal(minimumUpdatePeriods, 1, 'no 3rd minimumUpdatePeriod yet');

  // Now the refresh should happen
  this.clock.tick(1 * 1000);
  assert.equal(this.requests.length, 2, '3rd manifest refresh after targetDuration');
  assert.equal(minimumUpdatePeriods, 2, '3rd minimumUpdatePeriod after targetDuration');
});

QUnit.test('delays load when on final rendition', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);
  const origHasPendingRequest = loader.hasPendingRequest;
  let loadedplaylistEvents = 0;

  loader.on('loadedplaylist', () => loadedplaylistEvents++);

  // do an initial load to start the loader
  loader.load();
  // pretend there's a pending media request so
  // media isn't selected automatically
  loader.hasPendingRequest = () => true;
  this.standardXHRResponse(this.requests.shift());
  assert.equal(loadedplaylistEvents, 1, 'one loadedplaylist event after first load');
  loader.hasPendingRequest = origHasPendingRequest;

  loader.media(loader.main.playlists[0]);
  this.clock.tick(1);
  assert.equal(loadedplaylistEvents, 2, 'one more loadedplaylist event after media selected');

  loader.load();
  this.clock.tick(1);
  assert.equal(loadedplaylistEvents, 3, 'one more loadedplaylist event after load');

  loader.load(false);
  this.clock.tick(1);
  assert.equal(
    loadedplaylistEvents,
    4,
    'one more loadedplaylist event after load with isFinalRendition false'
  );

  loader.load(true);
  this.clock.tick(1);
  assert.equal(
    loadedplaylistEvents,
    4,
    'no loadedplaylist event after load with isFinalRendition false'
  );

  this.clock.tick(loader.media().targetDuration / 2 * 1000);
  assert.equal(
    loadedplaylistEvents,
    5,
    'one more loadedplaylist event after final rendition delay'
  );
});

QUnit.test('requests sidx if main xml includes it', function(assert) {
  const loader = new DashPlaylistLoader('dash-sidx.mpd', this.fakeVhs);

  loader.load();
  this.standardXHRResponse(this.requests.shift());
  assert.strictEqual(loader.state, 'HAVE_MAIN_MANIFEST', 'state is HAVE_MAIN_MANIFEST');
  assert.ok(loader.main.playlists[0].sidx, 'sidx info is returned from parser');

  // initial media selection happens automatically
  // as there was  no pending request
  assert.ok(loader.hasPendingRequest(), 'request is pending');
  assert.strictEqual(this.requests.length, 1, 'one request for sidx has been made');
  assert.notOk(loader.media(), 'media playlist is not yet set');

  this.standardXHRResponse(this.requests.shift(), mp4VideoInitSegment().subarray(0, 10));
  this.standardXHRResponse(this.requests.shift(), sidxResponse());
  assert.strictEqual(loader.state, 'HAVE_METADATA', 'state is HAVE_METADATA');
  assert.ok(loader.media(), 'media playlist is set');
  assert.ok(loader.media().sidx, 'sidx info attribute is preserved');
  assert.deepEqual(
    loader.media().segments[0].byterange, {
      offset: 400,
      length: 13001
    },
    'sidx was correctly applied'
  );
});

QUnit.test('sidx mapping not added on container failure', function(assert) {
  const loader = new DashPlaylistLoader('dash-sidx.mpd', this.fakeVhs);

  loader.load();
  this.standardXHRResponse(this.requests.shift());
  assert.strictEqual(loader.state, 'HAVE_MAIN_MANIFEST', 'state is HAVE_MAIN_MANIFEST');
  assert.ok(loader.main.playlists[0].sidx, 'sidx info is returned from parser');

  // initial media selection happens automatically
  // as there was  no pending request
  assert.ok(loader.hasPendingRequest(), 'request is pending');
  assert.strictEqual(this.requests.length, 1, 'one request for sidx has been made');
  assert.notOk(loader.media(), 'media playlist is not yet set');

  // respond with non-sidx data
  this.standardXHRResponse(this.requests.shift());

  assert.equal(Object.keys(loader.sidxMapping_).length, 0, 'no sidx data');
});

QUnit.test('sidx mapping not added on sidx parsing failure', function(assert) {
  const loader = new DashPlaylistLoader('dash-sidx.mpd', this.fakeVhs);

  loader.load();
  this.standardXHRResponse(this.requests.shift());
  assert.strictEqual(loader.state, 'HAVE_MAIN_MANIFEST', 'state is HAVE_MAIN_MANIFEST');
  assert.ok(loader.main.playlists[0].sidx, 'sidx info is returned from parser');

  // initial media selection happens automatically
  // as there was  no pending request
  assert.ok(loader.hasPendingRequest(), 'request is pending');
  assert.strictEqual(this.requests.length, 1, 'one request for sidx has been made');
  assert.notOk(loader.media(), 'media playlist is not yet set');

  // valid container request
  this.standardXHRResponse(this.requests.shift(), mp4VideoInitSegment().subarray(0, 10));

  // respond with non-sidx data
  this.standardXHRResponse(this.requests.shift(), new Uint8Array(1));

  assert.equal(Object.keys(loader.sidxMapping_).length, 0, 'no sidx data');
});

QUnit.test('child loaders wait for async action before moving to HAVE_MAIN_MANIFEST', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);

  loader.load();
  this.standardXHRResponse(this.requests.shift());
  const childPlaylist = loader.main.playlists['0-placeholder-uri-AUDIO-audio-audio'];
  const childLoader = new DashPlaylistLoader(childPlaylist, this.fakeVhs, false, loader);

  childLoader.load();
  assert.strictEqual(childLoader.state, 'HAVE_NOTHING');

  this.clock.tick(1);
  // media playlist is chosen automatically
  assert.strictEqual(childLoader.state, 'HAVE_METADATA');
});

QUnit.test('load resumes the media update timer for live playlists', function(assert) {
  // start at 4 seconds past epoch for 2x 2 second segments
  this.clock.tick(4 * 1000);
  const loader = new DashPlaylistLoader('dash-live.mpd', this.fakeVhs);

  loader.load();
  this.standardXHRResponse(this.requests.shift());
  this.clock.tick(1);

  const origMediaUpdateTimeout = loader.mediaUpdateTimeout;

  assert.ok(origMediaUpdateTimeout, 'media update timeout set');

  loader.pause();
  loader.load();

  const newMediaUpdateTimeout = loader.mediaUpdateTimeout;

  assert.ok(newMediaUpdateTimeout, 'media update timeout set');
  assert.notEqual(
    origMediaUpdateTimeout,
    newMediaUpdateTimeout,
    'media update timeout is different'
  );
});

QUnit.test('load does not resume the media update timer for non live playlists', function(assert) {
  const loader = new DashPlaylistLoader('dash.mpd', this.fakeVhs);

  loader.load();
  this.standardXHRResponse(this.requests.shift());
  this.clock.tick(1);

  assert.notOk(loader.mediaUpdateTimeout, 'media update timeout not set');

  loader.pause();
  loader.load();

  assert.notOk(loader.mediaUpdateTimeout, 'media update timeout not set');
});

QUnit.test('pause removes minimum update period timeout', function(assert) {
  const loader = new DashPlaylistLoader('dash-live.mpd', this.fakeVhs);

  loader.load();
  this.standardXHRResponse(this.requests.shift());
  this.clock.tick(1);

  assert.ok(loader.minimumUpdatePeriodTimeout_, 'minimum update period timeout set');

  loader.pause();

  assert.notOk(
    loader.minimumUpdatePeriodTimeout_,
    'minimum update period timeout not set'
  );
});

QUnit.test('load resumes minimum update period timeout for live', function(assert) {
  // start at 4 seconds past epoch for 2x 2 second segments
  this.clock.tick(4 * 1000);
  const loader = new DashPlaylistLoader('dash-live.mpd', this.fakeVhs);

  loader.load();
  this.standardXHRResponse(this.requests.shift());
  this.clock.tick(1);

  // media should be selected at this point
  loader.media(loader.main.playlists[0]);

  assert.ok(loader.minimumUpdatePeriodTimeout_, 'minimum update period timeout set');

  loader.pause();

  assert.notOk(
    loader.minimumUpdatePeriodTimeout_,
    'minimum update period timeout not set'
  );

  loader.load();

  assert.ok(loader.minimumUpdatePeriodTimeout_, 'minimum update period timeout set');
});

QUnit.test('pause does not remove minimum update period timeout when not main', function(assert) {
  const mainLoader = new DashPlaylistLoader('dash-live.mpd', this.fakeVhs);

  mainLoader.load();
  this.standardXHRResponse(this.requests.shift());
  this.clock.tick(1);

  const media = mainLoader.main.playlists[0];
  // media should be selected at this point

  mainLoader.media(media);

  const mediaLoader = new DashPlaylistLoader(media, this.fakeVhs, {}, mainLoader);

  assert.ok(
    mainLoader.minimumUpdatePeriodTimeout_,
    'minimum update period timeout set'
  );

  mediaLoader.pause();

  assert.ok(
    mainLoader.minimumUpdatePeriodTimeout_,
    'minimum update period timeout set'
  );
});

QUnit.test('updateMain: merges in top level timelineStarts', function(assert) {
  const prev = {
    timelineStarts: [0, 1],
    playlists: [{
      uri: '0',
      id: 0,
      segments: [{
        presentationTime: 0,
        timeline: 0
      }, {
        presentationTime: 1,
        timeline: 1
      }]
    }],
    mediaGroups: {
      AUDIO: {},
      SUBTITLES: {}
    }
  };
  const next = {
    timelineStarts: [2],
    playlists: [{
      uri: '0',
      id: 0,
      segments: [{
        presentationTime: 2,
        timeline: 2
      }]
    }],
    mediaGroups: {
      AUDIO: {},
      SUBTITLES: {}
    }
  };

  const update = updateMain(prev, next);

  assert.deepEqual(update.timelineStarts, [2], 'updated timelineStarts');
});

QUnit.test('updateMain: updates playlists and mediaGroups when labels change', function(assert) {
  const main = {
    duration: 10,
    minimumUpdatePeriod: 0,
    timelineStarts: [],
    mediaGroups: {
      AUDIO: {
        audio: {
          main: {
            playlists: [{
              mediaSequence: 0,
              attributes: {},
              id: 'audio-0-uri',
              uri: 'audio-0-uri',
              resolvedUri: urlTo('audio-0-uri'),
              segments: [{
                duration: 10,
                uri: 'audio-segment-0-uri',
                resolvedUri: urlTo('audio-segment-0-uri')
              }]
            }]
          }
        }
      }
    },
    playlists: [{
      mediaSequence: 0,
      attributes: {
        BANDWIDTH: 9
      },
      id: 'playlist-0-uri',
      uri: 'playlist-0-uri',
      resolvedUri: urlTo('playlist-0-uri'),
      segments: [{
        duration: 10,
        uri: 'segment-0-uri',
        resolvedUri: urlTo('segment-0-uri')
      }]
    }]
  };
  const update = {
    duration: 20,
    minimumUpdatePeriod: 0,
    timelineStarts: [],
    mediaGroups: {
      AUDIO: {
        audio: {
          update: {
            playlists: [{
              mediaSequence: 1,
              attributes: {},
              id: 'audio-0-uri',
              uri: 'audio-0-uri',
              resolvedUri: urlTo('audio-0-uri'),
              segments: [{
                duration: 10,
                uri: 'audio-segment-0-uri',
                resolvedUri: urlTo('audio-segment-0-uri')
              }]
            }]
          }
        }
      }
    },
    playlists: [{
      mediaSequence: 1,
      attributes: {
        BANDWIDTH: 9
      },
      id: 'playlist-0-uri',
      uri: 'playlist-0-uri',
      resolvedUri: urlTo('playlist-0-uri'),
      segments: [{
        duration: 10,
        uri: 'segment-0-uri',
        resolvedUri: urlTo('segment-0-uri')
      }]
    }]
  };

  main.playlists['playlist-0-uri'] = main.playlists[0];
  main.playlists['audio-0-uri'] = main.mediaGroups.AUDIO.audio.main.playlists[0];

  assert.deepEqual(
    updateMain(main, update),
    {
      duration: 20,
      minimumUpdatePeriod: 0,
      timelineStarts: [],
      mediaGroups: {
        AUDIO: {
          audio: {
            update: {
              playlists: [{
                mediaSequence: 1,
                attributes: {},
                id: 'audio-0-uri',
                uri: 'audio-0-uri',
                resolvedUri: urlTo('audio-0-uri'),
                segments: [{
                  duration: 10,
                  uri: 'audio-segment-0-uri',
                  resolvedUri: urlTo('audio-segment-0-uri')
                }]
              }]
            }
          }
        }
      },
      playlists: [{
        mediaSequence: 1,
        attributes: {
          BANDWIDTH: 9
        },
        id: 'playlist-0-uri',
        uri: 'playlist-0-uri',
        resolvedUri: urlTo('playlist-0-uri'),
        segments: [{
          duration: 10,
          uri: 'segment-0-uri',
          resolvedUri: urlTo('segment-0-uri')
        }]
      }]
    },
    'updates playlists and media groups'
  );
});
