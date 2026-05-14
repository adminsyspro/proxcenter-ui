'use client'

import { useEffect, useMemo, useState } from 'react'

import { useTranslations } from 'next-intl'

import {
  Box, Paper, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TablePagination, TableRow, Typography, useTheme,
} from '@mui/material'
import { Area, AreaChart, Tooltip as RTooltip } from 'recharts'

import SparklineCell from './SparklineCell'

import { NodeIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'
import { CpuRamTooltip, IoNetTooltip } from './SparklineTooltips'

const RRD_REFRESH_MS = 30_000

interface Host {
  node: string
  status: string
  maintenance?: string
  connId: string
}

interface SeriesPoint {
  t: number
  cpu: number
  ram: number
  netin: number
  netout: number
}

interface Props {

  /** The vDC's connection IDs; the card subscribes to the inventory stream. */
  connectionIds: string[]

  /** Node names authorised by the vDC (filter applied client-side). */
  allowedNodes: string[]
}

const hostKey = (h: Host) => `${h.connId}:${h.node}`

function buildSeries(raw: any[]): SeriesPoint[] {
  const out: SeriesPoint[] = []

  for (const p of raw || []) {
    const t = p.time ?? p.t ?? p.timestamp

    if (!t) continue
    const cpuRaw = p.cpu ?? p.cpu_avg

    const cpu = cpuRaw != null
      ? Math.max(0, Math.min(100, Math.round(cpuRaw <= 1.5 ? cpuRaw * 100 : cpuRaw)))
      : 0

    const memRaw = p.mem ?? p.memused
    const maxMem = p.maxmem ?? p.memtotal
    let ram = 0

    if (memRaw != null) {
      if (memRaw <= 1.5) ram = Math.round(memRaw * 100)
      else if (maxMem > 0) ram = Math.round((memRaw / maxMem) * 100)
    }

    out.push({ t, cpu, ram, netin: p.netin ?? 0, netout: p.netout ?? 0 })
  }


return out.sort((a, b) => a.t - b.t)
}

/**
 * Hosts table: one row per authorised node in the vDC, styled like the
 * /infrastructure/inventory tables. Status pastille comes from NodeIcon;
 * CPU / RAM / IO-NET sparklines are fed by the cluster RRD hour window.
 */
export default function HostsCard({ connectionIds, allowedNodes }: Props) {
  const t = useTranslations()
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const [hosts, setHosts] = useState<Host[]>([])
  const [loading, setLoading] = useState(true)
  const [trends, setTrends] = useState<Record<string, SeriesPoint[]>>({})
  const [page, setPage] = useState(0)
  const ROWS_PER_PAGE = 10

  useEffect(() => {
    if (connectionIds.length === 0) {
      setHosts([])
      setLoading(false)

return
    }

    setLoading(true)
    const accepted = new Set(connectionIds)
    const allow = new Set(allowedNodes)
    const found: Host[] = []
    const src = new EventSource('/api/v1/inventory/stream')

    const onCluster = (ev: MessageEvent) => {
      try {
        const cluster = JSON.parse(ev.data)

        if (!accepted.has(cluster.id)) return

        for (const n of cluster.nodes ?? []) {
          if (allow.size > 0 && !allow.has(n.node)) continue
          found.push({
            node: n.node,
            status: n.status ?? 'unknown',
            maintenance: n.maintenance,
            connId: cluster.id,
          })
        }

        setHosts([...found])
      } catch {}
    }

    const onDone = () => { setLoading(false); src.close() }
    const onError = () => { setLoading(false); src.close() }

    src.addEventListener('cluster', onCluster)
    src.addEventListener('done', onDone)
    src.addEventListener('error', onError)

    return () => {
      src.removeEventListener('cluster', onCluster)
      src.removeEventListener('done', onDone)
      src.removeEventListener('error', onError)
      src.close()
    }
  }, [connectionIds, allowedNodes])

  useEffect(() => {
    if (hosts.length === 0) return
    const controller = new AbortController()
    let cancelled = false

    const fetchRrd = async () => {
      const results = await Promise.all(
        hosts.filter(h => h.status === 'online').map(async (h) => {
          try {
            const url = `/api/v1/connections/${encodeURIComponent(h.connId)}/rrd?path=${encodeURIComponent(`/nodes/${h.node}`)}&timeframe=hour`
            const res = await fetch(url, { cache: 'no-store', signal: controller.signal })

            if (!res.ok) return null
            const json = await res.json()
            let raw: any[] = []

            if (Array.isArray(json)) raw = json
            else if (Array.isArray(json?.data)) raw = json.data
            else if (json?.data && typeof json.data === 'object') raw = Object.values(json.data)

return { key: hostKey(h), series: buildSeries(raw) }
          } catch {
            return null
          }
        }),
      )

      if (cancelled) return
      const next: Record<string, SeriesPoint[]> = {}

      for (const r of results) if (r && r.series.length > 0) next[r.key] = r.series
      setTrends(next)
    }

    void fetchRrd()
    const interval = setInterval(() => { void fetchRrd() }, RRD_REFRESH_MS)

    return () => { cancelled = true; controller.abort(); clearInterval(interval) }
  }, [hosts])

  const sortedHosts = useMemo(() => [...hosts].sort((a, b) => a.node.localeCompare(b.node)), [hosts])

  const pageHosts = useMemo(
    () => sortedHosts.slice(page * ROWS_PER_PAGE, page * ROWS_PER_PAGE + ROWS_PER_PAGE),
    [sortedHosts, page],
  )

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(sortedHosts.length / ROWS_PER_PAGE) - 1)

    if (page > maxPage) setPage(maxPage)
  }, [sortedHosts.length, page])

  const headerBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'
  const cellBorder = `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`
  const cpuColor = theme.palette.warning.main
  const ramColor = theme.palette.info.main
  const netInColor = theme.palette.success.main
  const netOutColor = '#f97316'

  const renderSpark = (
    series: SeriesPoint[] | undefined,
    keys: Array<{ dataKey: keyof SeriesPoint; color: string }>,
    variant: 'cpuRam' | 'ioNet',
  ) => {
    const hasData = series && series.length > 1
    const cursorColor = variant === 'cpuRam' ? '#f97316' : '#ab47bc'


return (
      <SparklineCell
        hasData={!!hasData}
        fallback={
          <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.3 }}>
            <Typography sx={{ fontSize: 9 }}>…</Typography>
          </Box>
        }
      >
        {(width) => (
          <AreaChart width={width} height={24} data={series} margin={{ top: 1, right: 1, left: 1, bottom: 1 }}>
            <RTooltip
              content={variant === 'cpuRam'
                ? <CpuRamTooltip isDark={isDark} />
                : <IoNetTooltip isDark={isDark} />}
              wrapperStyle={{ backgroundColor: 'transparent', zIndex: 1500, pointerEvents: 'none' }}
              cursor={{ stroke: cursorColor, strokeWidth: 1, strokeDasharray: '3 3' }}
              allowEscapeViewBox={{ x: true, y: true }}
            />
            {keys.map(k => (
              <Area
                key={String(k.dataKey)}
                type="monotone"
                dataKey={k.dataKey as string}
                stroke={k.color}
                fill={k.color}
                fillOpacity={0.35}
                strokeWidth={1.1}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        )}
      </SparklineCell>
    )
  }

  return (
    <Paper sx={{ p: 2 }} variant="outlined">
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <i className="ri-server-line" />
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('myVdc.cockpit.hostsTitle')}</Typography>
      </Stack>

      {loading ? (
        <Typography variant="caption" color="text.secondary">…</Typography>
      ) : sortedHosts.length === 0 ? (
        <Typography variant="caption" color="text.secondary">{t('myVdc.cockpit.noHosts')}</Typography>
      ) : (
        <TableContainer sx={{ overflow: 'visible' }}>
          <Table size="small" sx={{ '& .MuiTableCell-root': { overflow: 'visible' } }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700, fontSize: 11, py: 0.75, bgcolor: headerBg, borderBottom: cellBorder }}>
                  {t('myVdc.cockpit.hostsTitle')}
                </TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 11, py: 0.75, bgcolor: headerBg, borderBottom: cellBorder }}>
                  CPU / RAM
                </TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 11, py: 0.75, bgcolor: headerBg, borderBottom: cellBorder }}>
                  IO / NET
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pageHosts.map(h => {
                const series = trends[hostKey(h)]


return (
                  <TableRow key={hostKey(h)} hover>
                    <TableCell sx={{ py: 0.75, borderBottom: cellBorder }}>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <NodeIcon status={h.status} maintenance={h.maintenance} size={16} />
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>{h.node}</Typography>
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ py: 0.75, borderBottom: cellBorder }}>
                      {renderSpark(series, [
                        { dataKey: 'cpu', color: cpuColor },
                        { dataKey: 'ram', color: ramColor },
                      ], 'cpuRam')}
                    </TableCell>
                    <TableCell sx={{ py: 0.75, borderBottom: cellBorder }}>
                      {renderSpark(series, [
                        { dataKey: 'netin', color: netInColor },
                        { dataKey: 'netout', color: netOutColor },
                      ], 'ioNet')}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          {sortedHosts.length > ROWS_PER_PAGE && (
            <TablePagination
              component="div"
              count={sortedHosts.length}
              page={page}
              onPageChange={(_, p) => setPage(p)}
              rowsPerPage={ROWS_PER_PAGE}
              rowsPerPageOptions={[ROWS_PER_PAGE]}
              sx={{ '& .MuiTablePagination-toolbar': { minHeight: 40 } }}
            />
          )}
        </TableContainer>
      )}
    </Paper>
  )
}
