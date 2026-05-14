'use client'

import { useCallback, useEffect, useState } from 'react'

import {
  Alert, Box, Button, FormControlLabel, IconButton, MenuItem, Stack, Switch, TextField, Typography,
} from '@mui/material'
import { useTranslations } from 'next-intl'

interface Binding {
  id: string
  pbsConnectionId: string
  datastore: string
  namespace: string
  mode: 'auto' | 'manual'
  pbsTokenId: string | null
  createdAt: string
}

interface PbsConnOption { id: string; name: string; fingerprint: string | null }

interface Props {
  vdcId: string
  tenantSlug: string
  vdcSlug: string
  pbsConnections: PbsConnOption[]
}

export default function VdcPbsBindingsSection({ vdcId, tenantSlug, vdcSlug, pbsConnections }: Props) {
  const t = useTranslations()
  const defaultNamespace = `tenant-${tenantSlug}/vdc-${vdcSlug}`
  const [bindings, setBindings] = useState<Binding[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)

  const [form, setForm] = useState({
    mode: 'auto' as 'auto' | 'manual',
    pbsConnectionId: '', datastore: '', namespace: defaultNamespace,
    pveStorageName: '',
  })

  useEffect(() => {
    if (addOpen) {
      setForm(f => ({ ...f, namespace: defaultNamespace }))
    }
  }, [addOpen, defaultNamespace])
  const [datastores, setDatastores] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [stepReport, setStepReport] = useState<any | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)

    try {
      const r = await fetch(`/api/v1/admin/vdcs/${encodeURIComponent(vdcId)}/pbs-bindings`)
      const j = await r.json()

      setBindings(Array.isArray(j.data) ? j.data : [])
    } finally { setLoading(false) }
  }, [vdcId])

  useEffect(() => { void reload() }, [reload])

  useEffect(() => {
    if (!form.pbsConnectionId) { setDatastores([]);

return }

    ;

(async () => {
      try {
        const r = await fetch(`/api/v1/admin/pbs-connections/${encodeURIComponent(form.pbsConnectionId)}/datastores`)
        const j = await r.json()

        setDatastores(Array.isArray(j.data) ? j.data : [])
      } catch { setDatastores([]) }
    })()
  }, [form.pbsConnectionId])

  const handleSubmit = async () => {
    setSubmitting(true); setError(null); setStepReport(null)

    try {
      const body: any = { mode: form.mode, pbsConnectionId: form.pbsConnectionId, datastore: form.datastore }

      if (!form.namespace) { setError(t('vdc.pbsNamespaceRequired')); setSubmitting(false);

return }

      body.namespace = form.namespace
      if (form.mode === 'manual' && form.pveStorageName) body.pveStorageName = form.pveStorageName

      const r = await fetch(`/api/v1/admin/vdcs/${encodeURIComponent(vdcId)}/pbs-bindings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })

      const j = await r.json()

      if (!r.ok) { setError(j.error ?? 'Request failed');

return }

      setStepReport(j.steps)
      await reload()
    } finally { setSubmitting(false) }
  }

  const handleDelete = async (bindingId: string) => {
    if (!confirm(t('vdc.pbsRemoveConfirm'))) return
    const r = await fetch(`/api/v1/admin/vdcs/${encodeURIComponent(vdcId)}/pbs-bindings/${encodeURIComponent(bindingId)}`, { method: 'DELETE' })

    if (r.ok) void reload()
  }

  const eligibleAuto = pbsConnections.filter(c => c.fingerprint)
  const noFingerprint = form.mode === 'auto' && pbsConnections.length > 0 && eligibleAuto.length === 0
  const eligible = form.mode === 'auto' ? eligibleAuto : pbsConnections

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <i className="ri-save-3-line" />
        {t('vdc.pbsBindings')}
      </Typography>

      {noFingerprint && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('vdc.pbsFingerprintMissing')}
        </Alert>
      )}
      {loading ? <Typography variant="caption">…</Typography> : (
        <Stack spacing={1}>
          {bindings.length === 0 && <Typography variant="caption" color="text.secondary">{t('vdc.pbsNoBinding')}</Typography>}
          {bindings.map(b => (
            <Stack key={b.id} direction="row" alignItems="center" spacing={1} sx={{ border: '1px solid', borderColor: 'divider', p: 1, borderRadius: 1 }}>
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2">
                  <b>{b.datastore}</b> / {b.namespace}
                  {' '}<Box component="span" sx={{ fontSize: 10, fontWeight: 600, px: 0.5, borderRadius: 0.5, bgcolor: b.mode === 'manual' ? 'warning.light' : 'success.light', color: 'text.primary' }}>{b.mode}</Box>
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  PBS: {pbsConnections.find(c => c.id === b.pbsConnectionId)?.name ?? b.pbsConnectionId}
                  {b.pbsTokenId ? ` — token ${b.pbsTokenId}` : ''}
                </Typography>
              </Box>
              <IconButton size="small" color="error" onClick={() => handleDelete(b.id)}><i className="ri-delete-bin-line" /></IconButton>
            </Stack>
          ))}
        </Stack>
      )}
      <Button sx={{ mt: 1.5 }} size="small" startIcon={<i className="ri-add-line" />} onClick={() => setAddOpen(v => !v)} disabled={pbsConnections.length === 0}>
        {t('vdc.pbsAddBinding')}
      </Button>
      {addOpen && (
        <Box sx={{ mt: 2, p: 2, border: '1px dashed', borderColor: 'divider', borderRadius: 1 }}>
          <Stack spacing={2}>
            <FormControlLabel
              control={<Switch size="small" checked={form.mode === 'auto'} onChange={e => setForm(f => ({ ...f, mode: e.target.checked ? 'auto' : 'manual', pbsConnectionId: '', datastore: '' }))} />}
              label={t('vdc.pbsModeAuto')}
            />
            <TextField select size="small" label={t('vdc.pbsPbsConnection')} value={form.pbsConnectionId} onChange={e => setForm(f => ({ ...f, pbsConnectionId: e.target.value, datastore: '' }))}>
              {eligible.map(c => <MenuItem key={c.id} value={c.id}>{c.name}{!c.fingerprint ? ' (no fingerprint)' : ''}</MenuItem>)}
            </TextField>
            <TextField select size="small" label={t('vdc.pbsDatastore')} value={form.datastore} onChange={e => setForm(f => ({ ...f, datastore: e.target.value }))} disabled={!form.pbsConnectionId}>
              {datastores.map(d => <MenuItem key={d} value={d}>{d}</MenuItem>)}
            </TextField>
            <TextField
              size="small"
              required
              label={t('vdc.pbsNamespace')}
              helperText={form.mode === 'manual' ? t('vdc.pbsNamespaceManualHelper') : t('vdc.pbsNamespaceHelper')}
              value={form.namespace}
              onChange={e => setForm(f => ({ ...f, namespace: e.target.value }))}
            />
            {form.mode === 'manual' && (
              <TextField size="small" label={t('vdc.pbsPveStorageNameLabel')} helperText={t('vdc.pbsPveStorageNameHelper')} value={form.pveStorageName} onChange={e => setForm(f => ({ ...f, pveStorageName: e.target.value }))} />
            )}
            {error && <Alert severity="error">{error}</Alert>}
            {stepReport && stepReport.mode === 'manual' && (
              <Alert severity="success">
                {t('vdc.pbsManualSuccess', { status: stepReport.pveStorage })}
              </Alert>
            )}
            {stepReport && stepReport.mode !== 'manual' && (
              <Alert severity="info">
                namespace {stepReport.namespace} · token {stepReport.token} · acl {stepReport.acl}
                {stepReport.pveStorages?.map((s: any) => (
                  <div key={s.name}>PVE {s.name} on {s.pveConnectionId}: {s.status}{s.error ? ` (${s.error})` : ''}</div>
                ))}
              </Alert>
            )}
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button onClick={() => { setAddOpen(false); setStepReport(null); setError(null) }}>{t('vdc.pbsCancel')}</Button>
              <Button variant="contained" disabled={!form.pbsConnectionId || !form.datastore || submitting} onClick={handleSubmit}>
                {submitting ? '…' : t('vdc.pbsCreate')}
              </Button>
            </Stack>
          </Stack>
        </Box>
      )}
    </Box>
  )
}
