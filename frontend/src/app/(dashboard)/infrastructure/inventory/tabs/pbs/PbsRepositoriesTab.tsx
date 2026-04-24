'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Snackbar,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'

interface PbsRepositoriesTabProps {
  pbsId: string
}

type RepoEntry = {
  Types?: string[]
  URIs?: string[]
  Suites?: string[]
  Components?: string[]
  Enabled?: boolean | number
  FileType?: string
  Options?: any
}

type RepoFile = {
  path: string
  'file-type'?: string
  repositories?: RepoEntry[]
}

type StandardRepo = {
  handle: string
  name?: string
  status?: 'configured' | 'not-configured' | 'unknown' | string
}

type RepoPayload = {
  digest?: string
  files?: RepoFile[]
  infos?: any[]
  errors?: Array<{ path?: string; error?: string } | string>
  'standard-repos'?: StandardRepo[]
}

function statusChipColor(status: string): 'success' | 'warning' | 'default' {
  if (status === 'configured') return 'success'
  if (status === 'not-configured') return 'warning'
  return 'default'
}

export default function PbsRepositoriesTab({ pbsId }: PbsRepositoriesTabProps) {
  const t = useTranslations()

  const [payload, setPayload] = useState<RepoPayload | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const [snackbar, setSnackbar] = useState<{
    open: boolean
    severity: 'success' | 'error'
    message: string
  }>({ open: false, severity: 'success', message: '' })

  const fetchRepos = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/pbs/${pbsId}/repositories`, { cache: 'no-store' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `HTTP ${res.status}`)
      }
      const body = await res.json()
      setPayload(body?.data || null)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [pbsId])

  useEffect(() => {
    fetchRepos()
  }, [fetchRepos])

  const runAction = useCallback(
    async (key: string, body: Record<string, any>) => {
      setBusyKey(key)
      try {
        const res = await fetch(`/api/v1/pbs/${pbsId}/repositories`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const rb = await res.json().catch(() => ({}))
          throw new Error(rb?.error || `HTTP ${res.status}`)
        }
        setSnackbar({
          open: true,
          severity: 'success',
          message: t('inventory.pbsReposActionSuccess'),
        })
        await fetchRepos()
      } catch (e: any) {
        setSnackbar({
          open: true,
          severity: 'error',
          message:
            t('inventory.pbsReposActionError') +
            (e?.message ? ` (${e.message})` : ''),
        })
      } finally {
        setBusyKey(null)
      }
    },
    [pbsId, fetchRepos, t]
  )

  const handleToggle = (path: string, index: number, enabled: boolean) => {
    const key = `toggle:${path}:${index}`
    runAction(key, {
      op: 'toggle',
      path,
      index,
      enabled,
      digest: payload?.digest,
    })
  }

  const handleAdd = (handle: string) => {
    const key = `add:${handle}`
    runAction(key, {
      op: 'add',
      handle,
      digest: payload?.digest,
    })
  }

  const handleSnackbarClose = () => setSnackbar(s => ({ ...s, open: false }))

  const standardRepos: StandardRepo[] = payload?.['standard-repos'] || []
  const files: RepoFile[] = payload?.files || []
  const errors = payload?.errors || []

  const statusLabel = (status: string): string => {
    if (status === 'configured') return t('inventory.pbsReposStatusConfigured')
    if (status === 'not-configured') return t('inventory.pbsReposStatusNotConfigured')
    return t('inventory.pbsReposStatusUnknown')
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
            onClick={fetchRepos}
            disabled={loading}
            startIcon={<i className="ri-refresh-line" style={{ fontSize: 16 }} />}
          >
            {t('inventory.pbsReposRefresh')}
          </Button>
        </Stack>
      </Box>

      {/* Content */}
      {loading && !payload ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, py: 6 }}>
          <CircularProgress size={32} />
        </Box>
      ) : error ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={fetchRepos}>
              {t('inventory.pbsReposRefresh')}
            </Button>
          }
        >
          {t('inventory.pbsReposLoadError')}: {error}
        </Alert>
      ) : (
        <Stack spacing={2}>
          {/* Errors */}
          {errors.length > 0 && (
            <Alert severity="error">
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
                {t('inventory.pbsReposErrorsHeader')}
              </Typography>
              <Stack spacing={0.25}>
                {errors.map((e: any, idx: number) => {
                  const txt =
                    typeof e === 'string'
                      ? e
                      : `${e?.path ? `${e.path}: ` : ''}${e?.error || JSON.stringify(e)}`
                  return (
                    <Typography key={idx} variant="caption" sx={{ display: 'block' }}>
                      {txt}
                    </Typography>
                  )
                })}
              </Stack>
            </Alert>
          )}

          {/* Standard repositories */}
          <Card variant="outlined">
            <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
              <Box
                sx={{
                  px: 2,
                  py: 1.25,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <Typography
                  fontWeight={700}
                  sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                >
                  <i className="ri-stack-line" style={{ fontSize: 18, opacity: 0.7 }} />
                  {t('inventory.pbsReposStandard')}
                </Typography>
              </Box>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('inventory.pbsReposHandle')}</TableCell>
                      <TableCell>{t('inventory.pbsReposName')}</TableCell>
                      <TableCell>{t('inventory.pbsReposStatus')}</TableCell>
                      <TableCell align="right">{t('inventory.pbsReposActionAdd')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {standardRepos.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} sx={{ textAlign: 'center', py: 3, opacity: 0.6 }}>
                          —
                        </TableCell>
                      </TableRow>
                    ) : (
                      standardRepos.map(r => {
                        const status = String(r.status || 'unknown')
                        const key = `add:${r.handle}`
                        const busy = busyKey === key
                        return (
                          <TableRow key={r.handle} hover>
                            <TableCell sx={{ fontSize: 12 }}>{r.handle}</TableCell>
                            <TableCell>
                              <Typography variant="caption">{r.name || '—'}</Typography>
                            </TableCell>
                            <TableCell>
                              <Chip
                                size="small"
                                color={statusChipColor(status)}
                                label={statusLabel(status)}
                                variant={status === 'configured' ? 'filled' : 'outlined'}
                                sx={{ fontSize: 11 }}
                              />
                            </TableCell>
                            <TableCell align="right">
                              {status === 'not-configured' && (
                                <Button
                                  size="small"
                                  variant="outlined"
                                  disabled={busy}
                                  onClick={() => handleAdd(r.handle)}
                                  startIcon={
                                    busy ? (
                                      <CircularProgress size={12} />
                                    ) : (
                                      <i className="ri-add-line" style={{ fontSize: 14 }} />
                                    )
                                  }
                                >
                                  {t('inventory.pbsReposActionAdd')}
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>

          {/* Files / repositories */}
          {files.length === 0 ? (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                py: 4,
                opacity: 0.7,
                gap: 1,
              }}
            >
              <i className="ri-file-list-3-line" style={{ fontSize: 48 }} />
              <Typography variant="body2">{t('inventory.pbsReposNoFiles')}</Typography>
            </Box>
          ) : (
            files.map(file => (
              <Card key={file.path} variant="outlined">
                <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                  <Box
                    sx={{
                      px: 2,
                      py: 1.25,
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                    }}
                  >
                    <Typography
                      fontWeight={700}
                      sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                    >
                      <i className="ri-file-list-3-line" style={{ fontSize: 16, opacity: 0.7 }} />
                      {t('inventory.pbsReposFileHeader', { path: file.path })}
                    </Typography>
                  </Box>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>{t('inventory.pbsReposColType')}</TableCell>
                          <TableCell>{t('inventory.pbsReposColUris')}</TableCell>
                          <TableCell>{t('inventory.pbsReposColSuites')}</TableCell>
                          <TableCell>{t('inventory.pbsReposColComponents')}</TableCell>
                          <TableCell align="right">{t('inventory.pbsReposColEnabled')}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(file.repositories || []).length === 0 ? (
                          <TableRow>
                            <TableCell
                              colSpan={5}
                              sx={{ textAlign: 'center', py: 3, opacity: 0.6 }}
                            >
                              —
                            </TableCell>
                          </TableRow>
                        ) : (
                          (file.repositories || []).map((repo, idx) => {
                            const types = Array.isArray(repo.Types) ? repo.Types : []
                            const uris = Array.isArray(repo.URIs) ? repo.URIs : []
                            const suites = Array.isArray(repo.Suites) ? repo.Suites : []
                            const comps = Array.isArray(repo.Components) ? repo.Components : []
                            const enabled =
                              repo.Enabled === true ||
                              repo.Enabled === 1 ||
                              (typeof repo.Enabled === 'string' && repo.Enabled === '1')
                            const key = `toggle:${file.path}:${idx}`
                            const busy = busyKey === key
                            return (
                              <TableRow key={`${file.path}-${idx}`} hover>
                                <TableCell>
                                  <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                                    {types.length === 0 ? (
                                      <Typography variant="caption" sx={{ opacity: 0.6 }}>
                                        —
                                      </Typography>
                                    ) : (
                                      types.map(ty => (
                                        <Chip
                                          key={ty}
                                          size="small"
                                          label={ty}
                                          variant="outlined"
                                          sx={{ fontSize: 11 }}
                                        />
                                      ))
                                    )}
                                  </Stack>
                                </TableCell>
                                <TableCell sx={{ fontSize: 12 }}>
                                  <Stack spacing={0.25}>
                                    {uris.length === 0 ? (
                                      <Typography variant="caption" sx={{ opacity: 0.6 }}>
                                        —
                                      </Typography>
                                    ) : (
                                      uris.map(u => (
                                        <Typography key={u} variant="caption">
                                          {u}
                                        </Typography>
                                      ))
                                    )}
                                  </Stack>
                                </TableCell>
                                <TableCell sx={{ fontSize: 12 }}>
                                  <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                                    {suites.length === 0 ? (
                                      <Typography variant="caption" sx={{ opacity: 0.6 }}>
                                        —
                                      </Typography>
                                    ) : (
                                      suites.map(s => (
                                        <Chip
                                          key={s}
                                          size="small"
                                          label={s}
                                          variant="outlined"
                                          sx={{ fontSize: 11 }}
                                        />
                                      ))
                                    )}
                                  </Stack>
                                </TableCell>
                                <TableCell sx={{ fontSize: 12 }}>
                                  <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                                    {comps.length === 0 ? (
                                      <Typography variant="caption" sx={{ opacity: 0.6 }}>
                                        —
                                      </Typography>
                                    ) : (
                                      comps.map(c => (
                                        <Chip
                                          key={c}
                                          size="small"
                                          label={c}
                                          variant="outlined"
                                          sx={{ fontSize: 11 }}
                                        />
                                      ))
                                    )}
                                  </Stack>
                                </TableCell>
                                <TableCell align="right">
                                  <Stack
                                    direction="row"
                                    spacing={1}
                                    alignItems="center"
                                    justifyContent="flex-end"
                                  >
                                    {busy && <CircularProgress size={14} />}
                                    <Switch
                                      size="small"
                                      checked={enabled}
                                      disabled={busy}
                                      onChange={e => handleToggle(file.path, idx, e.target.checked)}
                                    />
                                  </Stack>
                                </TableCell>
                              </TableRow>
                            )
                          })
                        )}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </CardContent>
              </Card>
            ))
          )}
        </Stack>
      )}

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={handleSnackbarClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert onClose={handleSnackbarClose} severity={snackbar.severity} variant="filled">
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
