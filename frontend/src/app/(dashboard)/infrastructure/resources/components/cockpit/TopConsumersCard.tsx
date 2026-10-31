'use client'

import { useState } from 'react'

import { Box, ButtonBase, Stack, ToggleButton, ToggleButtonGroup, Typography, useTheme } from '@mui/material'
import { useTranslations } from 'next-intl'

import { GuestGlyph, NodeGlyph } from '@/components/automation/drs/glyphs'

import type { ResourceThresholds, TopVm, VmIdentity } from '../../types'
import { formatBytes, parseResourceVmId } from '../../helpers'
import { EmptyState, SectionCard, UsageBar } from './ui'

type Metric = 'cpu' | 'ram'

// A bounded preview (the top 10 the overview computes); the inventory has the rest.
export default function TopConsumersCard({ topCpu, topRam, thresholds, onOpenVm }: {
  topCpu: TopVm[]
  topRam: TopVm[]
  thresholds: ResourceThresholds
  onOpenVm: (vm: VmIdentity) => void
}) {
  const t = useTranslations()
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  const [metric, setMetric] = useState<Metric>('cpu')
  const rows = metric === 'cpu' ? topCpu : topRam
  const limits = metric === 'cpu' ? thresholds.cpu : thresholds.ram

  const open = (vm: TopVm) => {
    const { connId, type, node, vmid } = parseResourceVmId(vm.id)

    onOpenVm({ id: vm.id, name: vm.name, node, connId, type, vmid })
  }

  return (
    <SectionCard
      icon="ri-fire-line"
      title={t('resources.cockpit.topConsumers')}
      subtitle={t('resources.clickVmForDetails')}
      action={(
        <ToggleButtonGroup size="small" exclusive value={metric} onChange={(_e, v: Metric | null) => v && setMetric(v)}>
          <ToggleButton value="cpu">CPU</ToggleButton>
          <ToggleButton value="ram">RAM</ToggleButton>
        </ToggleButtonGroup>
      )}
    >
      {rows.length === 0 ? (
        <EmptyState icon="ri-fire-line" text={t('resources.cockpit.noConsumers')} />
      ) : (
        <Stack divider={<Box sx={{ borderBottom: '1px solid', borderColor: 'divider' }} />}>
          {rows.map(vm => {
            const { type } = parseResourceVmId(vm.id)

            return (
              <ButtonBase key={vm.id} onClick={() => open(vm)} sx={{ py: 0.75, px: 0.5, borderRadius: 1, justifyContent: 'stretch', '&:hover': { bgcolor: 'action.hover' } }}>
                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ width: '100%', minWidth: 0 }}>
                  <GuestGlyph type={type} status="running" dotBorder={theme.palette.background.paper} />
                  <Typography variant="body2" fontWeight={600} noWrap sx={{ flex: 1, minWidth: 0, textAlign: 'left' }}>{vm.name}</Typography>
                  <Stack direction="row" alignItems="center" spacing={0.75} sx={{ width: 120, flexShrink: 0 }}>
                    <NodeGlyph status="online" dark={dark} dotBorder={theme.palette.background.paper} />
                    <Typography variant="body2" color="text.secondary" noWrap>{vm.node}</Typography>
                  </Stack>
                  <Typography variant="body2" color="text.secondary" noWrap sx={{ width: 90, flexShrink: 0, textAlign: 'right' }}>
                    {metric === 'cpu' ? `${vm.cpuAllocated} vCPU` : formatBytes(vm.ramAllocated)}
                  </Typography>
                  <Box sx={{ width: 150, flexShrink: 0 }}>
                    <UsageBar pct={metric === 'cpu' ? vm.cpu : vm.ram} warning={limits.warning} critical={limits.critical} width={150} />
                  </Box>
                </Stack>
              </ButtonBase>
            )
          })}
        </Stack>
      )}
    </SectionCard>
  )
}
