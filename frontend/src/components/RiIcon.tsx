/**
 * RiIcon - Thin wrapper for RemixIcon that's compatible with MUI icon prop APIs.
 * Replaces @mui/icons-material to avoid pulling in the massive MUI icons bundle.
 *
 * Usage:
 *   <RiIcon name="ri-refresh-line" />
 *   <RiIcon name="ri-play-fill" size={18} color="success.main" />
 *   <Button startIcon={<RiIcon name="ri-refresh-line" />}>Refresh</Button>
 */
import React from 'react'

interface RiIconProps {
  /** RemixIcon class name, e.g. "ri-refresh-line" */
  name: string
  /** Font size in px (default: 20) */
  size?: number | string
  /** CSS color value */
  color?: string
  /** Additional inline styles */
  style?: React.CSSProperties
  /** Additional CSS class names */
  className?: string
}

const RiIcon = React.memo(function RiIcon({ name, size = 20, color, style, className }: RiIconProps) {
  return (
    <i
      className={`${name}${className ? ` ${className}` : ''}`}
      style={{
        fontSize: typeof size === 'number' ? `${size}px` : size,
        color,
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...style,
      }}
    />
  )
})

export default RiIcon
