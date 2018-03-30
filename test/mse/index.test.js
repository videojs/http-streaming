import QUnit from 'qunit';
import sinon from 'sinon';
import videojs from 'video.js';

// we disable this because browserify needs to include these files
// but the exports are not important
/* eslint-disable no-unused-vars */
import {MediaSource, URL} from '../../src/mse/index';
/* eslint-disable no-unused-vars */

QUnit.test('the environment is sane', function(assert) {
  assert.strictEqual(typeof Array.isArray, 'function', 'es5 exists');
  assert.strictEqual(typeof sinon, 'object', 'sinon exists');
  assert.strictEqual(typeof videojs, 'function', 'videojs exists');
  assert.strictEqual(typeof videojs.MediaSource, 'function', 'plugin is a function');
});

QUnit.module('videojs-contrib-media-sources - General');

QUnit.test('Plugin is registered', function(assert) {
  assert.strictEqual(
    typeof videojs.MediaSource,
    'function',
    'MediaSource plugin is attached to videojs'
  );
  assert.strictEqual(
    typeof videojs.URL,
    'object',
    'URL plugin is attached to player'
  );
});
