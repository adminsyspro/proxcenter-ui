'use client'

import React, { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'

import {
  Dialog,
  DialogContent,
  DialogActions,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
  Typography,
  Stack,
  Alert,
  CircularProgress,
  TextField,
  FormControlLabel,
  Checkbox,
} from '@mui/material'

import { formatBytes } from '@/utils/format'
import AppDialogTitle from '@/components/ui/AppDialogTitle'
import type { Storage } from './utils'

type HardwareType = 'usb' | 'pci' | 'serial' | 'cloudinit' | 'audio' | 'rng'

type AddOtherHardwareDialogProps = {
  open: boolean
  onClose: () => void
  onSave: (config: any) => Promise<void>
  connId: string
  node: string
  vmid: string
  existingHardware: string[]
}

export function AddOtherHardwareDialog({
  open, onClose, onSave, connId, node, vmid, existingHardware,
}: AddOtherHardwareDialogProps) {
  const t = useTranslations()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hwType, setHwType] = useState<HardwareType>('usb')

  // Storages
  const [storages, setStorages] = useState<Storage[]>([])
  const [storagesLoading, setStoragesLoading] = useState(false)

  // USB
  const [usbType, setUsbType] = useState<'spice' | 'device'>('spice')
  const [usbDeviceId, setUsbDeviceId] = useState('')
  const [usbUsb3, setUsbUsb3] = useState(true)

  // PCI
  const [pciDeviceId, setPciDeviceId] = useState('')
  const [pciAllFunctions, setPciAllFunctions] = useState(false)
  const [pciPrimaryGpu, setPciPrimaryGpu] = useState(false)
  const [pciRombar, setPciRombar] = useState(true)
  const [pciPcie, setPciPcie] = useState(true)

  // Serial
  const [serialPath, setSerialPath] = useState('socket')

  // CloudInit
  const [ciStorage, setCiStorage] = useState('')
  const [ciBus, setCiBus] = useState<'ide' | 'scsi' | 'sata'>('ide')

  // Audio
  const [audioDevice, setAudioDevice] = useState('intel-hda')
  const [audioDriver, setAudioDriver] = useState('spice')

  // VirtIO RNG
  const [rngSource, setRngSource] = useState('/dev/urandom')
  const [rngMaxBytes, setRngMaxBytes] = useState(1024)
  const [rngPeriod, setRngPeriod] = useState(1000)

  // PCI/USB device lists from host
  const [pciDevices, setPciDevices] = useState<any[]>([])
  const [usbDevices, setUsbDevices] = useState<any[]>([])
  const [devicesLoading, setDevicesLoading] = useState(false)

  // Determine what's already present
  const hasCloudInit = existingHardware.some(h => h === 'cloudinit')
  const hasAudio = existingHardware.some(h => h.startsWith('audio'))
  const hasRng = existingHardware.some(h => h === 'rng0')

  // Load storages
  useEffect(() => {
    if (!open || !connId || !node) return
    setStoragesLoading(true)
    fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/storages`)
      .then(r => r.json())
      .then(json => {
        const list = (json?.data || json || []).filter((s: any) =>
          s.content?.includes('images') || s.type === 'zfspool' || s.type === 'lvmthin' || s.type === 'lvm' || s.type === 'dir' || s.type === 'nfs' || s.type === 'cifs'
        )
        setStorages(list)
        if (list.length > 0) {
          if (!ciStorage) setCiStorage(list[0].storage)
        }
      })
      .catch(() => {})
      .finally(() => setStoragesLoading(false))
  }, [open, connId, node])

  // Load PCI/USB devices when those types are selected
  useEffect(() => {
    if (!open || !connId || !node) return
    if (hwType === 'pci' || hwType === 'usb') {
      setDevicesLoading(true)
      const endpoint = hwType === 'pci'
        ? `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/hardware/pci`
        : `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/hardware/usb`

      fetch(endpoint)
        .then(r => r.json())
        .then(json => {
          const list = json?.data || json || []
          if (hwType === 'pci') setPciDevices(list)
          else setUsbDevices(list)
        })
        .catch(() => {})
        .finally(() => setDevicesLoading(false))
    }
  }, [open, connId, node, hwType])

  // Reset on open
  useEffect(() => {
    if (open) {
      setError(null)
      setSaving(false)
    }
  }, [open])

  // Find next available index for a key pattern
  const nextIndex = (prefix: string, max: number) => {
    for (let i = 0; i <= max; i++) {
      if (!existingHardware.includes(`${prefix}${i}`)) return i
    }
    return -1
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      let config: Record<string, string> = {}

      switch (hwType) {
        case 'usb': {
          const idx = nextIndex('usb', 4)
          if (idx < 0) throw new Error('Maximum USB devices reached (5)')
          if (usbType === 'spice') {
            config = { [`usb${idx}`]: `spice${usbUsb3 ? ',usb3=1' : ''}` }
          } else {
            if (!usbDeviceId) throw new Error('Please select a USB device')
            config = { [`usb${idx}`]: `host=${usbDeviceId}${usbUsb3 ? ',usb3=1' : ''}` }
          }
          break
        }
        case 'pci': {
          const idx = nextIndex('hostpci', 15)
          if (idx < 0) throw new Error('Maximum PCI devices reached (16)')
          if (!pciDeviceId) throw new Error('Please enter a PCI device ID')
          const parts = [pciDeviceId]
          if (pciPcie) parts.push('pcie=1')
          if (pciRombar) parts.push('rombar=1')
          if (pciAllFunctions) parts.push('x-vga=0')
          if (pciPrimaryGpu) parts.push('x-vga=1')
          config = { [`hostpci${idx}`]: parts.join(',') }
          break
        }
        case 'serial': {
          const idx = nextIndex('serial', 3)
          if (idx < 0) throw new Error('Maximum serial ports reached (4)')
          config = { [`serial${idx}`]: serialPath || 'socket' }
          break
        }
        case 'cloudinit': {
          if (!ciStorage) throw new Error('Please select a storage')
          // Find next available disk slot for the chosen bus
          const busPrefix = ciBus
          let slotIdx = 2 // ide2 is typical for cloudinit
          if (busPrefix === 'ide') {
            for (let i = 0; i <= 3; i++) {
              if (!existingHardware.includes(`ide${i}`)) { slotIdx = i; break }
            }
          } else {
            for (let i = 0; i <= 30; i++) {
              if (!existingHardware.includes(`${busPrefix}${i}`)) { slotIdx = i; break }
            }
          }
          config = { [`${busPrefix}${slotIdx}`]: `${ciStorage}:cloudinit` }
          break
        }
        case 'audio': {
          config = { audio0: `device=${audioDevice},driver=${audioDriver}` }
          break
        }
        case 'rng': {
          const parts = [`source=${rngSource}`]
          if (rngMaxBytes > 0) parts.push(`max_bytes=${rngMaxBytes}`)
          if (rngPeriod > 0) parts.push(`period=${rngPeriod}`)
          config = { rng0: parts.join(',') }
          break
        }
      }

      await onSave(config)
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Failed to add hardware')
    } finally {
      setSaving(false)
    }
  }

  const renderStorageSelect = (value: string, onChange: (v: string) => void, label = 'Storage') => (
    <FormControl fullWidth size="small">
      <InputLabel>{label}</InputLabel>
      <Select value={value} onChange={e => onChange(e.target.value as string)} label={label}>
        {storagesLoading ? (
          <MenuItem disabled><CircularProgress size={16} sx={{ mr: 1 }} /> Loading...</MenuItem>
        ) : storages.length === 0 ? (
          <MenuItem disabled>No storage available</MenuItem>
        ) : (
          storages.map(s => (
            <MenuItem key={s.storage} value={s.storage}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 2 }}>
                <span>{s.storage}</span>
                <Typography variant="caption" sx={{ opacity: 0.6 }}>
                  {s.type} {s.total ? `• ${formatBytes(s.total)}` : ''}
                </Typography>
              </Box>
            </MenuItem>
          ))
        )}
      </Select>
    </FormControl>
  )

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <AppDialogTitle onClose={onClose} icon={<i className="ri-cpu-line" style={{ fontSize: 22 }} />}>
        {t('inventory.addHardware')}
      </AppDialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

          <FormControl fullWidth size="small">
            <InputLabel>{t('common.type')}</InputLabel>
            <Select value={hwType} onChange={e => setHwType(e.target.value as HardwareType)} label={t('common.type')}>
              <MenuItem value="usb">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className="ri-usb-line" style={{ fontSize: 18 }} />{' '}
                  USB Device
                </Box>
              </MenuItem>
              <MenuItem value="pci">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className="ri-cpu-line" style={{ fontSize: 18 }} />{' '}
                  PCI Device
                </Box>
              </MenuItem>
              <MenuItem value="serial">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className="ri-terminal-line" style={{ fontSize: 18 }} />{' '}
                  Serial Port
                </Box>
              </MenuItem>
              <MenuItem value="cloudinit" disabled={hasCloudInit}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className="ri-cloud-line" style={{ fontSize: 18 }} />
                  CloudInit Drive {hasCloudInit && '(already exists)'}
                </Box>
              </MenuItem>
              <MenuItem value="audio" disabled={hasAudio}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className="ri-volume-up-line" style={{ fontSize: 18 }} />
                  Audio Device {hasAudio && '(already exists)'}
                </Box>
              </MenuItem>
              <MenuItem value="rng" disabled={hasRng}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className="ri-shuffle-line" style={{ fontSize: 18 }} />
                  VirtIO RNG {hasRng && '(already exists)'}
                </Box>
              </MenuItem>
            </Select>
          </FormControl>

          {/* USB config */}
          {hwType === 'usb' && (
            <Stack spacing={2}>
              <FormControl fullWidth size="small">
                <InputLabel>USB Type</InputLabel>
                <Select value={usbType} onChange={e => setUsbType(e.target.value as any)} label="USB Type">
                  <MenuItem value="spice">SPICE USB Redirection</MenuItem>
                  <MenuItem value="device">Host USB Device</MenuItem>
                </Select>
              </FormControl>
              {usbType === 'device' && (
                devicesLoading ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CircularProgress size={16} /> Loading USB devices...
                  </Box>
                ) : usbDevices.length > 0 ? (
                  <FormControl fullWidth size="small">
                    <InputLabel>Device</InputLabel>
                    <Select value={usbDeviceId} onChange={e => setUsbDeviceId(e.target.value)} label="Device">
                      {usbDevices.map((d: any) => (
                        <MenuItem key={d.devnum || d.busnum + d.devnum} value={`${d.vendid}:${d.prodid}`}>
                          {d.product || d.manufacturer || `${d.vendid}:${d.prodid}`}
                          {d.serial && ` (${d.serial})`}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                ) : (
                  <TextField
                    fullWidth
                    size="small"
                    label="Device ID (vendor:product)"
                    value={usbDeviceId}
                    onChange={e => setUsbDeviceId(e.target.value)}
                    placeholder="1234:5678"
                    helperText="Enter vendor:product ID (e.g. 046d:c52b)"
                  />
                )
              )}
              <FormControlLabel
                control={<Checkbox checked={usbUsb3} onChange={e => setUsbUsb3(e.target.checked)} />}
                label="USB 3.0 (xHCI)"
              />
            </Stack>
          )}

          {/* PCI config */}
          {hwType === 'pci' && (
            <Stack spacing={2}>
              {devicesLoading ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CircularProgress size={16} /> Loading PCI devices...
                </Box>
              ) : pciDevices.length > 0 ? (
                <FormControl fullWidth size="small">
                  <InputLabel>PCI Device</InputLabel>
                  <Select value={pciDeviceId} onChange={e => setPciDeviceId(e.target.value)} label="PCI Device">
                    {pciDevices.map((d: any) => (
                      <MenuItem key={d.id} value={d.id}>
                        <Box>
                          <Typography variant="body2">{d.device_name || d.id}</Typography>
                          {d.vendor_name && (
                            <Typography variant="caption" sx={{ opacity: 0.6 }}>{d.vendor_name}</Typography>
                          )}
                        </Box>
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              ) : (
                <TextField
                  fullWidth
                  size="small"
                  label="PCI Device ID"
                  value={pciDeviceId}
                  onChange={e => setPciDeviceId(e.target.value)}
                  placeholder="0000:00:02.0"
                  helperText="Enter the PCI address (e.g. 0000:00:02.0)"
                />
              )}
              <FormControlLabel
                control={<Checkbox checked={pciPcie} onChange={e => setPciPcie(e.target.checked)} />}
                label="PCI Express"
              />
              <FormControlLabel
                control={<Checkbox checked={pciRombar} onChange={e => setPciRombar(e.target.checked)} />}
                label="ROM-Bar"
              />
              <FormControlLabel
                control={<Checkbox checked={pciPrimaryGpu} onChange={e => setPciPrimaryGpu(e.target.checked)} />}
                label="Primary GPU"
              />
              <Alert severity="warning" sx={{ fontSize: 13 }}>
                PCI passthrough requires IOMMU enabled on the host. The VM must be stopped to add PCI devices.
              </Alert>
            </Stack>
          )}

          {/* Serial port config */}
          {hwType === 'serial' && (
            <Stack spacing={2}>
              <TextField
                fullWidth
                size="small"
                label="Serial Port Path"
                value={serialPath}
                onChange={e => setSerialPath(e.target.value)}
                helperText="Use 'socket' for a Unix socket or a device path like /dev/ttyS0"
              />
            </Stack>
          )}

          {/* CloudInit drive config */}
          {hwType === 'cloudinit' && (
            <Stack spacing={2}>
              {renderStorageSelect(ciStorage, setCiStorage)}
              <FormControl fullWidth size="small">
                <InputLabel>Bus</InputLabel>
                <Select value={ciBus} onChange={e => setCiBus(e.target.value as any)} label="Bus">
                  <MenuItem value="ide">IDE (ide2 - default)</MenuItem>
                  <MenuItem value="scsi">SCSI</MenuItem>
                  <MenuItem value="sata">SATA</MenuItem>
                </Select>
              </FormControl>
              <Alert severity="info" sx={{ fontSize: 13 }}>
                CloudInit drive is used to pass user-data, network config, and SSH keys to the VM at boot.
              </Alert>
            </Stack>
          )}

          {/* Audio device config */}
          {hwType === 'audio' && (
            <Stack spacing={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Audio Device</InputLabel>
                <Select value={audioDevice} onChange={e => setAudioDevice(e.target.value)} label="Audio Device">
                  <MenuItem value="intel-hda">Intel HDA (ich9-intel-hda)</MenuItem>
                  <MenuItem value="AC97">AC97</MenuItem>
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel>Audio Driver</InputLabel>
                <Select value={audioDriver} onChange={e => setAudioDriver(e.target.value)} label="Audio Driver">
                  <MenuItem value="spice">SPICE</MenuItem>
                  <MenuItem value="none">None</MenuItem>
                </Select>
              </FormControl>
              <Alert severity="info" sx={{ fontSize: 13 }}>
                Audio device allows sound output via SPICE console. Requires SPICE display.
              </Alert>
            </Stack>
          )}

          {/* VirtIO RNG config */}
          {hwType === 'rng' && (
            <Stack spacing={2}>
              <TextField
                fullWidth
                size="small"
                label="Entropy Source"
                value={rngSource}
                onChange={e => setRngSource(e.target.value)}
                helperText="/dev/urandom (default) or /dev/random (blocking)"
              />
              <TextField
                fullWidth
                size="small"
                label="Max Bytes per Period"
                type="number"
                value={rngMaxBytes}
                onChange={e => setRngMaxBytes(Number(e.target.value))}
                helperText="Maximum bytes of entropy injected per period (0 = unlimited)"
              />
              <TextField
                fullWidth
                size="small"
                label="Period (ms)"
                type="number"
                value={rngPeriod}
                onChange={e => setRngPeriod(Number(e.target.value))}
                helperText="Time interval in milliseconds for rate-limiting entropy"
              />
              <Alert severity="info" sx={{ fontSize: 13 }}>
                VirtIO RNG provides hardware random number generation to the guest. Recommended for cryptographic operations.
              </Alert>
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={16} /> : undefined}
        >
          {t('common.add')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
