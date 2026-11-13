'use client'

import { useMemo } from 'react'

import { useTranslations } from 'next-intl'
import { Alert, Box, FormControlLabel, LinearProgress, Switch, Tooltip, Typography, alpha, useTheme } from '@mui/material'

import { GuestGlyph, Section } from '@/components/gpu/GpuInventoryPanel'
import GpuGauge from '@/components/gpu/GpuGauge'
import GpuVendorLogo, { gpuVendor } from '@/components/gpu/GpuVendorLogo'
import { useGpuLatest } from '@/components/gpu/useGpuMetrics'
import type { GpuReport } from '@/lib/gpu/report'
import { isComputeProfile, parseProfile, profileCapacity, type ProfileModel, type ProfileRow } from '@/lib/gpu/vgpu'

import { shortModel } from './GpuTileMap'
import { vgpuCards } from './VgpuTab'

// Profile, GPU memory, per card, used by, still possible.
const COLUMNS = '110px 100px 100px minmax(0, 1.4fr) minmax(0, 1fr)'

const gib = (mib: number) => {
  const v = Math.round(mib / 102.4) / 10
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

/** "Show every profile" in the page bar: the B and A profiles carry no CUDA worth the name. */
export function ProfilesToggle({ value, onChange }: { value: boolean; onChange: (next: boolean) => void }) {
  const t = useTranslations('gpu.profiles')
  return (
    <FormControlLabel
      sx={{ mr: 0 }}
      control={<Switch size='small' checked={value} onChange={e => onChange(e.target.checked)} />}
      label={<Typography variant='body2'>{t('showAll')}</Typography>}
    />
  )
}

function CardBars({ model }: { model: ProfileModel }) {
  const t = useTranslations('gpu.profiles')
  const theme = useTheme()
  const primary = theme.palette.primary.main
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 1.5, px: 2, py: 1.25, borderBottom: 1, borderColor: 'divider' }}>
      {model.cards.map(c => (
        <Box key={c.deviceKey} data-testid='gpu-profile-card' sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, mb: 0.5 }}>
            <Typography variant='caption' sx={{ fontWeight: 600 }} noWrap>{c.connectionName} · {c.node}</Typography>
            <Typography variant='caption' color='text.secondary' noWrap>
              {t('promised', { used: gib(c.fbPromised), total: gib(c.fbTotal) })}
            </Typography>
          </Box>
          <GpuGauge pct={c.fbTotal ? (c.fbPromised / c.fbTotal) * 100 : 0} label={t('promised', { used: gib(c.fbPromised), total: gib(c.fbTotal) })} />
        </Box>
      ))}
    </Box>
  )
}

function Row({ row, cards }: { row: ProfileRow; cards: number }) {
  const t = useTranslations('gpu.profiles')
  const theme = useTheme()
  const parsed = parseProfile(row.name)
  const free = row.perCard.reduce((s, p) => s + p.free, 0)
  const holders = row.holders.map(h => `${h.vmName ?? ''} #${h.vmid}${h.running ? '' : ` (${t('stopped')})`}`).join(', ')
  const perCard = row.perCard.map(p => `${p.node} : ${p.free}`).join(' · ')
  return (
    <Box
      data-testid='gpu-profile-row'
      sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: COLUMNS }, gap: 1.5, alignItems: 'center', px: 2, py: 0.75, borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
        <Box sx={{ px: 0.75, borderRadius: 1, bgcolor: alpha(theme.palette.primary.main, 0.12), color: 'primary.main' }}>
          <Typography variant='body2' sx={{ fontWeight: 700, color: 'inherit' }}>{parsed ? `${parsed.gib}${parsed.series}` : row.name}</Typography>
        </Box>
        <Typography variant='caption' color='text.secondary' noWrap title={`${row.name} · nvidia-${row.typeId}`}>nvidia-{row.typeId}</Typography>
      </Box>
      <Typography variant='body2'>{gib(row.fbMemory)} {t('gib')}</Typography>
      <Typography variant='body2' color='text.secondary'>{t('max', { count: row.maxInstances })}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
        {row.holders.length ? (
          <>
            <GuestGlyph status={row.holders.some(h => h.running) ? 'running' : 'stopped'} dotBorder={theme.palette.background.paper} />
            <Typography variant='body2' noWrap title={holders} sx={{ minWidth: 0 }}>{holders}</Typography>
          </>
        ) : (
          <Typography variant='body2' color='text.secondary'>-</Typography>
        )}
      </Box>
      <Tooltip title={cards > 1 ? perCard : ''} disableInteractive>
        <Typography variant='body2' sx={{ fontWeight: free ? 700 : 400, color: free ? 'success.main' : 'text.secondary' }} noWrap data-testid='gpu-profile-free'>
          {free ? (cards > 1 ? t('freeMany', { count: free, cards }) : t('freeOne', { count: free })) : t('full')}
        </Typography>
      </Tooltip>
    </Box>
  )
}

/**
 * The vGPU profiles of each card model (#672): what each one gives a VM, how
 * many fit on a card, which VMs hold one, and how many more the cards can
 * still take, their frame buffer allowing. NVIDIA fixes the profiles; the
 * page shows them, it does not create any.
 */
export default function ProfilesTab({ report, showAll }: { report: GpuReport; showAll: boolean }) {
  const t = useTranslations('gpu.profiles')
  const latest = useGpuLatest()
  const catalog = useMemo(() => latest.data?.vgpuTypes ?? [], [latest.data])
  const models = useMemo(() => profileCapacity(vgpuCards(report), report.allocations, catalog), [report, catalog])

  if (latest.loading && !latest.data) return <LinearProgress />
  const head = { variant: 'caption' as const, color: 'text.secondary', sx: { fontWeight: 600 } }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }} data-testid='gpu-profiles-tab'>
      <Typography variant='body2' color='text.secondary'>{t('intro')}</Typography>
      {models.map(m => {
        const rows = m.rows.filter(r => showAll || isComputeProfile(r.name))
        const title = m.deviceName ? shortModel({ deviceName: m.deviceName, vendorName: m.vendorName, vendorId: m.vendorId, deviceId: null }) : m.key
        return (
          <Section
            key={m.key}
            title={title}
            icon='ri-stack-line'
            right={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <GpuVendorLogo vendor={gpuVendor(m)} size={16} />
                <Typography variant='caption' color='text.secondary'>
                  {t('cards', { count: m.cards.length + m.unread.length })}
                  {m.cards[0] ? ` · ${t('perCard', { size: gib(m.cards[0].fbTotal) })}` : ''}
                </Typography>
              </Box>
            }
          >
            {m.unread.length > 0 && (
              <Alert severity='info' sx={{ m: 1.5 }}>{t('unread', { count: m.unread.length })}</Alert>
            )}
            {m.cards.length > 0 && (
              <>
                <CardBars model={m} />
                <Box sx={{ display: { xs: 'none', md: 'grid' }, gridTemplateColumns: COLUMNS, gap: 1.5, px: 2, py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
                  <Typography {...head}>{t('colProfile')}</Typography>
                  <Typography {...head}>{t('colMemory')}</Typography>
                  <Typography {...head}>{t('colMax')}</Typography>
                  <Typography {...head}>{t('colUsedBy')}</Typography>
                  <Tooltip title={t('colFreeHint')} disableInteractive>
                    <Typography {...head} sx={{ ...head.sx, cursor: 'help', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      {t('colFree')} <i className='ri-information-line' aria-hidden />
                    </Typography>
                  </Tooltip>
                </Box>
                {rows.map(r => <Row key={r.typeId} row={r} cards={m.cards.length} />)}
              </>
            )}
          </Section>
        )
      })}
    </Box>
  )
}
