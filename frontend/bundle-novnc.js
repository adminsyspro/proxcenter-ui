#!/usr/bin/env node
/**
 * Script pour bundler noVNC en un seul fichier utilisable dans le navigateur
 * Usage: node bundle-novnc.js
 */

const path = require('path');
const fs = require('fs');

const esbuild = require('esbuild');

async function bundle() {
  try {
    const pkgPath = path.join(__dirname, 'node_modules/@novnc/novnc/package.json');

    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

      console.log(`noVNC version: ${pkg.version}`);
    }

    await esbuild.build({
      // Through the package exports (core/rfb.js), not a file path: 1.6
      // dropped the CommonJS lib/ build this used to name.
      stdin: {
        contents: "export { default } from '@novnc/novnc'\n",
        resolveDir: __dirname,
        sourcefile: 'novnc-entry.js',
        loader: 'js',
      },
      // The bundle names each source by its path from here: keep it the
      // same in CI and in a git worktree whose node_modules is a symlink.
      absWorkingDir: __dirname,
      preserveSymlinks: true,
      bundle: true,
      outfile: path.join(__dirname, 'public/novnc/rfb.bundle.js'),
      // An ES module, not an IIFE: since 1.6 noVNC probes the H.264 decoder
      // with a top-level await. public/novnc/console.html imports it.
      format: 'esm',
      platform: 'browser',
      target: ['es2022'],
      minify: false,
      sourcemap: false,
    });
    console.log('✅ noVNC bundled successfully to public/novnc/rfb.bundle.js');
  } catch (error) {
    console.error('❌ Failed to bundle noVNC:', error.message);
    process.exit(1);
  }
}

bundle();
