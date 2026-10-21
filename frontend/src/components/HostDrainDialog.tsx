'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  List,
  ListItem,
  MenuItem,
  Select,
  Slider,
  Stack,
  Switch,
  TablePagination,
  Tooltip,
  Typography,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'

import NumericTextField from '@/components/ui/NumericTextField'
import CephNooutOption from '@/components/ceph/CephNooutOption'
import { GuestGlyph, NodeGlyph } from '@/components/automation/drs/glyphs'
import { useToast } from '@/contexts/ToastContext'
import { useCephNoout } from '@/hooks/useCephNoout'

/*
   Host drain dialog (#248).

   Shared by "Enter maintenance" and "Migrate all VMs": both now hand the node
   to the orchestrator, which places each guest with the placement engine of
   the rolling updates (projected load, memory ceiling, affinity rules, network
   and storage feasibility) and migrates them in parallel under a cap. The
   dialog previews that plan before the operator confirms, and every setting
   the engine takes is exposed here.
*/

export type HostDrainMode = 'maintenance' | 'migrate-all'

export interface HostDrainPlanGuest {
  vmid: number
  name: string
  type: string
  status: 'pending' | 'skipped' | string
  mode: string
  running: boolean
  ha: boolean
  target_node?: string
  reason?: string
  /** Left on the node on purpose (stopped guest kept, or the operator's choice). */
  kept?: boolean
}

export interface HostDrainNodeProjection {
  node: string
  source?: boolean
  mem_total: number
  mem_before: number
  mem_after: number
  cpu_before: number
  cpu_after: number
  guests_in?: number
  guests_out?: number
}

export interface HostDrainPlan {
  node: string
  guests: HostDrainPlanGuest[]
  candidates: string[]
  movable: number
  skipped: number
  /** Load of the drained node and of each candidate, before and after. */
  projection?: HostDrainNodeProjection[]
  /** Running HA guests ha-manager places itself, not counted on any target. */
  ha_unplaced?: number
}

export interface HostDrainDialogProps {
  open: boolean
  onClose: () => void
  connId: string
  node: string
  mode: HostDrainMode
  /** Online nodes of the cluster other than `node`, for the manual target. */
  otherNodes: string[]
  /** Entering maintenance runs ha-manager over SSH. */
  sshEnabled?: boolean
  onStarted?: (drain: any) => void
  /**
   * Maintenance without evacuation: the ha-manager call alone, as before. Kept
   * for the clusters where only HA guests matter.
   */
  onMaintenanceOnly?: () => Promise<void>
}

export const HOST_DRAIN_PARALLEL_MIN = 1
export const HOST_DRAIN_PARALLEL_MAX = 5
export const HOST_DRAIN_PARALLEL_DEFAULT = 2
export const HOST_DRAIN_CEILING_MIN = 50
export const HOST_DRAIN_CEILING_MAX = 100
export const HOST_DRAIN_CEILING_DEFAULT = 90

const PLAN_ROWS_PER_PAGE = [20, 50, 100]

/** The per-guest choice that leaves the guest on the node (Migrate all VMs only). */
export const KEEP_ON_NODE = '__keep__'
/** "Apply to all" back to the placement engine: every choice dropped. */
const AUTOMATIC = '__auto__'

/**
 * The drain request. The plan is edited guest by guest: `overrides` maps a
 * VMID to the target the operator chose, or to KEEP_ON_NODE; the guests left
 * out keep the target the placement engine picks. Keeping a guest is only
 * possible when the node does not enter maintenance.
 */
export function buildHostDrainConfig(opts: {
  mode: HostDrainMode
  maxParallel: number
  memCeiling: number
  includeStopped: boolean
  overrides?: Record<number, string>
}) {
  const entries = Object.entries(opts.overrides || {}).filter(([, v]) => !!v)
  const targets = Object.fromEntries(entries.filter(([, v]) => v !== KEEP_ON_NODE))
  const keep = opts.mode === 'migrate-all' ? entries.filter(([, v]) => v === KEEP_ON_NODE).map(([k]) => Number(k)) : []

  return {
    max_concurrent_migrations: opts.maxParallel,
    mem_ceiling_percent: opts.memCeiling,
    include_stopped: opts.includeStopped,
    enter_maintenance: opts.mode === 'maintenance',
    ...(Object.keys(targets).length > 0 ? { guest_targets: targets } : {}),
    ...(keep.length > 0 ? { keep_vmids: keep } : {}),
  }
}

/**
 * The target of one guest, or of every guest ("Apply to all"): the eligible
 * nodes with their Proxmox glyph, "Leave on the node" for Migrate all VMs, and
 * "Automatic placement" in the shortcut, which drops every choice.
 */
function TargetSelect({ value, candidates, canKeep, automatic, onChange, label, testId }: Readonly<{
  value: string
  candidates: string[]
  canKeep: boolean
  automatic?: boolean
  onChange: (value: string) => void
  label: string
  testId: string
}>) {
  const t = useTranslations()
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const dotBorder = theme.palette.background.paper
  const nodeLabel = (n: string) => (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
      <NodeGlyph status="online" dark={isDark} dotBorder={dotBorder} />
      {n}
    </Box>
  )
  const render = (v: string) => {
    if (v === KEEP_ON_NODE) return t('hostDrain.keepOnNode')
    if (v === AUTOMATIC) return t('hostDrain.automaticPlacement')
    if (!v) return automatic ? t('hostDrain.perGuest') : '—'
    return nodeLabel(v)
  }
  // A choice no longer among the candidates (node gone offline) still shows.
  const options = value && value !== KEEP_ON_NODE && value !== AUTOMATIC && !candidates.includes(value) ? [...candidates, value] : candidates

  return (
    <Select
      variant="standard"
      disableUnderline
      size="small"
      displayEmpty
      value={value}
      onChange={e => onChange(String(e.target.value))}
      renderValue={render}
      inputProps={{ 'aria-label': label }}
      data-testid={testId}
      sx={{
        minWidth: 64,
        fontSize: '0.75rem',
        fontWeight: 600,
        '& .MuiSelect-select': { py: 0, pr: '20px !important', display: 'flex', alignItems: 'center' },
        // The theme's chevron sits 1rem from the edge, made for full-width selects.
        '& > i': { right: '0 !important', fontSize: '1rem !important', width: '1rem !important', height: '1rem !important', top: 'calc(50% - 0.5rem) !important' },
      }}
    >
      {automatic && <MenuItem value={AUTOMATIC} sx={{ fontSize: '0.8rem' }}>{t('hostDrain.automaticPlacement')}</MenuItem>}
      {options.map(n => <MenuItem key={n} value={n} sx={{ fontSize: '0.8rem' }}>{nodeLabel(n)}</MenuItem>)}
      {canKeep && <MenuItem value={KEEP_ON_NODE} sx={{ fontSize: '0.8rem' }}>{t('hostDrain.keepOnNode')}</MenuItem>}
    </Select>
  )
}

const pct = (ratio: number) => Math.round(ratio * 100)

/**
 * A load before and after: the part both share, then the part the drain adds
 * (solid) or frees (faded). Past the ceiling the bar turns red.
 */
export function LoadBar({ before, after, limit, testId }: Readonly<{ before: number; after: number; limit: number; testId: string }>) {
  const clamp = (v: number) => Math.max(0, Math.min(1, v))
  const base = clamp(Math.min(before, after))
  const delta = clamp(Math.max(before, after)) - base
  const grows = after > before
  let color = 'primary.main'
  if (after > limit) color = 'error.main'
  else if (after > limit - 0.1) color = 'warning.main'

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }} data-testid={testId}>
      <Box sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: 'action.hover', overflow: 'hidden', display: 'flex' }}>
        <Box sx={{ width: `${base * 100}%`, bgcolor: color }} />
        <Box sx={{ width: `${delta * 100}%`, bgcolor: color, opacity: grows ? 0.55 : 0.2 }} />
      </Box>
      <Typography variant="caption" sx={{ flexShrink: 0, width: 72, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {pct(before)} → <Box component="span" sx={{ fontWeight: 600, color: after > limit ? 'error.main' : 'text.primary' }}>{pct(after)} %</Box>
      </Typography>
    </Box>
  )
}

/** Each node's memory and CPU once the plan has run, the drained node first. */
function ProjectionBlock({ plan, memCeiling }: Readonly<{ plan: HostDrainPlan; memCeiling: number }>) {
  const t = useTranslations()
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const dotBorder = theme.palette.background.paper
  const rows = plan.projection || []
  const ratio = (v: number, total: number) => (total > 0 ? v / total : 0)
  const help = plan.ha_unplaced
    ? `${t('hostDrain.projectionHelp')} ${t('hostDrain.projectionHaUnplaced', { count: plan.ha_unplaced })}`
    : t('hostDrain.projectionHelp')

  return (
    <Box data-testid="drain-projection">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <Typography variant="subtitle2" fontWeight={600}>{t('hostDrain.projectionTitle')}</Typography>
        <Box sx={{ flex: 1 }} />
        <Tooltip title={help}>
          <Box component="i" className="ri-information-line" aria-label={help} data-testid="drain-projection-help" sx={{ fontSize: 15, color: 'text.secondary', cursor: 'help' }} />
        </Tooltip>
      </Box>
      <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, px: 1.5, py: 0.75 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(90px, auto) 1fr 1fr', columnGap: 2, rowGap: 0.75, alignItems: 'center' }}>
          <Box />
          <Typography variant="caption" color="text.secondary">{t('hostDrain.projectionMem')}</Typography>
          <Typography variant="caption" color="text.secondary">{t('hostDrain.projectionCpu')}</Typography>
          {rows.map(r => (
            <React.Fragment key={r.node}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }} data-testid={`drain-projection-node-${r.node}`}>
                <NodeGlyph status="online" dark={isDark} dotBorder={dotBorder} />
                <Typography variant="caption" noWrap sx={{ fontWeight: 600 }}>{r.node}</Typography>
                {r.source ? (
                  <Typography variant="caption" color="text.secondary" noWrap>{`−${r.guests_out ?? 0}`}</Typography>
                ) : (
                  (r.guests_in ?? 0) > 0 && <Typography variant="caption" color="text.secondary" noWrap>{`+${r.guests_in}`}</Typography>
                )}
              </Box>
              <LoadBar before={ratio(r.mem_before, r.mem_total)} after={ratio(r.mem_after, r.mem_total)} limit={memCeiling / 100} testId={`drain-projection-mem-${r.node}`} />
              <LoadBar before={r.cpu_before} after={r.cpu_after} limit={1} testId={`drain-projection-cpu-${r.node}`} />
            </React.Fragment>
          ))}
        </Box>
      </Box>
    </Box>
  )
}

export default function HostDrainDialog(props: HostDrainDialogProps) {
  const { open, onClose, connId, node, mode, otherNodes, sshEnabled = true, onStarted, onMaintenanceOnly } = props
  const t = useTranslations()
  const toast = useToast()
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const dotBorder = theme.palette.background.paper
  // A target the dialog was given as online shows green; anything else unknown.
  const nodeStatus = (n: string) => (otherNodes.includes(n) ? 'online' : undefined)

  const [evacuate, setEvacuate] = useState(true)
  // The plan as the operator edited it: VMID -> chosen target or KEEP_ON_NODE.
  const [overrides, setOverrides] = useState<Record<number, string>>({})
  const [maxParallel, setMaxParallel] = useState(HOST_DRAIN_PARALLEL_DEFAULT)
  const [memCeiling, setMemCeiling] = useState(HOST_DRAIN_CEILING_DEFAULT)
  const [includeStopped, setIncludeStopped] = useState(true)

  // The plan is keyed by the request that produced it: a plan for another
  // configuration is stale, and "loading" is simply "no plan for this key yet".
  // The dialog is mounted only while open, so its state starts fresh each time.
  const [planState, setPlanState] = useState<{ key: string; plan: HostDrainPlan | null; error: string | null }>({ key: '', plan: null, error: null })
  const [starting, setStarting] = useState(false)
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(PLAN_ROWS_PER_PAGE[0])
  const [error, setError] = useState<string | null>(null)
  // The per-host Ceph noout of a node entering maintenance (ui#1164), set
  // before the drain or the ha-manager call so the OSDs are covered first.
  const noout = useCephNoout({ connId, node, open: open && mode === 'maintenance', mode: 'enter' })
  const { active: nooutWanted, setFlag: setNoout, rollback: rollbackNoout } = noout

  const config = useMemo(
    () => buildHostDrainConfig({ mode, maxParallel, memCeiling, includeStopped, overrides }),
    [mode, maxParallel, memCeiling, includeStopped, overrides],
  )

  const needsSsh = mode === 'maintenance'
  const sshBlocked = needsSsh && !sshEnabled
  const drainWanted = mode === 'migrate-all' || evacuate
  const planWanted = open && drainWanted
  const planKey = useMemo(() => JSON.stringify({ connId, node, config }), [connId, node, config])
  // The last plan stays on screen while the next one loads, so the list does
  // not blink at every choice; Start waits for the plan of the current settings.
  const plan = planState.plan
  const planError = planState.key === planKey ? planState.error : null
  const planLoading = planWanted && planState.key !== planKey

  // Preview, debounced so typing a ceiling does not fire a plan per digit.
  useEffect(() => {
    if (!planWanted) return
    let cancelled = false
    const handle = setTimeout(async () => {
      try {
        const res = await fetch('/api/v1/orchestrator/host-drains/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connection_id: connId, node, config }),
        })
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          setPlanState({ key: planKey, plan: null, error: json?.error || `HTTP ${res.status}` })
        } else {
          setPlanState({ key: planKey, plan: json?.data ?? json, error: null })
        }
      } catch (e: any) {
        if (cancelled) return
        setPlanState({ key: planKey, plan: null, error: e?.message || t('hostDrain.orchestratorUnavailable') })
      }
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [planWanted, connId, node, config, planKey, t])

  const start = useCallback(async () => {
    setStarting(true)
    setError(null)
    try {
      // A refused flag stops here: the node must not enter maintenance
      // without the protection the operator asked for.
      if (nooutWanted) await setNoout()
      if (!drainWanted) {
        await onMaintenanceOnly?.()
        onClose()
        return
      }
      const res = await fetch('/api/v1/orchestrator/host-drains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connection_id: connId, node, config }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        // The node never entered maintenance: the flag set above goes too.
        await rollbackNoout()
        setError(json?.error || `HTTP ${res.status}`)
        return
      }
      toast.success(t('hostDrain.started', { node }))
      onStarted?.(json?.data ?? json)
      onClose()
    } catch (e: any) {
      await rollbackNoout()
      setError(e?.message || t('hostDrain.orchestratorUnavailable'))
    } finally {
      setStarting(false)
    }
  }, [nooutWanted, setNoout, rollbackNoout, drainWanted, onMaintenanceOnly, onClose, connId, node, config, toast, t, onStarted])

  const modeLabel = (m: string) => {
    switch (m) {
      case 'restart': return t('hostDrain.modeRestart')
      case 'offline': return t('hostDrain.modeOffline')
      case 'ha': return t('hostDrain.modeHa')
      default: return t('hostDrain.modeLive')
    }
  }

  const guests = plan?.guests || []
  // Refused guests first, so what will stay on the node shows on page one.
  const sortedGuests = [...guests.filter(g => g.status === 'skipped'), ...guests.filter(g => g.status !== 'skipped')]
  const lastPage = Math.max(0, Math.ceil(sortedGuests.length / rowsPerPage) - 1)
  const currentPage = Math.min(page, lastPage)
  const shownGuests = sortedGuests.slice(currentPage * rowsPerPage, (currentPage + 1) * rowsPerPage)
  const canStart = !starting && !sshBlocked && !noout.blocked && (!drainWanted || (!!plan && !planLoading && !planError))
  const canKeep = mode === 'migrate-all'
  // A guest gets a target selector when it will move, or when the operator
  // already chose for it (a refused choice stays editable). HA guests of a
  // node entering maintenance are ha-manager's, never ours.
  const selectable = (g: HostDrainPlanGuest) => {
    if (g.mode === 'ha' && !g.target_node && mode === 'maintenance') return false
    return g.status !== 'skipped' || overrides[g.vmid] !== undefined
  }
  const choiceOf = (g: HostDrainPlanGuest) => overrides[g.vmid] ?? g.target_node ?? ''
  const choose = (vmid: number, value: string) => setOverrides(prev => ({ ...prev, [vmid]: value }))
  // What the shortcut shows: automatic while nothing is chosen, the common
  // choice when every line has the same, "per guest" once lines differ.
  const appliedToAll = (() => {
    const lines = guests.filter(selectable)
    const chosen = new Set(lines.map(g => overrides[g.vmid] ?? AUTOMATIC))
    if (chosen.size === 1) return [...chosen][0]
    return ''
  })()
  const applyToAll = (value: string) => {
    if (!value || value === AUTOMATIC) {
      setOverrides({})
      return
    }
    setOverrides(Object.fromEntries(guests.filter(selectable).map(g => [g.vmid, value])))
  }

  return (
    <Dialog open={open} onClose={() => { if (!starting) onClose() }} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{
          width: 40, height: 40, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
          bgcolor: mode === 'maintenance' ? 'rgba(255,152,0,0.12)' : 'rgba(33,150,243,0.12)',
        }}>
          <i className={mode === 'maintenance' ? 'ri-tools-fill' : 'ri-logout-box-r-line'} style={{ fontSize: 22, color: mode === 'maintenance' ? '#ff9800' : '#2196f3' }} />
        </Box>
        <Box>{mode === 'maintenance' ? t('inventory.enterMaintenance') : t('bulkActions.migrateAllVms')}</Box>
      </DialogTitle>
      {/* MUI drops the top padding after a title: the intro needs air. */}
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, '&&': { pt: 1.5 } }}>
        <Typography variant="body2" color="text.secondary">
          {mode === 'maintenance' ? t('hostDrain.introMaintenance') : t('hostDrain.introMigrateAll')}
        </Typography>

        {sshBlocked && (
          <Alert severity="warning" icon={<i className="ri-ssh-line" style={{ fontSize: 18 }} />}>
            {t('hostDrain.requiresSsh')}
          </Alert>
        )}

        {mode === 'maintenance' && (
          <Box>
            <FormControlLabel
              control={<Switch checked={evacuate} onChange={e => setEvacuate(e.target.checked)} />}
              label={t('hostDrain.evacuateGuests')}
            />
            {!evacuate && (
              <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', ml: 0.5 }}>
                {t('hostDrain.evacuateGuestsOff')}
              </Typography>
            )}
          </Box>
        )}

        {mode === 'maintenance' && <CephNooutOption state={noout} disabled={starting} />}

        {drainWanted && (
          <>
            {/* Two bounded settings as sliders: the value reads in the label. */}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} sx={{ px: 0.5 }}>
              <Box sx={{ flex: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', minHeight: 20 }}>
                  <Typography variant="caption" color="text.secondary" id="drain-parallel-label">
                    {t('hostDrain.maxParallel')}: <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>{maxParallel}</Box>
                  </Typography>
                </Box>
                <Slider
                  size="small"
                  value={maxParallel}
                  min={HOST_DRAIN_PARALLEL_MIN}
                  max={HOST_DRAIN_PARALLEL_MAX}
                  step={1}
                  marks
                  valueLabelDisplay="auto"
                  onChange={(_e, v) => setMaxParallel(v as number)}
                  slotProps={{ input: { 'aria-label': t('hostDrain.maxParallel') } }}
                />
              </Box>
              <Box sx={{ flex: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minHeight: 20 }}>
                  <Typography variant="caption" color="text.secondary" id="drain-ceiling-label">
                    {t('hostDrain.memCeiling')}: <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>{memCeiling} %</Box>
                  </Typography>
                  <Tooltip title={t('hostDrain.memCeilingHelp')}>
                    <Box component="i" className="ri-information-line" aria-label={t('hostDrain.memCeilingHelp')} sx={{ fontSize: 14, color: 'text.secondary', cursor: 'help' }} />
                  </Tooltip>
                </Box>
                <Slider
                  size="small"
                  value={memCeiling}
                  min={HOST_DRAIN_CEILING_MIN}
                  max={HOST_DRAIN_CEILING_MAX}
                  step={5}
                  marks
                  valueLabelDisplay="auto"
                  valueLabelFormat={v => `${v} %`}
                  onChange={(_e, v) => setMemCeiling(v as number)}
                  slotProps={{ input: { 'aria-label': t('hostDrain.memCeiling') } }}
                />
              </Box>
            </Stack>

            <Box>
              {/* Apply to all, with the eligible targets on demand at the right. */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, mt: 2, mb: 3 }}>
                {plan && !planError && guests.some(selectable) && (
                  <>
                    <Typography variant="caption" color="text.secondary">{t('hostDrain.applyToAll')}</Typography>
                    <TargetSelect
                      value={appliedToAll}
                      candidates={plan.candidates}
                      canKeep={canKeep}
                      automatic
                      onChange={applyToAll}
                      label={t('hostDrain.applyToAll')}
                      testId="drain-plan-apply-all"
                    />
                  </>
                )}
                <Box sx={{ flex: 1 }} />
                {plan && !planError && plan.candidates.length > 0 && (
                  <Tooltip title={t('hostDrain.candidates', { nodes: plan.candidates.join(', ') })}>
                    <Box component="i" className="ri-information-line" data-testid="drain-plan-candidates" aria-label={t('hostDrain.candidates', { nodes: plan.candidates.join(', ') })} sx={{ fontSize: 15, color: 'text.secondary', cursor: 'help', flexShrink: 0 }} />
                  </Tooltip>
                )}
                {planLoading && <CircularProgress size={14} />}
              </Box>
              {planError && <Alert severity="error" sx={{ mb: 1 }}>{planError}</Alert>}
              {plan && !planError && (
                <>
                  {plan.candidates.length === 0 && (
                    <Typography variant="caption" sx={{ display: 'block', color: 'warning.main' }}>{t('hostDrain.noCandidates')}</Typography>
                  )}
                  {guests.length === 0 ? (
                    <Typography variant="body2" sx={{ mt: 1 }}>{t('hostDrain.planEmpty')}</Typography>
                  ) : (
                    <List dense disablePadding sx={{ mt: 1, maxHeight: 320, overflow: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                      {shownGuests.map(g => {
                        const skipped = g.status === 'skipped'
                        // One line per guest: glyph with its power dot, name,
                        // how it moves, then the route between the two nodes;
                        // a refused guest carries the reason on its warning icon.
                        return (
                          <ListItem key={g.vmid} divider sx={{ py: 0.5, gap: 1 }} data-testid={`drain-plan-guest-${g.vmid}`}>
                            <GuestGlyph type={g.type} status={g.running ? 'running' : 'stopped'} dotBorder={dotBorder} />
                            <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>{g.vmid} {g.name}</Typography>
                            {g.ha && <Chip size="small" label="HA" sx={{ height: 16, fontSize: '0.6rem', flexShrink: 0 }} />}
                            {!skipped && g.mode !== 'ha' && <Chip size="small" variant="outlined" label={modeLabel(g.mode)} sx={{ height: 16, fontSize: '0.6rem', flexShrink: 0 }} />}
                            <Box sx={{ flex: 1 }} />
                            {skipped && !(g.kept && overrides[g.vmid] === KEEP_ON_NODE) && (
                              <Tooltip title={g.reason || t('hostDrain.planSkipped')} placement="left">
                                <Box component="i" className="ri-alert-line" data-testid={`drain-plan-reason-${g.vmid}`} aria-label={g.reason || t('hostDrain.planSkipped')} sx={{ color: 'warning.main', fontSize: 16, flexShrink: 0, cursor: 'help' }} />
                              </Tooltip>
                            )}
                            {(!skipped || selectable(g)) && (
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0, color: 'text.secondary' }} data-testid={`drain-plan-route-${g.vmid}`}>
                                <NodeGlyph status="online" dark={isDark} dotBorder={dotBorder} />
                                <Typography variant="caption">{node}</Typography>
                                <Typography variant="caption">→</Typography>
                                {selectable(g) ? (
                                  <TargetSelect
                                    value={choiceOf(g)}
                                    candidates={plan?.candidates || []}
                                    canKeep={canKeep}
                                    onChange={v => choose(g.vmid, v)}
                                    label={t('hostDrain.targetOf', { name: g.name || String(g.vmid) })}
                                    testId={`drain-plan-target-${g.vmid}`}
                                  />
                                ) : (
                                  <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.primary' }}>{t('hostDrain.planHa')}</Typography>
                                )}
                              </Box>
                            )}
                          </ListItem>
                        )
                      })}
                    </List>
                  )}
                  {sortedGuests.length > PLAN_ROWS_PER_PAGE[0] && (
                    <TablePagination
                      component="div"
                      count={sortedGuests.length}
                      page={currentPage}
                      onPageChange={(_e, p) => setPage(p)}
                      rowsPerPage={rowsPerPage}
                      onRowsPerPageChange={e => {
                        setRowsPerPage(Number(e.target.value))
                        setPage(0)
                      }}
                      rowsPerPageOptions={PLAN_ROWS_PER_PAGE}
                      labelRowsPerPage={t('common.rowsPerPage')}
                      data-testid="drain-plan-pagination"
                    />
                  )}
                </>
              )}
            </Box>

            <FormControlLabel
              control={<Switch checked={includeStopped} onChange={e => setIncludeStopped(e.target.checked)} />}
              label={t('hostDrain.includeStopped')}
            />

            {plan && !planError && (plan.projection?.length ?? 0) > 0 && (
              <ProjectionBlock plan={plan} memCeiling={memCeiling} />
            )}

            <Typography variant="caption" color="text.secondary">{t('hostDrain.runsInOrchestrator')}</Typography>
          </>
        )}

        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit" disabled={starting}>{t('common.cancel')}</Button>
        <Button
          onClick={start}
          variant="contained"
          color={mode === 'maintenance' ? 'warning' : 'primary'}
          disabled={!canStart}
          startIcon={starting ? <CircularProgress size={16} /> : undefined}
        >
          {drainWanted ? t('hostDrain.start') : t('common.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
