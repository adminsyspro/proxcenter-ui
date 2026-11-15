'use client'

import { useMemo } from 'react'
import { Box, FormControl, InputLabel, MenuItem, Select, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { SMALL_SELECT_SX } from '@/components/settings/destinations/DestinationDialogParts'
import type { MicrosegSuggestion, MicrosegZone } from '@/lib/microseg/types'

import { zoneTraffic } from './guestViewModel'
import { byText } from './zoneLayout'
import TruncatedText from './TruncatedText'

type Props = {
  zones: MicrosegZone[]
  suggestions: MicrosegSuggestion[]
  centre: string | null
  onCentre: (zoneId: string) => void
}

/**
 * The bar of the guest view: the zone in the centre (each with its observed hits), how to move to another zone, and
 * the reminder that an observed flow is drawn between one sample pair of guests (UA28).
 */
export default function GuestViewBar({ zones, suggestions, centre, onCentre }: Props) {
  const t = useTranslations('microsegPilot.overview')
  const traffic = useMemo(() => zoneTraffic(zones, suggestions), [zones, suggestions])
  const sorted = useMemo(() => [...zones].sort((a, b) => byText(a.name, b.name) || byText(a.id, b.id)), [zones])
  const note = t('flowPanel.sampleNote')
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1, minWidth: 0 }}>
      <FormControl size='small' sx={{ minWidth: 220, flexShrink: 0 }}>
        <InputLabel shrink>{t('guestView.zone')}</InputLabel>
        <Select
          label={t('guestView.zone')}
          notched
          value={centre ?? ''}
          onChange={e => onCentre(e.target.value)}
          inputProps={{ 'aria-label': t('guestView.zone') }}
          sx={SMALL_SELECT_SX}
        >
          {sorted.map(z => (
            <MenuItem key={z.id} value={z.id}>{t('guestView.option', { name: z.name, count: traffic.get(z.id) ?? 0 })}</MenuItem>
          ))}
        </Select>
      </FormControl>
      <Typography noWrap variant='caption' color='text.secondary' sx={{ flexShrink: 0 }}>{t('guestView.hint')}</Typography>
      <Box component='i' className='ri-information-line' aria-hidden sx={{ color: 'text.secondary', flexShrink: 0 }} />
      <TruncatedText text={note} variant='caption' color='text.secondary' sx={{ flex: '1 1 0', minWidth: 0 }} />
    </Box>
  )
}
