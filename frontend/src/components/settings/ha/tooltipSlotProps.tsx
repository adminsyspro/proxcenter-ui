// Theme-aware tooltip overrides shared by the HA components (mirrors the
// tooltipSlotProps pattern of InventoryTree.tsx / FrameworksTab.tsx).
export const tooltipSlotProps = {
  tooltip: {
    sx: {
      bgcolor: 'background.paper',
      color: 'text.primary',
      border: '1px solid',
      borderColor: 'divider',
      borderRadius: 1.5,
      boxShadow: 3,
      maxWidth: 320,
    },
  },
  arrow: {
    sx: { color: 'background.paper' },
  },
} as const
