'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Avatar, Box, Button, Chip, Collapse, Dialog, DialogTitle, DialogContent, DialogActions,
  FormControl, Grid, IconButton, InputLabel, MenuItem, Paper, Select, Stack,
  Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, Tooltip, Typography, useTheme, alpha
} from '@mui/material'

import * as firewallAPI from '@/lib/api/firewall'
import { useToast } from '@/contexts/ToastContext'
import { EditingRule, monoStyle } from '../../types'

interface SecurityGroupsPanelProps {
  securityGroups: firewallAPI.SecurityGroup[]
  firewallMode: firewallAPI.FirewallMode
  selectedConnection: string
  totalRules: number
  reload: () => void
}

const ActionChip = ({ action }: { action: string }) => {
  const colors: Record<string, string> = { ACCEPT: '#22c55e', DROP: '#ef4444', REJECT: '#f59e0b' }
  const color = colors[action] || '#94a3b8'
  return (
    <Chip size="small" label={action} sx={{ height: 22, fontSize: 11, fontWeight: 700, bgcolor: alpha(color, 0.15), color, border: `1px solid ${alpha(color, 0.3)}`, minWidth: 70 }} />
  )
}

export default function SecurityGroupsPanel({ securityGroups, firewallMode, selectedConnection, totalRules, reload }: SecurityGroupsPanelProps) {
  const theme = useTheme()
  const t = useTranslations()
  const { showToast } = useToast()

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [newGroup, setNewGroup] = useState({ group: '', comment: '' })
  const [selectedGroup, setSelectedGroup] = useState<firewallAPI.SecurityGroup | null>(null)
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false)
  const [newRule, setNewRule] = useState<firewallAPI.CreateRuleRequest>({ type: 'in', action: 'ACCEPT', enable: 1, proto: '', dport: '', source: '', dest: '', comment: '' })
  const [editingRule, setEditingRule] = useState<EditingRule | null>(null)
  const [sgDragState, setSgDragState] = useState<{ groupName: string; draggedPos: number | null; dragOverPos: number | null }>({ groupName: '', draggedPos: null, dragOverPos: null })

  const toggleGroup = (name: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const expandAllGroups = () => setExpandedGroups(new Set(securityGroups.map(g => g.group)))
  const collapseAllGroups = () => setExpandedGroups(new Set())

  // ── CRUD handlers ──
  const handleCreateGroup = async () => {
    try {
      await firewallAPI.createSecurityGroup(selectedConnection, newGroup)
      showToast(t('networkPage.securityGroupCreated'), 'success')
      setGroupDialogOpen(false)
      setNewGroup({ group: '', comment: '' })
      reload()
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  const handleDeleteGroup = async (name: string) => {
    if (!confirm(t('networkPage.deleteSgConfirm', { name }))) return
    try {
      await firewallAPI.deleteSecurityGroup(selectedConnection, name)
      showToast(t('networkPage.securityGroupDeleted'), 'success')
      reload()
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  const handleAddRule = async () => {
    if (!selectedGroup) return
    try {
      await firewallAPI.addSecurityGroupRule(selectedConnection, selectedGroup.group, newRule)
      showToast(t('network.ruleAdded'), 'success')
      setRuleDialogOpen(false)
      setNewRule({ type: 'in', action: 'ACCEPT', enable: 1, proto: '', dport: '', source: '', dest: '', comment: '' })
      reload()
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  const handleUpdateRule = async () => {
    if (!editingRule) return
    try {
      await firewallAPI.updateSecurityGroupRule(selectedConnection, editingRule.groupName, editingRule.rule.pos, {
        type: editingRule.rule.type, action: editingRule.rule.action, enable: editingRule.rule.enable,
        proto: editingRule.rule.proto || '', dport: editingRule.rule.dport || '', sport: editingRule.rule.sport || '',
        source: editingRule.rule.source || '', dest: editingRule.rule.dest || '', comment: editingRule.rule.comment || '',
      })
      showToast(t('network.ruleUpdated'), 'success')
      setEditingRule(null)
      reload()
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  const handleToggleRuleEnable = async (groupName: string, rule: firewallAPI.FirewallRule) => {
    try {
      await firewallAPI.updateSecurityGroupRule(selectedConnection, groupName, rule.pos, { ...rule, enable: rule.enable === 1 ? 0 : 1 })
      showToast(rule.enable === 1 ? t('network.ruleDisabled') : t('network.ruleEnabled'), 'success')
      reload()
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  const handleDeleteRule = async (groupName: string, pos: number) => {
    if (!confirm(t('networkPage.deleteRuleConfirm'))) return
    try {
      await firewallAPI.deleteSecurityGroupRule(selectedConnection, groupName, pos)
      showToast(t('network.ruleDeleted'), 'success')
      reload()
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  // ── Drag & drop ──
  const handleDragStart = (e: React.DragEvent, groupName: string, pos: number) => {
    setSgDragState({ groupName, draggedPos: pos, dragOverPos: null })
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', pos.toString())
    setTimeout(() => { (e.currentTarget as HTMLElement).style.opacity = '0.5' }, 0)
  }
  const handleDragEnd = (e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).style.opacity = '1'
    setSgDragState({ groupName: '', draggedPos: null, dragOverPos: null })
  }
  const handleDragOver = (e: React.DragEvent, groupName: string, pos: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (sgDragState.groupName === groupName && sgDragState.draggedPos !== null && sgDragState.draggedPos !== pos) {
      setSgDragState(prev => ({ ...prev, dragOverPos: pos }))
    }
  }
  const handleDragLeave = () => setSgDragState(prev => ({ ...prev, dragOverPos: null }))
  const handleDrop = async (e: React.DragEvent, groupName: string, toPos: number) => {
    e.preventDefault()
    const fromPos = sgDragState.draggedPos
    setSgDragState({ groupName: '', draggedPos: null, dragOverPos: null })
    if (fromPos !== null && fromPos !== toPos && sgDragState.groupName === groupName) {
      try {
        await firewallAPI.updateSecurityGroupRule(selectedConnection, groupName, fromPos, { moveto: toPos })
        showToast(t('network.ruleMoved'), 'success')
        reload()
      } catch (err: any) {
        showToast(err.message || t('networkPage.moveError'), 'error')
      }
    }
  }

  if (firewallMode === 'standalone') {
    return (
      <Box sx={{ textAlign: 'center', py: 6 }}>
        <Avatar sx={{ width: 80, height: 80, bgcolor: alpha('#f59e0b', 0.15), mx: 'auto', mb: 3 }}>
          <i className="ri-shield-line" style={{ fontSize: 40, color: '#f59e0b' }} />
        </Avatar>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>{t('network.securityGroupsNotAvailable')}</Typography>
        <Typography variant="body1" sx={{ color: 'text.secondary', maxWidth: 500, mx: 'auto', mb: 3 }}>
          {t('network.securityGroupsClusterFeature')}
        </Typography>
        <Box sx={{ p: 3, bgcolor: alpha(theme.palette.divider, 0.05), borderRadius: 2, maxWidth: 600, mx: 'auto' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>{t('network.availableAlternatives')}</Typography>
          <Stack spacing={1.5} alignItems="flex-start">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Avatar sx={{ width: 32, height: 32, bgcolor: alpha('#8b5cf6', 0.15) }}>
                <i className="ri-price-tag-3-line" style={{ fontSize: 16, color: '#8b5cf6' }} />
              </Avatar>
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>Aliases</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('network.aliasesDescription')}</Typography>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Avatar sx={{ width: 32, height: 32, bgcolor: alpha('#f59e0b', 0.15) }}>
                <i className="ri-database-2-line" style={{ fontSize: 16, color: '#f59e0b' }} />
              </Avatar>
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>IP Sets</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('network.ipSetsDescription')}</Typography>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Avatar sx={{ width: 32, height: 32, bgcolor: alpha('#22c55e', 0.15) }}>
                <i className="ri-computer-line" style={{ fontSize: 16, color: '#22c55e' }} />
              </Avatar>
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{t('network.vmCtRules')}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('network.vmCtRulesDescription')}</Typography>
              </Box>
            </Box>
          </Stack>
        </Box>
      </Box>
    )
  }

  return (
    <>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>Security Groups</Typography>
          <Chip label={t('network.groupsAndRules', { groups: securityGroups.length, rules: totalRules })} size="small" />
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button size="small" variant="outlined" onClick={expandAllGroups}>{t('common.expandAll')}</Button>
          <Button size="small" variant="outlined" onClick={collapseAllGroups}>{t('common.collapseAll')}</Button>
          <Button variant="contained" startIcon={<i className="ri-add-line" />} onClick={() => setGroupDialogOpen(true)} disabled={!selectedConnection}>
            {t('network.newGroup')}
          </Button>
        </Box>
      </Box>

      <Stack spacing={1}>
        {securityGroups.map((group) => (
          <Paper key={group.group} sx={{ border: `1px solid ${alpha(theme.palette.divider, 0.1)}`, overflow: 'hidden' }}>
            <Box
              sx={{
                p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer',
                bgcolor: expandedGroups.has(group.group) ? alpha(theme.palette.primary.main, 0.05) : 'transparent',
                '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.03) }
              }}
              onClick={() => toggleGroup(group.group)}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <i className={expandedGroups.has(group.group) ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} style={{ fontSize: 20 }} />
                <Avatar sx={{ width: 32, height: 32, bgcolor: alpha(theme.palette.primary.main, 0.15) }}>
                  <i className="ri-shield-line" style={{ fontSize: 16, color: theme.palette.primary.main }} />
                </Avatar>
                <Box>
                  <code style={{ background: 'transparent', fontSize: 14, fontWeight: 600, color: 'inherit' }}>{group.group}</code>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>{group.comment || t('network.noDescription')}</Typography>
                </Box>
              </Box>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                <Chip label={t('networkPage.rulesCount', { count: group.rules?.length || 0 })} size="small" />
                <Button size="small" startIcon={<i className="ri-add-line" />} onClick={() => { setSelectedGroup(group); setRuleDialogOpen(true) }}>
                  {t('networkPage.rule')}
                </Button>
                <IconButton size="small" color="error" onClick={() => handleDeleteGroup(group.group)}>
                  <i className="ri-delete-bin-line" />
                </IconButton>
              </Box>
            </Box>

            <Collapse in={expandedGroups.has(group.group)}>
              {group.rules && group.rules.length > 0 ? (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: alpha(theme.palette.background.default, 0.5) }}>
                        <TableCell sx={{ fontWeight: 700, width: 30, p: 0.5 }}></TableCell>
                        <TableCell sx={{ fontWeight: 700, width: 35 }}>#</TableCell>
                        <TableCell sx={{ fontWeight: 700, width: 60 }}>Active</TableCell>
                        <TableCell sx={{ fontWeight: 700, width: 60 }}>Type</TableCell>
                        <TableCell sx={{ fontWeight: 700, width: 90 }}>Action</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Source</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Destination</TableCell>
                        <TableCell sx={{ fontWeight: 700, width: 70 }}>Proto</TableCell>
                        <TableCell sx={{ fontWeight: 700, width: 80 }}>Port</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>{t('networkPage.comment')}</TableCell>
                        <TableCell sx={{ width: 80 }}></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {group.rules.map((rule, idx) => {
                        const isDragging = sgDragState.groupName === group.group && sgDragState.draggedPos === rule.pos
                        const isDragOver = sgDragState.groupName === group.group && sgDragState.dragOverPos === rule.pos
                        return (
                          <TableRow
                            key={idx}
                            hover
                            draggable
                            onDragStart={(e) => handleDragStart(e, group.group, rule.pos)}
                            onDragEnd={handleDragEnd}
                            onDragOver={(e) => handleDragOver(e, group.group, rule.pos)}
                            onDragLeave={handleDragLeave}
                            onDrop={(e) => handleDrop(e, group.group, rule.pos)}
                            sx={{
                              cursor: 'grab', opacity: isDragging ? 0.5 : 1,
                              borderTop: isDragOver ? `2px solid ${theme.palette.primary.main}` : undefined,
                              '&:active': { cursor: 'grabbing' }
                            }}
                          >
                            <TableCell sx={{ p: 0.5, cursor: 'grab' }}>
                              <i className="ri-draggable" style={{ fontSize: 14, color: theme.palette.text.disabled }} />
                            </TableCell>
                            <TableCell sx={{ color: 'text.secondary', fontSize: 11, p: 0.5 }}>{rule.pos}</TableCell>
                            <TableCell sx={{ p: 0.5 }}>
                              <Switch checked={rule.enable === 1} onChange={() => handleToggleRuleEnable(group.group, rule)} size="small" color="success" />
                            </TableCell>
                            <TableCell sx={{ p: 0.5 }}>
                              <Chip label={rule.type?.toUpperCase() || 'IN'} size="small" variant="outlined" sx={{ fontSize: 10, height: 20 }} />
                            </TableCell>
                            <TableCell sx={{ p: 0.5 }}><ActionChip action={rule.action || 'ACCEPT'} /></TableCell>
                            <TableCell sx={{ ...monoStyle, color: rule.source ? 'text.primary' : 'text.disabled', fontSize: 11, p: 0.5 }}>{rule.source || 'any'}</TableCell>
                            <TableCell sx={{ ...monoStyle, color: rule.dest ? 'text.primary' : 'text.disabled', fontSize: 11, p: 0.5 }}>{rule.dest || 'any'}</TableCell>
                            <TableCell sx={{ ...monoStyle, fontSize: 11, p: 0.5 }}>{rule.proto || 'any'}</TableCell>
                            <TableCell sx={{ ...monoStyle, color: rule.dport ? 'text.primary' : 'text.disabled', fontSize: 11, p: 0.5 }}>{rule.dport || '-'}</TableCell>
                            <TableCell sx={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', p: 0.5 }}>
                              <Tooltip title={rule.comment || ''}><span style={{ fontSize: 11 }}>{rule.comment || '-'}</span></Tooltip>
                            </TableCell>
                            <TableCell sx={{ p: 0.5 }}>
                              <Box sx={{ display: 'flex', gap: 0 }}>
                                <Tooltip title={t('networkPage.edit')}>
                                  <IconButton size="small" onClick={() => setEditingRule({ groupName: group.group, rule, index: idx })}>
                                    <i className="ri-edit-line" style={{ fontSize: 14 }} />
                                  </IconButton>
                                </Tooltip>
                                <Tooltip title={t('networkPage.delete')}>
                                  <IconButton size="small" color="error" onClick={() => handleDeleteRule(group.group, rule.pos)}>
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
              ) : (
                <Box sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
                  <Typography variant="body2">{t('networkPage.noRules')}</Typography>
                  <Button size="small" sx={{ mt: 1 }} onClick={() => { setSelectedGroup(group); setRuleDialogOpen(true) }}>
                    {t('networkPage.addRule')}
                  </Button>
                </Box>
              )}
            </Collapse>
          </Paper>
        ))}

        {securityGroups.length === 0 && (
          <Paper sx={{ p: 4, textAlign: 'center', border: `1px dashed ${alpha(theme.palette.divider, 0.3)}` }}>
            <i className="ri-shield-line" style={{ fontSize: 48, opacity: 0.3 }} />
            <Typography variant="body1" sx={{ mt: 2, color: 'text.secondary' }}>{t('networkPage.noSecurityGroup')}</Typography>
            <Button sx={{ mt: 2 }} onClick={() => setGroupDialogOpen(true)}>{t('networkPage.createGroup')}</Button>
          </Paper>
        )}
      </Stack>

      {/* ══ DIALOGS ══ */}

      {/* Create Security Group */}
      <Dialog open={groupDialogOpen} onClose={() => setGroupDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('networkPage.createSgTitle')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 2 }}>
            <TextField label={t('common.name')} value={newGroup.group} onChange={(e) => setNewGroup({ ...newGroup, group: e.target.value })} placeholder="sg-web" fullWidth size="small" InputProps={{ sx: monoStyle }} />
            <TextField label={t('common.description')} value={newGroup.comment} onChange={(e) => setNewGroup({ ...newGroup, comment: e.target.value })} fullWidth size="small" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGroupDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleCreateGroup} disabled={!newGroup.group}>{t('networkPage.createButton')}</Button>
        </DialogActions>
      </Dialog>

      {/* Add Rule */}
      <Dialog open={ruleDialogOpen} onClose={() => setRuleDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{t('networkPage.addRuleToTitle', { name: selectedGroup?.group })}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid size={{ xs: 6, sm: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Type</InputLabel>
                <Select value={newRule.type} label="Type" onChange={(e) => setNewRule({ ...newRule, type: e.target.value })}>
                  <MenuItem value="in">IN</MenuItem>
                  <MenuItem value="out">OUT</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Action</InputLabel>
                <Select value={newRule.action} label="Action" onChange={(e) => setNewRule({ ...newRule, action: e.target.value })}>
                  <MenuItem value="ACCEPT">ACCEPT</MenuItem>
                  <MenuItem value="DROP">DROP</MenuItem>
                  <MenuItem value="REJECT">REJECT</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Protocole</InputLabel>
                <Select value={newRule.proto || ''} label="Protocole" onChange={(e) => setNewRule({ ...newRule, proto: e.target.value })}>
                  <MenuItem value="">Tous</MenuItem>
                  <MenuItem value="tcp">TCP</MenuItem>
                  <MenuItem value="udp">UDP</MenuItem>
                  <MenuItem value="icmp">ICMP</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField label="Port dest" value={newRule.dport || ''} onChange={(e) => setNewRule({ ...newRule, dport: e.target.value })} placeholder="22, 80:443" fullWidth size="small" InputProps={{ sx: monoStyle }} />
            </Grid>
            <Grid size={{ xs: 6 }}>
              <TextField label="Source" value={newRule.source || ''} onChange={(e) => setNewRule({ ...newRule, source: e.target.value })} placeholder="any" fullWidth size="small" helperText="CIDR, alias, ou +ipset" InputProps={{ sx: monoStyle }} />
            </Grid>
            <Grid size={{ xs: 6 }}>
              <TextField label="Destination" value={newRule.dest || ''} onChange={(e) => setNewRule({ ...newRule, dest: e.target.value })} placeholder="any" fullWidth size="small" helperText="CIDR, alias, ou +ipset" InputProps={{ sx: monoStyle }} />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField label="Commentaire" value={newRule.comment || ''} onChange={(e) => setNewRule({ ...newRule, comment: e.target.value })} fullWidth size="small" />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRuleDialogOpen(false)}>Annuler</Button>
          <Button variant="contained" onClick={handleAddRule}>Ajouter</Button>
        </DialogActions>
      </Dialog>

      {/* Edit Rule */}
      <Dialog open={!!editingRule} onClose={() => setEditingRule(null)} maxWidth="md" fullWidth>
        <DialogTitle>{t('networkPage.editTheRule')}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid size={{ xs: 6, sm: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Type</InputLabel>
                <Select value={editingRule?.rule.type || 'in'} label="Type" onChange={(e) => setEditingRule(prev => prev ? { ...prev, rule: { ...prev.rule, type: e.target.value } } : null)}>
                  <MenuItem value="in">IN</MenuItem>
                  <MenuItem value="out">OUT</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Action</InputLabel>
                <Select value={editingRule?.rule.action || 'ACCEPT'} label="Action" onChange={(e) => setEditingRule(prev => prev ? { ...prev, rule: { ...prev.rule, action: e.target.value } } : null)}>
                  <MenuItem value="ACCEPT">ACCEPT</MenuItem>
                  <MenuItem value="DROP">DROP</MenuItem>
                  <MenuItem value="REJECT">REJECT</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Protocole</InputLabel>
                <Select value={editingRule?.rule.proto || ''} label="Protocole" onChange={(e) => setEditingRule(prev => prev ? { ...prev, rule: { ...prev.rule, proto: e.target.value } } : null)}>
                  <MenuItem value="">Tous</MenuItem>
                  <MenuItem value="tcp">TCP</MenuItem>
                  <MenuItem value="udp">UDP</MenuItem>
                  <MenuItem value="icmp">ICMP</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField label="Port dest" value={editingRule?.rule.dport || ''} onChange={(e) => setEditingRule(prev => prev ? { ...prev, rule: { ...prev.rule, dport: e.target.value } } : null)} fullWidth size="small" InputProps={{ sx: monoStyle }} />
            </Grid>
            <Grid size={{ xs: 6 }}>
              <TextField label="Source" value={editingRule?.rule.source || ''} onChange={(e) => setEditingRule(prev => prev ? { ...prev, rule: { ...prev.rule, source: e.target.value } } : null)} fullWidth size="small" InputProps={{ sx: monoStyle }} />
            </Grid>
            <Grid size={{ xs: 6 }}>
              <TextField label="Destination" value={editingRule?.rule.dest || ''} onChange={(e) => setEditingRule(prev => prev ? { ...prev, rule: { ...prev.rule, dest: e.target.value } } : null)} fullWidth size="small" InputProps={{ sx: monoStyle }} />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField label="Commentaire" value={editingRule?.rule.comment || ''} onChange={(e) => setEditingRule(prev => prev ? { ...prev, rule: { ...prev.rule, comment: e.target.value } } : null)} fullWidth size="small" />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditingRule(null)}>Annuler</Button>
          <Button variant="contained" onClick={handleUpdateRule}>Enregistrer</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
