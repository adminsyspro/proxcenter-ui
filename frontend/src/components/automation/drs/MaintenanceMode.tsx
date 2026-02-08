'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Chip,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Alert,
  LinearProgress,
  Tooltip,
  alpha,
  useTheme,
  CircularProgress,
} from '@mui/material'
import BuildIcon from '@mui/icons-material/Build'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import DnsIcon from '@mui/icons-material/Dns'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import ErrorIcon from '@mui/icons-material/Error'

// ============================================
// Types
// ============================================

export interface NodeMaintenanceInfo {
  name: string
  connectionId: string
  status: 'online' | 'offline'
  inMaintenance: boolean
  vmCount: number
  ctCount: number
  evacuationProgress?: number
  evacuationStatus?: 'idle' | 'pending' | 'in_progress' | 'completed' | 'failed'
}

interface MaintenanceModeProps {
  nodes: NodeMaintenanceInfo[]
  onEnterMaintenance: (nodeName: string, connectionId: string) => Promise<void>
  onExitMaintenance: (nodeName: string, connectionId: string) => Promise<void>
  onEvacuate: (nodeName: string, connectionId: string) => Promise<void>
  loading?: boolean
}

// ============================================
// Component
// ============================================

export default function MaintenanceMode({
  nodes,
  onEnterMaintenance,
  onExitMaintenance,
  onEvacuate,
  loading = false,
}: MaintenanceModeProps) {
  const theme = useTheme()
  const t = useTranslations()
  const [selectedNode, setSelectedNode] = useState<NodeMaintenanceInfo | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const maintenanceNodes = nodes.filter(n => n.inMaintenance)
  const activeNodes = nodes.filter(n => !n.inMaintenance && n.status === 'online')

  const handleEnterMaintenance = async (node: NodeMaintenanceInfo) => {
    setActionLoading(node.name)

    try {
      await onEnterMaintenance(node.name, node.connectionId)
    } finally {
      setActionLoading(null)
      setDialogOpen(false)
    }
  }

  const handleExitMaintenance = async (node: NodeMaintenanceInfo) => {
    setActionLoading(node.name)

    try {
      await onExitMaintenance(node.name, node.connectionId)
    } finally {
      setActionLoading(null)
    }
  }

  const handleEvacuate = async (node: NodeMaintenanceInfo) => {
    setActionLoading(node.name)

    try {
      await onEvacuate(node.name, node.connectionId)
    } finally {
      setActionLoading(null)
    }
  }

  const openDialog = (node: NodeMaintenanceInfo) => {
    setSelectedNode(node)
    setDialogOpen(true)
  }

  if (loading) {
    return (
      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <BuildIcon color="primary" />
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                {t('drsPage.maintenanceMode')}
              </Typography>
            </Box>
            {maintenanceNodes.length > 0 && (
              <Chip
                label={t('drs.maintenanceNodes')}
                color="warning"
                size="small"
              />
            )}
          </Box>

          {maintenanceNodes.length === 0 ? (
            <Alert severity="success" icon={<CheckCircleIcon />} sx={{ mb: 2 }}>
              {t('drsPage.noNodeInMaintenance')}
            </Alert>
          ) : (
            <Stack spacing={1} sx={{ mb: 3 }}>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                {t('drsPage.inMaintenance')}
              </Typography>
              {maintenanceNodes.map(node => (
                <Box
                  key={`${node.connectionId}-${node.name}`}
                  sx={{
                    p: 2,
                    borderRadius: 1,
                    bgcolor: alpha(theme.palette.warning.main, 0.08),
                    border: `1px solid ${alpha(theme.palette.warning.main, 0.3)}`,
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <DnsIcon sx={{ color: 'warning.main' }} />
                      <Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                          {node.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {node.vmCount} VMs, {node.ctCount} CTs
                        </Typography>
                      </Box>
                    </Box>
                    <Stack direction="row" spacing={1}>
                      {(node.vmCount + node.ctCount) > 0 && node.evacuationStatus !== 'in_progress' && (
                        <Tooltip title={t('drsPage.evacuateAllGuests')}>
                          <Button
                            size="small"
                            variant="outlined"
                            color="warning"
                            startIcon={actionLoading === node.name ? <CircularProgress size={16} /> : <SwapHorizIcon />}
                            onClick={() => handleEvacuate(node)}
                            disabled={actionLoading === node.name}
                          >
                            {t('drsPage.evacuate')}
                          </Button>
                        </Tooltip>
                      )}
                      <Tooltip title={
                        (node.vmCount + node.ctCount) > 0
                          ? t('drsPage.evacuateFirst')
                          : t('drsPage.exitMaintenanceMode')
                      }>
                        <span>
                          <Button
                            size="small"
                            variant="contained"
                            color="success"
                            startIcon={actionLoading === node.name ? <CircularProgress size={16} color="inherit" /> : <PlayArrowIcon />}
                            onClick={() => handleExitMaintenance(node)}
                            disabled={actionLoading === node.name || (node.vmCount + node.ctCount) > 0}
                          >
                            {t('drsPage.exit')}
                          </Button>
                        </span>
                      </Tooltip>
                    </Stack>
                  </Box>

                  {node.evacuationStatus === 'in_progress' && node.evacuationProgress !== undefined && (
                    <Box sx={{ mt: 1.5 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                        <Typography variant="caption" color="text.secondary">
                          {t('drsPage.evacuationInProgress')}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {node.evacuationProgress}%
                        </Typography>
                      </Box>
                      <LinearProgress
                        variant="determinate"
                        value={node.evacuationProgress}
                        sx={{ borderRadius: 1 }}
                      />
                    </Box>
                  )}

                  {node.evacuationStatus === 'failed' && (
                    <Alert severity="error" sx={{ mt: 1 }} icon={<ErrorIcon />}>
                      {t('drsPage.evacuationFailed')}
                    </Alert>
                  )}
                </Box>
              ))}
            </Stack>
          )}

          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
            {t('drs.activeNodes', { count: activeNodes.length })}
          </Typography>
          
          {activeNodes.length === 0 ? (
            <Alert severity="warning">
              {t('drsPage.noActiveNode')}
            </Alert>
          ) : (
            <List dense disablePadding>
              {activeNodes.map(node => (
                <ListItem
                  key={`${node.connectionId}-${node.name}`}
                  sx={{
                    borderRadius: 1,
                    mb: 0.5,
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 40 }}>
                    <DnsIcon color="success" fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {node.name}
                      </Typography>
                    }
                    secondary={`${node.vmCount} VMs, ${node.ctCount} CTs`}
                  />
                  <ListItemSecondaryAction>
                    <Tooltip title={t('drsPage.enterMaintenance')}>
                      <IconButton
                        edge="end"
                        onClick={() => openDialog(node)}
                        disabled={actionLoading === node.name}
                        size="small"
                      >
                        {actionLoading === node.name ? (
                          <CircularProgress size={20} />
                        ) : (
                          <BuildIcon fontSize="small" />
                        )}
                      </IconButton>
                    </Tooltip>
                  </ListItemSecondaryAction>
                </ListItem>
              ))}
            </List>
          )}
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <WarningAmberIcon color="warning" />
            {t('drsPage.enterMaintenance')}
          </Box>
        </DialogTitle>
        <DialogContent>
          {selectedNode && (
            <>
              <Typography
                variant="body1"
                sx={{ mb: 2 }}
                dangerouslySetInnerHTML={{
                  __html: t('drsPage.confirmEnterMaintenance', { nodeName: selectedNode.name })
                }}
              />

              {(selectedNode.vmCount + selectedNode.ctCount) > 0 && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  <span dangerouslySetInnerHTML={{
                    __html: t('drsPage.nodeHostsGuests', {
                      vmCount: selectedNode.vmCount,
                      ctCount: selectedNode.ctCount
                    })
                  }} />
                </Alert>
              )}

              <Typography variant="body2" color="text.secondary">
                {t('drsPage.actionsPerformed')}
              </Typography>
              <Box component="ul" sx={{ mt: 1, pl: 2, '& li': { mb: 0.5 } }}>
                <li>{t('drsPage.actionNodeMarked')}</li>
                <li>{t('drsPage.actionNoNewGuest')}</li>
                <li>{t('drsPage.actionGuestsEvacuated')}</li>
                <li>{t('drsPage.actionAffinityRespected')}</li>
              </Box>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            color="warning"
            onClick={() => selectedNode && handleEnterMaintenance(selectedNode)}
            disabled={actionLoading !== null}
          >
            {actionLoading ? t('common.loading') : t('common.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
