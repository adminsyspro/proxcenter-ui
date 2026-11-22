'use client'

import type { ReactNode } from 'react'
import { Box, Button, Chip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { IPFilterGuest, IPFilterHeld } from '@/lib/microseg/types'

import { heldKey, nicKeys, splitAddresses, type RowState } from './ipFilterModel'
import { WriteTip, useMicrosegWrite } from './microsegAccess'
import TruncatedText from './TruncatedText'

/** One line of the IP filter of a guest: an icon in its tone, a text cut with an ellipsis, something at its right. */
export const FILTER_LINE_SX = { display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, minHeight: 32 } as const

type Tone = 'warning.main' | 'info.main' | 'success.main' | 'text.secondary'

export function FilterLine({ icon, tone = 'text.secondary', text, testId, children }: Readonly<{ icon: string; tone?: Tone; text: string; testId?: string; children?: ReactNode }>) {
  return (
    <Box role='listitem' data-testid={testId} sx={FILTER_LINE_SX}>
      <Box component='i' aria-hidden className={icon} sx={{ fontSize: 16, color: tone, flexShrink: 0 }} />
      <TruncatedText text={text} variant='body2' sx={{ flex: '1 1 0', minWidth: 0 }} />
      {children}
    </Box>
  )
}

/** A NIC and the addresses it may send from: the guest's own, then the technical ones (DHCP discovery, link-local), muted. */
function NicLine({ nic, addresses, missing }: Readonly<{ nic: string; addresses: readonly string[]; missing: boolean }>) {
  const t = useTranslations('microsegPilot.ipFilter')
  const { own, technical } = splitAddresses(addresses)
  const all = addresses.join(', ')
  return (
    <Box role='listitem' aria-label={nic} data-testid='ipfilter-nic' sx={FILTER_LINE_SX}>
      <Box component='i' aria-hidden className='ri-router-line' sx={{ fontSize: 16, color: missing ? 'warning.main' : 'text.secondary', flexShrink: 0 }} />
      <Typography variant='body2' color='text.secondary' noWrap sx={{ flexShrink: 0, minWidth: 36 }}>{nic}</Typography>
      {missing && own.length === 0
        ? <TruncatedText text={t('nicNoAddress')} variant='body2' color='warning.main' sx={{ flex: '1 1 0', minWidth: 0 }} />
        : <TruncatedText text={own.join(', ')} title={all} variant='body2' sx={{ flex: '0 1 auto', minWidth: 0 }} />}
      {technical.length > 0 && <TruncatedText text={technical.join(', ')} title={all} variant='body2' color='text.disabled' sx={{ flex: '1 1 0', minWidth: 0 }} />}
    </Box>
  )
}

/** The sentence of an address that was not added. */
export function useHeldText(): (held: IPFilterHeld) => string {
  const t = useTranslations('microsegPilot.ipFilter.held')
  return held => t(heldKey(held), { addr: held.addr, nic: held.nic, by: held.by ?? '' })
}

type LinesProps = {
  guest: IPFilterGuest
  /** Offers "Allow" on each address held back; absent: the lines are read only. */
  onAllow?: (held: IPFilterHeld) => void
  busy?: boolean
}

/**
 * What the engine computed for a guest, one line each: every NIC with its addresses (a NIC without a known address says
 * so), every address held back with why (and "Allow"), the source addresses the lists would drop, the NICs on DHCP.
 */
export default function IPFilterLines({ guest, onAllow, busy = false }: Readonly<LinesProps>) {
  const t = useTranslations('microsegPilot.ipFilter')
  const heldText = useHeldText()
  const { canWrite } = useMicrosegWrite()
  const missing = new Set(guest.no_address ?? [])
  const nics = [...new Set([...nicKeys(guest), ...missing])]
  const held = guest.held ?? []
  const unknown = guest.unknown ?? []
  const dhcp = guest.dhcp ?? []
  return (
    <Box role='list' aria-label={t('linesLabel', { name: guest.name })} sx={{ minWidth: 0 }}>
      {nics.map(nic => <NicLine key={nic} nic={nic} addresses={guest.nics?.[nic] ?? []} missing={missing.has(nic)} />)}
      {held.map(h => (
        <FilterLine key={`${h.nic}|${h.addr}`} icon='ri-forbid-line' tone='warning.main' text={heldText(h)} testId='ipfilter-held'>
          {onAllow && (
            <WriteTip>
              <Button size='small' variant='outlined' disabled={!canWrite || busy} onClick={() => onAllow(h)} aria-label={t('allowAddr', { addr: h.addr })} sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
                {t('allow')}
              </Button>
            </WriteTip>
          )}
        </FilterLine>
      ))}
      {unknown.length > 0 && <FilterLine icon='ri-alert-line' tone='warning.main' text={t('unknown', { addrs: unknown.join(', ') })} testId='ipfilter-unknown' />}
      {dhcp.length > 0 && <FilterLine icon='ri-information-line' tone='info.main' text={t('dhcp', { nics: dhcp.join(', ') })} testId='ipfilter-dhcp' />}
    </Box>
  )
}

type StateVisual = { icon: string; tone: Tone; color: 'success' | 'info' | 'warning' | 'default' }

/** The icon and the tone of each state of a guest, shared by the state line, the chip of a list and the mark of a member. */
export const FILTER_STATE_VISUAL: Record<RowState | 'loading' | 'waiting' | 'off' | 'notMember', StateVisual> = {
  filtered: { icon: 'ri-shield-check-line', tone: 'success.main', color: 'success' },
  willFilter: { icon: 'ri-time-line', tone: 'info.main', color: 'info' },
  excluded: { icon: 'ri-forbid-2-line', tone: 'text.secondary', color: 'default' },
  manual: { icon: 'ri-edit-line', tone: 'text.secondary', color: 'default' },
  noAddress: { icon: 'ri-map-pin-line', tone: 'warning.main', color: 'warning' },
  loading: { icon: 'ri-time-line', tone: 'text.secondary', color: 'default' },
  waiting: { icon: 'ri-time-line', tone: 'text.secondary', color: 'default' },
  off: { icon: 'ri-toggle-line', tone: 'text.secondary', color: 'default' },
  notMember: { icon: 'ri-question-line', tone: 'text.secondary', color: 'default' },
}

/** The state of a member as an outlined chip, in a list. */
export function FilterStateChip({ state }: Readonly<{ state: RowState }>) {
  const t = useTranslations('microsegPilot.ipFilter.chip')
  const visual = FILTER_STATE_VISUAL[state]
  return (
    <Chip
      size='small'
      variant='outlined'
      color={visual.color}
      icon={<i className={visual.icon} style={{ fontSize: 14 }} />}
      label={t(state)}
      data-testid='ipfilter-state-chip'
      sx={{ flexShrink: 0 }}
    />
  )
}
