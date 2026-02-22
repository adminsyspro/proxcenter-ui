'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'
import { useLicense } from '@/contexts/LicenseContext'

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES
═══════════════════════════════════════════════════════════════════════════ */

interface FirewallRule {
  pos: number
  type: string
  action: string
  enable?: number
  source?: string
  dest?: string
  proto?: string
  dport?: string
  sport?: string
  macro?: string
  iface?: string
  log?: string
  comment?: string
}

interface FirewallOptions {
  enable?: number
  log_level_in?: string
  log_level_out?: string
  log_nf_conntrack?: number
  nf_conntrack_max?: number
  nosmurfs?: number
  policy_in?: string
  policy_out?: string
  protection_synflood?: number
  smurf_log_level?: string
  tcp_flags_log_level?: string
  tcpflags?: number
}

interface SecurityGroup {
  group: string
  name?: string
  comment?: string
  rules?: FirewallRule[]
}

interface Props {
  connectionId: string
  node: string
}

/* ═══════════════════════════════════════════════════════════════════════════
   HELPER COMPONENTS
═══════════════════════════════════════════════════════════════════════════ */

const ActionChip = ({ action }: { action: string }) => {
  const colors: Record<string, string> = { ACCEPT: '#22c55e', DROP: '#ef4444', REJECT: '#f59e0b' }
  const color = colors[action] || '#94a3b8'


return (
    <Chip
      size="small"
      label={action}
      sx={{
        height: 22,
        fontSize: 11,
        fontWeight: 700,
        bgcolor: alpha(color, 0.15),
        color,
        border: `1px solid ${alpha(color, 0.3)}`,
        minWidth: 70
      }}
    />
  )
}

const PolicyChip = ({ policy }: { policy: string }) => {
  const color = policy === 'DROP' ? '#ef4444' : policy === 'REJECT' ? '#f59e0b' : '#22c55e'


return (
    <Chip
      size="small"
      label={policy}
      sx={{
        height: 26,
        fontSize: 12,
        fontWeight: 700,
        bgcolor: alpha(color, 0.15),
        color
      }}
    />
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════════ */

export default function NodeFirewallTab({ connectionId, node }: Props) {
  const theme = useTheme()
  const t = useTranslations()
  const { isEnterprise } = useLicense()
  const monoStyle = { fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace', fontSize: 13 }

  // State
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' })

  // Firewall data
  const [options, setOptions] = useState<FirewallOptions>({})
  const [rules, setRules] = useState<FirewallRule[]>([])
  const [availableGroups, setAvailableGroups] = useState<SecurityGroup[]>([])

  // Drag & drop state
  const [draggedRule, setDraggedRule] = useState<number | null>(null)
  const [dragOverRule, setDragOverRule] = useState<number | null>(null)

  // Dialogs
  const [addRuleOpen, setAddRuleOpen] = useState(false)
  const [addGroupOpen, setAddGroupOpen] = useState(false)
  const [editRuleOpen, setEditRuleOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<FirewallRule | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [ruleToDelete, setRuleToDelete] = useState<number | null>(null)

  // Form state
  const [newRule, setNewRule] = useState<Partial<FirewallRule>>({
    type: 'in',
    action: 'ACCEPT',
    enable: 1,
    proto: '',
    dport: '',
    source: '',
    dest: '',
    comment: ''
  })

  const [selectedGroup, setSelectedGroup] = useState('')

  // Load firewall data
  const loadFirewallData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      // Load options
      const optRes = await fetch(`/api/v1/firewall/nodes/${connectionId}/${node}?type=options`)

      if (optRes.ok) {
        const optData = await optRes.json()

        setOptions(optData || {})
      }

      // Load rules
      const rulesRes = await fetch(`/api/v1/firewall/nodes/${connectionId}/${node}?type=rules`)

      if (rulesRes.ok) {
        const rulesData = await rulesRes.json()

        const normalizedRules = (Array.isArray(rulesData) ? rulesData : []).map((rule: any) => ({
          ...rule,
          enable: rule.enable === 1 || rule.enable === '1' ? 1 : 0
        }))

        setRules(normalizedRules)
      }

      // Load available security groups
      const groupsRes = await fetch(`/api/v1/firewall/groups/${connectionId}`)

      if (groupsRes.ok) {
        const groupsData = await groupsRes.json()

        setAvailableGroups(Array.isArray(groupsData) ? groupsData : [])
      }
    } catch (err: any) {
      setError(err.message || t('errors.loadingError'))
    } finally {
      setLoading(false)
    }
  }, [connectionId, node])

  // Load only rules (for quick refresh after move/toggle/delete)
  const loadRulesOnly = useCallback(async () => {
    try {
      const rulesRes = await fetch(`/api/v1/firewall/nodes/${connectionId}/${node}?type=rules`)

      if (rulesRes.ok) {
        const rulesData = await rulesRes.json()

        const normalizedRules = (Array.isArray(rulesData) ? rulesData : []).map((rule: any) => ({
          ...rule,
          enable: rule.enable === 1 || rule.enable === '1' ? 1 : 0
        }))

        setRules(normalizedRules)
      }
    } catch (err) {
      // Silently fail, user can refresh manually
    }
  }, [connectionId, node])

  useEffect(() => {
    if (!isEnterprise) return

    loadFirewallData()
  }, [loadFirewallData, isEnterprise])

  // Toggle firewall enable
  const handleToggleFirewall = async () => {
    setSaving(true)

    try {
      const newEnable = options.enable === 1 ? 0 : 1

      const res = await fetch(`/api/v1/firewall/nodes/${connectionId}/${node}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enable: newEnable })
      })

      if (!res.ok) throw new Error(t('errors.updateError'))
      setSnackbar({ open: true, message: `Firewall ${newEnable === 1 ? t('common.enabled') : t('common.disabled')}`, severity: 'success' })
      loadFirewallData()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  // Add rule
  const handleAddRule = async () => {
    setSaving(true)

    try {
      const res = await fetch(`/api/v1/firewall/nodes/${connectionId}/${node}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRule)
      })

      if (!res.ok) throw new Error(t('errors.addError'))
      setSnackbar({ open: true, message: t('network.addRule'), severity: 'success' })
      setAddRuleOpen(false)
      setNewRule({ type: 'in', action: 'ACCEPT', enable: 1, proto: '', dport: '', source: '', dest: '', comment: '' })
      loadFirewallData()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  // Add security group
  const handleAddSecurityGroup = async () => {
    if (!selectedGroup) return
    setSaving(true)

    try {
      const res = await fetch(`/api/v1/firewall/nodes/${connectionId}/${node}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'group', action: selectedGroup, enable: 1 })
      })

      if (!res.ok) throw new Error(t('errors.addError'))
      setSnackbar({ open: true, message: t('network.addSecurityGroup'), severity: 'success' })
      setAddGroupOpen(false)
      setSelectedGroup('')
      loadFirewallData()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  // Toggle rule enable
  const handleToggleRule = async (rule: FirewallRule) => {
    setSaving(true)

    try {
      const currentEnable = rule.enable === undefined ? 1 : (typeof rule.enable === 'string' ? parseInt(rule.enable, 10) : rule.enable)
      const newEnable = currentEnable === 1 ? 0 : 1

      const res = await fetch(`/api/v1/firewall/nodes/${connectionId}/${node}/rules/${rule.pos}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enable: newEnable })
      })

      const data = await res.json()

      if (!res.ok) throw new Error(data.error || t('common.error'))
      setSnackbar({ open: true, message: `${t('network.editRule')} ${newEnable === 0 ? t('common.disabled') : t('common.enabled')}`, severity: 'success' })
      loadRulesOnly()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  // Confirm delete rule
  const confirmDeleteRule = (pos: number) => {
    setRuleToDelete(pos)
    setDeleteConfirmOpen(true)
  }

  // Delete rule
  const handleDeleteRule = async () => {
    if (ruleToDelete === null) return
    setSaving(true)
    setDeleteConfirmOpen(false)

    try {
      const res = await fetch(`/api/v1/firewall/nodes/${connectionId}/${node}/rules/${ruleToDelete}`, {
        method: 'DELETE'
      })

      if (!res.ok) throw new Error(t('errors.deleteError'))
      setSnackbar({ open: true, message: t('common.delete'), severity: 'success' })
      setRuleToDelete(null)
      loadRulesOnly()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  // Move rule to new position
  const handleMoveRule = async (fromPos: number, toPos: number) => {
    if (fromPos === toPos) return
    setSaving(true)

    try {
      const res = await fetch(`/api/v1/firewall/nodes/${connectionId}/${node}/rules/${fromPos}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moveto: toPos })
      })

      if (!res.ok) throw new Error(t('errors.moveError'))
      setSnackbar({ open: true, message: t('network.editRule'), severity: 'success' })
      loadRulesOnly()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  // Drag & drop handlers
  const handleDragStart = (e: React.DragEvent, pos: number) => {
    setDraggedRule(pos)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', pos.toString())

    setTimeout(() => {
      const row = e.currentTarget as HTMLElement

      row.style.opacity = '0.5'
    }, 0)
  }

  const handleDragEnd = (e: React.DragEvent) => {
    const row = e.currentTarget as HTMLElement

    row.style.opacity = '1'
    setDraggedRule(null)
    setDragOverRule(null)
  }

  const handleDragOver = (e: React.DragEvent, pos: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'

    if (draggedRule !== null && draggedRule !== pos) {
      setDragOverRule(pos)
    }
  }

  const handleDragLeave = () => {
    setDragOverRule(null)
  }

  const handleDrop = (e: React.DragEvent, toPos: number) => {
    e.preventDefault()
    const fromPos = draggedRule

    setDraggedRule(null)
    setDragOverRule(null)

    if (fromPos !== null && fromPos !== toPos) {
      handleMoveRule(fromPos, toPos)
    }
  }

  // Update rule
  const handleUpdateRule = async () => {
    if (!editingRule) return
    setSaving(true)

    try {
      const res = await fetch(`/api/v1/firewall/nodes/${connectionId}/${node}/rules/${editingRule.pos}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingRule)
      })

      if (!res.ok) throw new Error(t('errors.updateError'))
      setSnackbar({ open: true, message: t('network.editRule'), severity: 'success' })
      setEditRuleOpen(false)
      setEditingRule(null)
      loadRulesOnly()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  // Enterprise guard
  if (!isEnterprise) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 8, textAlign: 'center' }}>
        <i className='ri-vip-crown-fill' style={{ fontSize: 48, color: 'var(--mui-palette-warning-main)', marginBottom: 16 }} />
        <Typography variant='h6' sx={{ mb: 1 }}>Enterprise Feature</Typography>
        <Typography variant='body2' sx={{ opacity: 0.6 }}>
          Node Firewall management requires an Enterprise license.
        </Typography>
      </Box>
    )
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>
    )
  }

  return (
    <Box sx={{ py: 2 }}>
      <Stack spacing={3}>
        {/* Options Card */}
        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className="ri-shield-keyhole-line" style={{ fontSize: 20 }} />
                Firewall
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  {options.enable === 1 ? t('common.active') : t('common.inactive')}
                </Typography>
                <Switch
                  checked={options.enable === 1}
                  onChange={handleToggleFirewall}
                  disabled={saving}
                  color="success"
                />
              </Box>
            </Box>

            {options.enable !== 1 && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                {t('security.firewall')} {t('common.disabled')}
              </Alert>
            )}

            <Grid container spacing={2}>
              <Grid size={{ xs: 6, sm: 3 }}>
                <Paper sx={{ p: 2, bgcolor: alpha(theme.palette.background.default, 0.5), textAlign: 'center' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    Policy IN
                  </Typography>
                  <PolicyChip policy={options.policy_in || 'ACCEPT'} />
                </Paper>
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <Paper sx={{ p: 2, bgcolor: alpha(theme.palette.background.default, 0.5), textAlign: 'center' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    Policy OUT
                  </Typography>
                  <PolicyChip policy={options.policy_out || 'ACCEPT'} />
                </Paper>
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <Paper sx={{ p: 2, bgcolor: alpha(theme.palette.background.default, 0.5), textAlign: 'center' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    NF Conntrack
                  </Typography>
                  <Chip
                    size="small"
                    label={options.nf_conntrack_max ? String(options.nf_conntrack_max) : 'Default'}
                    sx={{ height: 26 }}
                  />
                </Paper>
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <Paper sx={{ p: 2, bgcolor: alpha(theme.palette.background.default, 0.5), textAlign: 'center' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    TCP Flags
                  </Typography>
                  <Chip
                    size="small"
                    label={options.tcpflags === 1 ? t('common.enabled') : t('common.disabled')}
                    color={options.tcpflags === 1 ? 'success' : 'default'}
                    sx={{ height: 26 }}
                  />
                </Paper>
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {/* Unified Rules Card */}
        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className="ri-shield-line" style={{ fontSize: 20 }} />
                {t('security.firewall')}
                {rules.length > 0 && (
                  <Chip size="small" label={rules.length} sx={{ ml: 1, height: 20, fontSize: 11 }} />
                )}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<i className="ri-shield-check-line" />}
                  onClick={() => setAddGroupOpen(true)}
                  disabled={availableGroups.length === 0}
                >
                  Security Group
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<i className="ri-add-line" />}
                  onClick={() => setAddRuleOpen(true)}
                >
                  {t('network.addRule')}
                </Button>
              </Box>
            </Box>

            {rules.length === 0 ? (
              <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
                <i className="ri-shield-line" style={{ fontSize: 48, opacity: 0.3 }} />
                <Typography variant="body2" sx={{ mt: 1 }}>{t('common.noData')}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('network.addSecurityGroupOrRule')}
                </Typography>
              </Box>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: alpha(theme.palette.background.default, 0.5) }}>
                      <TableCell sx={{ fontWeight: 700, width: 30, p: 0.5 }}></TableCell>
                      <TableCell sx={{ fontWeight: 700, width: 35 }}>#</TableCell>
                      <TableCell sx={{ fontWeight: 700, width: 55 }}>Active</TableCell>
                      <TableCell sx={{ fontWeight: 700, width: 70 }}>Type</TableCell>
                      <TableCell sx={{ fontWeight: 700, width: 180 }}>Action</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Source</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Dest</TableCell>
                      <TableCell sx={{ fontWeight: 700, width: 60 }}>Proto</TableCell>
                      <TableCell sx={{ fontWeight: 700, width: 70 }}>Port</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>{t('network.comment')}</TableCell>
                      <TableCell sx={{ width: 90 }}></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rules.map((rule) => {
                      const isGroup = rule.type === 'group'
                      const groupName = isGroup ? (rule.action || 'Unknown') : null
                      const isDragging = draggedRule === rule.pos
                      const isDragOver = dragOverRule === rule.pos

                      return (
                        <TableRow
                          key={rule.pos}
                          hover
                          draggable
                          onDragStart={(e) => handleDragStart(e, rule.pos)}
                          onDragEnd={handleDragEnd}
                          onDragOver={(e) => handleDragOver(e, rule.pos)}
                          onDragLeave={handleDragLeave}
                          onDrop={(e) => handleDrop(e, rule.pos)}
                          sx={{
                            bgcolor: isGroup ? alpha(theme.palette.primary.main, 0.03) : 'transparent',
                            cursor: 'grab',
                            opacity: isDragging ? 0.5 : 1,
                            borderTop: isDragOver ? `2px solid ${theme.palette.primary.main}` : undefined,
                            transition: 'border-top 0.1s ease',
                            '&:hover': {
                              bgcolor: isGroup ? alpha(theme.palette.primary.main, 0.08) : undefined
                            },
                            '&:active': {
                              cursor: 'grabbing'
                            }
                          }}
                        >
                          <TableCell sx={{ p: 0.5, textAlign: 'center', cursor: 'grab' }}>
                            <i className="ri-draggable" style={{ fontSize: 16, color: theme.palette.text.disabled }} />
                          </TableCell>
                          <TableCell sx={{ color: 'text.secondary', fontSize: 11, p: 0.5 }}>
                            {rule.pos}
                          </TableCell>
                          <TableCell sx={{ p: 0.5 }}>
                            <Switch
                              size="small"
                              checked={rule.enable !== 0}
                              onChange={() => handleToggleRule(rule)}
                              disabled={saving}
                              color="success"
                            />
                          </TableCell>
                          <TableCell sx={{ p: 0.5 }}>
                            {isGroup ? (
                              <Chip
                                label="GROUP"
                                size="small"
                                sx={{
                                  fontSize: 10,
                                  height: 20,
                                  bgcolor: alpha(theme.palette.primary.main, 0.1),
                                  color: theme.palette.primary.main,
                                  fontWeight: 600
                                }}
                              />
                            ) : (
                              <Chip
                                label={rule.type?.toUpperCase()}
                                size="small"
                                variant="outlined"
                                sx={{ fontSize: 10, height: 20 }}
                              />
                            )}
                          </TableCell>
                          <TableCell sx={{ p: 0.5 }}>
                            {isGroup ? (
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <i className="ri-shield-check-line" style={{ fontSize: 14, color: theme.palette.primary.main, flexShrink: 0 }} />
                                <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' }}>
                                  {groupName}
                                </Typography>
                              </Box>
                            ) : (
                              <ActionChip action={rule.action || 'ACCEPT'} />
                            )}
                          </TableCell>
                          <TableCell sx={{ ...monoStyle, color: rule.source ? 'text.primary' : 'text.disabled', fontSize: 11, p: 0.5 }}>
                            {isGroup ? '-' : (rule.source || 'any')}
                          </TableCell>
                          <TableCell sx={{ ...monoStyle, color: rule.dest ? 'text.primary' : 'text.disabled', fontSize: 11, p: 0.5 }}>
                            {isGroup ? '-' : (rule.dest || 'any')}
                          </TableCell>
                          <TableCell sx={{ ...monoStyle, fontSize: 11, p: 0.5 }}>
                            {isGroup ? '-' : (rule.proto || 'any')}
                          </TableCell>
                          <TableCell sx={{ ...monoStyle, color: rule.dport ? 'text.primary' : 'text.disabled', fontSize: 11, p: 0.5 }}>
                            {isGroup ? '-' : (rule.dport || '-')}
                          </TableCell>
                          <TableCell sx={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', p: 0.5 }}>
                            <Tooltip title={rule.comment || ''}>
                              <span style={{ fontSize: 11 }}>{rule.comment || '-'}</span>
                            </Tooltip>
                          </TableCell>
                          <TableCell sx={{ p: 0.5 }}>
                            <Box sx={{ display: 'flex', gap: 0 }}>
                              <Tooltip title={t('common.edit')}>
                                <IconButton size="small" onClick={() => { setEditingRule(rule); setEditRuleOpen(true); }}>
                                  <i className="ri-edit-line" style={{ fontSize: 14 }} />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title={t('common.delete')}>
                                <IconButton size="small" color="error" onClick={() => confirmDeleteRule(rule.pos)}>
                                  <i className="ri-delete-bin-line" style={{ fontSize: 14 }} />
                                </IconButton>
                              </Tooltip>
                            </Box>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
              {t('network.rulesEvaluatedTopBottom')}
            </Typography>
          </CardContent>
        </Card>
      </Stack>

      {/* Add Rule Dialog */}
      <Dialog open={addRuleOpen} onClose={() => setAddRuleOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{t('network.addRule')}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid size={{ xs: 6, sm: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Type</InputLabel>
                <Select
                  value={newRule.type || 'in'}
                  label="Type"
                  onChange={(e) => setNewRule({ ...newRule, type: e.target.value })}
                >
                  <MenuItem value="in">IN</MenuItem>
                  <MenuItem value="out">OUT</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Action</InputLabel>
                <Select
                  value={newRule.action || 'ACCEPT'}
                  label="Action"
                  onChange={(e) => setNewRule({ ...newRule, action: e.target.value })}
                >
                  <MenuItem value="ACCEPT">ACCEPT</MenuItem>
                  <MenuItem value="DROP">DROP</MenuItem>
                  <MenuItem value="REJECT">REJECT</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>{t('network.protocol')}</InputLabel>
                <Select
                  value={newRule.proto || ''}
                  label={t('network.protocol')}
                  onChange={(e) => setNewRule({ ...newRule, proto: e.target.value })}
                >
                  <MenuItem value="">{t('network.allProtocols')}</MenuItem>
                  <MenuItem value="tcp">TCP</MenuItem>
                  <MenuItem value="udp">UDP</MenuItem>
                  <MenuItem value="icmp">ICMP</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField
                label={t('network.destPort')}
                value={newRule.dport || ''}
                onChange={(e) => setNewRule({ ...newRule, dport: e.target.value })}
                placeholder="22, 80:443"
                fullWidth
                size="small"
                InputProps={{ sx: monoStyle }}
              />
            </Grid>
            <Grid size={{ xs: 6 }}>
              <TextField
                label="Source"
                value={newRule.source || ''}
                onChange={(e) => setNewRule({ ...newRule, source: e.target.value })}
                placeholder="any, 10.0.0.0/8, alias"
                fullWidth
                size="small"
                helperText="CIDR, alias, ou +ipset"
                InputProps={{ sx: monoStyle }}
              />
            </Grid>
            <Grid size={{ xs: 6 }}>
              <TextField
                label="Destination"
                value={newRule.dest || ''}
                onChange={(e) => setNewRule({ ...newRule, dest: e.target.value })}
                placeholder="any, 10.0.0.0/8, alias"
                fullWidth
                size="small"
                helperText="CIDR, alias, ou +ipset"
                InputProps={{ sx: monoStyle }}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                label={t('network.comment')}
                value={newRule.comment || ''}
                onChange={(e) => setNewRule({ ...newRule, comment: e.target.value })}
                fullWidth
                size="small"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddRuleOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleAddRule} disabled={saving}>{t('common.add')}</Button>
        </DialogActions>
      </Dialog>

      {/* Add Security Group Dialog */}
      <Dialog open={addGroupOpen} onClose={() => { setAddGroupOpen(false); setSelectedGroup(''); }} maxWidth="sm" fullWidth>
        <DialogTitle>{t('network.addSecurityGroup')}</DialogTitle>
        <DialogContent>
          <FormControl fullWidth size="small" sx={{ mt: 2 }}>
            <InputLabel>Security Group</InputLabel>
            <Select
              value={selectedGroup}
              label="Security Group"
              onChange={(e) => setSelectedGroup(e.target.value as string)}
              renderValue={(value) => value}
            >
              {availableGroups.map((g) => (
                <MenuItem key={g.group} value={g.group}>
                  <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{g.group}</Typography>
                    {g.comment && (
                      <Typography variant="caption" color="text.secondary">{g.comment}</Typography>
                    )}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {selectedGroup && (
            <Box sx={{ mt: 2 }}>
              <Alert severity="info">
                {t('network.securityGroupRulesApplied', { name: selectedGroup })}
              </Alert>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setAddGroupOpen(false); setSelectedGroup(''); }}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleAddSecurityGroup} disabled={saving || !selectedGroup}>{t('common.add')}</Button>
        </DialogActions>
      </Dialog>

      {/* Edit Rule Dialog */}
      <Dialog open={editRuleOpen} onClose={() => setEditRuleOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          {editingRule?.type === 'group' ? t('network.editSecurityGroup') : t('network.editRule')}
        </DialogTitle>
        <DialogContent>
          {editingRule?.type === 'group' ? (
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Security Group"
                  value={editingRule?.action || ''}
                  fullWidth
                  size="small"
                  disabled
                  InputProps={{
                    sx: monoStyle,
                    startAdornment: <i className="ri-shield-check-line" style={{ marginRight: 8, color: theme.palette.primary.main }} />
                  }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={editingRule?.enable === 1}
                      onChange={(e) => setEditingRule(prev => prev ? { ...prev, enable: e.target.checked ? 1 : 0 } : null)}
                      color="success"
                    />
                  }
                  label={t('common.enabled')}
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <TextField
                  label={t('network.comment')}
                  value={editingRule?.comment || ''}
                  onChange={(e) => setEditingRule(prev => prev ? { ...prev, comment: e.target.value } : null)}
                  fullWidth
                  size="small"
                  placeholder={t('network.optionalDescription')}
                />
              </Grid>
            </Grid>
          ) : (
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid size={{ xs: 6, sm: 3 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Type</InputLabel>
                  <Select
                    value={editingRule?.type || 'in'}
                    label="Type"
                    onChange={(e) => setEditingRule(prev => prev ? { ...prev, type: e.target.value } : null)}
                  >
                    <MenuItem value="in">IN</MenuItem>
                    <MenuItem value="out">OUT</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Action</InputLabel>
                  <Select
                    value={editingRule?.action || 'ACCEPT'}
                    label="Action"
                    onChange={(e) => setEditingRule(prev => prev ? { ...prev, action: e.target.value } : null)}
                  >
                    <MenuItem value="ACCEPT">ACCEPT</MenuItem>
                    <MenuItem value="DROP">DROP</MenuItem>
                    <MenuItem value="REJECT">REJECT</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>{t('network.protocol')}</InputLabel>
                  <Select
                    value={editingRule?.proto || ''}
                    label={t('network.protocol')}
                    onChange={(e) => setEditingRule(prev => prev ? { ...prev, proto: e.target.value } : null)}
                  >
                    <MenuItem value="">{t('network.allProtocols')}</MenuItem>
                    <MenuItem value="tcp">TCP</MenuItem>
                    <MenuItem value="udp">UDP</MenuItem>
                    <MenuItem value="icmp">ICMP</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <TextField
                  label={t('network.destPort')}
                  value={editingRule?.dport || ''}
                  onChange={(e) => setEditingRule(prev => prev ? { ...prev, dport: e.target.value } : null)}
                  fullWidth
                  size="small"
                  InputProps={{ sx: monoStyle }}
                />
              </Grid>
              <Grid size={{ xs: 6 }}>
                <TextField
                  label="Source"
                  value={editingRule?.source || ''}
                  onChange={(e) => setEditingRule(prev => prev ? { ...prev, source: e.target.value } : null)}
                  fullWidth
                  size="small"
                  InputProps={{ sx: monoStyle }}
                />
              </Grid>
              <Grid size={{ xs: 6 }}>
                <TextField
                  label="Destination"
                  value={editingRule?.dest || ''}
                  onChange={(e) => setEditingRule(prev => prev ? { ...prev, dest: e.target.value } : null)}
                  fullWidth
                  size="small"
                  InputProps={{ sx: monoStyle }}
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <TextField
                  label={t('network.comment')}
                  value={editingRule?.comment || ''}
                  onChange={(e) => setEditingRule(prev => prev ? { ...prev, comment: e.target.value } : null)}
                  fullWidth
                  size="small"
                />
              </Grid>
            </Grid>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditRuleOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleUpdateRule} disabled={saving}>{t('common.save')}</Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('common.confirmDelete')}</DialogTitle>
        <DialogContent>
          <Typography>{t('common.deleteConfirmation')}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setDeleteConfirmOpen(false); setRuleToDelete(null); }}>{t('common.cancel')}</Button>
          <Button variant="contained" color="error" onClick={handleDeleteRule} disabled={saving}>
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar({ ...snackbar, open: false })}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
