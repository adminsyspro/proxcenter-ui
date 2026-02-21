'use client'

import { useState } from 'react'

import { ReactFlowProvider } from '@xyflow/react'
import { Box, Card, alpha, useTheme } from '@mui/material'

import type { SecurityMapFilters, SelectedMapItem } from './types'
import { useSecurityMapData } from './hooks/useSecurityMapData'
import SecurityMapCanvas from './SecurityMapCanvas'
import SecurityMapToolbar from './SecurityMapToolbar'
import SecurityMapSidebar from './SecurityMapSidebar'
import FlowMatrix from './FlowMatrix'

interface SecurityMapTabProps {
  connectionId: string
  securityGroups: { group: string; rules?: any[] }[]
  aliases: { name: string; cidr: string }[]
  clusterOptions: any
  clusterRules: any[]
}

export default function SecurityMapTab({
  connectionId,
  securityGroups,
  aliases,
  clusterOptions,
  clusterRules,
}: SecurityMapTabProps) {
  const theme = useTheme()
  const [filters, setFilters] = useState<SecurityMapFilters>({
    hideInfraNetworks: true,
    hideStoppedVms: false,
  })
  const [selected, setSelected] = useState<SelectedMapItem | null>(null)

  const { nodes, edges, loading, flowMatrix } = useSecurityMapData({
    connectionId,
    securityGroups,
    aliases,
    clusterOptions,
    clusterRules,
    filters,
  })

  return (
    <ReactFlowProvider>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, p: 2 }}>
        <SecurityMapToolbar filters={filters} onChange={setFilters} />

        <Card
          sx={{
            position: 'relative',
            overflow: 'hidden',
            height: 500,
            border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
          }}
        >
          <SecurityMapCanvas
            nodes={nodes}
            edges={edges}
            isLoading={loading}
            flowMatrix={flowMatrix}
            onSelect={setSelected}
          />
          {selected && (
            <SecurityMapSidebar
              selected={selected}
              onClose={() => setSelected(null)}
            />
          )}
        </Card>

        <FlowMatrix flowMatrix={flowMatrix} />
      </Box>
    </ReactFlowProvider>
  )
}
