'use client'

// Tenant target of a service-desk assignment (ui#1336): every tenant the role
// is published to (and the ones it will be published to), or a narrower list.

import Box from '@mui/material/Box'
import FormControlLabel from '@mui/material/FormControlLabel'
import Switch from '@mui/material/Switch'
import Typography from '@mui/material/Typography'

import type { TenantOption } from './catalogueClient'
import TenantCheckboxGrid from './TenantCheckboxGrid'

type Props = {
  allTenants: boolean
  onAllTenantsChange: (next: boolean) => void
  tenantIds: string[]
  onTenantIdsChange: (next: string[]) => void
  /** The tenants the role is published to. */
  publishedTenants: TenantOption[]
  disabled?: boolean
  t: (key: string, values?: Record<string, unknown>) => string
}

export default function ServiceDeskTargetEditor({
  allTenants,
  onAllTenantsChange,
  tenantIds,
  onTenantIdsChange,
  publishedTenants,
  disabled = false,
  t,
}: Readonly<Props>) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
        <Typography variant='body2' sx={{ width: 120, flexShrink: 0, fontWeight: 600 }}>{t('rbacPage.catalogue.serviceDeskTarget')}</Typography>
        <FormControlLabel
          disabled={disabled}
          sx={{ m: 0, minWidth: 0 }}
          control={<Switch size='small' checked={allTenants} onChange={e => onAllTenantsChange(e.target.checked)} />}
          label={<Typography variant='body2' noWrap>{t('rbacPage.catalogue.serviceDeskTargetAll')}</Typography>}
        />
      </Box>
      {!allTenants && (
        <TenantCheckboxGrid tenants={publishedTenants} value={tenantIds} onChange={onTenantIdsChange} disabled={disabled} t={t} />
      )}
    </Box>
  )
}
