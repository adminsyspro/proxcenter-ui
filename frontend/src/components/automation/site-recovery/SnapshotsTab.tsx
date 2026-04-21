'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert, Box, Button, Card, CardContent, Checkbox, Chip, CircularProgress, Dialog,
  DialogActions, DialogContent, DialogTitle, Divider, Drawer, IconButton, InputAdornment,
  LinearProgress, MenuItem, Select, Stack, Table, TableBody, TableCell, TableHead, TablePagination, TableRow,
  TextField, Tooltip, Typography,
} from '@mui/material'

import EmptyState from '@/components/EmptyState'

interface MirrorSnapshot {
  cluster_id: string
  cluster_name: string
  pool: string
  image: string
  snapshot: string
  provisioned_bytes: number
  created_ts: number
  created_iso: string
  vmid?: number
  job_id?: string
  is_orphan: boolean
  side?: 'source' | 'target'
}

interface Connection {
  id: string
  name: string
}

interface Props {
  connections: Connection[]
  vmNameMap?: Record<number, string>
}

function formatBytes(b: number | undefined | null): string {
  if (!b || b <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(b) / Math.log(1024))
  return `${(b / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

function formatAge(ts: number): string {
  if (!ts) return '—'
  const diff = Math.floor(Date.now() / 1000 - ts)
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

export default function SnapshotsTab({ connections, vmNameMap }: Props) {
  const t = useTranslations()

  const [snaps, setSnaps] = useState<MirrorSnapshot[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [clusterFilter, setClusterFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'orphan' | 'active'>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [detail, setDetail] = useState<MirrorSnapshot | null>(null)
  const [detailUsage, setDetailUsage] = useState<{ used_bytes: number; provisioned_bytes: number } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<MirrorSnapshot[] | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(25)

  const key = (s: MirrorSnapshot) => `${s.cluster_id}::${s.pool}::${s.image}::${s.snapshot}`

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/v1/orchestrator/replication/snapshots', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setSnaps(Array.isArray(data) ? data : [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load snapshots')
      setSnaps([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase()
    return (snaps || []).filter(s => {
      if (clusterFilter !== 'all' && s.cluster_id !== clusterFilter) return false
      if (statusFilter === 'orphan' && !s.is_orphan) return false
      if (statusFilter === 'active' && s.is_orphan) return false
      if (!qq) return true
      return (
        s.cluster_name?.toLowerCase().includes(qq) ||
        s.pool?.toLowerCase().includes(qq) ||
        s.image?.toLowerCase().includes(qq) ||
        s.snapshot?.toLowerCase().includes(qq) ||
        String(s.vmid || '').includes(qq)
      )
    })
  }, [snaps, q, clusterFilter, statusFilter])

  // Reset page when filters change and current page would be out of range
  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(filtered.length / rowsPerPage) - 1)
    if (page > maxPage) setPage(0)
  }, [filtered.length, rowsPerPage, page])

  const paged = useMemo(
    () => filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [filtered, page, rowsPerPage]
  )

  const totals = useMemo(() => {
    const list = snaps || []
    return {
      all: list.length,
      orphans: list.filter(s => s.is_orphan).length,
      clusters: new Set(list.map(s => s.cluster_id)).size,
    }
  }, [snaps])

  const toggleSelect = (s: MirrorSnapshot) => {
    const k = key(s)
    setSelected(prev => {
      const next = new Set(prev)
      next.has(k) ? next.delete(k) : next.add(k)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selected.size === filtered.length) setSelected(new Set())
    else setSelected(new Set(filtered.map(key)))
  }

  const openDetail = useCallback(async (s: MirrorSnapshot) => {
    setDetail(s)
    setDetailUsage(null)
    setDetailLoading(true)
    try {
      const params = new URLSearchParams({ cluster: s.cluster_id, pool: s.pool, image: s.image, snap: s.snapshot })
      const res = await fetch(`/api/v1/orchestrator/replication/snapshots/usage?${params.toString()}`, { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setDetailUsage({ used_bytes: data.used_bytes, provisioned_bytes: data.provisioned_bytes })
      }
    } catch { /* ignore — drawer just shows "—" */ } finally {
      setDetailLoading(false)
    }
  }, [])

  const runDelete = useCallback(async (items: MirrorSnapshot[]) => {
    setDeleting(true)
    try {
      const res = await fetch('/api/v1/orchestrator/replication/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map(s => ({
            cluster_id: s.cluster_id, pool: s.pool, image: s.image, snapshot: s.snapshot,
          })),
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setSelected(new Set())
      await load()
    } catch (e: any) {
      setError(e?.message || 'Delete failed')
    } finally {
      setDeleting(false)
      setConfirmDelete(null)
    }
  }, [load])

  const cephConnections = useMemo(() => connections, [connections])
  const connName = (id: string) => cephConnections.find(c => c.id === id)?.name || id

  const selectedList = useMemo(
    () => (snaps || []).filter(s => selected.has(key(s))),
    [snaps, selected]
  )
  const orphansInView = useMemo(() => filtered.filter(s => s.is_orphan), [filtered])

  return (
    <Box>
      {/* KPI bar */}
      <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Card variant='outlined' sx={{ flex: 1, minWidth: 140 }}>
          <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
            <Typography variant='caption' color='text.secondary'>{t('siteRecovery.snapshots.totalSnaps')}</Typography>
            <Typography variant='h5' fontWeight={700}>{totals.all}</Typography>
          </CardContent>
        </Card>
        <Card variant='outlined' sx={{ flex: 1, minWidth: 140, borderColor: totals.orphans > 0 ? 'warning.main' : 'divider' }}>
          <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
            <Typography variant='caption' color='text.secondary'>{t('siteRecovery.snapshots.orphans')}</Typography>
            <Typography variant='h5' fontWeight={700} color={totals.orphans > 0 ? 'warning.main' : 'text.primary'}>{totals.orphans}</Typography>
          </CardContent>
        </Card>
        <Card variant='outlined' sx={{ flex: 1, minWidth: 140 }}>
          <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
            <Typography variant='caption' color='text.secondary'>{t('siteRecovery.snapshots.clusters')}</Typography>
            <Typography variant='h5' fontWeight={700}>{totals.clusters}</Typography>
          </CardContent>
        </Card>
      </Box>

      {/* Filter bar + actions */}
      <Card variant='outlined' sx={{ borderRadius: 2, mb: 2 }}>
        <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={t('siteRecovery.snapshots.searchPlaceholder')}
              size='small'
              sx={{ flex: 1, minWidth: 220 }}
              InputProps={{ startAdornment: <InputAdornment position='start'><i className='ri-search-line' style={{ opacity: 0.5 }} /></InputAdornment> }}
            />
            <Select value={clusterFilter} onChange={e => setClusterFilter(e.target.value)} size='small' sx={{ minWidth: 160 }}>
              <MenuItem value='all'>{t('siteRecovery.snapshots.allClusters')}</MenuItem>
              {cephConnections.map(c => (
                <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
              ))}
            </Select>
            <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} size='small' sx={{ minWidth: 140 }}>
              <MenuItem value='all'>{t('siteRecovery.snapshots.allStatuses')}</MenuItem>
              <MenuItem value='active'>{t('siteRecovery.snapshots.activeJobs')}</MenuItem>
              <MenuItem value='orphan'>{t('siteRecovery.snapshots.orphansOnly')}</MenuItem>
            </Select>
            <Button size='small' startIcon={<i className='ri-refresh-line' />} onClick={load} disabled={loading}>
              {t('common.refresh')}
            </Button>
            {selectedList.length > 0 && (
              <Button
                size='small' variant='contained' color='error'
                startIcon={<i className='ri-delete-bin-line' />}
                onClick={() => setConfirmDelete(selectedList)}
                disabled={deleting}
              >
                {t('siteRecovery.snapshots.deleteSelected', { count: selectedList.length })}
              </Button>
            )}
            {selectedList.length === 0 && orphansInView.length > 0 && (
              <Tooltip title={t('siteRecovery.snapshots.cleanupOrphansHint')} arrow>
                <Button
                  size='small' variant='outlined' color='warning'
                  startIcon={<i className='ri-sparkling-line' />}
                  onClick={() => setConfirmDelete(orphansInView)}
                  disabled={deleting}
                >
                  {t('siteRecovery.snapshots.cleanupOrphans', { count: orphansInView.length })}
                </Button>
              </Tooltip>
            )}
          </Box>
        </CardContent>
      </Card>

      {error && <Alert severity='error' sx={{ mb: 2 }}>{error}</Alert>}

      {loading && !snaps && <LinearProgress sx={{ mb: 2 }} />}

      {/* Snapshots table */}
      <Card variant='outlined' sx={{ borderRadius: 2 }}>
        {filtered.length === 0 && !loading ? (
          <Box sx={{ p: 3 }}>
            <EmptyState
              icon='ri-camera-line'
              title={t('siteRecovery.snapshots.none')}
              description={(snaps || []).length === 0 ? t('siteRecovery.snapshots.noneDesc') : t('siteRecovery.snapshots.noneMatchingDesc')}
              size='medium'
            />
          </Box>
        ) : (
          <Table size='small'>
            <TableHead>
              <TableRow>
                <TableCell padding='checkbox'>
                  <Checkbox
                    size='small'
                    indeterminate={selected.size > 0 && selected.size < filtered.length}
                    checked={filtered.length > 0 && selected.size === filtered.length}
                    onChange={toggleSelectAll}
                  />
                </TableCell>
                <TableCell>{t('siteRecovery.snapshots.cluster')}</TableCell>
                <TableCell>{t('siteRecovery.snapshots.pool')}</TableCell>
                <TableCell>{t('siteRecovery.snapshots.image')}</TableCell>
                <TableCell>{t('siteRecovery.snapshots.vm')}</TableCell>
                <TableCell>{t('siteRecovery.snapshots.snapshot')}</TableCell>
                <TableCell align='right'>{t('siteRecovery.snapshots.age')}</TableCell>
                <TableCell align='right'>{t('siteRecovery.snapshots.imageSize')}</TableCell>
                <TableCell>{t('siteRecovery.snapshots.status')}</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {paged.map(s => {
                const k = key(s)
                const vmName = s.vmid ? vmNameMap?.[s.vmid] : undefined
                return (
                  <TableRow key={k} hover selected={selected.has(k)}>
                    <TableCell padding='checkbox'>
                      <Checkbox size='small' checked={selected.has(k)} onChange={() => toggleSelect(s)} />
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <i className='ri-server-line' style={{ fontSize: 14, opacity: 0.7 }} />
                        <span>{s.cluster_name || connName(s.cluster_id)}</span>
                      </Box>
                    </TableCell>
                    <TableCell>{s.pool}</TableCell>
                    <TableCell>{s.image}</TableCell>
                    <TableCell>
                      {s.vmid ? (vmName ? `${s.vmid} · ${vmName}` : s.vmid) : '—'}
                    </TableCell>
                    <TableCell sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.75rem' }}>{s.snapshot}</TableCell>
                    <TableCell align='right'>{formatAge(s.created_ts)}</TableCell>
                    <TableCell align='right'>{formatBytes(s.provisioned_bytes)}</TableCell>
                    <TableCell>
                      {s.is_orphan ? (
                        <Chip label={t('siteRecovery.snapshots.orphan')} size='small' color='warning' sx={{ height: 20, fontSize: '0.65rem' }} />
                      ) : (
                        <Chip
                          label={s.side === 'source' ? t('siteRecovery.snapshots.activeSource') : s.side === 'target' ? t('siteRecovery.snapshots.activeTarget') : t('siteRecovery.snapshots.active')}
                          size='small' color='success' variant='outlined' sx={{ height: 20, fontSize: '0.65rem' }}
                        />
                      )}
                    </TableCell>
                    <TableCell align='right'>
                      <Box sx={{ display: 'flex', gap: 0.25, justifyContent: 'flex-end' }}>
                        <Tooltip title={t('siteRecovery.snapshots.viewDetails')} arrow>
                          <IconButton size='small' onClick={() => openDetail(s)} sx={{ p: 0.5 }}>
                            <i className='ri-information-line' style={{ fontSize: 14 }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t('common.delete')} arrow>
                          <IconButton size='small' color='error' onClick={() => setConfirmDelete([s])} sx={{ p: 0.5 }}>
                            <i className='ri-delete-bin-line' style={{ fontSize: 14 }} />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
        {filtered.length > 0 && (
          <TablePagination
            component='div'
            count={filtered.length}
            page={page}
            onPageChange={(_, p) => setPage(p)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={e => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0) }}
            rowsPerPageOptions={[10, 25, 50, 100]}
          />
        )}
      </Card>

      {/* Detail drawer */}
      <Drawer anchor='right' open={!!detail} onClose={() => setDetail(null)} PaperProps={{ sx: { width: { xs: '100%', sm: 420 } } }}>
        {detail && (
          <Box sx={{ p: 2.5 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
              <Box>
                <Typography variant='overline' color='text.secondary'>{t('siteRecovery.snapshots.title')}</Typography>
                <Typography variant='h6' fontWeight={700} sx={{ fontFamily: 'monospace', fontSize: '0.95rem' }}>{detail.snapshot}</Typography>
              </Box>
              <IconButton size='small' onClick={() => setDetail(null)}><i className='ri-close-line' /></IconButton>
            </Box>

            <Stack spacing={1.25}>
              <Box>
                <Typography variant='caption' color='text.secondary'>{t('siteRecovery.snapshots.cluster')}</Typography>
                <Typography variant='body2' fontWeight={600}>{detail.cluster_name || connName(detail.cluster_id)}</Typography>
              </Box>
              <Box>
                <Typography variant='caption' color='text.secondary'>{t('siteRecovery.snapshots.image')}</Typography>
                <Typography variant='body2' sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{detail.pool}/{detail.image}</Typography>
              </Box>
              {detail.vmid && (
                <Box>
                  <Typography variant='caption' color='text.secondary'>{t('siteRecovery.snapshots.vm')}</Typography>
                  <Typography variant='body2'>{detail.vmid}{vmNameMap?.[detail.vmid] ? ` · ${vmNameMap[detail.vmid]}` : ''}</Typography>
                </Box>
              )}
              <Box>
                <Typography variant='caption' color='text.secondary'>{t('siteRecovery.snapshots.created')}</Typography>
                <Typography variant='body2' sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                  {detail.created_ts ? `${new Date(detail.created_ts * 1000).toLocaleString()} (${formatAge(detail.created_ts)})` : '—'}
                </Typography>
              </Box>

              <Divider />

              <Box>
                <Typography variant='caption' color='text.secondary'>{t('siteRecovery.snapshots.imageSize')}</Typography>
                <Typography variant='body2' fontWeight={600}>{formatBytes(detail.provisioned_bytes)}</Typography>
              </Box>

              <Box>
                <Typography variant='caption' color='text.secondary'>{t('siteRecovery.snapshots.cowUsed')}</Typography>
                {detailLoading ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CircularProgress size={14} />
                    <Typography variant='caption' color='text.secondary'>{t('siteRecovery.snapshots.computing')}</Typography>
                  </Box>
                ) : detailUsage ? (
                  <Typography variant='body2' fontWeight={600} color='primary.main'>{formatBytes(detailUsage.used_bytes)}</Typography>
                ) : (
                  <Typography variant='body2' color='text.secondary'>—</Typography>
                )}
              </Box>

              <Divider />

              <Box>
                <Typography variant='caption' color='text.secondary'>{t('siteRecovery.snapshots.status')}</Typography>
                <Box sx={{ mt: 0.5 }}>
                  {detail.is_orphan ? (
                    <Chip label={t('siteRecovery.snapshots.orphan')} size='small' color='warning' />
                  ) : (
                    <Chip
                      label={detail.side === 'source' ? t('siteRecovery.snapshots.activeSource') : detail.side === 'target' ? t('siteRecovery.snapshots.activeTarget') : t('siteRecovery.snapshots.active')}
                      size='small' color='success' variant='outlined'
                    />
                  )}
                </Box>
                {detail.job_id && (
                  <Typography variant='caption' sx={{ color: 'text.secondary', display: 'block', mt: 0.5, fontFamily: 'monospace', fontSize: '0.65rem' }}>
                    job: {detail.job_id}
                  </Typography>
                )}
              </Box>

              <Box sx={{ pt: 1 }}>
                <Button
                  fullWidth variant='outlined' color='error'
                  startIcon={<i className='ri-delete-bin-line' />}
                  onClick={() => { setConfirmDelete([detail]); setDetail(null) }}
                >
                  {t('common.delete')}
                </Button>
              </Box>
            </Stack>
          </Box>
        )}
      </Drawer>

      {/* Confirm delete dialog */}
      <Dialog open={!!confirmDelete} onClose={() => !deleting && setConfirmDelete(null)} maxWidth='sm' fullWidth>
        <DialogTitle>{t('siteRecovery.snapshots.confirmDeleteTitle')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ py: 2 }}>
            <Alert severity='warning' sx={{ py: 1.5 }}>
              {t('siteRecovery.snapshots.confirmDeleteDesc', { count: confirmDelete?.length || 0 })}
            </Alert>
            {confirmDelete && confirmDelete.some(s => !s.is_orphan) && (
              <Alert severity='error' sx={{ py: 1.5 }}>
                {t('siteRecovery.snapshots.confirmDeleteActiveWarn')}
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(null)} disabled={deleting}>{t('common.cancel')}</Button>
          <Button
            variant='contained' color='error' onClick={() => confirmDelete && runDelete(confirmDelete)}
            disabled={deleting}
            startIcon={deleting ? <CircularProgress size={14} /> : <i className='ri-delete-bin-line' />}
          >
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
