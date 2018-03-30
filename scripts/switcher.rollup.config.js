import worker from '@gkatsev/rollup-plugin-bundle-worker';
import babel from 'rollup-plugin-babel';
import commonjs from 'rollup-plugin-commonjs';
import resolve from 'rollup-plugin-node-resolve';

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
    format: 'umd'
  },
  plugins: [
    worker(),
    resolve({
      preferBuiltins: false,
      browser: true,
      main: true,
      jsnext: true
    }),
    commonjs({ sourceMap: false }),
    babel()
  ]
};
