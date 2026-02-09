'use client'

import React, { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Box, Typography } from '@mui/material'
import VmWaffleChart from '@/components/VmWaffleChart'

function VmStatusWaffleWidget({ data, loading }) {
  const router = useRouter()

  // Combine VMs and LXCs for the waffle chart
  const allGuests = useMemo(() => {
    const vms = data?.vmList || []
    const lxcs = data?.lxcList || []
    return [...vms, ...lxcs]
  }, [data?.vmList, data?.lxcList])

  const handleVmClick = (vm) => {
    router.push(`/infrastructure/inventory?selected=${vm.connId}&type=${vm.type}&vmid=${vm.vmid}&node=${vm.node}`)
  }

  if (!data) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography variant="caption" color="text.secondary">Loading...</Typography>
      </Box>
    )
  }

  if (allGuests.length === 0) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography variant="caption" color="text.secondary">No VMs found</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ height: '100%', overflow: 'auto' }}>
      <VmWaffleChart
        vms={allGuests}
        cellSize={10}
        gap={2}
        maxColumns={25}
        onVmClick={handleVmClick}
        showLegend={false}
        compact
      />
    </Box>
  )
}

export default React.memo(VmStatusWaffleWidget)
