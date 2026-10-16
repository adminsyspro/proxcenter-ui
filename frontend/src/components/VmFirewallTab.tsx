'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { useRBAC } from '@/contexts/RBACContext'

import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  FormControl,
  IconButton,
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
} from '@mui/material'
import * as firewallAPI from '@/lib/api/firewall'

import { useFirewallState } from './firewall/useFirewallState'
import { PVE_DEFAULT_POLICY_IN, PVE_DEFAULT_POLICY_OUT } from '@/lib/firewall/pveDefaults'
import { LOG_LEVELS, DEFAULT_LOG_LEVEL, cleanSourceDest } from './firewall/shared'
import FirewallRulesTable from './firewall/FirewallRulesTable'
import FirewallDialogs from './firewall/FirewallDialogs'
import FirewallLogDialog from './firewall/FirewallLogDialog'
import type { LogRuleFilter } from './firewall/FirewallLogDialog'
import type { FirewallAPIAdapter, NicInfo } from './firewall/types'

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
  const t = useTranslations()
  const { hasPermission } = useRBAC()
  const canConfig = hasPermission('vm.config')

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
  const [logDialogOpen, setLogDialogOpen] = useState(false)
  // Set when the log was opened from one rule's terminal icon.
  const [logRule, setLogRule] = useState<{ filter: LogRuleFilter; pos: number } | null>(null)

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

  useEffect(() => {
    void fw.loadFirewallData()
    void loadVmData()
  }, [fw.loadFirewallData, loadVmData])

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
      // The dialog always resolves a level, but this payload is built field by
      // field: without this line the log level picked by the user is dropped.
      log: fw.newRule.log || DEFAULT_LOG_LEVEL,
      comment: fw.newRule.comment || undefined,
    }

    void fw.handleAddRule(payload)
  }

  // Wrap update rule to clean source/dest. An emptied field is sent as '' so
  // the update clears it on PVE; undefined would leave the old value (#1115).
  const handleUpdateRule = () => {
    if (!fw.editingRule) return
    const payload: firewallAPI.CreateRuleRequest = {
      ...fw.editingRule,
      source: cleanSourceDest(fw.editingRule.source),
      dest: cleanSourceDest(fw.editingRule.dest),
    }

    void fw.handleUpdateRule(payload)
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
                        <TableCell>{nic.id}</TableCell>
                        <TableCell>{nic.bridge}</TableCell>
                        <TableCell>{nic.mac || '-'}</TableCell>
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
              onAddRuleOpen={canConfig ? () => fw.setAddRuleOpen(true) : undefined}
              onAddGroupOpen={canConfig ? () => fw.setAddGroupOpen(true) : undefined}
              onToggleRule={canConfig ? fw.handleToggleRule : undefined}
              onEditRule={canConfig ? (rule) => { fw.setEditingRule(rule); fw.setEditRuleOpen(true); } : undefined}
              onDeleteRule={canConfig ? fw.confirmDeleteRule : undefined}
              onDragStart={canConfig ? fw.handleDragStart : undefined}
              onDragEnd={canConfig ? fw.handleDragEnd : undefined}
              onDragOver={canConfig ? fw.handleDragOver : undefined}
              onDragLeave={canConfig ? fw.handleDragLeave : undefined}
              onDrop={canConfig ? fw.handleDrop : undefined}
              onShowRuleLogs={(rule) => {
                setLogRule({ pos: rule.pos, filter: rule.type === 'group' ? { kind: 'groupRef', group: rule.action } : { kind: 'guestRule', pos: rule.pos } })
                setLogDialogOpen(true)
              }}
              headerExtra={
                <>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mr: 0.5 }}>
                    <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', fontSize: 10 }}>IN:</Typography>
                    <FormControl size="small">
                      <Select
                        value={fw.options.policy_in || PVE_DEFAULT_POLICY_IN}
                        onChange={(e) => fw.handlePolicyChange('policy_in', e.target.value)}
                        sx={{ fontSize: 10, height: 22, minWidth: 72, '& .MuiSelect-select': { py: 0.1 } }}
                        disabled={fw.saving || !canConfig}
                      >
                        <MenuItem value="ACCEPT">ACCEPT</MenuItem>
                        <MenuItem value="DROP">DROP</MenuItem>
                        <MenuItem value="REJECT">REJECT</MenuItem>
                      </Select>
                    </FormControl>
                    <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', fontSize: 10 }}>OUT:</Typography>
                    <FormControl size="small">
                      <Select
                        value={fw.options.policy_out || PVE_DEFAULT_POLICY_OUT}
                        onChange={(e) => fw.handlePolicyChange('policy_out', e.target.value)}
                        sx={{ fontSize: 10, height: 22, minWidth: 72, '& .MuiSelect-select': { py: 0.1 } }}
                        disabled={fw.saving || !canConfig}
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
                    disabled={fw.saving || !canConfig}
                  />
                  <Typography variant="caption" sx={{ fontWeight: 600, color: fw.options.enable === 1 ? '#22c55e' : 'text.secondary', fontSize: 11, minWidth: 24 }}>
                    {fw.options.enable === 1 ? 'ON' : 'OFF'}
                  </Typography>
                  <Tooltip title={t('networkPage.firewallLogs')}>
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
      <FirewallLogDialog
        open={logDialogOpen}
        onClose={() => { setLogDialogOpen(false); setLogRule(null) }}
        connectionId={connectionId}
        scope={{ kind: 'vm', node, vmType, vmid }}
        subject={logRule ? t('firewallLog.ruleSubject', { name: vmName || String(vmid), pos: logRule.pos }) : vmName}
        ruleFilter={logRule?.filter}
        headerExtra={
          <>
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
          </>
        }
      />

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
