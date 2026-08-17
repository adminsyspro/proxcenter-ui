/**
 * The tool registry.
 *
 * Ordering is deliberate: small local models weigh the head of the tool list,
 * so the cheap snapshot-only tools come first and the ones that fan out to
 * Proxmox come last. Every entry is read-only, and the registry is the
 * enforcement point for that: there is no write tool to reach.
 */

import { getCephStatusTool, listCephOsdsTool } from '@/lib/ai/tools/ceph'
import { getGuestHardwareTool, rankGuestHardwareTool } from '@/lib/ai/tools/guests'
import { listGuestsTool, listHostsTool } from '@/lib/ai/tools/inventory'
import { getNodeHardwareTool } from '@/lib/ai/tools/nodes'
import { rankStorageTool } from '@/lib/ai/tools/storage'
import { collectAiSnapshot, type AiSnapshot } from '@/lib/ai/context'
import type { AiTool, AiToolContext } from '@/lib/ai/tools/types'

export const AI_TOOLS: AiTool[] = [
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

export function findTool(name: string): AiTool | undefined {
  return AI_TOOLS.find(t => t.name === name)
}

export function buildToolContext(
  snapshot: AiSnapshot,
  tenantId: string,
  locale: string
): AiToolContext {
  return { snapshot, tenantId, locale }
}

export { collectAiSnapshot }
