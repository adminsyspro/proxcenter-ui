'use client'

import React from 'react'
import { useTranslations } from 'next-intl'

import {
  Box,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  IconButton,
  Tooltip as MuiTooltip,
  Typography,
  useTheme,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'
import ChartContainer from '@/components/ChartContainer'

import { formatBytes } from '@/utils/format'
import { formatBps, fetchDetails } from '../helpers'
import ExpandableChart from './ExpandableChart'
import StorageContentGroup from './StorageContentGroup'
import { UploadDialog } from '@/components/storage/StorageContentBrowser'
import TemplateDownloadDialog from '@/components/storage/TemplateDownloadDialog'
import type { PbsServerPanelHandle } from './PbsServerPanel'
import type { InventorySelection, DetailsPayload, RrdTimeframe } from '../types'

/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */

interface StorageDetailPanelProps {
  data: DetailsPayload
  selection: InventorySelection | null

  // Storage RRD
  storageRrdHistory: any[]
  storageRrdTimeframe: RrdTimeframe
  setStorageRrdTimeframe: React.Dispatch<React.SetStateAction<RrdTimeframe>>

  // Ceph perf
  storageCephPerf: any
  storageCephPerfHistory: any[]

  // Dialogs
  storageUploadOpen: boolean
  setStorageUploadOpen: React.Dispatch<React.SetStateAction<boolean>>
  templateDialogOpen: boolean
  setTemplateDialogOpen: React.Dispatch<React.SetStateAction<boolean>>

  // PBS storage backup search / groups
  pbsStorageSearch: string
  setPbsStorageSearch: React.Dispatch<React.SetStateAction<string>>
  pbsStoragePage: number
  setPbsStoragePage: React.Dispatch<React.SetStateAction<number>>
  expandedStorageBackupGroups: Set<string>
  setExpandedStorageBackupGroups: React.Dispatch<React.SetStateAction<Set<string>>>

  // Misc
  vmNamesMap: Record<string, string>
  dateLocale: string
  primaryColor: string
  primaryColorLight: string

  // Refs
  pbsPanelRef: React.RefObject<PbsServerPanelHandle | null>

  // Callbacks
  setData: React.Dispatch<React.SetStateAction<DetailsPayload>>
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function StorageDetailPanel({
  data,
  selection,
  storageRrdHistory,
  storageRrdTimeframe,
  setStorageRrdTimeframe,
  storageCephPerf,
  storageCephPerfHistory,
  storageUploadOpen,
  setStorageUploadOpen,
  templateDialogOpen,
  setTemplateDialogOpen,
  pbsStorageSearch,
  setPbsStorageSearch,
  pbsStoragePage,
  setPbsStoragePage,
  expandedStorageBackupGroups,
  setExpandedStorageBackupGroups,
  vmNamesMap,
  dateLocale,
  primaryColor,
  primaryColorLight,
  pbsPanelRef,
  setData,
}: StorageDetailPanelProps) {
  const t = useTranslations()
  const theme = useTheme()

  const si = data.storageInfo
  if (!si) return null

  const isCeph = si.type === 'rbd' || si.type === 'cephfs'
  const typeLabels: Record<string, string> = {
    rbd: 'Ceph RBD', cephfs: 'CephFS', nfs: 'NFS', cifs: 'SMB/CIFS',
    zfspool: 'ZFS', zfs: 'ZFS over iSCSI', lvm: 'LVM', lvmthin: 'LVM-Thin',
    dir: 'Directory', iscsi: 'iSCSI', glusterfs: 'GlusterFS', pbs: 'PBS',
  }
  const storageTypeIcon = (type: string) => {
    if (type === 'rbd' || type === 'cephfs') return null // use img
    if (type === 'nfs' || type === 'cifs') return 'ri-folder-shared-fill'
    if (type === 'zfspool' || type === 'zfs') return 'ri-stack-fill'
    if (type === 'lvm' || type === 'lvmthin') return 'ri-hard-drive-2-fill'
    if (type === 'dir') return 'ri-folder-fill'
    return 'ri-hard-drive-fill'
  }
  const storageTypeColor = (type: string) => {
    if (type === 'nfs' || type === 'cifs') return '#3498db'
    if (type === 'zfspool' || type === 'zfs') return '#2ecc71'
    if (type === 'lvm' || type === 'lvmthin') return '#e67e22'
    return '#95a5a6'
  }

  // Group content items by type
  const groups: Record<string, { label: string; icon: string; items: any[]; contentType?: string }> = {}
  const contentLabelMap: Record<string, { label: string; icon: string }> = {
    images: { label: t('inventory.storageVmDisks'), icon: 'ri-hard-drive-3-line' },
    rootdir: { label: t('inventory.storageCtVolumes'), icon: 'ri-archive-line' },
    iso: { label: t('inventory.storageIsoImages'), icon: 'ri-disc-line' },
    backup: { label: t('inventory.storageBackups'), icon: 'ri-shield-check-line' },
    snippets: { label: t('inventory.storageSnippets'), icon: 'ri-code-s-slash-line' },
    vztmpl: { label: t('inventory.storageTemplates'), icon: 'ri-file-copy-line' },
    import: { label: 'Import', icon: 'ri-import-line' },
  }

  // Pre-create empty groups for all content types the storage supports
  for (const ct of si.content || []) {
    const cfg = contentLabelMap[ct] || { label: ct, icon: 'ri-file-line' }
    groups[ct] = { label: cfg.label, icon: cfg.icon, items: [], contentType: ct }
  }

  for (const item of si.contentItems || []) {
    const ct = item.content || 'other'
    if (!groups[ct]) {
      const cfg = contentLabelMap[ct] || { label: ct, icon: 'ri-file-line' }
      groups[ct] = { label: cfg.label, icon: cfg.icon, items: [], contentType: ct }
    }
    groups[ct].items.push(item)
  }

  // Sort items in each group
  for (const g of Object.values(groups)) {
    g.items.sort((a: any, b: any) => (b.ctime || 0) - (a.ctime || 0))
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Usage chart card - fixed, never cropped */}
      {si.total > 0 && (
        <Card variant="outlined" sx={{ borderRadius: 2, flexShrink: 0 }}>
          <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
            <Typography fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              {isCeph
                ? <img src="/images/ceph-logo.svg" alt="" width={18} height={18} />
                : <i className={storageTypeIcon(si.type) || 'ri-hard-drive-fill'} style={{ fontSize: 18, color: storageTypeColor(si.type) }} />
              }
              {t('inventory.storageUsage')}
            </Typography>

            {/* Usage gauge + graphs */}
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'stretch', flexWrap: 'wrap' }}>
              {/* Donut gauge + legend */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                <Box sx={{ position: 'relative', width: 90, height: 90, flexShrink: 0 }}>
                  <CircularProgress
                    variant="determinate"
                    value={100}
                    size={90}
                    thickness={6}
                    sx={{ color: 'action.hover', position: 'absolute' }}
                  />
                  <CircularProgress
                    variant="determinate"
                    value={si.usedPct}
                    size={90}
                    thickness={6}
                    sx={{
                      color: si.usedPct > 90 ? 'error.main' : si.usedPct > 70 ? 'warning.main' : 'success.main',
                      position: 'absolute',
                    }}
                  />
                  <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                    <Typography variant="h6" fontWeight={900} sx={{ lineHeight: 1 }}>{si.usedPct}%</Typography>
                    <Typography variant="caption" sx={{ opacity: 0.5, fontSize: 10 }}>used</Typography>
                  </Box>
                </Box>
                <Box sx={{ minWidth: 120 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="caption" sx={{ opacity: 0.7 }}>Used</Typography>
                    <Typography variant="caption" fontWeight={600} sx={{ ml: 1 }}>{formatBytes(si.used)}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="caption" sx={{ opacity: 0.7 }}>Free</Typography>
                    <Typography variant="caption" fontWeight={600} sx={{ ml: 1 }}>{formatBytes(si.total - si.used)}</Typography>
                  </Box>
                  <Divider sx={{ my: 0.5 }} />
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="caption" sx={{ opacity: 0.7 }}>Total</Typography>
                    <Typography variant="caption" fontWeight={700} sx={{ ml: 1 }}>{formatBytes(si.total)}</Typography>
                  </Box>
                </Box>
              </Box>

              {/* Storage usage evolution graph (all storage types) */}
              {storageRrdHistory.length > 1 && (
                <Box sx={{ flex: 1, minWidth: 180 }}>
                  <ExpandableChart
                    title={t('inventory.storageUsage')}
                    height={90}
                    header={
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flex: 1 }}>
                        <Typography variant="caption" fontWeight={600}>{t('inventory.storageUsage')}</Typography>
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
                              onClick={() => setStorageRrdTimeframe(opt.value)}
                              sx={{
                                px: 0.6, py: 0.1, borderRadius: 0.5, cursor: 'pointer',
                                fontSize: '0.6rem', fontWeight: 700, lineHeight: 1.4,
                                bgcolor: storageRrdTimeframe === opt.value ? 'primary.main' : 'transparent',
                                color: storageRrdTimeframe === opt.value ? 'primary.contrastText' : 'text.secondary',
                                opacity: storageRrdTimeframe === opt.value ? 1 : 0.5,
                                '&:hover': { opacity: 1 },
                              }}
                            >
                              {opt.label}
                            </Box>
                          ))}
                        </Box>
                      </Box>
                    }
                  >
                    <ChartContainer>
                      <AreaChart data={storageRrdHistory}>
                        <XAxis dataKey="time" tickFormatter={(v: any) => { const d = new Date(v); return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }} minTickGap={40} tick={{ fontSize: 9 }} type="number" domain={['dataMin', 'dataMax']} />
                        <YAxis domain={[0, 100]} tickFormatter={(v: any) => `${v}%`} tick={{ fontSize: 9 }} width={30} />
                        <Tooltip
                          wrapperStyle={{ backgroundColor: 'transparent', boxShadow: 'none' }}
                          content={({ active, payload, label }) => {
                            if (!active || !payload?.length) return null
                            const strokeColor = si.usedPct > 90 ? theme.palette.error.main : si.usedPct > 70 ? theme.palette.warning.main : theme.palette.success.main
                            const ts = new Date(Number(label))
                            const timeStr = storageRrdTimeframe === 'hour' || storageRrdTimeframe === 'day'
                              ? ts.toLocaleTimeString()
                              : ts.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' }) + ' ' + ts.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
                            return (
                              <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 160 }}>
                                <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha(strokeColor, 0.1), borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                  <i className="ri-hard-drive-2-line" style={{ fontSize: 13, color: strokeColor }} />
                                  <Typography variant="caption" sx={{ fontWeight: 700, color: strokeColor }}>Storage Usage</Typography>
                                  <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{timeStr}</Typography>
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
                        <Area
                          type="monotone"
                          dataKey="usedPct"
                          stroke={si.usedPct > 90 ? theme.palette.error.main : si.usedPct > 70 ? theme.palette.warning.main : theme.palette.success.main}
                          fill={si.usedPct > 90 ? theme.palette.error.main : si.usedPct > 70 ? theme.palette.warning.main : theme.palette.success.main}
                          fillOpacity={0.3}
                          strokeWidth={1.5}
                          isAnimationActive={false}
                          name="usedPct"
                        />
                      </AreaChart>
                    </ChartContainer>
                  </ExpandableChart>
                </Box>
              )}

              {/* Ceph Read/Write + IOPS graphs */}
              {isCeph && storageCephPerfHistory.length > 1 && (
                <>
                  {/* Read/Write throughput */}
                  <Box sx={{ flex: 1, minWidth: 180 }}>
                    <ExpandableChart
                      title={t('inventory.pbsTransferRate')}
                      height={90}
                      header={
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flex: 1 }}>
                          <Typography variant="caption" fontWeight={600}>{t('inventory.pbsTransferRate')}</Typography>
                          <Typography variant="caption" fontWeight={700} sx={{ opacity: 0.7, fontSize: 10 }}>
                            {storageCephPerf ? `R: ${formatBps(storageCephPerf.read_bytes_sec)} / W: ${formatBps(storageCephPerf.write_bytes_sec)}` : '\u2014'}
                          </Typography>
                        </Box>
                      }
                    >
                      <ChartContainer>
                        <AreaChart data={storageCephPerfHistory}>
                          <XAxis dataKey="time" tickFormatter={(v: any) => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} minTickGap={40} tick={{ fontSize: 9 }} />
                          <YAxis tickFormatter={(v: any) => formatBps(Number(v))} tick={{ fontSize: 9 }} width={50} domain={[0, 'auto']} />
                          <Tooltip
                            wrapperStyle={{ backgroundColor: 'transparent', boxShadow: 'none' }}
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null
                              const ts = payload[0]?.payload?.time ? new Date(payload[0].payload.time).toLocaleTimeString() : ''
                              return (
                                <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 180 }}>
                                  <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha('#3b82f6', 0.1), borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                    <i className="ri-speed-line" style={{ fontSize: 13, color: '#3b82f6' }} />
                                    <Typography variant="caption" sx={{ fontWeight: 700, color: '#3b82f6' }}>Throughput</Typography>
                                    <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{ts}</Typography>
                                  </Box>
                                  <Box sx={{ px: 1.5, py: 0.75 }}>
                                    {payload.map(entry => (
                                      <Box key={String(entry.dataKey)} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                        <Typography variant="caption" sx={{ flex: 1 }}>{entry.name === 'read_bytes_sec' ? 'Read' : 'Write'}</Typography>
                                        <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{formatBps(Number(entry.value))}</Typography>
                                      </Box>
                                    ))}
                                  </Box>
                                </Box>
                              )
                            }}
                          />
                          <Area type="monotone" dataKey="read_bytes_sec" stroke={primaryColor} fill={primaryColor} fillOpacity={0.4} strokeWidth={1.5} isAnimationActive={false} name="read_bytes_sec" />
                          <Area type="monotone" dataKey="write_bytes_sec" stroke={primaryColorLight} fill={primaryColorLight} fillOpacity={0.3} strokeWidth={1} isAnimationActive={false} name="write_bytes_sec" />
                        </AreaChart>
                      </ChartContainer>
                    </ExpandableChart>
                  </Box>

                  {/* IOPS */}
                  <Box sx={{ flex: 1, minWidth: 180 }}>
                    <ExpandableChart
                      title="IOPS"
                      height={90}
                      header={
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flex: 1 }}>
                          <Typography variant="caption" fontWeight={600}>IOPS</Typography>
                          <Typography variant="caption" fontWeight={700} sx={{ opacity: 0.7, fontSize: 10 }}>
                            {storageCephPerf ? `R: ${storageCephPerf.read_op_per_sec?.toLocaleString() || 0} / W: ${storageCephPerf.write_op_per_sec?.toLocaleString() || 0}` : '\u2014'}
                          </Typography>
                        </Box>
                      }
                    >
                      <ChartContainer>
                        <AreaChart data={storageCephPerfHistory}>
                          <XAxis dataKey="time" tickFormatter={(v: any) => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} minTickGap={40} tick={{ fontSize: 9 }} />
                          <YAxis tick={{ fontSize: 9 }} width={40} domain={[0, 'auto']} />
                          <Tooltip
                            wrapperStyle={{ backgroundColor: 'transparent', boxShadow: 'none' }}
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null
                              const ts = payload[0]?.payload?.time ? new Date(payload[0].payload.time).toLocaleTimeString() : ''
                              return (
                                <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 180 }}>
                                  <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha('#f59e0b', 0.1), borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                    <i className="ri-dashboard-3-line" style={{ fontSize: 13, color: '#f59e0b' }} />
                                    <Typography variant="caption" sx={{ fontWeight: 700, color: '#f59e0b' }}>IOPS</Typography>
                                    <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{ts}</Typography>
                                  </Box>
                                  <Box sx={{ px: 1.5, py: 0.75 }}>
                                    {payload.map(entry => (
                                      <Box key={String(entry.dataKey)} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                        <Typography variant="caption" sx={{ flex: 1 }}>{entry.name === 'read_op_per_sec' ? 'Read' : 'Write'}</Typography>
                                        <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{Number(entry.value).toLocaleString()} IOPS</Typography>
                                      </Box>
                                    ))}
                                  </Box>
                                </Box>
                              )
                            }}
                          />
                          <Area type="monotone" dataKey="read_op_per_sec" stroke={primaryColor} fill={primaryColor} fillOpacity={0.4} strokeWidth={1.5} isAnimationActive={false} name="read_op_per_sec" />
                          <Area type="monotone" dataKey="write_op_per_sec" stroke={primaryColorLight} fill={primaryColorLight} fillOpacity={0.3} strokeWidth={1} isAnimationActive={false} name="write_op_per_sec" />
                        </AreaChart>
                      </ChartContainer>
                    </ExpandableChart>
                  </Box>
                </>
              )}
            </Box>

          </CardContent>
        </Card>
      )}

      {/* Scrollable rest */}
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Properties card */}
      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
          <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Typography fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <i className="ri-information-line" style={{ fontSize: 18, opacity: 0.7 }} />
              {t('inventory.storageProperties')}
            </Typography>
          </Box>
          <Box>
            {[
              { k: 'Type', v: typeLabels[si.type] || si.type },
              { k: 'Shared', v: si.shared ? 'Yes' : 'No' },
              { k: 'Status', v: si.enabled ? 'Enabled' : 'Disabled' },
              { k: 'Content types', v: si.content.join(', ') || '-' },
              ...(si.node && !si.shared ? [{ k: 'Node', v: si.node }] : []),
              ...(si.nodes && si.nodes.length > 1 ? [{ k: 'Nodes', v: si.nodes.join(', ') }] : []),
              ...(si.path ? [{ k: 'Path', v: si.path }] : []),
              ...(si.server ? [{ k: 'Server', v: si.server }] : []),
              ...(si.pool ? [{ k: 'Pool', v: si.pool }] : []),
              ...(si.monhost ? [{ k: 'Monitor Host', v: si.monhost }] : []),
            ].map(({ k, v }) => (
              <Box key={k} sx={{ display: 'flex', px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 'none' } }}>
                <Typography variant="body2" sx={{ opacity: 0.5, width: 130, flexShrink: 0, fontSize: 13 }}>{k}</Typography>
                <Typography variant="body2" sx={{ fontSize: 13, fontFamily: 'JetBrains Mono, monospace' }}>{v}</Typography>
              </Box>
            ))}
          </Box>
        </CardContent>
      </Card>

      {/* PBS storage: grouped backup table */}
      {si.type === 'pbs' && (groups['backup']?.items?.length > 0) ? (() => {
        const backupItems = groups['backup']?.items || []

        // Group by vmid (e.g. "vm/269")
        const groupMap = new Map<string, any[]>()
        for (const item of backupItems) {
          const volParts = String(item.volid || '').split(':')
          const backupPath = volParts.length > 1 ? volParts.slice(1).join(':') : item.volid
          const pathParts = backupPath?.split('/') || []
          // backup/vm/269/timestamp -> groupKey = "vm/269"
          const groupKey = pathParts.length >= 3 ? `${pathParts[1]}/${pathParts[2]}` : String(item.vmid || 'unknown')
          if (!groupMap.has(groupKey)) groupMap.set(groupKey, [])
          groupMap.get(groupKey)!.push(item)
        }

        // Sort each group by ctime desc
        for (const [, group] of groupMap) {
          group.sort((a: any, b: any) => (b.ctime || 0) - (a.ctime || 0))
        }

        // Sort groups by latest backup
        let sortedGroups = Array.from(groupMap.entries())
          .sort((a, b) => (b[1][0]?.ctime || 0) - (a[1][0]?.ctime || 0))

        // Filter by search
        if (pbsStorageSearch.trim()) {
          const q = pbsStorageSearch.toLowerCase()
          sortedGroups = sortedGroups.filter(([groupId, groupItems]) => {
            if (groupId.toLowerCase().includes(q)) return true
            return groupItems.some((item: any) =>
              String(item.volid || '').toLowerCase().includes(q) ||
              String(item.notes || '').toLowerCase().includes(q) ||
              (item.vmid ? String(item.vmid).includes(q) : false)
            )
          })
        }

        const totalFiltered = sortedGroups.reduce((sum, [, g]) => sum + g.length, 0)

        return (
          <Card variant="outlined" sx={{ borderRadius: 2, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <CardContent sx={{ p: 0, '&:last-child': { pb: 0 }, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              {/* Header */}
              <Box sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0, fontSize: 13 }}>
                  <i className="ri-shield-check-line" style={{ fontSize: 16, opacity: 0.7 }} />
                  {t('inventory.pbsBackupList')} ({totalFiltered}{pbsStorageSearch ? `/${backupItems.length}` : ''})
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Box sx={{
                  display: 'flex', alignItems: 'center', gap: 0.5,
                  border: '1px solid', borderColor: 'divider', borderRadius: 1,
                  px: 0.75, py: 0.15, maxWidth: 200,
                }}>
                  <i className="ri-search-line" style={{ fontSize: 12, opacity: 0.4 }} />
                  <input
                    type="text"
                    value={pbsStorageSearch}
                    onChange={e => { setPbsStorageSearch(e.target.value); setPbsStoragePage(0) }}
                    placeholder={t('inventory.pbsSearchBackups')}
                    style={{
                      border: 'none', outline: 'none', background: 'transparent',
                      fontSize: 11, width: '100%', color: 'inherit',
                      fontFamily: 'Inter, sans-serif',
                    }}
                  />
                  {pbsStorageSearch && (
                    <i className="ri-close-line" style={{ fontSize: 12, opacity: 0.4, cursor: 'pointer' }} onClick={() => { setPbsStorageSearch(''); setPbsStoragePage(0) }} />
                  )}
                </Box>
              </Box>

              {/* Grouped backup list */}
              <Box sx={{ flex: 1, minHeight: 0, maxHeight: 'calc(100vh - 400px)', overflow: 'auto' }}>
                {sortedGroups.length === 0 ? (
                  <Box sx={{ px: 2, py: 3, textAlign: 'center' }}>
                    <Typography variant="caption" sx={{ opacity: 0.4 }}>{t('inventory.pbsNoBackups')}</Typography>
                  </Box>
                ) : sortedGroups.map(([groupId, groupItems]) => {
                  const isExpanded = expandedStorageBackupGroups.has(groupId)
                  const latest = groupItems[0]
                  const isVm = latest.format === 'pbs-vm'
                  const isCt = latest.format === 'pbs-ct'
                  const backupType = isVm ? 'vm' : isCt ? 'ct' : 'host'
                  const totalSize = groupItems.reduce((sum: number, i: any) => sum + (i.size || 0), 0)
                  const verifiedCount = groupItems.filter((i: any) => i.verification?.state === 'ok').length
                  const vmName = latest.notes || (latest.vmid ? `VM ${latest.vmid}` : groupId)

                  return (
                    <Box key={groupId}>
                      {/* Group header */}
                      <Box
                        onClick={() => {
                          setExpandedStorageBackupGroups(prev => {
                            const next = new Set(prev)
                            if (next.has(groupId)) next.delete(groupId)
                            else next.add(groupId)
                            return next
                          })
                        }}
                        sx={{
                          display: 'flex', alignItems: 'center', gap: 1,
                          px: 1.5, py: 0.4,
                          borderBottom: '1px solid', borderColor: 'divider',
                          cursor: 'pointer',
                          '&:hover': { bgcolor: 'action.hover' },
                          bgcolor: isExpanded ? 'action.selected' : 'transparent',
                        }}
                      >
                        <i className={isExpanded ? 'ri-subtract-line' : 'ri-add-line'} style={{ fontSize: 16, opacity: 0.5 }} />
                        <i
                          className={isVm ? 'ri-computer-line' : isCt ? 'ri-instance-line' : 'ri-server-line'}
                          style={{ fontSize: 14, color: isVm ? '#ff9800' : isCt ? '#9c27b0' : '#757575' }}
                        />
                        <Typography variant="body2" fontWeight={600} noWrap sx={{ fontSize: 11, flex: 1, minWidth: 0 }}>
                          {vmName} <Typography component="span" sx={{ opacity: 0.4, fontSize: 9 }}>({groupId})</Typography>
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="caption" sx={{ opacity: 0.7, fontSize: 11 }}>
                            {groupItems.length} snapshot{groupItems.length > 1 ? 's' : ''}
                          </Typography>
                          <Typography variant="caption" sx={{ opacity: 0.6, minWidth: 60, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 10 }}>
                            {formatBytes(totalSize)}
                          </Typography>
                          {verifiedCount === groupItems.length ? (
                            <MuiTooltip title={t('inventory.pbsAllVerified')}>
                              <i className="ri-checkbox-circle-fill" style={{ fontSize: 16, color: '#4caf50' }} />
                            </MuiTooltip>
                          ) : verifiedCount > 0 ? (
                            <MuiTooltip title={t('inventory.pbsPartiallyVerified', { count: verifiedCount, total: groupItems.length })}>
                              <i className="ri-checkbox-circle-line" style={{ fontSize: 16, color: '#ff9800' }} />
                            </MuiTooltip>
                          ) : (
                            <MuiTooltip title={t('inventory.pbsNotVerified')}>
                              <i className="ri-checkbox-blank-circle-line" style={{ fontSize: 16, opacity: 0.3 }} />
                            </MuiTooltip>
                          )}
                        </Box>
                      </Box>

                      {/* Expanded snapshots */}
                      {isExpanded && (
                        <Box sx={{ bgcolor: 'action.hover' }}>
                          {/* Column headers */}
                          <Box sx={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 80px 30px 80px 30px',
                            gap: 0.25, px: 1.5, pl: 5, py: 0.3,
                            borderBottom: '1px solid', borderColor: 'divider',
                            bgcolor: 'background.paper',
                          }}>
                            <Typography variant="caption" fontWeight={600} sx={{ opacity: 0.6, fontSize: 10 }}>{t('inventory.pbsDateTime')}</Typography>
                            <Typography variant="caption" fontWeight={600} sx={{ opacity: 0.6, fontSize: 10 }}>{t('inventory.pbsSize')}</Typography>
                            <Typography variant="caption" fontWeight={600} sx={{ opacity: 0.6, fontSize: 10, textAlign: 'center' }}><i className="ri-lock-line" style={{ fontSize: 10 }} /></Typography>
                            <Typography variant="caption" fontWeight={600} sx={{ opacity: 0.6, fontSize: 10, textAlign: 'center' }}>{t('common.actions')}</Typography>
                            <Typography variant="caption" fontWeight={600} sx={{ opacity: 0.6, fontSize: 10, textAlign: 'center' }}><i className="ri-checkbox-circle-line" style={{ fontSize: 10 }} /></Typography>
                          </Box>
                          {groupItems.map((item: any, idx: number) => {
                            const dateStr = item.ctime
                              ? new Date(item.ctime * 1000).toLocaleString(dateLocale || 'en', {
                                  year: 'numeric', month: '2-digit', day: '2-digit',
                                  hour: '2-digit', minute: '2-digit',
                                })
                              : '-'
                            const encrypted = item.encrypted
                            const verifyOk = item.verification?.state === 'ok'
                            const itemIsVm = item.format === 'pbs-vm'
                            const itemIsCt = item.format === 'pbs-ct'

                            return (
                              <Box
                                key={item.volid || idx}
                                sx={{
                                  display: 'grid',
                                  gridTemplateColumns: '1fr 80px 30px 80px 30px',
                                  gap: 0.25, px: 1.5, pl: 5, py: 0.15,
                                  borderBottom: idx < groupItems.length - 1 ? '1px solid' : 'none',
                                  borderColor: 'divider',
                                  alignItems: 'center',
                                  '&:hover': { bgcolor: 'action.focus' },
                                  minHeight: 24,
                                }}
                              >
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                  <i className="ri-time-line" style={{ fontSize: 12, opacity: 0.5 }} />
                                  <Typography variant="body2" noWrap sx={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
                                    {dateStr}
                                  </Typography>
                                </Box>
                                <Typography variant="body2" sx={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', opacity: 0.7 }}>
                                  {item.size ? formatBytes(item.size) : '-'}
                                </Typography>
                                <Box sx={{ textAlign: 'center' }}>
                                  {encrypted ? (
                                    <MuiTooltip title={t('inventory.pbsEncryptedYes')}><i className="ri-lock-fill" style={{ fontSize: 12, color: '#ff9800' }} /></MuiTooltip>
                                  ) : (
                                    <i className="ri-lock-unlock-line" style={{ fontSize: 12, opacity: 0.15 }} />
                                  )}
                                </Box>
                                <Box sx={{ display: 'flex', justifyContent: 'center', gap: 0 }}>
                                  <MuiTooltip title={itemIsVm ? t('inventory.pbsRestoreVm') : itemIsCt ? t('inventory.pbsRestoreCt') : t('inventory.pbsRestoreVm')}>
                                    <IconButton size="small" sx={{ p: 0.15 }} onClick={() => pbsPanelRef.current?.openRestoreDialog(item, si)}>
                                      <i className="ri-inbox-unarchive-line" style={{ fontSize: 13, color: '#2196f3' }} />
                                    </IconButton>
                                  </MuiTooltip>
                                  <MuiTooltip title={t('inventory.pbsFileRestore')}>
                                    <IconButton size="small" sx={{ p: 0.15 }} onClick={() => pbsPanelRef.current?.openFileRestore(item, si)}>
                                      <i className="ri-folder-open-line" style={{ fontSize: 13, color: '#ff9800' }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </Box>
                                <Box sx={{ textAlign: 'center' }}>
                                  {verifyOk ? (
                                    <MuiTooltip title={t('inventory.pbsVerified')}><i className="ri-checkbox-circle-fill" style={{ fontSize: 12, color: '#4caf50' }} /></MuiTooltip>
                                  ) : (
                                    <i className="ri-checkbox-blank-circle-line" style={{ fontSize: 12, opacity: 0.15 }} />
                                  )}
                                </Box>
                              </Box>
                            )
                          })}
                        </Box>
                      )}
                    </Box>
                  )
                })}
              </Box>
            </CardContent>
          </Card>
        )
      })() : null}

      {/* Non-PBS content items grouped by type */}
      {(si.type !== 'pbs' || !groups['backup']?.items?.length) && (
        Object.keys(groups).length > 0 ? Object.entries(groups)
          .filter(([ct]) => si.type === 'pbs' ? ct !== 'backup' : true)
          .map(([contentType, group]) => (
            <StorageContentGroup
              key={contentType}
              group={group}
              formatBytes={formatBytes}
              vmNames={vmNamesMap}
              onUpload={['iso', 'snippets', 'vztmpl', 'import'].includes(contentType) ? () => setStorageUploadOpen(true) : undefined}
              onDownloadTemplate={contentType === 'vztmpl' ? () => setTemplateDialogOpen(true) : undefined}
              onDelete={async (volid: string) => {
                const res = await fetch(
                  `/api/v1/connections/${encodeURIComponent(si.connId)}/nodes/${encodeURIComponent(si.node)}/storage/${encodeURIComponent(si.storage)}/content/${encodeURIComponent(volid)}`,
                  { method: 'DELETE' }
                )
                if (!res.ok) {
                  const json = await res.json().catch(() => ({}))
                  throw new Error(json.error || `HTTP ${res.status}`)
                }
                // Refresh data
                if (selection) fetchDetails(selection).then(setData)
              }}
            />
          )) : (si.contentItems || []).length === 0 && (
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <CardContent sx={{ p: 3, textAlign: 'center' }}>
              <i className="ri-folder-open-line" style={{ fontSize: 36, opacity: 0.2 }} />
              <Typography variant="body2" sx={{ opacity: 0.5, mt: 1 }}>
                {t('inventory.storageEmpty')}
              </Typography>
            </CardContent>
          </Card>
        )
      )}

      {/* Upload dialog for storage content */}
      <UploadDialog
        open={storageUploadOpen}
        onClose={() => setStorageUploadOpen(false)}
        onOpen={() => setStorageUploadOpen(true)}
        connId={si.connId}
        node={si.node}
        storage={si.storage}
        contentTypes={si.content || []}
        onUploaded={() => {
          setStorageUploadOpen(false)
          if (selection) fetchDetails(selection).then(setData)
        }}
      />

      {/* Template download dialog */}
      {(si.content || []).includes('vztmpl') && (
        <TemplateDownloadDialog
          open={templateDialogOpen}
          onClose={() => setTemplateDialogOpen(false)}
          connId={si.connId}
          node={si.node}
          storage={si.storage}
          onDownloaded={() => {
            setTemplateDialogOpen(false)
            if (selection) fetchDetails(selection).then(setData)
          }}
        />
      )}
      </Box>
    </Box>
  )
}
