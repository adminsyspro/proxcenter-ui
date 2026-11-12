'use client'

import { useState } from 'react'

import { useTranslations } from 'next-intl'

import { Box, Tab, Tabs } from '@mui/material'

import { Features, useLicense } from '@/contexts/LicenseContext'

import OidcConnectionForm from '../OidcConfigTab'
import TenantOidcConnectionsList, { type TenantConnectionRow } from './TenantOidcConnectionsList'

type SettingsTab = 'provider' | 'tenants'

/**
 * Settings > OIDC / SSO. "Provider" is the provider's own IdP; "Tenants" lists
 * the customer tenants and their own IdP (issue #1289), with multi-tenancy.
 */
export default function OidcSettingsTab() {
  const t = useTranslations()
  const { hasFeature } = useLicense()
  const tenantsAvailable = hasFeature(Features.MULTI_TENANCY)
  const [tab, setTab] = useState<SettingsTab>('provider')
  const [openTenant, setOpenTenant] = useState<TenantConnectionRow | null>(null)

  if (!tenantsAvailable) return <OidcConnectionForm />

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Tabs
        value={tab}
        onChange={(_e, value: SettingsTab) => {
          setTab(value)
          setOpenTenant(null)
        }}
        sx={{ borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab value='provider' label={t('oidc.tenantConnections.tabProvider')} icon={<i className='ri-shield-keyhole-line' />} iconPosition='start' />
        <Tab value='tenants' label={t('oidc.tenantConnections.tabTenants')} icon={<i className='ri-building-line' />} iconPosition='start' />
      </Tabs>

      {tab === 'provider' && <OidcConnectionForm />}

      {tab === 'tenants' && !openTenant && <TenantOidcConnectionsList onOpen={setOpenTenant} />}

      {tab === 'tenants' && openTenant && (
        <OidcConnectionForm
          key={openTenant.tenant_id}
          mode='tenant'
          apiBase={`/api/v1/auth/oidc/connections/${encodeURIComponent(openTenant.tenant_id)}`}
          title={t('oidc.tenantConnections.formTitle', { tenant: openTenant.name })}
          onBack={() => setOpenTenant(null)}
          onDeleted={() => setOpenTenant(null)}
          canDelegate
        />
      )}
    </Box>
  )
}
