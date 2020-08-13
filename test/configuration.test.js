import QUnit from 'qunit';
import {
  createPlayer,
  useFakeEnvironment
} from './test-helpers.js';
import videojs from 'video.js';

/* eslint-disable no-unused-vars */
// we need this so that it can register vhs with videojs
import {VhsSourceHandler, VhsHandler, Vhs} from '../src/videojs-http-streaming';
/* eslint-enable no-unused-vars */
import Config from '../src/config';

// list of posible options
// name - the proprety name
// default - the default value
// test - alternative value to verify that default is not used
// alt - another alternative value to very that test/default are not used
const options = [{
  name: 'withCredentials',
  default: false,
  test: true,
  alt: false
}, {
  name: 'limitRenditionByPlayerDimensions',
  default: true,
  test: false,
  alt: false
}, {
  name: 'useDevicePixelRatio',
  default: false,
  test: true,
  alt: false
}, {
  name: 'bandwidth',
  default: 4194304,
  test: 5,
  alt: 555
}, {
  name: 'smoothQualityChange',
  default: false,
  test: true,
  alt: false
}, {
  name: 'useBandwidthFromLocalStorage',
  default: false,
  test: true
}, {
  name: 'customTagParsers',
  default: [],
  test: [{
    expression: /#PARSER/,
    customType: 'test',
    segment: true
  }]
}, {
  name: 'customTagMappers',
  default: [],
  test: [{
    expression: /#MAPPER/,
    map(line) {
      return '#FOO';
    }
  }]
}, {
  name: 'cacheEncryptionKeys',
  default: false,
  test: true
}];

const CONFIG_KEYS = Object.keys(Config);

QUnit.module('Configuration - Deprication', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.requests = this.env.requests;
    this.clock = this.env.clock;
    this.old = {};

    CONFIG_KEYS.forEach((key) => {
      this.old[key] = Config[key];
    });

    // force the HLS tech to run
    this.old.NativeHlsSupport = videojs.Vhs.supportsNativeHls;
    videojs.Vhs.supportsNativeHls = false;
  },

  afterEach() {
    CONFIG_KEYS.forEach((key) => {
      Config[key] = this.old[key];
    });

    this.env.restore();
    videojs.Vhs.supportsNativeHls = this.old.NativeHlsSupport;
  }
});

QUnit.test('GOAL_BUFFER_LENGTH get warning', function(assert) {
  assert.equal(
    Vhs.GOAL_BUFFER_LENGTH,
    Config.GOAL_BUFFER_LENGTH,
    'Vhs.GOAL_BUFFER_LENGTH returns the default'
  );
  assert.equal(this.env.log.warn.calls, 1, 'logged a warning');
});

QUnit.test('GOAL_BUFFER_LENGTH set warning', function(assert) {
  Vhs.GOAL_BUFFER_LENGTH = 10;
  assert.equal(this.env.log.warn.calls, 1, 'logged a warning');

  assert.equal(Config.GOAL_BUFFER_LENGTH, 10, 'returns what we set it to');
});

QUnit.test('GOAL_BUFFER_LENGTH set warning and invalid', function(assert) {
  Vhs.GOAL_BUFFER_LENGTH = 'nope';
  assert.equal(this.env.log.warn.calls, 2, 'logged two warnings');

  assert.equal(Config.GOAL_BUFFER_LENGTH, 30, 'default');

  Vhs.GOAL_BUFFER_LENGTH = -1;
  assert.equal(this.env.log.warn.calls, 2, 'logged two warnings');

  assert.equal(Config.GOAL_BUFFER_LENGTH, 30, 'default');
});

QUnit.test('MAX_GOAL_BUFFER_LENGTH get warning', function(assert) {
  assert.equal(
    Vhs.MAX_GOAL_BUFFER_LENGTH,
    Config.MAX_GOAL_BUFFER_LENGTH,
    'Vhs.MAX_GOAL_BUFFER_LENGTH returns the default'
  );
  assert.equal(this.env.log.warn.calls, 1, 'logged a warning');
});

QUnit.test('MAX_GOAL_BUFFER_LENGTH set warning', function(assert) {
  Vhs.MAX_GOAL_BUFFER_LENGTH = 10;
  assert.equal(this.env.log.warn.calls, 1, 'logged a warning');

  assert.equal(Config.MAX_GOAL_BUFFER_LENGTH, 10, 'returns what we set it to');
});

QUnit.test('MAX_GOAL_BUFFER_LENGTH set warning and invalid', function(assert) {
  Vhs.MAX_GOAL_BUFFER_LENGTH = 'nope';
  assert.equal(this.env.log.warn.calls, 2, 'logged two warnings');

  assert.equal(Config.MAX_GOAL_BUFFER_LENGTH, 60, 'default');

  Vhs.MAX_GOAL_BUFFER_LENGTH = -1;
  assert.equal(this.env.log.warn.calls, 2, 'logged two warnings');

  assert.equal(Config.MAX_GOAL_BUFFER_LENGTH, 60, 'default');
});

QUnit.test('BACK_BUFFER_LENGTH get warning', function(assert) {
  assert.equal(
    Vhs.BACK_BUFFER_LENGTH,
    Config.BACK_BUFFER_LENGTH,
    'Vhs.BACK_BUFFER_LENGTH returns the default'
  );
  assert.equal(this.env.log.warn.calls, 1, 'logged a warning');
});

QUnit.test('BACK_BUFFER_LENGTH set warning', function(assert) {
  Vhs.BACK_BUFFER_LENGTH = 10;
  assert.equal(this.env.log.warn.calls, 1, 'logged a warning');

  assert.equal(Config.BACK_BUFFER_LENGTH, 10, 'returns what we set it to');
});

QUnit.test('BACK_BUFFER_LENGTH set warning and invalid', function(assert) {
  Vhs.BACK_BUFFER_LENGTH = 'nope';
  assert.equal(this.env.log.warn.calls, 2, 'logged two warnings');

  assert.equal(Config.BACK_BUFFER_LENGTH, 30, 'default');

  Vhs.BACK_BUFFER_LENGTH = -1;
  assert.equal(this.env.log.warn.calls, 2, 'logged two warnings');

  assert.equal(Config.BACK_BUFFER_LENGTH, 30, 'default');
});

QUnit.test('GOAL_BUFFER_LENGTH_RATE get warning', function(assert) {
  assert.equal(
    Vhs.GOAL_BUFFER_LENGTH_RATE,
    Config.GOAL_BUFFER_LENGTH_RATE,
    'Vhs.GOAL_BUFFER_LENGTH_RATE returns the default'
  );
  assert.equal(this.env.log.warn.calls, 1, 'logged a warning');
});

QUnit.test('GOAL_BUFFER_LENGTH_RATE set warning', function(assert) {
  Vhs.GOAL_BUFFER_LENGTH_RATE = 10;
  assert.equal(this.env.log.warn.calls, 1, 'logged a warning');

  assert.equal(Config.GOAL_BUFFER_LENGTH_RATE, 10, 'returns what we set it to');
});

QUnit.test('GOAL_BUFFER_LENGTH_RATE set warning and invalid', function(assert) {
  Vhs.GOAL_BUFFER_LENGTH_RATE = 'nope';
  assert.equal(this.env.log.warn.calls, 2, 'logged two warnings');

  assert.equal(Config.GOAL_BUFFER_LENGTH_RATE, 1, 'default');

  Vhs.GOAL_BUFFER_LENGTH_RATE = -1;
  assert.equal(this.env.log.warn.calls, 2, 'logged two warnings');

  assert.equal(Config.GOAL_BUFFER_LENGTH_RATE, 1, 'default');
});

QUnit.test('BUFFER_LOW_WATER_LINE get warning', function(assert) {
  assert.equal(
    Vhs.BUFFER_LOW_WATER_LINE,
    Config.BUFFER_LOW_WATER_LINE,
    'Vhs.BUFFER_LOW_WATER_LINE returns the default'
  );
  assert.equal(this.env.log.warn.calls, 1, 'logged a warning');
});

QUnit.test('BUFFER_LOW_WATER_LINE set warning', function(assert) {
  Vhs.BUFFER_LOW_WATER_LINE = 20;
  assert.equal(this.env.log.warn.calls, 1, 'logged a warning');

  assert.equal(Config.BUFFER_LOW_WATER_LINE, 20, 'returns what we set it to');

  // Allow setting to 0
  Vhs.BUFFER_LOW_WATER_LINE = 0;
  assert.equal(this.env.log.warn.calls, 1, 'logged a warning');

  assert.equal(Config.BUFFER_LOW_WATER_LINE, 0, 'returns what we set it to');
});

QUnit.test('BUFFER_LOW_WATER_LINE set warning and invalid', function(assert) {
  Vhs.BUFFER_LOW_WATER_LINE = 'nope';
  assert.equal(this.env.log.warn.calls, 2, 'logged two warnings');

  assert.equal(Config.BUFFER_LOW_WATER_LINE, 0, 'default');

  Vhs.BUFFER_LOW_WATER_LINE = -1;
  assert.equal(this.env.log.warn.calls, 2, 'logged two warnings');

  assert.equal(Config.BUFFER_LOW_WATER_LINE, 0, 'default');
});

QUnit.test('MAX_BUFFER_LOW_WATER_LINE get warning', function(assert) {
  assert.equal(
    Vhs.MAX_BUFFER_LOW_WATER_LINE,
    Config.MAX_BUFFER_LOW_WATER_LINE,
    'Vhs.MAX_BUFFER_LOW_WATER_LINE returns the default'
  );
  assert.equal(this.env.log.warn.calls, 1, 'logged a warning');
});

QUnit.test('MAX_BUFFER_LOW_WATER_LINE set warning', function(assert) {
  Vhs.MAX_BUFFER_LOW_WATER_LINE = 20;
  assert.equal(this.env.log.warn.calls, 1, 'logged a warning');

  assert.equal(Config.MAX_BUFFER_LOW_WATER_LINE, 20, 'returns what we set it to');

  // Allow setting to 0
  Vhs.MAX_BUFFER_LOW_WATER_LINE = 0;
  assert.equal(this.env.log.warn.calls, 1, 'logged a warning');

  assert.equal(Config.MAX_BUFFER_LOW_WATER_LINE, 0, 'returns what we set it to');
});

QUnit.test('MAX_BUFFER_LOW_WATER_LINE set warning and invalid', function(assert) {
  const defaultValue = Config.MAX_BUFFER_LOW_WATER_LINE;

  Vhs.MAX_BUFFER_LOW_WATER_LINE = 'nope';
  assert.equal(this.env.log.warn.calls, 2, 'logged two warnings');

  assert.equal(Config.MAX_BUFFER_LOW_WATER_LINE, defaultValue, 'default');

  Vhs.MAX_BUFFER_LOW_WATER_LINE = -1;
  assert.equal(this.env.log.warn.calls, 2, 'logged two warnings');

  assert.equal(Config.MAX_BUFFER_LOW_WATER_LINE, defaultValue, 'default');
});

QUnit.test('BUFFER_LOW_WATER_LINE_RATE get warning', function(assert) {
  assert.equal(
    Vhs.BUFFER_LOW_WATER_LINE_RATE,
    Config.BUFFER_LOW_WATER_LINE_RATE,
    'Vhs.BUFFER_LOW_WATER_LINE_RATE returns the default'
  );
  assert.equal(this.env.log.warn.calls, 1, 'logged a warning');
});

QUnit.test('BUFFER_LOW_WATER_LINE_RATE set warning', function(assert) {
  Vhs.BUFFER_LOW_WATER_LINE_RATE = 10;
  assert.equal(this.env.log.warn.calls, 1, 'logged a warning');

  assert.equal(Config.BUFFER_LOW_WATER_LINE_RATE, 10, 'returns what we set it to');
});

QUnit.test('BUFFER_LOW_WATER_LINE_RATE set warning and invalid', function(assert) {
  Vhs.BUFFER_LOW_WATER_LINE_RATE = 'nope';
  assert.equal(this.env.log.warn.calls, 2, 'logged two warnings');

  assert.equal(Config.BUFFER_LOW_WATER_LINE_RATE, 1, 'default');

  Vhs.BUFFER_LOW_WATER_LINE_RATE = -1;
  assert.equal(this.env.log.warn.calls, 2, 'logged two warnings');

  assert.equal(Config.BUFFER_LOW_WATER_LINE_RATE, 1, 'default');
});

QUnit.module('Configuration - Options', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.requests = this.env.requests;
    this.clock = this.env.clock;
    this.old = {};

    // force the HLS tech to run
    this.old.NativeHlsSupport = videojs.Vhs.supportsNativeHls;
    videojs.Vhs.supportsNativeHls = false;
  },

  afterEach() {
    this.env.restore();
    videojs.Vhs.supportsNativeHls = this.old.NativeHlsSupport;

    this.player.dispose();
    videojs.options.vhs = {};

  }
});

options.forEach((opt) => {
  QUnit.test(`default ${opt.name}`, function(assert) {
    this.player = createPlayer();
    this.player.src({
      src: 'http://example.com/media.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });
    this.clock.tick(1);

    const vhs = this.player.tech_.vhs;

    assert.deepEqual(
      vhs.options_[opt.name],
      opt.default,
      `${opt.name} should be default`
    );
  });

  QUnit.test(`global ${opt.name}`, function(assert) {
    videojs.options.vhs[opt.name] = opt.test;
    this.player = createPlayer();
    this.player.src({
      src: 'http://example.com/media.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });
    this.clock.tick(1);
    const vhs = this.player.tech_.vhs;

    assert.equal(
      vhs.options_[opt.name],
      opt.test,
      `${opt.name} should be equal to global`
    );
  });

  QUnit.test(`sourceHandler ${opt.name}`, function(assert) {
    const sourceHandlerOptions = {html5: {vhs: {}}};

    sourceHandlerOptions.html5.vhs[opt.name] = opt.test;
    this.player = createPlayer(sourceHandlerOptions);
    this.player.src({
      src: 'http://example.com/media.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });
    this.clock.tick(1);

    const vhs = this.player.tech_.vhs;

    assert.deepEqual(
      vhs.options_[opt.name],
      opt.test,
      `${opt.name} should be equal to sourceHandler Option`
    );
  });

  QUnit.test(`src ${opt.name}`, function(assert) {
    const srcOptions = {
      src: 'http://example.com/media.m3u8',
      type: 'application/vnd.apple.mpegurl'
    };

    srcOptions[opt.name] = opt.test;
    this.player = createPlayer();
    this.player.src(srcOptions);
    this.clock.tick(1);

    const vhs = this.player.tech_.vhs;

    assert.deepEqual(
      vhs.options_[opt.name],
      opt.test,
      `${opt.name} should be equal to src option`
    );
  });

  QUnit.test(`srcHandler overrides global ${opt.name}`, function(assert) {
    const sourceHandlerOptions = {html5: {vhs: {}}};

    sourceHandlerOptions.html5.vhs[opt.name] = opt.test;
    videojs.options.vhs[opt.name] = opt.alt;
    this.player = createPlayer(sourceHandlerOptions);
    this.player.src({
      src: 'http://example.com/media.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });
    this.clock.tick(1);

    const vhs = this.player.tech_.vhs;

    assert.deepEqual(
      vhs.options_[opt.name],
      opt.test,
      `${opt.name} should be equal to sourceHandler option`
    );
  });

  QUnit.test(`src overrides sourceHandler ${opt.name}`, function(assert) {
    const sourceHandlerOptions = {html5: {vhs: {}}};
    const srcOptions = {
      src: 'http://example.com/media.m3u8',
      type: 'application/vnd.apple.mpegurl'
    };

    sourceHandlerOptions.html5.vhs[opt.name] = opt.alt;
    srcOptions[opt.name] = opt.test;
    this.player = createPlayer(sourceHandlerOptions);
    this.player.src(srcOptions);
    this.clock.tick(1);

    const vhs = this.player.tech_.vhs;

    assert.deepEqual(
      vhs.options_[opt.name],
      opt.test,
      `${opt.name} should be equal to sourceHandler option`
    );
  });
});
