'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  Typography,
} from '@mui/material'

import NumericTextField from '@/components/ui/NumericTextField'
import { useRBAC } from '@/contexts/RBACContext'
import { useToast } from '@/contexts/ToastContext'

/**
 * Auto-HA card of the cluster HA tab: the per-connection defaults applied to
 * new guests, and a sync that applies them now. The settings cover the whole
 * connection, so the routes require node.manage on it: below that (a single
 * node, say) the card is read-only, and a refusal keeps what is stored on
 * screen and says why.
 */
export default function AutoHaCard({ connId, pveMajorVersion, haGroups }: {
  connId: string
  pveMajorVersion: number
  haGroups: any[]
}) {
  const t = useTranslations()
  const toast = useToast()
  const { hasPermissionOn } = useRBAC()
  const canManageAutoHa = !!connId && hasPermissionOn('node.manage', 'connection', connId)

  const [autoHaSettings, setAutoHaSettings] = useState<any>(null)
  const [autoHaSaving, setAutoHaSaving] = useState(false)
  const [autoHaSyncing, setAutoHaSyncing] = useState(false)
  const [autoHaSyncResult, setAutoHaSyncResult] = useState<any>(null)

  useEffect(() => {
    if (!connId) return
    let cancelled = false
    fetch(`/api/v1/connections/${encodeURIComponent(connId)}/ha/auto-ha`)
      .then(res => res.json())
      .then(json => { if (!cancelled) setAutoHaSettings(json.data) })
      .catch(() => { /* ignore */ })
    return () => { cancelled = true }
  }, [connId])

  const saveAutoHaSettings = useCallback(async (data: any) => {
    if (!connId) return
    setAutoHaSaving(true)
    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/ha/auto-ha`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const json = await res.json()
      if (res.ok) setAutoHaSettings(json.data)
      else toast.error(json.error || t('errors.updateError'))
    } catch { /* ignore */ }
    setAutoHaSaving(false)
  }, [connId, toast, t])

  const syncAutoHa = useCallback(async () => {
    if (!connId) return
    setAutoHaSyncing(true)
    setAutoHaSyncResult(null)
    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/ha/auto-ha/sync`, { method: 'POST' })
      const json = await res.json()
      setAutoHaSyncResult(res.ok ? json.data : { error: json.error || t('errors.updateError') })
    } catch (e: any) {
      setAutoHaSyncResult({ error: e?.message })
    }
    setAutoHaSyncing(false)
  }, [connId, t])

  if (!autoHaSettings) return null

  return (
    <Card variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: autoHaSettings.enabled ? 2 : 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <i className="ri-shield-star-line" style={{ fontSize: 20, opacity: 0.7 }} />
            <Typography variant="subtitle2" fontWeight={700}>Auto-HA</Typography>
            <Typography variant="caption" sx={{ opacity: 0.5 }}>
              {autoHaSettings.enabled ? t('cluster.autoHaEnabled') : t('cluster.autoHaDisabled')}
            </Typography>
          </Box>
          <Switch
            checked={autoHaSettings.enabled}
            onChange={(e) => saveAutoHaSettings({ ...autoHaSettings, enabled: e.target.checked })}
            disabled={autoHaSaving || !canManageAutoHa}
          />
        </Box>

        {autoHaSettings.enabled && (
          <Stack spacing={2}>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
              <FormControl size="small" sx={{ flex: 1 }}>
                <InputLabel>{t('cluster.autoHaDefaultState')}</InputLabel>
                <Select
                  value={autoHaSettings.state || 'started'}
                  label={t('cluster.autoHaDefaultState')}
                  onChange={(e) => setAutoHaSettings((prev: any) => ({ ...prev, state: e.target.value }))}
                  disabled={!canManageAutoHa}
                >
                  <MenuItem value="started">Started</MenuItem>
                  <MenuItem value="stopped">Stopped</MenuItem>
                  <MenuItem value="enabled">Enabled</MenuItem>
                  <MenuItem value="disabled">Disabled</MenuItem>
                </Select>
              </FormControl>

              {pveMajorVersion < 9 && haGroups.length > 0 && (
                <FormControl size="small" sx={{ flex: 1 }}>
                  <InputLabel>{t('common.group')}</InputLabel>
                  <Select
                    value={autoHaSettings.group || ''}
                    label={t('common.group')}
                    onChange={(e) => setAutoHaSettings((prev: any) => ({ ...prev, group: e.target.value }))}
                    disabled={!canManageAutoHa}
                  >
                    <MenuItem value=""><em>{t('common.none')}</em></MenuItem>
                    {haGroups.map((g: any) => (
                      <MenuItem key={g.group} value={g.group}>{g.group}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}

              <NumericTextField
                size="small"
                type="number"
                label="Max Restart"
                value={autoHaSettings.max_restart ?? 1}
                onChange={(n) => setAutoHaSettings((prev: any) => ({ ...prev, max_restart: n }))}
                disabled={!canManageAutoHa}
                fallback={0}
                inputProps={{ min: 0, max: 10 }}
                sx={{ flex: 1 }}
              />
              <NumericTextField
                size="small"
                type="number"
                label="Max Relocate"
                value={autoHaSettings.max_relocate ?? 1}
                onChange={(n) => setAutoHaSettings((prev: any) => ({ ...prev, max_relocate: n }))}
                disabled={!canManageAutoHa}
                fallback={0}
                inputProps={{ min: 0, max: 10 }}
                sx={{ flex: 1 }}
              />
              <Button
                size="small"
                variant="outlined"
                onClick={() => saveAutoHaSettings(autoHaSettings)}
                disabled={autoHaSaving || !canManageAutoHa}
                startIcon={autoHaSaving ? <CircularProgress size={14} /> : <i className="ri-save-line" />}
              >
                {t('common.save')}
              </Button>
              <Button
                size="small"
                variant="contained"
                onClick={syncAutoHa}
                disabled={autoHaSyncing || !canManageAutoHa}
                startIcon={autoHaSyncing ? <CircularProgress size={14} /> : <i className="ri-refresh-line" />}
              >
                {t('cluster.autoHaSyncNow')}
              </Button>
            </Box>
            {autoHaSyncResult && !autoHaSyncResult.error && (
              <Alert severity="success" sx={{ py: 0.5 }}>
                {t('cluster.autoHaSyncSuccess', { added: autoHaSyncResult.added, skipped: autoHaSyncResult.skipped })}
                {autoHaSyncResult.errors?.length > 0 && ` (${autoHaSyncResult.errors.length} errors)`}
              </Alert>
            )}
            {autoHaSyncResult?.error && (
              <Alert severity="error" sx={{ py: 0.5 }}>{autoHaSyncResult.error}</Alert>
            )}
          </Stack>
        )}
      </CardContent>
    </Card>
  )
}
