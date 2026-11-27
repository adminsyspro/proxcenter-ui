'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import {
  Box, List, ListItemButton, ListItemIcon, ListItemText, ListSubheader,
  Select, MenuItem, IconButton, Typography, Alert, Stack,
  Dialog, DialogTitle, DialogActions, Button,
} from '@mui/material'
import { useTranslations } from 'next-intl'
import { useRBAC } from '@/contexts/RBACContext'
import { NAV_GROUPS, kindByApiKind, OVERVIEW_ICON } from '@/lib/k8s/resourceKinds'
import { useK8sResource } from '@/lib/k8s/useK8sResource'
import { postNodeOp, DRAIN_BACKOFF_MS, type DrainRowState } from '@/lib/k8s/nodeOpsClient'
import { shouldContinueDrain, type DrainResult } from '@/lib/k8s/nodeDrain'
import { NodeDrainDialog } from './NodeDrainDialog'
import { WorkloadActionDialog } from './WorkloadActionDialog'
import type { WorkloadAction } from '@/lib/k8s/workloadActions'
import { panelMessage } from '@/lib/k8s/panelState'
import type { ResourceListItem, NodeMetricsResult, PodMetricsResult } from '@/lib/k8s/types'
import { perNodeUtilization } from '@/lib/k8s/metrics'
import { healthDotColor, type K8sClusterRow, type K8sHealthState } from '../ClusterCard'
import { ResourceTable } from './ResourceTable'
import { KindIcon } from './KindIcon'
import { ResourceDrawer } from './ResourceDrawer'
import { ClusterOverview } from './ClusterOverview'
import { K8sTopologyView } from './K8sTopologyView'
import { HistoryView } from './HistoryView'
import { AddWorkersDialog, RemoveWorkerDialog, WorkerChangeBanner, useWorkerChange } from './WorkerChange'

export function ClusterExplorer({
  clusterId,
  clusterName,
  initialView,
  onBack,
}: {
  clusterId: string
  clusterName?: string
  /** Deep-link the pane to a resource kind (apiKind, e.g. 'node' | 'pod') on
   *  mount and whenever it changes; undefined shows the overview. */
  initialView?: string
  onBack?: () => void
}) {
  const t = useTranslations('kubernetes.explorer')
  const tc = useTranslations('common')
  const tNodeOps = useTranslations('kubernetes.node.ops')
  const tHistory = useTranslations('kubernetes.history')
  const tWorkers = useTranslations('kubernetes.workers')
  const { hasPermission } = useRBAC()
  // Cosmetic gate for the node day-2 actions; the API routes re-check k8s.manage.
  const canManage = hasPermission('k8s.manage')
  // Adding or removing workers creates and destroys VMs: k8s.provision (and
  // the VM rights on the connection, checked by the route).
  const canProvision = hasPermission('k8s.provision')

  const [view, setView] = useState<string>(initialView ?? 'overview') // 'overview' | apiKind
  const [namespace, setNamespace] = useState('')
  const [selected, setSelected] = useState<ResourceListItem | null>(null)
  // The node whose drain-confirm dialog is open (from a table icon or the drawer).
  const [drainDialog, setDrainDialog] = useState<{ item: ResourceListItem } | null>(null)
  // Per-node background drain progress, keyed by node name (shown in table + drawer).
  const [drainStates, setDrainStates] = useState<Record<string, DrainRowState>>({})
  // Pending cordon/uncordon awaiting confirmation (table row action).
  const [cordonConfirm, setCordonConfirm] = useState<ResourceListItem | null>(null)
  // Inline error from a table-row cordon/uncordon (drain errors show in the drawer).
  const [nodeOpError, setNodeOpError] = useState<string | null>(null)
  // Open workload action dialog (table row), and the outcome line shown above the table.
  const [workloadDialog, setWorkloadDialog] = useState<{ action: WorkloadAction; item: ResourceListItem } | null>(null)
  const [workloadNotice, setWorkloadNotice] = useState<string | null>(null)
  useEffect(() => { setWorkloadNotice(null) }, [view])
  const [yamlOpen, setYamlOpen] = useState(false)
  // False once the explorer unmounts, so a background drain loop stops touching state.
  const drainAliveRef = useRef(true)
  useEffect(() => { drainAliveRef.current = true; return () => { drainAliveRef.current = false } }, [])
  // Node names with a drain loop in flight - prevents a second concurrent loop.
  const drainingRef = useRef<Set<string>>(new Set())
  // Follow tree-driven deep-links: reset to the requested kind (or overview)
  // and close any open drawer/YAML when the incoming selection changes (the
  // previous `selected` item belongs to the old kind). Runs only on
  // initialView changes, so manual in-pane navigation is preserved.
  useEffect(() => {
    setView(initialView ?? 'overview')
    setSelected(null)
    setYamlOpen(false)
  }, [initialView])
  const [docHidden, setDocHidden] = useState(false)
  const [overviewTick, setOverviewTick] = useState(0)
  const [namespaces, setNamespaces] = useState<string[]>([])
  const [nodeMetrics, setNodeMetrics] = useState<Record<string, { cpuPct: number; memPct: number }>>({})
  // Per-pod CPU/RAM (% of the pod's node capacity), keyed `${namespace}/${name}`.
  const [podMetrics, setPodMetrics] = useState<Record<string, { cpuPct: number; memPct: number }>>({})
  // Pod count per node for the Nodes table 'pods' column, keyed by node name.
  const [podCounts, setPodCounts] = useState<Record<string, number>>({})

  // Cluster metadata + live health for header
  const [cluster, setCluster] = useState<K8sClusterRow | null>(null)
  const [liveHealth, setLiveHealth] = useState<{
    state?: K8sHealthState
    version?: string
    nodesReady?: number
    nodesTotal?: number
  } | null>(null)

  const loadMeta = useCallback(async (doRefresh: boolean) => {
    try {
      const res = await fetch(
        `/api/v1/k8s/clusters/${clusterId}${doRefresh ? '?refresh=1' : ''}`,
        { cache: 'no-store' },
      )
      if (res.ok) {
        const data = await res.json()
        if (data?.cluster) setCluster(data.cluster)
        if (data?.health) setLiveHealth(data.health)
      }
    } catch {
      /* leave existing state on network error */
    }
  }, [clusterId])

  // Fetch fresh health on mount
  useEffect(() => {
    loadMeta(true)
  }, [loadMeta])

  // Fetch the namespace list once to populate the namespace selector
  useEffect(() => {
    let cancelled = false
    fetch(`/api/v1/k8s/clusters/${clusterId}/resources?kind=namespace`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d?.items) return
        setNamespaces(
          (d.items as ResourceListItem[]).map((i) => i.name).filter(Boolean).sort((a, b) => a.localeCompare(b)),
        )
      })
      .catch(() => { /* selector falls back to All namespaces only */ })
    return () => { cancelled = true }
  }, [clusterId])

  // Per-node CPU/RAM utilization for the Nodes table progress columns
  useEffect(() => {
    if (view !== 'node') return
    let cancelled = false
    fetch(`/api/v1/k8s/clusters/${clusterId}/metrics`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: NodeMetricsResult | null) => {
        if (cancelled) return
        if (!data?.nodes) { setNodeMetrics({}); return }
        const map: Record<string, { cpuPct: number; memPct: number }> = {}
        for (const u of perNodeUtilization(data.nodes)) map[u.name] = { cpuPct: u.cpuPct, memPct: u.memPct }
        setNodeMetrics(map)
      })
      .catch(() => { if (!cancelled) setNodeMetrics({}) })
    return () => { cancelled = true }
  }, [clusterId, view, overviewTick])

  // Pod count per node for the Nodes table 'pods' column: list all pods once and
  // group by spec.nodeName (summary.node). Refetched on overviewTick (drain bumps it).
  useEffect(() => {
    if (view !== 'node') return
    let cancelled = false
    fetch(`/api/v1/k8s/clusters/${clusterId}/resources?kind=pod`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { items?: ResourceListItem[]; truncated?: boolean } | null) => {
        if (cancelled) return
        // On a truncated list (>500 pods cluster-wide) the per-node counts would
        // undercount, so blank the column rather than show wrong numbers.
        if (!data?.items || data.truncated) { setPodCounts({}); return }
        const map: Record<string, number> = {}
        for (const p of data.items) {
          const node = p.summary?.['node']
          if (node) map[node] = (map[node] ?? 0) + 1
        }
        setPodCounts(map)
      })
      .catch(() => { if (!cancelled) setPodCounts({}) })
    return () => { cancelled = true }
  }, [clusterId, view, overviewTick])

  // Per-pod CPU/RAM utilization for the Pods table progress columns
  useEffect(() => {
    if (view !== 'pod') return
    let cancelled = false
    fetch(`/api/v1/k8s/clusters/${clusterId}/metrics?scope=pod`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: PodMetricsResult | null) => {
        if (cancelled) return
        if (!data?.pods) { setPodMetrics({}); return }
        const map: Record<string, { cpuPct: number; memPct: number }> = {}
        for (const p of data.pods) map[`${p.namespace}/${p.name}`] = { cpuPct: p.cpuPct, memPct: p.memPct }
        setPodMetrics(map)
      })
      .catch(() => { if (!cancelled) setPodMetrics({}) })
    return () => { cancelled = true }
  }, [clusterId, view, overviewTick])

  // Track document visibility so polling pauses when the tab is hidden
  useEffect(() => {
    const onVisibility = () => setDocHidden(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    // Capture initial state (page may already be hidden on mount in some flows)
    setDocHidden(document.hidden)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const paused = yamlOpen || docHidden

  const kind = view === 'overview' ? null : (kindByApiKind(view) ?? null)
  const nsParam = kind?.scope === 'namespaced' && namespace ? namespace : undefined

  const { items, truncated, status, errorMessage, refresh } = useK8sResource(
    clusterId,
    kind?.apiKind ?? null,
    nsParam,
    { paused },
  )
  // `refresh` closes over the current view's kind, so a long-running background
  // drain must call the LATEST one (via ref) - never the one captured at confirm
  // time, which would refetch node data into whatever view the user navigated to.
  const refreshRef = useRef(refresh)
  useEffect(() => { refreshRef.current = refresh }, [refresh])

  const msg = panelMessage({ status, truncated })

  // For the Nodes/Pods tables, merge live CPU/RAM utilization into each row's
  // summary (nodes keyed by name; pods by namespace/name).
  let displayItems = items
  if (kind?.apiKind === 'node') {
    displayItems = items.map((it) => {
      const m = nodeMetrics[it.name]
      const pc = podCounts[it.name]
      return {
        ...it,
        summary: {
          ...it.summary,
          cpuPct: m ? String(m.cpuPct) : '',
          memPct: m ? String(m.memPct) : '',
          pods: pc != null ? String(pc) : '',
        },
      }
    })
  } else if (kind?.apiKind === 'pod') {
    displayItems = items.map((it) => {
      const m = podMetrics[`${it.namespace ?? ''}/${it.name}`]
      return {
        ...it,
        summary: {
          ...it.summary,
          cpuPct: m ? String(m.cpuPct) : '',
          memPct: m ? String(m.memPct) : '',
        },
      }
    })
  }

  // Derived header values
  const state: K8sHealthState | undefined = liveHealth?.state ?? cluster?.healthState
  const version = liveHealth?.version ?? cluster?.version ?? undefined
  const ready = liveHealth?.nodesReady ?? cluster?.healthDetail?.nodesReady
  const total = liveHealth?.nodesTotal ?? cluster?.healthDetail?.nodesTotal
  const displayName = cluster?.name ?? clusterName

  // A cluster ProxCenter deployed: its workers can be added and removed.
  const workerChange = useWorkerChange(clusterId, () => { void loadMeta(true); refreshRef.current(); setOverviewTick(n => n + 1) })
  const layout = workerChange.state?.layout ?? null
  const canChangeWorkers = canProvision && !!layout?.changeable && workerChange.state?.status === 'completed'
  const workerNames = new Set((layout?.workers ?? []).map(w => w.name))
  const [addWorkersOpen, setAddWorkersOpen] = useState(false)
  const [removeWorker, setRemoveWorker] = useState<string | null>(null)
  const [workerErrorHidden, setWorkerErrorHidden] = useState<string | null>(null)
  const workerState = workerChange.state && workerChange.state.error === workerErrorHidden
    ? { ...workerChange.state, error: null }
    : workerChange.state
  const startedWorkerChange = () => {
    setAddWorkersOpen(false)
    setRemoveWorker(null)
    void workerChange.reload()
  }

  const handleRefresh = () => {
    loadMeta(true)
    refresh()
    setOverviewTick(n => n + 1)
  }

  // Cordon/uncordon from a table row: confirm first (the toggle is not otherwise
  // visible in the table), then a single call + refetch.
  const handleNodeCordonToggle = useCallback((item: ResourceListItem) => {
    setNodeOpError(null)
    setCordonConfirm(item)
  }, [])

  const confirmCordon = useCallback(async () => {
    const item = cordonConfirm
    setCordonConfirm(null)
    if (!item) return
    const next = item.summary?.['unschedulable'] !== 'true'
    try {
      await postNodeOp(clusterId, item.name, 'cordon', { unschedulable: next })
      // Uncordoning clears any leftover stopped/error drain indicator on the row.
      if (!next) setDrainStates((s) => { const rest = { ...s }; delete rest[item.name]; return rest })
      refresh()
    } catch (err) {
      setNodeOpError(err instanceof Error ? err.message : String(err))
    }
  }, [cordonConfirm, clusterId, refresh])

  // Drain (from a table icon or the drawer): open the shared confirm dialog; the
  // drain itself runs in the background once confirmed.
  const handleNodeDrain = useCallback((item: ResourceListItem) => {
    setNodeOpError(null)
    setDrainDialog({ item })
  }, [])

  // Background drain runner: after confirm, keep POSTing /drain until the node is
  // empty, stalled, or errors. Progress is surfaced per-node in drainStates
  // (table row + drawer). There is no Cancel button, so the loop must self-stop:
  // fast when a real blocker (PDB / rejected eviction) has stalled it, and after
  // a generous unconditional cap otherwise (e.g. a pod stuck Terminating).
  const startDrain = useCallback(async (nodeName: string, force: boolean): Promise<DrainRowState['phase']> => {
    if (drainingRef.current.has(nodeName)) return 'draining' // already draining this node
    drainingRef.current.add(nodeName)
    let final: DrainRowState['phase'] = 'error'
    setDrainStates((s) => ({ ...s, [nodeName]: { phase: 'draining' } }))
    let prevRemaining = Infinity
    let noProgress = 0
    try {
      for (;;) {
        const result = (await postNodeOp(clusterId, nodeName, 'drain', { force })) as DrainResult
        if (!drainAliveRef.current) return final
        setDrainStates((s) => ({ ...s, [nodeName]: { phase: 'draining', result } }))
        refreshRef.current() // latest view's refresh (never the one captured at confirm)
        setOverviewTick((n) => n + 1) // refresh pod counts + metrics as pods leave
        if (result.done) { final = 'done'; setDrainStates((s) => ({ ...s, [nodeName]: { phase: 'done', result } })); break }
        const rem = result.remaining.length
        noProgress = rem < prevRemaining ? 0 : noProgress + 1
        prevRemaining = rem
        // Fast-stop on a real blocker; hard-stop after ~3 min of zero progress so
        // pods stuck Terminating cannot spin forever. Gracefully terminating pods
        // (remaining shrinking) reset the counter and keep the loop going.
        const blocked = result.blockedByPdb.length > 0 || result.evictionFailures.length > 0
        if (!shouldContinueDrain(result) || (blocked && noProgress >= 3) || noProgress >= 60) {
          final = 'stopped'; setDrainStates((s) => ({ ...s, [nodeName]: { phase: 'stopped', result } })); break
        }
        await new Promise((r) => setTimeout(r, DRAIN_BACKOFF_MS))
        if (!drainAliveRef.current) return final
      }
    } catch (err) {
      if (drainAliveRef.current) {
        setDrainStates((s) => ({ ...s, [nodeName]: { phase: 'error', error: err instanceof Error ? err.message : String(err) } }))
      }
    } finally {
      drainingRef.current.delete(nodeName)
    }
    return final
  }, [clusterId])

  // Normal row click / drawer close.
  const handleRowClick = useCallback((item: ResourceListItem) => { setSelected(item) }, [])
  const handleDrawerClose = useCallback(() => { setSelected(null) }, [])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Full-width header */}
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{
          flexShrink: 0,
          borderBottom: 1,
          borderColor: 'divider',
          px: 2,
          py: 1.5,
        }}
      >
        {onBack && (
          <IconButton onClick={onBack} aria-label={tc('back')} size="small" sx={{ mr: 0.5 }}>
            <i className="ri-arrow-left-line" style={{ fontSize: 18 }} />
          </IconButton>
        )}

        <Box sx={{ position: 'relative', width: 26, height: 26, flexShrink: 0 }}>
          <img src="/images/kubernetes-logo.svg" alt="Kubernetes" width={26} height={26} />
          <Box sx={{
            position: 'absolute', bottom: -1, right: -2, width: 9, height: 9,
            borderRadius: '50%', bgcolor: healthDotColor(state),
            border: '1.5px solid', borderColor: 'background.paper',
            boxShadow: state === 'healthy' ? `0 0 4px ${healthDotColor(state)}` : 'none',
          }} />
        </Box>

        <Typography variant="h6" noWrap sx={{ flexShrink: 1, minWidth: 0 }}>
          {displayName}
        </Typography>

        {(version || typeof total === 'number') && (
          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
            {[
              version,
              typeof total === 'number' ? `${ready ?? 0}/${total} nodes` : undefined,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Typography>
        )}

        {/* Push namespace + refresh to the right */}
        <Box sx={{ flex: 1 }} />

        {(kind?.scope === 'namespaced' || view === 'topology') && (
          <Select
            size="small"
            value={namespace}
            displayEmpty
            onChange={e => setNamespace(e.target.value)}
            renderValue={(val) => (val ? (val as string) : t('allNamespaces'))}
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="">{t('allNamespaces')}</MenuItem>
            {namespaces.map((ns) => (
              <MenuItem key={ns} value={ns}>{ns}</MenuItem>
            ))}
          </Select>
        )}

        {view === 'node' && canChangeWorkers && (
          <Button size="small" variant="outlined" startIcon={<i className="ri-add-line" />} onClick={() => setAddWorkersOpen(true)}>
            {tWorkers('addButton')}
          </Button>
        )}

        <IconButton onClick={handleRefresh} aria-label={t('refresh')} size="small">
          <i className="ri-refresh-line" style={{ fontSize: 18 }} />
        </IconButton>
      </Stack>

      {/* Body row: kind-nav + content */}
      <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Left nav */}
        <Box
          sx={{
            width: 220,
            flexShrink: 0,
            borderRight: 1,
            borderColor: 'divider',
            overflow: 'auto',
          }}
        >
          <List dense disablePadding>
            <ListItemButton
              selected={view === 'overview'}
              onClick={() => { setView('overview'); setSelected(null) }}
            >
              <ListItemIcon sx={{ minWidth: 30 }}>
                <i className={OVERVIEW_ICON} style={{ fontSize: 17 }} />
              </ListItemIcon>
              <ListItemText primary={t('overview.title')} />
            </ListItemButton>

            <ListItemButton
              selected={view === 'topology'}
              onClick={() => { setView('topology'); setSelected(null) }}
            >
              <ListItemIcon sx={{ minWidth: 30 }}>
                <i className="ri-git-branch-line" style={{ fontSize: 17 }} />
              </ListItemIcon>
              <ListItemText primary={t('topology.title')} />
            </ListItemButton>

            <ListItemButton
              selected={view === 'history'}
              onClick={() => { setView('history'); setSelected(null) }}
            >
              <ListItemIcon sx={{ minWidth: 30 }}>
                <i className="ri-time-line" style={{ fontSize: 17 }} />
              </ListItemIcon>
              <ListItemText primary={tHistory('title')} />
            </ListItemButton>

            {NAV_GROUPS.map(g => (
              <li key={g.group}>
                <ul style={{ padding: 0, listStyle: 'none', margin: 0 }}>
                  <ListSubheader
                    disableSticky
                    sx={{
                      lineHeight: '2rem',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: 0.4,
                      borderTop: '1px solid',
                      borderColor: 'divider',
                      mt: 0.5,
                    }}
                  >
                    {t(`group.${g.group}`)}
                  </ListSubheader>
                  {g.kinds.map(k => (
                    <ListItemButton
                      key={k}
                      selected={view === k}
                      onClick={() => { setView(k); setSelected(null) }}
                      sx={{ pl: 2.5 }}
                    >
                      <ListItemIcon sx={{ minWidth: 30 }}>
                        <KindIcon icon={kindByApiKind(k)?.icon ?? 'ri-circle-line'} iconImg={kindByApiKind(k)?.iconImg} size={16} />
                      </ListItemIcon>
                      <ListItemText primary={t(`kind.${k}`)} />
                    </ListItemButton>
                  ))}
                </ul>
              </li>
            ))}
          </List>
        </Box>

        {/* Main content */}
        <Box sx={{ flex: 1, p: view === 'topology' ? 0 : 2, overflow: view === 'topology' ? 'hidden' : 'auto', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {/* Overview */}
          {view === 'overview' && (
            <ClusterOverview
              clusterId={clusterId}
              refreshTick={overviewTick}
              onOpenResource={(k, item) => { setView(k); setSelected(item) }}
            />
          )}

          {view === 'history' && (
            <HistoryView
              clusterId={clusterId}
              namespace={namespace || undefined}
              refreshTick={overviewTick}
              onOpenResource={(k, item) => { setView(k); setSelected(item) }}
            />
          )}

          {/* Topology - full height canvas */}
          {view === 'topology' && (
            <K8sTopologyView
              clusterId={clusterId}
              namespace={namespace}
              refreshTick={overviewTick}
            />
          )}

          {/* Resource view */}
          {kind && (
            <>
              {msg && (
                <Alert severity={msg.tone} sx={{ mb: 1 }}>
                  {t(`msg.${msg.key}`)}
                  {errorMessage ? `: ${errorMessage}` : ''}
                </Alert>
              )}

              {status === 'loading' && (
                <Typography variant="body2" color="text.secondary">
                  {t('loading')}
                </Typography>
              )}

              {status === 'ok' && items.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  {t('empty')}
                </Typography>
              )}

              {nodeOpError && (
                <Alert severity="error" sx={{ mb: 1 }} onClose={() => setNodeOpError(null)}>{nodeOpError}</Alert>
              )}
              {workloadNotice && (
                <Alert severity="success" sx={{ mb: 1 }} onClose={() => setWorkloadNotice(null)}>{workloadNotice}</Alert>
              )}

              {view === 'node' && (
                <WorkerChangeBanner state={workerState} onDismissError={() => setWorkerErrorHidden(workerChange.state?.error ?? null)} />
              )}

              {status === 'ok' && items.length > 0 && (
                <ResourceTable
                  key={kind.apiKind}
                  kind={kind}
                  items={displayItems}
                  onRowClick={handleRowClick}
                  canManage={canManage}
                  drainStates={drainStates}
                  onCordonToggle={handleNodeCordonToggle}
                  onDrain={handleNodeDrain}
                  removableNodes={canChangeWorkers ? workerNames : undefined}
                  onRemoveNode={item => setRemoveWorker(item.name)}
                  onWorkloadAction={(action, item) => { setWorkloadNotice(null); setWorkloadDialog({ action, item }) }}
                />
              )}

              {addWorkersOpen && layout && (
                <AddWorkersDialog
                  clusterId={clusterId}
                  clusterName={displayName ?? ''}
                  layout={layout}
                  onClose={() => setAddWorkersOpen(false)}
                  onStarted={startedWorkerChange}
                />
              )}
              {removeWorker && (
                <RemoveWorkerDialog
                  clusterId={clusterId}
                  nodeName={removeWorker}
                  drain={name => startDrain(name, false)}
                  onClose={() => setRemoveWorker(null)}
                  onStarted={startedWorkerChange}
                />
              )}

              {workloadDialog && (
                <WorkloadActionDialog
                  clusterId={clusterId}
                  action={workloadDialog.action}
                  item={workloadDialog.item}
                  onClose={() => setWorkloadDialog(null)}
                  onDone={(message) => {
                    setWorkloadDialog(null)
                    setWorkloadNotice(message)
                    refresh()
                    setOverviewTick(n => n + 1)
                  }}
                />
              )}

              <ResourceDrawer
                clusterId={clusterId}
                kind={kind}
                item={selected}
                canManage={canManage}
                drainState={selected ? drainStates[selected.name] : undefined}
                onNodeMutated={refresh}
                onOpenDrainDialog={() => { if (selected) handleNodeDrain(selected) }}
                onClose={handleDrawerClose}
                onYamlOpenChange={setYamlOpen}
                compareCandidates={items}
              />

              {drainDialog && (
                <NodeDrainDialog
                  clusterId={clusterId}
                  nodeName={drainDialog.item.name}
                  controlPlane={(drainDialog.item.summary?.['roles'] ?? '').split(',').map((r) => r.trim()).some((r) => r === 'control-plane' || r === 'master')}
                  lastReadyNode={(() => {
                    const readySched = items.filter((n) => n.summary?.['ready'] === 'True' && n.summary?.['unschedulable'] !== 'true')
                    return readySched.length === 1 && readySched[0].name === drainDialog.item.name
                  })()}
                  onConfirm={(force) => { void startDrain(drainDialog.item.name, force); setDrainDialog(null) }}
                  onClose={() => setDrainDialog(null)}
                />
              )}

              <Dialog open={!!cordonConfirm} onClose={() => setCordonConfirm(null)} maxWidth="xs" fullWidth>
                <DialogTitle>
                  {cordonConfirm && (cordonConfirm.summary?.['unschedulable'] === 'true'
                    ? tNodeOps('confirmUncordonTitle', { node: cordonConfirm.name })
                    : tNodeOps('confirmCordonTitle', { node: cordonConfirm.name }))}
                </DialogTitle>
                <DialogActions>
                  <Button onClick={() => setCordonConfirm(null)}>{tNodeOps('cancel')}</Button>
                  <Button variant="contained" onClick={confirmCordon}>
                    {cordonConfirm?.summary?.['unschedulable'] === 'true' ? tNodeOps('uncordon') : tNodeOps('cordon')}
                  </Button>
                </DialogActions>
              </Dialog>
            </>
          )}
        </Box>
      </Box>
    </Box>
  )
}
