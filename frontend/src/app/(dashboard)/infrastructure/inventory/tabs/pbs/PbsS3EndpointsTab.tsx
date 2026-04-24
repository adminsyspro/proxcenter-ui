'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'

interface PbsS3EndpointsTabProps {
  pbsId: string
}

type PbsS3Endpoint = {
  name?: string
  endpoint?: string
  region?: string
  'access-key'?: string
  'access-key-id'?: string
  comment?: string
}

function maskKey(key: string): string {
  if (!key) return '—'
  if (key.length <= 6) return '••••'
  return `${key.slice(0, 4)}${'•'.repeat(Math.max(4, key.length - 6))}${key.slice(-2)}`
}

export default function PbsS3EndpointsTab({ pbsId }: PbsS3EndpointsTabProps) {
  const t = useTranslations()

  const [endpoints, setEndpoints] = useState<PbsS3Endpoint[]>([])
  const [notSupported, setNotSupported] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const fetchEndpoints = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/pbs/${pbsId}/s3-endpoints`, { cache: 'no-store' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `HTTP ${res.status}`)
      }
      const body = await res.json()
      setEndpoints(Array.isArray(body?.data) ? body.data : [])
      setNotSupported(Boolean(body?.notSupported))
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [pbsId])

  useEffect(() => {
    fetchEndpoints()
  }, [fetchEndpoints])

  if (loading && endpoints.length === 0 && !notSupported) {
    return (
      <Box sx={{ p: 2, display: 'flex', flex: 1, justifyContent: 'center', alignItems: 'center', py: 6 }}>
        <CircularProgress size={32} />
      </Box>
    )
  }

  if (notSupported) {
    return (
      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Card variant="outlined">
          <CardContent>
            <Stack direction="row" spacing={2} alignItems="center">
              <i className="ri-information-line" style={{ fontSize: 32, opacity: 0.7 }} />
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  {t('inventory.pbsS3NotSupported')}
                </Typography>
              </Box>
            </Stack>
          </CardContent>
        </Card>
      </Box>
    )
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
            onClick={fetchEndpoints}
            disabled={loading}
            startIcon={<i className="ri-refresh-line" style={{ fontSize: 16 }} />}
          >
            {t('inventory.pbsS3Refresh')}
          </Button>
        </Stack>
      </Box>

      {/* Content */}
      {error ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={fetchEndpoints}>
              {t('inventory.pbsS3Refresh')}
            </Button>
          }
        >
          {t('inventory.pbsS3LoadError')}: {error}
        </Alert>
      ) : endpoints.length === 0 ? (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
            py: 6,
            opacity: 0.7,
            gap: 1.5,
          }}
        >
          <i className="ri-cloud-line" style={{ fontSize: 64 }} />
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            {t('inventory.pbsS3Empty')}
          </Typography>
          <Typography variant="body2" sx={{ opacity: 0.8 }}>
            {t('inventory.pbsS3EmptyHint')}
          </Typography>
        </Box>
      ) : (
        <>
          <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>{t('inventory.pbsS3Col.name')}</TableCell>
                  <TableCell>{t('inventory.pbsS3Col.endpoint')}</TableCell>
                  <TableCell>{t('inventory.pbsS3Col.region')}</TableCell>
                  <TableCell>{t('inventory.pbsS3Col.accessKey')}</TableCell>
                  <TableCell>{t('inventory.pbsS3Col.comment')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {endpoints.map((ep, idx) => {
                  const accessKey = String(ep['access-key-id'] || ep['access-key'] || '')
                  return (
                    <TableRow key={ep.name || `s3-${idx}`} hover>
                      <TableCell sx={{ fontSize: 12 }}>
                        <Typography variant="caption" sx={{ fontWeight: 600 }}>
                          {ep.name || '—'}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ fontSize: 12 }}>
                        <Typography variant="caption">{ep.endpoint || '—'}</Typography>
                      </TableCell>
                      <TableCell sx={{ fontSize: 12 }}>
                        <Typography variant="caption">{ep.region || '—'}</Typography>
                      </TableCell>
                      <TableCell sx={{ fontSize: 12 }}>
                        <Typography variant="caption">{maskKey(accessKey)}</Typography>
                      </TableCell>
                      <TableCell sx={{ fontSize: 12, maxWidth: 300 }}>
                        <Typography
                          variant="caption"
                          sx={{
                            display: 'block',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {ep.comment || '—'}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
          <Typography variant="caption" sx={{ opacity: 0.6 }}>
            {t('inventory.pbsS3EmptyHint')}
          </Typography>
        </>
      )}
    </Box>
  )
}
