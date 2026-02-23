'use client'

import { Box, Card, CardContent, Chip, Typography, Button, Tooltip } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { CloudImage } from '@/lib/templates/cloudImages'
import VendorLogo from './VendorLogo'

interface ImageCardProps {
  image: CloudImage
  onDeploy: (image: CloudImage) => void
}

export default function ImageCard({ image, onDeploy }: ImageCardProps) {
  const t = useTranslations()

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
        {/* Header: icon + name */}
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
            </Typography>
          </Box>
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
