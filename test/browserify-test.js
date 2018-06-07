/* eslint-env qunit */

const hls = require('../es5/videojs-http-streaming.js');
const q = window.QUnit;

q.module('Browserify Require');
q.test('hls should be requirable and bundled via browserify', function(assert) {
  assert.ok(hls, 'videoj-contrib-hls is required properly');
});
