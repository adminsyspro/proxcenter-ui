'use client'

import { useEffect } from 'react'

import { signOut } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import { Box, CircularProgress, Typography } from '@mui/material'

export default function LogoutPage() {
  const t = useTranslations()

  useEffect(() => {
    // Auto logout and redirect to login
    signOut({ callbackUrl: '/login' })
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
