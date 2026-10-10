'use client'

import { useCallback, useState } from 'react'

import { useTranslations } from 'next-intl'
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Divider,
  Table, TableBody, TableCell, TableHead, TablePagination, TableRow, Typography,
} from '@mui/material'

import { useSWRFetch } from '@/hooks/useSWRFetch'

interface ActiveLock {
  kind: 'account' | 'ip'
  key: string
  failedCount: number
  lastFailedAt: string
  lockedUntil: string
}

const ROWS_PER_PAGE = 10

// Accounts and client IPs locked by the login policy, with the admin unlock.
export default function LoginLockoutsCard() {
  const t = useTranslations()
  const { data, isLoading, mutate } = useSWRFetch('/api/v1/compliance/login-lockouts', { refreshInterval: 30_000 })
  const locks: ActiveLock[] = data?.data ?? []

  const [page, setPage] = useState(0)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleUnlock = useCallback(async (lock: ActiveLock) => {
    const id = `${lock.kind}:${lock.key}`
    setBusyKey(id)
    setError(null)
    try {
      const qs = new URLSearchParams({ kind: lock.kind, key: lock.key })
      const res = await fetch(`/api/v1/compliance/login-lockouts?${qs}`, { method: 'DELETE' })
      // 404 = the lock expired meanwhile, the refresh below drops the row.
      if (!res.ok && res.status !== 404) throw new Error(String(res.status))
      await mutate()
    } catch {
      setError(t('compliance.loginLockouts.unlockFailed'))
    } finally {
      setBusyKey(null)
    }
  }, [mutate, t])

  const pageRows = locks.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE)

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <i className="ri-lock-2-line" style={{ fontSize: 20 }} />
          <Typography variant="h6">{t('compliance.loginLockouts.title')}</Typography>
          {locks.length > 0 && <Chip size="small" color="warning" label={locks.length} />}
        </Box>
        <Divider sx={{ mb: 2 }} />
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('compliance.loginLockouts.description')}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {isLoading ? (
          <CircularProgress size={20} />
        ) : locks.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t('compliance.loginLockouts.empty')}
          </Typography>
        ) : (
          <>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('compliance.loginLockouts.subject')}</TableCell>
                  <TableCell>{t('compliance.loginLockouts.type')}</TableCell>
                  <TableCell align="right">{t('compliance.loginLockouts.failedAttempts')}</TableCell>
                  <TableCell>{t('compliance.loginLockouts.lockedUntil')}</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {pageRows.map((lock) => {
                  const id = `${lock.kind}:${lock.key}`
                  return (
                    <TableRow key={id}>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <i
                            className={lock.kind === 'account' ? 'ri-user-line' : 'ri-global-line'}
                            style={{ fontSize: 16, opacity: 0.8 }}
                          />
                          <Typography variant="body2" sx={{ fontFamily: lock.kind === 'ip' ? 'monospace' : undefined }}>
                            {lock.key}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          variant="outlined"
                          label={t(lock.kind === 'account' ? 'compliance.loginLockouts.kindAccount' : 'compliance.loginLockouts.kindIp')}
                        />
                      </TableCell>
                      <TableCell align="right">{lock.failedCount}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{new Date(lock.lockedUntil).toLocaleString()}</TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={busyKey === id ? <CircularProgress size={14} color="inherit" /> : <i className="ri-lock-unlock-line" />}
                          disabled={busyKey !== null}
                          onClick={() => handleUnlock(lock)}
                        >
                          {t('compliance.loginLockouts.unlock')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            {locks.length > ROWS_PER_PAGE && (
              <TablePagination
                component="div"
                count={locks.length}
                page={page}
                onPageChange={(_, p) => setPage(p)}
                rowsPerPage={ROWS_PER_PAGE}
                rowsPerPageOptions={[ROWS_PER_PAGE]}
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
