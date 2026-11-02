'use client'

import { useMemo, useState, type ReactNode } from 'react'

import {
  Box, ButtonBase, Card, IconButton, InputAdornment, MenuItem, Select, Skeleton, Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import CephNooutChip from '@/components/ceph/CephNooutChip'
import { SMALL_SELECT_SX } from '@/components/settings/destinations/DestinationDialogParts'
import { useRBAC } from '@/contexts/RBACContext'
import { useCephNoout } from '@/hooks/useCephNoout'
import { osdIssues, type OsdIssue } from '@/lib/ceph/hostMap'
import { flagsOnOsd, hostFlagsForNode } from '@/lib/ceph/osdFlagsView'
import {
  flattenGroups, groupOsdsByHost, OSD_PAGE_SIZE, osdDeviceClasses, osdDotState, osdFilterCounts, osdHosts, pageOfOsd, paginateGroups, resolvePveNode, toOsdLoad,
} from '@/lib/ceph/osdTable'
import { binaryUnit, osdLatencyMs } from '@/lib/ceph/overview'
import type { CephOsd, OsdFilter } from '@/lib/ceph/types'

import type { CockpitTabProps } from './CephCockpit'
import OsdDrawer from './OsdDrawer'
import OsdIoCell, { OSD_IO_CELL_WIDTH } from './OsdIoCell'
import OsdLatencyTrend from './OsdLatencyTrend'
import { useCephOsdLatencySeries, type OsdLatencyPoint } from './hooks/useCephOsdLatencySeries'
import { useOsdIoColumns, useOsdIoStore, type OsdIoColumns, type OsdIoRef } from './hooks/useOsdIoColumns'
import { CephOsdGlyph, fillColumnLg, fillGrowLg, HostGlyph, StateDot, TABULAR, ThresholdBar, useStableByKey, usePercent, type DotState } from './ui'

/*
   OSD tab of the Ceph cockpit: every OSD in one table grouped by host (foldable groups,
   20 rows per page), with a search, host and class selects and the quick filters
   (all, with a problem, down, out) and their counts. A click on a row opens the OSD
   sheet in a drawer and writes `item=osd.N` in the URL.
*/

const FILTERS: OsdFilter[] = ['all', 'problem', 'down', 'out']
const COLUMNS = 9
const EMPTY: CephOsd[] = []

function Tag({ children }: { children: ReactNode }) {
  return (
    <Box component='span' sx={{ display: 'inline-flex', fontSize: 10.5, fontWeight: 600, lineHeight: 1.7, px: 0.75, borderRadius: 1, bgcolor: 'action.hover', color: 'text.secondary', whiteSpace: 'nowrap' }}>
      {children}
    </Box>
  )
}

/** The noout chip of a host: its state is read only for a host that carries a flag. */
function HostNooutChip({ conn, node, flags, canManage }: { conn: string; node: string; flags: string[]; canManage: boolean }) {
  const state = useCephNoout({ connId: conn, node, open: true, mode: 'exit', refreshKey: flags.join(',') })

  return <CephNooutChip state={state} canManage={canManage} inline />
}

function OsdRow({ osd, node, state, ratios, selected, issues, trend, session, io, onOpen }: { osd: CephOsd; node: string | null; state: DotState; ratios: { nearfull: number; full: number }; selected: boolean; issues: OsdIssue[]; trend?: OsdLatencyPoint[]; session: boolean; io: OsdIoColumns; onOpen: (id: number) => void }) {
  const t = useTranslations('cephCockpit')
  const format = useFormatter()
  const percent = usePercent()
  const sep = t('ui.separator')
  const latency = osdLatencyMs(osd)
  const label = t('osd.open', { id: osd.id })

  return (
    <TableRow
      hover
      selected={selected}
      tabIndex={0}
      aria-label={label}
      aria-current={selected ? 'true' : undefined}
      data-testid='osd-row'
      data-osd={osd.id}
      data-state={state}
      onClick={() => onOpen(osd.id)}
      onKeyDown={e => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onOpen(osd.id)
        }
      }}
      sx={{ cursor: 'pointer', '& td': { py: 0.875, whiteSpace: 'nowrap' }, opacity: osd.in ? 1 : 0.7 }}
    >
      <TableCell>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CephOsdGlyph osd={osd} />
          <Typography component='span' sx={{ fontSize: 13, fontWeight: 700 }}>{`osd.${osd.id}`}</Typography>
        </Box>
      </TableCell>
      <TableCell>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.875, fontSize: 12, fontWeight: 600 }}>
          <StateDot state={state} size={7} />
          <Box component='span' sx={osd.up ? undefined : { color: 'error.main' }}>{t(osd.up ? 'osd.state.up' : 'osd.state.down')}</Box>
          {sep}
          <Box component='span' sx={osd.in ? undefined : { color: 'warning.main' }}>{t(osd.in ? 'osd.state.in' : 'osd.state.out')}</Box>
          {issues.length > 0 && (
            <Tooltip title={t('osd.issues', { count: issues.length })}>
              <i
                className='ri-alert-line'
                role='img'
                aria-label={t('osd.issues', { count: issues.length })}
                style={{ fontSize: 14, color: issues.some(i => i.severity === 'error') ? 'var(--mui-palette-error-main)' : 'var(--mui-palette-warning-main)' }}
              />
            </Tooltip>
          )}
        </Box>
      </TableCell>
      <TableCell>{osd.deviceClass && osd.deviceClass !== 'unknown' ? <Tag>{osd.deviceClass.toUpperCase()}</Tag> : null}</TableCell>
      <TableCell sx={{ minWidth: 170 }}>
        {osd.up ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: '110px 44px', alignItems: 'center', columnGap: 1 }}>
            <ThresholdBar value={osd.usedPct / 100} max={1} nearfull={ratios.nearfull} full={ratios.full} size='sm' />
            <Typography component='span' sx={{ ...TABULAR, fontSize: 12.5, fontWeight: 700, textAlign: 'right' }}>{percent(osd.usedPct / 100)}</Typography>
          </Box>
        ) : (
          <Typography component='span' variant='body2' color='text.disabled'>{t('overview.missing')}</Typography>
        )}
      </TableCell>
      <TableCell sx={{ ...TABULAR, fontSize: 12.5 }}>
        {osd.up && latency !== null ? (
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
            <Box component='span' sx={{ minWidth: 52 }}>{t('osd.latency', { ms: format.number(latency, { maximumFractionDigits: 1 }) })}</Box>
            <OsdLatencyTrend points={trend} session={session} />
          </Box>
        ) : t('overview.missing')}
      </TableCell>
      {(['ops', 'bytes'] as const).map(kind => (
        <TableCell key={kind} sx={{ ...TABULAR, fontSize: 12.5 }}>
          <OsdIoCell kind={kind} current={io.currentOf(osd.id)} series={io.seriesOf(osd.id)} state={io.stateOf(node)} reason={io.reasonOf(node)} node={node} noNode={node === null} port={io.port} session={io.source === 'session'} up={osd.up} />
        </TableCell>
      ))}
      <TableCell sx={{ ...TABULAR, fontSize: 12.5 }}>{typeof osd.pgs === 'number' ? format.number(osd.pgs) : t('overview.missing')}</TableCell>
      <TableCell align='right' sx={{ width: 32 }}><i className='ri-arrow-right-s-line' style={{ opacity: 0.45 }} aria-hidden /></TableCell>
    </TableRow>
  )
}

export default function OsdTab({ conn, live, inventory, url, enterprise, ratios, osdFlags, latencyBuffer, ioStore, onNavigate: _onNavigate }: CockpitTabProps) {
  const t = useTranslations('cephCockpit')
  const format = useFormatter()
  const { hasPermission } = useRBAC()
  const canManage = hasPermission('storage.admin')
  const canManageNode = hasPermission('node.manage')
  const inv = inventory.inventory
  const osds = inv?.osds.list ?? EMPTY
  const checks = live.live?.health.checks ?? inv?.health.checks

  const rawIssues = useMemo(() => osdIssues(checks ?? []), [checks])
  const issues = useStableByKey(rawIssues, [...rawIssues].map(([id, list]) => `${id}:${list.map(i => `${i.code}/${i.severity}`).join(',')}`).join('|'))

  const [search, setSearch] = useState('')
  const [hostPick, setHostPick] = useState('')
  const [classPick, setClassPick] = useState('')
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
  const [page, setPage] = useState(0)
  const [followed, setFollowed] = useState<number | null>(null)

  const hosts = useMemo(() => osdHosts(osds), [osds])
  const classes = useMemo(() => osdDeviceClasses(osds), [osds])
  // A host or class that the selected cluster does not have is no filter.
  const host = hosts.includes(hostPick) ? hostPick : ''
  const deviceClass = classes.includes(classPick) ? classPick : ''
  const ctx = useMemo(() => ({ ratios, issues }), [ratios, issues])
  const counts = useMemo(() => osdFilterCounts(osds, ctx), [osds, ctx])
  const groups = useMemo(() => groupOsdsByHost(osds, { search, host, deviceClass, filter: url.filter, ...ctx }), [osds, search, host, deviceClass, url.filter, ctx])
  const flat = useMemo(() => flattenGroups(groups), [groups])

  const selectedId = url.item?.kind === 'osd' ? url.item.id : null
  const selected = selectedId === null ? null : (osds.find(o => o.id === selectedId) ?? null)

  // The page follows the OSD the sheet moves to (arrows, health link, deep link), not the other way round.
  if (selectedId !== followed) {
    setFollowed(selectedId)
    if (selected) setPage(pageOfOsd(groups, folded, selected.id))
  }

  const view = useMemo(() => paginateGroups(groups, folded, page), [groups, folded, page])
  const sep = t('ui.separator')
  const total = view.rowCount
  const from = view.page * OSD_PAGE_SIZE + 1
  const to = Math.min(total, (view.page + 1) * OSD_PAGE_SIZE)

  // The curves of the rows shown (the page), not of the whole table.
  const pageIds = useMemo(() => view.shown.flatMap(g => g.rows.map(o => o.id)), [view.shown])
  const latency = useCephOsdLatencySeries(conn, url.range, enterprise, pageIds, latencyBuffer)

  // IOPS and throughput of the rows shown: the exporter of their nodes, polled while this table is on screen.
  const ownIoStore = useOsdIoStore()
  const pveNodes = inv?.pveNodes
  const ioRefs = useMemo<OsdIoRef[]>(() => view.shown.flatMap(g => {
    const node = resolvePveNode(g.host, pveNodes)

    return g.rows.map(o => ({ id: o.id, node }))
  }), [view.shown, pveNodes])
  const io = useOsdIoColumns(conn, url.range, enterprise, ioRefs, !!inv, ioStore ?? ownIoStore)
  const nodeOf = useMemo(() => new Map(ioRefs.map(r => [r.id, r.node])), [ioRefs])

  const navList = flat.some(o => o.id === selectedId) ? flat : flattenGroups(groupOsdsByHost(osds, {}))
  const at = navList.findIndex(o => o.id === selectedId)
  const open = (id: number) => url.set({ item: { kind: 'osd', id } })
  const step = (delta: number) => {
    const target = navList[at + delta]

    if (target) open(target.id)
  }

  const toggleFold = (name: string) => setFolded(prev => {
    const next = new Set(prev)

    if (next.has(name)) next.delete(name)
    else next.add(name)

    return next
  })

  if (!inv) return <Skeleton variant='rounded' height={320} data-testid='osd-loading' />

  return (
    <Box data-testid='osd-tab' sx={fillColumnLg}>
      <Card variant='outlined' data-testid='osd-card' sx={fillColumnLg}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', p: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
          <TextField
            size='small'
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0) }}
            placeholder={t('osd.search')}
            slotProps={{
              htmlInput: { 'aria-label': t('osd.search') },
              input: { startAdornment: <InputAdornment position='start'><i className='ri-search-line' aria-hidden /></InputAdornment> },
            }}
            sx={{ width: 230 }}
          />
          <Select
            size='small'
            displayEmpty
            value={host}
            onChange={e => { setHostPick(e.target.value); setPage(0) }}
            inputProps={{ 'aria-label': t('osd.hostFilter') }}
            sx={{ minWidth: 150, ...SMALL_SELECT_SX }}
          >
            <MenuItem value=''>{t('osd.allHosts')}</MenuItem>
            {hosts.map(h => <MenuItem key={h} value={h}>{h}</MenuItem>)}
          </Select>
          <Select
            size='small'
            displayEmpty
            value={deviceClass}
            onChange={e => { setClassPick(e.target.value); setPage(0) }}
            inputProps={{ 'aria-label': t('osd.classFilter') }}
            sx={{ minWidth: 150, ...SMALL_SELECT_SX }}
          >
            <MenuItem value=''>{t('osd.allClasses')}</MenuItem>
            {classes.map(c => <MenuItem key={c} value={c}>{c.toUpperCase()}</MenuItem>)}
          </Select>
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', ml: 'auto' }}>
            {FILTERS.map(f => {
              const on = url.filter === f

              return (
                <ButtonBase
                  key={f}
                  aria-pressed={on}
                  onClick={() => { url.set({ filter: f }); setPage(0) }}
                  sx={{
                    display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.5, borderRadius: 4, border: '1px solid', fontSize: 12, fontWeight: 600,
                    borderColor: on ? 'text.primary' : 'divider', bgcolor: on ? 'text.primary' : 'transparent', color: on ? 'background.paper' : 'text.secondary',
                    '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 },
                  }}
                >
                  {t(`osd.filters.${f}`)}
                  <Box component='b' sx={{ ...TABULAR, fontWeight: 700, color: on ? 'inherit' : 'text.primary' }}>{counts[f]}</Box>
                </ButtonBase>
              )
            })}
          </Box>
        </Box>

        <Box data-testid='osd-table' sx={[{ overflowX: 'auto' }, fillGrowLg]}>
          <Table size='small' sx={{ minWidth: 640, '& th, & td': { px: 1.25 } }}>
            <TableHead>
              <TableRow sx={{ '& th': { fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'text.secondary', whiteSpace: 'nowrap' } }}>
                {(['osd', 'state', 'class', 'fill', 'latency'] as const).map(c => <TableCell key={c}>{t(`osd.columns.${c}`)}</TableCell>)}
                {(['ops', 'bytes'] as const).map(k => <TableCell key={k} sx={{ minWidth: OSD_IO_CELL_WIDTH[k] }}>{t(k === 'ops' ? 'osd.columns.iops' : 'osd.columns.throughput')}</TableCell>)}
                <TableCell>{t('osd.columns.pgs')}</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {view.shown.length === 0 && (
                <TableRow>
                  <TableCell colSpan={COLUMNS} sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
                    {osds.length === 0 ? t('osd.empty') : t('osd.emptyFiltered')}
                  </TableCell>
                </TableRow>
              )}
              {view.shown.map(g => {
                const hostFlags = hostFlagsForNode(osdFlags.hostFlags, g.host).flags
                const size = g.osds.reduce((sum, o) => sum + toOsdLoad(o).totalBytes, 0)
                const unit = binaryUnit(size)
                const isFolded = g.folded

                return [
                  <TableRow key={`g-${g.host}`} data-testid={`osd-group-${g.host}`} sx={{ '& td': { bgcolor: 'action.hover', py: 0.5 } }}>
                    <TableCell colSpan={COLUMNS}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                        <IconButton size='small' aria-expanded={!isFolded} aria-label={t(isFolded ? 'osd.group.unfold' : 'osd.group.fold', { host: g.host })} onClick={() => toggleFold(g.host)}>
                          <i className={isFolded ? 'ri-arrow-right-s-line' : 'ri-arrow-down-s-line'} aria-hidden />
                        </IconButton>
                        <HostGlyph host={g.host} inventory={inv} />
                        <Typography component='span' sx={{ fontSize: 13, fontWeight: 700 }}>{g.host}</Typography>
                        <Typography component='span' variant='caption' color='text.secondary' sx={TABULAR}>
                          {sep}{t('osd.group.osdCount', { count: g.osds.length })}
                          {size > 0 && <>{sep}{`${format.number(size / unit.divisor, { maximumFractionDigits: 1 })} ${unit.unit}`}</>}
                        </Typography>
                        {hostFlags.length > 0 && resolvePveNode(g.host, inv.pveNodes) && (
                          <HostNooutChip conn={conn} node={resolvePveNode(g.host, inv.pveNodes) as string} flags={hostFlags} canManage={canManageNode} />
                        )}
                      </Box>
                    </TableCell>
                  </TableRow>,
                  ...g.rows.map(o => {
                    const own = issues.get(o.id) ?? []

                    return (
                      <OsdRow key={o.id} osd={o} node={nodeOf.get(o.id) ?? null} io={io} state={osdDotState(o, ratios, own)} ratios={ratios} selected={o.id === selectedId} issues={own} trend={latency.series[o.id]} session={latency.source === 'session'} onOpen={open} />
                    )
                  }),
                ]
              })}
            </TableBody>
          </Table>
        </Box>

        {view.rowCount > OSD_PAGE_SIZE && (
          <Box data-testid='osd-pager' sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1, px: 1.5, py: 0.75, borderTop: '1px solid', borderColor: 'divider' }}>
            <Typography variant='caption' color='text.secondary' sx={TABULAR}>{t('osd.pager.range', { from, to, total })}</Typography>
            <IconButton size='small' aria-label={t('osd.pager.prev')} disabled={view.page === 0} onClick={() => setPage(view.page - 1)}><i className='ri-arrow-left-s-line' /></IconButton>
            <IconButton size='small' aria-label={t('osd.pager.next')} disabled={view.page >= view.pageCount - 1} onClick={() => setPage(view.page + 1)}><i className='ri-arrow-right-s-line' /></IconButton>
          </Box>
        )}
      </Card>

      {selected && (
        <OsdDrawer
          conn={conn}
          node={resolvePveNode(selected.host, inv.pveNodes)}
          osd={selected}
          inventory={inv}
          ratios={ratios}
          issues={issues.get(selected.id)}
          flags={flagsOnOsd(selected.id, selected.host, osdFlags.osdFlags, osdFlags.hostFlags).map(f => f.flag)}
          canManage={canManage}
          enterprise={enterprise}
          range={url.range}
          hasPrev={at > 0}
          hasNext={at >= 0 && at < navList.length - 1}
          onClose={() => url.set({ item: null })}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          onDone={() => { inventory.reload(); live.refresh() }}
        />
      )}
    </Box>
  )
}
