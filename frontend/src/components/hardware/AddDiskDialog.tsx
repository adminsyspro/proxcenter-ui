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
  Tabs,
  Tab,
} from '@mui/material'

import { formatBytes } from '@/utils/format'
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
  const [busIndex, setBusIndex] = useState(0)
  const [storage, setStorage] = useState('')
  const [diskSize, setDiskSize] = useState(32)
  const [format, setFormat] = useState('raw')
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
        }
      } catch (e) {
        console.error('Error loading storages:', e)
      } finally {
        setStoragesLoading(false)
      }
    }

    loadStorages()
  }, [open, connId, node])

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
    if (!storage) {
      setError(t('common.select') + ' storage')

return
    }

    setSaving(true)
    setError(null)

    try {
      const diskId = busType === 'virtio' ? `virtio${busIndex}` : `${busType}${busIndex}`

      // Construire la config du disque
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
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className="ri-hard-drive-2-line" style={{ fontSize: 24 }} />
        Ajouter: Disque dur
      </DialogTitle>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 3, borderBottom: 1, borderColor: 'divider' }}>
        <Tab label="Disk" />
        <Tab label="Bandwidth" />
      </Tabs>

      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {tab === 0 && (
          <Stack spacing={2} sx={{ mt: 1 }}>
            {/* Bus/Device */}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 2 }}>
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

            {/* SCSI Controller (si SCSI) */}
            {busType === 'scsi' && (
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

            {/* Storage */}
            <FormControl fullWidth size="small">
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
                        {s.type} • {formatBytes(s.avail)} libre / {formatBytes(s.total)}
                      </Typography>
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

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
        <Button variant="contained" onClick={handleSave} disabled={saving || !storage}>
          {saving ? <CircularProgress size={20} /> : t('common.add')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
