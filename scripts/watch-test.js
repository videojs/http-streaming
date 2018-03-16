var browserify = require('browserify');
var fs = require('fs');
var glob = require('glob');
var watchify = require('watchify');

glob('test/**/*.test.js', function(err, files) {
  var b = browserify(files, {
    cache: {},
    packageCache: {},
    plugin: [watchify]
  })
  .transform('babelify')
  .transform('browserify-global-shim');

  var bundle = function() {
    b.bundle().pipe(fs.createWriteStream('dist-test/videojs-http-streaming.js'));
  };

  b.on('log', function(msg) {
    process.stdout.write(msg + ' dist-test/videojs-http-streaming.js\n');
  });

  b.on('update', bundle);
  bundle();
});
