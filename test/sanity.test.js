import QUnit from 'qunit';
import videojs from 'video.js';
import window from 'global/window';
// needed for plugin registration
import '../src/videojs-http-streaming';

QUnit.module('videojs-http-streaming - sanity');

QUnit.test('the environment is sane', function(assert) {
  assert.strictEqual(typeof Array.isArray, 'function', 'es5 exists');
  assert.strictEqual(typeof sinon, 'object', 'sinon exists');
  assert.strictEqual(typeof videojs, 'function', 'videojs exists');
  assert.strictEqual(typeof window.MediaSource, 'function', 'MediaSource is a function');
  assert.strictEqual(typeof window.URL, 'function', 'URL is a function');
  assert.strictEqual(typeof videojs.Hls, 'object', 'Hls is an object');
  assert.strictEqual(typeof videojs.HlsSourceHandler,
                     'object',
                     'HlsSourceHandler is a function');
  assert.strictEqual(typeof videojs.HlsHandler, 'function', 'HlsHandler is a function');
});
