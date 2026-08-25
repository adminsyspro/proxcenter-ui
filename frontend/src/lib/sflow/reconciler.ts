/**
 * Periodic re-application of the sFlow configuration.
 *
 * OVS keeps its sFlow setup in its own database, and it is lost whenever the
 * bridges are recreated, which a Proxmox node does on a network reload or a
 * reboot. Nothing in the product noticed: a node came back with no sFlow, the
 * flow panels went quiet, and the only cure was for somebody to spot it and
 * press Configure again. A customer hit exactly that and reported the action as
 * doing nothing, because by then it also could not report its own failures.
 *
 * This lives in the frontend rather than the orchestrator on purpose: the
 * orchestrator is handed SSH credentials per request and holds none of its own,
 * so it cannot open a session by itself.
 *
 * Timer discipline copied from sessionSweeper.ts: an in-flight guard so a slow
 * pass cannot overlap the next tick, unref() so the interval never keeps the
 * process alive by itself, and an error path that can never throw.
 */
import { prisma } from "@/lib/db/prisma"
import { executeSSH } from "@/lib/ssh/exec"
import { applySFlowOnNode, SFLOW_PROBE_COMMAND, type SFlowDesiredConfig } from "@/lib/sflow/configure"

export const SFLOW_RECONCILE_INTERVAL_MS = 10 * 60 * 1000
export const SFLOW_DESIRED_CONFIG_KEY = "sflow.desiredConfig"

export interface SFlowReconcileReport {
  checked: number
  reapplied: number
  failed: number
}

/** Persist the configuration a successful Configure run asked for. */
export async function saveDesiredSFlowConfig(tenantId: string, config: SFlowDesiredConfig): Promise<void> {
  await prisma.setting.upsert({
    where: { key_tenantId: { key: SFLOW_DESIRED_CONFIG_KEY, tenantId } },
    create: { key: SFLOW_DESIRED_CONFIG_KEY, tenantId, value: config as unknown as object },
    update: { value: config as unknown as object, updatedAt: new Date() },
  })
}

function isUsableConfig(value: unknown): value is SFlowDesiredConfig {
  if (!value || typeof value !== "object") return false
  const c = value as Partial<SFlowDesiredConfig>

  return (
    typeof c.collectorTarget === "string" &&
    c.collectorTarget.length > 0 &&
    Number.isInteger(c.samplingRate) &&
    Number.isInteger(c.pollingInterval)
  )
}

/**
 * One reconciliation pass over every tenant that has ever configured sFlow.
 *
 * A node is only touched when it has OVS bridges and currently reports no
 * collector at all. A node that is merely unreachable is left alone: this must
 * never turn a transient SSH failure into a reconfiguration storm.
 */
export async function reconcileSFlow(): Promise<SFlowReconcileReport> {
  const report: SFlowReconcileReport = { checked: 0, reapplied: 0, failed: 0 }

  const desired = await prisma.setting.findMany({ where: { key: SFLOW_DESIRED_CONFIG_KEY } })
  if (desired.length === 0) return report

  const connections = await prisma.connection.findMany({
    where: { type: "pve", sshEnabled: true },
    include: { hosts: true },
  })

  for (const setting of desired) {
    if (!isUsableConfig(setting.value)) continue
    const config = setting.value

    for (const conn of connections) {
      if (conn.tenantId !== setting.tenantId) continue
      if (!conn.sshKeyEnc && !conn.sshPassEnc) continue

      for (const host of conn.hosts) {
        if (!host.enabled || !host.ip) continue

        const probe = await executeSSH(conn.id, host.ip, SFLOW_PROBE_COMMAND)
        if (!probe.success) continue // unreachable, not drifted

        report.checked++
        if (Number.parseInt((probe.output ?? "0").trim(), 10) > 0) continue // still configured

        const applied = await applySFlowOnNode(conn.id, host.ip, config)
        if (applied.success) {
          report.reapplied++
        } else if (applied.bridgesConfigured === 0 && applied.failedBridges.length === 0) {
          // No OVS bridge on this node: nothing to reconcile, not a failure.
          continue
        } else {
          report.failed++
        }
      }
    }
  }

  return report
}

export interface SFlowReconcilerOptions {
  intervalMs?: number
  reconcile?: () => Promise<SFlowReconcileReport>
}

/**
 * Start the periodic reconciliation.
 *
 * Safe to run from several replicas: re-applying an sFlow configuration is
 * idempotent, so no leader election is needed and the only cost of N replicas
 * is a redundant probe per interval.
 *
 * @returns A stop() function, safe to call multiple times.
 */
export function startSFlowReconciler(options: SFlowReconcilerOptions = {}): () => void {
  const { intervalMs = SFLOW_RECONCILE_INTERVAL_MS, reconcile = reconcileSFlow } = options
  let stopped = false
  let inFlight = false

  const tick = () => {
    if (stopped || inFlight) return
    inFlight = true
    reconcile()
      .then(report => {
        if (report.reapplied > 0 || report.failed > 0) {
          console.log(
            `[sflow-reconciler] checked ${report.checked} nodes, re-applied ${report.reapplied}, failed ${report.failed}`
          )
        }
      })
      .catch(e => {
        console.error("[sflow-reconciler] pass failed:", e?.message || e)
      })
      .finally(() => {
        inFlight = false
      })
  }

  const timer = setInterval(tick, intervalMs)
  timer.unref?.()

  return () => {
    stopped = true
    clearInterval(timer)
  }
}
