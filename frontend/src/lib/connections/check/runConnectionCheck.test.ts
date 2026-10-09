// src/lib/connections/check/runConnectionCheck.test.ts
//
// The runner: isolation of a failing probe, the time bound, item ordering and
// the SSH prerequisite.

import { describe, expect, it, vi } from 'vitest'

import { PRIVILEGE_REQUIREMENTS } from './privilegeMap'
import { guardProbe, runConnectionCheck } from './runConnectionCheck'
import type { CheckContext, CheckDeps } from './types'

function makeCtx(overrides: Partial<CheckContext> = {}): CheckContext {
  return {
    connectionId: 'c1',
    conn: { id: 'c1', baseUrl: 'https://10.42.0.101:8006', apiToken: 'u@pve!t=s', insecureDev: true, behindProxy: false },
    fallbackHosts: [],
    pinnedFingerprint: null,
    ssh: { enabled: true, user: 'root', port: 22, key: 'KEY', overrides: [] },
    ...overrides,
  }
}

const NOW = Date.UTC(2026, 9, 9)

/** Every privilege of the map, propagated from /. */
const FULL_PERMISSIONS = {
  '/': Object.fromEntries(PRIVILEGE_REQUIREMENTS.flatMap(r => r.privileges).map(p => [p, 1])),
}

function makeDeps(overrides: Partial<CheckDeps> = {}): CheckDeps {
  return {
    directGet: vi.fn(async () => ({ statusCode: 200, data: { version: '9.2.11' } })),
    pveGet: vi.fn(async (path: string) => {
      if (path === '/nodes') return [{ node: 'pve1', status: 'online' }]
      if (path === '/access/permissions') return FULL_PERMISSIONS
      if (path === '/cluster/status') return [{ type: 'node', name: 'pve1', online: 1 }]
      if (path.endsWith('/version')) return { version: '9.2.11' }
      if (path.endsWith('/time')) return { time: Math.round(NOW / 1000) }
      return {}
    }) as CheckDeps['pveGet'],
    readCertificate: vi.fn(async () => ({
      validFrom: new Date(NOW - 86_400_000).toUTCString(),
      validTo: new Date(NOW + 365 * 86_400_000).toUTCString(),
      fingerprint: 'AA',
      authorized: true,
    })),
    resolveSshEndpoint: vi.fn(async () => ({ host: '10.42.0.101', port: 22 })),
    sshExec: vi.fn(async () => ({ success: true, output: 'pve1' })),
    now: () => NOW,
    ...overrides,
  }
}

describe('guardProbe', () => {
  it('turns a throw into one failed item', async () => {
    const items = await guardProbe('quorum', async () => { throw new Error('boom') })
    expect(items).toEqual([{ id: 'quorum', probe: 'quorum', status: 'fail', hint: 'probe.crashed', params: { probe: 'quorum', error: 'boom' } }])
  })

  it('turns an overrun into one failed item within the budget', async () => {
    const items = await guardProbe('clock', () => new Promise(() => {}), 20)
    expect(items).toEqual([{ id: 'clock', probe: 'clock', status: 'fail', hint: 'probe.timeout', params: { probe: 'clock', timeoutMs: 20 } }])
  })
})

describe('runConnectionCheck', () => {
  it('runs every probe and orders the items api, tls, privileges, version, clock, quorum, ssh', async () => {
    const deps = makeDeps()
    const items = await runConnectionCheck(makeCtx(), deps)
    expect(items.map(i => i.probe)).toEqual(['api', 'api', 'tls', 'tls', 'privileges', 'version', 'clock', 'quorum', 'ssh'])
    expect(items.find(i => i.id === 'ssh.pve1')).toMatchObject({ status: 'ok' })
    expect(deps.sshExec).toHaveBeenCalledTimes(1)
  })

  it('keeps the other probes when one throws', async () => {
    const deps = makeDeps({ readCertificate: vi.fn(async () => { throw new TypeError('tls module exploded') }) })
    const items = await runConnectionCheck(makeCtx(), deps)
    // probeTls catches its own transport error; make the whole probe crash instead.
    expect(items.find(i => i.id === 'tls.certificate')).toMatchObject({ status: 'fail', hint: 'tls.unreachable' })
    expect(items.filter(i => i.probe !== 'tls').every(i => i.status !== 'fail')).toBe(true)
    expect(items.some(i => i.probe === 'quorum' && i.status === 'ok')).toBe(true)
  })

  it('skips SSH when the primary API probe failed', async () => {
    const deps = makeDeps({ directGet: vi.fn(async () => { throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }) }) })
    const items = await runConnectionCheck(makeCtx(), deps)
    expect(items.find(i => i.probe === 'ssh')).toMatchObject({ id: 'ssh', status: 'skip', hint: 'ssh.prerequisitesFailed' })
    expect(deps.sshExec).not.toHaveBeenCalled()
  })

  it('skips SSH when the certificate is broken, not when it is merely untrusted', async () => {
    const expired = makeDeps({
      readCertificate: vi.fn(async () => ({ validFrom: 'x', validTo: new Date(NOW - 86_400_000).toUTCString(), fingerprint: 'AA', authorized: true })),
    })
    expect((await runConnectionCheck(makeCtx(), expired)).find(i => i.probe === 'ssh')?.hint).toBe('ssh.prerequisitesFailed')

    const untrusted = makeDeps({
      readCertificate: vi.fn(async () => ({ validFrom: 'x', validTo: new Date(NOW + 300 * 86_400_000).toUTCString(), fingerprint: 'AA', authorized: false })),
    })
    const ctx = makeCtx()
    ctx.conn.insecureDev = false
    expect((await runConnectionCheck(ctx, untrusted)).find(i => i.probe === 'ssh')?.hint).toBe('ssh.ok')
  })

  it('reports the node list failure on the per-node probes without blocking the rest', async () => {
    const deps = makeDeps({
      pveGet: vi.fn(async (path: string) => {
        if (path === '/nodes') throw new Error('PVE 500 /nodes: down')
        if (path === '/access/permissions') return FULL_PERMISSIONS
        if (path === '/cluster/status') return [{ type: 'node', name: 'pve1', online: 1 }]
        return {}
      }) as CheckDeps['pveGet'],
    })
    const items = await runConnectionCheck(makeCtx(), deps)
    expect(items.find(i => i.id === 'version')).toMatchObject({ status: 'skip', hint: 'nodes.unreadable' })
    expect(items.find(i => i.id === 'clock')).toMatchObject({ status: 'skip', hint: 'nodes.unreadable' })
    expect(items.find(i => i.id === 'ssh')).toMatchObject({ status: 'skip', hint: 'nodes.unreadable' })
    expect(items.find(i => i.id === 'quorum')).toMatchObject({ status: 'ok' })
  })
})
