import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn<(...args: any[]) => Promise<Response | null>>(),
  PERMISSIONS: {
    CONNECTION_VIEW: 'connection.view',
  },
}))

vi.mock('@/lib/vdc/scope', () => ({
  guardTenantStorageWrite: vi.fn<(connId: string, storage: string) => Promise<Response | null>>(),
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: vi.fn<(id: string) => Promise<any>>(),
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: vi.fn<(...args: any[]) => Promise<any>>(),
}))

vi.mock('@/lib/tenant/infraScope', () => ({
  getTenantInfrastructureScope: vi.fn<(tenantId: string) => Promise<any>>(),
  maskingScope: vi.fn<(infra: any) => any>(),
}))

vi.mock('@/lib/tenant', () => ({
  getCurrentTenantId: vi.fn<() => Promise<string>>(),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    tenant: {
      findUnique: vi.fn<(args: any) => Promise<any>>(),
    },
  },
}))

vi.mock('@/lib/audit', () => ({
  audit: vi.fn<(...args: any[]) => Promise<void>>(),
}))

import { DELETE } from './route'
import { checkPermission } from '@/lib/rbac'
import { guardTenantStorageWrite } from '@/lib/vdc/scope'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { maskingScope, getTenantInfrastructureScope } from '@/lib/tenant/infraScope'
import { getCurrentTenantId } from '@/lib/tenant'
import { prisma } from '@/lib/db/prisma'
import { audit } from '@/lib/audit'

const checkPermissionMock = checkPermission as any
const guardTenantStorageWriteMock = guardTenantStorageWrite as any
const getConnectionByIdMock = getConnectionById as any
const pveFetchMock = pveFetch as any
const maskingScopeMock = maskingScope as any
const getTenantInfrastructureScopeMock = getTenantInfrastructureScope as any
const getCurrentTenantIdMock = getCurrentTenantId as any
const tenantFindUniqueMock = prisma.tenant.findUnique as any
const auditMock = audit as any

const BASE_PARAMS = {
  id: 'conn-1',
  node: 'pve-node-01',
  storage: 'local',
  volid: 'local%3Aiso%2Fubuntu-22.04.iso',
}

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  guardTenantStorageWriteMock.mockResolvedValue(null)
  getConnectionByIdMock.mockResolvedValue({ id: 'conn-1' })
  pveFetchMock.mockResolvedValue(null)
  maskingScopeMock.mockReturnValue(null) // provider: no tenant restriction
  getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })
  getCurrentTenantIdMock.mockResolvedValue('provider-tenant')
  tenantFindUniqueMock.mockResolvedValue(null)
  auditMock.mockResolvedValue(undefined)
})

describe('DELETE /api/v1/connections/[id]/nodes/[node]/storage/[storage]/content/[volid]', () => {
  it('returns 200 and calls pveFetch with the decoded volid path', async () => {
    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: BASE_PARAMS,
    })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.success).toBe(true)

    // volid is decoded from "local%3Aiso%2Fubuntu-22.04.iso" to "local:iso/ubuntu-22.04.iso"
    // then re-encoded for the URL segment
    expect(pveFetchMock).toHaveBeenCalledWith(
      { id: 'conn-1' },
      '/nodes/pve-node-01/storage/local/content/local%3Aiso%2Fubuntu-22.04.iso',
      { method: 'DELETE' },
    )
  })

  it('403 when checkPermission denies', async () => {
    const denied = new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })
    checkPermissionMock.mockResolvedValue(denied)

    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: BASE_PARAMS,
    })

    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('403 when guardTenantStorageWrite blocks', async () => {
    const blocked = new Response(JSON.stringify({ error: 'Storage not accessible' }), { status: 403 })
    guardTenantStorageWriteMock.mockResolvedValue(blocked)

    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: BASE_PARAMS,
    })

    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('403 when tenant tries to delete an ISO not prefixed with their slug', async () => {
    maskingScopeMock.mockReturnValue({ something: 'non-null' }) // non-null scope = tenant
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'iaas', vdcScope: {} })
    getCurrentTenantIdMock.mockResolvedValue('tenant-abc')
    tenantFindUniqueMock.mockResolvedValue({ slug: 'acme' })

    // volid: "local:iso/ubuntu-22.04.iso" — no custom-acme- prefix
    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: {
        ...BASE_PARAMS,
        volid: encodeURIComponent('local:iso/ubuntu-22.04.iso'),
      },
    })

    expect(res.status).toBe(403)
    const body = await readJson<any>(res)
    expect(body.error).toBe('Volume not accessible')
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('200 when tenant deletes an ISO with matching slug prefix', async () => {
    maskingScopeMock.mockReturnValue({ something: 'non-null' })
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'iaas', vdcScope: {} })
    getCurrentTenantIdMock.mockResolvedValue('tenant-abc')
    tenantFindUniqueMock.mockResolvedValue({ slug: 'acme' })

    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: {
        ...BASE_PARAMS,
        volid: encodeURIComponent('local:iso/custom-acme-my.iso'),
      },
    })

    expect(res.status).toBe(200)
    expect(pveFetchMock).toHaveBeenCalled()
  })

  it('200 when tenant deletes a non-controlled content type (backup), no slug check', async () => {
    maskingScopeMock.mockReturnValue({ something: 'non-null' })
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'iaas', vdcScope: {} })
    getCurrentTenantIdMock.mockResolvedValue('tenant-abc')

    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: {
        ...BASE_PARAMS,
        storage: 'backups',
        volid: encodeURIComponent('backups:backup/vzdump-qemu-100-2024_01_01-00_00_00.vma.zst'),
      },
    })

    expect(res.status).toBe(200)
    expect(pveFetchMock).toHaveBeenCalled()
    // slug check never needed for 'backup' content type
    expect(tenantFindUniqueMock).not.toHaveBeenCalled()
  })

  it('falls back to tenantId as slug when tenant row not found', async () => {
    maskingScopeMock.mockReturnValue({ something: 'non-null' })
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'iaas', vdcScope: {} })
    getCurrentTenantIdMock.mockResolvedValue('acme123')
    tenantFindUniqueMock.mockResolvedValue(null) // no slug row

    // filename with matching slug derived from tenantId
    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: {
        ...BASE_PARAMS,
        volid: encodeURIComponent('local:iso/custom-acme123-test.iso'),
      },
    })

    expect(res.status).toBe(200)
  })

  it('calls audit after successful delete', async () => {
    await callRoute(DELETE as any, {
      method: 'DELETE',
      params: BASE_PARAMS,
    })

    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'delete',
        category: 'storage',
        resourceType: 'storage',
        resourceId: 'local',
        details: expect.objectContaining({ node: 'pve-node-01', connectionId: 'conn-1' }),
      }),
    )
  })

  it('500 on pveFetch throw', async () => {
    pveFetchMock.mockRejectedValue(new Error('PVE unreachable'))

    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: BASE_PARAMS,
    })

    expect(res.status).toBe(500)
    const body = await readJson<any>(res)
    expect(body.error).toContain('PVE unreachable')
  })
})
