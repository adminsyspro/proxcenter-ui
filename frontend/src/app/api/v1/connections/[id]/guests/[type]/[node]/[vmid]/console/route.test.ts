/**
 * POST /api/v1/connections/[id]/guests/[type]/[node]/[vmid]/console: open a
 * noVNC session. Every attempt is journaled under the ProxCenter user, with
 * the PVE UPID but never the session secrets (roadmap#41).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

import { callRoute } from '@/__tests__/setup/route-test'

const m = vi.hoisted(() => ({
  pveFetch: vi.fn(),
  getConnectionById: vi.fn(),
  checkPermission: vi.fn(),
  audit: vi.fn(),
}))

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: unknown[]) => m.pveFetch(...a) }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: (...a: unknown[]) => m.getConnectionById(...a) }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: unknown[]) => m.checkPermission(...a),
  buildVmResourceId: (id: string, node: string, type: string, vmid: string) => `${id}:${node}:${type}:${vmid}`,
  PERMISSIONS: { VM_CONSOLE: 'vm.console' },
}))
vi.mock('@/lib/audit', () => ({ audit: (...a: unknown[]) => m.audit(...a) }))

import { POST } from './route'

const PARAMS = { id: 'c1', type: 'qemu', node: 'pve1', vmid: '100' }
const call = (params: Record<string, string> = PARAMS) => callRoute(POST as any, { method: 'POST', params })
const UPID = 'UPID:pve1:00001234:00ABCDEF:65000000:vncproxy:100:proxcenter@pve!api:'

beforeEach(() => {
  vi.clearAllMocks()
  m.checkPermission.mockResolvedValue(null)
  m.audit.mockResolvedValue('a1')
  m.getConnectionById.mockResolvedValue({ id: 'c1', name: 'ml5-cl01', baseUrl: 'https://pve1:8006', apiToken: 'secret-token', insecureDev: false })
  m.pveFetch.mockResolvedValue({ port: '5900', ticket: 'PVEVNC:SECRET', cert: 'CERT', upid: UPID, user: 'proxcenter@pve!api' })
})

describe('POST .../console audit', () => {
  it('journals a successful open with the UPID and no session secret', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(m.audit).toHaveBeenCalledTimes(1)
    const entry = m.audit.mock.calls[0][0]
    expect(entry).toMatchObject({
      action: 'console.open',
      category: 'vms',
      resourceType: 'qemu',
      resourceId: '100',
      status: 'success',
      details: { connectionId: 'c1', connectionName: 'ml5-cl01', node: 'pve1', upid: UPID },
    })
    const serialized = JSON.stringify(entry)
    for (const secret of ['PVEVNC:SECRET', 'CERT', 'secret-token', '5900']) {
      expect(serialized).not.toContain(secret)
    }
  })

  it('files a container console under containers', async () => {
    await call({ ...PARAMS, type: 'lxc' })
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ category: 'containers', resourceType: 'lxc' }))
  })

  it('journals a failure when Proxmox refuses the vncproxy call', async () => {
    m.pveFetch.mockRejectedValueOnce(new Error('VM 100 not running'))
    const res = await call()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'VM 100 not running' })
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'console.open',
      status: 'failure',
      errorMessage: 'VM 100 not running',
      details: expect.not.objectContaining({ upid: expect.anything() }),
    }))
  })

  it('journals a failure when the connection is gone', async () => {
    m.getConnectionById.mockResolvedValueOnce(null)
    expect((await call()).status).toBe(404)
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ status: 'failure', errorMessage: 'Connection not found' }))
    expect(m.pveFetch).not.toHaveBeenCalled()
  })

  it('still opens the console when the journal write fails', async () => {
    m.audit.mockRejectedValueOnce(new Error('db down'))
    expect((await call()).status).toBe(200)
  })

  it('leaves an RBAC refusal to checkPermission without opening anything', async () => {
    m.checkPermission.mockResolvedValueOnce(NextResponse.json({ error: 'denied' }, { status: 403 }))
    expect((await call()).status).toBe(403)
    expect(m.checkPermission).toHaveBeenCalledWith('vm.console', 'vm', 'c1:pve1:qemu:100')
    expect(m.pveFetch).not.toHaveBeenCalled()
  })
})
