'use client'

import { useTranslations } from 'next-intl'
import { Box, Stack, Typography } from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'

import QuotaDonut from '@/components/mydc/QuotaDonut'

export type VdcQuota = {
  maxVcpus: number | null
  maxRamMb: number | null
  maxStorageMb: number | null
  maxVms: number | null
}
export type VdcUsage = {
  usedVcpus: number
  usedRamMb: number
  usedStorageMb: number
  usedVms: number
}
export type VdcRequest = {
  vcpus: number
  ramMb: number
  storageMb: number
  vms: number
}

interface Props {
  quota: VdcQuota
  usage: VdcUsage
  requested: VdcRequest

  /** Notified whenever the over-limit / approaching state changes — lets the
   *  parent gate Next/Submit on quota validity. */
  onStateChange?: (state: { blocked: boolean; tight: boolean; overCount: number }) => void
}

type QuotaResource = 'vcpus' | 'ram' | 'storage' | 'vms'
interface QuotaItem {
  resource: QuotaResource
  label: string
  icon: string
  used: number
  requested: number
  projected: number
  max: number | null
  format: (v: number) => string
  pct: number
  over: boolean
}

const formatMbAsGb = (mb: number) => `${(mb / 1024).toFixed(1)} GB`

/**
 * vDC quota banner with live donuts and structured violations. Shared by
 * the CreateVm/CreateLxc dialogs (per-tenant pre-flight) and the Templates
 * deploy wizard (cloud-image deployments).
 *
 * The component is purely presentational — it receives quota / usage from
 * the parent (which fetches them once per dialog open) and `requested`
 * which mirrors the live form state so the donuts animate as the user
 * tweaks sliders.
 */
export default function VdcQuotaBanner({ quota, usage, requested, onStateChange }: Props) {
  const t = useTranslations()
  const theme = useTheme()

  const items: QuotaItem[] = (() => {
    const fmtNum = (v: number) => String(v)

    const raw = [
      { resource: 'vcpus' as const, icon: 'ri-cpu-line', label: t('inventory.createVm.quotaBanner.labels.vcpus'),
        used: usage.usedVcpus, requested: requested.vcpus, max: quota.maxVcpus, format: fmtNum },
      { resource: 'ram' as const, icon: 'ri-ram-2-line', label: t('inventory.createVm.quotaBanner.labels.ram'),
        used: usage.usedRamMb, requested: requested.ramMb, max: quota.maxRamMb, format: formatMbAsGb },
      { resource: 'storage' as const, icon: 'ri-hard-drive-2-line', label: t('inventory.createVm.quotaBanner.labels.storage'),
        used: usage.usedStorageMb, requested: requested.storageMb, max: quota.maxStorageMb, format: formatMbAsGb },
      { resource: 'vms' as const, icon: 'ri-computer-line', label: t('inventory.createVm.quotaBanner.labels.vms'),
        used: usage.usedVms, requested: requested.vms, max: quota.maxVms, format: fmtNum },
    ]


return raw.map(i => {
      const projected = i.used + i.requested
      const pct = i.max != null && i.max > 0 ? Math.round((projected / i.max) * 100) : 0
      const over = i.max != null && projected > i.max


return { ...i, projected, pct, over }
    })
  })()

  const overItems = items.filter(i => i.over)
  const tightItems = items.filter(i => !i.over && i.pct >= 90)
  const blocked = overItems.length > 0
  const tight = !blocked && tightItems.length > 0

  // Notify parent on state transitions only (no infinite render loop).
  // The signature of onStateChange is stable per render, so we compare by
  // serialised value through a ref-less pattern in the parent.
  if (onStateChange) onStateChange({ blocked, tight, overCount: overItems.length })

  const accent = blocked ? theme.palette.error.main
    : tight ? theme.palette.warning.main
    : theme.palette.success.main

  return (
    <Box
      sx={{
        mb: 2,
        p: 2,
        borderRadius: 1,
        border: 1,
        borderColor: alpha(accent, 0.35),
        position: 'relative',
        overflow: 'hidden',
        background: `linear-gradient(135deg, ${alpha(accent, 0.1)} 0%, ${alpha(theme.palette.background.paper, 0.97)} 50%, ${alpha(accent, 0.04)} 100%)`,
        backdropFilter: 'blur(8px)',
        transition: 'border-color 0.2s, box-shadow 0.2s, background 0.2s',
        '&:hover': {
          borderColor: alpha(accent, 0.55),
          boxShadow: `0 8px 32px ${alpha(accent, 0.15)}`,
        },
      }}
    >
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          top: -60,
          right: -60,
          width: 220,
          height: 220,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${alpha(accent, 0.14)} 0%, transparent 70%)`,
          pointerEvents: 'none',
        }}
      />
      <Stack direction="row" alignItems="center" spacing={1} mb={1.5} sx={{ position: 'relative' }}>
        <Box
          component="i"
          className={blocked ? 'ri-close-circle-fill' : tight ? 'ri-error-warning-fill' : 'ri-checkbox-circle-fill'}
          sx={{ fontSize: 20, color: blocked ? 'error.main' : tight ? 'warning.main' : 'success.main' }}
        />
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {blocked ? t('inventory.createVm.quotaBanner.titleBlocked') : t('inventory.createVm.quotaBanner.title')}
        </Typography>
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(4, 1fr)' },
          justifyItems: 'center',
          position: 'relative',
        }}
      >
        {items.map(item => (
          <QuotaDonut
            key={item.resource}
            icon={item.icon}
            label={item.label}
            used={item.used}
            requested={item.requested}
            max={item.max}
            formatValue={item.resource === 'ram' || item.resource === 'storage' ? formatMbAsGb : undefined}
            unlimitedLabel={t('inventory.createVm.quotaBanner.unlimited')}
            size={88}
          />
        ))}
      </Box>

      {overItems.length > 0 && (
        <Box
          sx={{
            mt: 2,
            pt: 1.5,
            borderTop: 1,
            borderColor: (th) => th.palette.mode === 'dark' ? 'error.dark' : 'error.light',
            display: 'flex',
            flexDirection: 'column',
            gap: 0.75,
            position: 'relative',
          }}
        >
          {overItems.map(item => {
            const overAmount = item.max != null ? item.projected - item.max : 0


return (
              <Stack key={item.resource} direction="row" alignItems="center" spacing={1.5}>
                <Box component="i" className={item.icon} sx={{ fontSize: 16, color: 'error.main', width: 16, textAlign: 'center', flexShrink: 0 }} />
                <Typography variant="body2" sx={{ fontWeight: 500, minWidth: 70 }}>
                  {item.label}
                </Typography>
                <Typography variant="body2" sx={{ flex: 1, color: 'text.secondary' }} noWrap>
                  {item.format(item.projected)} / {item.format(item.max as number)}
                </Typography>
                <Box
                  sx={{
                    px: 1,
                    py: 0.25,
                    borderRadius: 0.75,
                    bgcolor: 'error.main',
                    color: 'error.contrastText',
                    fontWeight: 600,
                    fontSize: '0.72rem',
                    lineHeight: 1.4,
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                  }}
                >
                  +{item.format(overAmount)}
                </Box>
              </Stack>
            )
          })}
        </Box>
      )}
    </Box>
  )
}
