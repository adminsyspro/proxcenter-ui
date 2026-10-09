// src/components/settings/ConnectionCheckDialog.tsx
// Runs the read-only "Check connection" probes of a PVE connection and shows
// the checklist, one line per item with the fix to apply.
'use client'

import { useCallback, useEffect, useState } from 'react'

import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  Divider,
  Typography,
} from '@mui/material'

import ConnectionDialogTitle from './ConnectionDialogTitle'

import { CHECK_PROBE_ORDER, type CheckItem, type CheckProbe, type CheckStatus } from '@/lib/connections/check/types'

interface ConnectionCheckDialogProps {
  open: boolean
  connectionId: string | null
  connectionName: string
  onClose: () => void
}

function statusIcon(status: CheckStatus): { cls: string; color: string } {
  switch (status) {
    case 'ok':
      return { cls: 'ri-checkbox-circle-fill', color: 'success.main' }
    case 'warn':
      return { cls: 'ri-error-warning-fill', color: 'warning.main' }
    case 'fail':
      return { cls: 'ri-close-circle-fill', color: 'error.main' }
    case 'skip':
    default:
      return { cls: 'ri-indeterminate-circle-line', color: 'text.disabled' }
  }
}

/** The target an item is about, shown next to the probe name. */
function targetOf(item: CheckItem): string {
  const { node, host } = item.params
  if (typeof node === 'string' && node) return typeof host === 'string' && host ? `${node} (${host})` : node
  if (typeof host === 'string' && host) return host
  if (typeof item.params.path === 'string' && item.id.startsWith('privileges.')) return item.params.path
  return ''
}

export default function ConnectionCheckDialog({ open, connectionId, connectionName, onClose }: ConnectionCheckDialogProps) {
  const t = useTranslations('settings.connectionCheck')

  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<CheckItem[] | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const run = useCallback(async () => {
    if (!connectionId) return
    setLoading(true)
    setItems(null)
    setFetchError(null)

    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/check`, { method: 'POST' })
      const text = await res.text()
      let json: { items?: CheckItem[]; error?: string } | null = null
      try {
        json = text ? JSON.parse(text) : null
      } catch {
        json = null
      }

      if (!res.ok || !Array.isArray(json?.items)) {
        setFetchError(json?.error || text || `HTTP ${res.status}`)
        return
      }

      setItems(json.items)
    } catch (e: unknown) {
      setFetchError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [connectionId])

  // Run on open, reset on close (`run` left out on purpose, as DiagnosticModal does).
  useEffect(() => {
    if (open && connectionId) {
      void run()
    }
    if (!open) {
      setItems(null)
      setFetchError(null)
      setLoading(false)
    }
  }, [open, connectionId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Hint and feature codes come from the server; an unknown one is shown raw
  // rather than as a dotted key path.
  const hintText = (item: CheckItem): string => {
    const values: Record<string, string | number> = {}
    for (const [key, value] of Object.entries(item.params)) {
      values[key] = Array.isArray(value)
        ? value.map(v => (t.has(`features.${v}`) ? t(`features.${v}`) : v)).join(', ')
        : value
    }
    return t.has(`hints.${item.hint}`) ? t(`hints.${item.hint}`, values) : item.hint
  }

  const summary = { ok: 0, warn: 0, fail: 0, skip: 0 }
  for (const i of items ?? []) summary[i.status] += 1
  const hasIssues = summary.fail > 0 || summary.warn > 0

  const grouped: Array<[CheckProbe, CheckItem[]]> = []
  if (items) {
    for (const probe of CHECK_PROBE_ORDER) {
      const list = items.filter(i => i.probe === probe)
      if (list.length > 0) grouped.push([probe, list])
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth='sm' fullWidth PaperProps={{ sx: { bgcolor: 'background.paper' } }}>
      <ConnectionDialogTitle icon='ri-shield-check-line' title={t('title')} connectionName={connectionName} onClose={onClose} />

      <Divider />

      <DialogContent sx={{ pt: 2, pb: 1 }}>
        {loading && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 4, justifyContent: 'center' }}>
            <CircularProgress size={22} />
            <Typography variant='body2' sx={{ opacity: 0.7 }}>
              {t('running')}
            </Typography>
          </Box>
        )}

        {!loading && fetchError && (
          <Alert severity='error' sx={{ mt: 1 }}>
            {t('unavailable')}: {fetchError}
          </Alert>
        )}

        {!loading && items && (
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 2 }}>
              {summary.ok > 0 && (
                <Chip size='small' color='success' variant='outlined' icon={<i className='ri-checkbox-circle-fill' style={{ fontSize: 14 }} />} label={t('summaryOk', { count: summary.ok })} />
              )}
              {summary.warn > 0 && (
                <Chip size='small' color='warning' variant='outlined' icon={<i className='ri-error-warning-fill' style={{ fontSize: 14 }} />} label={t('summaryWarn', { count: summary.warn })} />
              )}
              {summary.fail > 0 && (
                <Chip size='small' color='error' variant='outlined' icon={<i className='ri-close-circle-fill' style={{ fontSize: 14 }} />} label={t('summaryFail', { count: summary.fail })} />
              )}
              {summary.skip > 0 && (
                <Chip size='small' color='default' variant='outlined' icon={<i className='ri-indeterminate-circle-line' style={{ fontSize: 14 }} />} label={t('summarySkip', { count: summary.skip })} />
              )}
            </Box>

            {!hasIssues && (
              <Alert severity='success' sx={{ mb: 2 }}>
                {t('allOk')}
              </Alert>
            )}

            {grouped.map(([probe, list], idx) => (
              <Box key={probe}>
                {idx > 0 && <Divider sx={{ my: 1 }} />}
                <Typography variant='overline' sx={{ opacity: 0.5, fontSize: '0.65rem', letterSpacing: '0.08em' }}>
                  {t(`probes.${probe}`)}
                </Typography>
                {list.map(item => {
                  const { cls, color } = statusIcon(item.status)
                  const target = targetOf(item)
                  return (
                    <Box key={item.id} data-testid={`check-item-${item.id}`} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, py: 0.75 }}>
                      <Box sx={{ pt: 0.15, flexShrink: 0, color }}>
                        <i className={cls} style={{ fontSize: 16 }} />
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        {target && (
                          <Typography variant='body2' sx={{ fontWeight: 600, color }}>
                            {target}
                          </Typography>
                        )}
                        <Typography variant='body2' sx={{ opacity: 0.85, wordBreak: 'break-word' }}>
                          {hintText(item)}
                        </Typography>
                      </Box>
                    </Box>
                  )
                })}
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>

      <Divider />

      <DialogActions sx={{ px: 2, py: 1.5, gap: 1 }}>
        <Button
          size='small'
          variant='outlined'
          startIcon={loading ? <CircularProgress size={14} /> : <i className='ri-refresh-line' style={{ fontSize: 16 }} />}
          onClick={run}
          disabled={loading || !connectionId}
        >
          {t('rerun')}
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button size='small' variant='contained' onClick={onClose}>
          {t('close')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
