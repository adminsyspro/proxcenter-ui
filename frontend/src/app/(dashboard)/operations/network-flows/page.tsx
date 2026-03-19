'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'

import {
  Box,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Typography,
} from '@mui/material'

import { usePageTitle } from '@/contexts/PageTitleContext'
import { usePVEConnections } from '@/hooks/useConnections'

import FlowsTab from './FlowsTab'

export default function NetworkFlowsPage() {
  const { setPageInfo } = usePageTitle()
  const t = useTranslations()

  const [selectedConnection, setSelectedConnection] = useState<string>('')

  const { data: connectionsData } = usePVEConnections()
  // Only show PVE connections with SSH enabled (required for OVS/sFlow)
  const connections = (connectionsData?.data || []).filter((c: any) => c.sshConfigured)

  useEffect(() => {
    setPageInfo(t('networkFlows.title'), t('networkFlows.subtitle'), 'ri-flow-chart')
    return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  useEffect(() => {
    if (connections.length > 0 && !selectedConnection) {
      setSelectedConnection(connections[0].id)
    }
  }, [connections, selectedConnection])

  if (connectionsData && connections.length === 0) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 2 }}>
        <i className="ri-link-unlink" style={{ fontSize: 48, opacity: 0.3 }} />
        <Typography variant="h6" color="text.secondary">{t('networkFlows.noSshConnections')}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 400, textAlign: 'center' }}>
          {t('networkFlows.noSshConnectionsDesc')}
        </Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>

      {/* Connection selector */}
      {connections.length > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <FormControl size="small" sx={{ minWidth: 250 }}>
            <InputLabel>{t('common.connection')}</InputLabel>
            <Select
              value={selectedConnection}
              onChange={(e) => setSelectedConnection(e.target.value)}
              label={t('common.connection')}
            >
              {connections.map((conn: any) => (
                <MenuItem key={conn.id} value={conn.id}>{conn.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
      )}

      <FlowsTab
        connectionId={selectedConnection}
        connectionName={connections.find((c: any) => c.id === selectedConnection)?.name}
      />
    </Box>
  )
}
