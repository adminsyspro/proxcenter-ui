'use client'

import { useState, type MouseEvent, type ReactElement } from 'react'
import { useTranslations } from 'next-intl'
import { Alert, Box, Button, Chip, Tooltip, Typography } from '@mui/material'

import FlowDialog, { type FlowSaveValues } from '@/app/(dashboard)/automation/network/components/microseg/FlowDialog'
import { isVersionConflict } from '@/app/(dashboard)/automation/network/components/microseg/dialogParts'
import { WriteTip, useMicrosegWrite } from '@/app/(dashboard)/automation/network/components/microseg/microsegAccess'
import { useResolveSuggestions } from '@/app/(dashboard)/automation/network/components/microseg/observationParts'
import { EDGE_COLORS } from '@/app/(dashboard)/automation/network/components/microseg/zoneGraph'
import { serviceLabel } from '@/lib/network/serviceNames'
import { formatBytes } from '@/utils/format'
import { microsegApi } from '@/lib/microseg/api'
import type { MicrosegSuggestion } from '@/lib/microseg/types'
import {
  flowDraftOf, groupKeyOf, protoOf, type LensEndpoint, type LensPair, type LensStatus, type PairVerdict, type ReplyMarks,
} from '@/lib/microseg/trafficLens'

import type { TrafficLens, TrafficLensRead } from './useTrafficLens'

/** Same colours as the edges of the zone map: green allowed, red outline not covered, blue blocked. */
const STATUS_SX: Record<LensStatus, object> = {
  allowed: { bgcolor: `${EDGE_COLORS.allowed}1f`, color: EDGE_COLORS.allowed, borderColor: 'transparent' },
  not_covered: { bgcolor: 'transparent', color: EDGE_COLORS.unprotected, borderColor: EDGE_COLORS.unprotected },
  blocked: { bgcolor: `${EDGE_COLORS.blocked}1f`, color: EDGE_COLORS.blocked, borderColor: 'transparent' },
  unknown: { bgcolor: 'transparent', color: 'text.secondary', borderColor: 'divider' },
  reply: { bgcolor: 'action.hover', color: 'text.secondary', borderColor: 'transparent' },
}

const STATUS_LABEL: Record<LensStatus, string> = {
  allowed: 'status.allowed', not_covered: 'status.notCovered', blocked: 'status.blocked', unknown: 'status.unknown', reply: 'status.reply',
}

/** A row of the table: an sFlow pair, its reply direction folded in. */
type LensRow = LensPair & Partial<ReplyMarks>

/** The service of a pair as the policy writes it: "tcp/443", "udp/53", "icmp". */
export function pairService(pair: Pick<LensPair, 'protocol' | 'dst_port'>): string {
  const proto = protoOf(pair.protocol)
  return (proto === 'tcp' || proto === 'udp') && pair.dst_port > 0 ? `${proto}/${pair.dst_port}` : proto
}

/** The buttons sit in a clickable table row: their click must not open the pair details too. */
const only = (action: () => void) => (e: MouseEvent) => {
  e.stopPropagation()
  action()
}

/** The group label of an endpoint: its zone, Unzoned, or Unknown / External. */
function useEndpointLabel(lens: TrafficLens) {
  return (endpoint: LensEndpoint) => lens.labelOf(groupKeyOf(endpoint))
}

/** The tooltip of a status: the flow that allows the pair, or why none does, then what the row is made of. */
function useVerdictText(lens: TrafficLens) {
  const t = useTranslations('microsegPilot.trafficLens.tip')
  const labelOf = useEndpointLabel(lens)
  const reason = (verdict: PairVerdict, pair: LensRow) => {
    const values = { src: labelOf(verdict.src), dst: labelOf(verdict.dst), service: pairService(pair) }
    if (verdict.status === 'reply') return t('reply', { ...values, port: pair.dst_port })
    if (verdict.notEnforced) return t('notEnforced', { zone: values.dst })
    if (verdict.status === 'unknown') return t('unknown', values)
    if (verdict.intraZone) return t('intraZone', { zone: values.src })
    if (verdict.flow) {
      const f = verdict.flow
      return t('allowedFlow', { ...values, service: serviceLabel(f.proto, f.dport) })
    }
    if (verdict.status === 'blocked') return t('blocked', { ...values, hits: verdict.suggestion?.hits ?? 0 })
    if (verdict.suggestion) return t('wouldBlock', { ...values, hits: verdict.suggestion.hits })
    return t('notCovered', values)
  }
  return (verdict: PairVerdict, pair: LensRow) => {
    const lines = [reason(verdict, pair)]
    if (pair.replyBytes) lines.push(t('includesReply', { volume: formatBytes(pair.replyBytes) }))
    // The orchestrator keeps one entry per direction of two addresses: the service is the last one sampled.
    if (verdict.status !== 'reply') lines.push(t('lastSampled', { service: pairService(pair) }))
    return lines.join('\n')
  }
}

/** One end of a pair in Zone mode: the zone dot and name, then the address, on one line. */
export function ZoneEndpointCell({ ip, endpoint, lens }: { ip: string; endpoint: LensEndpoint; lens: TrafficLens }) {
  const key = groupKeyOf(endpoint)
  const label = lens.labelOf(key)
  const guest = endpoint.kind === 'external' ? '' : endpoint.guest
  return (
    <Tooltip title={[label, guest, ip].filter(Boolean).join(' · ')}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
        <Box component='span' sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: lens.colorOf(key), flexShrink: 0 }} />
        <Typography variant='body2' fontSize='0.8rem' fontWeight={600} noWrap sx={{ flexShrink: 0 }}>{label}</Typography>
        <Typography variant='caption' color='text.secondary' noWrap sx={{ minWidth: 0 }}>{ip}</Typography>
      </Box>
    </Tooltip>
  )
}

export type PairActions = {
  openCreate: (pair: LensPair, verdict: PairVerdict) => void
  accept: (suggestion: MicrosegSuggestion) => void
  busy: boolean
  /** The Create flow window, when open, and the failure of the last accept: rendered once by the table. */
  dialog: ReactElement | null
  failure: ReactElement | null
}

/**
 * The writes of the Micro-segmentation column: a flow created from a pair (the existing flow window, prefilled with
 * the two zones and the service), or a pending suggestion accepted. Both go to the draft and read it again, so the
 * statuses follow; a VERSION_CONFLICT reloads the draft and keeps the window open.
 */
export function usePairActions(read: TrafficLensRead): PairActions {
  const lens = read.lens
  const [creating, setCreating] = useState<{ pair: LensPair; verdict: PairVerdict } | null>(null)
  const resolver = useResolveSuggestions(lens?.connectionId ?? '', lens?.policy.version ?? 0, read.reloadPolicy, read.reloadSuggestions)

  const saveFlow = async (values: FlowSaveValues) => {
    if (!lens) return
    try {
      await microsegApi(lens.connectionId).saveFlow({ version: lens.policy.version, ...values })
    } catch (e) {
      if (isVersionConflict(e)) await read.reloadPolicy().catch(() => undefined)
      throw e
    }
    await Promise.all([read.reloadPolicy().catch(() => undefined), read.reloadSuggestions().catch(() => undefined)])
    setCreating(null)
  }

  const src = creating?.verdict.src
  const dst = creating?.verdict.dst
  const zoneIds = src?.kind === 'zone' && dst?.kind === 'zone' ? { src: src.zone.id, dst: dst.zone.id } : null

  const dialog = lens && creating && zoneIds ? (
    <FlowDialog
      flow={null}
      zones={lens.policy.zones}
      initial={flowDraftOf(creating.pair, zoneIds.src, zoneIds.dst)}
      onSave={saveFlow}
      onClose={() => setCreating(null)}
    />
  ) : null

  const failure = resolver.failure ? (
    <Alert severity='error' onClose={resolver.clearFailure} sx={{ mb: 1 }}>
      <Typography variant='body2' noWrap title={resolver.failure}>{resolver.failure}</Typography>
    </Alert>
  ) : null

  return {
    openCreate: (pair, verdict) => setCreating({ pair, verdict }),
    accept: suggestion => { void resolver.resolve([suggestion.id], 'accept') },
    busy: resolver.busy,
    dialog,
    failure,
  }
}

/** The status of a pair against the draft, as a chip with its explanation, and the write it calls for. */
export function MicrosegPairStatus({ pair, lens, actions }: { pair: LensRow; lens: TrafficLens; actions: PairActions }) {
  const t = useTranslations('microsegPilot.trafficLens')
  const { canWrite } = useMicrosegWrite()
  const verdictText = useVerdictText(lens)
  const verdict = lens.verdictOf(pair)
  const { status, suggestion } = verdict
  const canAccept = !!suggestion && (status === 'not_covered' || status === 'blocked')
  const canCreate = !canAccept && status === 'not_covered'

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
      <Tooltip title={verdictText(verdict, pair)} slotProps={{ tooltip: { sx: { whiteSpace: 'pre-line' } } }}>
        <Chip
          data-testid='microseg-status'
          data-status={status}
          label={t(STATUS_LABEL[status])}
          size='small'
          variant='outlined'
          sx={{ height: 20, fontSize: '0.65rem', fontWeight: 600, flexShrink: 0, ...STATUS_SX[status] }}
        />
      </Tooltip>
      {canAccept && (
        <WriteTip title={t('acceptTip')}>
          <Button
            size='small'
            disabled={!canWrite || actions.busy}
            onClick={only(() => actions.accept(suggestion))}
            startIcon={<i className='ri-check-line' style={{ fontSize: 14 }} />}
            sx={{ textTransform: 'none', fontSize: 12, py: 0, minWidth: 0 }}
          >
            {t('accept')}
          </Button>
        </WriteTip>
      )}
      {canCreate && (
        <WriteTip title={t('createFlowTip')}>
          <Button
            size='small'
            disabled={!canWrite}
            onClick={only(() => actions.openCreate(pair, verdict))}
            startIcon={<i className='ri-add-line' style={{ fontSize: 14 }} />}
            sx={{ textTransform: 'none', fontSize: 12, py: 0, minWidth: 0 }}
          >
            {t('createFlow')}
          </Button>
        </WriteTip>
      )}
    </Box>
  )
}
