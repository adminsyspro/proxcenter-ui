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
// RemixIcon replacements for @mui/icons-material
const AddIcon = (props: any) => <i className="ri-add-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const EditIcon = (props: any) => <i className="ri-pencil-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const DeleteIcon = (props: any) => <i className="ri-delete-bin-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const LocalOfferIcon = (props: any) => <i className="ri-price-tag-3-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const GroupWorkIcon = (props: any) => <i className="ri-group-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const CallSplitIcon = (props: any) => <i className="ri-git-branch-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const PushPinIcon = (props: any) => <i className="ri-pushpin-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const InfoIcon = (props: any) => <i className="ri-information-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const ShieldCheckIcon = (props: any) => <i className="ri-shield-check-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const CheckDoubleIcon = (props: any) => <i className="ri-check-double-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const ArrowRightIcon = (props: any) => <i className="ri-arrow-right-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />

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

interface RuleAnalysis {
  satisfied: boolean
  currentPlacement: { vmid: number; name: string; node: string }[]
  violations: string[]
  requiredMigrations: { vmid: number; name: string; fromNode: string; toNode: string }[]
}

function analyzeRule(rule: AffinityRule, vms: VMInfo[], allNodes: string[]): RuleAnalysis {
  const ruleVMs = rule.vmids
    .map(vmid => vms.find(v => v.vmid === vmid))
    .filter((v): v is VMInfo => !!v)

  const currentPlacement = ruleVMs.map(vm => ({
    vmid: vm.vmid,
    name: vm.name,
    node: vm.node,
  }))

  const violations: string[] = []
  const requiredMigrations: RuleAnalysis['requiredMigrations'] = []

  if (rule.type === 'affinity') {
    // All VMs must be on the same node
    const nodeCount: Record<string, number> = {}
    for (const vm of ruleVMs) {
      nodeCount[vm.node] = (nodeCount[vm.node] || 0) + 1
    }
    const targetNode = Object.entries(nodeCount).sort((a, b) => b[1] - a[1])[0]?.[0]
    if (targetNode) {
      for (const vm of ruleVMs) {
        if (vm.node !== targetNode) {
          violations.push(`${vm.name} (${vm.vmid}) is on ${vm.node}, should be on ${targetNode}`)
          requiredMigrations.push({ vmid: vm.vmid, name: vm.name, fromNode: vm.node, toNode: targetNode })
        }
      }
    }
  } else if (rule.type === 'anti-affinity') {
    // No two VMs should share a node
    const nodeGroups: Record<string, VMInfo[]> = {}
    for (const vm of ruleVMs) {
      if (!nodeGroups[vm.node]) nodeGroups[vm.node] = []
      nodeGroups[vm.node].push(vm)
    }
    const usedNodes = new Set(ruleVMs.map(v => v.node))
    const availableNodes = allNodes.filter(n => !usedNodes.has(n))
    let availIdx = 0
    for (const [node, group] of Object.entries(nodeGroups)) {
      if (group.length > 1) {
        // Keep the first VM on this node, migrate the rest
        for (let i = 1; i < group.length; i++) {
          const vm = group[i]
          const targetNode = availableNodes[availIdx] || allNodes.find(n => n !== node) || node
          if (availableNodes[availIdx]) availIdx++
          violations.push(`${vm.name} (${vm.vmid}) shares node ${node} with ${group[0].name}`)
          requiredMigrations.push({ vmid: vm.vmid, name: vm.name, fromNode: node, toNode: targetNode })
        }
      }
    }
  } else if (rule.type === 'node-affinity') {
    // All VMs must be on one of rule.nodes
    const allowedNodes = rule.nodes || []
    const targetNode = allowedNodes[0] || ''
    for (const vm of ruleVMs) {
      if (!allowedNodes.includes(vm.node)) {
        violations.push(`${vm.name} (${vm.vmid}) is on ${vm.node}, should be on ${allowedNodes.join(' or ')}`)
        requiredMigrations.push({ vmid: vm.vmid, name: vm.name, fromNode: vm.node, toNode: targetNode })
      }
    }
  }

  return { satisfied: violations.length === 0, currentPlacement, violations, requiredMigrations }
}

interface AffinityRulesManagerProps {
  rules: AffinityRule[]
  vms: VMInfo[]
  nodes: string[]
  connectionId: string
  onCreateRule: (rule: Omit<AffinityRule, 'id'>) => Promise<void>
  onUpdateRule: (id: string, rule: Partial<AffinityRule>) => Promise<void>
  onDeleteRule: (id: string) => Promise<void>
  onEnforceRule?: (ruleId: string) => Promise<any>
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
  onEnforceRule,
  loading = false,
}: AffinityRulesManagerProps) {
  const t = useTranslations()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<AffinityRule | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [analyzeDialogOpen, setAnalyzeDialogOpen] = useState(false)
  const [analyzingRule, setAnalyzingRule] = useState<AffinityRule | null>(null)
  const [analysis, setAnalysis] = useState<RuleAnalysis | null>(null)
  const [enforcing, setEnforcing] = useState(false)

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
    await onUpdateRule(rule.id, { ...rule, enabled: !rule.enabled })
  }

  const openAnalyzeDialog = (rule: AffinityRule) => {
    const result = analyzeRule(rule, vms, nodes)
    setAnalyzingRule(rule)
    setAnalysis(result)
    setAnalyzeDialogOpen(true)
  }

  const handleEnforce = async () => {
    if (!analyzingRule || !onEnforceRule) return
    setEnforcing(true)
    try {
      await onEnforceRule(analyzingRule.id)
      setAnalyzeDialogOpen(false)
      setAnalyzingRule(null)
      setAnalysis(null)
    } finally {
      setEnforcing(false)
    }
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
                  <TableCell width={80}>{t('common.source')}</TableCell>
                  <TableCell width={130} align="right">{t('common.actions')}</TableCell>
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
                            <Chip label={t('drsPage.required')} size="small" color="error" sx={{ mt: 0.5, height: 18, fontSize: '0.65rem' }} />
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
                            const icon = vm?.type === 'lxc' ? 'ri-instance-line' : 'ri-computer-line'

                            return (
                              <Chip
                                key={vmid}
                                icon={<i className={icon} style={{ fontSize: 14 }} />}
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
                          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                            {rule.nodes.slice(0, 3).map(node => (
                              <Chip
                                key={node}
                                label={node}
                                size="small"
                                variant="outlined"
                                sx={{ height: 22, fontSize: '0.7rem' }}
                              />
                            ))}
                            {rule.nodes.length > 3 && (
                              <Tooltip title={rule.nodes.join(', ')} arrow>
                                <Chip
                                  label={`+${rule.nodes.length - 3}`}
                                  size="small"
                                  sx={{ height: 22, fontSize: '0.7rem' }}
                                />
                              </Tooltip>
                            )}
                          </Stack>
                        ) : (
                          <Typography variant="caption" color="text.secondary">—</Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={rule.fromTag ? 'Tag' : rule.fromPool ? 'Pool' : t('drsPage.manual')}
                          size="small"
                          color={rule.fromTag ? 'secondary' : rule.fromPool ? 'info' : 'default'}
                          variant="outlined"
                          sx={{ height: 22, fontSize: '0.7rem' }}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                          <Tooltip title={t('drsPage.enforceThisRule')}>
                            <span>
                              <IconButton
                                size="small"
                                color="warning"
                                onClick={() => openAnalyzeDialog(rule)}
                                disabled={!rule.enabled}
                              >
                                <ShieldCheckIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                          {!rule.fromTag && !rule.fromPool && (
                            <>
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
                            </>
                          )}
                        </Stack>
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
              renderOption={(props, vm) => (
                <li {...props} key={vm.vmid}>
                  <i className={vm.type === 'lxc' ? 'ri-instance-line' : 'ri-computer-line'} style={{ fontSize: 16, marginRight: 8, opacity: 0.7 }} />
                  {vm.name} ({vm.vmid})
                </li>
              )}
              renderTags={(value, getTagProps) =>
                value.map((vm, index) => (
                  <Chip
                    {...getTagProps({ index })}
                    key={vm.vmid}
                    icon={<i className={vm.type === 'lxc' ? 'ri-instance-line' : 'ri-computer-line'} style={{ fontSize: 14 }} />}
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

      {/* Rule Analysis Dialog */}
      <Dialog
        open={analyzeDialogOpen}
        onClose={() => { setAnalyzeDialogOpen(false); setAnalyzingRule(null); setAnalysis(null) }}
        maxWidth="sm"
        fullWidth
      >
        {analyzingRule && analysis && (
          <>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
                {analyzingRule.name}
              </Typography>
              <Chip
                icon={getTypeIcon(analyzingRule.type)}
                label={getTypeLabel(analyzingRule.type)}
                size="small"
                color={getTypeColor(analyzingRule.type)}
                variant="outlined"
              />
            </DialogTitle>
            <DialogContent>
              <Stack spacing={2.5}>
                {/* Current Placement */}
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                    {t('drsPage.currentPlacement')}
                  </Typography>
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Guest</TableCell>
                          <TableCell>{t('inventory.nodes')}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {analysis.currentPlacement.map(vm => (
                          <TableRow key={vm.vmid}>
                            <TableCell>
                              <Typography variant="body2">{vm.name} ({vm.vmid})</Typography>
                            </TableCell>
                            <TableCell>
                              <Chip label={vm.node} size="small" variant="outlined" sx={{ height: 22, fontSize: '0.7rem' }} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>

                {/* Status */}
                {analysis.satisfied ? (
                  <Alert severity="success" icon={<CheckDoubleIcon />}>
                    {t('drsPage.ruleSatisfied')}
                  </Alert>
                ) : (
                  <>
                    <Alert severity="warning">
                      {t('drsPage.ruleViolated')}
                    </Alert>

                    {/* Required Migrations */}
                    <Box>
                      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                        {t('drsPage.requiredMigrations')}
                      </Typography>
                      <TableContainer component={Paper} variant="outlined">
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Guest</TableCell>
                              <TableCell>{t('drsPage.fromNode')}</TableCell>
                              <TableCell width={30}></TableCell>
                              <TableCell>{t('drsPage.toNode')}</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {analysis.requiredMigrations.map(m => (
                              <TableRow key={m.vmid}>
                                <TableCell>
                                  <Typography variant="body2">{m.name} ({m.vmid})</Typography>
                                </TableCell>
                                <TableCell>
                                  <Chip label={m.fromNode} size="small" variant="outlined" color="error" sx={{ height: 22, fontSize: '0.7rem' }} />
                                </TableCell>
                                <TableCell>
                                  <ArrowRightIcon fontSize="small" />
                                </TableCell>
                                <TableCell>
                                  <Chip label={m.toNode} size="small" variant="outlined" color="success" sx={{ height: 22, fontSize: '0.7rem' }} />
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    </Box>
                  </>
                )}
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => { setAnalyzeDialogOpen(false); setAnalyzingRule(null); setAnalysis(null) }}>
                {analysis.satisfied ? t('common.close') : t('common.cancel')}
              </Button>
              {!analysis.satisfied && onEnforceRule && (
                <Button
                  variant="contained"
                  color="warning"
                  onClick={handleEnforce}
                  disabled={enforcing}
                  startIcon={enforcing ? <CircularProgress size={16} /> : <ShieldCheckIcon fontSize="small" />}
                >
                  {t('drsPage.enforceThisRule')}
                </Button>
              )}
            </DialogActions>
          </>
        )}
      </Dialog>
    </>
  )
}
