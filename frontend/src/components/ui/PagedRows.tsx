'use client'

import React, { useState } from 'react'

import { TablePagination } from '@mui/material'
import { useTranslations } from 'next-intl'

import { pageOf } from '@/lib/paging'

/** Rows per page offered by every paged list. */
export const PAGE_SIZES = [20, 50, 100]

/**
 * The pager stays at the bottom of whatever scrolls around it (a card, a
 * dashboard, a dialog) instead of showing up only once scrolled to the end.
 */
export const STICKY_PAGER_SX = {
  position: 'sticky',
  bottom: 0,
  zIndex: 2,
  bgcolor: 'background.paper',
  borderTop: '1px solid',
  borderColor: 'divider',
  '& .MuiTablePagination-toolbar': { minHeight: 36 },
} as const

interface PagedRowsProps<T> {
  items: T[]
  children: (item: T, index: number) => React.ReactNode
  testId?: string
}

/**
 * Renders `items` one page at a time, with the pager below the rows once the
 * list is longer than the smallest page. A list of data is never cut at N rows:
 * every row stays reachable.
 */
export default function PagedRows<T>({ items, children, testId }: PagedRowsProps<T>) {
  const t = useTranslations()
  const [page, setPage] = useState(0)
  const [perPage, setPerPage] = useState(PAGE_SIZES[0])
  const { rows, page: current } = pageOf(items, page, perPage)
  return (
    <>
      {rows.map((item, i) => children(item, current * perPage + i))}
      {items.length > PAGE_SIZES[0] && (
        <TablePagination
          component="div"
          count={items.length}
          page={current}
          onPageChange={(_e, p) => setPage(p)}
          rowsPerPage={perPage}
          onRowsPerPageChange={e => { setPerPage(Number(e.target.value)); setPage(0) }}
          rowsPerPageOptions={PAGE_SIZES}
          labelRowsPerPage={t('common.rowsPerPage')}
          sx={STICKY_PAGER_SX}
          data-testid={testId}
        />
      )}
    </>
  )
}
