'use client'

import { useState } from 'react'

import { Alert, Box, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { tooltipSlotProps } from '@/components/settings/ha/tooltipSlotProps'
import { copyToClipboard } from '@/lib/clipboard'

/** The one-time display of a token secret, after a creation or a rotation. */
export default function TokenSecretReveal({ secret }: { secret: string }) {
  const t = useTranslations('settings.apiTokens.reveal')
  const [copied, setCopied] = useState(false)

  return (
    <Stack spacing={2}>
      <Alert severity='warning'>{t('warning')}</Alert>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'action.hover', borderRadius: 1, p: 1.5 }}>
        <Typography sx={{ fontFamily: 'monospace', wordBreak: 'break-all', flex: 1 }}>{secret}</Typography>
        <Tooltip title={copied ? t('copied') : t('copy')} slotProps={tooltipSlotProps}>
          <IconButton aria-label={t('copy')} onClick={async () => setCopied(await copyToClipboard(secret))}>
            <i className='ri-file-copy-line' />
          </IconButton>
        </Tooltip>
      </Box>
    </Stack>
  )
}
