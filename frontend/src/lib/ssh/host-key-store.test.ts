import { createHash } from 'node:crypto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

// An in-memory ssh_host_keys (unique on host + key type) and ssh_known_hosts,
// enough of Prisma for the store: the tests check behaviour, not query shapes.
type Row = {
  host: string
  keyType: string
  keyData: Uint8Array | null
  pendingKeyData: Uint8Array | null
  pendingSeenAt: Date | null
  confirmedAt: Date | null
  confirmedBy: string | null
  firstSeenAt: Date
  lastUsedAt: Date
}

const db = vi.hoisted(() => ({
  rows: [] as any[],
  legacy: [] as { host: string; key_type: string; public_key: string; pinned_at: Date }[],
  legacyTable: true,
}))

function matches(r: Row, where: any): boolean {
  if (!where) return true
  if (where.OR) return where.OR.some((w: any) => matches(r, w))
  if (where.host_keyType) return r.host === where.host_keyType.host && r.keyType === where.host_keyType.keyType
  if (typeof where.host === 'string' && r.host !== where.host) return false
  if (typeof where.host === 'object' && !r.host.startsWith(where.host.startsWith)) return false
  if (where.keyData?.not === null && r.keyData === null) return false

  return true
}

function pick(r: Row, select?: Record<string, boolean>) {
  if (!select) return { ...r }

  return Object.fromEntries(Object.keys(select).map(k => [k, (r as any)[k]]))
}

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    sshHostKey: {
      findMany: async ({ where, select }: any = {}) =>
        db.rows.filter(r => matches(r, where)).sort((a, b) => (a.host + a.keyType).localeCompare(b.host + b.keyType)).map(r => pick(r, select)),
      upsert: async ({ where, create, update, select }: any) => {
        let row = db.rows.find(r => matches(r, where))
        if (row) Object.assign(row, update)
        else {
          row = { keyData: null, pendingKeyData: null, pendingSeenAt: null, confirmedAt: null, confirmedBy: null, firstSeenAt: new Date(), lastUsedAt: new Date(), ...create }
          db.rows.push(row)
        }

        return pick(row, select)
      },
      update: async ({ where, data }: any) => {
        const row = db.rows.find(r => matches(r, where))
        if (!row) throw new Error('not found')
        Object.assign(row, data)

        return row
      },
      deleteMany: async ({ where }: any) => {
        const before = db.rows.length
        db.rows = db.rows.filter(r => !matches(r, where))

        return { count: before - db.rows.length }
      },
    },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (!db.legacyTable) throw new Error('relation "ssh_known_hosts" does not exist')
      const sql = strings.join('?')
      if (sql.includes('WHERE host =')) return db.legacy.filter(l => l.host === values[0])

      return [...db.legacy].sort((a, b) => a.host.localeCompare(b.host))
    },
    $executeRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      if (!db.legacyTable) throw new Error('relation "ssh_known_hosts" does not exist')
      const before = db.legacy.length
      db.legacy = db.legacy.filter(l => l.host !== values[0])

      return before - db.legacy.length
    },
  },
}))

import {
  algorithmsForKeyType, confirmHostKey, forgetHostKey, hostKeyAlgorithms, hostKeyEndpoint, hostKeyFingerprint,
  hostKeyRefusalMessage, listHostKeys, makeHostVerifier, readKeyType, trustedKnownHosts, verifyHostKey,
} from './host-key-store'

// A wire-format public key: <4-byte BE length><algorithm name><payload>.
function fakeKey(algo: string, suffix = 'payload-bytes'): Buffer {
  const name = Buffer.from(algo, 'utf8')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(name.length, 0)

  return Buffer.concat([len, name, Buffer.from(suffix, 'utf8')])
}

function trust(host: string, key: Buffer, confirmed = true) {
  db.rows.push({
    host, keyType: readKeyType(key), keyData: Uint8Array.from(key), pendingKeyData: null, pendingSeenAt: null,
    confirmedAt: confirmed ? new Date() : null, confirmedBy: confirmed ? 'ops@example.com' : null,
    firstSeenAt: new Date(), lastUsedAt: new Date(),
  })
}

function rowOf(host: string, keyType: string) {
  return db.rows.find(r => r.host === host && r.keyType === keyType)
}

beforeEach(() => {
  db.rows = []
  db.legacy = []
  db.legacyTable = true
})

describe('hostKeyEndpoint and key helpers', () => {
  it('builds the same host:port string as the orchestrator', () => {
    expect(hostKeyEndpoint(' PVE1.Lab ', 22)).toBe('pve1.lab:22')
    expect(hostKeyEndpoint('[FE80::1]', 2222)).toBe('fe80::1:2222')
    expect(hostKeyEndpoint('10.0.0.1', 0)).toBe('10.0.0.1:22')
    expect(hostKeyEndpoint('  ', 22)).toBe('')
  })

  it('reads the key type and an OpenSSH fingerprint', () => {
    const key = fakeKey('ssh-ed25519')
    expect(readKeyType(key)).toBe('ssh-ed25519')
    expect(readKeyType(Buffer.from([0, 0]))).toBe('unknown')
    expect(readKeyType(Buffer.from([0, 0, 0, 99, 1]))).toBe('unknown')
    expect(hostKeyFingerprint(key)).toBe(`SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`)
  })

  it('signs an RSA key with SHA-2 and SHA-1', () => {
    expect(algorithmsForKeyType('ssh-rsa')).toEqual(['rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa'])
    expect(algorithmsForKeyType('ssh-ed25519')).toEqual(['ssh-ed25519'])
  })
})

describe('verifyHostKey', () => {
  it('refuses an unknown key and keeps it pending, on every attempt', async () => {
    const key = fakeKey('ssh-ed25519', 'new')
    const first = await verifyHostKey('PVE1', 22, key)
    expect(first).toEqual({ status: 'refused', endpoint: 'pve1:22', keyType: 'ssh-ed25519', fingerprint: hostKeyFingerprint(key), state: 'unconfirmed' })
    expect(Buffer.from(rowOf('pve1:22', 'ssh-ed25519').pendingKeyData).equals(key)).toBe(true)
    expect(rowOf('pve1:22', 'ssh-ed25519').keyData).toBeNull()

    expect((await verifyHostKey('pve1', 22, key)).status).toBe('refused')
  })

  it('accepts the trusted key and refreshes its last use at most hourly', async () => {
    const key = fakeKey('ssh-ed25519')
    trust('pve1:22', key)
    const old = new Date(Date.now() - 2 * 3_600_000)
    rowOf('pve1:22', 'ssh-ed25519').lastUsedAt = old

    expect(await verifyHostKey('pve1', 22, key)).toEqual({ status: 'trusted', keyType: 'ssh-ed25519' })
    expect(rowOf('pve1:22', 'ssh-ed25519').lastUsedAt.getTime()).toBeGreaterThan(old.getTime())
  })

  it('refuses a changed key, keeps the trusted one and stores the new one as pending', async () => {
    const good = fakeKey('ssh-ed25519', 'good')
    const evil = fakeKey('ssh-ed25519', 'evil')
    trust('pve1:22', good)

    const r = await verifyHostKey('pve1', 22, evil)
    expect(r).toMatchObject({ status: 'refused', state: 'mismatch' })
    const row = rowOf('pve1:22', 'ssh-ed25519')
    expect(Buffer.from(row.keyData).equals(good)).toBe(true)
    expect(Buffer.from(row.pendingKeyData).equals(evil)).toBe(true)
  })

  it('does not let a trusted key of one type vouch for another type or another port', async () => {
    trust('pve1:22', fakeKey('ssh-ed25519'))
    expect(await verifyHostKey('pve1', 22, fakeKey('ecdsa-sha2-nistp256'))).toMatchObject({ status: 'refused', state: 'unconfirmed' })
    expect(await verifyHostKey('pve1', 2222, fakeKey('ssh-ed25519'))).toMatchObject({ status: 'refused', state: 'unconfirmed' })
  })

  it('accepts the orchestrator legacy pin of the bare host and carries it over as automatic', async () => {
    const key = fakeKey('ecdsa-sha2-nistp256', 'legacy')
    db.legacy.push({ host: 'pve2', key_type: 'ecdsa-sha2-nistp256', public_key: key.toString('base64'), pinned_at: new Date() })

    expect(await verifyHostKey('pve2', 2201, key)).toEqual({ status: 'trusted', keyType: 'ecdsa-sha2-nistp256' })
    const row = rowOf('pve2:2201', 'ecdsa-sha2-nistp256')
    expect(Buffer.from(row.keyData).equals(key)).toBe(true)
    expect(row.confirmedAt).toBeNull()
  })

  it('refuses a key that differs from the legacy pin of its type', async () => {
    db.legacy.push({ host: 'pve2', key_type: 'ssh-ed25519', public_key: fakeKey('ssh-ed25519', 'a').toString('base64'), pinned_at: new Date() })
    expect(await verifyHostKey('pve2', 22, fakeKey('ssh-ed25519', 'b'))).toMatchObject({ status: 'refused', state: 'mismatch' })
  })

  it('treats a missing legacy table (no orchestrator) as no pin', async () => {
    db.legacyTable = false
    expect(await verifyHostKey('pve3', 22, fakeKey('ssh-ed25519'))).toMatchObject({ status: 'refused', state: 'unconfirmed' })
  })

  it('rejects an empty host', async () => {
    await expect(verifyHostKey('  ', 22, fakeKey('ssh-ed25519'))).rejects.toThrow(/empty/)
  })
})

describe('confirmHostKey', () => {
  it('promotes exactly the pending key with the fingerprint the operator saw', async () => {
    const key = fakeKey('ssh-ed25519', 'k')
    await verifyHostKey('pve1', 22, key)

    expect(await confirmHostKey('pve1:22', 'SHA256:other', 'ops@example.com')).toBe(false)
    expect(await confirmHostKey('pve1:22', hostKeyFingerprint(key), 'ops@example.com')).toBe(true)

    const row = rowOf('pve1:22', 'ssh-ed25519')
    expect(Buffer.from(row.keyData).equals(key)).toBe(true)
    expect(row.pendingKeyData).toBeNull()
    expect(row.confirmedBy).toBe('ops@example.com')
    expect((await verifyHostKey('pve1', 22, key)).status).toBe('trusted')
  })

  it('replaces a trusted key by the new one after a reinstall', async () => {
    const old = fakeKey('ssh-ed25519', 'old')
    const fresh = fakeKey('ssh-ed25519', 'fresh')
    trust('pve1:22', old)
    await verifyHostKey('pve1', 22, fresh)

    expect(await confirmHostKey('pve1:22', hostKeyFingerprint(fresh), 'ops@example.com')).toBe(true)
    expect((await verifyHostKey('pve1', 22, old)).status).toBe('refused')
  })

  it('turns an automatic pin into a confirmed one', async () => {
    const key = fakeKey('ssh-ed25519')
    trust('pve1:22', key, false)
    expect(await confirmHostKey('pve1:22', hostKeyFingerprint(key), 'ops@example.com')).toBe(true)
    expect(rowOf('pve1:22', 'ssh-ed25519').confirmedAt).toBeInstanceOf(Date)
  })
})

describe('hostKeyAlgorithms', () => {
  it('offers the trusted key types first, else the legacy one, else ed25519 first, then the rest', async () => {
    const defaults = await hostKeyAlgorithms('pve1', 22)
    expect(defaults).toEqual([
      'ssh-ed25519', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521', 'rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa',
    ])

    db.legacy.push({ host: 'pve1', key_type: 'ecdsa-sha2-nistp256', public_key: fakeKey('ecdsa-sha2-nistp256').toString('base64'), pinned_at: new Date() })
    const legacy = await hostKeyAlgorithms('pve1', 22)
    expect(legacy[0]).toBe('ecdsa-sha2-nistp256')
    expect([...legacy].sort()).toEqual([...defaults].sort())

    trust('pve1:22', fakeKey('ssh-rsa'))
    trust('pve1:22', fakeKey('ecdsa-sha2-nistp384'))
    expect(await hostKeyAlgorithms('pve1', 22)).toEqual([
      'ecdsa-sha2-nistp384', 'rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa', 'ssh-ed25519', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp521',
    ])
  })
})

describe('listHostKeys', () => {
  it('lists trusted, automatic and pending keys, then the legacy pins no trusted key covers', async () => {
    trust('pve1:22', fakeKey('ssh-ed25519', 'c'))
    trust('pve2:22', fakeKey('ssh-ed25519', 'a'), false)
    await verifyHostKey('pve3', 22, fakeKey('ssh-ed25519', 'p'))
    const legacyKey = fakeKey('ecdsa-sha2-nistp256', 'l')
    db.legacy.push(
      { host: 'pve1', key_type: 'ecdsa-sha2-nistp256', public_key: legacyKey.toString('base64'), pinned_at: new Date() },
      { host: 'pve9', key_type: 'ecdsa-sha2-nistp256', public_key: legacyKey.toString('base64'), pinned_at: new Date() },
    )

    const keys = await listHostKeys()
    expect(keys.map(k => [k.host, k.origin, !!k.legacy])).toEqual([
      ['pve1:22', 'confirmed', false],
      ['pve2:22', 'automatic', false],
      ['pve3:22', 'pending', false],
      ['pve9', 'automatic', true],
    ])
    expect(keys[2].fingerprint).toBeNull()
    expect(keys[2].pendingFingerprint).toMatch(/^SHA256:/)
    expect(keys[3].fingerprint).toBe(hostKeyFingerprint(legacyKey))
  })

  it('lists without the legacy table', async () => {
    db.legacyTable = false
    trust('pve1:22', fakeKey('ssh-ed25519'))
    expect(await listHostKeys()).toHaveLength(1)
  })
})

describe('forgetHostKey', () => {
  it('drops every port and type of a bare host plus its legacy pin', async () => {
    trust('pve1:22', fakeKey('ssh-ed25519'))
    trust('pve1:2222', fakeKey('ssh-ed25519'))
    trust('pve10:22', fakeKey('ssh-ed25519'))
    db.legacy.push({ host: 'pve1', key_type: 'ssh-ed25519', public_key: 'AAAA', pinned_at: new Date() })

    expect(await forgetHostKey('PVE1')).toBe(3)
    expect(db.rows.map(r => r.host)).toEqual(['pve10:22'])
  })

  it('drops one endpoint when given host:port', async () => {
    trust('pve1:22', fakeKey('ssh-ed25519'))
    trust('pve1:2222', fakeKey('ssh-ed25519'))
    expect(await forgetHostKey('pve1:2222')).toBe(1)
    expect(db.rows.map(r => r.host)).toEqual(['pve1:22'])
  })

  it('handles IPv6 literals and an empty host', async () => {
    trust('fe80::1:22', fakeKey('ssh-ed25519'))
    expect(await forgetHostKey('[fe80::1]:22')).toBe(1)
    expect(await forgetHostKey('  ')).toBe(0)
  })
})

describe('trustedKnownHosts', () => {
  it('writes OpenSSH lines and SHA-256 hashes of the trusted keys only', async () => {
    const key = fakeKey('ecdsa-sha2-nistp256')
    trust('esx1:22', key)
    trust('esx1:2222', key)
    await verifyHostKey('esx2', 22, key)

    expect(await trustedKnownHosts('ESX1', 22)).toEqual({
      lines: [`esx1 ecdsa-sha2-nistp256 ${key.toString('base64')}`],
      keyTypes: ['ecdsa-sha2-nistp256'],
      sha256Hex: [createHash('sha256').update(key).digest('hex')],
    })
    expect((await trustedKnownHosts('esx1', 2222)).lines[0]).toMatch(/^\[esx1\]:2222 /)
    expect((await trustedKnownHosts('esx2', 22)).lines).toEqual([])
  })
})

describe('makeHostVerifier', () => {
  it('accepts a trusted key', async () => {
    const key = fakeKey('ssh-ed25519')
    trust('pve1:22', key)
    const ok = await new Promise<boolean>(resolve => makeHostVerifier('pve1', 22)(key, resolve))
    expect(ok).toBe(true)
  })

  it('refuses an unconfirmed key and hands the refusal to the caller', async () => {
    const onRefusal = vi.fn()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ok = await new Promise<boolean>(resolve => makeHostVerifier('pve1', 22, onRefusal)(fakeKey('ssh-ed25519'), resolve))
    expect(ok).toBe(false)
    expect(onRefusal.mock.calls[0][0]).toMatchObject({ endpoint: 'pve1:22', state: 'unconfirmed' })
    expect(onRefusal.mock.calls[0][1]).toMatch(/not confirmed/)
    warn.mockRestore()
  })

  it('refuses when the check itself fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ok = await new Promise<boolean>(resolve => makeHostVerifier('', 22)(fakeKey('ssh-ed25519'), resolve))
    expect(ok).toBe(false)
    error.mockRestore()
  })
})

describe('hostKeyRefusalMessage', () => {
  it('tells a changed key from an unconfirmed one and names the way out', () => {
    const base = { endpoint: 'pve1:22', keyType: 'ssh-ed25519', fingerprint: 'SHA256:x' }
    expect(hostKeyRefusalMessage({ ...base, state: 'mismatch' })).toMatch(/changed.*Host keys/)
    expect(hostKeyRefusalMessage({ ...base, state: 'unconfirmed' })).toMatch(/not confirmed.*SSH test/)
  })
})
