import json from 'rollup-plugin-json';
import babel from 'rollup-plugin-babel';
import commonjs from 'rollup-plugin-commonjs';
import resolve from 'rollup-plugin-node-resolve';
import worker from '@gkatsev/rollup-plugin-bundle-worker';
import multiEntry from 'rollup-plugin-multi-entry';
import path from 'path';
import presetEnv from 'babel-preset-env';
import externalHelpers from 'babel-plugin-external-helpers';

/* to prevent going into a screen during rollup */
process.stderr.isTTY = false;

export default {
  input: [
    'test/custom-assertions.js',
    'test/**/*.test.js'
  ],
  external: ['video.js', 'qunit', 'sinon'],
  output: {
    name: 'vhsTest',
    format: 'iife',
    file: 'dist-test/videojs-http-streaming.test.js',
    globals: {
      'qunit': 'QUnit',
      'sinon': 'sinon',
      'video.js': 'videojs'
    }
  },
  plugins: [
    multiEntry({ exports: false }),
    json(),
    worker(),
    resolve({
      preferBuiltins: false,
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
  ]
};
