'use client'

import React, { useMemo } from 'react'
import {
  Box,
  Card,
  CardContent,
  Typography,
  LinearProgress,
  Stack,
  Chip,
  alpha,
  useTheme,
} from '@mui/material'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'

import { formatBytes } from '@/utils/format'
import type { TreeClusterStorage, TreeStorageItem } from './InventoryTree'

// Colors per storage type
const TYPE_COLORS: Record<string, string> = {
  nfs: '#4fc3f7',
  rbd: '#ab47bc',
  cephfs: '#ab47bc',
  zfspool: '#66bb6a',
  zfs: '#66bb6a',
  lvm: '#ff7043',
  lvmthin: '#ff7043',
  dir: '#ffa726',
  btrfs: '#26c6da',
  other: '#78909c',
}

function getTypeColor(type: string): string {
  const key = type.toLowerCase()
  return TYPE_COLORS[key] ?? TYPE_COLORS.other
}

function getTypeLabel(type: string): string {
  const map: Record<string, string> = {
    nfs: 'NFS',
    rbd: 'RBD',
    cephfs: 'CephFS',
    zfspool: 'ZFS',
    zfs: 'ZFS',
    lvm: 'LVM',
    lvmthin: 'LVM-thin',
    dir: 'Dir',
    btrfs: 'Btrfs',
  }
  return map[type.toLowerCase()] ?? type
}

function storageIcon(type: string): string {
  if (type === 'nfs' || type === 'cifs') return 'ri-folder-shared-fill'
  if (type === 'zfspool' || type === 'zfs') return 'ri-stack-fill'
  if (type === 'lvm' || type === 'lvmthin') return 'ri-hard-drive-2-fill'
  if (type === 'dir') return 'ri-folder-fill'
  return 'ri-hard-drive-fill'
}

function storageIconColor(type: string): string {
  if (type === 'nfs' || type === 'cifs') return '#3498db'
  if (type === 'zfspool' || type === 'zfs') return '#2ecc71'
  if (type === 'lvm' || type === 'lvmthin') return '#e67e22'
  return '#95a5a6'
}

interface StorageDashboardProps {
  clusterStorages: TreeClusterStorage[]
  onStorageClick?: (sel: { type: 'storage'; id: string }) => void
}

export default function StorageDashboard({ clusterStorages, onStorageClick }: StorageDashboardProps) {
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'

  type StorageWithConn = TreeStorageItem & { connId: string }

  // Flatten all storages (deduplicate shared storages by storage+node key)
  const allStorages = useMemo<StorageWithConn[]>(() => {
    const seen = new Set<string>()
    const result: StorageWithConn[] = []

    for (const cluster of clusterStorages) {
      // Node-local storages
      for (const nodeEntry of cluster.nodes) {
        for (const s of nodeEntry.storages) {
          const key = `${cluster.connId}:${s.node}:${s.storage}`
          if (!seen.has(key)) {
            seen.add(key)
            result.push({ ...s, connId: cluster.connId })
          }
        }
      }
      // Shared storages (may overlap with node storages — deduplicate by storage name only for shared)
      for (const s of cluster.sharedStorages) {
        const key = `${cluster.connId}:${s.node}:${s.storage}`
        if (!seen.has(key)) {
          seen.add(key)
          result.push({ ...s, connId: cluster.connId })
        }
      }
    }

    return result.sort((a, b) => b.usedPct - a.usedPct)
  }, [clusterStorages])

  // KPIs
  const totalBytes = allStorages.reduce((acc, s) => acc + (s.total || 0), 0)
  const usedBytes = allStorages.reduce((acc, s) => acc + (s.used || 0), 0)
  const freeBytes = totalBytes - usedBytes
  const usedPct = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0

  // Donut chart data: group by type, sum total capacity
  const chartData = useMemo(() => {
    const grouped = new Map<string, number>()
    for (const s of allStorages) {
      const typeKey = s.type.toLowerCase()
      grouped.set(typeKey, (grouped.get(typeKey) ?? 0) + (s.total || 0))
    }
    return Array.from(grouped.entries())
      .map(([type, value]) => ({ name: getTypeLabel(type), value, color: getTypeColor(type) }))
      .sort((a, b) => b.value - a.value)
  }, [allStorages])

  const cardBg = isDark
    ? alpha(theme.palette.background.paper, 0.6)
    : alpha(theme.palette.background.paper, 0.8)

  const borderColor = theme.palette.divider

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 1 }}>
      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={1}>
        <i className="ri-database-2-fill" style={{ fontSize: 20, color: theme.palette.primary.main }} />
        <Typography variant="h6" fontWeight={700}>
          Storage Overview
        </Typography>
        <Chip
          size="small"
          label={`${allStorages.length} storage${allStorages.length !== 1 ? 's' : ''}`}
          variant="outlined"
          sx={{ fontWeight: 600 }}
        />
      </Stack>

      {/* Charts row: Usage donut + By Type donut */}
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        {/* Usage donut (Total / Used / Free) */}
        <Card
          variant="outlined"
          sx={{
            borderRadius: 2,
            bgcolor: cardBg,
            border: `1px solid ${borderColor}`,
            flex: 1,
            minWidth: 0,
          }}
        >
          <CardContent sx={{ py: 1, px: 2, '&:last-child': { pb: 1 } }}>
            <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.5 }}>
              <i className="ri-pie-chart-2-line" style={{ fontSize: 14, opacity: 0.6 }} />
              <Typography variant="caption" sx={{ opacity: 0.6, fontWeight: 600 }}>
                Usage
              </Typography>
            </Stack>
            <ResponsiveContainer width="100%" height={120}>
              <PieChart>
                <Pie
                  data={[
                    { name: 'Used', value: usedBytes, color: usedPct > 85 ? theme.palette.error.main : usedPct > 70 ? theme.palette.warning.main : theme.palette.primary.main },
                    { name: 'Free', value: freeBytes, color: alpha(theme.palette.success.main, 0.5) },
                  ]}
                  cx="50%"
                  cy="50%"
                  innerRadius={35}
                  outerRadius={55}
                  paddingAngle={2}
                  dataKey="value"
                >
                  <Cell fill={usedPct > 85 ? theme.palette.error.main : usedPct > 70 ? theme.palette.warning.main : theme.palette.primary.main} strokeWidth={0} />
                  <Cell fill={alpha(theme.palette.success.main, 0.5)} strokeWidth={0} />
                </Pie>
                <Tooltip
                  wrapperStyle={{ backgroundColor: 'transparent', boxShadow: 'none' }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    return (
                      <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 160 }}>
                        <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha(theme.palette.primary.main, 0.1), borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          <i className="ri-pie-chart-line" style={{ fontSize: 13, color: theme.palette.primary.main }} />
                          <Typography variant="caption" sx={{ fontWeight: 700, color: 'primary.main' }}>Storage Usage</Typography>
                        </Box>
                        <Box sx={{ px: 1.5, py: 0.75 }}>
                          {payload.map(entry => (
                            <Box key={entry.name} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.payload?.color || entry.color, flexShrink: 0 }} />
                              <Typography variant="caption" sx={{ flex: 1 }}>{entry.name}</Typography>
                              <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{formatBytes(Number(entry.value))}</Typography>
                            </Box>
                          ))}
                        </Box>
                      </Box>
                    )
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <Stack spacing={0.5} sx={{ mt: 0.5 }}>
              <Stack direction="row" alignItems="center" spacing={0.75}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: theme.palette.primary.main, flexShrink: 0 }} />
                <Typography variant="caption" sx={{ flex: 1, opacity: 0.8 }}>Total</Typography>
                <Typography variant="caption" sx={{ fontWeight: 600, opacity: 0.7 }}>{formatBytes(totalBytes)}</Typography>
              </Stack>
              <Stack direction="row" alignItems="center" spacing={0.75}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: usedPct > 85 ? theme.palette.error.main : usedPct > 70 ? theme.palette.warning.main : theme.palette.primary.main, flexShrink: 0 }} />
                <Typography variant="caption" sx={{ flex: 1, opacity: 0.8 }}>Used ({usedPct}%)</Typography>
                <Typography variant="caption" sx={{ fontWeight: 600, opacity: 0.7 }}>{formatBytes(usedBytes)}</Typography>
              </Stack>
              <Stack direction="row" alignItems="center" spacing={0.75}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: alpha(theme.palette.success.main, 0.5), flexShrink: 0 }} />
                <Typography variant="caption" sx={{ flex: 1, opacity: 0.8 }}>Free</Typography>
                <Typography variant="caption" sx={{ fontWeight: 600, opacity: 0.7 }}>{formatBytes(freeBytes)}</Typography>
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        {/* By Type donut */}
        {chartData.length > 0 && (
          <Card
            variant="outlined"
            sx={{
              borderRadius: 2,
              bgcolor: cardBg,
              border: `1px solid ${borderColor}`,
              flex: 1,
              minWidth: 0,
            }}
          >
            <CardContent sx={{ py: 1, px: 2, '&:last-child': { pb: 1 } }}>
              <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.5 }}>
                <i className="ri-donut-chart-line" style={{ fontSize: 14, opacity: 0.6 }} />
                <Typography variant="caption" sx={{ opacity: 0.6, fontWeight: 600 }}>
                  By Type
                </Typography>
              </Stack>
              <ResponsiveContainer width="100%" height={120}>
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={35}
                    outerRadius={55}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} strokeWidth={0} />
                    ))}
                  </Pie>
                  <Tooltip
                    wrapperStyle={{ backgroundColor: 'transparent', boxShadow: 'none' }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      return (
                        <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 160 }}>
                          <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha(theme.palette.info.main, 0.1), borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            <i className="ri-donut-chart-line" style={{ fontSize: 13, color: theme.palette.info.main }} />
                            <Typography variant="caption" sx={{ fontWeight: 700, color: 'info.main' }}>By Type</Typography>
                          </Box>
                          <Box sx={{ px: 1.5, py: 0.75 }}>
                            {payload.map(entry => (
                              <Box key={entry.name} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.payload?.color || entry.color, flexShrink: 0 }} />
                                <Typography variant="caption" sx={{ flex: 1 }}>{entry.name}</Typography>
                                <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{formatBytes(Number(entry.value))}</Typography>
                              </Box>
                            ))}
                          </Box>
                        </Box>
                      )
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                {chartData.map((entry) => (
                  <Stack key={entry.name} direction="row" alignItems="center" spacing={0.75}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                    <Typography variant="caption" sx={{ flex: 1, opacity: 0.8 }}>{entry.name}</Typography>
                    <Typography variant="caption" sx={{ fontWeight: 600, opacity: 0.7 }}>{formatBytes(entry.value)}</Typography>
                  </Stack>
                ))}
              </Stack>
            </CardContent>
          </Card>
        )}
      </Stack>

      {/* Storage list */}
      <Box>
        <Card
          variant="outlined"
          sx={{
            flex: 1,
            borderRadius: 2,
            bgcolor: cardBg,
            border: `1px solid ${borderColor}`,
            minWidth: 0,
            width: '100%',
          }}
        >
          <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
            <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 1.5 }}>
              <i className="ri-list-check" style={{ fontSize: 14, opacity: 0.6 }} />
              <Typography variant="caption" sx={{ opacity: 0.6, fontWeight: 600 }}>
                Storage List
              </Typography>
              <Typography variant="caption" sx={{ opacity: 0.4 }}>
                (sorted by usage)
              </Typography>
            </Stack>

            {allStorages.length === 0 ? (
              <Box sx={{ py: 3, textAlign: 'center' }}>
                <i className="ri-database-2-line" style={{ fontSize: 32, opacity: 0.2 }} />
                <Typography variant="body2" sx={{ opacity: 0.4, mt: 1 }}>
                  No storages found
                </Typography>
              </Box>
            ) : (
              <Stack spacing={0.75}>
                {allStorages.map((s, idx) => {
                  const typeColor = getTypeColor(s.type)
                  const barColor =
                    s.usedPct > 85
                      ? theme.palette.error.main
                      : s.usedPct > 70
                      ? theme.palette.warning.main
                      : theme.palette.primary.main

                  const storageId = `${s.connId}:${s.storage}:${s.node}`
                  const isClickable = !!onStorageClick

                  return (
                    <Box
                      key={`${s.storage}-${s.node}-${idx}`}
                      onClick={isClickable ? () => onStorageClick({ type: 'storage', id: storageId }) : undefined}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                        px: 1.5,
                        py: 0.6,
                        borderRadius: 1.5,
                        border: '1px solid',
                        borderColor: 'divider',
                        bgcolor: isDark
                          ? alpha(theme.palette.background.default, 0.4)
                          : alpha(theme.palette.grey[50], 0.8),
                        cursor: isClickable ? 'pointer' : 'default',
                        transition: 'background-color 0.15s',
                        '&:hover': isClickable
                          ? { bgcolor: alpha(theme.palette.primary.main, 0.06) }
                          : undefined,
                      }}
                    >
                      {/* Storage type icon */}
                      {(s.type === 'rbd' || s.type === 'cephfs')
                        ? <img src="/images/ceph-logo.svg" alt="" width={16} height={16} style={{ flexShrink: 0, opacity: 0.8 }} />
                        : <i className={storageIcon(s.type)} style={{ fontSize: 16, color: storageIconColor(s.type), opacity: 0.8, flexShrink: 0 }} />
                      }

                      {/* Name */}
                      <Typography
                        variant="body2"
                        fontWeight={700}
                        sx={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontFamily: 'JetBrains Mono, monospace',
                          fontSize: '0.75rem',
                          minWidth: 0,
                          flexShrink: 1,
                        }}
                      >
                        {s.storage}
                      </Typography>

                      {/* Node */}
                      <Typography variant="caption" sx={{ opacity: 0.45, fontSize: '0.65rem', flexShrink: 0, whiteSpace: 'nowrap' }}>
                        {s.node}
                      </Typography>

                      {/* Type chip */}
                      <Chip
                        size="small"
                        label={getTypeLabel(s.type)}
                        sx={{
                          height: 18,
                          fontSize: '0.6rem',
                          fontWeight: 700,
                          bgcolor: alpha(typeColor, 0.15),
                          color: typeColor,
                          flexShrink: 0,
                        }}
                      />

                      {/* Usage bar */}
                      <Box sx={{ flex: 1, minWidth: 60 }}>
                        <LinearProgress
                          variant="determinate"
                          value={Math.min(s.usedPct, 100)}
                          sx={{
                            height: 5,
                            borderRadius: 3,
                            bgcolor: alpha(barColor, 0.15),
                            '& .MuiLinearProgress-bar': { bgcolor: barColor, borderRadius: 3 },
                          }}
                        />
                      </Box>

                      {/* Usage text */}
                      <Typography variant="caption" sx={{ opacity: 0.5, fontSize: '0.6rem', flexShrink: 0, whiteSpace: 'nowrap' }}>
                        {formatBytes(s.used)}/{formatBytes(s.total)}
                      </Typography>

                      {/* Percentage */}
                      <Typography
                        variant="caption"
                        sx={{
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          flexShrink: 0,
                          minWidth: 36,
                          textAlign: 'right',
                          color: s.usedPct > 85 ? theme.palette.error.main : s.usedPct > 70 ? theme.palette.warning.main : theme.palette.text.secondary,
                        }}
                      >
                        {s.usedPct.toFixed(1)}%
                      </Typography>

                      {/* Arrow indicator for clickable rows */}
                      {isClickable && (
                        <i
                          className="ri-arrow-right-s-line"
                          style={{ fontSize: 16, opacity: 0.3, flexShrink: 0 }}
                        />
                      )}
                    </Box>
                  )
                })}
              </Stack>
            )}
          </CardContent>
        </Card>
      </Box>
    </Box>
  )
}
