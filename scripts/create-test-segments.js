/* eslint-disable no-console */
/* global window */
const fs = require('fs');
const path = require('path');

const segmentsDir = path.join(__dirname, '..', 'test', 'segments');
const segmentsFilepath = path.join(__dirname, '..', 'test', 'dist', 'test-segments.js');

const base64ToUint8Array = (base64) => {
  const decoded = window.atob(base64);
  const uint8Array = new Uint8Array(new ArrayBuffer(decoded.length));

  for (let i = 0; i < decoded.length; i++) {
    uint8Array[i] = decoded.charCodeAt(i);
  }

  return uint8Array;
};

const utf16CharCodesToString = (typedArray) => {
  let val = '';

  Array.prototype.forEach.call(typedArray, (x) => {
    val += String.fromCharCode(x);
  });

  return val;
};

let fn = 'build';

// parse args
for (let i = 0; i < process.argv.length; i++) {
  if ((/^-w|--watch$/).test(process.argv[i])) {
    fn = 'watch';
    break;
  }
}

const createTestSegments = {
  build() {
    const files = fs.readdirSync(segmentsDir);
    const segmentData = {};

    while (files.length > 0) {
      const file = path.resolve(segmentsDir, files.shift());
      const extname = path.extname(file);

      if (extname === '.ts' || extname === '.mp4' || extname === '.key') {
        // read the file directly as a buffer before converting to base64
        const base64Segment = fs.readFileSync(file).toString('base64');

        segmentData[path.basename(file, extname)] = base64Segment;
      } else {
        console.log(`Unknown file ${file} found in segments dir ${segmentsDir}`);
      }
    }

    const segmentDataExportStrings = Object.keys(segmentData).reduce((acc, key) => {
      // use a function since the segment may be cleared out on usage
      acc.push(`export const ${key} = () => {
        cache.${key} = cache.${key} || base64ToUint8Array('${segmentData[key]}');

        const dest = new Uint8Array(cache.${key}.byteLength);

        dest.set(cache.${key});
        return dest;
      };`);
      // strings can be used to fake responseText in progress events
      // when testing partial appends of data
      acc.push(`export const ${key}String = () => {
        cache.${key}String = cache.${key}String || utf16CharCodesToString(${key}());
        return cache.${key}String;
      };`);
      return acc;
    }, []);

    const segmentsFile =
      'const cache = {};\n' +
      `const base64ToUint8Array = ${base64ToUint8Array.toString()};\n` +
      `const utf16CharCodesToString = ${utf16CharCodesToString.toString()};\n` +
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
  }
};

createTestSegments[fn]();
