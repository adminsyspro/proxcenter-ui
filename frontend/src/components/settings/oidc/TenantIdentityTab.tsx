'use client'

import { useEffect, useState } from 'react'

import { useTranslations } from 'next-intl'

import { Alert, Box, CircularProgress } from '@mui/material'

import OidcConnectionForm from '../OidcConfigTab'

const API = '/api/v1/tenant/identity'

type TabState = 'loading' | 'open' | 'closed' | 'error'

/** 403 means the provider keeps the tenant's IdP to itself. */
function stateOf(res: Response): TabState {
  if (res.ok) return 'open'
  return res.status === 403 ? 'closed' : 'error'
}

/**
 * Settings > Identity provider, in a customer tenant (issue #1289): the
 * tenant's own IdP, editable once the provider opened self-service. Closed, the
 * tab says who manages it rather than showing a form that would be refused.
 */
export default function TenantIdentityTab() {
  const t = useTranslations()
  const [state, setState] = useState<TabState>('loading')

  useEffect(() => {
    let alive = true
    fetch(API)
      .then(res => {
        if (alive) setState(stateOf(res))
      })
      .catch(() => {
        if (alive) setState('error')
      })
    return () => {
      alive = false
    }
  }, [])

  if (state === 'loading') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    )
  }
  if (state === 'closed') return <Alert severity='info'>{t('oidc.tenantConnections.managedByProvider')}</Alert>
  if (state === 'error') return <Alert severity='error'>{t('oidc.loadError')}</Alert>

  return <OidcConnectionForm mode='tenant' apiBase={API} testUrl={`${API}/test`} showProxy={false} domainsLocked />
}
