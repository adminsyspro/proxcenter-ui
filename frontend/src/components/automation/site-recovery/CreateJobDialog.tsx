'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import useSWR from 'swr'

import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, InputAdornment, MenuItem, Select, Stack,
  TextField, Typography
} from '@mui/material'

import { tagColor } from '@/app/(dashboard)/infrastructure/inventory/helpers'
import type { CreateReplicationJobRequest } from '@/lib/orchestrator/site-recovery.types'

// ── Types ───────────────────────────────────────────────────────────────

interface Connection {
  id: string
  name: string
  hasCeph: boolean
}

interface VM {
  vmid: number
  name: string
  node: string
  connId: string
  type: string
  status: string
  tags: string[]
}

interface CreateJobDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: CreateReplicationJobRequest) => void
  connections: Connection[]
  allVMs: VM[]
}

// ── Fetcher ─────────────────────────────────────────────────────────────

const fetcher = (url: string) => fetch(url).then(res => {
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
})

// ── Main Component ─────────────────────────────────────────────────────

export default function CreateJobDialog({ open, onClose, onSubmit, connections, allVMs }: CreateJobDialogProps) {
  const t = useTranslations()

  const [sourceCluster, setSourceCluster] = useState('')
  const [selectedVMs, setSelectedVMs] = useState<number[]>([])
  const [targetCluster, setTargetCluster] = useState('')
  const [targetPool, setTargetPool] = useState('')
  const [schedule, setSchedule] = useState('*/15 * * * *')
  const [rpoTarget, setRpoTarget] = useState(900)
  const [vmSearch, setVmSearch] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)

  // SSH connectivity check state
  const [sshCheck, setSshCheck] = useState<'idle' | 'checking' | 'success' | 'failed'>('idle')
  const [sshError, setSshError] = useState('')
  const [sshSourceNode, setSshSourceNode] = useState('')
  const [sshTargetIP, setSshTargetIP] = useState('')

  // Auto-trigger SSH check when both clusters are selected
  const runSSHCheck = useCallback(async (src: string, tgt: string) => {
    if (!src || !tgt) {
      setSshCheck('idle')
      setSshError('')
      return
    }

    setSshCheck('checking')
    setSshError('')

    try {
      const res = await fetch('/api/v1/orchestrator/replication/check-ssh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_cluster: src, target_cluster: tgt })
      })
      const data = await res.json()

      if (data.connected) {
        setSshCheck('success')
        setSshSourceNode(data.source_node || '')
        setSshTargetIP(data.target_ip || '')
      } else {
        setSshCheck('failed')
        setSshError(data.error || 'Unknown error')
      }
    } catch {
      setSshCheck('failed')
      setSshError('Failed to reach orchestrator')
    }
  }, [])

  useEffect(() => {
    runSSHCheck(sourceCluster, targetCluster)
  }, [sourceCluster, targetCluster, runSSHCheck])

  // Only Ceph-enabled connections can be source/target
  const cephConnections = useMemo(() =>
    connections.filter(c => c.hasCeph)
  , [connections])

  // Target clusters exclude the source cluster
  const targetConnections = useMemo(() =>
    cephConnections.filter(c => c.id !== sourceCluster)
  , [cephConnections, sourceCluster])

  // VMs filtered by source cluster (only running qemu VMs)
  const sourceVMs = useMemo(() =>
    allVMs.filter(vm =>
      vm.connId === sourceCluster &&
      vm.status === 'running' &&
      vm.type === 'qemu'
    )
  , [allVMs, sourceCluster])

  // Collect all unique tags from source VMs
  const allTags = useMemo(() => {
    const tags = new Set<string>()
    sourceVMs.forEach(vm => vm.tags?.forEach(t => tags.add(t)))
    return Array.from(tags).sort()
  }, [sourceVMs])

  // Search + tag filter on source VMs
  const filteredVMs = useMemo(() =>
    sourceVMs.filter(v => {
      if (tagFilter && (!v.tags || !v.tags.includes(tagFilter))) return false
      if (!vmSearch) return true
      return v.name.toLowerCase().includes(vmSearch.toLowerCase()) || String(v.vmid).includes(vmSearch)
    })
  , [sourceVMs, vmSearch, tagFilter])

  // Fetch Ceph pools for the selected target cluster
  const { data: cephData, isLoading: cephLoading } = useSWR(
    targetCluster ? `/api/v1/connections/${targetCluster}/ceph` : null,
    fetcher
  )

  // Filter out internal Ceph pools (.mgr, .rgw.root, device_health_metrics, etc.)
  const cephPools = useMemo(() =>
    (cephData?.data?.pools?.list || []).filter((p: any) =>
      !p.name.startsWith('.') && p.name !== 'device_health_metrics'
    )
  , [cephData])

  // ── Presets ───────────────────────────────────────────────────────────

  const schedulePresets = [
    { value: '* * * * *', label: t('siteRecovery.createJob.continuous') },
    { value: '*/5 * * * *', label: t('siteRecovery.createJob.every5min') },
    { value: '*/15 * * * *', label: t('siteRecovery.createJob.every15min') },
    { value: '*/30 * * * *', label: t('siteRecovery.createJob.every30min') },
    { value: '0 * * * *', label: t('siteRecovery.createJob.everyHour') },
    { value: '0 */6 * * *', label: t('siteRecovery.createJob.every6hours') },
    { value: '0 0 * * *', label: t('siteRecovery.createJob.daily') },
  ]

  const rpoPresets = [
    { value: 30, label: '30s' },
    { value: 60, label: '1m' },
    { value: 300, label: '5m' },
    { value: 900, label: '15m' },
    { value: 3600, label: '1h' },
    { value: 86400, label: '24h' },
  ]

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleSourceClusterChange = (value: string) => {
    setSourceCluster(value)
    setSelectedVMs([])
    setTargetCluster('')
    setTargetPool('')
    setSshCheck('idle')
    setSshError('')
    setTagFilter(null)
    setVmSearch('')
  }

  const handleTargetClusterChange = (value: string) => {
    setTargetCluster(value)
    setTargetPool('')
    setSshCheck('idle')
    setSshError('')
  }

  const toggleVM = (vmid: number) => {
    setSelectedVMs(prev => prev.includes(vmid) ? prev.filter(id => id !== vmid) : [...prev, vmid])
  }

  const handleSubmit = () => {
    onSubmit({
      vm_ids: selectedVMs,
      source_cluster: sourceCluster,
      target_cluster: targetCluster,
      target_pool: targetPool,
      schedule,
      rpo_target: rpoTarget,
      rate_limit_mbps: 0,
      network_mapping: {}
    })
    handleClose()
  }

  const handleClose = () => {
    setSourceCluster('')
    setSelectedVMs([])
    setTargetCluster('')
    setTargetPool('')
    setSchedule('*/15 * * * *')
    setRpoTarget(900)
    setVmSearch('')
    setTagFilter(null)
    setSshCheck('idle')
    setSshError('')
    onClose()
  }

  const canSubmit = sourceCluster && selectedVMs.length > 0 && targetCluster && targetPool && sshCheck === 'success'

  return (
    <Dialog open={open} onClose={handleClose} maxWidth='sm' fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{t('siteRecovery.createJob.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          {/* Source Cluster */}
          <Box>
            <Typography variant='subtitle2' sx={{ mb: 0.5 }}>{t('siteRecovery.createJob.sourceCluster')}</Typography>
            <Select value={sourceCluster} onChange={e => handleSourceClusterChange(e.target.value)} size='small' fullWidth displayEmpty>
              <MenuItem value='' disabled>{t('siteRecovery.createJob.selectCluster')}</MenuItem>
              {cephConnections.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </Select>
          </Box>

          {/* VM Selection (only shown after source cluster is selected) */}
          {sourceCluster && (
            <Box>
              <Typography variant='subtitle2' sx={{ mb: 1 }}>{t('siteRecovery.createJob.selectVMs')}</Typography>

              {/* Tag filter chips — clicking a tag filters AND selects matching VMs */}
              {allTags.length > 0 && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
                  {allTags.map(tag => (
                    <Chip
                      key={tag}
                      label={tag}
                      size='small'
                      onClick={() => {
                        if (tagFilter === tag) {
                          // Deactivate filter
                          setTagFilter(null)
                        } else {
                          // Activate filter and select all VMs with this tag
                          setTagFilter(tag)
                          const tagVMIds = sourceVMs.filter(v => v.tags?.includes(tag)).map(v => v.vmid)
                          setSelectedVMs(prev => [...new Set([...prev, ...tagVMIds])])
                        }
                      }}
                      variant={tagFilter === tag ? 'filled' : 'outlined'}
                      sx={{
                        bgcolor: tagFilter === tag ? tagColor(tag) : 'transparent',
                        color: tagFilter === tag ? '#fff' : tagColor(tag),
                        borderColor: tagColor(tag),
                        fontWeight: 500,
                        fontSize: '0.7rem',
                        height: 24,
                        cursor: 'pointer',
                      }}
                    />
                  ))}
                </Box>
              )}

              <TextField
                value={vmSearch}
                onChange={e => setVmSearch(e.target.value)}
                placeholder={t('siteRecovery.createJob.searchVMs')}
                size='small'
                fullWidth
                sx={{ mb: 1 }}
                InputProps={{ startAdornment: <InputAdornment position='start'><i className='ri-search-line' style={{ opacity: 0.5 }} /></InputAdornment> }}
              />

              <Box sx={{ maxHeight: 200, overflow: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 0.5 }}>
                {filteredVMs.length === 0 ? (
                  <Typography variant='caption' sx={{ p: 1, color: 'text.secondary' }}>{t('siteRecovery.createJob.noVMs')}</Typography>
                ) : (
                  filteredVMs.map(vm => (
                    <FormControlLabel
                      key={vm.vmid}
                      control={<Checkbox size='small' checked={selectedVMs.includes(vm.vmid)} onChange={() => toggleVM(vm.vmid)} />}
                      label={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                          <Typography variant='body2'>{vm.name}</Typography>
                          <Typography variant='caption' sx={{ color: 'text.secondary' }}>({vm.vmid})</Typography>
                          {vm.tags?.map(tag => (
                            <Chip key={tag} label={tag} size='small' sx={{ height: 18, fontSize: '0.6rem', bgcolor: tagColor(tag), color: '#fff' }} />
                          ))}
                        </Box>
                      }
                      sx={{ display: 'flex', m: 0, py: 0.25, px: 0.5, borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}
                    />
                  ))
                )}
              </Box>
              {selectedVMs.length > 0 && (
                <Typography variant='caption' sx={{ color: 'primary.main', mt: 0.5 }}>
                  {t('siteRecovery.createJob.selectedCount', { count: selectedVMs.length })}
                </Typography>
              )}
            </Box>
          )}

          {/* Target Cluster */}
          <Box>
            <Typography variant='subtitle2' sx={{ mb: 0.5 }}>{t('siteRecovery.createJob.targetCluster')}</Typography>
            <Select
              value={targetCluster}
              onChange={e => handleTargetClusterChange(e.target.value)}
              size='small'
              fullWidth
              displayEmpty
              disabled={!sourceCluster}
            >
              <MenuItem value='' disabled>{t('siteRecovery.createJob.selectCluster')}</MenuItem>
              {targetConnections.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </Select>
          </Box>

          {/* SSH Connectivity Check */}
          {sourceCluster && targetCluster && sshCheck !== 'idle' && (
            <Box>
              {sshCheck === 'checking' && (
                <Alert severity='info' icon={<CircularProgress size={18} />}>
                  {t('siteRecovery.createJob.sshChecking')}
                </Alert>
              )}
              {sshCheck === 'success' && (
                <Alert severity='success'>
                  {t('siteRecovery.createJob.sshSuccess', { source: sshSourceNode, target: sshTargetIP })}
                </Alert>
              )}
              {sshCheck === 'failed' && (
                <Alert
                  severity='error'
                  action={
                    <Button color='inherit' size='small' onClick={() => runSSHCheck(sourceCluster, targetCluster)}>
                      {t('siteRecovery.createJob.sshRetry')}
                    </Button>
                  }
                >
                  <Typography variant='body2' sx={{ fontWeight: 600 }}>{t('siteRecovery.createJob.sshFailed')}</Typography>
                  <Typography variant='caption' sx={{ display: 'block', mt: 0.5 }}>{sshError}</Typography>
                  <Typography variant='caption' sx={{ display: 'block', mt: 0.5, opacity: 0.85 }}>
                    {t('siteRecovery.createJob.sshRequirement')}
                  </Typography>
                </Alert>
              )}
            </Box>
          )}

          {/* Target Pool (dynamic from Ceph API) */}
          <Box>
            <Typography variant='subtitle2' sx={{ mb: 0.5 }}>{t('siteRecovery.createJob.targetPool')}</Typography>
            <Select
              value={targetPool}
              onChange={e => setTargetPool(e.target.value)}
              size='small'
              fullWidth
              displayEmpty
              disabled={!targetCluster || cephLoading}
              startAdornment={cephLoading ? <CircularProgress size={16} sx={{ mr: 1 }} /> : undefined}
            >
              <MenuItem value='' disabled>{t('siteRecovery.createJob.selectPool')}</MenuItem>
              {cephPools.map((p: any) => (
                <MenuItem key={p.name} value={p.name}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                    <span>{p.name}</span>
                    {p.maxAvail > 0 && (
                      <Typography variant='caption' sx={{ color: 'text.secondary', ml: 2 }}>
                        {p.bytesUsedFormatted} used &middot; {p.maxAvailFormatted} avail
                      </Typography>
                    )}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </Box>

          {/* Schedule */}
          <Box>
            <Typography variant='subtitle2' sx={{ mb: 0.5 }}>{t('siteRecovery.createJob.schedule')}</Typography>
            <Select value={schedule} onChange={e => setSchedule(e.target.value)} size='small' fullWidth>
              {schedulePresets.map(p => <MenuItem key={p.value} value={p.value}>{p.label}</MenuItem>)}
            </Select>
          </Box>

          {/* RPO Target */}
          <Box>
            <Typography variant='subtitle2' sx={{ mb: 0.5 }}>{t('siteRecovery.createJob.rpoTarget')}</Typography>
            <Select value={rpoTarget} onChange={e => setRpoTarget(Number(e.target.value))} size='small' fullWidth>
              {rpoPresets.map(p => <MenuItem key={p.value} value={p.value}>{p.label}</MenuItem>)}
            </Select>
          </Box>

        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose}>{t('common.cancel')}</Button>
        <Button
          variant='contained'
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {t('siteRecovery.createJob.create')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
