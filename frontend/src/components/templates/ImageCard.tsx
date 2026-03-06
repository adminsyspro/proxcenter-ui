'use client'

import { Box, Card, CardContent, Chip, Typography, Button, Tooltip, IconButton } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { CloudImage } from '@/lib/templates/cloudImages'
import VendorLogo from './VendorLogo'

interface ImageCardProps {
  image: CloudImage
  onDeploy: (image: CloudImage) => void
  isCustom?: boolean
  onEdit?: (image: CloudImage) => void
  onDelete?: (image: CloudImage) => void
}

export default function ImageCard({ image, onDeploy, isCustom, onEdit, onDelete }: ImageCardProps) {
  const t = useTranslations()

  const sourceLabel = (image as any).sourceType === 'volume'
    ? (image as any).volumeId || 'volume'
    : (() => { try { return new URL(image.downloadUrl).hostname } catch { return image.downloadUrl } })()

  return (
    <Card
      variant="outlined"
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        transition: 'border-color 0.2s, box-shadow 0.2s',
        '&:hover': {
          borderColor: 'primary.main',
          boxShadow: (theme) => `0 0 0 1px ${theme.palette.primary.main}22`,
        },
      }}
    >
      <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1.5, p: 2 }}>
        {/* Header: icon + name + custom actions */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <VendorLogo vendor={image.vendor} size={36} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, lineHeight: 1.3 }} noWrap>
              {image.name}
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.6 }}>
              {image.arch} &middot; {image.format}
              {isCustom && (
                <>
                  {' '}&middot;{' '}
                  <Chip
                    label={(image as any).sourceType === 'volume' ? t('templates.catalog.volume') : t('templates.catalog.customLabel')}
                    size="small"
                    color={(image as any).sourceType === 'volume' ? 'info' : 'secondary'}
                    sx={{ height: 16, fontSize: '0.6rem', ml: 0.5 }}
                  />
                </>
              )}
            </Typography>
          </Box>
          {isCustom && (
            <Box sx={{ display: 'flex', flexShrink: 0 }}>
              {onEdit && (
                <IconButton size="small" onClick={() => onEdit(image)} sx={{ opacity: 0.5, '&:hover': { opacity: 1 } }}>
                  <i className="ri-edit-line" style={{ fontSize: 14 }} />
                </IconButton>
              )}
              {onDelete && (
                <IconButton size="small" onClick={() => onDelete(image)} sx={{ opacity: 0.5, '&:hover': { opacity: 1, color: 'error.main' } }}>
                  <i className="ri-delete-bin-line" style={{ fontSize: 14 }} />
                </IconButton>
              )}
            </Box>
          )}
        </Box>

        {/* Tags */}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {image.tags.map(tag => (
            <Chip
              key={tag}
              label={tag}
              size="small"
              sx={{ height: 20, fontSize: '0.65rem' }}
            />
          ))}
        </Box>

        {/* Specs */}
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5, mt: 'auto' }}>
          <Typography variant="caption" sx={{ opacity: 0.6 }}>
            <i className="ri-cpu-line" style={{ fontSize: 12, marginRight: 4 }} />
            {image.recommendedCores} {t('templates.catalog.cores')}
          </Typography>
          <Typography variant="caption" sx={{ opacity: 0.6 }}>
            <i className="ri-ram-line" style={{ fontSize: 12, marginRight: 4 }} />
            {image.recommendedMemory >= 1024
              ? `${image.recommendedMemory / 1024} GB`
              : `${image.recommendedMemory} MB`}
          </Typography>
          <Typography variant="caption" sx={{ opacity: 0.6 }}>
            <i className="ri-hard-drive-3-line" style={{ fontSize: 12, marginRight: 4 }} />
            {image.defaultDiskSize}
          </Typography>
          <Typography variant="caption" sx={{ opacity: 0.6 }}>
            <i className="ri-terminal-box-line" style={{ fontSize: 12, marginRight: 4 }} />
            {image.ostype}
          </Typography>
        </Box>

        {/* Source */}
        <Tooltip title={(image as any).sourceType === 'volume' ? ((image as any).volumeId || '') : image.downloadUrl} arrow>
          <Typography
            variant="caption"
            {...((image as any).sourceType !== 'volume' && image.downloadUrl ? {
              component: 'a' as const,
              href: image.downloadUrl,
              target: '_blank',
              rel: 'noopener noreferrer',
            } : {})}
            sx={{
              opacity: 0.5,
              fontSize: '0.6rem',
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              textDecoration: 'none',
              color: 'text.secondary',
              '&:hover': { opacity: 0.8, color: 'primary.main' },
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            <i className={(image as any).sourceType === 'volume' ? 'ri-hard-drive-2-line' : 'ri-external-link-line'} style={{ fontSize: 10, flexShrink: 0 }} />
            {sourceLabel}
          </Typography>
        </Tooltip>

        {/* Deploy button */}
        <Tooltip title={t('templates.catalog.deployTooltip')}>
          <Button
            variant="contained"
            size="small"
            fullWidth
            onClick={() => onDeploy(image)}
            startIcon={<i className="ri-rocket-2-line" style={{ fontSize: 16 }} />}
            sx={{ mt: 1 }}
          >
            {t('templates.catalog.deploy')}
          </Button>
        </Tooltip>
      </CardContent>
    </Card>
  )
}
