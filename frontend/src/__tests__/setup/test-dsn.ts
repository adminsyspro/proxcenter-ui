/**
 * Where a test worker finds its Postgres schema.
 *
 * globalSetup (./postgres.ts) creates one schema per vitest worker slot,
 * `<prefix>_w1` … `<prefix>_wN`, and writes the base DSN + prefix to
 * TEST_DSN_FILE. Vitest hands each running file a VITEST_POOL_ID in 1..N
 * that no other file holds at the same time, so the files sharing a schema
 * always run one after the other and their `truncate()` calls never race.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

export const TEST_DSN_FILE = path.resolve(__dirname, '..', '..', '..', '.test-dsn')

export interface TestDsnFile {
  base: string
  prefix: string
}

export function withSchema(base: string, schema: string): string {
  return `${base}${base.includes('?') ? '&' : '?'}schema=${schema}`
}

export function workerSchema(prefix: string, poolId: string | number): string {
  return `${prefix}_w${poolId}`
}

export function workerTestDsn(): string {
  let file: TestDsnFile
  try {
    file = JSON.parse(readFileSync(TEST_DSN_FILE, 'utf8'))
  } catch (err) {
    throw new Error(
      '[test/setup/test-dsn] Could not read the test DSN at ' + TEST_DSN_FILE + '. ' +
      'Run vitest with the `globalSetup` configured (vitest.config.ts) — it writes ' +
      'this file before any test starts. Underlying error: ' + (err as Error).message,
    )
  }
  return withSchema(file.base, workerSchema(file.prefix, process.env.VITEST_POOL_ID ?? '1'))
}
