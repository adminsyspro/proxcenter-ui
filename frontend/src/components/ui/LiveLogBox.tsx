'use client'

import type { ReactNode } from 'react'

import { useTranslations } from 'next-intl'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import type { SxProps, Theme } from '@mui/material/styles'

import { useFollowTail } from '@/hooks/useFollowTail'

/**
 * Scroller of a live log (#1201): follows the new lines like a terminal, pauses
 * while the reader scrolls up, and offers "Jump to latest" until they are back
 * at the bottom.
 *
 * `sx` styles the scroller itself, `wrapperSx` the positioned box around it
 * (give it the flex sizing when the scroller has to fill a column).
 * `jumpButton={false}` keeps the follow without the button: only the migrate
 * dialog shows it.
 */
export default function LiveLogBox({
  lineCount,
  resetKey,
  sx,
  wrapperSx,
  jumpButton = true,
  children,
}: Readonly<{
  lineCount: number
  resetKey?: unknown
  sx?: SxProps<Theme>
  wrapperSx?: SxProps<Theme>
  jumpButton?: boolean
  children: ReactNode
}>) {
  const t = useTranslations()
  const { ref, following, onScroll, jumpToTail } = useFollowTail<HTMLDivElement>(lineCount, resetKey)

  return (
    <Box sx={[{ position: 'relative' }, ...(Array.isArray(wrapperSx) ? wrapperSx : [wrapperSx])]}>
      <Box ref={ref} onScroll={onScroll} data-testid="live-log-scroller" sx={sx}>
        {children}
      </Box>
      {jumpButton && !following && (
        <Button
          size="small"
          variant="contained"
          onClick={jumpToTail}
          startIcon={<i className="ri-arrow-down-line" style={{ fontSize: 14 }} />}
          sx={{
            position: 'absolute', right: 16, bottom: 10, zIndex: 1,
            py: 0.25, px: 1.25, minWidth: 0, borderRadius: 5,
            fontSize: 11, textTransform: 'none', boxShadow: 3,
          }}
        >
          {t('common.jumpToLatest')}
        </Button>
      )}
    </Box>
  )
}
