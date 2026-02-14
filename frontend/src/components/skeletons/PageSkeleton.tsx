'use client'

import { Box } from '@mui/material'

import CardsSkeleton from './CardsSkeleton'
import ChartSkeleton from './ChartSkeleton'
import TableSkeleton from './TableSkeleton'

export default function PageSkeleton() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <CardsSkeleton count={4} columns={4} />
      <ChartSkeleton height={300} />
      <TableSkeleton rows={5} columns={5} />
    </Box>
  )
}
