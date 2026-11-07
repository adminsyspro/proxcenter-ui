import { randomBytes } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { buildPoolConfig, migrationDatabaseUrl } from './connectionConfig'

const CA_PEM = '-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----\n'
const CA_PATH = '/app/ha-tls/ca.crt'

// Generated per run: never a real credential.
const PASSWORD = randomBytes(16).toString('hex')
const BASE = `postgresql://proxcenter_app:${PASSWORD}@127.0.0.1:5432/proxcenter?schema=public`
const HA_URL = `${BASE}&sslmode=verify-ca&sslrootcert=${CA_PATH}`
const STANDALONE_URL = 'postgresql://proxcenter:secret@postgres:5432/proxcenter?schema=public'

const readCa = (path: string): string => {
  if (path === CA_PATH) return CA_PEM
  const err = new Error(`ENOENT: no such file or directory, open '${path}'`) as NodeJS.ErrnoException

  err.code = 'ENOENT'
  throw err
}

describe('buildPoolConfig', () => {
  it('keeps a standalone URL byte for byte and adds no TLS', () => {
    expect(buildPoolConfig(STANDALONE_URL, {}, readCa)).toEqual({ connectionString: STANDALONE_URL })
  })

  it('leaves the modes that do not verify to node-postgres', () => {
    for (const mode of ['disable', 'prefer', 'require', 'no-verify']) {
      const url = `${STANDALONE_URL}&sslmode=${mode}`

      expect(buildPoolConfig(url, {}, readCa)).toEqual({ connectionString: url })
    }
  })

  it('turns the HA URL into TLS with the cluster CA and verification on', () => {
    const cfg = buildPoolConfig(HA_URL, {}, readCa)

    expect(cfg.ssl).toEqual({ ca: CA_PEM, rejectUnauthorized: true })
    expect(cfg.ssl).not.toHaveProperty('checkServerIdentity')
    expect(cfg.connectionString).toBe(BASE)
  })

  it('treats verify-full the same way', () => {
    const cfg = buildPoolConfig(`${BASE}&sslmode=verify-full&sslrootcert=${CA_PATH}`, {}, readCa)

    expect(cfg.ssl).toEqual({ ca: CA_PEM, rejectUnauthorized: true })
  })

  it('strips sslnegotiation along with the other TLS params', () => {
    const cfg = buildPoolConfig(`${HA_URL}&sslnegotiation=direct`, {}, readCa)

    expect(cfg.connectionString).toBe(BASE)
  })

  it('keeps verify-full without a CA on system trust with verification on', () => {
    const cfg = buildPoolConfig(`${BASE}&sslmode=verify-full`, {}, readCa)

    expect(cfg).toEqual({ connectionString: BASE, ssl: { rejectUnauthorized: true } })
  })

  it('maps sslrootcert=system to system trust instead of reading a file', () => {
    const cfg = buildPoolConfig(`${BASE}&sslmode=verify-full&sslrootcert=system`, {}, readCa)

    expect(cfg).toEqual({ connectionString: BASE, ssl: { rejectUnauthorized: true } })
  })

  it('fails closed on an unparseable URL that asks for a verifying mode', () => {
    let message = ''

    try {
      buildPoolConfig(`postgresql://u:${PASSWORD}@[bad/db?sslmode=verify-ca`, {}, readCa)
    } catch (err) {
      message = (err as Error).message
    }

    expect(message).toMatch(/cannot be parsed/)
    expect(message).not.toContain(PASSWORD)
  })

  it('passes an unparseable URL without a verifying mode through untouched', () => {
    expect(buildPoolConfig('not a url', {}, readCa)).toEqual({ connectionString: 'not a url' })
  })

  it('falls back to PGSSLROOTCERT when the URL names no CA', () => {
    const cfg = buildPoolConfig(`${BASE}&sslmode=verify-ca`, { PGSSLROOTCERT: CA_PATH }, readCa)

    expect(cfg.ssl?.ca).toBe(CA_PEM)
  })

  it('refuses a verifying mode without any CA instead of connecting unverified', () => {
    expect(() => buildPoolConfig(`${BASE}&sslmode=verify-ca`, {}, readCa)).toThrow(/sslrootcert or PGSSLROOTCERT/)
  })

  it('refuses a missing CA file with an explicit error that never carries the password', () => {
    const url = `${BASE}&sslmode=verify-ca&sslrootcert=/missing/ca.crt`
    let message = ''

    try {
      buildPoolConfig(url, {}, readCa)
    } catch (err) {
      message = (err as Error).message
    }

    expect(message).toMatch(/\/missing\/ca\.crt.*ENOENT/)
    expect(message).not.toContain(PASSWORD)
  })

  it('refuses a CA file that holds no PEM certificate', () => {
    expect(() => buildPoolConfig(HA_URL, {}, () => 'garbage')).toThrow(/no PEM certificate/)
  })
})

describe('migrationDatabaseUrl', () => {
  it('keeps a standalone URL byte for byte', () => {
    expect(migrationDatabaseUrl(STANDALONE_URL, {}, readCa)).toBe(STANDALONE_URL)
    expect(migrationDatabaseUrl(`${STANDALONE_URL}&sslmode=require`, {}, readCa)).toBe(`${STANDALONE_URL}&sslmode=require`)
  })

  it('passes an unset URL through, as prisma generate loads the config without one', () => {
    expect(migrationDatabaseUrl(undefined, {}, readCa)).toBeUndefined()
  })

  it('rewrites the HA URL into the form the Prisma schema engine verifies', () => {
    const out = new URL(migrationDatabaseUrl(HA_URL, {}, readCa) as string)

    expect(out.searchParams.get('sslmode')).toBe('require')
    expect(out.searchParams.get('sslcert')).toBe(CA_PATH)
    expect(out.searchParams.get('sslaccept')).toBe('strict')
    expect(out.searchParams.has('sslrootcert')).toBe(false)
    expect(out.searchParams.get('schema')).toBe('public')
    expect(decodeURIComponent(out.password)).toBe(PASSWORD)
    expect(out.hostname).toBe('127.0.0.1')
  })

  it('uses system trust and strict verification for verify-full without a CA', () => {
    const out = new URL(migrationDatabaseUrl(`${BASE}&sslmode=verify-full&sslnegotiation=direct`, {}, readCa) as string)

    expect(out.searchParams.get('sslmode')).toBe('require')
    expect(out.searchParams.get('sslaccept')).toBe('strict')
    expect(out.searchParams.has('sslcert')).toBe(false)
    expect(out.searchParams.has('sslnegotiation')).toBe(false)
  })

  it('fails closed on an unparseable URL that asks for a verifying mode', () => {
    expect(() => migrationDatabaseUrl('postgresql://u:p@[bad/db?sslmode=verify-full', {}, readCa)).toThrow(/cannot be parsed/)
  })

  it('uses PGSSLROOTCERT when the URL names no CA', () => {
    const out = new URL(migrationDatabaseUrl(`${BASE}&sslmode=verify-full`, { PGSSLROOTCERT: CA_PATH }, readCa) as string)

    expect(out.searchParams.get('sslcert')).toBe(CA_PATH)
  })

  it('refuses a missing CA file rather than letting the engine fall back to unverified TLS', () => {
    expect(() => migrationDatabaseUrl(`${BASE}&sslmode=verify-ca&sslrootcert=/missing/ca.crt`, {}, readCa)).toThrow(
      /\/missing\/ca\.crt/
    )
  })
})
