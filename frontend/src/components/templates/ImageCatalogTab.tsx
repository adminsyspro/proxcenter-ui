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

interface ImageCatalogTabProps {
  onDeploy: (image: CloudImage) => void
}

export default function ImageCatalogTab({ onDeploy }: ImageCatalogTabProps) {
  const t = useTranslations()
  const [images, setImages] = useState<(CloudImage & { isCustom?: boolean })[]>([])
  const [vendors, setVendors] = useState(VENDORS as readonly { id: string; name: string; icon: string }[])
  const [loading, setLoading] = useState(true)
  const [vendorFilter, setVendorFilter] = useState<string>('all')
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
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(img =>
        img.name.toLowerCase().includes(q) ||
        img.vendor.toLowerCase().includes(q) ||
        img.tags.some(tag => tag.toLowerCase().includes(q))
      )
    }
    return result
  }, [images, vendorFilter, search])

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
          {filtered.map(image => (
            <ImageCard
              key={image.slug}
              image={image}
              onDeploy={onDeploy}
              isCustom={!!(image as any).isCustom}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))}
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
