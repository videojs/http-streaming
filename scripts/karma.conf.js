const generate = require('videojs-generate-karma-config');

module.exports = function(config) {

  // see https://github.com/videojs/videojs-generate-karma-config
  // for options
  const options = {
    coverage: false,
    browserstackLaunchers(defaults) {
      delete defaults.bsSafariMojave;
      delete defaults.bsSafariElCapitan;

      return defaults;
    },
    serverBrowsers() {
      return [];
    }
  };

  config = generate(config, options);

  // any other custom stuff not supported by options here!
};
