'use client'

import React, { useState, useEffect, useMemo } from 'react'
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
  Chip,
} from '@mui/material'

import { formatBytes } from '@/utils/format'

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
  } | null
  availableStorages?: Array<{ storage: string; type: string; avail?: number; total?: number }>
}

export function EditDiskDialog({ open, onClose, onSave, onDelete, onResize, onMoveStorage, connId, node, disk, availableStorages }: EditDiskDialogProps) {
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

  // Charger les valeurs du disque
  useEffect(() => {
    if (open && disk) {
      setCache(disk.cache || 'none')
      setDiscard(disk.discard || false)
      setIothread(disk.iothread || false)
      setSsdEmulation(disk.ssd || false)
      setBackup(disk.backup !== false)
      setSkipReplication(disk.replicate === false)
      setAsyncIo(disk.aio || 'io_uring')
      setReadOnly(disk.ro || false)

      // Initialiser la taille pour le resize
      const sizeMatch = disk.size.match(/(\d+(?:\.\d+)?)\s*(G|T|M)?/i)

      if (sizeMatch) {
        const value = parseFloat(sizeMatch[1])
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
    const value = parseFloat(sizeMatch[1])
    const unit = (sizeMatch[2] || 'G').toUpperCase()

    if (unit === 'T') return value * 1024
    if (unit === 'M') return value / 1024

return value
  }, [disk?.size])

  // Calculer la nouvelle taille en GB
  const newSizeGB = useMemo(() => {
    const value = parseFloat(newSize) || 0


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
      const options: string[] = []

      if (cache !== 'none') options.push(`cache=${cache}`)
      if (discard) options.push('discard=on')
      if (iothread) options.push('iothread=1')
      if (ssdEmulation) options.push('ssd=1')
      if (!backup) options.push('backup=0')
      if (skipReplication) options.push('replicate=0')
      if (asyncIo !== 'io_uring') options.push(`aio=${asyncIo}`)
      if (readOnly) options.push('ro=1')
      if (mbpsRd) options.push(`mbps_rd=${mbpsRd}`)
      if (mbpsWr) options.push(`mbps_wr=${mbpsWr}`)
      if (iopsRd) options.push(`iops_rd=${iopsRd}`)
      if (iopsWr) options.push(`iops_wr=${iopsWr}`)

      await onSave({ options })
      onClose()
    } catch (e: any) {
      setError(e.message || t('errors.updateError'))
    } finally {
      setSaving(false)
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

  const isWorking = saving || deleting || resizing || moving

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-hard-drive-2-line" style={{ fontSize: 24 }} />
          Modifier: {disk.id}
        </Box>
        <Typography variant="caption" sx={{ opacity: 0.7 }}>
          {disk.size} • {disk.storage}
        </Typography>
      </DialogTitle>

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
              Le redimensionnement ne peut qu'agrandir le disque. Taille actuelle: <strong>{disk.size}</strong>
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
              <span dangerouslySetInnerHTML={{ __html: t('hardware.moveDiskTo', { storage: disk.storage }) }} />
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

                <FormControl fullWidth size="small">
                  <InputLabel>Format (optionnel)</InputLabel>
                  <Select
                    value={targetFormat}
                    onChange={(e) => setTargetFormat(e.target.value)}
                    label="Format (optionnel)"
                  >
                    <MenuItem value="">Conserver le format actuel</MenuItem>
                    <MenuItem value="raw">Raw</MenuItem>
                    <MenuItem value="qcow2">QCOW2</MenuItem>
                    <MenuItem value="vmdk">VMDK</MenuItem>
                  </Select>
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
                      {t('common.delete')}
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
