'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert,
  Avatar,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Paper,
  Skeleton,
  Snackbar,
  Stack,
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

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES
═══════════════════════════════════════════════════════════════════════════ */

interface VMSegmentationSummary {
  vmid: number
  name: string
  node: string
  type: string
  status: string
  network: string
  networks: string[]
  firewall_enabled: boolean
  is_isolated: boolean
  missing_base_sgs: string[]
  applied_sgs: string[]
}

interface VMListForSegmentation {
  total_vms: number
  isolated_vms: number
  unprotected_vms: number
  vms: VMSegmentationSummary[]
}

interface ImpactSimulation {
  vmid: number
  name: string
  current_state: VMIsolationState
  simulated_state: VMIsolationState
  allowed_flows: FlowAnalysis[]
  blocked_flows: FlowAnalysis[]
  affected_vms: AffectedVM[]
  warnings: string[]
  required_actions: string[]
}

interface VMIsolationState {
  firewall_enabled: boolean
  policy_in: string
  policy_out: string
  is_isolated: boolean
  applied_sgs: string[]
}

interface FlowAnalysis {
  direction: string
  protocol: string
  port: string
  source: string
  destination: string
  reason: string
  critical: boolean
}

interface AffectedVM {
  vmid: number
  name: string
  node: string
  network: string
  ip_address: string
  impact: string
  can_resolve: boolean
  resolution: string
}

interface VMNetworkInfo {
  interface: string
  bridge: string
  ip_address: string
  network: string
  gateway: string
  base_sg: string
  firewall: boolean
}

interface VMSegmentationStatus {
  vmid: number
  name: string
  node: string
  firewall_enabled: boolean
  policy_in: string
  policy_out: string
  networks: VMNetworkInfo[]
  is_isolated: boolean
  applied_base_sgs: string[]
  applied_sgs: string[]
  direct_rules: number
  recommendations: string[]
}

interface Props {
  connectionId: string
  networkFilter?: string
  excludePatterns?: string[]
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════════ */

export default function VMIsolationPanel({ connectionId, networkFilter, excludePatterns = [] }: Props) {
  const theme = useTheme()
  const t = useTranslations()
  
  const [loading, setLoading] = useState(true)
  const [vmList, setVmList] = useState<VMListForSegmentation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  
  const [selectedVM, setSelectedVM] = useState<VMSegmentationSummary | null>(null)
  const [vmStatus, setVmStatus] = useState<VMSegmentationStatus | null>(null)
  const [simulation, setSimulation] = useState<ImpactSimulation | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [isolating, setIsolating] = useState(false)
  
  const [selectedInterfaces, setSelectedInterfaces] = useState<Record<string, boolean>>({})
  
  // Security level: 'standard' (OUT=ACCEPT) or 'reinforced' (OUT=DROP + gateway only)
  const [securityLevel, setSecurityLevel] = useState<'standard' | 'reinforced'>('standard')
  
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ 
    open: false, message: '', severity: 'success' 
  })

  const loadVMList = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const url = networkFilter 
        ? `/api/v1/firewall/microseg/${connectionId}/vms?network=${encodeURIComponent(networkFilter)}`
        : `/api/v1/firewall/microseg/${connectionId}/vms`

      const res = await fetch(url)

      if (!res.ok) throw new Error('Failed to load VMs')
      const data = await res.json()

      setVmList(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [connectionId, networkFilter])

  useEffect(() => {
    loadVMList()
  }, [loadVMList])

  const isNetworkExcluded = (networkName: string) => {
    if (!networkName) return false
    
return excludePatterns.some(pattern => 
      networkName.toLowerCase().includes(pattern.toLowerCase())
    )
  }

  const loadVMDetails = async (vm: VMSegmentationSummary) => {
    setSelectedVM(vm)
    setVmStatus(null)
    setSimulation(null)
    setSelectedInterfaces({})
    setLoadingDetail(true)
    
    try {
      const statusRes = await fetch(
        `/api/v1/firewall/microseg/${connectionId}/vm/${vm.node}/${vm.type}/${vm.vmid}`
      )

      if (statusRes.ok) {
        const statusData = await statusRes.json()

        setVmStatus(statusData)
        
        const initialSelection: Record<string, boolean> = {}

        statusData.networks?.forEach((net: VMNetworkInfo) => {
          const isExcluded = isNetworkExcluded(net.network)

          initialSelection[net.interface] = !isExcluded && !!net.network
        })
        setSelectedInterfaces(initialSelection)
      }
      
      const simRes = await fetch(
        `/api/v1/firewall/microseg/${connectionId}/vm/${vm.node}/${vm.type}/${vm.vmid}/simulate`
      )

      if (simRes.ok) {
        const simData = await simRes.json()

        setSimulation(simData)
      }
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' })
    } finally {
      setLoadingDetail(false)
    }
  }

  const handleInterfaceToggle = (iface: string) => {
    setSelectedInterfaces(prev => ({ ...prev, [iface]: !prev[iface] }))
  }

  const getSelectedInterfacesCount = () => {
    return Object.values(selectedInterfaces).filter(Boolean).length
  }

  const handleIsolateVM = async () => {
    if (!selectedVM || !vmStatus) return
    
    const selectedBaseSGs: string[] = []

    vmStatus.networks?.forEach(net => {
      if (selectedInterfaces[net.interface] && net.base_sg) {
        if (!selectedBaseSGs.includes(net.base_sg)) {
          selectedBaseSGs.push(net.base_sg)
        }
      }
    })
    
    if (selectedBaseSGs.length === 0) {
      setSnackbar({ open: true, message: t('vmIsolation.selectInterface'), severity: 'error' })

return
    }
    
    setIsolating(true)

    try {
      const res = await fetch(
        `/api/v1/firewall/microseg/${connectionId}/vm/${selectedVM.node}/${selectedVM.type}/${selectedVM.vmid}/isolate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enable_firewall: true,
            set_policy_in_drop: true,
            set_policy_out_drop: securityLevel === 'reinforced',
            apply_base_sgs: true,
            additional_sgs: selectedBaseSGs,
            enable_nic_fw: true,
          })
        }
      )

      if (!res.ok) throw new Error('Failed to isolate VM')
      
      const levelLabel = securityLevel === 'reinforced' ? t('vmIsolation.levelReinforced') : t('vmIsolation.levelStandard')

      setSnackbar({
        open: true,
        message: t('vmIsolation.vmIsolatedSuccess', { name: selectedVM.name, level: levelLabel, count: selectedBaseSGs.length }),
        severity: 'success'
      })
      setSelectedVM(null)
      setVmStatus(null)
      setSimulation(null)
      loadVMList()
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' })
    } finally {
      setIsolating(false)
    }
  }

  const filteredVMs = vmList?.vms.filter(vm => {
    if (searchTerm) {
      const term = searchTerm.toLowerCase()

      if (!vm.name.toLowerCase().includes(term) && 
          !vm.vmid.toString().includes(term) &&
          !vm.node.toLowerCase().includes(term)) {
        return false
      }
    }

    
return true
  }) || []

  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <Stack spacing={2}>
          {[1, 2, 3, 4, 5].map(i => (
            <Skeleton key={i} variant="rectangular" height={60} sx={{ borderRadius: 1 }} />
          ))}
        </Stack>
      </Box>
    )
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ m: 3 }}>
        {error}
        <Button size="small" onClick={loadVMList} sx={{ ml: 2 }}>{t('common.retry')}</Button>
      </Alert>
    )
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ p: 2, borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
              <i className="ri-computer-line" style={{ fontSize: 20 }} />
              VMs
            </Typography>
            <Chip
              size="small"
              label={`${vmList?.isolated_vms || 0}/${vmList?.total_vms || 0} ${t('vmIsolation.isolated')}`}
              color={vmList?.isolated_vms === vmList?.total_vms ? 'success' : 'warning'}
            />
            {vmList && vmList.unprotected_vms > 0 && (
              <Chip size="small" label={`${vmList.unprotected_vms} ${t('vmIsolation.withoutFirewall')}`} color="error" variant="outlined" />
            )}
          </Box>
          <TextField
            size="small"
            placeholder={t('vmIsolation.searchPlaceholder')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            sx={{ width: 250 }}
            InputProps={{
              startAdornment: <i className="ri-search-line" style={{ marginRight: 8, opacity: 0.5 }} />
            }}
          />
        </Box>
      </Box>

      {/* VM List */}
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700, width: 60 }}>{t('vmIsolation.vmid')}</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>{t('vmIsolation.name')}</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>{t('vmIsolation.node')}</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>{t('vmIsolation.network')}</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>{t('vmIsolation.firewall')}</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>{t('vmIsolation.isolation')}</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>{t('vmIsolation.sgs')}</TableCell>
              <TableCell sx={{ fontWeight: 700, width: 80 }}></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredVMs.map((vm) => (
              <TableRow 
                key={`${vm.node}-${vm.vmid}`} 
                hover
                sx={{ cursor: 'pointer', bgcolor: selectedVM?.vmid === vm.vmid ? alpha(theme.palette.primary.main, 0.08) : undefined }}
                onClick={() => loadVMDetails(vm)}
              >
                <TableCell>
                  <Chip 
                    size="small" 
                    label={vm.vmid}
                    sx={{ 
                      fontWeight: 600, minWidth: 50,
                      bgcolor: vm.type === 'lxc' ? alpha('#8b5cf6', 0.1) : alpha('#3b82f6', 0.1),
                      color: vm.type === 'lxc' ? '#8b5cf6' : '#3b82f6'
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: vm.status === 'running' ? '#22c55e' : '#94a3b8' }} />
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{vm.name}</Typography>
                  </Box>
                </TableCell>
                <TableCell><Typography variant="body2" color="text.secondary">{vm.node}</Typography></TableCell>
                <TableCell>
                  {vm.networks?.length > 0 ? (
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                      {vm.networks.slice(0, 2).map(net => (
                        <Chip 
                          key={net} size="small" label={net} variant="outlined" 
                          sx={{ height: 22, fontSize: 11, opacity: isNetworkExcluded(net) ? 0.5 : 1, textDecoration: isNetworkExcluded(net) ? 'line-through' : 'none' }} 
                        />
                      ))}
                      {vm.networks.length > 2 && <Chip size="small" label={`+${vm.networks.length - 2}`} sx={{ height: 22, fontSize: 11 }} />}
                    </Stack>
                  ) : <Typography variant="caption" color="text.secondary">-</Typography>}
                </TableCell>
                <TableCell>
                  {vm.firewall_enabled
                    ? <Chip size="small" icon={<i className="ri-check-line" />} label={t('vmIsolation.active')} color="success" sx={{ height: 24 }} />
                    : <Chip size="small" icon={<i className="ri-close-line" />} label={t('vmIsolation.inactive')} color="default" sx={{ height: 24 }} />}
                </TableCell>
                <TableCell>
                  {vm.is_isolated
                    ? <Chip size="small" icon={<i className="ri-shield-check-line" />} label={t('vmIsolation.yes')} color="success" sx={{ height: 24 }} />
                    : vm.missing_base_sgs?.length > 0
                      ? <Tooltip title={`${t('vmIsolation.missing')} ${vm.missing_base_sgs.join(', ')}`}><Chip size="small" icon={<i className="ri-error-warning-line" />} label={t('vmIsolation.partial')} color="warning" sx={{ height: 24 }} /></Tooltip>
                      : <Chip size="small" icon={<i className="ri-shield-cross-line" />} label={t('vmIsolation.no')} color="error" variant="outlined" sx={{ height: 24 }} />}
                </TableCell>
                <TableCell>
                  <Typography variant="caption" color="text.secondary">{vm.applied_sgs?.length || 0}</Typography>
                </TableCell>
                <TableCell>
                  <IconButton size="small" onClick={(e) => { e.stopPropagation(); loadVMDetails(vm); }}>
                    <i className="ri-settings-3-line" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {filteredVMs.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} sx={{ textAlign: 'center', py: 4 }}>
                  <Typography color="text.secondary">{searchTerm ? t('vmIsolation.noMatchingVm') : t('vmIsolation.noVmFound')}</Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* VM Detail Dialog */}
      <Dialog open={selectedVM !== null} onClose={() => { setSelectedVM(null); setVmStatus(null); setSimulation(null); }} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Avatar sx={{ bgcolor: alpha(theme.palette.primary.main, 0.1) }}>
            <i className="ri-computer-line" style={{ color: theme.palette.primary.main }} />
          </Avatar>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {selectedVM?.name}
              <Chip size="small" label={selectedVM?.vmid} sx={{ ml: 1, fontWeight: 600 }} />
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {selectedVM?.node} • {selectedVM?.type === 'lxc' ? t('vmIsolation.container') : t('vmIsolation.vm')}
            </Typography>
          </Box>
          {selectedVM?.is_isolated
            ? <Chip icon={<i className="ri-shield-check-line" />} label={t('vmIsolation.isolatedStatus')} color="success" />
            : <Chip icon={<i className="ri-shield-cross-line" />} label={t('vmIsolation.notIsolatedStatus')} color="warning" />}
        </DialogTitle>
        
        <DialogContent>
          {loadingDetail ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
          ) : (
            <Stack spacing={3}>
              {/* Before / After comparison - using flexbox for equal width */}
              <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', md: 'row' } }}>
                <Paper sx={{ p: 2.5, bgcolor: alpha('#ef4444', 0.03), border: `1px solid ${alpha('#ef4444', 0.2)}`, flex: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2, display: 'flex', alignItems: 'center', gap: 1, color: '#ef4444' }}>
                    <i className="ri-close-circle-line" /> {t('vmIsolation.before')}
                  </Typography>
                  <Stack spacing={2}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography variant="body2" color="text.secondary">{t('vmIsolation.firewall')}</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{simulation?.current_state.firewall_enabled ? `✅ ${t('vmIsolation.enabled')}` : `❌ ${t('vmIsolation.disabled')}`}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography variant="body2" color="text.secondary">Policy IN</Typography>
                      <Chip size="small" label={simulation?.current_state.policy_in || 'ACCEPT'} color={simulation?.current_state.policy_in === 'DROP' ? 'success' : 'error'} sx={{ height: 22, fontSize: 12 }} />
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography variant="body2" color="text.secondary">Security Groups</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{simulation?.current_state.applied_sgs?.length || 0}</Typography>
                    </Box>
                    <Divider />
                    <Box sx={{ p: 2, bgcolor: alpha('#ef4444', 0.1), borderRadius: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: '#ef4444', mb: 1 }}>⚠️ {t('vmIsolation.currentRisks')}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        • {t('vmIsolation.riskVlanAccess')}<br/>• {t('vmIsolation.riskNoIsolation')}<br/>• {t('vmIsolation.riskLateralMovement')}
                      </Typography>
                    </Box>
                  </Stack>
                </Paper>
                <Paper sx={{ p: 2.5, bgcolor: alpha('#22c55e', 0.03), border: `1px solid ${alpha('#22c55e', 0.2)}`, flex: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2, display: 'flex', alignItems: 'center', gap: 1, color: '#22c55e' }}>
                    <i className="ri-checkbox-circle-line" /> {t('vmIsolation.after')}
                  </Typography>
                  <Stack spacing={2}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography variant="body2" color="text.secondary">{t('vmIsolation.firewall')}</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>✅ {t('vmIsolation.enabled')}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography variant="body2" color="text.secondary">Policy IN</Typography>
                      <Chip size="small" label="DROP" color="success" sx={{ height: 22, fontSize: 12 }} />
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography variant="body2" color="text.secondary">Policy OUT</Typography>
                      <Chip
                        size="small"
                        label={securityLevel === 'reinforced' ? 'DROP' : 'ACCEPT'}
                        color={securityLevel === 'reinforced' ? 'warning' : 'default'}
                        sx={{ height: 22, fontSize: 12 }}
                      />
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography variant="body2" color="text.secondary">Security Groups</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>+{getSelectedInterfacesCount()} sg-base-*</Typography>
                    </Box>
                    <Divider />
                    <Box sx={{ p: 2, bgcolor: alpha('#22c55e', 0.1), borderRadius: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: '#22c55e', mb: 1 }}>
                        ✅ {securityLevel === 'reinforced' ? t('vmIsolation.protectionReinforced') : t('vmIsolation.protectionStandard')}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        • {t('vmIsolation.inboundBlocked')}<br/>
                        • {t('vmIsolation.gatewayAllowed')}<br/>
                        {securityLevel === 'reinforced'
                          ? `• ${t('vmIsolation.outboundControlled')}`
                          : `• ${t('vmIsolation.outboundFree')}`
                        }
                      </Typography>
                    </Box>
                  </Stack>
                </Paper>
              </Box>

              {/* Interface Selection */}
              {vmStatus?.networks && vmStatus.networks.length > 0 && (
                <Paper sx={{ p: 2, border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`, bgcolor: alpha(theme.palette.primary.main, 0.02) }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <i className="ri-router-line" style={{ color: theme.palette.primary.main }} />
                    {t('vmIsolation.interfaceSelection')}
                  </Typography>
                  <Stack spacing={1}>
                    {vmStatus.networks.map((net) => {
                      const isExcluded = isNetworkExcluded(net.network)
                      const hasBaseSG = !!net.base_sg
                      const isSelected = selectedInterfaces[net.interface] || false
                      
                      return (
                        <Paper 
                          key={net.interface} 
                          sx={{ 
                            p: 1.5, 
                            bgcolor: isSelected ? alpha(theme.palette.primary.main, 0.05) : alpha(theme.palette.divider, 0.03),
                            border: `1px solid ${isSelected ? alpha(theme.palette.primary.main, 0.3) : alpha(theme.palette.divider, 0.1)}`,
                            opacity: isExcluded ? 0.6 : 1
                          }}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <Checkbox
                              checked={isSelected}
                              onChange={() => handleInterfaceToggle(net.interface)}
                              disabled={isExcluded || !hasBaseSG || !net.network}
                              size="small"
                            />
                            <Box sx={{ flex: 1 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>{net.interface}</Typography>
                                <Chip size="small" label={net.bridge} variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                                {net.network && (
                                  <Chip size="small" label={net.network} color={isExcluded ? 'default' : 'primary'} variant={isExcluded ? 'outlined' : 'filled'} sx={{ height: 18, fontSize: 10 }} />
                                )}
                                {isExcluded && <Chip size="small" label="Infra" color="warning" sx={{ height: 18, fontSize: 10 }} />}
                              </Box>
                              <Typography variant="caption" color="text.secondary">
                                {net.ip_address && `IP: ${net.ip_address} • `}
                                {net.base_sg ? `SG: ${net.base_sg}` : t('vmIsolation.networkNotDetected')}
                              </Typography>
                            </Box>
                            {isSelected && hasBaseSG && (
                              <Chip size="small" icon={<i className="ri-arrow-right-line" />} label={net.base_sg} color="success" variant="outlined" sx={{ height: 24 }} />
                            )}
                          </Box>
                        </Paper>
                      )
                    })}
                  </Stack>
                  {getSelectedInterfacesCount() === 0 && (
                    <Alert severity="warning" sx={{ mt: 2 }}>{t('vmIsolation.selectInterfaceWarning')}</Alert>
                  )}
                </Paper>
              )}

              {/* Security Level Selection */}
              {getSelectedInterfacesCount() > 0 && (
                <Paper sx={{ p: 2, border: `1px solid ${alpha(theme.palette.divider, 0.2)}` }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <i className="ri-shield-star-line" style={{ color: theme.palette.warning.main }} />
                    {t('vmIsolation.securityLevel')}
                  </Typography>
                  <Stack spacing={1}>
                    <Paper
                      sx={{
                        p: 1.5,
                        cursor: 'pointer',
                        border: `2px solid ${securityLevel === 'standard' ? theme.palette.primary.main : alpha(theme.palette.divider, 0.2)}`,
                        bgcolor: securityLevel === 'standard' ? alpha(theme.palette.primary.main, 0.05) : 'transparent'
                      }}
                      onClick={() => setSecurityLevel('standard')}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Box sx={{
                          width: 20, height: 20, borderRadius: '50%',
                          border: `2px solid ${securityLevel === 'standard' ? theme.palette.primary.main : theme.palette.divider}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                          {securityLevel === 'standard' && <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: theme.palette.primary.main }} />}
                        </Box>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="body2" sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
                            🟢 {t('vmIsolation.standard')}
                            <Chip size="small" label={t('vmIsolation.recommended')} color="success" sx={{ height: 18, fontSize: 10 }} />
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {t('vmIsolation.standardDesc')}
                          </Typography>
                        </Box>
                      </Box>
                    </Paper>
                    <Paper
                      sx={{
                        p: 1.5,
                        cursor: 'pointer',
                        border: `2px solid ${securityLevel === 'reinforced' ? theme.palette.warning.main : alpha(theme.palette.divider, 0.2)}`,
                        bgcolor: securityLevel === 'reinforced' ? alpha(theme.palette.warning.main, 0.05) : 'transparent'
                      }}
                      onClick={() => setSecurityLevel('reinforced')}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Box sx={{
                          width: 20, height: 20, borderRadius: '50%',
                          border: `2px solid ${securityLevel === 'reinforced' ? theme.palette.warning.main : theme.palette.divider}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                          {securityLevel === 'reinforced' && <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: theme.palette.warning.main }} />}
                        </Box>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            🟡 {t('vmIsolation.reinforced')}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {t('vmIsolation.reinforcedDesc')}
                          </Typography>
                        </Box>
                      </Box>
                    </Paper>
                  </Stack>
                </Paper>
              )}

              {/* Warnings - filter out infrastructure network warnings */}
              {simulation?.warnings && simulation.warnings.length > 0 && (() => {
                const filteredWarnings = simulation.warnings.filter(w => {
                  // Exclude warnings about infrastructure networks
                  for (const pattern of excludePatterns) {
                    if (w.toLowerCase().includes(pattern.toLowerCase())) {
                      return false
                    }
                  }

                  
return true
                })

                
return filteredWarnings.length > 0 ? (
                  <Alert severity="warning">
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{t('vmIsolation.warnings')}</Typography>
                    <ul style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
                      {filteredWarnings.map((w, i) => <li key={i}><Typography variant="body2">{w}</Typography></li>)}
                    </ul>
                  </Alert>
                ) : null
              })()}

              {/* What will change */}
              <Paper sx={{ p: 2, bgcolor: alpha(theme.palette.divider, 0.03) }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className="ri-exchange-line" /> {t('vmIsolation.whatWillChange')}
                </Typography>
                <Box sx={{ display: 'flex', gap: 3, flexDirection: { xs: 'column', md: 'row' } }}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" sx={{ fontWeight: 600, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <i className="ri-check-line" /> {t('vmIsolation.allowed')}
                    </Typography>
                    <Box sx={{ mt: 1, pl: 2 }}>
                      {vmStatus?.networks?.filter(n => selectedInterfaces[n.interface] && n.gateway).map(net => (
                        <Typography key={net.interface} variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                          <i className="ri-arrow-right-s-line" style={{ color: '#22c55e' }} />
                          {t('vmIsolation.trafficToFrom')} <code style={{ background: alpha('#22c55e', 0.1), padding: '2px 6px', borderRadius: 4 }}>{net.gateway}</code>
                        </Typography>
                      ))}
                      {getSelectedInterfacesCount() === 0 && <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>{t('vmIsolation.selectInterfaces')}</Typography>}
                    </Box>
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" sx={{ fontWeight: 600, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <i className="ri-close-line" /> {t('vmIsolation.blocked')}
                    </Typography>
                    <Box sx={{ mt: 1, pl: 2 }}>
                      {vmStatus?.networks?.filter(n => selectedInterfaces[n.interface] && n.network).map(net => (
                        <Typography key={net.interface} variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                          <i className="ri-arrow-right-s-line" style={{ color: '#ef4444' }} />
                          {t('vmIsolation.trafficIntraVlan')} <code style={{ background: alpha('#ef4444', 0.1), padding: '2px 6px', borderRadius: 4 }}>{net.network}</code>
                        </Typography>
                      ))}
                    </Box>
                  </Box>
                </Box>
              </Paper>

              {/* Affected VMs */}
              {simulation?.affected_vms && simulation.affected_vms.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <i className="ri-group-line" style={{ color: '#f59e0b' }} />
                    {t('vmIsolation.affectedVmsCount', { count: simulation.affected_vms.length })}
                  </Typography>
                  <Alert severity="info" sx={{ mb: 1 }}>
                    {t('vmIsolation.affectedVmsInfo')}
                  </Alert>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {simulation.affected_vms.slice(0, 10).map(vm => (
                      <Chip key={vm.vmid} size="small" label={`${vm.name} (${vm.vmid})`} variant="outlined" />
                    ))}
                  </Stack>
                </Box>
              )}
            </Stack>
          )}
        </DialogContent>
        
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => { setSelectedVM(null); setVmStatus(null); setSimulation(null); }}>{t('common.close')}</Button>
          {selectedVM && !selectedVM.is_isolated && (
            <Button
              variant="contained"
              color="primary"
              onClick={handleIsolateVM}
              disabled={isolating || getSelectedInterfacesCount() === 0}
              startIcon={isolating ? <CircularProgress size={18} color="inherit" /> : <i className="ri-shield-check-line" />}
              sx={{ minWidth: 200 }}
            >
              {isolating
                ? t('vmIsolation.applying')
                : (getSelectedInterfacesCount() > 1
                    ? t('vmIsolation.enableIsolationPlural', { count: getSelectedInterfacesCount() })
                    : t('vmIsolation.enableIsolation', { count: getSelectedInterfacesCount() }))
              }
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar open={snackbar.open} autoHideDuration={5000} onClose={() => setSnackbar({ ...snackbar, open: false })} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Alert severity={snackbar.severity} onClose={() => setSnackbar({ ...snackbar, open: false })}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  )
}
