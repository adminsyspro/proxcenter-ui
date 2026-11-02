import { createContext } from 'react'

/**
 * Lets the inventory tree report that its first stream has ended (the `done`
 * event), so the page can tell an empty inventory from one still loading
 * (#1271). A context rather than a prop keeps the tree's signature untouched.
 */
export const InventoryLoadedContext = createContext<((loaded: boolean) => void) | null>(null)
