import type { ViewMode } from './InventoryTree'

/**
 * Whether the root of the inventory shows the flat guest list (the "vms"
 * view). Its header carries "Deploy from template" and "Create VM", so an
 * empty inventory must still get it once loaded: a fresh vDC tenant has no
 * guest yet and nowhere else to create its first one (#1271). While the first
 * load runs, the placeholder stays, so nobody reads "no data" too early.
 */
export function showRootGuestList(viewMode: ViewMode, guestCount: number, inventoryLoaded: boolean): boolean {
  return viewMode === 'vms' && (guestCount > 0 || inventoryLoaded)
}
