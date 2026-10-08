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
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'

import NumericTextField from '@/components/ui/NumericTextField'
import VolumeSourcePicker, { type VolumeLocation } from '@/components/templates/VolumeSourcePicker'
import { useTenant } from '@/contexts/TenantContext'

interface CustomImageDialogProps {
  open: boolean
  onClose: (saved?: boolean) => void
  editData?: any | null
}

export default function CustomImageDialog({ open, onClose, editData }: CustomImageDialogProps) {
  const t = useTranslations()
  const { currentTenant, loading: tenantLoading } = useTenant()
  const isProviderTenant = !tenantLoading && currentTenant?.id === 'default'
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
  const [source, setSource] = useState<VolumeLocation>({ connectionId: '', node: '', volumeId: '' })
  // Copies of the same image on other clusters (#44), deployable there too.
  const [extraLocations, setExtraLocations] = useState<VolumeLocation[]>([])
  const [defaultDiskSize, setDefaultDiskSize] = useState('20G')
  const [minMemory, setMinMemory] = useState(512)
  const [recommendedMemory, setRecommendedMemory] = useState(2048)
  const [minCores, setMinCores] = useState(1)
  const [recommendedCores, setRecommendedCores] = useState(2)
  const [ostype, setOstype] = useState('l26')
  const [tags, setTags] = useState('')
  // Provider-only: publish to the shared catalogue (visible to every tenant).
  const [isShared, setIsShared] = useState(false)

  // Volume browser state
  const [connections, setConnections] = useState<any[]>([])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset form on open
  useEffect(() => {
    if (!open) return
    setError(null)
    setSaving(false)
    setSource({
      connectionId: editData?.sourceConnectionId || '',
      node: editData?.sourceNode || '',
      volumeId: editData?.volumeId || '',
    })
    setExtraLocations(Array.isArray(editData?.extraLocations) ? editData.extraLocations : [])

    if (editData) {
      setName(editData.name || '')
      setVendor(editData.vendor || 'custom')
      setVersion(editData.version || '')
      setArch(editData.arch || 'amd64')
      setFormat(editData.format || 'qcow2')
      setSourceType(editData.sourceType || 'url')
      setDownloadUrl(editData.downloadUrl || '')
      setChecksumUrl(editData.checksumUrl || '')
      setDefaultDiskSize(editData.defaultDiskSize || '20G')
      setMinMemory(editData.minMemory || 512)
      setRecommendedMemory(editData.recommendedMemory || 2048)
      setMinCores(editData.minCores || 1)
      setRecommendedCores(editData.recommendedCores || 2)
      setOstype(editData.ostype || 'l26')
      setTags(editData.tags || '')
      setIsShared(!!(editData as any).isShared)
    } else {
      setName('')
      setVendor('custom')
      setVersion('')
      setArch('amd64')
      setFormat('qcow2')
      setSourceType('url')
      setDownloadUrl('')
      setChecksumUrl('')
      setDefaultDiskSize('20G')
      setMinMemory(512)
      setRecommendedMemory(2048)
      setMinCores(1)
      setRecommendedCores(2)
      setOstype('l26')
      setTags('')
      setIsShared(false)
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
        if (conns.length === 1) setSource(current => current.connectionId ? current : { ...current, connectionId: conns[0].id })
      })
      .catch(() => {})
  }, [open, sourceType])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setError(null)

    const payload: any = {
      name, vendor, version, arch, format, sourceType,
      downloadUrl: sourceType === 'url' ? downloadUrl : null,
      checksumUrl: sourceType === 'url' && checksumUrl ? checksumUrl : null,
      volumeId: sourceType === 'volume' ? source.volumeId : null,
      sourceConnectionId: sourceType === 'volume' ? source.connectionId : null,
      sourceNode: sourceType === 'volume' ? source.node : null,
      extraLocations: sourceType === 'volume' ? extraLocations : [],
      defaultDiskSize, minMemory, recommendedMemory, minCores, recommendedCores,
      ostype, tags: tags || null,
      isShared,
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
    source, extraLocations, defaultDiskSize, minMemory, recommendedMemory, minCores,
    recommendedCores, ostype, tags, isEdit, editData, onClose, isShared,
  ])

  const canSave = name.trim() &&
    (sourceType === 'url'
      ? downloadUrl.trim()
      : [source, ...extraLocations].every(loc => loc.volumeId.trim() && loc.connectionId && loc.node)) &&
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

          {format === 'iso' && (
            <Alert severity="info" icon={<i className="ri-disc-line" style={{ fontSize: 18 }} />}>
              {t('templates.catalog.isoUploadNote')}
            </Alert>
          )}

          {/* Source type toggle. The "PVE volume" mode lets the caller
              point at an already-uploaded qcow2 on a PVE storage; it's
              irrelevant for tenants (no storage browser access) and we
              keep it provider-only. The "URL" mode covers 99% of cases
              and is the only one shown to tenants. */}
          {isProviderTenant && (
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
          )}

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
              <VolumeSourcePicker key={`${open}-${editData?.id ?? 'new'}`} connections={connections} value={source} onChange={setSource} />

              {/* Copies on other clusters: the same image deploys there too.
                  Each copy is picked explicitly, a volume name proves
                  nothing about the disk it names on another cluster. */}
              {extraLocations.map((loc, i) => (
                <Box key={i} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
                    <Typography variant="subtitle2" sx={{ opacity: 0.7 }}>
                      {t('templates.catalog.extraLocationTitle', { index: i + 1 })}
                    </Typography>
                    <Tooltip title={t('common.delete')}>
                      <IconButton
                        size="small"
                        sx={{ ml: 'auto' }}
                        aria-label={t('common.delete')}
                        onClick={() => setExtraLocations(list => list.filter((_, j) => j !== i))}
                      >
                        <i className="ri-delete-bin-line" style={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                  <VolumeSourcePicker
                    connections={connections.filter((c: any) => c.id === loc.connectionId
                      || ![source, ...extraLocations].some(other => other.connectionId === c.id))}
                    value={loc}
                    onChange={next => setExtraLocations(list => list.map((item, j) => j === i ? next : item))}
                  />
                </Box>
              ))}

              {connections.length > extraLocations.length + 1 && (
                <Box>
                  <Button
                    size="small"
                    startIcon={<i className="ri-add-line" />}
                    disabled={!source.connectionId}
                    onClick={() => setExtraLocations(list => [...list, { connectionId: '', node: '', volumeId: '' }])}
                  >
                    {t('templates.catalog.addExtraLocation')}
                  </Button>
                  <Typography variant="caption" sx={{ opacity: 0.65, display: 'block' }}>
                    {t('templates.catalog.extraLocationHelp')}
                  </Typography>
                </Box>
              )}
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
                <MenuItem value="iso">{t('templates.catalog.formatIso')}</MenuItem>
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
            <NumericTextField
              size="small"
              label={t('templates.catalog.minCores')}
              type="number"
              value={minCores}
              onChange={setMinCores}
              fallback={1}
              min={1}
              slotProps={{ htmlInput: { min: 1 } }}
            />
            <NumericTextField
              size="small"
              label={t('templates.catalog.recCores')}
              type="number"
              value={recommendedCores}
              onChange={setRecommendedCores}
              fallback={2}
              min={1}
              slotProps={{ htmlInput: { min: 1 } }}
            />
            <NumericTextField
              size="small"
              label={t('templates.catalog.minMem')}
              type="number"
              value={minMemory}
              onChange={setMinMemory}
              fallback={512}
              min={128}
              helperText="MB"
              slotProps={{ htmlInput: { min: 128, step: 256 } }}
            />
            <NumericTextField
              size="small"
              label={t('templates.catalog.recMem')}
              type="number"
              value={recommendedMemory}
              onChange={setRecommendedMemory}
              fallback={2048}
              min={128}
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

          {/* Shared catalogue toggle — provider only. Tenant uploads stay
              private to that tenant; the provider can promote an image to
              the shared catalogue visible by every tenant. */}
          {isProviderTenant && (
            <FormControlLabel
              control={
                <Switch
                  checked={isShared}
                  onChange={e => setIsShared(e.target.checked)}
                  size="small"
                />
              }
              label={
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {t('templates.catalog.shareWithTenants')}
                  </Typography>
                  <Typography variant="caption" sx={{ opacity: 0.65 }}>
                    {t('templates.catalog.shareWithTenantsHelp')}
                  </Typography>
                </Box>
              }
              sx={{ alignItems: 'flex-start', m: 0 }}
            />
          )}
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
