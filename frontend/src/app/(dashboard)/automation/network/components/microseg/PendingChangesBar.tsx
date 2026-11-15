'use client'

import { Alert, Box, Button, CircularProgress } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { DiffKind, PolicyDiff } from '@/lib/microseg/pendingChanges'
import type { MicrosegPolicy } from '@/lib/microseg/types'
import { serviceTokenLabel } from '@/lib/network/serviceNames'

import DiscardDraft from './DiscardDraft'
import { flowService } from './FlowSummary'
import { useRunsInProgress } from './runsInProgress'
import { usePendingChanges } from './usePendingChanges'
import { WriteTip, useMicrosegWrite } from './microsegAccess'

type Props = {
  connectionId: string
  policy: MicrosegPolicy
  /** The plan view; the button is disabled while nothing handles it. */
  onOpenPlan?: () => void
  /** Names whose changes these are, where other pending changes sit next to them (the Firewalling table). */
  prefix?: string
}

const KINDS: DiffKind[] = ['added', 'changed', 'removed']
/** Up to this many zones are named in the bar; past it their count is given. */
export const NAMED_MAX = 2

type Values = Record<string, string | number>
/** What names the changes: the zones, the flows and the guests queued of the draft. */
type Draft = Pick<MicrosegPolicy, 'zones' | 'flows' | 'pending_members'>

function tally(kinds: ReadonlyMap<string, DiffKind>): Record<DiffKind, number> {
  const out: Record<DiffKind, number> = { added: 0, changed: 0, removed: 0 }
  for (const kind of kinds.values()) out[kind]++
  return out
}

const idsOf = (kinds: ReadonlyMap<string, DiffKind>, kind: DiffKind) => [...kinds].filter(([, k]) => k === kind).map(([id]) => id)

/** The zones of one kind: their names when there are few and all are known, else their count. */
function zonePart(diff: PolicyDiff, kind: DiffKind, count: number, draft: Draft | undefined, t: (key: string, values?: Values) => string): string {
  if (draft && count <= NAMED_MAX) {
    const known = new Map([...draft.zones, ...diff.removedZones].map(z => [z.id, z.name]))
    const names = (kind === 'removed' ? diff.removedZones.map(z => z.id) : idsOf(diff.zones, kind)).map(id => known.get(id))
    if (names.length === count && names.every(Boolean)) return t(`microsegPilot.pending.zonesNamed.${kind}`, { count, names: names.join(', ') })
  }
  return t(`microsegPilot.pending.zones.${kind}`, { count })
}

/** The flows of one kind: the flow itself when it is the only one ("web → db PostgreSQL"), else their count. */
function flowPart(diff: PolicyDiff, kind: DiffKind, count: number, draft: Draft | undefined, t: (key: string, values?: Values) => string): string {
  if (draft && count === 1) {
    const flow = kind === 'removed' ? diff.removedFlows[0] : draft.flows.find(f => f.id === idsOf(diff.flows, kind)[0])
    const zoneName = new Map([...draft.zones, ...diff.removedZones].map(z => [z.id, z.name]))
    const end = (zoneId: string, cidr: string) => zoneName.get(zoneId) ?? cidr
    const from = flow ? end(flow.src_zone_id, flow.src_cidr) : ''
    const to = flow ? end(flow.dst_zone_id, flow.dst_cidr) : ''
    if (flow && from && to) return t(`microsegPilot.pending.flowsNamed.${kind}`, { flow: `${from} → ${to} ${serviceTokenLabel(flowService(flow))}` })
  }
  return t(`microsegPilot.pending.flows.${kind}`, { count })
}

/** The guests queued: how many go to each zone when they go to few zones, else how many they are. */
function memberParts(diff: PolicyDiff, draft: Draft | undefined, t: (key: string, values?: Values) => string): string[] {
  if (diff.members === 0) return []
  if (draft) {
    const zoneName = new Map(draft.zones.map(z => [z.id, z.name]))
    const perZone = new Map<string, number>()
    for (const m of draft.pending_members) perZone.set(m.zone_id, (perZone.get(m.zone_id) ?? 0) + 1)
    const named = perZone.size <= NAMED_MAX && [...perZone.keys()].every(id => zoneName.has(id)) && draft.pending_members.length === diff.members
    if (named) return [...perZone].map(([id, count]) => t('microsegPilot.pending.membersTo', { count, zone: zoneName.get(id)! }))
  }
  return [t('microsegPilot.pending.members', { count: diff.members })]
}

/**
 * The parts of what is not applied yet: zones, flows then exceptions added, changed, removed, the member changes, the
 * tag prefix.
 * With the draft, the few things that change are named instead of counted: "zone lt04 changed", "flow web → db
 * PostgreSQL added", "1 guest to lt04".
 */
export function diffParts(diff: PolicyDiff, t: (key: string, values?: Values) => string, draft?: Draft): string[] {
  const zones = tally(diff.zones)
  const flows = tally(diff.flows)
  const exceptions = tally(diff.exceptions)
  const parts = [
    ...KINDS.filter(k => zones[k] > 0).map(k => zonePart(diff, k, zones[k], draft, t)),
    ...KINDS.filter(k => flows[k] > 0).map(k => flowPart(diff, k, flows[k], draft, t)),
    ...KINDS.filter(k => exceptions[k] > 0).map(k => t(`microsegPilot.pending.exceptions.${k}`, { count: exceptions[k] })),
    ...memberParts(diff, draft, t),
  ]
  if (diff.prefix) parts.push(t('microsegPilot.pending.tagPrefix'))
  return parts
}

/**
 * "Not applied yet: zone lt04 changed, 3 flows added · Nothing changes in Proxmox until you apply the plan · Discard ·
 * Review and apply" (UA11, UA58): the bar says the changes wait for the admin, names them, and marks the next step
 * (the plan window, which applies them) as the main button. The server
 * tells that something is pending; what is computed here, and only when it can be trusted: with no revision
 * (everything is added) or once the last revision's snapshot is loaded. Otherwise the bar says "Unapplied changes".
 * While a run writes them to Proxmox the bar says so and offers neither to discard them nor to plan them again.
 */
export default function PendingChangesBar({ connectionId, policy, onOpenPlan, prefix }: Props) {
  const t = useTranslations()
  const { pending, count, diff } = usePendingChanges(connectionId, policy)
  const { canWrite } = useMicrosegWrite()
  const { applying } = useRunsInProgress()

  if (!pending) return null
  const parts = diff ? diffParts(diff, t as (key: string, values?: Values) => string, policy) : []
  const prefixed = (text: string) => (prefix ? t('microsegPilot.pending.prefixed', { prefix, text }) : text)

  if (applying) {
    return (
      <Alert severity='info' icon={<CircularProgress size={18} />}>
        {prefixed(parts.length > 0
          ? t(prefix ? 'microsegPilot.pending.applyingInline' : 'microsegPilot.pending.applying', { list: parts.join(', ') })
          : t('microsegPilot.pending.applyingNoCount'))}
      </Alert>
    )
  }

  return (
    <Alert
      severity='warning'
      icon={<i className='ri-draft-line' />}
      action={(
        <>
          <DiscardDraft connectionId={connectionId} policy={policy} count={count} />
          <WriteTip>
            <Button variant='contained' color='warning' size='small' disableElevation onClick={onOpenPlan} disabled={!canWrite || !onOpenPlan} sx={{ ml: 1, whiteSpace: 'nowrap' }}>
              {t('microsegPilot.pending.viewPlan')}
            </Button>
          </WriteTip>
        </>
      )}
    >
      <Box component='span' sx={{ fontWeight: 600 }}>
        {prefixed(parts.length > 0
          // After a prefix ("Micro-segmentation: not applied yet: ..."), the sentence goes on in lower case.
          ? t(prefix ? 'microsegPilot.pending.whatWillChangeInline' : 'microsegPilot.pending.whatWillChange', { list: parts.join(', ') })
          : t('microsegPilot.pending.noCount'))}
      </Box>
      {/* What the admin has to know to act: nothing is written until the plan is applied. */}
      {' '}
      <Box component='span' data-testid='pending-until-applied' sx={{ opacity: 0.85 }}>{t('microsegPilot.pending.untilApplied')}</Box>
    </Alert>
  )
}
