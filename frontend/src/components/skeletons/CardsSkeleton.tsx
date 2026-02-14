'use client'

import { Box, Skeleton } from '@mui/material'

interface CardsSkeletonProps {
  count?: number
  columns?: number
}

export default function CardsSkeleton({ count = 4, columns = 4 }: CardsSkeletonProps) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: '1fr',
          sm: `repeat(${Math.min(columns, 2)}, 1fr)`,
          md: `repeat(${columns}, 1fr)`,
        },
        gap: 2,
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton
          key={i}
          variant="rounded"
          height={120}
          sx={{ borderRadius: 1 }}
        />
      ))}
    </Box>
  )
}
