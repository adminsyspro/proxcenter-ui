import type { Theme } from '@mui/material/styles'

import type { AvailabilityState } from '@/lib/availability/types'

/** Fill of a state, from the theme. `absent` has no fill: it is drawn with a border only. */
export function stateColor(theme: Theme, state: AvailabilityState): string {
  switch (state) {
    case 'up': return theme.palette.success.main
    case 'down': return theme.palette.error.main
    case 'maintenance': return theme.palette.info.main
    case 'unobserved': return theme.palette.mode === 'dark' ? theme.palette.grey[700] : theme.palette.grey[400]
    default: return 'transparent'
  }
}

export const STATES: readonly AvailabilityState[] = ['up', 'down', 'maintenance', 'unobserved', 'absent']
