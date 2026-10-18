'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Box, Paper, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'
import { Area, CartesianGrid, ComposedChart, Line, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'

import ChartContainer from '@/components/ChartContainer'
import { NodeGlyph } from '@/components/automation/drs/glyphs'
import {
  addThroughputSample,
  axisTicks,
  axisTimeLabel,
  emptyThroughput,
  formatMBps,
  MB,
  THROUGHPUT_DEFAULT_RANGE,
  THROUGHPUT_RANGES,
  THROUGHPUT_TOTAL_KEY,
  throughputChart,
  type ThroughputJob,
  type ThroughputRange,
  type ThroughputState,
} from '../migrationThroughput'
import { fetchTargetNodeMetrics, jobsPerTargetNode, liveLoadColor, type NodeLiveMetrics } from '../targetNodeMetrics'

/*
   Follow-up of a migration in two columns (roadmap#53 part B), shared by the
   bulk dialog once its batch is launched and by the progress view of the
   single-VM dialog. Left: what the dialog already shows (job rows, logs).
   Right: the throughput of the whole batch and the live load of its target
   nodes, so an operator can tell whether the nodes take the load.
*/

export interface LiveJob extends ThroughputJob {
  targetNode?: string | null
}

export const NODE_METRICS_REFRESH_MS = 5000
const GB = 1024 ** 3

// The samples of the last follow-up outlive the dialog: minimising it and
// opening it again continues the same chart instead of starting a blank one.
let lastThroughput: ThroughputState | null = null
// The range picked last, kept for the next follow-up like the samples.
let lastRange: ThroughputRange = THROUGHPUT_DEFAULT_RANGE

function useThroughput(sessionKey: string, jobs: LiveJob[]): ThroughputState {
  const [state, setState] = useState<ThroughputState>(() => (lastThroughput?.key === sessionKey ? lastThroughput : emptyThroughput(sessionKey)))
  // `jobs` changes once per poll of the batch (or of the job): one sample each.
  useEffect(() => {
    setState(prev => addThroughputSample(prev.key === sessionKey ? prev : emptyThroughput(sessionKey), jobs, Date.now()))
  }, [jobs, sessionKey])
  useEffect(() => { lastThroughput = state }, [state])
  return state
}

/** The live metrics of `nodes`, read every NODE_METRICS_REFRESH_MS while `active`. */
function useTargetNodeMetrics(connectionId: string | undefined, nodes: string[], active: boolean) {
  const [metrics, setMetrics] = useState<Record<string, NodeLiveMetrics>>({})
  const [loaded, setLoaded] = useState(false)
  const nodesKey = nodes.join('\n')
  useEffect(() => {
    // Rebuilt from the key: `nodes` itself is a new array at every render.
    const list = nodesKey ? nodesKey.split('\n') : []
    if (!active || !connectionId || list.length === 0) return
    let stopped = false
    let ctrl: AbortController | null = null
    const tick = async () => {
      // A slow answer is overtaken by the next read rather than stacked behind it.
      ctrl?.abort()
      ctrl = new AbortController()
      try {
        const m = await fetchTargetNodeMetrics(connectionId, list, ctrl.signal)
        if (!stopped) { setMetrics(m); setLoaded(true) }
      } catch {
        if (!stopped && !ctrl?.signal.aborted) setLoaded(true)
      }
    }
    void tick()
    const interval = setInterval(tick, NODE_METRICS_REFRESH_MS)
    return () => { stopped = true; clearInterval(interval); ctrl?.abort() }
  }, [connectionId, nodesKey, active])
  return { metrics, loaded }
}

const titleSx = { fontSize: 12, fontWeight: 700 } as const
const captionSx = { fontSize: 11 } as const

function ThroughputPanel({ sessionKey, jobs }: Readonly<{ sessionKey: string; jobs: LiveJob[] }>) {
  const t = useTranslations('inventoryPage.esxiMigration')
  const locale = useLocale()
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const state = useThroughput(sessionKey, jobs)
  const [range, setRange] = useState<ThroughputRange>(() => lastRange)
  const pickRange = (r: ThroughputRange) => { lastRange = r; setRange(r) }
  const chart = useMemo(() => throughputChart(state, jobs, range), [state, jobs, range])
  // One colour per VM: the theme's five, then hues spread around the wheel
  // (golden angle) so a large batch never repeats a colour next to another.
  const palette = [theme.palette.primary.main, theme.palette.info.main, theme.palette.success.main, theme.palette.warning.main, theme.palette.secondary.main]
  const colorOf = (_key: string, i: number) => (i < palette.length ? palette[i] : `hsl(${Math.round((i * 137.508) % 360)}, 62%, ${isDark ? 60 : 45}%)`)
  const nameOf = (s: { key: string; name: string }) => s.name
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'
  const axisColor = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'
  const tMin = chart.rows.length ? chart.rows[0].t : 0
  const tMax = chart.rows.length ? chart.rows[chart.rows.length - 1].t : 0
  const ticks = axisTicks(tMin, tMax, locale)
  const timeLabel = (v: number) => axisTimeLabel(v, tMax - tMin, locale)

  return (
    <Paper variant="outlined" sx={{ p: 1.25, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }} data-testid="migration-live-throughput">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
        <i className="ri-speed-up-line" style={{ fontSize: 15, opacity: 0.7 }} />
        <Typography sx={titleSx}>{t('liveThroughput')}</Typography>
        <Box sx={{ flex: 1 }} />
        <ToggleButtonGroup
          size="small"
          exclusive
          value={range}
          onChange={(_e, v) => { if (v) pickRange(v) }}
          aria-label={t('liveThroughputRange')}
          data-testid="migration-live-throughput-range"
          sx={{ '& .MuiToggleButton-root': { py: 0, px: 0.75, fontSize: 10, lineHeight: '18px', textTransform: 'none' } }}
        >
          {(Object.keys(THROUGHPUT_RANGES) as ThroughputRange[]).map(r => <ToggleButton key={r} value={r}>{r}</ToggleButton>)}
        </ToggleButtonGroup>
        <Typography sx={{ ...captionSx, fontVariantNumeric: 'tabular-nums' }} color="text.secondary" data-testid="migration-live-throughput-figures">
          {t('liveThroughputCurrent', { value: formatMBps(chart.currentBps) })}
          {' · '}
          {t('liveThroughputPeak', { value: formatMBps(chart.peakBps) })}
        </Typography>
      </Box>
      {chart.rows.length < 2 ? (
        <Box sx={{ flex: 1, minHeight: 140, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography sx={captionSx} color="text.secondary">{t('liveThroughputWaiting')}</Typography>
        </Box>
      ) : (
        // The chart takes whatever height the column leaves it (at least 140 px);
        // no legend under it, the tooltip names every series, the total included.
        <Box sx={{ flex: 1, minHeight: 140 }}>
          <ChartContainer>
            <ComposedChart data={chart.rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={gridColor} vertical={false} />
              <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} ticks={ticks} tickFormatter={timeLabel} tick={{ fill: axisColor, fontSize: 10 }} stroke={axisColor} minTickGap={24} />
              <YAxis tick={{ fill: axisColor, fontSize: 10 }} stroke={axisColor} width={58} tickFormatter={(v: number) => `${Math.round(v)} MB/s`} />
              {/* Themed like the other charts of the app: Recharts paints a white
                  box and a light grey hover line by default, unreadable on the dark theme. */}
              <RTooltip
                labelFormatter={(v: any) => new Date(Number(v)).toLocaleTimeString()}
                formatter={(v: any, name: any) => [formatMBps(Number(v) * MB), name]}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${theme.palette.divider}`, background: theme.palette.background.paper }}
                labelStyle={{ color: theme.palette.text.primary }}
                itemStyle={{ color: theme.palette.text.secondary }}
                cursor={{ stroke: alpha(theme.palette.text.primary, 0.3) }}
              />
              {chart.series.map((s, i) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={nameOf(s)}
                  stroke={colorOf(s.key, i)}
                  fill={colorOf(s.key, i)}
                  fillOpacity={0.12}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
              {/* The batch total, the "Now" figure of the header, over the VMs. */}
              {chart.series.length > 1 && (
                <Line
                  type="monotone"
                  dataKey={THROUGHPUT_TOTAL_KEY}
                  name={t('liveThroughputTotal')}
                  stroke={theme.palette.text.primary}
                  strokeDasharray="4 3"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              )}
            </ComposedChart>
          </ChartContainer>
        </Box>
      )}
    </Paper>
  )
}

/** A live load: label, bar, then the figure. */
function LiveBar({ label, ratio, value, testId }: Readonly<{ label: string; ratio: number; value: string; testId: string }>) {
  const width = Math.max(0, Math.min(1, ratio)) * 100
  return (
    <>
      <Typography sx={captionSx} color="text.secondary">{label}</Typography>
      <Box sx={{ height: 5, borderRadius: 2.5, bgcolor: 'action.hover', overflow: 'hidden' }} data-testid={testId}>
        <Box sx={{ width: `${width}%`, height: '100%', bgcolor: liveLoadColor(ratio), transition: 'width 0.3s' }} />
      </Box>
      <Typography sx={{ ...captionSx, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{value}</Typography>
    </>
  )
}

const pct = (ratio: number) => `${Math.round(ratio * 100)} %`

function NodeCard({ node, status, m, counts }: Readonly<{ node: string; status?: string; m?: NodeLiveMetrics; counts: { total: number; running: number; queued: number } }>) {
  const t = useTranslations('inventoryPage.esxiMigration')
  const theme = useTheme()
  const memRatio = m && m.memTotal > 0 ? m.memUsed / m.memTotal : 0
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, px: 1, py: 0.75 }} data-testid={`migration-live-node-${node}`}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5, minWidth: 0 }}>
        <NodeGlyph status={status ?? (m ? 'online' : undefined)} dark={theme.palette.mode === 'dark'} dotBorder={theme.palette.background.paper} />
        <Typography sx={{ fontSize: 12, fontWeight: 600 }} noWrap>{node}</Typography>
        <Box sx={{ flex: 1 }} />
        <Typography sx={captionSx} color="text.secondary" noWrap data-testid={`migration-live-node-jobs-${node}`}>
          {t('liveNodeJobs', counts)}
        </Typography>
      </Box>
      {m ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'max-content minmax(40px, 1fr) auto', columnGap: 1, rowGap: 0.25, alignItems: 'center' }}>
          <LiveBar label={t('liveNodeCpu')} ratio={m.cpu} value={pct(m.cpu)} testId={`migration-live-node-cpu-${node}`} />
          <LiveBar
            label={t('liveNodeRam')}
            ratio={memRatio}
            value={`${pct(memRatio)} (${(m.memUsed / GB).toFixed(1)}/${(m.memTotal / GB).toFixed(1)} GB)`}
            testId={`migration-live-node-ram-${node}`}
          />
          <LiveBar label={t('liveNodeIoDelay')} ratio={m.iowait} value={pct(m.iowait)} testId={`migration-live-node-io-${node}`} />
        </Box>
      ) : (
        <Typography sx={captionSx} color="text.secondary">{t('liveNodeUnavailable')}</Typography>
      )}
    </Box>
  )
}

function TargetNodesPanel({ jobs, connectionId, nodeStatus, active }: Readonly<{ jobs: LiveJob[]; connectionId?: string; nodeStatus: Record<string, string | undefined>; active: boolean }>) {
  const t = useTranslations('inventoryPage.esxiMigration')
  // Target nodes in the order the batch first names them.
  const nodes = useMemo(() => [...new Set(jobs.map(j => j.targetNode).filter((n): n is string => !!n))], [jobs])
  const counts = useMemo(() => jobsPerTargetNode(jobs), [jobs])
  const { metrics, loaded } = useTargetNodeMetrics(connectionId, nodes, active)
  if (nodes.length === 0) return null
  return (
    <Paper variant="outlined" sx={{ p: 1.25, flex: 1, minHeight: 0, overflowY: 'auto' }} data-testid="migration-live-nodes">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
        <i className="ri-server-line" style={{ fontSize: 15, opacity: 0.7 }} />
        <Typography sx={titleSx}>{t('liveTargetNodes')}</Typography>
        {!loaded && <Typography sx={captionSx} color="text.secondary">{t('liveNodesLoading')}</Typography>}
      </Box>
      <Stack spacing={0.75}>
        {nodes.map(n => (
          <NodeCard key={n} node={n} status={nodeStatus[n]} m={loaded ? metrics[n] : undefined} counts={counts[n] || { total: 0, running: 0, queued: 0 }} />
        ))}
      </Stack>
    </Paper>
  )
}

export interface MigrationLiveColumnsProps {
  /** The batch id (bulk) or the job id (single VM): a new one starts a new chart. */
  sessionKey: string
  /** One per job, a new array at each poll only. */
  jobs: LiveJob[]
  /** PVE connection of the target nodes. */
  targetConnectionId?: string
  /** Node statuses as the dialog knows them, for the status dot. */
  nodeOptions?: Array<{ connId: string; node: string; status?: string }>
  /** False once the dialog is closed or minimised: the node reads stop. */
  active: boolean
  /** What the follow-up already shows: job rows, logs. */
  children: React.ReactNode
}

export default function MigrationLiveColumns({ sessionKey, jobs, targetConnectionId, nodeOptions, active, children }: Readonly<MigrationLiveColumnsProps>) {
  const nodeStatus = useMemo(() => {
    const out: Record<string, string | undefined> = {}
    for (const o of nodeOptions || []) if (o.connId === targetConnectionId) out[o.node] = o.status
    return out
  }, [nodeOptions, targetConnectionId])
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' }, gap: 2, alignItems: 'stretch' }} data-testid="migration-live-columns">
      {/* A column too, so the follow-up it holds can stretch to the row's height. */}
      <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>{children}</Box>
      {/* Both panels share the height of the left column (the grid row), down to the dialog's bottom edge. */}
      <Stack spacing={1.5} sx={{ minWidth: 0, minHeight: 0 }} data-testid="migration-live-right">
        <ThroughputPanel sessionKey={sessionKey} jobs={jobs} />
        <TargetNodesPanel jobs={jobs} connectionId={targetConnectionId} nodeStatus={nodeStatus} active={active} />
      </Stack>
    </Box>
  )
}
