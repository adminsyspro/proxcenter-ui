'use client'

import { Alert, Box, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { usePendingChanges, type PendingGuest } from '@/hooks/usePendingChanges'

/** Keys listed per guest before "+N". */
const MAX_KEYS = 6

/**
 * Migration preflight (#926): warns when guests about to be live-migrated have
 * configuration changes that wait for a restart, which PVE may then fail to
 * carry to the target. Pass only the guests that will be migrated while
 * running; stopped guests move with their whole configuration.
 */
export default function PendingChangesWarning({ guests, sx }: Readonly<{ guests: ReadonlyArray<PendingGuest>; sx?: Record<string, unknown> }>) {
  const t = useTranslations()
  const { flagged } = usePendingChanges(guests)

  if (flagged.length === 0) return null

  return (
    <Alert severity="warning" icon={<i className="ri-time-line" style={{ fontSize: 20 }} />} sx={sx}>
      <Typography variant="body2" fontWeight={600}>
        {t('migrationPreflight.pendingTitle', { count: flagged.length })}
      </Typography>
      <Typography variant="body2" sx={{ mt: 0.5, opacity: 0.85 }}>
        {t('migrationPreflight.pendingBody')}
      </Typography>
      <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
        {flagged.map(({ guest, changes }) => {
          const keys = changes.map(c => c.key)
          const shown = keys.slice(0, MAX_KEYS).join(', ') + (keys.length > MAX_KEYS ? ` +${keys.length - MAX_KEYS}` : '')

          return (
            <Typography component="li" variant="body2" key={`${guest.connId}:${guest.vmid}`}>
              <strong>{guest.name || guest.vmid}</strong>{guest.name ? ` (${guest.vmid})` : ''}: {shown}
            </Typography>
          )
        })}
      </Box>
    </Alert>
  )
}
