'use client'

import React, { useState, useEffect, useMemo } from 'react'
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
  Chip,
  Radio,
  RadioGroup,
} from '@mui/material'

import { formatBytes } from '@/utils/format'
import AppDialogTitle from '@/components/ui/AppDialogTitle'

// Storage types that support multiple disk image formats (file-based storages)
// Block-based storages (lvm, lvmthin, rbd, zfspool, iscsi, iscsidirect) only support raw
const FILE_BASED_STORAGE_TYPES = new Set(['dir', 'nfs', 'cifs', 'smb', 'glusterfs', 'cephfs', 'btrfs'])

function getSupportedFormats(storageType: string): string[] {
  if (FILE_BASED_STORAGE_TYPES.has(storageType)) {
    return ['raw', 'qcow2', 'vmdk']
  }

  // Block-based storage: only raw
  return ['raw']
}

// ==================== EDIT DISK DIALOG ====================
type EditDiskDialogProps = {
  open: boolean
  onClose: () => void
  onSave: (config: any) => Promise<void>
  onDelete: () => Promise<void>
  onResize?: (newSize: string) => Promise<void>
  onMoveStorage?: (targetStorage: string, deleteSource: boolean, format?: string) => Promise<void>
  connId?: string
  node?: string
  disk: {
    id: string
    size: string
    storage: string
    format?: string
    cache?: string
    iothread?: boolean
    discard?: boolean
    ssd?: boolean
    backup?: boolean
    replicate?: boolean
    aio?: string
    ro?: boolean
    mbps_rd?: number
    mbps_wr?: number
    iops_rd?: number
    iops_wr?: number
    isCdrom?: boolean
    isUnused?: boolean
    rawValue?: string
  } | null
  existingDisks?: string[]
  availableStorages?: Array<{ storage: string; type: string; avail?: number; total?: number }>
}

export function EditDiskDialog({ open, onClose, onSave, onDelete, onResize, onMoveStorage, connId, node, disk, existingDisks, availableStorages }: EditDiskDialogProps) {
  const t = useTranslations()
  const [tab, setTab] = useState(0)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [resizing, setResizing] = useState(false)
  const [moving, setMoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Resize state
  const [newSize, setNewSize] = useState('')
  const [sizeUnit, setSizeUnit] = useState<'G' | 'T'>('G')

  // Move storage state
  const [targetStorage, setTargetStorage] = useState('')
  const [deleteSource, setDeleteSource] = useState(true)
  const [targetFormat, setTargetFormat] = useState('')
  const [storages, setStorages] = useState<Array<{ storage: string; type: string; avail?: number; total?: number }>>([])
  const [storagesLoading, setStoragesLoading] = useState(false)

  // Disk config (éditable)
  const [cache, setCache] = useState('none')
  const [discard, setDiscard] = useState(false)
  const [iothread, setIothread] = useState(false)
  const [ssdEmulation, setSsdEmulation] = useState(false)
  const [backup, setBackup] = useState(true)
  const [skipReplication, setSkipReplication] = useState(false)
  const [asyncIo, setAsyncIo] = useState('io_uring')
  const [readOnly, setReadOnly] = useState(false)

  // Bandwidth limits
  const [mbpsRd, setMbpsRd] = useState('')
  const [mbpsWr, setMbpsWr] = useState('')
  const [iopsRd, setIopsRd] = useState('')
  const [iopsWr, setIopsWr] = useState('')

  // Compute supported formats for the selected target storage
  const selectedTargetStorageObj = useMemo(
    () => storages.find(s => s.storage === targetStorage),
    [storages, targetStorage]
  )
  const supportedFormats = useMemo(
    () => selectedTargetStorageObj ? getSupportedFormats(selectedTargetStorageObj.type) : ['raw', 'qcow2', 'vmdk'],
    [selectedTargetStorageObj]
  )
  const supportsMultipleFormats = supportedFormats.length > 1

  // Reset format when target storage changes and current format is not supported
  useEffect(() => {
    if (targetFormat && !supportedFormats.includes(targetFormat)) {
      setTargetFormat('')
    }
  }, [targetStorage, supportedFormats, targetFormat])

  // CDROM state
  const [cdromMode, setCdromMode] = useState<'iso' | 'physical' | 'none'>('none')
  const [isoStorage, setIsoStorage] = useState('')
  const [isoImage, setIsoImage] = useState('')
  const [isoStorages, setIsoStorages] = useState<Array<{ storage: string; type: string }>>([])
  const [isoImages, setIsoImages] = useState<string[]>([])
  const [isoLoading, setIsoLoading] = useState(false)
  const [cdromSaving, setCdromSaving] = useState(false)

  // Unused disk reassign state
  const [reassignBus, setReassignBus] = useState<'scsi' | 'virtio' | 'sata' | 'ide'>('scsi')
  const [reassignIndex, setReassignIndex] = useState(0)
  const [reassigning, setReassigning] = useState(false)

  // Charger les valeurs du disque
  useEffect(() => {
    if (open && disk) {
      // CDROM-specific init
      if (disk.isCdrom) {
        const raw = disk.rawValue || ''
        if (raw === 'cdrom') {
          // Physical CD/DVD drive
          setCdromMode('physical')
          setIsoStorage('')
          setIsoImage('')
        } else if (disk.storage === 'none' || raw === 'none,media=cdrom') {
          setCdromMode('none')
          setIsoStorage('')
          setIsoImage('')
        } else if (raw.includes('media=cdrom') && disk.storage && disk.storage !== 'none') {
          setCdromMode('iso')
          setIsoStorage(disk.storage)
          // Extract ISO filename from raw value like "local:iso/debian.iso,media=cdrom"
          const isoMatch = raw.match(/^[^:]+:iso\/(.+?)(?:,|$)/)
          setIsoImage(isoMatch ? isoMatch[1] : '')
        } else {
          setCdromMode('none')
          setIsoStorage('')
          setIsoImage('')
        }
      }

      setCache(disk.cache || 'none')
      setDiscard(disk.discard || false)
      setIothread(disk.iothread || false)
      setSsdEmulation(disk.ssd || false)
      setBackup(disk.backup !== false)
      setSkipReplication(disk.replicate === false)
      setAsyncIo(disk.aio || 'io_uring')
      setReadOnly(disk.ro || false)
      setMbpsRd(disk.mbps_rd ? String(disk.mbps_rd) : '')
      setMbpsWr(disk.mbps_wr ? String(disk.mbps_wr) : '')
      setIopsRd(disk.iops_rd ? String(disk.iops_rd) : '')
      setIopsWr(disk.iops_wr ? String(disk.iops_wr) : '')

      // Initialiser la taille pour le resize
      const sizeMatch = disk.size.match(/(\d+(?:\.\d+)?)\s*(G|T|M)?/i)

      if (sizeMatch) {
        const value = Number.parseFloat(sizeMatch[1])
        const unit = (sizeMatch[2] || 'G').toUpperCase()

        if (unit === 'T') {
          setNewSize(String(value))
          setSizeUnit('T')
        } else if (unit === 'M') {
          setNewSize(String(Math.ceil(value / 1024)))
          setSizeUnit('G')
        } else {
          setNewSize(String(value))
          setSizeUnit('G')
        }
      }

      // Réinitialiser le move storage
      setTargetStorage('')
      setDeleteSource(true)
      setTargetFormat('')
      setError(null)
      setTab(0)
    }
  }, [open, disk])

  // Load ISO storages for CDROM
  useEffect(() => {
    if (!open || !disk?.isCdrom || !connId || !node) return
    const loadIsoStorages = async () => {
      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/storages?content=iso`)
        if (res.ok) {
          const json = await res.json()
          setIsoStorages((json.data || []).filter((s: any) => s.content?.includes('iso')))
        }
      } catch {}
    }
    loadIsoStorages()
  }, [open, disk?.isCdrom, connId, node])

  // Load ISO images for selected storage
  useEffect(() => {
    if (!open || !disk?.isCdrom || !connId || !node || !isoStorage) {
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
            // volid looks like "local:iso/debian.iso" — extract filename
            const m = i.volid?.match(/iso\/(.+)$/)
            return m ? m[1] : i.volid || ''
          }).filter(Boolean))
        }
      } catch {}
      finally { setIsoLoading(false) }
    }
    loadIsos()
  }, [open, disk?.isCdrom, connId, node, isoStorage])

  // Charger les storages disponibles
  useEffect(() => {
    if (open && connId && node && !availableStorages) {
      const loadStorages = async () => {
        setStoragesLoading(true)

        try {
          const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/storages?content=images`)

          if (res.ok) {
            const json = await res.json()

            setStorages(json.data || [])
          }
        } catch (e) {
          console.error('Error loading storages:', e)
        } finally {
          setStoragesLoading(false)
        }
      }

      loadStorages()
    } else if (availableStorages) {
      setStorages(availableStorages)
    }
  }, [open, connId, node, availableStorages])

  // Calculer la taille actuelle en GB pour la comparaison
  const currentSizeGB = useMemo(() => {
    if (!disk?.size) return 0
    const sizeMatch = disk.size.match(/(\d+(?:\.\d+)?)\s*(G|T|M)?/i)

    if (!sizeMatch) return 0
    const value = Number.parseFloat(sizeMatch[1])
    const unit = (sizeMatch[2] || 'G').toUpperCase()

    if (unit === 'T') return value * 1024
    if (unit === 'M') return value / 1024

return value
  }, [disk?.size])

  // Calculer la nouvelle taille en GB
  const newSizeGB = useMemo(() => {
    const value = Number.parseFloat(newSize) || 0


return sizeUnit === 'T' ? value * 1024 : value
  }, [newSize, sizeUnit])

  const handleResize = async () => {
    if (!disk || !onResize) return

    if (newSizeGB <= currentSizeGB) {
      setError(t('common.error'))

return
    }

    setResizing(true)
    setError(null)

    try {
      await onResize(`+${(newSizeGB - currentSizeGB).toFixed(0)}G`)
      onClose()
    } catch (e: any) {
      setError(e.message || t('errors.updateError'))
    } finally {
      setResizing(false)
    }
  }

  const handleMoveStorage = async () => {
    if (!disk || !onMoveStorage || !targetStorage) return

    if (targetStorage === disk.storage) {
      setError(t('common.select'))

return
    }

    setMoving(true)
    setError(null)

    try {
      await onMoveStorage(targetStorage, deleteSource, targetFormat || undefined)
      onClose()
    } catch (e: any) {
      setError(e.message || t('errors.moveError'))
    } finally {
      setMoving(false)
    }
  }

  const handleSave = async () => {
    if (!disk) return

    setSaving(true)
    setError(null)

    try {
      // Extract the volume part (storage:image) and size from rawValue
      // rawValue looks like "local-lvm:vm-102-disk-0,size=32G,cache=writeback,..."
      const raw = disk.rawValue || ''
      const rawParts = raw.split(',')
      // Keep volume (first part) and size
      const baseParts: string[] = [rawParts[0]]
      const sizeParam = rawParts.find(p => p.startsWith('size='))
      if (sizeParam) baseParts.push(sizeParam)

      // Build new options
      if (cache !== 'none') baseParts.push(`cache=${cache}`)
      if (discard) baseParts.push('discard=on')
      if (iothread) baseParts.push('iothread=1')
      if (ssdEmulation) baseParts.push('ssd=1')
      if (!backup) baseParts.push('backup=0')
      if (skipReplication) baseParts.push('replicate=0')
      if (asyncIo !== 'io_uring') baseParts.push(`aio=${asyncIo}`)
      if (readOnly) baseParts.push('ro=1')
      if (mbpsRd) baseParts.push(`mbps_rd=${mbpsRd}`)
      if (mbpsWr) baseParts.push(`mbps_wr=${mbpsWr}`)
      if (iopsRd) baseParts.push(`iops_rd=${iopsRd}`)
      if (iopsWr) baseParts.push(`iops_wr=${iopsWr}`)

      await onSave(baseParts.join(','))
      onClose()
    } catch (e: any) {
      setError(e.message || t('errors.updateError'))
    } finally {
      setSaving(false)
    }
  }

  const handleCdromSave = async () => {
    if (!disk) return
    setCdromSaving(true)
    setError(null)
    try {
      let value: string
      if (cdromMode === 'iso' && isoStorage && isoImage) {
        value = `${isoStorage}:iso/${isoImage},media=cdrom`
      } else if (cdromMode === 'physical') {
        value = 'cdrom'
      } else {
        value = 'none,media=cdrom'
      }
      await onSave(value)
      onClose()
    } catch (e: any) {
      setError(e.message || 'Error')
    } finally {
      setCdromSaving(false)
    }
  }

  // Auto-calculate next free index for reassign bus
  useEffect(() => {
    if (!open || !disk?.isUnused || !existingDisks) return
    const prefix = reassignBus === 'virtio' ? 'virtio' : reassignBus
    const usedIndexes = existingDisks
      .filter(d => d.startsWith(prefix))
      .map(d => { const m = d.match(/(\d+)$/); return m ? Number.parseInt(m[1]) : -1 })
      .filter(i => i >= 0)
    let next = 0
    while (usedIndexes.includes(next)) next++
    setReassignIndex(next)
  }, [open, disk?.isUnused, existingDisks, reassignBus])

  const handleReassign = async () => {
    if (!disk) return
    setReassigning(true)
    setError(null)
    try {
      const targetId = reassignBus === 'virtio' ? `virtio${reassignIndex}` : `${reassignBus}${reassignIndex}`
      // Send the volume ID as the value for the target bus slot
      await onSave({ [targetId]: disk.rawValue, delete: disk.id })
      onClose()
    } catch (e: any) {
      setError(e.message || 'Error')
    } finally {
      setReassigning(false)
    }
  }

  const handleDelete = async () => {
    if (!disk) return
    if (!confirm(t('hardware.confirmDeleteDisk', { id: disk.id }))) return

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

  if (!disk) return null

  const isWorking = saving || deleting || resizing || moving || cdromSaving || reassigning

  // ── CDROM Dialog ──────────────────────────────────────────
  if (disk.isCdrom) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <AppDialogTitle onClose={onClose} icon={<i className="ri-disc-line" style={{ fontSize: 24 }} />}>
          {disk.id} (CD/DVD)
        </AppDialogTitle>

        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

          <RadioGroup value={cdromMode} onChange={(e) => setCdromMode(e.target.value as any)}>
            {/* Option 1: ISO image */}
            <FormControlLabel value="iso" control={<Radio />} label={
              <Typography variant="body2" fontWeight={500}>
                {t('hardware.cdrom.useIso')}
              </Typography>
            } />
            {cdromMode === 'iso' && (
              <Box sx={{ pl: 4, pb: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Storage</InputLabel>
                  <Select value={isoStorage} onChange={(e) => { setIsoStorage(e.target.value); setIsoImage('') }} label="Storage">
                    {isoStorages.map(s => (
                      <MenuItem key={s.storage} value={s.storage}>
                        {s.storage} <Typography component="span" variant="caption" sx={{ ml: 1, opacity: 0.6 }}>({s.type})</Typography>
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl fullWidth size="small">
                  <InputLabel>ISO Image</InputLabel>
                  <Select
                    value={isoImage}
                    onChange={(e) => setIsoImage(e.target.value)}
                    label="ISO Image"
                    disabled={!isoStorage || isoLoading}
                  >
                    {isoLoading ? (
                      <MenuItem disabled><CircularProgress size={16} sx={{ mr: 1 }} /> {t('common.loading')}</MenuItem>
                    ) : isoImages.map(iso => (
                      <MenuItem key={iso} value={iso}>{iso}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
            )}

            {/* Option 2: Physical drive */}
            <FormControlLabel value="physical" control={<Radio />} label={
              <Typography variant="body2" fontWeight={500}>
                {t('hardware.cdrom.usePhysical')}
              </Typography>
            } />

            {/* Option 3: No media */}
            <FormControlLabel value="none" control={<Radio />} label={
              <Typography variant="body2" fontWeight={500}>
                {t('hardware.cdrom.noMedia')}
              </Typography>
            } />
          </RadioGroup>
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
          <Button
            color="error"
            onClick={handleDelete}
            disabled={isWorking}
            startIcon={deleting ? <CircularProgress size={16} /> : <i className="ri-delete-bin-line" />}
          >
            {t('common.delete')}
          </Button>
          <Box>
            <Button onClick={onClose} disabled={isWorking} sx={{ mr: 1 }}>{t('common.cancel')}</Button>
            <Button
              variant="contained"
              onClick={handleCdromSave}
              disabled={isWorking || (cdromMode === 'iso' && (!isoStorage || !isoImage))}
            >
              {cdromSaving ? <CircularProgress size={20} /> : t('common.save')}
            </Button>
          </Box>
        </DialogActions>
      </Dialog>
    )
  }

  // ── Unused disk Dialog ───────────────────────────────────
  if (disk.isUnused) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
        <AppDialogTitle onClose={onClose} icon={<i className="ri-hard-drive-2-line" style={{ fontSize: 24, color: 'var(--mui-palette-warning-main)' }} />}>
          {disk.id} — {t('inventory.unused')}
        </AppDialogTitle>

        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

          <Alert severity="info" sx={{ mb: 2 }} icon={<i className="ri-information-line" />}>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
              {disk.rawValue}
            </Typography>
          </Alert>

          <Typography variant="body2" fontWeight={600} sx={{ mb: 1.5 }}>
            {t('hardware.reassignTo')}
          </Typography>

          <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
            <FormControl fullWidth size="small">
              <InputLabel>Bus/Device</InputLabel>
              <Select value={reassignBus} onChange={(e) => setReassignBus(e.target.value as any)} label="Bus/Device">
                <MenuItem value="scsi">SCSI</MenuItem>
                <MenuItem value="virtio">VirtIO Block</MenuItem>
                <MenuItem value="sata">SATA</MenuItem>
                <MenuItem value="ide">IDE</MenuItem>
              </Select>
            </FormControl>
            <TextField
              size="small"
              type="number"
              value={reassignIndex}
              onChange={(e) => setReassignIndex(Number.parseInt(e.target.value) || 0)}
              sx={{ width: 80 }}
              inputProps={{ min: 0, max: 30 }}
            />
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            → {reassignBus === 'virtio' ? 'virtio' : reassignBus}{reassignIndex}
          </Typography>
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
          <Button
            color="error"
            onClick={handleDelete}
            disabled={isWorking}
            startIcon={deleting ? <CircularProgress size={16} /> : <i className="ri-delete-bin-line" />}
          >
            {t('common.delete')}
          </Button>
          <Box>
            <Button onClick={onClose} disabled={isWorking} sx={{ mr: 1 }}>{t('common.cancel')}</Button>
            <Button
              variant="contained"
              onClick={handleReassign}
              disabled={isWorking}
              startIcon={reassigning ? <CircularProgress size={16} /> : <i className="ri-link" />}
            >
              {t('hardware.reassign')}
            </Button>
          </Box>
        </DialogActions>
      </Dialog>
    )
  }

  // ── Regular disk Dialog ───────────────────────────────────
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <AppDialogTitle onClose={onClose} icon={<i className="ri-hard-drive-2-line" style={{ fontSize: 24 }} />}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{t('common.edit')}: {disk.id}</span>
          <Typography variant="caption" sx={{ opacity: 0.7 }}>
            {disk.size} • {disk.storage}
          </Typography>
        </Box>
      </AppDialogTitle>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 3, borderBottom: 1, borderColor: 'divider' }}>
        <Tab label="Options" />
        <Tab label="Bandwidth" />
        {onResize && <Tab label="Resize" icon={<i className="ri-expand-diagonal-line" style={{ fontSize: 16 }} />} iconPosition="start" />}
        {onMoveStorage && <Tab label="Move" icon={<i className="ri-folder-transfer-line" style={{ fontSize: 16 }} />} iconPosition="start" />}
      </Tabs>

      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {tab === 0 && (
          <Stack spacing={2} sx={{ mt: 1 }}>
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

            {/* Checkboxes */}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
              <FormControlLabel
                control={<Checkbox checked={discard} onChange={(e) => setDiscard(e.target.checked)} size="small" />}
                label="Discard"
              />
              <FormControlLabel
                control={<Checkbox checked={iothread} onChange={(e) => setIothread(e.target.checked)} size="small" />}
                label="IO thread"
              />
              <FormControlLabel
                control={<Checkbox checked={ssdEmulation} onChange={(e) => setSsdEmulation(e.target.checked)} size="small" />}
                label="SSD emulation"
              />
              <FormControlLabel
                control={<Checkbox checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} size="small" />}
                label="Read-only"
              />
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
            <Typography variant="body2" sx={{ opacity: 0.7 }}>
              {t('hardware.bandwidthLimits')}
            </Typography>

            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <TextField
                size="small"
                label="Read limit (MB/s)"
                type="number"
                value={mbpsRd}
                onChange={(e) => setMbpsRd(e.target.value)}
              />
              <TextField
                size="small"
                label="Write limit (MB/s)"
                type="number"
                value={mbpsWr}
                onChange={(e) => setMbpsWr(e.target.value)}
              />
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <TextField
                size="small"
                label="Read limit (IOPS)"
                type="number"
                value={iopsRd}
                onChange={(e) => setIopsRd(e.target.value)}
              />
              <TextField
                size="small"
                label="Write limit (IOPS)"
                type="number"
                value={iopsWr}
                onChange={(e) => setIopsWr(e.target.value)}
              />
            </Box>
          </Stack>
        )}

        {/* Tab Resize */}
        {tab === 2 && onResize && (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="info" icon={<i className="ri-information-line" />}>
              {t.rich('hardware.resizeInfo', { size: disk.size, strong: (chunks) => <strong>{chunks}</strong> })}
            </Alert>

            <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
              <TextField
                fullWidth
                size="small"
                label={t('hardware.newSize')}
                type="number"
                value={newSize}
                onChange={(e) => setNewSize(e.target.value)}
                inputProps={{ min: currentSizeGB, step: 1 }}
                helperText={newSizeGB > currentSizeGB ? t('hardware.sizeIncrease', { size: (newSizeGB - currentSizeGB).toFixed(0) }) : t('hardware.enterLargerSize')}
                error={newSizeGB > 0 && newSizeGB <= currentSizeGB}
              />
              <FormControl size="small" sx={{ minWidth: 80 }}>
                <InputLabel>{t('hardware.unit')}</InputLabel>
                <Select value={sizeUnit} onChange={(e) => setSizeUnit(e.target.value as 'G' | 'T')} label={t('hardware.unit')}>
                  <MenuItem value="G">GB</MenuItem>
                  <MenuItem value="T">TB</MenuItem>
                </Select>
              </FormControl>
            </Box>

            <Button
              variant="contained"
              color="primary"
              onClick={handleResize}
              disabled={isWorking || newSizeGB <= currentSizeGB}
              startIcon={resizing ? <CircularProgress size={16} /> : <i className="ri-expand-diagonal-line" />}
              fullWidth
            >
              {resizing ? t('hardware.resizing') : t('hardware.resizeTo', { size: newSize, unit: sizeUnit })}
            </Button>
          </Stack>
        )}

        {/* Tab Move Storage */}
        {tab === 3 && onMoveStorage && (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="info" icon={<i className="ri-information-line" />}>
              {t.rich('hardware.moveDiskTo', { storage: disk.storage, strong: (chunks) => <strong>{chunks}</strong> })}
            </Alert>

            {storagesLoading ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 2 }}>
                <CircularProgress size={20} />
                <Typography variant="body2" color="text.secondary">{t('common.loading')}</Typography>
              </Box>
            ) : (
              <>
                <FormControl fullWidth size="small">
                  <InputLabel>{t('inventory.targetStorage')}</InputLabel>
                  <Select
                    value={targetStorage}
                    onChange={(e) => setTargetStorage(e.target.value)}
                    label={t('inventory.targetStorage')}
                  >
                    {storages
                      .filter(s => s.storage !== disk.storage)
                      .map(s => (
                        <MenuItem key={s.storage} value={s.storage}>
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <i className="ri-hard-drive-2-line" style={{ fontSize: 16, opacity: 0.7 }} />
                              <span>{s.storage}</span>
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Chip label={s.type} size="small" variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} />
                              {s.avail !== undefined && (
                                <Typography variant="caption" color="text.secondary">
                                  {formatBytes(s.avail)} free
                                </Typography>
                              )}
                            </Box>
                          </Box>
                        </MenuItem>
                      ))}
                  </Select>
                </FormControl>

                <FormControl fullWidth size="small" disabled={!supportsMultipleFormats}>
                  <InputLabel>{t('hardware.formatOptional')}</InputLabel>
                  <Select
                    value={supportsMultipleFormats ? targetFormat : 'raw'}
                    onChange={(e) => setTargetFormat(e.target.value)}
                    label={t('hardware.formatOptional')}
                  >
                    {supportsMultipleFormats && (
                      <MenuItem value="">{t('hardware.keepCurrentFormat')}</MenuItem>
                    )}
                    {supportedFormats.map(fmt => (
                      <MenuItem key={fmt} value={fmt}>{fmt === 'raw' ? 'Raw disk image (raw)' : fmt === 'qcow2' ? 'QCOW2 (qcow2)' : 'VMware (vmdk)'}</MenuItem>
                    ))}
                  </Select>
                  {!supportsMultipleFormats && selectedTargetStorageObj && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                      {t('hardware.storageOnlyRaw', { type: selectedTargetStorageObj.type })}
                    </Typography>
                  )}
                </FormControl>

                <FormControlLabel
                  control={
                    <Checkbox
                      checked={deleteSource}
                      onChange={(e) => setDeleteSource(e.target.checked)}
                      size="small"
                    />
                  }
                  label={
                    <Typography variant="body2">
                      {t('hardware.deleteSourceDisk')}
                    </Typography>
                  }
                />

                <Button
                  variant="contained"
                  color="primary"
                  onClick={handleMoveStorage}
                  disabled={isWorking || !targetStorage || targetStorage === disk.storage}
                  startIcon={moving ? <CircularProgress size={16} /> : <i className="ri-folder-transfer-line" />}
                  fullWidth
                >
                  {moving ? t('hardware.moving') : t('hardware.moveTo', { storage: targetStorage || '...' })}
                </Button>
              </>
            )}
          </Stack>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
        <Button
          color="error"
          onClick={handleDelete}
          disabled={isWorking}
          startIcon={deleting ? <CircularProgress size={16} /> : <i className="ri-delete-bin-line" />}
        >
          {t('common.delete')}
        </Button>
        <Box>
          <Button onClick={onClose} disabled={isWorking} sx={{ mr: 1 }}>{t('common.cancel')}</Button>
          {tab < 2 && (
            <Button variant="contained" onClick={handleSave} disabled={isWorking}>
              {saving ? <CircularProgress size={20} /> : t('common.save')}
            </Button>
          )}
        </Box>
      </DialogActions>
    </Dialog>
  )
}
