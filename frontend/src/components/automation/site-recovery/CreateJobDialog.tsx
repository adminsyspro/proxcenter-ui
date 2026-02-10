'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import useSWR from 'swr'

import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, InputAdornment, ListItemIcon, MenuItem, Select, Stack,
  TextField, ToggleButton, ToggleButtonGroup, Typography
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
  const [rpoTarget, setRpoTarget] = useState(900)
  const [vmSearch, setVmSearch] = useState('')
  const [selectionMode, setSelectionMode] = useState<'vms' | 'tags'>('vms')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [vmidPrefix, setVmidPrefix] = useState<number>(0)

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
    sourceVMs.forEach(vm => vm.tags?.forEach(t => { if (t.trim()) tags.add(t.trim()) }))
    return Array.from(tags).sort()
  }, [sourceVMs])

  // Count VMs per tag
  const tagVMCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    allTags.forEach(tag => {
      counts[tag] = sourceVMs.filter(v => v.tags?.includes(tag)).length
    })
    return counts
  }, [allTags, sourceVMs])

  // Total unique VMs matching selected tags
  const matchingTagVMCount = useMemo(() => {
    if (selectedTags.length === 0) return 0
    const ids = new Set<number>()
    sourceVMs.forEach(vm => {
      if (vm.tags?.some(t => selectedTags.includes(t))) ids.add(vm.vmid)
    })
    return ids.size
  }, [selectedTags, sourceVMs])

  // Search filter on source VMs (for VM mode only)
  const filteredVMs = useMemo(() =>
    sourceVMs.filter(v => {
      if (!vmSearch) return true
      return v.name.toLowerCase().includes(vmSearch.toLowerCase()) || String(v.vmid).includes(vmSearch)
    })
  , [sourceVMs, vmSearch])

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
    setSelectedTags([])
    setTargetCluster('')
    setTargetPool('')
    setSshCheck('idle')
    setSshError('')
    setSelectionMode('vms')
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

  // Derive cron schedule from RPO target (run at ~RPO/3 for safety margin)
  const scheduleFromRPO = (rpo: number): string => {
    const interval = Math.max(1, Math.floor(rpo / 180)) // RPO/3 in minutes, min 1
    if (interval <= 1) return '* * * * *'
    if (interval < 60) return `*/${interval} * * * *`
    const hours = Math.floor(interval / 60)
    if (hours < 24) return `0 */${hours} * * *`
    return '0 0 * * *'
  }

  const handleSubmit = () => {
    onSubmit({
      vm_ids: selectionMode === 'vms' ? selectedVMs : [],
      tags: selectionMode === 'tags' ? selectedTags : [],
      source_cluster: sourceCluster,
      target_cluster: targetCluster,
      target_pool: targetPool,
      schedule: scheduleFromRPO(rpoTarget),
      rpo_target: rpoTarget,
      rate_limit_mbps: 0,
      vmid_prefix: vmidPrefix || undefined,
      network_mapping: {}
    })
    handleClose()
  }

  const handleClose = () => {
    setSourceCluster('')
    setSelectedVMs([])
    setSelectedTags([])
    setSelectionMode('vms')
    setTargetCluster('')
    setTargetPool('')
    setRpoTarget(900)
    setVmidPrefix(0)
    setVmSearch('')
    setSshCheck('idle')
    setSshError('')
    onClose()
  }

  const hasSelection = selectionMode === 'vms' ? selectedVMs.length > 0 : selectedTags.length > 0
  const canSubmit = sourceCluster && hasSelection && targetCluster && targetPool && sshCheck === 'success'

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
              {cephConnections.map(c => (
                <MenuItem key={c.id} value={c.id}>
                  <ListItemIcon sx={{ minWidth: 28 }}><i className='ri-server-line' /></ListItemIcon>
                  {c.name}
                </MenuItem>
              ))}
            </Select>
          </Box>

          {/* VM / Tag Selection (only shown after source cluster is selected) */}
          {sourceCluster && (
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant='subtitle2'>{t('siteRecovery.createJob.selectVMs')}</Typography>
                <ToggleButtonGroup
                  value={selectionMode}
                  exclusive
                  onChange={(_, v) => {
                    if (v) {
                      setSelectionMode(v)
                      if (v === 'tags') { setSelectedVMs([]); setVmSearch('') }
                      if (v === 'vms') setSelectedTags([])
                    }
                  }}
                  size='small'
                >
                  <ToggleButton value='vms' sx={{ px: 1.5, py: 0.25, textTransform: 'none', gap: 0.5 }}>
                    <i className='ri-computer-line' style={{ fontSize: 16 }} /> VMs
                  </ToggleButton>
                  <ToggleButton value='tags' sx={{ px: 1.5, py: 0.25, textTransform: 'none', gap: 0.5 }}>
                    <i className='ri-price-tag-3-line' style={{ fontSize: 16 }} /> Tags
                  </ToggleButton>
                </ToggleButtonGroup>
              </Box>

              {/* ── VM selection mode ── */}
              {selectionMode === 'vms' && (
                <>
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
                </>
              )}

              {/* ── Tag selection mode ── */}
              {selectionMode === 'tags' && (
                <>
                  <Box sx={{ maxHeight: 200, overflow: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 0.5 }}>
                    {allTags.length === 0 ? (
                      <Typography variant='caption' sx={{ p: 1, color: 'text.secondary' }}>{t('siteRecovery.createJob.noTags')}</Typography>
                    ) : (
                      allTags.map(tag => (
                        <FormControlLabel
                          key={tag}
                          control={
                            <Checkbox
                              size='small'
                              checked={selectedTags.includes(tag)}
                              onChange={() => setSelectedTags(prev =>
                                prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
                              )}
                            />
                          }
                          label={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Chip
                                label={tag}
                                size='small'
                                sx={{ bgcolor: tagColor(tag), color: '#fff', fontWeight: 500, fontSize: '0.7rem', height: 22 }}
                              />
                              <Typography variant='caption' sx={{ color: 'text.secondary' }}>
                                ({tagVMCounts[tag]} VMs)
                              </Typography>
                            </Box>
                          }
                          sx={{ display: 'flex', m: 0, py: 0.25, px: 0.5, borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}
                        />
                      ))
                    )}
                  </Box>
                  {selectedTags.length > 0 && (
                    <Typography variant='caption' sx={{ color: 'primary.main', mt: 0.5 }}>
                      {selectedTags.length} {selectedTags.length === 1 ? 'tag' : 'tags'} selected — {matchingTagVMCount} VMs currently matching
                    </Typography>
                  )}
                </>
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
              {targetConnections.map(c => (
                <MenuItem key={c.id} value={c.id}>
                  <ListItemIcon sx={{ minWidth: 28 }}><i className='ri-server-line' /></ListItemIcon>
                  {c.name}
                </MenuItem>
              ))}
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
                  <ListItemIcon sx={{ minWidth: 28 }}><i className='ri-database-2-line' /></ListItemIcon>
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

          {/* RPO Target */}
          <Box>
            <Typography variant='subtitle2' sx={{ mb: 0.5 }}>{t('siteRecovery.createJob.rpoTarget')}</Typography>
            <Select value={rpoTarget} onChange={e => setRpoTarget(Number(e.target.value))} size='small' fullWidth>
              {rpoPresets.map(p => (
                <MenuItem key={p.value} value={p.value}>
                  <ListItemIcon sx={{ minWidth: 28 }}><i className='ri-timer-line' /></ListItemIcon>
                  {p.label}
                </MenuItem>
              ))}
            </Select>
          </Box>

          {/* VMID Prefix */}
          <Box>
            <Typography variant='subtitle2' sx={{ mb: 0.5 }}>{t('siteRecovery.createJob.vmidPrefix')}</Typography>
            <TextField
              type='number'
              value={vmidPrefix || ''}
              onChange={e => setVmidPrefix(Number(e.target.value) || 0)}
              size='small'
              fullWidth
              placeholder='0'
              helperText={t('siteRecovery.createJob.vmidPrefixHelp')}
              InputProps={{
                startAdornment: <InputAdornment position='start'><i className='ri-hashtag' style={{ opacity: 0.5 }} /></InputAdornment>
              }}
            />
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
