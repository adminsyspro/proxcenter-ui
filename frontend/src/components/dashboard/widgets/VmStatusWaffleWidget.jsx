'use client'

import React, { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Box, Typography } from '@mui/material'
import VmWaffleChart from '@/components/VmWaffleChart'

function VmStatusWaffleWidget({ data, loading }) {
  const router = useRouter()
  const t = useTranslations()

  // Combine VMs and LXCs for the waffle chart
  const allGuests = useMemo(() => {
    const vms = data?.vmList || []
    const lxcs = data?.lxcList || []
    return [...vms, ...lxcs]
  }, [data?.vmList, data?.lxcList])

  const handleVmClick = (vm) => {
    router.push(`/infrastructure/inventory?vmid=${vm.vmid}&connId=${vm.connId}&node=${vm.node}&type=${vm.type}`)
  }

  if (!data) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography variant="caption" color="text.secondary">{t('common.loading')}</Typography>
      </Box>
    )
  }

  if (allGuests.length === 0) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography variant="caption" color="text.secondary">{t('inventory.noGuests')}</Typography>
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
