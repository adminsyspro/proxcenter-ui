'use client'

import { Button } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { MicrosegControls } from './useMicrosegControls'

/**
 * The Emergency stop, at the right end of the sub-tabs row. Reachable whatever the status: the stop is idempotent,
 * and it is needed most when the engine misbehaves. While the stop is on, the banner offers Resume instead.
 */
export default function EmergencyStopButton({ controls }: { controls: MicrosegControls }) {
  const t = useTranslations('microsegPilot.stop')

  if (controls.status?.emergency_stop) return null

  return (
    <Button
      size='small'
      variant='outlined'
      color='error'
      startIcon={<i className='ri-stop-circle-line' />}
      onClick={() => controls.ask('stop')}
      sx={{ flexShrink: 0 }}
    >
      {t('button')}
    </Button>
  )
}
