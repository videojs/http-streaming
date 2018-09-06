const path = require('path');
const sh = require('shelljs');
const fs = require('fs');

const vjs = 'node_modules/video.js/dist/alt/video.core.js';
const vjsCss = 'node_modules/video.js/dist/video-js.css';
const eme = 'node_modules/videojs-contrib-eme/dist/videojs-contrib-eme.js';
const deployDir = 'deploy';
const files = [vjs, vjsCss, eme];

// cleanup previous deploy
sh.rm('-rf', deployDir);
// make sure the directory exists
sh.mkdir('-p', deployDir);

// create nested directories for the main files
files
.map((file) => path.dirname(file))
.forEach((dir) => sh.mkdir('-p', path.join(deployDir, dir)));

// copy over files, dist, and html files
files
.concat('dist', 'index.html', 'index.min.html')
.forEach((file) => sh.cp('-r', file, path.join(deployDir, file)));
