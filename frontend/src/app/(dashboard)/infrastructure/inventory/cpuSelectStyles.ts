import type { SxProps } from '@mui/material'

// En-têtes de groupes des Select "CPU Type" (Custom, Special, Intel, ...) :
// mis en évidence pour trancher visuellement sur les items de la liste (#665).
export const cpuGroupHeaderSx: SxProps = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.8px',
  lineHeight: '30px',
  color: 'primary.main',
  bgcolor: 'action.hover',
}
