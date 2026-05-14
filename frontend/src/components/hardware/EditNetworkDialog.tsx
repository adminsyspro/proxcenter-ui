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
  InputLabel,
  Select,
  MenuItem,
  FormControlLabel,
  Checkbox,
  Radio,
  RadioGroup,
  FormLabel,
  Box,
  Typography,
  Stack,
  Alert,
  CircularProgress,
  Divider,
  Tooltip,
} from '@mui/material'

import AppDialogTitle from '@/components/ui/AppDialogTitle'

// ==================== EDIT NETWORK DIALOG ====================
type EditNetworkDialogProps = {
  open: boolean
  onClose: () => void
  onSave: (config: any) => Promise<void>
  onDelete: () => Promise<void>
  connId: string
  node: string
  vmType?: 'qemu' | 'lxc'
  network: {
    id: string
    model?: string
    bridge: string
    mac?: string
    macaddr?: string
    vlan?: number
    firewall?: boolean
    linkDown?: boolean
    rate?: number
    mtu?: number
    queues?: number

    // LXC-only fields
    name?: string
    ip?: string
    gw?: string
    ip6?: string
    gw6?: string
    hostmanaged?: boolean
  } | null
}

// PVE LXC network dialog only exposes these modes (Static + DHCP for IPv4,
// Static + DHCP + SLAAC for IPv6). "Static" with an empty CIDR omits the
// `ip=`/`ip6=` line entirely, matching PVE's behavior of not writing empty
// values back to the LXC config.
type IPv4Mode = 'static' | 'dhcp'
type IPv6Mode = 'static' | 'dhcp' | 'auto'

function parseIPv4(ip: string | undefined): { mode: IPv4Mode; cidr: string } {
  if (ip === 'dhcp') return { mode: 'dhcp', cidr: '' }

return { mode: 'static', cidr: ip || '' }
}

function parseIPv6(ip6: string | undefined): { mode: IPv6Mode; cidr: string } {
  if (ip6 === 'auto') return { mode: 'auto', cidr: '' }
  if (ip6 === 'dhcp') return { mode: 'dhcp', cidr: '' }

return { mode: 'static', cidr: ip6 || '' }
}

export function EditNetworkDialog({ open, onClose, onSave, onDelete, connId, node, network, vmType = 'qemu' }: EditNetworkDialogProps) {
  const t = useTranslations()
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const isLxc = vmType === 'lxc'

  // Bridges disponibles
  // {iface,label,kind}: iface is the actual PVE bridge name (hashed for tenant
  // VNets); label is the user-friendly display name; kind tells us whether
  // this is a SDN VNet, a shared bridge, or a raw physical bridge — used to
  // gate the per-NIC VLAN tag field which PVE rejects on VXLAN VNets.
  const [bridges, setBridges] = useState<Array<{ iface: string; label: string; kind: 'vnet' | 'shared' | 'bridge' }>>([])

  // Network config — common
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

  // Charger les bridges et initialiser les valeurs
  useEffect(() => {
    if (!open || !connId || !node) return

    const loadBridges = async () => {
      try {
        const res = await fetch(
          `/api/v1/connections/${encodeURIComponent(connId)}/network-choices?node=${encodeURIComponent(node)}`
        )

        if (res.ok) {
          const json = await res.json()
          const choices = Array.isArray(json.data) ? json.data : []

          const bridgeList = choices.map((c: any) => ({
            iface: c.name,
            label: c.kind === 'vnet'
              ? (c.displayName ?? c.name)
              : c.kind === 'shared'
                ? (c.label ?? c.name)
                : c.name,
            kind: (c.kind === 'vnet' || c.kind === 'shared' ? c.kind : 'bridge') as 'vnet' | 'shared' | 'bridge',
          }))

          const fallback = [
            { iface: 'vmbr0', label: 'vmbr0', kind: 'bridge' as const },
            { iface: 'vmbr1', label: 'vmbr1', kind: 'bridge' as const },
          ]

          setBridges(bridgeList.length > 0 ? bridgeList : fallback)
        } else {
          setBridges([
            { iface: 'vmbr0', label: 'vmbr0', kind: 'bridge' },
            { iface: 'vmbr1', label: 'vmbr1', kind: 'bridge' },
          ])
        }
      } catch (e) {
        setBridges([
          { iface: 'vmbr0', label: 'vmbr0', kind: 'bridge' },
          { iface: 'vmbr1', label: 'vmbr1', kind: 'bridge' },
        ])
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

      // QEMU parser stores the MAC in `macaddr`, LXC parser in `macaddr` too,
      // but old callers may still pass `mac`.
      setMacAddress(network.macaddr || network.mac || '')

      // PVE convention: missing `firewall=` parameter = firewall OFF.
      // Our parser leaves network.firewall as undefined when the key isn't
      // present in the config, so map undefined to false to match PVE,
      // instead of the previous `!== false` which mapped undefined to true
      // and silently flipped the firewall on when the user clicked Save.
      setFirewall(network.firewall === true)
      setDisconnect(network.linkDown || false)
      setRateLimit(network.rate ? String(network.rate) : '')
      setMtu(network.mtu ? String(network.mtu) : '')
      setMultiqueue(network.queues ? String(network.queues) : '')

      // LXC-only
      setIfname(network.name || 'eth0')
      const v4 = parseIPv4(network.ip)

      setIpv4Mode(v4.mode)
      setIpv4Cidr(v4.cidr)
      setIpv4Gw(network.gw || '')
      const v6 = parseIPv6(network.ip6)

      setIpv6Mode(v6.mode)
      setIpv6Cidr(v6.cidr)
      setIpv6Gw(network.gw6 || '')
      setHostManaged(network.hostmanaged === true)
    }
  }, [open, network])

  const handleSave = async () => {
    if (!network) return

    setSaving(true)
    setError(null)

    try {
      // SDN VXLAN VNets reject per-NIC VLAN tags — drop the tag client-side
      // even if the field somehow holds a stale value from a prior bridge
      // selection, so the user doesn't hit a 400 from PVE.
      const selectedBridge = bridges.find(b => b.iface === bridge)
      const isSdnVnet = selectedBridge?.kind === 'vnet'

      let netConfig: string

      if (isLxc) {
        // LXC config string format (see PVE Parser.printLxcNetwork):
        //   name=eth0,bridge=vmbr0,hwaddr=...,ip=...,gw=...,ip6=...,gw6=...,
        //   firewall=0|1,link_down=0|1,mtu=...,rate=...,tag=...,host-managed=0|1
        // Empty values are omitted to match PVE's printer (which filters them).
        const parts: string[] = []

        if (ifname) parts.push(`name=${ifname}`)
        parts.push(`bridge=${bridge}`)
        if (macAddress) parts.push(`hwaddr=${macAddress}`)
        if (!isSdnVnet && vlanTag) parts.push(`tag=${vlanTag}`)
        parts.push(`firewall=${firewall ? 1 : 0}`)


        // IPv4
        if (ipv4Mode === 'dhcp') {
          parts.push('ip=dhcp')
        } else if (ipv4Mode === 'static' && ipv4Cidr) {
          parts.push(`ip=${ipv4Cidr}`)
          if (ipv4Gw) parts.push(`gw=${ipv4Gw}`)
        }


        // IPv6
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
        // QEMU config string format: <model>=<mac>,bridge=...,...
        netConfig = `${model},bridge=${bridge}`
        if (macAddress) netConfig += `,macaddr=${macAddress}`
        if (!isSdnVnet && vlanTag) netConfig += `,tag=${vlanTag}`
        if (firewall) netConfig += ',firewall=1'
        if (disconnect) netConfig += ',link_down=1'
        if (rateLimit) netConfig += `,rate=${rateLimit}`
        if (mtu) netConfig += `,mtu=${mtu}`
        if (multiqueue) netConfig += `,queues=${multiqueue}`
      }

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
      <AppDialogTitle onClose={onClose} icon={<i className="ri-router-line" style={{ fontSize: 24 }} />}>
        {t('common.edit')}: {network.id}
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
                <Select value={bridge} onChange={(e) => setBridge(e.target.value)} label="Bridge">
                  {bridges.map((b) => (
                    <MenuItem key={b.iface} value={b.iface}>
                      {b.label}
                      {b.label !== b.iface && (
                        <span style={{ opacity: 0.45, marginLeft: 8, fontSize: '0.75em' }}>{b.iface}</span>
                      )}
                    </MenuItem>
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

          {/* LXC: Bridge on its own row (after Name+MAC) */}
          {isLxc && (
            <FormControl fullWidth size="small">
              <InputLabel>Bridge</InputLabel>
              <Select value={bridge} onChange={(e) => setBridge(e.target.value)} label="Bridge">
                {bridges.map((b) => (
                  <MenuItem key={b.iface} value={b.iface}>
                    {b.label}
                    {b.label !== b.iface && (
                      <span style={{ opacity: 0.45, marginLeft: 8, fontSize: '0.75em' }}>{b.iface}</span>
                    )}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          {/* VLAN & MAC (QEMU) / VLAN alone (LXC, MAC already shown above) */}
          {(() => {
            const selectedBridge = bridges.find(b => b.iface === bridge)
            const isSdnVnet = selectedBridge?.kind === 'vnet'


            // PVE rejects per-NIC VLAN tags on VXLAN SDN VNets unless the
            // VNet has VLAN aware enabled (which is mutually exclusive with
            // an attached subnet, so almost never the case in our flow).
            // Surface this constraint inline instead of letting the user hit
            // a 400 from PVE.
            const tagField = (
              <TextField
                size="small"
                label="VLAN Tag"
                placeholder={isSdnVnet ? '— SDN VNet, tag ignored' : 'no VLAN'}
                value={isSdnVnet ? '' : vlanTag}
                onChange={(e) => setVlanTag(e.target.value)}
                type="number"
                disabled={isSdnVnet}
                helperText={isSdnVnet ? 'Use a separate VNet to segment traffic' : undefined}
                fullWidth={isLxc}
              />
            )

            if (isLxc) {
              return isSdnVnet ? (
                <Tooltip
                  arrow
                  placement="top"
                  title="VLAN tagging on a NIC isn't supported on VXLAN SDN VNets — each VNet is already its own isolated L2 domain (VNI). To split traffic, create a second VNet instead of tagging a NIC here."
                >
                  <span>{tagField}</span>
                </Tooltip>
              ) : (
                tagField
              )
            }


return (
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                {isSdnVnet ? (
                  <Tooltip
                    arrow
                    placement="top"
                    title="VLAN tagging on a NIC isn't supported on VXLAN SDN VNets — each VNet is already its own isolated L2 domain (VNI). To split traffic, create a second VNet instead of tagging a NIC here."
                  >
                    <span>{tagField}</span>
                  </Tooltip>
                ) : (
                  tagField
                )}
                <TextField
                  size="small"
                  label="MAC address"
                  value={macAddress}
                  onChange={(e) => setMacAddress(e.target.value)}
                />
              </Box>
            )
          })()}

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
                  fullWidth
                />
              )}
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
