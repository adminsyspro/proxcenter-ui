'use client'

import { useEffect, useMemo, useState } from 'react'

import { useTranslations } from 'next-intl'
import {
  Box,
  Button,
  TextField,
  InputAdornment,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'

import type { CloudImage } from '@/lib/templates/cloudImages'
import { VENDORS } from '@/lib/templates/cloudImages'
import ImageCard from './ImageCard'
import VendorLogo from './VendorLogo'
import EmptyState from '@/components/EmptyState'
import CustomImageDialog from './CustomImageDialog'
import { useTenant } from '@/contexts/TenantContext'

interface ImageCatalogTabProps {
  onDeploy: (image: CloudImage) => void
}

export default function ImageCatalogTab({ onDeploy }: ImageCatalogTabProps) {
  const t = useTranslations()

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

  const fetchCatalog = () => {
    fetch('/api/v1/templates/catalog')
      .then(r => r.json())
      .then(res => {
        setImages(res.data?.images || [])
        if (res.data?.vendors) setVendors(res.data.vendors)
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
        <Box sx={{ ml: 'auto' }}>
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
          {filtered.map(image => {
            // The image is mutable for the caller iff it's a custom image
            // they own. The provider can mutate everything (including
            // shared catalogue entries it published itself); a tenant
            // can only mutate its own private images, never the shared
            // provider entries it sees through the catalogue.
            const isShared = !!(image as any).isShared
            const canMutate = !!(image as any).isCustom && (isProviderTenant || !isShared)


return (
              <ImageCard
                key={image.slug}
                image={image}
                onDeploy={onDeploy}
                isCustom={!!(image as any).isCustom}
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
