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
import { orchestratorFetch } from "@/lib/orchestrator"
import { isConnectionLicenseExcluded } from "@/lib/license/exclusions"
import { executeSSH } from "@/lib/ssh/exec"
import { managedHostSshEndpoint } from "@/lib/ssh/node-endpoint-core"
import { applySFlowOnNode, SFLOW_PROBE_COMMAND, type SFlowDesiredConfig } from "@/lib/sflow/configure"
import { reportExpectedAgents, type ExpectedAgentReport } from "@/lib/sflow/expectedAgents"
import { collectGuestMACs, probeHost } from "@/lib/sflow/probe"

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

/** The configuration the last successful Configure run of a tenant saved, if usable. */
export async function readDesiredSFlowConfig(tenantId: string): Promise<SFlowDesiredConfig | null> {
  const setting = await prisma.setting.findUnique({ where: { key_tenantId: { key: SFLOW_DESIRED_CONFIG_KEY, tenantId } } })

  return setting && isUsableConfig(setting.value) ? setting.value : null
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

  // What this pass learnt about each node, for the orchestrator's telemetry
  // health (roadmap#52): with the page closed, this is the only path that
  // keeps the expected-agent inventory current. A cluster is reported as
  // complete only when every one of its nodes answered.
  const expected: ExpectedAgentReport[] = []
  const completeConnectionIds: string[] = []

  for (const setting of desired) {
    if (!isUsableConfig(setting.value)) continue
    const config = setting.value

    for (const conn of connections) {
      if (conn.tenantId !== setting.tenantId) continue
      if (!conn.sshKeyEnc && !conn.sshPassEnc) continue
      // A cluster outside the license is read-only for ProxCenter: nothing to
      // put back there, and executeSSH would refuse the re-apply (roadmap#58).
      if (await isConnectionLicenseExcluded(conn.id)) continue

      let allReached = true
      for (const host of conn.hosts) {
        if (!host.enabled || !(host.ip || host.sshAddress)) continue
        const target = managedHostSshEndpoint(host, conn.sshPort)
        const agentIp = host.ip || target.host

        const probe = await executeSSH(conn.id, target, SFLOW_PROBE_COMMAND, undefined, { readOnly: true })
        if (!probe.success) {
          allReached = false
          continue // unreachable, not drifted
        }

        report.checked++
        if (Number.parseInt((probe.output ?? "0").trim(), 10) > 0) {
          expected.push(expectedAgent(conn.id, conn.name, host.node, agentIp, config, true))
          continue // still configured
        }

        const applied = await applySFlowOnNode(conn.id, target, config, agentIp)
        if (applied.success) {
          report.reapplied++
          expected.push(expectedAgent(conn.id, conn.name, host.node, agentIp, config, true, true))
        } else if (applied.bridgesConfigured === 0 && applied.failedBridges.length === 0) {
          // No OVS bridge on this node: nothing to reconcile, not a failure,
          // and nothing to expect from it either.
          expected.push(expectedAgent(conn.id, conn.name, host.node, agentIp, config, false))
          continue
        } else {
          report.failed++
          // The bridges may hold the configuration while the collector stays
          // unreachable from the node: expected, so the silence is reported.
          expected.push(expectedAgent(conn.id, conn.name, host.node, agentIp, config, applied.bridgesConfigured > 0))
        }
      }
      if (allReached) completeConnectionIds.push(conn.id)
    }
  }

  await reportExpectedAgents({ connection_ids: completeConnectionIds, agents: expected })

  return report
}

function expectedAgent(
  connectionId: string,
  connectionName: string,
  node: string,
  agentIp: string,
  config: SFlowDesiredConfig,
  configured: boolean,
  reconfigured = false,
): ExpectedAgentReport {
  return {
    connection_id: connectionId,
    connection_name: connectionName,
    node,
    agent_ip: agentIp,
    target: config.collectorTarget,
    polling_interval: config.pollingInterval,
    sampling_rate: config.samplingRate,
    configured,
    reconfigured,
  }
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

/** The first port map push after a start: the orchestrator may have restarted too, with an empty port map. */
export const PORTMAP_FIRST_DELAY_MS = 60 * 1000

/**
 * Push the port map of every Open vSwitch node to the orchestrator: what attributes an sFlow sample to a guest, so to
 * a zone of the volume history. The agents route did it only when somebody opened the page, and an orchestrator that
 * restarted had none until then: the samples of that time went to no guest (measured on the lab, 20/11/2026). Per
 * pass, one read of the collector's status: only the nodes it hears are probed (none on an install without sFlow). Per
 * cluster with such a node, one guest MAC read; per node heard, the agents route's probe (four read-only SSH
 * commands), one node after the other. No Proxmox API call. Returns the nodes whose map was pushed.
 */
export async function refreshPortMaps(): Promise<number> {
  // Only the nodes the collector hears: nothing to attribute elsewhere, and no SSH at all on an install without sFlow.
  const status = await orchestratorFetch<{ enabled?: boolean; agents?: Array<{ agent_ip: string; active?: boolean }> }>("/sflow/status")
  const heard = new Set((status?.enabled ? status.agents ?? [] : []).filter(a => a.active).map(a => a.agent_ip))
  if (heard.size === 0) return 0
  const connections = await prisma.connection.findMany({ where: { type: "pve", sshEnabled: true }, include: { hosts: true } })
  let pushed = 0
  for (const conn of connections) {
    if (!conn.sshKeyEnc && !conn.sshPassEnc) continue
    if (await isConnectionLicenseExcluded(conn.id)) continue
    const targets = conn.hosts
      .filter(h => h.enabled && !!(h.ip || h.sshAddress))
      .map(h => {
        const endpoint = managedHostSshEndpoint(h, conn.sshPort)
        return { node: h.node, ip: h.ip || endpoint.host, endpoint }
      })
      .filter(t => heard.has(t.ip))
    if (targets.length === 0) continue
    const guestMacs = await collectGuestMACs(conn.id, targets.map(t => t.endpoint))
    for (const t of targets) {
      const status = await probeHost(conn.id, conn.name, t.node, t.ip, t.endpoint, guestMacs)
      if (status.hasOvs && !status.portMapError) pushed++
    }
  }
  return pushed
}

export interface PortMapRefresherOptions {
  intervalMs?: number
  firstDelayMs?: number
  refresh?: () => Promise<number>
}

/**
 * Start the periodic port map push, with the timer discipline of the reconciler (one pass at a time, unref, never
 * throws). Every replica pushes to the orchestrator it reaches: the push replaces a node's map, so a second one is
 * redundant, not harmful.
 *
 * @returns A stop() function, safe to call multiple times.
 */
export function startPortMapRefresher(options: PortMapRefresherOptions = {}): () => void {
  const { intervalMs = SFLOW_RECONCILE_INTERVAL_MS, firstDelayMs = PORTMAP_FIRST_DELAY_MS, refresh = refreshPortMaps } = options
  let stopped = false
  let inFlight = false

  const tick = () => {
    if (stopped || inFlight) return
    inFlight = true
    refresh()
      .catch(e => {
        console.error("[sflow-portmap] pass failed:", e?.message || e)
      })
      .finally(() => {
        inFlight = false
      })
  }

  const first = setTimeout(tick, firstDelayMs)
  first.unref?.()
  const timer = setInterval(tick, intervalMs)
  timer.unref?.()

  return () => {
    stopped = true
    clearTimeout(first)
    clearInterval(timer)
  }
}
