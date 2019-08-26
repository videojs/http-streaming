/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const manifestDir = path.join(__dirname, '..', 'test', 'manifests');
const manifestFilepath = path.join(__dirname, '..', 'test', 'dist', 'test-manifests.js');
let fn = 'build';

// parse args
for (let i = 0; i < process.argv.length; i++) {
  if ((/^-w|--watch$/).test(process.argv[i])) {
    fn = 'watch';
    break;
  }
}

const createTestManifest = {
  build() {
    let manifests = 'export default {\n';

    const files = fs.readdirSync(manifestDir);

    while (files.length > 0) {
      const file = path.resolve(manifestDir, files.shift());
      const extname = path.extname(file);

      if (extname === '.m3u8' || extname === '.mpd') {
        // translate this manifest
        manifests += '  \'' + path.basename(file, extname) + '\': ';
        manifests += fs.readFileSync(file, 'utf8')
          .split(/\r\n|\n/)
          // quote and concatenate
          .map((line) => '    \'' + line + '\\n\' +\n')
          .join('')
          // strip leading spaces and the trailing '+'
          .slice(4, -3);
        manifests += ',\n';
      } else {
        console.log(`Unknown file ${file} found in manifest dir ${manifestDir}`);
      }
    }

    // clean up and close the objects
    manifests = manifests.slice(0, -2);
    manifests += '\n};\n';

    fs.writeFileSync(manifestFilepath, manifests);
    console.log('Wrote test data file ' + manifestFilepath);
  },

  watch() {
    this.build();
    fs.watch(manifestDir, (event, filename) => {
      console.log('files in manifest dir were changed rebuilding manifest data');
      this.build();
    });
  }
};

createTestManifest[fn]();

