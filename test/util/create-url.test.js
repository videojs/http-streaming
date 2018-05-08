/* eslint-disable prefer-const */
/* eslint-disable no-undef */
// TODO: fix above

import document from 'global/document';
import window from 'global/window';
import QUnit from 'qunit';
import sinon from 'sinon';
import videojs from 'video.js';
// import HtmlMediaSource from '../../src/mse/html-media-source';
// we disable this because browserify needs to include these files
// but the exports are not important
/* eslint-disable no-unused-vars */
// import {MediaSource, URL} from '../../src/mse';
/* eslint-disable no-unused-vars */

// TODO: Delete this file once the assumptions these tests are checking
// are migrated to another test
QUnit.module('createObjectURL', {
  beforeEach() {
    this.fixture = document.getElementById('qunit-fixture');
    this.video = document.createElement('video');
    this.fixture.appendChild(this.video);
    this.player = videojs(this.video);

    // Mock the environment's timers because certain things - particularly
    // player readiness - are asynchronous in video.js 5.
    this.clock = sinon.useFakeTimers();
    this.oldMediaSource = window.MediaSource || window.WebKitMediaSource;

    // force MediaSource support
    if (!window.MediaSource) {
      window.MediaSource = function() {
        let result = new window.Blob();

        result.addEventListener = function() {};
        result.addSourceBuffer = function() {};
        return result;
      };
    }
  },

  afterEach() {
    // The clock _must_ be restored before disposing the player; otherwise,
    // certain timeout listeners that happen inside video.js may throw errors.
    this.clock.restore();
    this.player.dispose();
    window.MediaSource = window.WebKitMediaSource = this.oldMediaSource;
  }
});

QUnit.skip('delegates to the native implementation', function(assert) {
  assert.ok(!(/blob:vjs-media-source\//).test(
    window.URL.createObjectURL(
      new window.Blob())
    ),
    'created a native blob URL'
  );
});

QUnit.skip('uses the native MediaSource when available', function(assert) {
  assert.ok(!(/blob:vjs-media-source\//).test(
    window.URL.createObjectURL(
      new HtmlMediaSource())
    ),
    'created a native blob URL'
  );
});

QUnit.skip('stores the associated blob URL on the media source', function(assert) {
  let blob = new window.Blob();
  let url = window.URL.createObjectURL(blob);

  assert.strictEqual(blob.url_, url, 'captured the generated URL');
});
