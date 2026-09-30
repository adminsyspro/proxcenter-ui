'use client'

import { useState } from 'react'

import { Box, Divider, IconButton, Tooltip, Typography } from '@mui/material'

import { portalAccountUrl } from './format'

export function FingerprintRow({ label, value, t }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard unavailable on an http origin: the text stays selectable */ }
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.5, borderRadius: 1, bgcolor: 'action.hover', minWidth: 0 }}>
      <i className='ri-fingerprint-2-line' style={{ fontSize: 16, opacity: 0.6 }} />
      {label && <Typography variant='caption' sx={{ opacity: 0.8, whiteSpace: 'nowrap' }}>{label}</Typography>}
      <Typography variant='caption' sx={{ fontFamily: 'JetBrains Mono, monospace', letterSpacing: 0.5, wordBreak: 'break-all', flex: 1 }}>
        {value || '—'}
      </Typography>
      {value && (
        <Tooltip title={copied ? t('settings.licenseFingerprintCopied') : t('settings.licenseCopyFingerprint')}>
          <IconButton size='small' onClick={copy} aria-label={t('settings.licenseCopyFingerprint')}>
            <i className={copied ? 'ri-check-line' : 'ri-file-copy-line'} style={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  )
}

// One icon button with its label as tooltip and accessible name. A link
// when href is given; the span keeps the tooltip on a disabled button.
function Action({ label, icon, onClick, href, disabled, color }) {
  return (
    <Tooltip title={label}>
      <span>
        <IconButton
          size='small' color={color || 'default'} aria-label={label} disabled={disabled}
          {...(href ? { href, target: '_blank', rel: 'noopener noreferrer' } : { onClick })}
        >
          <i className={icon} style={{ fontSize: 18 }} />
        </IconButton>
      </span>
    </Tooltip>
  )
}

// The license actions, as icons on the right of the license card header:
// sync and connection, the offline request and key paste, the fingerprint,
// then the destructive ones last, set apart.
export default function LicenseActions({
  t, busy, install, canSign, licensed, showImport, showDeactivate, connection, fingerprintOnly = false,
  onSync, onConnect, onDisconnect, onRequestFile, onActivateKey, onResetIdentity, onImport, onDeactivate,
}) {
  const [copied, setCopied] = useState(false)
  const linked = connection?.status === 'connected' || connection?.status === 'disconnected'
  const fingerprint = install?.fingerprint

  const copyFingerprint = async () => {
    try {
      await navigator.clipboard.writeText(fingerprint)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard unavailable on an http origin */ }
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexWrap: 'wrap' }}>
      {!fingerprintOnly && (
        <>
          {linked && <Action label={t('settings.licenseTab.connection.sync')} icon='ri-refresh-line' onClick={onSync} disabled={busy} />}
          {connection?.status === 'none' && licensed && <Action label={t('settings.licenseTab.summary.connect')} icon='ri-plug-line' onClick={onConnect} disabled={busy} />}
          <Action
            label={canSign ? t('settings.licenseGenerateRequest') : t('settings.licenseSigningUnavailable')}
            icon='ri-file-shield-2-line' onClick={onRequestFile} disabled={!canSign || busy}
          />
          <Action label={t('settings.licenseTab.advanced.activateKey')} icon='ri-key-2-line' onClick={onActivateKey} disabled={busy} />
        </>
      )}
      {!fingerprintOnly && showImport && <Action label={t('settings.licenseTab.licenses.import')} icon='ri-add-line' onClick={onImport} disabled={busy} />}
      {!canSign && <Action label={t('settings.licenseResetIdentity')} icon='ri-restart-line' color='warning' onClick={onResetIdentity} disabled={busy} />}
      {fingerprint && (
        <Tooltip title={
          <Box>
            <Typography variant='caption' display='block' fontWeight={600}>{copied ? t('settings.licenseFingerprintCopied') : t('settings.licenseInstallFingerprint')}</Typography>
            <Typography variant='caption' display='block' sx={{ fontFamily: 'JetBrains Mono, monospace', wordBreak: 'break-all' }}>{fingerprint}</Typography>
            <Typography variant='caption' display='block' sx={{ opacity: 0.8, mt: 0.5 }}>{t('settings.licenseInstallFingerprintHint')}</Typography>
          </Box>
        }>
          <IconButton size='small' onClick={copyFingerprint} aria-label={t('settings.licenseCopyFingerprint')}>
            <i className={copied ? 'ri-check-line' : 'ri-fingerprint-2-line'} style={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      )}
      {!fingerprintOnly && linked && <Action label={t('settings.licenseTab.actions.openAccount')} icon='ri-external-link-line' href={portalAccountUrl(connection.portal_url)} />}
      {!fingerprintOnly && (linked || showDeactivate) && <Divider orientation='vertical' flexItem sx={{ mx: 0.5 }} />}
      {!fingerprintOnly && linked && <Action label={t('settings.licenseConnectionDisconnect')} icon='ri-plug-2-line' color='error' onClick={onDisconnect} disabled={busy} />}
      {!fingerprintOnly && showDeactivate && <Action label={t('settings.deactivateLicense')} icon='ri-delete-bin-line' color='error' onClick={onDeactivate} disabled={busy} />}
    </Box>
  )
}
