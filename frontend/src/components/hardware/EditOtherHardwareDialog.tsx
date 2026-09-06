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
import NumericTextField from '@/components/ui/NumericTextField'
import { humanizePveError } from '@/app/(dashboard)/infrastructure/inventory/helpers'

import { parsePropertyString, isRawPassthrough, usbMappingValue, pciMappingValue, type MappingKind } from './utils'
import { ResourceMappingSelect, useResourceMappings } from './ResourceMappingSelect'

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

export function EditOtherHardwareDialog({
  open, onClose, onSave, onDelete, connId, node, hardware,
}: EditOtherHardwareDialogProps) {
  const t = useTranslations()
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // USB
  const [usbType, setUsbType] = useState<'spice' | 'mapped'>('spice')
  const [usbMappingId, setUsbMappingId] = useState('')
  const [usbUsb3, setUsbUsb3] = useState(false)

  // PCI
  const [pciMappingId, setPciMappingId] = useState('')
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

  // A device given by its real hardware address: PVE only lets root@pam with a
  // password login edit or remove it, which an API token never is (#852).
  const passthroughKind: MappingKind | null =
    hardware && (hardware.type === 'usb' || hardware.type === 'pci') ? hardware.type : null
  const locked = !!hardware && !!passthroughKind && isRawPassthrough(passthroughKind, hardware.rawValue)

  // Datacenter resource mappings a mapped USB/PCI device can be switched to.
  // Nothing is fetched for a locked device; a SPICE USB item only needs the
  // list once switched to a mapped device.
  const { mappings, loading: mappingsLoading, error: mappingsError } = useResourceMappings(
    connId, node, passthroughKind, open && !locked && (passthroughKind === 'pci' || usbType === 'mapped'),
  )

  // Populate state from the raw config value when the dialog opens
  useEffect(() => {
    if (!open || !hardware) return
    setError(null)
    setSaving(false)
    setDeleting(false)
    setConfirmDelete(false)

    const { head, params } = parsePropertyString(hardware.rawValue)

    switch (hardware.type) {
      case 'usb': {
        if (params['mapping']) {
          setUsbType('mapped')
          setUsbMappingId(params['mapping'])
        } else {
          setUsbType('spice')
          setUsbMappingId('')
        }
        setUsbUsb3(params['usb3'] === '1')
        break
      }
      case 'pci': {
        setPciMappingId(params['mapping'] || '')
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

  if (!hardware) return null

  const buildValue = (): string => {
    switch (hardware.type) {
      case 'usb': {
        if (usbType === 'spice') return `spice${usbUsb3 ? ',usb3=1' : ''}`
        if (!usbMappingId) throw new Error(t('hardware.mappingRequired'))
        return usbMappingValue(usbMappingId, usbUsb3)
      }
      case 'pci': {
        if (!pciMappingId) throw new Error(t('hardware.mappingRequired'))
        return pciMappingValue(pciMappingId, { pcie: pciPcie, rombar: pciRombar, primaryGpu: pciPrimaryGpu })
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
      const message = humanizePveError(e) || t('errors.updateError')
      setError(/only root/i.test(message) ? `${message} ${t('hardware.rootOnlyErrorHint')}` : message)
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
      const message = humanizePveError(e) || t('errors.deleteError')
      setError(/only root/i.test(message) ? `${message} ${t('hardware.rootOnlyErrorHint')}` : message)
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

            {locked && (
              <Stack spacing={2}>
                <Alert severity="warning" sx={{ fontSize: 13 }}>{t('hardware.rawPassthroughLocked')}</Alert>
                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{hardware.rawValue}</Typography>
              </Stack>
            )}

            {hardware.type === 'usb' && !locked && (
              <Stack spacing={2}>
                <FormControl fullWidth size="small">
                  <InputLabel>{t('hardware.usbType')}</InputLabel>
                  <Select value={usbType} onChange={e => setUsbType(e.target.value as 'spice' | 'mapped')} label={t('hardware.usbType')}>
                    <MenuItem value="spice">{t('hardware.usbSpice')}</MenuItem>
                    <MenuItem value="mapped">{t('hardware.usbMappedDevice')}</MenuItem>
                    <MenuItem value="device" disabled>{t('hardware.usbHostDeviceRootOnly')}</MenuItem>
                  </Select>
                </FormControl>
                {usbType === 'mapped' && (
                  <ResourceMappingSelect
                    kind="usb" node={node} value={usbMappingId} onChange={setUsbMappingId} keepCurrent
                    mappings={mappings} loading={mappingsLoading} error={mappingsError}
                  />
                )}
                <FormControlLabel
                  control={<Checkbox checked={usbUsb3} onChange={e => setUsbUsb3(e.target.checked)} />}
                  label={t('hardware.usb3')}
                />
              </Stack>
            )}

            {hardware.type === 'pci' && !locked && (
              <Stack spacing={2}>
                <FormControl fullWidth size="small">
                  <InputLabel>{t('hardware.pciSource')}</InputLabel>
                  <Select value="mapped" label={t('hardware.pciSource')}>
                    <MenuItem value="mapped">{t('hardware.pciMappedDevice')}</MenuItem>
                    <MenuItem value="raw" disabled>{t('hardware.pciRawDeviceRootOnly')}</MenuItem>
                  </Select>
                </FormControl>
                <ResourceMappingSelect
                  kind="pci" node={node} value={pciMappingId} onChange={setPciMappingId} keepCurrent
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
                <NumericTextField
                  fullWidth
                  size="small"
                  label={t('hardware.rngMaxBytes')}
                  type="number"
                  value={rngMaxBytes}
                  onChange={setRngMaxBytes}
                  fallback={0}
                  helperText={t('hardware.rngMaxBytesHelper')}
                />
                <NumericTextField
                  fullWidth
                  size="small"
                  label={t('hardware.rngPeriod')}
                  type="number"
                  value={rngPeriod}
                  onChange={setRngPeriod}
                  fallback={0}
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
            disabled={saving || deleting || locked}
            startIcon={<i className="ri-delete-bin-line" />}
          >
            {t('common.delete')}
          </Button>
          <Box>
            <Button onClick={onClose} disabled={saving || deleting} sx={{ mr: 1 }}>{t('common.cancel')}</Button>
            <Button
              variant="contained"
              onClick={handleSave}
              disabled={saving || deleting || locked}
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
