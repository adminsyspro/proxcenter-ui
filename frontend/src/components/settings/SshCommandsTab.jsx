'use client'

import { useTranslations } from 'next-intl'
import { Box, Stack, Typography } from '@mui/material'
import ConnectionStatusCard from './ssh-commands/ConnectionStatusCard'
import AllowlistCard from './ssh-commands/AllowlistCard'
import SecurityRecommendationsCard from './ssh-commands/SecurityRecommendationsCard'

export default function SshCommandsTab() {
  const t = useTranslations()

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant='h5' fontWeight={600}>
          {t('settings.sshCommands.page.title')}
        </Typography>
        <Typography variant='body2' color='text.secondary'>
          {t('settings.sshCommands.page.subtitle')}
        </Typography>
      </Box>

      <ConnectionStatusCard />

      <SecurityRecommendationsCard />

      <AllowlistCard />
    </Stack>
  )
}
