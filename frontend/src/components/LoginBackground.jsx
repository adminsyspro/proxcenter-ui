'use client'

import { useState, useEffect } from 'react'
import { Box } from '@mui/material'

// Fallback static image
const DEFAULT_BACKGROUND = '/images/login-background.jpg'

export default function LoginBackground({ children }) {
  const [backgroundUrl, setBackgroundUrl] = useState(DEFAULT_BACKGROUND)

  useEffect(() => {
    fetch('/api/v1/settings/login-background')
      .then(res => res.json())
      .then(data => {
        if (data.imageUrl) {
          setBackgroundUrl(data.imageUrl)
        }
      })
      .catch(() => {})
  }, [])

  return (
    <Box sx={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
      <Box
        sx={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundImage: `url(${backgroundUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      />
      {/* Overlay sombre pour la lisibilité */}
      <Box
        sx={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.4)',
          pointerEvents: 'none'
        }}
      />
      <Box sx={{ position: 'relative', zIndex: 1, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
        {children}
      </Box>
    </Box>
  )
}
