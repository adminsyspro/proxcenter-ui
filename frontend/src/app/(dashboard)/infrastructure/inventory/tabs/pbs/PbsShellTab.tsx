'use client'

import React, { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Box, Button, Card, CardContent, Typography } from '@mui/material'

interface PbsShellTabProps {
  pbsId: string
}

export default function PbsShellTab({ pbsId }: PbsShellTabProps) {
  const t = useTranslations()

  const [baseUrl, setBaseUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/v1/pbs/${pbsId}/info`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(body => {
        if (!cancelled && body?.data?.baseUrl) {
          setBaseUrl(String(body.data.baseUrl))
        }
      })
      .catch(() => {
        /* non-fatal */
      })
    return () => {
      cancelled = true
    }
  }, [pbsId])

  const openPbsUi = () => {
    if (baseUrl) {
      window.open(baseUrl, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <Box
      sx={{
        p: 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
        minHeight: 400,
      }}
    >
      <Card variant="outlined" sx={{ maxWidth: 560, width: '100%' }}>
        <CardContent sx={{ textAlign: 'center', py: 5, px: 3 }}>
          <i
            className="ri-terminal-box-line"
            style={{ fontSize: 64, opacity: 0.6, display: 'inline-block' }}
          />
          <Typography variant="h6" sx={{ fontWeight: 700, mt: 2 }}>
            {t('inventory.pbsShellComingTitle')}
          </Typography>
          <Typography variant="body2" sx={{ opacity: 0.8, mt: 1.5, mb: 3 }}>
            {t('inventory.pbsShellComingBody')}
          </Typography>
          <Button
            variant="outlined"
            onClick={openPbsUi}
            disabled={!baseUrl}
            startIcon={<i className="ri-external-link-line" style={{ fontSize: 16 }} />}
          >
            {t('inventory.pbsShellOpenPbsUi')}
          </Button>
        </CardContent>
      </Card>
    </Box>
  )
}
