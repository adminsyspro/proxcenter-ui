/**
 * POST /api/v1/connections/[id]/guests/[type]/[node]/[vmid]/template: convert a
 * guest into a template. Gated by vm.config.hardware on the guest (#897).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The API token guard is covered by routeGuard.test.ts and writeContract.test.ts:
// pass-through so this file keeps testing the handler, as for a session caller.
vi.mock('@/lib/api-tokens/routeGuard', () => ({
  withPublicApiGuard: (_entryId: string, handler: any) => handler,
}))
import { NextResponse } from 'next/server'

import { callRoute } from '@/__tests__/setup/route-test'

const m = vi.hoisted(() => ({
  pveFetch: vi.fn(),
  getConnectionById: vi.fn(),
  checkPermission: vi.fn(),
  invalidateInventoryCache: vi.fn(),
  audit: vi.fn(),
}))

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: unknown[]) => m.pveFetch(...a) }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: (...a: unknown[]) => m.getConnectionById(...a) }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: unknown[]) => m.checkPermission(...a),
  buildVmResourceId: (id: string, node: string, type: string, vmid: string) => `${id}:${node}:${type}:${vmid}`,
  PERMISSIONS: { VM_CONFIG_HARDWARE: 'vm.config.hardware' },
}))
vi.mock('@/lib/cache/inventoryCache', () => ({ invalidateInventoryCache: (...a: unknown[]) => m.invalidateInventoryCache(...a) }))
vi.mock('@/lib/audit', async () => {
  // audit() flips the request's audit scope so withAudit() adds no row of its
  // own (#1105); the stand-in must do the same or every explicit row doubles.
  const { markAuditExplicit } = await vi.importActual<typeof import('@/lib/audit/scope')>('@/lib/audit/scope')
  return { audit: (...a: unknown[]) => { markAuditExplicit(); return m.audit(...a) } }
})

import { POST } from './route'

const PARAMS = { id: 'c1', type: 'qemu', node: 'pve1', vmid: '100' }
const call = (params: Record<string, string> = PARAMS) => callRoute(POST as any, { method: 'POST', params })

beforeEach(() => {
  vi.clearAllMocks()
  m.checkPermission.mockResolvedValue(null)
  m.getConnectionById.mockResolvedValue({ id: 'c1' })
  m.pveFetch.mockResolvedValue('UPID:pve1:0001')
})

describe('POST .../template', () => {
  it('400s on missing parameters or an unknown guest type', async () => {
    expect((await call({ id: 'c1', type: 'qemu', node: 'pve1' } as any)).status).toBe(400)
    expect((await call({ ...PARAMS, type: 'openvz' })).status).toBe(400)
    expect(m.pveFetch).not.toHaveBeenCalled()
  })

  it('checks vm.config.hardware on the guest before doing anything', async () => {
    m.checkPermission.mockResolvedValueOnce(NextResponse.json({ error: 'denied' }, { status: 403 }))
    expect((await call()).status).toBe(403)
    expect(m.checkPermission).toHaveBeenCalledWith('vm.config.hardware', 'vm', 'c1:pve1:qemu:100')
    expect(m.pveFetch).not.toHaveBeenCalled()
  })

  it('posts the conversion to Proxmox, invalidates the inventory cache and audits it', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(m.pveFetch).toHaveBeenCalledWith({ id: 'c1' }, '/nodes/pve1/qemu/100/template', expect.objectContaining({ method: 'POST' }))
    expect(m.invalidateInventoryCache).toHaveBeenCalled()
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ category: 'vms', resourceType: 'qemu', resourceId: '100', details: expect.objectContaining({ action: 'convert_to_template' }) }))
    expect(await res.json()).toEqual({ data: 'UPID:pve1:0001', message: 'Convert to template operation started' })
  })

  it('files a container under containers', async () => {
    await call({ ...PARAMS, type: 'lxc' })
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ category: 'containers', resourceType: 'lxc' }))
  })

  it('answers 500 when Proxmox refuses', async () => {
    m.pveFetch.mockRejectedValueOnce(new Error('VM is running'))
    const res = await call()
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('VM is running')
    // The route never reached its own audit(): the failure row is withAudit()'s.
    expect(m.audit).toHaveBeenCalledTimes(1)
    expect(m.audit.mock.calls[0][0]).toMatchObject({
      category: 'vms', action: 'update', resourceType: 'qemu', resourceId: '100', status: 'failure', errorMessage: 'VM is running',
      details: expect.objectContaining({ method: 'POST', httpStatus: 500, params: PARAMS }),
    })
  })
})
