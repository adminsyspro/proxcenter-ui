'use client'

import { Box, Typography } from '@mui/material'

import { BANNER_ROW_MIN_HEIGHT } from './broadcast/bannerHeight'

export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === 'true'
}

/**
 * Demo-mode row. It used to be a fixed element that set body padding-top and
 * its own layout custom property that nothing ever read; both jobs now
 * belong to TopBannerStack, which is also the only writer of
 * --top-banner-height. Rendering is unchanged for the user.
 */
export default function DemoBanner() {
  if (!isDemoMode()) return null

  return (
    <Box
      sx={{
        minHeight: BANNER_ROW_MIN_HEIGHT,
        bgcolor: '#f59e0b',
        color: '#000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
      }}
    >
      <i className='ri-information-line' style={{ fontSize: 16 }} />
      <Typography variant='caption' sx={{ fontWeight: 600, fontSize: '0.8rem', color: 'inherit' }}>
        Demo Mode — Data shown is simulated. Actions are read-only.
      </Typography>
    </Box>
  )
}
