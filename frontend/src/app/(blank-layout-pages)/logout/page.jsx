'use client'

import { useEffect } from 'react'

import { useTranslations } from 'next-intl'

import { federatedSignOut } from '@/lib/auth/federatedSignOut'
import { Box, CircularProgress, Typography } from '@mui/material'

export default function LogoutPage() {
  const t = useTranslations()

  useEffect(() => {
    // Auto logout and redirect to login. Federated so the IdP session goes too.
    federatedSignOut('/login')
  }, [])

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
      }}
    >
      <CircularProgress />
      <Typography variant='body1' sx={{ opacity: 0.7 }}>
        {t('auth.loggingOut')}
      </Typography>
    </Box>
  )
}
