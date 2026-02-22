'use client'

import { Fragment, useState, useEffect, useMemo } from 'react'
import { useTranslations } from 'next-intl'

import {
  Autocomplete, Box, Button, Chip, Dialog, DialogTitle, DialogContent, DialogActions,
  FormControl, Grid, IconButton, InputLabel, LinearProgress, MenuItem, Paper, Select, Stack,
  Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip,
  Typography, useTheme, alpha
} from '@mui/material'

import * as firewallAPI from '@/lib/api/firewall'
import { useToast } from '@/contexts/ToastContext'
import { DEFAULT_RULE, monoStyle } from '../../types'

interface HostRulesPanelProps {
  hostRulesByNode: Record<string, firewallAPI.FirewallRule[]>
  nodesList: string[]
  securityGroups: firewallAPI.SecurityGroup[]
  loadingHostRules: boolean
  selectedConnection: string
  loadHostRules: () => Promise<void>
  reloadHostRulesForNode: (node: string) => Promise<void>
  aliases: firewallAPI.Alias[]
  ipsets: firewallAPI.IPSet[]
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

const headCellSx = { fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap' } as const

// ── Main Component ──

export default function HostRulesPanel({ hostRulesByNode, nodesList, securityGroups, loadingHostRules, selectedConnection, loadHostRules, reloadHostRulesForNode, aliases, ipsets }: HostRulesPanelProps) {
  const theme = useTheme()
  const t = useTranslations()
  const { showToast } = useToast()

  const [expandedHosts, setExpandedHosts] = useState<Set<string>>(new Set())
  const [hostSearchQuery, setHostSearchQuery] = useState('')
  const [hostRuleDialogOpen, setHostRuleDialogOpen] = useState(false)
  const [editingHostRule, setEditingHostRule] = useState<{ node: string; rule: firewallAPI.FirewallRule | null; isNew: boolean } | null>(null)
  const [deleteHostRuleConfirm, setDeleteHostRuleConfirm] = useState<{ node: string; pos: number } | null>(null)
  const [newHostRule, setNewHostRule] = useState<firewallAPI.CreateRuleRequest>({ ...DEFAULT_RULE })
  const [hostDragState, setHostDragState] = useState<{ node: string; draggedPos: number | null; dragOverPos: number | null }>({ node: '', draggedPos: null, dragOverPos: null })

  // Per-node firewall options
  const [nodeOptionsByNode, setNodeOptionsByNode] = useState<Record<string, firewallAPI.NodeOptions>>({})

  // Load host rules on mount if not already loaded
  useEffect(() => {
    if (selectedConnection && nodesList.length > 0 && Object.keys(hostRulesByNode).length === 0) {
      loadHostRules()
    }
  }, [selectedConnection, nodesList, loadHostRules])

  // Load node options for all nodes
  useEffect(() => {
    if (!selectedConnection || nodesList.length === 0) return
    const fetchAll = async () => {
      const result: Record<string, firewallAPI.NodeOptions> = {}
      for (const node of nodesList) {
        try {
          result[node] = await firewallAPI.getNodeOptions(selectedConnection, node)
        } catch { /* ignore */ }
      }
      setNodeOptionsByNode(result)
    }
    fetchAll()
  }, [selectedConnection, nodesList])

  const filteredHosts = nodesList.filter(node =>
    !hostSearchQuery || node.toLowerCase().includes(hostSearchQuery.toLowerCase())
  )

  const autocompleteOptions = useMemo(() => {
    const opts: { label: string; secondary?: string }[] = []
    for (const a of aliases) opts.push({ label: a.name, secondary: a.cidr })
    for (const s of ipsets) opts.push({ label: `+${s.name}`, secondary: s.comment || `${s.members?.length || 0} entries` })
    return opts
  }, [aliases, ipsets])

  // ── Toggle node firewall ──
  const handleToggleNodeFirewall = async (node: string) => {
    if (!selectedConnection) return
    const current = nodeOptionsByNode[node]
    const newEnable = current?.enable === 1 ? 0 : 1
    try {
      await firewallAPI.updateNodeOptions(selectedConnection, node, { enable: newEnable })
      showToast(newEnable === 1 ? t('networkPage.firewallEnabled') : t('networkPage.firewallDisabled'), 'success')
      setNodeOptionsByNode(prev => ({ ...prev, [node]: { ...prev[node], enable: newEnable } }))
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  // ── Toggle rule enable ──
  const handleToggleHostRuleEnable = async (node: string, rule: firewallAPI.FirewallRule) => {
    if (!selectedConnection) return
    const newEnable = rule.enable === 1 ? 0 : 1
    try {
      await fetch(`/api/v1/firewall/nodes/${selectedConnection}/${node}/rules/${rule.pos}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...rule, enable: newEnable })
      })
      showToast(newEnable === 1 ? t('network.ruleEnabled') : t('network.ruleDisabled'), 'success')
      reloadHostRulesForNode(node)
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  // ── CRUD handlers ──
  const handleAddHostRule = async () => {
    if (!editingHostRule || !selectedConnection) return
    try {
      await firewallAPI.addNodeRule(selectedConnection, editingHostRule.node, newHostRule)
      showToast(t('network.ruleAdded'), 'success')
      setHostRuleDialogOpen(false)
      setEditingHostRule(null)
      setNewHostRule({ ...DEFAULT_RULE })
      reloadHostRulesForNode(editingHostRule.node)
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  const handleUpdateHostRule = async () => {
    if (!editingHostRule?.rule || !selectedConnection) return
    try {
      await fetch(`/api/v1/firewall/nodes/${selectedConnection}/${editingHostRule.node}/rules/${editingHostRule.rule.pos}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newHostRule)
      })
      showToast(t('network.ruleModified'), 'success')
      setHostRuleDialogOpen(false)
      setEditingHostRule(null)
      reloadHostRulesForNode(editingHostRule.node)
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  const handleDeleteHostRule = async () => {
    if (!deleteHostRuleConfirm || !selectedConnection) return
    const { node, pos } = deleteHostRuleConfirm
    try {
      await firewallAPI.deleteNodeRule(selectedConnection, node, pos)
      showToast(t('network.ruleDeleted'), 'success')
      setDeleteHostRuleConfirm(null)
      reloadHostRulesForNode(node)
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  // ── Drag & drop ──
  const handleDragStart = (e: React.DragEvent, node: string, pos: number) => {
    setHostDragState({ node, draggedPos: pos, dragOverPos: null })
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', pos.toString())
    setTimeout(() => { (e.currentTarget as HTMLElement).style.opacity = '0.5' }, 0)
  }
  const handleDragEnd = (e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).style.opacity = '1'
    setHostDragState({ node: '', draggedPos: null, dragOverPos: null })
  }
  const handleDragOver = (e: React.DragEvent, node: string, pos: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (hostDragState.node === node && hostDragState.draggedPos !== null && hostDragState.draggedPos !== pos) {
      setHostDragState(prev => ({ ...prev, dragOverPos: pos }))
    }
  }
  const handleDragLeave = () => setHostDragState(prev => ({ ...prev, dragOverPos: null }))
  const handleDrop = async (e: React.DragEvent, node: string, toPos: number) => {
    e.preventDefault()
    const fromPos = hostDragState.draggedPos
    setHostDragState({ node: '', draggedPos: null, dragOverPos: null })
    if (fromPos !== null && fromPos !== toPos && hostDragState.node === node) {
      try {
        await fetch(`/api/v1/firewall/nodes/${selectedConnection}/${node}/rules/${fromPos}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ moveto: toPos })
        })
        showToast(t('network.ruleMoved'), 'success')
        loadHostRules()
      } catch (err: any) {
        showToast(err.message || t('networkPage.moveError'), 'error')
      }
    }
  }

  const sectionRowBg = alpha(theme.palette.primary.main, 0.1)
  const sectionRowHoverBg = alpha(theme.palette.primary.main, 0.16)

  return (
    <>
      {/* Toolbar */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <TextField
            size="small" placeholder={t('networkPage.searchHost')} value={hostSearchQuery}
            onChange={e => setHostSearchQuery(e.target.value)}
            InputProps={{
              startAdornment: <i className="ri-search-line" style={{ marginRight: 6, fontSize: 16, color: theme.palette.text.disabled }} />,
              sx: { fontSize: 13 }
            }}
            sx={{ width: 200 }}
          />
          <Button size="small" variant="outlined" onClick={() => setExpandedHosts(new Set(filteredHosts))}>{t('common.expandAll')}</Button>
          <Button size="small" variant="outlined" onClick={() => setExpandedHosts(new Set())}>{t('common.collapseAll')}</Button>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Chip label={t('networkPage.hostsAndRulesCount', { filtered: filteredHosts.length, total: nodesList.length, rules: Object.values(hostRulesByNode).reduce((acc, r) => acc + r.length, 0) })} size="small" />
          <Button size="small" variant="outlined" startIcon={<i className={loadingHostRules ? "ri-loader-4-line" : "ri-refresh-line"} />} onClick={() => loadHostRules()} disabled={loadingHostRules}>
            {t('networkPage.refresh')}
          </Button>
        </Box>
      </Box>

      {loadingHostRules ? (
        <Box sx={{ py: 4 }}>
          <LinearProgress />
          <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', mt: 2 }}>{t('networkPage.loadingHostRules')}</Typography>
        </Box>
      ) : filteredHosts.length > 0 ? (
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
              {filteredHosts.map(node => {
                const rules = hostRulesByNode[node] || []
                const isExpanded = expandedHosts.has(node)
                const nodeOpts = nodeOptionsByNode[node]
                const nodeEnabled = nodeOpts?.enable === 1

                return (
                  <Fragment key={node}>
                    {/* Section header row */}
                    <TableRow
                      sx={{
                        bgcolor: sectionRowBg,
                        '&:hover': { bgcolor: sectionRowHoverBg },
                        cursor: 'pointer',
                        '& td': { borderBottom: `1px solid ${alpha(theme.palette.divider, 0.15)}` }
                      }}
                      onClick={() => setExpandedHosts(prev => { const n = new Set(prev); if (n.has(node)) n.delete(node); else n.add(node); return n })}
                    >
                      <TableCell colSpan={10} sx={{ py: 1, px: 2 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                            <i
                              className={isExpanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'}
                              style={{ fontSize: 20, color: theme.palette.text.secondary, flexShrink: 0 }}
                            />
                            <i className="ri-server-line" style={{ fontSize: 16, color: '#f59e0b', flexShrink: 0 }} />
                            <code style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>{node}</code>
                            <Chip
                              label={t('firewall.rulesCount', { count: rules.length })}
                              size="small"
                              sx={{ height: 20, fontSize: 10, ml: 0.5 }}
                            />
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 1 }} onClick={e => e.stopPropagation()}>
                              <Switch
                                checked={nodeEnabled}
                                onChange={() => handleToggleNodeFirewall(node)}
                                color="success"
                                size="small"
                                disabled={!selectedConnection}
                              />
                              <Typography variant="caption" sx={{ fontWeight: 600, color: nodeEnabled ? '#22c55e' : 'text.secondary', fontSize: 11 }}>
                                {nodeEnabled ? 'ON' : 'OFF'}
                              </Typography>
                            </Box>
                          </Box>
                          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                            <Tooltip title={t('networkPage.addRule')}>
                              <IconButton size="small" onClick={() => {
                                setEditingHostRule({ node, rule: null, isNew: true })
                                setNewHostRule({ ...DEFAULT_RULE })
                                setHostRuleDialogOpen(true)
                              }}>
                                <i className="ri-add-line" style={{ fontSize: 16 }} />
                              </IconButton>
                            </Tooltip>
                          </Box>
                        </Box>
                      </TableCell>
                    </TableRow>

                    {/* Rule rows when expanded */}
                    {isExpanded && (rules.length > 0 ? rules.map((rule, idx) => {
                      const isDragging = hostDragState.node === node && hostDragState.draggedPos === rule.pos
                      const isDragOver = hostDragState.node === node && hostDragState.dragOverPos === rule.pos
                      const isGroupRule = rule.type === 'group'

                      return (
                        <TableRow
                          key={`${node}-rule-${idx}`}
                          hover draggable
                          onDragStart={e => handleDragStart(e, node, rule.pos)}
                          onDragEnd={handleDragEnd}
                          onDragOver={e => handleDragOver(e, node, rule.pos)}
                          onDragLeave={handleDragLeave}
                          onDrop={e => handleDrop(e, node, rule.pos)}
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
                            <Switch checked={rule.enable !== 0} onChange={() => handleToggleHostRuleEnable(node, rule)} size="small" color="success" />
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
                                <IconButton size="small" onClick={() => {
                                  setEditingHostRule({ node, rule, isNew: false })
                                  setNewHostRule({
                                    type: rule.type || 'in', action: rule.action || 'ACCEPT', enable: rule.enable ?? 1,
                                    proto: rule.proto || '', dport: rule.dport || '', sport: rule.sport || '',
                                    source: rule.source || '', dest: rule.dest || '', macro: rule.macro || '',
                                    iface: rule.iface || '', log: rule.log || 'nolog', comment: rule.comment || ''
                                  })
                                  setHostRuleDialogOpen(true)
                                }}>
                                  <i className="ri-pencil-line" style={{ fontSize: 14 }} />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title={t('networkPage.delete')}>
                                <IconButton size="small" color="error" onClick={() => setDeleteHostRuleConfirm({ node, pos: rule.pos })}>
                                  <i className="ri-delete-bin-line" style={{ fontSize: 14 }} />
                                </IconButton>
                              </Tooltip>
                            </Box>
                          </TableCell>
                        </TableRow>
                      )
                    }) : (
                      <TableRow key={`empty-${node}`}>
                        <TableCell colSpan={10} sx={{ py: 3, textAlign: 'center', color: 'text.secondary' }}>
                          <Typography variant="body2">{t('networkPage.noRuleConfigured')}</Typography>
                          <Button size="small" sx={{ mt: 1 }} onClick={() => {
                            setEditingHostRule({ node, rule: null, isNew: true })
                            setNewHostRule({ ...DEFAULT_RULE })
                            setHostRuleDialogOpen(true)
                          }}>
                            {t('networkPage.addRule')}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <Paper sx={{ p: 4, textAlign: 'center', border: `1px dashed ${alpha(theme.palette.divider, 0.3)}` }}>
          <i className="ri-server-line" style={{ fontSize: 48, opacity: 0.3 }} />
          <Typography variant="body1" sx={{ mt: 2, color: 'text.secondary' }}>
            {hostSearchQuery ? t('networkPage.noResultsForSearch') : t('networkPage.cannotGetNodeList')}
          </Typography>
        </Paper>
      )}

      {/* ══ DIALOGS ══ */}

      {/* Host Rule Dialog */}
      <Dialog open={hostRuleDialogOpen} onClose={() => setHostRuleDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className="ri-server-line" style={{ fontSize: 20 }} />
            {editingHostRule?.isNew ? t('networkPage.addHostRuleTitle') : t('networkPage.editHostRuleTitle')}
            {editingHostRule?.node && <Chip label={editingHostRule.node} size="small" sx={{ ml: 1 }} />}
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControl fullWidth size="small">
                <InputLabel>{t('firewall.type')}</InputLabel>
                <Select value={newHostRule.type} label={t('firewall.type')} onChange={(e) => setNewHostRule({ ...newHostRule, type: e.target.value })}>
                  <MenuItem value="in">{t('firewall.typeIn')}</MenuItem>
                  <MenuItem value="out">{t('firewall.typeOut')}</MenuItem>
                  <MenuItem value="group">{t('firewall.typeGroup')}</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControl fullWidth size="small">
                <InputLabel>{t('firewall.action')}</InputLabel>
                {newHostRule.type === 'group' ? (
                  <Select value={newHostRule.action} label={t('firewall.action')} onChange={(e) => setNewHostRule({ ...newHostRule, action: e.target.value })}>
                    {securityGroups.map(sg => (<MenuItem key={sg.group} value={sg.group}>{sg.group}</MenuItem>))}
                  </Select>
                ) : (
                  <Select value={newHostRule.action} label={t('firewall.action')} onChange={(e) => setNewHostRule({ ...newHostRule, action: e.target.value })}>
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
                <Select value={newHostRule.enable} label={t('firewall.active')} onChange={(e) => setNewHostRule({ ...newHostRule, enable: Number(e.target.value) })}>
                  <MenuItem value={1}>{t('firewall.yes')}</MenuItem>
                  <MenuItem value={0}>{t('firewall.no')}</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            {newHostRule.type !== 'group' && (
              <>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField fullWidth size="small" label={t('firewall.protocol')} value={newHostRule.proto} onChange={(e) => setNewHostRule({ ...newHostRule, proto: e.target.value })} placeholder="tcp, udp, icmp..." />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <Autocomplete
                    freeSolo
                    options={autocompleteOptions}
                    getOptionLabel={(opt) => typeof opt === 'string' ? opt : opt.label}
                    inputValue={newHostRule.source || ''}
                    onInputChange={(_, v) => setNewHostRule({ ...newHostRule, source: v })}
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
                      <TextField {...params} fullWidth size="small" label={t('firewall.source')} placeholder="IP, CIDR, alias..." />
                    )}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <Autocomplete
                    freeSolo
                    options={autocompleteOptions}
                    getOptionLabel={(opt) => typeof opt === 'string' ? opt : opt.label}
                    inputValue={newHostRule.dest || ''}
                    onInputChange={(_, v) => setNewHostRule({ ...newHostRule, dest: v })}
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
                      <TextField {...params} fullWidth size="small" label={t('firewall.destination')} placeholder="IP, CIDR, alias..." />
                    )}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField fullWidth size="small" label={t('firewall.destPort')} value={newHostRule.dport} onChange={(e) => setNewHostRule({ ...newHostRule, dport: e.target.value })} placeholder="22, 80, 443..." />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField fullWidth size="small" label={t('firewall.sourcePort')} value={newHostRule.sport} onChange={(e) => setNewHostRule({ ...newHostRule, sport: e.target.value })} />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField fullWidth size="small" label={t('firewall.interface')} value={newHostRule.iface} onChange={(e) => setNewHostRule({ ...newHostRule, iface: e.target.value })} placeholder="vmbr0, eth0..." />
                </Grid>
              </>
            )}
            <Grid size={{ xs: 12 }}>
              <TextField fullWidth size="small" label={t('firewall.comment')} value={newHostRule.comment} onChange={(e) => setNewHostRule({ ...newHostRule, comment: e.target.value })} />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setHostRuleDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={editingHostRule?.isNew ? handleAddHostRule : handleUpdateHostRule} startIcon={<i className={editingHostRule?.isNew ? "ri-add-line" : "ri-check-line"} />}>
            {editingHostRule?.isNew ? t('common.add') : t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Host Rule Confirmation */}
      <Dialog open={!!deleteHostRuleConfirm} onClose={() => setDeleteHostRuleConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className="ri-error-warning-line" style={{ fontSize: 20, color: '#ef4444' }} />
            {t('networkPage.deleteRuleConfirm')}
          </Box>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('networkPage.deleteRuleWarning', { pos: deleteHostRuleConfirm?.pos, node: deleteHostRuleConfirm?.node })}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteHostRuleConfirm(null)}>{t('common.cancel')}</Button>
          <Button variant="contained" color="error" onClick={handleDeleteHostRule} startIcon={<i className="ri-delete-bin-line" />}>
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
