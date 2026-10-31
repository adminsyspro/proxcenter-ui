'use client'

import { useState } from 'react'

import { useTranslations } from 'next-intl'
import { Box, Button, ButtonBase, Chip, InputAdornment, TextField, Typography } from '@mui/material'
import type { Theme } from '@mui/material/styles'

import type { Result } from '@/lib/availability/types'

import { useAvailabilityFormat } from './availabilityFormat'
import RowGlyph from './RowGlyph'
import { STATES } from './stateColors'
import { statusBars } from './statusBars'
import TimelineRowItem, { barColor } from './TimelineRowItem'

export type PolicyGuest = Result & { name: string | null; type: 'qemu' | 'lxc' | null }

/** Guests shown at first, then this many more per click. */
export const GUESTS_PAGE = 10

/** Bars of the small strip of a guest line. */
const MINI_BARS = 60

const GRID = { display: 'grid', gridTemplateColumns: 'minmax(180px, 1.3fr) minmax(140px, 3fr) 88px 96px 24px', alignItems: 'center', columnGap: 3 }

const miniSx = (theme: Theme) => ({
  display: 'flex',
  columnGap: '1px',
  height: 14,
  '& > span': { flex: '1 1 0', minWidth: 0, borderRadius: '1px' },
  ...Object.fromEntries(STATES.map(s => [`& > span[data-state="${s}"]`, { backgroundColor: barColor(theme, s) }])),
})

interface Props {
  guests: PolicyGuest[]
  /** Connection id to name. */
  connectionNames: Record<string, string>
  /** The policy target, %: a guest under it is listed first and in red. */
  target: number
  to: string
}

const below = (g: PolicyGuest, target: number) => g.availability !== null && g.availability < target

/**
 * The guests of a policy as one compact line each, the worst first: name,
 * connection, a small strip, rate and downtime. A line opens the full
 * timeline of its guest. A long list gets a search, a "below target" filter
 * and pages of GUESTS_PAGE.
 */
export default function PolicyGuests({ guests, connectionNames, target, to }: Readonly<Props>) {
  const t = useTranslations('availability')
  const { rate, span } = useAvailabilityFormat()
  const [query, setQuery] = useState('')
  const [belowOnly, setBelowOnly] = useState(false)
  const [limit, setLimit] = useState(GUESTS_PAGE)
  const [openKey, setOpenKey] = useState<string | null>(null)

  const nameOf = (g: PolicyGuest) =>
    g.name ?? t(g.type === 'lxc' ? 'policies.guestFallbackCt' : 'policies.guestFallbackVm', { vmid: g.ref.vmid ?? 0 })

  const sorted = [...guests].sort((a, b) =>
    Number(below(b, target)) - Number(below(a, target))
    || (a.availability ?? 101) - (b.availability ?? 101)
    || nameOf(a).localeCompare(nameOf(b)))

  const belowCount = sorted.filter(g => below(g, target)).length
  const q = query.trim().toLowerCase()
  const filtered = sorted.filter(g =>
    (!belowOnly || below(g, target))
    && (!q || `${nameOf(g)} ${g.ref.vmid ?? ''} ${connectionNames[g.ref.connection_id] ?? ''}`.toLowerCase().includes(q)))
  const shown = filtered.slice(0, limit)
  const long = guests.length > GUESTS_PAGE

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {long && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            size='small'
            value={query}
            onChange={e => { setQuery(e.target.value); setLimit(GUESTS_PAGE) }}
            placeholder={t('policies.guests.search')}
            sx={{ width: 280 }}
            slotProps={{
              htmlInput: { 'aria-label': t('policies.guests.search') },
              input: { startAdornment: <InputAdornment position='start'><i className='ri-search-line' aria-hidden='true' /></InputAdornment> },
            }}
          />
          {belowCount > 0 && (
            <Chip
              size='small'
              color='error'
              variant={belowOnly ? 'filled' : 'outlined'}
              aria-pressed={belowOnly}
              label={t('policies.guests.belowOnly', { count: belowCount })}
              onClick={() => { setBelowOnly(b => !b); setLimit(GUESTS_PAGE) }}
            />
          )}
        </Box>
      )}

      <Box sx={{ ...GRID, px: 1 }}>
        <Typography variant='caption' color='text.secondary'>{t('policies.guests.colGuest')}</Typography>
        <Typography variant='caption' color='text.secondary'>{t('policies.guests.colTimeline')}</Typography>
        <Typography variant='caption' color='text.secondary' sx={{ textAlign: 'right' }}>{t('policies.guests.colRate')}</Typography>
        <Typography variant='caption' color='text.secondary' sx={{ textAlign: 'right' }}>{t('policies.guests.colDowntime')}</Typography>
        <span />
      </Box>

      {shown.length === 0 && <Typography variant='body2' color='text.secondary' sx={{ px: 1 }}>{t('policies.guests.none')}</Typography>}

      <Box role='list' sx={{ display: 'flex', flexDirection: 'column' }}>
        {shown.map(g => {
          const key = `${g.ref.connection_id}:${g.ref.vmid}`
          const name = nameOf(g)
          const open = openKey === key
          const last = g.slots[g.slots.length - 1]?.state ?? 'absent'
          const bad = below(g, target)

          return (
            <Box role='listitem' key={key} sx={{ borderTop: 1, borderColor: 'divider' }}>
              <ButtonBase
                aria-expanded={open}
                aria-label={t('policies.guests.expand', { name })}
                onClick={() => setOpenKey(open ? null : key)}
                sx={{ ...GRID, width: '100%', textAlign: 'left', px: 1, py: 1.5, borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                  <RowGlyph kind='guest' guestType={g.type ?? undefined} state={last} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant='body2' noWrap sx={{ fontWeight: 500 }}>{name}</Typography>
                    <Typography variant='caption' color='text.secondary' noWrap sx={{ display: 'block' }}>
                      {`${g.ref.vmid ?? ''} · ${connectionNames[g.ref.connection_id] ?? g.ref.connection_id}`}
                    </Typography>
                  </Box>
                </Box>
                <Box sx={miniSx} aria-hidden='true'>
                  {statusBars(g.slots, to, MINI_BARS).map(b => <span key={b.start} data-state={b.state} />)}
                </Box>
                <Typography variant='body2' sx={{ textAlign: 'right', fontWeight: 500, color: bad ? 'error.main' : 'text.primary' }}>
                  {g.availability === null ? '-' : rate(g.availability)}
                </Typography>
                <Typography variant='body2' color='text.secondary' sx={{ textAlign: 'right' }}>{span(g.down_seconds)}</Typography>
                <i className={open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} aria-hidden='true' />
              </ButtonBase>
              {open && (
                <Box sx={{ px: 1, pb: 2 }}>
                  <TimelineRowItem row={{ label: name, guestType: g.type ?? undefined, result: g }} to={to} />
                </Box>
              )}
            </Box>
          )
        })}
      </Box>

      {filtered.length > shown.length && (
        <Box>
          <Button size='small' onClick={() => setLimit(l => l + GUESTS_PAGE)}>
            {t('policies.guests.showMore', { count: Math.min(GUESTS_PAGE, filtered.length - shown.length), rest: filtered.length - shown.length })}
          </Button>
        </Box>
      )}
    </Box>
  )
}
