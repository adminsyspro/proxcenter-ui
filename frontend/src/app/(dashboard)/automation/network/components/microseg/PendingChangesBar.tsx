'use client'

import { Alert, Button, CircularProgress } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { DiffKind, PolicyDiff } from '@/lib/microseg/pendingChanges'
import type { MicrosegPolicy } from '@/lib/microseg/types'

import DiscardDraft from './DiscardDraft'
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

function tally(kinds: ReadonlyMap<string, DiffKind>): Record<DiffKind, number> {
  const out: Record<DiffKind, number> = { added: 0, changed: 0, removed: 0 }
  for (const kind of kinds.values()) out[kind]++
  return out
}

/** The parts of "What will change": zones then flows added, changed, removed, the member changes, the tag prefix. */
export function diffParts(diff: PolicyDiff, t: (key: string, values?: Record<string, number>) => string): string[] {
  const zones = tally(diff.zones)
  const flows = tally(diff.flows)
  const parts = [
    ...KINDS.filter(k => zones[k] > 0).map(k => t(`microsegPilot.pending.zones.${k}`, { count: zones[k] })),
    ...KINDS.filter(k => flows[k] > 0).map(k => t(`microsegPilot.pending.flows.${k}`, { count: flows[k] })),
  ]
  if (diff.members > 0) parts.push(t('microsegPilot.pending.members', { count: diff.members }))
  if (diff.prefix) parts.push(t('microsegPilot.pending.tagPrefix'))
  return parts
}

/**
 * "What will change: 2 zones changed, 3 flows added, 1 flow removed · Discard · View plan" (UA11, UA58). The server
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
  const parts = diff ? diffParts(diff, t) : []
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
          <WriteTip><Button color='inherit' size='small' onClick={onOpenPlan} disabled={!canWrite || !onOpenPlan}>{t('microsegPilot.pending.viewPlan')}</Button></WriteTip>
        </>
      )}
    >
      {prefixed(parts.length > 0
        // After a prefix ("Micro-segmentation: what will change: ..."), the sentence goes on in lower case.
        ? t(prefix ? 'microsegPilot.pending.whatWillChangeInline' : 'microsegPilot.pending.whatWillChange', { list: parts.join(', ') })
        : t('microsegPilot.pending.noCount'))}
    </Alert>
  )
}
