'use client'

import React, { useState, useEffect } from 'react'

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
  Chip,
} from '@mui/material'

// Interface types supported by PVE
const IFACE_TYPES = [
  { value: 'bridge', label: 'Linux Bridge' },
  { value: 'bond', label: 'Linux Bond' },
  { value: 'vlan', label: 'VLAN' },
  { value: 'OVSBridge', label: 'OVS Bridge' },
  { value: 'OVSBond', label: 'OVS Bond' },
  { value: 'OVSPort', label: 'OVS Port' },
  { value: 'OVSIntPort', label: 'OVS IntPort' },
] as const

const BOND_MODES = [
  { value: 'balance-rr', label: 'balance-rr (0)' },
  { value: 'active-backup', label: 'active-backup (1)' },
  { value: 'balance-xor', label: 'balance-xor (2)' },
  { value: 'broadcast', label: 'broadcast (3)' },
  { value: '802.3ad', label: '802.3ad (4) - LACP' },
  { value: 'balance-tlb', label: 'balance-tlb (5)' },
  { value: 'balance-alb', label: 'balance-alb (6)' },
] as const

const HASH_POLICIES = [
  { value: 'layer2', label: 'layer2' },
  { value: 'layer2+3', label: 'layer2+3' },
  { value: 'layer3+4', label: 'layer3+4' },
] as const

type NetworkInterfaceDialogProps = {
  open: boolean
  onClose: () => void
  onSave: (data: any) => Promise<void>
  onDelete?: (iface: string) => Promise<void>
  mode: 'create' | 'edit' | 'view'
  /** The interface data when editing/viewing. null for create. */
  iface: any | null
  /** Available physical interfaces for bridge_ports/slaves selection */
  allInterfaces?: any[]
}

export default function NetworkInterfaceDialog({
  open,
  onClose,
  onSave,
  onDelete,
  mode,
  iface,
  allInterfaces = [],
}: NetworkInterfaceDialogProps) {
  const [form, setForm] = useState<Record<string, any>>({})
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(mode === 'create')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (open) {
      setError('')
      setSaving(false)
      setDeleting(false)
      setConfirmDelete(false)

      if (mode === 'create') {
        setForm({ type: 'bridge', autostart: true })
        setEditing(true)
      } else if (iface) {
        const isPhysicalIface = iface.type === 'eth'

        setForm({
          iface: iface.iface,
          type: iface.type,
          method: iface.method || 'static',
          address: iface.address || '',
          netmask: iface.netmask || '',
          gateway: iface.gateway || '',
          address6: iface.address6 || '',
          netmask6: iface.netmask6 || '',
          gateway6: iface.gateway6 || '',
          autostart: !!iface.autostart,
          mtu: iface.mtu || '',
          comments: iface.comments || '',
          bridge_ports: iface.bridge_ports || '',
          bridge_stp: iface.bridge_stp ?? '',
          bridge_fd: iface.bridge_fd ?? '',
          bridge_vlan_aware: !!iface.bridge_vlan_aware,
          bond_mode: iface.bond_mode || '',
          'bond-primary': iface.bond_primary || iface['bond-primary'] || '',
          bond_xmit_hash_policy: iface.bond_xmit_hash_policy || iface['bond-xmit-hash-policy'] || '',
          slaves: iface.slaves || '',
          'vlan-id': iface.vlan_id || '',
          'vlan-raw-device': iface.vlan_raw_device || '',
        })
        // Physical interfaces (eth) open in view mode; others open directly in edit mode
        setEditing(mode === 'edit' && !isPhysicalIface)
      }
    }
  }, [open, mode, iface])

  const set = (field: string, value: any) => setForm(prev => ({ ...prev, [field]: value }))
  const isReadonly = !editing
  const isPhysical = iface?.type === 'eth'
  const type = form.type || ''
  const isBridge = type === 'bridge' || type === 'OVSBridge'
  const isBond = type === 'bond' || type === 'OVSBond'
  const isVlan = type === 'vlan'

  const handleSave = async () => {
    setError('')
    setSaving(true)
    try {
      await onSave(form)
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setError('')
    setDeleting(true)
    try {
      await onDelete?.(form.iface)
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Failed to delete')
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const title = mode === 'create'
    ? 'Create Network Interface'
    : `Network Interface: ${iface?.iface || ''}`

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-router-line" style={{ fontSize: 20 }} />
          {title}
        </Box>
        {iface && (
          <Chip
            size="small"
            label={iface.active ? 'Active' : 'Inactive'}
            color={iface.active ? 'success' : 'default'}
            sx={{ height: 22, fontSize: 11 }}
          />
        )}
      </DialogTitle>

      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Stack spacing={2.5}>
          {/* Basic Info */}
          <Typography variant="subtitle2" fontWeight={700} sx={{ mt: 0.5 }}>General</Typography>

          {mode === 'create' && (
            <TextField
              label="Name"
              size="small"
              fullWidth
              value={form.iface || ''}
              onChange={e => set('iface', e.target.value)}
              placeholder={type === 'bridge' ? 'vmbr1' : type === 'bond' ? 'bond0' : type === 'vlan' ? 'eno1.100' : ''}
              helperText={type === 'bridge' ? 'e.g. vmbr0, vmbr1' : type === 'bond' ? 'e.g. bond0, bond1' : type === 'vlan' ? 'e.g. eno1.100' : ''}
            />
          )}

          <FormControl size="small" fullWidth disabled={isReadonly || (mode === 'edit' && isPhysical)}>
            <InputLabel>Type</InputLabel>
            <Select
              value={form.type || ''}
              label="Type"
              onChange={e => set('type', e.target.value)}
            >
              {IFACE_TYPES.map(t => (
                <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControlLabel
            control={
              <Checkbox
                checked={!!form.autostart}
                onChange={e => set('autostart', e.target.checked)}
                disabled={isReadonly}
              />
            }
            label="Autostart"
          />

          {/* IPv4 */}
          <Divider />
          <Typography variant="subtitle2" fontWeight={700}>IPv4</Typography>

          <TextField
            label="IPv4 Address"
            size="small"
            fullWidth
            value={form.address || ''}
            onChange={e => set('address', e.target.value)}
            disabled={isReadonly}
            placeholder="192.168.1.10"
          />

          <TextField
            label="Subnet Mask"
            size="small"
            fullWidth
            value={form.netmask || ''}
            onChange={e => set('netmask', e.target.value)}
            disabled={isReadonly}
            placeholder="255.255.255.0"
          />

          <TextField
            label="Gateway"
            size="small"
            fullWidth
            value={form.gateway || ''}
            onChange={e => set('gateway', e.target.value)}
            disabled={isReadonly}
            placeholder="192.168.1.1"
          />

          {/* IPv6 */}
          <Divider />
          <Typography variant="subtitle2" fontWeight={700}>IPv6</Typography>

          <TextField
            label="IPv6 Address"
            size="small"
            fullWidth
            value={form.address6 || ''}
            onChange={e => set('address6', e.target.value)}
            disabled={isReadonly}
          />

          <TextField
            label="IPv6 Prefix Length"
            size="small"
            fullWidth
            value={form.netmask6 || ''}
            onChange={e => set('netmask6', e.target.value)}
            disabled={isReadonly}
          />

          <TextField
            label="IPv6 Gateway"
            size="small"
            fullWidth
            value={form.gateway6 || ''}
            onChange={e => set('gateway6', e.target.value)}
            disabled={isReadonly}
          />

          {/* Bridge options */}
          {isBridge && (
            <>
              <Divider />
              <Typography variant="subtitle2" fontWeight={700}>Bridge Settings</Typography>

              <TextField
                label="Bridge Ports"
                size="small"
                fullWidth
                value={form.bridge_ports || ''}
                onChange={e => set('bridge_ports', e.target.value)}
                disabled={isReadonly}
                placeholder="eno1 eno2"
                helperText="Space-separated list of slave interfaces"
              />

              {/* bridge_stp and bridge_fd are read-only — PVE API does not accept them via PUT */}
              {(form.bridge_stp !== undefined && form.bridge_stp !== '') && (
                <TextField
                  label="Bridge STP"
                  size="small"
                  fullWidth
                  value={form.bridge_stp ?? ''}
                  disabled
                />
              )}

              {(form.bridge_fd !== undefined && form.bridge_fd !== '') && (
                <TextField
                  label="Bridge Forward Delay"
                  size="small"
                  fullWidth
                  value={form.bridge_fd ?? ''}
                  disabled
                />
              )}

              <FormControlLabel
                control={
                  <Checkbox
                    checked={!!form.bridge_vlan_aware}
                    onChange={e => set('bridge_vlan_aware', e.target.checked)}
                    disabled={isReadonly}
                  />
                }
                label="VLAN Aware"
              />
            </>
          )}

          {/* Bond options */}
          {isBond && (
            <>
              <Divider />
              <Typography variant="subtitle2" fontWeight={700}>Bond Settings</Typography>

              <TextField
                label="Slaves"
                size="small"
                fullWidth
                value={form.slaves || ''}
                onChange={e => set('slaves', e.target.value)}
                disabled={isReadonly}
                placeholder="eno1 eno2"
                helperText="Space-separated list of slave interfaces"
              />

              <FormControl size="small" fullWidth disabled={isReadonly}>
                <InputLabel>Bond Mode</InputLabel>
                <Select
                  value={form.bond_mode || ''}
                  label="Bond Mode"
                  onChange={e => set('bond_mode', e.target.value)}
                >
                  {BOND_MODES.map(m => (
                    <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl size="small" fullWidth disabled={isReadonly}>
                <InputLabel>Hash Policy</InputLabel>
                <Select
                  value={form.bond_xmit_hash_policy || ''}
                  label="Hash Policy"
                  onChange={e => set('bond_xmit_hash_policy', e.target.value)}
                >
                  <MenuItem value="">Default</MenuItem>
                  {HASH_POLICIES.map(p => (
                    <MenuItem key={p.value} value={p.value}>{p.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              <TextField
                label="Bond Primary"
                size="small"
                fullWidth
                value={form['bond-primary'] || ''}
                onChange={e => set('bond-primary', e.target.value)}
                disabled={isReadonly}
                placeholder="eno1"
              />
            </>
          )}

          {/* VLAN options */}
          {isVlan && (
            <>
              <Divider />
              <Typography variant="subtitle2" fontWeight={700}>VLAN Settings</Typography>

              <TextField
                label="VLAN ID"
                size="small"
                fullWidth
                type="number"
                value={form['vlan-id'] || ''}
                onChange={e => set('vlan-id', e.target.value)}
                disabled={isReadonly}
                placeholder="100"
              />

              <TextField
                label="VLAN Raw Device"
                size="small"
                fullWidth
                value={form['vlan-raw-device'] || ''}
                onChange={e => set('vlan-raw-device', e.target.value)}
                disabled={isReadonly}
                placeholder="eno1"
                helperText="Physical interface for this VLAN"
              />
            </>
          )}

          {/* Advanced */}
          <Divider />
          <Typography variant="subtitle2" fontWeight={700}>Advanced</Typography>

          <TextField
            label="MTU"
            size="small"
            fullWidth
            type="number"
            value={form.mtu || ''}
            onChange={e => set('mtu', e.target.value)}
            disabled={isReadonly}
            placeholder="1500"
          />

          <TextField
            label="Comments"
            size="small"
            fullWidth
            multiline
            rows={2}
            value={form.comments || ''}
            onChange={e => set('comments', e.target.value)}
            disabled={isReadonly}
          />
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 1.5, justifyContent: 'space-between' }}>
        <Box>
          {mode === 'edit' && !isPhysical && onDelete && (
            <Button
              color="error"
              onClick={handleDelete}
              disabled={deleting || saving}
              startIcon={deleting ? <CircularProgress size={14} /> : <i className="ri-delete-bin-line" style={{ fontSize: 14 }} />}
            >
              {confirmDelete ? 'Confirm Delete' : 'Delete'}
            </Button>
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button onClick={onClose} disabled={saving || deleting}>Cancel</Button>
          {mode !== 'create' && !editing && !isPhysical && (
            <Button variant="outlined" onClick={() => setEditing(true)}>Edit</Button>
          )}
          {editing && (
            <Button
              variant="contained"
              onClick={handleSave}
              disabled={saving || !form.iface || !form.type}
              startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}
            >
              {mode === 'create' ? 'Create' : 'Save'}
            </Button>
          )}
        </Box>
      </DialogActions>
    </Dialog>
  )
}
