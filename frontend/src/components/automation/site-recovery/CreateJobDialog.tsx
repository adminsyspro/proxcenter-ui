'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import useSWR from 'swr'

import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, InputAdornment, LinearProgress, MenuItem, Select, Stack, TablePagination, Tooltip,
  TextField, ToggleButton, ToggleButtonGroup, Typography
} from '@mui/material'

import { useTagColors } from '@/contexts/TagColorContext'
import type { BandwidthWindow, CreateReplicationJobRequest, ReplicableVM, ReplicationStorages, SSHConnectivityResult, StorageEngine } from '@/lib/orchestrator/site-recovery.types'
import ScheduleBuilder from './schedule/ScheduleBuilder'
import { defaultTimezone, type ScheduleBuilderValue } from './schedule/types'
import { cadenceSeconds, formatWindow, retentionWindowSeconds } from './schedule/retentionWindow'
import BandwidthWindowsEditor from './BandwidthWindowsEditor'
import RetentionSlider from './RetentionSlider'
import EngineGlyph from './EngineGlyph'
import NumericTextField from '@/components/ui/NumericTextField'

// ── Types ───────────────────────────────────────────────────────────────

interface Connection {
  id: string
  name: string
  hasCeph: boolean
  engines: StorageEngine[]
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
  engines?: StorageEngine[]
}

// ── Fetcher ─────────────────────────────────────────────────────────────

const fetcher = (url: string) => fetch(url).then(res => {
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
})

// ── Main Component ─────────────────────────────────────────────────────

export default function CreateJobDialog({ open, onClose, onSubmit, connections, allVMs, engines }: CreateJobDialogProps) {
  const t = useTranslations()
  const [name, setName] = useState('')
  const [engine, setEngine] = useState<StorageEngine>('rbd')
  const [targetNode, setTargetNode] = useState('')
  const [vmPage, setVmPage] = useState(0)
  const [tagPage, setTagPage] = useState(0)
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
  const [keepSource, setKeepSource] = useState(3)
  const [keepTarget, setKeepTarget] = useState(3)

  // Spell out the cadence the schedule will really produce and how far back the
  // kept points reach. Without this the user has no way to know that an RPO of
  // 30 minutes replicates every 10, and discovers the retention depth they
  // actually got only once the job has been running for days.
  const retentionCaption = useMemo(() => {
    const cadence = cadenceSeconds(scheduleValue)
    const covered = retentionWindowSeconds(cadence, keepTarget)

    if (!cadence || !covered) return t('siteRecovery.createJob.retentionTargetHelp')

    return t('siteRecovery.createJob.retentionCoverage', {
      cadence: formatWindow(cadence),
      window: formatWindow(covered),
    })
  }, [scheduleValue, keepTarget, t])

  const { data: cephVMsData, error: vmDiscoveryError, isLoading: vmDiscoveryLoading } = useSWR<ReplicableVM[]>(
    open && sourceCluster ? `/api/v1/connections/${sourceCluster}/replicable-vms?engine=${engine}` : null,
    fetcher
  )
  const cephVMMap = useMemo(() => new Map((cephVMsData || []).map(vm => [vm.vmid, vm.diskGb])), [cephVMsData])
  const eligibility = useMemo(() => new Map((cephVMsData || []).map(vm => [vm.vmid, vm])), [cephVMsData])
  const isVMDisabled = (vmid: number) => {
    const vm = eligibility.get(vmid)
    return !vm || vm.unsupported || (engine === 'zfs' && vm.mixed)
  }

  // Results carry their request key so a previous selection can never enable creation.
  type PreflightCheck = { id: 'source_health' | 'target_health' | 'target_space' | 'target_storage' | 'reverse_ssh'; status: 'ok' | 'warn' | 'error'; label?: string; detail?: string; message?: string }
  const [checkResult, setCheckResult] = useState<{
    key: string
    ssh?: SSHConnectivityResult
    preflight?: { checks: PreflightCheck[]; can_create: boolean }
    error?: string
  } | null>(null)
  const [checkAttempt, setCheckAttempt] = useState(0)
  const cephConnections = useMemo(() => connections.filter(c => c.engines.includes(engine)), [connections, engine])

  // Target clusters exclude the source cluster
  const targetConnections = useMemo(() =>
    cephConnections.filter(c => c.id !== sourceCluster)
  , [cephConnections, sourceCluster])

  // Replication also supports stopped QEMU guests.
  const sourceVMs = useMemo(() =>
    allVMs.filter(vm =>
      vm.connId === sourceCluster &&
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

  const hasSelection = selectionMode === 'vms' ? selectedVMs.length > 0 : selectedTags.length > 0
  const checkKey = open && sourceCluster && targetCluster && targetPool && hasSelection && (engine !== 'zfs' || targetNode)
    ? JSON.stringify({
      source_cluster: sourceCluster, target_cluster: targetCluster, storage_engine: engine,
      target_node: targetNode, vm_ids: selectionMode === 'vms' ? selectedVMs : [],
      tags: selectionMode === 'tags' ? selectedTags : [], target_pool: targetPool, estimated_size_bytes: estimatedSizeBytes,
    }) : ''

  useEffect(() => {
    if (!checkKey) return
    const controller = new AbortController()
    const { target_pool, estimated_size_bytes, ...context } = JSON.parse(checkKey)
    const runCheck = async (endpoint: string, body: unknown) => {
      const response = await fetch(`/api/v1/orchestrator/replication/${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal,
      })
      if (!response.ok) throw new Error(t('siteRecovery.preflight.blocked'))
      return response.json()
    }

    Promise.all([
      runCheck('check-ssh', context),
      runCheck('preflight', { ...context, target_pool, estimated_size_bytes }),
    ]).then(([ssh, preflight]) => {
      if (!controller.signal.aborted) setCheckResult({ key: checkKey, ssh, preflight })
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setCheckResult({ key: checkKey, error: error instanceof Error ? error.message : String(error) })
    })
    return () => controller.abort()
  }, [checkKey, checkAttempt, t])

  const currentChecks = checkResult?.key === checkKey ? checkResult : null
  const preflight = currentChecks?.preflight
  const preflightLoading = !!checkKey && !currentChecks
  const sshCheck = !checkKey ? 'idle' : !currentChecks ? 'checking' : currentChecks.ssh?.connected ? 'success' : 'failed'
  const sshError = currentChecks?.error || currentChecks?.ssh?.error || ''
  const sshSourceNode = currentChecks?.ssh?.source_node || ''
  const sshTargetIP = currentChecks?.ssh?.target_ip || ''
  const sshChecks = currentChecks?.ssh?.checks || []

  // Fetch Ceph pools for the selected target cluster
  const { data: cephData, isLoading: cephLoading } = useSWR(
    open && engine === 'rbd' && targetCluster ? `/api/v1/connections/${targetCluster}/ceph` : null,
    fetcher
  )

  const { data: targetStorages, isLoading: targetStoragesLoading, error: targetStoragesError } = useSWR<ReplicationStorages>(
    open && engine === 'zfs' && targetCluster ? `/api/v1/connections/${targetCluster}/replication-storages` : null,
    fetcher, { dedupingInterval: 300_000 },
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
    setCheckResult(null)
    setTargetNode('')
    setSelectionMode('vms')
    setVmSearch('')
    setVmPage(0)
    setTagPage(0)
  }

  const handleTargetClusterChange = (value: string) => {
    setTargetCluster(value)
    setTargetPool('')
    setCheckResult(null)
    setTargetNode('')
  }

  const toggleVM = (vmid: number) => {
    if (isVMDisabled(vmid)) return
    setCheckResult(null)
    setSelectedVMs(prev => prev.includes(vmid) ? prev.filter(id => id !== vmid) : [...prev, vmid])
  }

  const handleSubmit = () => {
    if (!canSubmit) return
    const base = {
      name: name.trim() || undefined,
      vm_ids: selectionMode === 'vms' ? selectedVMs : [],
      tags: selectionMode === 'tags' ? selectedTags : [],
      source_cluster: sourceCluster,
      target_cluster: targetCluster,
      target_pool: targetPool,
      storage_engine: engine,
      target_node: targetNode || undefined,
      rate_limit_mbps: 0,
      bandwidth_windows: bandwidthWindows.length > 0 ? bandwidthWindows : undefined,
      vmid_prefix: vmidPrefix || undefined,
      install_pv: installPv || undefined,
      network_mapping: {},
      snapshot_keep_source: keepSource,
      snapshot_keep_target: keepTarget,
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
    setEngine('rbd')
    setVmPage(0)
    setTagPage(0)
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
    setKeepSource(3)
    setKeepTarget(3)
    setVmSearch('')
    setCheckResult(null)
    setTargetNode('')
    onClose()
  }

  const scheduleValid = scheduleValue.mode === 'rpo' || scheduleValue.scheduleSpec !== null
  const preflightOk = !!preflight?.can_create && !preflightLoading
  const canSubmit = sourceCluster && hasSelection && targetCluster && targetPool && sshCheck === 'success' && scheduleValid && preflightOk && (engine === 'rbd' || !!engines?.includes('zfs'))
    && (selectionMode === 'tags' || selectedVMs.every(vmid => !isVMDisabled(vmid)))
    && cephConnections.some(connection => connection.id === sourceCluster) && targetConnections.some(connection => connection.id === targetCluster)
    && (engine !== 'zfs' || !!targetStorages?.zfs.some(row => row.storage === targetPool && row.node === targetNode && row.active))

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

          <Box>
            <Typography variant='subtitle2' sx={{ mb: 0.5 }}>{t('siteRecovery.createJob.engine')}</Typography>
            <ToggleButtonGroup value={engine} exclusive size='small' onChange={(_, value: StorageEngine | null) => {
              if (!value || value === engine) return
              setEngine(value)
              handleSourceClusterChange('')
            }}>
              <ToggleButton value='rbd' sx={{ gap: 1 }}><EngineGlyph />{t('siteRecovery.createJob.engineCeph')}</ToggleButton>
              <ToggleButton value='zfs' disabled={!engines?.includes('zfs')} sx={{ gap: 1 }}>
                <EngineGlyph engine='zfs' />{t('siteRecovery.createJob.engineZfs')}
                {!engines?.includes('zfs') && <Typography variant='caption'>{t('siteRecovery.createJob.engineComingSoon')}</Typography>}
              </ToggleButton>
            </ToggleButtonGroup>
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
              {vmDiscoveryError && <Alert severity='warning'>{t('siteRecovery.discoveryError')}</Alert>}
              {vmDiscoveryLoading && <Alert severity='info'>{t('siteRecovery.discoveryLoading')}</Alert>}
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant='subtitle2'>{t('siteRecovery.createJob.selectVMs')}</Typography>
                <ToggleButtonGroup
                  value={selectionMode}
                  exclusive
                  onChange={(_, v) => {
                    if (v) {
                      setCheckResult(null)
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
                    onChange={e => { setVmSearch(e.target.value); setVmPage(0) }}
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
                      filteredVMs.slice(vmPage * 10, vmPage * 10 + 10).map(vm => {
                        const diskGb = cephVMMap.get(vm.vmid)
                        const dotColor = vm.status === 'running' ? '#4caf50' : vm.status === 'paused' ? '#ed6c02' : '#f44336'
                        return (
                          <FormControlLabel
                            key={vm.vmid}
                            disabled={isVMDisabled(vm.vmid)}
                            control={<Checkbox size='small' checked={selectedVMs.includes(vm.vmid)} onChange={() => toggleVM(vm.vmid)} />}
                            label={
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, whiteSpace: 'nowrap' }}>
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
                                <Typography variant='body2' noWrap>{vm.name}</Typography>
                                {(eligibility.get(vm.vmid)?.unsupported || eligibility.get(vm.vmid)?.mixed) && (
                                  <Tooltip title={t(eligibility.get(vm.vmid)?.unsupported ? 'siteRecovery.createJob.vmUnsupportedDisk' : engine === 'zfs' ? 'siteRecovery.createJob.vmMixedStorage' : 'siteRecovery.createJob.vmMixedStorageWarn')}>
                                    <i className='ri-error-warning-line' aria-label={t(eligibility.get(vm.vmid)?.unsupported ? 'siteRecovery.createJob.vmUnsupportedDisk' : engine === 'zfs' ? 'siteRecovery.createJob.vmMixedStorage' : 'siteRecovery.createJob.vmMixedStorageWarn')} />
                                  </Tooltip>
                                )}
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
                      allTags.slice(tagPage * 10, tagPage * 10 + 10).map(tag => (
                        <FormControlLabel
                          key={tag}
                          control={
                            <Checkbox
                              size='small'
                              checked={selectedTags.includes(tag)}
                              onChange={() => { setCheckResult(null); setSelectedTags(prev =>
                                prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
                              ) }}
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

          {sourceCluster && (selectionMode === 'vms' ? filteredVMs.length : allTags.length) > 10 && (
            <TablePagination component='div' count={selectionMode === 'vms' ? filteredVMs.length : allTags.length} rowsPerPage={10} rowsPerPageOptions={[10]}
              page={selectionMode === 'vms' ? vmPage : tagPage} onPageChange={(_, value) => selectionMode === 'vms' ? setVmPage(value) : setTagPage(value)} />
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
              {sshCheck === 'success' && sshChecks.length <= 1 && (
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
              {sshChecks.length > 1 && (
                <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                  <Typography variant='subtitle2'>{t('siteRecovery.createJob.sshChecks')}</Typography>
                  {sshChecks.map(check => (
                    <Box key={check.source_node + ':' + check.target_node} sx={{ display: 'flex', alignItems: 'center', gap: 1, whiteSpace: 'nowrap' }}>
                      <Box component='span' sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: check.ok ? 'success.main' : 'error.main' }} />
                      <Typography variant='body2'>{check.source_node} → {check.target_node}</Typography>
                      {check.error && <Typography variant='caption' color='error'>{check.error}</Typography>}
                    </Box>
                  ))}
                </Box>
              )}
              {sshCheck === 'failed' && (
                <Alert
                  severity='error'
                  action={
                    <Button color='inherit' size='small' onClick={() => { setCheckResult(null); setCheckAttempt(value => value + 1) }}>
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
          {engine === 'rbd' ? <Box>
            <Typography variant='subtitle2' sx={{ mb: 0.5 }}>{t('siteRecovery.createJob.targetPool')}</Typography>
            <Select
              value={targetPool}
              onChange={e => { setCheckResult(null); setTargetPool(e.target.value) }}
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
          </Box> : <Box>
            <Typography variant='subtitle2' sx={{ mb: 0.5 }}>{t('siteRecovery.createJob.targetStorage')}</Typography>
            {targetStoragesError && <Alert severity='warning'>{t('siteRecovery.discoveryError')}</Alert>}
            <Select value={targetPool && targetNode ? JSON.stringify([targetPool, targetNode]) : ''} size='small' fullWidth displayEmpty
              disabled={!targetCluster || targetStoragesLoading}
              inputProps={{ 'aria-label': t('siteRecovery.createJob.targetStorage') }}
              onChange={event => { setCheckResult(null); const [storage, node] = JSON.parse(event.target.value); setTargetPool(storage); setTargetNode(node) }}>
              <MenuItem value='' disabled>{t('siteRecovery.createJob.selectStorage')}</MenuItem>
              {(targetStorages?.zfs || []).map(row => (
                <MenuItem key={JSON.stringify([row.storage, row.node])} value={JSON.stringify([row.storage, row.node])} disabled={!row.active}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%', whiteSpace: 'nowrap' }}>
                    <EngineGlyph engine='zfs' />
                    <Box component='span' sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: row.active ? 'success.main' : 'text.disabled' }} />
                    <Typography variant='body2'>{row.storage} · {row.node}</Typography>
                    <LinearProgress variant='determinate' value={row.totalBytes ? Math.max(0, Math.min(100, 100 * (1 - row.availBytes / row.totalBytes))) : 0} sx={{ flex: 1, minWidth: 24 }} />
                    <Typography variant='caption'>{row.availFormatted} {t('common.free')}</Typography>
                  </Box>
                </MenuItem>
              ))}
            </Select>
            <Typography variant='caption' color='text.secondary'>{t('siteRecovery.createJob.zfsNodeHint')}</Typography>
          </Box>}

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
                        {(c.detail || c.message) && (
                          <Typography variant='caption' sx={{ color, display: 'block', lineHeight: 1.3 }}>
                            {c.detail || c.message}
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

          {/* Snapshot retention */}
          <Box>
            <Typography variant='subtitle2' sx={{ mb: 0.5 }}>{t('siteRecovery.createJob.snapshotRetention')}</Typography>
            <Typography variant='caption' sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
              {t('siteRecovery.createJob.snapshotRetentionHelp')}
            </Typography>
            <Stack spacing={1}>
              <RetentionSlider
                label={t('siteRecovery.createJob.retentionSource')}
                value={keepSource}
                onChange={setKeepSource}
              />
              <RetentionSlider
                label={t('siteRecovery.createJob.retentionTarget')}
                value={keepTarget}
                onChange={setKeepTarget}
                helperText={retentionCaption}
              />
            </Stack>
          </Box>

          {/* VMID Prefix */}
          <Box>
            <Typography variant='subtitle2' sx={{ mb: 0.5 }}>{t('siteRecovery.createJob.vmidPrefix')}</Typography>
            <NumericTextField
              type='number'
              value={vmidPrefix}
              onChange={setVmidPrefix}
              fallback={0}
              format={n => (n === 0 ? '' : String(n))}
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
