'use client'

import { Box, Button, Typography } from '@mui/material'
import type { SxProps, Theme } from '@mui/material'

interface EmptyStateProps {
  icon?: string
  illustration?: React.ReactNode
  title: string
  description?: string
  action?: { label: string; onClick: () => void; icon?: string }
  size?: 'small' | 'medium' | 'large'
  sx?: SxProps<Theme>
}

const sizeConfig = {
  small: {
    py: 3,
    titleVariant: 'body2' as const,
    descVariant: 'caption' as const,
    iconSize: '1.5rem',
  },
  medium: {
    py: 5,
    titleVariant: 'subtitle1' as const,
    descVariant: 'body2' as const,
    iconSize: '2rem',
  },
  large: {
    py: 8,
    titleVariant: 'h6' as const,
    descVariant: 'body2' as const,
    iconSize: '2.5rem',
  },
}

export default function EmptyState({
  icon = 'ri-inbox-line',
  illustration,
  title,
  description,
  action,
  size = 'medium',
  sx,
}: EmptyStateProps) {
  const config = sizeConfig[size]

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        py: config.py,
        px: 3,
        ...sx,
      }}
    >
      {illustration ? (
        <Box sx={{ mb: 2 }}>{illustration}</Box>
      ) : (
        <Box
          sx={{
            color: 'text.secondary',
            opacity: 0.4,
            mb: 1.5,
            lineHeight: 1,
          }}
        >
          <i className={icon} style={{ fontSize: config.iconSize }} />
        </Box>
      )}
      <Typography
        variant={config.titleVariant}
        sx={{ fontWeight: 600, color: 'text.primary', mb: description ? 0.5 : 0 }}
      >
        {title}
      </Typography>
      {description && (
        <Typography
          variant={config.descVariant}
          sx={{ color: 'text.secondary', maxWidth: 360 }}
        >
          {description}
        </Typography>
      )}
      {action && (
        <Button
          variant="outlined"
          size="small"
          onClick={action.onClick}
          startIcon={action.icon ? <i className={action.icon} /> : undefined}
          sx={{ mt: 2 }}
        >
          {action.label}
        </Button>
      )}
    </Box>
  )
}
