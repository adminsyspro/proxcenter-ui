'use client'

import { useTranslations } from 'next-intl'
import { Box, Chip, IconButton, Tab, Tabs, Tooltip, Typography } from '@mui/material'

import { STATUS_COLOR } from '@/components/incidents/IncidentHeader'
import { errorMessageOf } from '@/lib/api/fetchJsonSafe'
import type { IncidentSummary } from '@/lib/incidents/types'

const OUTAGE_TYPES = ['node_down', 'vm_down', 'cluster_quorum']

// The width of a small IconButton, kept by an empty slot.
const ACTION_SLOT_SX = { width: 30, flexShrink: 0, display: 'flex', justifyContent: 'center' }

const LOCKED_CODES = ['ALERT_IN_INCIDENT', 'ALERT_LOCKED']

type DeleteOutcome = { ok: true } | { lock: string } | { error: string }

/** What a DELETE of an alert answered: done, refused because an incident holds the alert (its code), or refused with the server's reason. */
async function deleteOutcome(res: Response): Promise<DeleteOutcome> {
  if (res.status >= 200 && res.status < 300) return { ok: true }

  let body: unknown = null

  try {
    body = await res.json()
  } catch {
    // Not JSON: the status is the reason.
  }

  const code = (body as { code?: unknown } | null)?.code

  if (res.status === 409 && typeof code === 'string' && LOCKED_CODES.includes(code)) return { lock: code }

  return { error: errorMessageOf(body, res.status) }
}

/** True when a DELETE of an alert was refused because the alert belongs to an incident. */
export async function isAlertInIncidentResponse(res: Response): Promise<boolean> {
  return 'lock' in (await deleteOutcome(res))
}

/**
 * Outcome of a batch of alert DELETEs: the alerts refused because an incident
 * holds them (kept, of which `neutral` carry the code that does not name the
 * incident), the ones deleted, and the ones refused for any other reason with
 * the first reason.
 */
export async function summarizeDeletes(responses: Response[]): Promise<{ kept: number; neutral: number; deleted: number; failed: number; firstError?: string }> {
  const outcomes = await Promise.all(responses.map(deleteOutcome))
  const locks = outcomes.flatMap(o => ('lock' in o ? [o.lock] : []))
  const errors = outcomes.flatMap(o => ('error' in o ? [o.error] : []))

  return {
    kept: locks.length,
    neutral: locks.filter(c => c === 'ALERT_LOCKED').length,
    deleted: outcomes.filter(o => 'ok' in o).length,
    failed: errors.length,
    ...(errors.length > 0 ? { firstError: errors[0] } : {}),
  }
}

/**
 * Incident column of an alert row: the incident the alert belongs to, as a
 * chip in the color of its status that opens it, its title cut to the column;
 * nothing for a free alert.
 */
export function IncidentCell({ summary, onOpen }: Readonly<{ summary?: IncidentSummary; onOpen: (incidentId: string) => void }>) {
  const t = useTranslations('incidents')

  if (!summary) return null

  return (
    <Tooltip title={`${t(`status.${summary.status}`)} · ${summary.title}`}>
      <Chip
        size='small'
        variant='outlined'
        color={STATUS_COLOR[summary.status]}
        icon={<i className='ri-alarm-warning-line' aria-hidden='true' />}
        label={summary.title}
        onClick={() => onOpen(summary.id)}
        sx={{ maxWidth: '100%' }}
      />
    </Tooltip>
  )
}

interface ButtonsProps {
  alert: { id: string; type?: string; connection_id?: string }
  summary: IncidentSummary | undefined
  canManage: boolean
  onOpen: (incidentId: string | null, seedAlertId?: string) => void
  onAvailability: (href: string) => void
}

/** Incident actions of an alert row: open an incident on a free alert, and jump to the availability of its connection. */
export function IncidentButtons({ alert, summary, canManage, onOpen, onAvailability }: Readonly<ButtonsProps>) {
  const t = useTranslations('incidents.actions')
  const isOutage = OUTAGE_TYPES.includes(alert.type ?? '') && !!alert.connection_id

  // One fixed slot per button, empty when the button does not apply, so the
  // actions after them line up from one row to the next.
  return (
    <>
      <Box sx={ACTION_SLOT_SX}>
        {!summary && canManage && (
          <Tooltip title={t('open')}>
            <IconButton size='small' aria-label={t('open')} onClick={() => onOpen(null, alert.id)}>
              <i className='ri-alarm-warning-line' aria-hidden='true' />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      <Box sx={ACTION_SLOT_SX}>
        {isOutage && (
          <Tooltip title={t('availability')}>
            <IconButton size='small' aria-label={t('availability')} onClick={() => onAvailability(`/operations/availability#conn-${alert.connection_id}`)}>
              <i className='ri-pulse-line' aria-hidden='true' />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    </>
  )
}

interface TabsProps {
  tab: number
  onChange: (tab: number) => void
  activeCount: number
  rulesCount: number
  incidentCount: number
  incidentsEnabled: boolean
}

/** Tabs of the Alerts page; the Incidents tab only when the register is on offer. */
export function AlertsTabs({ tab, onChange, activeCount, rulesCount, incidentCount, incidentsEnabled }: Readonly<TabsProps>) {
  const t = useTranslations()

  return (
    <Tabs value={tab} onChange={(_, v) => onChange(v)}>
      <Tab label={t('alerts.alertsTab', { count: activeCount })} />
      <Tab label={t('alerts.eventRules', { count: rulesCount })} />
      {incidentsEnabled && <Tab label={t('incidents.tab', { count: incidentCount })} />}
    </Tabs>
  )
}

/** Message cell of an alert row: the message and its occurrences. */
export function AlertMessageCell({ message, occurrences }: Readonly<{ message: string; occurrences: number }>) {
  const t = useTranslations()

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', py: 0.5 }}>
      <Typography variant='body2' sx={{ fontWeight: 500, lineHeight: 1.4 }}>{message}</Typography>
      <Typography variant='caption' sx={{ opacity: 0.6, lineHeight: 1.2 }}>{occurrences} {t('alerts.occurrences')}</Typography>
    </Box>
  )
}
