'use client'

import { useEffect } from 'react'

import { useTranslations } from 'next-intl'

import { Box, Card, CardContent, Typography, Chip, Divider } from '@mui/material'

import { usePageTitle } from '@/contexts/PageTitleContext'

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
            <Chip label='v1.0.0' color='primary' size='small' />
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
