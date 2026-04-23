'use client'

import { useTranslations } from 'next-intl'
import { Box, Card, CardContent, Stack, Typography } from '@mui/material'
import ConnectionStatusCard from './ssh-commands/ConnectionStatusCard'
import AllowlistCard from './ssh-commands/AllowlistCard'

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

      <Card variant='outlined'>
        <CardContent>
          <Typography variant='subtitle1' fontWeight={600} gutterBottom>
            {t('settings.sshCommands.recs.heading')}
          </Typography>
          <Typography variant='body2' color='text.secondary'>
            {/* SecurityRecommendationsCard placeholder — Task 8 */}
            …
          </Typography>
        </CardContent>
      </Card>

      <AllowlistCard />
    </Stack>
  )
}
