'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
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

import VMIsolationPanel from './VMIsolationPanel'

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES
═══════════════════════════════════════════════════════════════════════════ */

interface MicrosegAnalysis {
  networks: NetworkInfo[]
  gateway_aliases: string[]
  base_sgs: string[]
  missing_gateways: MissingGateway[]
  missing_base_sgs: MissingBaseSG[]
  total_vms: number
  isolated_vms: number
  unprotected_vms: number
  segmentation_ready: boolean
}

interface NetworkInfo {
  name: string
  cidr: string
  comment: string
  gateway: string
  has_gateway: boolean
  has_base_sg: boolean
}

interface MissingGateway {
  network_name: string
  alias_name: string
  gateway_ip: string
}

interface MissingBaseSG {
  network_name: string
  sg_name: string
  gateway_name: string
}

interface GenerateResult {
  created_aliases: string[]
  created_groups: string[]
  errors: string[]
  dry_run: boolean
  plan: PlannedAction[]
}

interface PlannedAction {
  type: string
  name: string
  description: string
}

interface Props {
  connectionId: string
}

interface MicrosegConfig {
  gatewayMode: 'first' | 'last' | 'custom'
  customOffset: number
  createGateways: boolean
  createBaseSGs: boolean
  excludePatterns: string[]
  showExcluded: boolean
}

// Default patterns for infrastructure networks that should NOT be micro-segmented
const DEFAULT_EXCLUDE_PATTERNS = [
  'ceph',
  'corosync', 
  'migration',
  'backup',
  'cluster',
  'storage',
  'replication',
]

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════════ */

export default function MicrosegmentationTab({ connectionId }: Props) {
  const theme = useTheme()
  const t = useTranslations()
  
  // State
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [analysis, setAnalysis] = useState<MicrosegAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({ open: false, message: '', severity: 'success' })
  
  // Configuration
  const [config, setConfig] = useState<MicrosegConfig>(() => {
    // Try to load from localStorage
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(`microseg-config-${connectionId}`)

      if (saved) {
        try {
          return JSON.parse(saved)
        } catch {}
      }
    }

    
return {
      gatewayMode: 'last',
      customOffset: 254,
      createGateways: true,
      createBaseSGs: true,
      excludePatterns: DEFAULT_EXCLUDE_PATTERNS,
      showExcluded: true,
    }
  })

  const [configDialogOpen, setConfigDialogOpen] = useState(false)
  const [newPattern, setNewPattern] = useState('')
  
  // How it works toggle
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  // Dialogs
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false)
  const [previewResult, setPreviewResult] = useState<GenerateResult | null>(null)
  
  // Save config to localStorage when it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(`microseg-config-${connectionId}`, JSON.stringify(config))
    }
  }, [config, connectionId])
  
  // Check if a network is excluded based on patterns
  const isNetworkExcluded = useCallback((networkName: string): boolean => {
    const lowerName = networkName.toLowerCase()

    
return config.excludePatterns.some(pattern => 
      lowerName.includes(pattern.toLowerCase())
    )
  }, [config.excludePatterns])
  
  // Filter networks for display and operations
  const getFilteredNetworks = useCallback(() => {
    if (!analysis) return { included: [], excluded: [] }
    
    const included: NetworkInfo[] = []
    const excluded: NetworkInfo[] = []
    
    analysis.networks.forEach(net => {
      if (isNetworkExcluded(net.name)) {
        excluded.push(net)
      } else {
        included.push(net)
      }
    })
    
    return { included, excluded }
  }, [analysis, isNetworkExcluded])
  
  // Compute gateway offset based on config
  const getGatewayOffset = () => {
    switch (config.gatewayMode) {
      case 'first': return 1
      case 'last': return 254
      case 'custom': return config.customOffset
      default: return 254
    }
  }
  
  // Load analysis
  const loadAnalysis = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const offset = getGatewayOffset()
      const res = await fetch(`/api/v1/firewall/microseg/${connectionId}/analyze?gateway_offset=${offset}`)

      if (!res.ok) throw new Error('Failed to load analysis')
      const data = await res.json()

      setAnalysis(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [connectionId, config.gatewayMode, config.customOffset])
  
  useEffect(() => {
    loadAnalysis()
  }, [loadAnalysis])
  
  // Generate base SGs
  const handleGenerate = async (dryRun: boolean) => {
    setGenerating(true)

    try {
      const { included } = getFilteredNetworks()
      const includedNames = included.map(n => n.name)
      
      const res = await fetch(`/api/v1/firewall/microseg/${connectionId}/generate-base`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dry_run: dryRun,
          create_gateways: config.createGateways,
          gateway_offset: getGatewayOffset(),
          networks: includedNames, // Only generate for non-excluded networks
        })
      })

      if (!res.ok) throw new Error('Failed to generate')
      const result = await res.json()
      
      if (dryRun) {
        setPreviewResult(result)
      } else {
        setSnackbar({
          open: true,
          message: t('microseg.generateDialog.createdSuccess', { aliases: result.created_aliases?.length || 0, sgs: result.created_groups?.length || 0 }),
          severity: 'success'
        })
        setGenerateDialogOpen(false)
        setPreviewResult(null)
        loadAnalysis()
      }
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' })
    } finally {
      setGenerating(false)
    }
  }
  
  // Add exclusion pattern
  const handleAddPattern = () => {
    if (newPattern.trim() && !config.excludePatterns.includes(newPattern.trim().toLowerCase())) {
      setConfig({
        ...config,
        excludePatterns: [...config.excludePatterns, newPattern.trim().toLowerCase()]
      })
      setNewPattern('')
    }
  }
  
  // Remove exclusion pattern
  const handleRemovePattern = (pattern: string) => {
    setConfig({
      ...config,
      excludePatterns: config.excludePatterns.filter(p => p !== pattern)
    })
  }
  
  // Reset to default patterns
  const handleResetPatterns = () => {
    setConfig({
      ...config,
      excludePatterns: DEFAULT_EXCLUDE_PATTERNS
    })
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
      <Alert severity="error" sx={{ m: 3 }}>
        {error}
        <Button size="small" onClick={loadAnalysis} sx={{ ml: 2 }}>{t('common.retry')}</Button>
      </Alert>
    )
  }
  
  if (!analysis) return null
  
  const { included, excluded } = getFilteredNetworks()
  
  // Calculate stats based on included networks only
  const readinessPercent = included.length > 0 
    ? Math.round((included.filter(n => n.has_gateway && n.has_base_sg).length / included.length) * 100)
    : 100
  
  const isolationPercent = analysis.total_vms > 0
    ? Math.round((analysis.isolated_vms / analysis.total_vms) * 100)
    : 0

  const gatewayOffsetLabel = config.gatewayMode === 'first' ? '.1' : config.gatewayMode === 'last' ? '.254' : `.${config.customOffset}`
  
  // Filter missing items to exclude infrastructure networks
  const filteredMissingGateways = analysis.missing_gateways.filter(gw => !isNetworkExcluded(gw.network_name))
  const filteredMissingBaseSGs = analysis.missing_base_sgs.filter(sg => !isNetworkExcluded(sg.network_name))
  
  const isSegmentationReady = filteredMissingGateways.length === 0 && filteredMissingBaseSGs.length === 0

  return (
    <Box sx={{ p: 3 }}>
      <Stack spacing={3}>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
              <i className="ri-shield-keyhole-line" style={{ color: theme.palette.primary.main }} />
              {t('microseg.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('microseg.subtitle')}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Tooltip title="Configuration">
              <IconButton onClick={() => setConfigDialogOpen(true)}>
                <i className="ri-settings-4-line" />
              </IconButton>
            </Tooltip>
            <Button
              variant="contained"
              startIcon={<i className="ri-magic-line" />}
              onClick={() => setGenerateDialogOpen(true)}
              disabled={isSegmentationReady}
            >
              {isSegmentationReady ? t('microseg.configComplete') : t('microseg.generateConfig')}
            </Button>
          </Box>
        </Box>
        
        {/* Status Cards */}
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card sx={{ 
              background: `linear-gradient(135deg, ${alpha(isSegmentationReady ? '#22c55e' : '#f59e0b', 0.1)} 0%, transparent 100%)`,
              border: `1px solid ${alpha(isSegmentationReady ? '#22c55e' : '#f59e0b', 0.2)}`
            }}>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <i className={isSegmentationReady ? "ri-checkbox-circle-fill" : "ri-error-warning-fill"} 
                     style={{ fontSize: 20, color: isSegmentationReady ? '#22c55e' : '#f59e0b' }} />
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase' }}>
                    Readiness
                  </Typography>
                </Box>
                <Typography variant="h4" sx={{ fontWeight: 900, color: isSegmentationReady ? '#22c55e' : '#f59e0b' }}>
                  {readinessPercent}%
                </Typography>
                <LinearProgress 
                  variant="determinate" 
                  value={readinessPercent} 
                  sx={{ 
                    mt: 1, 
                    height: 6, 
                    borderRadius: 3,
                    bgcolor: alpha(isSegmentationReady ? '#22c55e' : '#f59e0b', 0.1),
                    '& .MuiLinearProgress-bar': { bgcolor: isSegmentationReady ? '#22c55e' : '#f59e0b' }
                  }} 
                />
              </CardContent>
            </Card>
          </Grid>
          
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card sx={{ border: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <i className="ri-router-line" style={{ fontSize: 20, color: theme.palette.primary.main }} />
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase' }}>
                    {t('microseg.networks')}
                  </Typography>
                </Box>
                <Typography variant="h4" sx={{ fontWeight: 900 }}>
                  {included.length}
                  <Typography component="span" variant="body2" color="text.secondary">/{analysis.networks.length}</Typography>
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {excluded.length} {t('microseg.excludedInfra')}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card sx={{ border: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <i className="ri-server-line" style={{ fontSize: 20, color: '#22c55e' }} />
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase' }}>
                    {t('microseg.isolatedVms')}
                  </Typography>
                </Box>
                <Typography variant="h4" sx={{ fontWeight: 900 }}>
                  {analysis.isolated_vms}
                  <Typography component="span" variant="h6" color="text.secondary">/{analysis.total_vms}</Typography>
                </Typography>
                <LinearProgress 
                  variant="determinate" 
                  value={isolationPercent} 
                  sx={{ mt: 1, height: 6, borderRadius: 3 }} 
                />
              </CardContent>
            </Card>
          </Grid>
          
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card sx={{ 
              background: analysis.unprotected_vms > 0 ? `linear-gradient(135deg, ${alpha('#ef4444', 0.1)} 0%, transparent 100%)` : undefined,
              border: `1px solid ${alpha(analysis.unprotected_vms > 0 ? '#ef4444' : theme.palette.divider, 0.2)}`
            }}>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <i className="ri-shield-cross-line" style={{ fontSize: 20, color: analysis.unprotected_vms > 0 ? '#ef4444' : '#94a3b8' }} />
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase' }}>
                    {t('microseg.unprotected')}
                  </Typography>
                </Box>
                <Typography variant="h4" sx={{ fontWeight: 900, color: analysis.unprotected_vms > 0 ? '#ef4444' : 'text.primary' }}>
                  {analysis.unprotected_vms}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('microseg.firewallDisabled')}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
        
        {/* Missing Configuration Alert */}
        {!isSegmentationReady && (
          <Alert 
            severity="warning" 
            icon={<i className="ri-error-warning-line" style={{ fontSize: 22 }} />}
            action={
              <Button color="inherit" size="small" onClick={() => setGenerateDialogOpen(true)}>
                {t('microseg.configure')}
              </Button>
            }
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{t('microseg.configIncomplete')}</Typography>
            <Typography variant="body2">
              {filteredMissingGateways.length > 0 && t('microseg.missingGatewayAliases', { count: filteredMissingGateways.length }) + ' '}
              {filteredMissingBaseSGs.length > 0 && t('microseg.missingBaseSGs', { count: filteredMissingBaseSGs.length })}
            </Typography>
          </Alert>
        )}
        
        {/* Networks Table */}
        <Card sx={{ border: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
              <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className="ri-global-line" style={{ fontSize: 20 }} />
                {t('microseg.detectedNetworks')}
                <Chip size="small" label={`${included.length} ${t('microseg.active')}`} color="primary" sx={{ ml: 1 }} />
                {excluded.length > 0 && (
                  <Chip size="small" label={`${excluded.length} ${t('microseg.excluded')}`} variant="outlined" />
                )}
              </Typography>
              <Chip 
                size="small" 
                variant="outlined"
                icon={<i className="ri-route-line" style={{ fontSize: 14 }} />}
                label={`Gateway: ${gatewayOffsetLabel}`} 
              />
            </Box>
            
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>{t('microseg.networks')}</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>CIDR</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>{t('microseg.gateway')}</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>{t('microseg.aliasGW')}</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>{t('microseg.baseSG')}</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>{t('microseg.status')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {/* Included networks */}
                  {included.map((net) => {
                    const suffix = net.name.substring(4)
                    const gwName = `gw-${suffix}`
                    const sgName = `sg-base-${suffix}`
                    const isComplete = net.has_gateway && net.has_base_sg
                    
                    return (
                      <TableRow key={net.name} hover>
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <i className="ri-router-line" style={{ fontSize: 16, color: theme.palette.primary.main }} />
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>{net.name}</Typography>
                          </Box>
                          {net.comment && (
                            <Typography variant="caption" color="text.secondary">{net.comment}</Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{net.cidr}</Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{net.gateway}</Typography>
                        </TableCell>
                        <TableCell>
                          {net.has_gateway ? (
                            <Chip size="small" icon={<i className="ri-check-line" />} label={gwName} color="success" variant="outlined" sx={{ height: 24 }} />
                          ) : (
                            <Chip size="small" icon={<i className="ri-close-line" />} label={gwName} color="warning" variant="outlined" sx={{ height: 24 }} />
                          )}
                        </TableCell>
                        <TableCell>
                          {net.has_base_sg ? (
                            <Chip size="small" icon={<i className="ri-check-line" />} label={sgName} color="success" variant="outlined" sx={{ height: 24 }} />
                          ) : (
                            <Chip size="small" icon={<i className="ri-close-line" />} label={sgName} color="warning" variant="outlined" sx={{ height: 24 }} />
                          )}
                        </TableCell>
                        <TableCell>
                          {isComplete ? (
                            <Chip size="small" label={t('microseg.ready')} color="success" sx={{ height: 24 }} />
                          ) : (
                            <Chip size="small" label={t('microseg.incomplete')} color="warning" sx={{ height: 24 }} />
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                  
                  {/* Excluded networks (if showExcluded is true) */}
                  {config.showExcluded && excluded.length > 0 && (
                    <>
                      <TableRow>
                        <TableCell colSpan={6} sx={{ bgcolor: alpha(theme.palette.divider, 0.03), py: 1 }}>
                          <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 1 }}>
                            <i className="ri-forbid-line" style={{ fontSize: 14 }} />
                            {t('microseg.excludedNetworks')}
                          </Typography>
                        </TableCell>
                      </TableRow>
                      {excluded.map((net) => (
                        <TableRow key={net.name} sx={{ opacity: 0.5, bgcolor: alpha(theme.palette.divider, 0.02) }}>
                          <TableCell>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <i className="ri-server-line" style={{ fontSize: 16, color: '#94a3b8' }} />
                              <Typography variant="body2" sx={{ fontWeight: 600 }}>{net.name}</Typography>
                              <Chip size="small" label="Infra" sx={{ height: 18, fontSize: 10, bgcolor: alpha('#94a3b8', 0.2) }} />
                            </Box>
                            {net.comment && (
                              <Typography variant="caption" color="text.secondary">{net.comment}</Typography>
                            )}
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{net.cidr}</Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{net.gateway}</Typography>
                          </TableCell>
                          <TableCell colSpan={3}>
                            <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                              {t('microseg.excludedFromMicroseg')}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ))}
                    </>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
        
        {/* VM Isolation Panel */}
        <Card sx={{ border: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
          <CardContent sx={{ p: 0 }}>
            <Box sx={{ p: 2, borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className="ri-computer-line" style={{ fontSize: 20 }} />
                {t('microseg.vmIsolation')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('microseg.clickVmToIsolate')}
              </Typography>
            </Box>
            <VMIsolationPanel 
              connectionId={connectionId} 
              excludePatterns={config.excludePatterns}
            />
          </CardContent>
        </Card>
        
        {/* How it works — collapsible */}
        <Box>
          <Button
            variant="text"
            onClick={() => setShowHowItWorks(!showHowItWorks)}
            startIcon={<i className="ri-question-line" style={{ fontSize: 18 }} />}
            endIcon={<i className={showHowItWorks ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"} style={{ fontSize: 18 }} />}
            sx={{ color: 'text.secondary', textTransform: 'none', fontWeight: 600 }}
          >
            {t('microseg.howItWorksToggle')}
          </Button>
          <Collapse in={showHowItWorks}>
            <Card sx={{ border: `1px solid ${alpha(theme.palette.divider, 0.1)}`, mt: 1 }}>
              <CardContent>
                <Grid container spacing={3}>
                  <Grid size={{ xs: 12, md: 4 }}>
                    <Paper sx={{ p: 2, bgcolor: alpha(theme.palette.primary.main, 0.03), border: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`, height: '100%' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <Avatar sx={{ width: 28, height: 28, bgcolor: theme.palette.primary.main, fontSize: 14 }}>1</Avatar>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t('microseg.gatewayAliases')}</Typography>
                      </Box>
                      <Typography variant="body2" color="text.secondary">
                        {t('microseg.gatewayAliasesDesc', { offset: gatewayOffsetLabel })}
                      </Typography>
                    </Paper>
                  </Grid>

                  <Grid size={{ xs: 12, md: 4 }}>
                    <Paper sx={{ p: 2, bgcolor: alpha(theme.palette.warning.main, 0.03), border: `1px solid ${alpha(theme.palette.warning.main, 0.1)}`, height: '100%' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <Avatar sx={{ width: 28, height: 28, bgcolor: theme.palette.warning.main, fontSize: 14 }}>2</Avatar>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t('microseg.securityGroupsBase')}</Typography>
                      </Box>
                      <Typography variant="body2" color="text.secondary">
                        {t('microseg.securityGroupsBaseDesc')}
                      </Typography>
                    </Paper>
                  </Grid>

                  <Grid size={{ xs: 12, md: 4 }}>
                    <Paper sx={{ p: 2, bgcolor: alpha(theme.palette.success.main, 0.03), border: `1px solid ${alpha(theme.palette.success.main, 0.1)}`, height: '100%' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <Avatar sx={{ width: 28, height: 28, bgcolor: theme.palette.success.main, fontSize: 14 }}>3</Avatar>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t('microseg.vmApplication')}</Typography>
                      </Box>
                      <Typography variant="body2" color="text.secondary">
                        {t('microseg.vmApplicationDesc')}
                      </Typography>
                    </Paper>
                  </Grid>
                </Grid>

                <Divider sx={{ my: 2 }} />

                <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>{t('microseg.exampleRules')}</Typography>
                <Paper sx={{ p: 1.5, bgcolor: '#0d1117', borderRadius: 1 }}>
                  <Box component="pre" sx={{ m: 0, fontSize: 12, fontFamily: 'monospace', color: '#c9d1d9' }}>
{`OUT ACCEPT -dest gw-dmz-k8s        # Autoriser passerelle
IN  ACCEPT -source gw-dmz-k8s      # Autoriser depuis passerelle
OUT DROP   -dest net-dmz-k8s       # Bloquer VLAN sortant
IN  DROP   -source net-dmz-k8s     # Bloquer VLAN entrant`}
                  </Box>
                </Paper>
              </CardContent>
            </Card>
          </Collapse>
        </Box>
      </Stack>
      
      {/* Configuration Dialog */}
      <Dialog open={configDialogOpen} onClose={() => setConfigDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-settings-4-line" style={{ color: theme.palette.primary.main }} />
          {t('microseg.configDialog.title')}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ mt: 1 }}>
            {/* Gateway Configuration */}
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                {t('microseg.configDialog.gatewayAddress')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('microseg.configDialog.gatewayAddressDesc')}
              </Typography>
              <FormControl component="fieldset">
                <RadioGroup 
                  value={config.gatewayMode} 
                  onChange={(e) => setConfig({ ...config, gatewayMode: e.target.value as any })}
                >
                  <FormControlLabel
                    value="first"
                    control={<Radio size="small" />}
                    label={
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>{t('microseg.configDialog.firstIP')}</Typography>
                        <Typography variant="caption" color="text.secondary">{t('microseg.configDialog.firstIPExample')}</Typography>
                      </Box>
                    }
                  />
                  <FormControlLabel
                    value="last"
                    control={<Radio size="small" />}
                    label={
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>{t('microseg.configDialog.lastIP')}</Typography>
                        <Typography variant="caption" color="text.secondary">{t('microseg.configDialog.lastIPExample')}</Typography>
                      </Box>
                    }
                  />
                  <FormControlLabel
                    value="custom"
                    control={<Radio size="small" />}
                    label={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>{t('microseg.configDialog.custom')}</Typography>
                        <TextField
                          size="small"
                          type="number"
                          value={config.customOffset}
                          onChange={(e) => setConfig({ ...config, customOffset: parseInt(e.target.value) || 1 })}
                          disabled={config.gatewayMode !== 'custom'}
                          sx={{ width: 80 }}
                          inputProps={{ min: 1, max: 254 }}
                        />
                      </Box>
                    }
                  />
                </RadioGroup>
              </FormControl>
            </Box>
            
            <Divider />
            
            {/* Exclusion Patterns */}
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                  {t('microseg.configDialog.excludedNetworks')}
                </Typography>
                <Button size="small" onClick={handleResetPatterns} startIcon={<i className="ri-refresh-line" />}>
                  {t('microseg.configDialog.reset')}
                </Button>
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('microseg.configDialog.excludedNetworksDesc')}
              </Typography>
              
              <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                <TextField
                  size="small"
                  placeholder={t('microseg.configDialog.addPattern')}
                  value={newPattern}
                  onChange={(e) => setNewPattern(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleAddPattern()}
                  sx={{ flex: 1 }}
                />
                <Button variant="outlined" onClick={handleAddPattern} disabled={!newPattern.trim()}>
                  {t('microseg.configDialog.add')}
                </Button>
              </Box>
              
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {config.excludePatterns.map(pattern => (
                  <Chip
                    key={pattern}
                    label={pattern}
                    onDelete={() => handleRemovePattern(pattern)}
                    size="small"
                    variant="outlined"
                  />
                ))}
                {config.excludePatterns.length === 0 && (
                  <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                    {t('microseg.configDialog.noExclusionPattern')}
                  </Typography>
                )}
              </Box>
              
              <FormControlLabel
                sx={{ mt: 2 }}
                control={
                  <Switch 
                    checked={config.showExcluded} 
                    onChange={(e) => setConfig({ ...config, showExcluded: e.target.checked })}
                    size="small"
                  />
                }
                label={<Typography variant="body2">{t('microseg.configDialog.showExcludedInList')}</Typography>}
              />
            </Box>
            
            <Divider />
            
            {/* Generation Options */}
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                {t('microseg.configDialog.generationOptions')}
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={config.createGateways}
                    onChange={(e) => setConfig({ ...config, createGateways: e.target.checked })}
                    size="small"
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2">{t('microseg.configDialog.autoCreateGwAliases')}</Typography>
                    <Typography variant="caption" color="text.secondary">{t('microseg.configDialog.autoCreateGwAliasesDesc')}</Typography>
                  </Box>
                }
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={config.createBaseSGs}
                    onChange={(e) => setConfig({ ...config, createBaseSGs: e.target.checked })}
                    size="small"
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2">{t('microseg.configDialog.autoCreateBaseSGs')}</Typography>
                    <Typography variant="caption" color="text.secondary">{t('microseg.configDialog.autoCreateBaseSGsDesc')}</Typography>
                  </Box>
                }
              />
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfigDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button 
            variant="contained" 
            onClick={() => { setConfigDialogOpen(false); loadAnalysis(); }}
            startIcon={<i className="ri-check-line" />}
          >
            {t('common.apply')}
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* Generate Dialog */}
      <Dialog open={generateDialogOpen} onClose={() => setGenerateDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-magic-line" style={{ color: theme.palette.primary.main }} />
          {t('microseg.generateDialog.title')}
        </DialogTitle>
        <DialogContent>
          {!previewResult ? (
            <>
              <Alert severity="info" sx={{ mb: 2 }}>
                {t('microseg.generateDialog.info')}
                <br />
                <strong>{t('microseg.generateDialog.excludedNetworksInfo', { count: excluded.length })}</strong>
              </Alert>

              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>{t('microseg.generateDialog.itemsToCreate')}</Typography>
              
              {filteredMissingGateways.length > 0 && config.createGateways && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                    {t('microseg.generateDialog.gatewayAliases', { count: filteredMissingGateways.length })}
                  </Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {filteredMissingGateways.map(gw => (
                      <Chip key={gw.alias_name} size="small" label={`${gw.alias_name} → ${gw.gateway_ip}`} variant="outlined" />
                    ))}
                  </Stack>
                </Box>
              )}
              
              {filteredMissingBaseSGs.length > 0 && config.createBaseSGs && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                    {t('microseg.generateDialog.securityGroupsBase', { count: filteredMissingBaseSGs.length })}
                  </Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {filteredMissingBaseSGs.map(sg => (
                      <Chip key={sg.sg_name} size="small" label={sg.sg_name} variant="outlined" color="primary" />
                    ))}
                  </Stack>
                </Box>
              )}
              
              {filteredMissingGateways.length === 0 && filteredMissingBaseSGs.length === 0 && (
                <Alert severity="success">
                  {t('microseg.generateDialog.allConfigured')}
                </Alert>
              )}

              {!config.createGateways && filteredMissingGateways.length > 0 && (
                <Alert severity="warning" sx={{ mt: 2 }}>
                  {t('microseg.generateDialog.gwCreationDisabled', { count: filteredMissingGateways.length })}
                </Alert>
              )}
            </>
          ) : (
            <>
              <Alert severity="success" sx={{ mb: 2 }}>
                {t('microseg.generateDialog.previewTitle')}
              </Alert>

              {previewResult.plan.length > 0 ? (
                <>
                  <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>{t('microseg.generateDialog.plannedActions')}</Typography>
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>Nom</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>Description</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {previewResult.plan.map((action, idx) => (
                          <TableRow key={idx}>
                            <TableCell>
                              <Chip 
                                size="small" 
                                label={action.type === 'alias' ? 'Alias' : 'Security Group'} 
                                color={action.type === 'alias' ? 'default' : 'primary'}
                                sx={{ height: 22 }}
                              />
                            </TableCell>
                            <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{action.name}</TableCell>
                            <TableCell>{action.description}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </>
              ) : (
                <Alert severity="info">
                  {t('microseg.generateDialog.noActions')}
                </Alert>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setGenerateDialogOpen(false); setPreviewResult(null) }}>
            {t('common.cancel')}
          </Button>
          {!previewResult ? (
            <Button
              variant="outlined"
              onClick={() => handleGenerate(true)}
              disabled={generating || (filteredMissingGateways.length === 0 && filteredMissingBaseSGs.length === 0)}
              startIcon={generating ? <CircularProgress size={16} /> : <i className="ri-eye-line" />}
            >
              {t('microseg.generateDialog.preview')}
            </Button>
          ) : (
            <Button
              variant="contained"
              onClick={() => handleGenerate(false)}
              disabled={generating || previewResult.plan.length === 0}
              startIcon={generating ? <CircularProgress size={16} /> : <i className="ri-check-line" />}
              color="success"
            >
              {t('microseg.generateDialog.apply', { count: previewResult.plan.length })}
            </Button>
          )}
        </DialogActions>
      </Dialog>
      
      {/* Snackbar */}
      <Snackbar 
        open={snackbar.open} 
        autoHideDuration={5000} 
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
