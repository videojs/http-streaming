/* eslint-disable no-var */
/* eslint-env qunit */

/* eslint-disable no-undef */
// TODO: fix above

var hls = require('../es5/videojs-http-streaming.js');
var q = window.QUnit;

q.module('Browserify Require');
q.test('hls should be requirable and bundled via browserify', function(assert) {
  assert.ok(hls, 'videoj-contrib-hls is required properly');
});
