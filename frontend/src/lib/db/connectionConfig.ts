/**
 * One place that turns the rendered DATABASE_URL into what each database
 * consumer of the image needs.
 *
 * Standalone installs carry no verifying sslmode: every helper returns their
 * URL untouched. The HA level-1 render carries
 * `sslmode=verify-ca&sslrootcert=/app/ha-tls/ca.crt` (plus PGSSLROOTCERT):
 *
 *   - node-postgres (runtime pool, seed, migration lock) gets an explicit
 *     `ssl: { ca, rejectUnauthorized: true }` and a URL stripped of the libpq
 *     TLS params, because pg would otherwise let the parsed URL override the
 *     explicit object. Hostname checking stays on (the node certificates carry
 *     127.0.0.1, the VIP and the node IP), which is what pg 8 already did for
 *     verify-ca, without its deprecation warning and its pending switch to
 *     libpq semantics in pg 9.
 *   - the Prisma schema engine (`prisma migrate deploy` and every other CLI
 *     command, through prisma.config.ts) does not know verify-ca/sslrootcert:
 *     it silently degrades them to `prefer` and accepts any certificate. Its
 *     verifying form is `sslmode=require&sslcert=<CA>&sslaccept=strict`.
 *
 * A verify-ca without a CA, a CA that cannot be read, or an unparseable URL
 * asking for a verifying mode is an error, never a fallback to an unverified
 * or plain connection. verify-full without a CA (or sslrootcert=system) keeps
 * verifying against the system trust store, as it did before this helper. Errors name the CA path, never the URL.
 *
 * This file is loaded outside the Next bundle too (prisma.config.ts through
 * the Prisma config loader, scripts/migrate-with-lock.js through Node type
 * stripping in the runner image): keep it to node builtins and erasable
 * TypeScript only (no enums, no path aliases).
 */
import { readFileSync } from 'node:fs'

export type DbEnv = Record<string, string | undefined>
export type ReadCaFile = (path: string) => string

export interface PoolConnectionConfig {
  connectionString: string
  ssl?: { ca?: string; rejectUnauthorized: true }
}

const VERIFYING_SSL_MODES = new Set(['verify-ca', 'verify-full'])

// libpq / pg-connection-string TLS params plus the Prisma ones, removed before
// the explicit form is written back.
const TLS_URL_PARAMS = [
  'sslmode',
  'sslrootcert',
  'sslcert',
  'sslkey',
  'sslaccept',
  'sslidentity',
  'sslnegotiation',
  'uselibpqcompat',
  'ssl',
]

// libpq keyword for "the platform trust store" instead of a CA file.
const SYSTEM_TRUST = 'system'

const readUtf8 = (path: string): string => readFileSync(path, 'utf8')

interface VerifiedTls {
  url: URL
  // null: verify against the system trust store (verify-full without a CA,
  // or sslrootcert=system); hostname checking stays on either way.
  caPath: string | null
}

function verifiedTls(connectionString: string, env: DbEnv): VerifiedTls | null {
  let url: URL

  try {
    url = new URL(connectionString)
  } catch {
    // A verifying mode we cannot honour must not reach the driver as an
    // opaque string it might connect with on weaker terms: fail closed.
    if (/sslmode=verify/i.test(connectionString)) {
      throw new Error('DATABASE_URL requests a verifying sslmode but cannot be parsed; refusing to connect without TLS verification')
    }

    // Not a URL this helper understands: hand it to the driver untouched.
    return null
  }

  const mode = url.searchParams.get('sslmode')

  if (!mode || !VERIFYING_SSL_MODES.has(mode)) return null

  const caPath = url.searchParams.get('sslrootcert') || env.PGSSLROOTCERT

  if (caPath === SYSTEM_TRUST) return { url, caPath: null }

  if (!caPath) {
    // verify-full against a public CA (managed database) needs no file;
    // verify-ca does, it is the CA-pinned mode the HA render uses.
    if (mode === 'verify-full') return { url, caPath: null }

    throw new Error(`DATABASE_URL requests sslmode=${mode} but names no CA certificate (sslrootcert or PGSSLROOTCERT)`)
  }

  return { url, caPath }
}

function readCa(caPath: string, readFile: ReadCaFile): string {
  let pem: string

  try {
    pem = readFile(caPath)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code ?? 'read error'

    throw new Error(`Database CA certificate ${caPath} cannot be read (${code}); refusing to connect without TLS verification`)
  }

  if (!pem.includes('-----BEGIN CERTIFICATE-----')) {
    throw new Error(`Database CA certificate ${caPath} holds no PEM certificate; refusing to connect without TLS verification`)
  }

  return pem
}

function stripTlsParams(url: URL): URL {
  for (const key of TLS_URL_PARAMS) url.searchParams.delete(key)

  return url
}

/** node-postgres Pool/Client config for DATABASE_URL. */
export function buildPoolConfig(
  connectionString: string,
  env: DbEnv = process.env,
  readFile: ReadCaFile = readUtf8
): PoolConnectionConfig {
  const tls = verifiedTls(connectionString, env)

  if (!tls) return { connectionString }

  const stripped = stripTlsParams(tls.url).toString()

  if (tls.caPath === null) return { connectionString: stripped, ssl: { rejectUnauthorized: true } }

  return { connectionString: stripped, ssl: { ca: readCa(tls.caPath, readFile), rejectUnauthorized: true } }
}

/** DATABASE_URL in the form the Prisma schema engine (migrate, CLI) verifies. */
export function migrationDatabaseUrl(
  connectionString: string | undefined,
  env: DbEnv = process.env,
  readFile: ReadCaFile = readUtf8
): string | undefined {
  if (connectionString === undefined) return connectionString

  const tls = verifiedTls(connectionString, env)

  if (!tls) return connectionString

  // The engine reads the file itself; reading it here first turns a missing
  // CA into the same explicit error as the runtime pool.
  if (tls.caPath !== null) readCa(tls.caPath, readFile)

  const url = stripTlsParams(tls.url)

  url.searchParams.set('sslmode', 'require')
  // Without sslcert the engine verifies against its default trust store.
  if (tls.caPath !== null) url.searchParams.set('sslcert', tls.caPath)
  url.searchParams.set('sslaccept', 'strict')

  return url.toString()
}
