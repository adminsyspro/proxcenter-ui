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

import type { PatroniMember } from './useHaCluster'

const ROLE_COLORS: Record<string, 'success' | 'info' | 'default' | 'error'> = {
  leader: 'success',
  sync_standby: 'info',
  replica: 'default',
  standby_leader: 'info',
}

function roleLabel(role: string): string {
  switch (role) {
    case 'leader': return 'DB Primary'
    case 'sync_standby': return 'DB Sync Standby'
    case 'replica': return 'DB Replica'
    case 'standby_leader': return 'DB Standby Leader'
    default: return role
  }
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
  const roleColor = ROLE_COLORS[member.role] || 'error'
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
        setResult({ type: 'success', message: data.message || 'Switchover completed' })
        onSwitchover?.()
      } else {
        setResult({ type: 'error', message: data.error || `Switchover failed (${res.status})` })
      }
    } catch (e: any) {
      setResult({ type: 'error', message: e.message || 'Request failed' })
    } finally {
      setLoading(false)
    }
  }, [member.name, onSwitchover])

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
        setResult({ type: 'success', message: data.message || (maintenance ? 'Exited maintenance' : 'Entered maintenance') })
        onRefresh?.()
      } else {
        setResult({ type: 'error', message: data.error || `Operation failed (${res.status})` })
      }
    } catch (e: any) {
      setResult({ type: 'error', message: e.message || 'Request failed' })
    } finally {
      setLoading(false)
    }
  }, [member.name, maintenance, onRefresh])

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
              <Tooltip title="Promote to leader">
                <IconButton
                  size="small"
                  color="primary"
                  disabled={loading}
                  onClick={() => setConfirmOpen('switchover')}
                >
                  <i className="ri-swap-line" style={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title={maintenance ? 'Exit maintenance' : maintenanceLocked ? 'Another node is already in maintenance' : 'Enter maintenance'}>
              <span>
                <IconButton
                  size="small"
                  color={maintenance ? 'warning' : 'default'}
                  disabled={loading || (!maintenance && maintenanceLocked)}
                  onClick={() => setConfirmOpen('maintenance')}
                >
                  <i className={maintenance ? 'ri-tools-fill' : 'ri-tools-line'} style={{ fontSize: 18 }} />
                </IconButton>
              </span>
            </Tooltip>
            {vipAddress && <Chip label={`VIP ${vipAddress}`} size="small" color="primary" />}
            {maintenance && <Chip label="Maintenance" size="small" color="warning" />}
          </Box>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {member.host}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Chip label={roleLabel(member.role)} size="small" color={roleColor} />
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
        <DialogTitle>Confirm Switchover</DialogTitle>
        <DialogContent>
          <Typography>
            Promote <strong>{member.name}</strong> to leader?
            {leaderName && <> The current leader (<strong>{leaderName}</strong>) will become a replica.</>}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleSwitchover}>
            Switchover
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmOpen === 'maintenance'} onClose={() => setConfirmOpen(null)}>
        <DialogTitle>{maintenance ? 'Exit Maintenance' : 'Enter Maintenance'}</DialogTitle>
        <DialogContent>
          {maintenance ? (
            <Typography>
              Restart application services on <strong>{member.name}</strong> and return it to the cluster?
            </Typography>
          ) : (
            <Typography>
              Put <strong>{member.name}</strong> into maintenance mode?
              This will stop application services (frontend, orchestrator, weasyprint).
              {member.role === 'leader' && ' The leader role will be switched to another node first.'}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(null)}>Cancel</Button>
          <Button variant="contained" color={maintenance ? 'primary' : 'warning'} onClick={handleMaintenance}>
            {maintenance ? 'Exit Maintenance' : 'Enter Maintenance'}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  )
}
