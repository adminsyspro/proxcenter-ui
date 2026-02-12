'use client'

import { useMemo } from 'react'
import {
  Box,
  Card,
  CardContent,
  Chip,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useTranslations } from 'next-intl'

import type { OverprovisioningData } from '../types'
import { COLORS } from '../constants'
import { StarIcon, SpeedIcon, MemoryIcon } from './icons'

export default function BestNodeRecommendation({ overprovisioning }: { overprovisioning: OverprovisioningData | null }) {
  const t = useTranslations()

  const bestNode = useMemo(() => {
    if (!overprovisioning?.perNode?.length) return null

    const scored = overprovisioning.perNode.map(node => {
      const cpuHeadroom = Math.max(0, 100 - (node.cpuRatio / 8) * 100)
      const ramHeadroom = Math.max(0, 100 - (node.ramRatio / 2) * 100)
      const overprovScore = Math.max(0, 100 - ((node.cpuRatio + node.ramRatio * 4) / 10) * 100)
      const score = cpuHeadroom * 0.3 + ramHeadroom * 0.4 + overprovScore * 0.3
      const ramFreeGB = Math.max(0, node.ramPhysical - node.ramAllocated)
      const cpuFree = Math.max(0, node.cpuPhysical - node.cpuAllocated)
      return { ...node, score, ramFreeGB, cpuFree }
    })

    scored.sort((a, b) => b.score - a.score)
    return scored[0]
  }, [overprovisioning])

  if (!bestNode) return null

  return (
    <Card variant="outlined" sx={{ background: `linear-gradient(135deg, ${alpha(COLORS.success, 0.04)} 0%, transparent 100%)`, border: '1px solid', borderColor: alpha(COLORS.success, 0.25) }}>
      <CardContent sx={{ p: 2.5 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
          <StarIcon sx={{ color: COLORS.success, fontSize: 20 }} />
          <Typography variant="subtitle2" fontWeight={700}>{t('resources.bestNodeForNewVm')}</Typography>
        </Stack>
        <Stack direction="row" alignItems="center" spacing={2}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6" fontWeight={800} sx={{ color: COLORS.success }}>{bestNode.name}</Typography>
            <Chip size="small" label={`Score: ${bestNode.score.toFixed(0)}/100`} sx={{ mt: 0.5, height: 20, fontSize: '0.65rem', bgcolor: alpha(COLORS.success, 0.1), color: COLORS.success, fontWeight: 600 }} />
          </Box>
          <Stack spacing={0.75} sx={{ minWidth: 160 }}>
            <Box>
              <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.25 }}>
                <Stack direction="row" alignItems="center" spacing={0.5}><SpeedIcon sx={{ fontSize: 14, color: COLORS.cpu }} /><Typography variant="caption" color="text.secondary">CPU</Typography></Stack>
                <Typography variant="caption" fontWeight={600}>{bestNode.cpuFree} {t('resources.coresFree')}</Typography>
              </Stack>
              <LinearProgress variant="determinate" value={Math.min(100, (bestNode.cpuAllocated / bestNode.cpuPhysical) * 100)} sx={{ height: 4, borderRadius: 1, bgcolor: alpha(COLORS.cpu, 0.1), '& .MuiLinearProgress-bar': { bgcolor: COLORS.cpu } }} />
            </Box>
            <Box>
              <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.25 }}>
                <Stack direction="row" alignItems="center" spacing={0.5}><MemoryIcon sx={{ fontSize: 14, color: COLORS.ram }} /><Typography variant="caption" color="text.secondary">RAM</Typography></Stack>
                <Typography variant="caption" fontWeight={600}>{bestNode.ramFreeGB.toFixed(0)} GB {t('resources.free')}</Typography>
              </Stack>
              <LinearProgress variant="determinate" value={Math.min(100, (bestNode.ramAllocated / bestNode.ramPhysical) * 100)} sx={{ height: 4, borderRadius: 1, bgcolor: alpha(COLORS.ram, 0.1), '& .MuiLinearProgress-bar': { bgcolor: COLORS.ram } }} />
            </Box>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  )
}
