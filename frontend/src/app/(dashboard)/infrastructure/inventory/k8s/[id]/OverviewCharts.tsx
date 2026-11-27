'use client'
import type { ReactNode } from 'react'
import { Box, Typography, Alert, Tooltip, useTheme } from '@mui/material'
import { useTranslations } from 'next-intl'
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis } from 'recharts'
import ChartContainer from '@/components/ChartContainer'
import CircularGauge from '@/components/dashboard/widgets/CircularGauge'
import type { ResourceListItem, EventItem, NodeMetricsResult } from '@/lib/k8s/types'
import {
  podPhaseBreakdown, podsPerNode, topRestarts, recentWarnings, relativeAge, NODE_BARS_LIMIT,
} from '@/lib/k8s/overviewCharts'
import {
  clusterUtilization, perNodeUtilization, sortNodesByUsage, utilizationGradientColor, UTIL_GRADIENT_CSS, formatCores, formatBytes, NODE_UTIL_LIMIT,
} from '@/lib/k8s/metrics'
import { KindIcon } from './KindIcon'

interface Props {
  pods: ResourceListItem[]
  nodeNames: string[]
  podsTruncated: boolean
  events: EventItem[]
  eventsError?: string
  metrics: NodeMetricsResult | null
  metricsError?: string
}

function Card({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  return (
    <Box sx={{
      bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
      border: '1px solid', borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
      borderRadius: 'var(--proxcenter-card-radius)', p: 2, display: 'flex', flexDirection: 'column', gap: 1.5,
      minWidth: 0,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, opacity: 0.8 }}>
          {title}
        </Typography>
        {typeof count === 'number' && (
          <Typography sx={{ fontSize: '0.75rem', opacity: 0.5 }}>({count})</Typography>
        )}
      </Box>
      {children}
    </Box>
  )
}

function Empty({ label }: { label: string }) {
  return (
    <Box sx={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
    </Box>
  )
}

export function OverviewCharts({ pods, nodeNames, podsTruncated, events, eventsError, metrics, metricsError }: Props) {
  const t = useTranslations('kubernetes.explorer.charts')
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const axisColor = theme.palette.text.secondary
  const trackColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'

  const phases = podPhaseBreakdown(pods)
  const nodeBars = podsPerNode(pods, nodeNames)
  const shownNodeBars = nodeBars.slice(0, NODE_BARS_LIMIT).map(b => ({
    node: b.node === '' ? t('unscheduled') : b.node, count: b.count,
  }))
  const moreNodes = Math.max(0, nodeBars.length - NODE_BARS_LIMIT)
  const restarts = topRestarts(pods)
  const warnings = recentWarnings(events)
  const restartColor = (tone: 'red' | 'amber') => (tone === 'red' ? '#f44336' : '#ff9800')

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%' }}>
      {podsTruncated && (
        <Alert severity="warning">{t('incomplete')}</Alert>
      )}

      {/* Distribution charts (responsive grid) */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 2, width: '100%' }}>
      {/* 1. Pod phase donut */}
      <Card title={t('phaseTitle')} count={pods.length}>
        {pods.length === 0 ? <Empty label={t('noPods')} /> : (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <ChartContainer height={200}>
                <PieChart>
                  <Pie data={phases} dataKey="count" nameKey="phase" innerRadius="60%" outerRadius="90%" paddingAngle={2}>
                    {phases.map(s => <Cell key={s.phase} fill={s.color} />)}
                  </Pie>
                </PieChart>
              </ChartContainer>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, flexShrink: 0 }}>
              {phases.map(s => (
                <Box key={s.phase} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: s.color, flexShrink: 0 }} />
                  <Typography sx={{ fontSize: '0.8125rem' }}>{s.phase}</Typography>
                  <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, ml: 'auto', fontFamily: '"JetBrains Mono", monospace' }}>{s.count}</Typography>
                </Box>
              ))}
            </Box>
          </Box>
        )}
      </Card>

      {/* 2. Pods per node */}
      <Card title={t('perNodeTitle')}>
        {nodeBars.length === 0 ? <Empty label={t('noPods')} /> : (
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ flex: 1, minHeight: Math.max(140, shownNodeBars.length * 28) }}>
              <ChartContainer>
              <BarChart data={shownNodeBars} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: axisColor }} />
                <YAxis
                  type="category"
                  dataKey="node"
                  width={132}
                  interval={0}
                  tick={(props: any) => {
                    const label: string = props.payload?.value ?? ''
                    const isNode = label !== t('unscheduled')
                    const shortLabel = label.length > 16 ? `${label.slice(0, 15)}…` : label
                    return (
                      <g transform={`translate(${props.x},${props.y})`}>
                        {isNode && <image href="/images/kubernetes-logo.svg" x={-128} y={-7} width={13} height={13} />}
                        <text x={isNode ? -110 : -128} y={0} dy={4} textAnchor="start" fontSize={11} fill={axisColor}>{shortLabel}</text>
                      </g>
                    )
                  }}
                />
                <Bar dataKey="count" fill="#3b82f6" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ChartContainer>
            </Box>
            {moreNodes > 0 && (
              <Typography sx={{ fontSize: '0.7rem', opacity: 0.6, mt: 0.5 }}>{t('moreNodes', { count: moreNodes })}</Typography>
            )}
          </Box>
        )}
      </Card>

      {/* 3. Top restarts */}
      <Card title={t('restartsTitle')}>
        {restarts.length === 0 ? <Empty label={t('noRestarts')} /> : (
          <ChartContainer height={Math.max(120, restarts.length * 30)}>
            <BarChart data={restarts} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: axisColor }} />
              <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11, fill: axisColor }} />
              <Bar dataKey="restarts" radius={[0, 3, 3, 0]}>
                {restarts.map(r => <Cell key={`${r.namespace}/${r.name}`} fill={restartColor(r.tone)} />)}
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
      </Card>
      </Box>

      {/* Resource Utilization - full-width block between charts grid and warnings */}
      <Card title={t('utilizationTitle')}>
        {(() => {
          if (!metrics && !metricsError) return <Empty label={t('utilizationTitle')} />
          const code = metrics?.errorCode || metricsError
          if (code === 'metrics_unavailable') return <Alert severity="info">{t('metricsUnavailable')}</Alert>
          if (code === 'forbidden') return <Alert severity="warning">{t('metricsForbidden')}</Alert>
          if (code || !metrics) return <Alert severity="warning">{t('metricsError')}</Alert>

          const cluster = clusterUtilization(metrics.nodes)
          const bars = sortNodesByUsage(perNodeUtilization(metrics.nodes))
          const shown = bars.slice(0, NODE_UTIL_LIMIT)
          const overflow = bars.length - shown.length

          return (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
              {/* Cluster gauges */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center', flexShrink: 0 }}>
                {[
                  { label: t('clusterCpu'), icon: 'ri-cpu-line', pctVal: cluster.cpuPct, sub: `${formatCores(cluster.cpuUsedMilli)} / ${formatCores(cluster.cpuAllocMilli)}` },
                  { label: t('clusterMemory'), icon: 'ri-ram-line', pctVal: cluster.memPct, sub: `${formatBytes(cluster.memUsedBytes)} / ${formatBytes(cluster.memAllocBytes)}` },
                ].map(g => (
                  <Box key={g.label} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, minWidth: 96 }}>
                    <CircularGauge value={g.pctVal} color={utilizationGradientColor(g.pctVal)} trackColor={trackColor} size="5.4em">
                      <Box component="span" sx={{ fontWeight: 700, fontSize: '1.15em' }}>{g.pctVal}%</Box>
                    </CircularGauge>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: '0.8rem', fontWeight: 600 }}>
                      <Box component="i" className={g.icon} sx={{ fontSize: 14, opacity: 0.7 }} />
                      {g.label}
                    </Box>
                    <Box sx={{ fontSize: '0.72rem', opacity: 0.7 }}>{g.sub}</Box>
                  </Box>
                ))}
              </Box>

              {/* Per-node bars */}
              <Box sx={{ flex: 1, minWidth: 240 }}>
                <Box sx={{ fontSize: '0.8125rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, opacity: 0.8, mb: 1 }}>{t('perNode')}</Box>
                <Box sx={{ maxHeight: 220, overflowY: 'auto', pr: 2 }}>
                {metrics.reportingNodes < metrics.totalNodes && (
                  <Box sx={{ fontSize: '0.75rem', opacity: 0.7, mb: 1 }}>
                    {t('nodesReporting', { reporting: metrics.reportingNodes, total: metrics.totalNodes })}
                  </Box>
                )}
                {shown.map(b => (
                  <Box key={b.name} sx={{ mb: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
                      <KindIcon icon="ri-server-line" iconImg="/images/kubernetes-logo.svg" size={14} />
                      <Box sx={{ fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</Box>
                    </Box>
                    {[
                      { tag: 'cpu', v: b.cpuPct, icon: 'ri-cpu-line' },
                      { tag: 'mem', v: b.memPct, icon: 'ri-ram-line' },
                    ].map(row => (
                      <Box key={row.tag} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box component="i" className={row.icon} aria-label={row.tag} sx={{ width: 20, fontSize: 14, opacity: 0.6, textAlign: 'center', flexShrink: 0 }} />
                        <Box sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: 'action.hover', overflow: 'hidden' }}>
                          <Box sx={{
                            width: `${row.v}%`, height: '100%',
                            background: UTIL_GRADIENT_CSS,
                            backgroundSize: row.v > 0 ? `${(100 / row.v) * 100}% 100%` : '100% 100%',
                            backgroundPosition: 'left center',
                          }} />
                        </Box>
                        <Box sx={{ width: 36, textAlign: 'right', fontSize: '0.72rem' }}>{row.v}%</Box>
                      </Box>
                    ))}
                  </Box>
                ))}
                {overflow > 0 && <Box sx={{ fontSize: '0.75rem', opacity: 0.7 }}>{t('moreNodes', { count: overflow })}</Box>}
                </Box>
              </Box>
            </Box>
          )
        })()}
      </Card>

      {/* Current warning events - full-width block (more room than a grid cell) */}
      <Card title={t('warningsTitle')} count={eventsError ? undefined : warnings.length}>
        {eventsError ? (
          <Empty label={t('forbidden')} />
        ) : warnings.length === 0 ? (
          <Empty label={t('noWarnings')} />
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 320, overflowY: 'auto' }}>
            {warnings.map((w, i) => (
              <Box key={`${w.object}-${w.reason}-${i}`} sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#ff9800', flexShrink: 0 }} />
                  <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.reason}</Typography>
                  <Typography sx={{ fontSize: '0.75rem', opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{w.object}</Typography>
                  {w.count > 1 && <Typography sx={{ fontSize: '0.7rem', opacity: 0.6, ml: 'auto', flexShrink: 0 }}>×{w.count}</Typography>}
                  <Tooltip title={w.lastSeen}><Typography sx={{ fontSize: '0.7rem', opacity: 0.5, flexShrink: 0, ml: w.count > 1 ? 0.5 : 'auto' }}>{relativeAge(w.lastSeen)}</Typography></Tooltip>
                </Box>
                <Tooltip title={w.message}>
                  <Typography sx={{ fontSize: '0.7rem', opacity: 0.65, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', pl: 1.75 }}>{w.message}</Typography>
                </Tooltip>
              </Box>
            ))}
          </Box>
        )}
      </Card>
    </Box>
  )
}
