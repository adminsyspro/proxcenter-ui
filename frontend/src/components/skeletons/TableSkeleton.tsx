'use client'

import {
  Box,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material'

interface TableSkeletonProps {
  rows?: number
  columns?: number
  hasHeader?: boolean
}

export default function TableSkeleton({
  rows = 5,
  columns = 5,
  hasHeader = true,
}: TableSkeletonProps) {
  return (
    <TableContainer>
      <Table size="small">
        {hasHeader && (
          <TableHead>
            <TableRow>
              {Array.from({ length: columns }).map((_, i) => (
                <TableCell key={i}>
                  <Skeleton variant="text" width={i === 0 ? '60%' : '80%'} height={20} />
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
        )}
        <TableBody>
          {Array.from({ length: rows }).map((_, rowIdx) => (
            <TableRow key={rowIdx}>
              {Array.from({ length: columns }).map((_, colIdx) => (
                <TableCell key={colIdx}>
                  <Skeleton
                    variant="text"
                    width={colIdx === 0 ? '70%' : `${50 + Math.random() * 40}%`}
                    height={18}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
