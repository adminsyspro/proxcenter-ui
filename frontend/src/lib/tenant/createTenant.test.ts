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

describe('createTenant provider switches', () => {
  it('keeps the built-in catalogue on and API self-service off by default', async () => {
    const tenant = await createTenant({ slug: 'acme', name: 'Acme' })
    expect(tenantCreateMock.mock.calls[0][0].data).toMatchObject({ builtInCatalog: true, apiSelfService: false })
    expect(tenant).toMatchObject({ builtInCatalog: true, apiSelfService: false })
  })

  it('applies both switches of the create dialog', async () => {
    await createTenant({ slug: 'acme', name: 'Acme', builtInCatalog: false, apiSelfService: true })
    expect(tenantCreateMock.mock.calls[0][0].data).toMatchObject({ builtInCatalog: false, apiSelfService: true })
  })
})
