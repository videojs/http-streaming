/* global window */
const fs = require('fs');
const path = require('path');
const manifestsDir = path.join(__dirname, '..', 'test', 'manifests');
const segmentsDir = path.join(__dirname, '..', 'test', 'segments');

const buildManifestString = function() {
  let manifests = '/* create-test-data!manifests */\n';

  manifests += 'export default {\n';

  const files = fs.readdirSync(manifestsDir);

  while (files.length > 0) {
    const file = path.resolve(manifestsDir, files.shift());
    const extname = path.extname(file);

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
  }

  // clean up and close the objects
  manifests = manifests.slice(0, -2);
  manifests += '\n};\n';

  return manifests;
};

const buildSegmentString = function() {
  const files = fs.readdirSync(segmentsDir);
  const segmentData = {};

  while (files.length > 0) {
    const file = path.resolve(segmentsDir, files.shift());
    const extname = path.extname(file);
    // read the file directly as a buffer before converting to base64
    const base64Segment = fs.readFileSync(file).toString('base64');

    segmentData[path.basename(file, extname)] = base64Segment;
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
  const base64ToUint8Array = function(base64) {
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

  const segmentsFile =
    '/* create-test-data!segments */\n' +
    "import window from 'global/window';\n" +
    'const cache = {};\n' +
    `const base64ToUint8Array = ${base64ToUint8Array.toString()};\n` +
    `const utf16CharCodesToString = ${utf16CharCodesToString.toString()};\n` +
    segmentDataExportStrings.join('\n');

  return segmentsFile;
};

/* we refer to them as .js, so that babel and other plugins can work on them */
const segmentsKey = 'create-test-data!segments.js';
const manifestsKey = 'create-test-data!manifests.js';

module.exports = function() {
  return {
    name: 'createTestData',
    resolveId(importee, importer) {
      if (importee.indexOf('create-test-data!') === 0) {
        const name = importee.split('!')[1];

        if (name.indexOf('segments') === 0) {
          this.addWatchFile(segmentsDir);

          return segmentsKey;
        }

        this.addWatchFile(manifestsDir);

        return manifestsKey;
      }
    },
    load(id) {
      // if the dir has changed, or the "key" itself is asked for
      // return it the correct content
      if (id === segmentsDir || id === segmentsKey) {
        return buildSegmentString();
      }

      if (id === manifestsDir || id === manifestsKey) {
        return buildManifestString();
      }

    }
  };
};
