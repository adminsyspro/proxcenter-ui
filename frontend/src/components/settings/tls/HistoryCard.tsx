'use client'

import { useCallback, useEffect, useState } from 'react'

import {
  Alert, Button, Card, CardContent, Chip, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material'
import { useTranslations } from 'next-intl'

import type { CertificateHistoryDto } from '@/components/settings/tls/types'

const SOURCE_LABELS: Record<string, string> = {
  self_signed: 'settings.tls.sourceSelfSigned',
  uploaded: 'settings.tls.sourceUploaded',
  acme: 'settings.tls.sourceAcme',
}

// A value people compare character by character stays readable in full only
// via its `title` attribute; the cell itself gets a short, monospace preview.
function truncateFingerprint(fingerprint: string): string {
  if (fingerprint.length <= 20) return fingerprint

  return `${fingerprint.slice(0, 8)}…${fingerprint.slice(-8)}`
}

export default function HistoryCard({
  onActivated, reloadToken = 0,
}: {
  onActivated: () => void
  /**
   * Changes every time the parent reloads its payload. Generating or importing
   * a certificate refreshes the parent, not this card, which went on showing
   * the replaced certificate as Active with no rollback button until the tab
   * was remounted.
   */
  reloadToken?: number
}) {
  const t = useTranslations()
  const [certificates, setCertificates] = useState<CertificateHistoryDto[]>([])
  const [error, setError] = useState<string | null>(null)
  const [activatingId, setActivatingId] = useState<string | null>(null)

  // Deps stay `[]`: this repo has already been taken out once by an effect
  // whose callback dependency was rebuilt every render (see TlsTab's own
  // `load`). `load` here never closes over anything that changes, so it stays
  // referentially stable and the effect below fires on mount and on nothing
  // but a new reloadToken, which is a number.
  const load = useCallback(async () => {
    const res = await fetch('/api/v1/settings/tls/certificates')

    if (!res.ok) return

    const body = await res.json().catch(() => ({}))

    setCertificates(Array.isArray(body?.certificates) ? body.certificates : [])
  }, [])

  useEffect(() => {
    void load()
  }, [load, reloadToken])

  const activate = async (id: string) => {
    setActivatingId(id)
    setError(null)

    try {
      const res = await fetch(`/api/v1/settings/tls/certificates/${id}/activate`, { method: 'POST' })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))

        setError(body?.error || t('settings.tls.saveFailed'))

        return
      }

      // Refresh this card's own list AND the parent's whole payload, so the
      // active certificate card and the listener state pick up the new
      // active row in the same round trip.
      await load()
      onActivated()
    } finally {
      setActivatingId(null)
    }
  }

  return (
    <Card variant='outlined'>
      <CardContent>
        <Typography variant='subtitle1' fontWeight={600} sx={{ mb: 2 }}>{t('settings.tls.historyTitle')}</Typography>

        {error && (
          <Alert severity='error' sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>
        )}

        {certificates.length === 0 && (
          <Typography variant='body2' color='text.secondary'>{t('settings.tls.noCertificate')}</Typography>
        )}

        {certificates.length > 0 && (
          <TableContainer>
            <Table size='small' sx={{ minWidth: 640 }}>
              <TableHead>
                <TableRow>
                  <TableCell>{t('settings.tls.commonName')}</TableCell>
                  <TableCell>{t('common.source')}</TableCell>
                  <TableCell>{t('settings.tls.historyValidity')}</TableCell>
                  <TableCell align='right'>{t('common.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {certificates.map(cert => {
                  const sourceKey = SOURCE_LABELS[cert.source]

                  return (
                    <TableRow key={cert.id} hover>
                      <TableCell sx={{ maxWidth: 280 }}>
                        <Typography variant='body2' fontWeight={500} sx={{ overflowWrap: 'anywhere' }}>{cert.commonName}</Typography>
                        <Typography
                          variant='caption' color='text.secondary'
                          sx={{ display: 'block', fontFamily: 'monospace', whiteSpace: 'nowrap' }}
                          title={`${t('settings.tls.fingerprint')}: ${cert.fingerprint}`}
                        >
                          {truncateFingerprint(cert.fingerprint)}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ maxWidth: 200 }}>{sourceKey ? t(sourceKey) : cert.source}</TableCell>
                      <TableCell>
                        {new Date(cert.notBefore).toLocaleDateString()} – {new Date(cert.notAfter).toLocaleDateString()}
                      </TableCell>
                      <TableCell align='right' sx={{ whiteSpace: 'nowrap' }}>
                        {cert.isActive
                          ? <Chip size='small' color='success' label={t('settings.tls.historyActive')} />
                          : (
                            <Button
                              size='small' variant='outlined' disabled={activatingId === cert.id}
                              onClick={() => activate(cert.id)}
                            >
                              {t('settings.tls.historyActivate')}
                            </Button>
                          )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>
    </Card>
  )
}
