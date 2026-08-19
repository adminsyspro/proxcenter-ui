'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  Radio,
  RadioGroup,
  Typography,
} from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'

/**
 * The way out of an ambiguous guest inspection.
 *
 * A cold virt-v2v conversion can find several bootable systems on the source
 * disks, and converting the wrong one would boot the wrong OS on the target.
 * The pipeline refuses to guess: it parks the job on `awaiting_root_choice`
 * with the candidates in the config, and this action lets the operator pick
 * the system to convert (#738). Unlike the cutover and the hard power off,
 * this is a choice among N entries, not a confirm, so it carries its own
 * dialog instead of reusing ConfirmActionButton.
 */

type RootCandidate = {
  device: string
  description?: string | null
}

type RootChoiceJob = {
  id: string
  status: string
  currentStep?: string | null
  config?: { v2vRootCandidates?: RootCandidate[] | null } | null
} | null | undefined

/** True while the conversion is parked on the operator's choice of system. */
export function isAwaitingRootChoice(job: RootChoiceJob): boolean {
  return job?.currentStep === 'awaiting_root_choice'
    && !['completed', 'failed', 'cancelled'].includes(job?.status ?? '')
}

export default function RootChoiceButton({
  job,
  size = 'small',
  onRequested,
}: {
  job: RootChoiceJob
  size?: 'small' | 'medium'
  onRequested?: () => void
}) {
  const t = useTranslations()
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState('')
  const [error, setError] = useState<string | null>(null)

  const candidates = job?.config?.v2vRootCandidates ?? []

  if (!isAwaitingRootChoice(job) || candidates.length === 0) return null

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/migrations/${job!.id}/root-choice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: selected }),
      })
      if (!res.ok) {
        // 400 carries the reason (value not a candidate, job no longer waiting).
        const d = await res.json().catch(() => null)
        setError(d?.error || `HTTP ${res.status}`)
        return
      }
      setOpen(false)
      onRequested?.()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        size={size}
        variant="contained"
        color="primary"
        disabled={busy}
        startIcon={<i className="ri-list-check-2" style={{ fontSize: 14 }} />}
        onClick={() => {
          setSelected(candidates[0].device)
          setError(null)
          setOpen(true)
        }}
        sx={{ textTransform: 'none' }}
      >
        {t('inventoryPage.esxiMigration.chooseRootFilesystem')}
      </Button>

      <Dialog open={open} onClose={() => !busy && setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{
            width: 40, height: 40, borderRadius: 2,
            bgcolor: alpha(theme.palette.primary.main, 0.12),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Box component="i" className="ri-list-check-2" sx={{ fontSize: 22, color: 'primary.main' }} />
          </Box>
          {t('inventoryPage.esxiMigration.chooseRootTitle')}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>{t('inventoryPage.esxiMigration.chooseRootBody')}</DialogContentText>
          <RadioGroup value={selected} onChange={e => setSelected(e.target.value)} sx={{ mt: 2 }}>
            {candidates.map(c => (
              <FormControlLabel
                key={c.device}
                value={c.device}
                control={<Radio size="small" />}
                sx={{ alignItems: 'flex-start', mb: 0.5 }}
                label={
                  <Box sx={{ py: 0.25 }}>
                    <Typography variant="body2" color="text.primary" fontWeight={600}>
                      {c.description || c.device}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {c.device}
                    </Typography>
                  </Box>
                }
              />
            ))}
          </RadioGroup>
          {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setOpen(false)} color="inherit" disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            color="primary"
            disabled={busy}
            startIcon={busy ? <CircularProgress size={16} /> : undefined}
            onClick={confirm}
          >
            {t('inventoryPage.esxiMigration.chooseRootConfirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
