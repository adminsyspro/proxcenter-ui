'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import {
  Box,
  Button,
  TextField,
  InputAdornment,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'

import type { CloudImage } from '@/lib/templates/cloudImages'
import { VENDORS } from '@/lib/templates/cloudImages'
import type { CatalogMeta } from '@/lib/templates/catalogSchema'
import ImageCard from './ImageCard'
import VendorLogo from './VendorLogo'
import EmptyState from '@/components/EmptyState'
import CustomImageDialog from './CustomImageDialog'
import { useTenant } from '@/contexts/TenantContext'
import { useRBAC } from '@/contexts/RBACContext'
import { useToast } from '@/contexts/ToastContext'

interface ImageCatalogTabProps {
  onDeploy: (image: CloudImage) => void
}

interface ImageGroup {
  key: string
  /** Distribution name for a grouped card, image name for a custom one. */
  title: string
  versions: (CloudImage & { isCustom?: boolean })[]
  isCustom: boolean
}

/**
 * Newest first. Numeric segments compare as numbers, so 10 beats 9 and 24.10
 * beats 24.04; a version with no digits at all (Arch's "rolling") sorts last.
 */
function compareVersionsDesc(a: CloudImage, b: CloudImage): number {
  const parse = (v: string) => (String(v).match(/\d+/g) ?? []).map(Number)
  const av = parse(a.version)
  const bv = parse(b.version)
  if (!av.length || !bv.length) return av.length === bv.length ? 0 : av.length ? -1 : 1
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const diff = (bv[i] ?? 0) - (av[i] ?? 0)
    if (diff !== 0) return diff
  }

  return 0
}

export default function ImageCatalogTab({ onDeploy }: ImageCatalogTabProps) {
  const t = useTranslations()
  const locale = useLocale()
  const rbac = useRBAC()
  const { showToast } = useToast()
  // Anyone can add their own private custom image (kept tenant-scoped via
  // the prisma extension on the API). Edit/Delete on a card is per-image:
  // available on images that belong to the caller, hidden on shared
  // catalogue entries published by the provider (which a tenant must not
  // mutate).
  const { currentTenant, loading: tenantLoading } = useTenant()
  const isProviderTenant = !tenantLoading && currentTenant?.id === 'default'
  const [images, setImages] = useState<(CloudImage & { isCustom?: boolean })[]>([])
  const [vendors, setVendors] = useState(VENDORS as readonly { id: string; name: string; icon: string }[])
  const [loading, setLoading] = useState(true)
  const [vendorFilter, setVendorFilter] = useState<string>('all')
  // Format facet — split the catalog into unattended cloud images and
  // boot ISOs (manual installer). 'all' is the default; ISOs were rare
  // enough until now that the facet stays compact (3 buttons).
  const [formatFilter, setFormatFilter] = useState<'all' | 'cloud' | 'iso'>('all')
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editImage, setEditImage] = useState<any>(null)
  // Where the built-in list comes from (remote JSON or the embedded copy)
  // and when it was last checked. Null until the first catalog response.
  const [meta, setMeta] = useState<CatalogMeta | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const fetchCatalog = () => {
    fetch('/api/v1/templates/catalog')
      .then(r => r.json())
      .then(res => {
        setImages(res.data?.images || [])
        if (res.data?.vendors) setVendors(res.data.vendors)
        setMeta(res.data?.meta ?? null)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }

  useEffect(() => { fetchCatalog() }, [])

  const filtered = useMemo(() => {
    let result = images
    if (vendorFilter !== 'all') {
      result = result.filter(img => img.vendor === vendorFilter)
    }
    if (formatFilter !== 'all') {
      result = result.filter(img => {
        const isIso = String(img.format || '').toLowerCase() === 'iso'
        return formatFilter === 'iso' ? isIso : !isIso
      })
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(img =>
        img.name.toLowerCase().includes(q) ||
        img.vendor.toLowerCase().includes(q) ||
        img.tags.some(tag => tag.toLowerCase().includes(q))
      )
    }
    return result
  }, [images, vendorFilter, formatFilter, search])

  // One card per distribution rather than per image: the versions of a distro
  // collapse into a single card whose picker defaults to the newest, so an old
  // release no longer competes for attention with the one people should take.
  // Groups are built from the FILTERED list, so searching "22.04" leaves the
  // Ubuntu card with that version alone, already selected.
  const groups = useMemo(() => {
    const byVendor = new Map<string, ImageGroup>()
    const out: ImageGroup[] = []
    for (const image of filtered) {
      if (image.isCustom) {
        // Custom images stay one card each: they carry their own edit and
        // delete actions and have no version lineage to collapse.
        out.push({ key: `custom:${image.slug}`, title: image.name, versions: [image], isCustom: true })
        continue
      }
      const existing = byVendor.get(image.vendor)
      if (existing) {
        existing.versions.push(image)
        continue
      }
      const group: ImageGroup = { key: `builtin:${image.vendor}`, title: '', versions: [image], isCustom: false }
      byVendor.set(image.vendor, group)
      out.push(group)
    }
    for (const group of byVendor.values()) {
      group.versions.sort(compareVersionsDesc)
      const vendorId = group.versions[0].vendor
      group.title = vendors.find(v => v.id === vendorId)?.name ?? vendorId
    }

    return out
  }, [filtered, vendors])

  const handleDialogClose = (saved?: boolean) => {
    setDialogOpen(false)
    setEditImage(null)
    if (saved) fetchCatalog()
  }

  const handleEdit = (image: any) => {
    // Fetch full custom image data from API
    if (!image.isCustom) return
    fetch(`/api/v1/templates/custom-images`)
      .then(r => r.json())
      .then(res => {
        const match = (res.data || []).find((ci: any) => ci.slug === image.slug)
        if (match) {
          setEditImage(match)
          setDialogOpen(true)
        }
      })
      .catch(() => {})
  }

  const handleDelete = async (image: any) => {
    if (!image.isCustom) return
    // Find the custom image ID
    const res = await fetch('/api/v1/templates/custom-images').then(r => r.json())
    const match = (res.data || []).find((ci: any) => ci.slug === image.slug)
    if (!match) return
    await fetch(`/api/v1/templates/custom-images/${match.id}`, { method: 'DELETE' })
    fetchCatalog()
  }

  // Provider admin only: the catalog is global, so a tenant never sees the
  // button, and a provider user needs admin.settings (the same gate the
  // route enforces server-side).
  const canRefresh = isProviderTenant && rbac.hasPermission('admin.settings')

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      const res = await fetch('/api/v1/templates/catalog/refresh', { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      const out = json?.data
      if (!res.ok || !out) {
        showToast(t('templates.catalog.refreshFailed', { error: json?.error || `HTTP ${res.status}` }), 'error')
      } else if (out.result === 'error') {
        showToast(t('templates.catalog.refreshFailed', { error: out.error || '' }), 'error')
      } else if (out.result === 'updated') {
        showToast(t('templates.catalog.refreshUpdated', {
          added: out.added?.length ?? 0,
          updated: out.updated?.length ?? 0,
          removed: out.removed?.length ?? 0,
        }), 'success')
      } else {
        showToast(t('templates.catalog.refreshUpToDate'), 'info')
      }
    } catch (e: any) {
      showToast(t('templates.catalog.refreshFailed', { error: e?.message || String(e) }), 'error')
    } finally {
      setRefreshing(false)
      fetchCatalog()
    }
  }

  const formatCheckedAt = (iso: string) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(locale)
  }

  // "Catalog from <date>, checked <date>": shown as the tooltip of the
  // refresh button rather than inline, the toolbar row is crowded enough.
  const statusText = meta
    ? `${t('templates.catalog.catalogFrom', { date: meta.catalogUpdatedAt })}, ${meta.lastCheckedAt
      ? t('templates.catalog.lastChecked', { date: formatCheckedAt(meta.lastCheckedAt) })
      : t('templates.catalog.neverChecked')}`
    : ''

  if (loading) {
    return (
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 2, p: 2 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Box
            key={i}
            sx={{ height: 220, borderRadius: 2, bgcolor: 'action.hover', animation: 'pulse 1.5s infinite' }}
          />
        ))}
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 2 }}>
      {/* Filters */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <TextField
          size="small"
          placeholder={t('templates.catalog.search')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <i className="ri-search-line" style={{ fontSize: 18, opacity: 0.5 }} />
                </InputAdornment>
              ),
            },
          }}
          sx={{ minWidth: 240 }}
        />
        <ToggleButtonGroup
          size="small"
          value={vendorFilter}
          exclusive
          onChange={(_, v) => v && setVendorFilter(v)}
        >
          <ToggleButton value="all">
            <Typography variant="caption">{t('common.all')}</Typography>
          </ToggleButton>
          {vendors.map(v => (
            <ToggleButton key={v.id} value={v.id} sx={{ gap: 0.5 }}>
              <VendorLogo vendor={v.id} size={18} />
              <Typography variant="caption">{v.name}</Typography>
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        <ToggleButtonGroup
          size="small"
          value={formatFilter}
          exclusive
          onChange={(_, v) => v && setFormatFilter(v)}
        >
          <ToggleButton value="all">
            <Typography variant="caption">{t('common.all')}</Typography>
          </ToggleButton>
          <ToggleButton value="cloud" sx={{ gap: 0.5 }}>
            <Box component="i" className="ri-cloud-line" sx={{ fontSize: 14 }} />
            <Typography variant="caption">{t('templates.catalog.formatCloudChip')}</Typography>
          </ToggleButton>
          <ToggleButton value="iso" sx={{ gap: 0.5 }}>
            <Box component="i" className="ri-disc-line" sx={{ fontSize: 14 }} />
            <Typography variant="caption">{t('templates.catalog.formatIsoChip')}</Typography>
          </ToggleButton>
        </ToggleButtonGroup>
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          {meta && meta.lastResult === 'error' && (() => {
            // Keyed on lastResult, not on the source: once a valid remote
            // catalog is stored it keeps being served after a failure, so
            // source stays 'remote' and the only persistent sign of trouble
            // would otherwise never appear. The wording follows: falling back
            // to the embedded catalog and serving a stale remote one are two
            // different situations. lastError is null for a tenant.
            const warning = meta.source === 'embedded'
              ? t('templates.catalog.embeddedFallback', { error: meta.lastError ?? '' })
              : t('templates.catalog.refreshStale', { error: meta.lastError ?? '' })

            return (
              <Tooltip title={warning}>
                <Box
                  component="i"
                  className="ri-alert-line"
                  aria-label={warning}
                  sx={{ fontSize: 18, color: 'warning.main', display: 'inline-flex' }}
                />
              </Tooltip>
            )
          })()}
          {meta && !canRefresh && (
            // Without the refresh button there is no tooltip to carry the
            // status, so it stays inline for read-only users.
            <Typography variant="caption" color="text.secondary" component="span">
              {statusText}
            </Typography>
          )}
          {canRefresh && (
            // describeChild keeps the button's accessible name on its label;
            // the span lets the tooltip open while the button is disabled.
            <Tooltip title={statusText} describeChild>
              <span>
                <Button
                  variant="outlined"
                  size="small"
                  disabled={refreshing}
                  startIcon={<i className="ri-refresh-line" style={{ fontSize: 16 }} />}
                  onClick={handleRefresh}
                >
                  {t('templates.catalog.checkUpdates')}
                </Button>
              </span>
            </Tooltip>
          )}
          <Button
            variant="outlined"
            size="small"
            startIcon={<i className="ri-add-line" style={{ fontSize: 16 }} />}
            onClick={() => { setEditImage(null); setDialogOpen(true) }}
          >
            {t('templates.catalog.addCustom')}
          </Button>
        </Box>
      </Box>

      {/* Image grid */}
      {filtered.length === 0 ? (
        <EmptyState
          icon="ri-cloud-line"
          title={t('templates.catalog.noImages')}
          description={t('templates.catalog.noImagesDesc')}
          size="medium"
        />
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 2,
          }}
        >
          {groups.map(group => {
            // The image is mutable for the caller iff it's a custom image
            // they own. The provider can mutate everything (including
            // shared catalogue entries it published itself); a tenant
            // can only mutate its own private images, never the shared
            // provider entries it sees through the catalogue.
            const isShared = !!(group.versions[0] as any).isShared
            const canMutate = group.isCustom && (isProviderTenant || !isShared)
            return (
              <ImageCard
                key={group.key}
                versions={group.versions}
                title={group.title}
                onDeploy={onDeploy}
                isCustom={group.isCustom}
                onEdit={canMutate ? handleEdit : undefined}
                onDelete={canMutate ? handleDelete : undefined}
              />
            )
          })}
        </Box>
      )}

      <CustomImageDialog
        open={dialogOpen}
        onClose={handleDialogClose}
        editData={editImage}
      />
    </Box>
  )
}
