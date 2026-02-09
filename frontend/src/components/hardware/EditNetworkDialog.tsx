'use client'

import React, { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'

import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormControlLabel,
  Checkbox,
  Box,
  Typography,
  Stack,
  Alert,
  CircularProgress,
  Divider,
} from '@mui/material'

// ==================== EDIT NETWORK DIALOG ====================
type EditNetworkDialogProps = {
  open: boolean
  onClose: () => void
  onSave: (config: any) => Promise<void>
  onDelete: () => Promise<void>
  connId: string
  node: string
  network: {
    id: string
    model: string
    bridge: string
    mac?: string
    vlan?: number
    firewall?: boolean
    linkDown?: boolean
    rate?: number
    mtu?: number
    queues?: number
  } | null
}

export function EditNetworkDialog({ open, onClose, onSave, onDelete, connId, node, network }: EditNetworkDialogProps) {
  const t = useTranslations()
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Bridges disponibles
  const [bridges, setBridges] = useState<string[]>([])

  // Network config
  const [bridge, setBridge] = useState('vmbr0')
  const [model, setModel] = useState('virtio')
  const [vlanTag, setVlanTag] = useState('')
  const [macAddress, setMacAddress] = useState('')
  const [firewall, setFirewall] = useState(true)
  const [disconnect, setDisconnect] = useState(false)
  const [rateLimit, setRateLimit] = useState('')
  const [mtu, setMtu] = useState('')
  const [multiqueue, setMultiqueue] = useState('')

  // Charger les bridges et initialiser les valeurs
  useEffect(() => {
    if (!open || !connId || !node) return

    const loadBridges = async () => {
      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/network`)
        const json = await res.json()

        if (json.data && Array.isArray(json.data)) {
          const bridgeList = json.data
            .filter((n: any) => n.type === 'bridge')
            .map((n: any) => n.iface)

          setBridges(bridgeList.length > 0 ? bridgeList : ['vmbr0', 'vmbr1'])
        } else {
          setBridges(['vmbr0', 'vmbr1'])
        }
      } catch (e) {
        setBridges(['vmbr0', 'vmbr1'])
      }
    }

    loadBridges()
  }, [open, connId, node])

  // Initialiser les valeurs depuis le network
  useEffect(() => {
    if (open && network) {
      setBridge(network.bridge || 'vmbr0')
      setModel(network.model || 'virtio')
      setVlanTag(network.vlan ? String(network.vlan) : '')
      setMacAddress(network.mac || '')
      setFirewall(network.firewall !== false)
      setDisconnect(network.linkDown || false)
      setRateLimit(network.rate ? String(network.rate) : '')
      setMtu(network.mtu ? String(network.mtu) : '')
      setMultiqueue(network.queues ? String(network.queues) : '')
    }
  }, [open, network])

  const handleSave = async () => {
    if (!network) return

    setSaving(true)
    setError(null)

    try {
      let netConfig = `${model},bridge=${bridge}`

      if (macAddress) netConfig += `,macaddr=${macAddress}`
      if (vlanTag) netConfig += `,tag=${vlanTag}`
      if (firewall) netConfig += ',firewall=1'
      if (disconnect) netConfig += ',link_down=1'
      if (rateLimit) netConfig += `,rate=${rateLimit}`
      if (mtu) netConfig += `,mtu=${mtu}`
      if (multiqueue) netConfig += `,queues=${multiqueue}`

      await onSave({ [network.id]: netConfig })
      onClose()
    } catch (e: any) {
      setError(e.message || t('errors.updateError'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!network) return
    if (!confirm(t('hardware.confirmDeleteNetwork', { id: network.id }))) return

    setDeleting(true)
    setError(null)

    try {
      await onDelete()
      onClose()
    } catch (e: any) {
      setError(e.message || t('errors.deleteError'))
    } finally {
      setDeleting(false)
    }
  }

  if (!network) return null

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-router-line" style={{ fontSize: 24 }} />
          Modifier: {network.id}
        </Box>
      </DialogTitle>

      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Stack spacing={2} sx={{ mt: 1 }}>
          {/* Bridge & Model */}
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Bridge</InputLabel>
              <Select value={bridge} onChange={(e) => setBridge(e.target.value)} label="Bridge">
                {bridges.map((b) => (
                  <MenuItem key={b} value={b}>{b}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>Model</InputLabel>
              <Select value={model} onChange={(e) => setModel(e.target.value)} label="Model">
                <MenuItem value="e1000">Intel E1000</MenuItem>
                <MenuItem value="e1000e">Intel E1000E</MenuItem>
                <MenuItem value="virtio">VirtIO (paravirtualized)</MenuItem>
                <MenuItem value="rtl8139">Realtek RTL8139</MenuItem>
                <MenuItem value="vmxnet3">VMware vmxnet3</MenuItem>
              </Select>
            </FormControl>
          </Box>

          {/* VLAN & MAC */}
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField
              size="small"
              label="VLAN Tag"
              placeholder="no VLAN"
              value={vlanTag}
              onChange={(e) => setVlanTag(e.target.value)}
              type="number"
            />
            <TextField
              size="small"
              label="MAC address"
              value={macAddress}
              onChange={(e) => setMacAddress(e.target.value)}
            />
          </Box>

          {/* Checkboxes */}
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
            <FormControlLabel
              control={<Checkbox checked={firewall} onChange={(e) => setFirewall(e.target.checked)} size="small" />}
              label="Firewall"
            />
            <FormControlLabel
              control={<Checkbox checked={disconnect} onChange={(e) => setDisconnect(e.target.checked)} size="small" />}
              label="Disconnect"
            />
          </Box>

          {/* Advanced */}
          <FormControlLabel
            control={<Checkbox checked={showAdvanced} onChange={(e) => setShowAdvanced(e.target.checked)} size="small" />}
            label="Advanced"
          />

          {showAdvanced && (
            <>
              <Divider />
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                <TextField
                  size="small"
                  label="Rate limit (MB/s)"
                  value={rateLimit}
                  onChange={(e) => setRateLimit(e.target.value)}
                  type="number"
                />
                <TextField
                  size="small"
                  label="MTU"
                  placeholder="1500"
                  value={mtu}
                  onChange={(e) => setMtu(e.target.value)}
                  type="number"
                />
              </Box>
              <TextField
                size="small"
                label="Multiqueue"
                value={multiqueue}
                onChange={(e) => setMultiqueue(e.target.value)}
                type="number"
                fullWidth
              />
            </>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
        <Button
          color="error"
          onClick={handleDelete}
          disabled={saving || deleting}
          startIcon={deleting ? <CircularProgress size={16} /> : <i className="ri-delete-bin-line" />}
        >
          {t('common.delete')}
        </Button>
        <Box>
          <Button onClick={onClose} disabled={saving || deleting} sx={{ mr: 1 }}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving || deleting}>
            {saving ? <CircularProgress size={20} /> : t('common.save')}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  )
}
