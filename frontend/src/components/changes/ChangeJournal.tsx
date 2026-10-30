'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { useLocale, useTranslations } from 'next-intl'

import {
  Box,
  Card,
  Chip,
  Collapse,
  IconButton,
  InputAdornment,
  MenuItem,
  TablePagination,
  TextField,
  Typography
} from '@mui/material'
import { useTheme } from '@mui/material/styles'

import { GuestGlyph, NodeGlyph } from '@/components/automation/drs/glyphs'
import ActivityTimeline from '@/components/changes/ActivityTimeline'
import { AuthorCell, AuthorEvidence } from '@/components/changes/AuthorCell'
import ChangeDetails, { FieldDiff } from '@/components/changes/ChangeDetails'
import { attributionOf } from '@/lib/changes/attribution'
import { INFRA_ICONS, INFRA_TYPES, infraSummary } from '@/lib/changes/infra'
import { fieldKey, withKeys } from '@/lib/changes/keys'
import { FactSummary } from '@/components/changes/FactLine'
import { PAGE_SIZES, STICKY_PAGER_SX } from '@/components/ui/PagedRows'
import { netFields } from '@/lib/changes/describe'
import {
  FAMILIES,
  FAMILY_COLORS,
  FAMILY_LABELS,
  LIFECYCLE,
  RESOURCE_LABELS,
  actionMeta,
  backupSummary,
  bucketize,
  filterJournal,
  formatDuration,
  groupBursts,
  journalUsers,
  periodStart,
  startOfDay
} from '@/lib/changes/journal'
import type { BackupState, Bucket, Family, JournalChange, JournalEntry, Period } from '@/lib/changes/journal'
import { pageOf } from '@/lib/paging'

// A small Select is 2 px taller than a small text field; this keeps the
// filter bar on one baseline.
const SMALL_SELECT_SX = { '& .MuiInputBase-input.MuiSelect-select': { minHeight: '1.4375em', lineHeight: '1.4375em' } }

const BACKUP_STATE_COLORS: Record<BackupState, 'success' | 'error' | 'info' | 'default'> = {
  ok: 'success',
  failed: 'error',
  running: 'info',
  unknown: 'default'
}

type FilterKind = 'family' | 'resourceType' | 'user'

interface ChangeJournalProps {
  changes: JournalChange[]
  /** Current guest statuses keyed `${connectionId}:${vmid}`, for the status dots */
  guestStatus?: Record<string, string>
  /** False inside a single guest's tab, where every row is that guest */
  showResource?: boolean
  filters?: FilterKind[]
  /** Icon actions pinned right of the filters, given the rows the filters keep */
  toolbar?: (filtered: JournalChange[]) => ReactNode
  /** Grow to the bottom of the page, the rows scrolling inside */
  fill?: boolean
  /** The activity chart and its period above the rows */
  timeline?: boolean
}

const DAY = 24 * 3600 * 1000

const clock = (ts: string, locale: string) => new Date(ts).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })

/** One line per change: action, resource, what changed, author, where, when. */
export default function ChangeJournal({
  changes,
  guestStatus = {},
  showResource = true,
  filters = ['family', 'resourceType', 'user'],
  toolbar,
  fill = false,
  timeline = false
}: Readonly<ChangeJournalProps>) {
  const t = useTranslations()
  const locale = useLocale()
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  const dotBorder = theme.palette.background.paper

  const [search, setSearch] = useState('')
  const [family, setFamily] = useState<Family | ''>('')
  const [resourceType, setResourceType] = useState('')
  const [user, setUser] = useState('')
  const [page, setPage] = useState(0)
  const [perPage, setPerPage] = useState(PAGE_SIZES[0])
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  const [rawOpen, setRawOpen] = useState<Record<number, boolean>>({})
  const [period, setPeriod] = useState<Period>(timeline ? '30d' : 'all')
  const [slot, setSlot] = useState<Bucket | null>(null)

  // A filter change always goes back to the first page
  const onFilter = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setPage(0)
  }

  const filterSearch = onFilter(setSearch)
  const filterFamily = onFilter(setFamily)
  const filterResourceType = onFilter(setResourceType)
  const filterUser = onFilter(setUser)
  const filterSlot = onFilter(setSlot)
  const filterPeriod = onFilter((p: Period) => {
    setPeriod(p)
    setSlot(null)
  })

  const users = useMemo(() => journalUsers(changes), [changes])
  const resourceTypes = useMemo(() => [...new Set(changes.map(c => c.resourceType).filter(Boolean))] as string[], [changes])

  // The clock the period and the day headers hang on, a minute at a time
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)

    return () => clearInterval(id)
  }, [])

  // The chart counts what the other filters keep over the whole period; the
  // rows narrow further to the slot picked on the chart.
  const base = useMemo(
    () => filterJournal(changes, { search, family, resourceType, user, from: periodStart(period, now) }),
    [changes, search, family, resourceType, user, period, now]
  )

  const buckets = useMemo(() => (timeline ? bucketize(base, period, now) : []), [timeline, base, period, now])

  const filtered = useMemo(
    () => (slot ? filterJournal(base, { from: slot.from, to: slot.to }) : base),
    [base, slot]
  )

  const entries = useMemo(() => groupBursts(filtered), [filtered])

  const { rows, page: current } = pageOf(entries, page, perPage)

  // Entries per day over all pages, for the day headers
  const perDay = useMemo(() => {
    const counts = new Map<number, number>()

    for (const e of entries) {
      const day = startOfDay(new Date(e.latest.timestamp).getTime())

      counts.set(day, (counts.get(day) || 0) + 1)
    }

    return counts
  }, [entries])

  const dayLabel = (day: number) => {
    const today = startOfDay(now)

    if (day === today) return t('changes.today')
    if (day === today - DAY) return t('changes.yesterday')

    const text = new Date(day).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })

    return text.charAt(0).toUpperCase() + text.slice(1)
  }

  const units = { h: t('drsPage.historyUnitHours'), min: t('drsPage.historyUnitMinutes'), s: t('drsPage.historyUnitSeconds') }

  const columns = showResource
    ? '190px minmax(150px, 240px) minmax(0, 1fr) minmax(90px, 150px) minmax(120px, 200px) 110px 24px'
    : '190px minmax(0, 1fr) minmax(90px, 150px) minmax(120px, 200px) 110px 24px'

  const headers = [
    t('changes.colAction'),
    ...(showResource ? [t('changes.colResource')] : []),
    t('changes.colDetail'),
    t('changes.colAuthor'),
    t('changes.colLocation'),
    t('changes.colDate'),
    ''
  ]

  const infraWords = {
    pending: t('changes.infraPending'),
    disabled: t('changes.infraDisabled'),
    from: (host: string) => t('changes.infraFrom', { host }),
    times: (count: number) => t('changes.infraTimes', { count })
  }

  const resourceCell = (c: JournalChange) => {
    if (INFRA_TYPES.has(c.resourceType || '')) {
      const name = String(c.resourceName || c.resourceId || '')

      return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          <i className={INFRA_ICONS[c.resourceType || '']} style={{ fontSize: 16, opacity: 0.7, flexShrink: 0 }} />
          <Typography title={name} sx={{ fontWeight: 600, fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {name}
          </Typography>
        </Box>
      )
    }

    const name = c.resourceName || `${RESOURCE_LABELS[c.resourceType || ''] || c.resourceType} ${c.resourceId}`
    const glyph = c.resourceType === 'node'
      ? <NodeGlyph dark={dark} dotBorder={dotBorder} />
      : <GuestGlyph type={c.resourceType === 'ct' ? 'lxc' : 'qemu'} status={guestStatus[`${c.connectionId}:${c.resourceId}`]} dotBorder={dotBorder} />

    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
        {glyph}
        <Typography title={name} sx={{ fontWeight: 600, fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {name}
        </Typography>
        {c.resourceName && c.resourceType !== 'node' && (
          <Typography variant='caption' sx={{ opacity: 0.5, flexShrink: 0 }}>({c.resourceId})</Typography>
        )}
      </Box>
    )
  }

  const detailCell = (c: JournalChange) => {
    if (c.action === 'backup') {
      const b = backupSummary(c)

      return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <Chip
            size='small'
            variant='outlined'
            color={BACKUP_STATE_COLORS[b.state]}
            label={b.state === 'failed' && b.status ? b.status : t(`changes.backupState.${b.state}`)}
            sx={{ height: 20, fontSize: '0.7rem', flexShrink: 0, maxWidth: 160 }}
          />
          {b.start && (
            <Typography variant='caption' sx={{ opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {b.start.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
              {b.end && ` → ${b.end.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`}
              {b.durationSec !== undefined && ` · ${formatDuration(b.durationSec, units)}`}
            </Typography>
          )}
        </Box>
      )
    }

    if (INFRA_TYPES.has(c.resourceType || '')) {
      const text = infraSummary(c.action, c.fields, infraWords)

      return (
        <Typography variant='caption' title={text} sx={{ opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {text}
        </Typography>
      )
    }

    return <FactSummary fields={c.fields} side={sideOf(c)} empty={t('changes.noVisibleDiff')} />
  }

  // A created guest's row holds its config as it came, a deleted one's as it was
  const sideOf = (c: JournalChange): 'diff' | 'before' | 'after' => {
    if (c.action === 'created') return 'after'
    if (c.action === 'deleted') return 'before'

    return 'diff'
  }

  const backupDetails = (c: JournalChange) => {
    const b = backupSummary(c)
    const raw = c.fields || []
    const at = (d?: Date) => (d ? d.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'medium' }) : '')
    // A row recorded before the task times were kept has none: only what is
    // known is listed
    const facts = ([
      [t('changes.backupTask'), c.taskUpid || ''],
      [t('changes.backupStart'), at(b.start)],
      [t('changes.backupEnd'), at(b.end)],
      [t('changes.backupDuration'), b.durationSec !== undefined ? formatDuration(b.durationSec, units) : ''],
      [t('changes.backupStatus'), b.status || '']
    ] as [string, string][]).filter(([, value]) => value)

    return (
      <>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', columnGap: 2, rowGap: 0.5, mb: raw.length ? 1.5 : 0 }}>
          {facts.map(([label, value]) => (
            <Fragment key={label}>
              <Typography variant='caption' sx={{ opacity: 0.6 }}>{label}</Typography>
              <Typography variant='caption' sx={{ wordBreak: 'break-all' }}>{value}</Typography>
            </Fragment>
          ))}
        </Box>
        {raw.length > 0 && (
          <>
            <Box
              role='button'
              tabIndex={0}
              onClick={() => setRawOpen(prev => ({ ...prev, [c.id]: !prev[c.id] }))}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setRawOpen(prev => ({ ...prev, [c.id]: !prev[c.id] })) }}
              sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', userSelect: 'none' }}
            >
              <i className={rawOpen[c.id] ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} style={{ fontSize: 16 }} />
              <Typography variant='caption' sx={{ fontWeight: 600 }}>{t('changes.rawEvents', { count: raw.length })}</Typography>
            </Box>
            <Collapse in={!!rawOpen[c.id]}>
              <Box sx={{ pl: 2.5, pt: 0.5 }}>
                {withKeys(raw, fieldKey).map(({ key, item }) => <FieldDiff key={key} field={item} />)}
              </Box>
            </Collapse>
          </>
        )}
      </>
    )
  }

  const hasDetails = (c: JournalChange) =>
    c.action === 'backup' || (c.fields?.length || 0) > 0 || attributionOf([c]) !== undefined

  const actionIcon = (action: string | undefined, size = 24) => {
    const meta = actionMeta(action)
    // A creation or a deletion stands out of its family: green or red
    const familyHue = FAMILY_COLORS[meta.family][dark ? 'dark' : 'light']
    const hue = LIFECYCLE.has(action || '') ? theme.palette[meta.color].main : familyHue

    return (
      <Box
        sx={{
          width: size,
          height: size,
          borderRadius: '50%',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: hue,
          bgcolor: `color-mix(in srgb, ${hue} 16%, transparent)`
        }}
      >
        <i className={meta.icon} style={{ fontSize: size * 0.58 }} />
      </Box>
    )
  }

  const locationCell = (c: JournalChange) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
      <i className='ri-server-line' style={{ fontSize: '0.9286rem', opacity: 0.6, flexShrink: 0 }} />
      <Typography variant='caption' sx={{ opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {c.connectionName || c.connectionId}
        {c.node && ` · ${c.node}`}
      </Typography>
    </Box>
  )

  const chevron = (open: boolean, toggle: () => void) => (
    <IconButton
      size='small'
      aria-label={t(open ? 'changes.collapse' : 'changes.expand')}
      aria-expanded={open}
      sx={{ p: 0.25 }}
      onClick={e => { e.stopPropagation(); toggle() }}
    >
      <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} style={{ fontSize: 18 }} />
    </IconButton>
  )

  const rowSx = (clickable: boolean) => ({
    display: 'grid',
    gridTemplateColumns: columns,
    columnGap: 2,
    alignItems: 'center',
    py: 1,
    px: 2,
    whiteSpace: 'nowrap',
    cursor: clickable ? 'pointer' : 'default',
    '&:hover': clickable ? { bgcolor: 'action.hover' } : {}
  })

  const sectionTitle = (icon: string, text: string) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
      <i className={icon} style={{ fontSize: 15, opacity: 0.7 }} />
      <Typography variant='caption' sx={{ fontWeight: 700 }}>{text}</Typography>
    </Box>
  )

  // A burst's details: its net effect, then each change of it, newest first,
  // its own table a click away
  const burstDetails = (e: JournalEntry, net: JournalChange['fields']) => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box>
        {sectionTitle('ri-contrast-2-line', t('changes.netEffect'))}
        {net && net.length > 0
          ? <ChangeDetails fields={net} showRaw={false} />
          : <Typography variant='caption' sx={{ opacity: 0.6, fontStyle: 'italic' }}>{t('changes.burstNoNet')}</Typography>}
      </Box>
      <Box>
        {sectionTitle('ri-history-line', t('changes.history', { count: e.changes.length }))}
        {burstHistory(e)}
      </Box>
    </Box>
  )

  const burstHistory = (e: JournalEntry) => (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      {e.changes.map(c => {
        const open = !!rawOpen[c.id]
        const toggle = () => setRawOpen(prev => ({ ...prev, [c.id]: !prev[c.id] }))

        return (
          <Box key={c.id}>
            <Box
              role='button'
              tabIndex={0}
              onClick={toggle}
              onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') toggle() }}
              sx={{
                display: 'grid',
                gridTemplateColumns: '48px 20px minmax(110px, 160px) minmax(0, 1fr) minmax(80px, 140px) 18px',
                columnGap: 1.5,
                alignItems: 'center',
                py: 0.5,
                px: 0.5,
                borderRadius: 0.5,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                '&:hover': { bgcolor: 'action.selected' }
              }}
            >
              <Typography variant='caption' sx={{ opacity: 0.7 }}>{clock(c.timestamp, locale)}</Typography>
              {actionIcon(c.action, 20)}
              <Typography variant='caption' sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t(actionMeta(c.action).label)}</Typography>
              <FactSummary fields={c.fields} side={sideOf(c)} empty={t('changes.noVisibleDiff')} />
              <AuthorCell changes={[c]} />
              <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} style={{ fontSize: 16, opacity: 0.6 }} />
            </Box>
            <Collapse in={open} unmountOnExit>
              <Box sx={{ pl: 9, pr: 1, pt: 0.5, pb: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <ChangeDetails fields={c.fields} side={sideOf(c)} />
                <AuthorEvidence change={c} />
              </Box>
            </Collapse>
          </Box>
        )
      })}
    </Box>
  )

  // A burst of failed logins reads as who was tried, from where, how often
  const loginDetails = (c: JournalChange) => {
    const v = Object.fromEntries((c.fields || []).map(f => [f.field, f.newValue || '']))
    const at = (iso?: string) => (iso ? new Date(iso).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'medium' }) : '')
    const facts = ([
      [t('changes.loginAccount'), v.user],
      [t('changes.loginAddress'), v.rhost],
      [t('changes.loginAttempts'), v.count],
      [t('changes.loginFirst'), at(v.first)],
      [t('changes.loginLast'), at(v.last)]
    ] as [string, string | undefined][]).filter((pair): pair is [string, string] => !!pair[1])

    return (
      <Box sx={{ display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', columnGap: 2, rowGap: 0.5 }}>
        {facts.map(([label, value]) => (
          <Fragment key={label}>
            <Typography variant='caption' sx={{ opacity: 0.6 }}>{label}</Typography>
            <Typography variant='caption'>{value}</Typography>
          </Fragment>
        ))}
      </Box>
    )
  }

  const entryDetails = (e: JournalEntry, net: JournalChange['fields']) => {
    if (e.changes.length > 1) return burstDetails(e, net)

    const c = e.latest

    if (c.action === 'login_failed') return loginDetails(c)

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {c.action === 'backup' && backupDetails(c)}
        {c.action !== 'backup' && (c.fields?.length || 0) > 0 && <ChangeDetails fields={c.fields} side={sideOf(c)} />}
        <AuthorEvidence change={c} />
      </Box>
    )
  }

  const entryRow = (e: JournalEntry) => {
    const c = e.latest
    const burst = e.changes.length > 1
    const open = !!expanded[c.id]
    const details = burst || hasDetails(c)
    const toggle = () => details && setExpanded(prev => ({ ...prev, [c.id]: !prev[c.id] }))
    const sameAction = e.changes.every(x => x.action === c.action)
    // A burst reads as its net effect, oldest change first
    const net = burst ? netFields([...e.changes].reverse()) : undefined

    return (
      <Box key={e.key} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
        <Box onClick={toggle} sx={rowSx(details)}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            {actionIcon(c.action)}
            <Typography variant='body2' sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {burst && !sameAction ? t('changes.burstMixed') : t(actionMeta(c.action).label)}
            </Typography>
            {burst && (
              <Chip
                size='small'
                label={`×${e.changes.length}`}
                title={t('changes.burstHint', { count: e.changes.length })}
                sx={{ height: 18, fontSize: '0.68rem', fontWeight: 700, flexShrink: 0, '& .MuiChip-label': { px: 0.75 } }}
              />
            )}
          </Box>

          {showResource && resourceCell(c)}

          {burst ? <FactSummary fields={net} empty={t('changes.burstNoNet')} /> : detailCell(c)}

          <AuthorCell changes={e.changes} />

          {locationCell(c)}

          <Typography variant='caption' sx={{ opacity: 0.7 }}>
            {burst ? `${clock(e.earliest.timestamp, locale)} → ${clock(c.timestamp, locale)}` : clock(c.timestamp, locale)}
          </Typography>

          {details ? chevron(open, toggle) : <span />}
        </Box>

        {details && (
          <Collapse in={open} unmountOnExit>
            <Box sx={{ mx: 2, mb: 1.5, p: 1.5, bgcolor: 'action.hover', borderRadius: 1, whiteSpace: 'normal' }}>
              {entryDetails(e, net)}
            </Box>
          </Collapse>
        )}
      </Box>
    )
  }

  return (
    <Card variant='outlined' sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: fill ? 1 : undefined }}>
      {/* A flex box rather than a Stack: Stack spaces with margins, which
          beats the `ml: auto` that pins the actions to the right. */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5, p: 2, pb: 1.5 }}>
        <TextField
          size='small'
          placeholder={t('changes.search')}
          value={search}
          onChange={e => filterSearch(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position='start'>
                  <i className='ri-search-line' style={{ fontSize: 16 }} />
                </InputAdornment>
              )
            }
          }}
          sx={{ minWidth: 220 }}
        />
        {filters.includes('family') && (
          <TextField
            select
            size='small'
            value={family}
            onChange={e => filterFamily(e.target.value as Family | '')}
            slotProps={{ select: { displayEmpty: true } }}
            sx={{ minWidth: 170, ...SMALL_SELECT_SX }}
          >
            <MenuItem value=''>{t('changes.familyAll')}</MenuItem>
            {FAMILIES.map(f => <MenuItem key={f} value={f}>{t(FAMILY_LABELS[f])}</MenuItem>)}
          </TextField>
        )}
        {filters.includes('resourceType') && (
          <TextField
            select
            size='small'
            value={resourceType}
            onChange={e => filterResourceType(e.target.value)}
            slotProps={{ select: { displayEmpty: true } }}
            sx={{ minWidth: 160, ...SMALL_SELECT_SX }}
          >
            <MenuItem value=''>{t('changes.allTypes')}</MenuItem>
            {resourceTypes.map(rt => <MenuItem key={rt} value={rt}>{RESOURCE_LABELS[rt] || rt}</MenuItem>)}
          </TextField>
        )}
        {filters.includes('user') && (
          <TextField
            select
            size='small'
            value={user}
            onChange={e => filterUser(e.target.value)}
            slotProps={{ select: { displayEmpty: true } }}
            sx={{ minWidth: 160, ...SMALL_SELECT_SX }}
          >
            <MenuItem value=''>{t('changes.authorAll')}</MenuItem>
            {users.map(u => <MenuItem key={u} value={u}>{u}</MenuItem>)}
          </TextField>
        )}
        {toolbar && (
          <Box sx={{ display: 'flex', gap: 0.5, ml: 'auto', alignItems: 'center' }}>
            {toolbar(filtered)}
          </Box>
        )}
      </Box>

      {timeline && (
        <Box sx={{ borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'divider', mb: 1 }}>
          <ActivityTimeline
            buckets={buckets}
            period={period}
            onPeriod={filterPeriod}
            selected={slot?.from ?? null}
            onSelect={filterSlot}
            family={family}
            onFamily={f => filterFamily(family === f ? '' : f)}
            summary={{ changes: base.length, resources: new Set(base.map(c => `${c.connectionId}|${c.resourceType}|${c.resourceId}`)).size }}
          />
        </Box>
      )}

      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', px: 2 }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: columns,
            columnGap: 2,
            px: 2,
            pb: 0.75,
            borderBottom: '1px solid',
            borderColor: 'divider',
            whiteSpace: 'nowrap'
          }}
        >
          {headers.map(h => (
            <Typography key={h || 'expand'} variant='caption' sx={{ fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', opacity: 0.6 }}>
              {h}
            </Typography>
          ))}
        </Box>

        {filtered.length === 0 ? (
          <Typography variant='body2' color='text.secondary' sx={{ py: 3, textAlign: 'center' }}>
            {t('changes.noMatch')}
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, py: 1 }}>
            {rows.map((e, i) => {
              const day = startOfDay(new Date(e.latest.timestamp).getTime())
              const prev = i > 0 ? startOfDay(new Date(rows[i - 1].latest.timestamp).getTime()) : undefined

              return (
                <Fragment key={e.key}>
                  {day !== prev && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pt: i > 0 ? 1.25 : 0.25, pb: 0.25, px: 0.5 }}>
                      <Typography variant='caption' sx={{ fontWeight: 700, letterSpacing: 0.2 }}>{dayLabel(day)}</Typography>
                      <Typography variant='caption' sx={{ opacity: 0.5 }}>{perDay.get(day)}</Typography>
                      <Box sx={{ flex: 1, borderBottom: '1px solid', borderColor: 'divider' }} />
                    </Box>
                  )}
                  {entryRow(e)}
                </Fragment>
              )
            })}
          </Box>
        )}
      </Box>

      {entries.length > PAGE_SIZES[0] && (
        <TablePagination
          component='div'
          count={entries.length}
          page={current}
          onPageChange={(_e, p) => setPage(p)}
          rowsPerPage={perPage}
          onRowsPerPageChange={e => { setPerPage(Number(e.target.value)); setPage(0) }}
          rowsPerPageOptions={PAGE_SIZES}
          labelRowsPerPage={t('common.rowsPerPage')}
          labelDisplayedRows={({ from, to, count }) => t('changes.displayedRows', { from, to, count })}
          sx={STICKY_PAGER_SX}
        />
      )}
    </Card>
  )
}
