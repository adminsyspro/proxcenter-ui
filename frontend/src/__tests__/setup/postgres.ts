/**
 * Vitest globalSetup for tests that talk to Postgres via Prisma.
 *
 * Each `npm test` run:
 *   1. Connects to the Postgres pointed to by POSTGRES_TEST_URL_BASE.
 *   2. Creates one uniquely-named schema per worker slot
 *      (`test_<timestamp>_<rand>_w1` … `_wN`, see ./test-dsn.ts).
 *   3. Runs `prisma migrate deploy` on each so they mirror prod.
 *   4. Drops them in teardown — keeps the dev DB pristine.
 *
 * ./postgres-worker.ts then points each worker's DATABASE_URL at its own
 * schema, which is what lets the node project run its files in parallel.
 *
 * Locally we point at the dev Postgres that already runs in
 * docker-compose.override.yml (127.0.0.1:5432). In CI the docker-publish
 * workflow spins a `postgres:16-alpine` service with the same DSN.
 *
 * Tests truncate the tables they touch in a `beforeEach`; the schemas
 * themselves stay in place for the entire run so we don't pay the migration
 * cost per test file.
 */

import { execFile, execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { writeFileSync, unlinkSync } from 'node:fs'
import os from 'node:os'
import { promisify } from 'node:util'

import type { TestProject } from 'vitest/node'

import { TEST_DSN_FILE, withSchema, workerSchema, type TestDsnFile } from './test-dsn'

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

// Same resolution as vitest's own pool (resolveMaxWorkers): the pool hands
// out VITEST_POOL_ID 1..maxWorkers, so that is how many schemas we need.
function resolveWorkerSlots(project: TestProject): number {
  const configured = project.config.maxWorkers || project.vitest.config.maxWorkers
  if (configured) return configured
  const cpus = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length
  return project.vitest.config.watch ? Math.max(Math.floor(cpus / 2), 1) : Math.max(cpus - 1, 1)
}

let testSchemas: string[] = []

export async function setup(project: TestProject): Promise<void> {
  const base = readBaseUrl()
  const prefix = `test_${Date.now()}_${randomBytes(3).toString('hex')}`
  const slots = resolveWorkerSlots(project)
  testSchemas = Array.from({ length: slots }, (_, i) => workerSchema(prefix, i + 1))

  // execFileSync (not execSync) so the schema names + DSN never reach a
  // shell. The values are server-generated, but we keep the safer call.
  execFileSync('psql', [base, '-c', testSchemas.map((s) => `CREATE SCHEMA "${s}";`).join(' ')], { stdio: 'inherit' })

  // Hand the DSN to test workers via a tmp file — vitest globalSetup
  // process.env mutations don't always propagate to the worker pool.
  const file: TestDsnFile = { base, prefix }
  writeFileSync(TEST_DSN_FILE, JSON.stringify(file), 'utf8')

  // ~1.5 s each, so run them side by side rather than one per slot in a row.
  await Promise.all(
    testSchemas.map((s) =>
      promisify(execFile)('npx', ['prisma', 'migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: withSchema(base, s) },
      }),
    ),
  )
}

export async function teardown(): Promise<void> {
  if (testSchemas.length === 0) return
  const base = readBaseUrl()
  try {
    execFileSync('psql', [base, '-c', testSchemas.map((s) => `DROP SCHEMA "${s}" CASCADE;`).join(' ')], { stdio: 'inherit' })
  } catch {
    // best-effort — leftover schemas are harmless and easy to spot.
  }
  try {
    unlinkSync(TEST_DSN_FILE)
  } catch {}
}
