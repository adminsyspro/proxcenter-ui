'use client'

import { useState, useMemo } from 'react'
import { useTranslations } from 'next-intl'

import {
  Box, Button, Chip, Dialog, DialogTitle, DialogContent, DialogActions,
  FormControl, IconButton, InputLabel, MenuItem, Paper, Select, Switch,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Tooltip, Typography, useTheme, alpha
} from '@mui/material'

import * as firewallAPI from '@/lib/api/firewall'
import { useToast } from '@/contexts/ToastContext'
import { PolicySection, monoStyle } from '../../types'
import RuleFormDialog, { RuleFormData } from './RuleFormDialog'

// ── Props ──

interface FirewallPolicyTableProps {
  clusterRules: firewallAPI.FirewallRule[]
  securityGroups: firewallAPI.SecurityGroup[]
  selectedConnection: string
  setClusterRules: React.Dispatch<React.SetStateAction<firewallAPI.FirewallRule[]>>
  clusterOptions: firewallAPI.ClusterOptions | null
  setClusterOptions: React.Dispatch<React.SetStateAction<firewallAPI.ClusterOptions | null>>
  aliases: firewallAPI.Alias[]
  ipsets: firewallAPI.IPSet[]
  reload: () => void
}

// ── Helpers ──

const ActionChip = ({ action }: { action: string }) => {
  const colors: Record<string, string> = { ACCEPT: '#22c55e', DROP: '#ef4444', REJECT: '#f59e0b' }
  const color = colors[action] || '#94a3b8'
  return <Chip size="small" label={action} sx={{ height: 22, fontSize: 11, fontWeight: 700, bgcolor: alpha(color, 0.22), color, border: `1px solid ${alpha(color, 0.35)}`, minWidth: 70 }} />
}

function formatService(rule: firewallAPI.FirewallRule): string {
  if (rule.type === 'group') return '-'
  if (rule.macro) return rule.macro
  const proto = rule.proto?.toUpperCase() || ''
  const port = rule.dport || ''
  if (!proto && !port) return 'any'
  if (proto && port) return `${proto}/${port}`
  return proto || port
}

// ── Column header style ──
const headCellSx = { fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap' } as const

// ── Main Component ──

export default function FirewallPolicyTable({
  clusterRules, securityGroups, selectedConnection, setClusterRules,
  clusterOptions, setClusterOptions, aliases, ipsets, reload
}: FirewallPolicyTableProps) {
  const theme = useTheme()
  const t = useTranslations()
  const { showToast } = useToast()

  // ── State ──

  // Rule CRUD
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false)
  const [ruleDialogIsNew, setRuleDialogIsNew] = useState(true)
  const [ruleDialogEditPos, setRuleDialogEditPos] = useState<number | null>(null)
  const [ruleForm, setRuleForm] = useState<RuleFormData>({ type: 'in', action: 'ACCEPT', enable: 1, proto: '', dport: '', sport: '', source: '', dest: '', macro: '', iface: '', log: 'nolog', comment: '' })

  // Delete confirm
  const [deleteConfirm, setDeleteConfirm] = useState<{ pos: number } | null>(null)

  // Drag & drop
  const [dragState, setDragState] = useState<{ draggedPos: number | null; dragOverPos: number | null }>({ draggedPos: null, dragOverPos: null })

  // ── Cluster firewall toggle ──
  const handleToggleClusterFirewall = async () => {
    if (!selectedConnection) return
    const newEnable = clusterOptions?.enable === 1 ? 0 : 1
    try {
      await firewallAPI.updateClusterOptions(selectedConnection, { enable: newEnable })
      showToast(newEnable === 1 ? t('networkPage.firewallEnabled') : t('networkPage.firewallDisabled'), 'success')
      setClusterOptions(prev => prev ? { ...prev, enable: newEnable } : { enable: newEnable })
      reload()
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  // ── Cluster policy change ──
  const handlePolicyChange = async (field: 'policy_in' | 'policy_out', value: string) => {
    if (!selectedConnection) return
    try {
      await firewallAPI.updateClusterOptions(selectedConnection, { [field]: value })
      setClusterOptions(prev => prev ? { ...prev, [field]: value } : { [field]: value })
      showToast(t('networkPage.policyUpdated'), 'success')
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  // ── Cluster section (for rule rendering) ──
  const clusterSection: PolicySection = useMemo(() => ({
    id: '__cluster__',
    type: 'cluster',
    name: t('network.clusterRules'),
    comment: '',
    rules: clusterRules,
    appliedTo: [],
    ruleCount: clusterRules.length,
    activeRuleCount: clusterRules.filter(r => r.enable !== 0).length,
  }), [clusterRules, t])

  // ── Cluster rule reload ──
  const reloadClusterRules = async () => {
    if (!selectedConnection) return
    try {
      const rules = await firewallAPI.getClusterRules(selectedConnection)
      setClusterRules(Array.isArray(rules) ? rules : [])
    } catch (err) {
      console.error('Error reloading cluster rules:', err)
    }
  }

  // ── Open rule dialog ──
  const openAddRule = () => {
    setRuleDialogIsNew(true)
    setRuleDialogEditPos(null)
    setRuleForm({ type: 'in', action: 'ACCEPT', enable: 1, proto: '', dport: '', sport: '', source: '', dest: '', macro: '', iface: '', log: 'nolog', comment: '' })
    setRuleDialogOpen(true)
  }

  const openEditRule = (rule: firewallAPI.FirewallRule) => {
    setRuleDialogIsNew(false)
    setRuleDialogEditPos(rule.pos)
    setRuleForm({
      type: rule.type || 'in', action: rule.action || 'ACCEPT', enable: rule.enable ?? 1,
      proto: rule.proto || '', dport: rule.dport || '', sport: rule.sport || '',
      source: rule.source || '', dest: rule.dest || '', macro: rule.macro || '',
      iface: rule.iface || '', log: rule.log || 'nolog', comment: rule.comment || ''
    })
    setRuleDialogOpen(true)
  }

  // ── Rule CRUD handlers ──
  const handleRuleSubmit = async () => {
    if (!selectedConnection) return
    try {
      if (ruleDialogIsNew) {
        await firewallAPI.addClusterRule(selectedConnection, ruleForm)
      } else if (ruleDialogEditPos !== null) {
        await fetch(`/api/v1/firewall/cluster/${selectedConnection}/rules/${ruleDialogEditPos}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ruleForm)
        })
      }
      showToast(ruleDialogIsNew ? t('network.ruleAdded') : t('network.ruleModified'), 'success')
      reloadClusterRules()
      setRuleDialogOpen(false)
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  // ── Toggle enable ──
  const handleToggleEnable = async (rule: firewallAPI.FirewallRule) => {
    if (!selectedConnection) return
    const newEnable = rule.enable === 1 ? 0 : 1
    try {
      await fetch(`/api/v1/firewall/cluster/${selectedConnection}/rules/${rule.pos}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...rule, enable: newEnable })
      })
      reloadClusterRules()
      showToast(newEnable === 1 ? t('network.ruleEnabled') : t('network.ruleDisabled'), 'success')
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  // ── Delete rule ──
  const handleDeleteRule = async () => {
    if (!deleteConfirm || !selectedConnection) return
    try {
      await firewallAPI.deleteClusterRule(selectedConnection, deleteConfirm.pos)
      reloadClusterRules()
      showToast(t('network.ruleDeleted'), 'success')
      setDeleteConfirm(null)
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  // ── Drag & drop ──
  const handleDragStart = (e: React.DragEvent, pos: number) => {
    setDragState({ draggedPos: pos, dragOverPos: null })
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', pos.toString())
    setTimeout(() => { (e.currentTarget as HTMLElement).style.opacity = '0.5' }, 0)
  }
  const handleDragEnd = (e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).style.opacity = '1'
    setDragState({ draggedPos: null, dragOverPos: null })
  }
  const handleDragOver = (e: React.DragEvent, pos: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragState.draggedPos !== null && dragState.draggedPos !== pos) {
      setDragState(prev => ({ ...prev, dragOverPos: pos }))
    }
  }
  const handleDragLeave = () => setDragState(prev => ({ ...prev, dragOverPos: null }))
  const handleDrop = async (e: React.DragEvent, toPos: number) => {
    e.preventDefault()
    const fromPos = dragState.draggedPos
    setDragState({ draggedPos: null, dragOverPos: null })
    if (fromPos === null || fromPos === toPos) return
    try {
      await fetch(`/api/v1/firewall/cluster/${selectedConnection}/rules/${fromPos}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ moveto: toPos })
      })
      reloadClusterRules()
      showToast(t('network.ruleMoved'), 'success')
    } catch (err: any) {
      showToast(err.message || t('networkPage.moveError'), 'error')
    }
  }

  // ── Render a rule row ──
  const renderRuleRow = (rule: firewallAPI.FirewallRule, idx: number) => {
    const isDragging = dragState.draggedPos === rule.pos
    const isDragOver = dragState.dragOverPos === rule.pos
    const isGroupRule = rule.type === 'group'

    return (
      <TableRow
        key={`cluster-rule-${idx}`}
        hover draggable
        onDragStart={e => handleDragStart(e, rule.pos)}
        onDragEnd={handleDragEnd}
        onDragOver={e => handleDragOver(e, rule.pos)}
        onDragLeave={handleDragLeave}
        onDrop={e => handleDrop(e, rule.pos)}
        sx={{
          cursor: 'grab', opacity: isDragging ? 0.5 : 1,
          borderTop: isDragOver ? `2px solid ${theme.palette.primary.main}` : undefined,
          '&:active': { cursor: 'grabbing' }
        }}
      >
        <TableCell sx={{ p: 0.5, cursor: 'grab', width: 30 }}>
          <i className="ri-draggable" style={{ fontSize: 14, color: theme.palette.text.disabled }} />
        </TableCell>
        <TableCell sx={{ fontSize: 11, color: 'text.secondary', p: 0.5, width: 35 }}>{rule.pos}</TableCell>
        <TableCell sx={{ p: 0.5, width: 55 }}>
          <Switch checked={rule.enable !== 0} onChange={() => handleToggleEnable(rule)} size="small" color="success" />
        </TableCell>
        <TableCell sx={{ p: 0.5, width: 65 }}>
          <Chip
            label={isGroupRule ? 'GROUP' : rule.type?.toUpperCase() || 'IN'}
            size="small"
            sx={{
              height: 20, fontSize: 10, fontWeight: 600,
              bgcolor: isGroupRule ? alpha('#8b5cf6', 0.22) : rule.type === 'in' ? alpha('#3b82f6', 0.22) : alpha('#ec4899', 0.22),
              color: isGroupRule ? '#8b5cf6' : rule.type === 'in' ? '#3b82f6' : '#ec4899'
            }}
          />
        </TableCell>
        <TableCell sx={{ ...monoStyle, fontSize: 11, p: 0.5, color: (isGroupRule || !rule.source) ? 'text.disabled' : 'text.primary' }}>
          {isGroupRule ? '-' : (rule.source || 'any')}
        </TableCell>
        <TableCell sx={{ ...monoStyle, fontSize: 11, p: 0.5, color: (isGroupRule || !rule.dest) ? 'text.disabled' : 'text.primary' }}>
          {isGroupRule ? '-' : (rule.dest || 'any')}
        </TableCell>
        <TableCell sx={{ ...monoStyle, fontSize: 11, p: 0.5, width: 100 }}>
          {formatService(rule)}
        </TableCell>
        <TableCell sx={{ p: 0.5, width: 90 }}>
          {isGroupRule ? (
            <Chip icon={<i className="ri-shield-line" style={{ fontSize: 10 }} />} label={rule.action} size="small" sx={{ height: 22, fontSize: 10, fontWeight: 600, bgcolor: alpha('#8b5cf6', 0.22), color: '#8b5cf6', '& .MuiChip-icon': { color: '#8b5cf6' } }} />
          ) : (
            <ActionChip action={rule.action || 'ACCEPT'} />
          )}
        </TableCell>
        <TableCell sx={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', p: 0.5 }}>
          <Tooltip title={rule.comment || ''}><span style={{ fontSize: 11 }}>{rule.comment || '-'}</span></Tooltip>
        </TableCell>
        <TableCell sx={{ p: 0.5, width: 70 }}>
          <Box sx={{ display: 'flex', gap: 0 }}>
            <Tooltip title={t('networkPage.edit')}>
              <IconButton size="small" onClick={() => openEditRule(rule)}>
                <i className="ri-pencil-line" style={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('networkPage.delete')}>
              <IconButton size="small" color="error" onClick={() => setDeleteConfirm({ pos: rule.pos })}>
                <i className="ri-delete-bin-line" style={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          </Box>
        </TableCell>
      </TableRow>
    )
  }

  return (
    <>
      {/* ═══ Cluster Firewall Policy + Rules ═══ */}
      <Paper sx={{ border: `1px solid ${alpha(theme.palette.divider, 0.1)}`, overflow: 'hidden' }}>
        {/* Header: title + switch + policy selects */}
        <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2, borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <i className="ri-shield-flash-line" style={{ fontSize: 20, color: theme.palette.primary.main }} />
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Cluster Firewall</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Switch
                checked={clusterOptions?.enable === 1}
                onChange={handleToggleClusterFirewall}
                color="success"
                size="small"
                disabled={!selectedConnection}
              />
              <Typography variant="caption" sx={{ fontWeight: 600, color: clusterOptions?.enable === 1 ? '#22c55e' : 'text.secondary', fontSize: 11 }}>
                {clusterOptions?.enable === 1 ? 'ON' : 'OFF'}
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>Policy IN:</Typography>
              <FormControl size="small" sx={{ minWidth: 100 }}>
                <Select
                  value={clusterOptions?.policy_in || 'DROP'}
                  onChange={(e) => handlePolicyChange('policy_in', e.target.value)}
                  sx={{ fontSize: 12, height: 28, '& .MuiSelect-select': { py: 0.3 } }}
                  disabled={!selectedConnection}
                >
                  <MenuItem value="ACCEPT">ACCEPT</MenuItem>
                  <MenuItem value="DROP">DROP</MenuItem>
                  <MenuItem value="REJECT">REJECT</MenuItem>
                </Select>
              </FormControl>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>Policy OUT:</Typography>
              <FormControl size="small" sx={{ minWidth: 100 }}>
                <Select
                  value={clusterOptions?.policy_out || 'ACCEPT'}
                  onChange={(e) => handlePolicyChange('policy_out', e.target.value)}
                  sx={{ fontSize: 12, height: 28, '& .MuiSelect-select': { py: 0.3 } }}
                  disabled={!selectedConnection}
                >
                  <MenuItem value="ACCEPT">ACCEPT</MenuItem>
                  <MenuItem value="DROP">DROP</MenuItem>
                  <MenuItem value="REJECT">REJECT</MenuItem>
                </Select>
              </FormControl>
            </Box>
            <Tooltip title={t('networkPage.addRule')}>
              <IconButton size="small" onClick={openAddRule} disabled={!selectedConnection}>
                <i className="ri-add-line" style={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {/* Cluster Rules Table */}
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: alpha(theme.palette.background.default, 0.5) }}>
                <TableCell sx={{ ...headCellSx, width: 30, p: 0.5 }}></TableCell>
                <TableCell sx={{ ...headCellSx, width: 35 }}>#</TableCell>
                <TableCell sx={{ ...headCellSx, width: 55 }}>{t('common.active')}</TableCell>
                <TableCell sx={{ ...headCellSx, width: 65 }}>{t('firewall.direction')}</TableCell>
                <TableCell sx={headCellSx}>{t('network.source')}</TableCell>
                <TableCell sx={headCellSx}>{t('network.destination')}</TableCell>
                <TableCell sx={{ ...headCellSx, width: 100 }}>{t('firewall.service')}</TableCell>
                <TableCell sx={{ ...headCellSx, width: 90 }}>{t('firewall.action')}</TableCell>
                <TableCell sx={headCellSx}>{t('network.comment')}</TableCell>
                <TableCell sx={{ width: 70 }}></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {clusterRules.length > 0 ? (
                clusterRules.map((rule, idx) => renderRuleRow(rule, idx))
              ) : (
                <TableRow>
                  <TableCell colSpan={10} sx={{ py: 3, textAlign: 'center', color: 'text.secondary' }}>
                    <Typography variant="body2">{t('networkPage.noRules')}</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>

        {/* Add Rule button */}
        <Box sx={{ p: 1.5, display: 'flex', justifyContent: 'flex-end', borderTop: `1px solid ${alpha(theme.palette.divider, 0.08)}` }}>
          <Button size="small" startIcon={<i className="ri-add-line" />} onClick={openAddRule} disabled={!selectedConnection}>
            {t('networkPage.addRule')}
          </Button>
        </Box>
      </Paper>

      {/* ══ DIALOGS ══ */}

      {/* Rule form dialog */}
      <RuleFormDialog
        open={ruleDialogOpen}
        onClose={() => setRuleDialogOpen(false)}
        onSubmit={handleRuleSubmit}
        isNew={ruleDialogIsNew}
        scope={{ type: 'cluster' }}
        rule={ruleForm}
        onRuleChange={setRuleForm}
        securityGroups={securityGroups}
        aliases={aliases}
        ipsets={ipsets}
      />

      {/* Delete Rule Confirmation */}
      <Dialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className="ri-error-warning-line" style={{ fontSize: 20, color: '#ef4444' }} />
            {t('networkPage.deleteRuleConfirm')}
          </Box>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('networkPage.deleteClusterRuleWarning', { pos: deleteConfirm?.pos })}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteConfirm(null)}>{t('common.cancel')}</Button>
          <Button variant="contained" color="error" onClick={handleDeleteRule} startIcon={<i className="ri-delete-bin-line" />}>
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
