'use client'

import { Box, Link, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

export default function LoginFooter({ branding }) {
  const t = useTranslations()

  const docsNode = branding.docsUrl && (
    <Link
      href={branding.docsUrl}
      target='_blank'
      rel='noopener noreferrer'
      underline='hover'
      color='inherit'
    >
      {t('auth.docs')}
    </Link>
  )

  const supportNode = branding.supportUrl && (
    <Link
      href={branding.supportUrl}
      target='_blank'
      rel='noopener noreferrer'
      underline='hover'
      color='inherit'
    >
      {t('auth.support')}
    </Link>
  )

  const items = [docsNode, supportNode].filter(Boolean)

  if (items.length === 0) return null

  return (
    <Box
      sx={{
        mt: 'auto',
        pt: 4,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1.5,
        color: '#e7eaf3',
        opacity: 0.55,
      }}
    >
      {items.map((node, i) => (
        <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {i > 0 && <Typography variant='caption' aria-hidden>·</Typography>}
          <Typography variant='caption' component='span'>{node}</Typography>
        </Box>
      ))}
    </Box>
  )
}
