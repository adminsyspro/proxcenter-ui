'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'

import { Box, ButtonBase, IconButton, Menu, MenuItem, Tooltip } from '@mui/material'

import type { RuleFields } from '@/lib/firewall/publishOps'
import type { MicrosegFlow, MicrosegPolicy, MicrosegSnapshot, MicrosegZone, ZoneState } from '@/lib/microseg/types'

import PendingChangesBar from '../microseg/PendingChangesBar'
import PlanDialog from '../microseg/PlanDialog'
import RunStrip from '../microseg/RunStrip'
import ZoneStateChip from '../microseg/ZoneStateChip'
import { ZoneStateMenu } from '../microseg/ZoneRow'
import { ZoneStateConfirm, useFlowEditor } from '../microseg/ZonePanelActions'
import { MicrosegAccessProvider, WriteTip, useAccessHint, useMicrosegAccess, useMicrosegWrite, type MicrosegAccess } from '../microseg/microsegAccess'
import { RunsInProgressProvider, useTrackedRuns } from '../microseg/runsInProgress'
import { useZoneEdits } from '../microseg/useZoneEdits'
import { Badge, RuleRow, SectionAddButton, type RuleRowProps } from './DfwTableParts'
import { draftZoneOf, matchZoneRule, type ZoneRuleMatch } from './zoneRuleMatch'

/**
 * The micro-segmentation draft edited from the Firewalling table: a zone group's rules are the flows into the zone,
 * edited with the dialogs and writes of the Micro-segmentation tab (useZoneEdits, its flow editor, its state
 * confirmation, its plan window). These writes go to the micro-segmentation draft, never to the Firewalling publish.
 */
type ZoneToolsValue = {
  zoneOf: (name: string) => MicrosegZone | undefined
  match: (rule: RuleFields, zoneName: string, occurrence: number) => ZoneRuleMatch
  addFlow: (zone: MicrosegZone) => void
  editFlow: (flow: MicrosegFlow) => void
  removeFlow: (flow: MicrosegFlow) => void
  openStateMenu: (zone: MicrosegZone, anchor: HTMLElement) => void
  /** The write access of the micro-segmentation policy (on a shared one, the right on every cluster). */
  access: MicrosegAccess
}

const ZoneToolsContext = createContext<ZoneToolsValue | null>(null)

/**
 * The right of a zone control of the table: the page's (the selected connection), and on a shared policy the right on
 * every cluster of the policy. Only these controls follow the policy: the Proxmox rules of the table keep the page's.
 */
function useZoneToolsWrite(tools: ZoneToolsValue | null): { canWrite: boolean; hint: string } {
  const page = useMicrosegWrite()
  const hint = useAccessHint(tools?.access ?? null)
  return tools && page.canWrite ? { canWrite: tools.access.canWrite, hint } : page
}

/** No micro-segmentation write: the page refuses its connection. */
const NO_WRITE: Omit<MicrosegAccess, 'everyCluster'> = { canWrite: false, canWriteOn: () => false, canWriteSome: false }

type Props = {
  connectionId: string
  /** The draft; while it is not read (or no zone exists) the table shows the engine's rules read-only. */
  policy: MicrosegPolicy | null | undefined
  /** The last applied revision: the rules on Proxmox are compiled from it, so they are matched against it first. */
  deployed: MicrosegSnapshot | null
  reloadPolicy: () => Promise<unknown>
  /** A run (zone state, apply) finished: the firewall lists are read again, the zone groups changed in Proxmox. */
  onRunFinished: () => void
  children: ReactNode
}

export function ZoneTools({ policy, children, ...rest }: Props) {
  if (!policy) return <>{children}</>
  return <ZoneToolsWithPolicy policy={policy} {...rest}>{children}</ZoneToolsWithPolicy>
}

function ZoneToolsWithPolicy({ connectionId, policy, deployed, reloadPolicy, onRunFinished, children }: Props & { policy: MicrosegPolicy }) {
  const t = useTranslations('microsegPilot.dfw')
  const { runs, startRun, endRun, removeRun, inProgress } = useTrackedRuns()
  const [planOpen, setPlanOpen] = useState(false)
  const [stateMenu, setStateMenu] = useState<{ zone: MicrosegZone; anchor: HTMLElement } | null>(null)
  const [stateChange, setStateChange] = useState<{ zone: MicrosegZone; state: ZoneState } | null>(null)
  // A finished run (state change, apply): the draft once, the firewall lists once (the zone groups changed in Proxmox).
  const refresh = useRef({ reloadPolicy, onRunFinished })
  useEffect(() => { refresh.current = { reloadPolicy, onRunFinished } })
  const runFinished = useCallback((runId: string) => {
    endRun(runId)
    void refresh.current.reloadPolicy()
    refresh.current.onRunFinished()
  }, [endRun])
  const onOpenPlan = useCallback(() => setPlanOpen(true), [])
  const edits = useZoneEdits({ connectionId, policy, reloadPolicy, startRun, onOpenPlan })
  const flows = useFlowEditor(edits)
  const { create, edit, remove } = flows
  // The clusters of the draft already read: no request of its own.
  const linkedIds = useMemo(() => (policy.clusters ?? []).map(c => c.connection_id), [policy.clusters])
  const policyAccess = useMicrosegAccess(connectionId, linkedIds)
  // The page's right on its connection first (read-only stays read-only), then the policy's.
  const pageCanWrite = useMicrosegWrite().canWrite
  const access = useMemo<MicrosegAccess>(() => (pageCanWrite ? policyAccess : { ...NO_WRITE, everyCluster: false }), [pageCanWrite, policyAccess])

  const value = useMemo<ZoneToolsValue>(() => ({
    zoneOf: name => draftZoneOf(name, policy, deployed),
    match: (rule, zoneName, occurrence) => matchZoneRule(rule, zoneName, policy, deployed, occurrence),
    // A zone's rule is a flow INTO it: the new flow starts with the zone as its destination.
    addFlow: zone => create({ dst_zone_id: zone.id }),
    editFlow: edit,
    removeFlow: remove,
    openStateMenu: (zone, anchor) => setStateMenu({ zone, anchor }),
    access,
  }), [policy, deployed, create, edit, remove, access])

  return (
    <ZoneToolsContext.Provider value={value}>
    <RunsInProgressProvider value={inProgress}>
      {/* The micro-segmentation writes around the table follow the policy; the table (children) keeps the page's rights. */}
      <MicrosegAccessProvider value={access}>
        <Box data-testid='dfw-microseg-pending'>
          <PendingChangesBar connectionId={connectionId} policy={policy} onOpenPlan={onOpenPlan} prefix={t('microsegPrefix')} />
        </Box>
        <RunStrip connectionId={connectionId} runs={runs} onFinished={runFinished} onRemove={removeRun} />
      </MicrosegAccessProvider>
      {children}
      <MicrosegAccessProvider value={access}>
        {flows.dialogs}
        {stateMenu && <ZoneStateMenu zone={stateMenu.zone} anchor={stateMenu.anchor} onClose={() => setStateMenu(null)} onPick={state => setStateChange({ zone: stateMenu.zone, state })} />}
        {stateChange && <ZoneStateConfirm zone={stateChange.zone} state={stateChange.state} edits={edits} onClose={() => setStateChange(null)} />}
        <PlanDialog open={planOpen} connectionId={connectionId} policy={policy} reloadPolicy={reloadPolicy} startRun={startRun} onClose={() => setPlanOpen(false)} />
      </MicrosegAccessProvider>
    </RunsInProgressProvider>
    </ZoneToolsContext.Provider>
  )
}

/** The state of a zone section: a chip that opens the state menu of the Policy tab, read-only without the draft. */
export function ZoneStateControl({ zoneName, fallback }: { zoneName: string; fallback: ReactNode }) {
  const t = useTranslations('microsegPilot.dfw')
  const tools = useContext(ZoneToolsContext)
  const { canWrite, hint } = useZoneToolsWrite(tools)
  const zone = tools?.zoneOf(zoneName)
  if (!tools || !zone) return <>{fallback}</>
  return (
    <WriteTip allowed={canWrite} hint={hint} title={t('changeZoneState', { zone: zone.name })}>
      <ButtonBase disabled={!canWrite} aria-label={t('changeZoneState', { zone: zone.name })} aria-haspopup='menu'
        onClick={e => tools.openStateMenu(zone, e.currentTarget)} sx={{ borderRadius: 4 }}>
        <ZoneStateChip state={zone.state} />
      </ButtonBase>
    </WriteTip>
  )
}

/** The Add rule of a zone section: a new flow into the zone. */
export function ZoneAddFlow({ zoneName, title, open }: { zoneName: string; title: string; open: boolean }) {
  const tools = useContext(ZoneToolsContext)
  const { canWrite } = useZoneToolsWrite(tools)
  const zone = tools?.zoneOf(zoneName)
  if (!tools || !zone) return null
  return <SectionAddButton title={title} open={open} disabled={!canWrite} onClick={() => tools.addFlow(zone)} />
}

/**
 * A rule of a zone group: the flow it is compiled from is edited and deleted from its menu or a double-click; the
 * rule of the members among themselves is a zone setting; the rule of an exception names it (edited in its zone); a
 * rule matching no flow of the draft keeps its lock.
 */
/** A double-click on a control of the row (checkbox, switch, button, link) is that control's, not the row's. */
const onControl = (e: ReactMouseEvent) => !!(e.target as HTMLElement).closest('button, input, a, [role="switch"], [role="checkbox"], [role="combobox"]')

function lockTitleOf(match: ZoneRuleMatch, t: ReturnType<typeof useTranslations<'microsegPilot.dfw'>>): string {
  if (match?.kind === 'intra') return t('intraRule')
  if (match?.kind === 'removed') return t('removalPending')
  if (match?.kind === 'known') return t('knownZoneRule', { zone: match.zone.name })
  if (match?.kind === 'exception') {
    const name = (g: { name: string; vmid: number }) => g.name || String(g.vmid)
    return t(match.removed ? 'exceptionRuleRemoved' : 'exceptionRule', { source: name(match.source), destination: name(match.destination) })
  }
  return t('notInDraft')
}

export function ZoneRuleRow({ zoneName, occurrence, ...row }: RuleRowProps & { zoneName: string; occurrence: number }) {
  const t = useTranslations('microsegPilot.dfw')
  const tools = useContext(ZoneToolsContext)
  const { canWrite, hint } = useZoneToolsWrite(tools)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const match = tools?.match(row.rule, zoneName, occurrence) ?? null
  if (!tools || match?.kind !== 'flow') {
    return <RuleRow {...row} lockTitle={tools ? lockTitleOf(match, t) : undefined} struck={match?.kind === 'removed' || (match?.kind === 'exception' && match.removed)} />
  }
  const { flow, changed } = match
  // Still the engine's rule: the lock stays, it says the rule is edited as its flow.
  const menu = (
    <>
      {changed && <Badge label={t('flowChanged')} tone='warning' title={t('flowChangedHint')} />}
      <WriteTip allowed={canWrite} hint={hint} title={t('ruleMenu')}>
        <IconButton size='small' aria-label={t('ruleMenu')} aria-haspopup='menu' disabled={!canWrite} onClick={e => setAnchor(e.currentTarget)}>
          <i className='ri-more-2-fill' style={{ fontSize: 14 }} />
        </IconButton>
      </WriteTip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        <MenuItem sx={{ fontSize: 13 }} onClick={() => { setAnchor(null); tools.editFlow(flow) }}>{t('editFlow')}</MenuItem>
        <MenuItem sx={{ fontSize: 13, color: 'error.main' }} onClick={() => { setAnchor(null); tools.removeFlow(flow) }}>{t('deleteFlow')}</MenuItem>
      </Menu>
    </>
  )
  return (
    <RuleRow
      {...row}
      lockTitle={t('engineFlowRule')}
      actions={menu}
      onDoubleClick={canWrite ? e => { if (!onControl(e)) tools.editFlow(flow) } : undefined}
    />
  )
}

/** The engine's zone group rule of a guest: its zone is edited in the zone's section. */
export function EditZoneButton({ onClick }: { onClick: () => void }) {
  const t = useTranslations('microsegPilot.dfw')
  return (
    <Tooltip title={t('editZone')}>
      <IconButton size='small' aria-label={t('editZone')} onClick={onClick}>
        <i className='ri-pencil-line' style={{ fontSize: 14 }} />
      </IconButton>
    </Tooltip>
  )
}
