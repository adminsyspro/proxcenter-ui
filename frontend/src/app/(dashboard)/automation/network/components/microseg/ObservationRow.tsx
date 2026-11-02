'use client'

import { useState } from 'react'
import { Box, Checkbox, Chip, Collapse, IconButton, Tooltip, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import type { MicrosegSuggestion, MicrosegZone, SuggestionAction } from '@/lib/microseg/types'

import { OneLine } from './dialogParts'

/** What a zone-less endpoint is called: its IP, or "Unknown". */
function endpoint(zoneId: string, ip: string, zones: Map<string, MicrosegZone>, t: (key: string) => string): string {
  if (zoneId) return zones.get(zoneId)?.name ?? t('deletedZone')
  return ip || t('unknownEndpoint')
}

/** The zone with its IP when both are known, for the details. */
function endpointDetail(zoneId: string, ip: string, zones: Map<string, MicrosegZone>, t: (key: string) => string): string {
  const name = endpoint(zoneId, ip, zones, t)
  return zoneId && ip ? `${name} (${ip})` : name
}

export type ObservationRowProps = {
  suggestion: MicrosegSuggestion
  zones: Map<string, MicrosegZone>
  checked: boolean
  busy: boolean
  onToggle: () => void
  onResolve: (action: SuggestionAction) => void
}

/** One observed flow on one line; the first and last time and the addresses sit under the chevron. */
export default function ObservationRow({ suggestion: s, zones, checked, busy, onToggle, onResolve }: ObservationRowProps) {
  const t = useTranslations('microsegPilot.observation')
  const tp = useTranslations('microsegPilot.policy')
  const format = useFormatter()
  const [open, setOpen] = useState(false)

  const when = (iso: string) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? iso : format.dateTime(d, { dateStyle: 'medium', timeStyle: 'short' })
  }
  const source = endpoint(s.src_zone_id, s.src_ip, zones, t)
  const destination = endpoint(s.dst_zone_id, s.dst_ip, zones, t)
  const service = s.dport ? `${s.proto}/${s.dport}` : s.proto
  const pending = s.status === 'pending'
  const blocked = s.kind === 'blocked'

  return (
    <Box role='listitem' aria-label={t('rowLabel', { source, destination })} sx={{ borderBottom: 1, borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 44, pr: 1, minWidth: 0 }}>
        <Checkbox
          size='small'
          checked={checked}
          disabled={!pending || busy}
          onChange={onToggle}
          slotProps={{ input: { 'aria-label': t('selectRow', { source, destination }) } }}
          sx={{ p: 0.5 }}
        />
        <IconButton size='small' aria-expanded={open} aria-label={open ? tp('hideDetails') : tp('showDetails')} onClick={() => setOpen(v => !v)}>
          <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />
        </IconButton>
        <Tooltip title={t(`kind.${s.kind}`)}>
          <Box component='span' sx={{ position: 'relative', display: 'inline-flex', width: 16, height: 16, flexShrink: 0 }}>
            <i className={blocked ? 'ri-forbid-line' : 'ri-eye-line'} style={{ fontSize: 16 }} />
            <Box
              component='span'
              sx={{
                position: 'absolute', bottom: -2, right: -3, width: 8, height: 8, borderRadius: '50%', border: '1.5px solid', borderColor: 'background.paper',
                bgcolor: blocked ? 'error.main' : 'warning.main',
              }}
            />
          </Box>
        </Tooltip>
        <Tooltip title={source}><Typography noWrap fontWeight={600} sx={{ flex: '0 1 auto', maxWidth: 200 }}>{source}</Typography></Tooltip>
        <i className='ri-arrow-right-line' style={{ opacity: 0.6, flexShrink: 0 }} />
        <Tooltip title={destination}><Typography noWrap fontWeight={600} sx={{ flex: '0 1 auto', maxWidth: 200 }}>{destination}</Typography></Tooltip>
        <Typography noWrap color='text.secondary' sx={{ flexShrink: 0 }}>{service}</Typography>
        <Typography noWrap color='text.secondary' sx={{ flexShrink: 0 }}>{t('hits', { count: s.hits })}</Typography>
        <Tooltip title={t('lastSeen', { time: when(s.last_seen) })}>
          <Typography noWrap variant='body2' color='text.secondary' sx={{ flex: '1 1 0', minWidth: 0 }}>{t('lastSeen', { time: when(s.last_seen) })}</Typography>
        </Tooltip>
        {pending ? (
          <>
            <Tooltip title={s.src_zone_id ? t('accept') : t('acceptNoZone')}>
              <span>
                <IconButton size='small' aria-label={t('accept')} disabled={busy || !s.src_zone_id} onClick={() => onResolve('accept')}><i className='ri-check-line' /></IconButton>
              </span>
            </Tooltip>
            <Tooltip title={s.src_ip ? t('acceptCidr') : t('acceptCidrNoIp')}>
              <span>
                <IconButton size='small' aria-label={t('acceptCidr')} disabled={busy || !s.src_ip} onClick={() => onResolve('accept_cidr')}><i className='ri-checkbox-multiple-line' /></IconButton>
              </span>
            </Tooltip>
            <Tooltip title={t('dismiss')}>
              <span>
                <IconButton size='small' aria-label={t('dismiss')} disabled={busy} onClick={() => onResolve('dismiss')}><i className='ri-close-line' /></IconButton>
              </span>
            </Tooltip>
          </>
        ) : (
          <Chip size='small' variant='outlined' label={t(`status.${s.status}`)} sx={{ flexShrink: 0 }} />
        )}
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ pl: 11, pr: 2, pb: 1.5, minWidth: 0 }}>
          <OneLine text={t('detail.firstSeen', { time: when(s.first_seen) })} />
          <OneLine text={t('detail.lastSeen', { time: when(s.last_seen) })} />
          <OneLine text={t('detail.source', { value: endpointDetail(s.src_zone_id, s.src_ip, zones, t) })} />
          <OneLine text={t('detail.destination', { value: endpointDetail(s.dst_zone_id, s.dst_ip, zones, t) })} />
        </Box>
      </Collapse>
    </Box>
  )
}
