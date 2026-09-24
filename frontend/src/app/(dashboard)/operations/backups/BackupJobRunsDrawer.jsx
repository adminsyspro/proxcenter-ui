'use client'

import { useEffect, useState } from 'react'

import { useLocale, useTranslations } from 'next-intl'
import {
  Alert, Box, Chip, Divider, Drawer, IconButton, LinearProgress, List, ListItemButton, Stack,
  Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material'

import { useSWRFetch } from '@/hooks/useSWRFetch'
import { formatDurationSec, guestStatusChip, runStatusChip } from '@/lib/backups/runDisplay'
import { formatDateTime } from '@/lib/i18n/date'
import { formatBytes } from '@/utils/format'

import VzdumpLogSections from './VzdumpLogSections'

const dt = (epoch, locale) => (epoch ? formatDateTime(epoch * 1000, locale, { dateStyle: 'short', timeStyle: 'medium' }) : '—')

function StatusLabel({ chip }) {
  const t = useTranslations()

  return <Chip size="small" color={chip.color} label={chip.count ? `${t(chip.key)} (${chip.count})` : t(chip.key)} />
}

function RunTaskDetail({ connectionId, task }) {
  const t = useTranslations()
  const locale = useLocale()
  const url = task.logUnavailable
    ? null
    : `/api/v1/connections/${encodeURIComponent(connectionId)}/backup-jobs/runs/${encodeURIComponent(task.node)}/${encodeURIComponent(task.upid)}`
  const { data, error, isLoading } = useSWRFetch(url, { refreshInterval: task.status === 'running' ? 5000 : 0 })
  const detail = data?.data

  if (task.logUnavailable) return <Alert severity="info">{task.node}: {t('backups.runs.logUnavailable')}</Alert>
  if (error) return <Alert severity="error">{t('backups.runs.loadError')}</Alert>
  if (isLoading || !detail) return <LinearProgress />

  return (
    <Box sx={{ mb: 3 }}>
      <Table size="small" sx={{ mb: 2 }}>
        <TableHead>
          <TableRow>
            <TableCell>{t('backups.runs.guest')}</TableCell>
            <TableCell>{t('backups.runs.node')}</TableCell>
            <TableCell>{t('backups.runs.start')}</TableCell>
            <TableCell>{t('backups.runs.colDuration')}</TableCell>
            <TableCell>{t('backups.runs.transferred')}</TableCell>
            <TableCell>{t('backups.runs.reused')}</TableCell>
            <TableCell>{t('backups.runs.colStatus')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {detail.log.guests.map(g => (
            <TableRow key={`${g.vmid}-${g.lines[0]?.n ?? 0}`}>
              <TableCell>
                <Tooltip title={g.archive || ''}><span>{g.vmid}{g.name ? ` · ${g.name}` : ''}</span></Tooltip>
              </TableCell>
              <TableCell>{task.node}</TableCell>
              <TableCell>{dt(g.start, locale)}</TableCell>
              <TableCell>{formatDurationSec(g.durationSec)}</TableCell>
              <TableCell>{g.transferredBytes !== null ? formatBytes(g.transferredBytes) : '—'}</TableCell>
              <TableCell>{g.reusedPercent !== null ? `${g.reusedPercent}%` : '—'}</TableCell>
              <TableCell>
                <Tooltip title={g.reason || ''}><span><StatusLabel chip={guestStatusChip(g)} /></span></Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <VzdumpLogSections log={detail.log} node={task.node} />
    </Box>
  )
}

export default function BackupJobRunsDrawer({
  open, onClose, connectionId, title, subtitle, runs = [], focusUpid = null, days = 30, unreachableNodes = [],
}) {
  const t = useTranslations()
  const locale = useLocale()
  const [selectedId, setSelectedId] = useState(null)

  useEffect(() => {
    if (!open) return
    const focused = focusUpid ? runs.find(r => r.tasks.some(tk => tk.upid === focusUpid)) : null
    setSelectedId(prev => focused?.id ?? (runs.some(r => r.id === prev) ? prev : runs[0]?.id ?? null))
  }, [open, runs, focusUpid])

  const selected = runs.find(r => r.id === selectedId) ?? null

  return (
    <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', md: 960 }, p: 3 } }}>
      <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6" noWrap>{t('backups.runs.drawerTitle', { job: title })}</Typography>
          {subtitle && <Typography variant="body2" color="text.secondary" noWrap>{subtitle}</Typography>}
        </Box>
        <IconButton aria-label="close" onClick={onClose}><i className="ri-close-line" /></IconButton>
      </Stack>

      <Typography variant="caption" color="text.secondary">{t('backups.runs.window', { days })}</Typography>
      {unreachableNodes.length > 0 && (
        <Alert severity="warning" sx={{ mt: 1 }}>{t('backups.runs.unreachable', { nodes: unreachableNodes.join(', ') })}</Alert>
      )}

      <Typography variant="subtitle2" sx={{ mt: 2 }}>{t('backups.runs.runsTitle')}</Typography>
      {runs.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>{t('backups.runs.noRuns', { days })}</Typography>
      ) : (
        <List dense sx={{ maxHeight: 260, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
          {runs.map(r => (
            <ListItemButton key={r.id} selected={r.id === selectedId} onClick={() => setSelectedId(r.id)}>
              <Stack direction="row" spacing={2} alignItems="center" sx={{ width: '100%' }}>
                <Typography variant="body2" sx={{ minWidth: 300 }}>
                  {dt(r.start, locale)} → {r.end ? dt(r.end, locale) : '…'}
                </Typography>
                <Typography variant="body2" sx={{ minWidth: 70 }}>{formatDurationSec(r.durationSec)}</Typography>
                <StatusLabel chip={runStatusChip(r)} />
                <Tooltip title={t(`backups.runs.origin.${r.origin}`)}>
                  <i className={r.origin === 'scheduled' ? 'ri-calendar-schedule-line' : 'ri-hand-coin-line'} />
                </Tooltip>
                {r.sharedWith && (
                  <Chip size="small" variant="outlined" label={t('backups.runs.shared', { jobs: r.sharedWith.join(', ') })} />
                )}
              </Stack>
            </ListItemButton>
          ))}
        </List>
      )}

      <Divider sx={{ my: 2 }} />
      {selected ? (
        selected.tasks.map(task => <RunTaskDetail key={task.upid} connectionId={connectionId} task={task} />)
      ) : (
        runs.length > 0 && <Typography variant="body2" color="text.secondary">{t('backups.runs.selectRun')}</Typography>
      )}
    </Drawer>
  )
}
