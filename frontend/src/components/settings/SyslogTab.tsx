'use client'

// Settings > Syslog / SIEM (issue #184): forward the audit log to syslog
// collectors and SIEM platforms. Own tab, gated by Features.SYSLOG_FORWARDING
// in settings/page.jsx and by requireSyslogAdmin() on its routes.

import { useTranslations } from 'next-intl'
import { Box, Stack, Typography } from '@mui/material'

import SyslogDestinationsCard from './SyslogDestinationsCard'

export default function SyslogTab() {
  const t = useTranslations('settings.syslog')

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant='h5' fontWeight={600}>
          {t('title')}
        </Typography>
        <Typography variant='body2' color='text.secondary'>
          {t('description')}
        </Typography>
      </Box>

      <SyslogDestinationsCard />
    </Stack>
  )
}
