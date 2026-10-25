// The certificate source card spans the whole settings column, so its forms
// lay their fields out in two columns rather than one stretched line each.
export const FORM_GRID_SX = {
  display: 'grid',
  gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
  columnGap: 3,
  rowGap: 3,
  alignItems: 'start',
} as const

export const FULL_ROW_SX = { gridColumn: '1 / -1' } as const
