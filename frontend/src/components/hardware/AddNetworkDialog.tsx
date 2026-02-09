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
  Stack,
  Alert,
  CircularProgress,
  Divider,
} from '@mui/material'

// ==================== ADD NETWORK DIALOG ====================
type AddNetworkDialogProps = {
  open: boolean
  onClose: () => void
  onSave: (config: any) => Promise<void>
  connId: string
  node: string
  vmid: string
  existingNets: string[]
}

export function AddNetworkDialog({ open, onClose, onSave, connId, node, vmid, existingNets }: AddNetworkDialogProps) {
  const t = useTranslations()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Bridges disponibles
  const [bridges, setBridges] = useState<string[]>([])
  const [bridgesLoading, setBridgesLoading] = useState(false)

  // Network config
  const [netIndex, setNetIndex] = useState(0)
  const [bridge, setBridge] = useState('vmbr0')
  const [model, setModel] = useState('virtio')
  const [vlanTag, setVlanTag] = useState('')
  const [macAddress, setMacAddress] = useState('')
  const [firewall, setFirewall] = useState(true)
  const [disconnect, setDisconnect] = useState(false)
  const [rateLimit, setRateLimit] = useState('')
  const [mtu, setMtu] = useState('')
  const [multiqueue, setMultiqueue] = useState('')

  // Charger les bridges
  useEffect(() => {
    if (!open || !connId || !node) return

    const loadBridges = async () => {
      setBridgesLoading(true)

      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/network`)
        const json = await res.json()

        console.log('[AddNetworkDialog] Network response:', json)

        if (json.data && Array.isArray(json.data)) {
          const bridgeList = json.data
            .filter((n: any) => n.type === 'bridge' || n.type === 'OVSBridge')
            .map((n: any) => n.iface)

          console.log('[AddNetworkDialog] Bridges found:', bridgeList)

          if (bridgeList.length > 0) {
            setBridges(bridgeList)
            setBridge(bridgeList[0])
          } else {
            // Pas de bridges trouvés, utiliser fallback
            setBridges(['vmbr0', 'vmbr1'])
            setBridge('vmbr0')
          }
        } else {
          // Réponse invalide, utiliser fallback
          setBridges(['vmbr0', 'vmbr1'])
          setBridge('vmbr0')
        }
      } catch (e) {
        console.error('Error loading bridges:', e)

        // Fallback
        setBridges(['vmbr0', 'vmbr1'])
        setBridge('vmbr0')
      } finally {
        setBridgesLoading(false)
      }
    }

    loadBridges()
  }, [open, connId, node])

  // Calculer le prochain index disponible
  useEffect(() => {
    if (!open) return

    const usedIndexes = existingNets
      .filter(n => n.startsWith('net'))
      .map(n => {
        const match = n.match(/net(\d+)/)


return match ? parseInt(match[1]) : -1
      })
      .filter(i => i >= 0)

    let nextIndex = 0

    while (usedIndexes.includes(nextIndex)) {
      nextIndex++
    }

    setNetIndex(nextIndex)
  }, [open, existingNets])

  const handleSave = async () => {
    setSaving(true)
    setError(null)

    try {
      const netId = `net${netIndex}`

      // Construire la config réseau
      let netConfig = `${model},bridge=${bridge}`

      if (macAddress) netConfig += `,macaddr=${macAddress}`
      if (vlanTag) netConfig += `,tag=${vlanTag}`
      if (firewall) netConfig += ',firewall=1'
      if (disconnect) netConfig += ',link_down=1'
      if (rateLimit) netConfig += `,rate=${rateLimit}`
      if (mtu) netConfig += `,mtu=${mtu}`
      if (multiqueue) netConfig += `,queues=${multiqueue}`

      await onSave({ [netId]: netConfig })
      onClose()
    } catch (e: any) {
      setError(e.message || t('errors.addError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className="ri-router-line" style={{ fontSize: 24 }} />
        {t('hardware.addNetworkInterface')}
      </DialogTitle>

      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Stack spacing={2} sx={{ mt: 1 }}>
          {/* Bridge & Model */}
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Bridge</InputLabel>
              <Select
                value={bridge}
                onChange={(e) => setBridge(e.target.value)}
                label="Bridge"
                disabled={bridgesLoading}
              >
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
              inputProps={{ min: 1, max: 4094 }}
            />
            <TextField
              size="small"
              label="MAC address"
              placeholder="auto"
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

          {/* Advanced toggle */}
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
                  inputProps={{ min: 0 }}
                />
                <TextField
                  size="small"
                  label="MTU"
                  placeholder="1500 (= bridge MTU)"
                  value={mtu}
                  onChange={(e) => setMtu(e.target.value)}
                  type="number"
                  inputProps={{ min: 576, max: 65535 }}
                />
              </Box>
              <TextField
                size="small"
                label="Multiqueue"
                value={multiqueue}
                onChange={(e) => setMultiqueue(e.target.value)}
                type="number"
                inputProps={{ min: 0, max: 64 }}
                fullWidth
              />
            </>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? <CircularProgress size={20} /> : t('common.add')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
