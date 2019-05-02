import json from 'rollup-plugin-json';
import babel from 'rollup-plugin-babel';
import commonjs from 'rollup-plugin-commonjs';
import resolve from 'rollup-plugin-node-resolve';
import worker from '@gkatsev/rollup-plugin-bundle-worker';
import multiEntry from "rollup-plugin-multi-entry";

export default {
  input: [
    // include the regenerator-runtime directly instead of using the whole babel polyfill
    // with core-js
    'node_modules/regenerator-runtime/runtime.js',
    'test/custom-assertions.js',
    'test/**/*.test.js'
  ],
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
    babel({
      plugins: [
        // Require plugins to allow for async/await
        //
        // Can't use string shorthands in case we're linking another module (e.g., mux.js)
        // See: https://github.com/babel/babel/issues/3969#issuecomment-286961125
        require('babel-plugin-transform-regenerator'),
        require('babel-plugin-transform-async-to-generator'),
        require('babel-plugin-syntax-async-functions')
      ]
    })
  ]
};
