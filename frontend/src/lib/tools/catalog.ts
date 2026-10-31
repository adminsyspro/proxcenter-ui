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

import { listChangesTool, listTasksTool } from '@/lib/tools/activity'
import { listAlertsTool } from '@/lib/tools/alerts'
import { getDrsStatusTool, getSiteRecoveryTool } from '@/lib/tools/automation'
import { getBackupCoverageTool } from '@/lib/tools/backups'
import { getCapacityTool } from '@/lib/tools/capacity'
import { getCephStatusTool, listCephOsdsTool } from '@/lib/tools/ceph'
import { forecastCapacityTool, simulateMigrationTool } from '@/lib/tools/forecast'
import { getGuestHardwareTool, rankGuestHardwareTool } from '@/lib/tools/guests'
import { getMetricsHistoryTool } from '@/lib/tools/history'
import { getCveExposureTool, getHaStatusTool, getHostMaintenanceTool } from '@/lib/tools/hosts'
import { listGuestsTool, listHostsTool } from '@/lib/tools/inventory'
import { getNodeHardwareTool } from '@/lib/tools/nodes'
import { getHealthTrendTool, getVdcQuotasTool, listMigrationsTool } from '@/lib/tools/records'
import { rankStorageTool } from '@/lib/tools/storage'
import type { InventorySnapshot } from '@/lib/tools/snapshot'
import type { CatalogTool, ToolContext } from '@/lib/tools/types'

export const TOOL_CATALOG: CatalogTool[] = [
  // Snapshot-only, no Proxmox round trip.
  listHostsTool,
  listGuestsTool,
  rankGuestHardwareTool,
  getCapacityTool,
  simulateMigrationTool,
  // ProxCenter's own records (alerts, task history, change journal,
  // migrations, vDC quotas, health score, DRS, Site Recovery), scoped to the
  // snapshot: no Proxmox call.
  listAlertsTool,
  listTasksTool,
  listChangesTool,
  listMigrationsTool,
  getVdcQuotasTool,
  getHealthTrendTool,
  getDrsStatusTool,
  getSiteRecoveryTool,
  // One Proxmox read per guest, host or cluster, cached where it repeats.
  getGuestHardwareTool,
  getNodeHardwareTool,
  rankStorageTool,
  getBackupCoverageTool,
  getHaStatusTool,
  getCephStatusTool,
  listCephOsdsTool,
  getHostMaintenanceTool,
  // History reads, budgeted per question and cached.
  getMetricsHistoryTool,
  forecastCapacityTool,
  // A full SSH scan of a cluster's hosts: one per question, cached 6 h.
  getCveExposureTool,
]

/** What the assistant is handed: it answers questions, it never changes anything. */
export const READ_ONLY_TOOLS: CatalogTool[] = TOOL_CATALOG.filter(t => t.readOnly)

export function buildToolContext(
  snapshot: InventorySnapshot,
  tenantId: string,
  locale: string,
  timeZone?: string
): ToolContext {
  return { snapshot, tenantId, locale, ...(timeZone ? { timeZone } : {}), usage: { historyLookups: 0 } }
}
