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
  Box,
  Typography,
  Stack,
  Alert,
  CircularProgress,
  Tabs,
  Tab,
  Radio,
  RadioGroup,
} from '@mui/material'

import { formatBytes } from '@/utils/format'
import AppDialogTitle from '@/components/ui/AppDialogTitle'
import type { Storage } from './utils'

// ==================== ADD DISK DIALOG ====================
type AddDiskDialogProps = {
  open: boolean
  onClose: () => void
  onSave: (config: any) => Promise<void>
  connId: string
  node: string
  vmid: string
  existingDisks: string[]  // Pour déterminer le prochain index disponible
}

export function AddDiskDialog({ open, onClose, onSave, connId, node, vmid, existingDisks }: AddDiskDialogProps) {
  const t = useTranslations()
  const [tab, setTab] = useState(0)  // 0 = Disk, 1 = Bandwidth
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Storages disponibles
  const [storages, setStorages] = useState<Storage[]>([])
  const [storagesLoading, setStoragesLoading] = useState(false)

  // Disk config
  const [busType, setBusType] = useState<'scsi' | 'virtio' | 'sata' | 'ide'>('scsi')
  const [deviceType, setDeviceType] = useState<'disk' | 'cdrom' | 'efi' | 'tpm'>('disk')

  // EFI Disk
  const [efiPreEnrolledKeys, setEfiPreEnrolledKeys] = useState(true)

  // TPM
  const [tpmVersion, setTpmVersion] = useState('v2.0')
  const [busIndex, setBusIndex] = useState(0)
  const [storage, setStorage] = useState('')
  const [diskSize, setDiskSize] = useState(32)
  const [format, setFormat] = useState('raw')

  // CDROM state
  const [cdromMode, setCdromMode] = useState<'iso' | 'physical' | 'none'>('none')
  const [isoStorage, setIsoStorage] = useState('')
  const [isoImage, setIsoImage] = useState('')
  const [isoStorages, setIsoStorages] = useState<Array<{ storage: string; type: string }>>([])
  const [isoImages, setIsoImages] = useState<string[]>([])
  const [isoLoading, setIsoLoading] = useState(false)
  const [cache, setCache] = useState('none')
  const [discard, setDiscard] = useState(false)
  const [iothread, setIothread] = useState(false)
  const [ssdEmulation, setSsdEmulation] = useState(false)
  const [backup, setBackup] = useState(true)
  const [skipReplication, setSkipReplication] = useState(false)
  const [asyncIo, setAsyncIo] = useState('io_uring')
  const [readOnly, setReadOnly] = useState(false)

  // SCSI Controller (pour scsi)
  const [scsiController, setScsiController] = useState('virtio-scsi-single')

  // Bandwidth limits
  const [mbpsRd, setMbpsRd] = useState('')
  const [mbpsWr, setMbpsWr] = useState('')
  const [iopsRd, setIopsRd] = useState('')
  const [iopsWr, setIopsWr] = useState('')

  // Reset device type when bus changes
  useEffect(() => {
    if (busType !== 'ide' && busType !== 'sata') setDeviceType('disk')
  }, [busType])

  // Charger les storages
  useEffect(() => {
    if (!open || !connId || !node) return

    const loadStorages = async () => {
      setStoragesLoading(true)

      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/storages`)
        const json = await res.json()

        if (json.data) {
          // Filtrer les storages qui supportent les images disques
          const diskStorages = json.data.filter((s: Storage) =>
            s.content?.includes('images') || s.type === 'zfspool' || s.type === 'lvmthin' || s.type === 'lvm' || s.type === 'dir' || s.type === 'nfs' || s.type === 'cifs'
          )

          setStorages(diskStorages)

          if (diskStorages.length > 0 && !storage) {
            setStorage(diskStorages[0].storage)
          }

          // Also load ISO storages
          const isoStores = json.data.filter((s: Storage) => s.content?.includes('iso'))
          setIsoStorages(isoStores)
        }
      } catch (e) {
        console.error('Error loading storages:', e)
      } finally {
        setStoragesLoading(false)
      }
    }

    loadStorages()
  }, [open, connId, node])

  // Load ISO images for selected ISO storage
  useEffect(() => {
    if (!open || !connId || !node || !isoStorage || deviceType !== 'cdrom') {
      setIsoImages([])
      return
    }
    const loadIsos = async () => {
      setIsoLoading(true)
      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(isoStorage)}/content?content=iso`)
        if (res.ok) {
          const json = await res.json()
          setIsoImages((json.data || []).map((i: any) => {
            const m = i.volid?.match(/iso\/(.+)$/)
            return m ? m[1] : i.volid || ''
          }).filter(Boolean))
        }
      } catch {}
      finally { setIsoLoading(false) }
    }
    loadIsos()
  }, [open, connId, node, isoStorage, deviceType])

  // Calculer le prochain index disponible
  useEffect(() => {
    if (!open) return

    const prefix = busType === 'virtio' ? 'virtio' : busType

    const usedIndexes = existingDisks
      .filter(d => d.startsWith(prefix))
      .map(d => {
        const match = d.match(/(\d+)$/)


return match ? parseInt(match[1]) : -1
      })
      .filter(i => i >= 0)

    let nextIndex = 0

    while (usedIndexes.includes(nextIndex)) {
      nextIndex++
    }

    setBusIndex(nextIndex)
  }, [open, busType, existingDisks])

  const handleSave = async () => {
    setSaving(true)
    setError(null)

    try {
      // EFI Disk
      if (deviceType === 'efi') {
        if (!storage) { setError('Please select a storage'); setSaving(false); return }
        const parts = [`${storage}:1`]
        if (efiPreEnrolledKeys) parts.push('pre-enrolled-keys=1')
        parts.push('efitype=4m', 'size=128K')
        await onSave({ efidisk0: parts.join(',') })
        onClose()
        return
      }

      // TPM State
      if (deviceType === 'tpm') {
        if (!storage) { setError('Please select a storage'); setSaving(false); return }
        await onSave({ tpmstate0: `${storage}:1,version=${tpmVersion}` })
        onClose()
        return
      }

      const diskId = busType === 'virtio' ? `virtio${busIndex}` : `${busType}${busIndex}`

      // CDROM device
      if (deviceType === 'cdrom') {
        let value: string
        if (cdromMode === 'iso' && isoStorage && isoImage) {
          value = `${isoStorage}:iso/${isoImage},media=cdrom`
        } else if (cdromMode === 'physical') {
          value = 'cdrom'
        } else {
          value = 'none,media=cdrom'
        }
        await onSave({ [diskId]: value })
        onClose()
        return
      }

      // Regular disk
      if (!storage) {
        setError(t('common.select') + ' storage')
        setSaving(false)
        return
      }

      const diskConfig: any = {
        [diskId]: `${storage}:${diskSize}`,
      }

      // Options supplémentaires
      const options: string[] = []

      if (format !== 'raw') options.push(`format=${format}`)
      if (cache !== 'none') options.push(`cache=${cache}`)
      if (discard) options.push('discard=on')
      if (iothread && busType === 'scsi') options.push('iothread=1')
      if (ssdEmulation) options.push('ssd=1')
      if (!backup) options.push('backup=0')
      if (skipReplication) options.push('replicate=0')
      if (asyncIo !== 'io_uring') options.push(`aio=${asyncIo}`)
      if (readOnly) options.push('ro=1')

      // Bandwidth limits
      if (mbpsRd) options.push(`mbps_rd=${mbpsRd}`)
      if (mbpsWr) options.push(`mbps_wr=${mbpsWr}`)
      if (iopsRd) options.push(`iops_rd=${iopsRd}`)
      if (iopsWr) options.push(`iops_wr=${iopsWr}`)

      if (options.length > 0) {
        diskConfig[diskId] += `,${options.join(',')}`
      }

      await onSave(diskConfig)
      onClose()
    } catch (e: any) {
      setError(e.message || t('errors.addError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <AppDialogTitle onClose={onClose} icon={<i className={deviceType === 'cdrom' ? "ri-disc-line" : deviceType === 'efi' ? "ri-shield-keyhole-line" : deviceType === 'tpm' ? "ri-key-2-line" : "ri-hard-drive-2-line"} style={{ fontSize: 24 }} />}>
        {deviceType === 'cdrom' ? 'CD/DVD Drive' : deviceType === 'efi' ? 'EFI Disk' : deviceType === 'tpm' ? 'TPM State' : t('inventory.disks')}
      </AppDialogTitle>

      {deviceType === 'disk' && (
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 3, borderBottom: 1, borderColor: 'divider' }}>
          <Tab label="Disk" />
          <Tab label="Bandwidth" />
        </Tabs>
      )}

      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {(tab === 0 || deviceType === 'cdrom' || deviceType === 'efi' || deviceType === 'tpm') && (
          <Stack spacing={2} sx={{ mt: 1 }}>
            {/* Device Type selector */}
            <FormControl fullWidth size="small">
              <InputLabel>{t('common.type')}</InputLabel>
              <Select value={deviceType} onChange={(e) => setDeviceType(e.target.value as any)} label={t('common.type')}>
                <MenuItem value="disk">
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <i className="ri-hard-drive-2-line" style={{ fontSize: 18 }} /> Hard Disk
                  </Box>
                </MenuItem>
                <MenuItem value="cdrom">
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <i className="ri-disc-line" style={{ fontSize: 18 }} /> CD/DVD
                  </Box>
                </MenuItem>
                <MenuItem value="efi" disabled={existingDisks.some(d => d.startsWith('efidisk'))}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <i className="ri-shield-keyhole-line" style={{ fontSize: 18 }} /> EFI Disk {existingDisks.some(d => d.startsWith('efidisk')) && '(exists)'}
                  </Box>
                </MenuItem>
                <MenuItem value="tpm" disabled={existingDisks.some(d => d.startsWith('tpmstate'))}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <i className="ri-key-2-line" style={{ fontSize: 18 }} /> TPM State {existingDisks.some(d => d.startsWith('tpmstate')) && '(exists)'}
                  </Box>
                </MenuItem>
              </Select>
            </FormControl>

            {/* EFI Disk config */}
            {deviceType === 'efi' && (
              <>
                <FormControl fullWidth size="small">
                  <InputLabel>Storage</InputLabel>
                  <Select value={storage} onChange={(e) => setStorage(e.target.value)} label="Storage" disabled={storagesLoading}>
                    {storages.map((s) => (
                      <MenuItem key={s.storage} value={s.storage}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 2 }}>
                          <span>{s.storage}</span>
                          <Typography variant="caption" sx={{ opacity: 0.7 }}>{s.type} • {formatBytes(s.avail)} free</Typography>
                        </Box>
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControlLabel
                  control={<Checkbox checked={efiPreEnrolledKeys} onChange={(e) => setEfiPreEnrolledKeys(e.target.checked)} />}
                  label="Pre-Enroll Keys (Microsoft & UEFI CA)"
                />
                <Alert severity="info" sx={{ fontSize: 13 }}>
                  EFI disk is required for OVMF (UEFI) firmware. A 4MB disk will be allocated.
                </Alert>
              </>
            )}

            {/* TPM State config */}
            {deviceType === 'tpm' && (
              <>
                <FormControl fullWidth size="small">
                  <InputLabel>Storage</InputLabel>
                  <Select value={storage} onChange={(e) => setStorage(e.target.value)} label="Storage" disabled={storagesLoading}>
                    {storages.map((s) => (
                      <MenuItem key={s.storage} value={s.storage}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 2 }}>
                          <span>{s.storage}</span>
                          <Typography variant="caption" sx={{ opacity: 0.7 }}>{s.type} • {formatBytes(s.avail)} free</Typography>
                        </Box>
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl fullWidth size="small">
                  <InputLabel>TPM Version</InputLabel>
                  <Select value={tpmVersion} onChange={(e) => setTpmVersion(e.target.value)} label="TPM Version">
                    <MenuItem value="v2.0">v2.0 (recommended)</MenuItem>
                    <MenuItem value="v1.2">v1.2</MenuItem>
                  </Select>
                </FormControl>
                <Alert severity="info" sx={{ fontSize: 13 }}>
                  TPM (Trusted Platform Module) is required for Windows 11 and BitLocker.
                </Alert>
              </>
            )}

            {/* Bus/Device + Index (disk & cdrom only) */}
            {(deviceType === 'disk' || deviceType === 'cdrom') && (
            <Box sx={{ display: 'grid', gridTemplateColumns: (busType === 'ide' || busType === 'sata') ? '1fr auto' : '1fr auto', gap: 2 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Bus/Device</InputLabel>
                <Select value={busType} onChange={(e) => setBusType(e.target.value as any)} label="Bus/Device">
                  <MenuItem value="scsi">SCSI</MenuItem>
                  <MenuItem value="virtio">VirtIO Block</MenuItem>
                  <MenuItem value="sata">SATA</MenuItem>
                  <MenuItem value="ide">IDE</MenuItem>
                </Select>
              </FormControl>
              <TextField
                size="small"
                type="number"
                value={busIndex}
                onChange={(e) => setBusIndex(parseInt(e.target.value) || 0)}
                sx={{ width: 80 }}
                inputProps={{ min: 0, max: 30 }}
              />
            </Box>
            )}

            {/* CDROM config */}
            {deviceType === 'cdrom' && (
              <RadioGroup value={cdromMode} onChange={(e) => setCdromMode(e.target.value as any)}>
                <FormControlLabel value="iso" control={<Radio />} label={
                  <Typography variant="body2" fontWeight={500}>{t('hardware.cdrom.useIso')}</Typography>
                } />
                {cdromMode === 'iso' && (
                  <Box sx={{ pl: 4, pb: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Storage</InputLabel>
                      <Select value={isoStorage} onChange={(e) => { setIsoStorage(e.target.value); setIsoImage('') }} label="Storage">
                        {isoStorages.map((s: any) => (
                          <MenuItem key={s.storage} value={s.storage}>
                            {s.storage} <Typography component="span" variant="caption" sx={{ ml: 1, opacity: 0.6 }}>({s.type})</Typography>
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <FormControl fullWidth size="small">
                      <InputLabel>ISO Image</InputLabel>
                      <Select value={isoImage} onChange={(e) => setIsoImage(e.target.value)} label="ISO Image" disabled={!isoStorage || isoLoading}>
                        {isoLoading ? (
                          <MenuItem disabled><CircularProgress size={16} sx={{ mr: 1 }} /> {t('common.loading')}</MenuItem>
                        ) : isoImages.map(iso => (
                          <MenuItem key={iso} value={iso}>{iso}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Box>
                )}
                <FormControlLabel value="physical" control={<Radio />} label={
                  <Typography variant="body2" fontWeight={500}>{t('hardware.cdrom.usePhysical')}</Typography>
                } />
                <FormControlLabel value="none" control={<Radio />} label={
                  <Typography variant="body2" fontWeight={500}>{t('hardware.cdrom.noMedia')}</Typography>
                } />
              </RadioGroup>
            )}

            {/* SCSI Controller (si SCSI) */}
            {deviceType === 'disk' && busType === 'scsi' && (
              <FormControl fullWidth size="small">
                <InputLabel>SCSI Controller</InputLabel>
                <Select value={scsiController} onChange={(e) => setScsiController(e.target.value)} label="SCSI Controller">
                  <MenuItem value="lsi">Default (LSI 53C895A)</MenuItem>
                  <MenuItem value="lsi53c810">LSI 53C810</MenuItem>
                  <MenuItem value="megasas">MegaRAID SAS 8708EM2</MenuItem>
                  <MenuItem value="virtio-scsi-pci">VirtIO SCSI</MenuItem>
                  <MenuItem value="virtio-scsi-single">VirtIO SCSI single</MenuItem>
                  <MenuItem value="pvscsi">VMware PVSCSI</MenuItem>
                </Select>
              </FormControl>
            )}

            {/* Storage (disk only) */}
            {deviceType === 'disk' && <FormControl fullWidth size="small">
              <InputLabel>Storage</InputLabel>
              <Select
                value={storage}
                onChange={(e) => setStorage(e.target.value)}
                label="Storage"
                disabled={storagesLoading}
              >
                {storages.map((s) => (
                  <MenuItem key={s.storage} value={s.storage}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 2 }}>
                      <span>{s.storage}</span>
                      <Typography variant="caption" sx={{ opacity: 0.7 }}>
                        {s.type} • {formatBytes(s.avail)} free / {formatBytes(s.total)}
                      </Typography>
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>}

            {deviceType === 'disk' && <>
            {/* Disk Size & Format */}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <TextField
                size="small"
                label="Disk size (GiB)"
                type="number"
                value={diskSize}
                onChange={(e) => setDiskSize(parseInt(e.target.value) || 1)}
                inputProps={{ min: 1 }}
              />
              <FormControl fullWidth size="small">
                <InputLabel>Format</InputLabel>
                <Select value={format} onChange={(e) => setFormat(e.target.value)} label="Format">
                  <MenuItem value="raw">raw</MenuItem>
                  <MenuItem value="qcow2">qcow2</MenuItem>
                  <MenuItem value="vmdk">vmdk</MenuItem>
                </Select>
              </FormControl>
            </Box>

            {/* Cache & Async IO */}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Cache</InputLabel>
                <Select value={cache} onChange={(e) => setCache(e.target.value)} label="Cache">
                  <MenuItem value="none">Default (No cache)</MenuItem>
                  <MenuItem value="directsync">Direct sync</MenuItem>
                  <MenuItem value="writethrough">Write through</MenuItem>
                  <MenuItem value="writeback">Write back</MenuItem>
                  <MenuItem value="unsafe">Write back (unsafe)</MenuItem>
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel>Async IO</InputLabel>
                <Select value={asyncIo} onChange={(e) => setAsyncIo(e.target.value)} label="Async IO">
                  <MenuItem value="io_uring">Default (io_uring)</MenuItem>
                  <MenuItem value="native">native</MenuItem>
                  <MenuItem value="threads">threads</MenuItem>
                </Select>
              </FormControl>
            </Box>

            {/* Checkboxes row 1 */}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
              <FormControlLabel
                control={<Checkbox checked={discard} onChange={(e) => setDiscard(e.target.checked)} size="small" />}
                label="Discard"
              />
              <FormControlLabel
                control={<Checkbox checked={iothread} onChange={(e) => setIothread(e.target.checked)} size="small" disabled={busType !== 'scsi' && busType !== 'virtio'} />}
                label="IO thread"
              />
            </Box>

            {/* Checkboxes row 2 */}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
              <FormControlLabel
                control={<Checkbox checked={ssdEmulation} onChange={(e) => setSsdEmulation(e.target.checked)} size="small" />}
                label="SSD emulation"
              />
              <FormControlLabel
                control={<Checkbox checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} size="small" />}
                label="Read-only"
              />
            </Box>

            {/* Checkboxes row 3 */}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
              <FormControlLabel
                control={<Checkbox checked={backup} onChange={(e) => setBackup(e.target.checked)} size="small" />}
                label="Backup"
              />
              <FormControlLabel
                control={<Checkbox checked={skipReplication} onChange={(e) => setSkipReplication(e.target.checked)} size="small" />}
                label="Skip replication"
              />
            </Box>
            </>}
          </Stack>
        )}

        {tab === 1 && (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" sx={{ opacity: 0.7, mb: 1 }}>
              {t('hardware.bandwidthLimits')}
            </Typography>

            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <TextField
                size="small"
                label="Read limit (MB/s)"
                type="number"
                value={mbpsRd}
                onChange={(e) => setMbpsRd(e.target.value)}
                inputProps={{ min: 0 }}
              />
              <TextField
                size="small"
                label="Write limit (MB/s)"
                type="number"
                value={mbpsWr}
                onChange={(e) => setMbpsWr(e.target.value)}
                inputProps={{ min: 0 }}
              />
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <TextField
                size="small"
                label="Read limit (IOPS)"
                type="number"
                value={iopsRd}
                onChange={(e) => setIopsRd(e.target.value)}
                inputProps={{ min: 0 }}
              />
              <TextField
                size="small"
                label="Write limit (IOPS)"
                type="number"
                value={iopsWr}
                onChange={(e) => setIopsWr(e.target.value)}
                inputProps={{ min: 0 }}
              />
            </Box>
          </Stack>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving || (deviceType === 'disk' && !storage) || ((deviceType === 'efi' || deviceType === 'tpm') && !storage) || (deviceType === 'cdrom' && cdromMode === 'iso' && (!isoStorage || !isoImage))}>
          {saving ? <CircularProgress size={20} /> : t('common.add')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
