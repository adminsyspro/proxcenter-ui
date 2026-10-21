/**
 * The tool catalog.
 *
 * One list for every consumer: the in-app assistant today, the MCP endpoint
 * for external agents later. Run an entry through `invokeTool`
 * (`@/lib/tools/invoke`), never through `execute` directly.
 *
 * Ordering is deliberate: small local models weigh the head of the tool list,
 * so the cheap snapshot-only tools come first and the ones that fan out to
 * Proxmox come last.
 */

import { getCephStatusTool, listCephOsdsTool } from '@/lib/tools/ceph'
import { getGuestHardwareTool, rankGuestHardwareTool } from '@/lib/tools/guests'
import { listGuestsTool, listHostsTool } from '@/lib/tools/inventory'
import { getNodeHardwareTool } from '@/lib/tools/nodes'
import { rankStorageTool } from '@/lib/tools/storage'
import type { InventorySnapshot } from '@/lib/tools/snapshot'
import type { CatalogTool, ToolContext } from '@/lib/tools/types'

export const TOOL_CATALOG: CatalogTool[] = [
  // Snapshot-only, no Proxmox round trip.
  listHostsTool,
  listGuestsTool,
  rankGuestHardwareTool,
  // One Proxmox fan-out each.
  getGuestHardwareTool,
  getNodeHardwareTool,
  rankStorageTool,
  getCephStatusTool,
  listCephOsdsTool,
]

/** What the assistant is handed: it answers questions, it never changes anything. */
export const READ_ONLY_TOOLS: CatalogTool[] = TOOL_CATALOG.filter(t => t.readOnly)

export function buildToolContext(
  snapshot: InventorySnapshot,
  tenantId: string,
  locale: string
): ToolContext {
  return { snapshot, tenantId, locale }
}
