'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'

interface PbsRemotesTabProps {
  pbsId: string
}

type PbsRemote = {
  name?: string
  host?: string
  port?: number | string
  'auth-id'?: string
  fingerprint?: string
  comment?: string
}

export default function PbsRemotesTab({ pbsId }: PbsRemotesTabProps) {
  const t = useTranslations()

  const [remotes, setRemotes] = useState<PbsRemote[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const fetchRemotes = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/pbs/${pbsId}/remotes`, { cache: 'no-store' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `HTTP ${res.status}`)
      }
      const body = await res.json()
      setRemotes(Array.isArray(body?.data) ? body.data : [])
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [pbsId])

  useEffect(() => {
    fetchRemotes()
  }, [fetchRemotes])

  const truncate = (s: string, n: number): string =>
    s.length > n ? `${s.slice(0, n)}…` : s

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
            onClick={fetchRemotes}
            disabled={loading}
            startIcon={<i className="ri-refresh-line" style={{ fontSize: 16 }} />}
          >
            {t('inventory.pbsRemotesRefresh')}
          </Button>
        </Stack>
      </Box>

      {/* Content */}
      {loading && remotes.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, py: 6 }}>
          <CircularProgress size={32} />
        </Box>
      ) : error ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={fetchRemotes}>
              {t('inventory.pbsRemotesRefresh')}
            </Button>
          }
        >
          {t('inventory.pbsRemotesLoadError')}: {error}
        </Alert>
      ) : remotes.length === 0 ? (
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
          <i className="ri-server-line" style={{ fontSize: 64 }} />
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            {t('inventory.pbsRemotesEmpty')}
          </Typography>
          <Typography variant="body2" sx={{ opacity: 0.8 }}>
            {t('inventory.pbsRemotesEmptyHint')}
          </Typography>
        </Box>
      ) : (
        <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>{t('inventory.pbsRemotesCol.name')}</TableCell>
                <TableCell>{t('inventory.pbsRemotesCol.host')}</TableCell>
                <TableCell>{t('inventory.pbsRemotesCol.port')}</TableCell>
                <TableCell>{t('inventory.pbsRemotesCol.authId')}</TableCell>
                <TableCell>{t('inventory.pbsRemotesCol.fingerprint')}</TableCell>
                <TableCell>{t('inventory.pbsRemotesCol.comment')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {remotes.map((r, idx) => {
                const fp = String(r.fingerprint || '')
                return (
                  <TableRow key={r.name || `remote-${idx}`} hover>
                    <TableCell sx={{ fontSize: 12 }}>
                      <Typography variant="caption" sx={{ fontWeight: 600 }}>
                        {r.name || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      <Typography variant="caption">{r.host || '—'}</Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      <Typography variant="caption">
                        {r.port !== undefined && r.port !== null && r.port !== '' ? String(r.port) : '—'}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      <Typography variant="caption">{r['auth-id'] || '—'}</Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: 12, maxWidth: 180 }}>
                      {fp ? (
                        <Tooltip title={fp} placement="top-start">
                          <Typography
                            variant="caption"
                            sx={{
                              display: 'block',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {truncate(fp, 24)}
                          </Typography>
                        </Tooltip>
                      ) : (
                        <Typography variant="caption" sx={{ opacity: 0.6 }}>
                          —
                        </Typography>
                      )}
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
                        {r.comment || '—'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  )
}
