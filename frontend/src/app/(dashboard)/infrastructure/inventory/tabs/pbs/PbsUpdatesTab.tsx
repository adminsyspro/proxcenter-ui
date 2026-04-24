'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
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
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Tooltip,
  Typography,
} from '@mui/material'

interface PbsUpdatesTabProps {
  pbsId: string
}

type PbsPackage = {
  Package: string
  Version?: string
  OldVersion?: string
  Origin?: string
  Priority?: string
  Section?: string
  Description?: string
  Title?: string
}

type Order = 'asc' | 'desc'

export default function PbsUpdatesTab({ pbsId }: PbsUpdatesTabProps) {
  const t = useTranslations()

  const [packages, setPackages] = useState<PbsPackage[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const [order, setOrder] = useState<Order>('asc')

  const [refreshingDb, setRefreshingDb] = useState<boolean>(false)

  const [snackbar, setSnackbar] = useState<{
    open: boolean
    severity: 'success' | 'error'
    message: string
  }>({ open: false, severity: 'success', message: '' })

  // Changelog dialog
  const [changelogOpen, setChangelogOpen] = useState<boolean>(false)
  const [changelogPkg, setChangelogPkg] = useState<PbsPackage | null>(null)
  const [changelogText, setChangelogText] = useState<string>('')
  const [changelogLoading, setChangelogLoading] = useState<boolean>(false)
  const [changelogError, setChangelogError] = useState<string | null>(null)
  const [changelogForbidden, setChangelogForbidden] = useState<{ requiredPriv?: string } | null>(null)

  // Upgrade dialog (PBS has no REST endpoint for apt dist-upgrade — must run via Shell/SSH)
  const [upgradeOpen, setUpgradeOpen] = useState<boolean>(false)
  const [pbsBaseUrl, setPbsBaseUrl] = useState<string>('')

  const fetchUpdates = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/pbs/${pbsId}/updates`, { cache: 'no-store' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `HTTP ${res.status}`)
      }
      const body = await res.json()
      const data: PbsPackage[] = Array.isArray(body?.data) ? body.data : []
      setPackages(data)
      setLastUpdated(new Date())
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [pbsId])

  useEffect(() => {
    fetchUpdates()
  }, [fetchUpdates])

  const sortedPackages = useMemo(() => {
    const arr = [...packages]
    arr.sort((a, b) => {
      const na = (a.Package || '').toLowerCase()
      const nb = (b.Package || '').toLowerCase()
      if (na < nb) return order === 'asc' ? -1 : 1
      if (na > nb) return order === 'asc' ? 1 : -1
      return 0
    })
    return arr
  }, [packages, order])

  const handleSortName = () => {
    setOrder(prev => (prev === 'asc' ? 'desc' : 'asc'))
  }

  const handleRefreshDb = useCallback(async () => {
    setRefreshingDb(true)
    try {
      const res = await fetch(`/api/v1/pbs/${pbsId}/updates/refresh`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `HTTP ${res.status}`)
      }
      setSnackbar({
        open: true,
        severity: 'success',
        message: t('inventory.pbsUpdatesRefreshStarted'),
      })
      setTimeout(() => {
        fetchUpdates()
      }, 3000)
    } catch (e: any) {
      setSnackbar({
        open: true,
        severity: 'error',
        message: e?.message || String(e),
      })
    } finally {
      setRefreshingDb(false)
    }
  }, [pbsId, t, fetchUpdates])

  const openChangelog = useCallback(
    async (pkg: PbsPackage) => {
      setChangelogOpen(true)
      setChangelogPkg(pkg)
      setChangelogText('')
      setChangelogError(null)
      setChangelogForbidden(null)
      setChangelogLoading(true)
      try {
        const qs = new URLSearchParams({
          name: pkg.Package || '',
          version: pkg.Version || '',
        })
        const res = await fetch(
          `/api/v1/pbs/${pbsId}/updates/changelog?${qs.toString()}`,
          { cache: 'no-store' }
        )
        const body = await res.json().catch(() => ({}))
        if (res.status === 403 && body?.forbidden) {
          setChangelogForbidden({ requiredPriv: body?.requiredPriv })
          return
        }
        if (!res.ok) {
          throw new Error(body?.error || `HTTP ${res.status}`)
        }
        setChangelogText(String(body?.data?.changelog || ''))
      } catch (e: any) {
        setChangelogError(e?.message || String(e))
      } finally {
        setChangelogLoading(false)
      }
    },
    [pbsId]
  )

  const closeChangelog = () => {
    setChangelogOpen(false)
    setChangelogPkg(null)
    setChangelogText('')
    setChangelogError(null)
    setChangelogForbidden(null)
  }

  const handleSnackbarClose = () => setSnackbar(s => ({ ...s, open: false }))

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
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Button
            variant="outlined"
            size="small"
            onClick={fetchUpdates}
            disabled={loading}
            startIcon={<i className="ri-refresh-line" style={{ fontSize: 16 }} />}
          >
            {t('inventory.pbsUpdatesRefresh')}
          </Button>
          <Button
            variant="contained"
            size="small"
            onClick={handleRefreshDb}
            disabled={refreshingDb}
            startIcon={
              refreshingDb ? (
                <CircularProgress size={14} sx={{ color: 'inherit' }} />
              ) : (
                <i className="ri-download-cloud-2-line" style={{ fontSize: 16 }} />
              )
            }
          >
            {t('inventory.pbsUpdatesRefreshDb')}
          </Button>
          <Button
            variant="contained"
            color="warning"
            size="small"
            onClick={() => {
              setUpgradeOpen(true)
              fetch(`/api/v1/pbs/${pbsId}/info`, { cache: 'no-store' })
                .then(r => r.ok ? r.json() : null)
                .then(b => setPbsBaseUrl(b?.data?.baseUrl || ''))
                .catch(() => {})
            }}
            disabled={packages.length === 0}
            startIcon={<i className="ri-install-line" style={{ fontSize: 16 }} />}
          >
            {t('inventory.pbsUpdatesUpgrade')}
          </Button>
        </Stack>
        <Stack direction="row" spacing={1.5} alignItems="center">
          {lastUpdated && (
            <Typography variant="caption" sx={{ opacity: 0.6 }}>
              {t('inventory.pbsUpdatesLastUpdated')}: {lastUpdated.toLocaleTimeString()}
            </Typography>
          )}
          {!loading && !error && (
            <Chip
              size="small"
              color={packages.length > 0 ? 'warning' : 'success'}
              label={t('inventory.pbsUpdatesCount', { count: packages.length })}
              sx={{ fontWeight: 600 }}
            />
          )}
        </Stack>
      </Box>

      {/* Content */}
      {loading && packages.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, py: 6 }}>
          <CircularProgress size={32} />
        </Box>
      ) : error ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={fetchUpdates}>
              {t('inventory.pbsUpdatesRefresh')}
            </Button>
          }
        >
          {t('inventory.pbsUpdatesLoadError')}: {error}
        </Alert>
      ) : sortedPackages.length === 0 ? (
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
          <i
            className="ri-checkbox-circle-line"
            style={{ fontSize: 64, color: '#22c55e' }}
          />
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            {t('inventory.pbsUpdatesEmpty')}
          </Typography>
        </Box>
      ) : (
        <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sortDirection={order}>
                  <TableSortLabel active direction={order} onClick={handleSortName}>
                    {t('inventory.pbsUpdatesCol.package')}
                  </TableSortLabel>
                </TableCell>
                <TableCell>{t('inventory.pbsUpdatesCol.current')}</TableCell>
                <TableCell>{t('inventory.pbsUpdatesCol.new')}</TableCell>
                <TableCell>{t('inventory.pbsUpdatesCol.origin')}</TableCell>
                <TableCell>{t('inventory.pbsUpdatesCol.description')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedPackages.map(pkg => {
                const pkgName = pkg.Package || ''
                const oldVer = pkg.OldVersion || '—'
                const newVer = pkg.Version || '—'
                const origin = pkg.Origin || '—'
                const desc = pkg.Title || pkg.Description || ''
                return (
                  <TableRow
                    key={`${pkgName}-${newVer}`}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => openChangelog(pkg)}
                  >
                    <TableCell sx={{ fontSize: 12 }}>
                      {pkgName}
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      <Typography variant="caption">{oldVer}</Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      <Typography
                        variant="caption"
                        sx={{ color: 'success.main', fontWeight: 600 }}
                      >
                        {newVer}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={origin}
                        variant="outlined"
                        sx={{ fontSize: 11 }}
                      />
                    </TableCell>
                    <TableCell
                      sx={{
                        maxWidth: 400,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <Tooltip title={desc} placement="top-start">
                        <Typography
                          variant="caption"
                          sx={{
                            display: 'block',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {desc || '—'}
                        </Typography>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Changelog dialog */}
      <Dialog open={changelogOpen} onClose={closeChangelog} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pr: 6 }}>
          <i className="ri-file-list-3-line" style={{ fontSize: 18 }} />
          <Box component="span" sx={{ fontWeight: 700 }}>
            {t('inventory.pbsUpdatesChangelogTitle')}
          </Box>
          {changelogPkg && (
            <>
              <Box component="span" sx={{ fontWeight: 600, fontSize: 14 }}>
                {changelogPkg.Package} {changelogPkg.Version}
              </Box>
              {changelogPkg.Origin && (
                <Chip
                  size="small"
                  label={changelogPkg.Origin}
                  variant="outlined"
                  sx={{ ml: 'auto' }}
                />
              )}
            </>
          )}
          <IconButton
            aria-label="close"
            onClick={closeChangelog}
            sx={{ position: 'absolute', right: 8, top: 8 }}
          >
            <i className="ri-close-line" style={{ fontSize: 18 }} />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          {changelogLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 6 }}>
              <CircularProgress size={28} />
            </Box>
          ) : changelogForbidden ? (
            <Box sx={{ p: 2 }}>
              <Alert severity="warning" icon={<i className="ri-lock-line" style={{ fontSize: 20 }} />}>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                  {t('inventory.pbsUpdatesChangelogForbidden')}
                </Typography>
                {changelogForbidden.requiredPriv && (
                  <Typography variant="caption" sx={{ opacity: 0.8 }}>
                    {t('inventory.pbsUpdatesChangelogRequiredPriv', { priv: changelogForbidden.requiredPriv })}
                  </Typography>
                )}
              </Alert>
            </Box>
          ) : changelogError ? (
            <Box sx={{ p: 2 }}>
              <Alert severity="error">
                {t('inventory.pbsUpdatesChangelogError')}: {changelogError}
              </Alert>
            </Box>
          ) : (
            <Box
              component="pre"
              sx={{
                m: 0,
                bgcolor: '#1e1e1e',
                color: '#d4d4d4',
                
                fontSize: 12,
                lineHeight: 1.5,
                overflow: 'auto',
                maxHeight: '70vh',
                p: 2,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {changelogText.trim().length === 0 ? (
                <Box sx={{ opacity: 0.5, fontStyle: 'italic' }}>
                  {t('inventory.pbsUpdatesChangelogEmpty')}
                </Box>
              ) : (
                changelogText
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeChangelog} variant="contained">
            {t('inventory.pbsUpdatesChangelogClose')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Upgrade dialog */}
      <Dialog open={upgradeOpen} onClose={() => setUpgradeOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-install-line" style={{ fontSize: 20 }} />
          {t('inventory.pbsUpdatesUpgradeTitle')}
        </DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            {t('inventory.pbsUpdatesUpgradeInfo')}
          </Alert>
          <Typography variant="body2" sx={{ mb: 1, fontWeight: 600 }}>
            {t('inventory.pbsUpdatesUpgradeCommandLabel')}
          </Typography>
          <Box
            sx={{
              p: 1.5,
              bgcolor: 'action.hover',
              borderRadius: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1,
              mb: 2,
            }}
          >
            <Typography variant="body2" sx={{ flex: 1, wordBreak: 'break-all' }}>
              apt update && apt dist-upgrade -y
            </Typography>
            <Tooltip title={t('inventory.pbsUpdatesUpgradeCopy')}>
              <IconButton
                size="small"
                onClick={() => {
                  navigator.clipboard.writeText('apt update && apt dist-upgrade -y')
                  setSnackbar({
                    open: true,
                    severity: 'success',
                    message: t('inventory.pbsUpdatesUpgradeCopied'),
                  })
                }}
              >
                <i className="ri-file-copy-line" style={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>
          <Typography variant="caption" sx={{ opacity: 0.7 }}>
            {t('inventory.pbsUpdatesUpgradeHint')}
          </Typography>
        </DialogContent>
        <DialogActions>
          {pbsBaseUrl && (
            <Button
              variant="outlined"
              component="a"
              href={pbsBaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              startIcon={<i className="ri-external-link-line" style={{ fontSize: 16 }} />}
            >
              {t('inventory.pbsUpdatesUpgradeOpenPbs')}
            </Button>
          )}
          <Button onClick={() => setUpgradeOpen(false)}>
            {t('inventory.pbsUpdatesChangelogClose')}
          </Button>
        </DialogActions>
      </Dialog>

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
