'use client'

import { useState } from 'react'
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  LinearProgress,
  Paper,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  Typography,
  useTheme,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useTranslations } from 'next-intl'

import type { OverprovisioningData } from '../types'
import { COLORS } from '../constants'
import {
  SpeedIcon, MemoryIcon, StorageIcon, LayersIcon,
  CheckCircleIcon, WarningAmberIcon, TipsAndUpdatesIcon, SavingsIcon,
} from './icons'

export default function OverprovisioningCard({ data, loading }: { data: OverprovisioningData | null; loading?: boolean }) {
  const theme = useTheme()
  const t = useTranslations()
  const [activeTab, setActiveTab] = useState(0)

  const getRatioColor = (ratio: number, type: 'cpu' | 'ram') => {
    const thresholds = type === 'cpu'
      ? { safe: 2, warning: 4, danger: 6 }
      : { safe: 1, warning: 1.3, danger: 1.5 }
    if (ratio <= thresholds.safe) return COLORS.success
    if (ratio <= thresholds.warning) return COLORS.warning
    if (ratio <= thresholds.danger) return '#f97316'
    return COLORS.error
  }

  const getRatioLabel = (ratio: number, type: 'cpu' | 'ram') => {
    const thresholds = type === 'cpu'
      ? { safe: 2, warning: 4, danger: 6 }
      : { safe: 1, warning: 1.3, danger: 1.5 }
    if (ratio <= thresholds.safe) return t('resources.conservative')
    if (ratio <= thresholds.warning) return t('resources.optimal')
    if (ratio <= thresholds.danger) return t('resources.aggressive')
    return t('resources.critical')
  }

  const getEfficiencyStatus = (efficiency: number) => {
    if (efficiency >= 70) return { label: t('resources.scoreExcellent'), color: COLORS.success }
    if (efficiency >= 50) return { label: t('resources.scoreGood'), color: COLORS.info }
    if (efficiency >= 30) return { label: t('resources.medium'), color: COLORS.warning }
    return { label: t('resources.low'), color: COLORS.error }
  }

  if (loading) {
    return (
      <Card variant="outlined" sx={{ height: '100%' }}>
        <CardContent>
          <Skeleton variant="text" width="50%" height={32} sx={{ mb: 2 }} />
          <Stack direction="row" spacing={2}>
            <Skeleton variant="circular" width={140} height={140} />
            <Skeleton variant="circular" width={140} height={140} />
            <Box sx={{ flex: 1 }}><Skeleton variant="rectangular" height={100} sx={{ borderRadius: 2 }} /></Box>
          </Stack>
        </CardContent>
      </Card>
    )
  }

  if (!data) {
    return (
      <Card variant="outlined" sx={{ height: '100%' }}>
        <CardContent sx={{ textAlign: 'center', py: 6 }}>
          <LayersIcon sx={{ fontSize: 64, color: alpha(COLORS.info, 0.2), mb: 2 }} />
          <Typography variant="body1" fontWeight={600}>{t('resources.overprovisioningDataNotAvailable')}</Typography>
          <Typography variant="body2" color="text.secondary">{t('resources.allocationMetricsWillBeShown')}</Typography>
        </CardContent>
      </Card>
    )
  }

  const cpuColor = getRatioColor(data.cpu.ratio, 'cpu')
  const ramColor = getRatioColor(data.ram.ratio, 'ram')
  const cpuEfficiency = getEfficiencyStatus(data.cpu.efficiency)
  const ramEfficiency = getEfficiencyStatus(data.ram.efficiency)
  const wastedCpu = Math.max(0, data.cpu.allocated - Math.ceil(data.cpu.used * 1.3))
  const wastedRam = Math.max(0, data.ram.allocated - Math.ceil(data.ram.used * 1.2))

  return (
    <Card variant="outlined" sx={{ height: '100%', background: `linear-gradient(135deg, ${alpha(COLORS.info, 0.02)} 0%, transparent 50%, ${alpha(COLORS.primary, 0.02)} 100%)` }}>
      <CardContent sx={{ p: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }}>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Box sx={{ p: 1, borderRadius: 2, bgcolor: alpha(COLORS.info, 0.1), color: COLORS.info, display: 'flex' }}><LayersIcon /></Box>
            <Box>
              <Typography variant="h6" fontWeight={700}>{t('resources.overprovisioningAnalysis')}</Typography>
              <Typography variant="caption" color="text.secondary">{t('resources.allocationVsCapacity')}</Typography>
            </Box>
          </Stack>
          <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} sx={{ minHeight: 32 }}>
            <Tab label={t('resources.globalView')} sx={{ minHeight: 32, py: 0.5, textTransform: 'none', fontSize: '0.8rem' }} />
            <Tab label={t('resources.perNode')} sx={{ minHeight: 32, py: 0.5, textTransform: 'none', fontSize: '0.8rem' }} />
            <Tab label={t('resources.vmsToOptimize')} sx={{ minHeight: 32, py: 0.5, textTransform: 'none', fontSize: '0.8rem' }} />
          </Tabs>
        </Stack>

        {activeTab === 0 && (
          <Stack spacing={3}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
              <Paper sx={{ flex: 1, p: 3, bgcolor: alpha(cpuColor, 0.04), border: '1px solid', borderColor: alpha(cpuColor, 0.2), borderRadius: 2 }}>
                <Stack direction="row" alignItems="center" spacing={3}>
                  <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                    <CircularProgress variant="determinate" value={100} size={120} thickness={4} sx={{ color: alpha(cpuColor, 0.15) }} />
                    <CircularProgress variant="determinate" value={Math.min(100, (data.cpu.ratio / 8) * 100)} size={120} thickness={4} sx={{ color: cpuColor, position: 'absolute', left: 0, filter: `drop-shadow(0 0 6px ${alpha(cpuColor, 0.4)})` }} />
                    <Box sx={{ top: 0, left: 0, bottom: 0, right: 0, position: 'absolute', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                      <Typography variant="h4" fontWeight={800} sx={{ color: cpuColor, lineHeight: 1 }}>{data.cpu.ratio.toFixed(1)}</Typography>
                      <Typography variant="caption" color="text.secondary">:1</Typography>
                    </Box>
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                      <SpeedIcon sx={{ color: COLORS.cpu, fontSize: 20 }} />
                      <Typography variant="subtitle1" fontWeight={700}>CPU vCPU/pCPU</Typography>
                      <Chip size="small" label={getRatioLabel(data.cpu.ratio, 'cpu')} sx={{ height: 20, fontSize: '0.65rem', bgcolor: alpha(cpuColor, 0.15), color: cpuColor, fontWeight: 600 }} />
                    </Stack>
                    <Stack spacing={1}>
                      <Box>
                        <Stack direction="row" justifyContent="space-between"><Typography variant="caption" color="text.secondary">{t('resources.allocated')}</Typography><Typography variant="caption" fontWeight={600}>{data.cpu.allocated} vCPUs</Typography></Stack>
                        <LinearProgress variant="determinate" value={Math.min(100, (data.cpu.allocated / data.cpu.physical) * 100)} sx={{ height: 6, borderRadius: 1, bgcolor: alpha(COLORS.cpu, 0.1), '& .MuiLinearProgress-bar': { bgcolor: COLORS.cpu } }} />
                      </Box>
                      <Stack direction="row" justifyContent="space-between"><Typography variant="caption" color="text.secondary">{t('resources.physical')}</Typography><Typography variant="caption" fontWeight={600}>{data.cpu.physical} {t('resources.cores')}</Typography></Stack>
                      <Stack direction="row" justifyContent="space-between"><Typography variant="caption" color="text.secondary">{t('resources.usedAvg')}</Typography><Typography variant="caption" fontWeight={600}>{data.cpu.used.toFixed(1)} vCPUs</Typography></Stack>
                      <Divider sx={{ my: 0.5 }} />
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography variant="caption" color="text.secondary">{t('resources.efficiency')}</Typography>
                        <Chip size="small" label={`${data.cpu.efficiency.toFixed(0)}% - ${cpuEfficiency.label}`} sx={{ height: 18, fontSize: '0.6rem', bgcolor: alpha(cpuEfficiency.color, 0.15), color: cpuEfficiency.color }} />
                      </Stack>
                    </Stack>
                  </Box>
                </Stack>
              </Paper>

              <Paper sx={{ flex: 1, p: 3, bgcolor: alpha(ramColor, 0.04), border: '1px solid', borderColor: alpha(ramColor, 0.2), borderRadius: 2 }}>
                <Stack direction="row" alignItems="center" spacing={3}>
                  <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                    <CircularProgress variant="determinate" value={100} size={120} thickness={4} sx={{ color: alpha(ramColor, 0.15) }} />
                    <CircularProgress variant="determinate" value={Math.min(100, (data.ram.ratio / 2) * 100)} size={120} thickness={4} sx={{ color: ramColor, position: 'absolute', left: 0, filter: `drop-shadow(0 0 6px ${alpha(ramColor, 0.4)})` }} />
                    <Box sx={{ top: 0, left: 0, bottom: 0, right: 0, position: 'absolute', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                      <Typography variant="h4" fontWeight={800} sx={{ color: ramColor, lineHeight: 1 }}>{data.ram.ratio.toFixed(2)}</Typography>
                      <Typography variant="caption" color="text.secondary">:1</Typography>
                    </Box>
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                      <MemoryIcon sx={{ color: COLORS.ram, fontSize: 20 }} />
                      <Typography variant="subtitle1" fontWeight={700}>RAM vRAM/pRAM</Typography>
                      <Chip size="small" label={getRatioLabel(data.ram.ratio, 'ram')} sx={{ height: 20, fontSize: '0.65rem', bgcolor: alpha(ramColor, 0.15), color: ramColor, fontWeight: 600 }} />
                    </Stack>
                    <Stack spacing={1}>
                      <Box>
                        <Stack direction="row" justifyContent="space-between"><Typography variant="caption" color="text.secondary">{t('resources.allocated')}</Typography><Typography variant="caption" fontWeight={600}>{data.ram.allocated.toFixed(0)} GB</Typography></Stack>
                        <LinearProgress variant="determinate" value={Math.min(100, (data.ram.allocated / data.ram.physical) * 100)} sx={{ height: 6, borderRadius: 1, bgcolor: alpha(COLORS.ram, 0.1), '& .MuiLinearProgress-bar': { bgcolor: COLORS.ram } }} />
                      </Box>
                      <Stack direction="row" justifyContent="space-between"><Typography variant="caption" color="text.secondary">{t('resources.physical')}</Typography><Typography variant="caption" fontWeight={600}>{data.ram.physical.toFixed(0)} GB</Typography></Stack>
                      <Stack direction="row" justifyContent="space-between"><Typography variant="caption" color="text.secondary">{t('resources.usedLabel')}</Typography><Typography variant="caption" fontWeight={600}>{data.ram.used.toFixed(1)} GB</Typography></Stack>
                      <Divider sx={{ my: 0.5 }} />
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography variant="caption" color="text.secondary">{t('resources.efficiency')}</Typography>
                        <Chip size="small" label={`${data.ram.efficiency.toFixed(0)}% - ${ramEfficiency.label}`} sx={{ height: 18, fontSize: '0.6rem', bgcolor: alpha(ramEfficiency.color, 0.15), color: ramEfficiency.color }} />
                      </Stack>
                    </Stack>
                  </Box>
                </Stack>
              </Paper>
            </Stack>

            <Paper sx={{ p: 2, bgcolor: alpha(COLORS.primary, 0.03), border: '1px solid', borderColor: alpha(COLORS.primary, 0.15), borderRadius: 2 }}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} alignItems="center">
                <Stack direction="row" alignItems="center" spacing={1}>
                  <TipsAndUpdatesIcon sx={{ color: COLORS.warning, fontSize: 24 }} />
                  <Typography variant="subtitle2" fontWeight={700}>{t('resources.optimizationPotential')}</Typography>
                </Stack>
                <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', md: 'block' } }} />
                {wastedCpu > 0 && <Stack direction="row" alignItems="center" spacing={1}><SpeedIcon sx={{ fontSize: 18, color: COLORS.cpu }} /><Typography variant="body2">{t('resources.recoverableVcpus', { count: wastedCpu })}</Typography></Stack>}
                {wastedRam > 0 && <Stack direction="row" alignItems="center" spacing={1}><MemoryIcon sx={{ fontSize: 18, color: COLORS.ram }} /><Typography variant="body2">{t('resources.recoverableRam', { count: wastedRam.toFixed(0) })}</Typography></Stack>}
                {wastedCpu === 0 && wastedRam === 0 && <Stack direction="row" alignItems="center" spacing={1}><CheckCircleIcon sx={{ fontSize: 18, color: COLORS.success }} /><Typography variant="body2" sx={{ color: COLORS.success }}>{t('resources.optimizedResources')}</Typography></Stack>}
                <Box sx={{ ml: 'auto' }}>
                  <Chip size="small" icon={<SavingsIcon sx={{ fontSize: 14 }} />} label={t('resources.vmsToRightsize', { count: data.topOverprovisioned.length })} sx={{ bgcolor: alpha(data.topOverprovisioned.length > 0 ? COLORS.warning : COLORS.success, 0.1), color: data.topOverprovisioned.length > 0 ? COLORS.warning : COLORS.success, fontWeight: 600 }} />
                </Box>
              </Stack>
            </Paper>
          </Stack>
        )}

        {activeTab === 1 && (
          <Stack spacing={1.5}>
            <Stack direction="row" sx={{ px: 2, py: 1, bgcolor: alpha(COLORS.primary, 0.03), borderRadius: 1 }}>
              <Typography variant="caption" fontWeight={600} sx={{ width: 140 }}>{t('resources.node')}</Typography>
              <Typography variant="caption" fontWeight={600} sx={{ flex: 1, textAlign: 'center' }}>CPU Ratio</Typography>
              <Typography variant="caption" fontWeight={600} sx={{ flex: 1, textAlign: 'center' }}>RAM Ratio</Typography>
              <Typography variant="caption" fontWeight={600} sx={{ width: 100, textAlign: 'right' }}>{t('resources.status')}</Typography>
            </Stack>
            {data.perNode.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 4 }}><Typography variant="body2" color="text.secondary">{t('resources.noNodeDataAvailable')}</Typography></Box>
            ) : (
              data.perNode.map((node) => {
                const nodeCpuColor = getRatioColor(node.cpuRatio, 'cpu')
                const nodeRamColor = getRatioColor(node.ramRatio, 'ram')
                const worstRatio = Math.max(node.cpuRatio / 4, node.ramRatio / 1.3)
                const statusColor = worstRatio > 1.5 ? COLORS.error : worstRatio > 1 ? COLORS.warning : COLORS.success
                return (
                  <Paper key={node.name} sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2, '&:hover': { bgcolor: alpha(COLORS.primary, 0.02) } }}>
                    <Stack direction="row" alignItems="center">
                      <Stack direction="row" alignItems="center" spacing={1} sx={{ width: 140 }}>
                        <StorageIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                        <Typography variant="body2" fontWeight={600}>{node.name}</Typography>
                      </Stack>
                      <Box sx={{ flex: 1, px: 2 }}>
                        <Stack direction="row" alignItems="center" justifyContent="center" spacing={1}>
                          <Typography variant="body2" fontWeight={700} sx={{ color: nodeCpuColor }}>{node.cpuRatio.toFixed(1)}:1</Typography>
                          <Typography variant="caption" color="text.secondary">({node.cpuAllocated}/{node.cpuPhysical})</Typography>
                        </Stack>
                        <LinearProgress variant="determinate" value={Math.min(100, (node.cpuRatio / 8) * 100)} sx={{ height: 4, borderRadius: 1, mt: 0.5, bgcolor: alpha(nodeCpuColor, 0.1), '& .MuiLinearProgress-bar': { bgcolor: nodeCpuColor } }} />
                      </Box>
                      <Box sx={{ flex: 1, px: 2 }}>
                        <Stack direction="row" alignItems="center" justifyContent="center" spacing={1}>
                          <Typography variant="body2" fontWeight={700} sx={{ color: nodeRamColor }}>{node.ramRatio.toFixed(2)}:1</Typography>
                          <Typography variant="caption" color="text.secondary">({node.ramAllocated.toFixed(0)}/{node.ramPhysical.toFixed(0)} GB)</Typography>
                        </Stack>
                        <LinearProgress variant="determinate" value={Math.min(100, (node.ramRatio / 2) * 100)} sx={{ height: 4, borderRadius: 1, mt: 0.5, bgcolor: alpha(nodeRamColor, 0.1), '& .MuiLinearProgress-bar': { bgcolor: nodeRamColor } }} />
                      </Box>
                      <Box sx={{ width: 100, textAlign: 'right' }}>
                        <Chip size="small" icon={worstRatio > 1 ? <WarningAmberIcon sx={{ fontSize: 14 }} /> : <CheckCircleIcon sx={{ fontSize: 14 }} />} label={worstRatio > 1.5 ? t('resources.critical') : worstRatio > 1 ? t('resources.attention') : 'OK'} sx={{ height: 22, fontSize: '0.65rem', bgcolor: alpha(statusColor, 0.15), color: statusColor, '& .MuiChip-icon': { color: statusColor } }} />
                      </Box>
                    </Stack>
                  </Paper>
                )
              })
            )}
          </Stack>
        )}

        {activeTab === 2 && (
          <Stack spacing={1.5}>
            <Alert severity="info" sx={{ mb: 1 }}>{t('resources.rightsizingInfo')}</Alert>
            {data.topOverprovisioned.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <CheckCircleIcon sx={{ fontSize: 48, color: COLORS.success, mb: 1 }} />
                <Typography variant="body1" fontWeight={600}>{t('resources.allVmsCorrectlySized')}</Typography>
              </Box>
            ) : (
              data.topOverprovisioned.map((vm) => (
                <Paper key={vm.vmid} sx={{ p: 2, border: '1px solid', borderColor: alpha(COLORS.warning, 0.3), borderRadius: 2, bgcolor: alpha(COLORS.warning, 0.02), '&:hover': { bgcolor: alpha(COLORS.warning, 0.05), transform: 'translateX(4px)' }, transition: 'all 0.2s' }}>
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
                    <Box sx={{ minWidth: 180 }}>
                      <Typography variant="subtitle2" fontWeight={700}>{vm.name}</Typography>
                      <Typography variant="caption" color="text.secondary">{vm.vmid} • {vm.node}</Typography>
                    </Box>
                    <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', md: 'block' } }} />
                    <Box sx={{ flex: 1 }}>
                      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 0.5 }}><SpeedIcon sx={{ fontSize: 14, color: COLORS.cpu }} /><Typography variant="caption" fontWeight={600}>CPU</Typography></Stack>
                      <Stack direction="row" alignItems="baseline" spacing={1}>
                        <Typography variant="body2"><strong>{vm.cpuAllocated}</strong> → <strong style={{ color: COLORS.success }}>{vm.recommendedCpu}</strong> vCPU</Typography>
                        <Chip size="small" label={`${vm.cpuUsedPct.toFixed(0)}% ${t('resources.used')}`} sx={{ height: 16, fontSize: '0.55rem' }} />
                      </Stack>
                    </Box>
                    <Box sx={{ flex: 1 }}>
                      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 0.5 }}><MemoryIcon sx={{ fontSize: 14, color: COLORS.ram }} /><Typography variant="caption" fontWeight={600}>RAM</Typography></Stack>
                      <Stack direction="row" alignItems="baseline" spacing={1}>
                        <Typography variant="body2"><strong>{vm.ramAllocatedGB.toFixed(0)}</strong> → <strong style={{ color: COLORS.success }}>{vm.recommendedRamGB.toFixed(0)}</strong> GB</Typography>
                        <Chip size="small" label={`${vm.ramUsedPct.toFixed(0)}% ${t('resources.used')}`} sx={{ height: 16, fontSize: '0.55rem' }} />
                      </Stack>
                    </Box>
                    <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', md: 'block' } }} />
                    <Box sx={{ minWidth: 120, textAlign: { xs: 'left', md: 'right' } }}>
                      <Typography variant="caption" color="text.secondary">{t('resources.savings')}</Typography>
                      <Stack direction="row" spacing={1} justifyContent={{ xs: 'flex-start', md: 'flex-end' }}>
                        {vm.potentialSavings.cpu > 0 && <Chip size="small" label={`-${vm.potentialSavings.cpu} vCPU`} sx={{ height: 20, fontSize: '0.65rem', bgcolor: alpha(COLORS.success, 0.1), color: COLORS.success }} />}
                        {vm.potentialSavings.ramGB > 0 && <Chip size="small" label={`-${vm.potentialSavings.ramGB.toFixed(0)} GB`} sx={{ height: 20, fontSize: '0.65rem', bgcolor: alpha(COLORS.success, 0.1), color: COLORS.success }} />}
                      </Stack>
                    </Box>
                  </Stack>
                </Paper>
              ))
            )}
          </Stack>
        )}
      </CardContent>
    </Card>
  )
}
