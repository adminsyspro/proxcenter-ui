'use client'

import { useState } from 'react'
import { Box, Card, CardContent, Chip, Typography, Button, Tooltip, IconButton, Menu, MenuItem } from '@mui/material'
import { useLocale, useTranslations } from 'next-intl'

import type { CloudImage } from '@/lib/templates/cloudImages'
import VendorLogo from './VendorLogo'

interface ImageCardProps {
  /** Every version of one distribution, newest first, or a single image. */
  versions: CloudImage[]
  /** Distribution name, shown in place of the image name when there are several. */
  title?: string
  onDeploy: (image: CloudImage) => void
  isCustom?: boolean
  onEdit?: (image: CloudImage) => void
  onDelete?: (image: CloudImage) => void
}

export default function ImageCard({ versions, title, onDeploy, isCustom, onEdit, onDelete }: ImageCardProps) {
  const t = useTranslations()
  const locale = useLocale()
  const [picked, setPicked] = useState<string | null>(null)
  const [versionAnchor, setVersionAnchor] = useState<HTMLElement | null>(null)

  // Derived, not synchronised: when a filter narrows the group down and drops
  // the picked version, the newest remaining one takes over on its own. An
  // effect resetting the state here would fire on every list identity change.
  const image = versions.find(v => v.slug === picked) ?? versions[0]
  const hasVersionChoice = versions.length > 1
  // Every built-in card carries its version in the same slot, so a single
  // version distribution (Arch, which is a rolling release) reads like the
  // others instead of hiding its version in the title.
  const showVersion = !isCustom

  // MUI's Select reserves a 32px well for its own arrow and fights any attempt
  // to tighten it, so the picker is a pill plus a menu: same chip vocabulary as
  // the rest of the card, and the spacing is ours.
  const versionPillSx = {
    flexShrink: 0,
    px: 1,
    py: 0.25,
    minWidth: 0,
    borderRadius: 1.5,
    bgcolor: 'action.hover',
    color: 'text.secondary',
    fontSize: '0.7rem',
    fontWeight: 600,
    lineHeight: 1.6,
  } as const

  // Build identity of the file behind a rolling download URL, probed from the
  // mirror once a day. Absent on custom images and wherever the probe came
  // back empty, and the card then reads exactly as it did before.
  const buildDate = (() => {
    if (!image.buildDate) return null
    const d = new Date(image.buildDate)

    return Number.isNaN(d.getTime()) ? image.buildDate : d.toLocaleDateString(locale)
  })()

  if (!image) return null

  const sourceLabel = (image as any).sourceType === 'volume'
    ? (image as any).volumeId || 'volume'
    : (() => { try { return new URL(image.downloadUrl).hostname } catch { return image.downloadUrl } })()

  // ISO install media is rendered with a clearly different cue than cloud
  // images: distinct icon + chip so the tenant sees at a glance whether
  // they're picking an unattended cloud-init image or boot media that
  // requires a manual install.
  const isIso = String(image.format || '').toLowerCase() === 'iso'

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
              {showVersion ? (title ?? image.name) : image.name}
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.6 }}>
              {image.arch} &middot; {image.format}
              {image.release && <> &middot; {image.release}</>}
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
          {showVersion && (hasVersionChoice ? (
            <>
              <Button
                size="small"
                aria-label={t('templates.catalog.versionLabel')}
                onClick={e => setVersionAnchor(e.currentTarget)}
                endIcon={<Box component="i" className="ri-arrow-down-s-line" sx={{ fontSize: 14 }} />}
                sx={{
                  ...versionPillSx,
                  textTransform: 'none',
                  '&:hover': { bgcolor: 'action.selected' },
                  '& .MuiButton-endIcon': { ml: 0.25, mr: -0.5 },
                }}
              >
                {image.version}
              </Button>
              <Menu
                anchorEl={versionAnchor}
                open={!!versionAnchor}
                onClose={() => setVersionAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              >
                {/* The menu carries the full image name, the pill only the version. */}
                {versions.map(v => (
                  <MenuItem
                    key={v.slug}
                    selected={v.slug === image.slug}
                    onClick={() => { setPicked(v.slug); setVersionAnchor(null) }}
                    sx={{ fontSize: '0.8rem' }}
                  >
                    {v.name}
                  </MenuItem>
                ))}
              </Menu>
            </>
          ) : (
            <Box sx={{ ...versionPillSx, display: 'inline-flex', alignItems: 'center' }}>
              {image.version}
            </Box>
          ))}
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

        {/* Tags + format chip. The format chip is the primary signal —
            'Manual install' (ISO) vs 'Cloud-init' (qcow2/raw/…). It sits
            first so it's the eye's first stop in the chip row. */}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          <Chip
            icon={<Box component="i" className={isIso ? 'ri-disc-line' : 'ri-cloud-line'} sx={{ fontSize: 12, ml: 0.5 }} />}
            label={isIso ? t('templates.catalog.formatIsoChip') : t('templates.catalog.formatCloudChip')}
            size="small"
            color={isIso ? 'warning' : 'info'}
            variant="outlined"
            sx={{ height: 20, fontSize: '0.65rem', '& .MuiChip-icon': { color: 'inherit' } }}
          />
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

        {/* Source, and the build date of the file it points at */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
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
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              <i className={(image as any).sourceType === 'volume' ? 'ri-hard-drive-2-line' : 'ri-external-link-line'} style={{ fontSize: 10, flexShrink: 0 }} />
              {sourceLabel}
            </Typography>
          </Tooltip>
          {buildDate && (
            // Same line as the source link, at the same type scale: the date
            // qualifies that URL, not the image series. It never shrinks, the
            // link absorbs the slack and keeps its ellipsis. The wording that
            // says what the date is stays in the tooltip.
            <Tooltip title={t('templates.catalog.imageBuilt', { date: buildDate })}>
              <Typography
                variant="caption"
                sx={{
                  opacity: 0.5,
                  fontSize: '0.6rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  color: 'text.secondary',
                  ml: 'auto',
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                }}
              >
                <i className="ri-calendar-line" style={{ fontSize: 10, flexShrink: 0 }} />
                {buildDate}
              </Typography>
            </Tooltip>
          )}
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
