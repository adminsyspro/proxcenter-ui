'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, IconButton, List, ListItemButton, ListItemText, Table, TableBody,
  TableCell, TableRow, Typography
} from '@mui/material'

function AlertDetailDialog({ alert, open, onClose, onNavigate, router, t }) {
  if (!alert) return null

  const severityConfig = {
    crit: { label: 'CRITICAL', color: 'error' },
    warn: { label: 'WARNING', color: 'warning' },
    info: { label: 'INFO', color: 'info' },
  }

  const cfg = severityConfig[alert.severity] || severityConfig.info

  function getEntityLink(a) {
    if (a.entityType === 'node' && a.connId && a.entityId) {
      return `/infrastructure/inventory?selectType=node&selectId=${a.connId}:${a.entityId}`
    }
    if (a.entityType === 'cluster' && a.connId) {
      return `/infrastructure/inventory?selectType=cluster&selectId=${a.connId}`
    }
    return null
  }

  const entityLink = getEntityLink(alert)

  const sourceValue = entityLink ? (
    <Typography
      variant='body2'
      component='span'
      sx={{ fontSize: 13, color: 'primary.main', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
      onClick={() => { router.push(entityLink); onClose() }}
    >
      {alert.source} <i className='ri-external-link-line' style={{ fontSize: 11 }} />
    </Typography>
  ) : alert.source

  const rows = [
    { label: t('alerts.detail.severity'), value: <Chip size='small' label={cfg.label} color={cfg.color} sx={{ height: 22, fontSize: 11 }} /> },
    { label: t('alerts.detail.message'), value: alert.message },
    { label: t('alerts.detail.source'), value: sourceValue },
    { label: t('alerts.detail.sourceType'), value: (alert.sourceType || 'pve').toUpperCase() },
    alert.entityName && { label: t('alerts.detail.entity'), value: alert.entityName },
    alert.entityType && { label: t('alerts.detail.entityType'), value: alert.entityType },
    alert.metric && { label: t('alerts.detail.metric'), value: alert.metric },
    alert.currentValue != null && { label: t('alerts.detail.currentValue'), value: `${alert.currentValue}%` },
    alert.threshold != null && { label: t('alerts.detail.threshold'), value: `${alert.threshold}%` },
    alert.time && { label: t('alerts.detail.time'), value: new Date(alert.time).toLocaleString() },
  ].filter(Boolean)

  return (
    <Dialog open={open} onClose={onClose} maxWidth='sm' fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className='ri-alarm-warning-line' style={{ fontSize: 20 }} />
          {t('alerts.detail.title')}
        </Box>
        <IconButton size='small' onClick={onClose}>
          <i className='ri-close-line' />
        </IconButton>
      </DialogTitle>
      <Divider />
      <DialogContent sx={{ p: 0 }}>
        <Table size='small'>
          <TableBody>
            {rows.map((row, idx) => (
              <TableRow key={idx}>
                <TableCell sx={{ fontWeight: 600, width: 140, color: 'text.secondary', fontSize: 13, border: 'none', py: 1.25, pl: 3 }}>
                  {row.label}
                </TableCell>
                <TableCell sx={{ fontSize: 13, border: 'none', py: 1.25 }}>
                  {row.value}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        {onNavigate && (
          <Button
            variant='outlined'
            size='small'
            startIcon={<i className='ri-external-link-line' />}
            onClick={() => { onNavigate(); onClose() }}
          >
            {t('alerts.detail.goToEntity')}
          </Button>
        )}
        <Button onClick={onClose} size='small'>{t('alerts.detail.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}

function AlertsListWidget({ data, loading }) {
  const t = useTranslations()
  const router = useRouter()
  const [selectedAlert, setSelectedAlert] = useState(null)

  function getAlertLink(alert) {
    if (alert.entityType === 'node' && alert.connId && alert.entityId) {
      return `/infrastructure/inventory?selectType=node&selectId=${alert.connId}:${alert.entityId}`
    }
    if (alert.entityType === 'cluster' && alert.entityId) {
      return `/infrastructure/inventory?selectType=cluster&selectId=${alert.entityId}`
    }
    return null
  }

  const alerts = data?.alerts || []

  function timeAgo(date) {
    const now = new Date()
    const past = new Date(date)
    const diff = Math.floor((now - past) / 1000)

    if (diff < 60) return t('time.justNow')
    if (diff < 3600) return t('time.minutesAgo', { count: Math.floor(diff / 60) })
    if (diff < 86400) return t('time.hoursAgo', { count: Math.floor(diff / 3600) })

    return t('time.daysAgo', { count: Math.floor(diff / 86400) })
  }

  if (alerts.length === 0) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
        <Alert severity='success' sx={{ width: '100%' }}>{t('alerts.noActiveAlerts')}</Alert>
      </Box>
    )
  }

  const severityConfig = {
    crit: { label: 'CRIT', color: 'error' },
    warn: { label: 'WARN', color: 'warning' },
    info: { label: 'INFO', color: 'info' },
  }

  return (
    <>
      <List dense disablePadding sx={{ height: '100%', overflow: 'auto', p: 0.5 }}>
        {alerts.map((alert, idx) => {
          const cfg = severityConfig[alert.severity] || severityConfig.info

          return (
            <ListItemButton
              key={idx}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setSelectedAlert(alert)}
              sx={{
                px: 0.5, py: 0.5, borderRadius: 0.5,
              }}
            >
              <ListItemText
                primary={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <Chip
                      size='small'
                      label={cfg.label}
                      color={cfg.color}
                      sx={{ height: 18, fontSize: 9, minWidth: 40 }}
                    />
                    <Typography variant='caption' sx={{
                      fontWeight: 600, overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11
                    }}>
                      {alert.message}
                    </Typography>
                  </Box>
                }
                secondary={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.25 }}>
                    <Typography variant='caption' sx={{ opacity: 0.5, fontSize: 9 }}>
                      {timeAgo(alert.time)}
                    </Typography>
                    <Typography variant='caption' sx={{ opacity: 0.4, fontSize: 9 }}>
                      • {alert.source}
                    </Typography>
                  </Box>
                }
              />
            </ListItemButton>
          )
        })}
      </List>

      <AlertDetailDialog
        alert={selectedAlert}
        open={!!selectedAlert}
        onClose={() => setSelectedAlert(null)}
        onNavigate={selectedAlert && getAlertLink(selectedAlert) ? () => router.push(getAlertLink(selectedAlert)) : null}
        router={router}
        t={t}
      />
    </>
  )
}

export default React.memo(AlertsListWidget)
