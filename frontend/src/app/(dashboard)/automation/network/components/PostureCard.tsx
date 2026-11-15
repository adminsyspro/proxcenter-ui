'use client'

import { paletteAlpha } from './paletteAlpha'
import { Box, Paper, Tooltip, Typography, useTheme } from '@mui/material'

type Props = {
  testId: string
  title: string
  /** A short line after the title (what the figures are made of). */
  caption?: string
  /** What the caption leaves out, behind an information icon after it. */
  hint?: string
  /** Something on the right of the title (a select). */
  action?: React.ReactNode
  /** Takes the free height of a column of cards (its body can then fill it). */
  grow?: boolean
  children: React.ReactNode
}

/** One block of the Posture Dashboard: a paper with its title, its caption and an action, the same for all. */
export default function PostureCard({ testId, title, caption, hint, action, grow = false, children }: Props) {
  const theme = useTheme()
  return (
    <Paper data-testid={testId} sx={{ p: 2.5, border: `1px solid ${paletteAlpha(theme, 'divider', 0.1)}`, minWidth: 0, height: grow ? 'auto' : '100%', flex: grow ? '1 1 auto' : undefined, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', minWidth: 0 }}>
        <Typography variant='subtitle1' component='h2' sx={{ fontWeight: 700 }}>{title}</Typography>
        {caption && <Typography variant='caption' color='text.secondary' data-testid={`${testId}-caption`}>{caption}</Typography>}
        {hint && (
          <Tooltip title={hint}>
            <Box component='i' className='ri-information-line' tabIndex={0} role='img' aria-label={hint} data-testid={`${testId}-hint`} sx={{ fontSize: 16, lineHeight: 1, color: 'text.secondary', ml: -0.75, cursor: 'help' }} />
          </Tooltip>
        )}
        {action && <Box sx={{ ml: 'auto' }}>{action}</Box>}
      </Box>
      {children}
    </Paper>
  )
}
