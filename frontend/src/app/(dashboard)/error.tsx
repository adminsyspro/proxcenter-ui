'use client'

import { useEffect } from 'react'
import { Box, Typography, Button } from '@mui/material'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Dashboard error:', error)
  }, [error])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 2 }}>
      <Typography variant="h5">Something went wrong</Typography>
      <Typography color="text.secondary">{error.message}</Typography>
      <Button variant="contained" onClick={() => reset()}>Try again</Button>
    </Box>
  )
}
