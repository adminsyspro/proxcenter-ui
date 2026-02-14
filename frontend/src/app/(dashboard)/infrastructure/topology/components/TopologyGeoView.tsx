'use client'

import { useState } from 'react'

import dynamic from 'next/dynamic'

import { Box, Card, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import EmptyState from '@/components/EmptyState'

import type { InventoryCluster } from '../types'
import GeoDetailsSidebar from './GeoDetailsSidebar'

const GeoMapInner = dynamic(() => import('./GeoMapInner'), { ssr: false })

interface TopologyGeoViewProps {
  connections: InventoryCluster[]
  isLoading: boolean
}

export default function TopologyGeoView({ connections, isLoading }: TopologyGeoViewProps) {
  const t = useTranslations('topology')
  const [selectedCluster, setSelectedCluster] = useState<InventoryCluster | null>(null)

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
    <Card sx={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      {isLoading ? (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
          <Typography color='text.secondary'>{t('noData')}</Typography>
        </Box>
      ) : (
        <GeoMapInner connections={geoConnections} onSelectCluster={setSelectedCluster} />
      )}

      {selectedCluster && (
        <GeoDetailsSidebar cluster={selectedCluster} onClose={() => setSelectedCluster(null)} />
      )}
    </Card>
  )
}
