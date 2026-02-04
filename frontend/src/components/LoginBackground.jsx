'use client'

import { Box } from '@mui/material'

// Image de fond statique - placer votre image dans public/images/login-background.jpg
const BACKGROUND_IMAGE = '/images/login-background.jpg'

export default function LoginBackground({ children }) {
  return (
    <Box sx={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
      <Box
        sx={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundImage: `url(${BACKGROUND_IMAGE})`,
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
