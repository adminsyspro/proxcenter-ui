'use client'

import { useState, useCallback } from 'react'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material'
import { useTranslations } from 'next-intl'

import type { PatroniMember } from './useHaCluster'
import { tooltipSlotProps } from './tooltipSlotProps'

const ROLE_COLORS: Record<string, 'success' | 'info' | 'default' | 'error'> = {
  leader: 'success',
  sync_standby: 'info',
  replica: 'default',
  standby_leader: 'info',
}

const ROLE_KEYS: Record<string, string> = {
  leader: 'node.rolePrimary',
  sync_standby: 'node.roleSyncStandby',
  replica: 'node.roleReplica',
  standby_leader: 'node.roleStandbyLeader',
}

interface HaNodeCardProps {
  member: PatroniMember
  vipAddress?: string
  maintenance: boolean
  maintenanceLocked?: boolean
  leaderName?: string
  onSwitchover?: () => void
  onRefresh?: () => void
}

export default function HaNodeCard({ member, vipAddress, maintenance, maintenanceLocked, leaderName, onSwitchover, onRefresh }: HaNodeCardProps) {
  const t = useTranslations('ha')
  const roleColor = ROLE_COLORS[member.role] || 'error'
  const roleLabel = ROLE_KEYS[member.role] ? t(ROLE_KEYS[member.role]) : member.role
  const [confirmOpen, setConfirmOpen] = useState<'switchover' | 'maintenance' | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ type: 'success' | 'error', message: string } | null>(null)

  const handleSwitchover = useCallback(async () => {
    setConfirmOpen(null)
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch('/api/v1/ha/switchover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate: member.name }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setResult({ type: 'success', message: data.message || t('node.switchoverCompleted') })
        onSwitchover?.()
      } else {
        setResult({ type: 'error', message: data.error || t('node.switchoverFailed', { status: res.status }) })
      }
    } catch (e: any) {
      setResult({ type: 'error', message: e.message || t('common.requestFailed') })
    } finally {
      setLoading(false)
    }
  }, [member.name, onSwitchover, t])

  const handleMaintenance = useCallback(async () => {
    setConfirmOpen(null)
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch(`/api/v1/ha/maintenance/${encodeURIComponent(member.name)}`, {
        method: maintenance ? 'DELETE' : 'POST',
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setResult({ type: 'success', message: data.message || (maintenance ? t('node.maintenanceExited') : t('node.maintenanceEntered')) })
        onRefresh?.()
      } else {
        setResult({ type: 'error', message: data.error || t('common.operationFailed', { status: res.status }) })
      }
    } catch (e: any) {
      setResult({ type: 'error', message: e.message || t('common.requestFailed') })
    } finally {
      setLoading(false)
    }
  }, [member.name, maintenance, onRefresh, t])

  return (
    <Card variant="outlined" sx={{
      flex: 1,
      minWidth: 0,
      ...(maintenance && {
        bgcolor: 'rgba(237, 108, 2, 0.08)',
        borderColor: 'warning.main',
      }),
    }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {member.name}
            </Typography>
            {member.version && (
              <Typography variant="caption" color="text.secondary">
                (v{member.version})
              </Typography>
            )}
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
            {onSwitchover && (
              <Tooltip title={t('node.promoteTooltip')} arrow slotProps={tooltipSlotProps}>
                <span>
                  <IconButton
                    aria-label={t('node.promoteTooltip')}
                    size="small"
                    color="primary"
                    disabled={loading}
                    onClick={() => setConfirmOpen('switchover')}
                  >
                    <i className="ri-swap-line" style={{ fontSize: 18 }} />
                  </IconButton>
                </span>
              </Tooltip>
            )}
            <Tooltip
              title={maintenance ? t('node.maintenanceExitTooltip') : maintenanceLocked ? t('node.maintenanceLockedTooltip') : t('node.maintenanceEnterTooltip')}
              arrow
              slotProps={tooltipSlotProps}
            >
              <span>
                <IconButton
                  aria-label={maintenance ? t('node.maintenanceExitTooltip') : maintenanceLocked ? t('node.maintenanceLockedTooltip') : t('node.maintenanceEnterTooltip')}
                  size="small"
                  color={maintenance ? 'warning' : 'default'}
                  disabled={loading || (!maintenance && maintenanceLocked)}
                  onClick={() => setConfirmOpen('maintenance')}
                >
                  <i className={maintenance ? 'ri-tools-fill' : 'ri-tools-line'} style={{ fontSize: 18 }} />
                </IconButton>
              </span>
            </Tooltip>
            {vipAddress && <Chip label={t('node.vipChip', { address: vipAddress })} size="small" color="primary" />}
            {maintenance && <Chip label={t('node.maintenanceChip')} size="small" color="warning" />}
          </Box>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {member.host}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Chip label={roleLabel} size="small" color={roleColor} />
          <Chip
            label={member.state}
            size="small"
            variant="outlined"
            color={member.state === 'running' || member.state === 'streaming' ? 'success' : 'error'}
          />
        </Box>
        {result && (
          <Alert severity={result.type} sx={{ mt: 1 }} onClose={() => setResult(null)}>
            {result.message}
          </Alert>
        )}
      </CardContent>

      <Dialog open={confirmOpen === 'switchover'} onClose={() => setConfirmOpen(null)}>
        <DialogTitle>{t('node.confirmSwitchoverTitle')}</DialogTitle>
        <DialogContent>
          <Typography>
            {t('node.confirmSwitchoverBody', { node: member.name })}
            {leaderName && <> {t('node.confirmSwitchoverLeaderNote', { leader: leaderName })}</>}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(null)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleSwitchover}>
            {t('node.switchover')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmOpen === 'maintenance'} onClose={() => setConfirmOpen(null)}>
        <DialogTitle>{maintenance ? t('node.maintenanceExitTitle') : t('node.maintenanceEnterTitle')}</DialogTitle>
        <DialogContent>
          {maintenance ? (
            <Typography>
              {t('node.maintenanceExitBody', { node: member.name })}
            </Typography>
          ) : (
            <Typography>
              {t('node.maintenanceEnterBody', { node: member.name })}
              {member.role === 'leader' && <> {t('node.maintenanceLeaderNote')}</>}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(null)}>{t('common.cancel')}</Button>
          <Button variant="contained" color={maintenance ? 'primary' : 'warning'} onClick={handleMaintenance}>
            {maintenance ? t('node.maintenanceExitTitle') : t('node.maintenanceEnterTitle')}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  )
}
