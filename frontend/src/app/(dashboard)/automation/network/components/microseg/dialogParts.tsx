'use client'

import { useCallback, useState } from 'react'
import { Alert } from '@mui/material'
import { useTranslations } from 'next-intl'

import { MicrosegApiError, microsegErrorKeyOf } from '@/lib/microseg/api'
import TruncatedText from './TruncatedText'

export const ONE_LINE_SX = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const

/** A line of a dialog: one line, cut with an ellipsis and shown in full as a tooltip. */
export function OneLine({ text, color = 'text.secondary' }: { text: string; color?: string }) {
  return (
    <TruncatedText text={text} color={color} sx={{ minWidth: 0 }} />
  )
}

/** The error of a failed action, on one line (full text in the tooltip). */
export function DialogErrorLine({ message }: { message: string }) {
  return (
    <Alert severity='error' sx={{ '& .MuiAlert-message': { minWidth: 0, overflow: 'hidden' } }}>
      <TruncatedText text={message} variant='body2' />
    </Alert>
  )
}

/** True for the 409 that says the draft moved under the user (the input is kept, the policy reloaded). */
export function isVersionConflict(error: unknown): boolean {
  return error instanceof MicrosegApiError && error.code === 'VERSION_CONFLICT'
}

type Translate = (key: string) => string

/** One translated message for a failed write; the server's wording is only added for INVALID. */
export function writeErrorMessage(t: Translate, error: unknown): string {
  if (isVersionConflict(error)) return t('microsegPilot.policy.conflictReloaded')
  const base = t(microsegErrorKeyOf(error))
  const detail = error instanceof MicrosegApiError && error.code === 'INVALID' ? error.serverMessage : undefined
  return detail ? `${base} ${detail}` : base
}

/** Busy flag and error of a dialog action; the input of the dialog is never touched here. */
export function useDialogAction() {
  const t = useTranslations()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async (action: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      await action()
      return true
    } catch (e) {
      setError(writeErrorMessage(t as Translate, e))
      return false
    } finally {
      setBusy(false)
    }
  }, [t])

  const reset = useCallback(() => setError(null), [])

  return { busy, error, run, reset }
}
