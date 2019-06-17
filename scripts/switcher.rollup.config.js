import worker from '@gkatsev/rollup-plugin-bundle-worker';
import babel from 'rollup-plugin-babel';
import commonjs from 'rollup-plugin-commonjs';
import resolve from 'rollup-plugin-node-resolve';
import json from 'rollup-plugin-json';
import path from 'path';
import presetEnv from 'babel-preset-env';
import externalHelpers from 'babel-plugin-external-helpers';

/* to prevent going into a screen during rollup */
process.stderr.isTTY = false;
/**
 * Rollup configuration for packaging the plugin in a module that is consumable
 * as the `src` of a `script` tag or via AMD or similar client-side loading.
 *
 * This module DOES include its dependencies.
 */
export default {
  input: 'utils/switcher/switcher.js',
  output: {
    name: 'switcher',
    file: 'dist-test/switcher.js',
    format: 'umd',
    globals: {
      'sinon': 'sinon',
      'video.js': 'videojs'
    }
  },
  external: ['video.js', 'sinon'],
  plugins: [
    json(),
    worker(),
    resolve({
      preferBuiltins: false,
      browser: true,
      main: true,
      jsnext: true
    }),
    commonjs({ sourceMap: false }),
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
  ]
};
