'use client'

import { Box, IconButton, Link, Typography } from '@mui/material'

import type { PublicBroadcast } from '@/lib/broadcast/types'
import { BANNER_ROW_MIN_HEIGHT } from './bannerHeight'

interface Props {
  banner: PublicBroadcast
  onDismiss: (banner: PublicBroadcast) => void
}

/**
 * One banner row. The message is rendered as text, never as markup, which is
 * what makes an admin-authored string safe to show to every other user.
 * An emoji keeps its own colours and therefore ignores fgColor.
 */
export default function BroadcastBanner({ banner, onDismiss }: Props) {
  return (
    <Box
      role='status'
      sx={{
        // Own positioning context: the close button is absolutely placed, so
        // the row must not depend on a wrapper supplied by its parent.
        position: 'relative',
        minHeight: BANNER_ROW_MIN_HEIGHT,
        bgcolor: banner.bgColor,
        color: banner.fgColor,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1.5,
        px: 5,
        py: 0.5,
        textAlign: 'center',
      }}
    >
      <Typography variant='caption' sx={{ fontWeight: 600, fontSize: '0.8rem', color: 'inherit' }}>
        {banner.message}
      </Typography>
      {banner.linkUrl && banner.linkLabel ? (
        <Link
          href={banner.linkUrl}
          sx={{ color: 'inherit', fontSize: '0.8rem', fontWeight: 700, textDecorationColor: 'currentColor' }}
        >
          {banner.linkLabel}
        </Link>
      ) : null}
      {banner.dismissible ? (
        <IconButton
          size='small'
          aria-label='dismiss banner'
          onClick={() => onDismiss(banner)}
          sx={{ position: 'absolute', right: 4, color: 'inherit' }}
        >
          <i className='ri-close-line' style={{ fontSize: 16 }} />
        </IconButton>
      ) : null}
    </Box>
  )
}
