'use client'

import { useTranslations } from 'next-intl'
import { Box, IconButton, Link, Typography } from '@mui/material'

import { isSafeBannerLink } from '@/lib/broadcast/links'
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
 *
 * The link is re-validated with isSafeBannerLink on the read path too: the
 * write path (broadcastMessageSchema) already rejects an unsafe scheme such
 * as javascript:, but a row can reach this table another way (a direct SQL
 * write, a restored dump, a future write path that forgets to validate), so
 * rendering never trusts the column alone.
 */
export default function BroadcastBanner({ banner, onDismiss }: Props) {
  const t = useTranslations('common')
  const hasSafeLink = !!banner.linkUrl && !!banner.linkLabel && isSafeBannerLink(banner.linkUrl)

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
      {hasSafeLink ? (
        <Link
          href={banner.linkUrl as string}
          sx={{ color: 'inherit', fontSize: '0.8rem', fontWeight: 700, textDecorationColor: 'currentColor' }}
        >
          {banner.linkLabel}
        </Link>
      ) : null}
      {banner.dismissible ? (
        <IconButton
          size='small'
          aria-label={t('close')}
          onClick={() => onDismiss(banner)}
          sx={{ position: 'absolute', right: 4, color: 'inherit' }}
        >
          <i className='ri-close-line' style={{ fontSize: 16 }} />
        </IconButton>
      ) : null}
    </Box>
  )
}
