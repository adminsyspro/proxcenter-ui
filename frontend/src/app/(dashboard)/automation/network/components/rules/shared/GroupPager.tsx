'use client'

import { useState } from 'react'
import { Box, IconButton, MenuItem, Select, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { SMALL_SELECT_SX } from '@/components/settings/destinations/DestinationDialogParts'

export const GROUP_PAGE_SIZES = [25, 50, 100] as const
export const GROUP_PAGE_SIZE = GROUP_PAGE_SIZES[0]

/** Number of pages of `count` rows at `size` per page (at least one). */
export const pageCount = (count: number, size: number) => Math.max(1, Math.ceil(count / size))

/**
 * Page per group of a paged list, and one page size for every group. A page beyond the end (the list shrank) is
 * clamped; `reset()` brings every group back to its first page (a new search).
 */
export function useGroupPages(initialSize: number = GROUP_PAGE_SIZE) {
  const [pages, setPages] = useState<Record<string, number>>({})
  const [size, setSizeState] = useState(initialSize)

  const pageOf = (group: string, count: number) => Math.min(pages[group] ?? 0, pageCount(count, size) - 1)
  const slice = <T,>(group: string, items: T[]) => {
    const page = pageOf(group, items.length)
    return items.slice(page * size, (page + 1) * size)
  }

  return {
    size,
    pageOf,
    slice,
    setPage: (group: string, page: number) => setPages(prev => ({ ...prev, [group]: page })),
    reset: () => setPages({}),
    // A new page size starts every group over: page 3 of 25 rows is not page 3 of 100.
    setSize: (next: number) => { setSizeState(next); setPages({}) },
  }
}

type Props = {
  count: number
  page: number
  size: number
  onPage: (page: number) => void
  onSize: (size: number) => void
  /** Names the list for the screen reader ("VLAN 20", the group name). */
  label: string
}

/** "Page X of N", previous and next, and the page size, at the bottom of a group; nothing while it fits one page. */
export default function GroupPager({ count, page, size, onPage, onSize, label }: Props) {
  const t = useTranslations('networkPage.vmPager')
  if (count <= GROUP_PAGE_SIZE) return null
  const pages = pageCount(count, size)

  return (
    <Box
      role='navigation'
      aria-label={t('navigation', { group: label })}
      sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1, flexWrap: 'wrap', py: 0.5 }}
    >
      <Typography variant='caption' color='text.secondary' noWrap>{t('perPage')}</Typography>
      <Select
        size='small'
        value={size}
        onChange={e => onSize(Number(e.target.value))}
        inputProps={{ 'aria-label': t('perPageLabel', { group: label }) }}
        sx={{ ...SMALL_SELECT_SX, fontSize: 12 }}
      >
        {GROUP_PAGE_SIZES.map(n => <MenuItem key={n} value={n}>{n}</MenuItem>)}
      </Select>
      <Typography variant='body2' color='text.secondary' noWrap sx={{ ml: 1 }}>
        {t('page', { page: page + 1, pages })}
      </Typography>
      <IconButton size='small' aria-label={t('previous')} disabled={page === 0} onClick={() => onPage(page - 1)}>
        <i className='ri-arrow-left-s-line' />
      </IconButton>
      <IconButton size='small' aria-label={t('next')} disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>
        <i className='ri-arrow-right-s-line' />
      </IconButton>
    </Box>
  )
}
