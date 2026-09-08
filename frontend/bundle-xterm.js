#!/usr/bin/env node
/**
 * Bundle xterm.js + the fit addon into a single browser file exposing
 * window.XtermLib, and copy the stylesheet next to it.
 *
 * The node shell pop-out (public/xterm/console.html) is static HTML served
 * outside Next, so it cannot import from src/. It used to pull xterm from
 * jsdelivr, which breaks every air-gapped install; this is the same local
 * bundle treatment noVNC and spice-html5 already get.
 *
 * Usage: node bundle-xterm.js   (re-run after bumping xterm)
 */
const fs = require('fs')
const path = require('path')

const esbuild = require('esbuild')

async function bundle() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'node_modules/xterm/package.json'), 'utf8'))

    console.log(`xterm version: ${pkg.version}`)

    await esbuild.build({
      stdin: {
        contents: "export { Terminal } from 'xterm'\nexport { FitAddon } from '@xterm/addon-fit'\n",
        resolveDir: __dirname,
        sourcefile: 'xterm-entry.js',
        loader: 'js',
      },
      bundle: true,
      outfile: path.join(__dirname, 'public/xterm/xterm.bundle.js'),
      format: 'iife',
      globalName: 'XtermLib',
      platform: 'browser',
      target: ['es2020'],
      minify: false,
      sourcemap: false,
    })
    console.log('✅ xterm bundled successfully to public/xterm/xterm.bundle.js')

    fs.copyFileSync(
      path.join(__dirname, 'node_modules/xterm/css/xterm.css'),
      path.join(__dirname, 'public/xterm/xterm.css')
    )
    console.log('✅ xterm stylesheet copied to public/xterm/xterm.css')
  } catch (error) {
    console.error('❌ Failed to bundle xterm:', error.message)
    process.exit(1)
  }
}
bundle()
