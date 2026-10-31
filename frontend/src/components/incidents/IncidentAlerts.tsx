'use client'

import { useState } from 'react'

import { useFormatter, useNow, useTranslations } from 'next-intl'
import { Box, Button, IconButton, Tooltip, Typography } from '@mui/material'

import { useAvailabilityFormat } from '@/app/(dashboard)/operations/availability/components/availabilityFormat'
import CheckboxGroup from '@/app/(dashboard)/operations/availability/components/CheckboxGroup'
import { GlyphIcon, PROXMOX } from '@/app/(dashboard)/operations/availability/components/RowGlyph'
import type { IncidentAlert, IncidentView } from '@/lib/incidents/types'

import IncidentSection from './IncidentSection'
import { incidentRequest, useCandidates, type RunFn } from './useIncident'

const GLYPHS: Record<string, string> = {
  node_down: PROXMOX,
  cluster_quorum: 'ri-server-line',
  vm_down: 'ri-computer-line',
}

/** The glyph of an alert type: the Proxmox logo for a node, the server icon for a cluster, the VM icon for a guest. */
export function alertGlyph(type?: string): string {
  return (type && GLYPHS[type]) || 'ri-alarm-warning-line'
}

/** Alerts shown before the timeline folds the rest behind a button. */
const TIMELINE_MAX = 6

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

interface Props {
  view: IncidentView
  canManage: boolean
  run: RunFn
  /** The guest alerts no SLA policy of the tenant covers: out of the timeline and the report. */
  outOfSla?: readonly string[]
}

/** The alerts of the incident as a timeline, and the alerts of the same outage that can still join it. */
export default function IncidentAlerts({ view, canManage, run, outOfSla = [] }: Readonly<Props>) {
  const t = useTranslations('incidents')
  const fmt = useAvailabilityFormat()
  const format = useFormatter()
  const now = useNow({ updateInterval: 60_000 })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState(false)

  const closed = view.status === 'closed'
  const canEdit = canManage && !closed
  const canDetach = canEdit && view.alerts.length > 1
  const base = `/api/v1/incidents/${encodeURIComponent(view.id)}`
  const { data: candidates, mutate: refreshCandidates } = useCandidates(view.id, canEdit)

  const items = (candidates?.alerts ?? []).map(a => ({
    key: a.id,
    label: text(a.resource_name) || text(a.resource) || t('alerts.unknown'),
    secondary: text(a.message),
    icon: alertGlyph(a.type),
  }))

  const detach = (alertId: string) =>
    run(async () => {
      await incidentRequest(`${base}/alerts/${encodeURIComponent(alertId)}`, 'DELETE')
      await refreshCandidates()
    })

  const attach = async () => {
    const ids = [...selected]

    await run(async () => {
      try {
        for (const id of ids) await incidentRequest(`${base}/alerts`, 'POST', { alert_id: id })
      } finally {
        setSelected(new Set())
        await refreshCandidates()
      }
    })
  }

  const sorted = [...view.alerts].sort((a, b) => text(a.first_seen_at).localeCompare(text(b.first_seen_at)))
  const shown = expanded ? sorted : sorted.slice(0, TIMELINE_MAX)
  const hidden = sorted.length - shown.length
  const startDay = view.started_at.slice(0, 10)

  /** The time alone on the incident's first day, the date as well past it. */
  const when = (iso: string) => format.dateTime(new Date(iso), iso.slice(0, 10) === startDay ? { timeStyle: 'medium' } : { dateStyle: 'short', timeStyle: 'medium' })

  return (
    <IncidentSection icon='ri-alarm-warning-line' title={t('alerts.title')} description={t('alerts.description')}>
      <Box component='ol' sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {shown.map((a: IncidentAlert, i) => {
          const started = text(a.first_seen_at)
          const lasted = started ? fmt.duration(started, a.resolved_at ?? now.toISOString()) : ''
          const last = i === shown.length - 1

          return (
            <Box component='li' key={a.id} sx={{ display: 'flex', gap: 3 }}>
              <Box aria-hidden='true' sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 1.5 }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, bgcolor: a.resolved_at ? 'success.main' : 'error.main' }} />
                {!last && <Box sx={{ width: 2, flex: 1, bgcolor: 'divider', my: 1 }} />}
              </Box>
              <Box sx={{ flex: 1, minWidth: 0, pb: last ? 0 : 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
                  {started && (
                    <Tooltip title={fmt.dateTime(started)}>
                      <Typography variant='body2' color='text.secondary' sx={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{when(started)}</Typography>
                    </Tooltip>
                  )}
                  <GlyphIcon icon={alertGlyph(a.type)} />
                  <Typography variant='body2' sx={{ fontWeight: 500, flexShrink: 0 }}>{text(a.resource_name) || text(a.resource) || t('alerts.unknown')}</Typography>
                  <Typography variant='body2' color='text.secondary' noWrap sx={{ minWidth: 0 }}>{text(a.message)}</Typography>
                  <Box sx={{ flex: 1 }} />
                  {canDetach && (
                    <Tooltip title={t('alerts.detach')}>
                      <IconButton size='small' aria-label={t('alerts.detach')} onClick={() => detach(a.id)}>
                        <i className='ri-link-unlink' aria-hidden='true' />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                  <Typography variant='caption' color={a.resolved_at ? 'text.secondary' : 'error.main'}>
                    {a.resolved_at
                      ? t('alerts.resolvedAt', { time: when(a.resolved_at), duration: lasted })
                      : t('alerts.activeFor', { duration: lasted })}
                  </Typography>
                  {outOfSla.includes(a.id) && (
                    <Tooltip title={t('alerts.outOfSla')}>
                      <Typography variant='caption' color='warning.main' sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'help' }}>
                        <i className='ri-eye-off-line' aria-hidden='true' />
                        {t('alerts.outOfSlaShort')}
                      </Typography>
                    </Tooltip>
                  )}
                </Box>
              </Box>
            </Box>
          )
        })}
      </Box>
      {sorted.length > TIMELINE_MAX && (
        <Box>
          <Button size='small' onClick={() => setExpanded(e => !e)}>
            {expanded ? t('alerts.showLess') : t('alerts.showMore', { count: hidden })}
          </Button>
        </Box>
      )}
      {canEdit && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 3, borderRadius: 1, bgcolor: 'action.hover' }}>
          <Box>
            <Typography variant='subtitle2'>{t('alerts.sameOutage')}</Typography>
            <Typography variant='caption' color='text.secondary'>{t('alerts.sameOutageHint')}</Typography>
          </Box>
          <CheckboxGroup
            title={t('alerts.sameOutage')}
            hideTitle
            searchable
            items={items}
            selected={selected}
            onChange={setSelected}
            emptyText={t('alerts.noCandidates')}
          />
          {items.length > 0 && (
            <Box>
              <Button size='small' variant='contained' disabled={selected.size === 0} onClick={attach}>
                {t('alerts.attach', { count: selected.size })}
              </Button>
            </Box>
          )}
        </Box>
      )}
    </IncidentSection>
  )
}
