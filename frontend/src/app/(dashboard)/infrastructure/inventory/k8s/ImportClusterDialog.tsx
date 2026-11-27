'use client'

import { useRef, useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, MenuItem, Stack, Typography, Alert, Box, Chip, CircularProgress,
} from '@mui/material'
import { useTranslations } from 'next-intl'

type Connectivity = {
  state?: string
  version?: string
  nodesReady?: number
  nodesTotal?: number
  errorMessage?: string
}

function connectivityChipColor(state?: string): 'success' | 'warning' | 'error' {
  if (state === 'healthy') return 'success'
  if (state === 'degraded') return 'warning'

  return 'error'
}

type SanitizedPreview = {
  apiServerUrl?: string
  credentialType?: string
  contextName?: string
}

type Props = {
  open: boolean
  onClose: () => void
  /** Called after a successful import / credential replacement. */
  onImported: () => void
  /**
   * When set, the dialog runs in "replace credential" mode and PATCHes the
   * existing cluster instead of creating a new one. Name field is hidden.
   */
  replaceClusterId?: string
}

export default function ImportClusterDialog({ open, onClose, onImported, replaceClusterId }: Props) {
  const t = useTranslations()
  const fileRef = useRef<HTMLInputElement | null>(null)

  const [kubeconfig, setKubeconfig] = useState('')
  const [contexts, setContexts] = useState<string[]>([])
  const [context, setContext] = useState('')
  const [name, setName] = useState('')
  const [preview, setPreview] = useState<SanitizedPreview | null>(null)
  const [connectivity, setConnectivity] = useState<Connectivity | null>(null)
  const [rejections, setRejections] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [validating, setValidating] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const isReplace = !!replaceClusterId

  const reset = () => {
    setKubeconfig('')
    setContexts([])
    setContext('')
    setName('')
    setPreview(null)
    setConnectivity(null)
    setRejections([])
    setError(null)
    setValidating(false)
    setSubmitting(false)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleFile = async (file: File | null) => {
    if (!file) return
    const text = await file.text()
    setKubeconfig(text)
    // A fresh file invalidates any previously validated context.
    setContexts([])
    setContext('')
    setPreview(null)
    setConnectivity(null)
    setRejections([])
    setError(null)
  }

  // Validate twice: first call (no context) lists contexts; once a context is
  // picked the same endpoint returns a sanitized preview + connectivity probe.
  const validate = async (withContext: boolean) => {
    setValidating(true)
    setError(null)
    setRejections([])
    if (!withContext) {
      setPreview(null)
      setConnectivity(null)
    }
    try {
      const res = await fetch('/api/v1/k8s/clusters/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(withContext ? { kubeconfig, context } : { kubeconfig }),
      })
      const data = await res.json().catch(() => ({}))
      if (Array.isArray(data?.contexts)) {
        setContexts(data.contexts)
        if (!withContext && data.contexts.length === 1) setContext(data.contexts[0])
      }
      if (Array.isArray(data?.rejections)) setRejections(data.rejections)
      if (data?.error) setError(data.error)
      if (data?.sanitizedPreview) setPreview(data.sanitizedPreview)
      if (data?.connectivity) setConnectivity(data.connectivity)
    } catch {
      setError('network error')
    } finally {
      setValidating(false)
    }
  }

  const submit = async () => {
    setSubmitting(true)
    setError(null)
    setRejections([])
    try {
      const url = isReplace ? `/api/v1/k8s/clusters/${replaceClusterId}` : '/api/v1/k8s/clusters'
      const method = isReplace ? 'PATCH' : 'POST'
      const body = isReplace
        ? { kubeconfig, context }
        : { name, kubeconfig, context }
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        reset()
        onImported()
        return
      }
      if (Array.isArray(data?.rejections)) setRejections(data.rejections)
      setError(data?.error || 'import failed')
    } catch {
      setError('network error')
    } finally {
      setSubmitting(false)
    }
  }

  const canImport = !!kubeconfig && !!context && (isReplace || !!name.trim()) && rejections.length === 0

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <img src="/images/kubernetes-logo.svg" alt="" width={22} height={22} />
          {t('kubernetes.importDialog.title')}
        </Box>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField
            label={t('kubernetes.importDialog.pasteLabel')}
            value={kubeconfig}
            onChange={(e) => setKubeconfig(e.target.value)}
            multiline
            minRows={6}
            fullWidth
          />

          <Stack direction="row" spacing={1} alignItems="center">
            <Button
              variant="outlined"
              size="small"
              startIcon={<i className="ri-upload-2-line" />}
              onClick={() => fileRef.current?.click()}
            >
              {t('common.upload')}
            </Button>
            <input
              ref={fileRef}
              type="file"
              hidden
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />
            <Button
              variant="contained"
              size="small"
              disabled={!kubeconfig || validating}
              onClick={() => validate(false)}
              startIcon={validating ? <CircularProgress size={16} /> : <i className="ri-check-line" />}
            >
              {t('common.confirm')}
            </Button>
          </Stack>

          {contexts.length > 0 && (
            <TextField
              select
              label={t('kubernetes.importDialog.contextLabel')}
              value={context}
              onChange={(e) => {
                setContext(e.target.value)
                setPreview(null)
                setConnectivity(null)
                setRejections([])
              }}
              fullWidth
            >
              {contexts.map(c => (
                <MenuItem key={c} value={c}>{c}</MenuItem>
              ))}
            </TextField>
          )}

          {context && (
            <Button
              variant="text"
              size="small"
              sx={{ alignSelf: 'flex-start' }}
              disabled={validating}
              onClick={() => validate(true)}
            >
              {t('common.refresh')}
            </Button>
          )}

          {preview?.apiServerUrl && (
            <Box>
              <Typography variant="body2" color="text.secondary">
                {preview.apiServerUrl}
              </Typography>
              {connectivity?.state && (
                <Chip
                  size="small"
                  sx={{ mt: 0.5 }}
                  color={connectivityChipColor(connectivity.state)}
                  label={t(`kubernetes.health.${connectivity.state}`)}
                />
              )}
            </Box>
          )}

          {!isReplace && (
            <TextField
              label={t('kubernetes.importDialog.nameLabel')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
            />
          )}

          {rejections.length > 0 && (
            <Alert severity="error" variant="outlined">
              <Stack spacing={0.25}>
                {rejections.map((r, i) => (
                  <Typography key={i} variant="body2">{r}</Typography>
                ))}
              </Stack>
            </Alert>
          )}

          {error && rejections.length === 0 && (
            <Alert severity="error" variant="outlined">{error}</Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={submitting}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={!canImport || submitting}
          startIcon={submitting ? <CircularProgress size={16} /> : undefined}
        >
          {isReplace ? t('common.save') : t('common.import')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
