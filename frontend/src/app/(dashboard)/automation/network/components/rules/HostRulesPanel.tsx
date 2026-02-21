'use client'

import { useState, useEffect, useMemo } from 'react'
import { useTranslations } from 'next-intl'

import {
  Autocomplete, Avatar, Box, Button, Chip, Collapse, Dialog, DialogTitle, DialogContent, DialogActions,
  FormControl, Grid, IconButton, InputLabel, LinearProgress, MenuItem, Paper, Select, Stack, Switch,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip,
  Typography, useTheme, alpha
} from '@mui/material'

import * as firewallAPI from '@/lib/api/firewall'
import { useToast } from '@/contexts/ToastContext'
import { DEFAULT_RULE } from '../../types'

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
    for (const a of aliases) {
      opts.push({ label: a.name, secondary: a.cidr })
    }
    for (const s of ipsets) {
      opts.push({ label: `+${s.name}`, secondary: s.comment || `${s.members?.length || 0} entries` })
    }
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

  return (
    <>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>{t('network.hostRules')}</Typography>
          <Chip label={t('networkPage.hostsAndRulesCount', { filtered: filteredHosts.length, total: nodesList.length, rules: Object.values(hostRulesByNode).reduce((acc, r) => acc + r.length, 0) })} size="small" />
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <TextField size="small" placeholder={t('networkPage.searchHost')} value={hostSearchQuery} onChange={(e) => setHostSearchQuery(e.target.value)}
            InputProps={{ startAdornment: <i className="ri-search-line" style={{ marginRight: 8, opacity: 0.5 }} />, sx: { fontSize: 13 } }} sx={{ width: 180 }} />
          <Button size="small" variant="outlined" onClick={() => setExpandedHosts(new Set(filteredHosts))}>{t('common.expandAll')}</Button>
          <Button size="small" variant="outlined" onClick={() => setExpandedHosts(new Set())}>{t('common.collapseAll')}</Button>
          <Button size="small" variant="contained" startIcon={<i className={loadingHostRules ? "ri-loader-4-line" : "ri-refresh-line"} />} onClick={() => loadHostRules()} disabled={loadingHostRules}>
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
        <Stack spacing={1}>
          {filteredHosts.map((node) => {
            const rules = hostRulesByNode[node] || []
            const isExpanded = expandedHosts.has(node)
            const nodeOpts = nodeOptionsByNode[node]
            const nodeEnabled = nodeOpts?.enable === 1
            return (
              <Paper key={node} sx={{ border: `1px solid ${alpha(theme.palette.divider, 0.1)}`, overflow: 'hidden' }}>
                <Box
                  sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer',
                    bgcolor: isExpanded ? alpha(theme.palette.primary.main, 0.05) : 'transparent',
                    '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.03) } }}
                  onClick={() => setExpandedHosts(prev => { const n = new Set(prev); if (n.has(node)) n.delete(node); else n.add(node); return n })}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <i className={isExpanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} style={{ fontSize: 20 }} />
                    <Avatar sx={{ width: 32, height: 32, bgcolor: alpha('#f59e0b', 0.15) }}>
                      <i className="ri-server-line" style={{ fontSize: 16, color: '#f59e0b' }} />
                    </Avatar>
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{node}</Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {rules.length > 1
                          ? t('networkPage.rulesAndActiveCount', { count: rules.length, active: rules.filter(r => r.enable !== 0).length })
                          : t('networkPage.ruleAndActiveCount', { count: rules.length, active: rules.filter(r => r.enable !== 0).length })}
                      </Typography>
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                    <Switch
                      checked={nodeEnabled}
                      onChange={() => handleToggleNodeFirewall(node)}
                      color="success"
                      size="small"
                      disabled={!selectedConnection}
                    />
                    <Typography variant="caption" sx={{ fontWeight: 600, color: nodeEnabled ? '#22c55e' : 'text.secondary', fontSize: 11, minWidth: 24 }}>
                      {nodeEnabled ? 'ON' : 'OFF'}
                    </Typography>
                    <Chip label={t('networkPage.rulesCount', { count: rules.length })} size="small" />
                    <Tooltip title={t('networkPage.addRule')}>
                      <IconButton size="small" color="primary" onClick={() => {
                        setEditingHostRule({ node, rule: null, isNew: true })
                        setNewHostRule({ ...DEFAULT_RULE })
                        setHostRuleDialogOpen(true)
                      }}>
                        <i className="ri-add-line" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>

                <Collapse in={isExpanded}>
                  <Box sx={{ p: 2, borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}`, bgcolor: alpha(theme.palette.divider, 0.02) }}>
                    {rules.length > 0 ? (
                      <TableContainer>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell sx={{ fontWeight: 700, fontSize: 11, width: 30, p: 0.5 }}></TableCell>
                              <TableCell sx={{ fontWeight: 700, fontSize: 11, width: 35 }}>#</TableCell>
                              <TableCell sx={{ fontWeight: 700, fontSize: 11, width: 50 }}>{t('common.active')}</TableCell>
                              <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>{t('firewall.type')}</TableCell>
                              <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>{t('firewall.action')}</TableCell>
                              <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>{t('firewall.proto')}</TableCell>
                              <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>{t('firewall.source')}</TableCell>
                              <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>{t('firewall.dest')}</TableCell>
                              <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>{t('firewall.port')}</TableCell>
                              <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>{t('firewall.comment')}</TableCell>
                              <TableCell sx={{ fontWeight: 700, fontSize: 11, width: 80 }}>{t('firewall.actions')}</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {rules.map((rule, idx) => {
                              const isDragging = hostDragState.node === node && hostDragState.draggedPos === rule.pos
                              const isDragOver = hostDragState.node === node && hostDragState.dragOverPos === rule.pos
                              const isGroupRule = rule.type === 'group'
                              return (
                                <TableRow key={idx} hover draggable
                                  onDragStart={(e) => handleDragStart(e, node, rule.pos)}
                                  onDragEnd={handleDragEnd}
                                  onDragOver={(e) => handleDragOver(e, node, rule.pos)}
                                  onDragLeave={handleDragLeave}
                                  onDrop={(e) => handleDrop(e, node, rule.pos)}
                                  sx={{ opacity: isDragging ? 0.5 : 1, bgcolor: isDragOver ? alpha(theme.palette.primary.main, 0.1) : 'transparent', cursor: 'grab', '&:active': { cursor: 'grabbing' } }}
                                >
                                  <TableCell sx={{ p: 0.5 }}><i className="ri-draggable" style={{ fontSize: 14, color: theme.palette.text.disabled, cursor: 'grab' }} /></TableCell>
                                  <TableCell sx={{ fontSize: 11 }}>{rule.pos}</TableCell>
                                  <TableCell><Chip label={rule.enable === 0 ? 'Off' : 'On'} size="small" sx={{ height: 18, fontSize: 9, bgcolor: rule.enable === 0 ? alpha('#888', 0.15) : alpha('#22c55e', 0.15), color: rule.enable === 0 ? '#888' : '#22c55e' }} /></TableCell>
                                  <TableCell><Chip label={isGroupRule ? 'GROUP' : rule.type?.toUpperCase() || '-'} size="small" sx={{ height: 18, fontSize: 9, bgcolor: isGroupRule ? alpha('#8b5cf6', 0.15) : rule.type === 'in' ? alpha('#3b82f6', 0.15) : alpha('#ec4899', 0.15), color: isGroupRule ? '#8b5cf6' : rule.type === 'in' ? '#3b82f6' : '#ec4899' }} /></TableCell>
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
                                    </Stack>
                                  </TableCell>
                                </TableRow>
                              )
                            })}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    ) : (
                      <Box sx={{ textAlign: 'center', py: 2 }}>
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>{t('networkPage.noRuleConfigured')}</Typography>
                      </Box>
                    )}
                  </Box>
                </Collapse>
              </Paper>
            )
          })}
        </Stack>
      ) : (
        <Paper sx={{ p: 4, textAlign: 'center', border: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
          <Avatar sx={{ width: 64, height: 64, bgcolor: alpha('#f59e0b', 0.15), mx: 'auto', mb: 2 }}>
            <i className="ri-server-line" style={{ fontSize: 32, color: '#f59e0b' }} />
          </Avatar>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>{t('networkPage.noHostFoundTitle')}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
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
