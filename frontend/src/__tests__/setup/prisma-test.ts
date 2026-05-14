/**
 * Prisma client used by tests, plus a `truncate(...)` helper.
 *
 * Reads the DSN written by globalSetup (../setup/postgres.ts) so each test
 * worker connects to the per-run schema. Importing this module from any
 * test file is enough to share a single Prisma connection.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const DSN_FILE = path.resolve(__dirname, '..', '..', '..', '.test-dsn')

function readDsn(): string {
  try {
    const dsn = readFileSync(DSN_FILE, 'utf8').trim()

    if (!dsn) throw new Error('empty DSN')

return dsn
  } catch (err) {
    throw new Error(
      '[test/setup/prisma-test] Could not read the test DSN at ' + DSN_FILE + '. ' +
      'Run vitest with the `globalSetup` configured (vitest.config.ts) — it writes ' +
      'this file before any test starts. Underlying error: ' + (err as Error).message,
    )
  }
}

const dsn = readDsn()

/**
 * PrismaPg ignores the libpq-style `?schema=` query parameter on the
 * connection string — that's a Prisma migration / CLI extension, not a
 * pg-protocol field. The adapter only honours its own `schema` option;
 * without it, every query hits the connection's default schema (`public`),
 * which is the same one the dev server writes to. We then watched test
 * fixtures (tenant-1 / VDC1 / pve-conn / pbs-conn) bleed into the
 * developer's working database and wipe the user_tenants membership on
 * cascade when teardown dropped the test schema. Parse `schema=` out of
 * the DSN here and pass it explicitly so tests stay in their own sandbox.
 */
function extractSchema(connectionString: string): string {
  try {
    const url = new URL(connectionString)
    const fromQuery = url.searchParams.get('schema')

    if (fromQuery && fromQuery.length > 0) return fromQuery
  } catch {
    // fall through
  }


return 'public'
}

const schema = extractSchema(dsn)

// PrismaPg's first arg is the pg pool config (connectionString lives there);
// the schema goes in the second arg PrismaPgOptions.
export const prismaTest = new PrismaClient({
  adapter: new PrismaPg({ connectionString: dsn }, { schema }),
})

/**
 * TRUNCATE a list of tables, restarting their identity sequences and
 * cascading FK constraints. Use in a `beforeEach` to give each test a
 * clean slate without paying the cost of re-applying migrations.
 *
 * Example:
 *   beforeEach(() => truncate(['vdc_ipam_allocations', 'vdc_subnets', 'vdc_vnets', 'vdcs']))
 */
export async function truncate(tables: string[]): Promise<void> {
  if (tables.length === 0) return

  // $executeRawUnsafe bypasses the PrismaPg adapter's schema rewrite, so the
  // query hits the connection's default search_path (public). Qualify each
  // table name with the test schema so TRUNCATE lands on the right rows.
  const list = tables.map((t) => `"${schema}"."${t}"`).join(', ')

  await prismaTest.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`)
}
