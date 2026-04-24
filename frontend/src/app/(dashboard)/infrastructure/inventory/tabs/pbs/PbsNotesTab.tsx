'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material'

interface PbsNotesTabProps {
  pbsId: string
}

export default function PbsNotesTab({ pbsId }: PbsNotesTabProps) {
  const t = useTranslations()

  const [original, setOriginal] = useState<string>('')
  const [value, setValue] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(true)
  const [saving, setSaving] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [notSupported, setNotSupported] = useState<boolean>(false)
  const [forbidden, setForbidden] = useState<{ requiredPriv?: string } | null>(null)

  const [snackbar, setSnackbar] = useState<{
    open: boolean
    severity: 'success' | 'error'
    message: string
  }>({ open: false, severity: 'success', message: '' })

  const dirty = value !== original

  const fetchNotes = useCallback(async () => {
    setLoading(true)
    setError(null)
    setNotSupported(false)
    setForbidden(null)
    try {
      const res = await fetch(`/api/v1/pbs/${pbsId}/notes`, { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (res.status === 403 && body?.forbidden) {
        setForbidden({ requiredPriv: body?.requiredPriv })
        return
      }
      if (!res.ok) {
        throw new Error(body?.error || `HTTP ${res.status}`)
      }
      if (body?.data?.notSupported) {
        setNotSupported(true)
        setOriginal('')
        setValue('')
        return
      }
      const notes = String(body?.data?.notes || '')
      setOriginal(notes)
      setValue(notes)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [pbsId])

  useEffect(() => {
    fetchNotes()
  }, [fetchNotes])

  const saveRef = useRef<() => void>(() => {})

  const handleSave = useCallback(async () => {
    if (!dirty || saving) return
    setSaving(true)
    try {
      const res = await fetch(`/api/v1/pbs/${pbsId}/notes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: value }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `HTTP ${res.status}`)
      }
      setOriginal(value)
      setSnackbar({
        open: true,
        severity: 'success',
        message: t('inventory.pbsNotesSaveSuccess'),
      })
    } catch (e: any) {
      setSnackbar({
        open: true,
        severity: 'error',
        message: t('inventory.pbsNotesSaveError') + (e?.message ? `: ${e.message}` : ''),
      })
    } finally {
      setSaving(false)
    }
  }, [dirty, saving, pbsId, value, t])

  saveRef.current = handleSave

  const handleReset = useCallback(() => {
    setValue(original)
  }, [original])

  // Ctrl/Cmd+S keyboard shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleSnackbarClose = () => setSnackbar(s => ({ ...s, open: false }))

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
      {/* Toolbar */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
          flexWrap: 'wrap',
        }}
      >
        <Typography fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-file-text-line" style={{ fontSize: 18, opacity: 0.7 }} />
          {t('inventory.pbsNotesTitle')}
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <Button
            variant="outlined"
            size="small"
            onClick={handleReset}
            disabled={!dirty || saving || loading}
            startIcon={<i className="ri-refresh-line" style={{ fontSize: 16 }} />}
          >
            {t('inventory.pbsNotesReset')}
          </Button>
          <Button
            variant="contained"
            size="small"
            onClick={handleSave}
            disabled={!dirty || saving || loading}
            startIcon={
              saving ? (
                <CircularProgress size={14} sx={{ color: 'inherit' }} />
              ) : (
                <i className="ri-save-line" style={{ fontSize: 16 }} />
              )
            }
          >
            {t('inventory.pbsNotesSave')}
          </Button>
        </Stack>
      </Box>

      {/* Content */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, py: 6 }}>
          <CircularProgress size={32} />
        </Box>
      ) : forbidden ? (
        <Alert severity="warning" icon={<i className="ri-lock-line" style={{ fontSize: 20 }} />}>
          <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
            {t('inventory.pbsNotesForbidden')}
          </Typography>
          {forbidden.requiredPriv && (
            <Typography variant="caption" sx={{ opacity: 0.8 }}>
              {t('inventory.pbsNotesRequiredPriv', { priv: forbidden.requiredPriv })}
            </Typography>
          )}
        </Alert>
      ) : notSupported ? (
        <Alert severity="info" icon={<i className="ri-information-line" style={{ fontSize: 20 }} />}>
          {t('inventory.pbsNotesNotSupported')}
        </Alert>
      ) : error ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={fetchNotes}>
              {t('inventory.pbsNotesReset')}
            </Button>
          }
        >
          {t('inventory.pbsNotesLoadError')}: {error}
        </Alert>
      ) : (
        <TextField
          multiline
          minRows={15}
          fullWidth
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={t('inventory.pbsNotesPlaceholder')}
          disabled={saving}
          sx={{ flex: 1 }}
          slotProps={{
            input: {
              sx: {
                alignItems: 'flex-start',
                height: '100%',
                '& textarea': {
                  height: '100% !important',
                  whiteSpace: 'pre-wrap',
                },
              },
            },
          }}
        />
      )}

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={handleSnackbarClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert onClose={handleSnackbarClose} severity={snackbar.severity} variant="filled">
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
