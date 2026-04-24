'use client'

import React, { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'

import {
  Dialog,
  DialogContent,
  DialogActions,
  DialogTitle,
  DialogContentText,
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

import AppDialogTitle from '@/components/ui/AppDialogTitle'

export type OtherHardwareItem = {
  id: string
  type: 'usb' | 'pci' | 'serial' | 'audio' | 'rng'
  label?: string
  rawValue: string
}

type EditOtherHardwareDialogProps = {
  open: boolean
  onClose: () => void
  onSave: (config: Record<string, string>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  connId: string
  node: string
  hardware: OtherHardwareItem | null
}

function parseKv(raw: string): { head: string; params: Record<string, string> } {
  const parts = String(raw || '').split(',').map(p => p.trim()).filter(Boolean)
  const params: Record<string, string> = {}
  let head = ''
  parts.forEach((p, idx) => {
    const eq = p.indexOf('=')
    if (idx === 0 && eq === -1) {
      head = p
    } else if (eq > -1) {
      params[p.slice(0, eq).trim()] = p.slice(eq + 1).trim()
    } else if (idx === 0) {
      head = p
    } else {
      // bare flag without =
      params[p] = '1'
    }
  })
  return { head, params }
}

export function EditOtherHardwareDialog({
  open, onClose, onSave, onDelete, connId, node, hardware,
}: EditOtherHardwareDialogProps) {
  const t = useTranslations()
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // USB
  const [usbType, setUsbType] = useState<'spice' | 'device'>('spice')
  const [usbDeviceId, setUsbDeviceId] = useState('')
  const [usbUsb3, setUsbUsb3] = useState(false)

  // PCI
  const [pciDeviceId, setPciDeviceId] = useState('')
  const [pciPrimaryGpu, setPciPrimaryGpu] = useState(false)
  const [pciRombar, setPciRombar] = useState(true)
  const [pciPcie, setPciPcie] = useState(true)

  // Serial
  const [serialPath, setSerialPath] = useState('socket')

  // Audio
  const [audioDevice, setAudioDevice] = useState('intel-hda')
  const [audioDriver, setAudioDriver] = useState('spice')

  // RNG
  const [rngSource, setRngSource] = useState('/dev/urandom')
  const [rngMaxBytes, setRngMaxBytes] = useState<number>(1024)
  const [rngPeriod, setRngPeriod] = useState<number>(1000)

  // PCI/USB device lists from host (for dropdown while editing)
  const [pciDevices, setPciDevices] = useState<any[]>([])
  const [usbDevices, setUsbDevices] = useState<any[]>([])
  const [devicesLoading, setDevicesLoading] = useState(false)

  // Populate state from the raw config value when the dialog opens
  useEffect(() => {
    if (!open || !hardware) return
    setError(null)
    setSaving(false)
    setDeleting(false)
    setConfirmDelete(false)

    const { head, params } = parseKv(hardware.rawValue)

    switch (hardware.type) {
      case 'usb': {
        const isSpice = head === 'spice' || params['spice'] === '1'
        setUsbType(isSpice ? 'spice' : 'device')
        setUsbDeviceId(params['host'] || '')
        setUsbUsb3(params['usb3'] === '1')
        break
      }
      case 'pci': {
        setPciDeviceId(head || params['host'] || '')
        setPciPcie(params['pcie'] !== '0')
        setPciRombar(params['rombar'] !== '0')
        setPciPrimaryGpu(params['x-vga'] === '1')
        break
      }
      case 'serial': {
        setSerialPath(head || hardware.rawValue || 'socket')
        break
      }
      case 'audio': {
        setAudioDevice(params['device'] || 'intel-hda')
        setAudioDriver(params['driver'] || 'spice')
        break
      }
      case 'rng': {
        setRngSource(params['source'] || '/dev/urandom')
        setRngMaxBytes(params['max_bytes'] ? Number(params['max_bytes']) : 1024)
        setRngPeriod(params['period'] ? Number(params['period']) : 1000)
        break
      }
    }
  }, [open, hardware])

  // Load host devices for PCI/USB so the user can reassign to a different device
  useEffect(() => {
    if (!open || !hardware || !connId || !node) return
    if (hardware.type !== 'pci' && hardware.type !== 'usb') return

    setDevicesLoading(true)
    const endpoint = hardware.type === 'pci'
      ? `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/hardware/pci`
      : `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/hardware/usb`

    fetch(endpoint)
      .then(r => r.json())
      .then(json => {
        const list = json?.data || json || []
        if (hardware.type === 'pci') setPciDevices(list)
        else setUsbDevices(list)
      })
      .catch(() => {})
      .finally(() => setDevicesLoading(false))
  }, [open, hardware, connId, node])

  if (!hardware) return null

  const buildValue = (): string => {
    switch (hardware.type) {
      case 'usb': {
        if (usbType === 'spice') return `spice${usbUsb3 ? ',usb3=1' : ''}`
        if (!usbDeviceId) throw new Error(t('hardware.usbDeviceRequired'))
        return `host=${usbDeviceId}${usbUsb3 ? ',usb3=1' : ''}`
      }
      case 'pci': {
        if (!pciDeviceId) throw new Error(t('hardware.pciDeviceRequired'))
        const parts = [pciDeviceId]
        if (pciPcie) parts.push('pcie=1')
        if (pciRombar) parts.push('rombar=1')
        if (pciPrimaryGpu) parts.push('x-vga=1')
        return parts.join(',')
      }
      case 'serial': {
        return serialPath || 'socket'
      }
      case 'audio': {
        return `device=${audioDevice},driver=${audioDriver}`
      }
      case 'rng': {
        const parts = [`source=${rngSource}`]
        if (rngMaxBytes > 0) parts.push(`max_bytes=${rngMaxBytes}`)
        if (rngPeriod > 0) parts.push(`period=${rngPeriod}`)
        return parts.join(',')
      }
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const value = buildValue()
      await onSave({ [hardware.id]: value })
      onClose()
    } catch (e: any) {
      setError(e?.message || t('errors.updateError'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    setError(null)
    try {
      await onDelete(hardware.id)
      setConfirmDelete(false)
      onClose()
    } catch (e: any) {
      setError(e?.message || t('errors.deleteError'))
    } finally {
      setDeleting(false)
    }
  }

  const iconMap: Record<OtherHardwareItem['type'], string> = {
    usb: 'ri-usb-line',
    pci: 'ri-cpu-line',
    serial: 'ri-terminal-line',
    audio: 'ri-volume-up-line',
    rng: 'ri-shuffle-line',
  }

  return (
    <>
      <Dialog open={open} onClose={saving || deleting ? undefined : onClose} maxWidth="sm" fullWidth>
        <AppDialogTitle onClose={onClose} icon={<i className={iconMap[hardware.type]} style={{ fontSize: 22 }} />}>
          {t('common.edit')}: {hardware.id}
        </AppDialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

            {hardware.type === 'usb' && (
              <Stack spacing={2}>
                <FormControl fullWidth size="small">
                  <InputLabel>{t('hardware.usbType')}</InputLabel>
                  <Select value={usbType} onChange={e => setUsbType(e.target.value as any)} label={t('hardware.usbType')}>
                    <MenuItem value="spice">{t('hardware.usbSpice')}</MenuItem>
                    <MenuItem value="device">{t('hardware.usbHostDevice')}</MenuItem>
                  </Select>
                </FormControl>
                {usbType === 'device' && (
                  devicesLoading ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <CircularProgress size={16} /> {t('hardware.loadingUsbDevices')}
                    </Box>
                  ) : usbDevices.length > 0 ? (
                    <FormControl fullWidth size="small">
                      <InputLabel>{t('hardware.device')}</InputLabel>
                      <Select value={usbDeviceId} onChange={e => setUsbDeviceId(e.target.value)} label={t('hardware.device')}>
                        {usbDevices.map((d: any) => (
                          <MenuItem key={`${d.busnum}-${d.devnum}-${d.vendid}-${d.prodid}`} value={`${d.vendid}:${d.prodid}`}>
                            {d.product || d.manufacturer || `${d.vendid}:${d.prodid}`}
                            {d.serial && ` (${d.serial})`}
                          </MenuItem>
                        ))}
                        {usbDeviceId && !usbDevices.some((d: any) => `${d.vendid}:${d.prodid}` === usbDeviceId) && (
                          <MenuItem value={usbDeviceId}>{usbDeviceId} ({t('hardware.currentValue')})</MenuItem>
                        )}
                      </Select>
                    </FormControl>
                  ) : (
                    <TextField
                      fullWidth
                      size="small"
                      label={t('hardware.usbDeviceIdLabel')}
                      value={usbDeviceId}
                      onChange={e => setUsbDeviceId(e.target.value)}
                      placeholder="1234:5678"
                      helperText={t('hardware.usbDeviceIdHelper')}
                    />
                  )
                )}
                <FormControlLabel
                  control={<Checkbox checked={usbUsb3} onChange={e => setUsbUsb3(e.target.checked)} />}
                  label={t('hardware.usb3')}
                />
              </Stack>
            )}

            {hardware.type === 'pci' && (
              <Stack spacing={2}>
                {devicesLoading ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CircularProgress size={16} /> {t('hardware.loadingPciDevices')}
                  </Box>
                ) : pciDevices.length > 0 ? (
                  <FormControl fullWidth size="small">
                    <InputLabel>{t('hardware.pciDevice')}</InputLabel>
                    <Select value={pciDeviceId} onChange={e => setPciDeviceId(e.target.value)} label={t('hardware.pciDevice')}>
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
                      {pciDeviceId && !pciDevices.some((d: any) => d.id === pciDeviceId) && (
                        <MenuItem value={pciDeviceId}>{pciDeviceId} ({t('hardware.currentValue')})</MenuItem>
                      )}
                    </Select>
                  </FormControl>
                ) : (
                  <TextField
                    fullWidth
                    size="small"
                    label={t('hardware.pciDeviceIdLabel')}
                    value={pciDeviceId}
                    onChange={e => setPciDeviceId(e.target.value)}
                    placeholder="0000:00:02.0"
                    helperText={t('hardware.pciDeviceIdHelper')}
                  />
                )}
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
                <Alert severity="warning" sx={{ fontSize: 13 }}>
                  {t('hardware.pciPassthroughWarning')}
                </Alert>
              </Stack>
            )}

            {hardware.type === 'serial' && (
              <Stack spacing={2}>
                <TextField
                  fullWidth
                  size="small"
                  label={t('hardware.serialPath')}
                  value={serialPath}
                  onChange={e => setSerialPath(e.target.value)}
                  helperText={t('hardware.serialPathHelper')}
                />
              </Stack>
            )}

            {hardware.type === 'audio' && (
              <Stack spacing={2}>
                <FormControl fullWidth size="small">
                  <InputLabel>{t('hardware.audioDevice')}</InputLabel>
                  <Select value={audioDevice} onChange={e => setAudioDevice(e.target.value)} label={t('hardware.audioDevice')}>
                    <MenuItem value="intel-hda">Intel HDA (ich9-intel-hda)</MenuItem>
                    <MenuItem value="AC97">AC97</MenuItem>
                  </Select>
                </FormControl>
                <FormControl fullWidth size="small">
                  <InputLabel>{t('hardware.audioDriver')}</InputLabel>
                  <Select value={audioDriver} onChange={e => setAudioDriver(e.target.value)} label={t('hardware.audioDriver')}>
                    <MenuItem value="spice">SPICE</MenuItem>
                    <MenuItem value="none">None</MenuItem>
                  </Select>
                </FormControl>
              </Stack>
            )}

            {hardware.type === 'rng' && (
              <Stack spacing={2}>
                <TextField
                  fullWidth
                  size="small"
                  label={t('hardware.rngSource')}
                  value={rngSource}
                  onChange={e => setRngSource(e.target.value)}
                  helperText={t('hardware.rngSourceHelper')}
                />
                <TextField
                  fullWidth
                  size="small"
                  label={t('hardware.rngMaxBytes')}
                  type="number"
                  value={rngMaxBytes}
                  onChange={e => setRngMaxBytes(Number(e.target.value))}
                  helperText={t('hardware.rngMaxBytesHelper')}
                />
                <TextField
                  fullWidth
                  size="small"
                  label={t('hardware.rngPeriod')}
                  type="number"
                  value={rngPeriod}
                  onChange={e => setRngPeriod(Number(e.target.value))}
                  helperText={t('hardware.rngPeriodHelper')}
                />
              </Stack>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
          <Button
            color="error"
            onClick={() => setConfirmDelete(true)}
            disabled={saving || deleting}
            startIcon={<i className="ri-delete-bin-line" />}
          >
            {t('common.delete')}
          </Button>
          <Box>
            <Button onClick={onClose} disabled={saving || deleting} sx={{ mr: 1 }}>{t('common.cancel')}</Button>
            <Button
              variant="contained"
              onClick={handleSave}
              disabled={saving || deleting}
              startIcon={saving ? <CircularProgress size={16} /> : undefined}
            >
              {t('common.save')}
            </Button>
          </Box>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmDelete} onClose={() => !deleting && setConfirmDelete(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('hardware.confirmRemoveHardwareTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('hardware.confirmDeleteHardware', { id: hardware.id })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)} disabled={deleting}>{t('common.cancel')}</Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleDelete}
            disabled={deleting}
            startIcon={deleting ? <CircularProgress size={16} /> : <i className="ri-delete-bin-line" />}
          >
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
