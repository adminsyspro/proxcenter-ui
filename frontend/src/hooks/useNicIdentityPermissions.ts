'use client'

import { useRBAC } from '@/contexts/RBACContext'
import { useTenant } from '@/contexts/TenantContext'

/** Sensitive NIC fields need explicit grants inside a tenant, including MSPs. */
export function useNicIdentityPermissions() {
  const { permissions = [], isAdmin: isSuperAdmin, loading: rbacLoading } = useRBAC()
  const { currentTenant, loading: tenantLoading } = useTenant()
  const isProvider = currentTenant?.id === 'default'
  // Wait on the two contexts only: a tenant that never resolved denies (fail
  // closed) but must not pin the dialogs in a permanent loading state, the
  // server enforces the rights either way.
  const loading = rbacLoading || tenantLoading
  const resolved = !loading && (!!currentTenant || !!isSuperAdmin)
  return {
    loading,
    canEditMac: resolved && (isProvider || !!isSuperAdmin || permissions.includes('vm.config.nic.mac')),
    canEditVlan: resolved && (isProvider || !!isSuperAdmin || permissions.includes('vm.config.nic.vlan')),
  }
}
