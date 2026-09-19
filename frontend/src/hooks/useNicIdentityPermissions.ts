'use client'

import { useRBAC } from '@/contexts/RBACContext'
import { useTenant } from '@/contexts/TenantContext'

/** Sensitive NIC fields need explicit grants inside a tenant, including MSPs. */
export function useNicIdentityPermissions() {
  const { permissions = [], isAdmin: isSuperAdmin, loading: rbacLoading } = useRBAC()
  const { currentTenant, loading: tenantLoading } = useTenant()
  const isProvider = currentTenant?.id === 'default'
  const loading = rbacLoading || tenantLoading || !currentTenant
  return {
    loading,
    canEditMac: !loading && (isProvider || isSuperAdmin || permissions.includes('vm.config.nic.mac')),
    canEditVlan: !loading && (isProvider || isSuperAdmin || permissions.includes('vm.config.nic.vlan')),
  }
}
