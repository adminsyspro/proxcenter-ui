'use client'

import { useEffect, useMemo, useState } from 'react'

import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Checkbox from '@mui/material/Checkbox'
import CircularProgress from '@mui/material/CircularProgress'
import InputAdornment from '@mui/material/InputAdornment'
import LinearProgress from '@mui/material/LinearProgress'
import ListItemText from '@mui/material/ListItemText'
import MenuItem from '@mui/material/MenuItem'
import Skeleton from '@mui/material/Skeleton'
import Stack from '@mui/material/Stack'
import TablePagination from '@mui/material/TablePagination'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { alpha, useTheme } from '@mui/material/styles'
import { useLocale, useTranslations } from 'next-intl'

import EmptyState from '@/components/EmptyState'
import TaskDetailDialog from '@/components/TaskDetailDialog'
import { DonutStatCard, DonutTotalCard } from '@/components/charts/DonutStatCards'
import { GuestGlyph, NodeGlyph } from '@/components/automation/drs/glyphs'
import { useSWRFetch } from '@/hooks/useSWRFetch'
import { formatDate, formatTime } from '@/lib/i18n/date'
import {
  ARCHIVE_DEFAULT_PAGE_SIZE,
  ARCHIVE_NODE_LIMIT,
  ARCHIVE_PAGE_SIZES,
  TASK_FAMILIES,
  type ArchiveStatus,
  type ArchiveSummary,
  type ArchiveTask,
  type TaskFamily
} from '@/lib/tasks/archive'

type Period = '1h' | '24h' | '7d' | '30d' | 'custom'

const PERIOD_SECONDS: Record<Exclude<Period, 'custom'>, number> = { '1h': 3600, '24h': 86400, '7d': 7 * 86400, '30d': 30 * 86400 }

const FAMILY_ICONS: Record<TaskFamily, string> = {
  power: 'ri-shut-down-line',
  migration: 'ri-arrow-left-right-line',
  ha: 'ri-shield-check-line',
  backup: 'ri-archive-line',
  snapshot: 'ri-camera-line',
  other: 'ri-settings-3-line'
}

const FAMILY_LABEL_KEYS: Record<TaskFamily, string> = {
  power: 'familyPower',
  migration: 'familyMigration',
  ha: 'familyHa',
  backup: 'familyBackup',
  snapshot: 'familySnapshot',
  other: 'familyOther'
}

const ALL = 'all'

// One grid for every row: time, task, target, node, cluster, user, duration,
// status. The text columns share the width in proportion, so the row spans the
// whole card on a wide screen instead of leaving a gap before the duration.
const ROW_COLUMNS = '64px minmax(140px, 1.3fr) minmax(150px, 1.6fr) minmax(90px, 1fr) minmax(90px, 1fr) minmax(110px, 1.3fr) 72px 24px'

// Same height for selects and text fields on one line.
const SMALL_SELECT_SX = { '& .MuiInputBase-input.MuiSelect-select': { minHeight: '1.4375em', lineHeight: '1.4375em' } }

interface ArchiveResponse {
  data: ArchiveTask[]
  meta: {
    total: number
    page: number
    pageSize: number
    truncated: boolean
    summary: ArchiveSummary
    unavailable: { connectionName: string; node: string }[]
    connections: { id: string; name: string }[]
    nodes: { connectionId: string; node: string; status: string }[]
  }
}

/** `datetime-local` value of an epoch, in the browser's time zone. */
function toLocalInput(sec: number): string {
  const d = new Date(sec * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInput(value: string): number | null {
  const ms = new Date(value).getTime()

  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)

    return () => clearTimeout(id)
  }, [value, ms])

  return debounced
}

function dayKey(iso: string): string {
  const d = new Date(iso)

  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/**
 * The task archive of the Events page (#1225): the history each Proxmox node
 * keeps, not only the latest entries of the cluster feed, filtered by period,
 * task type, status, node and guest.
 */
export default function TaskArchive({ refreshedAt }: Readonly<{ refreshedAt: number }>) {
  const t = useTranslations()
  const locale = useLocale()
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  const dotBorder = theme.palette.background.paper

  const [period, setPeriod] = useState<Period>('24h')
  const [anchor, setAnchor] = useState(() => Math.floor(Date.now() / 1000))
  const [customFrom, setCustomFrom] = useState(() => toLocalInput(Math.floor(Date.now() / 1000) - 86400))
  const [customTo, setCustomTo] = useState(() => toLocalInput(Math.floor(Date.now() / 1000)))
  const [families, setFamilies] = useState<TaskFamily[]>([...TASK_FAMILIES])
  const [status, setStatus] = useState<ArchiveStatus>('all')
  const [connectionId, setConnectionId] = useState(ALL)
  const [node, setNode] = useState(ALL)
  const [vmid, setVmid] = useState('')
  const [search, setSearch] = useState('')
  const [pageState, setPageState] = useState({ key: '', page: 0 })
  const [seenRefresh, setSeenRefresh] = useState(refreshedAt)
  const [pageSize, setPageSize] = useState<number>(ARCHIVE_DEFAULT_PAGE_SIZE)
  const [selected, setSelected] = useState<(ArchiveTask & { typeLabel: string }) | null>(null)

  const debouncedVmid = useDebounced(vmid.trim(), 400)
  const debouncedSearch = useDebounced(search.trim(), 400)

  // Refresh re-anchors a sliding period on "now" (state adjusted while rendering).
  if (refreshedAt !== seenRefresh) {
    setSeenRefresh(refreshedAt)
    setAnchor(Math.floor(refreshedAt / 1000))
  }

  // Any filter change goes back to the first page: the page is only kept for
  // the filters it was chosen under.
  const filtersKey = JSON.stringify([period, anchor, customFrom, customTo, families, status, connectionId, node, debouncedVmid, debouncedSearch, pageSize])
  const page = pageState.key === filtersKey ? pageState.page : 0
  const setPage = (next: number) => setPageState({ key: filtersKey, page: next })

  const range = useMemo(() => {
    if (period !== 'custom') return { since: anchor - PERIOD_SECONDS[period], until: anchor }

    return { since: fromLocalInput(customFrom), until: fromLocalInput(customTo) }
  }, [period, anchor, customFrom, customTo])

  const rangeValid = range.since !== null && range.until !== null && range.since < range.until

  const url = useMemo(() => {
    if (!rangeValid || families.length === 0) return null
    const params = new URLSearchParams({
      since: String(range.since),
      until: String(range.until),
      families: families.join(','),
      status,
      page: String(page),
      pageSize: String(pageSize)
    })

    if (connectionId !== ALL) params.set('connectionId', connectionId)
    if (node !== ALL) params.set('node', node)
    if (debouncedVmid) params.set('vmid', debouncedVmid)
    if (debouncedSearch) params.set('q', debouncedSearch)

    return `/api/v1/events/archive?${params}`
  }, [rangeValid, range, families, status, page, pageSize, connectionId, node, debouncedVmid, debouncedSearch])

  const { data, error, isLoading, isValidating, mutate } = useSWRFetch<ArchiveResponse>(url, { keepPreviousData: true, revalidateOnFocus: false })

  useEffect(() => {
    // A sliding period refetches through its new anchor; a custom range keeps its key.
    if (refreshedAt > 0 && period === 'custom') mutate()
  }, [refreshedAt, period, mutate])

  const rows = useMemo(() => (url ? data?.data ?? [] : []), [url, data])
  const meta = url ? data?.meta : undefined
  const summary = meta?.summary ?? { total: 0, ok: 0, warning: 0, error: 0, running: 0 }
  const connections = meta?.connections ?? []
  const nodeOptions = useMemo(() => {
    const all = meta?.nodes ?? []
    const scoped = connectionId === ALL ? all : all.filter(n => n.connectionId === connectionId)

    return [...new Set(scoped.map(n => n.node))]
  }, [meta, connectionId])

  const days = useMemo(() => {
    const groups: { key: string; date: Date; entries: ArchiveTask[] }[] = []

    for (const row of rows) {
      const key = dayKey(row.ts)
      const last = groups.at(-1)

      if (last?.key === key) last.entries.push(row)
      else groups.push({ key, date: new Date(row.ts), entries: [row] })
    }

    return groups
  }, [rows])

  const typeLabel = (type: string) => {
    const key = `events.taskTypes.${type}`

    return t.has(key) ? t(key) : type
  }

  const allFamilies = families.length === TASK_FAMILIES.length

  // The closed selector: "All", one type with its icon, or the icons of the
  // picked types with their count.
  const renderFamilies = () => {
    if (allFamilies) return t('eventsPage.archive.familyAll')
    if (families.length === 0) return t('eventsPage.archive.familyNone')

    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
        {families.map(f => (
          <i key={f} className={FAMILY_ICONS[f]} style={{ fontSize: 15, opacity: 0.75, flexShrink: 0 }} />
        ))}
        <Box component='span' sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {families.length === 1
            ? t(`eventsPage.archive.${FAMILY_LABEL_KEYS[families[0]]}`)
            : t('eventsPage.archive.familiesCount', { count: families.length })}
        </Box>
      </Box>
    )
  }

  const statusGlyph = (row: ArchiveTask) => {
    if (row.statusClass === 'running') {
      return (
        <Tooltip title={t('eventsPage.statusRunning')} arrow>
          <Box component='span' role='img' aria-label={t('eventsPage.statusRunning')} sx={{ display: 'inline-flex', width: 24, justifyContent: 'center' }}>
            <CircularProgress size={16} color='info' />
          </Box>
        </Tooltip>
      )
    }

    const glyph = {
      ok: { icon: 'ri-checkbox-circle-fill', color: theme.palette.success.main, label: t('eventsPage.statusOk') },
      warning: { icon: 'ri-error-warning-fill', color: theme.palette.warning.main, label: row.status },
      error: { icon: 'ri-close-circle-fill', color: theme.palette.error.main, label: row.status }
    }[row.statusClass]

    return (
      <Tooltip title={glyph.label} arrow>
        <Box component='span' role='img' aria-label={glyph.label} sx={{ display: 'inline-flex', width: 24, justifyContent: 'center' }}>
          <i className={glyph.icon} style={{ fontSize: 20, color: glyph.color }} />
        </Box>
      </Tooltip>
    )
  }

  const rowTint = (row: ArchiveTask) => {
    if (row.statusClass === 'error') return theme.palette.error.main
    if (row.statusClass === 'warning') return theme.palette.warning.main
    if (row.statusClass === 'running') return theme.palette.info.main

    return null
  }

  const targetCell = (row: ArchiveTask) => {
    if (row.vmid) {
      return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          <GuestGlyph type={row.guestType ?? undefined} status={row.guestStatus ?? undefined} dotBorder={dotBorder} />
          <Typography sx={{ fontWeight: 600, fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {row.guestName || `VM ${row.vmid}`}
          </Typography>
          <Typography variant='caption' sx={{ opacity: 0.5, flexShrink: 0 }}>
            ({row.vmid})
          </Typography>
        </Box>
      )
    }

    return (
      <Typography variant='body2' sx={{ opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {row.entity || t('eventsPage.archive.nodeLevel')}
      </Typography>
    )
  }

  const unavailable = meta?.unavailable ?? []

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minHeight: 0 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' }, gap: 2, flexShrink: 0 }}>
        <DonutTotalCard
          title={t('eventsPage.archive.total')}
          value={summary.total}
          segments={[
            { value: summary.ok, color: theme.palette.success.main },
            { value: summary.warning, color: theme.palette.warning.main },
            { value: summary.error, color: theme.palette.error.main },
            { value: summary.running, color: theme.palette.info.main }
          ]}
        />
        <DonutStatCard title={t('eventsPage.archive.statusOk')} value={summary.ok} total={summary.total} color={theme.palette.success.main} />
        <DonutStatCard title={t('eventsPage.archive.statusWarning')} value={summary.warning} total={summary.total} color={theme.palette.warning.main} />
        <DonutStatCard title={t('eventsPage.archive.statusError')} value={summary.error} total={summary.total} color={theme.palette.error.main} />
      </Box>

      <Card variant='outlined' sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
        {isValidating && data && <LinearProgress sx={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2 }} />}
        <CardContent sx={{ flexShrink: 0, pb: 1 }}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
            <TextField
              select
              size='small'
              label={t('eventsPage.archive.period')}
              value={period}
              onChange={e => {
                setPeriod(e.target.value as Period)
                setAnchor(Math.floor(Date.now() / 1000))
              }}
              sx={{ minWidth: 170, ...SMALL_SELECT_SX }}
            >
              <MenuItem value='1h'>{t('eventsPage.archive.periodHour')}</MenuItem>
              <MenuItem value='24h'>{t('eventsPage.archive.periodDay')}</MenuItem>
              <MenuItem value='7d'>{t('eventsPage.archive.periodWeek')}</MenuItem>
              <MenuItem value='30d'>{t('eventsPage.archive.periodMonth')}</MenuItem>
              <MenuItem value='custom'>{t('eventsPage.archive.periodCustom')}</MenuItem>
            </TextField>

            {period === 'custom' && (
              <>
                <TextField
                  size='small'
                  type='datetime-local'
                  label={t('eventsPage.archive.from')}
                  value={customFrom}
                  onChange={e => setCustomFrom(e.target.value)}
                  error={!rangeValid}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
                <TextField
                  size='small'
                  type='datetime-local'
                  label={t('eventsPage.archive.to')}
                  value={customTo}
                  onChange={e => setCustomTo(e.target.value)}
                  error={!rangeValid}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              </>
            )}

            {connections.length > 1 && (
              <TextField
                select
                size='small'
                label={t('eventsPage.archive.cluster')}
                value={connectionId}
                onChange={e => {
                  setConnectionId(e.target.value)
                  setNode(ALL)
                }}
                sx={{ minWidth: 170, ...SMALL_SELECT_SX }}
              >
                <MenuItem value={ALL}>{t('eventsPage.allConnections')}</MenuItem>
                {connections.map(c => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.name}
                  </MenuItem>
                ))}
              </TextField>
            )}

            <TextField
              select
              size='small'
              label={t('eventsPage.archive.node')}
              value={node}
              onChange={e => setNode(e.target.value)}
              sx={{ minWidth: 150, ...SMALL_SELECT_SX }}
            >
              <MenuItem value={ALL}>{t('eventsPage.archive.allNodes')}</MenuItem>
              {node !== ALL && !nodeOptions.includes(node) && <MenuItem value={node}>{node}</MenuItem>}
              {nodeOptions.map(n => (
                <MenuItem key={n} value={n}>
                  {n}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              size='small'
              label={t('eventsPage.archive.status')}
              value={status}
              onChange={e => setStatus(e.target.value as ArchiveStatus)}
              sx={{ minWidth: 150, ...SMALL_SELECT_SX }}
            >
              <MenuItem value='all'>{t('eventsPage.archive.statusAll')}</MenuItem>
              <MenuItem value='ok'>{t('eventsPage.archive.statusOk')}</MenuItem>
              <MenuItem value='warning'>{t('eventsPage.archive.statusWarning')}</MenuItem>
              <MenuItem value='error'>{t('eventsPage.archive.statusError')}</MenuItem>
              <MenuItem value='running'>{t('eventsPage.statusRunning')}</MenuItem>
            </TextField>

            <TextField
              select
              size='small'
              label={t('eventsPage.archive.families')}
              value={families}
              onChange={e => {
                const picked = e.target.value as unknown as string[]

                if (picked.includes(ALL)) setFamilies(allFamilies ? [] : [...TASK_FAMILIES])
                else setFamilies(TASK_FAMILIES.filter(f => picked.includes(f)))
              }}
              sx={{ minWidth: 200, maxWidth: 260, ...SMALL_SELECT_SX }}
              slotProps={{ select: { multiple: true, renderValue: renderFamilies } }}
            >
              <MenuItem value={ALL} dense>
                <Checkbox size='small' checked={allFamilies} indeterminate={!allFamilies && families.length > 0} sx={{ p: 0.5, mr: 1 }} />
                <ListItemText primary={t('eventsPage.archive.familyAll')} slotProps={{ primary: { sx: { fontWeight: 600 } } }} />
              </MenuItem>
              {TASK_FAMILIES.map(family => (
                <MenuItem key={family} value={family} dense>
                  <Checkbox size='small' checked={families.includes(family)} sx={{ p: 0.5, mr: 1 }} />
                  <i className={FAMILY_ICONS[family]} style={{ fontSize: 16, opacity: 0.7, marginRight: 8 }} />
                  <ListItemText primary={t(`eventsPage.archive.${FAMILY_LABEL_KEYS[family]}`)} />
                </MenuItem>
              ))}
            </TextField>

            <TextField
              size='small'
              label={t('eventsPage.archive.vmid')}
              value={vmid}
              onChange={e => setVmid(e.target.value.replace(/\D/g, ''))}
              sx={{ width: 110 }}
              slotProps={{ htmlInput: { inputMode: 'numeric' } }}
            />

            <TextField
              size='small'
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('eventsPage.archive.search')}
              sx={{ minWidth: 220, flex: 1 }}
              slotProps={{
                htmlInput: { 'aria-label': t('eventsPage.archive.search') },
                input: {
                  startAdornment: (
                    <InputAdornment position='start'>
                      <i className='ri-search-line' style={{ fontSize: 18, opacity: 0.6 }} />
                    </InputAdornment>
                  )
                }
              }}
            />
          </Box>

          {(unavailable.length > 0 || meta?.truncated) && (
            <Stack spacing={0.5} sx={{ mt: 1 }}>
              {unavailable.length > 0 && (
                <Typography variant='caption' sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'warning.main' }}>
                  <i className='ri-error-warning-line' style={{ fontSize: 14 }} />
                  {t('eventsPage.archive.unavailable', {
                    nodes: unavailable.map(u => (u.node ? `${u.node} (${u.connectionName})` : u.connectionName)).join(', ')
                  })}
                </Typography>
              )}
              {meta?.truncated && (
                <Typography variant='caption' sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'warning.main' }}>
                  <i className='ri-error-warning-line' style={{ fontSize: 14 }} />
                  {t('eventsPage.archive.truncated', { limit: ARCHIVE_NODE_LIMIT })}
                </Typography>
              )}
            </Stack>
          )}
        </CardContent>

        {/* Absolute scroller: the rows never size the page, only this card. */}
        <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <Box sx={{ position: 'absolute', inset: 0, overflowY: 'auto', px: 2, pb: 1 }}>
            {error && (
              <Typography variant='body2' color='error' sx={{ py: 2 }}>
                {t('common.error')}: {error.message}
              </Typography>
            )}
            {!error && isLoading && !data && (
              <Stack spacing={1}>
                {[1, 2, 3, 4, 5].map(i => (
                  <Skeleton key={i} height={40} />
                ))}
              </Stack>
            )}
            {!error && !isLoading && rows.length === 0 && (
              <EmptyState icon='ri-history-line' title={t('eventsPage.archive.noMatch')} description={t('eventsPage.archive.noMatchDesc')} size='medium' />
            )}
            {!error && rows.length > 0 && (
              <Stack spacing={2}>
                {days.map(day => (
                  <Box key={day.key}>
                    <Typography
                      variant='caption'
                      sx={{ display: 'block', mb: 1, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', opacity: 0.7 }}
                    >
                      {formatDate(day.date, locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                    </Typography>
                    <Stack spacing={0.75}>
                      {day.entries.map(row => {
                        const tint = rowTint(row)
                        const label = typeLabel(row.type)

                        return (
                          <Box
                            key={row.id}
                            role='button'
                            tabIndex={0}
                            onClick={() => setSelected({ ...row, typeLabel: label })}
                            onKeyDown={e => {
                              if (e.key === 'Enter') setSelected({ ...row, typeLabel: label })
                            }}
                            sx={{
                              display: 'grid',
                              gridTemplateColumns: ROW_COLUMNS,
                              columnGap: 2,
                              alignItems: 'center',
                              py: 0.75,
                              px: 2,
                              borderRadius: 1,
                              border: '1px solid',
                              borderColor: tint ? alpha(tint, 0.4) : 'divider',
                              bgcolor: tint ? alpha(tint, 0.03) : 'transparent',
                              whiteSpace: 'nowrap',
                              cursor: 'pointer',
                              '&:hover': { bgcolor: 'action.hover' }
                            }}
                          >
                            <Typography variant='body2' sx={{ fontWeight: 600 }}>
                              {formatTime(new Date(row.ts), locale, { hour: '2-digit', minute: '2-digit' })}
                            </Typography>

                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                              <i className={FAMILY_ICONS[row.family]} style={{ fontSize: 16, opacity: 0.7, flexShrink: 0 }} />
                              <Typography variant='body2' sx={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {label}
                              </Typography>
                            </Box>

                            {targetCell(row)}

                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                              <NodeGlyph status={row.nodeStatus ?? undefined} dark={dark} dotBorder={dotBorder} />
                              <Typography sx={{ fontSize: '0.8125rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {row.node}
                              </Typography>
                            </Box>

                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                              <i className='ri-server-line' style={{ fontSize: '0.9286rem', opacity: 0.6, flexShrink: 0 }} />
                              <Typography variant='caption' sx={{ opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {row.connectionName}
                              </Typography>
                            </Box>

                            <Typography variant='body2' sx={{ opacity: 0.75, overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                              {row.initiatedBy?.email ? `${row.initiatedBy.email} (${row.user})` : row.user}
                            </Typography>

                            <Typography variant='body2' sx={{ textAlign: 'right', opacity: 0.8 }}>
                              {row.duration}
                            </Typography>

                            {statusGlyph(row)}
                          </Box>
                        )
                      })}
                    </Stack>
                  </Box>
                ))}
              </Stack>
            )}
          </Box>
        </Box>

        {(meta?.total ?? 0) > ARCHIVE_PAGE_SIZES[0] && (
          <TablePagination
            component='div'
            count={meta?.total ?? 0}
            page={meta?.page ?? page}
            onPageChange={(_, p) => setPage(p)}
            rowsPerPage={pageSize}
            onRowsPerPageChange={e => setPageSize(Number.parseInt(e.target.value, 10))}
            rowsPerPageOptions={[...ARCHIVE_PAGE_SIZES]}
            labelRowsPerPage={t('common.rowsPerPage')}
            labelDisplayedRows={({ from, to, count }) => t('eventsPage.archive.displayedRows', { from, to, count })}
            sx={{ flexShrink: 0, borderTop: '1px solid', borderColor: 'divider' }}
          />
        )}
      </Card>

      <TaskDetailDialog open={selected !== null} task={selected} onClose={() => setSelected(null)} />
    </Box>
  )
}
