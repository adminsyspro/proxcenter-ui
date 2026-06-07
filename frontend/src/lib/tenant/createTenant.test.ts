import { beforeEach, describe, expect, it, vi } from 'vitest'

const { tenantCreateMock, rbacUserRoleFindManyMock, userTenantCreateManyMock } = vi.hoisted(() => ({
  tenantCreateMock: vi.fn(),
  rbacUserRoleFindManyMock: vi.fn(),
  userTenantCreateManyMock: vi.fn(),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    tenant: { create: tenantCreateMock },
    rbacUserRole: { findMany: rbacUserRoleFindManyMock },
    userTenant: { createMany: userTenantCreateManyMock },
  },
}))

import { createTenant } from './index'

beforeEach(() => {
  // Return the data back as the created row so rowToTenant() can map it.
  tenantCreateMock.mockReset().mockImplementation(async ({ data }: any) => ({ ...data }))
  rbacUserRoleFindManyMock.mockReset().mockResolvedValue([])
  userTenantCreateManyMock.mockReset().mockResolvedValue({})
})

describe('createTenant operating_model default', () => {
  it("defaults operating_model to 'iaas' when not specified", async () => {
    await createTenant({ slug: 'acme', name: 'Acme' })
    expect(tenantCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ operatingModel: 'iaas' }) }),
    )
  })

  it("writes 'msp' when explicitly requested", async () => {
    await createTenant({ slug: 'msp-cust', name: 'MSP Cust', operatingModel: 'msp' })
    expect(tenantCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ operatingModel: 'msp' }) }),
    )
  })
})
