'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Button, Checkbox, CircularProgress, FormControlLabel, IconButton, InputAdornment, TextField, ToggleButton, Tooltip, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'
import { getGuestLogAfter, getGuestLogPage, type GuestLogPage } from '@/lib/api/firewall'
import { parseFirewallLogLine, type ParsedLogLine } from '@/lib/firewall/logParse'

import GuestIPFilterSection from './GuestIPFilterSection'
import { DirectionGlyph } from './observationParts'
import PanelSection, { PanelFrame } from './PanelSection'
import PolicyPager, { PagedList } from './PolicyPager'
import TruncatedText from './TruncatedText'
import type { MapMember } from './zoneGraph'

/** The lines of a page of the log where the panel's height is not known. */
export const LOG_PAGE_SIZE = 20
/** A page fills the panel's height: one line is this tall, the pager under the lines takes the other height. */
export const LOG_ROW_HEIGHT = 29
const PAGER_HEIGHT = 44
/** The line above the lines: the count of a search or of the filter. */
const CAPTION_HEIGHT = 22
const MIN_ROWS = 5
const MAX_ROWS = 200

/**
 * The lines that fit in `available` pixels, the pager included and the caption above the lines when there is one;
 * LOG_PAGE_SIZE when the height is not known.
 */
export function fitRows(available: number | null, caption = false): number {
  if (available === null || !(available > 0)) return LOG_PAGE_SIZE
  const room = available - PAGER_HEIGHT - (caption ? CAPTION_HEIGHT : 0)
  return Math.min(MAX_ROWS, Math.max(MIN_ROWS, Math.floor(room / LOG_ROW_HEIGHT)))
}

/**
 * The height of the panel's body under `anchor` (put right above the lines), 0 where it is not known. Null until
 * measured, so the first read already asks for the lines that fit; a resize settles 300 ms before it counts, so a drag
 * reads once.
 */
function useRoomBelow() {
  const anchor = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = anchor.current
    const body = el?.closest<HTMLElement>('[data-testid="panel-body"]')
    if (!el || !body) { setRoom(0); return }
    // Under the anchor, down to the body's bottom padding.
    const measure = () => {
      const top = el.getBoundingClientRect().bottom - body.getBoundingClientRect().top + body.scrollTop
      return body.clientHeight - top - Number.parseFloat(getComputedStyle(body).paddingBottom || '0')
    }
    setRoom(measure())
    if (typeof ResizeObserver === 'undefined') return
    let timer: ReturnType<typeof setTimeout> | undefined
    const observer = new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(() => setRoom(measure()), 300) })
    observer.observe(body)
    return () => { observer.disconnect(); clearTimeout(timer) }
  }, [])
  return { anchor, room }
}
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

/** A read of the log: which page (or the search block) of which size and round, and what came back. */
type Read = { page: number; size: number; round: number; data: GuestLogPage | null; error: string | null }

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

const IPV4_RE = /^(\d{1,3})\.\d{1,3}\.\d{1,3}\.(\d{1,3})$/
/** Destination MACs of a frame sent to many: IPv4 multicast, IPv6 multicast, broadcast. */
const MANY_MAC_RE = /^(?:01:00:5e|33:33|ff:ff:ff:ff:ff:ff)/i

/**
 * A line of what the network sends to every guest of the bridge (multicast, broadcast), logged by each of them: VRRP,
 * mDNS, NetBIOS, IPv6 neighbour discovery... A destination in 224.0.0.0/4 or ff00::/8, ending in .255, or a frame sent
 * to a multicast or broadcast MAC. A line PVE wrote in another shape is kept.
 */
export function isNoise(p: ParsedLogLine | null): boolean {
  if (!p) return false
  if (MANY_MAC_RE.test(p.fields.MAC ?? '')) return true
  const dst = p.dst?.toLowerCase() ?? ''
  if (dst.startsWith('ff')) return true
  const v4 = IPV4_RE.exec(dst)
  if (!v4) return false
  const first = Number(v4[1])
  return (first >= 224 && first <= 239) || v4[2] === '255'
}

const keepAll: (l: Line) => boolean = () => true
const keepSignal = (l: Line) => !isNoise(l.parsed)

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
  const current = read !== null && read.page === page && read.size === size && read.round === round ? read : null
  const answered = current?.data != null
  useEffect(() => {
    // Asked again with an answer in hand (the search cleared then typed again): no new read.
    if (!enabled || answered) return
    let cancelled = false
    void getGuestLogPage(conn, guest, page, size, total).then(
      data => { if (!cancelled) setRead({ page, size, round, data, error: null }) },
      (e: unknown) => { if (!cancelled) setRead({ page, size, round, data: null, error: e instanceof Error ? e.message : String(e) }) },
    )
    return () => { cancelled = true }
    // `total` comes with the first page: a later read uses it, it never asks for a read itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, guest.node, guest.type, guest.vmid, page, size, round, enabled, answered])
  return current
}

type LiveState = { from: Read; total: number; lines: Line[]; error: string | null }

/**
 * The live mode: from the first page (`start`), every LIVE_EVERY_MS the lines written since the count held, one read at
 * a time (the next is planned once the last answered), none while the browser tab is hidden, until `until`; then
 * `onExpire`. A count below the one held means the log was rotated: the view starts over from the new file.
 */
function useLiveLog(conn: string, guest: MapMember, start: Read | null, size: number, keep: (l: Line) => boolean, until: number, onExpire: () => void) {
  const [state, setState] = useState<LiveState | null>(null)
  useEffect(() => {
    if (!start?.data) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let after = start.data.total
    const from = start
    let lines = newestFirst(start.data).filter(keep).slice(0, size)
    const plan = () => { timer = setTimeout(() => { void tick() }, LIVE_EVERY_MS) }
    const tick = async () => {
      if (cancelled) return
      if (Date.now() >= until) { onExpire(); return }
      if (document.hidden) { plan(); return }
      try {
        const res = await getGuestLogAfter(conn, guest, after, LIVE_READ)
        if (cancelled) return
        if (res.total < after) {
          after = Math.max(0, res.total - size)
          lines = []
        } else {
          lines = [...newestFirst(res).filter(keep), ...lines].slice(0, size)
          // More lines came than one read brings: the next read starts from the newest ones.
          after = Math.max(after + res.lines.length, res.total - size)
        }
        setState({ from, total: res.total, lines, error: null })
      } catch (e) {
        if (cancelled) return
        setState(prev => ({ from, total: prev?.from === from ? prev.total : after, lines, error: e instanceof Error ? e.message : String(e) }))
      }
      plan()
    }
    plan()
    return () => { cancelled = true; clearTimeout(timer) }
    // A new start (Refresh, live turned on again) starts the loop over; the rest is read when it starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start])
  // The state of an earlier start (the other filter, a Refresh) is not shown.
  return start?.data && state?.from === start ? state : null
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
      <Box role='listitem' data-log-line sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, height: LOG_ROW_HEIGHT, boxSizing: 'border-box', borderBottom: 1, borderColor: 'divider' }}>
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
 * The panel of a guest clicked on the map: its name, VMID and node, its IP filter (the engine's memory, no Proxmox
 * call), then its firewall log, newest lines first, a page
 * of 20 at a time. Each page is read when it is shown, never in the background: the first costs two PVE reads (the
 * count, then its lines), each other one a single read, as the count of the first is handed back. The search reads the
 * 2000 newest lines once, at its first letter, and filters them in the browser while it is typed: no other read.
 * Hiding multicast and broadcast (on by default: the bridge hands them to every guest, so every log is full of the same
 * lines) reads that same block of 2000 lines, in the same two PVE reads as a first page. Refresh starts over from the
 * newest lines.
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
  const [hideNoise, setHideNoise] = useState(true)
  // The search and the filter read the newest block of lines and filter it in the browser; else a page at a time.
  const blockMode = searching || hideNoise
  // The count of the first page, handed back to read the next pages (and the search) in one PVE read each.
  const [total, setTotal] = useState<number | undefined>(undefined)

  const { anchor, room } = useRoomBelow()
  // Rounded to the pixel: a sub-pixel change of the layout must not read the page again.
  const size = fitRows(room === null ? null : Math.floor(room), blockMode)
  const pageRead = useLogRead(conn, guest, page, size, round, page === 0 ? undefined : total, !blockMode && room !== null)
  const searchRead = useLogRead(conn, guest, 0, SEARCH_LINES, round, total, blockMode)
  const head = blockMode ? searchRead : pageRead
  if ((blockMode || page === 0) && head?.data && head.data.total !== total) setTotal(head.data.total)

  const keep = hideNoise ? keepSignal : keepAll
  const block = useMemo(() => newestFirst(searchRead?.data ?? null).filter(keep), [searchRead, keep])
  const found = useMemo(() => matchLines(block, query), [block, query])

  const refresh = useCallback(() => { setPage(0); setTotal(undefined); setRound(r => r + 1) }, [])
  const shown = head
  const loading = shown === null

  // Live: on the first page only, outside the search; it stops by itself after LIVE_FOR_MS.
  const [liveUntil, setLiveUntil] = useState<number | null>(null)
  const [liveExpired, setLiveExpired] = useState(false)
  const live = liveUntil !== null && !searching
  const startLive = () => { setPage(0); setLiveExpired(false); setLiveUntil(Date.now() + LIVE_FOR_MS) }
  const stopLive = useCallback(() => setLiveUntil(null), [])
  const expire = useCallback(() => { setLiveUntil(null); setLiveExpired(true) }, [])
  const liveStart = blockMode ? searchRead : pageRead
  const liveState = useLiveLog(conn, guest, live && (blockMode || page === 0) ? liveStart : null, size, keep, liveUntil ?? 0, expire)
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
      <GuestIPFilterSection connectionId={connectionId} guest={{ connectionId: conn, type: guest.type, vmid: guest.vmid, name: guest.name }} />
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
          sx={{ mb: 0.5 }}
        />
        <Tooltip title={t('hideNoiseTip', { count: format.number(SEARCH_LINES) })} placement='left' disableInteractive describeChild>
          <FormControlLabel
            control={<Checkbox size='small' checked={hideNoise} onChange={e => setHideNoise(e.target.checked)} sx={{ py: 0.25 }} />}
            label={<Typography variant='caption'>{t('hideNoise')}</Typography>}
            sx={{ display: 'flex', mb: 0.5, mr: 0 }}
          />
        </Tooltip>
        <div ref={anchor} />
        {loading && <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}><CircularProgress size={16} /><Typography variant='body2' color='text.secondary'>{t(blockMode ? 'searchReading' : 'reading', { count: format.number(SEARCH_LINES) })}</Typography></Box>}
        {shown !== null && shown.error !== null && <Alert severity='warning' sx={{ py: 0 }}>{t('error', { error: shown.error })}</Alert>}
        {blockMode && searchRead?.data && !(live && liveState) && searchRead.data.lines.length === 0 && <Typography variant='body2' color='text.disabled'>{t('empty')}</Typography>}
        {blockMode && searchRead?.data && !(live && liveState) && searchRead.data.lines.length > 0 && (
          <>
            <Typography variant='caption' color='text.secondary' noWrap sx={{ display: 'block', mb: 0.5 }}>
              {t(searching ? 'searchFound' : 'noiseShown', { count: found.length, scanned: format.number(scanned) })}
            </Typography>
            <PagedList items={found} size={size} render={rows => <LogLines lines={rows} label={t('logTitle')} />} />
          </>
        )}
        {blockMode && live && liveState && (liveState.lines.length === 0 ? <Typography variant='body2' color='text.disabled'>{t('empty')}</Typography> : <LogLines lines={liveState.lines} label={t('logTitle')} />)}
        {liveExpired && !live && (
          <Alert severity='info' sx={{ py: 0, mb: 1 }} action={<Button size='small' onClick={startLive}>{t('liveResume')}</Button>}>{t('liveExpired', { minutes: LIVE_FOR_MS / 60_000 })}</Alert>
        )}
        {live && liveState?.error && <Alert severity='warning' sx={{ py: 0, mb: 1 }}>{t('error', { error: liveState.error })}</Alert>}
        {!blockMode && pageRead?.data && (
          <>
            {pageRead.data.lines.length === 0 && !liveState?.lines.length && <Typography variant='body2' color='text.disabled'>{t('empty')}</Typography>}
            <LogLines lines={live && liveState ? liveState.lines : newestFirst(pageRead.data)} label={t('logTitle')} />
            {/* While live the newest lines come in at the top: the pages would move under the reader. */}
            {!live && total !== undefined && <PolicyPager count={total} page={page} size={size} onPage={setPage} />}
          </>
        )}
      </PanelSection>
    </PanelFrame>
  )
}
