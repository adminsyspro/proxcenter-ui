'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Typography,
} from '@mui/material'

interface PbsSubscriptionTabProps {
  pbsId: string
}

type PbsSubscription = {
  status?: string
  key?: string
  checktime?: number
  productname?: string
  nextduedate?: string
  serverid?: string
  sockets?: number
  message?: string
  signature?: string
  level?: string
}

function formatDate(value: unknown, locale: string): string {
  if (value === undefined || value === null || value === '') return '—'
  if (typeof value === 'number' && Number.isFinite(value)) {
    try {
      return new Date(value * 1000).toLocaleString(locale)
    } catch {
      return String(value)
    }
  }
  if (typeof value === 'string') {
    // Accept YYYY-MM-DD
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) {
      try {
        return new Date(parsed).toLocaleDateString(locale)
      } catch {
        return value
      }
    }
    return value
  }
  return String(value)
}

function maskKey(key: string, show: boolean): string {
  if (!key) return '—'
  if (show) return key
  if (key.length <= 8) return key
  return key.slice(0, 8) + '••••••••'
}

export default function PbsSubscriptionTab({ pbsId }: PbsSubscriptionTabProps) {
  const t = useTranslations()
  const locale = useLocale()

  const [sub, setSub] = useState<PbsSubscription | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [showKey, setShowKey] = useState<boolean>(false)

  const fetchSubscription = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/pbs/${pbsId}/subscription`, { cache: 'no-store' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `HTTP ${res.status}`)
      }
      const body = await res.json()
      setSub((body?.data as PbsSubscription) || null)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [pbsId])

  useEffect(() => {
    fetchSubscription()
  }, [fetchSubscription])

  const statusInfo = useMemo(() => {
    const s = String(sub?.status || '').toLowerCase()
    if (s === 'active') {
      return { color: 'success' as const, label: t('inventory.pbsSubscriptionStatusActive') }
    }
    if (s === 'expired') {
      return { color: 'warning' as const, label: t('inventory.pbsSubscriptionStatusExpired') }
    }
    if (s === 'notfound' || s === 'not found' || s === '') {
      return { color: 'default' as const, label: t('inventory.pbsSubscriptionStatusNotfound') }
    }
    return { color: 'default' as const, label: t('inventory.pbsSubscriptionStatusInactive') }
  }, [sub?.status, t])

  const isNotFound =
    String(sub?.status || '').toLowerCase() === 'notfound' ||
    String(sub?.status || '').toLowerCase() === 'not found' ||
    !sub?.status

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
        <Typography fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-vip-crown-line" style={{ fontSize: 18, opacity: 0.7 }} />
          {t('inventory.pbsTabSubscription')}
        </Typography>
        <Button
          variant="outlined"
          size="small"
          onClick={fetchSubscription}
          disabled={loading}
          startIcon={<i className="ri-refresh-line" style={{ fontSize: 16 }} />}
        >
          {t('inventory.pbsSubscriptionRefresh')}
        </Button>
      </Box>

      {/* Content */}
      {loading && !sub ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, py: 6 }}>
          <CircularProgress size={32} />
        </Box>
      ) : error ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={fetchSubscription}>
              {t('inventory.pbsSubscriptionRefresh')}
            </Button>
          }
        >
          {t('inventory.pbsSubscriptionLoadError')}: {error}
        </Alert>
      ) : isNotFound ? (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
            py: 6,
            gap: 2,
          }}
        >
          <i
            className="ri-vip-crown-line"
            style={{ fontSize: 64, opacity: 0.4 }}
          />
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            {t('inventory.pbsSubscriptionNone')}
          </Typography>
          <Chip
            size="small"
            color={statusInfo.color}
            label={statusInfo.label}
            sx={{ fontWeight: 600 }}
          />
          {sub?.message && (
            <Alert severity="info" sx={{ maxWidth: 600 }}>
              {sub.message}
            </Alert>
          )}
        </Box>
      ) : (
        <Card variant="outlined" sx={{ maxWidth: 720, mx: 'auto', width: '100%' }}>
          <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
            <Table size="small">
              <TableBody>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, width: 220 }}>
                    {t('inventory.pbsSubscriptionStatus')}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={statusInfo.color}
                      label={statusInfo.label}
                      sx={{ fontWeight: 600 }}
                    />
                  </TableCell>
                </TableRow>
                {sub?.productname && (
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>
                      {t('inventory.pbsSubscriptionProduct')}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{sub.productname}</Typography>
                    </TableCell>
                  </TableRow>
                )}
                {sub?.key && (
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>
                      {t('inventory.pbsSubscriptionKey')}
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="body2">
                          {maskKey(sub.key, showKey)}
                        </Typography>
                        <IconButton
                          size="small"
                          onClick={() => setShowKey(s => !s)}
                          aria-label={
                            showKey
                              ? t('inventory.pbsSubscriptionHide')
                              : t('inventory.pbsSubscriptionShow')
                          }
                        >
                          <i
                            className={showKey ? 'ri-eye-off-line' : 'ri-eye-line'}
                            style={{ fontSize: 16 }}
                          />
                        </IconButton>
                      </Stack>
                    </TableCell>
                  </TableRow>
                )}
                {sub?.serverid && (
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>
                      {t('inventory.pbsSubscriptionServerId')}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{sub.serverid}</Typography>
                    </TableCell>
                  </TableRow>
                )}
                {sub?.level && (
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>
                      {t('inventory.pbsSubscriptionLevel')}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{sub.level}</Typography>
                    </TableCell>
                  </TableRow>
                )}
                {sub?.sockets !== undefined && sub?.sockets !== null && (
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>
                      {t('inventory.pbsSubscriptionSockets')}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{sub.sockets}</Typography>
                    </TableCell>
                  </TableRow>
                )}
                {sub?.checktime !== undefined && sub?.checktime !== null && (
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>
                      {t('inventory.pbsSubscriptionChecktime')}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {formatDate(sub.checktime, locale)}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
                {sub?.nextduedate && (
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>
                      {t('inventory.pbsSubscriptionNextDue')}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {formatDate(sub.nextduedate, locale)}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
                {sub?.message && (
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>
                      {t('inventory.pbsSubscriptionMessage')}
                    </TableCell>
                    <TableCell>
                      <Alert severity="info" sx={{ py: 0 }}>
                        {sub.message}
                      </Alert>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </Box>
  )
}
