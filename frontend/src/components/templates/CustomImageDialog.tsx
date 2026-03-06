'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'

interface CustomImageDialogProps {
  open: boolean
  onClose: (saved?: boolean) => void
  editData?: any | null
}

export default function CustomImageDialog({ open, onClose, editData }: CustomImageDialogProps) {
  const t = useTranslations()
  const isEdit = !!editData

  // Form state
  const [name, setName] = useState('')
  const [vendor, setVendor] = useState('custom')
  const [version, setVersion] = useState('')
  const [arch, setArch] = useState('amd64')
  const [format, setFormat] = useState('qcow2')
  const [sourceType, setSourceType] = useState<'url' | 'volume'>('url')
  const [downloadUrl, setDownloadUrl] = useState('')
  const [checksumUrl, setChecksumUrl] = useState('')
  const [volumeId, setVolumeId] = useState('')
  const [defaultDiskSize, setDefaultDiskSize] = useState('20G')
  const [minMemory, setMinMemory] = useState(512)
  const [recommendedMemory, setRecommendedMemory] = useState(2048)
  const [minCores, setMinCores] = useState(1)
  const [recommendedCores, setRecommendedCores] = useState(2)
  const [ostype, setOstype] = useState('l26')
  const [tags, setTags] = useState('')

  // Volume browser state
  const [connections, setConnections] = useState<any[]>([])
  const [selectedConn, setSelectedConn] = useState('')
  const [nodes, setNodes] = useState<any[]>([])
  const [selectedNode, setSelectedNode] = useState('')
  const [storages, setStorages] = useState<any[]>([])
  const [selectedStorage, setSelectedStorage] = useState('')
  const [volumes, setVolumes] = useState<any[]>([])
  const [loadingVolumes, setLoadingVolumes] = useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset form on open
  useEffect(() => {
    if (!open) return
    setError(null)
    setSaving(false)

    if (editData) {
      setName(editData.name || '')
      setVendor(editData.vendor || 'custom')
      setVersion(editData.version || '')
      setArch(editData.arch || 'amd64')
      setFormat(editData.format || 'qcow2')
      setSourceType(editData.sourceType || 'url')
      setDownloadUrl(editData.downloadUrl || '')
      setChecksumUrl(editData.checksumUrl || '')
      setVolumeId(editData.volumeId || '')
      setDefaultDiskSize(editData.defaultDiskSize || '20G')
      setMinMemory(editData.minMemory || 512)
      setRecommendedMemory(editData.recommendedMemory || 2048)
      setMinCores(editData.minCores || 1)
      setRecommendedCores(editData.recommendedCores || 2)
      setOstype(editData.ostype || 'l26')
      setTags(editData.tags || '')
    } else {
      setName('')
      setVendor('custom')
      setVersion('')
      setArch('amd64')
      setFormat('qcow2')
      setSourceType('url')
      setDownloadUrl('')
      setChecksumUrl('')
      setVolumeId('')
      setDefaultDiskSize('20G')
      setMinMemory(512)
      setRecommendedMemory(2048)
      setMinCores(1)
      setRecommendedCores(2)
      setOstype('l26')
      setTags('')
    }
  }, [open, editData])

  // Fetch connections for volume browser
  useEffect(() => {
    if (!open || sourceType !== 'volume') return
    fetch('/api/v1/connections?type=pve')
      .then(r => r.json())
      .then(res => {
        const conns = res.data || []
        setConnections(conns)
        if (conns.length === 1) setSelectedConn(conns[0].id)
      })
      .catch(() => {})
  }, [open, sourceType])

  // Fetch nodes
  useEffect(() => {
    if (!selectedConn) { setNodes([]); setSelectedNode(''); return }
    fetch(`/api/v1/connections/${encodeURIComponent(selectedConn)}/nodes`)
      .then(r => r.json())
      .then(res => {
        const nodeList = (res.data || []).filter((n: any) => n.status === 'online')
        setNodes(nodeList)
        if (nodeList.length === 1) setSelectedNode(nodeList[0].node)
      })
      .catch(() => setNodes([]))
  }, [selectedConn])

  // Fetch storages
  useEffect(() => {
    if (!selectedConn || !selectedNode) { setStorages([]); setSelectedStorage(''); return }
    fetch(`/api/v1/connections/${encodeURIComponent(selectedConn)}/nodes/${encodeURIComponent(selectedNode)}/storages`)
      .then(r => r.json())
      .then(res => {
        const stList = (res.data || []).filter((s: any) => s.enabled !== 0)
        setStorages(stList)
      })
      .catch(() => setStorages([]))
  }, [selectedConn, selectedNode])

  // Fetch volumes from storage
  useEffect(() => {
    if (!selectedConn || !selectedNode || !selectedStorage) { setVolumes([]); return }
    setLoadingVolumes(true)
    fetch(`/api/v1/connections/${encodeURIComponent(selectedConn)}/nodes/${encodeURIComponent(selectedNode)}/storage/${encodeURIComponent(selectedStorage)}/content`)
      .then(r => r.json())
      .then(res => {
        // Filter to importable image files
        const vols = (res.data || []).filter((v: any) => {
          const vol = v.volid || ''
          return vol.match(/\.(qcow2|raw|vmdk|img|iso)$/i) || v.content === 'import' || v.content === 'images'
        })
        setVolumes(vols)
        setLoadingVolumes(false)
      })
      .catch(() => { setVolumes([]); setLoadingVolumes(false) })
  }, [selectedConn, selectedNode, selectedStorage])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setError(null)

    const payload: any = {
      name, vendor, version, arch, format, sourceType,
      downloadUrl: sourceType === 'url' ? downloadUrl : null,
      checksumUrl: sourceType === 'url' && checksumUrl ? checksumUrl : null,
      volumeId: sourceType === 'volume' ? volumeId : null,
      defaultDiskSize, minMemory, recommendedMemory, minCores, recommendedCores,
      ostype, tags: tags || null,
    }

    try {
      const url = isEdit
        ? `/api/v1/templates/custom-images/${editData.id}`
        : '/api/v1/templates/custom-images'
      const res = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (data.error) {
        setError(data.error)
        setSaving(false)
        return
      }
      setSaving(false)
      onClose(true)
    } catch (err: any) {
      setError(err.message || 'Save failed')
      setSaving(false)
    }
  }, [
    name, vendor, version, arch, format, sourceType, downloadUrl, checksumUrl,
    volumeId, defaultDiskSize, minMemory, recommendedMemory, minCores,
    recommendedCores, ostype, tags, isEdit, editData, onClose,
  ])

  const canSave = name.trim() &&
    (sourceType === 'url' ? downloadUrl.trim() : volumeId.trim()) &&
    defaultDiskSize.match(/^\d+G$/)

  return (
    <Dialog open={open} onClose={() => onClose()} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className="ri-image-add-line" style={{ fontSize: 22 }} />
        {isEdit ? t('templates.catalog.editCustom') : t('templates.catalog.addCustom')}
      </DialogTitle>

      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          {/* Source type toggle */}
          <Box>
            <Typography variant="caption" sx={{ opacity: 0.6, mb: 0.5, display: 'block' }}>
              {t('templates.catalog.sourceType')}
            </Typography>
            <ToggleButtonGroup
              size="small"
              value={sourceType}
              exclusive
              onChange={(_, v) => v && setSourceType(v)}
            >
              <ToggleButton value="url" sx={{ gap: 0.5 }}>
                <i className="ri-link" style={{ fontSize: 16 }} />
                {t('templates.catalog.sourceUrl')}
              </ToggleButton>
              <ToggleButton value="volume" sx={{ gap: 0.5 }}>
                <i className="ri-hard-drive-2-line" style={{ fontSize: 16 }} />
                {t('templates.catalog.sourceVolume')}
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>

          {/* Name + vendor row */}
          <Box sx={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 2 }}>
            <TextField
              size="small"
              label={t('templates.catalog.imageName')}
              value={name}
              onChange={e => setName(e.target.value)}
              required
              placeholder="My Golden Ubuntu 24.04"
            />
            <TextField
              size="small"
              label={t('templates.catalog.vendorLabel')}
              value={vendor}
              onChange={e => setVendor(e.target.value)}
              placeholder="custom"
            />
          </Box>

          {/* Source: URL fields */}
          {sourceType === 'url' && (
            <Stack spacing={2}>
              <TextField
                size="small"
                label={t('templates.catalog.downloadUrl')}
                value={downloadUrl}
                onChange={e => setDownloadUrl(e.target.value)}
                required
                fullWidth
                placeholder="https://example.com/images/my-image.qcow2"
              />
              <TextField
                size="small"
                label={t('templates.catalog.checksumUrl')}
                value={checksumUrl}
                onChange={e => setChecksumUrl(e.target.value)}
                fullWidth
                placeholder="https://example.com/images/SHA256SUMS"
              />
            </Stack>
          )}

          {/* Source: Volume browser */}
          {sourceType === 'volume' && (
            <Stack spacing={2}>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 2 }}>
                <FormControl size="small">
                  <InputLabel>{t('templates.deploy.target.connection')}</InputLabel>
                  <Select
                    value={selectedConn}
                    onChange={e => { setSelectedConn(e.target.value); setSelectedNode(''); setSelectedStorage('') }}
                    label={t('templates.deploy.target.connection')}
                  >
                    {connections.map((c: any) => (
                      <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" disabled={!selectedConn}>
                  <InputLabel>{t('templates.deploy.target.node')}</InputLabel>
                  <Select
                    value={selectedNode}
                    onChange={e => { setSelectedNode(e.target.value); setSelectedStorage('') }}
                    label={t('templates.deploy.target.node')}
                  >
                    {nodes.map((n: any) => (
                      <MenuItem key={n.node} value={n.node}>{n.node}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" disabled={!selectedNode}>
                  <InputLabel>{t('templates.deploy.target.storage')}</InputLabel>
                  <Select
                    value={selectedStorage}
                    onChange={e => setSelectedStorage(e.target.value)}
                    label={t('templates.deploy.target.storage')}
                  >
                    {storages.map((s: any) => (
                      <MenuItem key={s.storage} value={s.storage}>
                        {s.storage} ({s.type})
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>

              {/* Volume list */}
              {loadingVolumes ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : volumes.length > 0 ? (
                <Box sx={{ maxHeight: 200, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
                  {volumes.map((v: any) => (
                    <Box
                      key={v.volid}
                      onClick={() => setVolumeId(v.volid)}
                      sx={{
                        px: 1.5, py: 0.75,
                        cursor: 'pointer',
                        bgcolor: volumeId === v.volid ? 'action.selected' : 'transparent',
                        '&:hover': { bgcolor: 'action.hover' },
                        display: 'flex', alignItems: 'center', gap: 1,
                        borderBottom: 1, borderColor: 'divider',
                        '&:last-child': { borderBottom: 0 },
                      }}
                    >
                      <i className="ri-file-line" style={{ fontSize: 14, opacity: 0.5 }} />
                      <Typography variant="body2" sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.75rem' }}>
                        {v.volid}
                      </Typography>
                      {v.size && (
                        <Typography variant="caption" sx={{ opacity: 0.5, ml: 'auto' }}>
                          {(v.size / 1073741824).toFixed(1)} GB
                        </Typography>
                      )}
                    </Box>
                  ))}
                </Box>
              ) : selectedStorage ? (
                <Typography variant="body2" sx={{ opacity: 0.5, fontStyle: 'italic' }}>
                  {t('templates.catalog.noVolumes')}
                </Typography>
              ) : null}

              <TextField
                size="small"
                label={t('templates.catalog.volumeIdLabel')}
                value={volumeId}
                onChange={e => setVolumeId(e.target.value)}
                required
                fullWidth
                placeholder="local:import/my-image.qcow2"
                helperText={t('templates.catalog.volumeIdHelp')}
              />
            </Stack>
          )}

          {/* Image properties */}
          <Typography variant="subtitle2" sx={{ opacity: 0.7, mt: 1 }}>
            {t('templates.catalog.imageProperties')}
          </Typography>

          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 2 }}>
            <TextField
              size="small"
              label={t('templates.catalog.versionLabel')}
              value={version}
              onChange={e => setVersion(e.target.value)}
              placeholder="24.04"
            />
            <FormControl size="small">
              <InputLabel>{t('templates.catalog.archLabel')}</InputLabel>
              <Select value={arch} onChange={e => setArch(e.target.value)} label={t('templates.catalog.archLabel')}>
                <MenuItem value="amd64">amd64</MenuItem>
                <MenuItem value="x86_64">x86_64</MenuItem>
                <MenuItem value="arm64">arm64</MenuItem>
                <MenuItem value="aarch64">aarch64</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small">
              <InputLabel>{t('templates.catalog.formatLabel')}</InputLabel>
              <Select value={format} onChange={e => setFormat(e.target.value)} label={t('templates.catalog.formatLabel')}>
                <MenuItem value="qcow2">qcow2</MenuItem>
                <MenuItem value="raw">raw</MenuItem>
                <MenuItem value="vmdk">vmdk</MenuItem>
                <MenuItem value="img">img</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small">
              <InputLabel>{t('templates.catalog.ostypeLabel')}</InputLabel>
              <Select value={ostype} onChange={e => setOstype(e.target.value)} label={t('templates.catalog.ostypeLabel')}>
                <MenuItem value="l26">Linux 2.6+</MenuItem>
                <MenuItem value="win10">Windows 10/11</MenuItem>
                <MenuItem value="win11">Windows 11</MenuItem>
                <MenuItem value="other">Other</MenuItem>
              </Select>
            </FormControl>
          </Box>

          {/* Hardware specs */}
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 2 }}>
            <TextField
              size="small"
              label={t('templates.deploy.hardware.diskSize')}
              value={defaultDiskSize}
              onChange={e => setDefaultDiskSize(e.target.value)}
              placeholder="20G"
            />
            <TextField
              size="small"
              label={t('templates.catalog.minCores')}
              type="number"
              value={minCores}
              onChange={e => setMinCores(parseInt(e.target.value) || 1)}
              slotProps={{ htmlInput: { min: 1 } }}
            />
            <TextField
              size="small"
              label={t('templates.catalog.recCores')}
              type="number"
              value={recommendedCores}
              onChange={e => setRecommendedCores(parseInt(e.target.value) || 2)}
              slotProps={{ htmlInput: { min: 1 } }}
            />
            <TextField
              size="small"
              label={t('templates.catalog.minMem')}
              type="number"
              value={minMemory}
              onChange={e => setMinMemory(parseInt(e.target.value) || 512)}
              helperText="MB"
              slotProps={{ htmlInput: { min: 128, step: 256 } }}
            />
            <TextField
              size="small"
              label={t('templates.catalog.recMem')}
              type="number"
              value={recommendedMemory}
              onChange={e => setRecommendedMemory(parseInt(e.target.value) || 2048)}
              helperText="MB"
              slotProps={{ htmlInput: { min: 128, step: 256 } }}
            />
          </Box>

          {/* Tags */}
          <TextField
            size="small"
            label={t('templates.catalog.tagsLabel')}
            value={tags}
            onChange={e => setTags(e.target.value)}
            fullWidth
            placeholder="cloud-init;lts;custom"
            helperText={t('templates.blueprints.tagsHelp')}
          />
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={() => onClose()}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || !canSave}
          startIcon={saving ? <CircularProgress size={16} /> : undefined}
        >
          {isEdit ? t('common.save') : t('templates.catalog.addCustom')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
