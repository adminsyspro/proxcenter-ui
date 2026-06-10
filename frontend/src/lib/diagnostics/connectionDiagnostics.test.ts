// src/lib/diagnostics/connectionDiagnostics.test.ts
//
// Unit tests for connectionDiagnostics: framework behaviour + PVE/PBS branching.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

// ---------------------------------------------------------------------------
// net mock -- controls tcpReachable without real sockets
// ---------------------------------------------------------------------------
// netConnectBehavior is set per test to either 'connect', 'error', or 'timeout'.
// The mock net.connect returns a minimal EventEmitter that fires the right event.

let netConnectBehavior: 'connect' | 'error' | 'timeout' = 'connect'
let netConnectError: Error = new Error('connect ECONNREFUSED')

vi.mock('net', () => {
  return {
    default: {
      connect: vi.fn((_opts: any) => {
        const emitter = new EventEmitter() as any
        emitter.setTimeout = (_ms: number) => {}
        emitter.destroy = () => {}
        // Schedule async so the promise has time to attach listeners.
        setImmediate(() => {
          if (netConnectBehavior === 'connect') {
            emitter.emit('connect')
          } else if (netConnectBehavior === 'timeout') {
            emitter.emit('timeout')
          } else {
            emitter.emit('error', netConnectError)
          }
        })
        return emitter
      }),
    },
  }
})

// Use vi.hoisted so mock factories can reference these before vi.mock is hoisted.
const { pveFetchMock, pbsFetchMock, executeSSHDirectMock } = vi.hoisted(() => ({
  pveFetchMock: vi.fn<(...args: any[]) => Promise<any>>(),
  pbsFetchMock: vi.fn<(...args: any[]) => Promise<any>>(),
  executeSSHDirectMock: vi.fn<(opts: any) => Promise<{ success: boolean; error?: string; output?: string }>>(
  ),
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: pveFetchMock,
}))

vi.mock('@/lib/proxmox/pbs-client', () => ({
  pbsFetch: pbsFetchMock,
}))

vi.mock('@/lib/ssh/exec', () => ({
  executeSSHDirect: executeSSHDirectMock,
}))

import {
  runCheck,
  runConnectionDiagnostics,
  type DiagnosticMeta,
} from './connectionDiagnostics'

// ---------------------------------------------------------------------------
// Minimal PVE and PBS client option stubs
// ---------------------------------------------------------------------------
const pveConn = { baseUrl: 'https://10.0.0.1:8006', apiToken: 'tok=secret' }
const pbsConn = { baseUrl: 'https://10.0.0.2:8007', apiToken: 'user@pbs!tok:secret' }

const pveMeta: DiagnosticMeta = {
  connectionId: 'c1',
  type: 'pve',
  hasCeph: false,
  sshEnabled: false,
}

const pbsMeta: DiagnosticMeta = {
  connectionId: 'c2',
  type: 'pbs',
}

beforeEach(() => {
  pveFetchMock.mockReset()
  pbsFetchMock.mockReset()
  executeSSHDirectMock.mockReset()
  // Reset TCP mock to the default happy path.
  netConnectBehavior = 'connect'
  netConnectError = new Error('connect ECONNREFUSED')
})

// ---------------------------------------------------------------------------
// runCheck: framework guarantees
// ---------------------------------------------------------------------------

describe('runCheck', () => {
  it('returns the fn result when the fn resolves normally', async () => {
    const result = await runCheck('test', 'network', 'A test', async () => ({
      status: 'ok',
      message: 'all good',
    }))
    expect(result.status).toBe('ok')
    expect(result.message).toBe('all good')
    expect(result.id).toBe('test')
    expect(result.category).toBe('network')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('catches a thrown error and returns status error without throwing', async () => {
    const result = await runCheck('boom', 'auth', 'Fail check', async () => {
      throw new Error('something exploded')
    })
    expect(result.status).toBe('error')
    expect(result.message).toContain('something exploded')
  })

  it('catches a timeout and returns status error', async () => {
    const result = await runCheck(
      'slow',
      'network',
      'Slow check',
      () => new Promise((resolve) => setTimeout(() => resolve({ status: 'ok', message: 'late' }), 200)),
      50, // 50ms timeout
    )
    expect(result.status).toBe('error')
    expect(result.message).toContain('timed out')
  }, 5000)

  it('propagates the detail field when the fn provides it', async () => {
    const result = await runCheck('d', 'storage', 'Detail check', async () => ({
      status: 'warn',
      message: 'High usage',
      detail: 'disk at 90%',
    }))
    expect(result.detail).toBe('disk at 90%')
  })
})

// ---------------------------------------------------------------------------
// PVE happy path
// ---------------------------------------------------------------------------

describe('runConnectionDiagnostics - PVE happy path', () => {
  function setupPveHappyPath() {
    // /version
    pveFetchMock.mockImplementation((_conn: any, path: string) => {
      if (path === '/version') return Promise.resolve({ version: '8.1.2' })
      if (path === '/access/permissions') return Promise.resolve({})
      if (path === '/cluster/resources') return Promise.resolve([])
      if (path === '/cluster/status') return Promise.resolve([
        { type: 'cluster', name: 'lab', quorate: 1 },
        { type: 'node', node: 'pve1', online: 1 },
      ])
      if (path === '/cluster/resources?type=storage') return Promise.resolve([
        { storage: 'local', status: 'active', disk: 10, maxdisk: 100 },
      ])
      return Promise.resolve(null)
    })
  }

  it('returns all expected check IDs for a PVE connection', async () => {
    setupPveHappyPath()
    const report = await runConnectionDiagnostics(pveMeta, pveConn)
    const ids = report.checks.map((c) => c.id)
    expect(ids).toContain('pve.network')
    expect(ids).toContain('pve.auth')
    expect(ids).toContain('pve.cluster')
    expect(ids).toContain('pve.storage')
    expect(ids).toContain('pve.ssh')
  })

  it('marks all checks ok on a healthy cluster', async () => {
    setupPveHappyPath()
    const report = await runConnectionDiagnostics(pveMeta, pveConn)
    for (const check of report.checks) {
      if (check.id === 'pve.ssh') continue // ssh disabled -> skip
      expect(check.status).toBe('ok')
    }
  })

  it('populates the summary counts correctly', async () => {
    setupPveHappyPath()
    const report = await runConnectionDiagnostics(pveMeta, pveConn)
    const total = report.summary.ok + report.summary.warn + report.summary.error + report.summary.skip
    expect(total).toBe(report.checks.length)
    expect(report.summary.skip).toBe(1) // ssh disabled
  })

  it('includes connectionId and type in the report', async () => {
    setupPveHappyPath()
    const report = await runConnectionDiagnostics(pveMeta, pveConn)
    expect(report.connectionId).toBe('c1')
    expect(report.type).toBe('pve')
    expect(report.ranAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

// ---------------------------------------------------------------------------
// PVE specific check behaviours
// ---------------------------------------------------------------------------

describe('runConnectionDiagnostics - PVE auth check', () => {
  it('returns error on auth check when both /access/permissions and /cluster/resources fail', async () => {
    pveFetchMock.mockImplementation((_conn: any, path: string) => {
      if (path === '/version') return Promise.resolve({ version: '8.0.0' })
      if (path === '/access/permissions') return Promise.reject(new Error('PVE 403 /access/permissions: forbidden'))
      if (path === '/cluster/resources') return Promise.reject(new Error('PVE 403 /cluster/resources: forbidden'))
      if (path === '/cluster/status') return Promise.resolve([])
      if (path === '/cluster/resources?type=storage') return Promise.resolve([])
      return Promise.resolve(null)
    })

    const report = await runConnectionDiagnostics(pveMeta, pveConn)
    const authCheck = report.checks.find((c) => c.id === 'pve.auth')
    expect(authCheck?.status).toBe('error')
  })

  it('returns warn on auth check when only one path fails', async () => {
    pveFetchMock.mockImplementation((_conn: any, path: string) => {
      if (path === '/version') return Promise.resolve({ version: '8.0.0' })
      if (path === '/access/permissions') return Promise.reject(new Error('PVE 403'))
      if (path === '/cluster/resources') return Promise.resolve([])
      if (path === '/cluster/status') return Promise.resolve([])
      if (path === '/cluster/resources?type=storage') return Promise.resolve([])
      return Promise.resolve(null)
    })

    const report = await runConnectionDiagnostics(pveMeta, pveConn)
    const authCheck = report.checks.find((c) => c.id === 'pve.auth')
    expect(authCheck?.status).toBe('warn')
  })
})

describe('runConnectionDiagnostics - PVE storage thresholds', () => {
  function setupBasePve() {
    pveFetchMock.mockImplementation((_conn: any, path: string) => {
      if (path === '/version') return Promise.resolve({ version: '8.0.0' })
      if (path === '/access/permissions') return Promise.resolve({})
      if (path === '/cluster/resources') return Promise.resolve([])
      if (path === '/cluster/status') return Promise.resolve([])
      return Promise.resolve(null)
    })
  }

  it('returns warn when a storage is at 90% usage', async () => {
    setupBasePve()
    pveFetchMock.mockImplementation((_conn: any, path: string) => {
      if (path === '/version') return Promise.resolve({ version: '8.0.0' })
      if (path === '/access/permissions') return Promise.resolve({})
      if (path === '/cluster/resources') return Promise.resolve([])
      if (path === '/cluster/status') return Promise.resolve([])
      if (path === '/cluster/resources?type=storage') return Promise.resolve([
        { storage: 'local', status: 'active', disk: 90, maxdisk: 100 },
      ])
      return Promise.resolve(null)
    })

    const report = await runConnectionDiagnostics(pveMeta, pveConn)
    const storageCheck = report.checks.find((c) => c.id === 'pve.storage')
    expect(storageCheck?.status).toBe('warn')
  })

  it('returns error when a storage is at 97% usage', async () => {
    pveFetchMock.mockImplementation((_conn: any, path: string) => {
      if (path === '/version') return Promise.resolve({ version: '8.0.0' })
      if (path === '/access/permissions') return Promise.resolve({})
      if (path === '/cluster/resources') return Promise.resolve([])
      if (path === '/cluster/status') return Promise.resolve([])
      if (path === '/cluster/resources?type=storage') return Promise.resolve([
        { storage: 'ceph-pool', status: 'active', disk: 97, maxdisk: 100 },
      ])
      return Promise.resolve(null)
    })

    const report = await runConnectionDiagnostics(pveMeta, pveConn)
    const storageCheck = report.checks.find((c) => c.id === 'pve.storage')
    expect(storageCheck?.status).toBe('error')
  })

  it('returns ok when storages are under 85%', async () => {
    pveFetchMock.mockImplementation((_conn: any, path: string) => {
      if (path === '/version') return Promise.resolve({ version: '8.0.0' })
      if (path === '/access/permissions') return Promise.resolve({})
      if (path === '/cluster/resources') return Promise.resolve([])
      if (path === '/cluster/status') return Promise.resolve([])
      if (path === '/cluster/resources?type=storage') return Promise.resolve([
        { storage: 'local', status: 'active', disk: 50, maxdisk: 100 },
      ])
      return Promise.resolve(null)
    })

    const report = await runConnectionDiagnostics(pveMeta, pveConn)
    const storageCheck = report.checks.find((c) => c.id === 'pve.storage')
    expect(storageCheck?.status).toBe('ok')
  })
})

describe('runConnectionDiagnostics - PVE SSH check', () => {
  function setupBasePveWithSsh() {
    pveFetchMock.mockImplementation((_conn: any, path: string) => {
      if (path === '/version') return Promise.resolve({ version: '8.0.0' })
      if (path === '/access/permissions') return Promise.resolve({})
      if (path === '/cluster/resources') return Promise.resolve([])
      if (path === '/cluster/status') return Promise.resolve([])
      if (path === '/cluster/resources?type=storage') return Promise.resolve([])
      return Promise.resolve(null)
    })
  }

  it('returns skip when sshEnabled is false', async () => {
    setupBasePveWithSsh()
    const report = await runConnectionDiagnostics({ ...pveMeta, sshEnabled: false }, pveConn)
    const sshCheck = report.checks.find((c) => c.id === 'pve.ssh')
    expect(sshCheck?.status).toBe('skip')
    expect(executeSSHDirectMock).not.toHaveBeenCalled()
  })

  it('returns skip (without calling executeSSHDirect) when sshEnabled but canManage is false', async () => {
    setupBasePveWithSsh()
    const meta: DiagnosticMeta = {
      ...pveMeta,
      sshEnabled: true,
      sshHost: '10.0.0.1',
      canManage: false,
    }
    const report = await runConnectionDiagnostics(meta, pveConn)
    const sshCheck = report.checks.find((c) => c.id === 'pve.ssh')
    expect(sshCheck?.status).toBe('skip')
    expect(sshCheck?.message).toContain('connection.manage')
    expect(executeSSHDirectMock).not.toHaveBeenCalled()
  })

  it('runs the SSH check when sshEnabled and canManage is true', async () => {
    setupBasePveWithSsh()
    executeSSHDirectMock.mockResolvedValueOnce({ success: true, output: 'pve1' })

    const meta: DiagnosticMeta = {
      ...pveMeta,
      sshEnabled: true,
      sshHost: '10.0.0.1',
      sshPort: 22,
      sshUser: 'root',
      sshPassword: 'secret',
      canManage: true,
    }
    const report = await runConnectionDiagnostics(meta, pveConn)
    const sshCheck = report.checks.find((c) => c.id === 'pve.ssh')
    expect(sshCheck?.status).toBe('ok')
    expect(executeSSHDirectMock).toHaveBeenCalledWith(
      expect.objectContaining({ host: '10.0.0.1', port: 22, user: 'root' }),
    )
  })

  it('returns ok when SSH connects successfully', async () => {
    setupBasePveWithSsh()
    executeSSHDirectMock.mockResolvedValueOnce({ success: true, output: 'pve1' })

    const meta: DiagnosticMeta = {
      ...pveMeta,
      sshEnabled: true,
      sshHost: '10.0.0.1',
      sshPort: 22,
      sshUser: 'root',
      sshPassword: 'secret',
      canManage: true,
    }
    const report = await runConnectionDiagnostics(meta, pveConn)
    const sshCheck = report.checks.find((c) => c.id === 'pve.ssh')
    expect(sshCheck?.status).toBe('ok')
    expect(executeSSHDirectMock).toHaveBeenCalledWith(
      expect.objectContaining({ host: '10.0.0.1', port: 22, user: 'root' }),
    )
  })

  it('returns error when SSH connection fails', async () => {
    setupBasePveWithSsh()
    executeSSHDirectMock.mockResolvedValueOnce({ success: false, error: 'Connection refused' })

    const meta: DiagnosticMeta = {
      ...pveMeta,
      sshEnabled: true,
      sshHost: '10.0.0.1',
      canManage: true,
    }
    const report = await runConnectionDiagnostics(meta, pveConn)
    const sshCheck = report.checks.find((c) => c.id === 'pve.ssh')
    expect(sshCheck?.status).toBe('error')
    expect(sshCheck?.detail).toContain('Connection refused')
  })
})

// ---------------------------------------------------------------------------
// PVE Ceph checks
// ---------------------------------------------------------------------------

describe('runConnectionDiagnostics - PVE Ceph check', () => {
  function setupPveWithCeph(cephStatus: any) {
    pveFetchMock.mockImplementation((_conn: any, path: string) => {
      if (path === '/version') return Promise.resolve({ version: '8.0.0' })
      if (path === '/access/permissions') return Promise.resolve({})
      if (path === '/cluster/resources') return Promise.resolve([])
      if (path === '/cluster/status') return Promise.resolve([
        { type: 'cluster', name: 'lab', quorate: 1 },
        { type: 'node', node: 'pve1', online: 1 },
      ])
      if (path === '/cluster/ceph/status') return Promise.resolve(cephStatus)
      if (path === '/cluster/resources?type=storage') return Promise.resolve([])
      return Promise.resolve(null)
    })
  }

  it('includes a ceph check when hasCeph is true', async () => {
    setupPveWithCeph({ health: { status: 'HEALTH_OK' } })
    const meta: DiagnosticMeta = { ...pveMeta, hasCeph: true }
    const report = await runConnectionDiagnostics(meta, pveConn)
    const cephCheck = report.checks.find((c) => c.id === 'pve.ceph')
    expect(cephCheck).toBeDefined()
    expect(cephCheck?.status).toBe('ok')
  })

  it('returns warn for HEALTH_WARN', async () => {
    setupPveWithCeph({ health: { status: 'HEALTH_WARN', checks: { OSDMAP_FLAGS: { severity: 'HEALTH_WARN', summary: { message: 'some flag set' } } } } })
    const meta: DiagnosticMeta = { ...pveMeta, hasCeph: true }
    const report = await runConnectionDiagnostics(meta, pveConn)
    const cephCheck = report.checks.find((c) => c.id === 'pve.ceph')
    expect(cephCheck?.status).toBe('warn')
  })

  it('returns error for HEALTH_ERR', async () => {
    setupPveWithCeph({ health: { status: 'HEALTH_ERR' } })
    const meta: DiagnosticMeta = { ...pveMeta, hasCeph: true }
    const report = await runConnectionDiagnostics(meta, pveConn)
    const cephCheck = report.checks.find((c) => c.id === 'pve.ceph')
    expect(cephCheck?.status).toBe('error')
  })

  it('does not include a ceph check when hasCeph is false', async () => {
    pveFetchMock.mockImplementation((_conn: any, path: string) => {
      if (path === '/version') return Promise.resolve({ version: '8.0.0' })
      if (path === '/access/permissions') return Promise.resolve({})
      if (path === '/cluster/resources') return Promise.resolve([])
      if (path === '/cluster/status') return Promise.resolve([])
      if (path === '/cluster/resources?type=storage') return Promise.resolve([])
      return Promise.resolve(null)
    })
    const report = await runConnectionDiagnostics(pveMeta, pveConn)
    const cephCheck = report.checks.find((c) => c.id === 'pve.ceph')
    expect(cephCheck).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// PBS checks
// ---------------------------------------------------------------------------

describe('runConnectionDiagnostics - PBS path', () => {
  it('runs version, auth, and datastore checks for PBS', async () => {
    pbsFetchMock.mockImplementation((_conn: any, path: string) => {
      if (path === '/version') return Promise.resolve({ version: '3.1.0' })
      if (path === '/admin/datastore') return Promise.resolve([
        { store: 'backup1' },
        { store: 'backup2' },
      ])
      if (path === '/admin/datastore/backup1/status') return Promise.resolve({ total: 1000, used: 200 })
      if (path === '/admin/datastore/backup2/status') return Promise.resolve({ total: 1000, used: 300 })
      return Promise.resolve(null)
    })

    const report = await runConnectionDiagnostics(pbsMeta, undefined, pbsConn)
    const ids = report.checks.map((c) => c.id)
    expect(ids).toContain('pbs.network')
    expect(ids).toContain('pbs.auth')
    expect(ids).toContain('pbs.datastore')
    expect(report.type).toBe('pbs')
  })

  it('returns ok when all PBS datastores are healthy', async () => {
    pbsFetchMock.mockImplementation((_conn: any, path: string) => {
      if (path === '/version') return Promise.resolve({ version: '3.1.0' })
      if (path === '/admin/datastore') return Promise.resolve([{ store: 'ds1' }])
      if (path.endsWith('/status')) return Promise.resolve({ total: 1000, used: 500 })
      return Promise.resolve(null)
    })

    const report = await runConnectionDiagnostics(pbsMeta, undefined, pbsConn)
    const datastoreCheck = report.checks.find((c) => c.id === 'pbs.datastore')
    expect(datastoreCheck?.status).toBe('ok')
  })

  it('returns warn when a PBS datastore is at 90%', async () => {
    pbsFetchMock.mockImplementation((_conn: any, path: string) => {
      if (path === '/version') return Promise.resolve({ version: '3.0.0' })
      if (path === '/admin/datastore') return Promise.resolve([{ store: 'ds1' }])
      if (path.endsWith('/status')) return Promise.resolve({ total: 100, used: 90 })
      return Promise.resolve(null)
    })

    const report = await runConnectionDiagnostics(pbsMeta, undefined, pbsConn)
    const datastoreCheck = report.checks.find((c) => c.id === 'pbs.datastore')
    expect(datastoreCheck?.status).toBe('warn')
  })

  it('returns error when a PBS datastore is at 97%', async () => {
    pbsFetchMock.mockImplementation((_conn: any, path: string) => {
      if (path === '/version') return Promise.resolve({ version: '3.0.0' })
      if (path === '/admin/datastore') return Promise.resolve([{ store: 'ds1' }])
      if (path.endsWith('/status')) return Promise.resolve({ total: 100, used: 97 })
      return Promise.resolve(null)
    })

    const report = await runConnectionDiagnostics(pbsMeta, undefined, pbsConn)
    const datastoreCheck = report.checks.find((c) => c.id === 'pbs.datastore')
    expect(datastoreCheck?.status).toBe('error')
  })

  it('returns error on auth check when /admin/datastore throws', async () => {
    pbsFetchMock.mockImplementation((_conn: any, path: string) => {
      if (path === '/version') return Promise.resolve({ version: '3.0.0' })
      if (path === '/admin/datastore') return Promise.reject(new Error('PBS 403'))
      return Promise.resolve(null)
    })

    const report = await runConnectionDiagnostics(pbsMeta, undefined, pbsConn)
    const authCheck = report.checks.find((c) => c.id === 'pbs.auth')
    expect(authCheck?.status).toBe('error')
  })

  it('returns warn when one datastore status fetch fails (fetch-failure downgrade)', async () => {
    pbsFetchMock.mockImplementation((_conn: any, path: string) => {
      if (path === '/version') return Promise.resolve({ version: '3.1.0' })
      if (path === '/admin/datastore') return Promise.resolve([
        { store: 'ds-ok' },
        { store: 'ds-fail' },
      ])
      if (path === '/admin/datastore/ds-ok/status') return Promise.resolve({ total: 1000, used: 200 })
      if (path === '/admin/datastore/ds-fail/status') return Promise.reject(new Error('connection refused'))
      return Promise.resolve(null)
    })

    const report = await runConnectionDiagnostics(pbsMeta, undefined, pbsConn)
    const datastoreCheck = report.checks.find((c) => c.id === 'pbs.datastore')
    expect(datastoreCheck?.status).toBe('warn')
    expect(datastoreCheck?.detail).toContain('ds-fail')
  })

  it('returns error (not masked by fetch-failure) when another datastore is over threshold', async () => {
    pbsFetchMock.mockImplementation((_conn: any, path: string) => {
      if (path === '/version') return Promise.resolve({ version: '3.1.0' })
      if (path === '/admin/datastore') return Promise.resolve([
        { store: 'ds-full' },
        { store: 'ds-fail' },
      ])
      if (path === '/admin/datastore/ds-full/status') return Promise.resolve({ total: 100, used: 97 })
      if (path === '/admin/datastore/ds-fail/status') return Promise.reject(new Error('timeout'))
      return Promise.resolve(null)
    })

    const report = await runConnectionDiagnostics(pbsMeta, undefined, pbsConn)
    const datastoreCheck = report.checks.find((c) => c.id === 'pbs.datastore')
    // error from threshold takes priority; failed datastore still surfaced in detail
    expect(datastoreCheck?.status).toBe('error')
    expect(datastoreCheck?.detail).toContain('ds-fail')
  })

  it('returns ok when all datastores are healthy with no fetch failures', async () => {
    pbsFetchMock.mockImplementation((_conn: any, path: string) => {
      if (path === '/version') return Promise.resolve({ version: '3.1.0' })
      if (path === '/admin/datastore') return Promise.resolve([{ store: 'ds1' }, { store: 'ds2' }])
      if (path.endsWith('/status')) return Promise.resolve({ total: 1000, used: 100 })
      return Promise.resolve(null)
    })

    const report = await runConnectionDiagnostics(pbsMeta, undefined, pbsConn)
    const datastoreCheck = report.checks.find((c) => c.id === 'pbs.datastore')
    expect(datastoreCheck?.status).toBe('ok')
  })
})

// ---------------------------------------------------------------------------
// Summary accounting
// ---------------------------------------------------------------------------

describe('summary counts', () => {
  it('summary totals always match checks length', async () => {
    pbsFetchMock.mockImplementation((_conn: any, path: string) => {
      if (path === '/version') return Promise.resolve({ version: '3.0.0' })
      if (path === '/admin/datastore') return Promise.resolve([{ store: 'ds1' }])
      if (path.endsWith('/status')) return Promise.resolve({ total: 100, used: 20 })
      return Promise.resolve(null)
    })

    const report = await runConnectionDiagnostics(pbsMeta, undefined, pbsConn)
    const { ok, warn, error, skip } = report.summary
    expect(ok + warn + error + skip).toBe(report.checks.length)
  })
})

// ---------------------------------------------------------------------------
// External (migration-source) reachability checks
// ---------------------------------------------------------------------------

describe('runConnectionDiagnostics - external types (vmware / xcpng / hyperv / nutanix)', () => {
  const vmwareMeta: DiagnosticMeta = {
    connectionId: 'ext1',
    type: 'vmware',
    baseUrl: 'https://vcenter.example.com:443',
  }

  it('returns ext.network ok when the TCP connection succeeds', async () => {
    netConnectBehavior = 'connect'
    const report = await runConnectionDiagnostics(vmwareMeta)
    expect(report.checks).toHaveLength(1)
    const check = report.checks[0]
    expect(check.id).toBe('ext.network')
    expect(check.category).toBe('network')
    expect(check.status).toBe('ok')
    expect(check.message).toContain('vcenter.example.com')
    expect(check.message).toContain('443')
    expect(check.detail).toContain('migration-source')
  })

  it('returns ext.network error when the TCP connection is refused', async () => {
    netConnectBehavior = 'error'
    netConnectError = new Error('connect ECONNREFUSED 192.168.1.10:443')
    const report = await runConnectionDiagnostics(vmwareMeta)
    const check = report.checks[0]
    expect(check.id).toBe('ext.network')
    expect(check.status).toBe('error')
    expect(check.message).toContain('ECONNREFUSED')
  })

  it('returns ext.network error when the TCP connection times out', async () => {
    netConnectBehavior = 'timeout'
    const report = await runConnectionDiagnostics({ ...vmwareMeta, baseUrl: 'https://10.0.0.5' })
    const check = report.checks[0]
    expect(check.id).toBe('ext.network')
    expect(check.status).toBe('error')
    expect(check.message).toMatch(/timed out/i)
  })

  it('returns ext.network skip when baseUrl is absent', async () => {
    const meta: DiagnosticMeta = { connectionId: 'ext2', type: 'xcpng' }
    const report = await runConnectionDiagnostics(meta)
    const check = report.checks[0]
    expect(check.id).toBe('ext.network')
    expect(check.status).toBe('skip')
    expect(check.message).toContain('No base URL')
  })

  it('returns ext.network skip when baseUrl is not a valid URL', async () => {
    const meta: DiagnosticMeta = { connectionId: 'ext3', type: 'hyperv', baseUrl: 'not-a-url' }
    const report = await runConnectionDiagnostics(meta)
    const check = report.checks[0]
    expect(check.id).toBe('ext.network')
    expect(check.status).toBe('skip')
    expect(check.message).toContain('could not be parsed')
  })

  it('defaults port to 443 for https when no explicit port is in the URL', async () => {
    netConnectBehavior = 'connect'
    const meta: DiagnosticMeta = {
      connectionId: 'ext4',
      type: 'nutanix',
      baseUrl: 'https://nutanix.local',
    }
    const report = await runConnectionDiagnostics(meta)
    const check = report.checks[0]
    expect(check.status).toBe('ok')
    expect(check.message).toContain(':443')
  })

  it('defaults port to 80 for http when no explicit port is in the URL', async () => {
    netConnectBehavior = 'connect'
    const meta: DiagnosticMeta = {
      connectionId: 'ext5',
      type: 'vmware',
      baseUrl: 'http://internal-esxi.lan',
    }
    const report = await runConnectionDiagnostics(meta)
    const check = report.checks[0]
    expect(check.status).toBe('ok')
    expect(check.message).toContain(':80')
  })

  it('summary reflects a single ok check for a reachable external connection', async () => {
    netConnectBehavior = 'connect'
    const report = await runConnectionDiagnostics(vmwareMeta)
    expect(report.summary.ok).toBe(1)
    expect(report.summary.error).toBe(0)
    expect(report.summary.skip).toBe(0)
  })

  it('summary reflects a single error check for an unreachable external connection', async () => {
    netConnectBehavior = 'error'
    const report = await runConnectionDiagnostics(vmwareMeta)
    expect(report.summary.error).toBe(1)
    expect(report.summary.ok).toBe(0)
  })
})
