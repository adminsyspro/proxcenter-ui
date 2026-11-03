'use client'

import { Fragment, useMemo, useState, type DragEvent, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'

import { Alert, Box, IconButton, LinearProgress, Link, Menu, MenuItem, Paper, Table, TableBody, TableContainer, Typography, useTheme } from '@mui/material'

import * as firewallAPI from '@/lib/api/firewall'
import type { VMFirewallInfo } from '@/hooks/useVMFirewallRules'
import { useToast } from '@/contexts/ToastContext'
import FirewallLogDialog from '@/components/firewall/FirewallLogDialog'
import {
  addRule, cloneRules, currentEntries, enableGuestFirewall, entryStates, moveRule, moveRulesToScope, removeRules,
  scopeDraftOf, setScopeOptions, shiftRules, toFields, updateRules,
  type DraftEntry, type EntryState, type FirewallDraft,
} from '@/lib/firewall/draft'
import { isEngineComment, scopeKey, type DraftScope, type PublishOp, type PublishResult, type RuleFields, type ScopeOptions } from '@/lib/firewall/publishOps'
import { useMicrosegEvents } from '@/lib/microseg/useMicrosegEvents'
import { useMicrosegPolicy } from '@/lib/microseg/useMicroseg'
import { useLastRevisionSnapshot } from '@/lib/microseg/useLastRevision'
import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'

import MicrosegConfirmDialog from '../microseg/MicrosegConfirmDialog'
import { useMicrosegWrite, WriteTip } from '../microseg/microsegAccess'
import { useNow } from '../microseg/useNow'
import RuleFormDialog, { type RuleFormData } from './RuleFormDialog'
import GroupPager, { GROUP_PAGE_SIZE, pageCount, useGroupPages } from './shared/GroupPager'
import { ZONE_GROUP_PREFIX } from './shared/groupMembership'
import { DfwHead, RuleRow, SectionRow, WideRow, Badge } from './DfwTableParts'
import { ActionBar, StatusBar, ViewToolbar } from './DfwToolbar'
import { AddSectionDialog, MoveToSectionDialog, ScopeOptionsDialog, type SectionTarget } from './DfwDialogs'
import {
  UNTAGGED, coveredCount, guestMatches, hitsIndex, ruleHits, ruleMatches, showsCluster, showsGuests, showsHosts, vlanGroups, zoneSections,
  type ScopeFilter, type ZoneSection,
} from './dfwModel'
import { useFirewallDraft } from './useFirewallDraft'
import { useSectionRules } from './useSectionRules'

type Rules = firewallAPI.FirewallRule[]

export type FirewallingViewProps = {
  connectionId: string
  connectionName?: string
  firewallMode: firewallAPI.FirewallMode
  nodesList: string[]
  clusterRules: Rules
  setClusterRules: React.Dispatch<React.SetStateAction<Rules>>
  clusterOptions: firewallAPI.ClusterOptions | null
  setClusterOptions: React.Dispatch<React.SetStateAction<firewallAPI.ClusterOptions | null>>
  hostRulesByNode: Record<string, Rules>
  setHostRulesByNode: React.Dispatch<React.SetStateAction<Record<string, Rules>>>
  /** The guests listed (filtered by the Dashboard link when it applies). */
  guests: VMFirewallInfo[]
  setVMFirewallData: React.Dispatch<React.SetStateAction<VMFirewallInfo[]>>
  loadingVMRules: boolean
  loadGuestRules: (vm: VMFirewallInfo) => Promise<Rules>
  securityGroups: firewallAPI.SecurityGroup[]
  aliases: firewallAPI.Alias[]
  ipsets: firewallAPI.IPSet[]
  initialScope: ScopeFilter
  /** A filter set from outside (the Dashboard link): every VLAN group back to its first page. */
  listFilter?: string | null
  reloadFirewall: () => void
  reloadGuests: () => Promise<void>
  onOpenMicroseg?: () => void
}

/** One section of the table: a scope of Proxmox, or a zone group of the engine (read-only). */
type Section = {
  key: string
  kind: 'zone' | 'cluster' | 'host' | 'guest'
  title: string
  scope: DraftScope | null
  /** The rules as read, null while not read. */
  base: Rules | null
  entries: DraftEntry[]
  states: Map<string, EntryState>
  managed: boolean
  pending: number
  appliedTo: string
  zone?: ZoneSection
  guest?: VMFirewallInfo
  node?: string
  /** The list read now is not the one the draft was made on. */
  stale: boolean
}

type Editor = { sectionKey: string; entryId: string | null; form: RuleFormData }
type Drag = { sectionKey: string; id: string; overId: string | null } | null

const NEW_RULE: RuleFields = { type: 'in', action: 'ACCEPT', enable: 1, source: '', dest: '', proto: '', dport: '', sport: '', macro: '', iface: '', log: 'nolog', comment: '' }

const selKey = (sectionKey: string, id: string) => `${sectionKey}|${id}`
const splitSel = (k: string): [string, string] => {
  const at = k.lastIndexOf('|')
  return [k.slice(0, at), k.slice(at + 1)]
}

const guestScope = (vm: VMFirewallInfo): DraftScope => ({ kind: 'guest', node: vm.node, vmType: vm.type, vmid: vm.vmid })
const digestOf = (rules: Rules | null) => rules?.find(r => typeof r.digest === 'string')?.digest ?? ''

function buildSection(
  base: Omit<Section, 'entries' | 'states' | 'pending' | 'stale' | 'managed'> & { managed?: boolean },
  draft: FirewallDraft,
  pendingOf: (scope: DraftScope) => number,
): Section {
  if (!base.scope) {
    return { ...base, managed: true, entries: (base.base ?? []).map((r, i) => ({ id: `b${i}`, rule: toFields(r) })), states: new Map(), pending: 0, stale: false }
  }
  const sd = scopeDraftOf(draft, base.scope)
  return {
    ...base,
    managed: base.managed ?? false,
    entries: currentEntries(draft, base.scope, base.base),
    states: entryStates(sd),
    pending: pendingOf(base.scope),
    stale: !!sd?.base && base.base !== null && digestOf(base.base) !== sd.baseDigest,
  }
}

/** Applies what a publish wrote to the lists the page holds: no new read for what the server already re-read. */
function applyPublished(result: PublishResult, ops: PublishOp[], p: FirewallingViewProps, setNodeOptions: (node: string, o: ScopeOptions) => void) {
  for (const [key, value] of Object.entries(result.scopes)) {
    if (!value.rules || key.includes('#')) continue
    const rules = value.rules as Rules
    if (key === 'cluster') p.setClusterRules(rules)
    else if (key.startsWith('host:')) p.setHostRulesByNode(prev => ({ ...prev, [key.slice(5)]: rules }))
    else p.setVMFirewallData(prev => prev.map(v => (`guest:${v.type}/${v.vmid}` === key ? { ...v, rules, rulesLoaded: true } : v)))
  }
  ops.slice(0, result.applied).forEach(op => {
    if (op.kind === 'options.set') {
      if (op.scope.kind === 'cluster') p.setClusterOptions(prev => ({ ...prev, ...op.options }))
      else if (op.scope.kind === 'host') setNodeOptions(op.scope.node, op.options)
      else {
        const { vmid } = op.scope
        p.setVMFirewallData(prev => prev.map(v => (v.vmid === vmid ? patchGuest(v, op.options) : v)))
      }
    } else if (op.kind === 'guest.enable') {
      const { vmid } = op.scope
      p.setVMFirewallData(prev => prev.map(v => (v.vmid === vmid ? { ...patchGuest(v, { enable: 1 }), nicFirewallEnabled: true, firewallEnabled: true } : v)))
    }
  })
}

/** The set with `key` added, or removed when it was there. */
function toggled(set: Set<string>, key: string): Set<string> {
  const next = new Set(set)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

/** The fixed sections a scope filter shows: the zone groups and the cluster, then the hosts. */
function fixedFor(scope: ScopeFilter, cluster: Section[], zones: Section[], hosts: Section[]): Section[] {
  return [...(showsCluster(scope) ? [...zones, ...cluster] : []), ...(showsHosts(scope) ? hosts : [])]
}

/** The figures of the status bar: rules of the sections read, disabled ones, sections in the scope. */
function statusFigures(fixed: Section[], loadedGuests: Section[], guestCount: number, guestsShown: boolean) {
  const counted = [...fixed.filter(s => s.base !== null), ...loadedGuests]
  return {
    total: counted.reduce((n, s) => n + s.entries.length, 0),
    disabled: counted.reduce((n, s) => n + s.entries.filter(e => e.rule.enable !== 1).length, 0),
    partial: fixed.some(s => s.base === null) || (guestsShown && loadedGuests.length < guestCount),
    sections: fixed.length + (guestsShown ? guestCount : 0),
  }
}

/** The page of each VLAN group; a filter set from outside starts every group again from its first page. */
function usePagesFor(listFilter: string | null) {
  const pager = useGroupPages()
  const [pagedFilter, setPagedFilter] = useState(listFilter)
  if (pagedFilter !== listFilter) {
    setPagedFilter(listFilter)
    pager.reset()
  }
  return pager
}

/**
 * The micro-segmentation side of the table: the deployed zones (mode, members) and the hits of their rules, from the
 * orchestrator only (no Proxmox call), read only when the connection has zone groups.
 */
function useZones(connectionId: string, groups: firewallAPI.SecurityGroup[], guests: VMFirewallInfo[]) {
  const hasZones = groups.some(g => g.group.startsWith(ZONE_GROUP_PREFIX))
  const zoneConnection = hasZones ? connectionId : null
  const { data: policy } = useMicrosegPolicy(zoneConnection)
  const { revision } = useLastRevisionSnapshot(zoneConnection, policy?.last_revision?.id)
  const deployed = revision?.snapshot ?? null
  const events = useMicrosegEvents(connectionId, { zone: '', verdict: '', q: '' }, hasZones)
  const now = useNow(60_000, events.events)
  const hits = useMemo(() => (hasZones ? hitsIndex(events.events, events.truncated, now) : null), [hasZones, events.events, events.truncated, now])
  const zones = useMemo(() => zoneSections(groups, deployed, guests), [groups, deployed, guests])
  return { deployed, hits, zones }
}

function Notices({ error, onCloseError, notice, onCloseNotice }: {
  error: { message: string; code?: string; applied?: number } | null
  onCloseError: () => void
  notice: string | null
  onCloseNotice: () => void
}) {
  return (
    <>
      {error && <PublishErrorAlert error={error} onClose={onCloseError} />}
      {notice && <Alert severity='info' onClose={onCloseNotice}>{notice}</Alert>}
    </>
  )
}

/** Why the last publish stopped, on one line. */
function PublishErrorAlert({ error, onClose }: { error: { message: string; code?: string; applied?: number }; onClose: () => void }) {
  const t = useTranslations('microsegPilot.dfw')
  const head = error.applied === undefined ? '' : `${t('publishFailed', { applied: error.applied })} `
  return (
    <Alert severity='error' onClose={onClose} data-testid='dfw-publish-error'>
      {head}{error.code === 'DIGEST_CONFLICT' ? t('conflict') : error.message}
    </Alert>
  )
}

function patchGuest(v: VMFirewallInfo, options: ScopeOptions): VMFirewallInfo {
  const merged = { ...v.options, ...options }
  const optionsEnabled = Number(merged.enable) === 1
  return { ...v, options: merged, optionsEnabled, firewallEnabled: optionsEnabled && v.nicFirewallEnabled }
}

export default function FirewallingView(p: FirewallingViewProps) {
  const t = useTranslations('microsegPilot.dfw')
  const tg = useTranslations()
  const theme = useTheme()
  const { showToast } = useToast()
  const { canWrite: mayWrite } = useMicrosegWrite()
  const canWrite = mayWrite && !!p.connectionId

  const fw = useFirewallDraft(p.connectionId)
  const lazy = useSectionRules({ connectionId: p.connectionId, hostRulesByNode: p.hostRulesByNode, setHostRulesByNode: p.setHostRulesByNode, loadGuestRules: p.loadGuestRules })

  const [scope, setScope] = useState<ScopeFilter>(p.initialScope)
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState<Set<string>>(() => new Set(['cluster']))
  const [openVlans, setOpenVlans] = useState<Set<string>>(() => new Set())
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [editor, setEditor] = useState<Editor | null>(null)
  const [drag, setDrag] = useState<Drag>(null)
  const [dialog, setDialog] = useState<'move' | 'addSection' | 'confirmPublish' | 'discard' | null>(null)
  const [optionsFor, setOptionsFor] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<{ key: string; anchor: HTMLElement } | null>(null)
  const [logVm, setLogVm] = useState<VMFirewallInfo | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmCount, setConfirmCount] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const pager = usePagesFor(p.listFilter ?? null)

  // Micro-segmentation: the deployed zones (their mode, their members) and the engine's events, from the
  // orchestrator only (no Proxmox call), read only when the connection has zone groups.
  const { deployed, hits, zones } = useZones(p.connectionId, p.securityGroups, p.guests)

  const pendingOf = (s: DraftScope) => opsOn(fw.ops, s)

  // ── Sections ──
  const clusterSection = buildSection({
    key: 'cluster', kind: 'cluster', title: t('section.cluster'), scope: { kind: 'cluster' }, base: p.clusterRules, appliedTo: t('appliedTo.cluster'),
  }, fw.draft, pendingOf)
  const zoneList = zones.map(z => buildSection({
    key: `zone:${z.group}`, kind: 'zone', title: t('section.zone', { zone: z.zone }), scope: null, base: z.rules ?? [], zone: z,
    appliedTo: z.members === null ? t('appliedTo.zoneUnknown', { zone: z.zone }) : t('appliedTo.zone', { count: z.members }),
  }, fw.draft, pendingOf))
  const hostList = p.nodesList.map(node => buildSection({
    key: `host:${node}`, kind: 'host', title: t('section.host', { node }), scope: { kind: 'host', node }, base: p.hostRulesByNode[node] ?? null, node, appliedTo: node,
  }, fw.draft, pendingOf))
  const guestSection = (vm: VMFirewallInfo) => {
    const s = guestScope(vm)
    const ruleCarrier = vm.rulesLoaded ? vm.rules : null
    return buildSection({ key: scopeKey(s), kind: 'guest', title: `${vm.name} (${vm.vmid})`, scope: s, base: ruleCarrier, guest: vm, appliedTo: vm.name }, fw.draft, pendingOf)
  }
  const standalone = p.firewallMode === 'standalone'
  const clusterIfAny = standalone ? [] : [clusterSection]
  const fixedSections: Section[] = [...clusterIfAny, ...zoneList, ...hostList]
  const sectionByKey = (key: string): Section | null => {
    const fixed = fixedSections.find(s => s.key === key)
    if (fixed) return fixed
    const vm = p.guests.find(g => scopeKey(guestScope(g)) === key)
    return vm ? guestSection(vm) : null
  }

  /** The rules of the section are known: read, or held by the draft (restored after a reload). */
  const hasRules = (s: Section) => s.base !== null || (!!s.scope && !!scopeDraftOf(fw.draft, s.scope)?.rules)

  const q = filter.trim()
  const visibleEntries = (s: Section) => s.entries.map((e, i) => ({ e, i })).filter(({ e }) => ruleMatches(e.rule, q))
  const sectionShown = (s: Section) => !q || s.title.toLowerCase().includes(q.toLowerCase()) || visibleEntries(s).length > 0
  const shownGuests = p.guests.filter(vm => guestMatches(vm, q) || (vm.rulesLoaded && vm.rules.some(r => ruleMatches(toFields(r), q))))
  const groups = vlanGroups(shownGuests)

  // ── Status bar figures ──
  const guestsShown = showsGuests(scope)
  const inScope = fixedFor(scope, clusterIfAny, zoneList, hostList)
  const figures = statusFigures(inScope, guestsShown ? p.guests.filter(vm => vm.rulesLoaded).map(guestSection) : [], p.guests.length, guestsShown)
  const covered = p.guests.length > 0 ? coveredCount(p.guests) : null

  // ── Selection ──
  const selection = useMemo(() => {
    const bySection = new Map<string, string[]>()
    for (const k of selected) {
      const [sectionKey, id] = splitSel(k)
      bySection.set(sectionKey, [...(bySection.get(sectionKey) ?? []), id])
    }
    return bySection
  }, [selected])
  const toggleSel = (sectionKey: string, ids: string[], on: boolean) => setSelected(prev => {
    const next = new Set(prev)
    for (const id of ids) {
      if (on) next.add(selKey(sectionKey, id))
      else next.delete(selKey(sectionKey, id))
    }
    return next
  })

  /** Applies a change to every section holding checked rules. */
  const onSelection = (change: (d: FirewallDraft, s: Section & { scope: DraftScope }, ids: string[]) => FirewallDraft) => {
    fw.update(d => [...selection.entries()].reduce((acc, [key, ids]) => {
      const s = sectionByKey(key)
      return s?.scope && !s.managed ? change(acc, s as Section & { scope: DraftScope }, ids) : acc
    }, d))
  }

  // ── Opening sections (the rules of a host or a guest are read the first time it opens) ──
  const toggleSection = (s: Section) => {
    const opening = !open.has(s.key)
    setOpen(prev => toggled(prev, s.key))
    if (!opening) return
    if (s.kind === 'host' && s.node) void lazy.openHost(s.node)
    if (s.kind === 'guest' && s.guest) void lazy.openGuest(s.guest)
  }

  // ── Editor ──
  const openEditor = (s: Section, entry: DraftEntry | null) => {
    if (!canWrite || !s.scope || s.managed) return
    setEditor({ sectionKey: s.key, entryId: entry?.id ?? null, form: { ...(entry?.rule ?? NEW_RULE) } })
  }
  const saveEditor = () => {
    if (!editor) return
    const s = sectionByKey(editor.sectionKey)
    if (!s?.scope) return
    const fields = toFields(editor.form)
    const sc = s.scope
    fw.update(d => (editor.entryId ? updateRules(d, sc, s.base, [editor.entryId], fields) : addRule(d, sc, s.base, fields, 0)))
    setOpen(prev => new Set(prev).add(s.key))
    setEditor(null)
  }

  // ── Drag and drop, inside a section ──
  const dragFor = (s: Section, entry: DraftEntry, index: number) => {
    const enabled = canWrite && !s.managed && !isEngineComment(entry.rule.comment) && !q
    return {
      enabled,
      dragging: drag?.sectionKey === s.key && drag.id === entry.id,
      over: drag?.sectionKey === s.key && drag.overId === entry.id && drag.id !== entry.id,
      onDragStart: (e: DragEvent) => {
        if (!enabled) return
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', entry.id)
        setDrag({ sectionKey: s.key, id: entry.id, overId: null })
      },
      onDragOver: (e: DragEvent) => {
        if (drag?.sectionKey !== s.key) return
        e.preventDefault()
        if (drag.overId !== entry.id) setDrag({ ...drag, overId: entry.id })
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault()
        if (drag?.sectionKey === s.key && drag.id !== entry.id && s.scope) {
          const sc = s.scope
          fw.update(d => moveRule(d, sc, s.base, drag.id, index))
        }
        setDrag(null)
      },
      onDragEnd: () => setDrag(null),
    }
  }

  // ── Publish ──
  const publish = async (confirmed: boolean) => {
    const sentOps = fw.ops
    const outcome = await fw.publish(confirmed)
    if (outcome.status === 'confirm') {
      setConfirmCount(outcome.count)
      return setDialog('confirmPublish')
    }
    setDialog(null)
    if (outcome.status === 'refused') return
    applyPublished(outcome.result, sentOps, p, (node, o) => lazy.setNodeOptions(prev => ({ ...prev, [node]: { ...prev[node], ...o } })))
    setSelected(new Set())
    if (outcome.status === 'published' && outcome.result.applied < sentOps.length) {
      setNotice(t('publishedPart', { applied: outcome.result.applied, total: sentOps.length }))
    } else if (outcome.status === 'published') {
      setNotice(null)
      showToast(t('published', { count: outcome.result.applied }), 'success')
    }
  }

  const refresh = async () => {
    setRefreshing(true)
    try {
      p.reloadFirewall()
      await p.reloadGuests()
      // The sections already read, and only them, one after the other.
      for (const node of Object.keys(p.hostRulesByNode)) await lazy.readHost(node)
      for (const vm of p.guests.filter(g => g.rulesLoaded && open.has(scopeKey(guestScope(g))))) await lazy.readGuest(vm)
    } finally {
      setRefreshing(false)
    }
  }

  // ── Section targets (Move to, Add section) ──
  const writableTargets: SectionTarget[] = [
    ...clusterIfAny.map(s => ({ key: s.key, label: s.title, scope: s.scope!, loaded: true })),
    ...hostList.map(s => ({ key: s.key, label: s.title, scope: s.scope!, loaded: hasRules(s) })),
    ...p.guests.map(vm => ({ key: scopeKey(guestScope(vm)), label: `${vm.name} (${vm.vmid}) · ${vm.node}`, scope: guestScope(vm), loaded: vm.rulesLoaded || !!scopeDraftOf(fw.draft, guestScope(vm))?.rules })),
  ]

  const addSection = async (target: SectionTarget) => {
    setDialog(null)
    if (target.scope.kind === 'host') await lazy.openHost(target.scope.node)
    if (target.scope.kind === 'guest') {
      const vm = p.guests.find(g => scopeKey(guestScope(g)) === target.key)
      if (vm) await lazy.openGuest(vm)
    }
    setOpen(prev => new Set(prev).add(target.key))
    setEditor({ sectionKey: target.key, entryId: null, form: { ...NEW_RULE } })
  }

  // ── Options of a scope ──
  const sectionOrNull = (key: string | null | undefined) => (key ? sectionByKey(key) : null)
  const optionsSection = sectionOrNull(optionsFor)
  const currentOptions = (s: Section): ScopeOptions => {
    const read: ScopeOptions = readOptions(s, p.clusterOptions, lazy.nodeOptions)
    return { ...read, ...(s.scope ? scopeDraftOf(fw.draft, s.scope)?.options : undefined) }
  }
  const saveOptions = (s: Section, form: ScopeOptions) => {
    if (!s.scope) return
    const sc = s.scope
    const read = readOptions(s, p.clusterOptions, lazy.nodeOptions)
    fw.update(d => {
      let next = setScopeOptions(d, sc, read, form)
      if (s.guest && form.enable === 1 && !s.guest.nicFirewallEnabled) next = enableGuestFirewall(next, sc)
      return next
    })
    setOptionsFor(null)
  }

  // ── Rendering ──
  const hitsTitle = (s: Section) => {
    if (s.kind !== 'zone') return t('hitsNone')
    return hits?.partial ? t('hitsPartial') : t('hitsZone')
  }

  const patchRule = (s: Section, id: string, fields: Partial<RuleFields>) => {
    const sc = s.scope
    if (sc) fw.update(d => updateRules(d, sc, s.base, [id], fields))
  }

  const renderRules = (s: Section): ReactNode => {
    if (!open.has(s.key)) return null
    if (!hasRules(s)) {
      const failed = lazy.failed.has(s.key)
      return (
        <WideRow testId={`dfw-reading-${s.key}`}>
          {failed ? <Typography variant='body2' color='text.secondary'>{tg('networkPage.rulesOnDemand.readFailed')}</Typography> : <LinearProgress />}
        </WideRow>
      )
    }
    const rows = visibleEntries(s)
    if (rows.length === 0) return <WideRow><Typography variant='body2' color='text.secondary'>{q ? t('noMatch') : tg('networkPage.noRules')}</Typography></WideRow>
    return rows.map(({ e, i }) => {
      const managed = s.managed || isEngineComment(e.rule.comment)
      const editable = canWrite && !managed
      const patch = (fields: Partial<RuleFields>) => patchRule(s, e.id, fields)
      return (
        <RuleRow
          key={`${s.key}|${e.id}`}
          index={i}
          rule={e.rule}
          state={s.states.get(e.id) ?? null}
          managed={managed}
          editable={editable}
          selected={selected.has(selKey(s.key, e.id))}
          appliedTo={s.appliedTo}
          hits={s.kind === 'zone' && s.zone ? ruleHits(hits, s.zone.zone, e.rule) : null}
          hitsTitle={hitsTitle(s)}
          drag={dragFor(s, e, i)}
          onSelect={on => toggleSel(s.key, [e.id], on)}
          onToggleEnable={() => patch({ enable: e.rule.enable === 1 ? 0 : 1 })}
          onToggleLog={() => patch({ log: e.rule.log && e.rule.log !== 'nolog' ? 'nolog' : 'info' })}
          onAction={action => patch({ action })}
          onOpen={() => openEditor(s, e)}
          onLogs={s.guest ? () => setLogVm(s.guest!) : undefined}
        />
      )
    })
  }

  const sectionBadges = (s: Section): ReactNode => (
    <>
      {s.zone && <ZoneStateBadge state={s.zone.state} />}
      {s.managed && <Badge label={t('managed')} />}
      {s.pending > 0 && <Badge label={t('unpublishedCount', { count: s.pending })} tone='warning' />}
      {s.stale && <Badge label={t('changedInProxmox')} tone='error' title={t('changedInProxmoxHint')} />}
      {firewallOffBadge(s)}
    </>
  )

  // The firewall of a host or guest that is off: a badge, and a link that turns it on at publish.
  function firewallOffBadge(s: Section): ReactNode {
    const sd = s.scope ? scopeDraftOf(fw.draft, s.scope) : undefined
    const hostOff = s.kind === 'host' && s.node && s.node in lazy.nodeOptions && Number(lazy.nodeOptions[s.node]?.enable) !== 1
    const guestOff = s.kind === 'guest' && s.guest && !s.guest.firewallEnabled && !s.guest.stateUnknown
    if (!hostOff && !guestOff) return null
    const willEnable = sd?.enableFirewall || sd?.options?.enable === 1
    const offLabel = s.kind === 'guest' ? t('guestFirewallOff') : t('hostFirewallOff')
    const sc = s.scope!
    const turnOn = () => fw.update(d => (s.kind === 'guest' ? enableGuestFirewall(d, sc) : setScopeOptions(d, sc, lazy.nodeOptions[s.node!] ?? null, { enable: 1 })))
    const undo = () => fw.update(d => (s.kind === 'guest' ? enableGuestFirewall(d, sc, false) : setScopeOptions(d, sc, lazy.nodeOptions[s.node!] ?? null, { enable: Number(lazy.nodeOptions[s.node!]?.enable) || 0 })))
    return (
      <>
        <Badge label={willEnable ? t('firewallOnAtPublish') : offLabel} tone={willEnable ? 'warning' : 'default'} />
        <WriteTip>
          <Link component='button' type='button' underline='hover' disabled={!canWrite} onClick={willEnable ? undo : turnOn} sx={{ fontSize: 12, fontWeight: 600 }}>
            {willEnable ? t('undo') : t('enableFirewall')}
          </Link>
        </WriteTip>
      </>
    )
  }

  const sectionRight = (s: Section): ReactNode => {
    const count = hasRules(s) ? t('ruleCount', { count: s.entries.length }) : tg('networkPage.rulesOnDemand.chip')
    return (
      <>
        <Typography component='span' noWrap sx={{ fontSize: 12 }}>{objectName(s, t)} · {count}</Typography>
        {s.kind === 'zone' && p.onOpenMicroseg && (
          <Link component='button' type='button' underline='hover' onClick={p.onOpenMicroseg} sx={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>{t('editInMicroseg')}</Link>
        )}
      </>
    )
  }

  const sectionCheck = (s: Section) => {
    const ids = s.entries.filter(e => !isEngineComment(e.rule.comment)).map(e => e.id)
    const on = ids.filter(id => selected.has(selKey(s.key, id))).length
    return { checked: ids.length > 0 && on === ids.length, indeterminate: on > 0 && on < ids.length, disabled: s.managed || ids.length === 0 || !open.has(s.key), onChange: (c: boolean) => toggleSel(s.key, ids, c) }
  }

  const sectionMenu = (s: Section) => (s.scope ? (
    <IconButton size='small' aria-label={t('sectionMenu', { name: s.title })} onClick={e => setMenuFor({ key: s.key, anchor: e.currentTarget })}>
      <i className='ri-more-2-fill' style={{ fontSize: 16 }} />
    </IconButton>
  ) : undefined)

  const renderSection = (s: Section, indent = 0) => (
    <Fragment key={s.key}>
      <SectionRow
        title={s.title}
        icon={sectionIcon(s, theme.palette.text.secondary)}
        open={open.has(s.key)}
        onToggle={() => toggleSection(s)}
        badges={sectionBadges(s)}
        right={sectionRight(s)}
        check={sectionCheck(s)}
        menu={sectionMenu(s)}
        indent={indent}
        testId={`dfw-section-${s.key}`}
      />
      {renderRules(s)}
    </Fragment>
  )

  const protectedIn = (vms: VMFirewallInfo[]) => {
    if (!deployed) return 0
    const tags = new Set(deployed.zones.filter(z => z.state === 'observe' || z.state === 'enforce').map(z => `${deployed.tag_prefix}${z.name}`.toLowerCase()))
    return vms.filter(vm => vm.tags.some(tag => tags.has(tag.toLowerCase()))).length
  }

  const renderGroup = ([vlan, vms]: [string, VMFirewallInfo[]]) => {
    const label = vlan === UNTAGGED ? tg('networkPage.untagged') : `VLAN ${vlan}`
    const isOpen = openVlans.has(vlan) || !!q
    const pages = pageCount(vms.length, pager.size)
    const page = pager.pageOf(vlan, vms.length)
    const prot = protectedIn(vms)
    return (
      <Fragment key={`vlan-${vlan}`}>
        <WideRow tone='group' testId={`dfw-group-${vlan}`}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <IconButton size='small' aria-expanded={isOpen} aria-label={isOpen ? t('collapse', { name: label }) : t('expand', { name: label })}
              onClick={() => setOpenVlans(prev => toggled(prev, vlan))}>
              <i className={isOpen ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} style={{ fontSize: 18 }} />
            </IconButton>
            <i className={vlan === UNTAGGED ? 'ri-ethernet-line' : 'ri-git-branch-line'} style={{ fontSize: 16 }} />
            <Typography component='span' sx={{ fontSize: 13, fontWeight: 700 }}>{label} · {tg('networkPage.vmPager.groupCount', { count: vms.length })}</Typography>
            {prot > 0 && <Badge label={t('group.protected', { count: prot })} tone='success' />}
            <Typography component='span' sx={{ ml: 'auto', fontSize: 12, color: 'text.secondary' }}>
              {t('group.onOpen')}{pages > 1 ? ` · ${t('group.page', { page: page + 1, pages })}` : ''}
            </Typography>
          </Box>
        </WideRow>
        {isOpen && pager.slice(vlan, vms).map(vm => renderSection(guestSection(vm), 1))}
        {isOpen && vms.length > GROUP_PAGE_SIZE && (
          <WideRow><GroupPager count={vms.length} page={page} size={pager.size} onPage={n => pager.setPage(vlan, n)} onSize={pager.setSize} label={label} /></WideRow>
        )}
      </Fragment>
    )
  }

  const shownFixed = inScope.filter(sectionShown)

  // The head checkbox checks every rule shown in an open section that can be changed.
  const openGuests = guestsShown ? p.guests.filter(vm => open.has(scopeKey(guestScope(vm)))).map(guestSection) : []
  const openSections = [...shownFixed, ...openGuests].filter(s => open.has(s.key) && !s.managed)
  const visibleSelectable = openSections.flatMap(s => visibleEntries(s).filter(({ e }) => !isEngineComment(e.rule.comment)).map(({ e }) => selKey(s.key, e.id)))
  const allVisibleChecked = visibleSelectable.length > 0 && visibleSelectable.every(k => selected.has(k))
  const oneSection = selection.size === 1
  const firstSelected = [...selection.keys()][0]
  const addTarget = sectionOrNull(firstSelected) ?? clusterIfAny[0] ?? hostList[0]
  const canAddRule = !!addTarget?.scope && !addTarget.managed && hasRules(addTarget)
  const menuSection = sectionOrNull(menuFor?.key)
  const selectedCount = selected.size
  const subtitle = [p.connectionName, t(standalone ? 'mode.standalone' : 'mode.cluster', { count: p.nodesList.length })].filter(Boolean).join(' · ')

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}>
      <ViewToolbar
        subtitle={subtitle}
        publishedAt={fw.publishedAt}
        count={fw.count}
        busy={fw.busy}
        canWrite={canWrite}
        refreshing={refreshing}
        onPublish={() => { void publish(false) }}
        onDiscard={() => setDialog('discard')}
        onRefresh={() => { void refresh() }}
        menu={[
          ...clusterIfAny.map(() => ({ label: t('clusterOptions'), onClick: () => setOptionsFor('cluster'), write: true })),
          { label: tg('common.expandAll'), onClick: () => setOpen(new Set(['cluster', ...zoneList.map(z => z.key)])) },
          { label: tg('common.collapseAll'), onClick: () => { setOpen(new Set()); setOpenVlans(new Set()) } },
        ]}
      />

      <Notices error={fw.error} onCloseError={fw.clearError} notice={notice} onCloseNotice={() => setNotice(null)} />

      <StatusBar total={figures.total} totalPartial={figures.partial} unpublished={fw.count} disabled={figures.disabled} sections={figures.sections}
        managed={inScope.filter(s => s.kind === 'zone').length} covered={covered} scope={scope} onScope={setScope} />

      <ActionBar
        selected={selectedCount}
        canWrite={canWrite}
        canAddRule={canAddRule}
        oneSection={oneSection}
        filter={filter}
        onFilter={value => { setFilter(value); pager.reset() }}
        onAddRule={() => addTarget && openEditor(addTarget, null)}
        onAddSection={() => setDialog('addSection')}
        onEnable={() => onSelection((d, s, ids) => updateRules(d, s.scope, s.base, ids, { enable: 1 }))}
        onDisable={() => onSelection((d, s, ids) => updateRules(d, s.scope, s.base, ids, { enable: 0 }))}
        onClone={() => onSelection((d, s, ids) => cloneRules(d, s.scope, s.base, ids))}
        onUp={() => onSelection((d, s, ids) => shiftRules(d, s.scope, s.base, ids, -1))}
        onDown={() => onSelection((d, s, ids) => shiftRules(d, s.scope, s.base, ids, 1))}
        onMoveTo={() => setDialog('move')}
        onDelete={() => { onSelection((d, s, ids) => removeRules(d, s.scope, s.base, ids)); setSelected(new Set()) }}
        onClearSelection={() => setSelected(new Set())}
      />

      <TableContainer component={Paper} variant='outlined' sx={{ borderRadius: 2.5 }}>
        <Table size='small' sx={{ minWidth: 1180 }}>
          <DfwHead allChecked={allVisibleChecked} someChecked={selectedCount > 0} canCheck={canWrite && visibleSelectable.length > 0}
            onCheckAll={on => setSelected(on ? new Set(visibleSelectable) : new Set())} />
          <TableBody>
            {shownFixed.map(s => renderSection(s))}
            {renderGuestGroups()}
          </TableBody>
        </Table>
      </TableContainer>

      {renderDialogs()}
    </Box>
  )

  function renderGuestGroups(): ReactNode {
    if (!guestsShown) return null
    if (p.loadingVMRules && p.guests.length === 0) return <WideRow><LinearProgress /></WideRow>
    return groups.map(renderGroup)
  }

  function renderDialogs(): ReactNode {
    return (
      <>
      {editor && (
        <RuleFormDialog
          open
          isNew={!editor.entryId}
          onClose={() => setEditor(null)}
          onSubmit={saveEditor}
          scope={editorScope(sectionByKey(editor.sectionKey))}
          rule={editor.form}
          onRuleChange={form => setEditor(prev => (prev ? { ...prev, form } : prev))}
          securityGroups={p.securityGroups.filter(g => !g.group.startsWith(ZONE_GROUP_PREFIX))}
          aliases={p.aliases}
          ipsets={p.ipsets}
          submitLabel={t('keepInDraft')}
        />
      )}
      {dialog === 'move' && (
        <MoveToSectionDialog
          open
          count={selectedCount}
          targets={writableTargets.filter(target => !selection.has(target.key) || selection.size > 1)}
          onClose={() => setDialog(null)}
          onMove={target => {
            fw.update(d => [...selection.entries()].reduce((acc, [key, ids]) => {
              const from = sectionByKey(key)
              return from?.scope && !from.managed ? moveRulesToScope(acc, { scope: from.scope, baseRules: from.base }, ids, { scope: target.scope, baseRules: sectionByKey(target.key)?.base ?? null }) : acc
            }, d))
            setSelected(new Set())
            setDialog(null)
            setOpen(prev => new Set(prev).add(target.key))
          }}
        />
      )}
      {dialog === 'addSection' && (
        <AddSectionDialog open targets={writableTargets.filter(target => target.key !== 'cluster')} onClose={() => setDialog(null)} onPick={target => { void addSection(target) }} />
      )}
      {optionsSection && (
        <ScopeOptionsDialog open name={optionsSection.title} scope={optionsSection.scope!} current={currentOptions(optionsSection)}
          onClose={() => setOptionsFor(null)} onSave={form => saveOptions(optionsSection, form)} />
      )}
      <MicrosegConfirmDialog
        open={dialog === 'confirmPublish'}
        title={t('confirmPublish.title', { count: confirmCount })}
        body={t('confirmPublish.body', { count: confirmCount })}
        confirmLabel={t('confirmPublish.confirm')}
        busy={fw.busy}
        onConfirm={() => { void publish(true) }}
        onCancel={() => setDialog(null)}
      />
      <MicrosegConfirmDialog
        open={dialog === 'discard'}
        title={t('confirmDiscard.title')}
        body={t('confirmDiscard.body', { count: fw.count })}
        confirmLabel={t('confirmDiscard.confirm')}
        color='error'
        onConfirm={() => { fw.discard(); setSelected(new Set()); setDialog(null) }}
        onCancel={() => setDialog(null)}
      />
      <Menu open={!!menuFor && !!menuSection} anchorEl={menuFor?.anchor} onClose={() => setMenuFor(null)}>
        {menuSection && sectionMenuItems(menuSection).map(item => (
          <MenuItem key={item.label} disabled={item.disabled} sx={{ fontSize: 13 }} onClick={() => { setMenuFor(null); item.onClick() }}>{item.label}</MenuItem>
        ))}
      </Menu>
      {logVm && (
        <FirewallLogDialog
          open
          onClose={() => setLogVm(null)}
          connectionId={p.connectionId}
          scope={{ kind: 'vm', node: logVm.node, vmType: logVm.type, vmid: logVm.vmid }}
          subject={`${logVm.name} (${logVm.vmid})`}
        />
      )}
      </>
    )
  }

  function sectionMenuItems(s: Section): { label: string; onClick: () => void; disabled?: boolean }[] {
    const loaded = hasRules(s)
    return [
      { label: tg('networkPage.addRule'), onClick: () => openEditor(s, null), disabled: !canWrite || !loaded },
      { label: t('menu.options'), onClick: () => setOptionsFor(s.key), disabled: !canWrite || (s.kind === 'host' && !((s.node ?? '') in lazy.nodeOptions)) },
      ...(s.guest ? [{ label: tg('networkPage.viewLogs'), onClick: () => setLogVm(s.guest!) }] : []),
      { label: t('menu.discard'), onClick: () => fw.update(d => discardOf(d, s.scope!)), disabled: s.pending === 0 },
    ]
  }
}

/** Operations of the draft that touch `scope`. */
function opsOn(ops: PublishOp[], scope: DraftScope): number {
  const key = scopeKey(scope)
  return ops.filter(op => scopeKey(op.scope) === key).length
}

function discardOf(d: FirewallDraft, scope: DraftScope): FirewallDraft {
  const scopes = { ...d.scopes }
  delete scopes[scopeKey(scope)]
  return { ...d, scopes }
}

function readOptions(s: Section, cluster: firewallAPI.ClusterOptions | null, nodes: Record<string, firewallAPI.NodeOptions>): ScopeOptions {
  const pick = (o: Record<string, unknown> | null | undefined): ScopeOptions => {
    if (!o) return {}
    const out: ScopeOptions = {}
    if (o.enable !== undefined) out.enable = Number(o.enable) === 1 ? 1 : 0
    for (const key of ['policy_in', 'policy_out', 'log_level_in', 'log_level_out'] as const) {
      if (typeof o[key] === 'string') out[key] = o[key] as string
    }
    return out
  }
  if (s.kind === 'cluster') return pick(cluster as Record<string, unknown> | null)
  if (s.kind === 'host') return pick(nodes[s.node!] as Record<string, unknown> | undefined)
  return pick(s.guest?.options as Record<string, unknown> | null)
}

function objectName(s: Section, t: ReturnType<typeof useTranslations<'microsegPilot.dfw'>>): string {
  if (s.kind === 'zone') return t('object.group', { group: s.zone!.group })
  if (s.kind === 'cluster') return 'cluster.fw'
  if (s.kind === 'host') return `host.fw · ${s.node}`
  return `${s.guest!.vmid}.fw · ${s.guest!.node}`
}

function sectionIcon(s: Section, colour: string): ReactNode {
  if (s.kind === 'guest' && s.guest) return <StatusIcon type='vm' status={s.guest.status} vmType={s.guest.type} size={16} />
  const icon: Record<Section['kind'], string> = { zone: 'ri-shield-keyhole-line', cluster: 'ri-server-line', host: 'ri-hard-drive-2-line', guest: 'ri-computer-line' }
  return <i className={icon[s.kind]} aria-hidden style={{ fontSize: 16, color: colour }} />
}

function editorScope(s: Section | null): { type: 'cluster' | 'host' | 'guest'; name?: string } {
  if (!s || s.kind === 'cluster') return { type: 'cluster' }
  return { type: s.kind === 'host' ? 'host' : 'guest', name: s.kind === 'host' ? s.node : s.title }
}

function ZoneStateBadge({ state }: { state: ZoneSection['state'] }) {
  const t = useTranslations('microsegPilot.dfw')
  if (state === 'enforce') return <Badge label={t('zoneState.enforce')} tone='error' />
  if (state === 'observe') return <Badge label={t('zoneState.observe')} tone='info' />
  return <Badge label={t('zoneState.disabled')} />
}
