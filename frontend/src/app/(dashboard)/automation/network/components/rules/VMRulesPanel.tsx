'use client'

import { Fragment, useState, useMemo } from 'react'
import { useTranslations } from 'next-intl'

import {
  Autocomplete, Box, Button, Chip, Dialog, DialogTitle, DialogContent, DialogActions,
  FormControl, Grid, IconButton, InputLabel, LinearProgress, MenuItem, Paper, Select, Stack,
  Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip,
  Typography, useTheme, alpha
} from '@mui/material'

import * as firewallAPI from '@/lib/api/firewall'
import { VMFirewallInfo } from '@/hooks/useVMFirewallRules'
import { useToast } from '@/contexts/ToastContext'
import { DEFAULT_RULE, monoStyle } from '../../types'

interface VMRulesPanelProps {
  vmFirewallData: VMFirewallInfo[]
  loadingVMRules: boolean
  selectedConnection: string
  loadVMFirewallData: () => Promise<void>
  reloadVMFirewallRules: (vm: VMFirewallInfo) => Promise<void>
  aliases: firewallAPI.Alias[]
  ipsets: firewallAPI.IPSet[]
}

// ── Helpers ──

const ActionChip = ({ action }: { action: string }) => {
  const colors: Record<string, string> = { ACCEPT: '#22c55e', DROP: '#ef4444', REJECT: '#f59e0b' }
  const color = colors[action] || '#94a3b8'
  return <Chip size="small" label={action} sx={{ height: 22, fontSize: 11, fontWeight: 700, bgcolor: alpha(color, 0.15), color, border: `1px solid ${alpha(color, 0.3)}`, minWidth: 70 }} />
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

const headCellSx = { fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap' } as const

const VLAN_COLORS = ['#f59e0b', '#3b82f6', '#8b5cf6', '#06b6d4', '#ec4899', '#10b981', '#f97316', '#6366f1', '#14b8a6', '#e11d48']
function getVlanColor(vlanKey: string, index: number): string {
  if (vlanKey === '__untagged__') return '#94a3b8'
  return VLAN_COLORS[index % VLAN_COLORS.length]
}

// ── Main Component ──

export default function VMRulesPanel({ vmFirewallData, loadingVMRules, selectedConnection, loadVMFirewallData, reloadVMFirewallRules, aliases, ipsets }: VMRulesPanelProps) {
  const theme = useTheme()
  const t = useTranslations()
  const { showToast } = useToast()

  const [expandedVMs, setExpandedVMs] = useState<Set<number>>(new Set())
  const [vmSearchQuery, setVmSearchQuery] = useState('')
  const [vmRuleDialogOpen, setVmRuleDialogOpen] = useState(false)
  const [editingVMRule, setEditingVMRule] = useState<{ vm: VMFirewallInfo; rule: firewallAPI.FirewallRule | null; isNew: boolean } | null>(null)
  const [deleteVMRuleConfirm, setDeleteVMRuleConfirm] = useState<{ vm: VMFirewallInfo; pos: number } | null>(null)
  const [newVMRule, setNewVMRule] = useState<firewallAPI.CreateRuleRequest>({ ...DEFAULT_RULE })
  const [vmDragState, setVmDragState] = useState<{ vmid: number; draggedPos: number | null; dragOverPos: number | null }>({ vmid: 0, draggedPos: null, dragOverPos: null })

  const [expandedVlans, setExpandedVlans] = useState<Set<string>>(new Set())

  const filteredVMData = vmFirewallData.filter(vm =>
    !vmSearchQuery ||
    vm.name.toLowerCase().includes(vmSearchQuery.toLowerCase()) ||
    vm.vmid.toString().includes(vmSearchQuery) ||
    vm.node.toLowerCase().includes(vmSearchQuery.toLowerCase()) ||
    vm.vlans.some(v => v.toString().includes(vmSearchQuery))
  )

  // Group VMs by primary VLAN (first tag from net0)
  const vlanGroups = useMemo(() => {
    const map = new Map<string, VMFirewallInfo[]>()
    for (const vm of filteredVMData) {
      const key = vm.vlans.length > 0 ? String(vm.vlans[0]) : '__untagged__'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(vm)
    }
    // Sort: numbered VLANs ascending, then untagged last
    return Array.from(map.entries()).sort((a, b) => {
      if (a[0] === '__untagged__') return 1
      if (b[0] === '__untagged__') return -1
      return parseInt(a[0]) - parseInt(b[0])
    })
  }, [filteredVMData])

  const autocompleteOptions = useMemo(() => {
    const opts: { label: string; secondary?: string }[] = []
    for (const a of aliases) opts.push({ label: a.name, secondary: a.cidr })
    for (const s of ipsets) opts.push({ label: `+${s.name}`, secondary: s.comment || `${s.members?.length || 0} entries` })
    return opts
  }, [aliases, ipsets])

  // ── Toggle VM firewall (modifies NIC config firewall=0/1) ──
  const handleToggleVMFirewall = async (vm: VMFirewallInfo) => {
    if (!selectedConnection) return
    const newEnable = !vm.firewallEnabled
    try {
      await firewallAPI.toggleVMNICFirewall(selectedConnection, vm.node, vm.type, vm.vmid, newEnable)
      showToast(newEnable ? t('networkPage.firewallEnabled') : t('networkPage.firewallDisabled'), 'success')
      reloadVMFirewallRules(vm)
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  // ── Change VM policy (policy_in / policy_out) ──
  const handleVMPolicyChange = async (vm: VMFirewallInfo, field: 'policy_in' | 'policy_out', value: string) => {
    if (!selectedConnection) return
    try {
      await firewallAPI.updateVMOptions(selectedConnection, vm.node, vm.type, vm.vmid, { [field]: value })
      showToast(t('networkPage.policyUpdated'), 'success')
      reloadVMFirewallRules(vm)
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  // ── CRUD handlers ──
  const openVMRuleDialog = (vm: VMFirewallInfo, rule: firewallAPI.FirewallRule | null = null) => {
    setEditingVMRule({ vm, rule, isNew: !rule })
    if (rule) {
      setNewVMRule({
        type: rule.type || 'in', action: rule.action || 'ACCEPT', enable: rule.enable ?? 1,
        proto: rule.proto || '', dport: rule.dport || '', sport: rule.sport || '',
        source: rule.source || '', dest: rule.dest || '', macro: rule.macro || '',
        iface: rule.iface || '', log: rule.log || 'nolog', comment: rule.comment || ''
      })
    } else {
      setNewVMRule({ ...DEFAULT_RULE })
    }
    setVmRuleDialogOpen(true)
  }

  const handleSaveVMRule = async () => {
    if (!editingVMRule || !selectedConnection) return
    const { vm, rule, isNew } = editingVMRule
    try {
      if (isNew) {
        await firewallAPI.addVMRule(selectedConnection, vm.node, vm.type, vm.vmid, newVMRule)
        showToast(t('network.ruleCreatedSuccess'), 'success')
      } else if (rule) {
        await firewallAPI.updateVMRule(selectedConnection, vm.node, vm.type, vm.vmid, rule.pos, newVMRule)
        showToast(t('network.ruleUpdated'), 'success')
      }
      setVmRuleDialogOpen(false)
      setEditingVMRule(null)
      reloadVMFirewallRules(vm)
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  const handleDeleteVMRule = async () => {
    if (!deleteVMRuleConfirm) return
    const { vm, pos } = deleteVMRuleConfirm
    try {
      await firewallAPI.deleteVMRule(selectedConnection, vm.node, vm.type, vm.vmid, pos)
      showToast(t('network.ruleDeleted'), 'success')
      setDeleteVMRuleConfirm(null)
      reloadVMFirewallRules(vm)
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  const handleToggleVMRuleEnable = async (vm: VMFirewallInfo, rule: firewallAPI.FirewallRule) => {
    try {
      await firewallAPI.updateVMRule(selectedConnection, vm.node, vm.type, vm.vmid, rule.pos, { ...rule, enable: rule.enable === 1 ? 0 : 1 })
      showToast(rule.enable === 1 ? t('network.ruleDisabled') : t('network.ruleEnabled'), 'success')
      reloadVMFirewallRules(vm)
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  // ── Drag & drop ──
  const handleDragStart = (e: React.DragEvent, vmid: number, pos: number) => {
    setVmDragState({ vmid, draggedPos: pos, dragOverPos: null })
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', pos.toString())
    setTimeout(() => { (e.currentTarget as HTMLElement).style.opacity = '0.5' }, 0)
  }
  const handleDragEnd = (e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).style.opacity = '1'
    setVmDragState({ vmid: 0, draggedPos: null, dragOverPos: null })
  }
  const handleDragOver = (e: React.DragEvent, vmid: number, pos: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (vmDragState.vmid === vmid && vmDragState.draggedPos !== null && vmDragState.draggedPos !== pos) {
      setVmDragState(prev => ({ ...prev, dragOverPos: pos }))
    }
  }
  const handleDragLeave = () => setVmDragState(prev => ({ ...prev, dragOverPos: null }))
  const handleDrop = async (e: React.DragEvent, vm: VMFirewallInfo, toPos: number) => {
    e.preventDefault()
    const fromPos = vmDragState.draggedPos
    setVmDragState({ vmid: 0, draggedPos: null, dragOverPos: null })
    if (fromPos !== null && fromPos !== toPos && vmDragState.vmid === vm.vmid) {
      try {
        await fetch(`/api/v1/firewall/vms/${selectedConnection}/${vm.node}/${vm.type}/${vm.vmid}/rules/${fromPos}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ moveto: toPos })
        })
        showToast(t('network.ruleMoved'), 'success')
        reloadVMFirewallRules(vm)
      } catch (err: any) {
        showToast(err.message || t('networkPage.moveError'), 'error')
      }
    }
  }

  const sectionRowBg = alpha(theme.palette.primary.main, 0.06)
  const sectionRowHoverBg = alpha(theme.palette.primary.main, 0.10)

  return (
    <>
      {/* Toolbar */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <TextField
            size="small" placeholder={t('networkPage.searchVm')} value={vmSearchQuery}
            onChange={e => setVmSearchQuery(e.target.value)}
            InputProps={{
              startAdornment: <i className="ri-search-line" style={{ marginRight: 6, fontSize: 16, color: theme.palette.text.disabled }} />,
              sx: { fontSize: 13 }
            }}
            sx={{ width: 200 }}
          />
          <Button size="small" variant="outlined" onClick={() => { setExpandedVlans(new Set(vlanGroups.map(([k]) => k))); setExpandedVMs(new Set(filteredVMData.map(v => v.vmid))) }}>{t('common.expandAll')}</Button>
          <Button size="small" variant="outlined" onClick={() => { setExpandedVlans(new Set()); setExpandedVMs(new Set()) }}>{t('common.collapseAll')}</Button>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Chip label={t('networkPage.vmsProtectedCount', { filtered: filteredVMData.length, total: vmFirewallData.length, protected: vmFirewallData.filter(v => v.firewallEnabled).length })} size="small" />
          <Button size="small" variant="outlined" startIcon={<i className="ri-refresh-line" />} onClick={loadVMFirewallData} disabled={loadingVMRules}>
            {t('networkPage.refresh')}
          </Button>
        </Box>
      </Box>

      {loadingVMRules ? (
        <Box sx={{ py: 4 }}>
          <LinearProgress />
          <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', mt: 2 }}>{t('networkPage.loadingFirewallRules')}</Typography>
        </Box>
      ) : filteredVMData.length > 0 ? (
        <TableContainer component={Paper} sx={{ border: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
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
              {vlanGroups.map(([vlanKey, vms], vlanIdx) => {
                const isUntagged = vlanKey === '__untagged__'
                const vlanLabel = isUntagged ? t('networkPage.untagged') : `VLAN ${vlanKey}`
                const isVlanExpanded = expandedVlans.has(vlanKey)
                const vlanVmCount = vms.length
                const vlanRulesCount = vms.reduce((acc, v) => acc + v.rules.length, 0)
                const vlanColor = getVlanColor(vlanKey, vlanIdx)

                return (
                  <Fragment key={`vlan-${vlanKey}`}>
                    {/* VLAN group header */}
                    <TableRow
                      sx={{
                        bgcolor: alpha(vlanColor, 0.06),
                        '&:hover': { bgcolor: alpha(vlanColor, 0.10) },
                        cursor: 'pointer',
                        '& td': { borderBottom: `1px solid ${alpha(theme.palette.divider, 0.2)}` }
                      }}
                      onClick={() => setExpandedVlans(prev => { const n = new Set(prev); if (n.has(vlanKey)) n.delete(vlanKey); else n.add(vlanKey); return n })}
                    >
                      <TableCell colSpan={10} sx={{ py: 1, px: 2 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                          <i
                            className={isVlanExpanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'}
                            style={{ fontSize: 20, color: vlanColor }}
                          />
                          <i className={isUntagged ? 'ri-ethernet-line' : 'ri-git-branch-line'} style={{ fontSize: 16, color: vlanColor }} />
                          <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: 13, color: vlanColor }}>{vlanLabel}</Typography>
                          <Chip label={`${vlanVmCount} VM${vlanVmCount > 1 ? 's' : ''}`} size="small" sx={{ height: 20, fontSize: 10, fontWeight: 600, bgcolor: alpha(vlanColor, 0.12), color: vlanColor }} />
                          <Chip label={t('networkPage.totalRules', { count: vlanRulesCount })} size="small" sx={{ height: 20, fontSize: 10, bgcolor: alpha(vlanColor, 0.08) }} />
                        </Box>
                      </TableCell>
                    </TableRow>

                    {/* VMs in this VLAN group */}
                    {isVlanExpanded && vms.map(vm => {
                      const isExpanded = expandedVMs.has(vm.vmid)

                      return (
                        <Fragment key={vm.vmid}>
                          {/* VM section header row */}
                          <TableRow
                            sx={{
                              bgcolor: sectionRowBg,
                              '&:hover': { bgcolor: sectionRowHoverBg },
                              cursor: 'pointer',
                              '& td': { borderBottom: `1px solid ${alpha(theme.palette.divider, 0.15)}` }
                            }}
                            onClick={() => setExpandedVMs(prev => { const n = new Set(prev); if (n.has(vm.vmid)) n.delete(vm.vmid); else n.add(vm.vmid); return n })}
                          >
                            <TableCell colSpan={10} sx={{ py: 1, px: 2, pl: 5 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                                  <i
                                    className={isExpanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'}
                                    style={{ fontSize: 20, color: theme.palette.text.secondary, flexShrink: 0 }}
                                  />
                                  <i
                                    className={vm.type === 'qemu' ? 'ri-computer-line' : 'ri-instance-line'}
                                    style={{ fontSize: 16, color: vm.firewallEnabled ? '#22c55e' : theme.palette.text.secondary, flexShrink: 0 }}
                                  />
                                  <code style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>{vm.name}</code>
                                  <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 11 }}>({vm.vmid})</Typography>
                                  <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 11 }}>{vm.node}</Typography>
                                  <Chip
                                    label={t('firewall.rulesCount', { count: vm.rules.length })}
                                    size="small"
                                    sx={{ height: 20, fontSize: 10, ml: 0.5 }}
                                  />
                                </Box>
                                <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mr: 1 }}>
                                    <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', fontSize: 10 }}>IN:</Typography>
                                    <FormControl size="small">
                                      <Select
                                        value={vm.options?.policy_in || 'ACCEPT'}
                                        onChange={(e) => handleVMPolicyChange(vm, 'policy_in', e.target.value)}
                                        sx={{ fontSize: 11, height: 24, minWidth: 80, '& .MuiSelect-select': { py: 0.2 } }}
                                        disabled={!selectedConnection}
                                      >
                                        <MenuItem value="ACCEPT">ACCEPT</MenuItem>
                                        <MenuItem value="DROP">DROP</MenuItem>
                                        <MenuItem value="REJECT">REJECT</MenuItem>
                                      </Select>
                                    </FormControl>
                                    <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', fontSize: 10 }}>OUT:</Typography>
                                    <FormControl size="small">
                                      <Select
                                        value={vm.options?.policy_out || 'ACCEPT'}
                                        onChange={(e) => handleVMPolicyChange(vm, 'policy_out', e.target.value)}
                                        sx={{ fontSize: 11, height: 24, minWidth: 80, '& .MuiSelect-select': { py: 0.2 } }}
                                        disabled={!selectedConnection}
                                      >
                                        <MenuItem value="ACCEPT">ACCEPT</MenuItem>
                                        <MenuItem value="DROP">DROP</MenuItem>
                                        <MenuItem value="REJECT">REJECT</MenuItem>
                                      </Select>
                                    </FormControl>
                                  </Box>
                                  <Tooltip title={t('networkPage.addRule')}>
                                    <IconButton size="small" onClick={() => openVMRuleDialog(vm)}>
                                      <i className="ri-add-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </Tooltip>
                                  <Switch
                                    checked={vm.firewallEnabled}
                                    onChange={() => handleToggleVMFirewall(vm)}
                                    color="success"
                                    size="small"
                                    disabled={!selectedConnection}
                                  />
                                  <Typography variant="caption" sx={{ fontWeight: 600, color: vm.firewallEnabled ? '#22c55e' : 'text.secondary', fontSize: 11, minWidth: 24 }}>
                                    {vm.firewallEnabled ? 'ON' : 'OFF'}
                                  </Typography>
                                </Box>
                              </Box>
                            </TableCell>
                          </TableRow>

                          {/* Rule rows when expanded */}
                          {isExpanded && (vm.rules.length > 0 ? vm.rules.map((rule, idx) => {
                      const isDragging = vmDragState.vmid === vm.vmid && vmDragState.draggedPos === rule.pos
                      const isDragOver = vmDragState.vmid === vm.vmid && vmDragState.dragOverPos === rule.pos
                      const isGroupRule = rule.type === 'group'

                      return (
                        <TableRow
                          key={`${vm.vmid}-rule-${idx}`}
                          hover draggable
                          onDragStart={e => handleDragStart(e, vm.vmid, rule.pos)}
                          onDragEnd={handleDragEnd}
                          onDragOver={e => handleDragOver(e, vm.vmid, rule.pos)}
                          onDragLeave={handleDragLeave}
                          onDrop={e => handleDrop(e, vm, rule.pos)}
                          sx={{
                            cursor: 'grab', opacity: isDragging ? 0.5 : (rule.enable === 0 ? 0.5 : 1),
                            borderTop: isDragOver ? `2px solid ${theme.palette.primary.main}` : undefined,
                            '&:active': { cursor: 'grabbing' }
                          }}
                        >
                          <TableCell sx={{ p: 0.5, cursor: 'grab', width: 30 }}>
                            <i className="ri-draggable" style={{ fontSize: 14, color: theme.palette.text.disabled }} />
                          </TableCell>
                          <TableCell sx={{ fontSize: 11, color: 'text.secondary', p: 0.5, width: 35 }}>{rule.pos}</TableCell>
                          <TableCell sx={{ p: 0.5, width: 55 }}>
                            <Switch checked={rule.enable === 1} onChange={() => handleToggleVMRuleEnable(vm, rule)} size="small" color="success" />
                          </TableCell>
                          <TableCell sx={{ p: 0.5, width: 65 }}>
                            <Chip
                              label={isGroupRule ? 'GROUP' : rule.type?.toUpperCase() || 'IN'}
                              size="small"
                              sx={{
                                height: 20, fontSize: 10, fontWeight: 600,
                                bgcolor: isGroupRule ? alpha('#8b5cf6', 0.15) : rule.type === 'in' ? alpha('#3b82f6', 0.15) : alpha('#ec4899', 0.15),
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
                              <Chip icon={<i className="ri-shield-line" style={{ fontSize: 10 }} />} label={rule.action} size="small" sx={{ height: 22, fontSize: 10, fontWeight: 600, bgcolor: alpha('#8b5cf6', 0.15), color: '#8b5cf6', '& .MuiChip-icon': { color: '#8b5cf6' } }} />
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
                                <IconButton size="small" onClick={() => openVMRuleDialog(vm, rule)}>
                                  <i className="ri-pencil-line" style={{ fontSize: 14 }} />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title={t('networkPage.delete')}>
                                <IconButton size="small" color="error" onClick={() => setDeleteVMRuleConfirm({ vm, pos: rule.pos })}>
                                  <i className="ri-delete-bin-line" style={{ fontSize: 14 }} />
                                </IconButton>
                              </Tooltip>
                            </Box>
                          </TableCell>
                        </TableRow>
                      )
                    }) : (
                      <TableRow key={`empty-${vm.vmid}`}>
                        <TableCell colSpan={10} sx={{ py: 3, textAlign: 'center', color: 'text.secondary' }}>
                          <Typography variant="body2">{t('networkPage.noRuleConfigured')}</Typography>
                          <Button size="small" sx={{ mt: 1 }} startIcon={<i className="ri-add-line" />} onClick={() => openVMRuleDialog(vm)}>
                            {t('networkPage.addRule')}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                        </Fragment>
                      )
                    })}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <Paper sx={{ p: 4, textAlign: 'center', border: `1px dashed ${alpha(theme.palette.divider, 0.3)}` }}>
          <i className="ri-computer-line" style={{ fontSize: 48, opacity: 0.3 }} />
          <Typography variant="body1" sx={{ mt: 2, color: 'text.secondary' }}>{t('networkPage.noVmFoundLabel')}</Typography>
          <Button sx={{ mt: 2 }} onClick={loadVMFirewallData}>{t('common.loadVms')}</Button>
        </Paper>
      )}

      {/* ══ DIALOGS ══ */}

      {/* VM Rule Dialog */}
      <Dialog open={vmRuleDialogOpen} onClose={() => setVmRuleDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className="ri-shield-line" style={{ color: theme.palette.primary.main }} />
            {editingVMRule?.isNew ? t('networkPage.addVmRuleTitle') : t('networkPage.editVmRuleTitle')}
            {editingVMRule && <Chip label={`${editingVMRule.vm.name} (${editingVMRule.vm.vmid})`} size="small" sx={{ ml: 1 }} />}
          </Box>
          <IconButton onClick={() => setVmRuleDialogOpen(false)} size="small"><i className="ri-close-line" /></IconButton>
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Grid container spacing={2.5}>
            <Grid size={{ xs: 6, sm: 2.5 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Direction</InputLabel>
                <Select value={newVMRule.type} label="Direction" onChange={(e) => setNewVMRule(prev => ({ ...prev, type: e.target.value }))}>
                  <MenuItem value="in">IN</MenuItem>
                  <MenuItem value="out">OUT</MenuItem>
                  <MenuItem value="group">GROUP</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, sm: 2.5 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Action</InputLabel>
                <Select value={newVMRule.action} label="Action" onChange={(e) => setNewVMRule(prev => ({ ...prev, action: e.target.value }))}>
                  <MenuItem value="ACCEPT">ACCEPT</MenuItem>
                  <MenuItem value="DROP">DROP</MenuItem>
                  <MenuItem value="REJECT">REJECT</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Macro</InputLabel>
                <Select value={newVMRule.macro || ''} label="Macro" onChange={(e) => setNewVMRule(prev => ({ ...prev, macro: e.target.value, proto: e.target.value ? '' : prev.proto }))}>
                  <MenuItem value="">{t('common.none')}</MenuItem>
                  <MenuItem value="SSH">SSH</MenuItem>
                  <MenuItem value="HTTP">HTTP</MenuItem>
                  <MenuItem value="HTTPS">HTTPS</MenuItem>
                  <MenuItem value="DNS">DNS</MenuItem>
                  <MenuItem value="Ping">Ping</MenuItem>
                  <MenuItem value="Web">Web (HTTP+HTTPS)</MenuItem>
                  <MenuItem value="SMTP">SMTP</MenuItem>
                  <MenuItem value="FTP">FTP</MenuItem>
                  <MenuItem value="NTP">NTP</MenuItem>
                  <MenuItem value="MySQL">MySQL</MenuItem>
                  <MenuItem value="PostgreSQL">PostgreSQL</MenuItem>
                  <MenuItem value="Redis">Redis</MenuItem>
                  <MenuItem value="Ceph">Ceph</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, sm: 2 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Protocole</InputLabel>
                <Select value={newVMRule.proto || ''} label="Protocole" onChange={(e) => setNewVMRule(prev => ({ ...prev, proto: e.target.value }))} disabled={!!newVMRule.macro}>
                  <MenuItem value="">Tous</MenuItem>
                  <MenuItem value="tcp">TCP</MenuItem>
                  <MenuItem value="udp">UDP</MenuItem>
                  <MenuItem value="icmp">ICMP</MenuItem>
                  <MenuItem value="sctp">SCTP</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, sm: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', border: `1px solid ${alpha(theme.palette.divider, 0.3)}`, borderRadius: 1, px: 1 }}>
                <Switch checked={newVMRule.enable === 1} onChange={(e) => setNewVMRule(prev => ({ ...prev, enable: e.target.checked ? 1 : 0 }))} color="success" size="small" />
                <Typography variant="body2" sx={{ ml: 0.5, fontSize: 13 }}>{t('common.enabled')}</Typography>
              </Box>
            </Grid>
            <Grid size={{ xs: 4, sm: 2 }}>
              <TextField label="Interface" value={newVMRule.iface || ''} onChange={(e) => setNewVMRule(prev => ({ ...prev, iface: e.target.value }))} fullWidth size="small" placeholder="net0" InputProps={{ sx: { fontFamily: 'monospace', fontSize: 13 } }} />
            </Grid>
            <Grid size={{ xs: 8, sm: 5 }}>
              <Autocomplete
                freeSolo
                options={autocompleteOptions}
                getOptionLabel={(opt) => typeof opt === 'string' ? opt : opt.label}
                inputValue={newVMRule.source || ''}
                onInputChange={(_, v) => setNewVMRule(prev => ({ ...prev, source: v }))}
                renderOption={(props, opt) => (
                  <li {...props} key={typeof opt === 'string' ? opt : opt.label}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                      <code style={{ fontSize: 12 }}>{typeof opt === 'string' ? opt : opt.label}</code>
                      {typeof opt !== 'string' && opt.secondary && (
                        <span style={{ fontSize: 11, opacity: 0.6, marginLeft: 8 }}>{opt.secondary}</span>
                      )}
                    </Box>
                  </li>
                )}
                renderInput={(params) => (
                  <TextField {...params} label="Source" fullWidth size="small" placeholder="192.168.1.0/24, +ipset, alias" InputProps={{ ...params.InputProps, sx: { fontFamily: 'monospace', fontSize: 13 } }} />
                )}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 5 }}>
              <TextField label="Port source" value={newVMRule.sport || ''} onChange={(e) => setNewVMRule(prev => ({ ...prev, sport: e.target.value }))} fullWidth size="small" placeholder="80, 1024:65535" InputProps={{ sx: { fontFamily: 'monospace', fontSize: 13 } }} disabled={!!newVMRule.macro} />
            </Grid>
            <Grid size={{ xs: 12, sm: 7 }}>
              <Autocomplete
                freeSolo
                options={autocompleteOptions}
                getOptionLabel={(opt) => typeof opt === 'string' ? opt : opt.label}
                inputValue={newVMRule.dest || ''}
                onInputChange={(_, v) => setNewVMRule(prev => ({ ...prev, dest: v }))}
                renderOption={(props, opt) => (
                  <li {...props} key={typeof opt === 'string' ? opt : opt.label}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                      <code style={{ fontSize: 12 }}>{typeof opt === 'string' ? opt : opt.label}</code>
                      {typeof opt !== 'string' && opt.secondary && (
                        <span style={{ fontSize: 11, opacity: 0.6, marginLeft: 8 }}>{opt.secondary}</span>
                      )}
                    </Box>
                  </li>
                )}
                renderInput={(params) => (
                  <TextField {...params} label="Destination" fullWidth size="small" placeholder="10.0.0.0/8, +ipset, alias" InputProps={{ ...params.InputProps, sx: { fontFamily: 'monospace', fontSize: 13 } }} />
                )}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 5 }}>
              <TextField label="Port destination" value={newVMRule.dport || ''} onChange={(e) => setNewVMRule(prev => ({ ...prev, dport: e.target.value }))} fullWidth size="small" placeholder="22, 80, 443, 8000:9000" InputProps={{ sx: { fontFamily: 'monospace', fontSize: 13 } }} disabled={!!newVMRule.macro} />
            </Grid>
            <Grid size={{ xs: 12, sm: 9 }}>
              <TextField label="Commentaire" value={newVMRule.comment || ''} onChange={(e) => setNewVMRule(prev => ({ ...prev, comment: e.target.value }))} fullWidth size="small" />
            </Grid>
            <Grid size={{ xs: 12, sm: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Log level</InputLabel>
                <Select value={newVMRule.log || 'nolog'} label="Log level" onChange={(e) => setNewVMRule(prev => ({ ...prev, log: e.target.value }))}>
                  <MenuItem value="nolog">nolog</MenuItem>
                  <MenuItem value="warning">warning</MenuItem>
                  <MenuItem value="info">info</MenuItem>
                  <MenuItem value="debug">debug</MenuItem>
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setVmRuleDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleSaveVMRule} startIcon={<i className="ri-check-line" />}>
            {editingVMRule?.isNew ? t('common.add') : t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete VM Rule Confirmation */}
      <Dialog open={!!deleteVMRuleConfirm} onClose={() => setDeleteVMRuleConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-error-warning-line" style={{ color: theme.palette.error.main, fontSize: 24 }} />
          {t('networkPage.deleteRule')}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2">{t('networkPage.deleteRuleQuestion')}</Typography>
          {deleteVMRuleConfirm && (
            <Box sx={{ mt: 2, p: 1.5, bgcolor: alpha(theme.palette.divider, 0.1), borderRadius: 1 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                VM: <strong>{deleteVMRuleConfirm.vm.name}</strong> ({deleteVMRuleConfirm.vm.vmid}) • Position: <strong>{deleteVMRuleConfirm.pos}</strong>
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteVMRuleConfirm(null)}>{t('common.cancel')}</Button>
          <Button variant="contained" color="error" onClick={handleDeleteVMRule} startIcon={<i className="ri-delete-bin-line" />}>{t('common.delete')}</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
