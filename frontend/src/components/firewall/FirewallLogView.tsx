'use client'

// Firewall log of a guest, a security group, a node or the cluster's host rules
// (ui#1114): parsed, searchable, filterable lines, newest first, with the
// decision in color. FirewallLogDialog wraps it for the guests and the security
// groups (the guest ones pass their Log IN / Log OUT selects as `headerExtra`);
// the Logging tab of the Network Security page shows it inline.

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'

import {
  Alert, Box, IconButton, InputAdornment, LinearProgress,
  MenuItem, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow,
  TextField, Tooltip, Typography, useTheme, alpha,
} from '@mui/material'

import { GuestGlyph, NodeGlyph } from '@/components/automation/drs/glyphs'
import * as firewallAPI from '@/lib/api/firewall'
import { errorMessage } from '@/lib/firewall/loadError'

import LogLineDetails from './LogLineDetails'

import type { FirewallLogResult, FirewallLogRow, FirewallLogScope } from '@/lib/api/firewall'

export interface LogGuestInfo {
  name: string
  type: 'qemu' | 'lxc'
  status?: string
}

/**
 * Narrows the log to one rule. PVE never logs which rule matched: the rows
 * carry the rules that may have (`ruleCandidates`), deduced server side.
 */
export type LogRuleFilter =
  | { kind: 'groupRule'; group: string; pos: number }
  | { kind: 'guestRule'; pos: number }
  /** A guest's rule that references a group: every hit of that group. */
  | { kind: 'groupRef'; group: string }

const sameName = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

function matchesRule(r: FirewallLogRow, f: LogRuleFilter): boolean {
  if (f.kind === 'groupRef') return r.origin === 'group' && sameName(r.group, f.group)
  if (f.kind === 'groupRule') return r.origin === 'group' && sameName(r.group, f.group) && !!r.ruleCandidates?.includes(f.pos)

  return r.origin === 'guest' && !r.policy && !!r.ruleCandidates?.includes(f.pos)
}

export interface FirewallLogViewProps {
  connectionId: string
  scope: FirewallLogScope
  /** Guest names and states, for the Guest column of a group's log. */
  guests?: Record<number, LogGuestInfo>
  /** Controls rendered above the filters (the guest's log levels). */
  headerExtra?: ReactNode
  /** Only the lines one rule may have written. */
  ruleFilter?: LogRuleFilter
  /**
   * Height of the scrolling table; 'fill' takes what the window has left
   * below it, so a full page scrolls in the table only, never twice.
   */
  maxHeight?: number | 'fill'
}

const WINDOWS = [
  { sec: 900, key: 'last15m' },
  { sec: 3600, key: 'last1h' },
  { sec: 21600, key: 'last6h' },
  { sec: 86400, key: 'last24h' },
  { sec: 604800, key: 'last7d' },
] as const

/** Above this window a read covers rotated logs: refresh on demand only. */
const LIVE_MAX_WINDOW = 3600
const REFRESH_MS = 5000

type ActionFilter = 'all' | 'ACCEPT' | 'DROP' | 'REJECT' | 'unknown'
type DirectionFilter = 'all' | 'in' | 'out'

const ACTION_ICONS: Record<string, string> = { DROP: 'ri-forbid-2-line', REJECT: 'ri-close-circle-line', ACCEPT: 'ri-checkbox-circle-line' }

/** Below this, a 'fill' table lets the page scroll rather than shrink further. */
const MIN_FILL_HEIGHT = 160

const SMALL_SELECT_SX = { '& .MuiInputBase-input.MuiSelect-select': { minHeight: '1.4375em', lineHeight: '1.4375em' } }

/** Keyed by its scope where the scope changes: every read starts from fresh state. */
export default function FirewallLogView({ connectionId, scope: scopeProp, guests, headerExtra, ruleFilter, maxHeight = 520 }: FirewallLogViewProps) {
  const theme = useTheme()
  const t = useTranslations()
  const locale = useLocale()
  const dark = theme.palette.mode === 'dark'
  const dotBorder = theme.palette.background.paper

  const [windowSec, setWindowSec] = useState<number>(3600)
  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState<ActionFilter>('all')
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('all')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(50)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [data, setData] = useState<FirewallLogResult | null>(null)
  // True from mount: the first read starts with the dialog. Later reads set it
  // in their handler (refresh, period), never synchronously in the effect.
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const tableRef = useRef<HTMLDivElement>(null)
  const [fillHeight, setFillHeight] = useState<number>()

  // The scope object is rebuilt by every parent render: key the fetch on its content.
  const scopeKey = JSON.stringify(scopeProp)
  const scope = useMemo(() => JSON.parse(scopeKey) as FirewallLogScope, [scopeKey])
  // Group, node and cluster logs span several guests or nodes: say which.
  const showDecidedBy = scope.kind !== 'group'
  const showGuest = scope.kind === 'group' || scope.kind === 'node'
  const showNode = scope.kind === 'group' || scope.kind === 'cluster'

  const load = useCallback((silent: boolean) => {
    if (!connectionId) return

    void firewallAPI.getFirewallLog(connectionId, scope, windowSec)
      .then(
        res => { setData(res); setError(null) },
        // An auto-refresh failing keeps the last good page on screen.
        err => { if (!silent) setError(errorMessage(err)) },
      )
      .finally(() => { if (!silent) setLoading(false) })
  }, [connectionId, windowSec, scope])

  useEffect(() => {
    load(false)

    if (windowSec > LIVE_MAX_WINDOW) return
    const id = setInterval(() => load(true), REFRESH_MS)

    return () => clearInterval(id)
  }, [load, windowSec])

  // 'fill': the window height minus what sits above and below the table. The
  // table is stretched past the window for the read, so what follows it is
  // measured even when the page fits; nothing paints in between. Stretched, it
  // has nothing to scroll and the browser resets its position: put it back.
  // Only what sits above the table moves it, not the rows a refresh brings,
  // so the 5 s refresh never refits.
  const aboveKey = JSON.stringify([error, loading, data?.warnings.map(w => `${w.kind}:${w.node}`)])

  useLayoutEffect(() => {
    if (maxHeight !== 'fill') return
    const doc = document.scrollingElement

    const fit = () => {
      const el = tableRef.current

      if (!el || !doc) return
      const { height, maxHeight: max } = el.style
      const { scrollTop } = el

      el.style.maxHeight = 'none'
      el.style.height = `${doc.clientHeight * 2}px`
      const rect = el.getBoundingClientRect()
      const below = doc.scrollHeight - (rect.bottom + doc.scrollTop)

      el.style.height = height
      el.style.maxHeight = max
      el.scrollTop = scrollTop
      setFillHeight(Math.max(MIN_FILL_HEIGHT, Math.floor(doc.clientHeight - (rect.top + doc.scrollTop) - below)))
    }

    fit()
    window.addEventListener('resize', fit)

    return () => window.removeEventListener('resize', fit)
  }, [maxHeight, aboveKey])

  /** A filter change sends the list back to its first page. */
  const filterSetter = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(0) }

  const guestName = useCallback((vmid?: number) => (vmid !== undefined ? guests?.[vmid]?.name : undefined), [guests])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()

    return (data?.rows || []).filter(r => {
      if (ruleFilter && !matchesRule(r, ruleFilter)) return false
      if (actionFilter === 'unknown' ? !!r.action : actionFilter !== 'all' && r.action !== actionFilter) return false
      if (directionFilter !== 'all' && r.direction !== directionFilter) return false
      if (!q) return true

      return r.raw.toLowerCase().includes(q) || (guestName(r.vmid) || '').toLowerCase().includes(q) || (r.group || '').toLowerCase().includes(q)
    })
  }, [data, search, actionFilter, directionFilter, guestName, ruleFilter])

  const pageRows = rows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)

  const ACTION_COLORS: Record<string, string> = { DROP: theme.palette.error.main, REJECT: theme.palette.warning.main, ACCEPT: theme.palette.success.main }
  const actionColor = (a?: string) => (a && ACTION_COLORS[a]) || theme.palette.text.disabled
  const actionIcon = (a?: string) => (a && ACTION_ICONS[a]) || 'ri-question-line'

  const actionTip = (r: FirewallLogRow) => {
    if (!r.action) return t('firewallLog.unknownTip')

    return r.actionInferred ? t('firewallLog.inferredTip') : ''
  }

  const fmtTime = (ts: number) => new Date(ts).toLocaleString(locale, {
    ...(windowSec > 86400 ? { day: '2-digit', month: '2-digit' } : {}),
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })

  const service = (r: FirewallLogRow) => {
    if (!r.proto) return '—'
    if (r.dport !== undefined) return `${r.proto} ${r.dport}`
    if (r.icmpType !== undefined) return `${r.proto} ${t('firewallLog.icmpType', { type: r.icmpType })}`

    return r.proto
  }

  const decidedBy = (r: FirewallLogRow) => {
    if (r.origin === 'group') return t('firewallLog.byGroup', { name: r.group || '' })
    if (r.policy) return t('firewallLog.byPolicy')

    return r.origin === 'guest' ? t('firewallLog.byGuestRule') : t('firewallLog.byHost')
  }

  const toggleRow = (id: string) => setExpanded(prev => {
    const next = new Set(prev)

    if (next.has(id)) next.delete(id)
    else next.add(id)

    return next
  })

  const warnings = data?.warnings || []
  const permissionNodes = warnings.filter(w => w.kind === 'permission').map(w => w.node)
  const offlineNodes = warnings.filter(w => w.kind === 'offline').map(w => w.node)
  const otherWarnings = warnings.filter(w => w.kind === 'error')
  const colSpan = 7 + Number(showDecidedBy) + Number(showGuest) + Number(showNode)
  const cellSx = { py: 0.5, fontSize: 12, whiteSpace: 'nowrap' } as const
  // A line without a guest: say the host logged it, unless Decided by already does.
  const noGuest = showDecidedBy
    ? '—'
    : <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}>{t('firewallLog.byHost')}</Typography>

  return (
    <Box>
      {headerExtra && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, py: 1.5, borderBottom: `1px solid ${alpha(theme.palette.divider, 0.15)}` }}>
          {headerExtra}
        </Box>
      )}

      {/* Filters */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.5, flexWrap: 'wrap' }}>
        <TextField
          size="small"
          placeholder={t('firewallLog.searchPlaceholder')}
          value={search}
          onChange={e => filterSetter(setSearch)(e.target.value)}
          sx={{ flex: '1 1 220px', minWidth: 200 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <i className="ri-search-line" style={{ fontSize: 16, opacity: 0.6 }} />
                </InputAdornment>
              ),
            },
          }}
        />
        <TextField select size="small" label={t('firewallLog.action')} value={actionFilter} onChange={e => filterSetter(setActionFilter)(e.target.value as ActionFilter)} sx={{ minWidth: 150, ...SMALL_SELECT_SX }}>
          <MenuItem value="all">{t('firewallLog.allActions')}</MenuItem>
          <MenuItem value="DROP">DROP</MenuItem>
          <MenuItem value="REJECT">REJECT</MenuItem>
          <MenuItem value="ACCEPT">ACCEPT</MenuItem>
          <MenuItem value="unknown">{t('firewallLog.unknownAction')}</MenuItem>
        </TextField>
        <TextField select size="small" label={t('firewallLog.direction')} value={directionFilter} onChange={e => filterSetter(setDirectionFilter)(e.target.value as DirectionFilter)} sx={{ minWidth: 150, ...SMALL_SELECT_SX }}>
          <MenuItem value="all">{t('firewallLog.allDirections')}</MenuItem>
          <MenuItem value="in">{t('firewallLog.in')}</MenuItem>
          <MenuItem value="out">{t('firewallLog.out')}</MenuItem>
        </TextField>
        <TextField select size="small" label={t('firewallLog.period')} value={windowSec} onChange={e => { setLoading(true); filterSetter(setWindowSec)(Number(e.target.value)) }} sx={{ minWidth: 170, ...SMALL_SELECT_SX }}>
          {WINDOWS.map(w => <MenuItem key={w.sec} value={w.sec}>{t(`firewallLog.${w.key}`)}</MenuItem>)}
        </TextField>
        <Tooltip title={t('common.refresh')}>
          <span>
            <IconButton aria-label={t('common.refresh')} size="small" onClick={() => { setLoading(true); load(false) }} disabled={loading}>
              <i className={`ri-refresh-line ${loading ? 'animate-spin' : ''}`} style={{ fontSize: 18 }} />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {(error || permissionNodes.length > 0 || offlineNodes.length > 0 || otherWarnings.length > 0) && (
        <Box sx={{ px: 2, pb: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {permissionNodes.length > 0 && (
            <Alert severity="warning">{t('firewallLog.warnPermission', { nodes: permissionNodes.join(', ') })}</Alert>
          )}
          {offlineNodes.length > 0 && (
            <Alert severity="info">{t('firewallLog.warnOffline', { nodes: offlineNodes.join(', ') })}</Alert>
          )}
          {otherWarnings.map(w => <Alert key={w.node} severity="warning">{`${w.node}: ${w.message}`}</Alert>)}
        </Box>
      )}

      {loading && <LinearProgress />}

      <TableContainer ref={tableRef} sx={{ maxHeight: maxHeight === 'fill' ? fillHeight : maxHeight }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 28, px: 1 }} />
              <TableCell sx={cellSx}>{t('firewallLog.action')}</TableCell>
              <TableCell sx={cellSx}>{t('firewallLog.time')}</TableCell>
              <TableCell sx={cellSx}>{t('firewallLog.direction')}</TableCell>
              <TableCell sx={cellSx}>{t('firewallLog.source')}</TableCell>
              <TableCell sx={cellSx}>{t('firewallLog.destination')}</TableCell>
              <TableCell sx={cellSx}>{t('firewallLog.service')}</TableCell>
              {showDecidedBy && <TableCell sx={cellSx}>{t('firewallLog.decidedBy')}</TableCell>}
              {showGuest && <TableCell sx={cellSx}>{t('firewallLog.guest')}</TableCell>}
              {showNode && <TableCell sx={cellSx}>{t('firewallLog.node')}</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {pageRows.map(r => {
              const isOpen = expanded.has(r.id)
              const color = actionColor(r.action)
              const guest = r.vmid !== undefined ? guests?.[r.vmid] : undefined

              return (
                <Fragment key={r.id}>
                  <TableRow hover onClick={() => toggleRow(r.id)} sx={{ cursor: 'pointer', '& td': { borderBottom: isOpen ? 'none' : undefined } }}>
                    <TableCell sx={{ px: 1, py: 0.5 }}>
                      <i className={isOpen ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} style={{ fontSize: 16, opacity: 0.6 }} />
                    </TableCell>
                    <TableCell sx={cellSx}>
                      <Tooltip
                        title={actionTip(r)}
                        disableHoverListener={!!r.action && !r.actionInferred}
                      >
                        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, color, fontWeight: 700 }}>
                          <i className={actionIcon(r.action)} style={{ fontSize: 15 }} />
                          {r.action || t('firewallLog.unknownAction')}
                          {r.actionInferred && <Box component="span" sx={{ fontWeight: 400, opacity: 0.7 }}>≈</Box>}
                        </Box>
                      </Tooltip>
                      {ruleFilter && ruleFilter.kind !== 'groupRef' && (r.ruleCandidates?.length || 0) > 1 && (
                        <Tooltip title={t('firewallLog.ruleUncertain', { rules: r.ruleCandidates!.filter(p => p !== ruleFilter.pos).map(p => `#${p}`).join(', ') })}>
                          <i className="ri-question-line" style={{ fontSize: 14, marginLeft: 6, opacity: 0.6, verticalAlign: 'middle' }} />
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell sx={{ ...cellSx, fontVariantNumeric: 'tabular-nums' }}>{fmtTime(r.ts)}</TableCell>
                    <TableCell sx={cellSx}>
                      {r.direction ? (
                        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                          <i className={r.direction === 'in' ? 'ri-arrow-right-down-line' : 'ri-arrow-right-up-line'} style={{ fontSize: 14, opacity: 0.7 }} />
                          {r.direction === 'in' ? t('firewallLog.in') : t('firewallLog.out')}
                        </Box>
                      ) : '—'}
                    </TableCell>
                    <TableCell sx={cellSx}>{r.src ? `${r.src}${r.sport !== undefined ? `:${r.sport}` : ''}` : '—'}</TableCell>
                    <TableCell sx={cellSx}>{r.dst || '—'}</TableCell>
                    <TableCell sx={cellSx}>{service(r)}</TableCell>
                    {showDecidedBy && <TableCell sx={{ ...cellSx, color: 'text.secondary' }}>{decidedBy(r)}</TableCell>}
                    {showGuest && (
                      <TableCell sx={cellSx}>
                        {r.vmid !== undefined ? (
                          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                            <GuestGlyph type={guest?.type} status={guest?.status} dotBorder={dotBorder} />
                            {guest?.name || t('firewallLog.unknownGuest')}
                            <Typography component="span" variant="caption" sx={{ color: 'text.disabled' }}>#{r.vmid}</Typography>
                          </Box>
                        ) : noGuest}
                      </TableCell>
                    )}
                    {showNode && (
                      <TableCell sx={cellSx}>
                        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                          {/* A node whose log was read is online. */}
                          <NodeGlyph status="online" dark={dark} dotBorder={dotBorder} />
                          {r.node}
                        </Box>
                      </TableCell>
                    )}
                  </TableRow>
                  {isOpen && (
                    <TableRow>
                      <TableCell colSpan={colSpan} sx={{ py: 1.5, pr: 2, pl: 5, whiteSpace: 'normal', bgcolor: alpha(theme.palette.primary.main, 0.03) }}>
                        <LogLineDetails row={r} guest={guest} decidedBy={decidedBy(r)} actionColor={color} actionIcon={actionIcon(r.action)} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              )
            })}

            {!loading && data && pageRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={colSpan} sx={{ py: 5, textAlign: 'center', borderBottom: 'none' }}>
                  <i className="ri-file-list-line" style={{ fontSize: 32, opacity: 0.3 }} />
                  <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
                    {data.rows.length === 0 ? t('firewallLog.empty') : t('firewallLog.noMatch')}
                  </Typography>
                  {data.rows.length === 0 && (
                    <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block', mt: 0.5, maxWidth: 520, mx: 'auto' }}>
                      {t('firewallLog.emptyHint')}
                    </Typography>
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, borderTop: `1px solid ${alpha(theme.palette.divider, 0.15)}` }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {data?.truncated ? t('firewallLog.truncated', { count: data.rows.length }) : ''}
        </Typography>
        <TablePagination
          component="div"
          count={rows.length}
          page={page}
          onPageChange={(_, p) => setPage(p)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={e => { setRowsPerPage(Number(e.target.value)); setPage(0) }}
          rowsPerPageOptions={[20, 50, 100]}
          labelRowsPerPage={t('common.rowsPerPage')}
        />
      </Box>
    </Box>
  )
}
