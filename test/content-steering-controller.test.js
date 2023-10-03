import QUnit from 'qunit';
import ContentSteeringController from '../src/content-steering-controller';
import { useFakeEnvironment } from './test-helpers';
import xhrFactory from '../src/xhr';
import sinon from 'sinon';

QUnit.module('ContentSteering', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.requests = this.env.requests;
    this.baseURL = 'https://foo.bar';
    this.contentSteeringController = new ContentSteeringController(xhrFactory(), () => undefined);
    this.contentSteeringController.addAvailablePathway('test-1');
    // handles a common testing flow of assigning tag properties and requesting the steering manifest immediately.
    this.assignAndRequest = (steeringTag) => {
      this.contentSteeringController.assignTagProperties(this.baseURL, steeringTag);
      this.contentSteeringController.requestSteeringManifest();
    };
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

  this.contentSteeringController.assignTagProperties(this.baseURL, steeringTag);
  const reloadUri = this.contentSteeringController.steeringManifest.reloadUri;

  assert.equal(reloadUri, steeringTag.serverUri, 'reloadUri is expected value');
});

QUnit.test('Fails when there is no serverUri', function(assert) {
  const steeringTag = {};

  this.assignAndRequest(steeringTag);
  const reloadUri = this.contentSteeringController.steeringManifest.reloadUri;
  const request = this.contentSteeringController.request_;

  assert.equal(reloadUri, null, 'reloadUri is null');
  assert.equal(request, null, 'no request is made');
});

QUnit.test('Can handle HLS content steering object and manifest with relative serverUri', function(assert) {
  const steeringTag = {
    serverUri: '/hls/path'
  };

  this.assignAndRequest(steeringTag);
  let reloadUri = this.contentSteeringController.steeringManifest.reloadUri;
  const steeringResponsePath = 'steering/relative';

  assert.equal(reloadUri, this.baseURL + steeringTag.serverUri, 'reloadUri is expected value');
  // steering response with relative RELOAD-URI
  this.requests[0].respond(200, { 'Content-Type': 'application/json' }, `{ "VERSION": 1, "RELOAD-URI": "${steeringResponsePath}" }`);
  reloadUri = this.contentSteeringController.steeringManifest.reloadUri;
  assert.equal(reloadUri, this.baseURL + steeringTag.serverUri.slice(0, 5) + steeringResponsePath, 'reloadUri is expected value');
});

QUnit.test('Can handle HLS content steering object with pathwayId', function(assert) {
  const steeringTag = {
    serverUri: 'https://content.steering.hls',
    pathwayId: 'hls-test'
  };
  let done;

  // ensure event is fired.
  this.contentSteeringController.on('content-steering', function() {
    done = assert.async();
  });
  this.assignAndRequest(steeringTag);
  // check pathway query param
  assert.equal(this.requests[0].uri, steeringTag.serverUri + '/?_HLS_pathway=hls-test', 'query parameters are set');
  assert.equal(this.contentSteeringController.defaultPathway, steeringTag.pathwayId, 'default pathway is expected value');
  assert.ok(done, 'content-steering event was fired');
  done();
});

QUnit.test('Can add HLS pathway and throughput to steering manifest requests', function(assert) {
  const steeringTag = {
    serverUri: 'https://content.steering.hls',
    pathwayId: 'cdn-a'
  };
  const expectedThroughputUrl = steeringTag.serverUri + '/?_HLS_pathway=cdn-a&_HLS_throughput=99999';

  this.contentSteeringController.getBandwidth_ = () => {
    return 99999;
  };
  this.contentSteeringController.assignTagProperties(this.baseURL, steeringTag);
  assert.equal(this.contentSteeringController.setSteeringParams_(steeringTag.serverUri), expectedThroughputUrl, 'pathway and throughput parameters set as expected');
});

QUnit.test('Can handle HLS content steering object with serverUri encoded as a base64 dataURI', function(assert) {
  const steeringTag = {
    serverUri: 'data:application/' +
    'vnd.apple.steeringlist;base64,eyJWRVJTSU9OIjoxLCJUVEwiOjMwMCwiUkVMT0FELVVSSSI6Imh0dHBzOi8vZXhhbXB' +
    'sZS5jb20vc3RlZXJpbmc/dmlkZW89MDAwMTImc2Vzc2lvbj0xMjMiLCJQQVRIV0FZLVBSSU9SSVRZIjpbIkNETi1BIiwiQ0ROLUIiXX0='
  };
  const steeringManifest = this.contentSteeringController.steeringManifest;

  this.contentSteeringController.assignTagProperties(this.baseURL, steeringTag);
  assert.equal(steeringManifest.reloadUri, 'https://example.com/steering?video=00012&session=123', 'reloadUri is expected value');
  assert.equal(steeringManifest.ttl, 300, 'ttl is expected value');
  assert.deepEqual(steeringManifest.priority, ['CDN-A', 'CDN-B'], 'cdnPriority is expected value');
});

// DASH
QUnit.test('Can handle DASH content steering object with serverURL only', function(assert) {
  const steeringTag = {
    serverURL: 'https://content.steering.dash'
  };

  this.contentSteeringController.assignTagProperties(this.baseURL, steeringTag);
  const reloadUri = this.contentSteeringController.steeringManifest.reloadUri;

  assert.equal(reloadUri, steeringTag.serverURL, 'reloadUri is expected value');
});

QUnit.test('Can handle DASH content steering object and manifest with relative serverURL', function(assert) {
  const steeringTag = {
    serverURL: '/dash/path'
  };

  this.assignAndRequest(steeringTag);
  let reloadUri = this.contentSteeringController.steeringManifest.reloadUri;
  const steeringResponsePath = 'steering/relative';

  assert.equal(reloadUri, this.baseURL + steeringTag.serverURL, 'reloadUri is expected value');
  // steering response with relative RELOAD-URI
  this.requests[0].respond(200, { 'Content-Type': 'application/json' }, `{ "VERSION": 1, "RELOAD-URI": "${steeringResponsePath}" }`);
  reloadUri = this.contentSteeringController.steeringManifest.reloadUri;
  assert.equal(reloadUri, this.baseURL + steeringTag.serverURL.slice(0, 6) + steeringResponsePath, 'reloadUri is expected value');
});

QUnit.test('Can handle DASH content steering object with defaultServiceLocation', function(assert) {
  const steeringTag = {
    serverURL: 'https://content.steering.dash',
    defaultServiceLocation: 'dash-test'
  };
  let done;

  // ensure event is fired.
  this.contentSteeringController.on('content-steering', function() {
    done = assert.async();
  });
  this.assignAndRequest(steeringTag);
  assert.equal(this.requests[0].uri, steeringTag.serverURL + '/?_DASH_pathway=dash-test', 'query parameters are set');
  assert.equal(this.contentSteeringController.defaultPathway, steeringTag.defaultServiceLocation, 'default pathway is expected value');
  assert.ok(done, 'content-steering event was fired');
  done();
});

QUnit.test('Can add DASH pathway and throughput to steering manifest requests', function(assert) {
  const steeringTag = {
    serverURL: 'https://content.steering.dash/?previous=params',
    defaultServiceLocation: 'cdn-c'
  };
  const expectedThroughputUrl = steeringTag.serverURL + '&_DASH_pathway=cdn-c&_DASH_throughput=9999';

  this.contentSteeringController.getBandwidth_ = () => {
    return 9999;
  };
  this.contentSteeringController.assignTagProperties(this.baseURL, steeringTag);
  assert.equal(this.contentSteeringController.setSteeringParams_(steeringTag.serverURL), expectedThroughputUrl, 'pathway and throughput parameters set as expected');
});

QUnit.test('Can set DASH queryBeforeStart property', function(assert) {
  const steeringTag = {
    serverURL: 'https://content.steering.dash',
    queryBeforeStart: true
  };

  this.contentSteeringController.assignTagProperties(this.baseURL, steeringTag);
  assert.true(this.contentSteeringController.queryBeforeStart, 'queryBeforeStart is true');
});

QUnit.test('Can handle DASH proxyServerURL', function(assert) {
  const steeringTag = {
    serverURL: 'https://content.steering.dash/?previous=params',
    proxyServerURL: 'https://proxy.url',
    defaultServiceLocation: 'dash-cdn'
  };
  const expectedProxyUrl = 'https://proxy.url/?url=https%3A%2F%2Fcontent.steering.dash%2F%3Fprevious%3Dparams&_DASH_pathway=dash-cdn&_DASH_throughput=99';

  this.contentSteeringController.getBandwidth_ = () => {
    return 99;
  };
  this.assignAndRequest(steeringTag);
  assert.equal(this.requests[0].uri, expectedProxyUrl, 'returns expected proxy server URL');
});

QUnit.test('didDASHTagChange can check if a DASH content steering tag has changed', function(assert) {
  const oldSteeringTag = {
    serverURL: 'https://content.steering.dash/?old=params',
    proxyServerURL: 'https://old.proxy.url',
    defaultServiceLocation: 'old-dash-cdn'
  };
  const newSteeringTag = {
    serverURL: 'https://content.steering.dash/?new=params',
    proxyServerURL: 'https://new.proxy.url',
    defaultServiceLocation: 'new-dash-cdn',
    queryBeforeStart: true
  };
  const ommittedAttributes = {
    serverURL: 'https://content.steering.dash/?old=params'
  };

  this.contentSteeringController.assignTagProperties(this.baseURL, oldSteeringTag);
  assert.false(this.contentSteeringController.didDASHTagChange(this.baseURL, oldSteeringTag));
  assert.true(this.contentSteeringController.didDASHTagChange(this.baseURL, newSteeringTag));
  assert.true(this.contentSteeringController.didDASHTagChange(this.baseURL, ommittedAttributes));
  this.contentSteeringController.dispose();
  this.contentSteeringController.assignTagProperties(this.baseURL, ommittedAttributes);
  assert.false(this.contentSteeringController.didDASHTagChange(this.baseURL, ommittedAttributes));
  assert.true(this.contentSteeringController.didDASHTagChange(this.baseURL, newSteeringTag));
  assert.true(this.contentSteeringController.didDASHTagChange(this.baseURL, oldSteeringTag));
});

// Common steering manifest tests
QUnit.test('Can handle content steering manifest with VERSION', function(assert) {
  const steeringTag = {
    serverUri: '/content/steering'
  };
  const manifest = this.contentSteeringController.steeringManifest;

  this.assignAndRequest(steeringTag);
  this.requests[0].respond(200, { 'Content-Type': 'application/json' }, '{ "VERSION": 1 }');
  assert.equal(manifest.version, 1, 'version is expected value');
  assert.equal(manifest.ttl, 300, 'ttl is 300 by default');
});

QUnit.test('Can handle content steering manifest with RELOAD-URI', function(assert) {
  const steeringTag = {
    serverURL: 'https://content.steering.dash'
  };
  const manifest = this.contentSteeringController.steeringManifest;

  this.assignAndRequest(steeringTag);
  assert.equal(manifest.reloadUri, 'https://content.steering.dash', 'reloadUri is expected value');
  this.requests[0].respond(200, { 'Content-Type': 'application/json' }, '{ "VERSION": 1, "RELOAD-URI": "https://reload.uri" }');
  assert.equal(manifest.reloadUri, 'https://reload.uri', 'reloadUri is expected value');
  assert.equal(manifest.ttl, 300, 'ttl is 300 by default');
});

QUnit.test('Can handle content steering manifest with TTL', function(assert) {
  const steeringTag = {
    serverUri: 'https://content.steering.hls'
  };

  this.assignAndRequest(steeringTag);
  this.requests[0].respond(200, { 'Content-Type': 'application/json' }, '{ "VERSION": 1, "TTL": 1 }');
  assert.equal(this.contentSteeringController.steeringManifest.ttl, 1, 'ttl is expected value');
  assert.ok(this.contentSteeringController.ttlTimeout_, 'ttl timeout is set');
});

// HLS
QUnit.test('Can handle HLS content steering manifest with PATHWAY-PRIORITY', function(assert) {
  const steeringTag = {
    serverUri: 'https://content.steering.hls'
  };

  this.assignAndRequest(steeringTag);
  this.requests[0].respond(200, { 'Content-Type': 'application/json' }, '{ "VERSION": 1, "PATHWAY-PRIORITY": ["hls1", "hls2"] }');
  assert.deepEqual(this.contentSteeringController.steeringManifest.priority, ['hls1', 'hls2'], 'priority is expected value');
});

QUnit.test('Can handle HLS content steering manifest with PATHWAY-PRIORITY and tag with pathwayId', function(assert) {
  const steeringTag = {
    serverUri: 'https://content.steering.hls',
    pathwayId: 'hls2'
  };

  this.contentSteeringController.addAvailablePathway('hls1');
  this.contentSteeringController.addAvailablePathway('hls2');
  this.assignAndRequest(steeringTag);
  this.requests[0].respond(200, { 'Content-Type': 'application/json' }, '{ "VERSION": 1, "PATHWAY-PRIORITY": ["hls1", "hls2"] }');
  assert.deepEqual(this.contentSteeringController.steeringManifest.priority, ['hls1', 'hls2'], 'priority is expected value');
  assert.equal(this.contentSteeringController.currentPathway, 'hls1', 'current pathway is hls1');
});

// DASH
QUnit.test('Can handle DASH content steering manifest with SERVICE-LOCATION-PRIORITY', function(assert) {
  const steeringTag = {
    serverURL: 'https://content.steering.dash'
  };

  this.assignAndRequest(steeringTag);
  this.requests[0].respond(200, { 'Content-Type': 'application/json' }, '{ "VERSION": 1, "SERVICE-LOCATION-PRIORITY": ["dash1", "dash2", "dash3"] }');
  assert.deepEqual(this.contentSteeringController.steeringManifest.priority, ['dash1', 'dash2', 'dash3'], 'priority is expected value');
});

QUnit.test('Can handle DASH content steering manifest with PATHWAY-PRIORITY and tag with pathwayId', function(assert) {
  const steeringTag = {
    serverUri: 'https://content.steering.dash',
    pathwayId: 'dash3'
  };

  this.contentSteeringController.addAvailablePathway('dash1');
  this.contentSteeringController.addAvailablePathway('dash2');
  this.contentSteeringController.addAvailablePathway('dash3');
  this.assignAndRequest(steeringTag);
  this.requests[0].respond(200, { 'Content-Type': 'application/json' }, '{ "VERSION": 1, "SERVICE-LOCATION-PRIORITY": ["dash2", "dash1", "dash3"] }');
  assert.deepEqual(this.contentSteeringController.steeringManifest.priority, ['dash2', 'dash1', 'dash3'], 'priority is expected value');
  assert.equal(this.contentSteeringController.currentPathway, 'dash2', 'current pathway is dash2');
});

// Common abort, dispose and error cases
QUnit.test('Can abort a content steering manifest request', function(assert) {
  const steeringTag = {
    serverURL: 'https://content.steering.dash'
  };

  this.assignAndRequest(steeringTag);
  this.contentSteeringController.abort();
  assert.true(this.requests[0].aborted, 'request is aborted');
  assert.equal(this.contentSteeringController.request, null, 'request is null');
});

QUnit.test('Can abort and clear the TTL timeout for a content steering manifest', function(assert) {
  const steeringTag = {
    serverUri: 'https://content.steering.hls'
  };

  this.assignAndRequest(steeringTag);
  this.contentSteeringController.dispose();
  assert.true(this.requests[0].aborted, 'request is aborted');
  assert.equal(this.contentSteeringController.request_, null, 'request is null');
  assert.equal(this.contentSteeringController.ttlTimeout, null, 'ttl timeout is null');
});

QUnit.test('trigger error on VERSION !== 1', function(assert) {
  const steeringTag = {
    serverUri: '/content/steering'
  };
  const manifest = this.contentSteeringController.steeringManifest;
  const done = assert.async();

  this.contentSteeringController.on('error', function() {
    assert.equal(manifest.version, undefined, 'version is undefined');
    assert.equal(manifest.ttl, undefined, 'ttl is undefined');
    done();
  });
  this.assignAndRequest(steeringTag);
  this.requests[0].respond(200, { 'Content-Type': 'application/json' }, '{ "VERSION": 0 }');
});

QUnit.test('trigger error when serverUri or serverURL is undefined', function(assert) {
  const steeringTag = {};
  const done = assert.async();

  this.contentSteeringController.on('error', function() {
    assert.equal(undefined, this.steeringManifest.reloadUri, 'reloadUri is undefined');
    done();
  });
  this.contentSteeringController.assignTagProperties(this.baseURL, steeringTag);
});

QUnit.test('trigger retry on steering manifest request error', function(assert) {
  const steeringTag = {
    serverUri: '/content/steering'
  };
  const startTTLSpy = sinon.spy(this.contentSteeringController, 'startTTLTimeout_');

  this.contentSteeringController.steeringManifest.ttl = 1;
  this.assignAndRequest(steeringTag);
  this.requests[0].respond(404);
  assert.equal(startTTLSpy.callCount, 1, 'startTTLTimeout called on retry');
});

QUnit.test('Disposes content steering when there is not a valid requestUri', function(assert) {
  const steeringTag = {
    serverUri: '/content/steering'
  };

  // There is no valid request URI
  const getRequestURIStub = sinon.stub(this.contentSteeringController, 'getRequestURI');

  getRequestURIStub.returns(null);

  const disposeSpy = sinon.spy(this.contentSteeringController, 'dispose');

  this.assignAndRequest(steeringTag);

  const request = this.contentSteeringController.request_;

  assert.equal(request, null, 'no request is made');
  assert.ok(disposeSpy.called, 'diposes the content steering controller');
});

QUnit.test('Exclude request URI on a 410 error', function(assert) {
  const steeringTag = {
    serverUri: '/content/steering'
  };

  const resolvedUri = this.baseURL + steeringTag.serverUri;

  this.assignAndRequest(steeringTag);
  this.requests[0].respond(410);

  const excludedUri = [...this.contentSteeringController.excludedSteeringManifestURLs][0];

  assert.equal(excludedUri, resolvedUri, 'exludes uri from future requests');
});

QUnit.test('Set a retry on a 429 error', function(assert) {
  const steeringTag = {
    serverUri: '/content/steering'
  };
  const startTTLSpy = sinon.spy(this.contentSteeringController, 'startTTLTimeout_');

  this.assignAndRequest(steeringTag);
  this.requests[0].respond(429, { 'Retry-After': 10 });

  assert.deepEqual(startTTLSpy.getCall(0).args[0], 10, 'will retry the request in 10 seconds');
});

// getRequestURI

QUnit.test('getRequestURI returns null when no uri is passed', function(assert) {
  const actual = this.contentSteeringController.getRequestURI(null);

  assert.deepEqual(actual, null, 'function should return null');
});

QUnit.test('getRequestURI returns resolved proxyServerUrl when set', function(assert) {
  const reloadUri = 'https://baseUrl.com';

  this.contentSteeringController.proxyServerUrl_ = 'https://proxy.url';
  const actual = this.contentSteeringController.getRequestURI(reloadUri);
  const expected = 'https://proxy.url/?url=https%3A%2F%2Fbaseurl.com%2F';

  assert.deepEqual(actual, expected, 'function should return the resolved proxy url');
});

QUnit.test('getRequestURI returns resolved reloadUri when set', function(assert) {
  const reloadUri = 'https://baseUrl.com';

  const actual = this.contentSteeringController.getRequestURI(reloadUri);
  const expected = 'https://baseurl.com/';

  assert.deepEqual(actual, expected, 'function should return the original reloadUri');
});

QUnit.test('getRequestURI returns resolved reloadUri when proxyUri is excluded', function(assert) {
  const reloadUri = 'https://baseUrl.com';

  this.contentSteeringController.proxyServerUrl_ = 'https://proxy.url';
  // exlude the resolved url
  this.contentSteeringController.excludedSteeringManifestURLs.add('https://proxy.url/?url=https%3A%2F%2Fbaseurl.com%2F');

  const actual = this.contentSteeringController.getRequestURI(reloadUri);
  const expected = 'https://baseurl.com/';

  assert.deepEqual(actual, expected, 'function should return the original reloadUri');
});

QUnit.test('getRequestURI returns null when both reloadUri or proxyUri are excluded', function(assert) {
  const reloadUri = 'https://baseUrl.com';

  this.contentSteeringController.proxyServerUrl_ = 'https://proxy.url';
  // exlude the resolved urls
  this.contentSteeringController.excludedSteeringManifestURLs.add('https://proxy.url/?url=https%3A%2F%2Fbaseurl.com%2F');
  this.contentSteeringController.excludedSteeringManifestURLs.add('https://baseurl.com/');

  const actual = this.contentSteeringController.getRequestURI(reloadUri);

  assert.deepEqual(actual, null, 'function should return null');
});

// Switching Logic

QUnit.test('chooses pathway with highest priority', function(assert) {
  const steeringTag = {
    serverUri: '/content/steering'
  };

  this.contentSteeringController.addAvailablePathway('cdn-a');
  this.contentSteeringController.addAvailablePathway('cdn-b');
  this.contentSteeringController.addAvailablePathway('cdn-c');

  this.assignAndRequest(steeringTag);
  this.requests[0].respond(200, { 'Content-Type': 'application/json' }, '{ "VERSION": 1, "PATHWAY-PRIORITY": ["cdn-b", "cdn-a", "cdn-c"] }');

  const expected = this.contentSteeringController.currentPathway;

  assert.equal(expected, 'cdn-b', 'pathway with highest priority is selected');
});

QUnit.test('chooses pathway with highest priority when pathway is not available', function(assert) {
  const steeringTag = {
    serverUri: '/content/steering'
  };

  this.contentSteeringController.addAvailablePathway('cdn-a');
  this.contentSteeringController.addAvailablePathway('cdn-c');

  this.assignAndRequest(steeringTag);
  this.requests[0].respond(200, { 'Content-Type': 'application/json' }, '{ "VERSION": 1, "PATHWAY-PRIORITY": ["cdn-b", "cdn-c", "cdn-a"] }');

  const expected = this.contentSteeringController.currentPathway;

  assert.equal(expected, 'cdn-c', 'pathway with highest priority that is available');
});

QUnit.test('chooses first pathway when none are in the priority list', function(assert) {
  const steeringTag = {
    serverUri: '/content/steering'
  };

  this.assignAndRequest(steeringTag);
  this.requests[0].respond(200, { 'Content-Type': 'application/json' }, '{ "VERSION": 1, "PATHWAY-PRIORITY": ["cdn-z"] }');

  const expected = this.contentSteeringController.currentPathway;

  // test-1 is the default pathway added in beforeEach
  assert.equal(expected, 'test-1', 'use first pathway when none exist on the priority list');
});

QUnit.test('disposes the controller when there are no available pathways', function(assert) {
  const steeringTag = {
    serverUri: '/content/steering'
  };

  this.contentSteeringController.excludePathway('test-1');
  const disposeSpy = sinon.spy(this.contentSteeringController, 'dispose');

  this.assignAndRequest(steeringTag);
  this.requests[0].respond(200, { 'Content-Type': 'application/json' }, '{ "VERSION": 1, "PATHWAY-PRIORITY": ["cdn-z"] }');

  assert.ok(disposeSpy.called, 'diposes the content steering controller');
});
