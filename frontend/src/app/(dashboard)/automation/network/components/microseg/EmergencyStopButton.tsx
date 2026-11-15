'use client'

import { Button } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { MicrosegControls } from './useMicrosegControls'
import { WriteTip, useMicrosegWrite } from './microsegAccess'

/**
 * The Emergency stop, at the right end of the sub-tabs row. Reachable whatever the status: the stop is idempotent,
 * and it is needed most when the engine misbehaves. Nothing deployed, nothing to stop: it waits for a first revision. While the stop is on, the banner offers Resume instead.
 */
export default function EmergencyStopButton({ controls, deployed }: { controls: MicrosegControls; deployed: boolean }) {
  const t = useTranslations('microsegPilot.stop')
  const { canWrite } = useMicrosegWrite()

  if (controls.status?.emergency_stop) return null

  return (
    <WriteTip title={deployed ? undefined : t('notDeployed')}>
    <Button
      size='small'
      variant='outlined'
      color='error'
      startIcon={<i className='ri-stop-circle-line' />}
      onClick={() => controls.ask('stop')}
      disabled={!canWrite || !deployed}
      sx={{ flexShrink: 0 }}
    >
      {t('button')}
    </Button>
    </WriteTip>
  )
}
