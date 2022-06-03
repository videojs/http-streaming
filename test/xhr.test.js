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
