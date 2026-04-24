'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  DialogContentText,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
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
import PbsStatusChip from './PbsStatusChip'

type PbsService = {
  service: string
  name?: string
  state: 'running' | 'stopped' | 'dead' | 'unknown' | string
  'unit-state'?: 'enabled' | 'disabled' | 'static' | 'masked' | string
  desc?: string
}

type ServiceAction = 'start' | 'stop' | 'restart' | 'reload'

interface PbsServicesTabProps {
  pbsId: string
}

type Order = 'asc' | 'desc'

function getServiceName(s: PbsService): string {
  return (s.service || s.name || '').toString()
}

function getStatusIcon(state: string): { icon: string; color: string } {
  if (state === 'running') return { icon: 'ri-checkbox-circle-fill', color: '#22c55e' }
  if (state === 'stopped') return { icon: 'ri-stop-circle-fill', color: '#64748b' }
  if (state === 'dead') return { icon: 'ri-close-circle-fill', color: '#ef4444' }
  return { icon: 'ri-question-fill', color: '#9ca3af' }
}

function getStatusDotColor(state: string): string {
  if (state === 'running') return '#22c55e'
  if (state === 'stopped') return '#ef4444'
  if (state === 'dead') return '#9ca3af'
  return '#9ca3af'
}

export default function PbsServicesTab({ pbsId }: PbsServicesTabProps) {
  const t = useTranslations()

  const [services, setServices] = useState<PbsService[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const [order, setOrder] = useState<Order>('asc')

  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [menuService, setMenuService] = useState<PbsService | null>(null)

  const [confirmOpen, setConfirmOpen] = useState<boolean>(false)
  const [pendingAction, setPendingAction] = useState<{
    service: PbsService
    action: ServiceAction
  } | null>(null)

  const [snackbar, setSnackbar] = useState<{
    open: boolean
    severity: 'success' | 'error'
    message: string
  }>({ open: false, severity: 'success', message: '' })

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchServices = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/pbs/${pbsId}/services`, { cache: 'no-store' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `HTTP ${res.status}`)
      }
      const body = await res.json()
      const data: PbsService[] = Array.isArray(body?.data) ? body.data : []
      setServices(data)
      setLastUpdated(new Date())
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [pbsId])

  useEffect(() => {
    fetchServices()
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    }
  }, [fetchServices])

  const sortedServices = useMemo(() => {
    const arr = [...services]
    arr.sort((a, b) => {
      const na = getServiceName(a).toLowerCase()
      const nb = getServiceName(b).toLowerCase()
      if (na < nb) return order === 'asc' ? -1 : 1
      if (na > nb) return order === 'asc' ? 1 : -1
      return 0
    })
    return arr
  }, [services, order])

  const handleSortName = () => {
    setOrder(prev => (prev === 'asc' ? 'desc' : 'asc'))
  }

  const openMenu = (e: React.MouseEvent<HTMLElement>, svc: PbsService) => {
    setMenuAnchor(e.currentTarget)
    setMenuService(svc)
  }

  const closeMenu = () => {
    setMenuAnchor(null)
    setMenuService(null)
  }

  const runAction = useCallback(
    async (svc: PbsService, action: ServiceAction) => {
      const name = getServiceName(svc)
      try {
        const res = await fetch(
          `/api/v1/pbs/${pbsId}/services/${encodeURIComponent(name)}/${action}`,
          { method: 'POST' }
        )
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error || `HTTP ${res.status}`)
        }
        setSnackbar({
          open: true,
          severity: 'success',
          message: t('inventory.pbsServicesActionSuccess', { name, action }),
        })
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = setTimeout(() => {
          fetchServices()
        }, 1000)
      } catch (e: any) {
        setSnackbar({
          open: true,
          severity: 'error',
          message:
            t('inventory.pbsServicesActionError', { name, action }) +
            (e?.message ? ` (${e.message})` : ''),
        })
      }
    },
    [pbsId, fetchServices, t]
  )

  const handleActionClick = (action: ServiceAction) => {
    const svc = menuService
    closeMenu()
    if (!svc) return

    if (action === 'stop' || action === 'restart') {
      setPendingAction({ service: svc, action })
      setConfirmOpen(true)
      return
    }

    runAction(svc, action)
  }

  const handleConfirm = () => {
    const pa = pendingAction
    setConfirmOpen(false)
    setPendingAction(null)
    if (pa) runAction(pa.service, pa.action)
  }

  const handleCancel = () => {
    setConfirmOpen(false)
    setPendingAction(null)
  }

  const handleSnackbarClose = () => setSnackbar(s => ({ ...s, open: false }))

  const actionLabel = (action: ServiceAction): string =>
    t(`inventory.pbsServicesAction.${action}`)

  const statusLabel = (state: string): string => {
    const known = ['running', 'stopped', 'dead', 'unknown']
    if (known.includes(state)) {
      return t(`inventory.pbsServicesStatus.${state}`)
    }
    return state || t('inventory.pbsServicesStatus.unknown')
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
            onClick={fetchServices}
            disabled={loading}
            startIcon={<i className="ri-refresh-line" style={{ fontSize: 16 }} />}
          >
            {t('inventory.pbsServicesRefresh')}
          </Button>
        </Stack>
        {lastUpdated && (
          <Typography variant="caption" sx={{ opacity: 0.6 }}>
            {t('inventory.pbsServicesLastUpdated')}: {lastUpdated.toLocaleTimeString()}
          </Typography>
        )}
      </Box>

      {/* Content */}
      {loading && services.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, py: 6 }}>
          <CircularProgress size={32} />
        </Box>
      ) : error ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={fetchServices}>
              {t('inventory.pbsServicesRefresh')}
            </Button>
          }
        >
          {t('inventory.pbsServicesLoadError')}: {error}
        </Alert>
      ) : (
        <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sortDirection={order}>
                  <TableSortLabel active direction={order} onClick={handleSortName}>
                    {t('inventory.pbsServicesCol.name')}
                  </TableSortLabel>
                </TableCell>
                <TableCell>{t('inventory.pbsServicesCol.status')}</TableCell>
                <TableCell>{t('inventory.pbsServicesCol.unit')}</TableCell>
                <TableCell>{t('inventory.pbsServicesCol.description')}</TableCell>
                <TableCell align="right">{t('inventory.pbsServicesCol.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedServices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} sx={{ textAlign: 'center', py: 4, opacity: 0.6 }}>
                    —
                  </TableCell>
                </TableRow>
              ) : (
                sortedServices.map(svc => {
                  const name = getServiceName(svc)
                  const state = String(svc.state || 'unknown')
                  const unitState = String(svc['unit-state'] || '')
                  const desc = svc.desc || ''
                  const isRunning = state === 'running'

                  return (
                    <TableRow key={name} hover>
                      <TableCell sx={{ fontSize: 12 }}>
                        {name}
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const ic = getStatusIcon(state)
                          return (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                              <i className={ic.icon} style={{ fontSize: 18, color: ic.color }} />
                              <Typography variant="body2">{statusLabel(state)}</Typography>
                            </Box>
                          )
                        })()}
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption">{unitState || '—'}</Typography>
                      </TableCell>
                      <TableCell
                        sx={{
                          maxWidth: 360,
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
                      <TableCell align="right">
                        <IconButton size="small" onClick={e => openMenu(e, svc)}>
                          <i className="ri-more-2-fill" style={{ fontSize: 16 }} />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Action menu */}
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        <MenuItem
          onClick={() => handleActionClick('start')}
          disabled={menuService ? String(menuService.state) === 'running' : false}
        >
          <i className="ri-play-circle-line" style={{ fontSize: 16, marginRight: 8 }} />
          {actionLabel('start')}
        </MenuItem>
        <MenuItem
          onClick={() => handleActionClick('stop')}
          disabled={menuService ? String(menuService.state) !== 'running' : false}
        >
          <i className="ri-stop-circle-line" style={{ fontSize: 16, marginRight: 8 }} />
          {actionLabel('stop')}
        </MenuItem>
        <MenuItem onClick={() => handleActionClick('restart')}>
          <i className="ri-restart-line" style={{ fontSize: 16, marginRight: 8 }} />
          {actionLabel('restart')}
        </MenuItem>
        <MenuItem onClick={() => handleActionClick('reload')}>
          <i className="ri-refresh-line" style={{ fontSize: 16, marginRight: 8 }} />
          {actionLabel('reload')}
        </MenuItem>
      </Menu>

      {/* Confirmation dialog */}
      <Dialog open={confirmOpen} onClose={handleCancel} maxWidth="xs" fullWidth>
        <DialogTitle>{t('inventory.pbsServicesConfirmTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {pendingAction
              ? t('inventory.pbsServicesConfirmBody', {
                  action: actionLabel(pendingAction.action).toLowerCase(),
                  name: getServiceName(pendingAction.service),
                })
              : ''}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancel}>{t('common.cancel')}</Button>
          <Button
            onClick={handleConfirm}
            color={pendingAction?.action === 'stop' ? 'error' : 'primary'}
            variant="contained"
            autoFocus
          >
            {pendingAction ? actionLabel(pendingAction.action) : ''}
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
