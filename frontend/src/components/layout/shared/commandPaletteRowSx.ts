/**
 * Row style shared by the five result sections of the command palette (pages,
 * VMs, nodes, PBS servers, actions). The highlighted row uses the theme's
 * neutral selection tint (`action.selected`), never the primary colour: the
 * rows carry status badges and monospace hints whose colours must stay
 * readable whatever the White Label primary is.
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
  bgcolor: active ? 'action.selected' : 'transparent',
  color: 'text.primary',
  '&:hover': {
    bgcolor: active ? 'action.selected' : 'action.hover'
  },
  transition: 'background-color 0.1s'
})
