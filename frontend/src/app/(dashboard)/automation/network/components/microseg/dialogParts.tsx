'use client'

import { useCallback, useState, type ReactNode } from 'react'
import { Alert, Box, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { MicrosegApiError, microsegErrorKeyOf } from '@/lib/microseg/api'
import TruncatedText from './TruncatedText'

export const ONE_LINE_SX = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const

/** Width of the name column of a form dialog: room for the longest row name in every catalogue. */
export const FORM_LABEL_WIDTH = 150
/** Height of the first line of a form row: the height of a small outlined field, so names and controls share a centre line. */
const FORM_ROW_HEIGHT = 38

/** A checkbox or a radio without its padding, its drawn box flush with the left edge of the fields above (the icon is inset 3px). */
export const FLUSH_TOGGLE_SX = { p: 0, ml: '-3px', mr: 1 } as const

type FormRowProps = {
  label: string
  /** The id of the input the name labels, for a text field. */
  htmlFor?: string
  /** Captions under the control, in the control column. */
  below?: ReactNode
  /** An explanation behind an info icon at the right of the name. */
  tip?: string
  /** Width of the name column, for a dialog whose names are longer than the default. */
  labelWidth?: number
  children: ReactNode
}

/** A setting of a form dialog: its name in a fixed left column, its control on the right; the name goes above the control on a narrow screen. */
export function FormRow({ label, htmlFor, below, tip, labelWidth = FORM_LABEL_WIDTH, children }: FormRowProps) {
  const nameSx = { ...ONE_LINE_SX, display: 'block', lineHeight: { sm: `${FORM_ROW_HEIGHT}px` } }
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: `${labelWidth}px minmax(0, 1fr)` }, columnGap: 4, rowGap: 1, alignItems: 'start' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, height: { sm: FORM_ROW_HEIGHT } }}>
        {htmlFor
          ? <Typography component='label' htmlFor={htmlFor} variant='body2' color='text.secondary' sx={{ ...nameSx, minWidth: 0 }}>{label}</Typography>
          : <Typography component='span' variant='body2' color='text.secondary' sx={{ ...nameSx, minWidth: 0 }}>{label}</Typography>}
        {tip ? (
          <Tooltip title={tip} describeChild>
            <Box component='i' className='ri-information-line' data-testid='form-row-tip' sx={{ fontSize: 16, color: 'text.secondary', flexShrink: 0, cursor: 'help' }} />
          </Tooltip>
        ) : null}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ minHeight: FORM_ROW_HEIGHT, display: 'flex', alignItems: 'center', minWidth: 0 }}>{children}</Box>
        {below}
      </Box>
    </Box>
  )
}

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

/**
 * The inbound run of a zone dialog that changed both states ended in failure: the outbound change was not sent.
 * `detail` is the run's own error, when it gave one.
 */
export class InboundRunFailedError extends Error {
  readonly detail: string

  constructor(detail = '') {
    super(detail || 'inbound run failed')
    this.name = 'InboundRunFailedError'
    this.detail = detail
  }
}

type Translate = (key: string) => string

/** One translated message for a failed write; the server's wording is only added for INVALID (and a failed run's own error). */
export function writeErrorMessage(t: Translate, error: unknown): string {
  if (isVersionConflict(error)) return t('microsegPilot.policy.conflictReloaded')
  if (error instanceof InboundRunFailedError) {
    const base = t('microsegPilot.policy.zoneDialog.inboundRunFailed')
    return error.detail ? `${base} ${error.detail}` : base
  }
  const base = t(microsegErrorKeyOf(error))
  const detail = error instanceof MicrosegApiError && error.code === 'INVALID' ? error.serverMessage : undefined
  return detail ? `${base} ${detail}` : base
}

/** Busy flag and error of a dialog action; the input of the dialog is never touched here. */
export function useDialogAction() {
  const t = useTranslations()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** `messageOf` words an error the way this action's context needs it (null: the common wording). */
  const run = useCallback(async (action: () => Promise<unknown>, messageOf?: (error: unknown) => string | null): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      await action()
      return true
    } catch (e) {
      setError(messageOf?.(e) ?? writeErrorMessage(t as Translate, e))
      return false
    } finally {
      setBusy(false)
    }
  }, [t])

  const reset = useCallback(() => setError(null), [])

  return { busy, error, run, reset }
}
