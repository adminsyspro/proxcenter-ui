'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { formatBytes } from '@/utils/format'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
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
  FormHelperText,
  IconButton,
  InputLabel,
  LinearProgress,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Select,
  Slider,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
// RemixIcon replacements for @mui/icons-material
const CheckCircleIcon = (props: any) => <i className="ri-checkbox-circle-fill" style={{ fontSize: props?.sx?.fontSize || 20, color: props?.sx?.color, ...props?.style }} />
const ErrorIcon = (props: any) => <i className="ri-error-warning-fill" style={{ fontSize: props?.sx?.fontSize || 20, color: props?.sx?.color, ...props?.style }} />
const WarningIcon = (props: any) => <i className="ri-alert-line" style={{ fontSize: props?.sx?.fontSize || 20, color: props?.sx?.color, ...props?.style }} />
const InfoIcon = (props: any) => <i className="ri-information-line" style={{ fontSize: props?.sx?.fontSize || 20, color: props?.sx?.color, ...props?.style }} />
const PlayArrowIcon = (props: any) => <i className="ri-play-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const PauseIcon = (props: any) => <i className="ri-pause-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const StopIcon = (props: any) => <i className="ri-stop-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const RefreshIcon = (props: any) => <i className="ri-refresh-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const ExpandMoreIcon = (props: any) => <i className="ri-arrow-down-s-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const ExpandLessIcon = (props: any) => <i className="ri-arrow-up-s-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const DragIndicatorIcon = (props: any) => <i className="ri-drag-move-2-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />

// Types
interface NodeInfo {
  node: string
  version: string
  vms: number
  status: 'online' | 'offline'
}

interface UpdateInfo {
  node: string
  package_count: number
  kernel_update: boolean
  packages: Array<{
    name: string
    current_version: string
    new_version: string
  }>
}

interface PreflightResult {
  can_proceed: boolean
  warnings: string[]
  errors: string[]
  cluster_health: {
    healthy: boolean
    quorum_ok: boolean
    total_nodes: number
    online_nodes: number
    ceph_healthy?: boolean
    issues: string[]
  }
  nodes_health: Array<{
    node: string
    online: boolean
    disk_space_ok: boolean
    disk_space_free_bytes: number
    memory_ok: boolean
    load_ok: boolean
    services_healthy: boolean
    issues: string[]
  }>
  updates_available: UpdateInfo[]
  migration_plan: {
    total_vms: number
    vms_to_migrate: number
    vms_to_shutdown: number
    estimated_duration_minutes: number
    node_plans: Array<{
      node: string
      vms_to_migrate: Array<{
        vmid: number
        name: string
        target_node: string
      }>
      vms_to_shutdown: Array<{
        vmid: number
        name: string
      }>
    }>
    resource_warnings: string[]
  }
  estimated_time_minutes: number
}

interface RollingUpdateConfig {
  node_order?: string[]
  exclude_nodes?: string[]
  migrate_non_ha_vms: boolean
  shutdown_local_vms: boolean
  max_concurrent_migrations: number
  migration_timeout: number
  auto_reboot: boolean
  reboot_timeout: number
  require_manual_approval: boolean
  min_healthy_nodes: number
  abort_on_failure: boolean
  set_ceph_noout: boolean
  wait_ceph_healthy: boolean
  restore_vm_placement: boolean
  notify_on_complete: boolean
  notify_on_error: boolean
}

interface RollingUpdate {
  id: string
  connection_id: string
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  config: RollingUpdateConfig
  total_nodes: number
  completed_nodes: number
  current_node: string
  node_statuses: Array<{
    node_name: string
    status: string
    started_at?: string
    completed_at?: string
    error?: string
    reboot_required: boolean
    did_reboot: boolean
    version_before?: string
    version_after?: string
  }>
  logs: Array<{
    timestamp: string
    level: string
    node?: string
    message: string
  }>
  error?: string
  created_at: string
  started_at?: string
  completed_at?: string
}

interface RollingUpdateWizardProps {
  open: boolean
  onClose: () => void
  connectionId: string
  nodes: NodeInfo[]
  nodeUpdates: Record<string, { count: number; updates: any[]; version: string | null }>
}

const defaultConfig: RollingUpdateConfig = {
  migrate_non_ha_vms: true,
  shutdown_local_vms: false,
  max_concurrent_migrations: 2,
  migration_timeout: 600,
  auto_reboot: true,
  reboot_timeout: 300,
  require_manual_approval: false,
  min_healthy_nodes: 2,
  abort_on_failure: true,
  set_ceph_noout: true,
  wait_ceph_healthy: true,
  restore_vm_placement: false,
  notify_on_complete: true,
  notify_on_error: true,
}

export default function RollingUpdateWizard({
  open,
  onClose,
  connectionId,
  nodes,
  nodeUpdates,
}: RollingUpdateWizardProps) {
  const t = useTranslations()
  
  // Wizard state
  const [activeStep, setActiveStep] = useState(0)
  const steps = [t('updates.wizardStepConfiguration'), t('updates.wizardStepVerifications'), t('updates.wizardStepExecution'), t('updates.wizardStepCompleted')]
  
  // Configuration state
  const [config, setConfig] = useState<RollingUpdateConfig>({ ...defaultConfig })
  const [nodeOrder, setNodeOrder] = useState<string[]>([])
  const [excludedNodes, setExcludedNodes] = useState<string[]>([])
  const [showAdvanced, setShowAdvanced] = useState(false)
  
  // Preflight state
  const [preflightLoading, setPreflightLoading] = useState(false)
  const [preflightResult, setPreflightResult] = useState<PreflightResult | null>(null)
  const [preflightError, setPreflightError] = useState<string | null>(null)
  
  // Execution state
  const [rollingUpdate, setRollingUpdate] = useState<RollingUpdate | null>(null)
  const [executionError, setExecutionError] = useState<string | null>(null)
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null)
  
  // Initialize node order from nodes
  useEffect(() => {
    if (nodes.length > 0 && nodeOrder.length === 0) {
      const onlineNodes = nodes
        .filter(n => n.status === 'online')
        .map(n => n.node)
        .sort()
      setNodeOrder(onlineNodes)
    }
  }, [nodes])
  
  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval)
      }
    }
  }, [pollingInterval])
  
  // Run preflight check
  const runPreflightCheck = useCallback(async () => {
    setPreflightLoading(true)
    setPreflightError(null)
    setPreflightResult(null)
    
    try {
      const finalConfig = {
        ...config,
        node_order: nodeOrder.filter(n => !excludedNodes.includes(n)),
        exclude_nodes: excludedNodes,
      }
      
      const res = await fetch('/api/v1/orchestrator/rolling-updates/preflight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connection_id: connectionId,
          config: finalConfig,
        }),
      })
      
      const json = await res.json()
      
      if (!res.ok) {
        throw new Error(json.error || 'Preflight check failed')
      }
      
      setPreflightResult(json.data)
      setActiveStep(1)
    } catch (e: any) {
      setPreflightError(e.message || 'Unknown error')
    } finally {
      setPreflightLoading(false)
    }
  }, [connectionId, config, nodeOrder, excludedNodes])
  
  // Start rolling update
  const startRollingUpdate = useCallback(async () => {
    setExecutionError(null)
    
    try {
      const finalConfig = {
        ...config,
        node_order: nodeOrder.filter(n => !excludedNodes.includes(n)),
        exclude_nodes: excludedNodes,
      }
      
      const res = await fetch('/api/v1/orchestrator/rolling-updates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connection_id: connectionId,
          config: finalConfig,
        }),
      })
      
      const json = await res.json()
      
      if (!res.ok) {
        throw new Error(json.error || 'Failed to start rolling update')
      }
      
      setRollingUpdate(json.data)
      setActiveStep(2)
      
      // Start polling for updates
      const interval = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/v1/orchestrator/rolling-updates/${json.data.id}`)
          const statusJson = await statusRes.json()
          
          if (statusRes.ok && statusJson.data) {
            setRollingUpdate(statusJson.data)
            
            // Stop polling if completed, failed, or cancelled
            if (['completed', 'failed', 'cancelled'].includes(statusJson.data.status)) {
              clearInterval(interval)
              setPollingInterval(null)
              setActiveStep(3)
            }
          }
        } catch (e) {
          console.error('Polling error:', e)
        }
      }, 3000)
      
      setPollingInterval(interval)
    } catch (e: any) {
      setExecutionError(e.message || 'Unknown error')
    }
  }, [connectionId, config, nodeOrder, excludedNodes])
  
  // Pause/Resume/Cancel actions
  const executeAction = useCallback(async (action: 'pause' | 'resume' | 'cancel') => {
    if (!rollingUpdate) return
    
    try {
      const res = await fetch(`/api/v1/orchestrator/rolling-updates/${rollingUpdate.id}/${action}`, {
        method: 'POST',
      })
      
      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error || `Failed to ${action}`)
      }
    } catch (e: any) {
      setExecutionError(e.message)
    }
  }, [rollingUpdate])
  
  // Format time
  const formatTime = (minutes: number) => {
    if (minutes < 60) return `~${minutes} min`
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return mins > 0 ? `~${hours}h ${mins}min` : `~${hours}h`
  }
  
  // Get node status icon
  const getNodeStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircleIcon sx={{ color: 'success.main' }} />
      case 'failed':
        return <ErrorIcon sx={{ color: 'error.main' }} />
      case 'running':
      case 'migrating_vms':
      case 'updating':
      case 'rebooting':
        return <CircularProgress size={20} />
      case 'pending':
        return <InfoIcon sx={{ color: 'text.secondary' }} />
      default:
        return <WarningIcon sx={{ color: 'warning.main' }} />
    }
  }
  
  // Handle close
  const handleClose = () => {
    if (rollingUpdate && ['running', 'paused'].includes(rollingUpdate.status)) {
      // Confirm before closing during execution
      if (!window.confirm(t('updates.confirmCloseWhileRunning'))) {
        return
      }
    }
    
    if (pollingInterval) {
      clearInterval(pollingInterval)
      setPollingInterval(null)
    }
    
    // Reset state
    setActiveStep(0)
    setPreflightResult(null)
    setPreflightError(null)
    setRollingUpdate(null)
    setExecutionError(null)
    
    onClose()
  }
  
  // Toggle node exclusion
  const toggleNodeExclusion = (node: string) => {
    setExcludedNodes(prev => 
      prev.includes(node) 
        ? prev.filter(n => n !== node)
        : [...prev, node]
    )
  }
  
  // Move node in order
  const moveNode = (index: number, direction: 'up' | 'down') => {
    const newOrder = [...nodeOrder]
    const newIndex = direction === 'up' ? index - 1 : index + 1
    
    if (newIndex < 0 || newIndex >= newOrder.length) return
    
    [newOrder[index], newOrder[newIndex]] = [newOrder[newIndex], newOrder[index]]
    setNodeOrder(newOrder)
  }
  
  return (
    <Dialog 
      open={open} 
      onClose={handleClose}
      maxWidth="md"
      fullWidth
      PaperProps={{ sx: { minHeight: '70vh' } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className="ri-refresh-line" style={{ fontSize: 24 }} />
        Rolling Update
        {rollingUpdate && (
          <Chip 
            size="small" 
            label={rollingUpdate.status}
            color={
              rollingUpdate.status === 'completed' ? 'success' :
              rollingUpdate.status === 'failed' ? 'error' :
              rollingUpdate.status === 'running' ? 'primary' :
              rollingUpdate.status === 'paused' ? 'warning' :
              'default'
            }
            sx={{ ml: 'auto' }}
          />
        )}
      </DialogTitle>
      
      <DialogContent dividers>
        <Stepper activeStep={activeStep} sx={{ mb: 3 }}>
          {steps.map((label, index) => (
            <Step key={label} completed={index < activeStep}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>
        
        {/* Step 0: Configuration */}
        {activeStep === 0 && (
          <Stack spacing={3}>
            {/* Node selection */}
            <Card variant="outlined">
              <CardContent>
                <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                  <i className="ri-server-line" style={{ marginRight: 8 }} />
                  {t('updates.nodeOrder')}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                  {t('updates.nodeOrderDescription')}
                </Typography>
                
                <List dense>
                  {nodeOrder.map((node, index) => {
                    const isExcluded = excludedNodes.includes(node)
                    const updateCount = nodeUpdates[node]?.count || 0
                    
                    return (
                      <ListItem
                        key={node}
                        sx={{ 
                          bgcolor: isExcluded ? 'action.disabledBackground' : 'transparent',
                          borderRadius: 1,
                          mb: 0.5,
                          opacity: isExcluded ? 0.6 : 1,
                        }}
                        secondaryAction={
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Chip
                              size="small"
                              label={t('updates.updatesCount', { count: updateCount })}
                              color={updateCount > 0 ? 'warning' : 'success'}
                              sx={{ height: 20, fontSize: 11 }}
                            />
                            <IconButton 
                              size="small" 
                              onClick={() => moveNode(index, 'up')}
                              disabled={index === 0 || isExcluded}
                            >
                              <i className="ri-arrow-up-s-line" />
                            </IconButton>
                            <IconButton 
                              size="small" 
                              onClick={() => moveNode(index, 'down')}
                              disabled={index === nodeOrder.length - 1 || isExcluded}
                            >
                              <i className="ri-arrow-down-s-line" />
                            </IconButton>
                          </Box>
                        }
                      >
                        <ListItemIcon sx={{ minWidth: 36 }}>
                          <Checkbox
                            checked={!isExcluded}
                            onChange={() => toggleNodeExclusion(node)}
                            size="small"
                          />
                        </ListItemIcon>
                        <ListItemText 
                          primary={node}
                          secondary={nodeUpdates[node]?.version || '—'}
                        />
                      </ListItem>
                    )
                  })}
                </List>
              </CardContent>
            </Card>
            
            {/* Basic options */}
            <Card variant="outlined">
              <CardContent>
                <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                  <i className="ri-settings-3-line" style={{ marginRight: 8 }} />
                  {t('updates.mainOptions')}
                </Typography>
                
                <Stack spacing={2} sx={{ mt: 2 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={config.migrate_non_ha_vms}
                        onChange={(e) => setConfig(c => ({ ...c, migrate_non_ha_vms: e.target.checked }))}
                      />
                    }
                    label={t('updates.migrateNonHaVms')}
                  />
                  
                  <FormControlLabel
                    control={
                      <Switch
                        checked={config.auto_reboot}
                        onChange={(e) => setConfig(c => ({ ...c, auto_reboot: e.target.checked }))}
                      />
                    }
                    label={t('updates.autoRebootIfKernel')}
                  />
                  
                  <FormControlLabel
                    control={
                      <Switch
                        checked={config.set_ceph_noout}
                        onChange={(e) => setConfig(c => ({ ...c, set_ceph_noout: e.target.checked }))}
                      />
                    }
                    label={t('updates.setCephNoout')}
                  />
                  
                  <FormControlLabel
                    control={
                      <Switch
                        checked={config.abort_on_failure}
                        onChange={(e) => setConfig(c => ({ ...c, abort_on_failure: e.target.checked }))}
                      />
                    }
                    label={t('updates.abortOnFailure')}
                  />
                  
                  <FormControlLabel
                    control={
                      <Switch
                        checked={config.require_manual_approval}
                        onChange={(e) => setConfig(c => ({ ...c, require_manual_approval: e.target.checked }))}
                      />
                    }
                    label={t('updates.manualApprovalBetweenNodes')}
                  />
                </Stack>
              </CardContent>
            </Card>
            
            {/* Advanced options */}
            <Box>
              <Button
                startIcon={showAdvanced ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                onClick={() => setShowAdvanced(!showAdvanced)}
                size="small"
              >
                {t('updates.advancedOptions')}
              </Button>
              
              <Collapse in={showAdvanced}>
                <Card variant="outlined" sx={{ mt: 1 }}>
                  <CardContent>
                    <Stack spacing={3}>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          {t('updates.maxParallelMigrations')}
                        </Typography>
                        <Slider
                          value={config.max_concurrent_migrations}
                          onChange={(_, v) => setConfig(c => ({ ...c, max_concurrent_migrations: v as number }))}
                          min={1}
                          max={5}
                          marks
                          valueLabelDisplay="auto"
                        />
                      </Box>
                      
                      <TextField
                        label={t('updates.migrationTimeout')}
                        type="number"
                        size="small"
                        value={config.migration_timeout}
                        onChange={(e) => setConfig(c => ({ ...c, migration_timeout: parseInt(e.target.value) || 600 }))}
                        InputProps={{ inputProps: { min: 60, max: 3600 } }}
                      />
                      
                      <TextField
                        label={t('updates.rebootTimeoutSeconds')}
                        type="number"
                        size="small"
                        value={config.reboot_timeout}
                        onChange={(e) => setConfig(c => ({ ...c, reboot_timeout: parseInt(e.target.value) || 300 }))}
                        InputProps={{ inputProps: { min: 60, max: 600 } }}
                      />
                      
                      <TextField
                        label={t('updates.minHealthyNodes')}
                        type="number"
                        size="small"
                        value={config.min_healthy_nodes}
                        onChange={(e) => setConfig(c => ({ ...c, min_healthy_nodes: parseInt(e.target.value) || 2 }))}
                        InputProps={{ inputProps: { min: 1, max: 10 } }}
                        helperText={t('updates.minHealthyNodesHelper')}
                      />
                      
                      <FormControlLabel
                        control={
                          <Switch
                            checked={config.shutdown_local_vms}
                            onChange={(e) => setConfig(c => ({ ...c, shutdown_local_vms: e.target.checked }))}
                          />
                        }
                        label={t('updates.shutdownLocalVms')}
                      />
                      
                      <FormControlLabel
                        control={
                          <Switch
                            checked={config.wait_ceph_healthy}
                            onChange={(e) => setConfig(c => ({ ...c, wait_ceph_healthy: e.target.checked }))}
                          />
                        }
                        label={t('updates.waitCephHealthy')}
                      />
                    </Stack>
                  </CardContent>
                </Card>
              </Collapse>
            </Box>
          </Stack>
        )}
        
        {/* Step 1: Preflight Results */}
        {activeStep === 1 && preflightResult && (
          <Stack spacing={3}>
            {/* Overall status */}
            <Alert 
              severity={preflightResult.can_proceed ? 'success' : 'error'}
              icon={preflightResult.can_proceed ? <CheckCircleIcon /> : <ErrorIcon />}
            >
              <Typography variant="body2" fontWeight={600}>
                {preflightResult.can_proceed
                  ? t('updates.allChecksOk')
                  : t('updates.checksBlockingIssues')}
              </Typography>
              {preflightResult.estimated_time_minutes > 0 && (
                <Typography variant="caption">
                  {t('updates.estimatedTime', { time: formatTime(preflightResult.estimated_time_minutes) })}
                </Typography>
              )}
            </Alert>
            
            {/* Errors */}
            {preflightResult.errors && preflightResult.errors.length > 0 && (
              <Card variant="outlined" sx={{ borderColor: 'error.main' }}>
                <CardContent>
                  <Typography variant="subtitle2" color="error" fontWeight={700} gutterBottom>
                    <ErrorIcon sx={{ fontSize: 18, mr: 1, verticalAlign: 'text-bottom' }} />
                    {t('updates.errorsCount', { count: preflightResult.errors.length })}
                  </Typography>
                  <List dense>
                    {preflightResult.errors.map((err, i) => (
                      <ListItem key={i}>
                        <ListItemText primary={err} />
                      </ListItem>
                    ))}
                  </List>
                </CardContent>
              </Card>
            )}
            
            {/* Warnings */}
            {preflightResult.warnings && preflightResult.warnings.length > 0 && (
              <Card variant="outlined" sx={{ borderColor: 'warning.main' }}>
                <CardContent>
                  <Typography variant="subtitle2" color="warning.main" fontWeight={700} gutterBottom>
                    <WarningIcon sx={{ fontSize: 18, mr: 1, verticalAlign: 'text-bottom' }} />
                    {t('updates.warningsCount', { count: preflightResult.warnings.length })}
                  </Typography>
                  <List dense>
                    {preflightResult.warnings.map((warn, i) => (
                      <ListItem key={i}>
                        <ListItemText primary={warn} />
                      </ListItem>
                    ))}
                  </List>
                </CardContent>
              </Card>
            )}
            
            {/* Cluster health */}
            {preflightResult.cluster_health && (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                    <i className="ri-heart-pulse-line" style={{ marginRight: 8 }} />
                    {t('updates.clusterHealth')}
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 1 }}>
                    <Chip 
                      size="small"
                      icon={preflightResult.cluster_health.quorum_ok ? <CheckCircleIcon /> : <ErrorIcon />}
                      label={preflightResult.cluster_health.quorum_ok ? t('updates.quorumOk') : t('updates.quorumLost')}
                      color={preflightResult.cluster_health.quorum_ok ? 'success' : 'error'}
                    />
                    <Chip 
                      size="small"
                      label={t('updates.nodesOnline', { online: preflightResult.cluster_health.online_nodes || 0, total: preflightResult.cluster_health.total_nodes || 0 })}
                      color={preflightResult.cluster_health.online_nodes === preflightResult.cluster_health.total_nodes ? 'success' : 'warning'}
                    />
                    {preflightResult.cluster_health.ceph_healthy !== undefined && (
                      <Chip 
                        size="small"
                        icon={preflightResult.cluster_health.ceph_healthy ? <CheckCircleIcon /> : <WarningIcon />}
                        label={preflightResult.cluster_health.ceph_healthy ? t('updates.cephOk') : t('updates.cephDegraded')}
                        color={preflightResult.cluster_health.ceph_healthy ? 'success' : 'warning'}
                      />
                    )}
                  </Box>
                </CardContent>
              </Card>
            )}
            
            {/* Updates summary */}
            {preflightResult.updates_available && preflightResult.updates_available.length > 0 && (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                    <i className="ri-download-cloud-line" style={{ marginRight: 8 }} />
                    {t('updates.availableUpdatesTitle')}
                  </Typography>
                  <Box sx={{ mt: 1 }}>
                    {preflightResult.updates_available.map((u) => (
                      <Box 
                        key={u.node}
                        sx={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'space-between',
                          py: 0.5,
                          borderBottom: '1px solid',
                          borderColor: 'divider',
                        }}
                      >
                        <Typography variant="body2">{u.node}</Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Chip
                            size="small"
                            label={t('updates.packagesCount', { count: u.package_count })}
                            sx={{ height: 20, fontSize: 11 }}
                          />
                          {u.kernel_update && (
                            <Tooltip title={t('updates.rebootRequiredTooltip')}>
                              <i className="ri-restart-line" style={{ fontSize: 16, color: '#ff9800' }} />
                            </Tooltip>
                          )}
                        </Box>
                      </Box>
                    ))}
                  </Box>
                </CardContent>
              </Card>
            )}
            
            {/* Migration plan */}
            {preflightResult.migration_plan && preflightResult.migration_plan.vms_to_migrate > 0 && (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                    <i className="ri-shuffle-line" style={{ marginRight: 8 }} />
                    {t('updates.migrationPlan')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('updates.vmsMigrated', { count: preflightResult.migration_plan.vms_to_migrate })}
                    {preflightResult.migration_plan.vms_to_shutdown > 0 &&
                      t('updates.vmsShutdown', { count: preflightResult.migration_plan.vms_to_shutdown })}
                  </Typography>
                </CardContent>
              </Card>
            )}
          </Stack>
        )}
        
        {/* Step 2: Execution */}
        {activeStep === 2 && rollingUpdate && (
          <Stack spacing={3}>
            {/* Progress */}
            <Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2">
                  {t('updates.progressNodes', { completed: rollingUpdate.completed_nodes, total: rollingUpdate.total_nodes })}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {rollingUpdate.current_node && t('updates.inProgressNode', { node: rollingUpdate.current_node })}
                </Typography>
              </Box>
              <LinearProgress 
                variant="determinate" 
                value={(rollingUpdate.completed_nodes / rollingUpdate.total_nodes) * 100}
                sx={{ height: 8, borderRadius: 1 }}
              />
            </Box>
            
            {/* Node statuses */}
            {rollingUpdate.node_statuses && rollingUpdate.node_statuses.length > 0 && (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                    {t('updates.nodeStatuses')}
                  </Typography>
                  <List dense>
                    {rollingUpdate.node_statuses.map((ns) => (
                    <ListItem key={ns.node_name}>
                      <ListItemIcon sx={{ minWidth: 40 }}>
                        {getNodeStatusIcon(ns.status)}
                      </ListItemIcon>
                      <ListItemText 
                        primary={ns.node_name}
                        secondary={
                          <>
                            {ns.status}
                            {ns.version_before && ns.version_after && 
                              ` • ${ns.version_before} → ${ns.version_after}`}
                            {ns.did_reboot && ` • ${t('updates.rebooted')}`}
                          </>
                        }
                      />
                      {ns.error && (
                        <Chip size="small" label={t('updates.errorChip')} color="error" />
                      )}
                    </ListItem>
                  ))}
                </List>
              </CardContent>
            </Card>
            )}
            
            {/* Logs */}
            {rollingUpdate.logs && rollingUpdate.logs.length > 0 && (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                    {t('updates.logs')}
                  </Typography>
                  <Box 
                    sx={{ 
                      maxHeight: 200, 
                      overflow: 'auto', 
                      bgcolor: 'background.default',
                      borderRadius: 1,
                      p: 1,
                      fontFamily: 'monospace',
                      fontSize: 11,
                    }}
                  >
                    {rollingUpdate.logs.slice(-50).map((log, i) => (
                      <Box 
                        key={i}
                        sx={{ 
                          color: log.level === 'error' ? 'error.main' : 
                                 log.level === 'warning' ? 'warning.main' : 
                                 'text.primary'
                        }}
                      >
                        [{new Date(log.timestamp).toLocaleTimeString()}]
                        {log.node && ` [${log.node}]`}
                        {' '}{log.message}
                      </Box>
                    ))}
                  </Box>
                </CardContent>
              </Card>
            )}
            
            {executionError && (
              <Alert severity="error">{executionError}</Alert>
            )}
          </Stack>
        )}
        
        {/* Step 3: Completed */}
        {activeStep === 3 && rollingUpdate && (
          <Stack spacing={3}>
            <Alert 
              severity={rollingUpdate.status === 'completed' ? 'success' : 'error'}
              icon={rollingUpdate.status === 'completed' ? <CheckCircleIcon /> : <ErrorIcon />}
            >
              <Typography variant="body2" fontWeight={600}>
                {rollingUpdate.status === 'completed'
                  ? t('updates.rollingUpdateCompletedSuccess', { completed: rollingUpdate.completed_nodes, total: rollingUpdate.total_nodes })
                  : rollingUpdate.status === 'cancelled'
                    ? t('updates.rollingUpdateCancelled')
                    : t('updates.rollingUpdateFailed', { error: rollingUpdate.error || t('updates.unknownErrorRolling') })
                }
              </Typography>
              {rollingUpdate.started_at && rollingUpdate.completed_at && (
                <Typography variant="caption">
                  {t('updates.durationMinutes', { minutes: Math.round((new Date(rollingUpdate.completed_at).getTime() - new Date(rollingUpdate.started_at).getTime()) / 60000) })}
                </Typography>
              )}
            </Alert>
            
            {/* Final node statuses */}
            {rollingUpdate.node_statuses && rollingUpdate.node_statuses.length > 0 && (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                    {t('updates.nodeSummary')}
                  </Typography>
                  <List dense>
                    {rollingUpdate.node_statuses.map((ns) => (
                      <ListItem key={ns.node_name}>
                        <ListItemIcon sx={{ minWidth: 40 }}>
                          {getNodeStatusIcon(ns.status)}
                        </ListItemIcon>
                        <ListItemText 
                          primary={ns.node_name}
                          secondary={
                            <>
                              {ns.version_before && ns.version_after && (
                                <>{ns.version_before} → {ns.version_after}</>
                              )}
                              {ns.did_reboot && ` • ${t('updates.rebooted')}`}
                              {ns.error && <Typography component="span" color="error"> • {ns.error}</Typography>}
                            </>
                          }
                        />
                      </ListItem>
                    ))}
                  </List>
                </CardContent>
              </Card>
            )}
          </Stack>
        )}
        
        {/* Loading state */}
        {preflightLoading && (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 4 }}>
            <CircularProgress size={48} />
            <Typography variant="body2" sx={{ mt: 2 }}>
              {t('updates.checkingInProgress')}
            </Typography>
          </Box>
        )}
        
        {/* Error state */}
        {preflightError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {preflightError}
          </Alert>
        )}
      </DialogContent>
      
      <DialogActions sx={{ px: 3, py: 2 }}>
        {activeStep === 0 && (
          <>
            <Button onClick={handleClose}>{t('common.cancel')}</Button>
            <Button
              variant="contained"
              onClick={runPreflightCheck}
              disabled={preflightLoading || nodeOrder.filter(n => !excludedNodes.includes(n)).length === 0}
              startIcon={preflightLoading ? <CircularProgress size={16} /> : <RefreshIcon />}
            >
              {t('updates.verify')}
            </Button>
          </>
        )}
        
        {activeStep === 1 && (
          <>
            <Button onClick={() => setActiveStep(0)}>{t('common.back')}</Button>
            <Button
              variant="contained"
              onClick={startRollingUpdate}
              disabled={!preflightResult?.can_proceed}
              startIcon={<PlayArrowIcon />}
              color="warning"
            >
              {t('updates.startRollingUpdateBtn')}
            </Button>
          </>
        )}
        
        {activeStep === 2 && rollingUpdate && (
          <>
            {rollingUpdate.status === 'running' && (
              <>
                <Button
                  onClick={() => executeAction('pause')}
                  startIcon={<PauseIcon />}
                >
                  {t('updates.pause')}
                </Button>
                <Button
                  onClick={() => executeAction('cancel')}
                  color="error"
                  startIcon={<StopIcon />}
                >
                  {t('common.cancel')}
                </Button>
              </>
            )}
            {rollingUpdate.status === 'paused' && (
              <>
                <Button
                  onClick={() => executeAction('resume')}
                  variant="contained"
                  startIcon={<PlayArrowIcon />}
                >
                  {t('updates.resume')}
                </Button>
                <Button
                  onClick={() => executeAction('cancel')}
                  color="error"
                  startIcon={<StopIcon />}
                >
                  {t('common.cancel')}
                </Button>
              </>
            )}
          </>
        )}
        
        {activeStep === 3 && (
          <Button onClick={handleClose} variant="contained">
            {t('common.close')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
