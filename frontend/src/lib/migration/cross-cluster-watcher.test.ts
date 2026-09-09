import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  applyRestorePlanMock,
  rollbackPrereqsOnSourceMock,
  pveFetchMock,
  decryptSecretMock,
  getTenantPrismaMock,
  getNodeIpMock,
  executeSSHDirectMock,
  shellEscapeMock,
  safeLogMock,
  orchestratorHeadersMock,
} = vi.hoisted(() => ({
  applyRestorePlanMock: vi.fn(),
  rollbackPrereqsOnSourceMock: vi.fn(),
  pveFetchMock: vi.fn(),
  decryptSecretMock: vi.fn(),
  getTenantPrismaMock: vi.fn(),
  getNodeIpMock: vi.fn(),
  executeSSHDirectMock: vi.fn(),
  shellEscapeMock: vi.fn(),
  safeLogMock: vi.fn(),
  orchestratorHeadersMock: vi.fn(),
}))

vi.mock('@/lib/migration/ccm-prereqs', () => ({
  applyRestorePlan: (...args: any[]) => applyRestorePlanMock(...args),
  rollbackPrereqsOnSource: (...args: any[]) => rollbackPrereqsOnSourceMock(...args),
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: (...args: any[]) => pveFetchMock(...args),
}))

vi.mock('@/lib/crypto/secret', () => ({
  decryptSecret: (...args: any[]) => decryptSecretMock(...args),
}))

vi.mock('@/lib/tenant', () => ({
  getTenantPrisma: (...args: any[]) => getTenantPrismaMock(...args),
}))

vi.mock('@/lib/ssh/node-ip', () => ({
  getNodeIp: (...args: any[]) => getNodeIpMock(...args),
}))

vi.mock('@/lib/ssh/exec', () => ({
  executeSSHDirect: (...args: any[]) => executeSSHDirectMock(...args),
  shellEscape: (...args: any[]) => shellEscapeMock(...args),
}))

vi.mock('@/lib/log/sanitize', () => ({
  safeLog: (...args: any[]) => safeLogMock(...args),
}))

vi.mock('@/lib/orchestrator/headers', () => ({
  orchestratorHeaders: (...args: any[]) => orchestratorHeadersMock(...args),
}))

import { watchMigrationAndCleanup } from './cross-cluster-watcher'

const SOURCE_CONN = { id: 'source-connection', name: 'Source' } as any
const TARGET_CONN = { id: 'target-connection', name: 'Target' } as any
const CAPTURE = { ha: { sid: 'vm:100' }, replicationJobs: [] } as any

const BASE_OPTS = {
  connectionId: 'source-connection',
  tenantId: 'tenant-1',
  sourceConn: SOURCE_CONN,
  sourceNode: 'source-node',
  vmid: '100',
  upid: 'UPID:source-node:123',
  deleteSource: false,
}

const deleteCalls = () => pveFetchMock.mock.calls.filter((call) => call[2]?.method === 'DELETE')

beforeEach(() => {
  applyRestorePlanMock.mockReset().mockResolvedValue({ restored: [], errors: [] })
  rollbackPrereqsOnSourceMock.mockReset().mockResolvedValue({ restored: [], errors: [] })
  pveFetchMock.mockReset()
  decryptSecretMock.mockReset()
  getTenantPrismaMock.mockReset()
  getNodeIpMock.mockReset().mockResolvedValue('10.0.0.10')
  executeSSHDirectMock.mockReset().mockResolvedValue({ success: true })
  shellEscapeMock.mockReset().mockImplementation((value: string) => `'${value}'`)
  safeLogMock.mockReset().mockImplementation((value: unknown) => String(value))
  orchestratorHeadersMock.mockReset().mockReturnValue({ 'Content-Type': 'application/json' })

  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('watchMigrationAndCleanup', () => {
  it('returns before polling when vmid is invalid', async () => {
    await watchMigrationAndCleanup({ ...BASE_OPTS, vmid: '9; rm -rf /' })

    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('rolls prerequisites back after the status poll times out', async () => {
    vi.useFakeTimers()
    pveFetchMock.mockResolvedValue({ status: 'running' })

    const watcher = watchMigrationAndCleanup({
      ...BASE_OPTS,
      restore: { capture: CAPTURE } as any,
    })
    await vi.advanceTimersByTimeAsync(21_600_000)
    await watcher

    // Kept polling instead of giving up on the first non-final status, without
    // pinning the exact poll budget: that number is a tuning knob, not a contract.
    expect(pveFetchMock.mock.calls.length).toBeGreaterThan(100)
    expect(rollbackPrereqsOnSourceMock).toHaveBeenCalledOnce()
    expect(rollbackPrereqsOnSourceMock).toHaveBeenCalledWith(SOURCE_CONN, CAPTURE)
  })

  it('rolls prerequisites back and does not restore the target after a failed migration', async () => {
    pveFetchMock.mockResolvedValueOnce({ status: 'stopped', exitstatus: 'command failed' })

    await watchMigrationAndCleanup({
      ...BASE_OPTS,
      targetConn: TARGET_CONN,
      restore: { capture: CAPTURE, restoreHa: true } as any,
    })

    expect(rollbackPrereqsOnSourceMock).toHaveBeenCalledOnce()
    expect(rollbackPrereqsOnSourceMock).toHaveBeenCalledWith(SOURCE_CONN, CAPTURE)
    expect(applyRestorePlanMock).not.toHaveBeenCalled()
  })

  it('does not roll prerequisites back when rollbackOnFailure is false', async () => {
    pveFetchMock.mockResolvedValueOnce({ status: 'stopped', exitstatus: 'command failed' })

    await watchMigrationAndCleanup({
      ...BASE_OPTS,
      restore: { capture: CAPTURE, rollbackOnFailure: false } as any,
    })

    expect(rollbackPrereqsOnSourceMock).not.toHaveBeenCalled()
  })

  it('treats migration problems as success when the task log says migration completed', async () => {
    const restore = { capture: CAPTURE, restoreHa: true } as any
    pveFetchMock
      .mockResolvedValueOnce({ status: 'stopped', exitstatus: 'migration problems' })
      .mockResolvedValueOnce([{ t: 'migration status: completed' }])
      .mockResolvedValueOnce({})

    await watchMigrationAndCleanup({ ...BASE_OPTS, targetConn: TARGET_CONN, restore })

    expect(applyRestorePlanMock).toHaveBeenCalledWith(TARGET_CONN, restore, {
      vmid: '100',
      type: 'qemu',
      node: undefined,
    })
    expect(rollbackPrereqsOnSourceMock).not.toHaveBeenCalled()
  })

  it('restores the target using targetVmid when set and source vmid otherwise', async () => {
    const restore = { capture: CAPTURE, restoreHa: true } as any
    pveFetchMock
      .mockResolvedValueOnce({ status: 'stopped', exitstatus: 'OK' })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ status: 'stopped', exitstatus: 'OK' })
      .mockResolvedValueOnce({})

    await watchMigrationAndCleanup({
      ...BASE_OPTS,
      targetConn: TARGET_CONN,
      targetNode: 'target-node',
      targetVmid: '200',
      guestType: 'lxc',
      restore,
    })
    await watchMigrationAndCleanup({
      ...BASE_OPTS,
      targetConn: TARGET_CONN,
      targetNode: 'target-node',
      restore,
    })

    expect(applyRestorePlanMock).toHaveBeenNthCalledWith(1, TARGET_CONN, restore, {
      vmid: '200',
      type: 'lxc',
      node: 'target-node',
    })
    expect(applyRestorePlanMock).toHaveBeenNthCalledWith(2, TARGET_CONN, restore, {
      vmid: '100',
      type: 'qemu',
      node: 'target-node',
    })
  })

  it('stops before source deletion when restoring the target reports errors', async () => {
    const restore = { capture: CAPTURE, restoreHa: true } as any
    pveFetchMock
      .mockResolvedValueOnce({ status: 'stopped', exitstatus: 'OK' })
      .mockResolvedValueOnce({})
    applyRestorePlanMock.mockResolvedValueOnce({ restored: [], errors: ['boom'] })

    await watchMigrationAndCleanup({
      ...BASE_OPTS,
      deleteSource: true,
      targetConn: TARGET_CONN,
      restore,
    })

    expect(applyRestorePlanMock).toHaveBeenCalledOnce()
    expect(deleteCalls()).toHaveLength(0)
  })

  it('does not unlock or delete when the source VM is already gone', async () => {
    pveFetchMock
      .mockResolvedValueOnce({ status: 'stopped', exitstatus: 'OK' })
      .mockRejectedValueOnce(new Error('HTTP 404: VM does not exist'))

    await watchMigrationAndCleanup({ ...BASE_OPTS, deleteSource: true })

    expect(getNodeIpMock).not.toHaveBeenCalled()
    expect(executeSSHDirectMock).not.toHaveBeenCalled()
    expect(deleteCalls()).toHaveLength(0)
  })

  it('unlocks a locked VM over SSH before deleting the source', async () => {
    pveFetchMock
      .mockResolvedValueOnce({ status: 'stopped', exitstatus: 'OK' })
      .mockResolvedValueOnce({ lock: 'migrate' })
      .mockResolvedValueOnce(undefined)
    getTenantPrismaMock.mockReturnValue({
      connection: {
        findUnique: vi.fn().mockResolvedValue({
          sshEnabled: true,
          sshPort: 22,
          sshUser: 'root',
          sshAuthMethod: 'password',
          sshPassEnc: 'encrypted-password',
          sshUseSudo: false,
        }),
      },
    })
    decryptSecretMock.mockReturnValue('password')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ success: true, output: 'unlocked' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await watchMigrationAndCleanup({ ...BASE_OPTS, deleteSource: true })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://proxcenter-orchestrator:8080/api/v1/ssh/exec',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('qm unlock 100'),
      }),
    )
    expect(deleteCalls()).toEqual([
      [
        SOURCE_CONN,
        '/nodes/source-node/qemu/100?purge=1&destroy-unreferenced-disks=1',
        { method: 'DELETE' },
      ],
    ])
  })
})
