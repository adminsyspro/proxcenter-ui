import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next-auth', () => ({
  getServerSession: vi.fn<(...args: any[]) => Promise<any>>(),
}))

vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))

vi.mock('@/lib/rbac', () => ({
  isUserSuperAdmin: vi.fn<(userId: string) => Promise<boolean>>(),
}))

import { canReadFleetStorage } from './fleetScope'
import { getServerSession } from 'next-auth'
import { isUserSuperAdmin } from '@/lib/rbac'

const getServerSessionMock = getServerSession as any
const isUserSuperAdminMock = isUserSuperAdmin as any

beforeEach(() => {
  vi.clearAllMocks()
  isUserSuperAdminMock.mockResolvedValue(true)
})

describe('canReadFleetStorage', () => {
  it('grants a super admin whose raw session tenant is the provider tenant', async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: 'u-1', tenantId: 'default' } })

    await expect(canReadFleetStorage()).resolves.toBe(true)
    expect(isUserSuperAdminMock).toHaveBeenCalledWith('u-1')
  })

  it('denies a custom tenant session even for a super admin', async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: 'u-1', tenantId: 'tenant-a' } })

    await expect(canReadFleetStorage()).resolves.toBe(false)
    // The super-admin lookup must not even run: the raw tenant already decides.
    expect(isUserSuperAdminMock).not.toHaveBeenCalled()
  })

  it('denies a provider tenant session that is not super admin', async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: 'u-1', tenantId: 'default' } })
    isUserSuperAdminMock.mockResolvedValue(false)

    await expect(canReadFleetStorage()).resolves.toBe(false)
  })

  it('denies a session whose tenantId is missing, rather than falling back to the provider tenant', async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: 'u-1' } })

    await expect(canReadFleetStorage()).resolves.toBe(false)
    expect(isUserSuperAdminMock).not.toHaveBeenCalled()
  })

  it('denies when there is no session at all', async () => {
    getServerSessionMock.mockResolvedValue(null)

    await expect(canReadFleetStorage()).resolves.toBe(false)
  })

  it('denies when the session carries no user id', async () => {
    getServerSessionMock.mockResolvedValue({ user: { tenantId: 'default' } })

    await expect(canReadFleetStorage()).resolves.toBe(false)
    expect(isUserSuperAdminMock).not.toHaveBeenCalled()
  })
})
