'use client'

import type { ReactNode } from 'react'
import { Alert, Box, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { GuestRef, MicrosegRunResult } from '@/lib/microseg/types'

import { guestName } from './planGroups'
import type { PolicyGuest } from './zoneModel'

type NoticeProps = { severity: 'error' | 'warning' | 'info' | 'success'; text: string; action?: ReactNode }

/** A notice on one line (cut with an ellipsis, shown in full as a tooltip). */
export function Notice({ severity, text, action }: NoticeProps) {
  return (
    <Alert severity={severity} action={action} sx={{ '& .MuiAlert-message': { minWidth: 0, overflow: 'hidden' } }}>
      <Tooltip title={text}>
        <Typography variant='body2' noWrap>{text}</Typography>
      </Tooltip>
    </Alert>
  )
}

const MAX_NAMES_SHOWN = 50

function guestList(guests: PolicyGuest[], refs: GuestRef[]): string {
  const names = refs.slice(0, MAX_NAMES_SHOWN).map(ref => guestName(guests, ref))
  return refs.length > MAX_NAMES_SHOWN ? `${names.join(', ')}, ...` : names.join(', ')
}

type Props = { result: MicrosegRunResult; guests: PolicyGuest[] }

/**
 * What the plan found around its steps: collisions block (an error), the rules
 * kept as they are, the guests it could not read and the ones in several zones
 * are warnings.
 */
export default function PlanNotices({ result, guests }: Props) {
  const t = useTranslations('microsegPilot.plan')
  const { collisions = [], foreign_rules: foreign = [], unread = [], ambiguous = [] } = result
  if (!collisions.length && !foreign.length && !unread.length && !ambiguous.length) return null

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
      {collisions.length > 0 && <Notice severity='error' text={t('collisions', { names: collisions.join(', ') })} />}
      {foreign.length > 0 && <Notice severity='warning' text={t('foreignRules', { names: foreign.join(', ') })} />}
      {unread.length > 0 && <Notice severity='warning' text={t('unread', { count: unread.length, names: guestList(guests, unread) })} />}
      {ambiguous.length > 0 && <Notice severity='warning' text={t('ambiguous', { count: ambiguous.length, names: guestList(guests, ambiguous) })} />}
    </Box>
  )
}
