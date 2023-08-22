import QUnit from 'qunit';
import ContentSteering from '../../src/util/content-steering';
import { useFakeEnvironment } from '../test-helpers';
import xhrFactory from '../../src/xhr';

QUnit.module('ContentSteering', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.requests = this.env.requests;
    this.fakeVhs = {
      xhr: xhrFactory()
    };
  },
  afterEach() {
    this.env.restore();
  }
});

QUnit.test('Can handle HLS content steering object with serverUri only', function(assert) {
  const hlsServerUriOnly = {
    serverUri: 'https://content.steering.test'
  };
  const contentSteering = new ContentSteering(this.fakeVhs.xhr, this.manifestUri, hlsServerUriOnly);

  this.requests[0].respond(200, { 'Content-Type': 'application/json' }, '{ "VERSION": 1 }');
  assert.equal(contentSteering.reloadUri, hlsServerUriOnly.serverUri, 'reloadUri is expected value');
});

QUnit.test('Can handle HLS content steering object with pathwayId', function(assert) {
  const hlsSteeringTag = {
    serverUri: 'https://content.steering.test',
    pathwayId: 'test'
  };
  const contentSteering = new ContentSteering(this.fakeVhs.xhr, this.manifestUri, hlsSteeringTag);

  contentSteering.mainSegmentLoader_ = {
    throughput: {
      rate: 99999
    }
  };
  this.requests[0].respond(200, { 'Content-Type': 'application/json' }, '{ "VERSION": 1 }');
  assert.equal(contentSteering.reloadUri, hlsSteeringTag.serverUri, 'reloadUri is expected value');
  // check pathway query param
  assert.equal(this.requests[0].uri, contentSteering.reloadUri + '/?_HLS_pathway=test', 'query parameters are set');
  assert.equal(contentSteering.currentCdn, hlsSteeringTag.pathwayId, 'current cdn is expected value');
});

QUnit.test('Can add throughput to steering manifest requests', function(assert) {
  const hlsServerUriOnly = {
    serverUri: 'https://content.steering.test'
  };
  const contentSteering = new ContentSteering(this.fakeVhs.xhr, this.manifestUri, hlsServerUriOnly);
  const expectedThroughputUrl = hlsServerUriOnly.serverUri + '/?_HLS_throughput=99999';

  contentSteering.mainSegmentLoader_ = {
    throughput: {
      rate: 99999
    }
  };
  assert.equal(contentSteering.setSteeringParams_(hlsServerUriOnly.serverUri), expectedThroughputUrl, 'throughput parameters set as expected');
});

// Steering manifest tests

QUnit.test('Can handle HLS content steering manifest with VERSION', function(assert) {
  const hlsServerUriOnly = {
    serverUri: 'https://content.steering.test'
  };
  const contentSteering = new ContentSteering(this.fakeVhs.xhr, this.manifestUri, hlsServerUriOnly);

  this.requests[0].respond(200, { 'Content-Type': 'application/json' }, '{ "VERSION": 1 }');
  assert.equal(contentSteering.version, 1, 'version is expected value');
  // check that ttl is set to default value if absent
  assert.equal(contentSteering.ttl, 300, 'ttl is 300 by default');
});

QUnit.test('Can handle HLS content steering manifest with RELOAD-URI', function(assert) {
  const hlsServerUriOnly = {
    serverUri: 'https://content.steering.test'
  };
  const contentSteering = new ContentSteering(this.fakeVhs.xhr, this.manifestUri, hlsServerUriOnly);

  this.requests[0].respond(200, { 'Content-Type': 'application/json' }, '{ "VERSION": 1, "RELOAD-URI": "https://foo.bar" }');
  assert.equal(contentSteering.reloadUri, 'https://foo.bar', 'reloadUri is expected value');
});

QUnit.test('Can handle HLS content steering manifest with TTL', function(assert) {
  const hlsServerUriOnly = {
    serverUri: 'https://content.steering.test'
  };
  const contentSteering = new ContentSteering(this.fakeVhs.xhr, this.manifestUri, hlsServerUriOnly);

  this.requests[0].respond(200, { 'Content-Type': 'application/json' }, '{ "VERSION": 1, "TTL": 1 }');
  assert.equal(contentSteering.ttl, 1, 'ttl is expected value');
});

QUnit.test('Can handle HLS content steering manifest with PATHWAY-PRIORITY', function(assert) {
  const hlsServerUriOnly = {
    serverUri: 'https://content.steering.test',
    pathwayId: 'test'
  };
  const contentSteering = new ContentSteering(this.fakeVhs.xhr, this.manifestUri, hlsServerUriOnly);

  this.requests[0].respond(200, { 'Content-Type': 'application/json' }, '{ "VERSION": 1, "PATHWAY-PRIORITY": ["test1", "test2"] }');
  assert.deepEqual(contentSteering.cdnPriority, ['test1', 'test2'], 'cdn priority is expected value');
});
