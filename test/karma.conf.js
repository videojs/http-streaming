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
    frameworks: ['qunit', 'detectBrowsers'],
    client: {
      clearContext: false,
      qunit: {
        showUI: true,
        testTimeout: 30000
      }
    },
    files: [
      'node_modules/sinon/pkg/sinon.js',
      'node_modules/video.js/dist/alt/video.core.js',
      'node_modules/video.js/dist/video-js.css',
      'dist-test/videojs-http-streaming.test.js'
    ],
    /*browserConsoleLogOptions: {
      level: 'error',
      terminal: false
    },*/
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
        flags: [ '--no-sandbox' ]
      },
      ChromeBrowserStack: {
        base: 'BrowserStack',
        flags: [ '--no-sandbox' ],
        browser: 'chrome',
        os: 'Windows',
        os_version: '10'
      },
      SafariBrowserStack: {
        base: 'BrowserStack',
        browser: 'safari',
        os: 'OS X',
        os_version: 'High Sierra'
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
    reporters: ['spec'],
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
