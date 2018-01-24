var istanbul = require('browserify-istanbul');
var isparta = require('isparta');

module.exports = function(config) {


  if (process.env.TRAVIS) {
    config.browsers = ['ChromeHeadlessNoSandbox'];
  } else {
    config.browsers = ['ChromeHeadlessNoSandbox', 'ChromeCanaryHeadlessNoSandbox', 'FirefoxHeadless'];
  }

  // If no browsers are specified, we enable `karma-detect-browsers`
  // this will detect all browsers that are available for testing
  config.set({
    basePath: '..',
    frameworks: ['qunit', 'browserify'],
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
      ChromeHeadlessNoSandbox: {
        base: 'ChromeHeadless',
        flags: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required']
      },
      ChromeCanaryHeadlessNoSandbox: {
        base: 'ChromeCanaryHeadless',
        flags: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
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
