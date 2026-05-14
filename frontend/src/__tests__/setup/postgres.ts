/**
 * Vitest globalSetup for tests that talk to Postgres via Prisma.
 *
 * Each `npm test` run:
 *   1. Connects to the Postgres pointed to by POSTGRES_TEST_URL_BASE.
 *   2. Creates a uniquely-named schema (`test_<timestamp>_<rand>`).
 *   3. Sets DATABASE_URL=...&schema=<that schema> for the test workers.
 *   4. Runs `prisma migrate deploy` so the schema mirrors prod.
 *   5. Drops the schema in teardown — keeps the dev DB pristine.
 *
 * Locally we point at the dev Postgres that already runs in
 * docker-compose.override.yml (127.0.0.1:5432). In CI the docker-publish
 * workflow spins a `postgres:16-alpine` service with the same DSN.
 *
 * Tests truncate the tables they touch in a `beforeEach`; the schema
 * itself stays in place for the entire run so we don't pay the migration
 * cost per test file.
 */

import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { writeFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'

const TEST_DSN_FILE = path.resolve(__dirname, '..', '..', '..', '.test-dsn')

function readBaseUrl(): string {
  const base = process.env.POSTGRES_TEST_URL_BASE

  if (!base) {
    throw new Error(
      '[test/setup/postgres] POSTGRES_TEST_URL_BASE is not set. Point it at a writable\n' +
      '  Postgres instance (e.g. postgresql://proxcenter:<pass>@127.0.0.1:5432/proxcenter)\n' +
      '  before running `npm test`. CI sets this from a service container.',
    )
  }


return base
}

let testSchema = ''

export async function setup(): Promise<void> {
  const base = readBaseUrl()

  testSchema = `test_${Date.now()}_${randomBytes(3).toString('hex')}`

  // execFileSync (not execSync) so the schema name + DSN never reach a
  // shell. The values are server-generated, but we keep the safer call.
  execFileSync('psql', [base, '-c', `CREATE SCHEMA "${testSchema}"`], { stdio: 'inherit' })

  const dsn = `${base}${base.includes('?') ? '&' : '?'}schema=${testSchema}`

  process.env.DATABASE_URL = dsn

  // Hand the DSN to test workers via a tmp file — vitest globalSetup
  // process.env mutations don't always propagate to the worker pool.
  writeFileSync(TEST_DSN_FILE, dsn, 'utf8')

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: dsn },
  })
}

export async function teardown(): Promise<void> {
  if (!testSchema) return
  const base = readBaseUrl()

  try {
    execFileSync('psql', [base, '-c', `DROP SCHEMA "${testSchema}" CASCADE`], { stdio: 'inherit' })
  } catch {
    // best-effort — leftover schemas are harmless and easy to spot.
  }

  try {
    unlinkSync(TEST_DSN_FILE)
  } catch {}
}
