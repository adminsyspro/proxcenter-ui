'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'

import { Box, ButtonBase, IconButton, Menu, MenuItem, Tooltip } from '@mui/material'

import type { RuleFields } from '@/lib/firewall/publishOps'
import type { MicrosegFlow, MicrosegPolicy, MicrosegZone, ZoneState } from '@/lib/microseg/types'

import PendingChangesBar from '../microseg/PendingChangesBar'
import PlanDialog from '../microseg/PlanDialog'
import RunStrip from '../microseg/RunStrip'
import ZoneStateChip from '../microseg/ZoneStateChip'
import { ZoneStateMenu } from '../microseg/ZoneRow'
import { ZoneStateConfirm, useFlowEditor } from '../microseg/ZonePanelActions'
import { WriteTip, useMicrosegWrite } from '../microseg/microsegAccess'
import type { TrackedRun } from '../microseg/microsegTabTypes'
import { useZoneEdits } from '../microseg/useZoneEdits'
import { RuleRow, SectionAddButton, type RuleRowProps } from './DfwTableParts'
import { matchZoneRule, type ZoneRuleMatch } from './zoneRuleMatch'

/**
 * The micro-segmentation draft edited from the Firewalling table: a zone group's rules are the flows into the zone,
 * edited with the dialogs and writes of the Micro-segmentation tab (useZoneEdits, its flow editor, its state
 * confirmation, its plan window). These writes go to the micro-segmentation draft, never to the Firewalling publish.
 */
type ZoneToolsValue = {
  zoneOf: (name: string) => MicrosegZone | undefined
  match: (rule: RuleFields, zoneName: string) => ZoneRuleMatch
  addFlow: (zone: MicrosegZone) => void
  editFlow: (flow: MicrosegFlow) => void
  removeFlow: (flow: MicrosegFlow) => void
  openStateMenu: (zone: MicrosegZone, anchor: HTMLElement) => void
}

const ZoneToolsContext = createContext<ZoneToolsValue | null>(null)

type Props = {
  connectionId: string
  /** The draft; while it is not read (or no zone exists) the table shows the engine's rules read-only. */
  policy: MicrosegPolicy | null | undefined
  reloadPolicy: () => Promise<unknown>
  /** A run (zone state, apply) finished: the firewall lists are read again, the zone groups changed in Proxmox. */
  onRunFinished: () => void
  children: ReactNode
}

export function ZoneTools({ policy, children, ...rest }: Props) {
  if (!policy) return <>{children}</>
  return <ZoneToolsWithPolicy policy={policy} {...rest}>{children}</ZoneToolsWithPolicy>
}

function ZoneToolsWithPolicy({ connectionId, policy, reloadPolicy, onRunFinished, children }: Props & { policy: MicrosegPolicy }) {
  const t = useTranslations('microsegPilot.dfw')
  const [runs, setRuns] = useState<TrackedRun[]>([])
  const [planOpen, setPlanOpen] = useState(false)
  const [stateMenu, setStateMenu] = useState<{ zone: MicrosegZone; anchor: HTMLElement } | null>(null)
  const [stateChange, setStateChange] = useState<{ zone: MicrosegZone; state: ZoneState } | null>(null)
  const startRun = useCallback((run: TrackedRun) => setRuns(prev => (prev.some(r => r.runId === run.runId) ? prev : [...prev, run])), [])
  const onOpenPlan = useCallback(() => setPlanOpen(true), [])
  const edits = useZoneEdits({ connectionId, policy, reloadPolicy, startRun, onOpenPlan })
  const flows = useFlowEditor(edits)
  const { create, edit, remove } = flows

  const value = useMemo<ZoneToolsValue>(() => ({
    zoneOf: name => policy.zones.find(z => z.name === name),
    match: (rule, zoneName) => matchZoneRule(rule, zoneName, policy.zones, policy.flows),
    // A zone's rule is a flow INTO it: the new flow starts with the zone as its destination.
    addFlow: zone => create({ dst_zone_id: zone.id }),
    editFlow: edit,
    removeFlow: remove,
    openStateMenu: (zone, anchor) => setStateMenu({ zone, anchor }),
  }), [policy, create, edit, remove])

  return (
    <ZoneToolsContext.Provider value={value}>
      <Box data-testid='dfw-microseg-pending'>
        <PendingChangesBar connectionId={connectionId} policy={policy} onOpenPlan={onOpenPlan} prefix={t('microsegPrefix')} />
      </Box>
      <RunStrip connectionId={connectionId} runs={runs} onFinished={() => { void reloadPolicy(); onRunFinished() }} onRemove={runId => setRuns(prev => prev.filter(r => r.runId !== runId))} />
      {children}
      {flows.dialogs}
      {stateMenu && <ZoneStateMenu zone={stateMenu.zone} anchor={stateMenu.anchor} onClose={() => setStateMenu(null)} onPick={state => setStateChange({ zone: stateMenu.zone, state })} />}
      {stateChange && <ZoneStateConfirm zone={stateChange.zone} state={stateChange.state} edits={edits} onClose={() => setStateChange(null)} />}
      <PlanDialog open={planOpen} connectionId={connectionId} policy={policy} reloadPolicy={reloadPolicy} startRun={startRun} onClose={() => setPlanOpen(false)} />
    </ZoneToolsContext.Provider>
  )
}

/** The state of a zone section: a chip that opens the state menu of the Policy tab, read-only without the draft. */
export function ZoneStateControl({ zoneName, fallback }: { zoneName: string; fallback: ReactNode }) {
  const t = useTranslations('microsegPilot.dfw')
  const tools = useContext(ZoneToolsContext)
  const { canWrite } = useMicrosegWrite()
  const zone = tools?.zoneOf(zoneName)
  if (!tools || !zone) return <>{fallback}</>
  return (
    <WriteTip title={t('changeZoneState', { zone: zone.name })}>
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
  const { canWrite } = useMicrosegWrite()
  const zone = tools?.zoneOf(zoneName)
  if (!tools || !zone) return null
  return <SectionAddButton title={title} open={open} disabled={!canWrite} onClick={() => tools.addFlow(zone)} />
}

/**
 * A rule of a zone group: the flow it is compiled from is edited and deleted from its menu or a double-click; the
 * rule of the members among themselves is a zone setting; a rule matching no flow of the draft keeps its lock.
 */
export function ZoneRuleRow({ zoneName, ...row }: RuleRowProps & { zoneName: string }) {
  const t = useTranslations('microsegPilot.dfw')
  const tools = useContext(ZoneToolsContext)
  const { canWrite } = useMicrosegWrite()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const match = tools?.match(row.rule, zoneName) ?? null
  if (!tools || match?.kind !== 'flow') {
    const lockTitle = match?.kind === 'intra' ? t('intraRule') : t('notInDraft')
    return <RuleRow {...row} lockTitle={tools ? lockTitle : undefined} />
  }
  const { flow } = match
  const menu = (
    <>
      <WriteTip title={t('ruleMenu')}>
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
      lockTitle={null}
      actions={menu}
      onDoubleClick={canWrite ? () => tools.editFlow(flow) : undefined}
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
