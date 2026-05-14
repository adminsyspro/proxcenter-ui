#!/usr/bin/env node
/**
 * Ensures INTERNAL_API_TOKEN is set before `next dev` / `next start` and
 * `ws-proxy.js` are spawned by `concurrently`. They run as sibling processes
 * and authenticate inter-process calls (`/api/internal/console/consume`) via
 * this shared secret.
 *
 * Resolution order:
 *   1. If process.env.INTERNAL_API_TOKEN is set (Docker entrypoint, systemd
 *      unit, CI, etc.), do nothing — the value will flow to both children.
 *   2. If .env.local already contains INTERNAL_API_TOKEN, do nothing — Next.js
 *      loads .env.local natively and ws-proxy.js reads it as a fallback.
 *   3. Otherwise generate 32 random bytes and append the line to .env.local,
 *      creating the file if needed.
 *
 * Idempotent: safe to run on every `predev` / `prestart`. Designed so a client
 * upgrading via `git pull && npm start` on bare-metal recovers automatically
 * after the security fix that made INTERNAL_API_TOKEN mandatory.
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.resolve(__dirname, '..')
const ENV_LOCAL = path.join(ROOT, '.env.local')

if (process.env.INTERNAL_API_TOKEN) {
  process.exit(0)
}

let existing = ''
try {
  existing = fs.readFileSync(ENV_LOCAL, 'utf8')
} catch (err) {
  if (err.code !== 'ENOENT') {
    console.error(`[ensure-internal-token] Failed to read ${ENV_LOCAL}: ${err.message}`)
    process.exit(1)
  }
}

if (/^INTERNAL_API_TOKEN=.+/m.test(existing)) {
  process.exit(0)
}

const token = crypto.randomBytes(32).toString('hex')
const needsLeadingNewline = existing.length > 0 && !existing.endsWith('\n')
const block = `${needsLeadingNewline ? '\n' : ''}# Auto-generated for the ws-proxy <-> Next.js internal console channel.\n# Required since the security fix on /api/internal/console/consume.\nINTERNAL_API_TOKEN=${token}\n`

try {
  fs.appendFileSync(ENV_LOCAL, block, { mode: 0o600 })
  // Tighten permissions even if the file pre-existed with looser mode.
  try { fs.chmodSync(ENV_LOCAL, 0o600) } catch {}
  console.log('[ensure-internal-token] Generated INTERNAL_API_TOKEN in .env.local')
} catch (err) {
  console.error(`[ensure-internal-token] Failed to write ${ENV_LOCAL}: ${err.message}`)
  process.exit(1)
}
