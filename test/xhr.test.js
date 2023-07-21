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
  assert.equal(this.env.log.warn.calls, 1, 'warning logged for deprecation');

  videojs.Vhs.xhr.beforeRequest = (options) => {
    options.url = 'global';
    return options;
  };

  this.xhr(defaultOptions);
  assert.equal(this.requests.shift().url, 'player', 'prioritizes player override');
  assert.equal(this.env.log.warn.calls, 1, 'warning logged for deprecation');

  delete this.xhr.beforeRequest;

  this.xhr(defaultOptions);
  assert.equal(this.requests.shift().url, 'global', 'url changed with global override');
  assert.equal(this.env.log.warn.calls, 1, 'warning logged for deprecation');

  delete videojs.Vhs.xhr.beforeRequest;
});

QUnit.test('beforeRequest can return a new options object', function(assert) {
  const defaultOptions = {
    url: 'default'
  };

  this.xhr(defaultOptions);
  assert.equal(this.requests.shift().url, 'default', 'url the same without override');

  videojs.Vhs.xhr.beforeRequest = () => {
    return { uri: 'global-newOptions'};
  };

  this.xhr(defaultOptions);
  assert.equal(this.requests.shift().url, 'global-newOptions', 'url changed with global override');
  assert.equal(this.env.log.warn.calls, 1, 'warning logged for deprecation');

  this.xhr.beforeRequest = () => {
    return { uri: 'player-newOptions'};
  };

  this.xhr(defaultOptions);
  assert.equal(this.requests.shift().url, 'player-newOptions', 'url changed with player override');
  assert.equal(this.env.log.warn.calls, 1, 'warning logged for deprecation');

  delete this.xhr.beforeRequest;
  delete videojs.Vhs.xhr.beforeRequest;

  this.xhr(defaultOptions);
  assert.equal(this.requests.shift().url, 'default', 'url the same without override');
});

QUnit.test('calls global and player onRequest hooks respectively', function(assert) {
  const defaultOptions = {
    url: 'default'
  };

  this.xhr(defaultOptions);
  let xhrRequest = this.requests.shift();

  // create the global onRequest set and 2 hooks
  videojs.Vhs.xhr._requestCallbackSet = new Set();
  const globalRequestHook1 = (options) => {
    options.url = 'global';
    return options;
  };
  const globalRequestHook2 = (options) => {
    options.headers = {
      foo: 'bar'
    };
    return options;
  };

  // add them to the set
  videojs.Vhs.xhr._requestCallbackSet.add(globalRequestHook1);
  videojs.Vhs.xhr._requestCallbackSet.add(globalRequestHook2);

  this.xhr(defaultOptions);
  xhrRequest = this.requests.shift();

  assert.equal(xhrRequest.url, 'global', 'url changed with global onRequest hooks');
  assert.equal(xhrRequest.headers.foo, 'bar', 'headers changed with global onRequest hooks');

  // create the player onRequest set and 2 hooks
  this.xhr._requestCallbackSet = new Set();
  const playerRequestHook1 = (options) => {
    options.url = 'player';
    return options;
  };
  const playerRequestHook2 = (options) => {
    options.headers = {
      bar: 'foo'
    };
    return options;
  };

  // add them to the set
  this.xhr._requestCallbackSet.add(playerRequestHook1);
  this.xhr._requestCallbackSet.add(playerRequestHook2);

  this.xhr(defaultOptions);
  xhrRequest = this.requests.shift();

  // player level request hooks override global
  assert.equal(xhrRequest.url, 'player', 'url changed with player onRequest hooks');
  assert.equal(xhrRequest.headers.bar, 'foo', 'headers changed with player onRequest hooks');

  // delete player level request hooks and check to ensure global are still used
  delete this.xhr._requestCallbackSet;
  this.xhr(defaultOptions);
  xhrRequest = this.requests.shift();
  assert.equal(xhrRequest.url, 'global', 'url changed with player onRequest hooks');
  assert.equal(xhrRequest.headers.foo, 'bar', 'headers changed with player onRequest hooks');

  delete videojs.Vhs.xhr._requestCallbackSet;
  this.xhr(defaultOptions);
  xhrRequest = this.requests.shift();
  assert.notEqual(xhrRequest.headers.foo, 'bar', 'headers the same without onRequest hooks');
});

QUnit.test('xhr calls global and player onResponse hooks respectively', function(assert) {
  const done = assert.async();
  const defaultOptions = {
    url: 'default'
  };
  let globalHookCallCount = 0;

  // Create global onResponse set and 2 hooks
  videojs.Vhs.xhr._responseCallbackSet = new Set();
  const globalOnResponseHook1 = (request, error, response) => {
    globalHookCallCount++;
  };
  const globalOnResponseHook2 = (request, error, response) => {
    globalHookCallCount++;
  };

  videojs.Vhs.xhr._responseCallbackSet.add(globalOnResponseHook1);
  videojs.Vhs.xhr._responseCallbackSet.add(globalOnResponseHook2);

  // Create player onResponse set and 2 hooks
  this.xhr._responseCallbackSet = new Set();
  const playerOnResponseHook1 = (request, error, response) => {
    assert.equal(response.body, 'foo-bar', 'expected response body');
    assert.equal(response.method, 'GET', 'expected method');
  };
  const playerOnResponseHook2 = (request, error, response) => {
    assert.equal(response.headers.foo, 'bar', 'expected headers');
    assert.equal(response.statusCode, 200, 'expected statusCode');
    assert.equal(globalHookCallCount, 0, 'global response hooks not called yet');
    done();
  };

  this.xhr._responseCallbackSet.add(playerOnResponseHook1);
  this.xhr._responseCallbackSet.add(playerOnResponseHook2);

  this.xhr(defaultOptions, () => { });
  this.requests.shift().respond(200, { foo: 'bar' }, 'foo-bar');
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
