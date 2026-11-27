'use client'
import { useEffect, useState, useMemo } from 'react'
import { Box, Alert, Button, Typography, CircularProgress } from '@mui/material'
import { useTranslations } from 'next-intl'
import type { K8sTopologyData, K8sResourceKind, DetailRef } from '@/lib/k8s/topologyTypes'
import type { ResourceListItem } from '@/lib/k8s/types'
import type { KindDef } from '@/lib/k8s/resourceKinds'
import { kindByApiKind } from '@/lib/k8s/resourceKinds'
import { scopeToGroup } from '@/lib/k8s/appGrid'
import { K8sTopologyCanvas } from './K8sTopologyCanvas'
import { K8sTopologyToolbar, type K8sTopologyViewMode } from './K8sTopologyToolbar'
import { ResourceDrawer } from './ResourceDrawer'
import { AppGrid } from './AppGrid'
import { NodesView } from './NodesView'

type FetchStatus = 'idle' | 'loading' | 'ok' | 'forbidden' | 'unreachable'

interface K8sTopologyViewProps {
  clusterId: string
  namespace: string
  refreshTick: number
}

export function K8sTopologyView({ clusterId, namespace, refreshTick }: K8sTopologyViewProps) {
  const t = useTranslations('kubernetes.topology')

  const [data, setData] = useState<K8sTopologyData | null>(null)
  const [status, setStatus] = useState<FetchStatus>('idle')
  const [drawerItem, setDrawerItem] = useState<ResourceListItem | null>(null)
  const [drawerKind, setDrawerKind] = useState<KindDef | null>(null)
  const [enabledKinds, setEnabledKinds] = useState<Set<K8sResourceKind>>(() => new Set())
  const [mode, setMode] = useState<K8sTopologyViewMode>('apps')
  const [openGroupKey, setOpenGroupKey] = useState<string | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    setStatus('loading')
    // Fix 5: reset stale drawer on each fetch
    setDrawerItem(null)
    // Reset the app-graph drill-down so a cluster/namespace change returns to the grid
    setOpenGroupKey(null)
    const ns = namespace || 'all'
    fetch(`/api/v1/k8s/clusters/${clusterId}/topology?namespace=${ns}`, { signal: ac.signal })
      .then(async (res) => {
        if (ac.signal.aborted) return
        if (res.status === 403) { setStatus('forbidden'); return }
        if (!res.ok) { setStatus('unreachable'); return }
        const body = (await res.json()) as K8sTopologyData
        setData(body)
        // Seed enabledKinds with all workload kinds present in the DTO
        const presentKinds = new Set(body.resources.map((r) => r.kind))
        setEnabledKinds(presentKinds)
        setStatus('ok')
      })
      .catch(() => {
        if (ac.signal.aborted) return
        setStatus('unreachable')
      })
    return () => ac.abort()
  }, [clusterId, namespace, refreshTick])

  // Fix 1: guard - open no drawer for unknown kind
  function handleDetailRef(ref: DetailRef, kindStr: string) {
    const kd = kindByApiKind(kindStr)
    if (!kd) return
    const item: ResourceListItem = {
      kind: ref.kind,
      name: ref.name,
      namespace: ref.namespace,
      uid: ref.uid ?? '',
      createdAt: '',
      summary: {},
    }
    setDrawerKind(kd)
    setDrawerItem(item)
  }

  // Fix 2: filtered DTO for the canvas, reflows layout
  const filteredData = useMemo<K8sTopologyData | null>(() => {
    if (!data) return null
    if (enabledKinds.size === 0) return null

    const keptResources = data.resources.filter((r) => enabledKinds.has(r.kind))
    const keptIds = new Set(keptResources.map((r) => r.id))
    const keptEdges = data.edges.filter((e) => keptIds.has(e.source) && keptIds.has(e.target))
    const usedGroupKeys = new Set(keptResources.map((r) => r.groupKey))
    const keptGroups = data.groups.filter((g) => usedGroupKeys.has(g.key))

    return {
      ...data,
      groups: keptGroups,
      resources: keptResources,
      edges: keptEdges,
    }
  }, [data, enabledKinds])

  // Fix 3: memoize the drill-down scope so it's only recomputed when its inputs change
  const scopedGroupData = useMemo<K8sTopologyData | null>(() => {
    const source = filteredData ?? data
    if (openGroupKey === null || !source) return null
    return scopeToGroup(source, openGroupKey)
  }, [filteredData, data, openGroupKey])

  function handleToggleKind(kind: K8sResourceKind) {
    setEnabledKinds((prev) => {
      const next = new Set(prev)
      if (next.has(kind)) {
        next.delete(kind)
      } else {
        next.add(kind)
      }
      return next
    })
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Status states */}
      {status === 'loading' && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 1.5 }}>
          <CircularProgress size={24} />
          <Typography variant="body2" color="text.secondary">{t('status.loading')}</Typography>
        </Box>
      )}

      {status === 'forbidden' && (
        <Box sx={{ p: 2 }}>
          <Alert severity="error">{t('status.forbidden')}</Alert>
        </Box>
      )}

      {status === 'unreachable' && (
        <Box sx={{ p: 2 }}>
          <Alert severity="error">{t('status.unreachable')}</Alert>
        </Box>
      )}

      {status === 'ok' && data && (
        <>
          {/* Toolbar (namespace picker is in the explorer header) */}
          <K8sTopologyToolbar
            data={data}
            namespace={namespace}
            enabledKinds={enabledKinds}
            onToggleKind={handleToggleKind}
            mode={mode}
            onModeChange={setMode}
            showKindFilters={mode === 'apps' && openGroupKey !== null}
          />

          {/* Meta notices */}
          <Box sx={{ flexShrink: 0 }}>
            {data.meta.truncated && (
              <Alert severity="warning" sx={{ mx: 2, mt: 1, py: 0.5 }}>{t('meta.truncated')}</Alert>
            )}
            {Object.values(data.meta.perKind).some((v) => v.capped) && (
              <Alert severity="info" sx={{ mx: 2, mt: 1, py: 0.5 }}>{t('meta.capped')}</Alert>
            )}
            {data.meta.correlation.ambiguous > 0 && (
              <Alert severity="warning" sx={{ mx: 2, mt: 1, py: 0.5 }}>{t('meta.ambiguous')}</Alert>
            )}
            {data.infra.bridgeStatus !== 'enabled' && (
              <Alert severity="info" sx={{ mx: 2, mt: 1, py: 0.5 }}>{t('bridge.disabled')}</Alert>
            )}
          </Box>

          {/* Apps grid / app graph / nodes view */}
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {mode === 'nodes' && (
              <NodesView data={data} onDetailRef={handleDetailRef} />
            )}

            {mode === 'apps' && openGroupKey === null && (
              <AppGrid data={data} onOpen={setOpenGroupKey} />
            )}

            {mode === 'apps' && openGroupKey !== null && (
              <>
                <Box sx={{ px: 1.5, py: 0.5, flexShrink: 0 }}>
                  <Button size="small" onClick={() => setOpenGroupKey(null)}>
                    {t('apps.backToApps')}
                  </Button>
                </Box>
                <Box sx={{ flex: 1, minHeight: 0 }}>
                  {scopedGroupData && scopedGroupData.resources.length > 0 ? (
                    <K8sTopologyCanvas
                      data={scopedGroupData}
                      onDetailRef={handleDetailRef}
                    />
                  ) : (
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                      <Typography variant="body2" color="text.secondary">{t('toolbar.noResults')}</Typography>
                    </Box>
                  )}
                </Box>
              </>
            )}
          </Box>

          {/* Resource drawer - only when drawer item is set */}
          {drawerItem && drawerKind && (
            <ResourceDrawer
              clusterId={clusterId}
              kind={drawerKind}
              item={drawerItem}
              onClose={() => setDrawerItem(null)}
            />
          )}
        </>
      )}
    </Box>
  )
}
