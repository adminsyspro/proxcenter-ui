'use client'

import { useId, useState } from 'react'

import {
  Box, Button, Card, CardActionArea, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, IconButton, Stack, Typography,
} from '@mui/material'
import { useTranslations } from 'next-intl'

export interface ActiveCertificate {
  id: string
  source: string
  commonName: string
  sanNames: string[]
  issuer: string
  fingerprint: string
  notBefore: string
  notAfter: string
}

const SOON_MS = 30 * 86_400_000

const SOURCE_LABELS: Record<string, string> = {
  self_signed: 'settings.tls.sourceSelfSigned',
  uploaded: 'settings.tls.sourceUploaded',
  acme: 'settings.tls.sourceAcme',
}

export function validityTone(notAfter: string, now = Date.now()): 'error' | 'warning' | 'success' {
  const remaining = new Date(notAfter).getTime() - now

  if (remaining <= 0) return 'error'
  if (remaining <= SOON_MS) return 'warning'

  return 'success'
}

/** Keep each detail's label and value on separate lines, even for captions. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography component='dt' variant='caption' color='text.secondary' sx={{ display: 'block' }}>{label}</Typography>
      <Typography component='dd' variant='body2' sx={{ display: 'block', m: 0, overflowWrap: 'anywhere' }}>{value}</Typography>
    </Box>
  )
}

export default function CertificateStatusCard({ certificate }: { certificate: ActiveCertificate | null }) {
  const t = useTranslations()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const titleId = useId()

  if (!certificate) {
    return (
      <Card variant='outlined'>
        <CardContent>
          <Typography variant='subtitle1' fontWeight={600} sx={{ mb: 2 }}>{t('settings.tls.activeTitle')}</Typography>
          <Typography variant='body2' color='text.secondary'>{t('settings.tls.noCertificate')}</Typography>
        </CardContent>
      </Card>
    )
  }

  const tone = validityTone(certificate.notAfter)
  const label = tone === 'error' ? t('settings.tls.expired') : tone === 'warning' ? t('settings.tls.expiringSoon') : t('settings.tls.valid')
  const expiry = new Date(certificate.notAfter).toLocaleDateString()
  const sourceKey = SOURCE_LABELS[certificate.source]
  const closeDetails = () => setDetailsOpen(false)

  return (
    <>
      <Card variant='outlined'>
        <CardActionArea
          onClick={() => setDetailsOpen(true)}
          aria-haspopup='dialog'
          aria-expanded={detailsOpen}
          aria-label={`${t('settings.tls.activeTitle')}: ${certificate.commonName}, ${label}, ${t('settings.tls.validUntil')} ${expiry}`}
          sx={{
            borderRadius: 'inherit',
            '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
          }}
        >
          <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
            <Stack direction='row' alignItems='center' spacing={{ xs: 1, sm: 2 }}>
              <i className='ri-lock-line' aria-hidden='true' style={{ fontSize: 20, opacity: 0.7 }} />
              <Typography
                component='span' variant='body2' color='text.secondary'
                sx={{ display: { xs: 'none', md: 'inline' }, flexShrink: 0 }}
              >
                {t('settings.tls.activeTitle')}
              </Typography>
              <Typography
                component='span' variant='body2' fontWeight={600} noWrap
                title={certificate.commonName} sx={{ flex: 1, minWidth: 0 }}
              >
                {certificate.commonName}
              </Typography>
              <Chip component='span' size='small' color={tone} label={label} sx={{ flexShrink: 0 }} />
              <Stack
                component='span' direction='row' alignItems='center' spacing={1}
                title={`${t('settings.tls.validUntil')}: ${expiry}`}
                sx={{ color: 'text.secondary', flexShrink: 0 }}
              >
                <i className='ri-time-line' aria-hidden='true' style={{ fontSize: 16 }} />
                <Typography component='time' dateTime={certificate.notAfter} variant='body2' color='text.secondary'>
                  {expiry}
                </Typography>
              </Stack>
              <i className='ri-arrow-right-s-line' aria-hidden='true' style={{ fontSize: 18, opacity: 0.7 }} />
            </Stack>
          </CardContent>
        </CardActionArea>
      </Card>

      <Dialog open={detailsOpen} onClose={closeDetails} fullWidth maxWidth='sm' aria-labelledby={titleId}>
        <DialogTitle id={`${titleId}-header`} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, pb: 1 }}>
          <Box component='span' sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className='ri-lock-line' aria-hidden='true' style={{ fontSize: 20 }} />
            <Typography id={titleId} component='span' variant='subtitle1' fontWeight={700}>{t('settings.tls.activeTitle')}</Typography>
          </Box>
          <IconButton size='small' onClick={closeDetails} aria-label={t('common.close')} sx={{ opacity: 0.6 }}>
            <i className='ri-close-line' aria-hidden='true' style={{ fontSize: 18 }} />
          </IconButton>
        </DialogTitle>
        <Divider />
        <DialogContent sx={{ pt: 2, pb: 2 }}>
          <Stack spacing={2}>
            <Stack direction='row' alignItems='center' spacing={2}>
              <Typography variant='body1' fontWeight={600} sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                {certificate.commonName}
              </Typography>
              <Chip size='small' color={tone} label={label} sx={{ flexShrink: 0 }} />
            </Stack>
            <Stack component='dl' spacing={2} sx={{ m: 0 }}>
              <Fact label={t('settings.tls.issuer')} value={certificate.issuer} />
              <Fact label={t('common.source')} value={sourceKey ? t(sourceKey) : certificate.source} />
              <Fact
                label={t('settings.tls.historyValidity')}
                value={`${new Date(certificate.notBefore).toLocaleString()} – ${new Date(certificate.notAfter).toLocaleString()}`}
              />
              {certificate.sanNames.length > 0 && (
                <Fact label={t('settings.tls.san')} value={certificate.sanNames.join(', ')} />
              )}
              <Box sx={{ minWidth: 0 }}>
                <Box component='dt' sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary', mb: 1 }}>
                  <i className='ri-fingerprint-line' aria-hidden='true' style={{ fontSize: 16 }} />
                  <Typography component='span' variant='caption' color='text.secondary' sx={{ display: 'block' }}>
                    {t('settings.tls.fingerprint')}
                  </Typography>
                </Box>
                <Typography
                  component='dd' variant='body2'
                  sx={{ m: 0, p: 1.5, bgcolor: 'action.hover', borderRadius: 1, fontFamily: 'monospace', overflowWrap: 'anywhere', userSelect: 'text' }}
                >
                  {certificate.fingerprint}
                </Typography>
              </Box>
            </Stack>
          </Stack>
        </DialogContent>
        <Divider />
        <DialogActions sx={{ px: 2, py: 1.5 }}>
          <Button size='small' variant='contained' onClick={closeDetails}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
