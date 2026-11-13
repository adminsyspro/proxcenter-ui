'use client'

import { useMemo, useState } from 'react'

import { useTranslations } from 'next-intl'
import { Box, Chip, Collapse, MenuItem, TextField, Typography } from '@mui/material'

import { SMALL_SELECT_SX } from '@/components/backup/restoreDrills/DrillTargetPicker'
import { deviceLabel } from '@/components/gpu/GpuInventoryPanel'
import { attentionByKind, attentionItems, scopeReport, type GpuAttention } from '@/lib/gpu/fleet'
import type { GpuReport } from '@/lib/gpu/report'

import LoadDashboard from './LoadDashboard'

const ATTENTION_ICON: Record<GpuAttention['kind'], { icon: string; color: 'error' | 'warning' | 'default' }> = {
  connectionError: { icon: 'ri-error-warning-line', color: 'error' },
  nodeError: { icon: 'ri-error-warning-line', color: 'error' },
  notIsolated: { icon: 'ri-shield-cross-line', color: 'default' }
}

function AttentionRow({ item }: { item: GpuAttention }) {
  const t = useTranslations('gpu.page.attn')
  const { icon } = ATTENTION_ICON[item.kind]

  let text: string
  switch (item.kind) {
    case 'connectionError':
      text = t('connectionError', { cluster: item.connectionName, error: item.error })
      break
    case 'nodeError':
      text = t('nodeError', { cluster: item.connectionName, node: item.node, error: item.error })
      break
    case 'notIsolated':
      text = t('notIsolated', {
        device: item.device.deviceName || deviceLabel(item.device),
        node: item.device.node,
        cluster: item.device.connectionName
      })
      break
  }

  return (
    <Box
      data-testid='gpu-attention-row'
      data-kind={item.kind}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 2,
        py: 0.75,
        borderBottom: 1,
        borderColor: 'divider',
        '&:last-child': { borderBottom: 0 }
      }}
    >
      <i className={icon} style={{ fontSize: 16, flexShrink: 0 }} />
      <Typography
        variant='body2'
        sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        title={text}
      >
        {text}
      </Typography>
    </Box>
  )
}

type AttentionGroup = ReturnType<typeof attentionByKind>[number]

/** One chip per kind of thing to look at; a click unfolds its list under the bar (AttentionList). */
function AttentionChips({
  groups,
  open,
  onToggle
}: {
  groups: AttentionGroup[]
  open: GpuAttention['kind'] | null
  onToggle: (kind: GpuAttention['kind']) => void
}) {
  const t = useTranslations('gpu.page')
  // Nothing to flag: no chip at all.
  if (!groups.length) return null
  return (
    <>
      {groups.map(g => (
        <Chip
          key={g.kind}
          data-testid='gpu-attention-chip'
          data-kind={g.kind}
          size='small'
          variant={open === g.kind ? 'filled' : 'outlined'}
          color={ATTENTION_ICON[g.kind].color}
          icon={<i className={ATTENTION_ICON[g.kind].icon} />}
          label={t(`attnChip.${g.kind}`, { count: g.items.length })}
          onClick={() => onToggle(g.kind)}
          aria-expanded={open === g.kind}
        />
      ))}
    </>
  )
}

export default function OverviewTab({ report, onConfigure }: { report: GpuReport; onConfigure?: () => void }) {
  const t = useTranslations('gpu')
  const [connId, setConnId] = useState('')
  const [node, setNode] = useState('')

  const clusters = useMemo(
    () =>
      [...new Map(report.devices.filter(d => d.kind === 'gpu').map(d => [d.connId, d.connectionName])).entries()].sort(
        (a, b) => a[1].localeCompare(b[1])
      ),
    [report]
  )
  const nodes = useMemo(
    () =>
      [
        ...new Set(report.devices.filter(d => d.kind === 'gpu' && (!connId || d.connId === connId)).map(d => d.node))
      ].sort((a, b) => a.localeCompare(b)),
    [report, connId]
  )
  const scope = useMemo(() => ({ connId: connId || null, node: node || null }), [connId, node])
  const scoped = useMemo(() => scopeReport(report, scope), [report, scope])
  const attention = useMemo(() => attentionByKind(attentionItems(scoped)), [scoped])
  const [openKind, setOpenKind] = useState<GpuAttention['kind'] | null>(null)
  const openGroup = attention.find(g => g.kind === openKind)
  const hasGpu = report.devices.some(d => d.kind === 'gpu')

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }} data-testid='gpu-overview'>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }} data-testid='gpu-overview-bar'>
        <AttentionChips groups={attention} open={openKind} onToggle={k => setOpenKind(o => (o === k ? null : k))} />
        <Box sx={{ flex: 1 }} />
        {clusters.length > 1 && (
          <TextField
            select
            size='small'
            label={t('page.filterCluster')}
            value={connId}
            onChange={e => {
              setConnId(e.target.value)
              setNode('')
            }}
            sx={{ minWidth: 170, ...SMALL_SELECT_SX }}
            slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
          >
            <MenuItem value=''>{t('page.allClusters')}</MenuItem>
            {clusters.map(([id, name]) => (
              <MenuItem key={id} value={id}>
                {name}
              </MenuItem>
            ))}
          </TextField>
        )}
        {nodes.length > 1 && (
          <TextField
            select
            size='small'
            label={t('colNode')}
            value={node}
            onChange={e => setNode(e.target.value)}
            sx={{ minWidth: 150, ...SMALL_SELECT_SX }}
            slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
          >
            <MenuItem value=''>{t('page.allNodes')}</MenuItem>
            {nodes.map(n => (
              <MenuItem key={n} value={n}>
                {n}
              </MenuItem>
            ))}
          </TextField>
        )}
      </Box>
      <Collapse in={!!openGroup} unmountOnExit>
        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2 }}>
          {openGroup?.items.map(item => (
            <AttentionRow key={item.key} item={item} />
          ))}
        </Box>
      </Collapse>
      {/* No GPU at all: say so and how they are found, rather than ask to configure a load to read. */}
      {hasGpu ? (
        <LoadDashboard report={scoped} scope={scope} onConfigure={onConfigure} />
      ) : (
        <NoGpu consoles={report.devices.filter(d => d.kind === 'console').length} />
      )}
    </Box>
  )
}

/** The empty state of the GPU page: none found, and what was looked at. */
function NoGpu({ consoles }: { consoles: number }) {
  const t = useTranslations('gpu.page')
  return (
    <Box
      data-testid='gpu-none'
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        py: 5,
        px: 3,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1,
        textAlign: 'center'
      }}
    >
      <i className='ri-cpu-line' style={{ fontSize: 36, opacity: 0.5 }} aria-hidden />
      <Typography variant='subtitle1' sx={{ fontWeight: 700 }}>
        {t('noneTitle')}
      </Typography>
      <Typography variant='body2' color='text.secondary' sx={{ maxWidth: 640 }}>
        {t('noneText', { consoles })}
      </Typography>
    </Box>
  )
}
