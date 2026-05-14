'use client'

import React, { useState, useEffect } from 'react'

import { useTranslations } from 'next-intl'

import {
  Dialog,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  FormLabel,
  InputLabel,
  Select,
  MenuItem,
  FormControlLabel,
  Checkbox,
  Radio,
  RadioGroup,
  Box,
  Stack,
  Alert,
  CircularProgress,
  Divider,
} from '@mui/material'

import AppDialogTitle from '@/components/ui/AppDialogTitle'

// ==================== ADD NETWORK DIALOG ====================
type AddNetworkDialogProps = {
  open: boolean
  onClose: () => void
  onSave: (config: any) => Promise<void>
  connId: string
  node: string
  vmid: string
  vmType?: 'qemu' | 'lxc'
  existingNets: string[]
}

type IPv4Mode = 'static' | 'dhcp'
type IPv6Mode = 'static' | 'dhcp' | 'auto'

export function AddNetworkDialog({ open, onClose, onSave, connId, node, vmid, vmType = 'qemu', existingNets }: AddNetworkDialogProps) {
  const t = useTranslations()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const isLxc = vmType === 'lxc'

  // Bridges disponibles
  const [bridges, setBridges] = useState<string[]>([])
  const [bridgesLoading, setBridgesLoading] = useState(false)

  // Network config — common
  const [netIndex, setNetIndex] = useState(0)
  const [bridge, setBridge] = useState('vmbr0')
  const [vlanTag, setVlanTag] = useState('')
  const [macAddress, setMacAddress] = useState('')
  const [firewall, setFirewall] = useState(true)
  const [disconnect, setDisconnect] = useState(false)
  const [rateLimit, setRateLimit] = useState('')
  const [mtu, setMtu] = useState('')

  // QEMU-only
  const [model, setModel] = useState('virtio')
  const [multiqueue, setMultiqueue] = useState('')

  // LXC-only
  const [ifname, setIfname] = useState('eth0')
  const [ipv4Mode, setIpv4Mode] = useState<IPv4Mode>('static')
  const [ipv4Cidr, setIpv4Cidr] = useState('')
  const [ipv4Gw, setIpv4Gw] = useState('')
  const [ipv6Mode, setIpv6Mode] = useState<IPv6Mode>('static')
  const [ipv6Cidr, setIpv6Cidr] = useState('')
  const [ipv6Gw, setIpv6Gw] = useState('')
  const [hostManaged, setHostManaged] = useState(false)

  // Charger les bridges
  useEffect(() => {
    if (!open || !connId || !node) return

    const loadBridges = async () => {
      setBridgesLoading(true)

      try {
        const res = await fetch(
          `/api/v1/connections/${encodeURIComponent(connId)}/network-choices?node=${encodeURIComponent(node)}`
        )

        if (res.ok) {
          const json = await res.json()
          const choices = Array.isArray(json.data) ? json.data : []
          const bridgeList = choices.map((c: any) => c.name)

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


return match ? Number.parseInt(match[1]) : -1
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

      let netConfig: string

      if (isLxc) {
        // LXC config string format (see PVE Parser.printLxcNetwork).
        const parts: string[] = []

        if (ifname) parts.push(`name=${ifname}`)
        parts.push(`bridge=${bridge}`)
        if (macAddress) parts.push(`hwaddr=${macAddress}`)
        if (vlanTag) parts.push(`tag=${vlanTag}`)
        parts.push(`firewall=${firewall ? 1 : 0}`)

        if (ipv4Mode === 'dhcp') {
          parts.push('ip=dhcp')
        } else if (ipv4Mode === 'static' && ipv4Cidr) {
          parts.push(`ip=${ipv4Cidr}`)
          if (ipv4Gw) parts.push(`gw=${ipv4Gw}`)
        }

        if (ipv6Mode === 'dhcp') {
          parts.push('ip6=dhcp')
        } else if (ipv6Mode === 'auto') {
          parts.push('ip6=auto')
        } else if (ipv6Mode === 'static' && ipv6Cidr) {
          parts.push(`ip6=${ipv6Cidr}`)
          if (ipv6Gw) parts.push(`gw6=${ipv6Gw}`)
        }

        if (disconnect) parts.push('link_down=1')
        if (mtu) parts.push(`mtu=${mtu}`)
        if (rateLimit) parts.push(`rate=${rateLimit}`)
        if (hostManaged) parts.push('host-managed=1')
        netConfig = parts.join(',')
      } else {
        netConfig = `${model},bridge=${bridge}`
        if (macAddress) netConfig += `,macaddr=${macAddress}`
        if (vlanTag) netConfig += `,tag=${vlanTag}`
        if (firewall) netConfig += ',firewall=1'
        if (disconnect) netConfig += ',link_down=1'
        if (rateLimit) netConfig += `,rate=${rateLimit}`
        if (mtu) netConfig += `,mtu=${mtu}`
        if (multiqueue) netConfig += `,queues=${multiqueue}`
      }

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
      <AppDialogTitle onClose={onClose} icon={<i className="ri-router-line" style={{ fontSize: 24 }} />}>
        {t('hardware.addNetworkInterface')}
      </AppDialogTitle>

      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Stack spacing={2} sx={{ mt: 2.5 }}>
          {/* Row 1: LXC=Name+MAC | QEMU=Bridge+Model */}
          {isLxc ? (
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <TextField
                size="small"
                label="Name"
                placeholder="eth0"
                value={ifname}
                onChange={(e) => setIfname(e.target.value)}
              />
              <TextField
                size="small"
                label="MAC address"
                placeholder="auto"
                value={macAddress}
                onChange={(e) => setMacAddress(e.target.value)}
              />
            </Box>
          ) : (
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
          )}

          {/* LXC: Bridge below Name+MAC */}
          {isLxc && (
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
          )}

          {/* VLAN & MAC (QEMU) / VLAN alone (LXC) */}
          {isLxc ? (
            <TextField
              size="small"
              label="VLAN Tag"
              placeholder="no VLAN"
              value={vlanTag}
              onChange={(e) => setVlanTag(e.target.value)}
              type="number"
              inputProps={{ min: 1, max: 4094 }}
              fullWidth
            />
          ) : (
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
          )}

          {/* LXC: IPv4 + IPv6 sections */}
          {isLxc && (
            <>
              <Divider />
              <FormControl size="small">
                <FormLabel sx={{ fontSize: 13 }}>IPv4</FormLabel>
                <RadioGroup
                  row
                  value={ipv4Mode}
                  onChange={(e) => setIpv4Mode(e.target.value as IPv4Mode)}
                  sx={{ mt: 0.5 }}
                >
                  <FormControlLabel value="static" control={<Radio size="small" />} label="Static" />
                  <FormControlLabel value="dhcp" control={<Radio size="small" />} label="DHCP" />
                </RadioGroup>
              </FormControl>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                <TextField
                  size="small"
                  label="IPv4/CIDR"
                  placeholder={ipv4Mode === 'dhcp' ? '— DHCP' : '192.168.1.10/24'}
                  value={ipv4Mode === 'static' ? ipv4Cidr : ''}
                  onChange={(e) => setIpv4Cidr(e.target.value)}
                  disabled={ipv4Mode !== 'static'}
                />
                <TextField
                  size="small"
                  label="Gateway (IPv4)"
                  placeholder={ipv4Mode === 'dhcp' ? '— DHCP' : '192.168.1.1'}
                  value={ipv4Mode === 'static' ? ipv4Gw : ''}
                  onChange={(e) => setIpv4Gw(e.target.value)}
                  disabled={ipv4Mode !== 'static'}
                />
              </Box>

              <FormControl size="small">
                <FormLabel sx={{ fontSize: 13 }}>IPv6</FormLabel>
                <RadioGroup
                  row
                  value={ipv6Mode}
                  onChange={(e) => setIpv6Mode(e.target.value as IPv6Mode)}
                  sx={{ mt: 0.5 }}
                >
                  <FormControlLabel value="static" control={<Radio size="small" />} label="Static" />
                  <FormControlLabel value="dhcp" control={<Radio size="small" />} label="DHCP" />
                  <FormControlLabel value="auto" control={<Radio size="small" />} label="SLAAC" />
                </RadioGroup>
              </FormControl>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                <TextField
                  size="small"
                  label="IPv6/CIDR"
                  placeholder={ipv6Mode === 'static' ? '2001:db8::1/64' : `— ${ipv6Mode.toUpperCase()}`}
                  value={ipv6Mode === 'static' ? ipv6Cidr : ''}
                  onChange={(e) => setIpv6Cidr(e.target.value)}
                  disabled={ipv6Mode !== 'static'}
                />
                <TextField
                  size="small"
                  label="Gateway (IPv6)"
                  placeholder={ipv6Mode === 'static' ? 'fe80::1' : `— ${ipv6Mode.toUpperCase()}`}
                  value={ipv6Mode === 'static' ? ipv6Gw : ''}
                  onChange={(e) => setIpv6Gw(e.target.value)}
                  disabled={ipv6Mode !== 'static'}
                />
              </Box>
              <Divider />
            </>
          )}

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
              {isLxc ? (
                <FormControlLabel
                  control={<Checkbox checked={hostManaged} onChange={(e) => setHostManaged(e.target.checked)} size="small" />}
                  label="Host-Managed"
                />
              ) : (
                <TextField
                  size="small"
                  label="Multiqueue"
                  value={multiqueue}
                  onChange={(e) => setMultiqueue(e.target.value)}
                  type="number"
                  inputProps={{ min: 0, max: 64 }}
                  fullWidth
                />
              )}
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
