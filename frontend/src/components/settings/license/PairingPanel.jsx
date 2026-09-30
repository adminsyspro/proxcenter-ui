'use client'

import { Box, Button, Card, CardContent, Chip, Typography } from '@mui/material'

import { LogoIcon } from '@components/layout/shared/Logo'

// Connecting to proxcenter.io: the code to confirm on the portal account.
export default function PairingPanel({ connection, t, busy, onCancel }) {
  const minutesLeft = connection.pairing_expires_at
    ? Math.max(0, Math.ceil((new Date(connection.pairing_expires_at).getTime() - Date.now()) / 60000))
    : 0
  const openUrl = connection.verification_url
    ? `${connection.verification_url}?code=${encodeURIComponent(connection.user_code || '')}`
    : null

  return (
    <Card variant='outlined' sx={{ mb: 2 }}>
      <CardContent sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <Box sx={{ width: 48, height: 48, borderRadius: 2, border: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.primary', flexShrink: 0 }}>
            <LogoIcon size={30} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant='h6' fontWeight={700}>{t('settings.licenseTab.pairing.title')}</Typography>
            <Typography variant='body2' color='text.secondary'>{t('settings.licenseTab.pairing.step')}</Typography>
          </Box>
          <Chip size='small' color='info' variant='outlined' icon={<i className='ri-time-line' />} label={t('settings.licenseTab.pairing.pill')} />
        </Box>
        <Typography variant='body2' color='text.secondary' sx={{ mt: 2 }}>{t('settings.licenseTab.pairing.hint')}</Typography>
        <Typography variant='h4' sx={{ fontFamily: 'JetBrains Mono, monospace', letterSpacing: 4, fontWeight: 700, mt: 1.5 }}>{connection.user_code}</Typography>
        <Typography variant='caption' color='text.secondary'>{t('settings.licenseConnectionPairingExpires', { minutes: minutesLeft })}</Typography>
        <Box sx={{ display: 'flex', gap: 1.5, mt: 2, flexWrap: 'wrap' }}>
          {openUrl && (
            <Button variant='contained' size='small' href={openUrl} target='_blank' rel='noopener noreferrer' startIcon={<i className='ri-external-link-line' />}>
              {t('settings.licenseConnectionOpenPortal')}
            </Button>
          )}
          <Button variant='text' size='small' color='inherit' onClick={onCancel} disabled={busy}>{t('settings.licenseConnectionCancel')}</Button>
        </Box>
      </CardContent>
    </Card>
  )
}
