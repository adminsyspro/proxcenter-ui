'use client'

import React from 'react'
import { useTranslations } from 'next-intl'
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'

import type { PredictiveAlert } from '../resources/types'

type OrchestratorAlert = {
  id?: string | number
  severity: string
  message?: string
  i18nKey?: string
  i18nParams?: Record<string, string | number>
  source?: string
  entityName?: string
  metric?: string
  currentValue?: number
  threshold?: number
  time?: string
}

function translateAlertMessage(alert: OrchestratorAlert, t: (key: string, params?: any) => string): string {
  if (alert.i18nKey) {
    try {
      return t(alert.i18nKey, alert.i18nParams || {})
    } catch {
      return alert.message || ''
    }
  }
  return alert.message || ''
}

function resourceLabel(resource: PredictiveAlert['resource'], t: (key: string) => string): string {
  switch (resource) {
    case 'cpu': return 'CPU'
    case 'ram': return t('monitoring.memory')
    case 'storage': return t('storage.title')
    default: return resource
  }
}

function resourceIcon(resource: PredictiveAlert['resource']): string {
  switch (resource) {
    case 'cpu': return 'ri-cpu-line'
    case 'ram': return 'ri-database-2-line'
    case 'storage': return 'ri-hard-drive-2-line'
    default: return 'ri-information-line'
  }
}

export default function AlertsDrillDownDialog({
  open,
  onClose,
  activeAlerts,
  predictiveAlerts,
}: {
  open: boolean
  onClose: () => void
  activeAlerts: OrchestratorAlert[]
  predictiveAlerts: PredictiveAlert[]
}) {
  const t = useTranslations()
  const theme = useTheme()

  const criticalActive = activeAlerts.filter(a => a.severity === 'critical' || a.severity === 'high')
  const warningActive = activeAlerts.filter(a => a.severity === 'warning' || a.severity === 'medium')
  const criticalPred = predictiveAlerts.filter(a => a.severity === 'critical')
  const warningPred = predictiveAlerts.filter(a => a.severity === 'warning')

  const totalCrit = criticalActive.length + criticalPred.length
  const totalWarn = warningActive.length + warningPred.length

  const severityColor = (severity: string) => {
    if (severity === 'critical' || severity === 'high') return theme.palette.error.main
    if (severity === 'warning' || severity === 'medium') return theme.palette.warning.main
    return theme.palette.info.main
  }

  const severityLabel = (severity: string) => {
    if (severity === 'critical' || severity === 'high') return t('alerts.critical').toUpperCase()
    if (severity === 'warning' || severity === 'medium') return t('alerts.warning').toUpperCase()
    return severity.toUpperCase()
  }

  const renderActiveAlert = (alert: OrchestratorAlert, idx: number) => {
    const color = severityColor(alert.severity)

    return (
      <ListItem
        key={`active-${idx}`}
        sx={{ py: 1.25, px: 2, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <ListItemText
          primary={
            <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
              <Chip
                size="small"
                label={severityLabel(alert.severity)}
                sx={{
                  height: 20,
                  fontSize: 10,
                  fontWeight: 700,
                  bgcolor: alpha(color, 0.1),
                  color,
                  minWidth: 64,
                }}
              />
              <Typography variant="body2" sx={{ fontWeight: 500, fontSize: 13 }}>
                {translateAlertMessage(alert, t)}
              </Typography>
            </Stack>
          }
          secondary={alert.source ? (
            <Typography variant="caption" sx={{ opacity: 0.6, display: 'block', mt: 0.5 }}>
              {alert.source}
              {alert.time && ` • ${new Date(alert.time).toLocaleString()}`}
            </Typography>
          ) : null}
        />
      </ListItem>
    )
  }

  const renderPredictiveAlert = (alert: PredictiveAlert, idx: number) => {
    const color = severityColor(alert.severity)
    const icon = resourceIcon(alert.resource)
    const label = resourceLabel(alert.resource, t)

    return (
      <ListItem
        key={`pred-${idx}`}
        sx={{ py: 1.25, px: 2, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <ListItemText
          primary={
            <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
              <Chip
                size="small"
                label={severityLabel(alert.severity)}
                sx={{
                  height: 20,
                  fontSize: 10,
                  fontWeight: 700,
                  bgcolor: alpha(color, 0.1),
                  color,
                  minWidth: 64,
                }}
              />
              <i className={icon} style={{ fontSize: 16, color, verticalAlign: 'middle' }} />
              <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13 }}>
                {label}
              </Typography>
              <Typography variant="body2" sx={{ fontSize: 13, opacity: 0.85 }}>
                {alert.currentValue.toFixed(1)}% → {alert.predictedValue.toFixed(1)}% {t('resources.forecast30d')}
              </Typography>
            </Stack>
          }
          secondary={
            <Stack direction="row" spacing={1.5} sx={{ mt: 0.5 }}>
              {alert.daysToThreshold != null && (
                <Typography variant="caption" sx={{ color, fontWeight: 600 }}>
                  {alert.daysToThreshold}{t('resources.daysUnit')} {t('resources.before')} {alert.threshold}%
                </Typography>
              )}
              {alert.confidence != null && (
                <Typography variant="caption" sx={{ opacity: 0.6 }}>
                  {t('resources.confidencePct', { value: Math.round(alert.confidence) })}
                </Typography>
              )}
            </Stack>
          }
        />
      </ListItem>
    )
  }

  const hasAny = criticalActive.length + warningActive.length + criticalPred.length + warningPred.length > 0

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <i className="ri-alarm-warning-line" style={{ fontSize: 20 }} />
          <Typography variant="h6" fontWeight={700} sx={{ fontSize: 16 }}>
            {t('inventory.alertsDialog.title')}
          </Typography>
          {totalCrit > 0 && (
            <Chip
              size="small"
              label={`${totalCrit} ${t('alerts.critical')}`}
              sx={{ height: 22, fontSize: 11, fontWeight: 600, bgcolor: alpha(theme.palette.error.main, 0.12), color: 'error.main' }}
            />
          )}
          {totalWarn > 0 && (
            <Chip
              size="small"
              label={`${totalWarn} ${t('alerts.warning')}`}
              sx={{ height: 22, fontSize: 11, fontWeight: 600, bgcolor: alpha(theme.palette.warning.main, 0.12), color: 'warning.main' }}
            />
          )}
        </Stack>
        <IconButton size="small" onClick={onClose}>
          <i className="ri-close-line" />
        </IconButton>
      </DialogTitle>
      <Divider />
      <DialogContent sx={{ p: 0 }}>
        {!hasAny ? (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <i className="ri-shield-check-line" style={{ fontSize: 32, color: theme.palette.success.main, opacity: 0.7 }} />
            <Typography variant="body2" sx={{ opacity: 0.6, mt: 1 }}>
              {t('alerts.noActiveAlerts')}
            </Typography>
          </Box>
        ) : (
          <>
            {(criticalActive.length > 0 || warningActive.length > 0) && (
              <Box>
                <Typography
                  variant="caption"
                  sx={{ display: 'block', px: 2, py: 1, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6, fontSize: 10, bgcolor: alpha(theme.palette.text.primary, 0.03) }}
                >
                  {t('inventory.alertsDialog.realAlertsSection')}
                </Typography>
                <List dense disablePadding>
                  {[...criticalActive, ...warningActive].map((alert, idx) => renderActiveAlert(alert, idx))}
                </List>
              </Box>
            )}
            {(criticalPred.length > 0 || warningPred.length > 0) && (
              <Box>
                <Typography
                  variant="caption"
                  sx={{ display: 'block', px: 2, py: 1, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6, fontSize: 10, bgcolor: alpha(theme.palette.text.primary, 0.03) }}
                >
                  {t('inventory.alertsDialog.predictiveAlertsSection')}
                </Typography>
                <List dense disablePadding>
                  {[...criticalPred, ...warningPred].map((alert, idx) => renderPredictiveAlert(alert, idx))}
                </List>
              </Box>
            )}
          </>
        )}
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} size="small">{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}
