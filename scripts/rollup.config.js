const generate = require('videojs-generate-rollup-config');
const worker = require('rollup-plugin-worker-factory');
const {terser} = require('rollup-plugin-terser');
const createTestData = require('./create-test-data.js');
const replace = require('@rollup/plugin-replace');

// see https://github.com/videojs/videojs-generate-rollup-config
// for options
const options = {
  input: 'src/videojs-http-streaming.js',
  distName: 'videojs-http-streaming',
  globals(defaults) {
    defaults.browser.xmldom = 'window';
    defaults.test.xmldom = 'window';
    return defaults;
  },
  externals(defaults) {
    return Object.assign(defaults, {
      module: defaults.module.concat([
        'aes-decrypter',
        'm3u8-parser',
        'mpd-parser',
        'mux.js',
        '@videojs/vhs-utils',
        'rollup-plugin-worker-factory'
      ])
    });
  },
  plugins(defaults) {
    defaults.module.splice(0, 0, 'worker');
    defaults.browser.splice(0, 0, 'worker');
    defaults.test.splice(1, 0, 'worker');

    defaults.test.splice(0, 0, 'createTestData');

    // istanbul is only in the list for regular builds and not watch
    if (defaults.test.indexOf('istanbul') !== -1) {
      defaults.test.splice(defaults.test.indexOf('istanbul'), 1);
    }
    defaults.module.unshift('replace');

    return defaults;
  },
  primedPlugins(defaults) {
    defaults = Object.assign(defaults, {
      replace: replace({
        // single quote replace
        "require('@videojs/vhs-utils/es": "require('@videojs/vhs-utils/cjs",
        // double quote replace
        'require("@videojs/vhs-utils/es': 'require("@videojs/vhs-utils/cjs'
      }),
      uglify: terser({
        output: {comments: 'some'},
        compress: {passes: 2}
      }),
      createTestData: createTestData()
    });

    defaults.worker = worker({plugins: [
      defaults.resolve,
      defaults.json,
      defaults.commonjs
    ]});

    return defaults;
  },
  babel(defaults) {
    const presetEnvSettings = defaults.presets[0][1];

    presetEnvSettings.exclude = presetEnvSettings.exclude || [];
    presetEnvSettings.exclude.push('@babel/plugin-transform-typeof-symbol');

    return defaults;
  }
};

if (process.env.CI_TEST_TYPE) {
  if (process.env.CI_TEST_TYPE === 'playback') {
    options.testInput = 'test/playback.test.js';
  } else {
    options.testInput = {include: ['test/**/*.test.js'], exclude: ['test/playback.test.js']};
  }
}
const config = generate(options);

// Add additonal builds/customization here!

// export the builds to rollup
export default Object.values(config.builds);
