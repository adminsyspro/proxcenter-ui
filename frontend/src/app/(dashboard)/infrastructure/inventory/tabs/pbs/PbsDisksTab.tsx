'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  LinearProgress,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from '@mui/material'
import PbsStatusChip from './PbsStatusChip'
import { formatBytes } from '@/utils/format'

interface PbsDisksTabProps {
  pbsId: string
}

type PbsDisk = {
  name?: string
  'dev-path'?: string
  devpath?: string
  model?: string
  serial?: string
  size?: number
  used?: 'filesystem' | 'partitions' | 'zfs' | 'lvm' | 'unused' | string
  health?: string
  wearout?: number | string
  vendor?: string
  rpm?: number
  type?: 'hdd' | 'ssd' | 'nvme' | string
}

type PbsDirectory = {
  name?: string
  device?: string
  filesystem?: string
  path?: string
  mountpoint?: string
  'mount-point'?: string
  unitfile?: string
}

type PbsZfsPool = {
  name?: string
  size?: number
  alloc?: number
  free?: number
  dedup?: number | string
  frag?: number | string
  health?: string
}

export default function PbsDisksTab({ pbsId }: PbsDisksTabProps) {
  const t = useTranslations()

  const [subTab, setSubTab] = useState<number>(0)

  const [disks, setDisks] = useState<PbsDisk[]>([])
  const [dirs, setDirs] = useState<PbsDirectory[]>([])
  const [zfs, setZfs] = useState<PbsZfsPool[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [dRes, diRes, zRes] = await Promise.all([
        fetch(`/api/v1/pbs/${pbsId}/disks`, { cache: 'no-store' }),
        fetch(`/api/v1/pbs/${pbsId}/disks/directory`, { cache: 'no-store' }),
        fetch(`/api/v1/pbs/${pbsId}/disks/zfs`, { cache: 'no-store' }),
      ])

      for (const r of [dRes, diRes, zRes]) {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body?.error || `HTTP ${r.status}`)
        }
      }

      const [dBody, diBody, zBody] = await Promise.all([dRes.json(), diRes.json(), zRes.json()])

      setDisks(Array.isArray(dBody?.data) ? dBody.data : [])
      setDirs(Array.isArray(diBody?.data) ? diBody.data : [])
      setZfs(Array.isArray(zBody?.data) ? zBody.data : [])
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [pbsId])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  const typeChip = (type: string | undefined) => {
    if (type === 'nvme') {
      return <PbsStatusChip color="success" label={t('inventory.pbsDisksTypeNvme')} sx={{ fontSize: 11 }} />
    }
    if (type === 'ssd') {
      return <PbsStatusChip color="primary" label={t('inventory.pbsDisksTypeSsd')} sx={{ fontSize: 11 }} />
    }
    if (type === 'hdd') {
      return <Chip size="small" label={t('inventory.pbsDisksTypeHdd')} sx={{ fontSize: 11 }} />
    }
    return <Chip size="small" label={type || '—'} variant="outlined" sx={{ fontSize: 11 }} />
  }

  const usageChip = (used: string | undefined) => {
    if (!used) return <Typography variant="caption" sx={{ opacity: 0.6 }}>—</Typography>

    const labelMap: Record<string, string> = {
      filesystem: t('inventory.pbsDisksUsageFilesystem'),
      partitions: t('inventory.pbsDisksUsagePartitions'),
      zfs: t('inventory.pbsDisksUsageZfs'),
      lvm: t('inventory.pbsDisksUsageLvm'),
      unused: t('inventory.pbsDisksUsageUnused'),
    }
    const colorMap: Record<string, any> = {
      filesystem: 'primary',
      partitions: 'warning',
      zfs: 'success',
      lvm: 'info',
      unused: 'default',
    }

    return (
      <Chip
        size="small"
        color={colorMap[used] || 'default'}
        variant={used === 'unused' ? 'outlined' : 'filled'}
        label={labelMap[used] || used}
        sx={{ fontSize: 11 }}
      />
    )
  }

  const healthChip = (health: string | undefined) => {
    if (!health) return <Typography variant="caption" sx={{ opacity: 0.6 }}>—</Typography>
    const upper = health.toUpperCase()
    if (upper === 'PASSED') {
      return <PbsStatusChip color="success" label={t('inventory.pbsDisksHealthPassed')} sx={{ fontSize: 11 }} />
    }
    if (upper === 'UNKNOWN') {
      return <Chip size="small" label={t('inventory.pbsDisksHealthUnknown')} variant="outlined" sx={{ fontSize: 11 }} />
    }
    return <PbsStatusChip color="error" label={health} sx={{ fontSize: 11 }} />
  }

  const wearoutBar = (wearout: number | string | undefined, type: string | undefined) => {
    if (type === 'hdd') return <Typography variant="caption" sx={{ opacity: 0.6 }}>—</Typography>
    if (wearout === undefined || wearout === null || wearout === '') {
      return <Typography variant="caption" sx={{ opacity: 0.6 }}>—</Typography>
    }
    const n = typeof wearout === 'string' ? Number(wearout) : wearout
    if (!Number.isFinite(n)) return <Typography variant="caption" sx={{ opacity: 0.6 }}>—</Typography>

    const pct = Math.max(0, Math.min(100, n as number))
    const color: 'success' | 'warning' | 'error' = pct < 50 ? 'success' : pct < 80 ? 'warning' : 'error'

    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 120 }}>
        <LinearProgress
          variant="determinate"
          value={pct}
          color={color}
          sx={{ flex: 1, height: 6, borderRadius: 1 }}
        />
        <Typography variant="caption" sx={{ minWidth: 32, textAlign: 'right' }}>
          {pct.toFixed(0)}%
        </Typography>
      </Box>
    )
  }

  // Empty state renderer
  const emptyState = (icon: string, title: string, hint?: string) => (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
        py: 6,
        opacity: 0.7,
        gap: 1.5,
      }}
    >
      <i className={icon} style={{ fontSize: 64 }} />
      <Typography variant="h6" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      {hint && (
        <Typography variant="body2" sx={{ opacity: 0.8 }}>
          {hint}
        </Typography>
      )}
    </Box>
  )

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
      {/* Toolbar */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
          flexWrap: 'wrap',
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <Button
            variant="outlined"
            size="small"
            onClick={fetchAll}
            disabled={loading}
            startIcon={<i className="ri-refresh-line" style={{ fontSize: 16 }} />}
          >
            {t('inventory.pbsDisksRefresh')}
          </Button>
        </Stack>
      </Box>

      {/* Sub-tabs */}
      <Tabs
        value={subTab}
        onChange={(_e, v) => setSubTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{
          borderBottom: 1,
          borderColor: 'divider',
          minHeight: 36,
          '& .MuiTab-root': { minHeight: 36, py: 0, textTransform: 'none' },
        }}
      >
        <Tab
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <i className="ri-hard-drive-2-line" style={{ fontSize: 15 }} />
              {t('inventory.pbsDisksTab')}
            </Box>
          }
        />
        <Tab
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <i className="ri-folder-line" style={{ fontSize: 15 }} />
              {t('inventory.pbsDisksDirectoryTab')}
            </Box>
          }
        />
        <Tab
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <i className="ri-stack-line" style={{ fontSize: 15 }} />
              {t('inventory.pbsDisksZfsTab')}
            </Box>
          }
        />
      </Tabs>

      {/* Content */}
      {loading && disks.length === 0 && dirs.length === 0 && zfs.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, py: 6 }}>
          <CircularProgress size={32} />
        </Box>
      ) : error ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={fetchAll}>
              {t('inventory.pbsDisksRefresh')}
            </Button>
          }
        >
          {t('inventory.pbsDisksLoadError')}: {error}
        </Alert>
      ) : (
        <>
          {/* Disks */}
          {subTab === 0 && (
            disks.length === 0 ? (
              emptyState('ri-hard-drive-2-line', t('inventory.pbsDisksEmpty'))
            ) : (
              <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('inventory.pbsDisksCol.device')}</TableCell>
                      <TableCell>{t('inventory.pbsDisksCol.type')}</TableCell>
                      <TableCell>{t('inventory.pbsDisksCol.size')}</TableCell>
                      <TableCell>{t('inventory.pbsDisksCol.model')}</TableCell>
                      <TableCell>{t('inventory.pbsDisksCol.serial')}</TableCell>
                      <TableCell>{t('inventory.pbsDisksCol.vendor')}</TableCell>
                      <TableCell>{t('inventory.pbsDisksCol.health')}</TableCell>
                      <TableCell>{t('inventory.pbsDisksCol.wearout')}</TableCell>
                      <TableCell>{t('inventory.pbsDisksCol.usage')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {disks.map((d, idx) => {
                      const devPath = d['dev-path'] || d.devpath || d.name || '—'
                      return (
                        <TableRow key={d.name || `disk-${idx}`} hover>
                          <TableCell sx={{ fontSize: 12 }}>
                            <Typography variant="caption" sx={{ fontWeight: 600 }}>
                              {devPath}
                            </Typography>
                          </TableCell>
                          <TableCell sx={{ fontSize: 12 }}>{typeChip(d.type)}</TableCell>
                          <TableCell sx={{ fontSize: 12 }}>
                            <Typography variant="caption">
                              {typeof d.size === 'number' && d.size > 0 ? formatBytes(d.size) : '—'}
                            </Typography>
                          </TableCell>
                          <TableCell sx={{ fontSize: 12, maxWidth: 220 }}>
                            <Typography
                              variant="caption"
                              sx={{
                                display: 'block',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {d.model || '—'}
                            </Typography>
                          </TableCell>
                          <TableCell sx={{ fontSize: 12, maxWidth: 180 }}>
                            <Typography
                              variant="caption"
                              sx={{
                                display: 'block',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {d.serial || '—'}
                            </Typography>
                          </TableCell>
                          <TableCell sx={{ fontSize: 12 }}>
                            <Typography variant="caption">{d.vendor || '—'}</Typography>
                          </TableCell>
                          <TableCell sx={{ fontSize: 12 }}>{healthChip(d.health)}</TableCell>
                          <TableCell sx={{ fontSize: 12 }}>{wearoutBar(d.wearout, d.type)}</TableCell>
                          <TableCell sx={{ fontSize: 12 }}>{usageChip(d.used)}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )
          )}

          {/* Directory */}
          {subTab === 1 && (
            dirs.length === 0 ? (
              emptyState(
                'ri-folder-line',
                t('inventory.pbsDisksDirEmpty'),
                t('inventory.pbsDisksDirEmptyHint')
              )
            ) : (
              <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('inventory.pbsDisksDirCol.name')}</TableCell>
                      <TableCell>{t('inventory.pbsDisksDirCol.device')}</TableCell>
                      <TableCell>{t('inventory.pbsDisksDirCol.filesystem')}</TableCell>
                      <TableCell>{t('inventory.pbsDisksDirCol.mountPoint')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {dirs.map((dir, idx) => {
                      const mp = dir.path || dir.mountpoint || dir['mount-point'] || '—'
                      return (
                        <TableRow key={dir.name || `dir-${idx}`} hover>
                          <TableCell sx={{ fontSize: 12 }}>
                            <Typography variant="caption" sx={{ fontWeight: 600 }}>
                              {dir.name || '—'}
                            </Typography>
                          </TableCell>
                          <TableCell sx={{ fontSize: 12 }}>
                            <Typography variant="caption">{dir.device || '—'}</Typography>
                          </TableCell>
                          <TableCell sx={{ fontSize: 12 }}>
                            <Typography variant="caption">{dir.filesystem || '—'}</Typography>
                          </TableCell>
                          <TableCell sx={{ fontSize: 12 }}>
                            <Typography variant="caption">{mp}</Typography>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )
          )}

          {/* ZFS */}
          {subTab === 2 && (
            zfs.length === 0 ? (
              emptyState(
                'ri-stack-line',
                t('inventory.pbsDisksZfsEmpty'),
                t('inventory.pbsDisksZfsEmptyHint')
              )
            ) : (
              <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('inventory.pbsDisksZfsCol.pool')}</TableCell>
                      <TableCell>{t('inventory.pbsDisksZfsCol.size')}</TableCell>
                      <TableCell>{t('inventory.pbsDisksZfsCol.alloc')}</TableCell>
                      <TableCell>{t('inventory.pbsDisksZfsCol.free')}</TableCell>
                      <TableCell>{t('inventory.pbsDisksZfsCol.dedup')}</TableCell>
                      <TableCell>{t('inventory.pbsDisksZfsCol.frag')}</TableCell>
                      <TableCell>{t('inventory.pbsDisksZfsCol.health')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {zfs.map((p, idx) => (
                      <TableRow key={p.name || `zfs-${idx}`} hover>
                        <TableCell sx={{ fontSize: 12 }}>
                          <Typography variant="caption" sx={{ fontWeight: 600 }}>
                            {p.name || '—'}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ fontSize: 12 }}>
                          <Typography variant="caption">
                            {typeof p.size === 'number' && p.size > 0 ? formatBytes(p.size) : '—'}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ fontSize: 12 }}>
                          <Typography variant="caption">
                            {typeof p.alloc === 'number' && p.alloc > 0 ? formatBytes(p.alloc) : '—'}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ fontSize: 12 }}>
                          <Typography variant="caption">
                            {typeof p.free === 'number' && p.free > 0 ? formatBytes(p.free) : '—'}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ fontSize: 12 }}>
                          <Typography variant="caption">
                            {p.dedup !== undefined && p.dedup !== '' ? String(p.dedup) : '—'}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ fontSize: 12 }}>
                          <Typography variant="caption">
                            {p.frag !== undefined && p.frag !== '' ? String(p.frag) : '—'}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ fontSize: 12 }}>{healthChip(p.health)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )
          )}
        </>
      )}
    </Box>
  )
}
