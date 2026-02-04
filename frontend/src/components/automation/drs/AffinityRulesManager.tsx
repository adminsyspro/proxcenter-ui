'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Chip,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Switch,
  FormControlLabel,
  Tooltip,
  Alert,
  Autocomplete,
  CircularProgress,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import LocalOfferIcon from '@mui/icons-material/LocalOffer'
import GroupWorkIcon from '@mui/icons-material/GroupWork'
import CallSplitIcon from '@mui/icons-material/CallSplit'
import PushPinIcon from '@mui/icons-material/PushPin'
import InfoIcon from '@mui/icons-material/Info'

// ============================================
// Types
// ============================================

export interface AffinityRule {
  id: string
  name: string
  type: 'affinity' | 'anti-affinity' | 'node-affinity'
  connectionId: string
  enabled: boolean
  required: boolean
  vmids: number[]
  nodes: string[]
  fromTag?: boolean
  fromPool?: boolean
}

export interface VMInfo {
  vmid: number
  name: string
  node: string
  type: 'qemu' | 'lxc'
  connectionId: string
}

interface AffinityRulesManagerProps {
  rules: AffinityRule[]
  vms: VMInfo[]
  nodes: string[]
  connectionId: string
  onCreateRule: (rule: Omit<AffinityRule, 'id'>) => Promise<void>
  onUpdateRule: (id: string, rule: Partial<AffinityRule>) => Promise<void>
  onDeleteRule: (id: string) => Promise<void>
  loading?: boolean
}

// ============================================
// Component
// ============================================

export default function AffinityRulesManager({
  rules,
  vms,
  nodes,
  connectionId,
  onCreateRule,
  onUpdateRule,
  onDeleteRule,
  loading = false,
}: AffinityRulesManagerProps) {
  const t = useTranslations()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<AffinityRule | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    type: 'affinity' as AffinityRule['type'],
    enabled: true,
    required: false,
    vmids: [] as number[],
    nodes: [] as string[],
  })

  const resetForm = () => {
    setFormData({
      name: '',
      type: 'affinity',
      enabled: true,
      required: false,
      vmids: [],
      nodes: [],
    })
    setEditingRule(null)
  }

  const openCreateDialog = () => {
    resetForm()
    setDialogOpen(true)
  }

  const openEditDialog = (rule: AffinityRule) => {
    setEditingRule(rule)
    setFormData({
      name: rule.name,
      type: rule.type,
      enabled: rule.enabled,
      required: rule.required,
      vmids: rule.vmids || [],
      nodes: rule.nodes || [],
    })
    setDialogOpen(true)
  }

  const handleSave = async () => {
    setSaving(true)

    try {
      if (editingRule) {
        await onUpdateRule(editingRule.id, {
          ...formData,
          connectionId,
        })
      } else {
        await onCreateRule({
          ...formData,
          connectionId,
        })
      }

      setDialogOpen(false)
      resetForm()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    setSaving(true)

    try {
      await onDeleteRule(id)
    } finally {
      setSaving(false)
      setDeleteConfirmId(null)
    }
  }

  const handleToggleEnabled = async (rule: AffinityRule) => {
    await onUpdateRule(rule.id, { enabled: !rule.enabled })
  }

  const getTypeIcon = (type: AffinityRule['type']) => {
    switch (type) {
      case 'affinity':
        return <GroupWorkIcon sx={{ color: 'success.main' }} fontSize="small" />
      case 'anti-affinity':
        return <CallSplitIcon sx={{ color: 'error.main' }} fontSize="small" />
      case 'node-affinity':
        return <PushPinIcon sx={{ color: 'info.main' }} fontSize="small" />
    }
  }

  const getTypeLabel = (type: AffinityRule['type']) => {
    switch (type) {
      case 'affinity':
        return t('drsPage.typeAffinity')
      case 'anti-affinity':
        return t('drsPage.typeAntiAffinity')
      case 'node-affinity':
        return t('drsPage.typeNodeAffinity')
    }
  }

  const getTypeColor = (type: AffinityRule['type']): 'success' | 'error' | 'info' => {
    switch (type) {
      case 'affinity':
        return 'success'
      case 'anti-affinity':
        return 'error'
      case 'node-affinity':
        return 'info'
    }
  }

  // Separate rules by source
  const manualRules = rules.filter(r => !r.fromTag && !r.fromPool)
  const tagRules = rules.filter(r => r.fromTag)
  const poolRules = rules.filter(r => r.fromPool)

  if (loading) {
    return (
      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <LocalOfferIcon color="primary" />
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                {t('drs.affinityRules')}
              </Typography>
            </Box>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={openCreateDialog}
              size="small"
            >
              {t('drs.addRule')}
            </Button>
          </Box>

          {/* Tag-based rules info */}
          {tagRules.length > 0 && (
            <Alert severity="info" sx={{ mb: 2 }} icon={<InfoIcon />}>
              <Typography variant="body2" dangerouslySetInnerHTML={{
                __html: t('drsPage.rulesFromTags', { count: tagRules.length })
              }} />
            </Alert>
          )}

          {/* Pool-based rules info */}
          {poolRules.length > 0 && (
            <Alert severity="info" sx={{ mb: 2 }} icon={<InfoIcon />}>
              <Typography variant="body2" dangerouslySetInnerHTML={{
                __html: t('drsPage.rulesFromPools', { count: poolRules.length })
              }} />
            </Alert>
          )}

          {/* Rules table */}
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell width={60}>{t('common.active')}</TableCell>
                  <TableCell>{t('common.name')}</TableCell>
                  <TableCell width={130}>{t('common.type')}</TableCell>
                  <TableCell>Guests</TableCell>
                  <TableCell>{t('inventory.nodes')}</TableCell>
                  <TableCell width={80}>{t('replication.source')}</TableCell>
                  <TableCell width={100} align="right">{t('common.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rules.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                      <Typography color="text.secondary">
                        {t('drsPage.noAffinityRules')}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t('drsPage.noAffinityRulesDesc')}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  rules.map((rule) => (
                    <TableRow key={rule.id} hover>
                      <TableCell>
                        <Switch
                          size="small"
                          checked={rule.enabled}
                          onChange={() => handleToggleEnabled(rule)}
                          disabled={rule.fromTag || rule.fromPool}
                        />
                      </TableCell>
                      <TableCell>
                        <Box>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {rule.name}
                          </Typography>
                          {rule.required && (
                            <Chip label="Obligatoire" size="small" color="error" sx={{ mt: 0.5, height: 18, fontSize: '0.65rem' }} />
                          )}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Chip
                          icon={getTypeIcon(rule.type)}
                          label={getTypeLabel(rule.type)}
                          size="small"
                          color={getTypeColor(rule.type)}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                          {rule.vmids?.slice(0, 3).map(vmid => {
                            const vm = vms.find(v => v.vmid === vmid)

                            
return (
                              <Chip
                                key={vmid}
                                label={vm?.name || `ID ${vmid}`}
                                size="small"
                                variant="outlined"
                                sx={{ height: 22, fontSize: '0.7rem' }}
                              />
                            )
                          })}
                          {(rule.vmids?.length || 0) > 3 && (
                            <Chip 
                              label={`+${rule.vmids.length - 3}`} 
                              size="small" 
                              sx={{ height: 22, fontSize: '0.7rem' }}
                            />
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell>
                        {rule.nodes?.length > 0 ? (
                          <Stack direction="row" spacing={0.5} flexWrap="wrap">
                            {rule.nodes.slice(0, 2).map(node => (
                              <Chip 
                                key={node} 
                                label={node} 
                                size="small" 
                                variant="outlined"
                                sx={{ height: 22, fontSize: '0.7rem' }}
                              />
                            ))}
                            {rule.nodes.length > 2 && (
                              <Chip 
                                label={`+${rule.nodes.length - 2}`} 
                                size="small"
                                sx={{ height: 22, fontSize: '0.7rem' }}
                              />
                            )}
                          </Stack>
                        ) : (
                          <Typography variant="caption" color="text.secondary">—</Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={rule.fromTag ? 'Tag' : rule.fromPool ? 'Pool' : 'Manuel'}
                          size="small"
                          color={rule.fromTag ? 'secondary' : rule.fromPool ? 'info' : 'default'}
                          variant="outlined"
                          sx={{ height: 22, fontSize: '0.7rem' }}
                        />
                      </TableCell>
                      <TableCell align="right">
                        {!rule.fromTag && !rule.fromPool && (
                          <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                            <Tooltip title={t('common.edit')}>
                              <IconButton size="small" onClick={() => openEditDialog(rule)}>
                                <EditIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title={t('common.delete')}>
                              <IconButton
                                size="small"
                                color="error"
                                onClick={() => setDeleteConfirmId(rule.id)}
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </Stack>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingRule ? t('drs.editRule') : t('drs.addRule')}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              fullWidth
              label={t('drsPage.ruleName')}
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              size="small"
              placeholder="Ex: DB Cluster Anti-Affinity"
            />

            <FormControl fullWidth size="small">
              <InputLabel>{t('drsPage.ruleType')}</InputLabel>
              <Select
                value={formData.type}
                label={t('drsPage.ruleType')}
                onChange={(e) => setFormData({ ...formData, type: e.target.value as AffinityRule['type'] })}
              >
                <MenuItem value="affinity">
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <GroupWorkIcon color="success" fontSize="small" />
                    <Box>
                      <Typography variant="body2">{t('drsPage.typeAffinity')}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t('drsPage.affinityDesc')}
                      </Typography>
                    </Box>
                  </Box>
                </MenuItem>
                <MenuItem value="anti-affinity">
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CallSplitIcon color="error" fontSize="small" />
                    <Box>
                      <Typography variant="body2">{t('drsPage.typeAntiAffinity')}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t('drsPage.antiAffinityDesc')}
                      </Typography>
                    </Box>
                  </Box>
                </MenuItem>
                <MenuItem value="node-affinity">
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <PushPinIcon color="info" fontSize="small" />
                    <Box>
                      <Typography variant="body2">{t('drsPage.typeNodeAffinity')}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t('drsPage.nodeAffinityDesc')}
                      </Typography>
                    </Box>
                  </Box>
                </MenuItem>
              </Select>
            </FormControl>

            <Autocomplete
              multiple
              options={vms.filter(v => v.connectionId === connectionId)}
              getOptionLabel={(vm) => `${vm.name} (${vm.vmid})`}
              value={vms.filter(vm => formData.vmids.includes(vm.vmid))}
              onChange={(_, newValue) => setFormData({ ...formData, vmids: newValue.map(v => v.vmid) })}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={t('drsPage.affectedGuests')}
                  size="small"
                  placeholder={t('drsPage.selectAtLeastTwoGuests')}
                />
              )}
              renderTags={(value, getTagProps) =>
                value.map((vm, index) => (
                  <Chip
                    {...getTagProps({ index })}
                    key={vm.vmid}
                    label={`${vm.name} (${vm.vmid})`}
                    size="small"
                  />
                ))
              }
            />

            {formData.type === 'node-affinity' && (
              <Autocomplete
                multiple
                options={nodes}
                value={formData.nodes}
                onChange={(_, newValue) => setFormData({ ...formData, nodes: newValue })}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={t('drs.allowedNodes')}
                    size="small"
                    placeholder={t('common.select')}
                  />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((node, index) => (
                    <Chip
                      {...getTagProps({ index })}
                      key={node}
                      label={node}
                      size="small"
                    />
                  ))
                }
              />
            )}

            <Box>
              <FormControlLabel
                control={
                  <Switch
                    checked={formData.enabled}
                    onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                  />
                }
                label={t('drsPage.ruleEnabled')}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={formData.required}
                    onChange={(e) => setFormData({ ...formData, required: e.target.checked })}
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2">{t('drsPage.ruleRequired')}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t('drsPage.ruleRequiredDesc')}
                    </Typography>
                  </Box>
                }
              />
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={saving || !formData.name || formData.vmids.length < 2}
          >
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirmId} onClose={() => setDeleteConfirmId(null)}>
        <DialogTitle>{t('drs.deleteAffinityRule')}</DialogTitle>
        <DialogContent>
          <Typography>
            {t('common.deleteConfirmation')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmId(null)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
            disabled={saving}
          >
            {saving ? t('common.deleting') : t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
