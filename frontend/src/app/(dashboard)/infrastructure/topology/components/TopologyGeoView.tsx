'use client'

import dynamic from 'next/dynamic'

import { Box, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import EmptyState from '@/components/EmptyState'

import type { InventoryCluster } from '../types'

const GeoMapInner = dynamic(() => import('./GeoMapInner'), { ssr: false })

interface TopologyGeoViewProps {
  connections: InventoryCluster[]
  isLoading: boolean
}

export default function TopologyGeoView({ connections, isLoading }: TopologyGeoViewProps) {
  const t = useTranslations('topology')

  // Filter connections that have valid lat/lng
  const geoConnections = connections.filter(
    (c) => c.latitude != null && c.longitude != null
  )

  if (!isLoading && geoConnections.length === 0) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <EmptyState
          icon='ri-map-pin-line'
          title={t('geoNoData')}
          description={t('geoNoDataDesc')}
        />
      </Box>
    )
  }

  return (
    <Box sx={{ flex: 1, position: 'relative', borderRadius: 1, overflow: 'hidden' }}>
      {isLoading ? (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography color='text.secondary'>{t('noData')}</Typography>
        </Box>
      ) : (
        <GeoMapInner connections={geoConnections} />
      )}
    </Box>
  )
}
