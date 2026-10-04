'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import { useLocale, useTranslations } from 'next-intl'

import {
  Alert, Box, Button, Card, CardContent, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, FormControlLabel, InputLabel, LinearProgress, MenuItem, Select, TextField, Typography, useTheme,
} from '@mui/material'

import { useLicense } from '@/contexts/LicenseContext'
import { useLicenseManagement } from '@/hooks/useLicenseManagement'
import { isMultiLicenseEnabled } from '@/lib/features'
import { optionDisplayName } from '@/lib/license/features'
import { buildLicenseAlerts, buildLicenseSummary } from '@/lib/license/summary'
import { buildLicenseTableRows, computePerTenantRollup } from '@/lib/license/view'

import LicenseActions, { FingerprintRow } from './LicenseActions'
import LicenseAlerts from './LicenseAlerts'
import LicenseSummaryCard from './LicenseSummaryCard'
import LicensesSection from './LicensesSection'
import PairingPanel from './PairingPanel'
import { SUBSCRIBE_URL, portalAccountUrl } from './format'

// Told inside the card's source fact rather than as a banner.
const SYNC_ALERTS = new Set(['syncFailing', 'syncFailingNoLease'])

const CHECKIN_POLL_MS = 5000
const CHECKIN_POLL_MAX = 15

// What the rest of the app derives from the license: when a check-in brings
// or takes away a key, the feature gates and the imports list must follow.
function licenseSignature(status) {
  if (!status) return null

  return JSON.stringify([
    !!status.licensed,
    status.license_id || '',
    status.lease_error || '',
    status.lease_until || '',
    (status.connection?.held || []).map(h => `${h.license_id}:${h.lost ? 1 : 0}`),
  ])
}

export default function LicenseTab() {
  const t = useTranslations()
  const locale = useLocale()
  const theme = useTheme()
  const { refresh: refreshLicenseContext } = useLicense()

  const {
    licenseStatus, loading, error, success, activating, setError, setSuccess,
    handleActivate: hookActivate, handleDeactivate: hookDeactivate, loadLicenseStatus,
    downloadLicenseRequest, resetInstallIdentity, refreshLicenseStatus, startConnection, cancelConnection, checkinNow,
  } = useLicenseManagement()

  const [licenseKey, setLicenseKey] = useState('')
  const [keyDialogOpen, setKeyDialogOpen] = useState(false)
  const [deactivateDialogOpen, setDeactivateDialogOpen] = useState(false)
  const [resetIdentityOpen, setResetIdentityOpen] = useState(false)
  const [offlineOpen, setOfflineOpen] = useState(false) // the offline licensing steps, before the request download
  const [bindingMismatch, setBindingMismatch] = useState(null) // { expected, actual } from a refused activation

  const offline = !!licenseStatus?.offline
  const install = licenseStatus?.install || null
  const canSign = install?.can_sign !== false
  const connection = licenseStatus?.connection || null
  const [connectBusy, setConnectBusy] = useState(false)
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const prevConnStatus = useRef(connection?.status)
  const checkinPoll = useRef(null)
  const lastCheckinAt = useRef(connection?.last_checkin_at ?? null)
  const connectionMounted = useRef(true)

  const stopCheckinPoll = () => {
    clearInterval(checkinPoll.current)
    checkinPoll.current = null
  }

  useEffect(() => {
    connectionMounted.current = true

    return () => {
      connectionMounted.current = false
      stopCheckinPoll()
    }
  }, [])

  useEffect(() => { lastCheckinAt.current = connection?.last_checkin_at ?? null }, [connection?.last_checkin_at])

  // Poll every 3 s while a pairing is pending; nobody else polls the status.
  useEffect(() => {
    if (connection?.status !== 'pairing') return undefined
    const id = setInterval(() => { refreshLicenseStatus() }, 3000)

    return () => clearInterval(id)
  }, [connection?.status, refreshLicenseStatus])

  // Unlock app-wide features only after pairing or recovery succeeds.
  useEffect(() => {
    const previous = prevConnStatus.current

    prevConnStatus.current = connection?.status
    if ((previous === 'pairing' || previous === 'disconnected') && connection?.status === 'connected') {
      refreshLicenseContext()
      refreshLicenseStatus()
    }
  }, [connection?.status, refreshLicenseContext, refreshLicenseStatus])

  const connectErrorMessage = (result) => {
    if (result.code === 'CONNECT_DISABLED') return t('settings.licenseConnectionUnavailable')
    if (result.code === 'IDENTITY_SIGNING_UNAVAILABLE') return t('settings.licenseSigningUnavailable')
    if (result.code === 'PORTAL_UNREACHABLE') return result.error ? `${t('settings.licenseConnectionFailed')}: ${result.error}` : t('settings.licenseConnectionFailed')

    return result.error || t('settings.licenseConnectionFailed')
  }

  const runConnect = async (fn, okMessage) => {
    setConnectBusy(true); setError(null); setSuccess(null)
    const result = await fn()

    if (!connectionMounted.current) return result
    setConnectBusy(false)
    if (result.success) { if (okMessage) setSuccess(okMessage) } else setError(connectErrorMessage(result))

    return result
  }

  const handleConnect = () => runConnect(startConnection)
  const handleCancelPairing = () => runConnect(cancelConnection)

  // The check-in runs at the leader's next tick (up to a minute away on an HA
  // follower): poll quietly until last_checkin_at moves, for about 75 s.
  const handleCheckinNow = async () => {
    const before = connection?.last_checkin_at ?? null
    const result = await runConnect(checkinNow, t('settings.licenseConnectionCheckinQueued'))

    if (!connectionMounted.current || !result?.success) return
    stopCheckinPoll()
    let polls = 0

    checkinPoll.current = setInterval(() => {
      if (lastCheckinAt.current !== before || polls >= CHECKIN_POLL_MAX) {
        stopCheckinPoll()

        return
      }

      polls += 1
      refreshLicenseStatus()
    }, CHECKIN_POLL_MS)
  }

  const handleDisconnect = async () => { setDisconnectOpen(false); await runConnect(cancelConnection); await refreshLicenseContext() }

  const handleGenerateRequest = async () => {
    setError(null); setSuccess(null)
    const result = await downloadLicenseRequest()

    if (result.success) setSuccess(t('settings.licenseRequestDownloaded'))
    else setError(result.code === 'IDENTITY_SIGNING_UNAVAILABLE' ? t('settings.licenseSigningUnavailable') : (result.error || t('settings.licenseRequestFailed')))
  }

  const handleResetIdentity = async () => {
    setResetIdentityOpen(false)
    setError(null); setSuccess(null)
    const result = await resetInstallIdentity()

    if (result.success) {
      setSuccess(t('settings.licenseIdentityReset'))
      await refreshLicenseContext()
    } else {
      setError(result.error || t('settings.licenseIdentityResetFailed'))
    }
  }

  const handleActivate = async () => {
    setBindingMismatch(null)
    const result = await hookActivate(licenseKey)

    if (result.success) {
      setSuccess(t('settings.licenseActivated'))
      setLicenseKey('')
      setKeyDialogOpen(false)
    } else if (result.code === 'LICENSE_BINDING_MISMATCH') {
      setBindingMismatch({ expected: result.expected, actual: result.actual })
      setKeyDialogOpen(false)
    } else {
      setError(result.error || t('settings.activationFailed'))
    }
  }

  const handleDeactivate = async () => {
    setDeactivateDialogOpen(false)
    const result = await hookDeactivate()

    if (result.success) setSuccess(t('settings.licenseDeactivated'))
    else setError(result.error || t('settings.deactivationFailed'))
  }

  // ── Multi-license (imports) ──
  const [mlEnabled, setMlEnabled] = useState(false)
  const [imports, setImports] = useState([])
  const [pveConns, setPveConns] = useState([])      // for the import modal's cluster picker + rollup
  const [tenantNames, setTenantNames] = useState({})
  const [importOpen, setImportOpen] = useState(false)
  const [importBlob, setImportBlob] = useState('')
  const [importConnId, setImportConnId] = useState('')
  const [importing, setImporting] = useState(false)
  const [removeTarget, setRemoveTarget] = useState(null) // {rowId, licenseId} | null
  const [editMapTarget, setEditMapTarget] = useState(null) // {rowId, licenseId} | null
  const [editMapSelected, setEditMapSelected] = useState([])
  const [savingMap, setSavingMap] = useState(false)

  const loadImports = async () => {
    try {
      const res = await fetch('/api/v1/license/imports')

      if (isMultiLicenseEnabled(res.status)) {
        const data = await res.json().catch(() => ({}))

        setMlEnabled(true)
        setImports(Array.isArray(data?.imports) ? data.imports : [])
      } else {
        setMlEnabled(false)
        setImports([])
      }
    } catch {
      setMlEnabled(false)
    }
  }

  useEffect(() => { loadImports() }, [])

  const signature = licenseSignature(licenseStatus)
  const prevSignature = useRef(signature)

  useEffect(() => {
    const previous = prevSignature.current

    prevSignature.current = signature
    if (previous === null || signature === null || previous === signature) return
    refreshLicenseContext()
    loadImports()
  }, [signature, refreshLicenseContext])

  useEffect(() => {
    if (!mlEnabled) return
    fetch('/api/v1/connections')
      .then(r => (r.ok ? r.json() : null))
      .then(j => setPveConns((j?.data || []).filter(c => c.type === 'pve')))
      .catch(() => {})
    fetch('/api/v1/tenants')
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        const m = {}

        for (const tt of (j?.data || [])) m[tt.id] = tt.name
        setTenantNames(m)
      })
      .catch(() => {})
  }, [mlEnabled])

  const licenseRows = useMemo(() => buildLicenseTableRows(licenseStatus || {}, imports), [licenseStatus, imports])

  const heldById = useMemo(() => new Map((offline ? [] : connection?.held || []).map(h => [h.license_id, h])), [offline, connection])

  // A held license the table does not list (typically one moved to another
  // instance, still usable here in its grace period) keeps its own row.
  const tableRows = useMemo(() => {
    if (licenseRows.length === 0) return licenseRows
    const listed = new Set(licenseRows.map(r => r.licenseId))
    const extra = [...heldById.values()].filter(h => !listed.has(h.license_id)).map(h => ({
      rowId: `held-${h.license_id}`, licenseId: h.license_id, role: h.kind === 'option' ? 'option' : 'import', edition: '', label: h.label,
      licensedTo: '', usedNodes: 0, maxNodes: 0, unlimited: false, expiresAt: null, clusterUuid: null, connectionIds: [], state: 'unknown',
      capabilities: [], heldOnly: true,
    }))

    return extra.length ? [...licenseRows, ...extra] : licenseRows
  }, [licenseRows, heldById])

  const connName = useMemo(() => {
    const m = {}

    for (const c of pveConns) m[c.id] = c.name

    return m
  }, [pveConns])

  // connectionId -> import rowId (import rows only; connections under the primary stay freely mappable)
  const connToImport = useMemo(() => {
    const m = {}

    for (const r of licenseRows) {
      if (r.role !== 'import') continue
      for (const cid of r.connectionIds || []) m[cid] = r.rowId
    }

    return m
  }, [licenseRows])

  const perTenant = useMemo(() => {
    const perLicense = licenseStatus?.node_status?.per_license || []
    const connToTenant = {}

    for (const c of pveConns) connToTenant[c.id] = c.tenantId

    return computePerTenantRollup(perLicense, connToTenant, tenantNames)
  }, [licenseStatus, pveConns, tenantNames])

  const submitImport = async () => {
    setImporting(true); setError(null); setSuccess(null)
    try {
      const cleaned = importBlob.split('\n').map(l => l.trimEnd()).join('\n').trim()
      const res = await fetch('/api/v1/license/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ license: cleaned, connection_id: importConnId || undefined }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) throw new Error(data?.error || t('settings.licenseImportFailed'))
      setImportOpen(false); setImportBlob(''); setImportConnId('')
      setSuccess(t('settings.licenseImportSuccess'))
      await loadImports(); await loadLicenseStatus()
    } catch (e) {
      setError(e?.message || t('settings.licenseImportFailed'))
    } finally { setImporting(false) }
  }

  const confirmRemove = async () => {
    const target = removeTarget

    setRemoveTarget(null)
    if (!target) return
    try {
      const res = await fetch(`/api/v1/license/import/${encodeURIComponent(target.rowId)}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) throw new Error(data?.error || t('settings.licenseRemoveFailed'))
      setSuccess(t('settings.licenseRemoveSuccess'))
      await loadImports(); await loadLicenseStatus()
    } catch (e) {
      setError(e?.message || t('settings.licenseRemoveFailed'))
    }
  }

  const openEditMapping = (row) => {
    setEditMapTarget({ rowId: row.rowId, licenseId: row.licenseId })
    setEditMapSelected(row.connectionIds || [])
  }

  const toggleMapConn = (cid) => {
    setEditMapSelected(prev => (prev.includes(cid) ? prev.filter(x => x !== cid) : [...prev, cid]))
  }

  const submitEditMapping = async () => {
    if (!editMapTarget) return
    setSavingMap(true); setError(null); setSuccess(null)
    try {
      const res = await fetch(`/api/v1/license/import/${encodeURIComponent(editMapTarget.rowId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connection_ids: editMapSelected }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) throw new Error(data?.error || t('settings.licenseMappingFailed'))
      setEditMapTarget(null)
      setSuccess(t('settings.licenseMappingSuccess'))
      await loadImports(); await loadLicenseStatus()
    } catch (e) {
      setError(e?.message || t('settings.licenseMappingFailed'))
    } finally { setSavingMap(false) }
  }

  const summary = useMemo(() => (licenseStatus ? buildLicenseSummary(licenseStatus, tableRows) : null), [licenseStatus, tableRows])
  const alerts = useMemo(() => (licenseStatus ? buildLicenseAlerts(licenseStatus, { bindingMismatch: !!bindingMismatch }) : []), [licenseStatus, bindingMismatch])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <LinearProgress sx={{ width: 200 }} />
      </Box>
    )
  }

  const busy = connectBusy || activating
  const licensed = summary?.state === 'licensed' || summary?.state === 'expired'
  const awaiting = summary?.state === 'awaiting'
  const connectable = !offline && !!connection?.available
  const pairing = connectable && connection?.status === 'pairing'
  // Several licenses, or any import: an import is always listed with its
  // state, even alone (standing in for the primary, or granting nothing).
  const showTable = tableRows.length > 1 || tableRows.some(r => r.role !== 'primary')
  const primaryInTable = showTable && tableRows.some(r => r.role === 'primary')
  // An import stands in for the primary: the alert explains what the primary
  // needs, the header keeps its deactivate action since it has no row.
  const standIn = licenseStatus?.effective_source?.kind === 'import' ? licenseStatus.primary_problem || null : null
  const binding = bindingMismatch
    ? { expected: bindingMismatch.expected, actual: bindingMismatch.actual }
    : licenseStatus?.binding_error ? { expected: licenseStatus.bound_fingerprint || '', actual: install?.fingerprint || '' } : null
  const standInBinding = standIn?.reason === 'bound_elsewhere' ? { expected: standIn.bound_fingerprint || '', actual: install?.fingerprint || '' } : null
  const fingerprints = b => (
    <Box sx={{ display: 'grid', gap: 0.75 }}>
      <FingerprintRow label={t('settings.licenseBindingExpected')} value={b.expected} t={t} />
      <FingerprintRow label={t('settings.licenseBindingActual')} value={b.actual} t={t} />
    </Box>
  )
  const portalLinked = connectable && licenseStatus?.binding === 'connected'
  const alertHandlers = {
    addNodes: SUBSCRIBE_URL,
    renew: portalLinked ? portalAccountUrl(connection?.portal_url) : SUBSCRIBE_URL,
    openAccount: portalAccountUrl(connection?.portal_url),
    sync: handleCheckinNow,
    requestFile: handleGenerateRequest,
    resetIdentity: () => setResetIdentityOpen(true),
    reconnect: handleConnect,
  }

  return (
    <Box>
      {error && <Alert severity='error' sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity='success' sx={{ mb: 2 }}>{success}</Alert>}

      {!licenseStatus ? (
        <Card variant='outlined' sx={{ mb: 2 }}>
          <CardContent sx={{ p: 3, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <Box sx={{ flex: 1 }}>
              <Typography variant='subtitle1' fontWeight={600}>{t('settings.licenseTab.summary.unknownTitle')}</Typography>
              <Typography variant='body2' color='text.secondary'>{t('settings.licenseTab.summary.unknownBody')}</Typography>
            </Box>
            <Button variant='outlined' size='small' onClick={loadLicenseStatus} startIcon={<i className='ri-refresh-line' />}>{t('settings.licenseTab.actions.retry')}</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {pairing && <PairingPanel connection={connection} t={t} busy={busy} onCancel={handleCancelPairing} />}
          {!(pairing && !licensed && !awaiting) && (
            <LicenseSummaryCard
              summary={summary} alerts={alerts} t={t} locale={locale} busy={busy} canConnect={connectable && !['connected', 'disconnected'].includes(connection?.status)}
              syncAlert={alerts.find(a => SYNC_ALERTS.has(a.id)) || null}
              actions={(
                <LicenseActions
                  t={t} busy={busy} install={install} canSign={canSign} licensed={licensed} fingerprintOnly={!licensed && !awaiting} awaiting={awaiting}
                  showImport={mlEnabled && !showTable} showDeactivate={licensed && !primaryInTable && standIn?.reason !== 'absent'}
                  connection={connectable && !pairing ? connection : null}
                  onSync={handleCheckinNow} onConnect={handleConnect} onDisconnect={() => setDisconnectOpen(true)}
                  onRequestFile={handleGenerateRequest} onActivateKey={() => setKeyDialogOpen(true)} onResetIdentity={() => setResetIdentityOpen(true)}
                  onImport={() => { setImportBlob(''); setImportConnId(''); setImportOpen(true) }} onDeactivate={() => setDeactivateDialogOpen(true)}
                />
              )}
              onConnect={handleConnect} onHaveKey={() => setKeyDialogOpen(true)} onNoInternet={() => setOfflineOpen(true)} onRenewWithFile={handleGenerateRequest}
            />
          )}
          <LicenseAlerts alerts={alerts.filter(a => !SYNC_ALERTS.has(a.id))} t={t} locale={locale} busy={busy} handlers={alertHandlers} details={{
            ...(binding ? { binding: fingerprints(binding) } : {}),
            ...(standInBinding ? { standIn: fingerprints(standInBinding) } : {}),
          }} />
          {showTable && (
            <LicensesSection
              rows={tableRows} held={heldById} t={t} locale={locale} connName={connName} canImport={mlEnabled} perTenant={perTenant}
              effectiveLicenseId={standIn ? licenseStatus.effective_source.license_id : null}
              onImport={() => { setImportBlob(''); setImportConnId(''); setImportOpen(true) }}
              onEditMapping={openEditMapping}
              onRemove={row => setRemoveTarget({ rowId: row.rowId, licenseId: row.licenseId })}
              onDeactivate={() => setDeactivateDialogOpen(true)}
            />
          )}
        </>
      )}

      {/* Activate a license key */}
      <Dialog open={keyDialogOpen} onClose={() => setKeyDialogOpen(false)} maxWidth='sm' fullWidth>
        <DialogTitle>{t('settings.licenseTab.advanced.activateKey')}</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth multiline rows={4} sx={{ mt: 1 }}
            label={t('settings.licenseKey')}
            placeholder={t('settings.licenseKeyPlaceholder')}
            value={licenseKey}
            onChange={e => { setLicenseKey(e.target.value); setBindingMismatch(null) }}
            InputProps={{ sx: { fontFamily: 'JetBrains Mono, monospace', fontSize: '0.85rem' } }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setKeyDialogOpen(false)} variant='outlined'>{t('common.cancel')}</Button>
          <Button variant='contained' disabled={!licenseKey.trim() || activating} onClick={handleActivate}
            startIcon={activating ? <i className='ri-loader-4-line' /> : <i className='ri-check-line' />}>
            {activating ? t('settings.activating') : t('settings.activateLicense')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Deactivate Confirmation Dialog */}
      <Dialog open={deactivateDialogOpen} onClose={() => setDeactivateDialogOpen(false)} maxWidth='xs' fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className='ri-error-warning-line' style={{ color: 'var(--mui-palette-error-main)', fontSize: 24 }} />
          {t('settings.deactivateLicense')}
        </DialogTitle>
        <DialogContent><Typography>{t('settings.confirmDeactivateLicense')}</Typography></DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeactivateDialogOpen(false)} variant='outlined'>{t('common.cancel')}</Button>
          <Button onClick={handleDeactivate} variant='contained' color='error' startIcon={<i className='ri-delete-bin-line' />}>{t('settings.deactivateLicense')}</Button>
        </DialogActions>
      </Dialog>

      {/* Offline licensing: the steps first, the request file download last */}
      <Dialog open={offlineOpen} onClose={() => setOfflineOpen(false)} maxWidth='sm' fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className='ri-wifi-off-line' style={{ fontSize: 22 }} />
          {t('settings.licenseTab.offline.title')}
        </DialogTitle>
        <DialogContent>
          <Typography variant='body2' color='text.secondary'>{t('settings.licenseTab.offline.intro')}</Typography>
          <Box component='ol' sx={{ pl: 2.5, mt: 1.5, mb: 0, display: 'grid', gap: 1 }}>
            {[1, 2, 3, 4].map(n => (
              <Typography key={n} component='li' variant='body2'>
                {t(`settings.licenseTab.offline.step${n}`, { haveKey: t('settings.licenseTab.summary.haveKey') })}
              </Typography>
            ))}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setOfflineOpen(false)} variant='outlined'>{t('common.close')}</Button>
          <Button variant='contained' disabled={busy || !canSign} onClick={() => { setOfflineOpen(false); handleGenerateRequest() }} startIcon={<i className='ri-download-2-line' />}>
            {t('settings.licenseTab.offline.download')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={resetIdentityOpen} onClose={() => setResetIdentityOpen(false)} maxWidth='sm' fullWidth>
        <DialogTitle>{t('settings.licenseResetIdentityConfirmTitle')}</DialogTitle>
        <DialogContent><Typography variant='body2'>{t('settings.licenseResetIdentityConfirm')}</Typography></DialogContent>
        <DialogActions>
          <Button onClick={() => setResetIdentityOpen(false)}>{t('common.cancel')}</Button>
          <Button color='warning' variant='contained' onClick={handleResetIdentity} disabled={activating}>{t('settings.licenseResetIdentity')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={disconnectOpen} onClose={() => setDisconnectOpen(false)} maxWidth='sm' fullWidth>
        <DialogTitle>{t('settings.licenseConnectionDisconnectConfirmTitle')}</DialogTitle>
        <DialogContent><Typography variant='body2'>{t('settings.licenseConnectionDisconnectConfirm')}</Typography></DialogContent>
        <DialogActions>
          <Button onClick={() => setDisconnectOpen(false)}>{t('common.cancel')}</Button>
          <Button color='error' variant='contained' onClick={handleDisconnect} disabled={connectBusy}>{t('settings.licenseConnectionDisconnect')}</Button>
        </DialogActions>
      </Dialog>

      {/* Import additional license */}
      <Dialog open={importOpen} onClose={() => setImportOpen(false)} maxWidth='sm' fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className='ri-add-circle-line' style={{ fontSize: 22 }} />
          {t('settings.licenseImportDialogTitle')}
        </DialogTitle>
        <DialogContent>
          <TextField fullWidth multiline rows={4} sx={{ mt: 1, mb: 2 }}
            label={t('settings.licenseImportBlobLabel')}
            placeholder={t('settings.licenseImportBlobPlaceholder')}
            value={importBlob}
            onChange={e => setImportBlob(e.target.value)}
          />
          <FormControl fullWidth size='small'>
            <InputLabel>{t('settings.licenseImportConnLabel')}</InputLabel>
            <Select label={t('settings.licenseImportConnLabel')} value={importConnId} onChange={e => setImportConnId(e.target.value)}>
              <MenuItem value=''>{t('settings.licenseImportConnNone')}</MenuItem>
              {pveConns.map(c => (
                <MenuItem key={c.id} value={c.id}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {(c.hosts?.length || 0) > 1
                      ? <i className='ri-server-line' style={{ fontSize: 16, opacity: 0.7 }} />
                      : <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt='' width={16} height={16} />}
                    {c.name}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setImportOpen(false)} variant='outlined'>{t('common.cancel')}</Button>
          <Button onClick={submitImport} variant='contained' disabled={!importBlob.trim() || importing}
            startIcon={importing ? <i className='ri-loader-4-line' /> : <i className='ri-check-line' />}>
            {t('settings.licenseImportSubmit')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Remove import confirmation */}
      <Dialog open={!!removeTarget} onClose={() => setRemoveTarget(null)} maxWidth='xs' fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className='ri-error-warning-line' style={{ color: 'var(--mui-palette-error-main)', fontSize: 22 }} />
          {t('settings.licenseRemoveImport')}
        </DialogTitle>
        <DialogContent>
          <Typography>
            {(() => {
              const targetRow = licenseRows.find(r => r.rowId === removeTarget?.rowId)

              return targetRow?.role === 'option'
                ? t('settings.licenseRemoveOptionConfirm', { feature: targetRow.capabilities.map(optionDisplayName).join(', ') })
                : t('settings.licenseRemoveConfirm')
            })()}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setRemoveTarget(null)} variant='outlined'>{t('common.cancel')}</Button>
          <Button onClick={confirmRemove} variant='contained' color='error' startIcon={<i className='ri-delete-bin-line' />}>{t('settings.licenseRemoveImport')}</Button>
        </DialogActions>
      </Dialog>

      {/* Edit license mapping */}
      <Dialog open={!!editMapTarget} onClose={() => setEditMapTarget(null)} maxWidth='sm' fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className='ri-links-line' style={{ fontSize: 22 }} />
          {t('settings.licenseEditMappingTitle')}
        </DialogTitle>
        <DialogContent>
          <Typography variant='caption' sx={{ opacity: 0.7, display: 'block', mb: 1.5 }}>{t('settings.licenseEditMappingHint')}</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            {pveConns.map(c => {
              const takenByOther = !!(editMapTarget && connToImport[c.id] && connToImport[c.id] !== editMapTarget.rowId)

              return (
                <FormControlLabel key={c.id}
                  control={<Checkbox size='small' checked={editMapSelected.includes(c.id)} disabled={takenByOther} onChange={() => toggleMapConn(c.id)} />}
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {(c.hosts?.length || 0) > 1
                        ? <i className='ri-server-line' style={{ fontSize: 16, opacity: 0.7 }} />
                        : <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt='' width={16} height={16} />}
                      <span>{takenByOther ? `${c.name} (${t('settings.licenseConnCoveredByOther')})` : c.name}</span>
                    </Box>
                  } />
              )
            })}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEditMapTarget(null)} variant='outlined'>{t('common.cancel')}</Button>
          <Button onClick={submitEditMapping} variant='contained' disabled={savingMap}
            startIcon={savingMap ? <i className='ri-loader-4-line' /> : <i className='ri-check-line' />}>
            {t('settings.licenseMappingSave')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
