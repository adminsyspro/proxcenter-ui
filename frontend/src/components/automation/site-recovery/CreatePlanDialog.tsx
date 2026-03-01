'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  MenuItem, Select, Stack, TextField, Typography
} from '@mui/material'

import type { ReplicationJob, CreateRecoveryPlanRequest } from '@/lib/orchestrator/site-recovery.types'

// ── Main Component ─────────────────────────────────────────────────────

interface CreatePlanDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: CreateRecoveryPlanRequest) => void
  connections: Array<{ id: string; name: string; hasCeph: boolean }>
  jobs: ReplicationJob[]
}

interface VMAssignment {
  vm_id: number
  vm_name: string
  tier: 1 | 2 | 3
  boot_order: number
  source_cluster: string
  target_cluster: string
}

export default function CreatePlanDialog({ open, onClose, onSubmit, connections, jobs }: CreatePlanDialogProps) {
  const t = useTranslations()
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
    const groups: Record<string, { source: string; target: string; vms: { vm_id: number; vm_name: string }[] }> = {}
    for (const j of (jobs || [])) {
      const key = `${j.source_cluster}→${j.target_cluster}`
      if (!groups[key]) groups[key] = { source: j.source_cluster, target: j.target_cluster, vms: [] }
      const ids = j.vm_ids || []
      const names = j.vm_names || []
      for (let k = 0; k < ids.length; k++) {
        if (!groups[key].vms.find(v => v.vm_id === ids[k])) {
          groups[key].vms.push({ vm_id: ids[k], vm_name: names[k] || `VM ${ids[k]}` })
        }
      }
    }
    return groups
  }, [jobs])

  // Determine which cluster pair is locked (from first assigned VM)
  const lockedPair = useMemo(() => {
    if (vmAssignments.length === 0) return null
    return { source: vmAssignments[0].source_cluster, target: vmAssignments[0].target_cluster }
  }, [vmAssignments])

  const toggleVM = (vm: { vm_id: number; vm_name: string }, source: string, target: string) => {
    if (vmAssignments.find(v => v.vm_id === vm.vm_id)) {
      // Remove
      setVmAssignments(prev => prev.filter(v => v.vm_id !== vm.vm_id).map((v, i) => ({ ...v, boot_order: i + 1 })))
    } else {
      // Add
      setVmAssignments(prev => [...prev, {
        vm_id: vm.vm_id,
        vm_name: vm.vm_name,
        tier: 3,
        boot_order: prev.length + 1,
        source_cluster: source,
        target_cluster: target
      }])
    }
  }

  const removeVM = (vmId: number) => {
    setVmAssignments(prev => prev.filter(v => v.vm_id !== vmId).map((v, i) => ({ ...v, boot_order: i + 1 })))
  }

  const updateTier = (vmId: number, tier: 1 | 2 | 3) => {
    setVmAssignments(prev => prev.map(v => v.vm_id === vmId ? { ...v, tier } : v))
  }

  const handleSubmit = () => {
    if (!lockedPair) return
    onSubmit({
      name,
      description,
      source_cluster: lockedPair.source,
      target_cluster: lockedPair.target,
      vms: vmAssignments.map(v => ({ vm_id: v.vm_id, tier: v.tier, boot_order: v.boot_order }))
    })
    handleClose()
  }

  const handleClose = () => {
    setName('')
    setDescription('')
    setVmAssignments([])
    onClose()
  }

  const tierColors = { 1: 'error', 2: 'warning', 3: 'default' } as const
  const pairEntries = Object.entries(vmsByPair)

  return (
    <Dialog open={open} onClose={handleClose} maxWidth='sm' fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{t('siteRecovery.createPlan.title')}</DialogTitle>
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
              return (
                <Box key={key} sx={{ mb: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
                    <i className='ri-arrow-left-right-line' style={{ fontSize: 14, color: pairDisabled ? '#a1a1aa' : '#3b82f6' }} />
                    <Typography variant='caption' sx={{ color: pairDisabled ? 'text.disabled' : 'text.secondary', fontWeight: 600 }}>
                      {connMap[group.source] || group.source} → {connMap[group.target] || group.target}
                    </Typography>
                  </Box>
                  <Stack spacing={0.5}>
                    {group.vms.map(vm => {
                      const selected = !!vmAssignments.find(v => v.vm_id === vm.vm_id)
                      return (
                        <Box
                          key={vm.vm_id}
                          onClick={() => !pairDisabled && toggleVM(vm, group.source, group.target)}
                          sx={{
                            display: 'flex', alignItems: 'center', gap: 0.5,
                            p: 0.5, pl: 0, borderRadius: 1,
                            cursor: pairDisabled ? 'default' : 'pointer',
                            opacity: pairDisabled ? 0.4 : 1,
                            '&:hover': pairDisabled ? {} : { bgcolor: 'action.hover' }
                          }}
                        >
                          <Checkbox size='small' checked={selected} disabled={pairDisabled} sx={{ p: 0.5 }} />
                          <i className='ri-computer-line' style={{ fontSize: 14, color: '#71717a' }} />
                          <Typography variant='body2' sx={{ fontWeight: selected ? 600 : 400 }}>
                            {vm.vm_name}
                          </Typography>
                          <Typography variant='caption' sx={{ color: 'text.disabled', ml: 0.5 }}>
                            ({vm.vm_id})
                          </Typography>
                        </Box>
                      )
                    })}
                  </Stack>
                </Box>
              )
            })}
          </Box>

          {/* Assigned VMs — tier & boot order */}
          {vmAssignments.length > 0 && (
            <Box>
              <Typography variant='subtitle2' sx={{ mb: 1 }}>{t('siteRecovery.createPlan.assignVMs')}</Typography>
              <Stack spacing={0.75}>
                {vmAssignments.map(vm => (
                  <Box key={vm.vm_id} sx={{
                    display: 'flex', alignItems: 'center', gap: 1,
                    p: 1, borderRadius: 1, border: '1px solid', borderColor: 'divider'
                  }}>
                    <Typography variant='caption' sx={{ color: 'text.secondary', width: 24, textAlign: 'center' }}>
                      #{vm.boot_order}
                    </Typography>
                    <Typography variant='body2' sx={{ flex: 1, fontWeight: 500 }}>{vm.vm_name}</Typography>
                    <Select
                      value={vm.tier}
                      onChange={e => updateTier(vm.vm_id, Number(e.target.value) as 1 | 2 | 3)}
                      size='small'
                      sx={{ minWidth: 80, height: 28 }}
                    >
                      <MenuItem value={1}>T1</MenuItem>
                      <MenuItem value={2}>T2</MenuItem>
                      <MenuItem value={3}>T3</MenuItem>
                    </Select>
                    <Chip size='small' label={`T${vm.tier}`} color={tierColors[vm.tier]} variant='outlined' sx={{ height: 20, fontSize: '0.65rem' }} />
                    <Box
                      onClick={() => removeVM(vm.vm_id)}
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
          {t('siteRecovery.createPlan.create')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
