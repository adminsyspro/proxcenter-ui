'use client'

import { useState } from 'react'
import { TablePagination } from '@mui/material'
import { useTranslations } from 'next-intl'

export const POLICY_PAGE_SIZE = 10

/** The rows of the current page; the page is clamped when the list shrinks. */
export function usePaged<T>(items: T[], size = POLICY_PAGE_SIZE) {
  const [page, setPage] = useState(0)
  const last = Math.max(0, Math.ceil(items.length / size) - 1)
  const current = Math.min(page, last)
  return { rows: items.slice(current * size, (current + 1) * size), page: current, setPage, count: items.length, size }
}

type Props = { count: number; page: number; size: number; onPage: (page: number) => void }

/** Pagination of a list of the policy; nothing is drawn while everything fits on one page. */
export default function PolicyPager({ count, page, size, onPage }: Props) {
  const t = useTranslations('microsegPilot.policy.pager')
  if (count <= size) return null
  return (
    <TablePagination
      component='div'
      count={count}
      page={page}
      rowsPerPage={size}
      rowsPerPageOptions={[size]}
      onPageChange={(_, value) => onPage(value)}
      labelDisplayedRows={({ from, to, count: total }) => t('range', { from, to, count: total })}
      getItemAriaLabel={type => t(type)}
      sx={{ '& .MuiTablePagination-toolbar': { minHeight: 40, pl: 1 } }}
    />
  )
}
