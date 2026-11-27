'use client'
import { useMemo } from 'react'
import { Box, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'
import type { K8sTopologyData } from '@/lib/k8s/topologyTypes'
import { deriveAppSummaries } from '@/lib/k8s/appGrid'
import { AppTile } from './topologyNodes/AppTile'

export function AppGrid({ data, onOpen }: { data: K8sTopologyData; onOpen: (groupKey: string) => void }) {
  const t = useTranslations('kubernetes.topology')
  const apps = useMemo(() => deriveAppSummaries(data), [data])
  if (apps.length === 0) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="body2" color="text.secondary">{t('apps.empty')}</Typography>
      </Box>
    )
  }
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 2, p: 2, overflowY: 'auto' }}>
      {apps.map(app => <AppTile key={app.key} app={app} onOpen={onOpen} />)}
    </Box>
  )
}
