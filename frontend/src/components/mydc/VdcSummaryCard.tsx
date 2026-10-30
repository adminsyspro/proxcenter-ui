'use client'

import { useTranslations } from 'next-intl'

import { Box, Card, CardActionArea, Chip, Stack, Typography, alpha, useTheme } from '@mui/material'

export type QuotaTone = 'success' | 'warning' | 'error'

/** QuotaDonut's thresholds (red only over the quota, amber from 70 %), green below: the theme primary is orange too. */
export function quotaTone(used: number, max: number | null | undefined): QuotaTone | null {
  if (max == null || max <= 0) return null
  if (used > max) return 'error'
  return used / max >= 0.7 ? 'warning' : 'success'
}

export type VdcHealth = 'over' | 'near' | 'within' | 'none'

/** The worst quota of the vDC decides its state; no quota at all reads as such. */
export function vdcHealth(tones: Array<QuotaTone | null>): VdcHealth {
  if (tones.includes('error')) return 'over'
  if (tones.includes('warning')) return 'near'
  return tones.some(t => t !== null) ? 'within' : 'none'
}

const HEALTH_COLOR: Record<VdcHealth, 'error' | 'warning' | 'success' | 'default'> = {
  over: 'error',
  near: 'warning',
  within: 'success',
  none: 'default',
}

const formatGb = (mb: number) => (mb / 1024).toFixed(1)

interface QuotaRowProps {
  icon: string
  label: string
  used: number
  max: number | null | undefined
  /** Turns MB into the GB figures shown, the bar keeps the raw ratio. */
  gb?: boolean
  unlimitedLabel: string
}

function QuotaRow({ icon, label, used, max, gb, unlimitedLabel }: QuotaRowProps) {
  const theme = useTheme()
  const tone = quotaTone(used, max)
  const fmt = (v: number) => (gb ? formatGb(v) : String(v))
  const pct = tone ? Math.min(100, (used / (max as number)) * 100) : 0
  const barColor = tone ? theme.palette[tone].main : 'transparent'
  const track = theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'
  const unit = gb ? ' GB' : ''

  return (
    <Box sx={{ minWidth: 0 }}>
      <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mb: 0.75 }}>
        <Box component="i" className={icon} sx={{ fontSize: 16, color: 'text.secondary', alignSelf: 'center' }} />
        <Typography variant="body2" color="text.secondary" noWrap sx={{ flexGrow: 1 }}>{label}</Typography>
        <Typography
          variant="body2"
          noWrap
          sx={{ fontVariantNumeric: 'tabular-nums', color: tone === 'error' ? 'error.main' : 'text.primary', fontWeight: 600 }}
        >
          {tone ? fmt(used) : `${fmt(used)}${unit}`}
          <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400 }}>
            {tone ? ` / ${fmt(max as number)}${unit}` : ` · ${unlimitedLabel}`}
          </Box>
        </Typography>
      </Stack>
      <Box
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={tone ? (max as number) : undefined}
        aria-valuenow={used}
        sx={{
          height: 8,
          borderRadius: 4,
          overflow: 'hidden',
          // No quota: a dotted track, nothing to fill.
          background: tone ? track : `repeating-linear-gradient(90deg, ${track} 0 4px, transparent 4px 8px)`,
        }}
      >
        <Box sx={{ width: `${pct}%`, height: '100%', borderRadius: 4, bgcolor: barColor, transition: 'width 400ms cubic-bezier(0.16, 1, 0.3, 1)' }} />
      </Box>
    </Box>
  )
}

interface Props {
  vdc: any
  isContext: boolean
  onOpen: () => void
}

/**
 * One vDC per row on the multi-vDC landing: who it is and its state on the
 * left, the four quotas that block a deploy side by side as bars with their
 * figures, and what the vDC holds underneath. Stacks on narrow screens.
 */
export default function VdcSummaryCard({ vdc, isContext, onOpen }: Props) {
  const t = useTranslations()
  const theme = useTheme()
  const usage = vdc.usage || {}
  const quota = vdc.quota || {}
  const unlimitedLabel = t('vdc.quotaUnlimited')

  const rows: QuotaRowProps[] = [
    { icon: 'ri-cpu-line', label: t('myVdc.grid.vcpus'), used: usage.usedVcpus || 0, max: quota.maxVcpus, unlimitedLabel },
    { icon: 'ri-ram-2-line', label: t('myVdc.grid.ram'), used: usage.usedRamMb || 0, max: quota.maxRamMb, gb: true, unlimitedLabel },
    { icon: 'ri-hard-drive-2-line', label: t('myVdc.grid.storage'), used: usage.usedStorageMb || 0, max: quota.maxStorageMb, gb: true, unlimitedLabel },
    { icon: 'ri-computer-line', label: t('myVdc.grid.vms'), used: usage.usedVms || 0, max: quota.maxVms, unlimitedLabel },
  ]
  const health = vdcHealth(rows.map(r => quotaTone(r.used, r.max)))

  const facts = [
    { icon: 'ri-server-line', text: t('myVdc.grid.nodes', { count: (vdc.nodes || []).length }) },
    { icon: 'ri-database-2-line', text: t('myVdc.grid.storages', { count: (vdc.storages || []).length }) },
    { icon: 'ri-git-branch-line', text: t('myVdc.grid.networks', { count: (vdc.vnets || []).length }) },
    { icon: 'ri-archive-line', text: t('myVdc.grid.backups', { count: usage.usedBackups || 0 }) },
  ]

  return (
    <Card
      variant="outlined"
      sx={{
        borderColor: isContext ? alpha(theme.palette.primary.main, 0.6) : undefined,
        transition: 'border-color 150ms ease-out, box-shadow 200ms ease-out',
        '&:hover': {
          borderColor: theme.palette.primary.main,
          boxShadow: `0 6px 20px ${alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.35 : 0.08)}`,
        },
        '&:hover .vdc-open': { opacity: 1, transform: 'translateX(0)' },
      }}
    >
      <CardActionArea onClick={onOpen} sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'minmax(220px, 300px) 1fr' },
            columnGap: 4,
            rowGap: 2,
            alignItems: 'center',
            px: 2.5,
            py: 2,
          }}
        >
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
            <Box
              sx={{
                width: 44, height: 44, borderRadius: 1.5, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                bgcolor: alpha(theme.palette.primary.main, 0.12), color: 'primary.main',
              }}
            >
              <Box component="i" className="ri-cloud-line" sx={{ fontSize: 24 }} />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" fontWeight={600} noWrap>{vdc.name}</Typography>
              {vdc.description && (
                <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>{vdc.description}</Typography>
              )}
              <Stack direction="row" spacing={0.75} sx={{ mt: 0.75 }}>
                <Chip
                  size="small"
                  variant="outlined"
                  color={HEALTH_COLOR[health]}
                  label={(
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'currentColor' }} />
                      <span>{t(`myVdc.grid.health.${health}`)}</span>
                    </Stack>
                  )}
                  sx={{ height: 22, fontSize: '0.7rem' }}
                />
                {isContext && (
                  <Chip size="small" color="primary" variant="outlined" label={t('myVdc.currentContext')} sx={{ height: 22, fontSize: '0.7rem' }} />
                )}
              </Stack>
            </Box>
          </Stack>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' }, columnGap: 4, rowGap: 2 }}>
            {rows.map(r => <QuotaRow key={r.icon} {...r} />)}
          </Box>
        </Box>

        <Stack
          direction="row"
          alignItems="center"
          sx={{ mt: 'auto', px: 2, py: 1.25, borderTop: 1, borderColor: 'divider', columnGap: 2, rowGap: 0.5, flexWrap: 'wrap' }}
        >
          {facts.map(f => (
            <Stack key={f.icon} direction="row" spacing={0.5} alignItems="center">
              <Box component="i" className={f.icon} sx={{ fontSize: 14, color: 'text.secondary' }} />
              <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>{f.text}</Typography>
            </Stack>
          ))}
          <Box
            component="i"
            className="ri-arrow-right-line vdc-open"
            aria-hidden
            sx={{ ml: 'auto', fontSize: 18, color: 'primary.main', opacity: 0.4, transform: 'translateX(-4px)', transition: 'opacity 150ms ease-out, transform 200ms cubic-bezier(0.16, 1, 0.3, 1)' }}
          />
        </Stack>
      </CardActionArea>
    </Card>
  )
}
