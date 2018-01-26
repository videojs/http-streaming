var istanbul = require('browserify-istanbul');
var isparta = require('isparta');

module.exports = function(config) {
  config.set({
    basePath: '..',
    frameworks: ['qunit', 'browserify', 'detectBrowsers'],
    files: [
      'node_modules/sinon/pkg/sinon.js',
      'node_modules/sinon/pkg/sinon-ie.js',
      'node_modules/video.js/dist/video.js',
      'node_modules/video.js/dist/video-js.css',
      'node_modules/videojs-flash/dist/videojs-flash.js',
      'dist-test/browserify-test.js',
      'dist-test/webpack-test.js',
      'dist-test/videojs-http-streaming.js'
    ],
    browserConsoleLogOptions: {
      level: 'error',
      terminal: false
    },
    customLaunchers: {
      ChromeHeadlessWithFlags: {
        base: 'ChromeHeadless',
        flags: [
          '--mute-audio',
          '--no-sandbox',
          '--no-user-gesture-required'
        ]
      }
    },
    detectBrowsers: {
      usePhantomJS: false,

      // detect what browsers are installed on the system and
      // use headless mode and flags to allow for playback
      postDetection: function(browsers) {
        var newBrowsers = [];

        if (browsers.indexOf('Chrome') !== -1) {
          newBrowsers.push('ChromeHeadlessWithFlags');
        }

        if (browsers.indexOf('Firefox') !== -1) {
          newBrowsers.push('FirefoxHeadless');
        }

        return newBrowsers;
      }
    },
    preprocessors: {
      'test/**/*.test.js': ['browserify']
    },
    browserify: {
      debug: true,
      transform: [
        'babelify',
        ['browserify-shim', { global: true }]
      ],
      noParse: [
        'test/data/**',
      ]
    },
    babelPreprocessor: {
      options: {
        presets: ['es2015'],
        sourceMap: 'inline'
      },
      sourceFileName: function (file) {
        return file.originalPath;
      }
    },
    reporters: ['dots'],
    port: 9876,
    colors: true,
    autoWatch: false,
    singleRun: true,
    concurrency: Infinity
  });

  // Coverage reporting
  // Coverage is enabled by passing the flag --coverage to npm test
  var coverageFlag = process.env.npm_config_coverage;
  var reportCoverage = process.env.TRAVIS || coverageFlag;

  if (reportCoverage) {
    config.reporters.push('coverage');
    config.browserify.transform.push(istanbul({
      instrumenter: isparta,
      ignore: ['**/node_modules/**', '**/test/**']
    }));
    config.preprocessors['src/**/*.js'] = ['browserify', 'coverage'];
  }

};
