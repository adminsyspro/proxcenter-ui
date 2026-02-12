'use client'

import { useState, useEffect } from 'react'
import {
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Slider,
  Stack,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useTranslations } from 'next-intl'

import type { ResourceThresholds } from '../types'
import { COLORS, DEFAULT_THRESHOLDS } from '../constants'
import { SpeedIcon, MemoryIcon, StorageIcon, SettingsIcon } from './icons'

export default function ThresholdsDialog({ open, onClose, thresholds, onSave }: {
  open: boolean
  onClose: () => void
  thresholds: ResourceThresholds
  onSave: (t: ResourceThresholds) => void
}) {
  const t = useTranslations()
  const [local, setLocal] = useState<ResourceThresholds>(thresholds)
  const [saving, setSaving] = useState(false)

  useEffect(() => { setLocal(thresholds) }, [thresholds])

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/v1/settings/resource-thresholds', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(local),
      })
      if (res.ok) {
        onSave(local)
        onClose()
      }
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => setLocal(DEFAULT_THRESHOLDS)

  const resources = [
    { key: 'cpu' as const, label: 'CPU', icon: <SpeedIcon sx={{ fontSize: 20 }} />, color: COLORS.cpu },
    { key: 'ram' as const, label: 'RAM', icon: <MemoryIcon sx={{ fontSize: 20 }} />, color: COLORS.ram },
    { key: 'storage' as const, label: t('resources.storageLabel'), icon: <StorageIcon sx={{ fontSize: 20 }} />, color: COLORS.storage },
  ]

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Stack direction="row" alignItems="center" spacing={1}>
          <SettingsIcon sx={{ fontSize: 20 }} />
          <Typography variant="h6" fontWeight={700}>{t('resources.configureThresholds')}</Typography>
        </Stack>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t('resources.thresholdsDescription')}
        </Typography>
        <Stack spacing={4}>
          {resources.map(res => (
            <Box key={res.key}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
                <Box sx={{ color: res.color }}>{res.icon}</Box>
                <Typography variant="subtitle2" fontWeight={700}>{res.label}</Typography>
              </Stack>
              <Box sx={{ px: 2 }}>
                <Typography variant="caption" color="text.secondary">{t('resources.warningThreshold')}: {local[res.key].warning}%</Typography>
                <Slider
                  value={local[res.key].warning}
                  onChange={(_, v) => setLocal(prev => ({ ...prev, [res.key]: { ...prev[res.key], warning: v as number } }))}
                  min={50}
                  max={99}
                  valueLabelDisplay="auto"
                  sx={{ color: COLORS.warning, '& .MuiSlider-thumb': { bgcolor: COLORS.warning } }}
                />
                <Typography variant="caption" color="text.secondary">{t('resources.criticalThreshold')}: {local[res.key].critical}%</Typography>
                <Slider
                  value={local[res.key].critical}
                  onChange={(_, v) => setLocal(prev => ({ ...prev, [res.key]: { ...prev[res.key], critical: v as number } }))}
                  min={50}
                  max={99}
                  valueLabelDisplay="auto"
                  sx={{ color: COLORS.error, '& .MuiSlider-thumb': { bgcolor: COLORS.error } }}
                />
              </Box>
            </Box>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleReset} sx={{ textTransform: 'none' }}>{t('resources.resetDefaults')}</Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving} sx={{ textTransform: 'none' }}>{t('common.save')}</Button>
      </DialogActions>
    </Dialog>
  )
}
