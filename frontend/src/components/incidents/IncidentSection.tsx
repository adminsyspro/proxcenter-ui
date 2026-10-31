'use client'

import type { ReactNode } from 'react'

import { Box, Typography } from '@mui/material'

interface Props {
  icon: string
  title: string
  /** One sentence on what the section is for. */
  description: string
  children: ReactNode
}

/** A card of the incident window: an icon, a title, what the section is for, then its content. */
export default function IncidentSection({ icon, title, description, children }: Readonly<Props>) {
  return (
    <Box component='section' aria-label={title} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2.5 }}>
        <Box sx={{ width: 32, height: 32, flexShrink: 0, borderRadius: 1, display: 'grid', placeItems: 'center', bgcolor: 'action.hover', color: 'text.secondary', fontSize: 18 }}>
          <i className={icon} aria-hidden='true' />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant='subtitle1' sx={{ fontWeight: 600, lineHeight: 1.5 }}>{title}</Typography>
          <Typography variant='body2' color='text.secondary'>{description}</Typography>
        </Box>
      </Box>
      {children}
    </Box>
  )
}
