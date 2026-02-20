'use client'

import { useState, useMemo } from 'react'
import { useTranslations } from 'next-intl'

import {
  Avatar, Box, Button, Chip, Collapse, Dialog, DialogTitle, DialogContent, DialogActions,
  IconButton, Paper, Stack, Switch,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, Tooltip, Typography, useTheme, alpha
} from '@mui/material'

import * as firewallAPI from '@/lib/api/firewall'
import { VMFirewallInfo } from '@/hooks/useVMFirewallRules'
import { useToast } from '@/contexts/ToastContext'
import { PolicySection, PolicyCategory, classifySG, DEFAULT_RULE, monoStyle } from '../../types'
import RuleFormDialog, { RuleFormData } from './RuleFormDialog'

// ── Props ──

interface FirewallPolicyTableProps {
  clusterRules: firewallAPI.FirewallRule[]
  securityGroups: firewallAPI.SecurityGroup[]
  vmFirewallData: VMFirewallInfo[]
  firewallMode: firewallAPI.FirewallMode
  selectedConnection: string
  setClusterRules: React.Dispatch<React.SetStateAction<firewallAPI.FirewallRule[]>>
  reload: () => void
}

// ── Helpers ──

const CATEGORY_META: Record<PolicyCategory, { icon: string; label: string; color: string }> = {
  infrastructure: { icon: 'ri-server-line', label: 'networkPage.categoryInfrastructure', color: '#3b82f6' },
  application:    { icon: 'ri-apps-line', label: 'networkPage.categoryApplication', color: '#8b5cf6' },
  default:        { icon: 'ri-cloud-line', label: 'networkPage.categoryDefault', color: '#06b6d4' },
}

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

function computeAppliedTo(sgName: string, vmFirewallData: VMFirewallInfo[]): { vmid: number; name: string; node: string }[] {
  const vms: { vmid: number; name: string; node: string }[] = []
  for (const vm of vmFirewallData) {
    const hasRef = vm.rules.some(r => r.type === 'group' && r.action === sgName)
    if (hasRef) vms.push({ vmid: vm.vmid, name: vm.name, node: vm.node })
  }
  return vms
}

// ── Main Component ──

export default function FirewallPolicyTable({
  clusterRules, securityGroups, vmFirewallData, firewallMode,
  selectedConnection, setClusterRules, reload
}: FirewallPolicyTableProps) {
  const theme = useTheme()
  const t = useTranslations()
  const { showToast } = useToast()

  // ── State ──
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')

  // Rule CRUD
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false)
  const [ruleDialogScope, setRuleDialogScope] = useState<{ type: 'cluster' | 'security-group'; name?: string }>({ type: 'cluster' })
  const [ruleDialogIsNew, setRuleDialogIsNew] = useState(true)
  const [ruleDialogEditPos, setRuleDialogEditPos] = useState<number | null>(null)
  const [ruleForm, setRuleForm] = useState<RuleFormData>({ type: 'in', action: 'ACCEPT', enable: 1, proto: '', dport: '', sport: '', source: '', dest: '', macro: '', iface: '', log: 'nolog', comment: '' })

  // SG create dialog
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [newGroup, setNewGroup] = useState({ group: '', comment: '' })

  // Delete confirm
  const [deleteConfirm, setDeleteConfirm] = useState<{ scope: 'cluster' | 'security-group'; groupName?: string; pos: number } | null>(null)

  // Drag & drop
  const [dragState, setDragState] = useState<{ sectionId: string; draggedPos: number | null; dragOverPos: number | null }>({ sectionId: '', draggedPos: null, dragOverPos: null })

  // ── Build policy sections ──
  const sections: PolicySection[] = useMemo(() => {
    const result: PolicySection[] = []

    // Security groups → policies
    for (const sg of securityGroups) {
      const rules = sg.rules || []
      result.push({
        id: sg.group,
        category: classifySG(sg.group),
        type: 'security-group',
        name: sg.group,
        comment: sg.comment,
        rules,
        appliedTo: computeAppliedTo(sg.group, vmFirewallData),
        ruleCount: rules.length,
        activeRuleCount: rules.filter(r => r.enable !== 0).length,
      })
    }

    // Cluster rules → default policy (always last)
    result.push({
      id: '__cluster__',
      category: 'default',
      type: 'cluster',
      name: t('network.clusterRules'),
      comment: t('networkPage.defaultPolicyDesc'),
      rules: clusterRules,
      appliedTo: [],
      ruleCount: clusterRules.length,
      activeRuleCount: clusterRules.filter(r => r.enable !== 0).length,
    })

    return result
  }, [securityGroups, clusterRules, vmFirewallData, t])

  // ── Filter by search ──
  const filteredSections = useMemo(() => {
    if (!search.trim()) return sections
    const q = search.toLowerCase()
    return sections.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.comment?.toLowerCase().includes(q) ||
      s.rules.some(r => r.comment?.toLowerCase().includes(q) || r.source?.toLowerCase().includes(q) || r.dest?.toLowerCase().includes(q))
    )
  }, [sections, search])

  // ── Group by category ──
  const categorized = useMemo(() => {
    const cats: Record<PolicyCategory, PolicySection[]> = { infrastructure: [], application: [], default: [] }
    for (const s of filteredSections) cats[s.category].push(s)
    return cats
  }, [filteredSections])

  // ── Stats ──
  const totalPolicies = filteredSections.length
  const totalRulesCount = filteredSections.reduce((acc, s) => acc + s.ruleCount, 0)
  const totalActiveCount = filteredSections.reduce((acc, s) => acc + s.activeRuleCount, 0)

  // ── Section expand/collapse ──
  const toggleSection = (id: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const expandAll = () => setExpandedSections(new Set(filteredSections.map(s => s.id)))
  const collapseAll = () => setExpandedSections(new Set())

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
  const openAddRule = (scope: { type: 'cluster' | 'security-group'; name?: string }) => {
    setRuleDialogScope(scope)
    setRuleDialogIsNew(true)
    setRuleDialogEditPos(null)
    setRuleForm({ type: 'in', action: 'ACCEPT', enable: 1, proto: '', dport: '', sport: '', source: '', dest: '', macro: '', iface: '', log: 'nolog', comment: '' })
    setRuleDialogOpen(true)
  }

  const openEditRule = (scope: { type: 'cluster' | 'security-group'; name?: string }, rule: firewallAPI.FirewallRule) => {
    setRuleDialogScope(scope)
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
      if (ruleDialogScope.type === 'cluster') {
        if (ruleDialogIsNew) {
          await firewallAPI.addClusterRule(selectedConnection, ruleForm)
        } else if (ruleDialogEditPos !== null) {
          await fetch(`/api/v1/firewall/cluster/${selectedConnection}/rules/${ruleDialogEditPos}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ruleForm)
          })
        }
        showToast(ruleDialogIsNew ? t('network.ruleAdded') : t('network.ruleModified'), 'success')
        reloadClusterRules()
      } else {
        const sgName = ruleDialogScope.name!
        if (ruleDialogIsNew) {
          await firewallAPI.addSecurityGroupRule(selectedConnection, sgName, ruleForm)
        } else if (ruleDialogEditPos !== null) {
          await firewallAPI.updateSecurityGroupRule(selectedConnection, sgName, ruleDialogEditPos, ruleForm)
        }
        showToast(ruleDialogIsNew ? t('network.ruleAdded') : t('network.ruleUpdated'), 'success')
        reload()
      }
      setRuleDialogOpen(false)
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  // ── Toggle enable ──
  const handleToggleEnable = async (section: PolicySection, rule: firewallAPI.FirewallRule) => {
    if (!selectedConnection) return
    const newEnable = rule.enable === 1 ? 0 : 1
    try {
      if (section.type === 'cluster') {
        await fetch(`/api/v1/firewall/cluster/${selectedConnection}/rules/${rule.pos}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...rule, enable: newEnable })
        })
        reloadClusterRules()
      } else {
        await firewallAPI.updateSecurityGroupRule(selectedConnection, section.id, rule.pos, { ...rule, enable: newEnable })
        reload()
      }
      showToast(newEnable === 1 ? t('network.ruleEnabled') : t('network.ruleDisabled'), 'success')
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  // ── Delete rule ──
  const handleDeleteRule = async () => {
    if (!deleteConfirm || !selectedConnection) return
    try {
      if (deleteConfirm.scope === 'cluster') {
        await firewallAPI.deleteClusterRule(selectedConnection, deleteConfirm.pos)
        reloadClusterRules()
      } else {
        await firewallAPI.deleteSecurityGroupRule(selectedConnection, deleteConfirm.groupName!, deleteConfirm.pos)
        reload()
      }
      showToast(t('network.ruleDeleted'), 'success')
      setDeleteConfirm(null)
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  // ── Delete SG ──
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

  // ── Create SG ──
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

  // ── Drag & drop ──
  const handleDragStart = (e: React.DragEvent, sectionId: string, pos: number) => {
    setDragState({ sectionId, draggedPos: pos, dragOverPos: null })
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', pos.toString())
    setTimeout(() => { (e.currentTarget as HTMLElement).style.opacity = '0.5' }, 0)
  }
  const handleDragEnd = (e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).style.opacity = '1'
    setDragState({ sectionId: '', draggedPos: null, dragOverPos: null })
  }
  const handleDragOver = (e: React.DragEvent, sectionId: string, pos: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragState.sectionId === sectionId && dragState.draggedPos !== null && dragState.draggedPos !== pos) {
      setDragState(prev => ({ ...prev, dragOverPos: pos }))
    }
  }
  const handleDragLeave = () => setDragState(prev => ({ ...prev, dragOverPos: null }))
  const handleDrop = async (e: React.DragEvent, section: PolicySection, toPos: number) => {
    e.preventDefault()
    const fromPos = dragState.draggedPos
    setDragState({ sectionId: '', draggedPos: null, dragOverPos: null })
    if (fromPos === null || fromPos === toPos || dragState.sectionId !== section.id) return
    try {
      if (section.type === 'cluster') {
        await fetch(`/api/v1/firewall/cluster/${selectedConnection}/rules/${fromPos}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ moveto: toPos })
        })
        reloadClusterRules()
      } else {
        await firewallAPI.updateSecurityGroupRule(selectedConnection, section.id, fromPos, { moveto: toPos })
        reload()
      }
      showToast(t('network.ruleMoved'), 'success')
    } catch (err: any) {
      showToast(err.message || t('networkPage.moveError'), 'error')
    }
  }

  // ── Standalone warning ──
  if (firewallMode === 'standalone') {
    return (
      <Box>
        {/* Show only Default Policy in standalone */}
        <Box sx={{ mb: 3, p: 2, bgcolor: alpha('#f59e0b', 0.08), borderRadius: 2, border: `1px solid ${alpha('#f59e0b', 0.2)}` }}>
          <Typography variant="body2" sx={{ color: '#f59e0b', fontWeight: 600 }}>
            <i className="ri-information-line" style={{ marginRight: 6 }} />
            {t('networkPage.sgNotAvailableStandalone')}
          </Typography>
        </Box>
        {/* Render cluster section only */}
        {renderCategory('default', categorized.default)}
      </Box>
    )
  }

  // ── Render a category header ──
  function renderCategoryHeader(cat: PolicyCategory) {
    const meta = CATEGORY_META[cat]
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5, mt: 3 }}>
        <Box sx={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: alpha(meta.color, 0.15) }}>
          <i className={meta.icon} style={{ fontSize: 14, color: meta.color }} />
        </Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: meta.color, fontSize: 12 }}>
          {t(meta.label)}
        </Typography>
        <Box sx={{ flex: 1, height: 1, bgcolor: alpha(meta.color, 0.15) }} />
      </Box>
    )
  }

  // ── Render a policy section (accordion) ──
  function renderSection(section: PolicySection) {
    const isExpanded = expandedSections.has(section.id)
    const catMeta = CATEGORY_META[section.category]
    const scope: { type: 'cluster' | 'security-group'; name?: string } = section.type === 'cluster'
      ? { type: 'cluster' }
      : { type: 'security-group', name: section.id }

    return (
      <Paper key={section.id} sx={{ border: `1px solid ${alpha(theme.palette.divider, 0.1)}`, overflow: 'hidden', mb: 1 }}>
        {/* Header */}
        <Box
          sx={{
            p: 1.5, px: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer',
            bgcolor: isExpanded ? alpha(catMeta.color, 0.04) : 'transparent',
            '&:hover': { bgcolor: alpha(catMeta.color, 0.03) }
          }}
          onClick={() => toggleSection(section.id)}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
            <i className={isExpanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} style={{ fontSize: 20 }} />
            <Avatar sx={{ width: 28, height: 28, bgcolor: alpha(catMeta.color, 0.15) }}>
              <i className={section.type === 'cluster' ? 'ri-cloud-line' : 'ri-shield-line'} style={{ fontSize: 14, color: catMeta.color }} />
            </Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <code style={{ background: 'transparent', fontSize: 13, fontWeight: 600, color: 'inherit' }}>{section.name}</code>
                <Chip
                  label={`${t('firewall.rulesCount', { count: section.ruleCount })}, ${t('networkPage.activeRulesCount', { count: section.activeRuleCount })}`}
                  size="small" sx={{ height: 20, fontSize: 10 }}
                />
                {section.type === 'security-group' && (
                  <Tooltip
                    title={section.appliedTo.length > 0
                      ? section.appliedTo.map(v => `${v.name} (${v.vmid})`).join(', ')
                      : t('networkPage.noVmsReferencing')
                    }
                  >
                    <Chip
                      icon={<i className="ri-computer-line" style={{ fontSize: 12 }} />}
                      label={t('networkPage.vmCount', { count: section.appliedTo.length })}
                      size="small"
                      variant="outlined"
                      sx={{ height: 20, fontSize: 10, cursor: 'help' }}
                    />
                  </Tooltip>
                )}
              </Box>
              {section.comment && (
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.25 }}>{section.comment}</Typography>
              )}
            </Box>
          </Box>

          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
            <Tooltip title={t('networkPage.addRule')}>
              <IconButton size="small" onClick={() => openAddRule(scope)}>
                <i className="ri-add-line" style={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
            {section.type === 'security-group' && (
              <Tooltip title={t('networkPage.delete')}>
                <IconButton size="small" color="error" onClick={() => handleDeleteGroup(section.id)}>
                  <i className="ri-delete-bin-line" style={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        </Box>

        {/* Rules table */}
        <Collapse in={isExpanded}>
          {section.rules.length > 0 ? (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: alpha(theme.palette.background.default, 0.5) }}>
                    <TableCell sx={{ width: 30, p: 0.5 }}></TableCell>
                    <TableCell sx={{ fontWeight: 700, width: 35, fontSize: 11 }}>#</TableCell>
                    <TableCell sx={{ fontWeight: 700, width: 55, fontSize: 11 }}>{t('common.active')}</TableCell>
                    <TableCell sx={{ fontWeight: 700, width: 65, fontSize: 11 }}>{t('firewall.direction')}</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>{t('network.source')}</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>{t('network.destination')}</TableCell>
                    <TableCell sx={{ fontWeight: 700, width: 100, fontSize: 11 }}>{t('firewall.service')}</TableCell>
                    <TableCell sx={{ fontWeight: 700, width: 90, fontSize: 11 }}>{t('firewall.action')}</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>{t('network.comment')}</TableCell>
                    <TableCell sx={{ width: 80 }}></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {section.rules.map((rule, idx) => {
                    const isDragging = dragState.sectionId === section.id && dragState.draggedPos === rule.pos
                    const isDragOver = dragState.sectionId === section.id && dragState.dragOverPos === rule.pos
                    const isGroupRule = rule.type === 'group'

                    return (
                      <TableRow
                        key={idx}
                        hover draggable
                        onDragStart={e => handleDragStart(e, section.id, rule.pos)}
                        onDragEnd={handleDragEnd}
                        onDragOver={e => handleDragOver(e, section.id, rule.pos)}
                        onDragLeave={handleDragLeave}
                        onDrop={e => handleDrop(e, section, rule.pos)}
                        sx={{
                          cursor: 'grab', opacity: isDragging ? 0.5 : 1,
                          borderTop: isDragOver ? `2px solid ${theme.palette.primary.main}` : undefined,
                          '&:active': { cursor: 'grabbing' }
                        }}
                      >
                        <TableCell sx={{ p: 0.5, cursor: 'grab' }}>
                          <i className="ri-draggable" style={{ fontSize: 14, color: theme.palette.text.disabled }} />
                        </TableCell>
                        <TableCell sx={{ fontSize: 11, color: 'text.secondary', p: 0.5 }}>{rule.pos}</TableCell>
                        <TableCell sx={{ p: 0.5 }}>
                          <Switch checked={rule.enable !== 0} onChange={() => handleToggleEnable(section, rule)} size="small" color="success" />
                        </TableCell>
                        <TableCell sx={{ p: 0.5 }}>
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
                        <TableCell sx={{ ...monoStyle, fontSize: 11, p: 0.5 }}>
                          {formatService(rule)}
                        </TableCell>
                        <TableCell sx={{ p: 0.5 }}>
                          {isGroupRule ? (
                            <Chip icon={<i className="ri-shield-line" style={{ fontSize: 10 }} />} label={rule.action} size="small" sx={{ height: 22, fontSize: 10, fontWeight: 600, bgcolor: alpha('#8b5cf6', 0.15), color: '#8b5cf6', '& .MuiChip-icon': { color: '#8b5cf6' } }} />
                          ) : (
                            <ActionChip action={rule.action || 'ACCEPT'} />
                          )}
                        </TableCell>
                        <TableCell sx={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', p: 0.5 }}>
                          <Tooltip title={rule.comment || ''}><span style={{ fontSize: 11 }}>{rule.comment || '-'}</span></Tooltip>
                        </TableCell>
                        <TableCell sx={{ p: 0.5 }}>
                          <Box sx={{ display: 'flex', gap: 0 }}>
                            <Tooltip title={t('networkPage.edit')}>
                              <IconButton size="small" onClick={() => openEditRule(scope, rule)}>
                                <i className="ri-pencil-line" style={{ fontSize: 14 }} />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title={t('networkPage.delete')}>
                              <IconButton size="small" color="error" onClick={() => setDeleteConfirm({
                                scope: section.type === 'cluster' ? 'cluster' : 'security-group',
                                groupName: section.type === 'security-group' ? section.id : undefined,
                                pos: rule.pos
                              })}>
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
              <Button size="small" sx={{ mt: 1 }} onClick={() => openAddRule(scope)}>
                {t('networkPage.addRule')}
              </Button>
            </Box>
          )}
        </Collapse>
      </Paper>
    )
  }

  // ── Render a full category ──
  function renderCategory(cat: PolicyCategory, policySections: PolicySection[]) {
    if (policySections.length === 0) return null
    return (
      <Box key={cat}>
        {renderCategoryHeader(cat)}
        {policySections.map(s => renderSection(s))}
      </Box>
    )
  }

  return (
    <>
      {/* Toolbar */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <TextField
            size="small" placeholder={t('networkPage.searchPolicies')} value={search}
            onChange={e => setSearch(e.target.value)}
            InputProps={{
              startAdornment: <i className="ri-search-line" style={{ marginRight: 6, fontSize: 16, color: theme.palette.text.disabled }} />,
              sx: { fontSize: 13 }
            }}
            sx={{ width: 240 }}
          />
          <Button size="small" variant="outlined" onClick={expandAll}>{t('common.expandAll')}</Button>
          <Button size="small" variant="outlined" onClick={collapseAll}>{t('common.collapseAll')}</Button>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Button size="small" variant="contained" startIcon={<i className="ri-add-line" />} onClick={() => setGroupDialogOpen(true)} disabled={!selectedConnection}>
            {t('networkPage.newPolicy')}
          </Button>
          <Button size="small" variant="outlined" startIcon={<i className="ri-refresh-line" />} onClick={() => { reload(); reloadClusterRules() }}>
            {t('networkPage.refresh')}
          </Button>
        </Box>
      </Box>

      {/* Summary chips */}
      <Box sx={{ mb: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Chip label={t('networkPage.policiesCount', { count: totalPolicies })} size="small" variant="outlined" />
        <Chip label={t('firewall.rulesCount', { count: totalRulesCount })} size="small" variant="outlined" />
        <Chip label={t('networkPage.activeRulesCount', { count: totalActiveCount })} size="small" variant="outlined" sx={{ color: '#22c55e' }} />
      </Box>

      {/* Category sections */}
      {renderCategory('infrastructure', categorized.infrastructure)}
      {renderCategory('application', categorized.application)}
      {renderCategory('default', categorized.default)}

      {filteredSections.length === 0 && (
        <Paper sx={{ p: 4, textAlign: 'center', border: `1px dashed ${alpha(theme.palette.divider, 0.3)}` }}>
          <i className="ri-shield-line" style={{ fontSize: 48, opacity: 0.3 }} />
          <Typography variant="body1" sx={{ mt: 2, color: 'text.secondary' }}>{t('networkPage.noSecurityGroup')}</Typography>
          <Button sx={{ mt: 2 }} onClick={() => setGroupDialogOpen(true)}>{t('networkPage.createGroup')}</Button>
        </Paper>
      )}

      {/* ══ DIALOGS ══ */}

      {/* Rule form dialog */}
      <RuleFormDialog
        open={ruleDialogOpen}
        onClose={() => setRuleDialogOpen(false)}
        onSubmit={handleRuleSubmit}
        isNew={ruleDialogIsNew}
        scope={ruleDialogScope}
        rule={ruleForm}
        onRuleChange={setRuleForm}
        securityGroups={securityGroups}
      />

      {/* Create Security Group */}
      <Dialog open={groupDialogOpen} onClose={() => setGroupDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('networkPage.createSgTitle')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 2 }}>
            <TextField label={t('common.name')} value={newGroup.group} onChange={e => setNewGroup({ ...newGroup, group: e.target.value })} placeholder="sg-web" fullWidth size="small" InputProps={{ sx: monoStyle }} />
            <TextField label={t('common.description')} value={newGroup.comment} onChange={e => setNewGroup({ ...newGroup, comment: e.target.value })} fullWidth size="small" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGroupDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleCreateGroup} disabled={!newGroup.group}>{t('networkPage.createButton')}</Button>
        </DialogActions>
      </Dialog>

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
