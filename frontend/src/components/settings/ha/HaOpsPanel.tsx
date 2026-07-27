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
import { useTranslations } from 'next-intl'

import type { PatroniMember } from './useHaCluster'

interface HaOpsPanelProps {
  members: PatroniMember[]
  paused: boolean
  syncMode: string
  maintenanceNodes: Set<string>
  onRefresh: () => void
}

export default function HaOpsPanel({ members, syncMode, maintenanceNodes, onRefresh }: HaOpsPanelProps) {
  const t = useTranslations('ha')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ type: 'success' | 'error', message: string } | null>(null)

  const [switchoverTarget, setSwitchoverTarget] = useState('')
  const [switchoverOpen, setSwitchoverOpen] = useState(false)

  const leader = members.find(m => m.role === 'leader')
  const isStrictSync = syncMode === 'synchronous_mode_strict'
  const switchoverCandidates = isStrictSync
    ? members.filter(m => m.role === 'sync_standby' && !maintenanceNodes.has(m.name))
    : members.filter(m => m.role !== 'leader' && !maintenanceNodes.has(m.name))

  const doAction = useCallback(async (url: string, method: string, body?: any) => {
    setLoading(true)
    setResult(null)
    try {
      const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } }
      if (body) opts.body = JSON.stringify(body)
      const res = await fetch(url, opts)
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setResult({ type: 'success', message: data.message || t('ops.operationCompleted') })
        onRefresh()
        setSwitchoverTarget('')
      } else {
        setResult({ type: 'error', message: data.error || t('common.operationFailed', { status: res.status }) })
      }
    } catch (e: any) {
      setResult({ type: 'error', message: e.message || t('common.requestFailed') })
    } finally {
      setLoading(false)
    }
  }, [onRefresh, t])

  return (
    <Box>
      {result && (
        <Alert severity={result.type} sx={{ mb: 2 }} onClose={() => setResult(null)}>
          {result.message}
        </Alert>
      )}

      <Card variant="outlined" sx={{ maxWidth: 360 }}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('ops.switchoverTitle')}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            {t('ops.switchoverDesc')}
          </Typography>
          <FormControl size="small" fullWidth sx={{ mb: 1 }}>
            <InputLabel>{t('ops.target')}</InputLabel>
            <Select value={switchoverTarget} onChange={(e) => setSwitchoverTarget(e.target.value)} label={t('ops.target')}>
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
            {t('node.switchover')}
          </Button>
        </CardContent>
      </Card>

      <Dialog open={switchoverOpen} onClose={() => setSwitchoverOpen(false)}>
        <DialogTitle>{t('node.confirmSwitchoverTitle')}</DialogTitle>
        <DialogContent>
          <Typography>
            {t('node.confirmSwitchoverBody', { node: switchoverTarget })}
            {leader && <> {t('node.confirmSwitchoverLeaderNote', { leader: leader.name })}</>}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSwitchoverOpen(false)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            onClick={() => {
              setSwitchoverOpen(false)
              doAction('/api/v1/ha/switchover', 'POST', { candidate: switchoverTarget })
            }}
          >
            {t('node.switchover')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
