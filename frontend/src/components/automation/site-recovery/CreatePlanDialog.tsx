'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  MenuItem, Select, Stack, TablePagination, TextField, Typography
} from '@mui/material'

import type { ReplicationJob, CreateRecoveryPlanRequest, RecoveryPlan, StorageEngine } from '@/lib/orchestrator/site-recovery.types'

import EngineGlyph from './EngineGlyph'

// ── Main Component ─────────────────────────────────────────────────────

interface CreatePlanDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: CreateRecoveryPlanRequest) => void
  connections: Array<{ id: string; name: string; hasCeph: boolean; engines: StorageEngine[] }>
  jobs: ReplicationJob[]
  /** Set to edit that plan instead of creating one: same form, prefilled. */
  plan?: RecoveryPlan | null
  /** Every existing plan, to say under a guest which other plans list it. */
  plans?: RecoveryPlan[]
}

interface ReplicatedVM {
  vm_id: number
  vm_name: string
  replication_job_id: string
  job_name: string
  job_status: ReplicationJob['status']
  storage_engine: StorageEngine
}

interface VMAssignment extends ReplicatedVM {
  vm_id: number
  vm_name: string
  tier: 1 | 2 | 3
  boot_order: number
  source_cluster: string
  target_cluster: string
}

export default function CreatePlanDialog({ open, onClose, onSubmit, connections, jobs, plan = null, plans = [] }: CreatePlanDialogProps) {
  const t = useTranslations()
  const [page, setPage] = useState(0)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [vmAssignments, setVmAssignments] = useState<VMAssignment[]>([])

  // Build connection name map
  const connMap = useMemo(() => {
    const m: Record<string, string> = {}
    for (const c of connections) m[c.id] = c.name
    return m
  }, [connections])

  // Group VMs by cluster pair from replication jobs
  const vmsByPair = useMemo(() => {
    const groups: Record<string, { source: string; target: string; vms: ReplicatedVM[] }> = {}
    for (const j of (jobs || [])) {
      const key = `${j.source_cluster}→${j.target_cluster}`
      if (!groups[key]) groups[key] = { source: j.source_cluster, target: j.target_cluster, vms: [] }
      const ids = j.vm_ids || []
      const names = j.vm_names || []
      for (let k = 0; k < ids.length; k++) {
        groups[key].vms.push({ vm_id: ids[k], vm_name: names[k] || `VM ${ids[k]}`, replication_job_id: j.id, job_name: j.name || j.id, job_status: j.status, storage_engine: j.storage_engine || 'rbd' })
      }
    }
    return groups
  }, [jobs])

  // Editing prefills the form from the plan. The guests carry only ids, tiers
  // and job ids, so the rest of each row (name, engine, job state) is rebuilt
  // from the jobs list the dialog already groups.
  useEffect(() => {
    if (!open) return

    if (!plan) {
      setName('')
      setDescription('')
      setVmAssignments([])

      return
    }

    setName(plan.name || '')
    setDescription(plan.description || '')

    const known = new Map<string, ReplicatedVM>()
    for (const group of Object.values(vmsByPair)) {
      for (const vm of group.vms) known.set(`${vm.replication_job_id}:${vm.vm_id}`, vm)
    }

    setVmAssignments((plan.vms || []).map((pv, index) => {
      const match = known.get(`${pv.replication_job_id}:${pv.vm_id}`)

      return {
        vm_id: pv.vm_id,
        vm_name: match?.vm_name || pv.vm_name || `VM ${pv.vm_id}`,
        replication_job_id: pv.replication_job_id,
        job_name: match?.job_name || pv.replication_job_id,
        job_status: match?.job_status || 'pending',
        storage_engine: match?.storage_engine || 'rbd',
        tier: (pv.tier || 3) as 1 | 2 | 3,
        boot_order: pv.boot_order || index + 1,
        source_cluster: plan.source_cluster,
        target_cluster: plan.target_cluster,
      }
    }))
  }, [open, plan, vmsByPair])

  // A guest may sit in several plans (a broad plan plus a narrow rehearsal
  // one): the picker says so under the guest rather than forbid it. Keyed by
  // cluster pair and vmid, since a vmid is only unique per cluster, and the
  // plan being edited does not count as "another" plan.
  const otherPlansByGuest = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const p of plans) {
      if (p.id === plan?.id) continue
      for (const pv of (p.vms || [])) {
        const key = `${p.source_cluster}→${p.target_cluster}:${pv.vm_id}`
        m.set(key, [...(m.get(key) || []), p.name])
      }
    }
    return m
  }, [plans, plan])

  // Determine which cluster pair is locked (from first assigned VM)
  const lockedPair = useMemo(() => {
    if (vmAssignments.length === 0) return null
    return { source: vmAssignments[0].source_cluster, target: vmAssignments[0].target_cluster }
  }, [vmAssignments])

  const toggleVM = (vm: ReplicatedVM, source: string, target: string) => {
    if (vmAssignments.find(v => v.vm_id === vm.vm_id && v.replication_job_id === vm.replication_job_id)) {
      // Remove
      setVmAssignments(prev => prev.filter(v => !(v.vm_id === vm.vm_id && v.replication_job_id === vm.replication_job_id)).map((v, i) => ({ ...v, boot_order: i + 1 })))
    } else {
      // Add
      setVmAssignments(prev => [...prev, {
        ...vm,
        tier: 3,
        boot_order: prev.length + 1,
        source_cluster: source,
        target_cluster: target
      }])
    }
  }

  const removeVM = (vm: ReplicatedVM) => {
    setVmAssignments(prev => prev.filter(v => !(v.vm_id === vm.vm_id && v.replication_job_id === vm.replication_job_id)).map((v, i) => ({ ...v, boot_order: i + 1 })))
  }

  const updateTier = (vm: ReplicatedVM, tier: 1 | 2 | 3) => {
    setVmAssignments(prev => prev.map(v => v.vm_id === vm.vm_id && v.replication_job_id === vm.replication_job_id ? { ...v, tier } : v))
  }

  const handleSubmit = () => {
    if (!lockedPair) return
    onSubmit({
      name,
      description,
      source_cluster: lockedPair.source,
      target_cluster: lockedPair.target,
      vms: vmAssignments.map(v => ({ vm_id: v.vm_id, tier: v.tier, boot_order: v.boot_order, replication_job_id: v.replication_job_id }))
    })
    handleClose()
  }

  const editing = !!plan

  const handleClose = () => {
    setPage(0)
    setName('')
    setDescription('')
    setVmAssignments([])
    onClose()
  }

  const tierColors = { 1: 'error', 2: 'warning', 3: 'default' } as const
  const pairEntries = Object.entries(vmsByPair)
  const allRows = pairEntries.flatMap(([key, group]) => group.vms.map(vm => ({ ...vm, pair: key })))
  const pageRows = new Set(allRows.slice(page * 10, page * 10 + 10).map(vm => `${vm.pair}:${vm.replication_job_id}:${vm.vm_id}`))

  return (
    <Dialog open={open} onClose={handleClose} maxWidth='sm' fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>
        {editing ? t('siteRecovery.createPlan.editTitle') : t('siteRecovery.createPlan.title')}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          {/* Plan Name */}
          <TextField
            label={t('siteRecovery.createPlan.name')}
            value={name}
            onChange={e => setName(e.target.value)}
            size='small'
            fullWidth
            required
          />

          {/* Description */}
          <TextField
            label={t('siteRecovery.createPlan.description')}
            value={description}
            onChange={e => setDescription(e.target.value)}
            size='small'
            fullWidth
            multiline
            rows={2}
          />

          {/* Replicated VMs selection */}
          <Box>
            <Typography variant='subtitle2' sx={{ mb: 1 }}>{t('siteRecovery.createPlan.selectReplicatedVMs')}</Typography>

            {pairEntries.length === 0 && (
              <Typography variant='body2' sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
                {t('siteRecovery.createPlan.noReplicatedVMs')}
              </Typography>
            )}

            {pairEntries.map(([key, group]) => {
              const pairDisabled = lockedPair !== null && (lockedPair.source !== group.source || lockedPair.target !== group.target)
              if (!group.vms.some(vm => pageRows.has(`${key}:${vm.replication_job_id}:${vm.vm_id}`))) return null
              return (
                <Box key={key} sx={{ mb: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
                    <i className='ri-arrow-left-right-line' style={{ fontSize: 14, color: pairDisabled ? '#a1a1aa' : '#3b82f6' }} />
                    <Typography variant='caption' sx={{ color: pairDisabled ? 'text.disabled' : 'text.secondary', fontWeight: 600 }}>
                      {connMap[group.source] || group.source} → {connMap[group.target] || group.target}
                    </Typography>
                  </Box>
                  <Stack spacing={0.5}>
                    {group.vms.filter(vm => pageRows.has(`${key}:${vm.replication_job_id}:${vm.vm_id}`)).map(vm => {
                      const selected = !!vmAssignments.find(v => v.vm_id === vm.vm_id && v.replication_job_id === vm.replication_job_id)
                      const otherPlans = otherPlansByGuest.get(`${key}:${vm.vm_id}`)
                      return (
                        <Box
                          key={`${vm.replication_job_id}:${vm.vm_id}`}
                          onClick={() => !pairDisabled && toggleVM(vm, group.source, group.target)}
                          sx={{
                            display: 'flex', alignItems: 'center', gap: 0.5,
                            p: 0.5, pl: 0, borderRadius: 1,
                            cursor: pairDisabled ? 'default' : 'pointer',
                            opacity: pairDisabled ? 0.4 : 1,
                            '&:hover': pairDisabled ? {} : { bgcolor: 'action.hover' }
                          }}
                        >
                          <Checkbox inputProps={{ 'aria-label': `${vm.vm_name} (${vm.vm_id}) · ${vm.job_name}` }} size='small' checked={selected} disabled={pairDisabled} sx={{ p: 0.5 }} />
                          <EngineGlyph engine={vm.storage_engine} size={16} />
                          <Box component='span' sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: vm.job_status === 'error' ? 'error.main' : vm.job_status === 'syncing' ? 'primary.main' : vm.job_status === 'synced' ? 'success.main' : 'text.disabled' }} />
                          <Box sx={{ minWidth: 0 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                              <Typography variant='body2' noWrap sx={{ fontWeight: selected ? 600 : 400 }}>
                                {vm.vm_name}
                              </Typography>
                              <Typography variant='caption' sx={{ color: 'text.disabled', ml: 0.5 }}>
                                ({vm.vm_id})
                              </Typography>
                            </Box>
                            {otherPlans && (
                              <Typography variant='caption' color='text.secondary' noWrap sx={{ display: 'block' }}>
                                {t('siteRecovery.createPlan.vmInOtherPlans', { plans: otherPlans.join(', ') })}
                              </Typography>
                            )}
                          </Box>
                          <Typography variant='caption' noWrap aria-label={t('siteRecovery.plans.jobColumn')} sx={{ ml: 'auto' }}>{vm.job_name}</Typography>
                        </Box>
                      )
                    })}
                  </Stack>
                </Box>
              )
            })}
          </Box>

          {allRows.length > 10 && <TablePagination component='div' count={allRows.length} page={page} rowsPerPage={10} rowsPerPageOptions={[10]} onPageChange={(_, value) => setPage(value)} />}

          {/* Assigned VMs — tier & boot order */}
          {vmAssignments.length > 0 && (
            <Box>
              <Typography variant='subtitle2' sx={{ mb: 1 }}>{t('siteRecovery.createPlan.assignVMs')}</Typography>
              <Stack spacing={0.75}>
                {vmAssignments.map(vm => (
                  <Box key={`${vm.replication_job_id}:${vm.vm_id}`} sx={{
                    display: 'flex', alignItems: 'center', gap: 1,
                    p: 1, borderRadius: 1, border: '1px solid', borderColor: 'divider'
                  }}>
                    <Typography variant='caption' sx={{ color: 'text.secondary', width: 24, textAlign: 'center' }}>
                      #{vm.boot_order}
                    </Typography>
                    <Typography variant='body2' sx={{ flex: 1, fontWeight: 500 }}>{vm.vm_name} · {vm.job_name}</Typography>
                    <Select
                      value={vm.tier}
                      onChange={e => updateTier(vm, Number(e.target.value) as 1 | 2 | 3)}
                      size='small'
                      sx={{ minWidth: 80, height: 28 }}
                    >
                      <MenuItem value={1}>T1</MenuItem>
                      <MenuItem value={2}>T2</MenuItem>
                      <MenuItem value={3}>T3</MenuItem>
                    </Select>
                    <Chip size='small' label={`T${vm.tier}`} color={tierColors[vm.tier]} variant='outlined' sx={{ height: 20, fontSize: '0.65rem' }} />
                    <Box
                      onClick={() => removeVM(vm)}
                      sx={{ cursor: 'pointer', color: 'text.secondary', '&:hover': { color: 'error.main' } }}
                    >
                      <i className='ri-close-line' style={{ fontSize: 16 }} />
                    </Box>
                  </Box>
                ))}
              </Stack>
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose}>{t('common.cancel')}</Button>
        <Button
          variant='contained'
          onClick={handleSubmit}
          disabled={!name || vmAssignments.length === 0}
        >
          {editing ? t('common.save') : t('siteRecovery.createPlan.create')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
