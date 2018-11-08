const generateKarmaConfig = require('videojs-generate-karma-config');

module.exports = function(config) {
  const options = {
    files(defaultFiles) {
      return [
        'node_modules/sinon/pkg/sinon.js',
        'node_modules/video.js/dist/alt/video.core.js',
        'node_modules/video.js/dist/video-js.css',
        'dist-test/videojs-http-streaming.test.js'
      ];
    },
    detectBrowsers: true,
    coverage: false,
    customLaunchers(defaults) {
      return Object.assign(defaults, {
        ChromeHeadlessWithFlags: {
          base: 'ChromeHeadless',
          flags: [ '--no-sandbox', '--autoplay-policy=no-user-gesture-required' ]
        }
      });
    },
    browserstackLaunchers(defaults) {
      // only test on Edge windows 10
      return {
        bsFirefox: defaults.bsFirefox,
        bsIE11Win10: defaults.bsIE11Win10,
        bsEdgeWin10: defaults.bsEdgeWin10,
        SafariBrowserStack: {
          base: 'BrowserStack',
          browser: 'safari',
          os: 'OS X',
          os_version: 'High Sierra'
        },
        ChromeBrowserStack: {
          base: 'BrowserStack',
          flags: [ '--no-sandbox' ],
          browser: 'chrome',
          os: 'Windows',
          os_version: '10'
        }
      };
    },
    browsers(aboutToRun) {
      var newBrowsers = [];

      const chromeBrowsers = aboutToRun.filter(
        (x) => /Chrome/.test(x)
      );
      const firefoxBrowsers = aboutToRun.filter(
        (x) => /Firefox/.test(x)
      );

      if (chromeBrowsers.length) {
        newBrowsers.push('ChromeHeadlessWithFlags');
      }

      if (firefoxBrowsers.length) {
        newBrowsers.push('FirefoxHeadless');
      }

      return newBrowsers;
    }
  };

  config = generateKarmaConfig(config, options);

  config.client.qunit.testTimeout = 30000;

  config.reporters = ['spec'];

  config.concurrency = 1;
};
