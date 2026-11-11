'use client'

// The vDCs of the tenant that carry a network of the shared EVPN zone
// (#1334): ticked = present there. Saving creates the network where it was
// ticked and removes it where it was unticked; each presence counts in the
// network quota of its own vDC.

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, FormControlLabel, Stack, Typography,
} from '@mui/material'

import AppDialogTitle from '@/components/ui/AppDialogTitle'

interface Props {
  /** The vDC the network is managed from. */
  vdcId: string
  networkId: string
  networkName: string
  onClose: () => void
  onSaved: () => void
}

export default function VnetPresenceDialog({ vdcId, networkId, networkName, onClose, onSaved }: Props) {
  const t = useTranslations()
  const [vdcs, setVdcs] = useState<Array<{ id: string; name: string }>>([])
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/v1/vdcs/${encodeURIComponent(vdcId)}/evpn-networks`)
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
        if (cancelled) return
        setVdcs(Array.isArray(json?.data?.vdcs) ? json.data.vdcs : [])
        const network = (json?.data?.networks ?? []).find((n: any) => n.id === networkId)
        setSelected(Array.isArray(network?.vdcIds) ? network.vdcIds : [])
      } catch (e: any) {
        if (!cancelled) setError(e?.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [vdcId, networkId])

  const toggle = (id: string) => setSelected(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))
  const all = vdcs.length > 0 && selected.length === vdcs.length

  const save = async () => {
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/v1/vdcs/${encodeURIComponent(vdcId)}/evpn-networks/${encodeURIComponent(networkId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vdcIds: selected }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      onSaved()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={saving ? undefined : onClose} maxWidth="xs" fullWidth>
      <AppDialogTitle onClose={onClose}>{t('myVdc.vnetSharedManageTitle', { name: networkName })}</AppDialogTitle>
      <DialogContent>
        <Stack spacing={0.5} mt={1}>
          {loading ? (
            <Stack alignItems="center" sx={{ py: 3 }}><CircularProgress size={20} /></Stack>
          ) : (
            <>
              <Stack direction="row" alignItems="center">
                <Typography variant="subtitle2" sx={{ flex: 1 }}>{t('myVdc.vnetSharedPresence')}</Typography>
                {vdcs.length > 1 && (
                  <FormControlLabel
                    sx={{ mr: 0 }}
                    labelPlacement="start"
                    control={
                      <Checkbox
                        size="small"
                        checked={all}
                        indeterminate={selected.length > 0 && !all}
                        disabled={saving}
                        onChange={() => setSelected(all ? [] : vdcs.map(v => v.id))}
                      />
                    }
                    label={<Typography variant="body2">{t('common.all')}</Typography>}
                  />
                )}
              </Stack>
              {vdcs.map((v) => (
                <FormControlLabel
                  key={v.id}
                  control={<Checkbox size="small" checked={selected.includes(v.id)} disabled={saving} onChange={() => toggle(v.id)} />}
                  label={
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <i className="ri-cloud-line" style={{ opacity: 0.7 }} />
                      <Typography variant="body2">{v.name}</Typography>
                    </Stack>
                  }
                />
              ))}
              <Typography variant="caption" color="text.secondary">{t('myVdc.vnetSharedManageHelp')}</Typography>
            </>
          )}
          {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={() => void save()} disabled={loading || saving || selected.length === 0}>{t('common.save')}</Button>
      </DialogActions>
    </Dialog>
  )
}
