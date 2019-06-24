import babel from 'rollup-plugin-babel';
import commonjs from 'rollup-plugin-commonjs';
import resolve from 'rollup-plugin-node-resolve';
import path from 'path';
import presetEnv from 'babel-preset-env';
import externalHelpers from 'babel-plugin-external-helpers';

/* to prevent going into a screen during rollup */
process.stderr.isTTY = false;
export default [{
  input: 'src/decrypter-worker.js',
  output: {
    format: 'iife',
    name: 'decrypterWorker',
    file: 'src/decrypter-worker.worker.js'
  },
  plugins: [
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
  ]
}, {
  input: 'src/transmuxer-worker.js',
  output: {
    name: 'transmuxerWorker',
    file: 'src/transmuxer-worker.worker.js',
    format: 'iife'
  },
  plugins: [
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
  ]
}];
