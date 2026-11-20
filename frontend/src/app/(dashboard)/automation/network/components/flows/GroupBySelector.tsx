'use client'

import NextLink from 'next/link'
import { useTranslations } from 'next-intl'
import { Box, FormControl, InputLabel, Link, MenuItem, Select, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material'

import { SMALL_SELECT_SX } from '@/components/settings/destinations/DestinationDialogParts'

import type { GroupBy, LensConnection, LensState } from './useTrafficLens'

/** The Micro-segmentation tab of the network page (the page has no deep link to one of its tabs). */
export const MICROSEG_SETUP_HREF = '/automation/network'

type Props = {
  value: GroupBy
  onChange: (next: GroupBy) => void
  lensState: LensState
  connections: LensConnection[]
  connectionId: string | null
  onConnection: (id: string) => void
}

/** Why the Zone grouping cannot be chosen, with the way to set micro-segmentation up when that is the reason. */
function ZoneUnavailable({ state }: { state: LensState }) {
  const t = useTranslations('microsegPilot.trafficLens')
  if (state === 'loading') return <>{t('loadingZones')}</>
  if (state === 'error') return <>{t('loadError')}</>
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Typography variant='caption'>{t('setupFirst')}</Typography>
      <Link component={NextLink} href={MICROSEG_SETUP_HREF} variant='caption' color='inherit' underline='always'>
        {t('setupLink')}
      </Link>
    </Box>
  )
}

/** Group by VM, IP or micro-segmentation zone, and the connection whose zones are used when there are several. */
export default function GroupBySelector({ value, onChange, lensState, connections, connectionId, onConnection }: Props) {
  const t = useTranslations('networkFlows')
  const tl = useTranslations('microsegPilot.trafficLens')
  const zoneReady = lensState === 'ready'

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
      <Typography variant='caption' color='text.secondary' sx={{ fontWeight: 600 }}>{t('groupBy')}</Typography>
      <ToggleButtonGroup
        size='small'
        exclusive
        value={value}
        aria-label={t('groupBy')}
        onChange={(_, next: GroupBy | null) => { if (next) onChange(next) }}
        sx={{ '& .MuiToggleButton-root': { textTransform: 'none', fontSize: 12, py: 0.5, px: 1.25 } }}
      >
        <ToggleButton value='vm'>{t('groupByVm')}</ToggleButton>
        <ToggleButton value='ip'>{t('groupByIp')}</ToggleButton>
        {zoneReady ? (
          <ToggleButton value='zone'>{t('groupByZone')}</ToggleButton>
        ) : (
          <Tooltip title={<ZoneUnavailable state={lensState} />}>
            <span data-testid='group-by-zone-unavailable' style={{ display: 'inline-flex' }}>
              <ToggleButton value='zone' disabled>{t('groupByZone')}</ToggleButton>
            </span>
          </Tooltip>
        )}
      </ToggleButtonGroup>
      {connections.length > 1 && (
        <FormControl size='small' sx={{ ...SMALL_SELECT_SX, minWidth: 160 }}>
          <InputLabel id='flows-lens-connection-label'>{tl('connection')}</InputLabel>
          <Select
            labelId='flows-lens-connection-label'
            label={tl('connection')}
            value={connectionId ?? ''}
            onChange={e => onConnection(String(e.target.value))}
          >
            {connections.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
          </Select>
        </FormControl>
      )}
    </Box>
  )
}
