'use client'

import { useContext, useMemo, type ReactNode } from 'react'
import { Box, Button, IconButton, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { serviceTitle } from '@/lib/network/serviceNames'
import { isAggregateDst, type MicrosegPolicy, type MicrosegSuggestion, type SuggestionAction, type SuggestionKind } from '@/lib/microseg/types'

import ExceptionDialog from './ExceptionDialog'
import { exceptionCovered, exceptionFromSuggestion, type ExceptionDraft } from './exceptionModel'
import { AggregateHint, ObservedKindGlyph, outboundZoneAcceptTip, usePrefixChoice } from './observationParts'
import { MicrosegActionsSlot, WriteTip, useMicrosegWrite } from './microsegAccess'
import type { TrackedRun } from './microsegTabTypes'
import { useZoneEdits } from './useZoneEdits'
import { useZoneGuests } from './useZoneGuests'
import { zoneMembers, type ZoneMember } from './zoneModel'

const ACTION_SX = { minWidth: 0, px: 1, py: 0, lineHeight: 1.6, whiteSpace: 'nowrap' } as const

type FlowActionsProps = {
  suggestion: MicrosegSuggestion
  /** Names of the two ends as the row shows them, for the tooltip of Accept. */
  source: string
  destination: string
  busy: boolean
  /** `prefixLen` comes with As CIDR on an outbound flow, whose dialog chooses it. */
  onResolve: (action: SuggestionAction, prefixLen?: number) => void
  /** Coloured icons for the rows of the table (the default), labelled buttons where there is room (the flow dialog). */
  variant?: 'icons' | 'buttons'
  /** "Allow this flow only": given when the flow is between two known guests (`useFlowException`), absent otherwise. */
  exception?: { source: string; destination: string; open: () => void }
}

/** The three ways out, their icon and colour (Accept green, As CIDR blue, Dismiss red). */
const FLOW_ACTIONS = [
  { action: 'accept', icon: 'ri-checkbox-circle-line', color: 'success' },
  { action: 'accept_cidr', icon: 'ri-global-line', color: 'info' },
  { action: 'dismiss', icon: 'ri-close-circle-line', color: 'error' },
] as const

type Translate = ReturnType<typeof useTranslations<'microsegPilot.observation'>>

/** The tooltip of Accept: the flow between the zones, which for an outbound flow to a zone also opens its inbound. */
function acceptTipOf(t: Translate, s: MicrosegSuggestion, flow: { from: string; to: string; service: string }): string {
  if (!s.src_zone_id) return t('acceptUnknownSource')
  return outboundZoneAcceptTip(t, s, flow.from, flow.to) ?? t('acceptTip', flow)
}

/** The tooltip of "allow this flow only": an icon is named by its action first, like the three others. */
const exceptionTip = (t: Translate, variant: 'icons' | 'buttons', tip: string) => (variant === 'icons' ? t('actionTip', { action: t('exceptionOnly'), tip }) : tip)

/**
 * The three ways out of an observed flow, whose tooltip says what each does: Accept (a flow between the zones in the
 * draft), As CIDR (the same with the source as an address range) and Dismiss. In the rows they are coloured icons
 * named by the action; in the dialog, labelled buttons.
 */
export function FlowActions({ suggestion: s, source, destination, busy, onResolve, variant = 'icons', exception }: FlowActionsProps) {
  const t = useTranslations('microsegPilot.observation')
  const { canWrite } = useMicrosegWrite()
  const service = serviceTitle(s.proto, s.dport)
  const outbound = s.direction === 'out'
  const prefix = usePrefixChoice(s.dst_ip, onResolve)
  const spec = {
    accept: { label: t('accept'), tip: acceptTipOf(t, s, { from: source, to: destination, service }), off: !s.src_zone_id },
    accept_cidr: outbound
      ? { label: t('asCidr'), tip: t('cidrOutTip', { from: source, ip: s.dst_ip, service }), off: !s.dst_ip }
      : { label: t('asCidr'), tip: s.src_ip ? t('cidrTip', { ip: s.src_ip }) : t('acceptCidrNoIp'), off: !s.src_ip },
    dismiss: { label: t('dismiss'), tip: t('dismissTip'), off: false },
  }
  // Many destinations never make one flow in one click, nor one network: the backend refuses both, so neither is offered.
  const aggregate = outbound && isAggregateDst(s)
  const actions = FLOW_ACTIONS.filter(({ action }) => !(aggregate && action !== 'dismiss'))
  const run = (action: SuggestionAction) => (action === 'accept_cidr' && outbound ? prefix.choose() : onResolve(action))

  return (
    <Box sx={{ display: 'inline-flex', gap: variant === 'icons' ? 0 : 0.5 }}>
      {aggregate && <AggregateHint />}
      {actions.map(({ action, icon, color }) => {
        const { label, tip, off } = spec[action]
        const disabled = !canWrite || busy || off
        return (
          <WriteTip key={action} title={variant === 'icons' ? t('actionTip', { action: label, tip }) : tip}>
            {variant === 'icons' ? (
              <IconButton size='small' color={color} aria-label={label} disabled={disabled} onClick={() => run(action)}>
                <i className={icon} />
              </IconButton>
            ) : (
              <Button size='small' variant='outlined' color={action === 'dismiss' ? 'inherit' : 'primary'} disabled={disabled} onClick={() => run(action)} sx={ACTION_SX}>
                {label}
              </Button>
            )}
          </WriteTip>
        )
      })}
      {exception && (
        <WriteTip title={exceptionTip(t, variant, t('exceptionOnlyTip', { from: exception.source, to: exception.destination, service }))}>
          {variant === 'icons' ? (
            <IconButton size='small' color='primary' aria-label={t('exceptionOnly')} disabled={!canWrite || busy} onClick={exception.open}>
              <i className='ri-door-open-line' />
            </IconButton>
          ) : (
            <Button size='small' variant='outlined' disabled={!canWrite || busy} onClick={exception.open} sx={ACTION_SX}>{t('exceptionOnly')}</Button>
          )}
        </WriteTip>
      )}
      {prefix.dialog}
    </Box>
  )
}

/** An exception an observed flow would be, with the zone it is written into and what its dialog lists. */
export type FlowException = { zoneId: string; draft: ExceptionDraft; members: ZoneMember[] }

/**
 * What "allow this flow only" would write for an observed flow: the exception between its two guests, in its
 * destination zone. Null when the flow is not between two known guests (`exceptionFromSuggestion`), or when an
 * exception of the zone allows it already (`exceptionCovered`): the action is then not offered. Read from the
 * inventory the tab already holds, no request of its own; the members of a destination zone are worked out once for
 * all the flows that reach it.
 */
export function useFlowExceptions(connectionId: string, policy: MicrosegPolicy): (suggestion: MicrosegSuggestion) => FlowException | null {
  const { guests } = useZoneGuests(connectionId)

  return useMemo(() => {
    const zones = new Map(policy.zones.map(z => [z.id, z]))
    const membersByZone = new Map<string, ZoneMember[]>()
    const membersOf = (zoneId: string) => {
      const zone = zones.get(zoneId)
      if (!zone) return null
      let members = membersByZone.get(zoneId)
      if (!members) {
        members = zoneMembers(zone, policy.policy.tag_prefix, guests, policy.pending_members, policy.zones)
        membersByZone.set(zoneId, members)
      }
      return members
    }

    return (suggestion: MicrosegSuggestion) => {
      if (suggestion.status !== 'pending') return null
      const members = membersOf(suggestion.dst_zone_id)
      const draft = members && exceptionFromSuggestion(suggestion, guests, members)
      if (!members || !draft || exceptionCovered(draft, suggestion.dst_zone_id, policy.exceptions)) return null

      return { zoneId: suggestion.dst_zone_id, draft, members }
    }
  }, [policy, guests])
}

type FlowExceptionDialogProps = {
  connectionId: string
  policy: MicrosegPolicy
  reloadPolicy: () => Promise<unknown>
  startRun: (run: TrackedRun) => void
  exception: FlowException
  /** After the exception is written (the draft is read again by then). */
  onSaved: () => void
  onClose: () => void
}

/**
 * The exception dialog opened on an observed flow: its two guests and its service are picked already, and the save
 * writes the exception into the destination zone like the zone panel does (`saveException`). The suggestion is left
 * as it is: once the exception is applied the engine stops reporting the flow.
 */
export function FlowExceptionDialog({ connectionId, policy, reloadPolicy, startRun, exception, onSaved, onClose }: Readonly<FlowExceptionDialogProps>) {
  const edits = useZoneEdits({ connectionId, policy, reloadPolicy, startRun })
  const { guests } = useZoneGuests(connectionId)
  const save = async (draft: ExceptionDraft) => {
    await edits.saveException(exception.zoneId, draft)
    onSaved()
  }

  return <ExceptionDialog open exception={exception.draft} guests={guests} members={exception.members} onSave={save} onClose={onClose} />
}

type BulkBarProps = {
  count: number
  busy: boolean
  /** A selected flow has no source zone (Accept impossible) / no source IP (As CIDR impossible). */
  noZone: boolean
  noIp: boolean
  /** A selected flow is outbound: its network is accepted one by one (its prefix is chosen in a dialog). */
  outbound?: boolean
  /** A selected flow goes to many destinations: Accept is off (the flow is created by hand). */
  aggregate?: boolean
  /** A selected flow is outbound to a zone: its Accept also opens that zone's inbound. */
  outboundZone?: boolean
  onResolve: (action: SuggestionAction) => void
}

/** The tooltip of the bulk As CIDR: why it is off (an outbound flow, a flow without an address), or what it does. */
function bulkCidrTipOf(t: Translate, outbound: boolean, noIp: boolean): string {
  if (outbound) return t('bulkCidrOutbound')
  return noIp ? t('bulkCidrBlocked') : t('bulkCidrTip')
}

/** The tooltip of the bulk Accept: why it is off (no source zone, many destinations), or what it does. */
function bulkAcceptTipOf(t: Translate, c: { noZone: boolean; aggregate: boolean; outboundZone: boolean }): string {
  if (c.noZone) return t('bulkAcceptBlocked')
  if (c.aggregate) return t('aggregateHint')
  return t(c.outboundZone ? 'bulkAcceptOutZoneTip' : 'bulkAcceptTip')
}

/** "3 selected · Accept · As CIDR · Dismiss": the same three ways out for every checked flow of the page. */
export function BulkBar({ count, busy, noZone, noIp, outbound = false, aggregate = false, outboundZone = false, onResolve }: BulkBarProps) {
  const t = useTranslations('microsegPilot.observation')
  const { canWrite } = useMicrosegWrite()

  return (
    <Box
      role='toolbar'
      aria-label={t('bulkLabel')}
      sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, px: 1, py: 0.5, borderRadius: 1, bgcolor: 'action.selected' }}
    >
      <Typography noWrap variant='body2' fontWeight={600} sx={{ flexShrink: 0, mr: 0.5 }}>{t('selected', { count })}</Typography>
      <WriteTip title={bulkAcceptTipOf(t, { noZone, aggregate, outboundZone })}>
        <Button size='small' variant='outlined' aria-label={t('bulkAccept')} disabled={!canWrite || busy || noZone || aggregate} onClick={() => onResolve('accept')} sx={ACTION_SX}>
          {t('accept')}
        </Button>
      </WriteTip>
      <WriteTip title={bulkCidrTipOf(t, outbound, noIp)}>
        <Button size='small' variant='outlined' aria-label={t('bulkAcceptCidr')} disabled={!canWrite || busy || noIp || outbound} onClick={() => onResolve('accept_cidr')} sx={ACTION_SX}>
          {t('asCidr')}
        </Button>
      </WriteTip>
      <WriteTip title={t('bulkDismissTip')}>
        <Button size='small' variant='outlined' color='inherit' aria-label={t('bulkDismiss')} disabled={!canWrite || busy} onClick={() => onResolve('dismiss')} sx={ACTION_SX}>
          {t('dismiss')}
        </Button>
      </WriteTip>
    </Box>
  )
}

function Dot({ color }: { color: string }) {
  return <Box component='span' data-legend-dot={color} sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
}

function LegendItem({ mark, text }: { mark: ReactNode; text: string }) {
  return (
    <Box component='li' sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
      {mark}
      <Typography noWrap variant='caption' color='text.secondary'>{text}</Typography>
    </Box>
  )
}

const KINDS: SuggestionKind[] = ['would_block', 'blocked']

/**
 * What the marks of the table mean, on one compact row, with the sampling limit of Proxmox behind an info icon and the
 * way to the settings where it is raised.
 */
export function ObservationLegend({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const t = useTranslations('microsegPilot.observation')
  // Under a tab row, its gear opens the settings: no link of its own.
  const tabRow = useContext(MicrosegActionsSlot) !== null

  // On the row of the pager, left of it.
  return (
    <Box data-testid='observation-legend' sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1, rowGap: 0.5, minWidth: 0 }}>
      <Box component='ul' aria-label={t('legend.title')} sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1.5, rowGap: 0.5, m: 0, p: 0, listStyle: 'none', minWidth: 0 }}>
        {KINDS.map(kind => <LegendItem key={kind} mark={<ObservedKindGlyph kind={kind} />} text={t(`legend.${kind}`)} />)}
        <LegendItem mark={<Dot color='primary.main' />} text={t('legend.zoneDot')} />
        <LegendItem mark={<Dot color='error.main' />} text={t('legend.unknownDot')} />
      </Box>
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
        <Tooltip title={t('sampling')}>
          <IconButton size='small' aria-label={t('legend.about')}><i className='ri-information-line' /></IconButton>
        </Tooltip>
        {!tabRow && <Button size='small' disabled={!onOpenSettings} onClick={onOpenSettings} sx={{ whiteSpace: 'nowrap' }}>{t('openSettings')}</Button>}
      </Box>
    </Box>
  )
}
