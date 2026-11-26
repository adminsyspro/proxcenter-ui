'use client'

import { useTranslations } from 'next-intl'
import { Box, Typography } from '@mui/material'

import { acceptanceLineValues, type AcceptanceView } from './riskAcceptance.helpers'

/** Beside the finding of an accepted check, on the same line: who accepted the risk, when, until when, and why. */
export default function RiskAcceptanceNote({ acceptance }: { acceptance: AcceptanceView }) {
  const t = useTranslations('compliance.riskAcceptance')
  const { user, date, until } = acceptanceLineValues(acceptance)

  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, minWidth: 0 }}>
      <i className="ri-shield-check-line" style={{ fontSize: 16, color: '#0ea5e9', marginTop: 2, flexShrink: 0 }} />
      <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
        <span>{until ? t('acceptedByUntil', { user, date, until }) : t('acceptedBy', { user, date })}</span>
        {': '}
        <Box component="span" sx={{ color: 'text.primary' }}>{acceptance.justification}</Box>
      </Typography>
    </Box>
  )
}
