'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, CircularProgress, IconButton, InputAdornment, TextField, ToggleButton, Tooltip, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'
import { getGuestLogAfter, getGuestLogPage, type GuestLogPage } from '@/lib/api/firewall'
import { parseFirewallLogLine, type ParsedLogLine } from '@/lib/firewall/logParse'

import { DirectionGlyph } from './observationParts'
import PanelSection, { PanelFrame } from './PanelSection'
import PolicyPager, { PagedList } from './PolicyPager'
import TruncatedText from './TruncatedText'
import type { MapMember } from './zoneGraph'

/** The lines of a page of the log. */
export const LOG_PAGE_SIZE = 20
/** The newest lines the search reads, once, then filters in the browser. */
export const SEARCH_LINES = 2000

/** The live mode: a read every 5 s (one PVE read: the lines written since the count held), for 10 minutes at most. */
export const LIVE_EVERY_MS = 5000
export const LIVE_FOR_MS = 10 * 60_000
/** The most lines one live read brings; past it the next read jumps to the newest ones. */
const LIVE_READ = 200

const ACTION_COLOUR: Record<string, string> = { ACCEPT: 'success.main', DROP: 'error.main', REJECT: 'error.main' }

type Props = {
  guest: MapMember
  /** The connection of the policy: a guest of a shared policy is read through its own cluster. */
  connectionId: string
  onClose: () => void
}

/** A read of the log: which page (or the search block) of which round, and what came back. */
type Read = { page: number; round: number; data: GuestLogPage | null; error: string | null }

type Line = { key: number; parsed: ParsedLogLine | null; raw: string }

/** The lines of a page, newest first, each parsed (a line PVE wrote in another shape keeps its raw text). */
export function newestFirst(page: GuestLogPage | null): Line[] {
  return [...(page?.lines ?? [])].reverse().map(l => ({ key: l.n, parsed: parseFirewallLogLine(l.t), raw: l.t }))
}

/** "source → destination:port proto" of a line, what is known of it. */
export function lineSummary(p: ParsedLogLine): string {
  const dst = p.dst ? `${p.dst}${p.dport === undefined ? '' : `:${p.dport}`}` : ''
  return [p.src && dst ? `${p.src} → ${dst}` : p.src || dst, p.proto?.toLowerCase()].filter(Boolean).join(' ')
}

/** The lines holding every word of the search (any case), in the raw line PVE wrote. */
export function matchLines(lines: Line[], query: string): Line[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return lines
  return lines.filter(l => {
    const raw = l.raw.toLowerCase()
    return words.every(w => raw.includes(w))
  })
}

/** Reads one page of the guest's log for a round, and keeps the last answer (null until the first comes). */
function useLogRead(conn: string, guest: MapMember, page: number, size: number, round: number, total: number | undefined, enabled: boolean) {
  const [read, setRead] = useState<Read | null>(null)
  // The answer of the read asked for, null while it is under way.
  const current = read !== null && read.page === page && read.round === round ? read : null
  const answered = current?.data != null
  useEffect(() => {
    // Asked again with an answer in hand (the search cleared then typed again): no new read.
    if (!enabled || answered) return
    let cancelled = false
    void getGuestLogPage(conn, guest, page, size, total).then(
      data => { if (!cancelled) setRead({ page, round, data, error: null }) },
      (e: unknown) => { if (!cancelled) setRead({ page, round, data: null, error: e instanceof Error ? e.message : String(e) }) },
    )
    return () => { cancelled = true }
    // `total` comes with the first page: a later read uses it, it never asks for a read itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, guest.node, guest.type, guest.vmid, page, size, round, enabled, answered])
  return current
}

type LiveState = { total: number; lines: Line[]; error: string | null }

/**
 * The live mode: from the first page (`start`), every LIVE_EVERY_MS the lines written since the count held, one read at
 * a time (the next is planned once the last answered), none while the browser tab is hidden, until `until`; then
 * `onExpire`. A count below the one held means the log was rotated: the view starts over from the new file.
 */
function useLiveLog(conn: string, guest: MapMember, start: Read | null, until: number, onExpire: () => void) {
  const [state, setState] = useState<LiveState | null>(null)
  useEffect(() => {
    if (!start?.data) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let after = start.data.total
    let lines = newestFirst(start.data)
    const plan = () => { timer = setTimeout(() => { void tick() }, LIVE_EVERY_MS) }
    const tick = async () => {
      if (cancelled) return
      if (Date.now() >= until) { onExpire(); return }
      if (document.hidden) { plan(); return }
      try {
        const res = await getGuestLogAfter(conn, guest, after, LIVE_READ)
        if (cancelled) return
        if (res.total < after) {
          after = Math.max(0, res.total - LOG_PAGE_SIZE)
          lines = []
        } else {
          lines = [...newestFirst(res), ...lines].slice(0, LOG_PAGE_SIZE)
          // More lines came than one read brings: the next read starts from the newest ones.
          after = Math.max(after + res.lines.length, res.total - LOG_PAGE_SIZE)
        }
        setState({ total: res.total, lines, error: null })
      } catch (e) {
        if (cancelled) return
        setState(prev => ({ total: prev?.total ?? after, lines, error: e instanceof Error ? e.message : String(e) }))
      }
      plan()
    }
    plan()
    return () => { cancelled = true; clearTimeout(timer) }
    // A new start (Refresh, live turned on again) starts the loop over; the rest is read when it starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start])
  return start?.data ? state : null
}

function LogLine({ line }: { line: Line }) {
  const t = useTranslations('microsegPilot.overview.guestPanel')
  const format = useFormatter()
  const { parsed, raw } = line
  const actionText = (p: ParsedLogLine) => {
    if (!p.action) return t('noAction')
    return p.policy ? t('policyAction', { action: p.action }) : p.action
  }
  return (
    <Tooltip title={raw} disableInteractive placement='left'>
      <Box role='listitem' data-log-line sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, py: 0.5, borderBottom: 1, borderColor: 'divider' }}>
        {parsed ? (
          <>
            <Typography variant='caption' color='text.secondary' noWrap sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
              {format.dateTime(new Date(parsed.ts), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </Typography>
            <DirectionGlyph direction={parsed.direction} />
            <Typography variant='caption' fontWeight={600} noWrap sx={{ flexShrink: 0, color: ACTION_COLOUR[parsed.action ?? ''] ?? 'text.secondary' }}>{actionText(parsed)}</Typography>
            <TruncatedText text={lineSummary(parsed)} variant='caption' sx={{ flex: '1 1 0', minWidth: 0 }} />
          </>
        ) : (
          <TruncatedText text={raw} variant='caption' color='text.secondary' sx={{ flex: '1 1 0', minWidth: 0 }} />
        )}
      </Box>
    </Tooltip>
  )
}

function LogLines({ lines, label }: { lines: Line[]; label: string }) {
  return <Box role='list' aria-label={label}>{lines.map(line => <LogLine key={line.key} line={line} />)}</Box>
}

/**
 * The panel of a guest clicked on the map: its name, VMID and node, then its firewall log, newest lines first, a page
 * of 20 at a time. Each page is read when it is shown, never in the background: the first costs two PVE reads (the
 * count, then its lines), each other one a single read, as the count of the first is handed back. The search reads the
 * 2000 newest lines once, at its first letter, and filters them in the browser while it is typed: no other read.
 * Refresh starts over from the newest lines.
 */
export default function GuestPanel({ guest, connectionId, onClose }: Readonly<Props>) {
  const t = useTranslations('microsegPilot.overview.guestPanel')
  const tp = useTranslations('microsegPilot.overview')
  const format = useFormatter()
  const conn = guest.cluster?.id ?? connectionId
  const [page, setPage] = useState(0)
  const [round, setRound] = useState(0)
  const [query, setQuery] = useState('')
  const searching = query.trim() !== ''
  // The count of the first page, handed back to read the next pages (and the search) in one PVE read each.
  const [total, setTotal] = useState<number | undefined>(undefined)

  const pageRead = useLogRead(conn, guest, page, LOG_PAGE_SIZE, round, page === 0 ? undefined : total, !searching)
  const searchRead = useLogRead(conn, guest, 0, SEARCH_LINES, round, total, searching)
  if (page === 0 && pageRead?.data && pageRead.data.total !== total) setTotal(pageRead.data.total)

  const block = useMemo(() => newestFirst(searchRead?.data ?? null), [searchRead])
  const found = useMemo(() => matchLines(block, query), [block, query])

  const refresh = useCallback(() => { setPage(0); setTotal(undefined); setRound(r => r + 1) }, [])
  const shown = searching ? searchRead : pageRead
  const loading = shown === null

  // Live: on the first page only, outside the search; it stops by itself after LIVE_FOR_MS.
  const [liveUntil, setLiveUntil] = useState<number | null>(null)
  const [liveExpired, setLiveExpired] = useState(false)
  const live = liveUntil !== null && !searching
  const startLive = () => { setPage(0); setLiveExpired(false); setLiveUntil(Date.now() + LIVE_FOR_MS) }
  const stopLive = useCallback(() => setLiveUntil(null), [])
  const expire = useCallback(() => { setLiveUntil(null); setLiveExpired(true) }, [])
  const liveState = useLiveLog(conn, guest, live && page === 0 ? pageRead : null, liveUntil ?? 0, expire)
  const liveButton = (
    <Tooltip title={live ? t('liveStop') : t('liveStart', { seconds: LIVE_EVERY_MS / 1000, minutes: LIVE_FOR_MS / 60_000 })}>
      <span>
        <ToggleButton
          size='small'
          value='live'
          selected={live}
          disabled={searching}
          aria-label={live ? t('liveStop') : t('live')}
          onChange={() => (live ? stopLive() : startLive())}
          sx={{ py: 0, px: 0.75, gap: 0.5, textTransform: 'none', fontSize: 12 }}
        >
          <Box component='span' aria-hidden sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: live ? 'success.main' : 'text.disabled', ...(live ? { animation: 'microseg-live 1.6s ease-in-out infinite', '@keyframes microseg-live': { '50%': { opacity: 0.3 } } } : {}) }} />
          {t('live')}
        </ToggleButton>
      </span>
    </Tooltip>
  )

  const header = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      <StatusIcon type='vm' vmType={guest.type} status={guest.status} size={16} />
      <TruncatedText text={guest.name} fontWeight={600} sx={{ minWidth: 0 }} />
      <Typography variant='caption' color='text.secondary' noWrap sx={{ flex: '1 1 0', minWidth: 0 }}>
        {[guest.vmid, guest.node, guest.cluster?.name].filter(Boolean).join(' · ')}
      </Typography>
      <IconButton size='small' aria-label={tp('panel.close')} onClick={onClose}><i className='ri-close-line' /></IconButton>
    </Box>
  )
  const refreshButton = (
    <Tooltip title={t('refresh')}>
      <span>
        <IconButton size='small' aria-label={t('refresh')} onClick={refresh} disabled={loading}><i className='ri-refresh-line' /></IconButton>
      </span>
    </Tooltip>
  )
  const scanned = searchRead?.data?.lines.length ?? 0

  return (
    <PanelFrame label={t('label', { name: guest.name })} width={400} header={header}>
      <PanelSection id='guest.log' title={t('logTitle')} count={liveState?.total ?? total} action={<Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>{liveButton}{refreshButton}</Box>}>
        <TextField
          size='small'
          fullWidth
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('search')}
          slotProps={{
            htmlInput: { 'aria-label': t('search') },
            input: { startAdornment: <InputAdornment position='start'><i className='ri-search-line' aria-hidden /></InputAdornment> },
          }}
          sx={{ mb: 1 }}
        />
        {loading && <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}><CircularProgress size={16} /><Typography variant='body2' color='text.secondary'>{t(searching ? 'searchReading' : 'reading', { count: format.number(SEARCH_LINES) })}</Typography></Box>}
        {shown !== null && shown.error !== null && <Alert severity='warning' sx={{ py: 0 }}>{t('error', { error: shown.error })}</Alert>}
        {searching && searchRead?.data && (
          <>
            <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mb: 0.5 }}>
              {t('searchFound', { count: found.length, scanned: format.number(scanned) })}
            </Typography>
            <PagedList items={found} size={LOG_PAGE_SIZE} render={rows => <LogLines lines={rows} label={t('logTitle')} />} />
          </>
        )}
        {liveExpired && !live && (
          <Alert severity='info' sx={{ py: 0, mb: 1 }} action={<Button size='small' onClick={startLive}>{t('liveResume')}</Button>}>{t('liveExpired', { minutes: LIVE_FOR_MS / 60_000 })}</Alert>
        )}
        {live && liveState?.error && <Alert severity='warning' sx={{ py: 0, mb: 1 }}>{t('error', { error: liveState.error })}</Alert>}
        {!searching && pageRead?.data && (
          <>
            {pageRead.data.lines.length === 0 && !liveState?.lines.length && <Typography variant='body2' color='text.disabled'>{t('empty')}</Typography>}
            <LogLines lines={live && liveState ? liveState.lines : newestFirst(pageRead.data)} label={t('logTitle')} />
            {/* While live the newest lines come in at the top: the pages would move under the reader. */}
            {!live && total !== undefined && <PolicyPager count={total} page={page} size={LOG_PAGE_SIZE} onPage={setPage} />}
          </>
        )}
      </PanelSection>
    </PanelFrame>
  )
}
