import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ rbac: vi.fn(), tenant: vi.fn() }))
vi.mock('@/contexts/RBACContext', () => ({ useRBAC: mocks.rbac }))
vi.mock('@/contexts/TenantContext', () => ({ useTenant: mocks.tenant }))
import { useNicIdentityPermissions } from './useNicIdentityPermissions'

function usePermissionsUnderTest() { return useNicIdentityPermissions() }

describe('NIC identity permissions', () => {
  beforeEach(() => {
    mocks.tenant.mockReturnValue({ loading: false, currentTenant: { id: 'tenant-a' }, isProvider: false })
    mocks.rbac.mockReturnValue({ loading: false, permissions: ['vm.config', 'vm.config.nic'], hasPermission: () => true })
  })
  it('requires exact grants for tenants even when broader config rights exist', () => {
    expect(usePermissionsUnderTest()).toMatchObject({ canEditMac: false, canEditVlan: false })
  })
  it('allows independently granted MAC changes', () => {
    mocks.rbac.mockReturnValue({ loading: false, permissions: ['vm.config.nic.mac'] })
    expect(usePermissionsUnderTest()).toMatchObject({ canEditMac: true, canEditVlan: false })
  })
  it('retains the explicit global super-admin bypass', () => {
    mocks.rbac.mockReturnValue({ loading: false, permissions: [], isAdmin: true })
    expect(usePermissionsUnderTest()).toMatchObject({ canEditMac: true, canEditVlan: true })
  })
  it('preserves the provider behavior', () => {
    mocks.tenant.mockReturnValue({ loading: false, currentTenant: { id: 'default' }, isProvider: true })
    expect(usePermissionsUnderTest()).toMatchObject({ canEditMac: true, canEditVlan: true })
  })
  it('fails closed while either context loads or tenant resolution fails', () => {
    mocks.rbac.mockReturnValue({ loading: true, permissions: ['vm.config.nic.mac', 'vm.config.nic.vlan'] })
    expect(usePermissionsUnderTest()).toMatchObject({ canEditMac: false, canEditVlan: false })
    mocks.rbac.mockReturnValue({ loading: false, permissions: ['vm.config.nic.mac'] })
    mocks.tenant.mockReturnValue({ loading: false, currentTenant: null, isProvider: true })
    expect(usePermissionsUnderTest()).toMatchObject({ canEditMac: false, canEditVlan: false })
  })
})
