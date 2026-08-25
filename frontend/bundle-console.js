#!/usr/bin/env node
/**
 * Bundle the shared console viewport logic (src/lib/console/viewport.ts) into
 * a single browser file exposing window.ConsoleUI.
 *
 * The two graphical console pages (public/novnc/console.html and
 * public/spice/console.html) are static HTML served outside Next, because they
 * have to load the noVNC / spice-html5 IIFE bundles. They cannot import from
 * src/, so this is how they reach logic that is unit-tested
 * (src/lib/console/viewport.test.ts) instead of living inline in a <script>.
 *
 * Usage: node bundle-console.js   (re-run after editing viewport.ts)
 */
const path = require('path')

const esbuild = require('esbuild')

async function bundle() {
  try {
    await esbuild.build({
      entryPoints: [path.join(__dirname, 'src/lib/console/viewport.ts')],
      bundle: true,
      outfile: path.join(__dirname, 'public/console/console-ui.bundle.js'),
      format: 'iife',
      globalName: 'ConsoleUI',
      platform: 'browser',
      target: ['es2020'],
      minify: false,
      sourcemap: false,
    })
    console.log('✅ console viewport helpers bundled to public/console/console-ui.bundle.js')
  } catch (err) {
    console.error('❌ Failed to bundle console viewport helpers:', err.message)
    process.exit(1)
  }
}
bundle()
