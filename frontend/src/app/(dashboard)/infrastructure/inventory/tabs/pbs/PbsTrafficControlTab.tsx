'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  Chip,
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

import { formatBytes } from '@/utils/format'

interface PbsTrafficControlTabProps {
  pbsId: string
}

type PbsTcRule = {
  name?: string
  network?: string[] | string
  'rate-in'?: number | string
  'rate-out'?: number | string
  'burst-in'?: number | string
  'burst-out'?: number | string
  timeframe?: string[] | string
  comment?: string
}

function toArray(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) return value.filter(v => typeof v === 'string' && v.length > 0)
  if (typeof value === 'string' && value.length > 0) {
    return value
      .split(/[,;\s]+/)
      .map(s => s.trim())
      .filter(Boolean)
  }
  return []
}

function toNumber(value: number | string | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.length > 0) {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function formatRate(value: number | string | undefined): string | null {
  const n = toNumber(value)
  if (!n) return null
  return `${formatBytes(n)}/s`
}

function formatBurst(value: number | string | undefined): string | null {
  const n = toNumber(value)
  if (!n) return null
  return formatBytes(n)
}

export default function PbsTrafficControlTab({ pbsId }: PbsTrafficControlTabProps) {
  const t = useTranslations()

  const [rules, setRules] = useState<PbsTcRule[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState<{ requiredPriv?: string } | null>(null)
  const [notSupported, setNotSupported] = useState<boolean>(false)

  const fetchRules = useCallback(async () => {
    setLoading(true)
    setError(null)
    setForbidden(null)
    setNotSupported(false)
    try {
      const res = await fetch(`/api/v1/pbs/${pbsId}/traffic-control`, { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (res.status === 403 && body?.forbidden) {
        setForbidden({ requiredPriv: body?.requiredPriv })
        setRules([])
        return
      }
      if (!res.ok) {
        throw new Error(body?.error || `HTTP ${res.status}`)
      }
      if (body?.notSupported) {
        setNotSupported(true)
      }
      setRules(Array.isArray(body?.data) ? body.data : [])
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [pbsId])

  useEffect(() => {
    fetchRules()
  }, [fetchRules])

  const dash = (value: string | null): React.ReactNode =>
    value ? (
      <Typography variant="caption">{value}</Typography>
    ) : (
      <Typography variant="caption" sx={{ opacity: 0.6 }}>
        —
      </Typography>
    )

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
            onClick={fetchRules}
            disabled={loading}
            startIcon={<i className="ri-refresh-line" style={{ fontSize: 16 }} />}
          >
            {t('inventory.pbsTcRefresh')}
          </Button>
        </Stack>
      </Box>

      {/* Content */}
      {loading && rules.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, py: 6 }}>
          <CircularProgress size={32} />
        </Box>
      ) : forbidden ? (
        <Alert severity="warning" icon={<i className="ri-lock-line" style={{ fontSize: 20 }} />}>
          <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
            {t('inventory.pbsTcForbidden')}
          </Typography>
          {forbidden.requiredPriv && (
            <Typography variant="caption" sx={{ opacity: 0.8 }}>
              {t('inventory.pbsTcRequiredPriv', { priv: forbidden.requiredPriv })}
            </Typography>
          )}
        </Alert>
      ) : error ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={fetchRules}>
              {t('inventory.pbsTcRefresh')}
            </Button>
          }
        >
          {t('inventory.pbsTcLoadError')}: {error}
        </Alert>
      ) : rules.length === 0 ? (
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
          <i className="ri-speed-up-line" style={{ fontSize: 64 }} />
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            {t('inventory.pbsTcEmpty')}
          </Typography>
          <Typography variant="body2" sx={{ opacity: 0.8 }}>
            {t('inventory.pbsTcEmptyHint')}
          </Typography>
        </Box>
      ) : (
        <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>{t('inventory.pbsTcCol.name')}</TableCell>
                <TableCell>{t('inventory.pbsTcCol.networks')}</TableCell>
                <TableCell>{t('inventory.pbsTcCol.rateIn')}</TableCell>
                <TableCell>{t('inventory.pbsTcCol.rateOut')}</TableCell>
                <TableCell>{t('inventory.pbsTcCol.burstIn')}</TableCell>
                <TableCell>{t('inventory.pbsTcCol.burstOut')}</TableCell>
                <TableCell>{t('inventory.pbsTcCol.timeframe')}</TableCell>
                <TableCell>{t('inventory.pbsTcCol.comment')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rules.map((r, idx) => {
                const networks = toArray(r.network)
                const timeframes = toArray(r.timeframe)
                return (
                  <TableRow key={r.name || `tc-${idx}`} hover>
                    <TableCell sx={{ fontSize: 12 }}>
                      <Typography variant="caption" sx={{ fontWeight: 600 }}>
                        {r.name || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: 12, maxWidth: 240 }}>
                      {networks.length === 0 ? (
                        <Typography variant="caption" sx={{ opacity: 0.6 }}>
                          —
                        </Typography>
                      ) : (
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                          {networks.map(n => (
                            <Chip
                              key={n}
                              size="small"
                              label={n}
                              variant="outlined"
                              sx={{ fontSize: 11 }}
                            />
                          ))}
                        </Stack>
                      )}
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>{dash(formatRate(r['rate-in']))}</TableCell>
                    <TableCell sx={{ fontSize: 12 }}>{dash(formatRate(r['rate-out']))}</TableCell>
                    <TableCell sx={{ fontSize: 12 }}>{dash(formatBurst(r['burst-in']))}</TableCell>
                    <TableCell sx={{ fontSize: 12 }}>{dash(formatBurst(r['burst-out']))}</TableCell>
                    <TableCell sx={{ fontSize: 12, maxWidth: 240 }}>
                      {timeframes.length === 0 ? (
                        <Typography variant="caption" sx={{ opacity: 0.6 }}>
                          —
                        </Typography>
                      ) : (
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                          {timeframes.map(tf => (
                            <Chip
                              key={tf}
                              size="small"
                              label={tf}
                              variant="outlined"
                              sx={{ fontSize: 11 }}
                            />
                          ))}
                        </Stack>
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
