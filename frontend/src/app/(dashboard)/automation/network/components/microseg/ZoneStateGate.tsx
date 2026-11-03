'use client'

import { Box, Button } from '@mui/material'
import { useTranslations } from 'next-intl'

import { OneLine } from './dialogParts'

type Props = {
  /** The draft has unapplied changes: the state change would apply them unseen, so it is refused. */
  pending: boolean
  /** How many, when it is known. */
  count: number | null
  /** Opens the plan window (closes the state dialog first). */
  onViewPlan?: () => void
}

/**
 * What every zone state dialog says: the change goes to Proxmox at once as a new revision, and it waits for the
 * pending changes of the draft to be applied or discarded (UA30): a state change applies the whole draft.
 */
export default function ZoneStateGate({ pending, count, onViewPlan }: Props) {
  const t = useTranslations('microsegPilot')
  return (
    <>
      <OneLine text={t('policy.state.immediate')} />
      {pending && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <Box sx={{ flex: '1 1 0', minWidth: 0 }}>
            <OneLine
              color='warning.main'
              text={count ? t('policy.state.pendingFirst', { count }) : t('policy.state.pendingFirstNoCount')}
            />
          </Box>
          {onViewPlan && (
            <Button size='small' variant='outlined' color='warning' onClick={onViewPlan} sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
              {t('pending.viewPlan')}
            </Button>
          )}
        </Box>
      )}
    </>
  )
}
