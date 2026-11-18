import type { ThemeOptions } from '@mui/material/styles'

// Component overrides as createTheme accepts them: typing an override module
// with it gives its style callbacks their `theme` and `ownerState`.
export type ThemeComponents = NonNullable<ThemeOptions['components']>

// The lab components (TabPanel, Timeline) are themed here too.
import type {} from '@mui/lab/themeAugmentation'

// `tonal` is a variant this theme adds to the pagination.
declare module '@mui/material/Pagination' {
  interface PaginationPropsVariantOverrides {
    tonal: true
  }
}

// The scheme MUI resolved, as opposed to the `system` a user may have picked.
export type SystemMode = 'light' | 'dark'
