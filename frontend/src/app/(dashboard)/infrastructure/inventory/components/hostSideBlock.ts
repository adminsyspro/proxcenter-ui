/**
 * Sizing for the two side blocks of the host summary — available updates and
 * subscription — which can be collapsed to a tile.
 *
 * The summary is a row from `xl` up and a column below it. Collapsed, the tile
 * has to follow: a narrow vertical rail beside the other columns, a full-width
 * bar once they stack. Sized for the row alone, it used to hang under the card
 * as a 44px ribbon 150px tall.
 */

export function hostSideBlockSx(collapsed: boolean) {
  return {
    flex: collapsed ? '0 0 auto' : 1,
    width: collapsed ? { xs: '100%', xl: 44 } : 'auto',
    minWidth: collapsed ? { xs: 'auto', xl: 44 } : undefined,
  }
}

export function hostSideHandleSx() {
  return {
    display: 'flex',
    flexDirection: { xs: 'row', xl: 'column' },
    alignItems: 'center',
    justifyContent: 'center',
    gap: { xs: 1, xl: 0 },
    height: '100%',
    minHeight: { xs: 44, xl: 150 },
    cursor: 'pointer',
  }
}
