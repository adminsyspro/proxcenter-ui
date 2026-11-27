'use client'
import { useEffect, useState } from 'react'
import { Box, Typography, useTheme } from '@mui/material'
import { useTranslations } from 'next-intl'
import CircularGauge from '@/components/dashboard/widgets/CircularGauge'
import { kindByApiKind } from '@/lib/k8s/resourceKinds'
import {
  OVERVIEW_KINDS, computeKindStat, healthRatioColor,
  type KindStat, type OverviewKind,
} from '@/lib/k8s/overviewStats'
import type { ResourceListItem, EventItem, NodeMetricsResult } from '@/lib/k8s/types'
import { OverviewCharts } from './OverviewCharts'
import { KindIcon } from './KindIcon'
import { IssuesPanel } from './IssuesPanel'
import { detectIssues, type Issue } from '@/lib/k8s/issues'
import type { K8sResourceKind } from '@/lib/k8s/types'

interface ListFetch { items: ResourceListItem[]; truncated: boolean; errorCode?: string }

async function fetchList(clusterId: string, kind: string, signal: AbortSignal): Promise<ListFetch | null> {
  try {
    const res = await fetch(`/api/v1/k8s/clusters/${clusterId}/resources?kind=${kind}`, { signal })
    if (!res.ok) return null
    const body = await res.json()
    return { items: (body.items || []) as ResourceListItem[], truncated: !!body.truncated, errorCode: body.errorCode }
  } catch {
    return null
  }
}

async function fetchEvents(clusterId: string, signal: AbortSignal): Promise<{ items: EventItem[]; errorCode?: string } | null> {
  try {
    const res = await fetch(`/api/v1/k8s/clusters/${clusterId}/events`, { signal })
    if (!res.ok) return null
    const body = await res.json()
    return { items: (body.items || []) as EventItem[], errorCode: body.errorCode }
  } catch {
    return null
  }
}

async function fetchMetrics(clusterId: string, signal: AbortSignal): Promise<{ value: NodeMetricsResult | null; errorCode?: string }> {
  try {
    const res = await fetch(`/api/v1/k8s/clusters/${clusterId}/metrics`, { signal })
    if (!res.ok) return { value: null, errorCode: 'unreachable' }
    const value = (await res.json()) as NodeMetricsResult
    return { value, errorCode: value.errorCode }
  } catch {
    return { value: null, errorCode: 'unreachable' }
  }
}

export function ClusterOverview({ clusterId, refreshTick = 0, onOpenResource }: {
  clusterId: string
  refreshTick?: number
  /** Open a resource from the problems list (switches the explorer to its kind). */
  onOpenResource?: (kind: K8sResourceKind, item: ResourceListItem) => void
}) {
  const t = useTranslations('kubernetes.explorer')
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'

  const [lists, setLists] = useState<Record<string, ListFetch | null>>({})
  const [pods, setPods] = useState<ResourceListItem[]>([])
  const [podsTruncated, setPodsTruncated] = useState(false)
  const [nodeNames, setNodeNames] = useState<string[]>([])
  const [events, setEvents] = useState<EventItem[]>([])
  const [eventsError, setEventsError] = useState<string | undefined>(undefined)
  const [metrics, setMetrics] = useState<{ value: NodeMetricsResult | null; errorCode?: string }>({ value: null })
  const [issues, setIssues] = useState<Issue[]>([])
  const [issuesLoading, setIssuesLoading] = useState(true)

  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      // The problems list reuses node, deployment and pod; it adds four lists,
      // read once per open or refresh like the rest (never polled).
      const [n, ns, dep, pod, ev, m, sts, ds, job, pvc] = await Promise.all([
        fetchList(clusterId, 'node', ac.signal),
        fetchList(clusterId, 'namespace', ac.signal),
        fetchList(clusterId, 'deployment', ac.signal),
        fetchList(clusterId, 'pod', ac.signal),
        fetchEvents(clusterId, ac.signal),
        fetchMetrics(clusterId, ac.signal),
        fetchList(clusterId, 'statefulset', ac.signal),
        fetchList(clusterId, 'daemonset', ac.signal),
        fetchList(clusterId, 'job', ac.signal),
        fetchList(clusterId, 'pvc', ac.signal),
      ])
      if (ac.signal.aborted) return
      setIssues(detectIssues({
        nodes: n?.items, pods: pod?.items, deployments: dep?.items, statefulsets: sts?.items,
        daemonsets: ds?.items, jobs: job?.items, pvcs: pvc?.items,
      }))
      setIssuesLoading(false)
      setLists({ node: n, namespace: ns, deployment: dep, pod })
      setPods(pod?.items ?? [])
      setPodsTruncated(pod?.truncated ?? false)
      setNodeNames((n?.items ?? []).map(i => i.name))
      setEvents(ev?.items ?? [])
      setEventsError(ev?.errorCode)
      setMetrics(m)
    })()
    return () => ac.abort()
  }, [clusterId, refreshTick])

  // Live-refresh utilisation metrics every 5s (instantaneous samples from
  // metrics-server; keeps the per-node CPU/RAM bars and cluster gauges current
  // without re-fetching the whole resource set).
  useEffect(() => {
    let cancelled = false
    const ac = new AbortController()
    const id = setInterval(() => {
      void fetchMetrics(clusterId, ac.signal).then(m => {
        if (!cancelled && !ac.signal.aborted) setMetrics(m)
      })
    }, 5000)
    return () => { cancelled = true; ac.abort(); clearInterval(id) }
  }, [clusterId])

  const trackColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'

  const statFor = (k: OverviewKind): KindStat | null => {
    const l = lists[k]
    if (!l || l.errorCode) return null
    return computeKindStat(k, l.items)
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, width: '100%' }}>
      <IssuesPanel issues={issues} loading={issuesLoading} onOpen={onOpenResource} />

      {/* KPI donut row */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 2, width: '100%' }}>
        {OVERVIEW_KINDS.map(k => {
          const stat = statFor(k)
          const color = healthRatioColor(stat)
          const kd = kindByApiKind(k)
          const icon = kd?.icon ?? 'ri-circle-line'
          return (
            <Box
              key={k}
              sx={{
                bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
                border: '1px solid',
                borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
                borderRadius: 'var(--proxcenter-card-radius)',
                p: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.25,
                transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
                '&:hover': {
                  borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)',
                  boxShadow: isDark ? '0 2px 8px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.08)',
                },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, alignSelf: 'stretch', minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 1, color, bgcolor: `${color}1f`, flexShrink: 0 }}>
                  <KindIcon icon={icon} iconImg={kd?.iconImg} size={16} />
                </Box>
                <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t(`overview.${k}`)}
                </Typography>
              </Box>
              <CircularGauge value={stat && stat.total > 0 ? (stat.healthy / stat.total) * 100 : 0} color={color} trackColor={trackColor} size="5.4em">
                <Box component="span" sx={{ fontWeight: 700, fontSize: '1.15em' }}>{stat == null ? '-' : stat.total}</Box>
              </CircularGauge>
              <Typography sx={{ fontSize: '0.7143rem', opacity: 0.6, fontFamily: '"JetBrains Mono", monospace' }}>
                {stat == null ? '-' : `${stat.healthy}/${stat.total}`}
              </Typography>
            </Box>
          )
        })}
      </Box>

      {/* Charts */}
      <OverviewCharts pods={pods} nodeNames={nodeNames} podsTruncated={podsTruncated} events={events} eventsError={eventsError} metrics={metrics.value} metricsError={metrics.errorCode} />
    </Box>
  )
}
