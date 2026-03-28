'use client'

import React from 'react'
import { useTranslations } from 'next-intl'

import {
  Box,
  Card,
  CardContent,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  useTheme,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'

import type { InventorySelection } from '../types'
import ExpandableChart from './ExpandableChart'
import { pickNumber, fetchRrd } from '../helpers'
import type { TreeClusterStorage } from '../InventoryTree'

export default function StorageIntermediatePanel({ selection, clusterStorages, onSelect }: {
  selection: InventorySelection
  clusterStorages: TreeClusterStorage[]
  onSelect?: (sel: InventorySelection) => void
}) {
  const theme = useTheme()
  const t = useTranslations()

  const parts = selection.id.split(':')
  const connId = parts[0]
  const nodeName = selection.type === 'storage-node' ? parts[1] : undefined

  const cs = clusterStorages.find(c => c.connId === connId)

  // RRD history for storage graphs
  const [rrdTimeframe, setRrdTimeframe] = React.useState<'hour' | 'day' | 'week' | 'month' | 'year'>('day')
  const [rrdData, setRrdData] = React.useState<Record<string, Array<{ time: number; usedPct: number; used: number; total: number }>>>({})

  React.useEffect(() => {
    if (!cs) return
    const storages = selection.type === 'storage-node' && nodeName
      ? [...cs.sharedStorages, ...(cs.nodes.find(n => n.node === nodeName)?.storages || [])]
      : [...cs.sharedStorages, ...cs.nodes.flatMap(n => n.storages)]
    // Deduplicate shared storages (same name across nodes)
    const seen = new Set<string>()
    const uniqueStorages = storages.filter(s => {
      const key = `${s.storage}:${s.node}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    let cancelled = false
    const loadAll = async () => {
      const results: Record<string, Array<{ time: number; usedPct: number; used: number; total: number }>> = {}
      await Promise.all(uniqueStorages.map(async (s) => {
        try {
          const path = `/nodes/${encodeURIComponent(s.node)}/storage/${encodeURIComponent(s.storage)}`
          const raw = await fetchRrd(connId, path, rrdTimeframe)
          if (cancelled) return
          results[s.storage] = (Array.isArray(raw) ? raw : [])
            .filter((p: any) => p.time || p.t || p.timestamp)
            .map((p: any) => {
              const time = Math.round(pickNumber(p, ['time', 't', 'timestamp']) || 0) * 1000
              const total = pickNumber(p, ['total', 'maxdisk']) || 0
              const used = pickNumber(p, ['used', 'disk']) || 0
              return { time, used, total, usedPct: total > 0 ? Math.round((used / total) * 100) : 0 }
            })
            .filter((p: any) => p.time > 0 && p.total > 0)
        } catch { /* skip */ }
      }))
      if (!cancelled) setRrdData(results)
    }
    loadAll()
    return () => { cancelled = true }
  }, [cs, connId, nodeName, selection.type, rrdTimeframe])

  if (!cs) return <Box sx={{ p: 3, textAlign: 'center' }}><Typography variant="body2" sx={{ opacity: 0.5 }}>No data</Typography></Box>

  const primaryColor = theme.palette.primary.main

  const timeframeSelector = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
      {([
        { value: 'hour', label: '1h' },
        { value: 'day', label: '24h' },
        { value: 'week', label: '7d' },
        { value: 'month', label: '30d' },
        { value: 'year', label: '1y' },
      ] as const).map(opt => (
        <Box
          key={opt.value}
          onClick={() => setRrdTimeframe(opt.value)}
          sx={{
            px: 0.8, py: 0.2, borderRadius: 0.5, cursor: 'pointer',
            fontSize: '0.65rem', fontWeight: 700, lineHeight: 1.4,
            bgcolor: rrdTimeframe === opt.value ? 'primary.main' : 'transparent',
            color: rrdTimeframe === opt.value ? 'primary.contrastText' : 'text.secondary',
            opacity: rrdTimeframe === opt.value ? 1 : 0.5,
            '&:hover': { opacity: 1 },
          }}
        >
          {opt.label}
        </Box>
      ))}
    </Box>
  )

  const renderStorageGraph = (storageName: string, points: Array<{ time: number; usedPct: number; used: number; total: number }>) => {
    if (points.length < 2) return null
    const fmtBytes = (bytes: number) => {
      if (!bytes) return '0 B'
      const k = 1024
      const sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
      const i = Math.floor(Math.log(bytes) / Math.log(k))
      return `${(bytes / Math.pow(k, i)).toFixed(i > 0 ? 1 : 0)} ${sizes[i]}`
    }
    return (
      <Box key={storageName} sx={{ flex: 1, minWidth: 250 }}>
        <ExpandableChart
          title={storageName}
          height={80}
          header={
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flex: 1 }}>
              <Typography variant="caption" fontWeight={700}>{storageName}</Typography>
              <Typography variant="caption" sx={{ opacity: 0.5, fontSize: 10 }}>
                {points.length > 0 ? `${points[points.length - 1].usedPct}%` : ''}
              </Typography>
            </Box>
          }
        >
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <AreaChart data={points}>
              <XAxis dataKey="time" tickFormatter={v => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} minTickGap={40} tick={{ fontSize: 9 }} type="number" domain={['dataMin', 'dataMax']} />
              <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 9 }} width={30} />
              <Tooltip
                wrapperStyle={{ backgroundColor: 'transparent', boxShadow: 'none' }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  return (
                    <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 160 }}>
                      <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha(primaryColor, 0.1), borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <i className="ri-hard-drive-2-line" style={{ fontSize: 13, color: primaryColor }} />
                        <Typography variant="caption" sx={{ fontWeight: 700, color: primaryColor }}>Storage Usage</Typography>
                        <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{new Date(Number(label)).toLocaleTimeString()}</Typography>
                      </Box>
                      <Box sx={{ px: 1.5, py: 0.75 }}>
                        {payload.map(entry => (
                          <Box key={String(entry.dataKey)} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                            <Typography variant="caption" sx={{ flex: 1 }}>Usage</Typography>
                            <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{Number(entry.value).toFixed(1)}%</Typography>
                          </Box>
                        ))}
                      </Box>
                    </Box>
                  )
                }}
              />
              <Area type="monotone" dataKey="usedPct" stroke={primaryColor} fill={primaryColor} fillOpacity={0.3} strokeWidth={1.5} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ExpandableChart>
      </Box>
    )
  }

  const isCeph = (type: string) => type === 'rbd' || type === 'cephfs'
  const storageIcon = (type: string) => {
    if (isCeph(type)) return ''
    if (type === 'nfs' || type === 'cifs') return 'ri-folder-shared-fill'
    if (type === 'zfspool' || type === 'zfs') return 'ri-stack-fill'
    if (type === 'lvm' || type === 'lvmthin') return 'ri-hard-drive-2-fill'
    if (type === 'dir') return 'ri-folder-fill'
    return 'ri-hard-drive-fill'
  }
  const storageColor = (type: string) => {
    if (type === 'nfs' || type === 'cifs') return '#3498db'
    if (type === 'zfspool' || type === 'zfs') return '#2ecc71'
    if (type === 'lvm' || type === 'lvmthin') return '#e67e22'
    return '#95a5a6'
  }
  const fmt = (bytes: number) => {
    if (!bytes) return '0 B'
    const k = 1024
    const sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(i > 0 ? 1 : 0)} ${sizes[i]}`
  }

  // --- STORAGE-CLUSTER: Connection-level storage overview ---
  if (selection.type === 'storage-cluster') {
    const allStorages = [...cs.sharedStorages, ...cs.nodes.flatMap(n => n.storages)]
    const totalUsed = allStorages.reduce((s, st) => s + st.used, 0)
    const totalSize = allStorages.reduce((s, st) => s + st.total, 0)
    const sharedCount = cs.sharedStorages.length
    const localCount = cs.nodes.reduce((s, n) => s + n.storages.length, 0)
    const typeMap = new Map<string, number>()
    for (const s of allStorages) typeMap.set(s.type, (typeMap.get(s.type) || 0) + 1)

    return (
      <Box sx={{ p: 2.5 }}>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Chip size="small" label="STORAGE" icon={<i className="ri-database-2-fill" style={{ fontSize: 14, marginLeft: 8 }} />} />
          <Typography variant="h6" fontWeight={900}>{cs.connName}</Typography>
        </Box>

        {/* KPIs */}
        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          {[
            { label: t('common.nodes'), value: cs.nodes.length, icon: 'ri-server-line' },
            { label: 'Shared', value: sharedCount, icon: 'ri-share-line' },
            { label: 'Local', value: localCount, icon: 'ri-folder-line' },
            { label: 'Total', value: allStorages.length, icon: 'ri-database-2-line' },
          ].map(kpi => (
            <Card key={kpi.label} variant="outlined" sx={{ flex: 1, minWidth: 100, borderRadius: 2 }}>
              <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 }, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Box sx={{ width: 36, height: 36, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: alpha(theme.palette.primary.main, 0.1) }}>
                  <i className={kpi.icon} style={{ fontSize: 18, color: theme.palette.primary.main }} />
                </Box>
                <Box>
                  <Typography variant="h6" fontWeight={900} sx={{ lineHeight: 1.2 }}>{kpi.value}</Typography>
                  <Typography variant="caption" sx={{ opacity: 0.6 }}>{kpi.label}</Typography>
                </Box>
              </CardContent>
            </Card>
          ))}
        </Box>

        {/* Storage usage graphs */}
        {Object.keys(rrdData).length > 0 && (
          <Card variant="outlined" sx={{ borderRadius: 2, mb: 2 }}>
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                <Typography fontWeight={800} sx={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className="ri-line-chart-line" style={{ fontSize: 16, opacity: 0.7 }} />
                  {t('inventory.storageUsage')}
                </Typography>
                {timeframeSelector}
              </Box>
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                {Object.entries(rrdData).map(([name, points]) => renderStorageGraph(name, points))}
              </Box>
            </CardContent>
          </Card>
        )}

        {/* Storage types breakdown */}
        {typeMap.size > 0 && (
          <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
            {Array.from(typeMap.entries()).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
              <Chip
                key={type}
                size="small"
                variant="outlined"
                label={`${type} (${count})`}
                icon={isCeph(type)
                  ? <img src="/images/ceph-logo.svg" alt="" width={14} height={14} style={{ marginLeft: 8 }} />
                  : <i className={storageIcon(type)} style={{ fontSize: 14, color: storageColor(type), marginLeft: 8 }} />
                }
              />
            ))}
          </Box>
        )}

        {/* Shared storages */}
        {cs.sharedStorages.length > 0 && (
          <Card variant="outlined" sx={{ borderRadius: 2, mb: 2 }}>
            <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
              <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Typography fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className="ri-share-line" style={{ fontSize: 18, opacity: 0.7 }} />
                  Shared Storages
                </Typography>
              </Box>
              {cs.sharedStorages.map(s => (
                <Box
                  key={s.storage}
                  sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' }, borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 'none' } }}
                  onClick={() => onSelect?.({ type: 'storage', id: `${connId}:${s.storage}` })}
                >
                  {isCeph(s.type)
                    ? <img src="/images/ceph-logo.svg" alt="" width={16} height={16} />
                    : <i className={storageIcon(s.type)} style={{ fontSize: 16, color: storageColor(s.type) }} />
                  }
                  <Typography variant="body2" fontWeight={600} sx={{ flex: 1 }}>{s.storage}</Typography>
                  <Chip size="small" variant="outlined" label={s.type} sx={{ fontSize: 10, height: 20, fontFamily: 'JetBrains Mono, monospace' }} />
                  {s.total > 0 && (
                    <>
                      <Box sx={{ width: 60, height: 4, bgcolor: 'action.hover', borderRadius: 1, overflow: 'hidden' }}>
                        <Box sx={{ width: `${s.usedPct}%`, height: '100%', bgcolor: s.usedPct > 90 ? 'error.main' : s.usedPct > 70 ? 'warning.main' : 'success.main' }} />
                      </Box>
                      <Typography variant="caption" sx={{ opacity: 0.5, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, minWidth: 35, textAlign: 'right' }}>{s.usedPct}%</Typography>
                    </>
                  )}
                </Box>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Per-node storages */}
        {cs.nodes.filter(n => n.storages.length > 0).length > 0 && (
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
              <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Typography fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className="ri-server-line" style={{ fontSize: 18, opacity: 0.7 }} />
                  {t('common.nodes')}
                </Typography>
              </Box>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Node</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: 12 }} align="center">Local Storages</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {cs.nodes.filter(n => n.storages.length > 0).map(n => (
                      <TableRow
                        key={n.node}
                        hover
                        sx={{ cursor: 'pointer' }}
                        onClick={() => onSelect?.({ type: 'storage-node', id: `${connId}:${n.node}` })}
                      >
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Box sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 14, height: 14, flexShrink: 0 }}>
                              <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={14} height={14} style={{ opacity: 0.8 }} />
                              <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 7, height: 7, borderRadius: '50%', bgcolor: n.status === 'online' ? 'success.main' : 'error.main', border: '1.5px solid', borderColor: 'background.paper' }} />
                            </Box>
                            <Typography variant="body2" fontWeight={600}>{n.node}</Typography>
                          </Box>
                        </TableCell>
                        <TableCell align="center">
                          <Chip size="small" label={n.storages.length} sx={{ minWidth: 32, fontWeight: 700, fontSize: 12 }} />
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={n.status === 'online' ? 'Online' : n.status}
                            color={n.status === 'online' ? 'success' : 'default'}
                            variant="outlined"
                            sx={{ fontSize: 11, height: 22 }}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        )}
      </Box>
    )
  }

  // --- STORAGE-NODE: Node-level storage view ---
  if (selection.type === 'storage-node' && nodeName) {
    const nodeData = cs.nodes.find(n => n.node === nodeName)
    const storages = [...cs.sharedStorages, ...(nodeData?.storages || [])]
    const totalUsed = storages.reduce((s, st) => s + st.used, 0)
    const totalSize = storages.reduce((s, st) => s + st.total, 0)

    return (
      <Box sx={{ p: 2.5 }}>
        {/* Header breadcrumb */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Chip size="small" label="STORAGE" icon={<i className="ri-database-2-fill" style={{ fontSize: 14, marginLeft: 8 }} />} />
          <Typography
            variant="body2"
            sx={{ opacity: 0.5, cursor: 'pointer', '&:hover': { opacity: 0.8 } }}
            onClick={() => onSelect?.({ type: 'storage-cluster', id: connId })}
          >
            {cs.connName}
          </Typography>
          <i className="ri-arrow-right-s-line" style={{ opacity: 0.3 }} />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 16, height: 16, flexShrink: 0 }}>
              <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={16} height={16} style={{ opacity: 0.8 }} />
              <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 8, height: 8, borderRadius: '50%', bgcolor: nodeData?.status === 'online' ? 'success.main' : 'error.main', border: '1.5px solid', borderColor: 'background.paper' }} />
            </Box>
            <Typography variant="h6" fontWeight={900}>{nodeName}</Typography>
          </Box>
          {nodeData && (
            <Chip
              size="small"
              label={nodeData.status === 'online' ? 'Online' : nodeData.status}
              color={nodeData.status === 'online' ? 'success' : 'default'}
              variant="outlined"
              sx={{ fontSize: 11, height: 22 }}
            />
          )}
        </Box>

        {/* KPIs */}
        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          {[
            { label: 'Storages', value: storages.length, icon: 'ri-database-2-line' },
            { label: 'Used', value: fmt(totalUsed), icon: 'ri-pie-chart-line' },
            { label: 'Total', value: fmt(totalSize), icon: 'ri-hard-drive-3-line' },
          ].map(kpi => (
            <Card key={kpi.label} variant="outlined" sx={{ flex: 1, minWidth: 100, borderRadius: 2 }}>
              <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 }, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Box sx={{ width: 36, height: 36, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: alpha(theme.palette.primary.main, 0.1) }}>
                  <i className={kpi.icon} style={{ fontSize: 18, color: theme.palette.primary.main }} />
                </Box>
                <Box>
                  <Typography variant="h6" fontWeight={900} sx={{ lineHeight: 1.2 }}>{kpi.value}</Typography>
                  <Typography variant="caption" sx={{ opacity: 0.6 }}>{kpi.label}</Typography>
                </Box>
              </CardContent>
            </Card>
          ))}
        </Box>

        {/* Storage usage graphs */}
        {Object.keys(rrdData).length > 0 && (
          <Card variant="outlined" sx={{ borderRadius: 2, mb: 2 }}>
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                <Typography fontWeight={800} sx={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className="ri-line-chart-line" style={{ fontSize: 16, opacity: 0.7 }} />
                  {t('inventory.storageUsage')}
                </Typography>
                {timeframeSelector}
              </Box>
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                {Object.entries(rrdData).map(([name, points]) => renderStorageGraph(name, points))}
              </Box>
            </CardContent>
          </Card>
        )}

        {/* Storages list */}
        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
            <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Typography fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className="ri-database-2-line" style={{ fontSize: 18, opacity: 0.7 }} />
                Storages
              </Typography>
            </Box>
            {storages.map(s => (
              <Box
                key={s.storage}
                sx={{ px: 2, py: 1.25, display: 'flex', alignItems: 'center', gap: 1.5, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' }, borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 'none' } }}
                onClick={() => onSelect?.({ type: 'storage', id: `${connId}:${s.storage}:${nodeName}` })}
              >
                {isCeph(s.type)
                  ? <img src="/images/ceph-logo.svg" alt="" width={18} height={18} />
                  : <i className={storageIcon(s.type)} style={{ fontSize: 18, color: storageColor(s.type) }} />
                }
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={700}>{s.storage}</Typography>
                  <Typography variant="caption" sx={{ opacity: 0.5 }}>{s.content.join(', ')}</Typography>
                </Box>
                <Chip size="small" variant="outlined" label={s.type} sx={{ fontSize: 10, height: 20, fontFamily: 'JetBrains Mono, monospace' }} />
                {s.total > 0 && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 120 }}>
                    <Box sx={{ flex: 1, height: 6, bgcolor: 'action.hover', borderRadius: 1, overflow: 'hidden' }}>
                      <Box sx={{ width: `${s.usedPct}%`, height: '100%', borderRadius: 1, bgcolor: s.usedPct > 90 ? 'error.main' : s.usedPct > 70 ? 'warning.main' : 'success.main' }} />
                    </Box>
                    <Typography variant="caption" sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, opacity: 0.6, minWidth: 35, textAlign: 'right' }}>{s.usedPct}%</Typography>
                  </Box>
                )}
                <Typography variant="caption" sx={{ opacity: 0.4, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, minWidth: 60, textAlign: 'right' }}>
                  {fmt(totalSize > 0 ? s.total : 0)}
                </Typography>
              </Box>
            ))}
          </CardContent>
        </Card>
      </Box>
    )
  }

  return null
}
