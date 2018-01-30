const istanbul = require('browserify-istanbul');
const isparta = require('isparta');

module.exports = function(config) {
  // build out a name for browserstack
  // {TRAVIS_BUILD_NUMBER} [{TRAVIS_PULL_REQUEST} {PR_BRANCH}] {TRAVIS_BRANCH}
  var browserstackName = process.env.TRAVIS_BUILD_NUMBER;

  if (process.env.TRAVIS_PULL_REQUEST !== 'false') {
    browserstackName += ' ' + process.env.TRAVIS_PULL_REQUEST + ' ' + process.env.TRAVIS_PULL_REQUEST_BRANCH;
  }

  browserstackName +=  ' ' + process.env.TRAVIS_BRANCH;

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
    browserStack: {
      project: 'videojs-http-streaming',
      name: browserstackName,
      build: browserstackName,
      pollingTimeout: 30000,
      captureTimeout: 600,
      timeout: 600
    },
    customLaunchers: {
      ChromeHeadlessWithFlags: {
        base: 'ChromeHeadless',
        flags: [
          '--mute-audio',
          '--no-sandbox',
          '--no-user-gesture-required'
        ]
      },
      ChromeBrowserStack: {
        base: 'BrowserStack',
        flags: [
          '--mute-audio',
          '--no-sandbox',
          '--no-user-gesture-required'
        ],
        browser: 'chrome',
        os: 'Windows',
        os_version: '10'
      },
      FirefoxBrowserStack: {
        base: 'BrowserStack',
        browser: 'firefox',
        os: 'Windows',
        os_version: '10'
      },
      EdgeBrowserStack: {
        base: 'BrowserStack',
        browser: 'edge',
        os: 'Windows',
        os_version: '10'
      },
      IE11BrowserStack: {
        base: 'BrowserStack',
        browser: 'ie',
        browser_version: '11',
        os: 'Windows',
        os_version: '10'
      }
    },
    detectBrowsers: {
      usePhantomJS: false,

      // detect what browsers are installed on the system and
      // use headless mode and flags to allow for playback
      postDetection: function(browsers) {
        if (process.env.BROWSER_STACK_ACCESS_KEY) {
          return [ 'ChromeBrowserStack', 'FirefoxBrowserStack' ];
        }

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
    concurrency: 1,
    captureTimeout: 300000,
    browserNoActivityTimeout: 300000,
    browserDisconnectTimeout: 300000,
    browserDisconnectTolerance: 3
  });

  // Coverage reporting
  // Coverage is enabled by passing the flag --coverage to npm test
  const coverageFlag = process.env.npm_config_coverage;
  const reportCoverage = process.env.TRAVIS || coverageFlag;

  if (reportCoverage) {
    config.reporters.push('coverage');
    config.browserify.transform.push(istanbul({
      instrumenter: isparta,
      ignore: ['**/node_modules/**', '**/test/**']
    }));
    config.preprocessors['src/**/*.js'] = ['browserify', 'coverage'];
  }

};
