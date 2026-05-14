'use client'

import { useState } from 'react'

import { useTranslations } from 'next-intl'

import {
  Dialog, DialogContent, DialogActions, Button, TextField, FormControlLabel, Switch,
  Alert, Stack, Box, Typography, Divider,
} from '@mui/material'

import AppDialogTitle from '@/components/ui/AppDialogTitle'

interface Props {
  vnet: any
  vdcId: string
  onClose: () => void
  onSaved: () => void
}

export default function VnetEditDialog({ vnet, vdcId, onClose, onSaved }: Props) {
  const t = useTranslations()
  const subnet = vnet.subnet ?? null

  const [description, setDescription] = useState(vnet.description ?? '')
  const [firewall, setFirewall] = useState(!!vnet.firewall)

  const [dnsServers, setDnsServers] = useState<string>(
    Array.isArray(subnet?.dnsServers) ? subnet.dnsServers.join(', ') : '',
  )

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = !saving

  const handleSubmit = async () => {
    setSaving(true); setError(null)

    try {
      const segment = vnet.displayName ?? vnet.pveName

      const subnetPatch = subnet
        ? {
            dnsServers: dnsServers
              .split(',')
              .map(s => s.trim())
              .filter(Boolean),
          }
        : undefined

      const res = await fetch(
        `/api/v1/vdcs/${encodeURIComponent(vdcId)}/vnets/${encodeURIComponent(segment)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description, firewall, subnet: subnetPatch }),
        }
      )

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
    <Dialog open onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <AppDialogTitle onClose={onClose}>{vnet.displayName ?? vnet.pveName}</AppDialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          <TextField label={t('myVdc.vnetDescription')} value={description} onChange={(e) => setDescription(e.target.value)} fullWidth multiline rows={2} />
          <FormControlLabel control={<Switch checked={firewall} onChange={(e) => setFirewall(e.target.checked)} />} label={t('myVdc.vnetFirewallToggle')} />

          {subnet && (
            <>
              <Divider />
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{t('myVdc.subnetColumn')}</Typography>
              {/* CIDR + gateway are immutable post-creation (changing them
                  invalidates IPAM allocations). Render as read-only for context. */}
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                <TextField
                  label={t('myVdc.subnetCidr')}
                  value={subnet.cidr}
                  fullWidth
                  size="small"
                  InputProps={{ readOnly: true }}
                  helperText={t('myVdc.subnetReadOnly')}
                />
                <TextField
                  label={t('myVdc.subnetGateway')}
                  value={subnet.gateway}
                  fullWidth
                  size="small"
                  InputProps={{ readOnly: true }}
                />
              </Box>
              <TextField
                label={t('myVdc.subnetDns')}
                value={dnsServers}
                onChange={(e) => setDnsServers(e.target.value)}
                helperText={t('myVdc.subnetDnsHint')}
                fullWidth
                size="small"
                placeholder="1.1.1.1, 9.9.9.9"
              />
            </>
          )}

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={!canSubmit}>{t('common.save')}</Button>
      </DialogActions>
    </Dialog>
  )
}
