'use client'

import React, { useState } from 'react'

import { useRouter } from 'next/navigation'

import { useTranslations } from 'next-intl'
import {
  Box, Button, ButtonBase, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, IconButton, List, ListItemButton, ListItemText, Typography, useTheme
} from '@mui/material'

import { widgetColors } from './themeColors'

function translateAlertMessage(alert, t) {
  if (alert?.i18nKey) {
    try {
      return t(alert.i18nKey, alert.i18nParams || {})
    } catch {
      return alert.message
    }
  }
  return alert?.message
}

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

  const details = [
    { label: t('alerts.detail.message'), value: translateAlertMessage(alert, t) },
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
          <Chip size='small' label={cfg.label} color={cfg.color} sx={{ height: 22, fontSize: 11 }} />
          {t('alerts.detail.title')}
        </Box>
        <IconButton size='small' onClick={onClose}>
          <i className='ri-close-line' />
        </IconButton>
      </DialogTitle>
      <Divider />
      <DialogContent sx={{ py: 2 }}>
        {details.map((row, idx) => (
          <Box key={idx} sx={{ display: 'flex', py: 0.75, borderBottom: idx < details.length - 1 ? '1px solid' : 'none', borderColor: 'divider' }}>
            <Typography variant='body2' sx={{ fontWeight: 600, width: 140, flexShrink: 0, color: 'text.secondary', fontSize: 13 }}>
              {row.label}
            </Typography>
            <Typography variant='body2' sx={{ fontSize: 13 }}>
              {row.value}
            </Typography>
          </Box>
        ))}
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

function AlertsListDialog({ alerts, open, onClose, t, router }) {
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

  function timeAgo(date) {
    const now = new Date()
    const past = new Date(date)
    const diff = Math.floor((now - past) / 1000)

    if (diff < 60) return t('time.justNow')
    if (diff < 3600) return t('time.minutesAgo', { count: Math.floor(diff / 60) })
    if (diff < 86400) return t('time.hoursAgo', { count: Math.floor(diff / 3600) })
    
return t('time.daysAgo', { count: Math.floor(diff / 86400) })
  }

  const severityConfig = {
    crit: { label: 'CRIT', color: 'error' },
    warn: { label: 'WARN', color: 'warning' },
    info: { label: 'INFO', color: 'info' },
  }

  return (
    <>
      <Dialog open={open && !selectedAlert} onClose={onClose} maxWidth='sm' fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className='ri-alarm-warning-line' style={{ fontSize: 20 }} />
            {t('alerts.title')} ({alerts.length})
          </Box>
          <IconButton size='small' onClick={onClose}>
            <i className='ri-close-line' />
          </IconButton>
        </DialogTitle>
        <Divider />
        <DialogContent sx={{ p: 0 }}>
          {alerts.length === 0 ? (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <Typography variant='body2' sx={{ opacity: 0.5 }}>{t('alerts.noActiveAlerts')}</Typography>
            </Box>
          ) : (
            <List dense disablePadding>
              {alerts.map((alert, idx) => {
                const cfg = severityConfig[alert.severity] || severityConfig.info

                return (
                  <ListItemButton
                    key={idx}
                    onClick={() => setSelectedAlert(alert)}
                    sx={{ px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}
                  >
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Chip size='small' label={cfg.label} color={cfg.color} sx={{ height: 20, fontSize: 10, minWidth: 44 }} />
                          <Typography variant='body2' sx={{ fontWeight: 600, fontSize: 13 }}>
                            {translateAlertMessage(alert, t)}
                          </Typography>
                        </Box>
                      }
                      secondary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                          <Typography variant='caption' sx={{ opacity: 0.5 }}>{timeAgo(alert.time)}</Typography>
                          <Typography variant='caption' sx={{ opacity: 0.4 }}>• {alert.source}</Typography>
                        </Box>
                      }
                    />
                    <i className='ri-arrow-right-s-line' style={{ fontSize: 18, opacity: 0.3 }} />
                  </ListItemButton>
                )
              })}
            </List>
          )}
        </DialogContent>
        <Divider />
        <DialogActions sx={{ px: 3, py: 1.5 }}>
          <Button onClick={onClose} size='small'>{t('alerts.detail.close')}</Button>
        </DialogActions>
      </Dialog>

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

function KpiAlertsWidget({ data, loading }) {
  const t = useTranslations()
  const router = useRouter()
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const c = widgetColors(isDark)
  const [dialogOpen, setDialogOpen] = useState(false)

  const alertsSummary = data?.alertsSummary || {}
  const alerts = data?.alerts || []
  const hasCrit = alertsSummary.crit > 0
  const hasWarn = alertsSummary.warn > 0
  const totalAlerts = (alertsSummary.crit || 0) + (alertsSummary.warn || 0)

  const color = hasCrit ? '#f44336' : hasWarn ? '#ff9800' : '#4caf50'

  return (
    <>
      {hasCrit && (
        <style>{`
          @keyframes kpiAlertPulse {
            0% { box-shadow: 0 0 0 0 rgba(244, 67, 54, 0.45); }
            70% { box-shadow: 0 0 0 10px rgba(244, 67, 54, 0); }
            100% { box-shadow: 0 0 0 0 rgba(244, 67, 54, 0); }
          }
          @keyframes kpiIconShake {
            0%, 100% { transform: rotate(0deg); }
            20% { transform: rotate(-8deg); }
            40% { transform: rotate(8deg); }
            60% { transform: rotate(-5deg); }
            80% { transform: rotate(5deg); }
          }
        `}</style>
      )}
      <ButtonBase
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => setDialogOpen(true)}
        component="div"
        sx={{ height: '100%', width: '100%', display: 'block', borderRadius: 2.5, textAlign: 'left' }}
      >
        <Box
          sx={{
            bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
            border: '1px solid', borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
            borderRadius: 2.5, p: 1.5, height: '100%',
            display: 'flex', alignItems: 'center', gap: 1.5,
          }}
        >
          <Box sx={{
            width: 56, height: 56, borderRadius: '50%',
            bgcolor: `${color}18`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
            ...(hasCrit && { animation: 'kpiAlertPulse 2s ease-in-out infinite' }),
          }}>
            <i className='ri-alarm-warning-line' style={{
              fontSize: 24, color,
              ...(hasCrit && { animation: 'kpiIconShake 3s ease-in-out infinite' }),
            }} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: 10, opacity: 0.65, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {t('dashboard.widgets.alerts')}
            </Typography>
            <Typography sx={{ fontSize: 18, fontWeight: 800, color, lineHeight: 1.2, fontFamily: '"JetBrains Mono", monospace' }}>
              {hasCrit ? `${alertsSummary.crit} CRIT` : hasWarn ? `${alertsSummary.warn} WARN` : 'OK'}
            </Typography>
            <Typography sx={{ fontSize: 10, opacity: 0.6 }}>
              {hasCrit || hasWarn ? `${alertsSummary.crit || 0} crit \u2022 ${alertsSummary.warn || 0} warn` : t('alerts.noActiveAlerts')}
            </Typography>
          </Box>
        </Box>
      </ButtonBase>

      <AlertsListDialog
        alerts={alerts}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        t={t}
        router={router}
      />
    </>
  )
}

export default React.memo(KpiAlertsWidget)
