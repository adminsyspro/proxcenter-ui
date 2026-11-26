'use client'

import { useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { Box, CircularProgress, Dialog, DialogContent, DialogTitle, IconButton, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, Typography } from '@mui/material'
import { visuallyHidden } from '@mui/utils'
import { useFormatter, useTranslations } from 'next-intl'

import { useMicrosegEvents, type EventFilters } from '@/lib/microseg/useMicrosegEvents'
import { useMergedClusters } from '@/lib/microseg/useMerged'
import type { MicrosegEvent } from '@/lib/microseg/types'

import { mergeClusterEvents } from '../MicrosegEventsView'
import MicrosegErrorAlert from './MicrosegErrorAlert'
import { DirectionGlyph, ObservedKindGlyph } from './observationParts'
import { PrevNextPager } from './PolicyPager'
import { TrafficClustersContext } from './SelectionTraffic'
import { formatWhen } from './summaryModel'
import TruncatedText from './TruncatedText'
import { rowsThatFit } from './useRowsPerPage'

type TabId = 'traffic' | 'data' | 'logs'
const TABS: TabId[] = ['traffic', 'data', 'logs']
/** The page margin around the dialog (2 x 16 px), and the fixed chrome above the content: title bar, main tabs, content padding. */
const PAGE_MARGIN_PX = 32
const DIALOG_CHROME_PX = 64 + 41 + 40
/** A log row, and what the Logs tab adds around the rows: the table head and the pager. */
const LOG_ROW_PX = 22
const LOG_HEAD_PX = 68
/** A list row of the Data tab (the tallest, a suggestion), and what it adds around the rows: the sub-tabs and the pager. */
const LIST_ROW_PX = 37
const LIST_HEAD_PX = 49 + 56

/** The viewport height, followed as the window resizes: the most the dialog can take. */
function useViewportHeight(): number {
  const [height, setHeight] = useState(() => (typeof window === 'undefined' ? 0 : window.innerHeight))
  useEffect(() => {
    const onResize = () => setHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return height
}

/** The rows of a page when the dialog takes all the height the viewport leaves it. */
export function rowsForViewport(viewport: number, rowPx: number, extraPx: number): number {
  return rowsThatFit(viewport - PAGE_MARGIN_PX - DIALOG_CHROME_PX, rowPx, extraPx)
}
const CELL_SX = { py: 0.5, px: 1, whiteSpace: 'nowrap' } as const

const EVERY_EVENT: EventFilters = { zone: '', verdict: '', q: '' }

/** The whole ring of one cluster, read when the dialog opens (the shape `useMergedClusters` merges). */
function useClusterLog(id: string | null) {
  const read = useMicrosegEvents(id, EVERY_EVENT, true)
  return { data: read, error: read.error, loading: read.loading, reload: read.reload }
}

/**
 * The events of the engine's memory of the dialog's scope (a zone, a pair), newest first, older ones on demand. On a
 * shared policy each cluster logs its own guests: every cluster the panel reads is read and merged, as the Logging tab does.
 */
function ScopeLogs({ connectionId, keep, emptyText, viewport }: { connectionId: string; keep: (e: MicrosegEvent) => boolean; emptyText: string; viewport: number }) {
  const t = useTranslations('microsegPilot.overview.zonePanel')
  const to = useTranslations('microsegPilot.observation')
  const format = useFormatter()
  const group = useContext(TrafficClustersContext)
  const groupKey = (group && group.length > 1 ? [...new Set(group)] : [connectionId]).join('|')
  const ids = useMemo(() => groupKey.split('|'), [groupKey])
  const reads = useMergedClusters(ids, useClusterLog)
  const answered = ids.filter(id => !(id in reads.errors) && reads.byCluster[id])
  const merged = useMemo(
    () => mergeClusterEvents(Object.fromEntries(ids.filter(id => !(id in reads.errors)).map(id => [id, reads.byCluster[id]])), ids),
    [reads, ids],
  )
  const log = {
    events: merged.events,
    more: merged.more,
    // The list fails only when every cluster did; a cluster still reading shows the spinner while nothing is known.
    error: answered.length === 0 ? Object.values(reads.errors)[0] : undefined,
    loading: reads.loading,
    olderBusy: answered.some(id => reads.byCluster[id]?.olderBusy),
    reload: reads.reload,
    loadOlder: () => Promise.all(answered.filter(id => reads.byCluster[id]?.more).map(id => reads.byCluster[id]!.loadOlder())),
  }
  const rows = log.events.filter(keep)
  const known = log.events.length > 0
  const size = rowsForViewport(viewport, LOG_ROW_PX, LOG_HEAD_PX)
  const [page, setPage] = useState(0)
  const last = Math.max(0, Math.ceil(rows.length / size) - 1)
  const current = Math.min(page, last)
  const shown = rows.slice(current * size, (current + 1) * size)
  const hasNext = current < last || log.more
  async function next() {
    if (current >= last && log.more) await log.loadOlder()
    setPage(current + 1)
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      {log.error != null && !known && <MicrosegErrorAlert error={log.error} onRetry={log.reload} />}
      {log.loading && !known && log.error == null && <CircularProgress size={18} />}
      {!log.loading && log.error == null && rows.length === 0 && <Typography variant='body2' color='text.disabled'>{emptyText}</Typography>}
      {rows.length > 0 && (
        <Table size='small' stickyHeader aria-label={t('tabLogs')}>
          <TableHead>
            <TableRow>
              <TableCell sx={CELL_SX}>{to('dialog.colTime')}</TableCell>
              <TableCell sx={CELL_SX}>{t('colDirection')}</TableCell>
              <TableCell sx={CELL_SX}>{t('colVerdict')}</TableCell>
              <TableCell sx={CELL_SX}>{to('dialog.colSource')}</TableCell>
              <TableCell sx={CELL_SX}>{to('dialog.colDestination')}</TableCell>
              <TableCell sx={CELL_SX}>{to('columns.service')}</TableCell>
              <TableCell sx={CELL_SX}>{to('dialog.colNode')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {shown.map(e => (
              <TableRow key={`${e.connection_id}-${e.seq}`} hover data-event={e.seq}>
                <TableCell sx={CELL_SX}>{formatWhen(format, e.ts)}</TableCell>
                <TableCell sx={CELL_SX}>
                  <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}><DirectionGlyph direction={e.direction} />{to(e.direction === 'out' ? 'direction.out' : 'direction.in')}</Box>
                </TableCell>
                <TableCell sx={CELL_SX}>
                  <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}><ObservedKindGlyph kind={e.verdict} />{to(`kind.${e.verdict}`)}</Box>
                </TableCell>
                <TableCell sx={{ ...CELL_SX, maxWidth: 220 }}><TruncatedText text={e.src_ip || e.src_zone || '-'} variant='body2' /></TableCell>
                <TableCell sx={{ ...CELL_SX, maxWidth: 220 }}><TruncatedText text={e.dst_ip || e.guest || '-'} variant='body2' /></TableCell>
                <TableCell sx={CELL_SX}>{`${e.proto}/${e.dport}`}</TableCell>
                <TableCell sx={CELL_SX}>{e.node}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {(rows.length > size || log.more) && (
        <Box data-testid='logs-pager' sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5, mt: 1 }}>
          {log.olderBusy && <CircularProgress size={14} />}
          <PrevNextPager page={current} hasNext={hasNext && !log.olderBusy} onPage={p => { if (p > current) { void next() } else setPage(p) }} />
        </Box>
      )}
    </Box>
  )
}

/** A sub-tab label with its count (none while the count is unknown). */
export const withCount = (label: string, count: number | null) => (count === null ? label : `${label} (${count})`)

/** One sub-tab of the Data tab: its label (count included), the add button above its content, the content. */
export type DataTab = { id: string; label: string; action?: ReactNode; content: (size: number) => ReactNode }

function DataTabs({ tabs, viewport }: { tabs: DataTab[]; viewport: number }) {
  const t = useTranslations('microsegPilot.overview.zonePanel')
  const [id, setId] = useState(tabs[0]?.id ?? '')
  const current = tabs.find(x => x.id === id) ?? tabs[0]
  if (!current) return null
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, borderBottom: 1, borderColor: 'divider', mb: 1.5 }}>
        <Tabs value={current.id} onChange={(_e, v: string) => setId(v)} variant='scrollable' scrollButtons={false} aria-label={t('tabData')} sx={{ flex: 1, minWidth: 0, minHeight: 36 }}>
          {tabs.map(x => <Tab key={x.id} value={x.id} label={x.label} sx={{ minHeight: 36, py: 0.5, textTransform: 'none' }} />)}
        </Tabs>
        {current.action}
      </Box>
      <Box role='tabpanel' data-subtab={current.id}>{current.content(rowsForViewport(viewport, LIST_ROW_PX, LIST_HEAD_PX))}</Box>
    </Box>
  )
}

/** What the dialog is about: its name, its heading (an icon before the title, the title, a line after it) and its events. */
export type ExpandScope = {
  /** The accessible name of the dialog. */
  label: string
  lead?: ReactNode
  title: string
  subtitle?: ReactNode
  /** The state chips, after the subtitle. */
  chips: ReactNode
  /** The events of the scope in the Logs tab, and what the tab says without any. */
  keepEvent: (e: MicrosegEvent) => boolean
  logsEmpty: string
}

/**
 * A map panel (a zone, a pair of zones) in a centred dialog, with room: its traffic (chart, summary), its data (one
 * sub-tab per list) and the log of its events, one tab each. The panel's own sections are passed in: same content,
 * same state. The dialog follows its content up to the page height, the lists paged from the rows that fit.
 */
export default function ExpandDialog({ scope, connectionId, traffic, dataTabs, onClose }: {
  scope: ExpandScope
  connectionId: string
  traffic: ReactNode
  dataTabs: DataTab[]
  onClose: () => void
}) {
  const t = useTranslations('microsegPilot.overview.zonePanel')
  const tc = useTranslations('microsegPilot.overview.panel')
  const [tab, setTab] = useState<TabId>('traffic')
  const viewport = useViewportHeight()
  const labelId = useId()
  return (
    <Dialog open onClose={onClose} maxWidth='lg' fullWidth aria-labelledby={labelId} slotProps={{ paper: { sx: { maxHeight: 'calc(100vh - 32px)', minHeight: '50vh', m: 2 } } }}>
      <DialogTitle component='div' id={`${labelId}-bar`} sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <Box component='span' id={labelId} sx={visuallyHidden}>{scope.label}</Box>
        {scope.lead}
        <Typography component='h2' variant='h6' sx={{ flexShrink: 0 }}>{scope.title}</Typography>
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>{scope.subtitle}</Box>
        {scope.chips}
        <IconButton size='small' aria-label={tc('close')} onClick={onClose}><i className='ri-close-line' /></IconButton>
      </DialogTitle>
      <Tabs value={tab} onChange={(_e, v: TabId) => setTab(v)} sx={{ px: 3, borderBottom: 1, borderColor: 'divider', minHeight: 40 }}>
        {TABS.map(id => (
          <Tab key={id} value={id} label={t(id === 'traffic' ? 'tabTraffic' : id === 'data' ? 'tabData' : 'tabLogs')} sx={{ minHeight: 40 }} />
        ))}
      </Tabs>
      <DialogContent sx={{ pt: 2 }}>
        {tab === 'traffic' && traffic}
        {tab === 'data' && <DataTabs tabs={dataTabs} viewport={viewport} />}
        {tab === 'logs' && <ScopeLogs connectionId={connectionId} keep={scope.keepEvent} emptyText={scope.logsEmpty} viewport={viewport} />}
      </DialogContent>
    </Dialog>
  )
}
