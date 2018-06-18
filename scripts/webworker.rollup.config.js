import babel from 'rollup-plugin-babel';
import commonjs from 'rollup-plugin-commonjs';
import resolve from 'rollup-plugin-node-resolve';

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
    babel()
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
    babel()
  ]
}];
