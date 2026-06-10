// src/components/settings/DiagnosticModal.tsx
// Modal to run and display connection diagnostics
'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material'

// ---- Types -----------------------------------------------------------------

type DiagCheckStatus = 'ok' | 'warn' | 'error' | 'skip'
type DiagCategory =
  | 'network'
  | 'auth'
  | 'version'
  | 'cluster'
  | 'storage'
  | 'ssh'
  | 'datastore'

interface DiagCheck {
  id: string
  category: DiagCategory
  label: string
  status: DiagCheckStatus
  message: string
  detail?: string
  durationMs: number
}

interface DiagResult {
  connectionId: string
  type: string
  checks: DiagCheck[]
  summary: { ok: number; warn: number; error: number; skip: number }
  ranAt: string
  durationMs: number
}

interface DiagnosticModalProps {
  open: boolean
  connectionId: string | null
  connectionName: string
  onClose: () => void
}

// ---- Helpers ----------------------------------------------------------------

const CATEGORY_ORDER: DiagCategory[] = [
  'network',
  'auth',
  'version',
  'cluster',
  'storage',
  'ssh',
  'datastore',
]

function statusIcon(status: DiagCheckStatus): { cls: string; color: string } {
  switch (status) {
    case 'ok':
      return { cls: 'ri-checkbox-circle-fill', color: 'success.main' }
    case 'warn':
      return { cls: 'ri-error-warning-fill', color: 'warning.main' }
    case 'error':
      return { cls: 'ri-close-circle-fill', color: 'error.main' }
    case 'skip':
    default:
      return { cls: 'ri-indeterminate-circle-line', color: 'text.disabled' }
  }
}

function chipColor(
  status: DiagCheckStatus
): 'success' | 'warning' | 'error' | 'default' {
  switch (status) {
    case 'ok':
      return 'success'
    case 'warn':
      return 'warning'
    case 'error':
      return 'error'
    default:
      return 'default'
  }
}

// ---- CheckRow ---------------------------------------------------------------

function CheckRow({ check }: { check: DiagCheck }) {
  const [detailOpen, setDetailOpen] = useState(false)
  const { cls, color } = statusIcon(check.status)

  return (
    <Box sx={{ py: 0.75 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        {/* Status icon */}
        <Box sx={{ pt: 0.15, flexShrink: 0 }}>
          <i className={cls} style={{ fontSize: 16, color: 'inherit' }} />
        </Box>

        {/* Label + message */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant='body2' sx={{ fontWeight: 600, color }}>
              {check.label}
            </Typography>
            <Typography variant='body2' sx={{ opacity: 0.8 }}>
              {check.message}
            </Typography>
          </Box>

          {/* Expand button for detail */}
          {check.detail && (
            <Box sx={{ mt: 0.25 }}>
              <Button
                size='small'
                variant='text'
                onClick={() => setDetailOpen(v => !v)}
                sx={{ p: 0, minWidth: 0, fontSize: '0.75rem', opacity: 0.65, textTransform: 'none' }}
                startIcon={
                  <i
                    className={detailOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}
                    style={{ fontSize: 14 }}
                  />
                }
              >
                {detailOpen ? 'Hide detail' : 'Show detail'}
              </Button>
              <Collapse in={detailOpen}>
                <Box
                  sx={{
                    mt: 0.5,
                    p: 1,
                    borderRadius: 1,
                    bgcolor: 'action.hover',
                    border: '1px solid',
                    borderColor: 'divider',
                  }}
                >
                  <Typography
                    variant='caption'
                    component='pre'
                    sx={{
                      display: 'block',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      m: 0,
                    }}
                  >
                    {check.detail}
                  </Typography>
                </Box>
              </Collapse>
            </Box>
          )}
        </Box>

        {/* Duration badge */}
        <Typography
          variant='caption'
          sx={{ opacity: 0.4, flexShrink: 0, pt: 0.15 }}
        >
          {check.durationMs}ms
        </Typography>
      </Box>
    </Box>
  )
}

// ---- DiagnosticModal --------------------------------------------------------

export default function DiagnosticModal({
  open,
  connectionId,
  connectionName,
  onClose,
}: DiagnosticModalProps) {
  const t = useTranslations('settings.diagnostics')

  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<DiagResult | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const run = useCallback(async () => {
    if (!connectionId) return
    setLoading(true)
    setResult(null)
    setFetchError(null)

    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/diagnostics`)
      const text = await res.text()
      let json: DiagResult | null = null
      try {
        json = text ? JSON.parse(text) : null
      } catch {
        // not JSON
      }

      if (!res.ok) {
        const msg = (json as { error?: string } | null)?.error || text || `HTTP ${res.status}`
        setFetchError(msg)
        return
      }

      setResult(json)
    } catch (e: unknown) {
      setFetchError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [connectionId])

  // Auto-run when modal opens
  useEffect(() => {
    if (open && connectionId) {
      run()
    }
    // Reset when closed
    if (!open) {
      setResult(null)
      setFetchError(null)
      setLoading(false)
    }
  }, [open, connectionId]) // deliberately exclude `run` to avoid loop

  // ---- Render ----------------------------------------------------------------

  // Group checks by category (preserving CATEGORY_ORDER)
  const grouped: Map<DiagCategory, DiagCheck[]> = new Map()
  if (result) {
    for (const cat of CATEGORY_ORDER) {
      const items = result.checks.filter(c => c.category === cat)
      if (items.length > 0) grouped.set(cat, items)
    }
    // Any category not in CATEGORY_ORDER (future-proof)
    for (const check of result.checks) {
      if (!grouped.has(check.category)) {
        const list = grouped.get(check.category) ?? []
        list.push(check)
        grouped.set(check.category, list)
      }
    }
  }

  const hasIssues =
    result && (result.summary.error > 0 || result.summary.warn > 0)

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth='sm'
      fullWidth
      PaperProps={{
        sx: { bgcolor: 'background.paper' },
      }}
    >
      {/* ---- Title ---- */}
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          pb: 1,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className='ri-heart-pulse-line' style={{ fontSize: 20 }} />
          <Box>
            <Typography variant='subtitle1' sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              {t('title')}
            </Typography>
            {connectionName && (
              <Typography variant='caption' sx={{ opacity: 0.6 }}>
                {connectionName}
              </Typography>
            )}
          </Box>
        </Box>
        <IconButton size='small' onClick={onClose} sx={{ opacity: 0.6 }}>
          <i className='ri-close-line' style={{ fontSize: 18 }} />
        </IconButton>
      </DialogTitle>

      <Divider />

      {/* ---- Content ---- */}
      <DialogContent sx={{ pt: 2, pb: 1 }}>
        {/* Loading state */}
        {loading && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              py: 4,
              justifyContent: 'center',
            }}
          >
            <CircularProgress size={22} />
            <Typography variant='body2' sx={{ opacity: 0.7 }}>
              {t('running')}
            </Typography>
          </Box>
        )}

        {/* Error state */}
        {!loading && fetchError && (
          <Alert severity='error' sx={{ mt: 1 }}>
            {t('unavailable')}: {fetchError}
          </Alert>
        )}

        {/* Results */}
        {!loading && result && (
          <Box>
            {/* Summary chips row */}
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                flexWrap: 'wrap',
                mb: 2,
              }}
            >
              {result.summary.ok > 0 && (
                <Chip
                  size='small'
                  color='success'
                  variant='outlined'
                  icon={<i className='ri-checkbox-circle-fill' style={{ fontSize: 14 }} />}
                  label={t('summaryOk', { count: result.summary.ok })}
                />
              )}
              {result.summary.warn > 0 && (
                <Chip
                  size='small'
                  color='warning'
                  variant='outlined'
                  icon={<i className='ri-error-warning-fill' style={{ fontSize: 14 }} />}
                  label={t('summaryWarn', { count: result.summary.warn })}
                />
              )}
              {result.summary.error > 0 && (
                <Chip
                  size='small'
                  color='error'
                  variant='outlined'
                  icon={<i className='ri-close-circle-fill' style={{ fontSize: 14 }} />}
                  label={t('summaryError', { count: result.summary.error })}
                />
              )}
              {result.summary.skip > 0 && (
                <Chip
                  size='small'
                  color='default'
                  variant='outlined'
                  icon={<i className='ri-indeterminate-circle-line' style={{ fontSize: 14 }} />}
                  label={t('summarySkip', { count: result.summary.skip })}
                />
              )}
              <Typography variant='caption' sx={{ opacity: 0.45, ml: 'auto' }}>
                {t('durationLabel', { ms: result.durationMs })}
              </Typography>
            </Box>

            {/* No-issue banner */}
            {!hasIssues && (
              <Alert severity='success' sx={{ mb: 2 }}>
                {t('allOk')}
              </Alert>
            )}

            {/* Check groups */}
            {Array.from(grouped.entries()).map(([cat, checks], idx) => (
              <Box key={cat}>
                {idx > 0 && <Divider sx={{ my: 1 }} />}
                <Typography
                  variant='overline'
                  sx={{ opacity: 0.5, fontSize: '0.65rem', letterSpacing: '0.08em' }}
                >
                  {cat}
                </Typography>
                <Box>
                  {checks.map(check => (
                    <CheckRow key={check.id} check={check} />
                  ))}
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>

      <Divider />

      {/* ---- Actions ---- */}
      <DialogActions sx={{ px: 2, py: 1.5, gap: 1 }}>
        <Button
          size='small'
          variant='outlined'
          startIcon={
            loading
              ? <CircularProgress size={14} />
              : <i className='ri-refresh-line' style={{ fontSize: 16 }} />
          }
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
