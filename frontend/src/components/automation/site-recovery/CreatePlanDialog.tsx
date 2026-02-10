'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
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
}

export default function CreatePlanDialog({ open, onClose, onSubmit, connections, jobs }: CreatePlanDialogProps) {
  const t = useTranslations()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [sourceCluster, setSourceCluster] = useState('')
  const [targetCluster, setTargetCluster] = useState('')
  const [vmAssignments, setVmAssignments] = useState<VMAssignment[]>([])

  // Filter jobs matching selected source cluster
  const availableJobs = (jobs || []).filter(j =>
    (!sourceCluster || j.source_cluster === sourceCluster) &&
    (!targetCluster || j.target_cluster === targetCluster)
  )

  const addVM = (job: ReplicationJob) => {
    if (vmAssignments.find(v => v.vm_id === job.vm_id)) return
    setVmAssignments(prev => [...prev, {
      vm_id: job.vm_id,
      vm_name: job.vm_name,
      tier: 3,
      boot_order: prev.length + 1
    }])
  }

  const removeVM = (vmId: number) => {
    setVmAssignments(prev => prev.filter(v => v.vm_id !== vmId).map((v, i) => ({ ...v, boot_order: i + 1 })))
  }

  const updateTier = (vmId: number, tier: 1 | 2 | 3) => {
    setVmAssignments(prev => prev.map(v => v.vm_id === vmId ? { ...v, tier } : v))
  }

  const handleSubmit = () => {
    onSubmit({
      name,
      description,
      source_cluster: sourceCluster,
      target_cluster: targetCluster,
      vms: vmAssignments.map(v => ({ vm_id: v.vm_id, tier: v.tier, boot_order: v.boot_order }))
    })
    handleClose()
  }

  const handleClose = () => {
    setName('')
    setDescription('')
    setSourceCluster('')
    setTargetCluster('')
    setVmAssignments([])
    onClose()
  }

  const tierColors = { 1: 'error', 2: 'warning', 3: 'default' } as const

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

          {/* Source Cluster */}
          <Box>
            <Typography variant='subtitle2' sx={{ mb: 0.5 }}>{t('siteRecovery.createPlan.sourceCluster')}</Typography>
            <Select value={sourceCluster} onChange={e => setSourceCluster(e.target.value)} size='small' fullWidth displayEmpty>
              <MenuItem value='' disabled>{t('siteRecovery.createPlan.selectCluster')}</MenuItem>
              {connections.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </Select>
          </Box>

          {/* Target Cluster */}
          <Box>
            <Typography variant='subtitle2' sx={{ mb: 0.5 }}>{t('siteRecovery.createPlan.targetCluster')}</Typography>
            <Select value={targetCluster} onChange={e => setTargetCluster(e.target.value)} size='small' fullWidth displayEmpty>
              <MenuItem value='' disabled>{t('siteRecovery.createPlan.selectCluster')}</MenuItem>
              {connections.filter(c => c.id !== sourceCluster).map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </Select>
          </Box>

          {/* VM Assignment */}
          <Box>
            <Typography variant='subtitle2' sx={{ mb: 1 }}>{t('siteRecovery.createPlan.assignVMs')}</Typography>

            {/* Available VMs from replication jobs */}
            {availableJobs.length > 0 && (
              <Box sx={{ mb: 1.5 }}>
                <Typography variant='caption' sx={{ color: 'text.secondary', mb: 0.5, display: 'block' }}>
                  {t('siteRecovery.createPlan.availableVMs')}
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  {availableJobs
                    .filter(j => !vmAssignments.find(v => v.vm_id === j.vm_id))
                    .map(j => (
                      <Chip
                        key={j.id}
                        label={j.vm_name}
                        size='small'
                        onClick={() => addVM(j)}
                        icon={<i className='ri-add-line' style={{ fontSize: 14 }} />}
                        sx={{ cursor: 'pointer' }}
                      />
                    ))}
                </Box>
              </Box>
            )}

            {/* Assigned VMs */}
            {vmAssignments.length > 0 && (
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
            )}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose}>{t('common.cancel')}</Button>
        <Button
          variant='contained'
          onClick={handleSubmit}
          disabled={!name || !sourceCluster || !targetCluster || vmAssignments.length === 0}
        >
          {t('siteRecovery.createPlan.create')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
