'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Alert, Box, Typography } from '@mui/material'
import parser from 'cron-parser'
import type { ScheduleSpec } from './types'
import { scheduleToCron } from './scheduleToCron'

interface Props {
  spec: ScheduleSpec | null
  timezone: string
  count?: number
}

export default function SchedulePreview({ spec, timezone, count = 5 }: Props) {
  const t = useTranslations()
  const next = useMemo(() => {
    if (!spec) return null
    try {
      const cronBody = scheduleToCron(spec, '')
      const it = parser.parseExpression(cronBody, { tz: timezone || undefined })
      const out: string[] = []
      for (let i = 0; i < count; i++) {
        out.push(it.next().toDate().toLocaleString(undefined, { timeZone: timezone || undefined }))
      }
      return out
    } catch (e) {
      return { error: (e as Error).message }
    }
  }, [spec, timezone, count])

  if (!spec) return null

  if (next && 'error' in next) {
    return <Alert severity='warning'>{t('siteRecovery.schedule.previewError')}: {next.error}</Alert>
  }

  return (
    <Alert severity='info' variant='outlined' icon={<i className='ri-calendar-event-line' />}>
      <Typography variant='subtitle2' sx={{ mb: 0.5 }}>
        {t('siteRecovery.schedule.nextRuns', { count })}
      </Typography>
      <Box component='ul' sx={{ m: 0, pl: 2 }}>
        {(next as string[]).map((line, i) => (
          <li key={i}><Typography variant='caption'>{line}</Typography></li>
        ))}
      </Box>
    </Alert>
  )
}
