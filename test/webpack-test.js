/* eslint-disable no-undef */
const hls = require('../es5/videojs-http-streaming.js');
const q = window.QUnit;

q.module('Webpack Require');
q.test('hls should be requirable and bundled via webpack', function(assert) {
  assert.ok(hls, 'videojs-http-streaming is required properly');
});
