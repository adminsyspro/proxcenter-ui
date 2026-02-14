'use client'

import { Skeleton } from '@mui/material'

interface ChartSkeletonProps {
  height?: number
}

export default function ChartSkeleton({ height = 300 }: ChartSkeletonProps) {
  return (
    <Skeleton
      variant="rounded"
      height={height}
      sx={{ borderRadius: 1 }}
    />
  )
}
