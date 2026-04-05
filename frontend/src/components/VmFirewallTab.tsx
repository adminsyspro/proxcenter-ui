'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  LinearProgress,
  MenuItem,
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
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'
import { useLicense } from '@/contexts/LicenseContext'
import * as firewallAPI from '@/lib/api/firewall'

import { useFirewallState } from './firewall/useFirewallState'
import { LOG_LEVELS, MONO_STYLE, cleanSourceDest } from './firewall/shared'
import FirewallRulesTable from './firewall/FirewallRulesTable'
import FirewallDialogs from './firewall/FirewallDialogs'
import type { FirewallAPIAdapter, NicInfo, FirewallLogEntry } from './firewall/types'

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES
═══════════════════════════════════════════════════════════════════════════ */

interface Props {
  connectionId: string
  node: string
  vmType: 'qemu' | 'lxc'
  vmid: number
  vmName?: string
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════════ */

export default function VmFirewallTab({ connectionId, node, vmType, vmid, vmName }: Props) {
  const theme = useTheme()
  const t = useTranslations()
  const { isEnterprise } = useLicense()

  // VM-specific API adapter
  const api = useMemo<FirewallAPIAdapter>(() => ({
    getOptions: () => firewallAPI.getVMOptions(connectionId, node, vmType, vmid),
    getRules: () => firewallAPI.getVMRules(connectionId, node, vmType, vmid),
    getGroups: () => firewallAPI.getSecurityGroups(connectionId),
    updateOptions: (data) => firewallAPI.updateVMOptions(connectionId, node, vmType, vmid, data),
    addRule: (data) => firewallAPI.addVMRule(connectionId, node, vmType, vmid, data),
    updateRule: (pos, data) => firewallAPI.updateVMRule(connectionId, node, vmType, vmid, pos, data),
    deleteRule: (pos) => firewallAPI.deleteVMRule(connectionId, node, vmType, vmid, pos),
  }), [connectionId, node, vmType, vmid])

  const fw = useFirewallState(api)

  // VM-specific state
  const [aliases, setAliases] = useState<firewallAPI.Alias[]>([])
  const [ipsets, setIpsets] = useState<firewallAPI.IPSet[]>([])
  const [nics, setNics] = useState<NicInfo[]>([])
  const [logs, setLogs] = useState<FirewallLogEntry[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [logDialogOpen, setLogDialogOpen] = useState(false)
  const logEndRef = useRef<HTMLDivElement>(null)
  const logIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Autocomplete options for source/dest (aliases + ipsets)
  const autocompleteOptions = useMemo(() => {
    const opts: { label: string; secondary?: string }[] = []
    for (const a of aliases) opts.push({ label: a.name, secondary: a.cidr })
    for (const s of ipsets) opts.push({ label: `+${s.name}`, secondary: s.comment || `${s.members?.length || 0} entries` })
    return opts
  }, [aliases, ipsets])

  // Load VM-specific data (aliases, ipsets, nics) alongside the shared data
  const loadVmData = useCallback(async () => {
    try {
      const [aliasesData, ipsetsData] = await Promise.all([
        firewallAPI.getAliases(connectionId).catch(() => [] as firewallAPI.Alias[]),
        firewallAPI.getIPSets(connectionId).catch(() => [] as firewallAPI.IPSet[]),
      ])

      setAliases(Array.isArray(aliasesData) ? aliasesData : [])
      setIpsets(Array.isArray(ipsetsData) ? ipsetsData : [])

      // Load VM config to get NICs
      const configRes = await fetch(`/api/v1/connections/${connectionId}/guests/${vmType}/${node}/${vmid}/config`)

      if (configRes.ok) {
        const configData = await configRes.json()

        // Parse NICs from config (net0, net1, etc.)
        const nicList: NicInfo[] = []

        for (let i = 0; i < 10; i++) {
          const netKey = `net${i}`

          if (configData[netKey]) {
            const netConfig = configData[netKey] as string

            // Parse: virtio=XX:XX:XX:XX:XX:XX,bridge=vmbr0,firewall=1
            const parts = netConfig.split(',')
            const nic: NicInfo = { id: netKey, bridge: '', firewall: false }

            parts.forEach(part => {
              const [key, value] = part.split('=')

              if (key === 'bridge') nic.bridge = value
              if (key === 'firewall') nic.firewall = value === '1'
              if (key === 'virtio' || key === 'e1000' || key === 'rtl8139') nic.mac = value
              if (key === 'model') nic.model = value
            })


            // If no explicit model, detect from first part
            if (!nic.model) {
              const firstPart = parts[0]

              if (firstPart.includes('=')) {
                nic.model = firstPart.split('=')[0]
              }
            }

            nicList.push(nic)
          }
        }

        setNics(nicList)
      }
    } catch (err) {
      // Non-critical, shared state handles the main error
    }
  }, [connectionId, node, vmType, vmid])

  // Load logs
  const loadLogs = useCallback(async () => {
    setLogsLoading(true)

    try {
      const data = await firewallAPI.getVMFirewallLog(connectionId, node, vmType, vmid, 50)
      setLogs(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Failed to load firewall logs:', err)
    } finally {
      setLogsLoading(false)
    }
  }, [connectionId, node, vmType, vmid])

  useEffect(() => {
    if (!isEnterprise) return

    fw.loadFirewallData()
    loadVmData()
  }, [fw.loadFirewallData, loadVmData, isEnterprise])

  // Auto-refresh logs every 5s when log dialog is open
  useEffect(() => {
    if (logDialogOpen) {
      loadLogs()
      logIntervalRef.current = setInterval(() => {
        loadLogs()
      }, 5000)
    } else {
      if (logIntervalRef.current) {
        clearInterval(logIntervalRef.current)
        logIntervalRef.current = null
      }
    }

    return () => {
      if (logIntervalRef.current) {
        clearInterval(logIntervalRef.current)
        logIntervalRef.current = null
      }
    }
  }, [logDialogOpen, loadLogs])

  // Auto-scroll logs to bottom when new entries arrive
  useEffect(() => {
    if (logDialogOpen && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, logDialogOpen])

  // Change log level IN or OUT
  const handleLogLevelChange = async (field: 'log_level_in' | 'log_level_out', value: string) => {
    await fw.handleOptionChange(field, value)
  }

  // Wrap add rule to clean source/dest
  const handleAddRule = () => {
    const payload: firewallAPI.CreateRuleRequest = {
      type: fw.newRule.type,
      action: fw.newRule.action,
      enable: fw.newRule.enable,
      proto: fw.newRule.proto || undefined,
      dport: fw.newRule.dport || undefined,
      source: cleanSourceDest(fw.newRule.source) || undefined,
      dest: cleanSourceDest(fw.newRule.dest) || undefined,
      comment: fw.newRule.comment || undefined,
    }

    fw.handleAddRule(payload)
  }

  // Wrap update rule to clean source/dest
  const handleUpdateRule = () => {
    if (!fw.editingRule) return
    const payload: firewallAPI.CreateRuleRequest = {
      ...fw.editingRule,
      source: cleanSourceDest(fw.editingRule.source) || undefined,
      dest: cleanSourceDest(fw.editingRule.dest) || undefined,
    }

    fw.handleUpdateRule(payload)
  }

  // Enterprise guard
  if (!isEnterprise) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 8, textAlign: 'center' }}>
        <i className='ri-vip-crown-fill' style={{ fontSize: 48, color: 'var(--mui-palette-warning-main)', marginBottom: 16 }} />
        <Typography variant='h6' sx={{ mb: 1 }}>Enterprise Feature</Typography>
        <Typography variant='body2' sx={{ opacity: 0.6 }}>
          VM Firewall management requires an Enterprise license.
        </Typography>
      </Box>
    )
  }

  if (fw.loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  if (fw.error) {
    return (
      <Alert severity="error" sx={{ m: 2 }}>{fw.error}</Alert>
    )
  }

  return (
    <Box sx={{ py: 2 }}>
      <Stack spacing={3}>
        {/* NICs Card */}
        {nics.length > 0 && (
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <CardContent>
              <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <i className="ri-router-line" style={{ fontSize: 20 }} />
                {t('inventory.tabs.network')}
              </Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700 }}>Interface</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Bridge</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>MAC</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Firewall</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {nics.map((nic) => (
                      <TableRow key={nic.id}>
                        <TableCell sx={MONO_STYLE}>{nic.id}</TableCell>
                        <TableCell sx={MONO_STYLE}>{nic.bridge}</TableCell>
                        <TableCell sx={MONO_STYLE}>{nic.mac || '-'}</TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={nic.firewall ? t('common.enabled') : t('common.disabled')}
                            color={nic.firewall ? 'success' : 'default'}
                            sx={{ height: 22, fontSize: 11 }}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                {t('network.enableFirewallOnNic')}
              </Typography>
            </CardContent>
          </Card>
        )}

        {/* Unified Rules Card */}
        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <CardContent>
            <FirewallRulesTable
              rules={fw.rules}
              saving={fw.saving}
              draggedRule={fw.draggedRule}
              dragOverRule={fw.dragOverRule}
              availableGroups={fw.availableGroups}
              variant="vm"
              onAddRuleOpen={() => fw.setAddRuleOpen(true)}
              onAddGroupOpen={() => fw.setAddGroupOpen(true)}
              onToggleRule={fw.handleToggleRule}
              onEditRule={(rule) => { fw.setEditingRule(rule); fw.setEditRuleOpen(true); }}
              onDeleteRule={fw.confirmDeleteRule}
              onDragStart={fw.handleDragStart}
              onDragEnd={fw.handleDragEnd}
              onDragOver={fw.handleDragOver}
              onDragLeave={fw.handleDragLeave}
              onDrop={fw.handleDrop}
              headerExtra={
                <>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mr: 0.5 }}>
                    <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', fontSize: 10 }}>IN:</Typography>
                    <FormControl size="small">
                      <Select
                        value={fw.options.policy_in || 'ACCEPT'}
                        onChange={(e) => fw.handlePolicyChange('policy_in', e.target.value)}
                        sx={{ fontSize: 10, height: 22, minWidth: 72, '& .MuiSelect-select': { py: 0.1 } }}
                        disabled={fw.saving}
                      >
                        <MenuItem value="ACCEPT">ACCEPT</MenuItem>
                        <MenuItem value="DROP">DROP</MenuItem>
                        <MenuItem value="REJECT">REJECT</MenuItem>
                      </Select>
                    </FormControl>
                    <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', fontSize: 10 }}>OUT:</Typography>
                    <FormControl size="small">
                      <Select
                        value={fw.options.policy_out || 'ACCEPT'}
                        onChange={(e) => fw.handlePolicyChange('policy_out', e.target.value)}
                        sx={{ fontSize: 10, height: 22, minWidth: 72, '& .MuiSelect-select': { py: 0.1 } }}
                        disabled={fw.saving}
                      >
                        <MenuItem value="ACCEPT">ACCEPT</MenuItem>
                        <MenuItem value="DROP">DROP</MenuItem>
                        <MenuItem value="REJECT">REJECT</MenuItem>
                      </Select>
                    </FormControl>
                  </Box>
                  <Switch
                    checked={fw.options.enable === 1}
                    onChange={fw.handleToggleFirewall}
                    color="success"
                    size="small"
                    disabled={fw.saving}
                  />
                  <Typography variant="caption" sx={{ fontWeight: 600, color: fw.options.enable === 1 ? '#22c55e' : 'text.secondary', fontSize: 11, minWidth: 24 }}>
                    {fw.options.enable === 1 ? 'ON' : 'OFF'}
                  </Typography>
                  <Tooltip title="Firewall Logs">
                    <IconButton size="small" onClick={() => setLogDialogOpen(true)}>
                      <i className="ri-terminal-box-line" style={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                </>
              }
            />
          </CardContent>
        </Card>

      </Stack>

      {/* Shared Dialogs */}
      <FirewallDialogs
        addRuleOpen={fw.addRuleOpen}
        setAddRuleOpen={fw.setAddRuleOpen}
        newRule={fw.newRule}
        setNewRule={fw.setNewRule}
        saving={fw.saving}
        onAddRule={handleAddRule}
        addGroupOpen={fw.addGroupOpen}
        setAddGroupOpen={fw.setAddGroupOpen}
        selectedGroup={fw.selectedGroup}
        setSelectedGroup={fw.setSelectedGroup}
        availableGroups={fw.availableGroups}
        onAddSecurityGroup={fw.handleAddSecurityGroup}
        editRuleOpen={fw.editRuleOpen}
        setEditRuleOpen={fw.setEditRuleOpen}
        editingRule={fw.editingRule}
        setEditingRule={fw.setEditingRule}
        onUpdateRule={handleUpdateRule}
        deleteConfirmOpen={fw.deleteConfirmOpen}
        setDeleteConfirmOpen={fw.setDeleteConfirmOpen}
        ruleToDelete={fw.ruleToDelete}
        onDeleteRule={fw.handleDeleteRule}
        autocompleteOptions={autocompleteOptions}
        directionLabel="Direction"
      />

      {/* Firewall Log Dialog */}
      <Dialog open={logDialogOpen} onClose={() => setLogDialogOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className="ri-terminal-box-line" style={{ color: theme.palette.primary.main }} />
            Firewall Logs
            {vmName && <Chip label={vmName} size="small" sx={{ ml: 1 }} />}
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Tooltip title={t('common.refresh')}>
              <IconButton size="small" onClick={loadLogs} disabled={logsLoading}>
                <i className={`ri-refresh-line ${logsLoading ? 'animate-spin' : ''}`} style={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <IconButton onClick={() => setLogDialogOpen(false)} size="small"><i className="ri-close-line" /></IconButton>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          {/* Log level controls */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, py: 1.5, borderBottom: `1px solid ${alpha(theme.palette.divider, 0.15)}` }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', fontSize: 11 }}>Log IN:</Typography>
              <FormControl size="small">
                <Select
                  value={fw.options.log_level_in || 'nolog'}
                  onChange={(e) => handleLogLevelChange('log_level_in', e.target.value)}
                  sx={{ fontSize: 11, height: 28, minWidth: 90, '& .MuiSelect-select': { py: 0.3 } }}
                  disabled={fw.saving}
                >
                  {LOG_LEVELS.map(l => <MenuItem key={l} value={l} sx={{ fontSize: 11 }}>{l}</MenuItem>)}
                </Select>
              </FormControl>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', fontSize: 11 }}>Log OUT:</Typography>
              <FormControl size="small">
                <Select
                  value={fw.options.log_level_out || 'nolog'}
                  onChange={(e) => handleLogLevelChange('log_level_out', e.target.value)}
                  sx={{ fontSize: 11, height: 28, minWidth: 90, '& .MuiSelect-select': { py: 0.3 } }}
                  disabled={fw.saving}
                >
                  {LOG_LEVELS.map(l => <MenuItem key={l} value={l} sx={{ fontSize: 11 }}>{l}</MenuItem>)}
                </Select>
              </FormControl>
            </Box>
          </Box>
          <Box sx={{
            bgcolor: '#1e1e1e', color: '#d4d4d4', fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            fontSize: 12, lineHeight: 1.6, p: 2, minHeight: 300, maxHeight: 500, overflow: 'auto',
          }}>
            {logsLoading && logs.length === 0 ? (
              <Box sx={{ py: 4, textAlign: 'center' }}>
                <LinearProgress sx={{ mb: 2 }} />
                <Typography variant="body2" sx={{ color: '#888' }}>Loading logs...</Typography>
              </Box>
            ) : logs.length > 0 ? (
              logs.map((entry) => (
                <Box key={entry.n} sx={{ py: 0.2, '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' } }}>
                  <span style={{ color: '#888', marginRight: 8, userSelect: 'none' }}>{String(entry.n).padStart(4, ' ')}</span>
                  <span style={{
                    color: entry.t.includes('DROP') ? '#f85149' :
                           entry.t.includes('REJECT') ? '#d29922' :
                           entry.t.includes('ACCEPT') ? '#3fb950' : '#d4d4d4'
                  }}>
                    {entry.t}
                  </span>
                </Box>
              ))
            ) : (
              <Box sx={{ py: 6, textAlign: 'center' }}>
                <i className="ri-file-list-line" style={{ fontSize: 32, opacity: 0.3 }} />
                <Typography variant="body2" sx={{ color: '#888', mt: 1 }}>{t('common.noData')}</Typography>
              </Box>
            )}
            <div ref={logEndRef} />
          </Box>
        </DialogContent>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={fw.snackbar.open}
        autoHideDuration={4000}
        onClose={() => fw.setSnackbar({ ...fw.snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity={fw.snackbar.severity} onClose={() => fw.setSnackbar({ ...fw.snackbar, open: false })}>
          {fw.snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
