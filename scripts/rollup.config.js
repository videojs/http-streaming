import babel from 'rollup-plugin-babel';
import commonjs from 'rollup-plugin-commonjs';
import json from 'rollup-plugin-json';
import resolve from 'rollup-plugin-node-resolve';
import uglify from 'rollup-plugin-uglify';
import worker from '@gkatsev/rollup-plugin-bundle-worker';
import { minify } from 'uglify-es';
import pkg from '../package.json';
import path from 'path';
import presetEnv from 'babel-preset-env';
import externalHelpers from 'babel-plugin-external-helpers';

const date = new Date();

/* to prevent going into a screen during rollup */
process.stderr.isTTY = false;

const banner =
  `/**
 * ${pkg.name}
 * @version ${pkg.version}
 * @copyright ${date.getFullYear()} ${pkg.author}
 * @license ${pkg.license}
 */`;

const umdPlugins = [
  json(),
  worker(),
  resolve({
    browser: true,
    main: true,
    jsnext: true
  }),
  commonjs({
    sourceMap: false
  }),
  babel({
    babelrc: false,
    exclude: path.join(process.cwd(), 'node_modules/**'),
    presets: [
      [presetEnv, {
        loose: true,
        modules: false,
        exclude: ['transform-es2015-typeof-symbol'],
        targets: {
          browsers: ['defaults', 'ie 11']
        }
      }]
    ],
    plugins: [externalHelpers]
  })
];

const externals = [
  'aes-decrypter',
  'global/document',
  'global/window',
  'm3u8-parser',
  'mpd-parser',
  'mux.js/lib/mp4',
  'mux.js/lib/mp4/probe',
  'mux.js/lib/tools/mp4-inspector',
  'mux.js/lib/tools/ts-inspector.js',
  'mux.js/lib/utils/clock',
  'url-toolkit',
  'video.js'
];

const onwarn = (warning) => {
  if (warning.code === 'UNUSED_EXTERNAL_IMPORT' ||
      warning.code === 'UNRESOLVED_IMPORT') {
    return;
  }

  // eslint-disable-next-line no-console
  console.warn(warning.message);
};

let isWatch = false;

for (let i = 0; i < process.argv.length; i++) {
  if ((/^-w|--watch$/).test(process.argv[i])) {
    isWatch = true;
    break;
  }
}

const builds = [
  /**
   * Rollup configuration for packaging the plugin in a module that is consumable
   * as the `src` of a `script` tag or via AMD or similar client-side loading.
   *
   * This module DOES include its dependencies.
   */
  {
    input: 'src/videojs-http-streaming.js',
    output: {
      name: 'videojsHttpStreaming',
      file: 'dist/videojs-http-streaming.js',
      format: 'umd',
      globals: {
        'video.js': 'videojs'
      },
      banner
    },
    external: ['video.js'],
    plugins: umdPlugins
  },

  /**
   * Rollup configuration for packaging the plugin in a module that is consumable
   * by either CommonJS (e.g. Node or Browserify) or ECMAScript (e.g. Rollup or webpack).
   *
   * These modules DO NOT include their dependencies as we expect those to be
   * handled by the module system.
   */
  {
    input: 'src/videojs-http-streaming.js',
    plugins: [
      json(),
      worker(),
      babel({
        babelrc: false,
        exclude: path.join(process.cwd(), 'node_modules/**'),
        presets: [
          [presetEnv, {
            loose: true,
            modules: false,
            exclude: ['transform-es2015-typeof-symbol'],
            targets: {
              browsers: ['defaults', 'ie 11']
            }
          }]
        ],
        plugins: [externalHelpers]
      })
    ],
    output: [{
      name: 'videojsHttpStreaming',
      file: 'dist/videojs-http-streaming.cjs.js',
      format: 'cjs',
      banner
    }],
    external: externals,
    onwarn
  }, {
    input: 'src/videojs-http-streaming.js',
    plugins: [
      json({
        preferConst: true
      }),
      worker(),
      babel({
        babelrc: false,
        exclude: path.join(process.cwd(), 'node_modules/**'),
        presets: [
          [presetEnv, {
            loose: true,
            modules: false,
            exclude: ['transform-es2015-typeof-symbol'],
            targets: {
              browsers: ['defaults', 'ie 11']
            }
          }]
        ],
        plugins: [externalHelpers]
      })
    ],
    output: [{
      name: 'videojsHttpStreaming',
      file: 'dist/videojs-http-streaming.es.js',
      format: 'es',
      banner
    }],
    external: externals,
    onwarn
  }
];

if (!isWatch) {
  builds.push({
    input: 'src/videojs-http-streaming.js',
    output: {
      name: 'videojsHttpStreaming',
      file: 'dist/videojs-http-streaming.min.js',
      format: 'umd',
      globals: {
        'video.js': 'videojs'
      },
      banner
    },
    external: ['video.js'],
    plugins: umdPlugins
    .concat([uglify({
      output: {
        comments: 'some'
      }
    }, minify)])
  });
}

export default builds;
