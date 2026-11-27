'use client'
import { useTheme } from '@mui/material'

/**
 * Theme-aware slotProps for MUI Tooltip so tooltips read correctly in both light
 * and dark themes. Mirrors the styling duplicated across InventoryTree /
 * CephTopology / FrameworksTab; new call sites should import this instead of
 * copying it again.
 */
export function useTooltipSlotProps() {
  const theme = useTheme()
  return {
    tooltip: {
      sx: {
        bgcolor: 'background.paper',
        color: 'text.primary',
        border: `1px solid ${theme.palette.divider}`,
        boxShadow: 3,
        fontSize: '0.75rem',
      },
    },
    arrow: { sx: { color: 'background.paper' } },
  }
}
