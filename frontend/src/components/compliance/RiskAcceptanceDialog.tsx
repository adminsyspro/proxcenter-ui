'use client'

import { useEffect, useState } from 'react'

import { useTranslations } from 'next-intl'
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material'

import { errorMessage, jsonInit, requireOk } from '@/lib/api/fetchJsonSafe'

import { acceptancePayload, isJustificationValid, JUSTIFICATION_MAX_LENGTH, tomorrowIso } from './riskAcceptance.helpers'

export type RiskAcceptanceTarget = { id: string; name: string; status: string }

interface Props {
  connectionId: string
  /** The check to accept ('fail' or 'warning') or whose acceptance to revoke ('accepted'); null closes the dialog. */
  check: RiskAcceptanceTarget | null
  onClose: () => void
  /** Called once the acceptance was saved or revoked. */
  onDone: () => void
}

/** Accept the risk of a failing hardening check, or revoke the acceptance it has. */
export default function RiskAcceptanceDialog({ connectionId, check, onClose, onDone }: Props) {
  const t = useTranslations('compliance.riskAcceptance')
  const tc = useTranslations('common')
  const [justification, setJustification] = useState('')
  const [expiry, setExpiry] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const revoking = check?.status === 'accepted'

  useEffect(() => {
    if (!check) return
    setJustification('')
    setExpiry('')
    setError('')
  }, [check])

  const submit = async () => {
    if (!check) return
    setBusy(true)
    setError('')
    const base = `/api/v1/compliance/hardening/${encodeURIComponent(connectionId)}/acceptances`
    try {
      if (revoking) await requireOk(`${base}?checkId=${encodeURIComponent(check.id)}`, jsonInit('DELETE'))
      else await requireOk(base, jsonInit('POST', acceptancePayload(check.id, justification, expiry)))
      onDone()
      onClose()
    } catch (e) {
      setError(errorMessage(e, t('error')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={!!check} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{revoking ? t('revokeTitle') : t('acceptTitle')}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 0.5 }}>
          <Typography variant="body2" fontWeight={600}>{check?.name}</Typography>
          <Typography variant="body2" color="text.secondary">
            {revoking ? t('revokeIntro') : t('acceptIntro')}
          </Typography>
          {!revoking && (
            <>
              <TextField
                label={t('justification')}
                value={justification}
                onChange={e => setJustification(e.target.value)}
                multiline
                minRows={3}
                fullWidth
                required
                autoFocus
                helperText={t('justificationHelper')}
                slotProps={{ htmlInput: { maxLength: JUSTIFICATION_MAX_LENGTH } }}
              />
              <TextField
                label={t('expiry')}
                type="date"
                value={expiry}
                onChange={e => setExpiry(e.target.value)}
                fullWidth
                helperText={t('expiryHelper')}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: tomorrowIso() } }}
              />
            </>
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{tc('cancel')}</Button>
        <Button
          variant="contained"
          color={revoking ? 'error' : 'primary'}
          onClick={() => void submit()}
          disabled={busy || (!revoking && !isJustificationValid(justification))}
          startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {revoking ? t('revoke') : t('accept')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
