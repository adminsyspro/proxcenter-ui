'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'

interface PbsCertificatesTabProps {
  pbsId: string
}

type PbsCertInfo = {
  filename?: string
  fingerprint?: string
  issuer?: string
  notafter?: number | string
  notbefore?: number | string
  public_key_bits?: number
  public_key_type?: string
  san?: string[]
  subject?: string
}

type CertStatus = 'valid' | 'expiring' | 'expired'

const DAY_MS = 24 * 60 * 60 * 1000

function toMillis(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value * 1000
  }
  if (typeof value === 'string') {
    const n = Number(value)
    if (Number.isFinite(n) && n > 0) return n * 1000
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return null
}

function formatCertDate(value: unknown, locale: string): string {
  const ms = toMillis(value)
  if (ms === null) return '—'
  try {
    return new Date(ms).toLocaleString(locale)
  } catch {
    return String(value)
  }
}

function getStatus(notafter: unknown): CertStatus {
  const ms = toMillis(notafter)
  if (ms === null) return 'valid'
  const now = Date.now()
  if (ms < now) return 'expired'
  if (ms < now + 30 * DAY_MS) return 'expiring'
  return 'valid'
}

export default function PbsCertificatesTab({ pbsId }: PbsCertificatesTabProps) {
  const t = useTranslations()
  const locale = useLocale()

  const [certs, setCerts] = useState<PbsCertInfo[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState<{ requiredPriv?: string } | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const [detailOpen, setDetailOpen] = useState<boolean>(false)
  const [detailCert, setDetailCert] = useState<PbsCertInfo | null>(null)

  const fetchCerts = useCallback(async () => {
    setLoading(true)
    setError(null)
    setForbidden(null)
    try {
      const res = await fetch(`/api/v1/pbs/${pbsId}/certificates`, { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (res.status === 403 && body?.forbidden) {
        setForbidden({ requiredPriv: body?.requiredPriv })
        setCerts([])
        return
      }
      if (!res.ok) {
        throw new Error(body?.error || `HTTP ${res.status}`)
      }
      const data: PbsCertInfo[] = Array.isArray(body?.data) ? body.data : []
      setCerts(data)
      setLastUpdated(new Date())
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [pbsId])

  useEffect(() => {
    fetchCerts()
  }, [fetchCerts])

  const statusLabel = useCallback(
    (s: CertStatus): string => {
      if (s === 'valid') return t('inventory.pbsCertsStatusValid')
      if (s === 'expiring') return t('inventory.pbsCertsStatusExpiring')
      return t('inventory.pbsCertsStatusExpired')
    },
    [t]
  )

  const statusColor = (s: CertStatus): 'success' | 'warning' | 'error' => {
    if (s === 'valid') return 'success'
    if (s === 'expiring') return 'warning'
    return 'error'
  }

  const rows = useMemo(() => certs, [certs])

  const openDetails = (cert: PbsCertInfo) => {
    setDetailCert(cert)
    setDetailOpen(true)
  }

  const closeDetails = () => {
    setDetailOpen(false)
    setDetailCert(null)
  }

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
      {/* Toolbar */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
          flexWrap: 'wrap',
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <Button
            variant="outlined"
            size="small"
            onClick={fetchCerts}
            disabled={loading}
            startIcon={<i className="ri-refresh-line" style={{ fontSize: 16 }} />}
          >
            {t('inventory.pbsCertsRefresh')}
          </Button>
        </Stack>
        {lastUpdated && (
          <Typography variant="caption" sx={{ opacity: 0.6 }}>
            {lastUpdated.toLocaleTimeString()}
          </Typography>
        )}
      </Box>

      {/* Content */}
      {loading && certs.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, py: 6 }}>
          <CircularProgress size={32} />
        </Box>
      ) : forbidden ? (
        <Alert severity="warning" icon={<i className="ri-lock-line" style={{ fontSize: 20 }} />}>
          <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
            {t('inventory.pbsCertsForbidden')}
          </Typography>
          {forbidden.requiredPriv && (
            <Typography variant="caption" sx={{ opacity: 0.8 }}>
              {t('inventory.pbsCertsRequiredPriv', { priv: forbidden.requiredPriv })}
            </Typography>
          )}
        </Alert>
      ) : error ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={fetchCerts}>
              {t('inventory.pbsCertsRefresh')}
            </Button>
          }
        >
          {t('inventory.pbsCertsLoadError')}: {error}
        </Alert>
      ) : rows.length === 0 ? (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
            py: 6,
            opacity: 0.6,
            gap: 1.5,
          }}
        >
          <i className="ri-shield-keyhole-line" style={{ fontSize: 48 }} />
          <Typography variant="body2">{t('inventory.pbsCertsEmpty')}</Typography>
        </Box>
      ) : (
        <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>{t('inventory.pbsCertsCol.filename')}</TableCell>
                <TableCell>{t('inventory.pbsCertsCol.subject')}</TableCell>
                <TableCell>{t('inventory.pbsCertsCol.issuer')}</TableCell>
                <TableCell>{t('inventory.pbsCertsCol.validUntil')}</TableCell>
                <TableCell>{t('inventory.pbsCertsCol.status')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((cert, idx) => {
                const status = getStatus(cert.notafter)
                return (
                  <TableRow
                    key={`${cert.filename || 'cert'}-${idx}`}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => openDetails(cert)}
                  >
                    <TableCell sx={{ fontSize: 12 }}>
                      {cert.filename || '—'}
                    </TableCell>
                    <TableCell
                      sx={{
                        maxWidth: 280,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <Typography variant="caption">{cert.subject || '—'}</Typography>
                    </TableCell>
                    <TableCell
                      sx={{
                        maxWidth: 280,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <Typography variant="caption">{cert.issuer || '—'}</Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      <Typography variant="caption">
                        {formatCertDate(cert.notafter, locale)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={statusColor(status)}
                        label={statusLabel(status)}
                        sx={{ fontWeight: 600 }}
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Details dialog */}
      <Dialog open={detailOpen} onClose={closeDetails} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pr: 6 }}>
          <i className="ri-shield-keyhole-line" style={{ fontSize: 18 }} />
          <Box component="span" sx={{ fontWeight: 700 }}>
            {t('inventory.pbsCertsDetailsTitle')}
          </Box>
          {detailCert?.filename && (
            <Box component="span" sx={{ ml: 1, opacity: 0.7, fontSize: 14 }}>
              {detailCert.filename}
            </Box>
          )}
          <IconButton
            aria-label="close"
            onClick={closeDetails}
            sx={{ position: 'absolute', right: 8, top: 8 }}
          >
            <i className="ri-close-line" style={{ fontSize: 18 }} />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {detailCert && (
            <Table size="small">
              <TableBody>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, width: 200, verticalAlign: 'top' }}>
                    {t('inventory.pbsCertsCol.filename')}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                      {detailCert.filename || '—'}
                    </Typography>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, verticalAlign: 'top' }}>
                    {t('inventory.pbsCertsCol.subject')}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                      {detailCert.subject || '—'}
                    </Typography>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, verticalAlign: 'top' }}>
                    {t('inventory.pbsCertsCol.issuer')}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                      {detailCert.issuer || '—'}
                    </Typography>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, verticalAlign: 'top' }}>
                    {t('inventory.pbsCertsDetailFingerprint')}
                  </TableCell>
                  <TableCell>
                    <Box
                      component="pre"
                      sx={{
                        m: 0,
                        bgcolor: '#1e1e1e',
                        color: '#d4d4d4',
                        p: 1,
                        borderRadius: 1,
                        fontSize: 12,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}
                    >
                      {detailCert.fingerprint || '—'}
                    </Box>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, verticalAlign: 'top' }}>
                    {t('inventory.pbsCertsDetailSan')}
                  </TableCell>
                  <TableCell>
                    {Array.isArray(detailCert.san) && detailCert.san.length > 0 ? (
                      <Stack spacing={0.5} sx={{ flexWrap: 'wrap' }} direction="row" useFlexGap>
                        {detailCert.san.map((s, i) => (
                          <Chip key={`${s}-${i}`} size="small" label={s} variant="outlined" />
                        ))}
                      </Stack>
                    ) : (
                      <Typography variant="body2">—</Typography>
                    )}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, verticalAlign: 'top' }}>
                    {t('inventory.pbsCertsDetailKey')}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {(detailCert.public_key_type || '—') +
                        (detailCert.public_key_bits ? ` (${detailCert.public_key_bits} bits)` : '')}
                    </Typography>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, verticalAlign: 'top' }}>
                    {t('inventory.pbsCertsCol.validUntil')}
                  </TableCell>
                  <TableCell>
                    <Stack spacing={0.5}>
                      <Typography variant="body2">
                        {formatCertDate(detailCert.notbefore, locale)} →{' '}
                        {formatCertDate(detailCert.notafter, locale)}
                      </Typography>
                      <Chip
                        size="small"
                        color={statusColor(getStatus(detailCert.notafter))}
                        label={statusLabel(getStatus(detailCert.notafter))}
                        sx={{ fontWeight: 600, alignSelf: 'flex-start' }}
                      />
                    </Stack>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDetails} variant="contained">
            {t('inventory.pbsCertsClose')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
