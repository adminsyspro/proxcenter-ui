/**
 * Expected sFlow agents (roadmap#52).
 *
 * The orchestrator owns the UDP socket, so it alone knows which agents send
 * datagrams; the frontend owns the SSH sessions, so it alone knows which nodes
 * were configured to. Telemetry health is the join of the two, evaluated in
 * the orchestrator (where the alert loop also runs, with the page closed).
 * This module is the frontend's half: every code path that learns the OVS
 * state of a node over SSH reports it here.
 *
 * Three callers: the agents probe (page load, every 30 s at most), the
 * configure action (which also restarts the grace period of the nodes it just
 * set), and the ten-minute reconciler (so the inventory stays current with the
 * page closed).
 */
import { orchestratorFetch } from "@/lib/orchestrator"

export interface ExpectedAgentReport {
  connection_id: string
  connection_name: string
  node: string
  agent_ip: string
  target: string
  polling_interval: number
  sampling_rate: number
  /** false for a node with no sFlow collector set, or no OVS: nothing is expected from it. */
  configured: boolean
  /** true right after a configure run succeeded on the node: restarts the grace period. */
  reconfigured?: boolean
}

export interface ExpectedAgentsUpdate {
  /** Clusters reported in full: their nodes left unmentioned are dropped. */
  connection_ids: string[]
  agents: ExpectedAgentReport[]
}

/**
 * Report the nodes to the orchestrator. Best effort: an orchestrator that is
 * down or does not know the route yet must not fail the probe or the
 * configure action the caller is in the middle of. Returns whether it got
 * through.
 */
export async function reportExpectedAgents(update: ExpectedAgentsUpdate): Promise<boolean> {
  if (update.agents.length === 0 && update.connection_ids.length === 0) return true

  try {
    await orchestratorFetch("/sflow/expected-agents", { method: "PUT", body: update })

    return true
  } catch (error: any) {
    if (error?.code !== "ORCHESTRATOR_UNAVAILABLE") {
      console.warn("[sflow] expected agents report failed:", String(error?.message || error).replace(/[\r\n]/g, ""))
    }

    return false
  }
}
