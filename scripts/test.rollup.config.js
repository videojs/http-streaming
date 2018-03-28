import json from 'rollup-plugin-json';
import babel from 'rollup-plugin-babel';
import commonjs from 'rollup-plugin-commonjs';
import resolve from 'rollup-plugin-node-resolve';
import worker from '@gkatsev/rollup-plugin-bundle-worker';
import multiEntry from "rollup-plugin-multi-entry";

export default {
  input: 'test/**/*.test.js',
  external: ['video.js', 'qunit', 'sinon'],
  output: {
    name: 'vhsTest',
    format: 'iife',
    file: 'dist-test/videojs-http-streaming.test.js',
    globals: {
      qunit: 'QUnit',
      sinon: 'sinon',
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
    babel()
  ]
};
