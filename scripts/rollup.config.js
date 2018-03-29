import babel from 'rollup-plugin-babel';
import commonjs from 'rollup-plugin-commonjs';
import json from 'rollup-plugin-json';
import resolve from 'rollup-plugin-node-resolve';
import uglify from 'rollup-plugin-uglify';
import worker from '@gkatsev/rollup-plugin-bundle-worker';
import { minify } from 'uglify-es';
import pkg from '../package.json';

const date = new Date();

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
  babel(),
];

const onwarn = (warning) => {
  if (warning.code === 'UNUSED_EXTERNAL_IMPORT' ||
      warning.code === 'UNRESOLVED_IMPORT') {
    return;
  }

  // eslint-disable-next-line no-console
  console.warn(warning.message);
};

export default [
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
  }, {
    input: 'src/videojs-http-streaming.js',
    output: {
      name: 'videojsHttpStreaming',
      file: 'dist/videojs-http-streaming.min.js',
      format: 'umd',
      globals: {
        'video.js': 'videojs'
      },
      banner,
    },
    external: ['video.js'],
    plugins: umdPlugins
      .concat([uglify({
        output: {
          comments: 'some'
        }
      }, minify)])
  },

  /**
   * Rollup configuration for packaging the plugin in a module that is consumable
   * by either CommonJS (e.g. Node or Browserify) or ECMAScript (e.g. Rollup).
   *
   * These modules DO NOT include their dependencies as we expect those to be
   * handled by the module system.
   */
  {
    input: 'src/videojs-http-streaming.js',
    plugins: [
      json(),
      worker(),
      babel()
    ],
    output: [{
      name: 'videojsHttpStreaming',
      file: 'dist/videojs-http-streaming.cjs.js',
      format: 'cjs',
      banner
    }],
    onwarn
  }, {
    input: 'src/videojs-http-streaming.js',
    plugins: [
      json({
        preferConst: true
      }),
      worker()
    ],
    output: [{
      name: 'videojsHttpStreaming',
      file: 'dist/videojs-http-streaming.es.js',
      format: 'es',
      banner
    }],
    onwarn
  }
];
