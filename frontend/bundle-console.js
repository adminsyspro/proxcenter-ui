#!/usr/bin/env node
/**
 * Bundle the shared console logic (src/lib/console/consoleUi.ts: viewport
 * helpers and the CD/DVD menu) into a single browser file exposing
 * window.ConsoleUI.
 *
 * The two graphical console pages (public/novnc/console.html and
 * public/spice/console.html) are static HTML served outside Next, because they
 * have to load the noVNC / spice-html5 IIFE bundles. They cannot import from
 * src/, so this is how they reach logic that is unit-tested
 * (src/lib/console/*.test.ts) instead of living inline in a <script>.
 *
 * Usage: node bundle-console.js   (re-run after editing src/lib/console/)
 */
const path = require('path')

const esbuild = require('esbuild')

async function bundle() {
  try {
    await esbuild.build({
      entryPoints: [path.join(__dirname, 'src/lib/console/consoleUi.ts')],
      // The bundle names each source by its path from here: keep it the
      // same in CI and in a git worktree whose node_modules is a symlink.
      absWorkingDir: __dirname,
      preserveSymlinks: true,
      bundle: true,
      outfile: path.join(__dirname, 'public/console/console-ui.bundle.js'),
      format: 'iife',
      globalName: 'ConsoleUI',
      platform: 'browser',
      target: ['es2020'],
      minify: false,
      sourcemap: false,
    })
    console.log('✅ console helpers bundled to public/console/console-ui.bundle.js')
  } catch (err) {
    console.error('❌ Failed to bundle console helpers:', err.message)
    process.exit(1)
  }
}
bundle()
