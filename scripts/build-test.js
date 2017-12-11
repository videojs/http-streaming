var browserify = require('browserify');
var fs = require('fs');
var glob = require('glob');

glob('test/**/videojs-http-streaming.test.js', function(err, files) {
  browserify(files)
    .transform('babelify')
    .transform('browserify-shim', {global: true})
    .bundle()
    .pipe(fs.createWriteStream('dist-test/videojs-http-streaming.js'));
});
