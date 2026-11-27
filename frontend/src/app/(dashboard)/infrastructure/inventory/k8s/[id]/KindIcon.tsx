'use client'
import { Box } from '@mui/material'
import type { SxProps, Theme } from '@mui/material'

interface KindIconProps {
  /** Remix Icon class used when no SVG asset is provided. */
  icon: string
  /** Optional SVG asset path (e.g. the Kubernetes logo). Takes precedence. */
  iconImg?: string
  /** Rendered size in px (font-size for the icon, width/height for the image). */
  size?: number
  sx?: SxProps<Theme>
}

/**
 * Renders a resource-kind icon: an <img> when the kind provides an SVG
 * (`iconImg`, e.g. the Kubernetes logo for nodes), otherwise the Remix font
 * icon. Single source of the img-vs-font decision so every call site stays
 * consistent (kind nav, overview, resource table rows, detail drawer).
 */
export function KindIcon({ icon, iconImg, size = 16, sx }: KindIconProps) {
  if (iconImg) {
    return (
      <Box
        component="img"
        src={iconImg}
        alt=""
        sx={{ width: size, height: size, flexShrink: 0, objectFit: 'contain', ...sx }}
      />
    )
  }
  return <Box component="i" className={icon} sx={{ fontSize: size, flexShrink: 0, ...sx }} />
}
