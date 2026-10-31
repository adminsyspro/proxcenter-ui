'use client'

import type { ReactNode } from 'react'

import { useNow, useTranslations } from 'next-intl'
import { Box, Tooltip, Typography } from '@mui/material'

import { useAvailabilityFormat } from '@/app/(dashboard)/operations/availability/components/availabilityFormat'
import type { IncidentView } from '@/lib/incidents/types'

/** Post-mortem progress of an incident: validated when closed, in progress once a cause is written, else to do. */
export function postmortemKey(i: IncidentView): 'validated' | 'inProgress' | 'todo' {
  if (i.status === 'closed') return 'validated'
  if (i.status === 'resolved' && i.root_cause.trim() !== '') return 'inProgress'

  return 'todo'
}

interface Props {
  view: IncidentView
  /** Whether the incident enters the SLA report; unknown while it is read. */
  inReport?: boolean
}

function Fact({ label, children, hint }: Readonly<{ label: string; children: ReactNode; hint?: string }>) {
  const value = <Typography variant='body2' sx={{ fontWeight: 500 }}>{children}</Typography>

  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>{label}</Typography>
      {hint ? <Tooltip title={hint}><Box component='span' sx={{ display: 'inline-block', cursor: 'help' }}>{value}</Box></Tooltip> : value}
    </Box>
  )
}

/** The key facts of the incident under its title: when, how long, how many alerts, and where it is reported. */
export default function IncidentFacts({ view, inReport }: Readonly<Props>) {
  const t = useTranslations('incidents')
  const fmt = useAvailabilityFormat()
  const now = useNow({ updateInterval: 60_000 })

  const active = view.alerts.filter(a => !a.resolved_at).length
  const end = view.ended_at ?? now.toISOString()

  let report = t('facts.reportPending')
  let reportHint: string | undefined
  if (inReport !== undefined) {
    report = t(inReport ? 'facts.reportIn' : 'facts.reportOut')
    reportHint = t(inReport ? 'postmortem.slaNotice' : 'postmortem.notInReport')
  }

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 4, px: 6, py: 3, bgcolor: 'action.hover' }}>
      <Fact label={t('facts.started')}>{fmt.dateTime(view.started_at)}</Fact>
      <Fact label={t('facts.ended')}>{view.ended_at ? fmt.dateTime(view.ended_at) : t('alerts.ongoing')}</Fact>
      <Fact label={t('facts.duration')}>{fmt.duration(view.started_at, end)}</Fact>
      <Fact label={t('facts.alerts')}>{`${t('facts.alertsTotal', { total: view.alerts.length })}, ${active ? t('facts.alertsActive', { count: active }) : t('facts.alertsResolved')}`}</Fact>
      <Fact label={t('facts.report')} hint={reportHint}>{report}</Fact>
      <Fact label={t('facts.postmortem')}>{t(`list.postmortem.${postmortemKey(view)}`)}</Fact>
    </Box>
  )
}
