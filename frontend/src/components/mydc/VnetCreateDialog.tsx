'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Dialog, DialogContent, DialogActions, Button, TextField, FormControlLabel, Switch,
  Alert, Stack, Typography, MenuItem,
} from '@mui/material'

import AppDialogTitle from '@/components/ui/AppDialogTitle'
import {
  parseCidr, gatewayValidForCidr, usableHostCount, ipToInt, intToIp,
} from '@/lib/vdc/network'
import { readVdcContextCookie } from '@/lib/vdc/contextCookie'

interface VdcOption { id: string; name: string }

interface Props {
  open: boolean
  vdcs: VdcOption[]
  defaultVdcId?: string
  onClose: () => void
  onCreated: () => void
}

// User-facing display name — kept scoped to the vDC, free of PVE's 8-char +
// cluster-wide constraints (the backend hashes a unique 8-char pve_name from
// this). Keep in sync with VNET_DISPLAY_NAME_REGEX in lib/vdc/vnets.ts.
const NAME_REGEX = /^[a-z][a-z0-9-]{0,19}$/

export default function VnetCreateDialog({ open, vdcs, defaultVdcId, onClose, onCreated }: Props) {
  const t = useTranslations()
  // Default vDC: the caller-supplied one wins if valid; otherwise the vDC
  // context (if the tenant is scoped to one) beats the arbitrary "first in
  // the list" — a tenant creating a VNet while browsing vDC B shouldn't
  // land the picker on vDC A. A cookie pointing outside `vdcs` (foreign,
  // stale, or the "all vDCs" state) fails open to vdcs[0], same as before.
  const initialVdc = useMemo(() => {
    if (defaultVdcId && vdcs.some(v => v.id === defaultVdcId)) return defaultVdcId
    const ctxVdcId = readVdcContextCookie()
    if (ctxVdcId && vdcs.some(v => v.id === ctxVdcId)) return ctxVdcId
    return vdcs[0]?.id ?? ''
  }, [vdcs, defaultVdcId])

  const [vdcId, setVdcId] = useState(initialVdc)
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [firewall, setFirewall] = useState(true)
  const [cidr, setCidr] = useState('')
  const [gateway, setGateway] = useState('')
  const [dnsServers, setDnsServers] = useState('')        // comma-separated
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) setVdcId(initialVdc)
  }, [open, initialVdc])

  // CIDR / gateway live validation — drives helper text + Submit gate.
  const cidrInfo = useMemo(() => parseCidr(cidr), [cidr])
  const cidrValid = !!cidrInfo
  const gatewayValid = !cidr || !gateway || gatewayValidForCidr(gateway, cidr)

  // Suggest gateway = first usable host the moment a fresh, valid CIDR is
  // typed and the gateway field is still empty (don't fight manual edits).
  useEffect(() => {
    if (!cidrInfo) return
    if (!gateway) {
      const candidate = intToIp(cidrInfo.firstUsableInt)
      if (candidate && ipToInt(candidate) !== null) setGateway(candidate)
    }
  }, [cidrInfo, gateway])

  const nameValid = displayName === '' || NAME_REGEX.test(displayName)
  const subnetValid = cidrValid && !!gateway && gatewayValid
  const canSubmit = !!vdcId && !!displayName && nameValid && subnetValid && !saving

  const handleSubmit = async () => {
    if (!vdcId) {
      setError(t('myVdc.vnetSelectVdc'))
      return
    }
    if (!NAME_REGEX.test(displayName)) {
      setError(t('myVdc.errorInvalidName'))
      return
    }
    setSaving(true); setError(null)
    try {
      const subnet = {
        cidr,
        gateway,
        dnsServers: dnsServers
          ? dnsServers.split(',').map(s => s.trim()).filter(Boolean)
          : undefined,
      }
      const res = await fetch(`/api/v1/vdcs/${encodeURIComponent(vdcId)}/vnets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName,
          description: description || undefined,
          firewall,
          subnet,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      onCreated()
      setDisplayName(''); setDescription(''); setFirewall(true)
      setCidr(''); setGateway(''); setDnsServers('')
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <AppDialogTitle onClose={onClose}>{t('myVdc.createVnet')}</AppDialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          <TextField
            select
            label={t('myVdc.vnetVdc')}
            value={vdcId}
            onChange={(e) => setVdcId(e.target.value)}
            disabled={vdcs.length <= 1 || saving}
            helperText={vdcs.length === 0 ? t('myVdc.vnetNoVdc') : undefined}
            fullWidth
          >
            {vdcs.map((v) => (
              <MenuItem key={v.id} value={v.id}>{v.name}</MenuItem>
            ))}
          </TextField>
          <TextField
            label={t('myVdc.vnetName')}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            error={!nameValid}
            helperText={nameValid ? t('myVdc.vnetNameHint') : t('myVdc.errorInvalidName')}
            fullWidth
            autoFocus
            slotProps={{ htmlInput: { maxLength: 20, pattern: '^[a-z][a-z0-9-]{0,19}$' } }}
          />
          <TextField
            label={t('myVdc.vnetDescription')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            multiline
            rows={2}
          />
          <FormControlLabel
            control={<Switch checked={firewall} onChange={(e) => setFirewall(e.target.checked)} />}
            label={t('myVdc.vnetFirewallToggle')}
          />
          <Typography variant="caption" color="text.secondary">{t('myVdc.vnetVniAutoAllocated')}</Typography>

          <Stack spacing={1.5} sx={{ pt: 1 }}>
            <Typography variant="subtitle2">{t('myVdc.subnetSectionTitle')}</Typography>
            <TextField
              label={t('myVdc.subnetCidr')}
              value={cidr}
              onChange={(e) => setCidr(e.target.value.trim())}
              error={!!cidr && !cidrValid}
              helperText={
                !cidr
                  ? t('myVdc.subnetCidrHint')
                  : !cidrValid
                    ? t('myVdc.subnetCidrInvalid')
                    : t('myVdc.subnetCidrUsable', { count: usableHostCount(cidr) })
              }
              fullWidth
              size="small"
              placeholder="10.42.0.0/24"
              required
            />
            <TextField
              label={t('myVdc.subnetGateway')}
              value={gateway}
              onChange={(e) => setGateway(e.target.value.trim())}
              error={!!gateway && !gatewayValid}
              helperText={
                !!gateway && !gatewayValid
                  ? t('myVdc.subnetGatewayInvalid')
                  : t('myVdc.subnetGatewayHint')
              }
              fullWidth
              size="small"
              placeholder="10.42.0.1"
              disabled={!cidrValid}
              required
            />
            <TextField
              label={t('myVdc.subnetDns')}
              value={dnsServers}
              onChange={(e) => setDnsServers(e.target.value)}
              helperText={t('myVdc.subnetDnsHint')}
              fullWidth
              size="small"
              placeholder="1.1.1.1, 9.9.9.9"
            />
          </Stack>

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={!canSubmit}>{t('common.create')}</Button>
      </DialogActions>
    </Dialog>
  )
}
