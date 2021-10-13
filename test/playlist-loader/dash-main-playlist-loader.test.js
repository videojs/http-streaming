import QUnit from 'qunit';
import videojs from 'video.js';
import DashMainPlaylistLoader from '../../src/playlist-loader/dash-main-playlist-loader.js';
import {useFakeEnvironment} from '../test-helpers';
import xhrFactory from '../../src/xhr';
// import testDataManifests from 'create-test-data!manifests';

QUnit.module('Dash Main Playlist Loader', function(hooks) {
  hooks.beforeEach(function(assert) {
    this.env = useFakeEnvironment(assert);
    this.clock = this.env.clock;
    this.requests = this.env.requests;
    this.fakeVhs = {
      xhr: xhrFactory()
    };
    this.logLines = [];
    this.oldDebugLog = videojs.log.debug;
    videojs.log.debug = (...args) => {
      this.logLines.push(args.join(' '));
    };
  });

  hooks.afterEach(function(assert) {
    if (this.loader) {
      this.loader.dispose();
    }
    this.env.restore();
    videojs.log.debug = this.oldDebugLog;
  });

  QUnit.module('#start()');

  QUnit.test('multiple calls do nothing', function(assert) {
    this.loader = new DashMainPlaylistLoader('dash-many-codecs.mpd', {
      vhs: this.fakeVhs
    });
  });

});

