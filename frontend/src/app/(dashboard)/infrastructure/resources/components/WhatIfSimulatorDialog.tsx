'use client'

import { useState, useMemo, useDeferredValue } from 'react'
import {
  Box,
  Button,
  Card,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  Slider,
  Stack,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useTranslations } from 'next-intl'

import type { KpiData, OverprovisioningData, ResourceThresholds } from '../types'
import { COLORS, DEFAULT_THRESHOLDS } from '../constants'
import { formatPct } from '../helpers'
import { SimulationIcon } from './icons'
import { calculateHealthScore } from '../algorithms/healthScore'

export default function WhatIfSimulatorDialog({ open, onClose, kpis, overprovisioning, thresholds }: {
  open: boolean
  onClose: () => void
  kpis: KpiData | null
  overprovisioning: OverprovisioningData | null
  thresholds?: ResourceThresholds
}) {
  const t = useTranslations()
  const th = thresholds || DEFAULT_THRESHOLDS

  const [vmCount, setVmCount] = useState(5)
  const [vcpuPerVm, setVcpuPerVm] = useState(4)
  const [ramPerVm, setRamPerVm] = useState(8)
  const [diskPerVm, setDiskPerVm] = useState(100)

  const deferredVmCount = useDeferredValue(vmCount)
  const deferredVcpu = useDeferredValue(vcpuPerVm)
  const deferredRam = useDeferredValue(ramPerVm)
  const deferredDisk = useDeferredValue(diskPerVm)

  const simulation = useMemo(() => {
    if (!kpis) return null

    const addedCpu = deferredVmCount * deferredVcpu
    const addedRamBytes = deferredVmCount * deferredRam * 1024 * 1024 * 1024
    const addedDiskBytes = deferredVmCount * deferredDisk * 1024 * 1024 * 1024

    const newCpuAllocated = kpis.cpu.allocated + addedCpu
    const newRamAllocated = kpis.ram.allocated + addedRamBytes
    const newStorageUsed = kpis.storage.used + addedDiskBytes

    const newCpuPct = kpis.cpu.total > 0 ? (newCpuAllocated / kpis.cpu.total) * 100 : 0
    const newRamPct = kpis.ram.total > 0 ? (newRamAllocated / kpis.ram.total) * 100 : 0
    const newStoragePct = kpis.storage.total > 0 ? (newStorageUsed / kpis.storage.total) * 100 : 0

    const simKpis: KpiData = {
      ...kpis,
      cpu: { ...kpis.cpu, allocated: newCpuAllocated, used: Math.min(100, kpis.cpu.used + (addedCpu / kpis.cpu.total) * 50) },
      ram: { ...kpis.ram, allocated: newRamAllocated, used: Math.min(100, kpis.ram.used + (addedRamBytes / kpis.ram.total) * 50) },
      storage: { ...kpis.storage, used: newStorageUsed },
      vms: { ...kpis.vms, total: kpis.vms.total + deferredVmCount, running: kpis.vms.running + deferredVmCount },
    }

    const simScore = calculateHealthScore(simKpis, [], th)
    const currentScore = calculateHealthScore(kpis, [], th)

    // Overprovisioning ratios
    const cpuRatio = overprovisioning ? (overprovisioning.cpu.allocated + addedCpu) / overprovisioning.cpu.physical : 0
    const ramRatioGB = overprovisioning ? (overprovisioning.ram.allocated + deferredVmCount * deferredRam) / overprovisioning.ram.physical : 0

    // Projected fill date for storage
    const storageFreeGB = kpis.storage.total > 0 ? (kpis.storage.total - newStorageUsed) / (1024 * 1024 * 1024) : 0

    return {
      currentScore,
      simScore,
      scoreDelta: simScore - currentScore,
      cpuPct: newCpuPct,
      ramPct: newRamPct,
      storagePct: newStoragePct,
      cpuRatio,
      ramRatioGB,
      storageFreeGB,
    }
  }, [kpis, overprovisioning, deferredVmCount, deferredVcpu, deferredRam, deferredDisk, th])

  const currentStoragePct = kpis && kpis.storage.total > 0 ? (kpis.storage.used / kpis.storage.total) * 100 : 0

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Stack direction="row" alignItems="center" spacing={1}>
          <SimulationIcon sx={{ fontSize: 20 }} />
          <Typography variant="h6" fontWeight={700}>{t('resources.whatIfSimulator')}</Typography>
        </Stack>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>{t('resources.whatIfDescription')}</Typography>

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={4}>
          {/* Controls */}
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>{t('resources.scenario')}</Typography>
            <Stack spacing={3}>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('resources.numberOfVms')}: {vmCount}</Typography>
                <Slider value={vmCount} onChange={(_, v) => setVmCount(v as number)} min={1} max={50} valueLabelDisplay="auto" sx={{ color: COLORS.primary }} />
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('resources.vcpuPerVm')}: {vcpuPerVm}</Typography>
                <Slider value={vcpuPerVm} onChange={(_, v) => setVcpuPerVm(v as number)} min={1} max={32} valueLabelDisplay="auto" sx={{ color: COLORS.cpu }} />
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('resources.ramPerVm')}: {ramPerVm} GB</Typography>
                <Slider value={ramPerVm} onChange={(_, v) => setRamPerVm(v as number)} min={1} max={256} valueLabelDisplay="auto" sx={{ color: COLORS.ram }} />
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('resources.diskPerVm')}: {diskPerVm} GB</Typography>
                <Slider value={diskPerVm} onChange={(_, v) => setDiskPerVm(v as number)} min={10} max={2000} step={10} valueLabelDisplay="auto" sx={{ color: COLORS.storage }} />
              </Box>
            </Stack>
          </Box>

          <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', md: 'block' } }} />

          {/* Results */}
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>{t('resources.impact')}</Typography>
            {simulation && (
              <Stack spacing={2}>
                <Card variant="outlined" sx={{ p: 2 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Box>
                      <Typography variant="caption" color="text.secondary">{t('resources.healthScore')}</Typography>
                      <Stack direction="row" alignItems="baseline" spacing={1}>
                        <Typography variant="h4" fontWeight={800}>{simulation.currentScore}</Typography>
                        <Typography variant="h5" color="text.secondary">→</Typography>
                        <Typography variant="h4" fontWeight={800} sx={{ color: simulation.simScore >= 60 ? COLORS.success : simulation.simScore >= 40 ? COLORS.warning : COLORS.error }}>{simulation.simScore}</Typography>
                      </Stack>
                    </Box>
                    <Chip label={`${simulation.scoreDelta >= 0 ? '+' : ''}${simulation.scoreDelta}`} sx={{ fontWeight: 700, bgcolor: alpha(simulation.scoreDelta >= 0 ? COLORS.success : COLORS.error, 0.1), color: simulation.scoreDelta >= 0 ? COLORS.success : COLORS.error }} />
                  </Stack>
                </Card>

                {[
                  { label: 'CPU', current: kpis?.cpu.used || 0, sim: simulation.cpuPct, color: COLORS.cpu },
                  { label: 'RAM', current: kpis?.ram.used || 0, sim: simulation.ramPct, color: COLORS.ram },
                  { label: t('resources.storageLabel'), current: currentStoragePct, sim: simulation.storagePct, color: COLORS.storage },
                ].map(item => (
                  <Stack key={item.label} direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="body2" fontWeight={600}>{item.label}</Typography>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2">{formatPct(item.current)}</Typography>
                      <Typography variant="caption" color="text.secondary">→</Typography>
                      <Typography variant="body2" fontWeight={700} sx={{ color: item.sim > 90 ? COLORS.error : item.sim > 80 ? COLORS.warning : item.color }}>{formatPct(item.sim)}</Typography>
                    </Stack>
                  </Stack>
                ))}

                {simulation.cpuRatio > 0 && (
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="body2" fontWeight={600}>{t('resources.cpuOverprovRatio')}</Typography>
                    <Typography variant="body2" fontWeight={700} sx={{ color: simulation.cpuRatio > 6 ? COLORS.error : simulation.cpuRatio > 4 ? COLORS.warning : COLORS.success }}>
                      {simulation.cpuRatio.toFixed(1)}:1
                    </Typography>
                  </Stack>
                )}

                {simulation.storageFreeGB > 0 && (
                  <Typography variant="caption" color="text.secondary">
                    {t('resources.storageFreeAfter')}: {simulation.storageFreeGB.toFixed(0)} GB
                  </Typography>
                )}
              </Stack>
            )}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}
