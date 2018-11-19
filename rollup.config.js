import commonjs from 'rollup-plugin-commonjs'
import resolve from 'rollup-plugin-node-resolve'
import nodent from 'rollup-plugin-nodent'

export default {
  input: './index.js',
  output: {
    // name: 'adonisWebsocketMP',
    file: './dist/index.js',
    format: 'cjs'
  },
  plugins: [
    resolve(),
    commonjs(),
    nodent({
      promises: true,
      noRuntime: true
    })
  ]
}
