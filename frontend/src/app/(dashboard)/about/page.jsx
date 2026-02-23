'use client'

import { useEffect } from 'react'

import { useTranslations } from 'next-intl'

import { Box, Card, CardContent, Typography, Chip, Divider } from '@mui/material'

import { usePageTitle } from '@/contexts/PageTitleContext'
import { GIT_SHA, GITHUB_URL } from '@/config/version'

export default function AboutPage() {
  const { setPageInfo } = usePageTitle()
  const t = useTranslations()

  useEffect(() => {
    setPageInfo(t('aboutPage.title'), t('aboutPage.subtitle'), 'ri-information-line')

return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  return (
    <Box sx={{ p: 3, maxWidth: 800 }}>
      <Card variant='outlined'>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
            <Typography variant='h4' sx={{ fontWeight: 800 }}>ProxCenter</Typography>
            <Chip
              label={GIT_SHA ? GIT_SHA.substring(0, 7) : 'dev'}
              color='primary'
              size='small'
              component={GIT_SHA ? 'a' : 'span'}
              href={GIT_SHA ? `${GITHUB_URL}/commit/${GIT_SHA}` : undefined}
              target='_blank'
              rel='noopener noreferrer'
              clickable={!!GIT_SHA}
              sx={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}
            />
          </Box>
          <Typography variant='body1' sx={{ mb: 2, opacity: 0.8 }}>
            {t('aboutPage.description')}
          </Typography>
          <Divider sx={{ my: 2 }} />
          <Typography variant='body2' sx={{ opacity: 0.6 }}>
            {t('aboutPage.copyright')}
          </Typography>
        </CardContent>
      </Card>
    </Box>
  )
}
