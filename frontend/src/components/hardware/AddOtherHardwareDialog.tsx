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
import { humanizePveError } from '@/app/(dashboard)/infrastructure/inventory/helpers'
import AppDialogTitle from '@/components/ui/AppDialogTitle'
import NumericTextField from '@/components/ui/NumericTextField'
import { pciMappingValue, usbMappingValue } from './utils'
import type { Storage } from './utils'
import { ResourceMappingSelect, useResourceMappings } from './ResourceMappingSelect'

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

  // USB. A raw host device (host=vendor:product) is root@pam only in PVE and
  // an API token never is, so the only real device offered is a mapped one (#852).
  const [usbType, setUsbType] = useState<'spice' | 'mapped'>('spice')
  const [usbMappingId, setUsbMappingId] = useState('')
  const [usbUsb3, setUsbUsb3] = useState(true)

  // PCI. Same rule: a raw PCI address is refused through a token, hence the
  // single "mapped" source (#852).
  const [pciSource, setPciSource] = useState<'mapped'>('mapped')
  const [pciMappingId, setPciMappingId] = useState('')
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

  // Datacenter resource mappings of the selected kind, checked against the
  // node, fetched only while a mapped USB device or a PCI device is being added.
  const mappingKind = hwType === 'usb' || hwType === 'pci' ? hwType : null
  const { mappings, loading: mappingsLoading, error: mappingsError } = useResourceMappings(
    connId, node, mappingKind, open && ((hwType === 'usb' && usbType === 'mapped') || hwType === 'pci'),
  )

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

  // A USB mapping is useless for a PCI device and vice versa: drop the
  // selection whenever the hardware type changes.
  useEffect(() => {
    setUsbMappingId('')
    setPciMappingId('')
  }, [hwType])

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
            if (!usbMappingId) throw new Error(t('hardware.mappingRequired'))
            config = { [`usb${idx}`]: usbMappingValue(usbMappingId, usbUsb3) }
          }
          break
        }
        case 'pci': {
          const idx = nextIndex('hostpci', 15)
          if (idx < 0) throw new Error('Maximum PCI devices reached (16)')
          if (!pciMappingId) throw new Error(t('hardware.mappingRequired'))
          config = {
            [`hostpci${idx}`]: pciMappingValue(pciMappingId, { pcie: pciPcie, rombar: pciRombar, primaryGpu: pciPrimaryGpu }),
          }
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
      const message = humanizePveError(e) || 'Failed to add hardware'
      setError(/only root/i.test(message) ? `${message} ${t('hardware.rootOnlyErrorHint')}` : message)
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
                <InputLabel>{t('hardware.usbType')}</InputLabel>
                <Select value={usbType} onChange={e => setUsbType(e.target.value as 'spice' | 'mapped')} label={t('hardware.usbType')}>
                  <MenuItem value="spice">{t('hardware.usbSpice')}</MenuItem>
                  <MenuItem value="mapped">{t('hardware.usbMappedDevice')}</MenuItem>
                  <MenuItem value="device" disabled>{t('hardware.usbHostDeviceRootOnly')}</MenuItem>
                </Select>
              </FormControl>
              <Alert severity="info" sx={{ fontSize: 13 }}>{t('hardware.rawPassthroughHint')}</Alert>
              {usbType === 'mapped' && (
                <ResourceMappingSelect
                  kind="usb" node={node} value={usbMappingId} onChange={setUsbMappingId}
                  mappings={mappings} loading={mappingsLoading} error={mappingsError}
                />
              )}
              <FormControlLabel
                control={<Checkbox checked={usbUsb3} onChange={e => setUsbUsb3(e.target.checked)} />}
                label={t('hardware.usb3')}
              />
            </Stack>
          )}

          {/* PCI config */}
          {hwType === 'pci' && (
            <Stack spacing={2}>
              <FormControl fullWidth size="small">
                <InputLabel>{t('hardware.pciSource')}</InputLabel>
                <Select value={pciSource} onChange={e => setPciSource(e.target.value as 'mapped')} label={t('hardware.pciSource')}>
                  <MenuItem value="mapped">{t('hardware.pciMappedDevice')}</MenuItem>
                  <MenuItem value="raw" disabled>{t('hardware.pciRawDeviceRootOnly')}</MenuItem>
                </Select>
              </FormControl>
              <ResourceMappingSelect
                kind="pci" node={node} value={pciMappingId} onChange={setPciMappingId}
                mappings={mappings} loading={mappingsLoading} error={mappingsError}
              />
              <FormControlLabel
                control={<Checkbox checked={pciPcie} onChange={e => setPciPcie(e.target.checked)} />}
                label={t('hardware.pcie')}
              />
              <FormControlLabel
                control={<Checkbox checked={pciRombar} onChange={e => setPciRombar(e.target.checked)} />}
                label={t('hardware.romBar')}
              />
              <FormControlLabel
                control={<Checkbox checked={pciPrimaryGpu} onChange={e => setPciPrimaryGpu(e.target.checked)} />}
                label={t('hardware.primaryGpu')}
              />
              <Alert severity="warning" sx={{ fontSize: 13 }}>{t('hardware.pciPassthroughWarning')}</Alert>
              <Alert severity="info" sx={{ fontSize: 13 }}>{t('hardware.rawPassthroughHint')}</Alert>
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
              <NumericTextField
                fullWidth
                size="small"
                label="Max Bytes per Period"
                type="number"
                value={rngMaxBytes}
                onChange={setRngMaxBytes}
                fallback={0}
                helperText="Maximum bytes of entropy injected per period (0 = unlimited)"
              />
              <NumericTextField
                fullWidth
                size="small"
                label="Period (ms)"
                type="number"
                value={rngPeriod}
                onChange={setRngPeriod}
                fallback={0}
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
