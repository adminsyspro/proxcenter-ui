'use client'

import { Fragment, useState, useMemo } from 'react'
import { useTranslations } from 'next-intl'

import {
  Avatar, Box, Button, Chip, Dialog, DialogTitle, DialogContent, DialogActions,
  IconButton, Paper, Stack, Switch, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
  useTheme, alpha
} from '@mui/material'

import * as firewallAPI from '@/lib/api/firewall'
import { VMFirewallInfo } from '@/hooks/useVMFirewallRules'
import { useToast } from '@/contexts/ToastContext'
import { PolicySection, monoStyle } from '../../types'
import RuleFormDialog, { RuleFormData } from './RuleFormDialog'

// ── Props ──

interface SecurityGroupsPanelProps {
  securityGroups: firewallAPI.SecurityGroup[]
  vmFirewallData: VMFirewallInfo[]
  firewallMode: firewallAPI.FirewallMode
  selectedConnection: string
  totalRules: number
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

function computeAppliedTo(sgName: string, vmFirewallData: VMFirewallInfo[]): { vmid: number; name: string; node: string }[] {
  const vms: { vmid: number; name: string; node: string }[] = []
  for (const vm of vmFirewallData) {
    const hasRef = vm.rules.some(r => r.type === 'group' && r.action === sgName)
    if (hasRef) vms.push({ vmid: vm.vmid, name: vm.name, node: vm.node })
  }
  return vms
}

// ── Column header style ──
const headCellSx = { fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap' } as const

// ── Main Component ──

export default function SecurityGroupsPanel({
  securityGroups, vmFirewallData, firewallMode, selectedConnection, totalRules,
  aliases, ipsets, reload
}: SecurityGroupsPanelProps) {
  const theme = useTheme()
  const t = useTranslations()
  const { showToast } = useToast()

  // ── State ──
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')

  // Rule CRUD
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false)
  const [ruleDialogIsNew, setRuleDialogIsNew] = useState(true)
  const [ruleDialogScope, setRuleDialogScope] = useState<{ type: 'cluster' | 'security-group'; name?: string }>({ type: 'security-group' })
  const [ruleDialogEditPos, setRuleDialogEditPos] = useState<number | null>(null)
  const [ruleForm, setRuleForm] = useState<RuleFormData>({ type: 'in', action: 'ACCEPT', enable: 1, proto: '', dport: '', sport: '', source: '', dest: '', macro: '', iface: '', log: 'nolog', comment: '' })

  // SG create dialog
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [newGroup, setNewGroup] = useState({ group: '', comment: '' })

  // Delete confirm
  const [deleteConfirm, setDeleteConfirm] = useState<{ groupName: string; pos: number } | null>(null)

  // Drag & drop
  const [dragState, setDragState] = useState<{ sectionId: string; draggedPos: number | null; dragOverPos: number | null }>({ sectionId: '', draggedPos: null, dragOverPos: null })

  // ── Build SG sections ──
  const sections: PolicySection[] = useMemo(() => {
    return securityGroups.map(sg => {
      const rules = sg.rules || []
      return {
        id: sg.group,
        type: 'security-group' as const,
        name: sg.group,
        comment: sg.comment,
        rules,
        appliedTo: computeAppliedTo(sg.group, vmFirewallData),
        ruleCount: rules.length,
        activeRuleCount: rules.filter(r => r.enable !== 0).length,
      }
    })
  }, [securityGroups, vmFirewallData])

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

  // ── Open rule dialog ──
  const openAddRule = (sgName: string) => {
    setRuleDialogScope({ type: 'security-group', name: sgName })
    setRuleDialogIsNew(true)
    setRuleDialogEditPos(null)
    setRuleForm({ type: 'in', action: 'ACCEPT', enable: 1, proto: '', dport: '', sport: '', source: '', dest: '', macro: '', iface: '', log: 'nolog', comment: '' })
    setRuleDialogOpen(true)
  }

  const openEditRule = (sgName: string, rule: firewallAPI.FirewallRule) => {
    setRuleDialogScope({ type: 'security-group', name: sgName })
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
    const sgName = ruleDialogScope.name!
    try {
      if (ruleDialogIsNew) {
        await firewallAPI.addSecurityGroupRule(selectedConnection, sgName, ruleForm)
      } else if (ruleDialogEditPos !== null) {
        await firewallAPI.updateSecurityGroupRule(selectedConnection, sgName, ruleDialogEditPos, ruleForm)
      }
      showToast(ruleDialogIsNew ? t('network.ruleAdded') : t('network.ruleUpdated'), 'success')
      setRuleDialogOpen(false)
      reload()
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  // ── Toggle enable ──
  const handleToggleEnable = async (section: PolicySection, rule: firewallAPI.FirewallRule) => {
    if (!selectedConnection) return
    const newEnable = rule.enable === 1 ? 0 : 1
    try {
      await firewallAPI.updateSecurityGroupRule(selectedConnection, section.id, rule.pos, { ...rule, enable: newEnable })
      showToast(newEnable === 1 ? t('network.ruleEnabled') : t('network.ruleDisabled'), 'success')
      reload()
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  // ── Delete rule ──
  const handleDeleteRule = async () => {
    if (!deleteConfirm || !selectedConnection) return
    try {
      await firewallAPI.deleteSecurityGroupRule(selectedConnection, deleteConfirm.groupName, deleteConfirm.pos)
      showToast(t('network.ruleDeleted'), 'success')
      setDeleteConfirm(null)
      reload()
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
      await firewallAPI.updateSecurityGroupRule(selectedConnection, section.id, fromPos, { moveto: toPos })
      showToast(t('network.ruleMoved'), 'success')
      reload()
    } catch (err: any) {
      showToast(err.message || t('networkPage.moveError'), 'error')
    }
  }

  // ── Section row color ──
  const sectionRowBg = alpha(theme.palette.primary.main, 0.1)
  const sectionRowHoverBg = alpha(theme.palette.primary.main, 0.16)

  // ── Render a rule row ──
  const renderRuleRow = (section: PolicySection, rule: firewallAPI.FirewallRule, idx: number) => {
    const isDragging = dragState.sectionId === section.id && dragState.draggedPos === rule.pos
    const isDragOver = dragState.sectionId === section.id && dragState.dragOverPos === rule.pos

    return (
      <TableRow
        key={`${section.id}-rule-${idx}`}
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
        <TableCell sx={{ p: 0.5, cursor: 'grab', width: 30 }}>
          <i className="ri-draggable" style={{ fontSize: 14, color: theme.palette.text.disabled }} />
        </TableCell>
        <TableCell sx={{ fontSize: 11, color: 'text.secondary', p: 0.5, width: 35 }}>{rule.pos}</TableCell>
        <TableCell sx={{ p: 0.5, width: 55 }}>
          <Switch checked={rule.enable !== 0} onChange={() => handleToggleEnable(section, rule)} size="small" color="success" />
        </TableCell>
        <TableCell sx={{ p: 0.5, width: 65 }}>
          <Chip
            label={rule.type?.toUpperCase() || 'IN'}
            size="small"
            sx={{
              height: 20, fontSize: 10, fontWeight: 600,
              bgcolor: rule.type === 'in' ? alpha('#3b82f6', 0.22) : alpha('#ec4899', 0.22),
              color: rule.type === 'in' ? '#3b82f6' : '#ec4899'
            }}
          />
        </TableCell>
        <TableCell sx={{ ...monoStyle, fontSize: 11, p: 0.5, color: rule.source ? 'text.primary' : 'text.disabled' }}>
          {rule.source || 'any'}
        </TableCell>
        <TableCell sx={{ ...monoStyle, fontSize: 11, p: 0.5, color: rule.dest ? 'text.primary' : 'text.disabled' }}>
          {rule.dest || 'any'}
        </TableCell>
        <TableCell sx={{ ...monoStyle, fontSize: 11, p: 0.5, width: 100 }}>
          {formatService(rule)}
        </TableCell>
        <TableCell sx={{ p: 0.5, width: 90 }}>
          <Tooltip
            title={section.appliedTo.length > 0
              ? section.appliedTo.map(v => `${v.name} (${v.vmid})`).join(', ')
              : t('networkPage.noVmsReferencing')
            }
          >
            <Chip
              label={t('networkPage.vmCount', { count: section.appliedTo.length })}
              size="small" variant="outlined"
              sx={{ height: 20, fontSize: 10, cursor: 'help' }}
            />
          </Tooltip>
        </TableCell>
        <TableCell sx={{ p: 0.5, width: 90 }}>
          <ActionChip action={rule.action || 'ACCEPT'} />
        </TableCell>
        <TableCell sx={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', p: 0.5 }}>
          <Tooltip title={rule.comment || ''}><span style={{ fontSize: 11 }}>{rule.comment || '-'}</span></Tooltip>
        </TableCell>
        <TableCell sx={{ p: 0.5, width: 70 }}>
          <Box sx={{ display: 'flex', gap: 0 }}>
            <Tooltip title={t('networkPage.edit')}>
              <IconButton size="small" onClick={() => openEditRule(section.id, rule)}>
                <i className="ri-pencil-line" style={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('networkPage.delete')}>
              <IconButton size="small" color="error" onClick={() => setDeleteConfirm({ groupName: section.id, pos: rule.pos })}>
                <i className="ri-delete-bin-line" style={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          </Box>
        </TableCell>
      </TableRow>
    )
  }

  // ── Render SG section row ──
  const renderSectionRow = (section: PolicySection) => {
    const isExpanded = expandedSections.has(section.id)

    return (
      <TableRow
        key={`section-${section.id}`}
        sx={{
          bgcolor: sectionRowBg,
          '&:hover': { bgcolor: sectionRowHoverBg },
          cursor: 'pointer',
          '& td': { borderBottom: `1px solid ${alpha(theme.palette.divider, 0.15)}` }
        }}
        onClick={() => toggleSection(section.id)}
      >
        <TableCell colSpan={11} sx={{ py: 1, px: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
              <i
                className={isExpanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'}
                style={{ fontSize: 20, color: theme.palette.text.secondary, flexShrink: 0 }}
              />
              <code style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>{section.name}</code>
              {section.comment && (
                <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  — {section.comment}
                </Typography>
              )}
              <Chip
                label={t('firewall.rulesCount', { count: section.ruleCount })}
                size="small"
                sx={{ height: 20, fontSize: 10, ml: 0.5 }}
              />
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
            </Box>

            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
              <Tooltip title={t('networkPage.addRule')}>
                <IconButton size="small" onClick={() => openAddRule(section.id)}>
                  <i className="ri-add-line" style={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('networkPage.delete')}>
                <IconButton size="small" color="error" onClick={() => handleDeleteGroup(section.id)}>
                  <i className="ri-delete-bin-line" style={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>
        </TableCell>
      </TableRow>
    )
  }

  // ── Render rule rows for a SG section ──
  const renderSGRuleRows = (section: PolicySection) => {
    if (!expandedSections.has(section.id)) return null

    if (section.rules.length === 0) {
      return (
        <TableRow key={`empty-${section.id}`}>
          <TableCell colSpan={11} sx={{ py: 3, textAlign: 'center', color: 'text.secondary' }}>
            <Typography variant="body2">{t('networkPage.noRules')}</Typography>
            <Button size="small" sx={{ mt: 1 }} onClick={() => openAddRule(section.id)}>
              {t('networkPage.addRule')}
            </Button>
          </TableCell>
        </TableRow>
      )
    }

    return section.rules.map((rule, idx) => renderRuleRow(section, rule, idx))
  }

  // ── Standalone warning ──
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
    <Box sx={{ p: 3 }}>
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
          <Button size="small" variant="outlined" startIcon={<i className="ri-refresh-line" />} onClick={reload}>
            {t('networkPage.refresh')}
          </Button>
        </Box>
      </Box>

      {/* SG flat table */}
      {filteredSections.length > 0 ? (
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
                <TableCell sx={{ ...headCellSx, width: 90 }}>{t('networkPage.appliedTo')}</TableCell>
                <TableCell sx={{ ...headCellSx, width: 90 }}>{t('firewall.action')}</TableCell>
                <TableCell sx={headCellSx}>{t('network.comment')}</TableCell>
                <TableCell sx={{ width: 70 }}></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredSections.map(section => (
                <Fragment key={section.id}>{renderSectionRow(section)}{renderSGRuleRows(section)}</Fragment>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
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
        aliases={aliases}
        ipsets={ipsets}
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
    </Box>
  )
}
