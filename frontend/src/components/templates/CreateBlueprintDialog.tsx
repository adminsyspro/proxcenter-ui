'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  ListSubheader,
  MenuItem,
  Select,
  Slider,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'

import { CLOUD_IMAGES } from '@/lib/templates/cloudImages'
import type { CatalogImage } from '@/lib/templates/blueprintImages'
import { splitCatalogImages, hasMeaningfulCloudInit } from '@/lib/templates/blueprintImages'
import { buildDeployIpconfig0, parseIpconfig0 } from '@/lib/templates/deployIpconfig'
import type { NetworkOption } from '@/lib/templates/networkOptions'
import { useToast } from '@/contexts/ToastContext'
import { useTenant } from '@/contexts/TenantContext'
import VendorLogo from './VendorLogo'

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
  const { isProvider } = useTenant()
  const [saving, setSaving] = useState(false)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [imageSlug, setImageSlug] = useState('')
  const [tags, setTags] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [hardware, setHardware] = useState({ ...defaultHardware })
  const [cloudInit, setCloudInit] = useState({ ...defaultCloudInit })

  // Decomposed IP state
  const [useDhcp, setUseDhcp] = useState(true)
  const [manualIpCidr, setManualIpCidr] = useState('')
  const [manualGateway, setManualGateway] = useState('')
  const [ipCidrTouched, setIpCidrTouched] = useState(false)
  const [gatewayTouched, setGatewayTouched] = useState(false)

  // Catalog images fetched on dialog open
  const [catalogImages, setCatalogImages] = useState<CatalogImage[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)

  // Network options fetched on dialog open (VDC VNets)
  const [networkOptions, setNetworkOptions] = useState<NetworkOption[]>([])

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

      // Decompose the stored ipconfig0 into structured fields
      const p = parseIpconfig0((ci?.ipconfig0) || 'ip=dhcp')
      setUseDhcp(p.useDhcp || !p.manualIpCidr)
      setManualIpCidr(p.manualIpCidr)
      setManualGateway(p.manualGateway)
      setIpCidrTouched(false)
      setGatewayTouched(false)
    } else {
      setName('')
      setDescription('')
      setImageSlug(CLOUD_IMAGES[0]?.slug || '')
      setTags('')
      setIsPublic(true)
      setHardware({ ...defaultHardware })
      setCloudInit({ ...defaultCloudInit })
      setUseDhcp(true)
      setManualIpCidr('')
      setManualGateway('')
      setIpCidrTouched(false)
      setGatewayTouched(false)
    }
  }, [open, blueprint])

  // Keep cloudInit.ipconfig0 in sync with the decomposed IP state
  useEffect(() => {
    setCloudInit(ci => ({
      ...ci,
      ipconfig0: buildDeployIpconfig0({ subnet: null, ipOverride: '', manualIpCidr, manualGateway, useDhcp }),
    }))
  }, [useDhcp, manualIpCidr, manualGateway])

  // Fetch the catalog on each open so custom images always appear.
  // Falls back to CLOUD_IMAGES if the fetch fails.
  useEffect(() => {
    if (!open) return
    setCatalogLoading(true)
    setCatalogImages([])
    fetch('/api/v1/templates/catalog')
      .then(r => {
        if (!r.ok) throw new Error('catalog fetch failed')
        return r.json()
      })
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

  // Fetch network options (vDC VNets) on each open. On failure, leave empty
  // so the field still works as free text.
  useEffect(() => {
    if (!open) return
    setNetworkOptions([])
    fetch('/api/v1/templates/network-options')
      .then(r => {
        if (!r.ok) throw new Error('network-options fetch failed')
        return r.json()
      })
      .then(res => {
        setNetworkOptions(res.data?.options || [])
      })
      .catch(() => {
        // Leave empty — field operates as free-text fallback.
      })
  }, [open])

  const { builtIn, custom } = splitCatalogImages(catalogImages)

  // IP validation (mirrors DeployWizard)
  const ipCidrValid = /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(manualIpCidr.trim())
  const gatewayValid = !manualGateway.trim() || /^\d{1,3}(\.\d{1,3}){3}$/.test(manualGateway.trim())

  const handleSave = useCallback(async () => {
    if (!name.trim() || !imageSlug) return
    if (!useDhcp && !ipCidrValid) return
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
  }, [name, description, imageSlug, hardware, cloudInit, tags, isPublic, blueprint, onClose, showToast, t, useDhcp, ipCidrValid])

  // Disk size as integer GB
  const diskGb = Number.parseInt(hardware.diskSize) || 20

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
                <ListSubheader>{t('templates.catalog.builtInLabel')}</ListSubheader>
              )}
              {builtIn.map(img => (
                <MenuItem key={img.slug} value={img.slug}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <VendorLogo vendor={img.vendor || 'custom'} size={20} />
                    <span>{img.name}</span>
                  </Box>
                </MenuItem>
              ))}
              {custom.length > 0 && (
                <ListSubheader>{t('templates.catalog.customLabel')}</ListSubheader>
              )}
              {custom.map(img => (
                <MenuItem key={img.slug} value={img.slug}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <VendorLogo vendor={img.vendor || 'custom'} size={20} />
                    <span>{img.name}</span>
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Hardware section — sliders + synced numeric inputs */}
          <Stack spacing={1.5}>
            {/* CPU cores */}
            <Box>
              <Typography variant="caption" color="text.secondary">
                {t('templates.deploy.hardware.cores')}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 0.5 }}>
                <Slider
                  size="small"
                  min={1}
                  max={32}
                  step={1}
                  value={Math.min(hardware.cores, 32)}
                  onChange={(_, v) => setHardware(h => ({ ...h, cores: v as number }))}
                  sx={{ flex: 1 }}
                />
                <TextField
                  type="number"
                  size="small"
                  value={hardware.cores}
                  onChange={e => setHardware(h => ({ ...h, cores: Number.parseInt(e.target.value) || 1 }))}
                  sx={{ width: 92 }}
                  slotProps={{ htmlInput: { min: 1, max: 128 } }}
                />
              </Box>
            </Box>

            {/* Memory */}
            <Box>
              <Typography variant="caption" color="text.secondary">
                {t('templates.deploy.hardware.memory')}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 0.5 }}>
                <Slider
                  size="small"
                  min={512}
                  max={32768}
                  step={512}
                  value={Math.min(hardware.memory, 32768)}
                  onChange={(_, v) => setHardware(h => ({ ...h, memory: v as number }))}
                  valueLabelDisplay="auto"
                  valueLabelFormat={(v) => `${v / 1024} GB`}
                  sx={{ flex: 1 }}
                />
                <TextField
                  type="number"
                  size="small"
                  value={hardware.memory}
                  onChange={e => setHardware(h => ({ ...h, memory: Number.parseInt(e.target.value) || 128 }))}
                  sx={{ width: 92 }}
                  helperText="MB"
                  slotProps={{ htmlInput: { min: 128, step: 256 } }}
                />
              </Box>
            </Box>

            {/* Disk size */}
            <Box>
              <Typography variant="caption" color="text.secondary">
                {t('templates.deploy.hardware.diskSize')}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 0.5 }}>
                <Slider
                  size="small"
                  min={10}
                  max={500}
                  step={5}
                  value={Math.min(diskGb, 500)}
                  onChange={(_, v) => setHardware(h => ({ ...h, diskSize: `${v as number}G` }))}
                  sx={{ flex: 1 }}
                />
                <TextField
                  type="number"
                  size="small"
                  value={diskGb}
                  onChange={e => {
                    const gb = Number.parseInt(e.target.value) || 1
                    setHardware(h => ({ ...h, diskSize: `${gb}G` }))
                  }}
                  sx={{ width: 92 }}
                  helperText="GB"
                  slotProps={{ htmlInput: { min: 1 } }}
                />
              </Box>
            </Box>

            {/* Network bridge — freeSolo Autocomplete (vDC VNets or typed bridge) */}
            <Autocomplete
              freeSolo
              size="small"
              options={networkOptions}
              getOptionLabel={(o) => typeof o === 'string'
                ? o
                : (o.subnet ? `${o.displayName} (${o.subnet.cidr})` : o.displayName)}
              isOptionEqualToValue={(o, v) =>
                (typeof o === 'string' ? o : o.pveName) === (typeof v === 'string' ? v : v.pveName)}
              value={networkOptions.find(o => o.pveName === hardware.networkBridge) ?? hardware.networkBridge}
              onChange={(_, v) => setHardware(h => ({
                ...h,
                networkBridge: v == null ? '' : typeof v === 'string' ? v : v.pveName,
              }))}
              renderOption={(props, o) => {
                const { key, ...optionProps } = props as any
                return (
                  <li key={key ?? (typeof o === 'string' ? o : o.pveName)} {...optionProps}>
                    <Box>
                      <Typography variant="body2">{typeof o === 'string' ? o : o.displayName}</Typography>
                      {typeof o !== 'string' && o.subnet && (
                        <Typography variant="caption" color="text.secondary">
                          {o.subnet.cidr}
                        </Typography>
                      )}
                    </Box>
                  </li>
                )
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={t('templates.deploy.hardware.bridge')}
                  helperText={t('templates.blueprints.bridgeHelp')}
                />
              )}
              sx={{ alignSelf: 'flex-start', width: 280 }}
            />
          </Stack>

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

              {/* Decomposed IP config: DHCP switch + static fields */}
              <Stack spacing={1}>
                <FormControlLabel
                  control={<Switch checked={useDhcp} onChange={(_, v) => setUseDhcp(v)} size="small" />}
                  label={t('templates.deploy.cloudInit.useDhcp')}
                />
                {!useDhcp && (
                  <>
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                      <TextField
                        size="small"
                        label={t('templates.deploy.cloudInit.ipCidr')}
                        value={manualIpCidr}
                        onChange={e => { setManualIpCidr(e.target.value.trim()); setIpCidrTouched(true) }}
                        placeholder="10.0.1.4/25"
                        error={ipCidrTouched && !ipCidrValid}
                        helperText={ipCidrTouched && !ipCidrValid
                          ? t('templates.deploy.cloudInit.ipCidrInvalid')
                          : t('templates.deploy.cloudInit.ipCidrHelp')}
                        fullWidth
                      />
                      <TextField
                        size="small"
                        label={t('templates.deploy.cloudInit.gateway')}
                        value={manualGateway}
                        onChange={e => { setManualGateway(e.target.value.trim()); setGatewayTouched(true) }}
                        placeholder="10.0.1.253"
                        error={gatewayTouched && !gatewayValid}
                        helperText={gatewayTouched && !gatewayValid
                          ? t('templates.deploy.cloudInit.gatewayInvalid')
                          : t('templates.deploy.cloudInit.gatewayManualHelp')}
                        fullWidth
                      />
                    </Box>
                    <Typography variant="caption" color="warning.main">
                      {t('templates.blueprints.staticIpWarning')}
                    </Typography>
                  </>
                )}
              </Stack>

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

          {isProvider && (
            <FormControlLabel
              control={<Switch checked={isPublic} onChange={(_, v) => setIsPublic(v)} size="small" />}
              label={t('templates.blueprints.public')}
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose()}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || !name.trim() || !imageSlug || (!useDhcp && !ipCidrValid)}
        >
          {saving ? <CircularProgress size={20} /> : t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
