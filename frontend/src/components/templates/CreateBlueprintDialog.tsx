'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  ListSubheader,
  MenuItem,
  Select,
  Stack,
  Switch,
  FormControlLabel,
  TextField,
  Typography,
} from '@mui/material'

import { CLOUD_IMAGES } from '@/lib/templates/cloudImages'
import type { CatalogImage } from '@/lib/templates/blueprintImages'
import { splitCatalogImages, hasMeaningfulCloudInit } from '@/lib/templates/blueprintImages'
import { useToast } from '@/contexts/ToastContext'

function safeJsonParse(s: string): any {
  try { return JSON.parse(s) } catch { return null }
}

interface Blueprint {
  id: string
  name: string
  description: string | null
  imageSlug: string
  hardware: string
  cloudInit: string | null
  tags: string | null
  isPublic: boolean
}

interface CreateBlueprintDialogProps {
  open: boolean
  onClose: (saved?: boolean) => void
  blueprint?: Blueprint | null
}

const defaultHardware = {
  cores: 2,
  sockets: 1,
  memory: 2048,
  diskSize: '20G',
  scsihw: 'virtio-scsi-single',
  networkModel: 'virtio',
  networkBridge: 'vmbr0',
  vlanTag: null as number | null,
  ostype: 'l26',
  agent: true,
  cpu: 'host',
}

const defaultCloudInit = {
  ciuser: '',
  sshKeys: '',
  ipconfig0: 'ip=dhcp',
  nameserver: '',
  searchdomain: '',
}

export default function CreateBlueprintDialog({ open, onClose, blueprint }: CreateBlueprintDialogProps) {
  const t = useTranslations()
  const { showToast } = useToast()
  const [saving, setSaving] = useState(false)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [imageSlug, setImageSlug] = useState('')
  const [tags, setTags] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [hardware, setHardware] = useState({ ...defaultHardware })
  const [cloudInit, setCloudInit] = useState({ ...defaultCloudInit })

  // Catalog images fetched on dialog open
  const [catalogImages, setCatalogImages] = useState<CatalogImage[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)

  // Reset form on open / populate from editing blueprint
  useEffect(() => {
    if (!open) return
    if (blueprint) {
      setName(blueprint.name)
      setDescription(blueprint.description || '')
      setImageSlug(blueprint.imageSlug)
      setTags(blueprint.tags || '')
      setIsPublic(blueprint.isPublic)
      // hardware/cloudInit are JSONB on the API since step 2.5; the API
      // returns them as parsed objects. Tolerate the legacy string shape
      // for any cached client that hasn't reloaded yet.
      const hw = typeof blueprint.hardware === 'string'
        ? safeJsonParse(blueprint.hardware)
        : blueprint.hardware
      setHardware({ ...defaultHardware, ...(hw || {}) })

      const ci = blueprint.cloudInit == null
        ? null
        : typeof blueprint.cloudInit === 'string'
          ? safeJsonParse(blueprint.cloudInit)
          : blueprint.cloudInit
      setCloudInit(ci ? { ...defaultCloudInit, ...ci } : { ...defaultCloudInit })
    } else {
      setName('')
      setDescription('')
      setImageSlug(CLOUD_IMAGES[0]?.slug || '')
      setTags('')
      setIsPublic(true)
      setHardware({ ...defaultHardware })
      setCloudInit({ ...defaultCloudInit })
    }
  }, [open, blueprint])

  // Fetch the catalog on each open so custom images always appear.
  // Falls back to CLOUD_IMAGES if the fetch fails.
  useEffect(() => {
    if (!open) return
    setCatalogLoading(true)
    fetch('/api/v1/templates/catalog')
      .then(r => r.json())
      .then(res => {
        const imgs: CatalogImage[] = res.data?.images || []
        setCatalogImages(imgs.length > 0 ? imgs : CLOUD_IMAGES)
      })
      .catch(() => {
        // Graceful degradation: keep the built-in list so the dialog stays usable.
        setCatalogImages(CLOUD_IMAGES)
      })
      .finally(() => setCatalogLoading(false))
  }, [open])

  const { builtIn, custom } = splitCatalogImages(catalogImages)

  const handleSave = useCallback(async () => {
    if (!name.trim() || !imageSlug) return
    setSaving(true)

    try {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        imageSlug,
        hardware,
        cloudInit: hasMeaningfulCloudInit(cloudInit) ? cloudInit : null,
        tags: tags.trim() || null,
        isPublic,
      }

      const url = blueprint
        ? `/api/v1/templates/blueprints/${blueprint.id}`
        : '/api/v1/templates/blueprints'

      const res = await fetch(url, {
        method: blueprint ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Save failed')
      }

      showToast(
        blueprint ? t('templates.blueprints.updated') : t('templates.blueprints.created'),
        'success'
      )
      onClose(true)
    } catch (err: any) {
      showToast(err.message || t('errors.generic'), 'error')
    } finally {
      setSaving(false)
    }
  }, [name, description, imageSlug, hardware, cloudInit, tags, isPublic, blueprint, onClose, showToast, t])

  return (
    <Dialog open={open} onClose={() => onClose()} maxWidth="sm" fullWidth>
      <DialogTitle>
        {blueprint ? t('templates.blueprints.edit') : t('templates.blueprints.create')}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label={t('common.name')}
            value={name}
            onChange={e => setName(e.target.value)}
            fullWidth
            required
            size="small"
          />
          <TextField
            label={t('common.description')}
            value={description}
            onChange={e => setDescription(e.target.value)}
            fullWidth
            multiline
            rows={2}
            size="small"
          />
          <FormControl size="small" fullWidth>
            <InputLabel>{t('templates.blueprints.image')}</InputLabel>
            <Select
              value={imageSlug}
              onChange={e => setImageSlug(e.target.value)}
              label={t('templates.blueprints.image')}
              startAdornment={catalogLoading ? <CircularProgress size={16} sx={{ mr: 1 }} /> : undefined}
            >
              {/*
                Edit-mode guard: if the catalog hasn't loaded yet the blueprint's
                slug won't match any MenuItem, causing an MUI out-of-range warning.
                Render a hidden fallback option so the Select shows the current
                slug while we wait for the fetch.
              */}
              {catalogLoading && imageSlug && (
                <MenuItem key="__loading__" value={imageSlug} sx={{ display: 'none' }}>
                  {imageSlug}
                </MenuItem>
              )}
              {builtIn.length > 0 && (
                <ListSubheader>Built-in</ListSubheader>
              )}
              {builtIn.map(img => (
                <MenuItem key={img.slug} value={img.slug}>{img.name}</MenuItem>
              ))}
              {custom.length > 0 && (
                <ListSubheader>{t('templates.catalog.customLabel')}</ListSubheader>
              )}
              {custom.map(img => (
                <MenuItem key={img.slug} value={img.slug}>{img.name}</MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Hardware section */}
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
            <TextField
              label={t('templates.deploy.hardware.cores')}
              type="number"
              value={hardware.cores}
              onChange={e => setHardware(h => ({ ...h, cores: Number.parseInt(e.target.value) || 1 }))}
              size="small"
              slotProps={{ htmlInput: { min: 1, max: 128 } }}
            />
            <TextField
              label={t('templates.deploy.hardware.memory')}
              type="number"
              value={hardware.memory}
              onChange={e => setHardware(h => ({ ...h, memory: Number.parseInt(e.target.value) || 512 }))}
              size="small"
              helperText="MB"
              slotProps={{ htmlInput: { min: 128, step: 256 } }}
            />
            <TextField
              label={t('templates.deploy.hardware.diskSize')}
              value={hardware.diskSize}
              onChange={e => setHardware(h => ({ ...h, diskSize: e.target.value }))}
              size="small"
            />
            <TextField
              label={t('templates.deploy.hardware.bridge')}
              value={hardware.networkBridge}
              onChange={e => setHardware(h => ({ ...h, networkBridge: e.target.value }))}
              size="small"
            />
          </Box>

          {/* Cloud-init section */}
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {t('templates.blueprints.cloudInitSection')}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              {t('templates.blueprints.cloudInitHelp')}
            </Typography>
            <Stack spacing={1.5}>
              <TextField
                label={t('templates.deploy.cloudInit.user')}
                value={cloudInit.ciuser}
                onChange={e => setCloudInit(ci => ({ ...ci, ciuser: e.target.value }))}
                size="small"
                fullWidth
              />
              <TextField
                label={t('templates.deploy.cloudInit.sshKeys')}
                value={cloudInit.sshKeys}
                onChange={e => setCloudInit(ci => ({ ...ci, sshKeys: e.target.value }))}
                size="small"
                fullWidth
                multiline
                rows={2}
              />
              <TextField
                label={t('templates.deploy.cloudInit.ipConfig')}
                value={cloudInit.ipconfig0}
                onChange={e => setCloudInit(ci => ({ ...ci, ipconfig0: e.target.value }))}
                size="small"
                fullWidth
                helperText={t('templates.deploy.cloudInit.ipConfigHelp')}
              />
              <TextField
                label={t('templates.deploy.cloudInit.nameserver')}
                value={cloudInit.nameserver}
                onChange={e => setCloudInit(ci => ({ ...ci, nameserver: e.target.value }))}
                size="small"
                fullWidth
              />
              <TextField
                label={t('templates.deploy.cloudInit.searchdomain')}
                value={cloudInit.searchdomain}
                onChange={e => setCloudInit(ci => ({ ...ci, searchdomain: e.target.value }))}
                size="small"
                fullWidth
              />
            </Stack>
          </Box>

          <TextField
            label={t('common.tags')}
            value={tags}
            onChange={e => setTags(e.target.value)}
            size="small"
            helperText={t('templates.blueprints.tagsHelp')}
          />

          <FormControlLabel
            control={<Switch checked={isPublic} onChange={(_, v) => setIsPublic(v)} size="small" />}
            label={t('templates.blueprints.public')}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose()}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || !name.trim() || !imageSlug}
        >
          {saving ? <CircularProgress size={20} /> : t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
