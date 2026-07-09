// One-shot: import on-disk branding/login-bg assets into Postgres.
// Usage (from the frontend container, after `prisma migrate deploy`):
//   node scripts/import-uploads-to-db.mjs
// DATABASE_URL must be set. Idempotent: safe to run more than once.
import path from 'node:path'
import { importDiskAssets } from '../.next/server/chunks/importDiskAssets.js' // resolved at build; see note

const root = path.join(process.cwd(), 'data', 'uploads')
const res = await importDiskAssets(root)
console.log(`[import-uploads] imported=${res.imported} skipped=${res.skipped}`)
process.exit(0)
