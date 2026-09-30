'use client'

import { Alert, AlertTitle, Box, Button } from '@mui/material'

import { formatDate, formatDateTime } from './format'

// Values that hold a date: `since` and `next` read with their time.
const DATE_VALUES = new Set(['date', 'until'])
const DATETIME_VALUES = new Set(['since', 'next'])

const ICON = {
  quota: 'ri-server-line',
  expired: 'ri-calendar-close-line',
  expiring: 'ri-calendar-event-line',
  expiringFile: 'ri-calendar-event-line',
  leaseEnded: 'ri-wifi-off-line',
  syncFailing: 'ri-wifi-off-line',
  syncFailingNoLease: 'ri-wifi-off-line',
  moved: 'ri-arrow-left-right-line',
  movedEnded: 'ri-arrow-left-right-line',
  binding: 'ri-lock-2-line',
  cloned: 'ri-file-copy-line',
  revoked: 'ri-plug-2-line',
  identityChanged: 'ri-fingerprint-line',
  clockSkew: 'ri-time-line',
  noLicense: 'ri-inbox-line',
}

function formatValues(values, locale) {
  const out = {}

  for (const [k, v] of Object.entries(values)) {
    out[k] = DATE_VALUES.has(k) ? formatDate(v, locale) : DATETIME_VALUES.has(k) ? formatDateTime(v, locale) : v
  }

  return out
}

// handlers: { addNodes, renew, sync, requestFile, resetIdentity, reconnect,
// openAccount }, each a function or an href string.
// details: optional extra content per alert id, shown under its text.
export default function LicenseAlerts({ alerts, t, locale, busy, handlers, details = {} }) {
  if (alerts.length === 0) return null

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 2 }}>
      {alerts.map((a, i) => {
        const values = formatValues(a.values, locale)

        return (
          <Alert
            key={`${a.id}-${i}`}
            severity={a.severity}
            icon={<i className={ICON[a.id] || 'ri-error-warning-line'} style={{ fontSize: 18 }} />}
            sx={{ py: 0.75, alignItems: 'center', '& .MuiAlert-message': { fontSize: '0.8125rem', lineHeight: 1.5 } }}
            action={a.actions.length > 0 && (
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', alignSelf: 'center', flexWrap: 'wrap' }}>
                {a.actions.map(action => {
                  const h = handlers[action]
                  const common = { size: 'small', variant: 'outlined', color: a.severity, disabled: busy && typeof h === 'function' }

                  return typeof h === 'string'
                    ? <Button key={action} {...common} href={h} target='_blank' rel='noopener noreferrer'>{t(`settings.licenseTab.actions.${action}`)}</Button>
                    : <Button key={action} {...common} onClick={h}>{t(`settings.licenseTab.actions.${action}`)}</Button>
                })}
              </Box>
            )}
          >
            <AlertTitle sx={{ fontWeight: 600, fontSize: '0.875rem', mb: 0.25 }}>{t(`settings.licenseTab.alerts.${a.id}.title`, values)}</AlertTitle>
            {t(`settings.licenseTab.alerts.${a.id}.body`, values)}
            {details[a.id] && <Box sx={{ mt: 1.5 }}>{details[a.id]}</Box>}
          </Alert>
        )
      })}
    </Box>
  )
}
