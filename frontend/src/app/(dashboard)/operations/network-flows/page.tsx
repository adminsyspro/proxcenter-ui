'use client'

import { useEffect } from 'react'

import { useTranslations } from 'next-intl'

import {
  Box,
  Typography,
} from '@mui/material'

import { usePageTitle } from '@/contexts/PageTitleContext'
import { usePVEConnections } from '@/hooks/useConnections'
import ProviderTenantGuard from '@/components/guards/ProviderTenantGuard'

import FlowsTab from './FlowsTab'

export default function NetworkFlowsPage() {
  const { setPageInfo } = usePageTitle()
  const t = useTranslations()

  const { data: connectionsData } = usePVEConnections()
  const connections = connectionsData?.data || []

  useEffect(() => {
    setPageInfo(t('networkFlows.title'), t('networkFlows.subtitle'), 'ri-flow-chart')

return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  if (connectionsData && connections.length === 0) {
    return (
      <ProviderTenantGuard>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 2 }}>
          <i className="ri-link-unlink" style={{ fontSize: 48, opacity: 0.3 }} />
          <Typography variant="h6" color="text.secondary">{t('networkFlows.noSshConnections')}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 400, textAlign: 'center' }}>
            {t('networkFlows.noSshConnectionsDesc')}
          </Typography>
        </Box>
      </ProviderTenantGuard>
    )
  }

  return (
    <ProviderTenantGuard>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
        <FlowsTab />
      </Box>
    </ProviderTenantGuard>
  )
}
