import QUnit from 'qunit';
import ContentSteeringController from '../src/content-steering-controller';
import { useFakeEnvironment } from './test-helpers';
import xhrFactory from '../src/xhr';

QUnit.module.only('ContentSteering', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.requests = this.env.requests;
    this.fakeVhs = {
      xhr: xhrFactory()
    };
    this.manifestUri = 'https://foo.bar';
    this.mockSegmentLoader = {
      vhs_: this.fakeVhs,
      throughput: {
        rate: 0
      }
    };
    this.mockMainPlaylist = {
      uri: 'https://foo.bar'
    };

    this.contentSteeringController = new ContentSteeringController(this.mockSegmentLoader);
  },
  afterEach() {
    this.env.restore();
    this.contentSteeringController = null;
  }
});

// HLS
QUnit.test('Can handle HLS content steering object with serverUri only', function(assert) {
  const steeringTag = {
    serverUri: 'https://content.steering.hls'
  };

  this.mockMainPlaylist.contentSteering = steeringTag;
  this.contentSteeringController.handleContentSteeringTag(this.mockMainPlaylist);
  const reloadUri = this.contentSteeringController.steeringManifest.reloadUri;

  assert.equal(reloadUri, steeringTag.serverUri, 'reloadUri is expected value');
});

QUnit.test('Can handle HLS content steering object with relative serverUri', function(assert) {
  const steeringTag = {
    serverUri: '/hls/path'
  };

  this.mockMainPlaylist.contentSteering = steeringTag;
  this.contentSteeringController.handleContentSteeringTag(this.mockMainPlaylist);
  this.contentSteeringController.requestContentSteeringManifest();
  let reloadUri = this.contentSteeringController.steeringManifest.reloadUri;
  const baseURL = this.mockMainPlaylist.uri;
  const steeringResponsePath = 'steering/relative';

  assert.equal(reloadUri, baseURL + steeringTag.serverUri, 'reloadUri is expected value');
  // steering response with relative RELOAD-URI
  this.requests[0].respond(200, { 'Content-Type': 'application/json' }, `{ "VERSION": 1, "RELOAD-URI": "${steeringResponsePath}" }`);
  reloadUri = this.contentSteeringController.steeringManifest.reloadUri;
  assert.equal(reloadUri, baseURL + steeringTag.serverUri.slice(0, 5) + steeringResponsePath, 'reloadUri is expected value');
});

QUnit.test('Can handle HLS content steering object with pathwayId', function(assert) {
  const steeringTag = {
    serverUri: 'https://content.steering.hls',
    pathwayId: 'hls-test'
  };

  this.mockMainPlaylist.contentSteering = steeringTag;
  this.contentSteeringController.handleContentSteeringTag(this.mockMainPlaylist);
  this.contentSteeringController.requestContentSteeringManifest();
  const reloadUri = this.contentSteeringController.steeringManifest.reloadUri;

  // check pathway query param
  assert.equal(this.requests[0].uri, reloadUri + '/?_HLS_pathway=hls-test', 'query parameters are set');
  assert.equal(this.contentSteeringController.defaultPathway, steeringTag.pathwayId, 'default pathway is expected value');
});

QUnit.test('Can add HLS pathway and throughput to steering manifest requests', function(assert) {
  const steeringTag = {
    serverUri: 'https://content.steering.hls',
    pathwayId: 'cdn-a'
  };
  const expectedThroughputUrl = steeringTag.serverUri + '/?_HLS_pathway=cdn-a&_HLS_throughput=99999';

  this.mockMainPlaylist.contentSteering = steeringTag;
  this.contentSteeringController.handleContentSteeringTag(this.mockMainPlaylist);
  this.mockSegmentLoader.throughput.rate = 99999;
  assert.equal(this.contentSteeringController.setSteeringParams_(steeringTag.serverUri), expectedThroughputUrl, 'throughput parameters set as expected');
});

QUnit.test('Can handle HLS content steering object with serverUri encoded as a base64 dataURI', function(assert) {
  const steeringTag = {
    serverUri: 'data:application/' +
    'vnd.apple.steeringlist;base64,eyJWRVJTSU9OIjoxLCJUVEwiOjMwMCwiUkVMT0FELVVSSSI6Imh0dHBzOi8vZXhhbXB' +
    'sZS5jb20vc3RlZXJpbmc/dmlkZW89MDAwMTImc2Vzc2lvbj0xMjMiLCJQQVRIV0FZLVBSSU9SSVRZIjpbIkNETi1BIiwiQ0ROLUIiXX0='
  };
  const steeringManifest = this.contentSteeringController.steeringManifest;

  this.mockMainPlaylist.contentSteering = steeringTag;
  this.contentSteeringController.handleContentSteeringTag(this.mockMainPlaylist);
  assert.equal(steeringManifest.reloadUri, 'https://example.com/steering?video=00012&session=123', 'reloadUri is expected value');
  assert.equal(steeringManifest.ttl, 300, 'ttl is expected value');
  assert.deepEqual(steeringManifest.priority, ['CDN-A', 'CDN-B'], 'cdnPriority is expected value');
});

// // DASH
// QUnit.test('Can handle DASH content steering object with serverURL only', function(assert) {
//   const dashServerUrlOnly = {
//     serverURL: 'https://content.steering.dash'
//   };
//   const contentSteering = new ContentSteering(this.fakeVhs.xhr, this.manifestUri, dashServerUrlOnly, this.mockSegmentLoader);

//   this.requests[0].respond(200, { 'Content-Type': 'application/json' }, '{ "VERSION": 1 }');
//   assert.equal(contentSteering.reloadUri, dashServerUrlOnly.serverURL, 'reloadUri is expected value');
// });

// QUnit.test('Can handle DASH content steering object with relative serverURL', function(assert) {
//   const dashServerUrlOnly = {
//     serverURL: '/dash/path'
//   };
//   const contentSteering = new ContentSteering(this.fakeVhs.xhr, this.manifestUri, dashServerUrlOnly, this.mockSegmentLoader);

//   this.requests[0].respond(200, { 'Content-Type': 'application/json' }, '{ "VERSION": 1 }');
//   assert.equal(contentSteering.reloadUri, this.manifestUri + dashServerUrlOnly.serverURL, 'reloadUri is expected value');
// });

// QUnit.test('Can handle DASH content steering object with defaultServiceLocation', function(assert) {
//   const dashSteeringTag = {
//     serverURL: 'https://content.steering.dash',
//     defaultServiceLocation: 'dash-test'
//   };
//   const contentSteering = new ContentSteering(this.fakeVhs.xhr, this.manifestUri, dashSteeringTag, this.mockSegmentLoader);

//   this.requests[0].respond(200, { 'Content-Type': 'application/json' }, '{ "VERSION": 1 }');
//   // check pathway query param
//   assert.equal(this.requests[0].uri, contentSteering.reloadUri + '/?_DASH_pathway=dash-test', 'query parameters are set');
//   assert.equal(contentSteering.currentCdn, dashSteeringTag.defaultServiceLocation, 'current cdn is expected value');
// });

// QUnit.test('Can add DASH throughput to steering manifest requests', function(assert) {
//   const dashServerUrlOnly = {
//     serverURL: 'https://content.steering.dash'
//   };
//   const contentSteering = new ContentSteering(this.fakeVhs.xhr, this.manifestUri, dashServerUrlOnly, this.mockSegmentLoader);
//   const expectedThroughputUrl = dashServerUrlOnly.serverURL + '/?_DASH_throughput=99999';

//   contentSteering.mainSegmentLoader_ = {
//     throughput: {
//       rate: 99999
//     }
//   };
//   assert.equal(contentSteering.setSteeringParams_(dashServerUrlOnly.serverURL), expectedThroughputUrl, 'throughput parameters set as expected');
// });

// // Common steering manifest tests
// QUnit.test('Can handle content steering manifest with VERSION', function(assert) {
//   const hlsServerUriOnly = {
//     serverUri: 'https://content.steering.hls'
//   };
//   const contentSteering = new ContentSteering(this.fakeVhs.xhr, this.manifestUri, hlsServerUriOnly, this.mockSegmentLoader);

//   this.requests[0].respond(200, { 'Content-Type': 'application/json' }, '{ "VERSION": 1 }');
//   assert.equal(contentSteering.version, 1, 'version is expected value');
//   // check that ttl is set to default value if absent
//   assert.equal(contentSteering.ttl, 300, 'ttl is 300 by default');
// });

// QUnit.test('Can handle content steering manifest with RELOAD-URI', function(assert) {
//   const dashServerUrlOnly = {
//     serverURL: 'https://content.steering.dash'
//   };
//   const contentSteering = new ContentSteering(this.fakeVhs.xhr, this.manifestUri, dashServerUrlOnly, this.mockSegmentLoader);

//   this.requests[0].respond(200, { 'Content-Type': 'application/json' }, '{ "VERSION": 1, "RELOAD-URI": "https://foo.bar" }');
//   assert.equal(contentSteering.reloadUri, 'https://foo.bar', 'reloadUri is expected value');
// });

// QUnit.test('Can handle content steering manifest with TTL', function(assert) {
//   const hlsServerUriOnly = {
//     serverUri: 'https://content.steering.hls'
//   };
//   const contentSteering = new ContentSteering(this.fakeVhs.xhr, this.manifestUri, hlsServerUriOnly, this.mockSegmentLoader);

//   this.requests[0].respond(200, { 'Content-Type': 'application/json' }, '{ "VERSION": 1, "TTL": 1 }');
//   assert.equal(contentSteering.ttl, 1, 'ttl is expected value');
// });

// QUnit.test('Can abort a content steering manifest request', function(assert) {
//   const dashServerUrlOnly = {
//     serverURL: 'https://content.steering.dash'
//   };
//   const contentSteering = new ContentSteering(this.fakeVhs.xhr, this.manifestUri, dashServerUrlOnly, this.mockSegmentLoader);

//   contentSteering.abort();
//   assert.true(this.requests[0].aborted, 'request is aborted');
//   assert.equal(contentSteering.request, null, 'request is null');
// });

// QUnit.test('Can abort and clear the TTL timeout for a content steering manifest', function(assert) {
//   const hlsServerUriOnly = {
//     serverUri: 'https://content.steering.hls'
//   };
//   const contentSteering = new ContentSteering(this.fakeVhs.xhr, this.manifestUri, hlsServerUriOnly, this.mockSegmentLoader);

//   contentSteering.dispose();
//   assert.true(this.requests[0].aborted, 'request is aborted');
//   assert.equal(contentSteering.request, null, 'request is null');
//   assert.equal(contentSteering.ttlTimeout, null, 'ttl timeout is null');
// });

// // HLS
// QUnit.test('Can handle HLS content steering manifest with PATHWAY-PRIORITY', function(assert) {
//   const hlsServerUriOnly = {
//     serverUri: 'https://content.steering.hls'
//   };
//   const contentSteering = new ContentSteering(this.fakeVhs.xhr, this.manifestUri, hlsServerUriOnly, this.mockSegmentLoader);

//   this.requests[0].respond(200, { 'Content-Type': 'application/json' }, '{ "VERSION": 1, "PATHWAY-PRIORITY": ["hls1", "hls2"] }');
//   assert.deepEqual(contentSteering.cdnPriority, ['hls1', 'hls2'], 'cdn priority is expected value');
// });

// // DASH
// QUnit.test('Can handle DASH content steering manifest with SERVICE-LOCATION-PRIORITY', function(assert) {
//   const dashServerUrlOnly = {
//     serverURL: 'https://content.steering.dash'
//   };
//   const contentSteering = new ContentSteering(this.fakeVhs.xhr, this.manifestUri, dashServerUrlOnly, this.mockSegmentLoader);

//   this.requests[0].respond(200, { 'Content-Type': 'application/json' }, '{ "VERSION": 1, "SERVICE-LOCATION-PRIORITY": ["dash1", "dash2", "dash3"] }');
//   assert.deepEqual(contentSteering.cdnPriority, ['dash1', 'dash2', 'dash3'], 'cdn priority is expected value');
// });
