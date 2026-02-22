'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
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
  TextField,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'
import { useLicense } from '@/contexts/LicenseContext'
import * as firewallAPI from '@/lib/api/firewall'

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES
═══════════════════════════════════════════════════════════════════════════ */

interface FirewallRule {
  pos: number
  type: string
  action: string
  enable?: number
  source?: string
  dest?: string
  proto?: string
  dport?: string
  sport?: string
  macro?: string
  iface?: string
  log?: string
  comment?: string
}

interface FirewallOptions {
  enable?: number
  dhcp?: number
  ipfilter?: number
  log_level_in?: string
  log_level_out?: string
  macfilter?: number
  ndp?: number
  policy_in?: string
  policy_out?: string
  radv?: number
}

interface SecurityGroup {
  group: string    // Proxmox/orchestrator returns "group" not "name"
  name?: string    // Alias for compatibility
  comment?: string
  rules?: FirewallRule[]
}

interface NicInfo {
  id: string
  bridge: string
  firewall: boolean
  mac?: string
  model?: string
}

interface FirewallLogEntry {
  n: number
  t: string
}

interface Props {
  connectionId: string
  node: string
  vmType: 'qemu' | 'lxc'
  vmid: number
  vmName?: string
}

/* ═══════════════════════════════════════════════════════════════════════════
   HELPER COMPONENTS & FUNCTIONS
═══════════════════════════════════════════════════════════════════════════ */

const ActionChip = ({ action }: { action: string }) => {
  const colors: Record<string, string> = { ACCEPT: '#22c55e', DROP: '#ef4444', REJECT: '#f59e0b' }
  const color = colors[action] || '#94a3b8'


return (
    <Chip
      size="small"
      label={action}
      sx={{
        height: 22,
        fontSize: 11,
        fontWeight: 700,
        bgcolor: alpha(color, 0.15),
        color,
        border: `1px solid ${alpha(color, 0.3)}`,
        minWidth: 70
      }}
    />
  )
}

function formatService(rule: FirewallRule): string {
  if (rule.type === 'group') return '-'
  if (rule.macro) return rule.macro
  const proto = rule.proto?.toUpperCase() || ''
  const port = rule.dport || ''
  if (!proto && !port) return 'any'
  if (proto && port) return `${proto}/${port}`
  return proto || port
}

/** Clean source/dest before sending to Proxmox: "any" is not a valid alias */
function cleanSourceDest(value: string | undefined): string {
  if (!value || value.trim().toLowerCase() === 'any') return ''
  return value.trim()
}

const LOG_LEVELS = ['nolog', 'emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug']

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════════ */

export default function VmFirewallTab({ connectionId, node, vmType, vmid, vmName }: Props) {
  const theme = useTheme()
  const t = useTranslations()
  const { isEnterprise } = useLicense()
  const monoStyle = { fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace', fontSize: 13 }

  // State
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' })

  // Firewall data
  const [options, setOptions] = useState<FirewallOptions>({})
  const [rules, setRules] = useState<FirewallRule[]>([])
  const [availableGroups, setAvailableGroups] = useState<SecurityGroup[]>([])
  const [aliases, setAliases] = useState<firewallAPI.Alias[]>([])
  const [ipsets, setIpsets] = useState<firewallAPI.IPSet[]>([])
  const [nics, setNics] = useState<NicInfo[]>([])
  const [logs, setLogs] = useState<FirewallLogEntry[]>([])
  const [logsLoading, setLogsLoading] = useState(false)

  // Drag & drop state
  const [draggedRule, setDraggedRule] = useState<number | null>(null)
  const [dragOverRule, setDragOverRule] = useState<number | null>(null)

  // Dialogs
  const [addRuleOpen, setAddRuleOpen] = useState(false)
  const [addGroupOpen, setAddGroupOpen] = useState(false)
  const [editRuleOpen, setEditRuleOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<FirewallRule | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [ruleToDelete, setRuleToDelete] = useState<number | null>(null)
  const [logDialogOpen, setLogDialogOpen] = useState(false)

  // Refs for log auto-scroll and auto-refresh
  const logEndRef = useRef<HTMLDivElement>(null)
  const logIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Form state
  const [newRule, setNewRule] = useState<Partial<FirewallRule>>({
    type: 'in',
    action: 'ACCEPT',
    enable: 1,
    proto: '',
    dport: '',
    source: '',
    dest: '',
    comment: ''
  })

  const [selectedGroup, setSelectedGroup] = useState('')

  // Autocomplete options for source/dest (aliases + ipsets)
  const autocompleteOptions = useMemo(() => {
    const opts: { label: string; secondary?: string }[] = []
    for (const a of aliases) opts.push({ label: a.name, secondary: a.cidr })
    for (const s of ipsets) opts.push({ label: `+${s.name}`, secondary: s.comment || `${s.members?.length || 0} entries` })
    return opts
  }, [aliases, ipsets])

  // Normalize rules helper
  const normalizeRules = (rulesData: any[]): FirewallRule[] =>
    (Array.isArray(rulesData) ? rulesData : []).map((rule: any) => ({
      ...rule,
      enable: rule.enable === 1 || rule.enable === '1' ? 1 : 0
    }))

  // Load firewall data
  const loadFirewallData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      // Load options, rules, security groups, aliases, ipsets in parallel
      const [optData, rulesData, groupsData, aliasesData, ipsetsData] = await Promise.all([
        firewallAPI.getVMOptions(connectionId, node, vmType, vmid).catch(() => ({} as firewallAPI.VMOptions)),
        firewallAPI.getVMRules(connectionId, node, vmType, vmid).catch(() => [] as firewallAPI.FirewallRule[]),
        firewallAPI.getSecurityGroups(connectionId).catch(() => [] as firewallAPI.SecurityGroup[]),
        firewallAPI.getAliases(connectionId).catch(() => [] as firewallAPI.Alias[]),
        firewallAPI.getIPSets(connectionId).catch(() => [] as firewallAPI.IPSet[]),
      ])

      setOptions(optData || {})
      setRules(normalizeRules(rulesData))
      setAvailableGroups(Array.isArray(groupsData) ? groupsData : [])
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
    } catch (err: any) {
      setError(err.message || t('errors.loadingError'))
    } finally {
      setLoading(false)
    }
  }, [connectionId, node, vmType, vmid])

  // Load only rules (for quick refresh after move/toggle/delete)
  const loadRulesOnly = useCallback(async () => {
    try {
      const rulesData = await firewallAPI.getVMRules(connectionId, node, vmType, vmid)
      setRules(normalizeRules(rulesData))
    } catch (err) {
      // Silently fail, user can refresh manually
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
    // En mode Community, pas d'orchestrator pour le firewall
    if (!isEnterprise) return

    loadFirewallData()
  }, [loadFirewallData, isEnterprise])

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

  // Toggle firewall enable
  const handleToggleFirewall = async () => {
    setSaving(true)

    try {
      const newEnable = options.enable === 1 ? 0 : 1

      await firewallAPI.updateVMOptions(connectionId, node, vmType, vmid, { enable: newEnable })
      setSnackbar({ open: true, message: `Firewall ${newEnable === 1 ? t('common.enabled') : t('common.disabled')}`, severity: 'success' })
      loadFirewallData()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  // Change policy IN or OUT
  const handlePolicyChange = async (field: 'policy_in' | 'policy_out', value: string) => {
    setSaving(true)

    try {
      await firewallAPI.updateVMOptions(connectionId, node, vmType, vmid, { [field]: value })
      setOptions(prev => ({ ...prev, [field]: value }))
      setSnackbar({ open: true, message: 'Policy updated', severity: 'success' })
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  // Change log level IN or OUT
  const handleLogLevelChange = async (field: 'log_level_in' | 'log_level_out', value: string) => {
    setSaving(true)

    try {
      await firewallAPI.updateVMOptions(connectionId, node, vmType, vmid, { [field]: value })
      setOptions(prev => ({ ...prev, [field]: value }))
      setSnackbar({ open: true, message: 'Log level updated', severity: 'success' })
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  // Add rule
  const handleAddRule = async () => {
    setSaving(true)

    try {
      const payload: firewallAPI.CreateRuleRequest = {
        type: newRule.type,
        action: newRule.action,
        enable: newRule.enable,
        proto: newRule.proto || undefined,
        dport: newRule.dport || undefined,
        source: cleanSourceDest(newRule.source) || undefined,
        dest: cleanSourceDest(newRule.dest) || undefined,
        comment: newRule.comment || undefined,
      }

      await firewallAPI.addVMRule(connectionId, node, vmType, vmid, payload)
      setSnackbar({ open: true, message: t('network.addRule'), severity: 'success' })
      setAddRuleOpen(false)
      setNewRule({ type: 'in', action: 'ACCEPT', enable: 1, proto: '', dport: '', source: '', dest: '', comment: '' })
      loadFirewallData()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  // Add security group
  const handleAddSecurityGroup = async () => {
    if (!selectedGroup) return
    setSaving(true)

    try {
      await firewallAPI.addVMRule(connectionId, node, vmType, vmid, { type: 'group', action: selectedGroup, enable: 1 })
      setSnackbar({ open: true, message: t('network.addSecurityGroup'), severity: 'success' })
      setAddGroupOpen(false)
      setSelectedGroup('')
      loadFirewallData()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  // Toggle rule enable
  const handleToggleRule = async (rule: FirewallRule) => {
    setSaving(true)

    try {
      // Handle enable being undefined, string, or number
      const currentEnable = rule.enable === undefined ? 1 : (typeof rule.enable === 'string' ? parseInt(rule.enable, 10) : rule.enable)
      const newEnable = currentEnable === 1 ? 0 : 1

      await firewallAPI.updateVMRule(connectionId, node, vmType, vmid, rule.pos, { enable: newEnable })
      setSnackbar({ open: true, message: `${t('network.editRule')} ${newEnable === 0 ? t('common.disabled') : t('common.enabled')}`, severity: 'success' })
      loadRulesOnly()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  // Confirm delete rule
  const confirmDeleteRule = (pos: number) => {
    setRuleToDelete(pos)
    setDeleteConfirmOpen(true)
  }

  // Delete rule
  const handleDeleteRule = async () => {
    if (ruleToDelete === null) return
    setSaving(true)
    setDeleteConfirmOpen(false)

    try {
      await firewallAPI.deleteVMRule(connectionId, node, vmType, vmid, ruleToDelete)
      setSnackbar({ open: true, message: t('common.delete'), severity: 'success' })
      setRuleToDelete(null)
      loadRulesOnly()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  // Move rule to new position
  const handleMoveRule = async (fromPos: number, toPos: number) => {
    if (fromPos === toPos) return
    setSaving(true)

    try {
      await firewallAPI.updateVMRule(connectionId, node, vmType, vmid, fromPos, { moveto: toPos })
      setSnackbar({ open: true, message: t('network.editRule'), severity: 'success' })
      loadRulesOnly()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  // Drag & drop handlers
  const handleDragStart = (e: React.DragEvent, pos: number) => {
    setDraggedRule(pos)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', pos.toString())

    // Add a slight delay to show the drag effect
    setTimeout(() => {
      const row = e.currentTarget as HTMLElement

      row.style.opacity = '0.5'
    }, 0)
  }

  const handleDragEnd = (e: React.DragEvent) => {
    const row = e.currentTarget as HTMLElement

    row.style.opacity = '1'
    setDraggedRule(null)
    setDragOverRule(null)
  }

  const handleDragOver = (e: React.DragEvent, pos: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'

    if (draggedRule !== null && draggedRule !== pos) {
      setDragOverRule(pos)
    }
  }

  const handleDragLeave = () => {
    setDragOverRule(null)
  }

  const handleDrop = (e: React.DragEvent, toPos: number) => {
    e.preventDefault()
    const fromPos = draggedRule

    setDraggedRule(null)
    setDragOverRule(null)

    if (fromPos !== null && fromPos !== toPos) {
      handleMoveRule(fromPos, toPos)
    }
  }

  // Update rule
  const handleUpdateRule = async () => {
    if (!editingRule) return
    setSaving(true)

    try {
      const payload: firewallAPI.CreateRuleRequest = {
        ...editingRule,
        source: cleanSourceDest(editingRule.source) || undefined,
        dest: cleanSourceDest(editingRule.dest) || undefined,
      }

      await firewallAPI.updateVMRule(connectionId, node, vmType, vmid, editingRule.pos, payload)
      setSnackbar({ open: true, message: t('network.editRule'), severity: 'success' })
      setEditRuleOpen(false)
      setEditingRule(null)
      loadRulesOnly()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  // Autocomplete renderOption helper
  const renderAutocompleteOption = (props: React.HTMLAttributes<HTMLLIElement>, opt: string | { label: string; secondary?: string }) => (
    <li {...props} key={typeof opt === 'string' ? opt : opt.label}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
        <code style={{ fontSize: 12 }}>{typeof opt === 'string' ? opt : opt.label}</code>
        {typeof opt !== 'string' && opt.secondary && (
          <span style={{ fontSize: 11, opacity: 0.6, marginLeft: 8 }}>{opt.secondary}</span>
        )}
      </Box>
    </li>
  )

  // En mode Community, afficher un message
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

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>
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
                        <TableCell sx={monoStyle}>{nic.id}</TableCell>
                        <TableCell sx={monoStyle}>{nic.bridge}</TableCell>
                        <TableCell sx={monoStyle}>{nic.mac || '-'}</TableCell>
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

        {/* Unified Rules Card - like Proxmox */}
        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
              <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className="ri-shield-keyhole-line" style={{ fontSize: 20 }} />
                {t('security.firewall')}
                {rules.length > 0 && (
                  <Chip size="small" label={rules.length} sx={{ ml: 0.5, height: 20, fontSize: 11 }} />
                )}
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexShrink: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mr: 0.5 }}>
                  <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', fontSize: 10 }}>IN:</Typography>
                  <FormControl size="small">
                    <Select
                      value={options.policy_in || 'ACCEPT'}
                      onChange={(e) => handlePolicyChange('policy_in', e.target.value)}
                      sx={{ fontSize: 10, height: 22, minWidth: 72, '& .MuiSelect-select': { py: 0.1 } }}
                      disabled={saving}
                    >
                      <MenuItem value="ACCEPT">ACCEPT</MenuItem>
                      <MenuItem value="DROP">DROP</MenuItem>
                      <MenuItem value="REJECT">REJECT</MenuItem>
                    </Select>
                  </FormControl>
                  <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', fontSize: 10 }}>OUT:</Typography>
                  <FormControl size="small">
                    <Select
                      value={options.policy_out || 'ACCEPT'}
                      onChange={(e) => handlePolicyChange('policy_out', e.target.value)}
                      sx={{ fontSize: 10, height: 22, minWidth: 72, '& .MuiSelect-select': { py: 0.1 } }}
                      disabled={saving}
                    >
                      <MenuItem value="ACCEPT">ACCEPT</MenuItem>
                      <MenuItem value="DROP">DROP</MenuItem>
                      <MenuItem value="REJECT">REJECT</MenuItem>
                    </Select>
                  </FormControl>
                </Box>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<i className="ri-shield-check-line" />}
                  onClick={() => setAddGroupOpen(true)}
                  disabled={availableGroups.length === 0}
                  sx={{ fontSize: 11 }}
                >
                  Security Group
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<i className="ri-add-line" />}
                  onClick={() => setAddRuleOpen(true)}
                  sx={{ fontSize: 11 }}
                >
                  {t('network.addRule')}
                </Button>
                <Switch
                  checked={options.enable === 1}
                  onChange={handleToggleFirewall}
                  color="success"
                  size="small"
                  disabled={saving}
                />
                <Typography variant="caption" sx={{ fontWeight: 600, color: options.enable === 1 ? '#22c55e' : 'text.secondary', fontSize: 11, minWidth: 24 }}>
                  {options.enable === 1 ? 'ON' : 'OFF'}
                </Typography>
                <Tooltip title="Firewall Logs">
                  <IconButton size="small" onClick={() => setLogDialogOpen(true)}>
                    <i className="ri-terminal-box-line" style={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>

            {rules.length === 0 ? (
              <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
                <i className="ri-shield-line" style={{ fontSize: 48, opacity: 0.3 }} />
                <Typography variant="body2" sx={{ mt: 1 }}>{t('common.noData')}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('network.addSecurityGroupOrRule')}
                </Typography>
              </Box>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: alpha(theme.palette.background.default, 0.5) }}>
                      <TableCell sx={{ fontWeight: 700, width: 30, p: 0.5 }}></TableCell>
                      <TableCell sx={{ fontWeight: 700, width: 35 }}>#</TableCell>
                      <TableCell sx={{ fontWeight: 700, width: 55 }}>Active</TableCell>
                      <TableCell sx={{ fontWeight: 700, width: 70 }}>{t('firewall.direction')}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Source</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Dest</TableCell>
                      <TableCell sx={{ fontWeight: 700, width: 100 }}>{t('firewall.service')}</TableCell>
                      <TableCell sx={{ fontWeight: 700, width: 90 }}>{t('firewall.action')}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>{t('network.comment')}</TableCell>
                      <TableCell sx={{ width: 90 }}></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rules.map((rule, idx) => {
                      const isGroup = rule.type === 'group'
                      const groupName = isGroup ? (rule.action || 'Unknown') : null
                      const isDragging = draggedRule === rule.pos
                      const isDragOver = dragOverRule === rule.pos

                      return (
                        <TableRow
                          key={rule.pos}
                          hover
                          draggable
                          onDragStart={(e) => handleDragStart(e, rule.pos)}
                          onDragEnd={handleDragEnd}
                          onDragOver={(e) => handleDragOver(e, rule.pos)}
                          onDragLeave={handleDragLeave}
                          onDrop={(e) => handleDrop(e, rule.pos)}
                          sx={{
                            bgcolor: isGroup ? alpha(theme.palette.primary.main, 0.03) : 'transparent',
                            cursor: 'grab',
                            opacity: isDragging ? 0.5 : 1,
                            borderTop: isDragOver ? `2px solid ${theme.palette.primary.main}` : undefined,
                            transition: 'border-top 0.1s ease',
                            '&:hover': {
                              bgcolor: isGroup ? alpha(theme.palette.primary.main, 0.08) : undefined
                            },
                            '&:active': {
                              cursor: 'grabbing'
                            }
                          }}
                        >
                          {/* Drag Handle */}
                          <TableCell sx={{ p: 0.5, textAlign: 'center', cursor: 'grab' }}>
                            <i className="ri-draggable" style={{ fontSize: 16, color: theme.palette.text.disabled }} />
                          </TableCell>

                          {/* Position */}
                          <TableCell sx={{ color: 'text.secondary', fontSize: 11, p: 0.5 }}>
                            {rule.pos}
                          </TableCell>

                          {/* Active switch */}
                          <TableCell sx={{ p: 0.5 }}>
                            <Switch
                              size="small"
                              checked={rule.enable !== 0}
                              onChange={() => handleToggleRule(rule)}
                              disabled={saving}
                              color="success"
                            />
                          </TableCell>

                          {/* Direction - colored chips like VMRulesPanel */}
                          <TableCell sx={{ p: 0.5 }}>
                            <Chip
                              label={isGroup ? 'GROUP' : rule.type?.toUpperCase() || 'IN'}
                              size="small"
                              sx={{
                                height: 20, fontSize: 10, fontWeight: 600,
                                bgcolor: isGroup ? alpha('#8b5cf6', 0.22) : rule.type === 'in' ? alpha('#3b82f6', 0.22) : alpha('#ec4899', 0.22),
                                color: isGroup ? '#8b5cf6' : rule.type === 'in' ? '#3b82f6' : '#ec4899'
                              }}
                            />
                          </TableCell>

                          {/* Source */}
                          <TableCell sx={{ ...monoStyle, color: (isGroup || !rule.source) ? 'text.disabled' : 'text.primary', fontSize: 11, p: 0.5 }}>
                            {isGroup ? '-' : (rule.source || 'any')}
                          </TableCell>

                          {/* Dest */}
                          <TableCell sx={{ ...monoStyle, color: (isGroup || !rule.dest) ? 'text.disabled' : 'text.primary', fontSize: 11, p: 0.5 }}>
                            {isGroup ? '-' : (rule.dest || 'any')}
                          </TableCell>

                          {/* Service (proto+port merged) */}
                          <TableCell sx={{ ...monoStyle, fontSize: 11, p: 0.5 }}>
                            {formatService(rule)}
                          </TableCell>

                          {/* Action / Security Group name */}
                          <TableCell sx={{ p: 0.5 }}>
                            {isGroup ? (
                              <Chip
                                icon={<i className="ri-shield-line" style={{ fontSize: 10 }} />}
                                label={groupName}
                                size="small"
                                sx={{
                                  height: 22, fontSize: 10, fontWeight: 600,
                                  bgcolor: alpha('#8b5cf6', 0.22), color: '#8b5cf6',
                                  '& .MuiChip-icon': { color: '#8b5cf6' }
                                }}
                              />
                            ) : (
                              <ActionChip action={rule.action || 'ACCEPT'} />
                            )}
                          </TableCell>

                          {/* Comment */}
                          <TableCell sx={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', p: 0.5 }}>
                            <Tooltip title={rule.comment || ''}>
                              <span style={{ fontSize: 11 }}>{rule.comment || '-'}</span>
                            </Tooltip>
                          </TableCell>

                          {/* Actions */}
                          <TableCell sx={{ p: 0.5 }}>
                            <Box sx={{ display: 'flex', gap: 0 }}>
                              {/* Edit */}
                              <Tooltip title={t('common.edit')}>
                                <IconButton size="small" onClick={() => { setEditingRule(rule); setEditRuleOpen(true); }}>
                                  <i className="ri-edit-line" style={{ fontSize: 14 }} />
                                </IconButton>
                              </Tooltip>

                              {/* Delete */}
                              <Tooltip title={t('common.delete')}>
                                <IconButton size="small" color="error" onClick={() => confirmDeleteRule(rule.pos)}>
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
            )}

            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
              {t('network.rulesEvaluatedTopBottom')}
            </Typography>
          </CardContent>
        </Card>

      </Stack>

      {/* Add Rule Dialog */}
      <Dialog open={addRuleOpen} onClose={() => setAddRuleOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{t('network.addRule')}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid size={{ xs: 6, sm: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Direction</InputLabel>
                <Select
                  value={newRule.type || 'in'}
                  label="Direction"
                  onChange={(e) => setNewRule({ ...newRule, type: e.target.value })}
                >
                  <MenuItem value="in">IN</MenuItem>
                  <MenuItem value="out">OUT</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Action</InputLabel>
                <Select
                  value={newRule.action || 'ACCEPT'}
                  label="Action"
                  onChange={(e) => setNewRule({ ...newRule, action: e.target.value })}
                >
                  <MenuItem value="ACCEPT">ACCEPT</MenuItem>
                  <MenuItem value="DROP">DROP</MenuItem>
                  <MenuItem value="REJECT">REJECT</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>{t('network.protocol')}</InputLabel>
                <Select
                  value={newRule.proto || ''}
                  label={t('network.protocol')}
                  onChange={(e) => setNewRule({ ...newRule, proto: e.target.value })}
                >
                  <MenuItem value="">{t('network.allProtocols')}</MenuItem>
                  <MenuItem value="tcp">TCP</MenuItem>
                  <MenuItem value="udp">UDP</MenuItem>
                  <MenuItem value="icmp">ICMP</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField
                label={t('network.destPort')}
                value={newRule.dport || ''}
                onChange={(e) => setNewRule({ ...newRule, dport: e.target.value })}
                placeholder="22, 80:443"
                fullWidth
                size="small"
                InputProps={{ sx: monoStyle }}
              />
            </Grid>
            <Grid size={{ xs: 6 }}>
              <Autocomplete
                freeSolo
                options={autocompleteOptions}
                getOptionLabel={(opt) => typeof opt === 'string' ? opt : opt.label}
                inputValue={newRule.source || ''}
                onInputChange={(_, v) => setNewRule(prev => ({ ...prev, source: v }))}
                renderOption={renderAutocompleteOption}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Source"
                    fullWidth
                    size="small"
                    placeholder="IP, CIDR, alias, +ipset"
                    helperText="CIDR, alias, ou +ipset"
                    InputProps={{ ...params.InputProps, sx: monoStyle }}
                  />
                )}
              />
            </Grid>
            <Grid size={{ xs: 6 }}>
              <Autocomplete
                freeSolo
                options={autocompleteOptions}
                getOptionLabel={(opt) => typeof opt === 'string' ? opt : opt.label}
                inputValue={newRule.dest || ''}
                onInputChange={(_, v) => setNewRule(prev => ({ ...prev, dest: v }))}
                renderOption={renderAutocompleteOption}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Destination"
                    fullWidth
                    size="small"
                    placeholder="IP, CIDR, alias, +ipset"
                    helperText="CIDR, alias, ou +ipset"
                    InputProps={{ ...params.InputProps, sx: monoStyle }}
                  />
                )}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                label={t('network.comment')}
                value={newRule.comment || ''}
                onChange={(e) => setNewRule({ ...newRule, comment: e.target.value })}
                fullWidth
                size="small"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddRuleOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleAddRule} disabled={saving}>{t('common.add')}</Button>
        </DialogActions>
      </Dialog>

      {/* Add Security Group Dialog */}
      <Dialog open={addGroupOpen} onClose={() => { setAddGroupOpen(false); setSelectedGroup(''); }} maxWidth="sm" fullWidth>
        <DialogTitle>{t('network.addSecurityGroup')}</DialogTitle>
        <DialogContent>
          <FormControl fullWidth size="small" sx={{ mt: 2 }}>
            <InputLabel>Security Group</InputLabel>
            <Select
              value={selectedGroup}
              label="Security Group"
              onChange={(e) => setSelectedGroup(e.target.value as string)}
              renderValue={(value) => value}
            >
              {availableGroups.map((g) => (
                <MenuItem key={g.group} value={g.group}>
                  <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{g.group}</Typography>
                    {g.comment && (
                      <Typography variant="caption" color="text.secondary">{g.comment}</Typography>
                    )}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {selectedGroup && (
            <Box sx={{ mt: 2 }}>
              <Alert severity="info">
                {t('network.securityGroupRulesApplied', { name: selectedGroup })}
              </Alert>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setAddGroupOpen(false); setSelectedGroup(''); }}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleAddSecurityGroup} disabled={saving || !selectedGroup}>{t('common.add')}</Button>
        </DialogActions>
      </Dialog>

      {/* Edit Rule Dialog */}
      <Dialog open={editRuleOpen} onClose={() => setEditRuleOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          {editingRule?.type === 'group' ? t('network.editSecurityGroup') : t('network.editRule')}
        </DialogTitle>
        <DialogContent>
          {editingRule?.type === 'group' ? (

            // Security Group: only show name (readonly) and comment
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Security Group"
                  value={editingRule?.action || ''}
                  fullWidth
                  size="small"
                  disabled
                  InputProps={{
                    sx: monoStyle,
                    startAdornment: <i className="ri-shield-check-line" style={{ marginRight: 8, color: theme.palette.primary.main }} />
                  }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={editingRule?.enable === 1}
                      onChange={(e) => setEditingRule(prev => prev ? { ...prev, enable: e.target.checked ? 1 : 0 } : null)}
                      color="success"
                    />
                  }
                  label={t('common.enabled')}
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <TextField
                  label={t('network.comment')}
                  value={editingRule?.comment || ''}
                  onChange={(e) => setEditingRule(prev => prev ? { ...prev, comment: e.target.value } : null)}
                  fullWidth
                  size="small"
                  placeholder={t('network.optionalDescription')}
                />
              </Grid>
            </Grid>
          ) : (

            // Regular rule: show all fields
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid size={{ xs: 6, sm: 3 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Direction</InputLabel>
                  <Select
                    value={editingRule?.type || 'in'}
                    label="Direction"
                    onChange={(e) => setEditingRule(prev => prev ? { ...prev, type: e.target.value } : null)}
                  >
                    <MenuItem value="in">IN</MenuItem>
                    <MenuItem value="out">OUT</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Action</InputLabel>
                  <Select
                    value={editingRule?.action || 'ACCEPT'}
                    label="Action"
                    onChange={(e) => setEditingRule(prev => prev ? { ...prev, action: e.target.value } : null)}
                  >
                    <MenuItem value="ACCEPT">ACCEPT</MenuItem>
                    <MenuItem value="DROP">DROP</MenuItem>
                    <MenuItem value="REJECT">REJECT</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>{t('network.protocol')}</InputLabel>
                  <Select
                    value={editingRule?.proto || ''}
                    label={t('network.protocol')}
                    onChange={(e) => setEditingRule(prev => prev ? { ...prev, proto: e.target.value } : null)}
                  >
                    <MenuItem value="">{t('network.allProtocols')}</MenuItem>
                    <MenuItem value="tcp">TCP</MenuItem>
                    <MenuItem value="udp">UDP</MenuItem>
                    <MenuItem value="icmp">ICMP</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <TextField
                  label={t('network.destPort')}
                  value={editingRule?.dport || ''}
                  onChange={(e) => setEditingRule(prev => prev ? { ...prev, dport: e.target.value } : null)}
                  fullWidth
                  size="small"
                  InputProps={{ sx: monoStyle }}
                />
              </Grid>
              <Grid size={{ xs: 6 }}>
                <Autocomplete
                  freeSolo
                  options={autocompleteOptions}
                  getOptionLabel={(opt) => typeof opt === 'string' ? opt : opt.label}
                  inputValue={editingRule?.source || ''}
                  onInputChange={(_, v) => setEditingRule(prev => prev ? { ...prev, source: v } : null)}
                  renderOption={renderAutocompleteOption}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Source"
                      fullWidth
                      size="small"
                      placeholder="IP, CIDR, alias, +ipset"
                      InputProps={{ ...params.InputProps, sx: monoStyle }}
                    />
                  )}
                />
              </Grid>
              <Grid size={{ xs: 6 }}>
                <Autocomplete
                  freeSolo
                  options={autocompleteOptions}
                  getOptionLabel={(opt) => typeof opt === 'string' ? opt : opt.label}
                  inputValue={editingRule?.dest || ''}
                  onInputChange={(_, v) => setEditingRule(prev => prev ? { ...prev, dest: v } : null)}
                  renderOption={renderAutocompleteOption}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Destination"
                      fullWidth
                      size="small"
                      placeholder="IP, CIDR, alias, +ipset"
                      InputProps={{ ...params.InputProps, sx: monoStyle }}
                    />
                  )}
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <TextField
                  label={t('network.comment')}
                  value={editingRule?.comment || ''}
                  onChange={(e) => setEditingRule(prev => prev ? { ...prev, comment: e.target.value } : null)}
                  fullWidth
                  size="small"
                />
              </Grid>
            </Grid>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditRuleOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleUpdateRule} disabled={saving}>{t('common.save')}</Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('common.confirmDelete')}</DialogTitle>
        <DialogContent>
          <Typography>{t('common.deleteConfirmation')}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setDeleteConfirmOpen(false); setRuleToDelete(null); }}>{t('common.cancel')}</Button>
          <Button variant="contained" color="error" onClick={handleDeleteRule} disabled={saving}>
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>

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
                  value={options.log_level_in || 'nolog'}
                  onChange={(e) => handleLogLevelChange('log_level_in', e.target.value)}
                  sx={{ fontSize: 11, height: 28, minWidth: 90, '& .MuiSelect-select': { py: 0.3 } }}
                  disabled={saving}
                >
                  {LOG_LEVELS.map(l => <MenuItem key={l} value={l} sx={{ fontSize: 11 }}>{l}</MenuItem>)}
                </Select>
              </FormControl>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', fontSize: 11 }}>Log OUT:</Typography>
              <FormControl size="small">
                <Select
                  value={options.log_level_out || 'nolog'}
                  onChange={(e) => handleLogLevelChange('log_level_out', e.target.value)}
                  sx={{ fontSize: 11, height: 28, minWidth: 90, '& .MuiSelect-select': { py: 0.3 } }}
                  disabled={saving}
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
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar({ ...snackbar, open: false })}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
