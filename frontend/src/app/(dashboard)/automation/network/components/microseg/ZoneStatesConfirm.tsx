'use client'

import { useTranslations } from 'next-intl'

import { zoneEgress, type EgressState, type MicrosegZone, type ZoneState } from '@/lib/microseg/types'

import IPFilterEnforceLine from './IPFilterEnforceLine'
import TypedConfirmDialog from './TypedConfirmDialog'
import { useReadinessCheck } from './useZoneReadiness'
import type { ZoneGate } from './zoneGate'
import ZoneStateGate from './ZoneStateGate'

type Props = {
  connectionId: string
  /** Names the clusters of a shared policy in the details of the IP filter line. */
  clusterName?: (id: string) => string
  zone: MicrosegZone
  readyAfterHours: number
  /** The inbound state asked for, null when it does not change. */
  inbound: ZoneState | null
  /** The outbound state asked for, null when it does not change. */
  outbound: EgressState | null
  /** The isolation changed too: it goes to Proxmox with the state change. */
  isolationChanged: boolean
  /** The pending changes of the draft as they were before the dialog wrote anything. */
  gate?: ZoneGate
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}

type Texts = { title: string; line: string | null; confirm: string }

/**
 * The confirmation of the state changes of the zone dialog, with the same contents as the panel's: a move to blocking
 * (inbound or outbound) checks the readiness and asks the zone name when not ready; the other moves say what they do;
 * every one is refused while the draft had pending changes (the change applies the whole draft).
 */
export default function ZoneStatesConfirm({ connectionId, clusterName, zone, readyAfterHours, inbound, outbound, isolationChanged, gate, busy, onConfirm, onCancel }: Props) {
  const t = useTranslations('microsegPilot.policy')
  const inCheck = useReadinessCheck(connectionId, zone, readyAfterHours, { enabled: inbound === 'enforce' })
  const outCheck = useReadinessCheck(connectionId, zone, readyAfterHours, { direction: 'out', enabled: outbound === 'enforce' })
  const name = { name: zone.name }

  const inboundTexts = (state: ZoneState): Texts => (state === 'enforce'
    ? { title: t('enforce.title', name), line: null, confirm: t('enforce.confirm') }
    : { title: t(`state.title.${state}`, name), line: t(`state.body.${state}`), confirm: t(`state.confirm.${state}`) })

  const outboundTexts = (state: EgressState): Texts => {
    if (state === 'enforce') return { title: t('egressState.title.block', name), line: null, confirm: t('egressState.confirm.block') }
    if (state === 'off') return { title: t('zoneDialog.egressOffTitle', name), line: t('zoneDialog.egressOffBody'), confirm: t('zoneDialog.egressOffConfirm') }
    if (zoneEgress(zone) === 'enforce') return { title: t('egressState.title.reopen', name), line: t('egressState.reopenBody'), confirm: t('egressState.confirm.reopen') }
    return { title: t('zoneDialog.egressOnTitle', name), line: t('zoneDialog.egressOnBody'), confirm: t('zoneDialog.egressOnConfirm') }
  }

  const parts = [inbound ? inboundTexts(inbound) : null, outbound ? outboundTexts(outbound) : null].filter((p): p is Texts => p !== null)
  const both = parts.length > 1
  const lines = parts.map(p => p.line).filter((l): l is string => l !== null)
  if (isolationChanged) lines.push(t('zoneDialog.egressIsolateNote'))

  return (
    <TypedConfirmDialog
      title={both ? t('zoneDialog.statesTitle', name) : parts[0]?.title ?? ''}
      lines={lines}
      inputLabel={t('enforce.typeName', name)}
      expected={inCheck.needsName || outCheck.needsName ? zone.name : undefined}
      confirmLabel={both ? t('zoneDialog.statesConfirm') : parts[0]?.confirm ?? ''}
      color='warning'
      ready={!inCheck.loading && !outCheck.loading && !gate?.pending}
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      {inCheck.line}
      {outCheck.line}
      {inbound === 'enforce' && <IPFilterEnforceLine connectionId={connectionId} clusterName={clusterName} />}
      <ZoneStateGate pending={!!gate?.pending} count={gate?.count ?? null} onViewPlan={gate?.onViewPlan} discard={gate?.discard} />
    </TypedConfirmDialog>
  )
}
