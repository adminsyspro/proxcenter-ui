// src/lib/connections/check/probes.test.ts
//
// One block per probe, each against fake transport deps and mocked PVE
// answers. No network, no ssh2, no Prisma.

import { describe, expect, it, vi } from 'vitest'

import {
  CLOCK_FAIL_SECONDS,
  CLOCK_WARN_SECONDS,
  classifyTransportError,
  probeApi,
  probeClock,
  probePrivileges,
  probeQuorum,
  probeSsh,
  probeTls,
  probeVersion,
  type NodeList,
} from './probes'
import type { CheckContext, CheckDeps, CheckItem } from './types'
import { isAtLeast, parsePveVersion, unmetGates } from './versionGates'

const NOW = Date.UTC(2026, 9, 9, 12, 0, 0)

function makeCtx(overrides: Partial<CheckContext> = {}): CheckContext {
  return {
    connectionId: 'c1',
    conn: {
      id: 'c1',
      baseUrl: 'https://10.42.0.101:8006',
      apiToken: 'proxcenter@pve!check=11111111-2222-3333-4444-555555555555',
      insecureDev: true,
      behindProxy: false,
    },
    fallbackHosts: [
      { node: 'pve1', ip: '10.42.0.101' },
      { node: 'pve2', ip: '10.42.0.102' },
    ],
    pinnedFingerprint: null,
    ssh: { enabled: false, user: 'root', port: 22, overrides: [] },
    ...overrides,
  }
}

function makeDeps(overrides: Partial<CheckDeps> = {}): CheckDeps {
  return {
    directGet: vi.fn(async () => ({ statusCode: 200, data: { version: '9.2.11' } })),
    pveGet: vi.fn(async () => ({})) as CheckDeps['pveGet'],
    readCertificate: vi.fn(async () => ({
      validFrom: new Date(NOW - 100 * 86_400_000).toUTCString(),
      validTo: new Date(NOW + 300 * 86_400_000).toUTCString(),
      fingerprint: 'AA:BB:CC',
      authorized: true,
    })),
    resolveSshEndpoint: vi.fn(async (node: string) => ({ host: `${node}.lab`, port: 22 })),
    sshExec: vi.fn(async () => ({ success: true, output: 'pve1\n' })),
    now: () => NOW,
    ...overrides,
  }
}

const byId = (items: CheckItem[], id: string) => items.find(i => i.id === id)

/** A PVE token with every privilege ProxCenter needs, propagated from /. */
const FULL_PERMISSIONS = {
  '/': Object.fromEntries(
    [
      'Sys.Audit', 'Sys.Console', 'Sys.Modify', 'Sys.Incoming', 'Sys.PowerMgmt',
      'VM.Audit', 'VM.Console', 'VM.PowerMgmt', 'VM.Allocate', 'VM.Clone', 'VM.Snapshot', 'VM.Snapshot.Rollback',
      'VM.Migrate', 'VM.Backup', 'VM.Config.Disk', 'VM.Config.CPU', 'VM.Config.Memory', 'VM.Config.Network',
      'VM.Config.Options', 'VM.Config.HWType', 'VM.Config.CDROM', 'VM.Config.Cloudinit',
      'Datastore.Audit', 'Datastore.AllocateSpace', 'Datastore.Allocate', 'Datastore.AllocateTemplate',
      'SDN.Audit', 'SDN.Allocate', 'Pool.Audit', 'Pool.Allocate', 'Mapping.Audit', 'Mapping.Modify',
    ].map(p => [p, 1]),
  ),
}

// ---------------------------------------------------------------------------
// classifyTransportError
// ---------------------------------------------------------------------------

describe('classifyTransportError', () => {
  it('reads a TLS code off the cause chain', () => {
    const err = new TypeError('fetch failed')
    ;(err as { cause?: unknown }).cause = Object.assign(new Error('self signed certificate'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' })
    expect(classifyTransportError(err)).toEqual({ kind: 'tls', reason: 'DEPTH_ZERO_SELF_SIGNED_CERT' })
  })

  it('tells a connect timeout from a refused connection', () => {
    expect(classifyTransportError(Object.assign(new Error('x'), { code: 'UND_ERR_CONNECT_TIMEOUT' })).kind).toBe('timeout')
    expect(classifyTransportError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })).kind).toBe('network')
    expect(classifyTransportError(new Error('something else')).kind).toBe('other')
  })
})

// ---------------------------------------------------------------------------
// 1. API reachability
// ---------------------------------------------------------------------------

describe('probeApi', () => {
  it('reports the primary and each fallback host, skipping the primary ip', async () => {
    const deps = makeDeps()
    const items = await probeApi(makeCtx(), deps)
    expect(items.map(i => i.id)).toEqual(['api.primary', 'api.fallback.pve2'])
    expect(byId(items, 'api.primary')).toMatchObject({ status: 'ok', hint: 'api.ok', params: { host: '10.42.0.101', version: '9.2.11' } })
    expect(byId(items, 'api.fallback.pve2')).toMatchObject({ status: 'ok', hint: 'api.fallbackOk', params: { node: 'pve2', host: '10.42.0.102' } })
    expect(deps.directGet).toHaveBeenCalledWith('https://10.42.0.102:8006', '/version', expect.any(Number))
  })

  it('fails the primary on 401 and names the token problem', async () => {
    const deps = makeDeps({ directGet: vi.fn(async () => ({ statusCode: 401, data: null })) })
    const items = await probeApi(makeCtx({ fallbackHosts: [] }), deps)
    expect(byId(items, 'api.primary')).toMatchObject({ status: 'fail', hint: 'api.unauthorized', params: { status: 401 } })
    expect(byId(items, 'api.fallback')).toMatchObject({ status: 'skip', hint: 'api.noFallbackHosts' })
  })

  it('maps transport failures to unreachable, timeout and tlsRejected', async () => {
    const codes = ['ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']
    const hints: string[] = []
    for (const code of codes) {
      const deps = makeDeps({ directGet: vi.fn(async () => { throw Object.assign(new Error(code), { code }) }) })
      const items = await probeApi(makeCtx({ fallbackHosts: [] }), deps)
      hints.push(byId(items, 'api.primary')!.hint)
    }
    expect(hints).toEqual(['api.unreachable', 'api.timeout', 'api.tlsRejected'])
  })

  it('warns (never fails) on an unreachable fallback, with its own TLS hint', async () => {
    const deps = makeDeps({
      directGet: vi.fn(async (baseUrl: string) => {
        if (baseUrl.includes('102')) throw Object.assign(new Error('refused'), { code: 'EHOSTUNREACH' })
        if (baseUrl.includes('103')) throw Object.assign(new Error('altname'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' })
        return { statusCode: 200, data: { version: '9.2.11' } }
      }),
    })
    const ctx = makeCtx({ fallbackHosts: [{ node: 'pve2', ip: '10.42.0.102' }, { node: 'pve3', ip: '10.42.0.103' }] })
    const items = await probeApi(ctx, deps)
    expect(byId(items, 'api.fallback.pve2')).toMatchObject({ status: 'warn', hint: 'api.fallbackUnreachable', params: { error: 'EHOSTUNREACH' } })
    expect(byId(items, 'api.fallback.pve3')).toMatchObject({ status: 'warn', hint: 'api.fallbackTlsRejected' })
  })

  it('does not probe fallbacks behind a reverse proxy', async () => {
    const deps = makeDeps()
    const items = await probeApi(makeCtx({ conn: { ...makeCtx().conn, behindProxy: true } }), deps)
    expect(byId(items, 'api.fallback')).toMatchObject({ status: 'skip', hint: 'api.fallbackBehindProxy' })
    expect(deps.directGet).toHaveBeenCalledTimes(1)
  })

  it('reports an unexpected HTTP status', async () => {
    const deps = makeDeps({ directGet: vi.fn(async () => ({ statusCode: 502, data: null })) })
    const items = await probeApi(makeCtx({ fallbackHosts: [] }), deps)
    expect(byId(items, 'api.primary')).toMatchObject({ status: 'fail', hint: 'api.httpError', params: { status: 502 } })
  })
})

// ---------------------------------------------------------------------------
// 2. TLS
// ---------------------------------------------------------------------------

describe('probeTls', () => {
  it('passes a trusted certificate with its remaining days and skips the pin when none is stored', async () => {
    const items = await probeTls(makeCtx(), makeDeps())
    expect(byId(items, 'tls.certificate')).toMatchObject({ status: 'ok', hint: 'tls.ok', params: { host: '10.42.0.101', days: 300 } })
    expect(byId(items, 'tls.fingerprint')).toMatchObject({ status: 'skip', hint: 'tls.noPin' })
  })

  it('tells an accepted self-signed certificate from a rejected one', async () => {
    const readCertificate = vi.fn(async () => ({
      validFrom: new Date(NOW - 10 * 86_400_000).toUTCString(),
      validTo: new Date(NOW + 200 * 86_400_000).toUTCString(),
      fingerprint: 'AA',
      authorized: false,
      authorizationError: 'DEPTH_ZERO_SELF_SIGNED_CERT',
    }))
    const accepted = await probeTls(makeCtx(), makeDeps({ readCertificate }))
    expect(byId(accepted, 'tls.certificate')).toMatchObject({ status: 'ok', hint: 'tls.okUntrusted' })

    const strict = makeCtx()
    strict.conn.insecureDev = false
    const rejected = await probeTls(strict, makeDeps({ readCertificate }))
    expect(byId(rejected, 'tls.certificate')).toMatchObject({ status: 'warn', hint: 'tls.untrusted', params: { reason: 'DEPTH_ZERO_SELF_SIGNED_CERT' } })
  })

  it('warns 30 days before expiry and fails once expired', async () => {
    const soon = makeDeps({
      readCertificate: vi.fn(async () => ({ validFrom: new Date(NOW - 10 * 86_400_000).toUTCString(), validTo: new Date(NOW + 12 * 86_400_000).toUTCString(), fingerprint: 'AA', authorized: true })),
    })
    expect(byId(await probeTls(makeCtx(), soon), 'tls.certificate')).toMatchObject({ status: 'warn', hint: 'tls.expiringSoon', params: { days: 12 } })

    const expired = makeDeps({
      readCertificate: vi.fn(async () => ({ validFrom: new Date(NOW - 400 * 86_400_000).toUTCString(), validTo: new Date(NOW - 3 * 86_400_000).toUTCString(), fingerprint: 'AA', authorized: true })),
    })
    expect(byId(await probeTls(makeCtx(), expired), 'tls.certificate')).toMatchObject({ status: 'fail', hint: 'tls.expired' })
  })

  it('compares the pinned fingerprint ignoring case and separators', async () => {
    const deps = makeDeps({
      readCertificate: vi.fn(async () => ({ validFrom: new Date(NOW - 10 * 86_400_000).toUTCString(), validTo: new Date(NOW + 200 * 86_400_000).toUTCString(), fingerprint: 'AA:BB:CC', authorized: true })),
    })
    const match = await probeTls(makeCtx({ pinnedFingerprint: 'aa:bb:cc' }), deps)
    expect(byId(match, 'tls.fingerprint')).toMatchObject({ status: 'ok', hint: 'tls.pinMatch' })

    const mismatch = await probeTls(makeCtx({ pinnedFingerprint: 'AA:BB:CD' }), deps)
    expect(byId(mismatch, 'tls.fingerprint')).toMatchObject({ status: 'fail', hint: 'tls.pinMismatch', params: { expected: 'AA:BB:CD', actual: 'AA:BB:CC' } })
  })

  it('fails the certificate and leaves the pin unchecked when the handshake fails', async () => {
    const deps = makeDeps({ readCertificate: vi.fn(async () => { throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }) }) })
    const items = await probeTls(makeCtx({ pinnedFingerprint: 'AA' }), deps)
    expect(byId(items, 'tls.certificate')).toMatchObject({ status: 'fail', hint: 'tls.unreachable', params: { error: 'ECONNREFUSED' } })
    expect(byId(items, 'tls.fingerprint')).toMatchObject({ status: 'skip', hint: 'tls.pinUnchecked' })
  })

  it('skips plain http connections', async () => {
    const ctx = makeCtx()
    ctx.conn.baseUrl = 'http://10.42.0.101:8006'
    const deps = makeDeps()
    const items = await probeTls(ctx, deps)
    expect(byId(items, 'tls.certificate')).toMatchObject({ status: 'skip', hint: 'tls.notHttps' })
    expect(deps.readCertificate).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 3. Privileges
// ---------------------------------------------------------------------------

describe('probePrivileges', () => {
  /** pveGet answering the permissions map and, when given, the token's own entry. */
  const privDeps = (permissions: unknown, token?: { privsep: 0 | 1 }) =>
    makeDeps({
      pveGet: vi.fn(async (path: string) => {
        if (path === '/access/permissions') {
          if (permissions instanceof Error) throw permissions
          return permissions
        }
        if (path === '/access/users/proxcenter%40pve/token/check') {
          if (token) return { ...token, comment: 'x' }
          throw new Error('PVE 403 /access/users/proxcenter@pve/token/check: Permission check failed')
        }
        throw new Error(`unexpected ${path}`)
      }) as CheckDeps['pveGet'],
    })

  it('passes a token holding everything at /', async () => {
    const deps = privDeps(FULL_PERMISSIONS, { privsep: 1 })
    const items = await probePrivileges(makeCtx(), deps)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'privileges', status: 'ok', hint: 'privileges.ok', params: { tokenId: 'proxcenter@pve!check' } })
    expect(deps.pveGet).toHaveBeenCalledWith('/access/permissions', expect.any(Number))
    expect(deps.pveGet).toHaveBeenCalledWith('/access/users/proxcenter%40pve/token/check', expect.any(Number))
  })

  it('fails the audit privileges and warns on the rest, naming the features', async () => {
    // PVEAuditor-like token: audit only, at /.
    const auditor = { '/': { 'Sys.Audit': 1, 'VM.Audit': 1, 'Datastore.Audit': 1, 'SDN.Audit': 1, 'Pool.Audit': 1, 'Mapping.Audit': 1 } }
    const items = await probePrivileges(makeCtx(), privDeps(auditor, { privsep: 1 }))
    expect(items.every(i => i.hint === 'privileges.missingSeparated')).toBe(true)
    expect(items.some(i => i.status === 'fail')).toBe(false)
    expect(byId(items, 'privileges.guest-console')).toMatchObject({
      status: 'warn',
      params: { privileges: 'VM.Console', path: '/vms', features: ['console'], user: 'proxcenter@pve' },
    })
    expect(byId(items, 'privileges.node-power')?.params.command).toContain('pveum role add ProxCenter -privs "Sys.PowerMgmt"')

    // VM.Audit only at /vms, nothing at /: cluster audit fails, guest audit passes.
    const vmOnly = { '/vms': { 'VM.Audit': 1 } }
    const items2 = await probePrivileges(makeCtx(), privDeps(vmOnly, { privsep: 1 }))
    expect(byId(items2, 'privileges.cluster-audit')).toMatchObject({ status: 'fail', params: { privileges: 'Sys.Audit', path: '/' } })
    expect(byId(items2, 'privileges.guest-audit')).toBeUndefined()
    expect(byId(items2, 'privileges.storage-audit')?.status).toBe('fail')
  })

  it('words the fix after privilege separation: on = user and token, off = user, unreadable = both stated', async () => {
    const partial = { '/': { ...FULL_PERMISSIONS['/'] } }
    delete partial['/']['VM.Console']

    const on = await probePrivileges(makeCtx(), privDeps(partial, { privsep: 1 }))
    expect(on).toHaveLength(1)
    expect(on[0]).toMatchObject({
      id: 'privileges.guest-console',
      hint: 'privileges.missingSeparated',
      params: { command: "pveum aclmod /vms -user proxcenter@pve -role PVEAdmin ; pveum aclmod /vms -token 'proxcenter@pve!check' -role PVEAdmin" },
    })

    const off = await probePrivileges(makeCtx(), privDeps(partial, { privsep: 0 }))
    expect(off[0]).toMatchObject({ hint: 'privileges.missingUser', params: { command: 'pveum aclmod /vms -user proxcenter@pve -role PVEAdmin' } })

    const unknown = await probePrivileges(makeCtx(), privDeps(partial))
    expect(unknown[0]).toMatchObject({
      hint: 'privileges.missing',
      params: { command: "pveum aclmod /vms -user proxcenter@pve -role PVEAdmin ; pveum aclmod /vms -token 'proxcenter@pve!check' -role PVEAdmin" },
    })
  })

  it('lists only the missing privileges of a group', async () => {
    const partial = { '/': { ...FULL_PERMISSIONS['/'] } }
    delete partial['/']['VM.Config.CDROM']
    delete partial['/']['VM.Config.Cloudinit']
    const items = await probePrivileges(makeCtx(), privDeps(partial, { privsep: 1 }))
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'privileges.guest-config', params: { privileges: 'VM.Config.CDROM, VM.Config.Cloudinit' } })
  })

  it('flags a token with no effective privilege, the intersection case included', async () => {
    // Separation on with the ACL on the token only: PVE answers {} because the user holds nothing.
    const separated = await probePrivileges(makeCtx(), privDeps({}, { privsep: 1 }))
    expect(separated[0]).toMatchObject({
      id: 'privileges',
      status: 'fail',
      hint: 'privileges.noneSeparated',
      params: { user: 'proxcenter@pve', command: "pveum aclmod / -user proxcenter@pve -role PVEAdmin ; pveum aclmod / -token 'proxcenter@pve!check' -role PVEAdmin" },
    })
    const user = await probePrivileges(makeCtx(), privDeps({}, { privsep: 0 }))
    expect(user[0]).toMatchObject({ hint: 'privileges.noneUser', params: { command: 'pveum aclmod / -user proxcenter@pve -role PVEAdmin' } })
    const unknown = await probePrivileges(makeCtx(), privDeps({}))
    expect(unknown[0]).toMatchObject({ hint: 'privileges.none' })
    expect(unknown[0].params.command).toContain("-token 'proxcenter@pve!check'")
  })

  it('fails when the permissions cannot be read', async () => {
    const items = await probePrivileges(makeCtx(), privDeps(new Error('PVE 500 /access/permissions: boom'), { privsep: 1 }))
    expect(items[0]).toMatchObject({ id: 'privileges', status: 'fail', hint: 'privileges.unreadable' })
  })
})

// ---------------------------------------------------------------------------
// 4. Version
// ---------------------------------------------------------------------------

const TWO_NODES: NodeList = { nodes: [{ node: 'pve1', status: 'online' }, { node: 'pve2', status: 'online' }] }

describe('versionGates', () => {
  it('parses pve-manager strings and plain versions', () => {
    expect(parsePveVersion('9.2.11')).toEqual({ major: 9, minor: 2 })
    expect(parsePveVersion('pve-manager/8.4.1/abc')).toEqual({ major: 8, minor: 4 })
    expect(parsePveVersion(undefined)).toBeNull()
    expect(isAtLeast({ major: 8, minor: 3 }, [8, 3])).toBe(true)
    expect(isAtLeast({ major: 8, minor: 2 }, [8, 3])).toBe(false)
    expect(isAtLeast({ major: 9, minor: 0 }, [8, 3])).toBe(true)
  })

  it('returns the gates a version misses, highest first', () => {
    const gates = unmetGates({ major: 8, minor: 2 })
    expect(gates.map(g => g.feature)).toEqual(['warmMigration', 'haAffinityRules', 'sdnFabrics', 'vnetFirewall'])
    expect(unmetGates({ major: 9, minor: 2 })).toEqual([])
  })
})

describe('probeVersion', () => {
  it('passes current nodes and reads /nodes/{node}/version', async () => {
    const pveGet = vi.fn(async () => ({ version: '9.2.11', release: '9.2' })) as CheckDeps['pveGet']
    const items = await probeVersion(makeCtx(), makeDeps({ pveGet }), TWO_NODES)
    expect(items.map(i => i.id)).toEqual(['version.pve1', 'version.pve2'])
    expect(items[0]).toMatchObject({ status: 'ok', hint: 'version.ok', params: { node: 'pve1', version: '9.2.11' } })
    expect(pveGet).toHaveBeenCalledWith('/nodes/pve1/version', expect.any(Number))
  })

  it('warns with the gated features and the required version, and on mixed versions', async () => {
    const pveGet = vi.fn(async (path: string) => ({ version: path.includes('pve1') ? '8.2.4' : '9.2.11' })) as CheckDeps['pveGet']
    const items = await probeVersion(makeCtx(), makeDeps({ pveGet }), TWO_NODES)
    expect(byId(items, 'version.pve1')).toMatchObject({
      status: 'warn',
      hint: 'version.gated',
      params: { node: 'pve1', version: '8.2.4', required: '9.0', features: ['warmMigration', 'haAffinityRules', 'sdnFabrics', 'vnetFirewall'] },
    })
    expect(byId(items, 'version.cluster')).toMatchObject({ status: 'warn', hint: 'version.mixed', params: { versions: 'pve1 8.2, pve2 9.2' } })
  })

  it('warns below the supported major, fails an unreadable node, skips offline nodes', async () => {
    const list: NodeList = { nodes: [{ node: 'old', status: 'online' }, { node: 'dead', status: 'online' }, { node: 'off', status: 'offline' }] }
    const pveGet = vi.fn(async (path: string) => {
      if (path.includes('dead')) throw new Error('PVE 595 /nodes/dead/version: no route')
      return { version: '6.4-1' }
    }) as CheckDeps['pveGet']
    const items = await probeVersion(makeCtx(), makeDeps({ pveGet }), list)
    expect(byId(items, 'version.old')).toMatchObject({ status: 'warn', hint: 'version.belowSupported', params: { min: 7 } })
    expect(byId(items, 'version.dead')).toMatchObject({ status: 'fail', hint: 'version.unreadable' })
    expect(byId(items, 'version.off')).toMatchObject({ status: 'skip', hint: 'node.offline' })
    expect(pveGet).toHaveBeenCalledTimes(2)
  })

  it('skips with the node list error', async () => {
    const items = await probeVersion(makeCtx(), makeDeps(), { error: 'nope' })
    expect(items).toEqual([{ id: 'version', probe: 'version', status: 'skip', hint: 'nodes.unreadable', params: { error: 'nope' } }])
  })
})

// ---------------------------------------------------------------------------
// 5. Clock
// ---------------------------------------------------------------------------

describe('probeClock', () => {
  const clockDeps = (skewByNode: Record<string, number>) =>
    makeDeps({
      pveGet: vi.fn(async (path: string) => {
        const node = /\/nodes\/([^/]+)\/time/.exec(path)![1]
        return { time: Math.round(NOW / 1000) + skewByNode[node], timezone: 'Europe/Paris' }
      }) as CheckDeps['pveGet'],
    })

  it('grades the skew: ok, warn above 30 s, fail above 2 min, with the sign kept', async () => {
    const list: NodeList = { nodes: [{ node: 'a', status: 'online' }, { node: 'b', status: 'online' }, { node: 'c', status: 'online' }] }
    const items = await probeClock(makeCtx(), clockDeps({ a: 3, b: -(CLOCK_WARN_SECONDS + 15), c: CLOCK_FAIL_SECONDS + 60 }), list)
    expect(byId(items, 'clock.a')).toMatchObject({ status: 'ok', hint: 'clock.ok', params: { skewSeconds: 3, timezone: 'Europe/Paris' } })
    expect(byId(items, 'clock.b')).toMatchObject({ status: 'warn', hint: 'clock.warn', params: { skewSeconds: -45 } })
    expect(byId(items, 'clock.c')).toMatchObject({ status: 'fail', hint: 'clock.fail', params: { skewSeconds: 180 } })
  })

  it('skips a node the token may not read and fails any other error', async () => {
    const pveGet = vi.fn(async (path: string) => {
      if (path.includes('/a/')) throw new Error('PVE 403 /nodes/a/time: Permission check failed')
      throw new Error('PVE 500 /nodes/b/time: boom')
    }) as CheckDeps['pveGet']
    const items = await probeClock(makeCtx(), makeDeps({ pveGet }), { nodes: [{ node: 'a' }, { node: 'b' }] })
    expect(byId(items, 'clock.a')).toMatchObject({ status: 'skip', hint: 'clock.forbidden' })
    expect(byId(items, 'clock.b')).toMatchObject({ status: 'fail', hint: 'clock.unreadable' })
  })
})

// ---------------------------------------------------------------------------
// 6. Quorum
// ---------------------------------------------------------------------------

describe('probeQuorum', () => {
  const status = (quorate: number, online: number[]) => [
    { type: 'cluster', name: 'lab', quorate },
    ...online.map((o, i) => ({ type: 'node', name: `pve${i + 1}`, online: o })),
  ]

  it('passes a quorate cluster with every node online', async () => {
    const items = await probeQuorum(makeCtx(), makeDeps({ pveGet: vi.fn(async () => status(1, [1, 1, 1])) as CheckDeps['pveGet'] }))
    expect(items[0]).toMatchObject({ id: 'quorum', status: 'ok', hint: 'quorum.ok', params: { cluster: 'lab', online: 3, total: 3 } })
  })

  it('warns when quorate with offline members, fails when quorum is lost', async () => {
    const degraded = await probeQuorum(makeCtx(), makeDeps({ pveGet: vi.fn(async () => status(1, [1, 0, 1])) as CheckDeps['pveGet'] }))
    expect(degraded[0]).toMatchObject({ status: 'warn', hint: 'quorum.degraded', params: { offline: 1, nodes: 'pve2', online: 2, total: 3 } })

    const lost = await probeQuorum(makeCtx(), makeDeps({ pveGet: vi.fn(async () => status(0, [1, 0, 0])) as CheckDeps['pveGet'] }))
    expect(lost[0]).toMatchObject({ status: 'fail', hint: 'quorum.lost', params: { online: 1, total: 3 } })
  })

  it('passes a standalone node and skips on 403', async () => {
    const standalone = await probeQuorum(makeCtx(), makeDeps({ pveGet: vi.fn(async () => [{ type: 'node', name: 'solo', online: 1 }]) as CheckDeps['pveGet'] }))
    expect(standalone[0]).toMatchObject({ status: 'ok', hint: 'quorum.standalone' })

    const forbidden = await probeQuorum(makeCtx(), makeDeps({ pveGet: vi.fn(async () => { throw new Error('PVE 403 /cluster/status: Permission check failed') }) as CheckDeps['pveGet'] }))
    expect(forbidden[0]).toMatchObject({ status: 'skip', hint: 'quorum.forbidden' })
  })
})

// ---------------------------------------------------------------------------
// 7. SSH
// ---------------------------------------------------------------------------

describe('probeSsh', () => {
  const sshCtx = (extra: Partial<CheckContext['ssh']> = {}) =>
    makeCtx({ ssh: { enabled: true, user: 'root', port: 22, key: 'KEY', overrides: [], ...extra } })

  it('skips when disabled, when the prerequisites failed, and without credentials', async () => {
    const deps = makeDeps()
    expect((await probeSsh(makeCtx(), deps, TWO_NODES, true))[0]).toMatchObject({ id: 'ssh', status: 'skip', hint: 'ssh.disabled' })
    expect((await probeSsh(sshCtx(), deps, TWO_NODES, false))[0]).toMatchObject({ status: 'skip', hint: 'ssh.prerequisitesFailed' })
    expect((await probeSsh(sshCtx({ key: undefined }), deps, TWO_NODES, true))[0]).toMatchObject({ status: 'skip', hint: 'ssh.noCredentials' })
    expect(deps.sshExec).not.toHaveBeenCalled()
  })

  it('makes exactly one attempt per online node through the resolved endpoint', async () => {
    const deps = makeDeps()
    const list: NodeList = { nodes: [...TWO_NODES.nodes, { node: 'pve3', status: 'offline' }] }
    const items = await probeSsh(sshCtx(), deps, list, true)
    expect(deps.sshExec).toHaveBeenCalledTimes(2)
    expect(deps.sshExec).toHaveBeenCalledWith({ host: 'pve1.lab', port: 22, command: 'hostname', timeoutMs: expect.any(Number) })
    expect(byId(items, 'ssh.pve1')).toMatchObject({ status: 'ok', hint: 'ssh.ok', params: { node: 'pve1', host: 'pve1.lab', port: 22, user: 'root', hostname: 'pve1' } })
    expect(byId(items, 'ssh.pve3')).toMatchObject({ status: 'skip', hint: 'node.offline' })
  })

  it('tells a rotated host key, an auth failure and a timeout apart', async () => {
    const errors: Record<string, string> = {
      'pve1.lab': 'ssh host-key mismatch for "pve1.lab": pinned ecdsa-sha2-nistp256, presented ecdsa-sha2-nistp256. Refusing to connect.',
      'pve2.lab': 'All configured authentication methods failed',
      'pve3.lab': 'SSH connection timeout (10s)',
      'pve4.lab': 'Exit code 127',
    }
    const deps = makeDeps({ sshExec: vi.fn(async ({ host }: { host: string }) => ({ success: false, error: errors[host] })) })
    const list: NodeList = { nodes: ['pve1', 'pve2', 'pve3', 'pve4'].map(node => ({ node, status: 'online' })) }
    const items = await probeSsh(sshCtx(), deps, list, true)
    expect(items.map(i => i.hint)).toEqual(['ssh.hostKeyMismatch', 'ssh.authFailed', 'ssh.timeout', 'ssh.failed'])
    expect(items.every(i => i.status === 'fail')).toBe(true)
  })
})
