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

  delete videojs.Vhs.xhr.beforeRequest;
});

QUnit.test('xhr calls beforeResponse', function(assert) {
  const done = assert.async();
  const defaultOptions = {
    url: 'default'
  };

  // Set player beforeResponse
  this.xhr.beforeResponse = (response) => {
    assert.equal(response.body, 'foo-bar', 'expected response body');
    assert.equal(response.method, 'GET', 'expected method');
    assert.equal(response.headers.foo, 'bar', 'expected headers');
    assert.equal(response.statusCode, 200, 'expected statusCode');
    assert.equal(response.url, 'default', 'expected URL');
  };

  // Set global beforeResponse
  videojs.Vhs.xhr.beforeResponse = (response) => {
    assert.equal(response.body, 'bar-foo', 'expected response body');
    assert.equal(response.method, 'GET', 'expected method');
    assert.equal(response.headers.bar, 'foo', 'expected headers');
    assert.equal(response.statusCode, 200, 'expected statusCode');
    assert.equal(response.url, 'global', 'expected URL');
    done();
  };

  this.xhr(defaultOptions, () => { });
  this.requests.shift().respond(200, { foo: 'bar' }, 'foo-bar');

  delete this.xhr.beforeResponse;

  const globalOptions = {
    url: 'global'
  };

  this.xhr(globalOptions, () => { });
  this.requests.shift().respond(200, { bar: 'foo' }, 'bar-foo');

  delete videojs.Vhs.xhr.beforeResponse;
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
