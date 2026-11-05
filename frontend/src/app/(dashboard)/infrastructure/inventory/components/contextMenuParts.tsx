'use client'

import React from 'react'

import { Box, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'

// One icon column for every context-menu row: a single size for all of them, and
// a tone taken from the theme palette rather than the brighter MUI defaults the
// menu used to mix in.
export const MenuIcon = ({ name, tone = 'text.secondary' }: { name: string; tone?: string }) => (
  <Box
    component="i"
    className={name}
    sx={{ fontSize: 16, lineHeight: 1, color: tone, width: 16, display: 'inline-flex', justifyContent: 'center', flexShrink: 0 }}
  />
)

// Shared shell for the inventory context menus (guests, nodes, clusters, pools): inset rows with a rounded hover, one
// exact icon gutter, and dividers that separate without cutting the card in two.
export const contextMenuPaperSx = {
  minWidth: 232,
  maxWidth: 320,
  borderRadius: 2,
  py: 0.5,
  '& .MuiMenuItem-root': {
    mx: 0.75,
    px: 1,
    py: 0.5,
    gap: 1.25,
    minHeight: 34,
    borderRadius: 1,
  },
  '& .MuiListItemIcon-root': { minWidth: 0 },
  '& .MuiListItemText-primary': { fontSize: '0.8125rem' },
  '& .MuiDivider-root': { mx: 1, my: 0.5 },
} as const

// Menu title: the subject of the actions below, not another row to click. Wears
// the theme accent so the card reads as titled, and sits on the same left edge
// and icon gutter as the rows underneath. It carries the tint, so no divider.
export const ContextMenuHeader = ({ icon, label, hint }: { icon: React.ReactNode; label?: string; hint?: string }) => (
  <Box
    sx={{
      display: 'flex',
      alignItems: 'center',
      gap: 1.25,
      mx: 0.75,
      mb: 0.5,
      px: 1,
      py: 0.75,
      borderRadius: 1,
      bgcolor: theme => alpha(theme.palette.primary.main, 0.08),
    }}
  >
    {icon}
    <Typography
      noWrap
      sx={{ minWidth: 0, fontSize: '0.8125rem', fontWeight: 600, color: 'primary.main', letterSpacing: '0.01em' }}
    >
      {label}
    </Typography>
    {hint && (
      <Typography sx={{ fontSize: '0.6875rem', color: 'primary.main', opacity: 0.65, ml: 'auto', pl: 1 }}>
        {hint}
      </Typography>
    )}
  </Box>
)
