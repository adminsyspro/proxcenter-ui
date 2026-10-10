'use client'

// Edit dialog pieces shared by the delivery destination cards (syslog
// collectors, notification channels): the test result and the footer.

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'

import { Alert, Box, Button, CircularProgress, DialogActions } from '@mui/material'

// A small MUI Select renders 38 px against 35.9 px for a small TextField; this
// pins both to the same line height so a row of fields sits level.
export const SMALL_SELECT_SX = {
  '& .MuiInputBase-input.MuiSelect-select': { minHeight: '1.4375em', lineHeight: '1.4375em' },
} as const

type TestResultProps = {
  ok: boolean
  text: ReactNode
  details?: string
  onClose: () => void
}

/** Outcome of a test send, with the raw detail (receiver answer, refusal) below. */
export function TestResultAlert({ ok, text, details, onClose }: TestResultProps) {
  return (
    <Alert severity={ok ? 'success' : 'error'} onClose={onClose}>
      {text}
      {details && (
        <Box
          component='pre'
          sx={{
            mt: 1,
            mb: 0,
            p: 1,
            fontSize: '0.7rem',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            bgcolor: 'action.hover',
            borderRadius: 1,
            maxHeight: 120,
            overflow: 'auto',
          }}
        >
          {details}
        </Box>
      )}
    </Alert>
  )
}

type ActionsProps = {
  testing: boolean
  saving: boolean
  testLabel: string
  testingLabel: string
  onTest: () => void
  onCancel: () => void
  onSave: () => void
}

/** Test on the left, cancel and save on the right. */
export function DestinationDialogActions({ testing, saving, testLabel, testingLabel, onTest, onCancel, onSave }: ActionsProps) {
  const tc = useTranslations('common')

  return (
    <DialogActions sx={{ px: 3, pb: 2 }}>
      <Button
        variant='outlined'
        onClick={onTest}
        disabled={testing || saving}
        startIcon={testing ? <CircularProgress size={16} /> : <i className='ri-send-plane-line' />}
        sx={{ mr: 'auto' }}
      >
        {testing ? testingLabel : testLabel}
      </Button>
      <Button onClick={onCancel} disabled={saving}>
        {tc('cancel')}
      </Button>
      <Button
        variant='contained'
        onClick={onSave}
        disabled={saving}
        startIcon={saving ? <CircularProgress size={16} /> : <i className='ri-save-line' />}
      >
        {saving ? tc('saving') : tc('save')}
      </Button>
    </DialogActions>
  )
}
