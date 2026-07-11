'use client'

import { useState, useCallback } from 'react'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Typography,
} from '@mui/material'

import type { PatroniMember } from './useHaCluster'

interface HaOpsPanelProps {
  members: PatroniMember[]
  paused: boolean
  syncMode: string
  maintenanceNodes: Set<string>
  onRefresh: () => void
}

export default function HaOpsPanel({ members, paused, syncMode, maintenanceNodes, onRefresh }: HaOpsPanelProps) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ type: 'success' | 'error', message: string } | null>(null)

  const [switchoverTarget, setSwitchoverTarget] = useState('')
  const [switchoverOpen, setSwitchoverOpen] = useState(false)

  const [reinitTarget, setReinitTarget] = useState('')
  const [reinitOpen, setReinitOpen] = useState(false)

  const [maintenanceTarget, setMaintenanceTarget] = useState('')
  const [maintenanceOpen, setMaintenanceOpen] = useState(false)

  const [pauseOpen, setPauseOpen] = useState(false)

  const leader = members.find(m => m.role === 'leader')
  const isStrictSync = syncMode === 'synchronous_mode_strict'
  const switchoverCandidates = isStrictSync
    ? members.filter(m => m.role === 'sync_standby' && !maintenanceNodes.has(m.name))
    : members.filter(m => m.role !== 'leader' && !maintenanceNodes.has(m.name))

  const reinitCandidates = members.filter(m => m.role !== 'leader')

  const nonMaintenanceCount = members.filter(m => !maintenanceNodes.has(m.name)).length

  const maintenanceAction = maintenanceTarget && maintenanceNodes.has(maintenanceTarget) ? 'exit' : 'enter'

  const doAction = useCallback(async (url: string, method: string, body?: any) => {
    setLoading(true)
    setResult(null)
    try {
      const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } }
      if (body) opts.body = JSON.stringify(body)
      const res = await fetch(url, opts)
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setResult({ type: 'success', message: data.message || 'Operation completed' })
        onRefresh()
        setSwitchoverTarget('')
        setReinitTarget('')
        setMaintenanceTarget('')
      } else {
        setResult({ type: 'error', message: data.error || `Operation failed (${res.status})` })
      }
    } catch (e: any) {
      setResult({ type: 'error', message: e.message || 'Request failed' })
    } finally {
      setLoading(false)
    }
  }, [onRefresh])

  return (
    <Box>
      {result && (
        <Alert severity={result.type} sx={{ mb: 2 }} onClose={() => setResult(null)}>
          {result.message}
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        {/* Switchover */}
        <Card variant="outlined" sx={{ flex: '1 1 220px' }}>
          <CardContent>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Switchover</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              Promote a standby to leader
            </Typography>
            <FormControl size="small" fullWidth sx={{ mb: 1 }}>
              <InputLabel>Target</InputLabel>
              <Select value={switchoverTarget} onChange={(e) => setSwitchoverTarget(e.target.value)} label="Target">
                {switchoverCandidates.map(m => (
                  <MenuItem key={m.name} value={m.name}>{m.name} ({m.role})</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button
              variant="outlined"
              size="small"
              disabled={!switchoverTarget || loading}
              onClick={() => setSwitchoverOpen(true)}
            >
              Switchover
            </Button>
          </CardContent>
        </Card>

        {/* Reinitialize */}
        <Card variant="outlined" sx={{ flex: '1 1 220px' }}>
          <CardContent>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Reinitialize Replica</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              Wipe and re-stream a failed replica
            </Typography>
            <FormControl size="small" fullWidth sx={{ mb: 1 }}>
              <InputLabel>Target</InputLabel>
              <Select value={reinitTarget} onChange={(e) => setReinitTarget(e.target.value)} label="Target">
                {reinitCandidates.map(m => (
                  <MenuItem key={m.name} value={m.name}>{m.name} ({m.state})</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button
              variant="outlined"
              color="warning"
              size="small"
              disabled={!reinitTarget || loading}
              onClick={() => setReinitOpen(true)}
            >
              Reinitialize
            </Button>
          </CardContent>
        </Card>

        {/* Pause/Resume */}
        <Card variant="outlined" sx={{ flex: '1 1 220px' }}>
          <CardContent>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {paused ? 'Resume Failover' : 'Pause Failover'}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              {paused ? 'Re-enable automatic failover' : 'Disable automatic failover'}
            </Typography>
            {paused && (
              <Alert severity="warning" sx={{ mb: 1, py: 0, '& .MuiAlert-message': { py: 0.5 } }}>
                Automatic failover is disabled
              </Alert>
            )}
            <Button
              variant="outlined"
              color={paused ? 'success' : 'warning'}
              size="small"
              disabled={loading}
              onClick={() => setPauseOpen(true)}
            >
              {paused ? 'Resume' : 'Pause'}
            </Button>
          </CardContent>
        </Card>

        {/* Maintenance */}
        <Card variant="outlined" sx={{ flex: '1 1 220px' }}>
          <CardContent>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Maintenance Mode</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              Stop app traffic on a node while keeping replication
            </Typography>
            <FormControl size="small" fullWidth sx={{ mb: 1 }}>
              <InputLabel>Node</InputLabel>
              <Select
                value={maintenanceTarget}
                onChange={(e) => setMaintenanceTarget(e.target.value)}
                label="Node"
              >
                {members.map(m => (
                  <MenuItem key={m.name} value={m.name}>
                    {m.name} {maintenanceNodes.has(m.name) ? '(in maintenance)' : ''}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button
              variant="outlined"
              color={maintenanceAction === 'enter' ? 'warning' : 'success'}
              size="small"
              disabled={
                !maintenanceTarget || loading ||
                (maintenanceAction === 'enter' && nonMaintenanceCount <= 1)
              }
              onClick={() => setMaintenanceOpen(true)}
            >
              {maintenanceAction === 'enter' ? 'Enter Maintenance' : 'Exit Maintenance'}
            </Button>
            {maintenanceAction === 'enter' && nonMaintenanceCount <= 1 && (
              <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
                Cannot enter maintenance: only 1 active node remaining
              </Typography>
            )}
          </CardContent>
        </Card>
      </Box>

      {/* Confirmation Dialogs */}
      <Dialog open={switchoverOpen} onClose={() => setSwitchoverOpen(false)}>
        <DialogTitle>Confirm Switchover</DialogTitle>
        <DialogContent>
          <Typography>
            Promote <strong>{switchoverTarget}</strong> to leader? The current leader ({leader?.name}) will become a replica.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSwitchoverOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              setSwitchoverOpen(false)
              doAction('/api/v1/ha/switchover', 'POST', { candidate: switchoverTarget })
            }}
          >
            Switchover
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={reinitOpen} onClose={() => setReinitOpen(false)}>
        <DialogTitle>Confirm Reinitialize</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 1 }}>
            This will wipe all data on {reinitTarget} and re-stream from the leader.
          </Alert>
          <Typography>Are you sure you want to reinitialize {reinitTarget}?</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReinitOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="warning"
            onClick={() => {
              setReinitOpen(false)
              doAction(`/api/v1/ha/reinit/${reinitTarget}`, 'POST')
            }}
          >
            Reinitialize
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={pauseOpen} onClose={() => setPauseOpen(false)}>
        <DialogTitle>{paused ? 'Resume Automatic Failover' : 'Pause Automatic Failover'}</DialogTitle>
        <DialogContent>
          <Typography>
            {paused
              ? 'Re-enable automatic failover? Patroni will resume automatic leader election on failure.'
              : 'Disable automatic failover? If the leader fails, Patroni will NOT automatically promote a standby.'}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPauseOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color={paused ? 'success' : 'warning'}
            onClick={() => {
              setPauseOpen(false)
              doAction(paused ? '/api/v1/ha/resume' : '/api/v1/ha/pause', 'POST')
            }}
          >
            {paused ? 'Resume' : 'Pause'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={maintenanceOpen} onClose={() => setMaintenanceOpen(false)}>
        <DialogTitle>
          {maintenanceAction === 'enter' ? 'Enter Maintenance Mode' : 'Exit Maintenance Mode'}
        </DialogTitle>
        <DialogContent>
          {maintenanceAction === 'enter' ? (
            <>
              <Typography sx={{ mb: 1 }}>
                This will stop frontend and orchestrator on <strong>{maintenanceTarget}</strong>.
                The VIP will not land on this node. Patroni keeps replicating.
              </Typography>
              {leader?.name === maintenanceTarget && (
                <Alert severity="warning">
                  This node is the current leader. A switchover will be triggered first.
                </Alert>
              )}
            </>
          ) : (
            <Typography>
              Restart services and exit maintenance on <strong>{maintenanceTarget}</strong>?
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMaintenanceOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color={maintenanceAction === 'enter' ? 'warning' : 'success'}
            onClick={() => {
              setMaintenanceOpen(false)
              doAction(
                `/api/v1/ha/maintenance/${maintenanceTarget}`,
                maintenanceAction === 'enter' ? 'POST' : 'DELETE'
              )
            }}
          >
            {maintenanceAction === 'enter' ? 'Enter Maintenance' : 'Exit Maintenance'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
