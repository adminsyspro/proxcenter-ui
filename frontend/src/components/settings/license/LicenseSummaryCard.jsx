'use client'

import { useState } from 'react'

import { Box, Button, Card, CardContent, Chip, LinearProgress, Tooltip, Typography } from '@mui/material'

import { LogoIcon } from '@components/layout/shared/Logo'

import { formatAgo, formatDate, formatDateTime } from './format'

const SEVERITY_COLOR = { error: 'error', warning: 'warning', info: 'info' }

// The fact an alert is about takes the alert's colour, so the eye lands on
// the value that needs attention.
const FACT_OF_ALERT = {
  quota: 'nodes',
  expired: 'validUntil',
  expiring: 'validUntil',
  expiringFile: 'validUntil',
  syncFailing: 'source',
  syncFailingNoLease: 'source',
  leaseEnded: 'source',
}

// inline: the label sits before the value on the same line, not above it.
function Fact({ label, children, color, inline = false }) {
  return (
    <Box sx={{ minWidth: 0, ...(inline && { display: 'flex', alignItems: 'baseline', gap: 1 }) }}>
      <Typography variant='caption' color='text.secondary' display='block' sx={{ mb: inline ? 0 : 0.5, whiteSpace: 'nowrap' }}>{label}</Typography>
      <Box sx={{ color: color ? `${color}.main` : 'text.primary', minWidth: 0 }}>{children}</Box>
    </Box>
  )
}

// extra: inline content on the same text line, so it shares its baseline.
function Value({ main, sub, extra }) {
  return (
    <Typography variant='body1' fontWeight={600} color='inherit'>
      {main}
      {sub && <Typography component='span' variant='body2' color='text.secondary' sx={{ fontWeight: 400, ml: 0.75 }}>{sub}</Typography>}
      {extra}
    </Typography>
  )
}

function StatusPill({ summary, alerts, t }) {
  const worst = alerts[0]

  if (worst) {
    return <Chip size='small' color={SEVERITY_COLOR[worst.severity]} label={t(`settings.licenseTab.alerts.${worst.id}.pill`)} />
  }

  if (summary.state === 'awaiting') return <Chip size='small' variant='outlined' color='info' label={t('settings.licenseTab.summary.pillAwaiting')} />

  return summary.state === 'community'
    ? <Chip size='small' variant='outlined' label={t('settings.licenseTab.summary.pillCommunity')} />
    : <Chip size='small' color='success' variant='outlined' label={t('settings.licenseTab.summary.pillActive')} />
}

// The partner's logo, then its name; a logo that fails to load leaves the name.
// Keyed by the logo url (versioned by digest): a replaced logo is tried again.
function PartnerSource({ partner }) {
  const [failed, setFailed] = useState(false)

  return (
    <Box component='span' sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, verticalAlign: 'middle' }}>
      {partner.logoUrl && !failed && (
        <Box component='img' src={partner.logoUrl} alt={partner.name} onError={() => setFailed(true)} sx={{ height: 20, maxWidth: 96, objectFit: 'contain', display: 'block' }} />
      )}
      {partner.name}
    </Box>
  )
}

// Where the license comes from: proxcenter.io (and the partner that delivers
// it), a request file or a pasted key; a failing sync is told on the same line.
function SourceFact({ source, syncAlert, color, t, locale }) {
  return (
    <Fact
      inline
      label={t(source?.kind === 'portal' ? 'settings.licenseTab.summary.receivedFrom' : 'settings.licenseTab.summary.activatedBy')}
      color={color}
    >
      {source?.kind === 'portal' && (
        <Value
          main={source.partner ? <PartnerSource key={source.partner.logoUrl || 'none'} partner={source.partner} /> : 'proxcenter.io'}
          sub={[
            source.partner ? t('settings.licenseTab.summary.viaPortal') : null,
            source.lastSyncAt
              ? t(source.failing ? 'settings.licenseTab.summary.lastSyncAgo' : 'settings.licenseTab.summary.syncedAgo', { ago: formatAgo(source.lastSyncAt, locale) })
              : t('settings.licenseTab.summary.neverSynced'),
          ].filter(Boolean).join(' · ')}
          extra={syncAlert && (
            // A failing sync is told on the same line, details in the tooltip, not by a banner.
            <Tooltip title={[
              t('settings.licenseTab.summary.syncFailingInline', {
                since: formatDateTime(syncAlert.values.since, locale),
                failures: syncAlert.values.failures,
                next: formatDateTime(syncAlert.values.next, locale),
              }),
              syncAlert.values.until ? t('settings.licenseTab.summary.syncFailingUntil', { until: formatDate(syncAlert.values.until, locale) }) : null,
            ].filter(Boolean).join(' ')}>
              <Typography component='span' variant='body2' color='warning.main' sx={{ fontWeight: 400, ml: 1, cursor: 'help' }}>
                <i className='ri-error-warning-line' aria-hidden='true' style={{ fontSize: '0.8125rem', verticalAlign: '-1px', marginRight: 3 }} />
                {t('settings.licenseTab.summary.syncFailingShort', { failures: syncAlert.values.failures })}
              </Typography>
            </Tooltip>
          )}
        />
      )}
      {source?.kind === 'file' && <Value main={t('settings.licenseTab.summary.fileSource')} sub={t('settings.licenseTab.summary.fileBound')} />}
      {source?.kind === 'key' && <Value main={t('settings.licenseTab.summary.keySource')} />}
    </Fact>
  )
}

export default function LicenseSummaryCard({ summary, alerts, t, locale, busy, canConnect, actions, syncAlert, onConnect, onHaveKey, onNoInternet, onRenewWithFile }) {
  const community = summary.state === 'community'
  const awaiting = summary.state === 'awaiting'
  const factColor = {}

  for (const a of alerts) {
    const fact = FACT_OF_ALERT[a.id]

    if (fact && !factColor[fact]) factColor[fact] = SEVERITY_COLOR[a.severity]
  }

  // Only the primary license moving out changes the date shown ("valid here
  // until"); another license moving out leaves the card's expiry alone.
  if (summary.validUntil?.here && !factColor.validUntil) factColor.validUntil = 'warning'

  const { nodes, validUntil, source } = summary
  const nodePct = nodes && !nodes.unlimited && nodes.used !== null ? Math.min(100, Math.round((nodes.used / nodes.max) * 100)) : null

  return (
    <Card variant='outlined' sx={{ mb: 2 }}>
      <CardContent sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <Box sx={{ width: 48, height: 48, borderRadius: 2, border: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.primary', flexShrink: 0 }}>
            <LogoIcon size={30} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant='h6' fontWeight={700}>
              {t(awaiting ? 'settings.licenseTab.summary.awaiting' : community ? 'settings.licenseTab.summary.community' : 'settings.licenseTab.summary.enterprise')}
            </Typography>
            <Typography variant='body2' color='text.secondary' noWrap>
              {awaiting
                ? summary.customer || t('settings.licenseTab.summary.awaitingDesc')
                : community
                ? t('settings.licenseTab.summary.communityDesc')
                : [summary.customer, summary.licenseCount > 1 ? t('settings.licenseTab.summary.licenseCount', { count: summary.licenseCount }) : null].filter(Boolean).join(' · ')}
            </Typography>
          </Box>
          {summary.nfr && <Chip size='small' variant='outlined' color='warning' label={t('settings.licenseTab.summary.nfr')} />}
          <StatusPill summary={summary} alerts={alerts} t={t} />
          {actions}
        </Box>

        {awaiting ? (
          <Box sx={{ mt: 2.5, pt: 2.5, borderTop: 1, borderColor: 'divider' }}>
            <SourceFact source={source} syncAlert={syncAlert} color={factColor.source} t={t} locale={locale} />
          </Box>
        ) : community ? (
          <>
            <Typography variant='body2' color='text.secondary' sx={{ mt: 2 }}>{t('settings.licenseTab.summary.communityPitch')}</Typography>
            <Box sx={{ display: 'flex', gap: 1.5, mt: 2, flexWrap: 'wrap', alignItems: 'center' }}>
              {canConnect && (
                <Button variant='contained' size='small' onClick={onConnect} disabled={busy} startIcon={<i className='ri-plug-line' />}>
                  {t('settings.licenseTab.summary.connect')}
                </Button>
              )}
              <Button variant={canConnect ? 'outlined' : 'contained'} size='small' onClick={onHaveKey} disabled={busy} startIcon={<i className='ri-key-2-line' />}>
                {t('settings.licenseTab.summary.haveKey')}
              </Button>
              <Button variant='text' size='small' color='inherit' onClick={onNoInternet} disabled={busy}>
                {t('settings.licenseTab.summary.noInternet')}
              </Button>
            </Box>
          </>
        ) : (
          <>
            <Box sx={{ mt: 2.5, pt: 2.5, borderTop: 1, borderColor: 'divider' }}>
              <Fact label={t(nodes?.fleet ? 'settings.licenseTab.summary.nodesFleet' : 'settings.licenseTab.summary.nodes')} color={factColor.nodes}>
                {nodes?.unlimited
                  ? <Value main={t('settings.licenseTab.summary.unlimited')} />
                  : <Value main={nodes?.used ?? '—'} sub={t('settings.licenseTab.summary.nodesOf', { max: nodes?.max ?? 0 })} />}
              </Fact>
              {nodePct !== null && (
                <LinearProgress variant='determinate' value={nodePct} color={factColor.nodes || 'primary'} sx={{ mt: 1, height: 6, borderRadius: 3, bgcolor: 'action.hover' }} />
              )}
            </Box>

            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: 6, rowGap: 1, mt: 2.5 }}>
              <Fact
                inline
                label={t(validUntil?.here ? 'settings.licenseTab.summary.validHereUntil' : validUntil?.next ? 'settings.licenseTab.summary.nextExpiry' : 'settings.licenseTab.summary.validUntil')}
                color={factColor.validUntil}
              >
                {validUntil ? (
                  <Value
                    main={formatDate(validUntil.date, locale, 'long')}
                    sub={[
                      validUntil.next ? validUntil.label || t(`settings.licenseTab.licenses.role${validUntil.role === 'primary' ? 'Primary' : validUntil.role === 'option' ? 'Option' : 'Import'}`) : null,
                      t('settings.licenseTab.summary.inDays', { days: validUntil.days }),
                    ].filter(Boolean).join(' · ')}
                  />
                ) : <Value main='—' />}
              </Fact>

              <SourceFact source={source} syncAlert={syncAlert} color={factColor.source} t={t} locale={locale} />
            </Box>

            {source?.kind === 'file' && (
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2.5 }}>
                <Button variant='outlined' size='small' onClick={onRenewWithFile} disabled={busy} startIcon={<i className='ri-file-shield-2-line' />}>
                  {t('settings.licenseTab.summary.renewWithFile')}
                </Button>
              </Box>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
