'use client'

import { Box, Paper, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import TwoFactorEnrollWizard from '@/components/profile/TwoFactorEnrollWizard'

export default function ForcedEnrollmentPage() {
  const t = useTranslations()

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 3,
      }}
    >
      <Paper
        variant='outlined'
        sx={{
          maxWidth: 640,
          width: '100%',
          p: { xs: 3, sm: 5 },
        }}
      >
        <Typography variant='h5' sx={{ fontWeight: 600, mb: 1 }}>
          {t('twoFactor.forcedTitle')}
        </Typography>
        <Typography variant='body2' color='text.secondary' sx={{ mb: 3 }}>
          {t('twoFactor.forcedBody')}
        </Typography>
        <TwoFactorEnrollWizard
          inline
          forced
          onDone={() => {
            window.location.href = '/home'
          }}
        />
      </Paper>
    </Box>
  )
}
