// MUI module augmentations for project-defined variants.
// See src/@core/theme/overrides/chip.js for the custom "tonal" Chip variant.

import '@mui/material/Chip'

declare module '@mui/material/Chip' {
  interface ChipPropsVariantOverrides {
    tonal: true
  }
}

export {}
