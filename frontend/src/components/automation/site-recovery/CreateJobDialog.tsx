'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import useSWR from 'swr'

import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, InputAdornment, LinearProgress, MenuItem, Select, Stack,
  TextField, ToggleButton, ToggleButtonGroup, Typography
} from '@mui/material'

import { useTagColors } from '@/contexts/TagColorContext'
import type { BandwidthWindow, CreateReplicationJobRequest } from '@/lib/orchestrator/site-recovery.types'
import ScheduleBuilder from './schedule/ScheduleBuilder'
import { defaultTimezone, type ScheduleBuilderValue } from './schedule/types'
import BandwidthWindowsEditor from './BandwidthWindowsEditor'

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
  diskGb?: number
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
  const [name, setName] = useState('')
  const [sourceCluster, setSourceCluster] = useState('')
  const { getColor: getTagColor } = useTagColors(sourceCluster || undefined)
  const [selectedVMs, setSelectedVMs] = useState<number[]>([])
  const [targetCluster, setTargetCluster] = useState('')
  const [targetPool, setTargetPool] = useState('')
  const [scheduleValue, setScheduleValue] = useState<ScheduleBuilderValue>({
    mode: 'rpo',
    rpoTargetSeconds: 900,
    scheduleSpec: null,
    timezone: defaultTimezone(),
  })
  const [vmSearch, setVmSearch] = useState('')
  const [selectionMode, setSelectionMode] = useState<'vms' | 'tags'>('vms')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [vmidPrefix, setVmidPrefix] = useState<number>(0)
  const [installPv, setInstallPv] = useState(true)
  const [bandwidthWindows, setBandwidthWindows] = useState<BandwidthWindow[]>([])

  // Ceph VM IDs for the source cluster (only VMs with disks on RBD storage)
  const { data: cephVMsData } = useSWR(
    sourceCluster ? `/api/v1/connections/${sourceCluster}/ceph-vms` : null,
    fetcher
  )
  const cephVMMap = useMemo(() => {
    const m = new Map<number, number>()
    for (const v of (cephVMsData?.data || [])) m.set(v.vmid, v.cephDiskGb)
    return m
  }, [cephVMsData])

  // SSH connectivity check state
  const [sshCheck, setSshCheck] = useState<'idle' | 'checking' | 'success' | 'failed'>('idle')
  const [sshError, setSshError] = useState('')
  const [sshSourceNode, setSshSourceNode] = useState('')
  const [sshTargetIP, setSshTargetIP] = useState('')

  // Pre-flight checks state
  type PreflightCheck = { id: string; status: 'ok' | 'warn' | 'error'; label: string; detail?: string }
  const [preflight, setPreflight] = useState<{ checks: PreflightCheck[]; can_create: boolean } | null>(null)
  const [preflightLoading, setPreflightLoading] = useState(false)

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

  // VMs filtered by source cluster (only running qemu VMs on Ceph storage)
  const sourceVMs = useMemo(() =>
    allVMs.filter(vm =>
      vm.connId === sourceCluster &&
      vm.status === 'running' &&
      vm.type === 'qemu' &&
      cephVMMap.has(vm.vmid)
    )
  , [allVMs, sourceCluster, cephVMMap])

  // Collect all unique tags from source VMs
  const allTags = useMemo(() => {
    const tags = new Set<string>()
    sourceVMs.forEach(vm => vm.tags?.forEach(t => { if (t.trim()) tags.add(t.trim()) }))
    return Array.from(tags).sort((a, b) => a.localeCompare(b))
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

  // Estimate total source disk size based on the selection (GB → bytes)
  const estimatedSizeBytes = useMemo(() => {
    if (selectionMode === 'vms') {
      return selectedVMs.reduce((sum, vmid) => sum + (cephVMMap.get(vmid) || 0), 0) * 1024 * 1024 * 1024
    }
    if (selectedTags.length === 0) return 0
    const matched = new Set<number>()
    for (const vm of sourceVMs) {
      if (vm.tags?.some(tag => selectedTags.includes(tag))) matched.add(vm.vmid)
    }
    let total = 0
    matched.forEach(vmid => { total += cephVMMap.get(vmid) || 0 })
    return total * 1024 * 1024 * 1024
  }, [selectionMode, selectedVMs, selectedTags, sourceVMs, cephVMMap])

  // Pre-flight checks run once source/target/pool are chosen
  const runPreflight = useCallback(async (src: string, tgt: string, pool: string, sizeBytes: number) => {
    if (!src || !tgt || !pool) {
      setPreflight(null)
      return
    }
    setPreflightLoading(true)
    try {
      const res = await fetch('/api/v1/orchestrator/replication/preflight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_cluster: src, target_cluster: tgt, target_pool: pool, estimated_size_bytes: sizeBytes }),
      })
      if (!res.ok) { setPreflight(null); return }
      const data = await res.json()
      setPreflight(data)
    } catch {
      setPreflight(null)
    } finally {
      setPreflightLoading(false)
    }
  }, [])

  useEffect(() => {
    runPreflight(sourceCluster, targetCluster, targetPool, estimatedSizeBytes)
  }, [sourceCluster, targetCluster, targetPool, estimatedSizeBytes, runPreflight])

  // Fetch Ceph pools for the selected target cluster
  const { data: cephData, isLoading: cephLoading } = useSWR(
    targetCluster ? `/api/v1/connections/${targetCluster}/ceph` : null,
    fetcher
  )

  // Filter to only RBD pools (exclude internal pools and CephFS pools)
  const cephPools = useMemo(() =>
    (cephData?.data?.pools?.list || []).filter((p: any) =>
      !p.name.startsWith('.') && p.name !== 'device_health_metrics' && p.application !== 'cephfs'
    )
  , [cephData])

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

  const handleSubmit = () => {
    const base = {
      name: name.trim() || undefined,
      vm_ids: selectionMode === 'vms' ? selectedVMs : [],
      tags: selectionMode === 'tags' ? selectedTags : [],
      source_cluster: sourceCluster,
      target_cluster: targetCluster,
      target_pool: targetPool,
      rate_limit_mbps: 0,
      bandwidth_windows: bandwidthWindows.length > 0 ? bandwidthWindows : undefined,
      vmid_prefix: vmidPrefix || undefined,
      install_pv: installPv || undefined,
      network_mapping: {},
    }
    if (scheduleValue.mode === 'rpo') {
      onSubmit({ ...base, rpo_target: scheduleValue.rpoTargetSeconds })
    } else {
      onSubmit({
        ...base,
        schedule_spec: scheduleValue.scheduleSpec,
        timezone: scheduleValue.timezone,
      })
    }
    handleClose()
  }

  const handleClose = () => {
    setName('')
    setSourceCluster('')
    setSelectedVMs([])
    setSelectedTags([])
    setSelectionMode('vms')
    setTargetCluster('')
    setTargetPool('')
    setScheduleValue({
      mode: 'rpo',
      rpoTargetSeconds: 900,
      scheduleSpec: null,
      timezone: defaultTimezone(),
    })
    setVmidPrefix(0)
    setInstallPv(true)
    setBandwidthWindows([])
    setVmSearch('')
    setSshCheck('idle')
    setSshError('')
    onClose()
  }

  const hasSelection = selectionMode === 'vms' ? selectedVMs.length > 0 : selectedTags.length > 0
  const scheduleValid = scheduleValue.mode === 'rpo' || scheduleValue.scheduleSpec !== null
  const preflightOk = !preflight || preflight.can_create
  const canSubmit = sourceCluster && hasSelection && targetCluster && targetPool && sshCheck === 'success' && scheduleValid && preflightOk

  return (
    <Dialog open={open} onClose={handleClose} maxWidth='sm' fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{t('siteRecovery.createJob.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          {/* Job Name */}
          <Box>
            <Typography variant='subtitle2' sx={{ mb: 0.5 }}>{t('siteRecovery.createJob.name')}</Typography>
            <TextField
              value={name}
              onChange={e => setName(e.target.value)}
              size='small'
              fullWidth
              placeholder={t('siteRecovery.createJob.namePlaceholder')}
              helperText={t('siteRecovery.createJob.nameHelp')}
              InputProps={{ startAdornment: <InputAdornment position='start'><i className='ri-bookmark-line' style={{ opacity: 0.5 }} /></InputAdornment> }}
            />
          </Box>

          {/* Source Cluster */}
          <Box>
            <Typography variant='subtitle2' sx={{ mb: 0.5 }}>{t('siteRecovery.createJob.sourceCluster')}</Typography>
            <Select value={sourceCluster} onChange={e => handleSourceClusterChange(e.target.value)} size='small' fullWidth displayEmpty>
              <MenuItem value='' disabled>{t('siteRecovery.createJob.selectCluster')}</MenuItem>
              {cephConnections.map(c => (
                <MenuItem key={c.id} value={c.id}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <i className='ri-server-line' style={{ fontSize: 16, opacity: 0.7 }} />
                    <span>{c.name}</span>
                  </Box>
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
                      filteredVMs.map(vm => {
                        const diskGb = cephVMMap.get(vm.vmid)
                        const dotColor = vm.status === 'running' ? '#4caf50' : vm.status === 'paused' ? '#ed6c02' : '#f44336'
                        return (
                          <FormControlLabel
                            key={vm.vmid}
                            control={<Checkbox size='small' checked={selectedVMs.includes(vm.vmid)} onChange={() => toggleVM(vm.vmid)} />}
                            label={
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                                <Box sx={{ position: 'relative', display: 'inline-flex', flexShrink: 0, mr: 0.25 }}>
                                  <i className='ri-computer-fill' style={{ fontSize: 16, opacity: 0.7 }} />
                                  <Box sx={{
                                    position: 'absolute', bottom: -1, right: -2,
                                    width: 7, height: 7, borderRadius: '50%',
                                    bgcolor: dotColor,
                                    border: '1.5px solid', borderColor: 'background.paper',
                                    boxShadow: vm.status === 'running' ? `0 0 4px ${dotColor}` : 'none',
                                  }} />
                                </Box>
                                <Typography variant='body2'>{vm.name}</Typography>
                                <Typography variant='caption' sx={{ color: 'text.secondary' }}>({vm.vmid})</Typography>
                                {diskGb != null && (
                                  <Chip label={`${diskGb} GB`} size='small' variant='outlined' sx={{ height: 18, fontSize: '0.6rem' }} />
                                )}
                                {vm.tags?.filter(tag => tag && tag.trim()).map(tag => (
                                  <Chip key={tag} label={tag} size='small' sx={{ height: 18, fontSize: '0.6rem', bgcolor: getTagColor(tag).bg, color: '#fff' }} />
                                ))}
                              </Box>
                            }
                            sx={{ display: 'flex', m: 0, py: 0.25, px: 0.5, borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}
                          />
                        )
                      })
                    )}
                  </Box>
                  {selectedVMs.length > 0 && (() => {
                    const totalGb = selectedVMs.reduce((sum, vmid) => sum + (cephVMMap.get(vmid) || 0), 0)
                    return (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                        <Typography variant='caption' sx={{ color: 'primary.main' }}>
                          {t('siteRecovery.createJob.selectedCount', { count: selectedVMs.length })}
                        </Typography>
                        {totalGb > 0 && (
                          <Chip
                            icon={<i className='ri-hard-drive-2-line' style={{ fontSize: 14 }} />}
                            label={totalGb >= 1024 ? `${(totalGb / 1024).toFixed(1)} TB` : `${totalGb} GB`}
                            size='small'
                            variant='outlined'
                            color='info'
                            sx={{ height: 20, fontSize: '0.7rem' }}
                          />
                        )}
                      </Box>
                    )
                  })()}
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
                                sx={{ bgcolor: getTagColor(tag).bg, color: '#fff', fontWeight: 500, fontSize: '0.7rem', height: 22 }}
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
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <i className='ri-server-line' style={{ fontSize: 16, opacity: 0.7 }} />
                    <span>{c.name}</span>
                  </Box>
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
                <Box
                  sx={{
                    p: 1.5,
                    borderRadius: 1,
                    border: 1,
                    borderColor: 'success.main',
                    bgcolor: theme => `${theme.palette.success.main}14`, // 8% opacity
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                  }}
                >
                  {/* Source node */}
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, minWidth: 0 }}>
                    <i className='ri-server-line' style={{ fontSize: 22, opacity: 0.75 }} />
                    <Typography variant='caption' sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.7rem', fontWeight: 600, mt: 0.25, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                      {sshSourceNode}
                    </Typography>
                    <Typography variant='caption' sx={{ color: 'text.secondary', fontSize: '0.6rem' }}>
                      {t('siteRecovery.protection.source')}
                    </Typography>
                  </Box>

                  {/* Animated link with check in the middle */}
                  <Box sx={{ flex: 2, display: 'flex', alignItems: 'center', gap: 0.75, position: 'relative', minWidth: 0 }}>
                    <Box sx={{
                      flex: 1, height: 2, borderRadius: 1,
                      background: theme => `repeating-linear-gradient(90deg, ${theme.palette.success.main} 0 6px, transparent 6px 12px)`,
                      backgroundSize: '12px 2px',
                      animation: 'sshFlow 1.2s linear infinite',
                      '@keyframes sshFlow': {
                        '0%': { backgroundPosition: '0 0' },
                        '100%': { backgroundPosition: '12px 0' },
                      },
                    }} />
                    <Box sx={{
                      width: 26, height: 26, borderRadius: '50%',
                      bgcolor: 'success.main', color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                      boxShadow: theme => `0 0 0 4px ${theme.palette.success.main}33`,
                      animation: 'sshPulse 2s ease-in-out infinite',
                      '@keyframes sshPulse': {
                        '0%, 100%': { boxShadow: theme => `0 0 0 4px ${theme.palette.success.main}33` },
                        '50%': { boxShadow: theme => `0 0 0 8px ${theme.palette.success.main}1a` },
                      },
                    }}>
                      <i className='ri-check-line' style={{ fontSize: 16 }} />
                    </Box>
                    <Box sx={{
                      flex: 1, height: 2, borderRadius: 1,
                      background: theme => `repeating-linear-gradient(90deg, ${theme.palette.success.main} 0 6px, transparent 6px 12px)`,
                      backgroundSize: '12px 2px',
                      animation: 'sshFlow 1.2s linear infinite',
                    }} />
                  </Box>

                  {/* Target IP */}
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, minWidth: 0 }}>
                    <i className='ri-server-line' style={{ fontSize: 22, opacity: 0.75 }} />
                    <Typography variant='caption' sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.7rem', fontWeight: 600, mt: 0.25, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                      {sshTargetIP}
                    </Typography>
                    <Typography variant='caption' sx={{ color: 'text.secondary', fontSize: '0.6rem' }}>
                      {t('siteRecovery.protection.target')}
                    </Typography>
                  </Box>
                </Box>
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
              {cephPools.map((p: any) => {
                // Ceph's percent_used is usually a 0..1 float; some versions return 0..100.
                const rawPct = typeof p.percentUsed === 'number' ? p.percentUsed : 0
                const pct = rawPct <= 1 ? Math.round(rawPct * 100) : Math.min(100, Math.round(rawPct))
                const hasStats = (p.bytesUsed || 0) > 0 || (p.maxAvail || 0) > 0
                const barColor = pct >= 90 ? 'error' : pct >= 75 ? 'warning' : 'primary'
                return (
                  <MenuItem key={p.name} value={p.name}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, width: '100%', py: 0.5 }}>
                      <img src='/images/ceph-logo.svg' alt='Ceph' width={16} height={16} style={{ flexShrink: 0 }} />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1 }}>
                          <span>{p.name}</span>
                          {hasStats && (
                            <Typography variant='caption' sx={{ color: 'text.secondary', fontFamily: '"JetBrains Mono", monospace', fontSize: '0.65rem' }}>
                              {p.bytesUsedFormatted} used{(p.maxAvail || 0) > 0 ? ` · ${p.maxAvailFormatted} free` : ''}
                            </Typography>
                          )}
                        </Box>
                        {hasStats && (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                            <LinearProgress
                              variant='determinate'
                              value={pct}
                              color={barColor as any}
                              sx={{ flex: 1, height: 4, borderRadius: 2 }}
                            />
                            <Typography variant='caption' sx={{ color: `${barColor}.main`, fontWeight: 600, minWidth: 30, textAlign: 'right', fontSize: '0.65rem' }}>
                              {pct}%
                            </Typography>
                          </Box>
                        )}
                      </Box>
                    </Box>
                  </MenuItem>
                )
              })}
            </Select>
          </Box>

          {/* Pre-flight checks — run once source/target/pool are selected */}
          {(preflight || preflightLoading) && (
            <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <i className='ri-shield-check-line' style={{ opacity: 0.7 }} />
                <Typography variant='subtitle2'>{t('siteRecovery.preflight.title')}</Typography>
                {preflightLoading && <CircularProgress size={14} sx={{ ml: 'auto' }} />}
              </Box>
              <Stack spacing={0.5}>
                {(preflight?.checks || []).map(c => {
                  const color = c.status === 'ok' ? 'success.main' : c.status === 'warn' ? 'warning.main' : 'error.main'
                  const icon = c.status === 'ok' ? 'ri-check-line' : c.status === 'warn' ? 'ri-error-warning-line' : 'ri-close-circle-line'
                  return (
                    <Box key={c.id} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                      <i className={icon} style={{ color: `var(--mui-palette-${c.status === 'ok' ? 'success' : c.status === 'warn' ? 'warning' : 'error'}-main)`, fontSize: 16, marginTop: 2 }} />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant='body2' sx={{ fontWeight: 500 }}>{t(`siteRecovery.preflight.checks.${c.id}`)}</Typography>
                        {c.detail && (
                          <Typography variant='caption' sx={{ color, display: 'block', lineHeight: 1.3 }}>
                            {c.detail}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                  )
                })}
              </Stack>
              {preflight && !preflight.can_create && (
                <Alert severity='error' sx={{ mt: 1.5, py: 0.5 }} icon={false}>
                  <Typography variant='caption'>{t('siteRecovery.preflight.blocked')}</Typography>
                </Alert>
              )}
            </Box>
          )}

          <ScheduleBuilder value={scheduleValue} onChange={setScheduleValue} />

          <BandwidthWindowsEditor value={bandwidthWindows} onChange={setBandwidthWindows} staticRateMbps={0} />

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

          {/* pv package — auto-install checkbox when SSH is connected, info note otherwise */}
          {sshCheck === 'success' ? (
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
              <FormControlLabel
                control={<Checkbox size='small' checked={installPv} onChange={e => setInstallPv(e.target.checked)} />}
                label={
                  <Box>
                    <Typography variant='body2' sx={{ fontWeight: 500 }}>
                      {t.rich('siteRecovery.createJob.pvInstallLabel', {
                        pv: () => <code style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>pv</code>
                      })}
                    </Typography>
                    <Typography variant='caption' sx={{ color: 'text.secondary' }}>
                      {t('siteRecovery.createJob.pvInstallDesc')}
                    </Typography>
                  </Box>
                }
                sx={{ m: 0, alignItems: 'flex-start' }}
              />
            </Box>
          ) : (
            <Alert severity='info' variant='outlined' sx={{ '& .MuiAlert-message': { fontSize: '0.8rem' } }}>
              {t.rich('siteRecovery.createJob.pvNote', {
                pv: () => <code style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>pv</code>
              })}
            </Alert>
          )}

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
