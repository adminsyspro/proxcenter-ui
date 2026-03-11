'use client'

import { useEffect } from 'react'
import { Box, Typography } from '@mui/material'

const BANNER_HEIGHT = 32

export default function DemoBanner() {
  const isDemo = process.env.NEXT_PUBLIC_DEMO_MODE === 'true'

  useEffect(() => {
    if (!isDemo) return
    document.documentElement.style.setProperty('--demo-banner-height', `${BANNER_HEIGHT}px`)
    document.body.style.paddingTop = `${BANNER_HEIGHT}px`
    return () => {
      document.documentElement.style.removeProperty('--demo-banner-height')
      document.body.style.paddingTop = ''
    }
  }, [isDemo])

  if (!isDemo) return null

  return (
    <Box
      sx={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: BANNER_HEIGHT,
        zIndex: 1300,
        bgcolor: '#f59e0b',
        color: '#000',
        textAlign: 'center',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
    >
      <i className='ri-information-line' style={{ fontSize: 16 }} />
      <Typography variant='caption' sx={{ fontWeight: 600, fontSize: '0.8rem', color: 'inherit' }}>
        Demo Mode — Data shown is simulated. Actions are read-only.
      </Typography>
    </Box>
  )
}
