import window from 'global/window';
import QUnit from 'qunit';
import {default as xhrFactory, byterangeStr} from '../src/xhr';
import { useFakeEnvironment } from './test-helpers.js';
import videojs from 'video.js';
// needed for plugin registration
import '../src/videojs-http-streaming';

QUnit.module('xhr', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.clock = this.env.clock;
    this.requests = this.env.requests;
    this.xhr = xhrFactory();
  },
  afterEach() {
    this.env.restore();
  }
});

QUnit.test('xhr respects beforeRequest', function(assert) {
  const defaultOptions = {
    url: 'default'
  };

  this.xhr(defaultOptions);
  assert.equal(this.requests.shift().url, 'default', 'url the same without override');

  this.xhr.beforeRequest = (options) => {
    options.url = 'player';
    return options;
  };

  this.xhr(defaultOptions);
  assert.equal(this.requests.shift().url, 'player', 'url changed with player override');

  videojs.Vhs.xhr.beforeRequest = (options) => {
    options.url = 'global';
    return options;
  };

  this.xhr(defaultOptions);
  assert.equal(this.requests.shift().url, 'player', 'prioritizes player override');

  delete this.xhr.beforeRequest;

  this.xhr(defaultOptions);
  assert.equal(this.requests.shift().url, 'global', 'url changed with global override');
});

QUnit.test('xhr calls global and player onRequest hooks respectively', function(assert) {
  const defaultOptions = {
    url: 'default'
  };

  this.xhr(defaultOptions);
  let xhrRequest = this.requests.shift();

  assert.equal(xhrRequest.url, 'default', 'url the same without onRequest hooks');
  // create the global onRequest set and 2 hooks
  videojs.Vhs.xhr.onRequest = new Set();
  const globalRequestHook1 = (request) => {
    request.url = 'global';
  };
  const globalRequestHook2 = (request) => {
    request.headers = {
      foo: 'bar'
    };
  };

  // add them to the set
  videojs.Vhs.xhr.onRequest.add(globalRequestHook1);
  videojs.Vhs.xhr.onRequest.add(globalRequestHook2);

  this.xhr(defaultOptions);
  xhrRequest = this.requests.shift();

  assert.equal(xhrRequest.url, 'global', 'url changed with global onRequest hooks');
  assert.equal(xhrRequest.headers.foo, 'bar', 'headers changed with global onRequest hooks');

  // create the player onRequest set and 2 hooks
  this.xhr.onRequest = new Set();
  const playerRequestHook1 = (request) => {
    request.url = 'player';
  };
  const playerRequestHook2 = (request) => {
    request.headers = {
      bar: 'foo'
    };
  };

  // add them to the set
  this.xhr.onRequest.add(playerRequestHook1);
  this.xhr.onRequest.add(playerRequestHook2);

  this.xhr(defaultOptions);
  xhrRequest = this.requests.shift();

  // player level request hooks override global
  assert.equal(xhrRequest.url, 'player', 'url changed with player onRequest hooks');
  assert.equal(xhrRequest.headers.bar, 'foo', 'headers changed with player onRequest hooks');

  // delete player level request hooks and check to ensure global are still used
  delete this.xhr.onRequest;
  this.xhr(defaultOptions);
  xhrRequest = this.requests.shift();
  assert.equal(xhrRequest.url, 'global', 'url changed with player onRequest hooks');
  assert.equal(xhrRequest.headers.foo, 'bar', 'headers changed with player onRequest hooks');

  // delete global request hooks and ensure we return to default
  delete videojs.Vhs.xhr.onRequest;
  this.xhr(defaultOptions);
  xhrRequest = this.requests.shift();
  assert.equal(xhrRequest.url, 'default', 'url the same without onRequest hooks');
  assert.notEqual(xhrRequest.headers.foo, 'bar', 'headers the same without onRequest hooks');
});

QUnit.test('xhr calls global and player onResponse hooks respectively', function(assert) {
  const done = assert.async();
  const defaultOptions = {
    url: 'default'
  };
  let globalHookCallCount = 0;

  // Create global onResponse set and 2 hooks
  videojs.Vhs.xhr.onResponse = new Set();
  const globalOnResponseHook1 = (request, error, response) => {
    globalHookCallCount++;
  };
  const globalOnResponseHook2 = (request, error, response) => {
    globalHookCallCount++;
  };

  videojs.Vhs.xhr.onResponse.add(globalOnResponseHook1);
  videojs.Vhs.xhr.onResponse.add(globalOnResponseHook2);

  // Create player onResponse set and 2 hooks
  this.xhr.onResponse = new Set();
  const playerOnResponseHook1 = (request, error, response) => {
    assert.equal(response.body, 'foo-bar', 'expected response body');
    assert.equal(response.method, 'GET', 'expected method');
  };
  const playerOnResponseHook2 = (request, error, response) => {
    assert.equal(response.headers.foo, 'bar', 'expected headers');
    assert.equal(response.statusCode, 200, 'expected statusCode');
    assert.equal(response.url, 'default', 'expected URL');
    assert.equal(globalHookCallCount, 0, 'global response hooks not called yet');
  };

  this.xhr.onResponse.add(playerOnResponseHook1);
  this.xhr.onResponse.add(playerOnResponseHook2);

  this.xhr(defaultOptions, () => { });
  this.requests.shift().respond(200, { foo: 'bar' }, 'foo-bar');

  const globalOnResponseHook3 = (request, error, response) => {
    assert.equal(response.body, 'bar-foo', 'expected response body');
    assert.equal(response.method, 'GET', 'expected method');
    assert.equal(response.headers.bar, 'foo', 'expected headers');
    assert.equal(response.statusCode, 200, 'expected statusCode');
    assert.equal(response.url, 'global', 'expected URL');
    assert.equal(globalHookCallCount, 2, 'global response hooks called 2 times');
    done();
  };

  videojs.Vhs.xhr.onResponse.add(globalOnResponseHook3);
  // delete player onResponse hooks
  delete this.xhr.onResponse;

  const globalOptions = {
    url: 'global'
  };

  this.xhr(globalOptions, () => { });
  this.requests.shift().respond(200, { bar: 'foo' }, 'bar-foo');
});

QUnit.test('byterangeStr works as expected', function(assert) {
  assert.equal(byterangeStr({offset: 20, length: 15}), 'bytes=20-34', 'as expected');
  assert.equal(byterangeStr({offset: 0, length: 40}), 'bytes=0-39', 'as expected');

  if (window.BigInt) {
    assert.equal(
      byterangeStr({offset: window.BigInt(20), length: window.BigInt(15)}),
      'bytes=20-34',
      'bigint result as expected'
    );
    assert.equal(
      byterangeStr({offset: window.BigInt(0), length: window.BigInt(40)}),
      'bytes=0-39',
      'bigint result as expected'
    );

  }

});
