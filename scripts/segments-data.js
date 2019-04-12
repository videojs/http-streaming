const fs = require('fs');
const path = require('path');

const basePath  = path.resolve(__dirname, '..');
const testDir = path.join(basePath, 'test');
const segmentsDir = path.join(testDir, 'segments');
const segmentsFilepath = path.join(testDir, 'test-segments.js');

const base64ToUint8Array = (base64) => {
  const decoded = window.atob(base64);
  const uint8Array = new Uint8Array(new ArrayBuffer(decoded.length));

  for(let i = 0; i < decoded.length; i++) {
    uint8Array[i] = decoded.charCodeAt(i);
  }

  return uint8Array;
};

module.exports = {
  build() {
    const files = fs.readdirSync(segmentsDir);
    const segmentData = {};

    while (files.length > 0) {
      const file = path.resolve(segmentsDir, files.shift());
      const extname = path.extname(file);

      if (extname === '.ts' || extname === '.mp4') {
        // read the file directly as a buffer before converting to base64
        const base64Segment = fs.readFileSync(file).toString('base64');

        segmentData[path.basename(file, extname)] = base64Segment;
      } else {
        console.log(`Unknown file ${file} found in segments dir ${segmentsDir}`);
      }
    }

    const segmentDataExportStrings = Object.keys(segmentData).reduce((acc, key) => {
      // use a function since the segment may be cleared out on usage
      acc.push(`export const ${key} = () => base64ToUint8Array('${segmentData[key]}');`);
      return acc;
    }, []);

    let segmentsFile =
      `const base64ToUint8Array = ${base64ToUint8Array.toString()};\n` +
      segmentDataExportStrings.join('\n');

    fs.writeFileSync(segmentsFilepath, segmentsFile);
    console.log('Wrote test data file ' + segmentsFilepath);
  },

  watch() {
    this.build();
    fs.watch(segmentsDir, (event, filename) => {
      console.log('files in segments dir were changed rebuilding segments data');
      this.build();
    });
  },

  clean() {
    if (fs.existsSync(segmentsFilepath)) {
      try {
        fs.unlinkSync(segmentsFilepath);
      } catch(e) {
        console.log(e);
      }
    }
  }
};
