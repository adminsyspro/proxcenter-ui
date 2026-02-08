'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
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
  Switch,
  Box,
  Typography,
  Stack,
  Alert,
  CircularProgress,
  Tabs,
  Tab,
  IconButton,
  Tooltip,
  Divider,
  Chip,
} from '@mui/material'
import { escapeHtml } from '@/lib/escapeHtml'

// Fonction utilitaire pour formater la taille de stockage
function formatStorageSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes < 1024 * 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  
return `${(bytes / (1024 * 1024 * 1024 * 1024)).toFixed(2)} TB`
}

// Types pour les storages
type Storage = {
  storage: string
  type: string
  avail?: number
  total?: number
  content?: string
}

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
  
  const formatBytes = (bytes?: number) => {
    if (!bytes) return '—'
    const gb = bytes / 1024 / 1024 / 1024

    if (gb >= 1024) return `${(gb / 1024).toFixed(2)} TB`
    
return `${gb.toFixed(2)} GB`
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


// ==================== ADD NETWORK DIALOG ====================
type AddNetworkDialogProps = {
  open: boolean
  onClose: () => void
  onSave: (config: any) => Promise<void>
  connId: string
  node: string
  vmid: string
  existingNets: string[]
}

export function AddNetworkDialog({ open, onClose, onSave, connId, node, vmid, existingNets }: AddNetworkDialogProps) {
  const t = useTranslations()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  
  // Bridges disponibles
  const [bridges, setBridges] = useState<string[]>([])
  const [bridgesLoading, setBridgesLoading] = useState(false)
  
  // Network config
  const [netIndex, setNetIndex] = useState(0)
  const [bridge, setBridge] = useState('vmbr0')
  const [model, setModel] = useState('virtio')
  const [vlanTag, setVlanTag] = useState('')
  const [macAddress, setMacAddress] = useState('')
  const [firewall, setFirewall] = useState(true)
  const [disconnect, setDisconnect] = useState(false)
  const [rateLimit, setRateLimit] = useState('')
  const [mtu, setMtu] = useState('')
  const [multiqueue, setMultiqueue] = useState('')
  
  // Charger les bridges
  useEffect(() => {
    if (!open || !connId || !node) return
    
    const loadBridges = async () => {
      setBridgesLoading(true)

      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/network`)
        const json = await res.json()

        console.log('[AddNetworkDialog] Network response:', json)
        
        if (json.data && Array.isArray(json.data)) {
          const bridgeList = json.data
            .filter((n: any) => n.type === 'bridge')
            .map((n: any) => n.iface)
          
          console.log('[AddNetworkDialog] Bridges found:', bridgeList)
          
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

        
return match ? parseInt(match[1]) : -1
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
      
      // Construire la config réseau
      let netConfig = `${model},bridge=${bridge}`
      
      if (macAddress) netConfig += `,macaddr=${macAddress}`
      if (vlanTag) netConfig += `,tag=${vlanTag}`
      if (firewall) netConfig += ',firewall=1'
      if (disconnect) netConfig += ',link_down=1'
      if (rateLimit) netConfig += `,rate=${rateLimit}`
      if (mtu) netConfig += `,mtu=${mtu}`
      if (multiqueue) netConfig += `,queues=${multiqueue}`
      
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
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className="ri-router-line" style={{ fontSize: 24 }} />
        {t('hardware.addNetworkInterface')}
      </DialogTitle>
      
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        
        <Stack spacing={2} sx={{ mt: 1 }}>
          {/* Bridge & Model */}
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
          
          {/* VLAN & MAC */}
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
              <TextField
                size="small"
                label="Multiqueue"
                value={multiqueue}
                onChange={(e) => setMultiqueue(e.target.value)}
                type="number"
                inputProps={{ min: 0, max: 64 }}
                fullWidth
              />
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


// ==================== EDIT SCSI CONTROLLER DIALOG ====================
type EditScsiControllerDialogProps = {
  open: boolean
  onClose: () => void
  onSave: (controller: string) => Promise<void>
  currentController: string
}

export function EditScsiControllerDialog({ open, onClose, onSave, currentController }: EditScsiControllerDialogProps) {
  const t = useTranslations()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [controller, setController] = useState(currentController || 'virtio-scsi-single')
  
  useEffect(() => {
    if (open) {
      setController(currentController || 'virtio-scsi-single')
    }
  }, [open, currentController])
  
  const handleSave = async () => {
    setSaving(true)
    setError(null)
    
    try {
      await onSave(controller)
      onClose()
    } catch (e: any) {
      setError(e.message || t('errors.updateError'))
    } finally {
      setSaving(false)
    }
  }
  
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className="ri-settings-3-line" style={{ fontSize: 24 }} />
        {t('inventory.editScsiController')}
      </DialogTitle>
      
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        
        <FormControl fullWidth size="small" sx={{ mt: 1 }}>
          <InputLabel>Type</InputLabel>
          <Select value={controller} onChange={(e) => setController(e.target.value)} label="Type">
            <MenuItem value="lsi">Default (LSI 53C895A)</MenuItem>
            <MenuItem value="lsi53c895a">LSI 53C895A</MenuItem>
            <MenuItem value="lsi53c810">LSI 53C810</MenuItem>
            <MenuItem value="megasas">MegaRAID SAS 8708EM2</MenuItem>
            <MenuItem value="virtio-scsi-pci">VirtIO SCSI</MenuItem>
            <MenuItem value="virtio-scsi-single">VirtIO SCSI single</MenuItem>
            <MenuItem value="pvscsi">VMware PVSCSI</MenuItem>
          </Select>
        </FormControl>
      </DialogContent>
      
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? <CircularProgress size={20} /> : t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
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
              <span dangerouslySetInnerHTML={{ __html: t('hardware.moveDiskTo', { storage: escapeHtml(disk.storage) }) }} />
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
                                  {formatStorageSize(s.avail)} free
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


// ==================== EDIT NETWORK DIALOG ====================
type EditNetworkDialogProps = {
  open: boolean
  onClose: () => void
  onSave: (config: any) => Promise<void>
  onDelete: () => Promise<void>
  connId: string
  node: string
  network: {
    id: string
    model: string
    bridge: string
    mac?: string
    vlan?: number
    firewall?: boolean
    linkDown?: boolean
    rate?: number
    mtu?: number
    queues?: number
  } | null
}

export function EditNetworkDialog({ open, onClose, onSave, onDelete, connId, node, network }: EditNetworkDialogProps) {
  const t = useTranslations()
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  
  // Bridges disponibles
  const [bridges, setBridges] = useState<string[]>([])
  
  // Network config
  const [bridge, setBridge] = useState('vmbr0')
  const [model, setModel] = useState('virtio')
  const [vlanTag, setVlanTag] = useState('')
  const [macAddress, setMacAddress] = useState('')
  const [firewall, setFirewall] = useState(true)
  const [disconnect, setDisconnect] = useState(false)
  const [rateLimit, setRateLimit] = useState('')
  const [mtu, setMtu] = useState('')
  const [multiqueue, setMultiqueue] = useState('')
  
  // Charger les bridges et initialiser les valeurs
  useEffect(() => {
    if (!open || !connId || !node) return
    
    const loadBridges = async () => {
      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/network`)
        const json = await res.json()

        if (json.data && Array.isArray(json.data)) {
          const bridgeList = json.data
            .filter((n: any) => n.type === 'bridge')
            .map((n: any) => n.iface)

          setBridges(bridgeList.length > 0 ? bridgeList : ['vmbr0', 'vmbr1'])
        } else {
          setBridges(['vmbr0', 'vmbr1'])
        }
      } catch (e) {
        setBridges(['vmbr0', 'vmbr1'])
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
      setMacAddress(network.mac || '')
      setFirewall(network.firewall !== false)
      setDisconnect(network.linkDown || false)
      setRateLimit(network.rate ? String(network.rate) : '')
      setMtu(network.mtu ? String(network.mtu) : '')
      setMultiqueue(network.queues ? String(network.queues) : '')
    }
  }, [open, network])
  
  const handleSave = async () => {
    if (!network) return
    
    setSaving(true)
    setError(null)
    
    try {
      let netConfig = `${model},bridge=${bridge}`
      
      if (macAddress) netConfig += `,macaddr=${macAddress}`
      if (vlanTag) netConfig += `,tag=${vlanTag}`
      if (firewall) netConfig += ',firewall=1'
      if (disconnect) netConfig += ',link_down=1'
      if (rateLimit) netConfig += `,rate=${rateLimit}`
      if (mtu) netConfig += `,mtu=${mtu}`
      if (multiqueue) netConfig += `,queues=${multiqueue}`
      
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
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-router-line" style={{ fontSize: 24 }} />
          Modifier: {network.id}
        </Box>
      </DialogTitle>
      
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        
        <Stack spacing={2} sx={{ mt: 1 }}>
          {/* Bridge & Model */}
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Bridge</InputLabel>
              <Select value={bridge} onChange={(e) => setBridge(e.target.value)} label="Bridge">
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
          
          {/* VLAN & MAC */}
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField
              size="small"
              label="VLAN Tag"
              placeholder="no VLAN"
              value={vlanTag}
              onChange={(e) => setVlanTag(e.target.value)}
              type="number"
            />
            <TextField
              size="small"
              label="MAC address"
              value={macAddress}
              onChange={(e) => setMacAddress(e.target.value)}
            />
          </Box>
          
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
              <TextField
                size="small"
                label="Multiqueue"
                value={multiqueue}
                onChange={(e) => setMultiqueue(e.target.value)}
                type="number"
                fullWidth
              />
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


// ==================== MIGRATE VM DIALOG ====================
type NodeInfo = {
  node: string
  status: string
  cpu?: number
  maxcpu?: number
  mem?: number
  maxmem?: number
}

type LocalDiskInfo = {
  id: string
  storage: string
  size: number
  format?: string
  isLocal?: boolean  // true si stockage local (commence par "local")
}

type MigrateVmDialogProps = {
  open: boolean
  onClose: () => void
  onMigrate: (targetNode: string, online: boolean, targetStorage?: string, withLocalDisks?: boolean) => Promise<void>
  connId: string
  currentNode: string
  vmName: string
  vmid: string
  vmStatus: string
}

type StorageInfo = {
  storage: string
  type: string
  avail?: number
  total?: number
  shared?: number
  content?: string
}

// Types CPU connus avec leur niveau de compatibilité
const CPU_COMPATIBILITY_LEVELS: Record<string, { level: number; label: string; description: string; color: string }> = {
  'qemu64': { level: 1, label: 'qemu64', description: 'Basic QEMU CPU - Maximum compatibility', color: '#9e9e9e' },
  'kvm64': { level: 2, label: 'kvm64', description: 'Basic KVM CPU', color: '#9e9e9e' },
  'x86-64-v2': { level: 3, label: 'x86-64-v2', description: 'Nehalem+ (2008+)', color: '#4caf50' },
  'x86-64-v2-AES': { level: 4, label: 'x86-64-v2-AES', description: 'Westmere+ with AES (2010+) - Recommended', color: '#4caf50' },
  'x86-64-v3': { level: 5, label: 'x86-64-v3', description: 'Haswell+ (2013+)', color: '#2196f3' },
  'x86-64-v4': { level: 6, label: 'x86-64-v4', description: 'Skylake-X+ with AVX-512 (2017+)', color: '#9c27b0' },
  'host': { level: 99, label: 'host', description: 'Pass-through host CPU - No live migration', color: '#f44336' },
}

// Mapping des modèles CPU physiques vers leur génération approximative
const CPU_MODEL_GENERATIONS: Record<string, string> = {
  // Intel
  'Nehalem': 'x86-64-v2',
  'Westmere': 'x86-64-v2-AES',
  'SandyBridge': 'x86-64-v2-AES',
  'IvyBridge': 'x86-64-v2-AES',
  'Haswell': 'x86-64-v3',
  'Broadwell': 'x86-64-v3',
  'Skylake': 'x86-64-v3',
  'Cascadelake': 'x86-64-v3',
  'Icelake': 'x86-64-v4',
  'Sapphirerapids': 'x86-64-v4',
  // AMD
  'Opteron': 'x86-64-v2',
  'EPYC': 'x86-64-v3',
  'EPYC-Rome': 'x86-64-v3',
  'EPYC-Milan': 'x86-64-v3',
  'EPYC-Genoa': 'x86-64-v4',
}

type NodeCpuInfo = {
  node: string
  cpuModel: string
  cpuFlags?: string[]
  sockets: number
  cores: number
  recommendedCpuType: string
}

export function MigrateVmDialog({ open, onClose, onMigrate, connId, currentNode, vmName, vmid, vmStatus }: MigrateVmDialogProps) {
  const t = useTranslations()
  const [migrating, setMigrating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nodes, setNodes] = useState<NodeInfo[]>([])
  const [nodesLoading, setNodesLoading] = useState(false)
  const [selectedNode, setSelectedNode] = useState<string>('')
  const [onlineMigration, setOnlineMigration] = useState(true)
  const [vmDisks, setVmDisks] = useState<LocalDiskInfo[]>([])  // Tous les disques de la VM
  const [storages, setStorages] = useState<StorageInfo[]>([])
  const [storagesLoading, setStoragesLoading] = useState(false)
  const [selectedStorage, setSelectedStorage] = useState<string>('__current__') // __current__ = garder le layout actuel
  
  // CPU Compatibility states
  const [nodesCpuInfo, setNodesCpuInfo] = useState<Record<string, NodeCpuInfo>>({})
  const [vmCpuType, setVmCpuType] = useState<string>('') // Type CPU configuré dans la VM
  const [cpuInfoLoading, setCpuInfoLoading] = useState(false)
  
  // Calculer les stockages actuels uniques
  const currentStorageNames = useMemo(() => {
    const names = [...new Set(vmDisks.map(d => d.storage))]

    
return names.sort()
  }, [vmDisks])
  
  // Vérifier si la VM a des disques locaux
  const hasLocalDisks = useMemo(() => {
    return vmDisks.some(d => d.isLocal)
  }, [vmDisks])
  
  // Charger les nodes disponibles
  useEffect(() => {
    if (!open || !connId) return
    
    const loadNodes = async () => {
      setNodesLoading(true)
      setError(null)
      
      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes`)
        const json = await res.json()
        
        if (json.data && Array.isArray(json.data)) {
          const availableNodes = json.data
            .filter((n: NodeInfo) => n.node !== currentNode && n.status === 'online')
            .map((n: NodeInfo) => ({
              node: n.node,
              status: n.status,
              cpu: n.cpu,
              maxcpu: n.maxcpu,
              mem: n.mem,
              maxmem: n.maxmem
            }))
          
          setNodes(availableNodes)
          
          if (availableNodes.length > 0) {
            const recommended = getRecommendedNode(availableNodes)

            setSelectedNode(recommended.node)
          }
        }
      } catch (e: any) {
        console.error('Error loading nodes:', e)
        setError('Impossible de charger la liste des nodes')
      } finally {
        setNodesLoading(false)
      }
    }
    
    loadNodes()
  }, [open, connId, currentNode])
  
  // Charger la config VM pour détecter les disques
  useEffect(() => {
    if (!open || !connId || !vmid || !currentNode) return
    
    const loadVmConfig = async () => {
      try {
        // Déterminer le type de VM (on essaie qemu d'abord)
        let vmType = 'qemu'
        let configRes = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/guests/qemu/${encodeURIComponent(currentNode)}/${encodeURIComponent(vmid)}/config`)
        
        if (!configRes.ok) {
          vmType = 'lxc'
          configRes = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/guests/lxc/${encodeURIComponent(currentNode)}/${encodeURIComponent(vmid)}/config`)
        }
        
        if (!configRes.ok) {
          setVmDisks([])
          
return
        }
        
        const configJson = await configRes.json()
        const config = configJson.data || {}
        
        // Chercher TOUS les disques de la VM
        const foundDisks: LocalDiskInfo[] = []
        
        // Patterns pour les disques: scsi0, virtio0, ide0, sata0, efidisk0, tpmstate0 pour QEMU
        // rootfs, mp0, mp1, etc. pour LXC
        const diskPatterns = vmType === 'qemu' 
          ? /^(scsi|virtio|ide|sata|efidisk|tpmstate)\d+$/
          : /^(rootfs|mp\d+)$/
        
        for (const [key, value] of Object.entries(config)) {
          if (diskPatterns.test(key) && typeof value === 'string') {
            // Format: "CephStoragePool:vm-111-disk-0,size=750G" ou "local-lvm:vm-111-disk-0,size=32G"
            const diskStr = value as string
            const storageMatch = diskStr.match(/^([^:]+):/)
            
            if (storageMatch) {
              const storageName = storageMatch[1]
              
              // Extraire la taille
              const sizeMatch = diskStr.match(/size=(\d+(?:\.\d+)?)(G|T|M)?/)
              let sizeGB = 0

              if (sizeMatch) {
                sizeGB = parseFloat(sizeMatch[1])
                if (sizeMatch[2] === 'T') sizeGB *= 1024
                else if (sizeMatch[2] === 'M') sizeGB /= 1024
              }
              
              // Extraire le format
              const formatMatch = diskStr.match(/\.(qcow2|raw|vmdk)/)
              
              // Vérifier si c'est un stockage local
              const isLocal = storageName.startsWith('local')
              
              foundDisks.push({
                id: key,
                storage: storageName,
                size: sizeGB,
                format: formatMatch ? formatMatch[1] : undefined,
                isLocal
              })
            }
          }
        }
        
        setVmDisks(foundDisks)
      } catch (e) {
        console.error('Error loading VM config:', e)
        setVmDisks([])
      }
    }
    
    loadVmConfig()
  }, [open, connId, vmid, currentNode])
  
  // Charger les infos CPU des nodes et le type CPU de la VM
  useEffect(() => {
    if (!open || !connId || !currentNode || !vmid) return
    
    const loadCpuInfo = async () => {
      setCpuInfoLoading(true)
      
      try {
        // 1. Charger le type CPU de la VM
        let vmType = 'qemu'
        let configRes = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/guests/qemu/${encodeURIComponent(currentNode)}/${encodeURIComponent(vmid)}/config`)
        
        if (!configRes.ok) {
          vmType = 'lxc'
          configRes = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/guests/lxc/${encodeURIComponent(currentNode)}/${encodeURIComponent(vmid)}/config`)
        }
        
        if (configRes.ok) {
          const configJson = await configRes.json()
          const config = configJson.data || {}
          
          // Extraire le type CPU - format: "cpu: host" ou "cpu: x86-64-v2-AES,flags=+aes"
          const cpuConfig = config.cpu || ''
          const cpuTypeMatch = cpuConfig.match(/^([^,]+)/)
          if (cpuTypeMatch) {
            setVmCpuType(cpuTypeMatch[1])
          } else if (vmType === 'lxc') {
            // LXC utilise toujours le CPU de l'hôte
            setVmCpuType('host')
          }
        }
        
        // 2. Charger les infos CPU de tous les nodes
        const nodesRes = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes`)
        const nodesJson = await nodesRes.json()
        
        if (nodesJson.data && Array.isArray(nodesJson.data)) {
          const cpuInfoMap: Record<string, NodeCpuInfo> = {}
          
          // Charger le statut de chaque node pour obtenir les infos CPU
          await Promise.all(nodesJson.data.map(async (node: any) => {
            try {
              const statusRes = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node.node)}/status`)
              const statusJson = await statusRes.json()
              
              if (statusJson.data) {
                const cpuInfo = statusJson.data.cpuinfo || {}
                const cpuModel = cpuInfo.model || 'Unknown'
                
                // Déterminer le niveau CPU recommandé basé sur le modèle
                let recommendedCpuType = 'x86-64-v2-AES' // Default safe
                
                for (const [modelKey, cpuType] of Object.entries(CPU_MODEL_GENERATIONS)) {
                  if (cpuModel.toLowerCase().includes(modelKey.toLowerCase())) {
                    recommendedCpuType = cpuType
                    break
                  }
                }
                
                cpuInfoMap[node.node] = {
                  node: node.node,
                  cpuModel,
                  sockets: cpuInfo.sockets || 1,
                  cores: cpuInfo.cores || 1,
                  recommendedCpuType
                }
              }
            } catch (e) {
              console.error(`Error loading CPU info for node ${node.node}:`, e)
            }
          }))
          
          setNodesCpuInfo(cpuInfoMap)
        }
      } catch (e) {
        console.error('Error loading CPU info:', e)
      } finally {
        setCpuInfoLoading(false)
      }
    }
    
    loadCpuInfo()
  }, [open, connId, currentNode, vmid])
  
  // Calculer la compatibilité CPU entre source et cible
  const getCpuCompatibility = useCallback((targetNodeName: string): { compatible: boolean; warning: boolean; message: string; color: string } => {
    if (!vmCpuType || !nodesCpuInfo[currentNode] || !nodesCpuInfo[targetNodeName]) {
      return { compatible: true, warning: false, message: '', color: '' }
    }
    
    const sourceInfo = nodesCpuInfo[currentNode]
    const targetInfo = nodesCpuInfo[targetNodeName]
    
    // Si la VM utilise cpu: host
    if (vmCpuType === 'host') {
      // Vérifier si les CPUs sont identiques (même modèle)
      const sameCpuModel = sourceInfo.cpuModel === targetInfo.cpuModel
      
      if (sameCpuModel) {
        return {
          compatible: true,
          warning: false,
          message: t('hardware.cpuHostIdentical'),
          color: '#4caf50'
        }
      }
      
      // Vérifier si les CPUs sont du même type/famille
      const sameVendor = (sourceInfo.cpuModel.includes('Intel') && targetInfo.cpuModel.includes('Intel')) ||
                        (sourceInfo.cpuModel.includes('AMD') && targetInfo.cpuModel.includes('AMD')) ||
                        (sourceInfo.cpuModel.includes('EPYC') && targetInfo.cpuModel.includes('EPYC'))
      
      if (!sameVendor) {
        return {
          compatible: false,
          warning: true,
          message: t('hardware.cpuHostDifferentVendor'),
          color: '#f44336'
        }
      }
      
      // Même vendeur mais modèle différent - avertissement léger
      return {
        compatible: true,
        warning: true,
        message: t('hardware.cpuHostSimilar'),
        color: '#ff9800'
      }
    }
    
    // Pour les autres types CPU, vérifier les niveaux de compatibilité
    const vmCpuLevel = CPU_COMPATIBILITY_LEVELS[vmCpuType]?.level || 0
    const targetRecommendedLevel = CPU_COMPATIBILITY_LEVELS[targetInfo.recommendedCpuType]?.level || 0
    
    if (vmCpuLevel > targetRecommendedLevel) {
      return {
        compatible: false,
        warning: true,
        message: t('hardware.cpuLevelTooHigh', { vmCpu: vmCpuType, targetMax: targetInfo.recommendedCpuType }),
        color: '#f44336'
      }
    }
    
    return {
      compatible: true,
      warning: false,
      message: t('hardware.cpuCompatible'),
      color: '#4caf50'
    }
  }, [vmCpuType, nodesCpuInfo, currentNode, t])
  
  // Vérifier si tous les nodes ont le même CPU (pour adapter les messages)
  const allNodesSameCpu = useMemo(() => {
    const cpuModels = Object.values(nodesCpuInfo).map(n => n.cpuModel)
    if (cpuModels.length === 0) return false
    return cpuModels.every(m => m === cpuModels[0])
  }, [nodesCpuInfo])
  
  // Charger les storages disponibles sur le node sélectionné
  useEffect(() => {
    if (!open || !connId || !selectedNode) {
      setStorages([])
      
return
    }
    
    const loadStorages = async () => {
      setStoragesLoading(true)
      
      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(selectedNode)}/storages`)
        const json = await res.json()
        
        if (json.data && Array.isArray(json.data)) {
          // Filtrer pour ne garder que les storages qui supportent les images disque (images, rootdir)
          const diskStorages = json.data
            .filter((s: StorageInfo) => {
              const content = s.content || ''

              
return content.includes('images') || content.includes('rootdir')
            })
            .map((s: StorageInfo) => ({
              storage: s.storage,
              type: s.type,
              avail: s.avail,
              total: s.total,
              shared: s.shared,
              content: s.content
            }))
          
          setStorages(diskStorages)
        }
      } catch (e) {
        console.error('Error loading storages:', e)
        setStorages([])
      } finally {
        setStoragesLoading(false)
      }
    }
    
    loadStorages()

    // Reset storage selection when node changes
    setSelectedStorage('__current__')
  }, [open, connId, selectedNode])
  
  const getRecommendedNode = (nodeList: NodeInfo[]): NodeInfo => {
    return nodeList.reduce((best, current) => {
      const bestScore = calculateNodeScore(best)
      const currentScore = calculateNodeScore(current)

      
return currentScore > bestScore ? current : best
    }, nodeList[0])
  }
  
  const calculateNodeScore = (node: NodeInfo): number => {
    const cpuFree = node.maxcpu ? (1 - (node.cpu || 0)) * 100 : 50
    const memFree = node.maxmem && node.mem ? ((node.maxmem - node.mem) / node.maxmem) * 100 : 50

    
return cpuFree * 0.4 + memFree * 0.6
  }
  
  const formatMemory = (bytes?: number): string => {
    if (!bytes) return '—'
    const gb = bytes / 1024 / 1024 / 1024

    
return `${gb.toFixed(1)} GB`
  }
  
  const formatCpu = (cpu?: number): string => {
    if (cpu === undefined) return '—'
    
return `${(cpu * 100).toFixed(0)}%`
  }
  
  const getMemoryPercent = (node: NodeInfo): number => {
    if (!node.maxmem || !node.mem) return 0
    
return (node.mem / node.maxmem) * 100
  }
  
  const getCpuPercent = (node: NodeInfo): number => {
    return (node.cpu || 0) * 100
  }
  
  const isRecommended = (node: NodeInfo): boolean => {
    if (nodes.length === 0) return false
    const recommended = getRecommendedNode(nodes)

    
return recommended.node === node.node
  }
  
  const handleMigrate = async () => {
    if (!selectedNode) {
      setError(t('hardware.selectDestinationNode'))
      
return
    }
    
    setMigrating(true)
    setError(null)
    
    try {
      // Passer le storage seulement s'il est différent de '__current__'
      const targetStorage = selectedStorage !== '__current__' ? selectedStorage : undefined

      // Passer withLocalDisks si on a des disques locaux ou si on change de stockage
      const withLocalDisks = hasLocalDisks || !!targetStorage

      await onMigrate(selectedNode, onlineMigration, targetStorage, withLocalDisks)
      onClose()
    } catch (e: any) {
      setError(e.message || t('hardware.migrationError'))
    } finally {
      setMigrating(false)
    }
  }
  
  const isVmRunning = vmStatus === 'running'
  
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className="ri-swap-box-line" style={{ fontSize: 24 }} />
        {t('hardware.migrateTitle', { vmName, vmid })}
      </DialogTitle>
      
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Alert severity="info" icon={<i className="ri-server-line" />}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <Typography variant="body2">
                {t('hardware.currentNode')} <strong>{currentNode}</strong>
              </Typography>
              {nodesCpuInfo[currentNode] && (
                <Chip
                  icon={<i className="ri-cpu-line" style={{ fontSize: 11 }} />}
                  label={nodesCpuInfo[currentNode].cpuModel}
                  size="small"
                  variant="outlined"
                  sx={{ 
                    height: 20, 
                    fontSize: '0.6rem', 
                    '& .MuiChip-label': { px: 0.5 },
                    '& .MuiChip-icon': { ml: 0.5, mr: -0.25, fontSize: 11 },
                    borderColor: 'divider',
                  }}
                />
              )}
            </Box>
          </Alert>
          
          {/* Affichage du type CPU de la VM */}
          {vmCpuType && (
            <Alert 
              severity={vmCpuType === 'host' && !allNodesSameCpu ? 'warning' : 'info'} 
              icon={<i className="ri-cpu-line" />}
              sx={{ py: 1 }}
            >
              <Box>
                <Typography variant="body2" fontWeight={600} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  VM CPU Type: <code style={{ 
                    backgroundColor: 'rgba(0,0,0,0.1)', 
                    padding: '2px 6px', 
                    borderRadius: 4,
                    fontFamily: 'monospace'
                  }}>{vmCpuType}</code>
                </Typography>
                {vmCpuType === 'host' && allNodesSameCpu && (
                  <Typography variant="caption" sx={{ opacity: 0.8, color: 'success.main', display: 'block', mt: 0.5 }}>
                    ✓ {t('hardware.cpuHostAllIdentical')}
                  </Typography>
                )}
                {vmCpuType !== 'host' && CPU_COMPATIBILITY_LEVELS[vmCpuType] && (
                  <Typography variant="caption" sx={{ opacity: 0.8 }}>
                    {CPU_COMPATIBILITY_LEVELS[vmCpuType].description}
                  </Typography>
                )}
              </Box>
              {vmCpuType === 'host' && !allNodesSameCpu && (
                <Chip 
                  label={t('hardware.cpuWarning')} 
                  size="small" 
                  color="warning"
                  sx={{ height: 20, fontSize: '0.65rem', mt: 1 }}
                />
              )}
            </Alert>
          )}
          
          {/* Avertissement pour cpu: host - seulement si CPUs différents */}
          {vmCpuType === 'host' && onlineMigration && !allNodesSameCpu && (
            <Alert severity="error" icon={<i className="ri-error-warning-fill" />}>
              <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                {t('hardware.cpuHostMigrationWarning')}
              </Typography>
              <Typography variant="caption">
                {t('hardware.cpuHostMigrationTip')}
              </Typography>
            </Alert>
          )}
          
          {/* Avertissement pour les disques sur stockage local */}
          {hasLocalDisks && (
            <Alert 
              severity="warning" 
              icon={<i className="ri-alert-line" />}
              sx={{ 
                '& .MuiAlert-message': { width: '100%' }
              }}
            >
              <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                {t('hardware.localDiskMigration')}
              </Typography>
              {vmDisks.filter(d => d.isLocal).map((disk, idx) => (
                <Typography key={idx} variant="caption" component="div" sx={{ opacity: 0.9 }}>
                  {disk.storage}:{vmid}/{disk.id}{disk.format ? `.${disk.format}` : ''} ({disk.size.toFixed(2)} GiB)
                </Typography>
              ))}
            </Alert>
          )}
          
          <Typography variant="subtitle2" sx={{ mt: 1 }}>
            {t('hardware.selectDestinationNodeLabel')}
          </Typography>
          
          {nodesLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress size={32} />
            </Box>
          ) : nodes.length === 0 ? (
            <Alert severity="warning">
              {t('hardware.noNodeAvailable')}
            </Alert>
          ) : (
            <Stack spacing={0.75}>
              {nodes.map((node) => {
                const cpuPercent = getCpuPercent(node)
                const memPercent = getMemoryPercent(node)
                const recommended = isRecommended(node)
                const cpuCompat = getCpuCompatibility(node.node)
                const nodeCpuInfo = nodesCpuInfo[node.node]
                
                return (
                  <Box
                    key={node.node}
                    onClick={() => setSelectedNode(node.node)}
                    sx={{
                      p: 1.25,
                      border: '1px solid',
                      borderColor: selectedNode === node.node ? 'primary.main' : cpuCompat.warning && !cpuCompat.compatible ? 'error.main' : 'divider',
                      borderRadius: 1.5,
                      cursor: 'pointer',
                      bgcolor: selectedNode === node.node ? 'action.selected' : 'transparent',
                      '&:hover': { bgcolor: 'action.hover' },
                    }}
                  >
                    {/* Header: Nom + Status + Badge Recommandé */}
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" fontWeight={600} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <i className="ri-server-line" style={{ fontSize: 14, opacity: 0.7 }} />
                          {node.node}
                        </Typography>
                        {recommended && (
                          <Chip
                            label={t('hardware.recommended')}
                            size="small"
                            color="success"
                            sx={{ height: 18, fontSize: '0.6rem', '& .MuiChip-label': { px: 0.75 } }}
                          />
                        )}
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        {/* CPU Compatibility indicator */}
                        {vmCpuType && nodeCpuInfo && (
                          <Tooltip title={cpuCompat.message || `CPU: ${nodeCpuInfo.cpuModel}`}>
                            <Chip
                              icon={<i className={cpuCompat.compatible ? "ri-checkbox-circle-fill" : "ri-error-warning-fill"} style={{ fontSize: 12 }} />}
                              label={nodeCpuInfo.recommendedCpuType}
                              size="small"
                              sx={{ 
                                height: 18, 
                                fontSize: '0.6rem', 
                                '& .MuiChip-label': { px: 0.5 },
                                '& .MuiChip-icon': { ml: 0.5, mr: -0.25 },
                                bgcolor: cpuCompat.compatible ? 'rgba(76, 175, 80, 0.15)' : 'rgba(244, 67, 54, 0.15)',
                                color: cpuCompat.color,
                                borderColor: cpuCompat.color,
                              }}
                              variant="outlined"
                            />
                          </Tooltip>
                        )}
                        <Chip
                          label={node.status}
                          size="small"
                          color={node.status === 'online' ? 'success' : 'default'}
                          variant="outlined"
                          sx={{ height: 18, fontSize: '0.6rem', '& .MuiChip-label': { px: 0.75 } }}
                        />
                      </Box>
                    </Box>
                    
                    {/* CPU Model info - affichage en badge */}
                    {nodeCpuInfo && (
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                        <Chip
                          icon={<i className="ri-cpu-line" style={{ fontSize: 11 }} />}
                          label={nodeCpuInfo.cpuModel}
                          size="small"
                          variant="outlined"
                          sx={{ 
                            height: 20, 
                            fontSize: '0.6rem', 
                            '& .MuiChip-label': { px: 0.5 },
                            '& .MuiChip-icon': { ml: 0.5, mr: -0.25, fontSize: 11 },
                            opacity: 0.8,
                            borderColor: 'divider',
                          }}
                        />
                        <Typography variant="caption" sx={{ opacity: 0.5, fontSize: '0.6rem' }}>
                          {nodeCpuInfo.sockets}×{nodeCpuInfo.cores} cores
                        </Typography>
                      </Box>
                    )}
                    
                    {/* CPU & RAM sur une ligne */}
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                      {/* CPU */}
                      <Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
                          <Typography variant="caption" sx={{ fontSize: '0.65rem', opacity: 0.8 }}>
                            CPU {formatCpu(node.cpu)}
                          </Typography>
                          <Typography variant="caption" sx={{ fontSize: '0.65rem', opacity: 0.6 }}>
                            {node.maxcpu}c
                          </Typography>
                        </Box>
                        <Box sx={{ height: 4, bgcolor: 'action.hover', borderRadius: 0.5, overflow: 'hidden' }}>
                          <Box sx={{ 
                            height: '100%', 
                            width: `${cpuPercent}%`,
                            bgcolor: cpuPercent > 80 ? 'error.main' : cpuPercent > 60 ? 'warning.main' : 'success.main',
                            borderRadius: 0.5
                          }} />
                        </Box>
                      </Box>
                      
                      {/* RAM */}
                      <Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
                          <Typography variant="caption" sx={{ fontSize: '0.65rem', opacity: 0.8 }}>
                            RAM {Math.round(memPercent)}%
                          </Typography>
                          <Typography variant="caption" sx={{ fontSize: '0.65rem', opacity: 0.6 }}>
                            {formatMemory(node.maxmem)}
                          </Typography>
                        </Box>
                        <Box sx={{ height: 4, bgcolor: 'action.hover', borderRadius: 0.5, overflow: 'hidden' }}>
                          <Box sx={{ 
                            height: '100%', 
                            width: `${memPercent}%`,
                            bgcolor: memPercent > 80 ? 'error.main' : memPercent > 60 ? 'warning.main' : 'success.main',
                            borderRadius: 0.5
                          }} />
                        </Box>
                      </Box>
                    </Box>
                  </Box>
                )
              })}
            </Stack>
          )}
          
          {/* Sélecteur de stockage cible */}
          {nodes.length > 0 && selectedNode && (
            <>
              <Typography variant="subtitle2" sx={{ mt: 2 }}>
                {t('hardware.targetStorageLabel')}
              </Typography>
              
              {!hasLocalDisks && (
                <Alert severity="info" sx={{ mt: 0.5, mb: 1, py: 0.5 }}>
                  <Typography variant="caption">
                    {t('hardware.sharedStorageInfo', { storages: currentStorageNames.join(', ') })}
                  </Typography>
                </Alert>
              )}
              
              {storagesLoading ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
                  <CircularProgress size={16} />
                  <Typography variant="caption" color="text.secondary">
                    {t('hardware.loadingStorages')}
                  </Typography>
                </Box>
              ) : (
                <FormControl fullWidth size="small" sx={{ mt: 0.5 }} disabled={!hasLocalDisks}>
                  <Select
                    value={hasLocalDisks ? selectedStorage : '__current__'}
                    onChange={(e) => setSelectedStorage(e.target.value)}
                    MenuProps={{
                      PaperProps: {
                        sx: { maxHeight: 300 }
                      }
                    }}
                  >
                    <MenuItem value="__current__">
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <i className="ri-layout-line" style={{ fontSize: 16, opacity: 0.7 }} />
                        <Typography variant="body2">
                          {t('hardware.keepCurrentStorage', { storage: currentStorageNames.length > 0 ? currentStorageNames.join(', ') : t('hardware.loading') })}
                        </Typography>
                        {hasLocalDisks && (
                          <Chip 
                            label="local" 
                            size="small" 
                            color="warning"
                            sx={{ height: 16, fontSize: '0.6rem', ml: 1 }}
                          />
                        )}
                      </Box>
                    </MenuItem>
                    
                    {hasLocalDisks && storages.length > 0 && <Divider sx={{ my: 0.5 }} />}
                    
                    {hasLocalDisks && storages.map((storage) => {
                      const isCurrent = currentStorageNames.includes(storage.storage)

                      
return (
                      <MenuItem key={storage.storage} value={storage.storage}>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 2 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <i className="ri-hard-drive-2-line" style={{ fontSize: 16, opacity: 0.7 }} />
                            <Typography variant="body2">{storage.storage}</Typography>
                            {isCurrent && (
                              <Chip
                                label={t('hardware.currentLabel')}
                                size="small"
                                color="info"
                                variant="outlined"
                                sx={{ height: 16, fontSize: '0.6rem' }}
                              />
                            )}
                          </Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <Chip 
                              label={storage.type} 
                              size="small" 
                              variant="outlined"
                              sx={{ height: 18, fontSize: '0.6rem' }}
                            />
                            <Typography variant="caption" color="text.secondary" sx={{ minWidth: 70, textAlign: 'right' }}>
                              {formatStorageSize(storage.avail)}
                            </Typography>
                            <Typography variant="caption" sx={{ opacity: 0.5, minWidth: 70, textAlign: 'right' }}>
                              {formatStorageSize(storage.total)}
                            </Typography>
                          </Box>
                        </Box>
                      </MenuItem>
                    )})}
                  </Select>
                </FormControl>
              )}
              
              {hasLocalDisks && selectedStorage === '__current__' && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                  💡 {t('hardware.selectSharedStorageTip')}
                </Typography>
              )}
            </>
          )}
          
          {nodes.length > 0 && (
            <>
              <Divider sx={{ my: 1 }} />
              
              <FormControlLabel
                control={
                  <Checkbox 
                    checked={onlineMigration} 
                    onChange={(e) => setOnlineMigration(e.target.checked)} 
                    size="small"
                    disabled={!isVmRunning}
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2">{t('hardware.onlineMigration')}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {isVmRunning
                        ? t('hardware.vmWillStayActive')
                        : t('hardware.onlineOnlyFeature')}
                    </Typography>
                  </Box>
                }
              />
              
              {!isVmRunning && (
                <Alert severity="info" sx={{ mt: 1 }}>
                  {t('hardware.vmStoppedColdMigration')}
                </Alert>
              )}
            </>
          )}
        </Stack>
      </DialogContent>
      
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={migrating}>{t('hardware.cancel')}</Button>
        {(() => {
          const selectedNodeCompat = selectedNode ? getCpuCompatibility(selectedNode) : null
          const isCpuIncompatible = selectedNodeCompat && !selectedNodeCompat.compatible
          
          return (
            <Tooltip title={isCpuIncompatible ? t('hardware.cpuIncompatibleBlocked') : ''}>
              <span>
                <Button 
                  variant="contained" 
                  onClick={handleMigrate} 
                  disabled={migrating || !selectedNode || nodes.length === 0 || isCpuIncompatible}
                  color={isCpuIncompatible ? 'error' : 'primary'}
                  startIcon={migrating ? <CircularProgress size={16} /> : <i className={isCpuIncompatible ? "ri-error-warning-line" : "ri-swap-box-line"} />}
                >
                  {migrating ? t('hardware.migrating') : isCpuIncompatible ? t('hardware.cpuIncompatible') : t('hardware.migrate')}
                </Button>
              </span>
            </Tooltip>
          )
        })()}
      </DialogActions>
    </Dialog>
  )
}


// ==================== CLONE VM DIALOG ====================
type CloneVmDialogProps = {
  open: boolean
  onClose: () => void
  onClone: (params: { targetNode: string; newVmid: number; name: string; targetStorage?: string; format?: string; pool?: string; full: boolean }) => Promise<void>
  connId: string
  currentNode: string
  vmName: string
  vmid: string
  nextVmid: number
  pools?: string[]
  existingVmids?: number[]  // Liste des VMIDs déjà utilisés
}

export function CloneVmDialog({ open, onClose, onClone, connId, currentNode, vmName, vmid, nextVmid, pools = [], existingVmids = [] }: CloneVmDialogProps) {
  const t = useTranslations()
  const [cloning, setCloning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nodes, setNodes] = useState<NodeInfo[]>([])
  const [storages, setStorages] = useState<{ storage: string; type: string; avail?: number; total?: number; shared?: number }[]>([])
  const [resourcePools, setResourcePools] = useState<{ poolid: string; comment?: string }[]>([])
  const [nodesLoading, setNodesLoading] = useState(false)
  const [storagesLoading, setStoragesLoading] = useState(false)
  const [poolsLoading, setPoolsLoading] = useState(false)
  
  // Form fields
  const [targetNode, setTargetNode] = useState(currentNode)
  const [newVmid, setNewVmid] = useState(nextVmid)
  const [name, setName] = useState('')
  const [targetStorage, setTargetStorage] = useState('')
  const [format, setFormat] = useState('qcow2')
  const [pool, setPool] = useState('')
  const [fullClone, setFullClone] = useState(true)
  
  // Validation du VMID
  const vmidError = useMemo(() => {
    if (!newVmid) return t('hardware.vmIdRequired')
    if (newVmid < 100) return t('hardware.vmIdMinimum')
    if (newVmid > 999999999) return t('hardware.vmIdTooLarge')
    if (existingVmids.includes(newVmid)) return t('hardware.vmIdAlreadyUsed', { id: newVmid })

return null
  }, [newVmid, existingVmids, t])
  
  // Charger les nodes du cluster
  useEffect(() => {
    if (!open || !connId) return
    
    const loadNodes = async () => {
      setNodesLoading(true)
      
      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes`)
        const json = await res.json()
        
        if (json.data && Array.isArray(json.data)) {
          const availableNodes = json.data
            .filter((n: NodeInfo) => n.status === 'online')
            .map((n: NodeInfo) => ({
              node: n.node,
              status: n.status,
              cpu: n.cpu,
              maxcpu: n.maxcpu,
              mem: n.mem,
              maxmem: n.maxmem
            }))
          
          setNodes(availableNodes)
        }
      } catch (e: any) {
        console.error('Error loading nodes:', e)
      } finally {
        setNodesLoading(false)
      }
    }
    
    loadNodes()
  }, [open, connId])
  
  // Charger les pools de ressources
  useEffect(() => {
    if (!open || !connId) return
    
    const loadPools = async () => {
      setPoolsLoading(true)
      
      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/pools`)
        const json = await res.json()
        
        if (json.data && Array.isArray(json.data)) {
          setResourcePools(json.data.map((p: any) => ({
            poolid: p.poolid,
            comment: p.comment
          })))
        }
      } catch (e: any) {
        console.error('Error loading pools:', e)


        // Si l'API n'existe pas ou échoue, utiliser les pools passés en props
        if (pools.length > 0) {
          setResourcePools(pools.map(p => ({ poolid: p })))
        }
      } finally {
        setPoolsLoading(false)
      }
    }
    
    loadPools()
  }, [open, connId, pools])
  
  // Charger les storages du node cible
  useEffect(() => {
    if (!open || !connId || !targetNode) return
    
    const loadStorages = async () => {
      setStoragesLoading(true)

      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(targetNode)}/storages`)
        const json = await res.json()
        
        if (json.data && Array.isArray(json.data)) {
          const diskStorages = json.data
            .filter((s: any) => 
              s.content?.includes('images') || s.type === 'zfspool' || s.type === 'lvmthin' || s.type === 'lvm' || s.type === 'dir' || s.type === 'nfs' || s.type === 'cifs' || s.type === 'rbd'
            )
            .map((s: any) => ({
              storage: s.storage,
              type: s.type,
              avail: s.avail,
              total: s.total,
              shared: s.shared
            }))

          setStorages(diskStorages)
        }
      } catch (e: any) {
        console.error('Error loading storages:', e)
      } finally {
        setStoragesLoading(false)
      }
    }
    
    loadStorages()

    // Reset storage when node changes
    setTargetStorage('')
  }, [open, connId, targetNode])
  
  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setTargetNode(currentNode)
      setNewVmid(nextVmid)
      setName('')
      setTargetStorage('')
      setFormat('qcow2')
      setPool('')
      setFullClone(true)
      setError(null)
    }
  }, [open, currentNode, nextVmid])
  
  const getRecommendedNode = (nodeList: NodeInfo[]): NodeInfo | null => {
    if (nodeList.length === 0) return null
    
return nodeList.reduce((best, current) => {
      const bestScore = calculateNodeScore(best)
      const currentScore = calculateNodeScore(current)

      
return currentScore > bestScore ? current : best
    }, nodeList[0])
  }
  
  const calculateNodeScore = (node: NodeInfo): number => {
    const cpuFree = node.maxcpu ? (1 - (node.cpu || 0)) * 100 : 50
    const memFree = node.maxmem && node.mem ? ((node.maxmem - node.mem) / node.maxmem) * 100 : 50

    
return cpuFree * 0.4 + memFree * 0.6
  }
  
  const formatMemory = (bytes?: number): string => {
    if (!bytes) return '—'
    const gb = bytes / 1024 / 1024 / 1024

    
return `${gb.toFixed(1)} GB`
  }
  
  const handleClone = async () => {
    if (vmidError) {
      setError(vmidError)
      
return
    }
    
    setCloning(true)
    setError(null)
    
    try {
      await onClone({
        targetNode,
        newVmid,
        name,
        targetStorage: targetStorage || undefined,
        format: targetStorage ? format : undefined,
        pool: pool || undefined,
        full: fullClone
      })
      onClose()
    } catch (e: any) {
      setError(e.message || t('hardware.cloneError'))
    } finally {
      setCloning(false)
    }
  }
  
  const recommendedNode = getRecommendedNode(nodes)
  
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className="ri-file-copy-line" style={{ fontSize: 24 }} />
        {t('hardware.cloneTitle', { vmName, vmid })}
      </DialogTitle>
      
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mt: 1 }}>
          {/* Target Node */}
          <FormControl fullWidth size="small">
            <InputLabel>Target node</InputLabel>
            <Select 
              value={targetNode} 
              onChange={(e) => setTargetNode(e.target.value)} 
              label="Target node"
              disabled={nodesLoading}
              MenuProps={{ PaperProps: { sx: { maxHeight: 300 } } }}
            >
              {nodes.map((node) => {
                const cpuPercent = (node.cpu || 0) * 100
                const memPercent = node.maxmem && node.mem ? (node.mem / node.maxmem) * 100 : 0
                const isRecommended = recommendedNode?.node === node.node
                
                return (
                  <MenuItem key={node.node} value={node.node} sx={{ py: 1 }}>
                    <Box sx={{ width: '100%' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          <i className="ri-server-line" style={{ fontSize: 14, opacity: 0.7 }} />
                          <Typography variant="body2" fontWeight={500}>{node.node}</Typography>
                          {isRecommended && (
                            <Chip label="★" size="small" color="success" sx={{ height: 16, fontSize: '0.6rem', minWidth: 20, '& .MuiChip-label': { px: 0.5 } }} />
                          )}
                        </Box>
                        <Typography variant="caption" sx={{ opacity: 0.6 }}>{node.maxcpu}c</Typography>
                      </Box>
                      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Typography variant="caption" sx={{ fontSize: '0.65rem', opacity: 0.7, minWidth: 28 }}>CPU</Typography>
                          <Box sx={{ flex: 1, height: 3, bgcolor: 'action.hover', borderRadius: 0.5, overflow: 'hidden' }}>
                            <Box sx={{ height: '100%', width: `${cpuPercent}%`, bgcolor: cpuPercent > 80 ? 'error.main' : cpuPercent > 60 ? 'warning.main' : 'success.main' }} />
                          </Box>
                          <Typography variant="caption" sx={{ fontSize: '0.6rem', opacity: 0.6, minWidth: 24 }}>{cpuPercent.toFixed(0)}%</Typography>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Typography variant="caption" sx={{ fontSize: '0.65rem', opacity: 0.7, minWidth: 28 }}>RAM</Typography>
                          <Box sx={{ flex: 1, height: 3, bgcolor: 'action.hover', borderRadius: 0.5, overflow: 'hidden' }}>
                            <Box sx={{ height: '100%', width: `${memPercent}%`, bgcolor: memPercent > 80 ? 'error.main' : memPercent > 60 ? 'warning.main' : 'success.main' }} />
                          </Box>
                          <Typography variant="caption" sx={{ fontSize: '0.6rem', opacity: 0.6, minWidth: 24 }}>{memPercent.toFixed(0)}%</Typography>
                        </Box>
                      </Box>
                    </Box>
                  </MenuItem>
                )
              })}
            </Select>
          </FormControl>
          
          {/* Target Storage */}
          <FormControl fullWidth size="small">
            <InputLabel>Target Storage</InputLabel>
            <Select 
              value={targetStorage} 
              onChange={(e) => setTargetStorage(e.target.value)} 
              label="Target Storage"
              disabled={storagesLoading}
              MenuProps={{ PaperProps: { sx: { maxHeight: 350 } } }}
            >
              <MenuItem value="">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className="ri-link" style={{ fontSize: 14, opacity: 0.7 }} />
                  <Typography variant="body2">Same as source</Typography>
                </Box>
              </MenuItem>
              
              {storages.length > 0 && <Divider sx={{ my: 0.5 }} />}
              
              {storages.map((s) => {
                const usedPercent = s.total && s.avail ? ((s.total - s.avail) / s.total) * 100 : 0
                
                return (
                  <MenuItem key={s.storage} value={s.storage} sx={{ py: 1 }}>
                    <Box sx={{ width: '100%' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          <i className="ri-hard-drive-2-line" style={{ fontSize: 14, opacity: 0.7 }} />
                          <Typography variant="body2" fontWeight={500}>{s.storage}</Typography>
                        </Box>
                        <Chip 
                          label={s.type} 
                          size="small" 
                          variant="outlined"
                          sx={{ height: 16, fontSize: '0.6rem', '& .MuiChip-label': { px: 0.5 } }}
                        />
                      </Box>
                      {s.total && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Box sx={{ flex: 1, height: 3, bgcolor: 'action.hover', borderRadius: 0.5, overflow: 'hidden' }}>
                            <Box sx={{ 
                              height: '100%', 
                              width: `${usedPercent}%`, 
                              bgcolor: usedPercent > 90 ? 'error.main' : usedPercent > 75 ? 'warning.main' : 'success.main' 
                            }} />
                          </Box>
                          <Typography variant="caption" sx={{ fontSize: '0.6rem', opacity: 0.7, minWidth: 100, textAlign: 'right' }}>
                            {formatStorageSize(s.avail)} / {formatStorageSize(s.total)}
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  </MenuItem>
                )
              })}
            </Select>
          </FormControl>
          
          {/* VM ID */}
          <TextField
            size="small"
            label="VM ID"
            type="number"
            value={newVmid}
            onChange={(e) => setNewVmid(parseInt(e.target.value) || 0)}
            inputProps={{ min: 100, max: 999999999 }}
            required
            error={!!vmidError}
            helperText={vmidError}
          />
          
          {/* Format */}
          <FormControl fullWidth size="small" disabled={!targetStorage}>
            <InputLabel>Format</InputLabel>
            <Select value={format} onChange={(e) => setFormat(e.target.value)} label="Format">
              <MenuItem value="qcow2">QEMU image format (qcow2)</MenuItem>
              <MenuItem value="raw">Raw disk image (raw)</MenuItem>
              <MenuItem value="vmdk">VMware image format (vmdk)</MenuItem>
            </Select>
          </FormControl>
          
          {/* Name */}
          <TextField
            size="small"
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('hardware.optional')}
          />
          
          {/* Resource Pool */}
          <FormControl fullWidth size="small">
            <InputLabel>Resource Pool</InputLabel>
            <Select 
              value={pool} 
              onChange={(e) => setPool(e.target.value)} 
              label="Resource Pool"
              disabled={poolsLoading}
            >
              <MenuItem value="">
                <Typography variant="body2" sx={{ opacity: 0.7 }}>{t('hardware.none')}</Typography>
              </MenuItem>
              {resourcePools.map((p) => (
                <MenuItem key={p.poolid} value={p.poolid}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <i className="ri-folder-line" style={{ fontSize: 14, opacity: 0.7 }} />
                    <Box>
                      <Typography variant="body2">{p.poolid}</Typography>
                      {p.comment && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.65rem' }}>
                          {p.comment}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
        
        {/* Mode de clonage */}
        <Box sx={{ mt: 2 }}>
          <FormControlLabel
            control={
              <Checkbox 
                checked={fullClone} 
                onChange={(e) => setFullClone(e.target.checked)} 
                size="small"
              />
            }
            label={
              <Box>
                <Typography variant="body2">Full Clone</Typography>
                <Typography variant="caption" color="text.secondary">
                  {fullClone
                    ? t('hardware.fullCopyDescription')
                    : t('hardware.linkedCloneDescription')}
                </Typography>
              </Box>
            }
          />
        </Box>
      </DialogContent>
      
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={cloning}>{t('hardware.cancel')}</Button>
        <Button 
          variant="contained" 
          onClick={handleClone} 
          disabled={cloning || !!vmidError}
          startIcon={cloning ? <CircularProgress size={16} /> : <i className="ri-file-copy-line" />}
        >
          {cloning ? t('hardware.cloning') : t('hardware.clone')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
