'use client'

import type { ReactNode } from 'react'
import { Box, Button, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

type Props = {
  /** The draft has unapplied changes: the state change would apply them unseen, so it is refused. */
  pending: boolean
  /** How many, when it is known. */
  count: number | null
  /** Opens the plan window (closes the state dialog first). */
  onViewPlan?: () => void
  /** The other way out of the refusal: discard the pending changes (DiscardDraft). */
  discard?: ReactNode
}

/**
 * What every zone state dialog says: the change goes to Proxmox at once as a new revision, and it waits for the
 * pending changes of the draft to be applied or discarded (UA30): a state change applies the whole draft.
 */
export default function ZoneStateGate({ pending, count, onViewPlan, discard }: Props) {
  const t = useTranslations('microsegPilot')
  return (
    <>
      {/* These lines are the reason of the refusal: they wrap rather than hide behind an ellipsis. */}
      <Typography color='text.secondary'>{t('policy.state.immediate')}</Typography>
      {pending && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flexWrap: 'wrap' }}>
          <Typography color='warning.main' sx={{ flex: '1 1 240px', minWidth: 0 }}>
            {count ? t('policy.state.pendingFirst', { count }) : t('policy.state.pendingFirstNoCount')}
          </Typography>
          {discard}
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
