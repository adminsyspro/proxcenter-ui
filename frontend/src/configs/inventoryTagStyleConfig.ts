// Inventory Tag Style Configuration
//
// How the guest tags are drawn in the inventory tree and in the VM list.
//
// Proxmox exposes exactly four shapes in Datacenter > Options > Tag Style
// Override, and the inventory already draws all four from the datacenter's
// `tag-style` property. `auto` is ProxCenter's own addition and the shipped
// default: it leaves the shape the datacenter asked for in charge, which is
// what every install rendered before this setting existed.

export const INVENTORY_TAG_STYLES = ['auto', 'full', 'circle', 'dense', 'none'] as const

export type InventoryTagStyle = (typeof INVENTORY_TAG_STYLES)[number]

export const DEFAULT_INVENTORY_TAG_STYLE: InventoryTagStyle = 'auto'

/** The order the settings card renders them in, with the label each one reads. */
export const INVENTORY_TAG_STYLE_OPTIONS: { id: InventoryTagStyle; labelKey: string }[] = [
  { id: 'auto', labelKey: 'settings.inventoryTagStyle.auto' },
  { id: 'full', labelKey: 'settings.inventoryTagStyle.full' },
  { id: 'circle', labelKey: 'settings.inventoryTagStyle.circle' },
  { id: 'dense', labelKey: 'settings.inventoryTagStyle.dense' },
  { id: 'none', labelKey: 'settings.inventoryTagStyle.none' },
]
