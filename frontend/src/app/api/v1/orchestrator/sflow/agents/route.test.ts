import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

vi.mock('@/lib/tenant', () => ({
  getCurrentTenantId: vi.fn<() => Promise<string>>(),
  getSessionPrisma: vi.fn<() => Promise<any>>(),
}))

vi.mock('@/lib/orchestrator', () => ({
  orchestratorFetch: vi.fn<(...args: any[]) => Promise<any>>(),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn<(...args: any[]) => Promise<any>>(),
  PERMISSIONS: { CONNECTION_MANAGE: 'connection.manage' },
}))

vi.mock('@/lib/ssh/exec', () => ({
  executeSSH: vi.fn<(...args: any[]) => Promise<any>>(),
  // Mirror the real single-quote shell escaper so command assertions match.
  shellEscape: (arg: string) => "'" + arg.replaceAll("'", "'\\''") + "'",
}))

import { POST } from './route'
import { getCurrentTenantId, getSessionPrisma } from '@/lib/tenant'
import { checkPermission } from '@/lib/rbac'
import { executeSSH } from '@/lib/ssh/exec'

const getCurrentTenantIdMock = getCurrentTenantId as any
const getSessionPrismaMock = getSessionPrisma as any
const checkPermissionMock = checkPermission as any
const executeSSHMock = executeSSH as any

const NODE_REQ = { node: 'pve1', ip: '10.0.0.1', connectionId: 'conn-1' }

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getCurrentTenantIdMock.mockResolvedValue('tenant-1')
  getSessionPrismaMock.mockResolvedValue({
    connection: { findMany: vi.fn().mockResolvedValue([{ id: 'conn-1' }]) },
  })
  executeSSHMock.mockResolvedValue({ success: true, output: '' })
})

describe('POST /sflow/agents — happy path', () => {
  it('shell-escapes the collector target and coerces the rates into the command', async () => {
    const res = await callRoute(POST as any, {
      method: 'POST',
      body: {
        nodes: [NODE_REQ],
        collectorTarget: '10.0.0.5:6343',
        samplingRate: 1024,
        pollingInterval: 15,
      },
    })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.success).toBe(true)
    expect(body.configured).toBe(1)

    expect(executeSSHMock).toHaveBeenCalledTimes(1)
    const [, , cmd] = executeSSHMock.mock.calls[0]
    expect(cmd).toContain("target='10.0.0.5:6343'")
    expect(cmd).toContain('sampling=1024')
    expect(cmd).toContain('polling=15')
  })

  it('coerces string-typed numeric rates from the body', async () => {
    const res = await callRoute(POST as any, {
      method: 'POST',
      body: { nodes: [NODE_REQ], collectorTarget: 'collector.local:6343', samplingRate: '256', pollingInterval: '20' },
    })
    expect(res.status).toBe(200)
    const [, , cmd] = executeSSHMock.mock.calls[0]
    expect(cmd).toContain('sampling=256')
    expect(cmd).toContain('polling=20')
  })
})

describe('POST /sflow/agents — input validation (command injection)', () => {
  it('403 when RBAC denies connection.manage', async () => {
    checkPermissionMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    )
    const res = await callRoute(POST as any, {
      method: 'POST',
      body: { nodes: [NODE_REQ], collectorTarget: '10.0.0.5:6343' },
    })
    expect(res.status).toBe(403)
    expect(executeSSHMock).not.toHaveBeenCalled()
  })

  const BAD_TARGETS = [
    '10.0.0.5:6343; reboot',
    '$(id)',
    '`whoami`',
    '10.0.0.5:6343 && curl evil',
    "10.0.0.5';rm -rf /;'",
    'target with spaces',
  ]
  for (const collectorTarget of BAD_TARGETS) {
    it(`rejects collector target ${JSON.stringify(collectorTarget)} with 400 and never runs SSH`, async () => {
      const res = await callRoute(POST as any, {
        method: 'POST',
        body: { nodes: [NODE_REQ], collectorTarget },
      })
      expect(res.status).toBe(400)
      const body = await readJson<any>(res)
      expect(body.error).toMatch(/collector target/i)
      expect(executeSSHMock).not.toHaveBeenCalled()
    })
  }

  const BAD_RATES = [
    { samplingRate: '10; reboot' },
    { samplingRate: 0 },
    { samplingRate: 1.5 },
    { pollingInterval: '$(id)' },
    { pollingInterval: 0 },
    { pollingInterval: 999999 },
  ]
  for (const extra of BAD_RATES) {
    it(`rejects rates ${JSON.stringify(extra)} with 400 and never runs SSH`, async () => {
      const res = await callRoute(POST as any, {
        method: 'POST',
        body: { nodes: [NODE_REQ], collectorTarget: '10.0.0.5:6343', ...extra },
      })
      expect(res.status).toBe(400)
      expect(executeSSHMock).not.toHaveBeenCalled()
    })
  }
})
