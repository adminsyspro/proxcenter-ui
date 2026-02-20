'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Avatar, Box, Button, Chip, Dialog, DialogTitle, DialogContent, DialogActions,
  FormControl, Grid, IconButton, InputLabel, MenuItem, Paper, Select, Stack,
  Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip,
  Typography, useTheme, alpha
} from '@mui/material'

import * as firewallAPI from '@/lib/api/firewall'
import { useToast } from '@/contexts/ToastContext'
import { DEFAULT_RULE } from '../../types'

interface ClusterRulesPanelProps {
  clusterRules: firewallAPI.FirewallRule[]
  securityGroups: firewallAPI.SecurityGroup[]
  selectedConnection: string
  setClusterRules: React.Dispatch<React.SetStateAction<firewallAPI.FirewallRule[]>>
}

export default function ClusterRulesPanel({ clusterRules, securityGroups, selectedConnection, setClusterRules }: ClusterRulesPanelProps) {
  const theme = useTheme()
  const t = useTranslations()
  const { showToast } = useToast()

  const [editingClusterRule, setEditingClusterRule] = useState<{ rule: firewallAPI.FirewallRule | null; isNew: boolean } | null>(null)
  const [deleteClusterRuleConfirm, setDeleteClusterRuleConfirm] = useState<{ pos: number } | null>(null)
  const [clusterRuleDialogOpen, setClusterRuleDialogOpen] = useState(false)
  const [newClusterRule, setNewClusterRule] = useState<firewallAPI.CreateRuleRequest>({ ...DEFAULT_RULE })
  const [clusterDragState, setClusterDragState] = useState<{ draggedPos: number | null; dragOverPos: number | null }>({ draggedPos: null, dragOverPos: null })

  const reloadClusterRules = async () => {
    if (!selectedConnection) return
    try {
      const rules = await firewallAPI.getClusterRules(selectedConnection)
      setClusterRules(Array.isArray(rules) ? rules : [])
    } catch (err) {
      console.error('Error reloading cluster rules:', err)
    }
  }

  const handleAddClusterRule = async () => {
    if (!selectedConnection) return
    try {
      await firewallAPI.addClusterRule(selectedConnection, newClusterRule)
      showToast(t('network.ruleAdded'), 'success')
      setClusterRuleDialogOpen(false)
      setEditingClusterRule(null)
      setNewClusterRule({ ...DEFAULT_RULE })
      reloadClusterRules()
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  const handleUpdateClusterRule = async () => {
    if (!editingClusterRule?.rule || !selectedConnection) return
    try {
      await fetch(`/api/v1/firewall/cluster/${selectedConnection}/rules/${editingClusterRule.rule.pos}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newClusterRule)
      })
      showToast(t('network.ruleModified'), 'success')
      setClusterRuleDialogOpen(false)
      setEditingClusterRule(null)
      reloadClusterRules()
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  const handleDeleteClusterRule = async () => {
    if (!deleteClusterRuleConfirm || !selectedConnection) return
    try {
      await firewallAPI.deleteClusterRule(selectedConnection, deleteClusterRuleConfirm.pos)
      showToast(t('network.ruleDeleted'), 'success')
      setDeleteClusterRuleConfirm(null)
      reloadClusterRules()
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  // ── Drag & drop ──
  const handleDragStart = (e: React.DragEvent, pos: number) => {
    setClusterDragState({ draggedPos: pos, dragOverPos: null })
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', pos.toString())
    setTimeout(() => { (e.currentTarget as HTMLElement).style.opacity = '0.5' }, 0)
  }
  const handleDragEnd = (e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).style.opacity = '1'
    setClusterDragState({ draggedPos: null, dragOverPos: null })
  }
  const handleDragOver = (e: React.DragEvent, pos: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (clusterDragState.draggedPos !== null && clusterDragState.draggedPos !== pos) {
      setClusterDragState(prev => ({ ...prev, dragOverPos: pos }))
    }
  }
  const handleDragLeave = () => setClusterDragState(prev => ({ ...prev, dragOverPos: null }))
  const handleDrop = async (e: React.DragEvent, toPos: number) => {
    e.preventDefault()
    const fromPos = clusterDragState.draggedPos
    setClusterDragState({ draggedPos: null, dragOverPos: null })
    if (fromPos !== null && fromPos !== toPos) {
      try {
        await fetch(`/api/v1/firewall/cluster/${selectedConnection}/rules/${fromPos}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ moveto: toPos })
        })
        showToast(t('network.ruleMoved'), 'success')
        reloadClusterRules()
      } catch (err: any) {
        showToast(err.message || t('networkPage.moveError'), 'error')
      }
    }
  }

  return (
    <>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>{t('network.clusterRules')}</Typography>
          <Chip
            label={clusterRules.length > 1
              ? t('networkPage.rulesAndActiveCount', { count: clusterRules.length, active: clusterRules.filter(r => r.enable !== 0).length })
              : t('networkPage.ruleAndActiveCount', { count: clusterRules.length, active: clusterRules.filter(r => r.enable !== 0).length })}
            size="small"
          />
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <Button size="small" variant="outlined" startIcon={<i className="ri-refresh-line" />} onClick={reloadClusterRules}>
            {t('networkPage.refresh')}
          </Button>
          <Button size="small" variant="contained" startIcon={<i className="ri-add-line" />} onClick={() => {
            setEditingClusterRule({ rule: null, isNew: true })
            setNewClusterRule({ ...DEFAULT_RULE })
            setClusterRuleDialogOpen(true)
          }}>
            {t('networkPage.add')}
          </Button>
        </Box>
      </Box>

      {clusterRules.length > 0 ? (
        <Paper sx={{ border: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700, width: 30 }}></TableCell>
                <TableCell sx={{ fontWeight: 700, width: 35, fontSize: 11 }}>#</TableCell>
                <TableCell sx={{ fontWeight: 700, width: 50, fontSize: 11 }}>{t('common.active')}</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>{t('firewall.type')}</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>{t('firewall.action')}</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>{t('firewall.proto')}</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>{t('firewall.source')}</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>{t('firewall.dest')}</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>{t('firewall.port')}</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>{t('networkPage.comment')}</TableCell>
                <TableCell sx={{ fontWeight: 700, width: 80, fontSize: 11 }}>{t('common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {clusterRules.map((rule, index) => {
                const isDragging = clusterDragState.draggedPos === rule.pos
                const isDragOver = clusterDragState.dragOverPos === rule.pos
                const isGroupRule = rule.type === 'group'

                return (
                  <TableRow
                    key={index}
                    hover draggable
                    onDragStart={(e) => handleDragStart(e, rule.pos)}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => handleDragOver(e, rule.pos)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, rule.pos)}
                    sx={{
                      opacity: isDragging ? 0.5 : 1,
                      bgcolor: isDragOver ? alpha(theme.palette.primary.main, 0.1) : 'transparent',
                      cursor: 'grab', '&:active': { cursor: 'grabbing' }
                    }}
                  >
                    <TableCell sx={{ p: 0.5 }}>
                      <i className="ri-draggable" style={{ fontSize: 14, color: theme.palette.text.disabled, cursor: 'grab' }} />
                    </TableCell>
                    <TableCell sx={{ fontSize: 11 }}>{rule.pos}</TableCell>
                    <TableCell>
                      <Chip label={rule.enable === 0 ? 'Off' : 'On'} size="small" sx={{ height: 18, fontSize: 9, bgcolor: rule.enable === 0 ? alpha('#888', 0.15) : alpha('#22c55e', 0.15), color: rule.enable === 0 ? '#888' : '#22c55e' }} />
                    </TableCell>
                    <TableCell>
                      <Chip label={isGroupRule ? 'GROUP' : rule.type?.toUpperCase() || '-'} size="small" sx={{ height: 18, fontSize: 9, bgcolor: isGroupRule ? alpha('#8b5cf6', 0.15) : rule.type === 'in' ? alpha('#3b82f6', 0.15) : alpha('#ec4899', 0.15), color: isGroupRule ? '#8b5cf6' : rule.type === 'in' ? '#3b82f6' : '#ec4899' }} />
                    </TableCell>
                    <TableCell>
                      {isGroupRule ? (
                        <Chip icon={<i className="ri-shield-line" style={{ fontSize: 10 }} />} label={rule.action} size="small" sx={{ height: 20, fontSize: 10, fontWeight: 600, bgcolor: alpha('#8b5cf6', 0.15), color: '#8b5cf6', '& .MuiChip-icon': { color: '#8b5cf6' } }} />
                      ) : (
                        <Chip label={rule.action || '-'} size="small" sx={{ height: 18, fontSize: 9, bgcolor: rule.action === 'ACCEPT' ? alpha('#22c55e', 0.15) : rule.action === 'DROP' ? alpha('#ef4444', 0.15) : alpha('#f59e0b', 0.15), color: rule.action === 'ACCEPT' ? '#22c55e' : rule.action === 'DROP' ? '#ef4444' : '#f59e0b' }} />
                      )}
                    </TableCell>
                    <TableCell sx={{ fontSize: 11 }}>{isGroupRule ? '-' : (rule.proto || 'any')}</TableCell>
                    <TableCell sx={{ fontSize: 11 }}><code>{isGroupRule ? '-' : (rule.source || 'any')}</code></TableCell>
                    <TableCell sx={{ fontSize: 11 }}><code>{isGroupRule ? '-' : (rule.dest || 'any')}</code></TableCell>
                    <TableCell sx={{ fontSize: 11 }}>{isGroupRule ? '-' : (rule.dport || '-')}</TableCell>
                    <TableCell sx={{ fontSize: 11, color: 'text.secondary' }}>{rule.comment || '-'}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5}>
                        <Tooltip title={t('networkPage.edit')}>
                          <IconButton size="small" onClick={() => {
                            setEditingClusterRule({ rule, isNew: false })
                            setNewClusterRule({
                              type: rule.type || 'in', action: rule.action || 'ACCEPT', enable: rule.enable ?? 1,
                              proto: rule.proto || '', dport: rule.dport || '', sport: rule.sport || '',
                              source: rule.source || '', dest: rule.dest || '', macro: rule.macro || '',
                              iface: rule.iface || '', log: rule.log || 'nolog', comment: rule.comment || ''
                            })
                            setClusterRuleDialogOpen(true)
                          }}>
                            <i className="ri-pencil-line" style={{ fontSize: 14 }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t('networkPage.delete')}>
                          <IconButton size="small" color="error" onClick={() => setDeleteClusterRuleConfirm({ pos: rule.pos })}>
                            <i className="ri-delete-bin-line" style={{ fontSize: 14 }} />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Paper>
      ) : (
        <Paper sx={{ p: 4, textAlign: 'center', border: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
          <Avatar sx={{ width: 64, height: 64, bgcolor: alpha('#3b82f6', 0.15), mx: 'auto', mb: 2 }}>
            <i className="ri-cloud-line" style={{ fontSize: 32, color: '#3b82f6' }} />
          </Avatar>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>{t('networkPage.noClusterRuleTitle')}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>{t('networkPage.clusterRulesDescription')}</Typography>
          <Button variant="contained" startIcon={<i className="ri-add-line" />} onClick={() => {
            setEditingClusterRule({ rule: null, isNew: true })
            setNewClusterRule({ ...DEFAULT_RULE })
            setClusterRuleDialogOpen(true)
          }}>
            {t('networkPage.createARule')}
          </Button>
        </Paper>
      )}

      {/* ══ DIALOGS ══ */}

      {/* Cluster Rule Dialog */}
      <Dialog open={clusterRuleDialogOpen} onClose={() => setClusterRuleDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className="ri-cloud-line" style={{ fontSize: 20 }} />
            {editingClusterRule?.isNew ? t('networkPage.addClusterRuleTitle') : t('networkPage.editClusterRuleTitle')}
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControl fullWidth size="small">
                <InputLabel>{t('firewall.type')}</InputLabel>
                <Select value={newClusterRule.type} label={t('firewall.type')} onChange={(e) => setNewClusterRule({ ...newClusterRule, type: e.target.value })}>
                  <MenuItem value="in">{t('firewall.typeIn')}</MenuItem>
                  <MenuItem value="out">{t('firewall.typeOut')}</MenuItem>
                  <MenuItem value="group">{t('firewall.typeGroup')}</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControl fullWidth size="small">
                <InputLabel>{t('firewall.action')}</InputLabel>
                {newClusterRule.type === 'group' ? (
                  <Select value={newClusterRule.action} label={t('firewall.action')} onChange={(e) => setNewClusterRule({ ...newClusterRule, action: e.target.value })}>
                    {securityGroups.map(sg => (<MenuItem key={sg.group} value={sg.group}>{sg.group}</MenuItem>))}
                  </Select>
                ) : (
                  <Select value={newClusterRule.action} label={t('firewall.action')} onChange={(e) => setNewClusterRule({ ...newClusterRule, action: e.target.value })}>
                    <MenuItem value="ACCEPT">ACCEPT</MenuItem>
                    <MenuItem value="DROP">DROP</MenuItem>
                    <MenuItem value="REJECT">REJECT</MenuItem>
                  </Select>
                )}
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControl fullWidth size="small">
                <InputLabel>{t('firewall.active')}</InputLabel>
                <Select value={newClusterRule.enable} label={t('firewall.active')} onChange={(e) => setNewClusterRule({ ...newClusterRule, enable: Number(e.target.value) })}>
                  <MenuItem value={1}>{t('firewall.yes')}</MenuItem>
                  <MenuItem value={0}>{t('firewall.no')}</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            {newClusterRule.type !== 'group' && (
              <>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField fullWidth size="small" label={t('firewall.protocol')} value={newClusterRule.proto} onChange={(e) => setNewClusterRule({ ...newClusterRule, proto: e.target.value })} placeholder="tcp, udp, icmp..." />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField fullWidth size="small" label={t('firewall.source')} value={newClusterRule.source} onChange={(e) => setNewClusterRule({ ...newClusterRule, source: e.target.value })} placeholder="IP, CIDR, alias..." />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField fullWidth size="small" label={t('firewall.destination')} value={newClusterRule.dest} onChange={(e) => setNewClusterRule({ ...newClusterRule, dest: e.target.value })} placeholder="IP, CIDR, alias..." />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField fullWidth size="small" label={t('firewall.destPort')} value={newClusterRule.dport} onChange={(e) => setNewClusterRule({ ...newClusterRule, dport: e.target.value })} placeholder="22, 80, 443..." />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField fullWidth size="small" label={t('firewall.sourcePort')} value={newClusterRule.sport} onChange={(e) => setNewClusterRule({ ...newClusterRule, sport: e.target.value })} />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField fullWidth size="small" label={t('firewall.interface')} value={newClusterRule.iface} onChange={(e) => setNewClusterRule({ ...newClusterRule, iface: e.target.value })} placeholder="vmbr0, eth0..." />
                </Grid>
              </>
            )}
            <Grid size={{ xs: 12 }}>
              <TextField fullWidth size="small" label={t('firewall.comment')} value={newClusterRule.comment} onChange={(e) => setNewClusterRule({ ...newClusterRule, comment: e.target.value })} />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setClusterRuleDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={editingClusterRule?.isNew ? handleAddClusterRule : handleUpdateClusterRule} startIcon={<i className={editingClusterRule?.isNew ? "ri-add-line" : "ri-check-line"} />}>
            {editingClusterRule?.isNew ? t('common.add') : t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Cluster Rule Confirmation */}
      <Dialog open={!!deleteClusterRuleConfirm} onClose={() => setDeleteClusterRuleConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className="ri-error-warning-line" style={{ fontSize: 20, color: '#ef4444' }} />
            {t('networkPage.deleteRuleConfirm')}
          </Box>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('networkPage.deleteClusterRuleWarning', { pos: deleteClusterRuleConfirm?.pos })}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteClusterRuleConfirm(null)}>{t('common.cancel')}</Button>
          <Button variant="contained" color="error" onClick={handleDeleteClusterRule} startIcon={<i className="ri-delete-bin-line" />}>
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
