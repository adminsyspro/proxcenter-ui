'use client'

import { useMemo, useState } from 'react'

import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import FormControl from '@mui/material/FormControl'
import InputAdornment from '@mui/material/InputAdornment'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Skeleton from '@mui/material/Skeleton'
import Stack from '@mui/material/Stack'
import TablePagination from '@mui/material/TablePagination'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { alpha, useTheme } from '@mui/material/styles'
import { useLocale, useTranslations } from 'next-intl'

import EmptyState from '@/components/EmptyState'
import { DonutStatCard, DonutTotalCard } from '@/components/charts/DonutStatCards'
import { formatDate, formatTime } from '@/lib/i18n/date'

import {
  filterMigrations,
  formatDurationMs,
  groupByDay,
  migrationDurationMs,
  sortNewestFirst,
  summarizeMigrations,
  type HistoryStatusFilter,
  type MigrationHistoryEntry
} from './migrationHistory'

interface Props {
  /** Every migration the orchestrator returned, any order, any status. */
  migrations: MigrationHistoryEntry[]
  connectionNames: Record<string, string>
  /** Current guest status, keyed `${connection_id}:${vmid}`; drives the status dot. */
  vmStatus?: Record<string, string>
  /** Current node status, keyed `${connection_id}:${node}`; drives the status dot. */
  nodeStatus?: Record<string, string>
  loading?: boolean
}

const ALL = 'all'
const PAGE_SIZES = [20, 50, 100]

// One grid for every row so a long guest or node name never shifts the
// columns of its neighbours: time, guest, cluster, source, arrow, target,
// reason (takes what is left), duration, status.
const ROW_COLUMNS = '76px 240px 120px 120px 20px 120px minmax(0, 1fr) 64px 24px'

// Same palette as the dashboard's Guests per Node widget, so a guest or a node
// reads the same everywhere.
const GUEST_STATUS_COLORS: Record<string, string> = { running: '#4caf50', stopped: '#f44336', paused: '#ff9800', suspended: '#ff9800' }
const NODE_STATUS_COLORS: Record<string, string> = { online: '#4caf50', unknown: '#9e9e9e', maintenance: '#ff9800' }

const guestStatusColor = (status?: string) => GUEST_STATUS_COLORS[status || ''] || '#616161'
const nodeStatusColor = (status?: string) => (status ? NODE_STATUS_COLORS[status] || '#f44336' : '#9e9e9e')

/** Guest glyph: type icon with the status dot, as in every guest list of the product. */
const GuestGlyph = ({ type, status, dotBorder }: { type?: string; status?: string; dotBorder: string }) => (
  <Box sx={{ position: 'relative', width: 16, height: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <i className={type === 'lxc' ? 'ri-instance-line' : 'ri-computer-line'} style={{ fontSize: '0.9286rem', opacity: 0.8 }} />
    <Box sx={{ position: 'absolute', bottom: -1, right: -2, width: 6, height: 6, borderRadius: '50%', bgcolor: guestStatusColor(status), border: `1px solid ${dotBorder}` }} />
  </Box>
)

/** Node glyph: the Proxmox logo with the status dot, as on every node row of the product. */
const NodeGlyph = ({ status, dark, dotBorder }: { status?: string; dark: boolean; dotBorder: string }) => (
  <Box component='span' sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 14, height: 14, flexShrink: 0 }}>
    <img src={dark ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt='' width={14} height={14} style={{ opacity: 0.8 }} />
    <Box component='span' sx={{ position: 'absolute', bottom: -1, right: -2, width: 6, height: 6, borderRadius: '50%', bgcolor: nodeStatusColor(status), border: `1px solid ${dotBorder}` }} />
  </Box>
)

/**
 * The DRS "History" tab: what DRS actually moved, newest first, grouped by
 * day, one line per move with the reason it was decided. The task center
 * lists the same migrations as generic jobs; this is the DRS-side reading.
 */
const MigrationHistoryTab = ({ migrations, connectionNames, vmStatus = {}, nodeStatus = {}, loading = false }: Props) => {
  const t = useTranslations()
  const locale = useLocale()
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  const dotBorder = theme.palette.background.paper

  const [cluster, setClusterState] = useState<string>(ALL)
  const [status, setStatusState] = useState<HistoryStatusFilter>(ALL)
  const [search, setSearchState] = useState('')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(PAGE_SIZES[0])

  // A filter change always goes back to the first page.
  const setCluster = (v: string) => {
    setClusterState(v)
    setPage(0)
  }

  const setStatus = (v: HistoryStatusFilter) => {
    setStatusState(v)
    setPage(0)
  }

  const setSearch = (v: string) => {
    setSearchState(v)
    setPage(0)
  }

  const durationUnits = useMemo(
    () => ({ s: t('drsPage.historyUnitSeconds'), min: t('drsPage.historyUnitMinutes'), h: t('drsPage.historyUnitHours') }),
    [t]
  )

  const sorted = useMemo(() => sortNewestFirst(migrations), [migrations])
  const summary = useMemo(() => summarizeMigrations(sorted), [sorted])

  const filtered = useMemo(
    () => filterMigrations(sorted, { connectionId: cluster === ALL ? '' : cluster, status, search }),
    [sorted, cluster, status, search]
  )

  const lastPage = Math.max(0, Math.ceil(filtered.length / rowsPerPage) - 1)
  const safePage = Math.min(page, lastPage)
  const pageRows = useMemo(
    () => filtered.slice(safePage * rowsPerPage, (safePage + 1) * rowsPerPage),
    [filtered, safePage, rowsPerPage]
  )

  const days = useMemo(() => groupByDay(pageRows), [pageRows])

  // Only offer the cluster filter when there is something to choose between.
  const clusterOptions = useMemo(
    () => Object.entries(connectionNames).sort((a, b) => a[1].localeCompare(b[1])),
    [connectionNames]
  )

  if (loading && migrations.length === 0) {
    return (
      <Stack spacing={1}>
        {[1, 2, 3].map(i => (
          <Skeleton key={i} height={56} />
        ))}
      </Stack>
    )
  }

  if (migrations.length === 0) {
    return (
      <EmptyState
        icon='ri-history-line'
        title={t('drsPage.noRecentMigrations')}
        description={t('drsPage.historyEmptyDesc')}
        size='medium'
      />
    )
  }

  // Status as a glyph, not a chip: a green check, a red cross, or a spinner
  // while the move runs. The tooltip is the only place the label lives now, and
  // on a failure it also carries the error text.
  const statusGlyph = (entry: MigrationHistoryEntry) => {
    if (entry.status === 'failed') {
      const label = entry.error ? `${t('drsPage.historyStatusFailed')}: ${entry.error}` : t('drsPage.historyStatusFailed')

      return (
        <Tooltip title={label} arrow>
          <Box component='span' role='img' aria-label={label} sx={{ display: 'inline-flex', width: 24, justifyContent: 'center', cursor: 'help' }}>
            <i className='ri-close-circle-fill' style={{ fontSize: 20, color: theme.palette.error.main }} />
          </Box>
        </Tooltip>
      )
    }

    if (entry.status === 'running') {
      return (
        <Tooltip title={t('drsPage.historyStatusRunning')} arrow>
          <Box component='span' role='img' aria-label={t('drsPage.historyStatusRunning')} sx={{ display: 'inline-flex', width: 24, justifyContent: 'center' }}>
            <CircularProgress size={16} color='info' />
          </Box>
        </Tooltip>
      )
    }

    return (
      <Tooltip title={t('drsPage.historyStatusCompleted')} arrow>
        <Box component='span' role='img' aria-label={t('drsPage.historyStatusCompleted')} sx={{ display: 'inline-flex', width: 24, justifyContent: 'center' }}>
          <i className='ri-checkbox-circle-fill' style={{ fontSize: 20, color: theme.palette.success.main }} />
        </Box>
      </Tooltip>
    )
  }

  const rowTint = (entry: MigrationHistoryEntry) => {
    if (entry.status === 'failed') return theme.palette.error.main
    if (entry.status === 'running') return theme.palette.info.main

    return null
  }

  // A node is its logo, its status dot and its name, with no colored backdrop:
  // the arrow already says which side is which.
  const nodeCell = (entry: MigrationHistoryEntry, node: string) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
      <NodeGlyph status={nodeStatus[`${entry.connection_id}:${node}`]} dark={dark} dotBorder={dotBorder} />
      <Typography title={node} sx={{ fontSize: '0.8125rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {node}
      </Typography>
    </Box>
  )

  return (
    <Stack spacing={2}>
      {/* Summary over the loaded window, the same donuts as the Operations pages */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 2 }}>
        <DonutTotalCard
          title={t('drsPage.historyTotal')}
          value={summary.total}
          segments={[
            { value: summary.completed, color: theme.palette.success.main },
            { value: summary.failed, color: theme.palette.error.main },
            { value: summary.running, color: theme.palette.info.main }
          ]}
          subtitle={
            summary.avgDurationMs === null
              ? undefined
              : `${t('drsPage.historyAvgDuration')} ${formatDurationMs(summary.avgDurationMs, durationUnits)}`
          }
        />
        <DonutStatCard title={t('drsPage.historyCompleted')} value={summary.completed} total={summary.total} color={theme.palette.success.main} />
        <DonutStatCard title={t('drsPage.historyFailed')} value={summary.failed} total={summary.total} color={theme.palette.error.main} />
        <DonutStatCard title={t('drsPage.historyStatusRunning')} value={summary.running} total={summary.total} color={theme.palette.info.main} />
      </Box>

      <Card variant='outlined' sx={{ borderRadius: 2 }}>
        <CardContent>
          {/* Filters */}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 2 }}>
            {clusterOptions.length > 1 && (
              <FormControl size='small' sx={{ minWidth: 220 }}>
                <InputLabel id='drs-history-cluster-label'>{t('drsPage.clusterLabel')}</InputLabel>
                <Select
                  labelId='drs-history-cluster-label'
                  value={cluster}
                  label={t('drsPage.clusterLabel')}
                  onChange={e => setCluster(e.target.value)}
                >
                  <MenuItem value={ALL}>{t('drsPage.historyAllClusters')}</MenuItem>
                  {clusterOptions.map(([id, name]) => (
                    <MenuItem key={id} value={id}>
                      {name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
            <FormControl size='small' sx={{ minWidth: 180 }}>
              <InputLabel id='drs-history-status-label'>{t('drsPage.historyStatusLabel')}</InputLabel>
              <Select
                labelId='drs-history-status-label'
                value={status}
                label={t('drsPage.historyStatusLabel')}
                onChange={e => setStatus(e.target.value as HistoryStatusFilter)}
              >
                <MenuItem value={ALL}>{t('drsPage.historyStatusAll')}</MenuItem>
                <MenuItem value='completed'>{t('drsPage.historyStatusCompleted')}</MenuItem>
                <MenuItem value='failed'>{t('drsPage.historyStatusFailed')}</MenuItem>
                <MenuItem value='running'>{t('drsPage.historyStatusRunning')}</MenuItem>
              </Select>
            </FormControl>
            <TextField
              size='small'
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('drsPage.historySearch')}
              inputProps={{ 'aria-label': t('drsPage.historySearch') }}
              sx={{ minWidth: 220, flex: 1 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position='start'>
                    <i className='ri-search-line' style={{ fontSize: 18, opacity: 0.6 }} />
                  </InputAdornment>
                )
              }}
            />
          </Box>

          {days.length === 0 ? (
            <Typography variant='body2' color='text.secondary' sx={{ py: 2, textAlign: 'center' }}>
              {t('drsPage.historyNoMatch')}
            </Typography>
          ) : (
            <Stack spacing={2}>
              {days.map(day => (
                <Box key={day.key}>
                  <Typography
                    variant='caption'
                    sx={{ display: 'block', mb: 1, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', opacity: 0.7 }}
                  >
                    {day.key === 'unknown'
                      ? t('drsPage.historyUnknownDate')
                      : formatDate(day.date, locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                  </Typography>

                  <Stack spacing={1}>
                    {day.entries.map(entry => {
                      const tint = rowTint(entry)
                      const duration = migrationDurationMs(entry)
                      const clusterName = connectionNames[entry.connection_id] || entry.connection_id.slice(0, 12)

                      return (
                        <Box
                          key={entry.id}
                          sx={{
                            display: 'grid',
                            gridTemplateColumns: ROW_COLUMNS,
                            columnGap: 2,
                            alignItems: 'center',
                            py: 1,
                            px: 2,
                            borderRadius: 1,
                            border: '1px solid',
                            borderColor: tint ? alpha(tint, 0.4) : 'divider',
                            bgcolor: tint ? alpha(tint, 0.03) : 'transparent',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {/* Time */}
                          <Typography variant='body2' sx={{ fontWeight: 600 }}>
                            {formatTime(new Date(entry.started_at), locale, { hour: '2-digit', minute: '2-digit' })}
                          </Typography>

                          {/* Guest */}
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                            <GuestGlyph type={entry.guest_type} status={vmStatus[`${entry.connection_id}:${entry.vmid}`]} dotBorder={dotBorder} />
                            <Typography title={entry.vm_name} sx={{ fontWeight: 600, fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {entry.vm_name || `VM ${entry.vmid}`}
                            </Typography>
                            <Typography variant='caption' sx={{ opacity: 0.5, flexShrink: 0 }}>
                              ({entry.vmid})
                            </Typography>
                            {entry.maintenance_evacuation && (
                              <Chip label={t('drsPage.evacuation')} size='small' color='warning' sx={{ height: 16, fontSize: '0.6rem', flexShrink: 0 }} />
                            )}
                          </Box>

                          {/* Cluster */}
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                            <i className='ri-server-line' style={{ fontSize: '0.9286rem', opacity: 0.6, flexShrink: 0 }} />
                            <Typography variant='caption' title={clusterName} sx={{ opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {clusterName}
                            </Typography>
                          </Box>

                          {/* Source, arrow, target: three cells so the arrows line up */}
                          {nodeCell(entry, entry.source_node)}
                          <Typography sx={{ opacity: 0.4, textAlign: 'center' }}>→</Typography>
                          {nodeCell(entry, entry.target_node)}

                          {/* Reason, takes what is left */}
                          <Typography
                            variant='caption'
                            sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', opacity: entry.reason ? 0.8 : 0.5, fontStyle: entry.reason ? 'normal' : 'italic' }}
                          >
                            {entry.reason || t('drsPage.historyNoReason')}
                          </Typography>

                          {/* Duration */}
                          <Typography variant='body2' sx={{ textAlign: 'right', opacity: 0.8 }}>
                            {duration === null ? '' : formatDurationMs(duration, durationUnits)}
                          </Typography>

                          {statusGlyph(entry)}
                        </Box>
                      )
                    })}
                  </Stack>
                </Box>
              ))}
            </Stack>
          )}

          {filtered.length > PAGE_SIZES[0] && (
            <TablePagination
              component='div'
              count={filtered.length}
              page={safePage}
              onPageChange={(_, p) => setPage(p)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={e => {
                setRowsPerPage(Number.parseInt(e.target.value, 10))
                setPage(0)
              }}
              rowsPerPageOptions={PAGE_SIZES}
              labelRowsPerPage={t('common.rowsPerPage')}
              labelDisplayedRows={({ from, to, count }) => t('drsPage.historyDisplayedRows', { from, to, count })}
            />
          )}
        </CardContent>
      </Card>
    </Stack>
  )
}

export default MigrationHistoryTab
