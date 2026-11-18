'use client'

import { useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import { Box } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'

const DEFAULT_BACKGROUND = '/images/login-background.jpg'

interface LoginBackgroundProps {
  children?: ReactNode
  inPanel?: boolean
  overlayOpacity?: number
}

export default function LoginBackground({ children, inPanel = false, overlayOpacity = 0.4 }: LoginBackgroundProps) {
  const [backgroundUrl, setBackgroundUrl] = useState(DEFAULT_BACKGROUND)

  useEffect(() => {
    fetch('/api/v1/settings/login-background')
      .then(res => res.json())
      .then(data => {
        if (data.imageUrl) setBackgroundUrl(data.imageUrl)
      })
      .catch(() => {})
  }, [])

  const containerSx: SxProps<Theme> = inPanel
    ? { position: 'absolute', inset: 0, overflow: 'hidden' }
    : { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }

  return (
    <Box sx={containerSx}>
      <Box
        sx={{
          position: 'absolute', inset: 0,
          backgroundImage: `url(${backgroundUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      />
      <Box
        sx={{
          position: 'absolute', inset: 0,
          backgroundColor: `rgba(0, 0, 0, ${overlayOpacity})`,
          pointerEvents: 'none',
        }}
      />
      {!inPanel && (
        <Box sx={{ position: 'relative', zIndex: 1, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
          {children}
        </Box>
      )}
      {inPanel && children}
    </Box>
  )
}
