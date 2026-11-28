'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { Box, Typography, Stack, Button, IconButton, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, CircularProgress, Checkbox, FormControlLabel, Alert, Snackbar } from '@mui/material'
import { useTranslations } from 'next-intl'
import { useRBAC } from '@/contexts/RBACContext'
import { useLicense, Features } from '@/contexts/LicenseContext'
import { clusterUtilization, pct, type ClusterUtil } from '@/lib/k8s/metrics'
import { isIntegrating } from '@/lib/k8s/clusterHealthStatus'
import type { NodeMetricsResult, ListResourcesResult } from '@/lib/k8s/types'
import type { InventorySelection } from './types'
import ClusterCard, { type K8sClusterRow } from './k8s/ClusterCard'
import K8sSummaryPanel from './k8s/K8sSummaryPanel'
import ImportClusterDialog from './k8s/ImportClusterDialog'
import KubernetesDeployWizard from '@/components/k8s/KubernetesDeployWizard'

const AddIcon = () => <i className="ri-add-line" style={{ fontSize: 18 }} />
const RocketIcon = () => <i className="ri-rocket-2-line" style={{ fontSize: 18 }} />

type Enrichment = { util: ClusterUtil | null; pods: { count: number; truncated: boolean } | null }

function isReachable(state?: K8sClusterRow['healthState']): boolean {
  return state === 'healthy' || state === 'degraded' || state === 'stale'
}

// Calls the parent's refresh callback; a rejected promise from it is ignored
// so it never surfaces as an unhandled rejection.
function notifyChanged(cb?: () => void | Promise<void>): void {
  Promise.resolve(cb?.()).catch(() => {})
}

type Props = {
  onClusterClick?: (sel: InventorySelection) => void
  /** Notifies the parent that the cluster list changed (create/import/delete) so it can refresh the inventory tree. */
  onClustersChanged?: () => void | Promise<void>
}

export default function KubernetesDashboard({ onClusterClick, onClustersChanged }: Props) {
  const t = useTranslations()
  const { hasPermission } = useRBAC()
  const canManage = hasPermission('k8s.manage')
  // Deploying a cluster creates VMs: its own permission, on top of the feature.
  const { hasFeature } = useLicense()
  const canProvision = hasFeature(Features.KUBERNETES) && hasPermission('k8s.provision')
  const [clusters, setClusters] = useState<K8sClusterRow[]>([])
  const [connectionNames, setConnectionNames] = useState<Record<string, string>>({})
  const [enrichment, setEnrichment] = useState<Record<string, Enrichment>>({})
  const [importOpen, setImportOpen] = useState(false)
  const [deployOpen, setDeployOpen] = useState(false)
  const [destroyNodes, setDestroyNodes] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [rechecking, setRechecking] = useState<Set<string>>(new Set())
  // Ref mirror of `rechecking` so recheck() can dedupe re-entrant calls
  // (auto-probe + manual click on the same id) without a stale closure.
  const recheckingRef = useRef<Set<string>>(new Set())
  // Ids already auto-probed this mount: each never-checked cluster is probed
  // at most once on load (not on every re-render or list refresh).
  const autoProbed = useRef<Set<string>>(new Set())

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/k8s/clusters', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setClusters(Array.isArray(data?.clusters) ? data.clusters : [])
      }
    } catch {
      /* network error: leave the existing list untouched */
    }
    try {
      const res = await fetch('/api/v1/connections', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        const list: any[] = Array.isArray(data) ? data : (data?.data ?? data?.connections ?? [])
        const map: Record<string, string> = {}
        for (const c of list) { if (c?.id && c?.name) map[c.id] = c.name }
        setConnectionNames(map)
      }
    } catch {
      /* network error: chip falls back to the raw connection id */
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // On-demand health probe: GET ?refresh=1 runs a live check server-side and
  // returns the updated row, which is merged back into the list (this is what
  // flips a card from the "integrating" loader to its real state).
  const recheck = useCallback(async (id: string) => {
    if (recheckingRef.current.has(id)) return
    recheckingRef.current.add(id)
    setRechecking(prev => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
    try {
      const res = await fetch(`/api/v1/k8s/clusters/${id}?refresh=1`, { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        const updated = data?.cluster
        if (updated?.id) {
          setClusters(prev => prev.map(c => (c.id === updated.id ? { ...c, ...updated } : c)))
        }
      }
    } catch {
      /* network error: keep the current row; the loader clears below */
    } finally {
      recheckingRef.current.delete(id)
      setRechecking(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }, [])

  // Auto-probe never-checked ("integrating") clusters after load so they
  // resolve to their real state on their own. Sequential on purpose: avoids
  // a request burst when several clusters were just deployed. Runs once per
  // id per mount (autoProbed guard), not on a timer.
  useEffect(() => {
    const pending = clusters.filter(c => isIntegrating(c) && !autoProbed.current.has(c.id))
    if (pending.length === 0) return
    for (const c of pending) autoProbed.current.add(c.id)
    void (async () => {
      for (const c of pending) {
        await recheck(c.id)
      }
    })()
  }, [clusters, recheck])

  // Clear any prior error whenever the delete target changes (dialog opened,
  // switched to another cluster, or closed) so nothing carries over.
  useEffect(() => {
    setDestroyNodes(false)
    setDeleteError(null)
  }, [deleteId])

  const deleteTarget = deleteId ? clusters.find(c => c.id === deleteId) : undefined

  const handleDelete = useCallback(async () => {
    if (!deleteId) return
    setDeleting(true)
    setDeleteError(null)
    try {
      const qs = destroyNodes ? '?destroyNodes=true' : ''
      const res = await fetch(`/api/v1/k8s/clusters/${deleteId}${qs}`, { method: 'DELETE' })
      if (res.ok) {
        setDeleteId(null)
        load()
        notifyChanged(onClustersChanged)
      } else if (res.status === 409) {
        // The server kept the cluster and its node mapping so the destroy can
        // be retried; name the VMs that failed. When a VM was refused before
        // anything was touched, the others are reported as kept.
        const body = await res.json().catch(() => null)
        const results: { status?: string; vmid: number }[] = Array.isArray(body?.results) ? body.results : []
        const failed = results.filter(r => r?.status === 'error').map(r => r.vmid)
        const key = results.some(r => r?.status === 'kept') ? 'kubernetes.delete.destroyRefused' : 'kubernetes.delete.destroyFailed'
        setDeleteError(t(key) + (failed.length > 0 ? ` (VMID: ${failed.join(', ')})` : ''))
      } else {
        setDeleteError(t('common.error'))
      }
    } catch {
      setDeleteError(t('common.error'))
    } finally {
      setDeleting(false)
    }
  }, [deleteId, destroyNodes, load, onClustersChanged, t])

  // Fetch the cluster's kubeconfig (rebuilt server-side from the stored
  // credential) and trigger a browser download. Available for any cluster the
  // user can manage, deployed or imported.
  const handleDownloadKubeconfig = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/v1/k8s/clusters/${id}/kubeconfig`)
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.kubeconfig) {
        setDownloadError(t('common.error'))
        return
      }
      const blob = new Blob([body.kubeconfig], { type: 'text/yaml' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${body.name || 'cluster'}.kubeconfig`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setDownloadError(t('common.error'))
    }
  }, [t])

  // Enrich reachable clusters with live pods + CPU/RAM (one fetch pair per
  // cluster). Feeds both the KPI blocks and each card's indicators.
  useEffect(() => {
    const ids = clusters.filter(c => isReachable(c.healthState)).map(c => c.id)
    if (ids.length === 0) {
      setEnrichment({})
      return
    }
    const ac = new AbortController()
    void (async () => {
      const entries = await Promise.all(
        ids.map(async (id): Promise<[string, Enrichment]> => {
          let util: ClusterUtil | null = null
          let pods: { count: number; truncated: boolean } | null = null
          try {
            const [mRes, pRes] = await Promise.all([
              fetch(`/api/v1/k8s/clusters/${id}/metrics`, { signal: ac.signal }),
              fetch(`/api/v1/k8s/clusters/${id}/resources?kind=pod`, { signal: ac.signal }),
            ])
            if (mRes.ok) {
              const m = (await mRes.json()) as NodeMetricsResult
              if (!m.errorCode && m.nodes?.length) util = clusterUtilization(m.nodes)
            }
            if (pRes.ok) {
              const p = (await pRes.json()) as ListResourcesResult
              if (!p.errorCode) pods = { count: p.items?.length ?? 0, truncated: !!p.truncated }
            }
          } catch {
            /* ignore: cluster stays on its DB-backed health */
          }
          return [id, { util, pods }]
        }),
      )
      if (ac.signal.aborted) return
      setEnrichment(Object.fromEntries(entries))
    })()
    return () => ac.abort()
  }, [clusters])

  const kpi = useMemo(() => {
    let nodesReady = 0, nodesTotal = 0, pods = 0, podsTruncated = false, hasPods = false
    let cpuUsed = 0, cpuAlloc = 0, memUsed = 0, memAlloc = 0
    const health = { healthy: 0, degraded: 0, down: 0 }
    for (const c of clusters) {
      nodesReady += c.healthDetail?.nodesReady ?? 0
      nodesTotal += c.healthDetail?.nodesTotal ?? 0
      const e = enrichment[c.id]
      if (e?.pods) {
        pods += e.pods.count
        podsTruncated = podsTruncated || e.pods.truncated
        hasPods = true
      }
      if (e?.util) {
        cpuUsed += e.util.cpuUsedMilli
        cpuAlloc += e.util.cpuAllocMilli
        memUsed += e.util.memUsedBytes
        memAlloc += e.util.memAllocBytes
      }
      if (c.healthState === 'healthy') health.healthy++
      else if (c.healthState === 'degraded' || c.healthState === 'stale') health.degraded++
      else if (c.healthState === 'unreachable' || c.healthState === 'auth_failed') health.down++
    }
    return {
      clusters: clusters.length,
      nodesReady, nodesTotal, pods, podsTruncated, hasPods,
      cpuPct: pct(cpuUsed, cpuAlloc), memPct: pct(memUsed, memAlloc), hasUtil: cpuAlloc > 0,
      health,
    }
  }, [clusters, enrichment])


  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {clusters.length === 0 ? (
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            gap: 2,
          }}
        >
          <img
            src="/images/kubernetes-logo.svg"
            alt="Kubernetes"
            width={96}
            height={96}
            style={{ opacity: 0.85 }}
          />
          <Typography color="text.secondary">{t('kubernetes.empty')}</Typography>
          <Stack direction="row" spacing={1.5}>
            {canManage && (
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setImportOpen(true)}>
                {t('kubernetes.addCluster')}
              </Button>
            )}
            {canProvision && (
              <Button variant="outlined" startIcon={<RocketIcon />} onClick={() => setDeployOpen(true)}>
                {t('kubernetes.provision.deployButton')}
              </Button>
            )}
          </Stack>
        </Box>
      ) : (
        <>
          {/* Aggregate summary across all clusters */}
          <K8sSummaryPanel summary={kpi} />

          {(canManage || canProvision) && (
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mb: 1.5 }}>
              {canManage && (
                <IconButton
                  size="small"
                  color="primary"
                  onClick={() => setImportOpen(true)}
                  title={t('kubernetes.addCluster')}
                  aria-label={t('kubernetes.addCluster')}
                >
                  <AddIcon />
                </IconButton>
              )}
              {canProvision && (
                <IconButton
                  size="small"
                  color="primary"
                  onClick={() => setDeployOpen(true)}
                  title={t('kubernetes.provision.deployButton')}
                  aria-label={t('kubernetes.provision.deployButton')}
                >
                  <RocketIcon />
                </IconButton>
              )}
            </Box>
          )}
          <Stack spacing={1.5}>
            {clusters.map(c => {
              const e = enrichment[c.id]
              return (
                <ClusterCard
                  key={c.id}
                  cluster={c}
                  util={e?.util ? { cpuPct: e.util.cpuPct, memPct: e.util.memPct } : null}
                  pods={e?.pods ?? null}
                  connectionName={c.proxmoxConnectionId ? (connectionNames[c.proxmoxConnectionId] ?? null) : null}
                  onClick={() => onClusterClick?.({ type: 'kubernetes-cluster', id: c.id })}
                  onDelete={canManage ? () => setDeleteId(c.id) : undefined}
                  onRecheck={recheck}
                  rechecking={rechecking.has(c.id)}
                  onDownloadKubeconfig={canManage ? handleDownloadKubeconfig : undefined}
                />
              )
            })}
          </Stack>
        </>
      )}

      {canManage && (
        <ImportClusterDialog
          open={importOpen}
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setImportOpen(false)
            load()
            notifyChanged(onClustersChanged)
          }}
        />
      )}
      {canProvision && (
        <KubernetesDeployWizard
          open={deployOpen}
          onClose={() => setDeployOpen(false)}
          onCreated={() => {
            // The dialog stays open on its "cluster ready" panel; the user
            // closes it from there.
            load()
            notifyChanged(onClustersChanged)
          }}
          // Its health is stored by then: show it without waiting for a reload.
          onIntegrated={() => {
            load()
            notifyChanged(onClustersChanged)
          }}
        />
      )}
      {canManage && (
        <Dialog open={!!deleteId} onClose={() => { if (!deleting) setDeleteId(null) }} maxWidth="xs" fullWidth>
          <DialogTitle>{t('common.delete')}</DialogTitle>
          <DialogContent>
            <DialogContentText>{t('kubernetes.delete.confirm')}</DialogContentText>
            {deleteTarget?.source === 'deployed' && canProvision && (
              <>
                <FormControlLabel
                  sx={{ mt: 1.5, mr: 0 }}
                  control={<Checkbox checked={destroyNodes} onChange={e => setDestroyNodes(e.target.checked)} disabled={deleting} />}
                  label={t('kubernetes.delete.destroyNodes', { count: 0 })}
                />
                {destroyNodes && (
                  <Alert severity="warning" sx={{ mt: 1 }}>{t('kubernetes.delete.destroyNodesWarn')}</Alert>
                )}
              </>
            )}
            {deleteError && (
              <Alert severity="error" sx={{ mt: 1.5 }}>
                {deleteError}
              </Alert>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDeleteId(null)} disabled={deleting}>{t('common.cancel')}</Button>
            <Button
              color="error"
              variant="contained"
              onClick={handleDelete}
              disabled={deleting}
              startIcon={deleting ? <CircularProgress size={16} /> : undefined}
            >
              {t('common.delete')}
            </Button>
          </DialogActions>
        </Dialog>
      )}

      <Snackbar
        open={!!downloadError}
        autoHideDuration={5000}
        onClose={() => setDownloadError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setDownloadError(null)} variant="filled">
          {downloadError}
        </Alert>
      </Snackbar>
    </Box>
  )
}
