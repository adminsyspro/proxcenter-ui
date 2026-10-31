'use client'

import { useState } from 'react'

import { useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Card,
  Chip,
  CircularProgress,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'

import { useAvailabilityFormat } from '@/app/(dashboard)/operations/availability/components/availabilityFormat'
import EmptyState from '@/components/EmptyState'
import { postmortemKey } from '@/components/incidents/IncidentFacts'
import { STATUS_COLOR } from '@/components/incidents/IncidentHeader'
import type { IncidentView } from '@/lib/incidents/types'

import { INCIDENT_PAGE_SIZE, useIncidentList, type IncidentStatusFilter } from './useIncidentList'

const SEVERITIES = ['info', 'warning', 'critical']
const FILTERS: IncidentStatusFilter[] = ['all', 'open', 'resolved', 'closed']
const COLUMNS = ['status', 'title', 'severity', 'started', 'duration', 'alerts', 'comments', 'postmortem'] as const

interface Props {
  onOpen: (incidentId: string) => void
}

/** The incident register of the Alerts page: filter by status, one row per incident, a click opens it. */
export default function IncidentsTab({ onOpen }: Readonly<Props>) {
  const t = useTranslations('incidents')
  const fmt = useAvailabilityFormat()
  const [status, setStatus] = useState<IncidentStatusFilter>('all')
  const [page, setPage] = useState(1)
  const { data, error, isLoading } = useIncidentList(status, page)

  const pages = data ? Math.max(1, Math.ceil(data.total / INCIDENT_PAGE_SIZE)) : 1

  let body

  if (error) body = <Alert severity='warning' sx={{ m: 2 }}>{t('errors.generic')}</Alert>
  else if (isLoading || !data) body = <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
  else if (data.incidents.length === 0) body = <EmptyState icon='ri-alarm-warning-line' title={t('list.empty')} description={t('list.emptyDescription')} />
  else {
    body = (
      <>
        <TableContainer>
          <Table size='small' aria-label={t('title')}>
            <TableHead>
              <TableRow>
                {COLUMNS.map(c => (
                  <TableCell key={c} sx={{ whiteSpace: 'nowrap' }}>{t(`list.columns.${c}`)}</TableCell>
                ))}
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{t('list.columns.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.incidents.map(i => (
                <TableRow key={i.id} hover sx={{ cursor: 'pointer' }} onClick={() => onOpen(i.id)}>
                  <TableCell><Chip size='small' color={STATUS_COLOR[i.status]} label={t(`status.${i.status}`)} /></TableCell>
                  <TableCell sx={{ fontWeight: 500 }}>{i.title}</TableCell>
                  <TableCell>{SEVERITIES.includes(i.severity) ? t(`severity.${i.severity}`) : i.severity}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmt.dateTime(i.started_at)}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {i.ended_at ? fmt.duration(i.started_at, i.ended_at) : t('header.ongoing')}
                  </TableCell>
                  <TableCell>{i.alert_count}</TableCell>
                  <TableCell>{i.comment_count}</TableCell>
                  <TableCell>{t(`list.postmortem.${postmortemKey(i)}`)}</TableCell>
                  <TableCell><i className='ri-arrow-right-s-line' aria-hidden='true' /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {pages > 1 && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', p: 1.5 }}>
            <Pagination count={pages} page={page} onChange={(_, p) => setPage(p)} size='small' />
          </Box>
        )}
      </>
    )
  }

  return (
    <Box sx={{ p: 2, overflow: 'auto' }}>
      <Card variant='outlined'>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2, borderBottom: 1, borderColor: 'divider', flexWrap: 'wrap' }}>
          <Typography variant='body2' color='text.secondary' sx={{ flex: 1 }}>{t('list.intro')}</Typography>
          <ToggleButtonGroup
            size='small'
            exclusive
            value={status}
            aria-label={t('list.filterLabel')}
            onChange={(_, v: IncidentStatusFilter | null) => {
              if (v) {
                setStatus(v)
                setPage(1)
              }
            }}
          >
            {FILTERS.map(f => <ToggleButton key={f} value={f}>{t(`list.filter.${f}`)}</ToggleButton>)}
          </ToggleButtonGroup>
        </Box>
        {body}
      </Card>
    </Box>
  )
}
