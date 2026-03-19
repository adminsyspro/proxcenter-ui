'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'

import {
  Box,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
} from '@mui/material'

import { usePageTitle } from '@/contexts/PageTitleContext'
import { usePVEConnections } from '@/hooks/useConnections'

import FlowsTab from './FlowsTab'

export default function NetworkFlowsPage() {
  const { setPageInfo } = usePageTitle()
  const t = useTranslations()

  const [selectedConnection, setSelectedConnection] = useState<string>('')

  const { data: connectionsData } = usePVEConnections()
  const connections = connectionsData?.data || []

  useEffect(() => {
    setPageInfo(t('networkFlows.title'), t('networkFlows.subtitle'), 'ri-flow-chart')
    return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  useEffect(() => {
    if (connections.length > 0 && !selectedConnection) {
      setSelectedConnection(connections[0].id)
    }
  }, [connections, selectedConnection])

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
