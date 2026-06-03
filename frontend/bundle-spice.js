#!/usr/bin/env node
/**
 * Bundle spice-html5 into a single browser file exposing window.SpiceMainConn.
 * Vendored from https://gitlab.freedesktop.org/spice/spice-html5 @ fea5c028b0e9ec2d2845fb766e8f91e40df94a47.
 * Usage: node bundle-spice.js
 */
const path = require('path')
const esbuild = require('esbuild')

async function bundle() {
  try {
    await esbuild.build({
      entryPoints: [path.join(__dirname, 'vendor/spice-html5/main.js')],
      bundle: true,
      outfile: path.join(__dirname, 'public/spice/spice.bundle.js'),
      format: 'iife',
      globalName: 'SpiceHtml5',
      platform: 'browser',
      target: ['es2020'],
      minify: false,
      sourcemap: false,
      footer: { js: 'window.SpiceMainConn = SpiceHtml5.SpiceMainConn;' },
    })
    console.log('✅ spice-html5 bundled to public/spice/spice.bundle.js')
  } catch (err) {
    console.error('❌ Failed to bundle spice-html5:', err.message)
    process.exit(1)
  }
}
bundle()
