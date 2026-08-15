import { INHERIT_ON_PRIMARY_SX } from '@/lib/theme/onPrimary'

/**
 * Row style shared by the five result sections of the command palette (pages,
 * VMs, nodes, PBS servers, actions). The highlighted row is painted with the
 * primary colour, which the user can set to anything through White Label, so
 * its content follows `primary.contrastText` instead of a fixed white.
 */
export const commandPaletteRowSx = (active: boolean) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 1.5,
  px: 2.5,
  py: 1,
  cursor: 'pointer',
  borderRadius: 1,
  mx: 1,
  bgcolor: active ? 'primary.main' : 'transparent',
  color: active ? 'primary.contrastText' : 'text.primary',
  ...(active ? INHERIT_ON_PRIMARY_SX : {}),
  '&:hover': {
    bgcolor: active ? 'primary.main' : 'action.hover'
  },
  transition: 'background-color 0.1s'
})
