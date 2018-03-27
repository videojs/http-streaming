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
    frameworks: ['qunit', 'sinon', 'detectBrowsers'],
    client: {
      clearContext: false,
      qunit: {
        showUI: true,
        testTimeout: 5000
      }
    },
    files: [
      'node_modules/video.js/dist/video.js',
      'dist-test/videojs-http-streaming.test.js'
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
    coverageReporter: {
      reporters: [{
        type: 'text-summary'
      }]
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
    reporters: ['dots', 'coverage'],
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
};
