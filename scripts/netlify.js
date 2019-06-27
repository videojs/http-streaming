const path = require('path');
const sh = require('shelljs');

const deployDir = 'deploy';
const files = [
  'node_modules/video.js/dist/video-js.css',
  'node_modules/video.js/dist/alt/video.core.js',
  'node_modules/videojs-contrib-eme/dist/videojs-contrib-eme.js',
  'node_modules/videojs-contrib-quality-levels/dist/videojs-contrib-quality-levels.js',
  'scripts/index.js'
];

// cleanup previous deploy
sh.rm('-rf', deployDir);
// make sure the directory exists
sh.mkdir('-p', deployDir);

// create nested directories
files
  .map((file) => path.dirname(file))
  .forEach((dir) => sh.mkdir('-p', path.join(deployDir, dir)));

// copy over files, dist, and html files
files
  .concat('dist', 'index.html')
  .forEach((file) => sh.cp('-r', file, path.join(deployDir, file)));
