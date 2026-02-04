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
      entryPoints: [path.join(__dirname, 'node_modules/@novnc/novnc/lib/rfb.js')],
      bundle: true,
      outfile: path.join(__dirname, 'public/novnc/rfb.bundle.js'),
      format: 'iife',
      globalName: 'noVNC',
      platform: 'browser',
      target: ['es2020'],
      minify: false,
      sourcemap: false,
      footer: {
        js: 'window.RFB = noVNC.default;'
      }
    });
    console.log('✅ noVNC bundled successfully to public/novnc/rfb.bundle.js');
  } catch (error) {
    console.error('❌ Failed to bundle noVNC:', error.message);
    process.exit(1);
  }
}

bundle();
