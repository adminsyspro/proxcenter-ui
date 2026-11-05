'use client'

import { useCallback, useRef, useState } from 'react'
import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { microsegApi } from '@/lib/microseg/api'
import { isAggregateDst, type FlowDirection, type MicrosegSuggestion, type SuggestionAction, type SuggestionKind } from '@/lib/microseg/types'
import { serviceLabel, serviceTitle } from '@/lib/network/serviceNames'

import AcceptNetworkDialog from './AcceptNetworkDialog'
import { isVersionConflict, writeErrorMessage } from './dialogParts'
import { WriteTip, useMicrosegWrite } from './microsegAccess'
import TruncatedText from './TruncatedText'

// Same semantics as the edges of the zone map (EDGE_COLORS): a flow an enforced zone blocked is blue, a flow
// that would be blocked once its zone enforces (unprotected today) is red.
const KIND_GLYPH: Record<SuggestionKind, { icon: string; dot: string }> = {
  blocked: { icon: 'ri-forbid-line', dot: 'info.main' },
  would_block: { icon: 'ri-eye-line', dot: 'error.main' },
}

/** The icon of an observed flow, with its kind as a coloured dot and in the tooltip. */
export function ObservedKindGlyph({ kind }: { kind: SuggestionKind }) {
  const t = useTranslations('microsegPilot.observation')
  const glyph = KIND_GLYPH[kind] ?? KIND_GLYPH.would_block

  return (
    <Tooltip title={t(`kind.${kind}`)}>
      <Box component='span' data-kind={kind} sx={{ position: 'relative', display: 'inline-flex', width: 16, height: 16, flexShrink: 0 }}>
        <i className={glyph.icon} style={{ fontSize: 16 }} />
        <Box
          component='span'
          data-dot={glyph.dot}
          sx={{
            position: 'absolute', bottom: -2, right: -3, width: 8, height: 8, borderRadius: '50%', border: '1.5px solid', borderColor: 'background.paper',
            bgcolor: glyph.dot,
          }}
        />
      </Box>
    </Tooltip>
  )
}

/** The direction of an observed flow as an arrow (up and out for an outbound flow, down and in for an inbound one). */
export function DirectionGlyph({ direction }: { direction: FlowDirection | undefined }) {
  const t = useTranslations('microsegPilot.observation')
  const out = direction === 'out'
  const label = t(out ? 'direction.out' : 'direction.in')
  return (
    <Tooltip title={label}>
      <Box component='span' role='img' aria-label={label} data-direction={out ? 'out' : 'in'} sx={{ display: 'inline-flex', flexShrink: 0, color: out ? 'warning.main' : 'text.secondary' }}>
        <i className={out ? 'ri-arrow-right-up-line' : 'ri-arrow-right-down-line'} style={{ fontSize: 16 }} />
      </Box>
    </Tooltip>
  )
}

/** The service of an observed flow (its name, protocol and port in the tooltip) and its hits, as two cells of a row. */
export function ServiceHits({ suggestion: s }: { suggestion: Pick<MicrosegSuggestion, 'proto' | 'dport' | 'hits'> }) {
  const t = useTranslations('microsegPilot.observation')
  return (
    <>
      <TruncatedText text={serviceLabel(s.proto, s.dport)} title={serviceTitle(s.proto, s.dport)} color='text.secondary' sx={{ flexShrink: 0 }} />
      <Typography noWrap color='text.secondary' sx={{ flexShrink: 0 }}>{t('hits', { count: s.hits })}</Typography>
    </>
  )
}

/**
 * Stands in the place of Accept on a row for many destinations: no one-click opening of the Internet, the flow is
 * created by hand.
 */
export function AggregateHint() {
  const t = useTranslations('microsegPilot.observation')
  return (
    <Tooltip title={t('aggregateHint')}>
      <Box component='span' role='img' aria-label={t('aggregateHint')} sx={{ display: 'inline-flex', alignItems: 'center', px: 1, color: 'text.secondary' }}>
        <i className='ri-information-line' />
      </Box>
    </Tooltip>
  )
}

/** The tooltip of Accept for an outbound flow to a zone, which also opens that zone's inbound; undefined for any other flow. */
export function outboundZoneAcceptTip(
  t: (key: 'acceptOutZoneTip', values: { from: string; to: string }) => string,
  s: Pick<MicrosegSuggestion, 'direction' | 'src_zone_id' | 'dst_zone_id'>,
  from: string,
  to: string,
): string | undefined {
  return s.direction === 'out' && s.src_zone_id && s.dst_zone_id ? t('acceptOutZoneTip', { from, to }) : undefined
}

/**
 * The prefix choice of an outbound As CIDR: `choose` opens the dialog (rendered as `dialog`, null while closed), whose
 * Accept closes it and resolves the flow with the chosen length.
 */
export function usePrefixChoice(ip: string, onResolve: (action: SuggestionAction, prefixLen?: number) => void) {
  const [choosing, setChoosing] = useState(false)
  const dialog = choosing
    ? <AcceptNetworkDialog ip={ip} onClose={() => setChoosing(false)} onAccept={len => { setChoosing(false); onResolve('accept_cidr', len) }} />
    : null
  return { choose: () => setChoosing(true), dialog }
}

type ResolveActionsProps = {
  suggestion: MicrosegSuggestion
  busy: boolean
  /** `prefixLen` comes with As CIDR on an outbound flow, whose dialog chooses it. */
  onResolve: (action: SuggestionAction, prefixLen?: number) => void
  /** Name of the accept button (its tooltip too when the flow has a source zone); "Accept" by default. */
  acceptLabel?: string
  /** Tooltip of the accept button when the flow has a source zone; the accept label by default. */
  acceptTip?: string
}

/** The three ways out of an observed flow: accept as a flow of the zones, accept as a CIDR, dismiss. */
export function ResolveActions({ suggestion: s, busy, onResolve, acceptLabel, acceptTip }: ResolveActionsProps) {
  const t = useTranslations('microsegPilot.observation')
  const accept = acceptLabel ?? t('accept')
  const { canWrite } = useMicrosegWrite()
  const outbound = s.direction === 'out'
  const prefix = usePrefixChoice(s.dst_ip, onResolve)
  // An outbound flow is accepted as the network of its destination (the prefix is chosen), never for many destinations.
  const cidrOff = outbound ? !s.dst_ip : !s.src_ip
  const aggregate = outbound && isAggregateDst(s)
  const showCidr = !aggregate
  const acceptTitle = s.src_zone_id ? acceptTip ?? accept : t('acceptNoZone')

  return (
    <>
      {aggregate ? <AggregateHint /> : (
        <WriteTip title={acceptTitle}>
          <IconButton size='small' aria-label={accept} disabled={!canWrite || busy || !s.src_zone_id} onClick={() => onResolve('accept')}><i className='ri-check-line' /></IconButton>
        </WriteTip>
      )}
      {showCidr && (
        <WriteTip title={cidrOff ? t('acceptCidrNoIp') : t('acceptCidr')}>
          <IconButton size='small' aria-label={t('acceptCidr')} disabled={!canWrite || busy || cidrOff} onClick={() => (outbound ? prefix.choose() : onResolve('accept_cidr'))}><i className='ri-checkbox-multiple-line' /></IconButton>
        </WriteTip>
      )}
      <WriteTip title={t('dismiss')}>
        <IconButton size='small' aria-label={t('dismiss')} disabled={!canWrite || busy} onClick={() => onResolve('dismiss')}><i className='ri-close-line' /></IconButton>
      </WriteTip>
      {prefix.dialog}
    </>
  )
}

/** What a resolve call came to: whether the server took it, and the suggestions as re-read after it (when they were). */
export type ResolveOutcome<R> = { resolved: boolean; fresh: R | undefined }

/**
 * Resolves suggestions against the draft version. On success, and on a 409 (the draft moved), the draft and the
 * list are re-read; any other failure leaves them as they are. The failure is kept as a message for an Alert.
 * Returns null when nothing was sent (a call already running, or no id).
 */
export function useResolveSuggestions<R>(
  connectionId: string,
  version: number,
  reloadPolicy: () => Promise<unknown>,
  reloadSuggestions: () => Promise<R>,
) {
  const tAll = useTranslations()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  // Read synchronously, so a second click in the same render does not send a second request.
  const running = useRef(false)

  const clearFailure = useCallback(() => setFailure(null), [])

  const resolve = useCallback(async (ids: string[], action: SuggestionAction, prefixLen?: number): Promise<ResolveOutcome<R> | null> => {
    if (running.current || ids.length === 0) return null
    running.current = true
    setBusy(true)
    setFailure(null)
    let resolved = false
    try {
      await microsegApi(connectionId).resolveSuggestions({ version, ids, action, ...(prefixLen === undefined ? {} : { prefix_len: prefixLen }) })
      resolved = true
    } catch (e) {
      setFailure(writeErrorMessage(tAll as (key: string) => string, e))
      if (!isVersionConflict(e)) {
        running.current = false
        setBusy(false)
        return { resolved, fresh: undefined }
      }
    }
    const [, fresh] = await Promise.all([reloadPolicy().catch(() => undefined), reloadSuggestions().catch(() => undefined)])
    running.current = false
    setBusy(false)
    return { resolved, fresh }
  }, [connectionId, version, reloadPolicy, reloadSuggestions, tAll])

  return { busy, failure, clearFailure, resolve }
}
