/**
 * The one place that knows how sFlow is applied to a node.
 *
 * Two callers need it: the Configure action in Network Flows, and the periodic
 * reconciler that puts the configuration back after a node loses it. Keeping
 * one copy each is how two code paths silently drift apart.
 */
import { isIP } from "node:net"

import { executeSSH, shellEscape } from "@/lib/ssh/exec"
import type { SshTarget } from "@/lib/ssh/node-endpoint-core"

export interface SFlowDesiredConfig {
  collectorTarget: string
  samplingRate: number
  pollingInterval: number
}

export interface SFlowApplyResult {
  success: boolean
  bridgesConfigured: number
  failedBridges: string[]
  error?: string
}

/**
 * The host part of a collector target, the name Open vSwitch has to resolve.
 * Accepts `host:port`, `[v6]:port`, a bare host and a bare IPv6 address.
 */
export function collectorHost(target: string): string {
  const bracketed = target.match(/^\[([^\]]+)\](?::\d+)?$/)
  if (bracketed) return bracketed[1]
  const colons = (target.match(/:/g) || []).length
  if (colons === 1) return target.slice(0, target.lastIndexOf(":"))
  return target
}

/**
 * Build the shell command that configures sFlow on every OVS bridge of a node.
 *
 * Three properties this command must keep, each of them a fixed bug:
 *   - it does NOT clear the existing sFlow first. Setting the column replaces
 *     the reference anyway, and clearing first left the bridge with no sFlow at
 *     all whenever the create failed, which is worse than doing nothing.
 *   - it marks every bridge, because `;` separated statements only surface the
 *     exit status of the last iteration and an earlier failure was lost.
 *   - an empty bridge list produces no marker at all, which lets the caller
 *     tell "nothing to configure" apart from "configured", instead of the loop
 *     exiting 0 and passing for a success.
 *
 * The agent is pinned to `agentAddress`, the address ProxCenter knows the node
 * by, when that address is a literal IP. Left unset, ovs-vswitchd reports the
 * source address of its route to the collector instead, and on a node with
 * several interfaces that is not the node's address: the samples arrived, but
 * under an agent no node row matched and with ifIndexes keyed to the wrong
 * port map, which looked exactly like "configured, no data" (#1066). An IP
 * literal is reported as is (ofproto-dpif-sflow.c, sflow_choose_agent_address),
 * unlike a bridge name, which broke on bridges with no IP address.
 *
 * After the bridges, the command reports what the node itself can do with the
 * collector target: resolve it, and route to it. ovs-vswitchd needs both and,
 * when either fails, only logs an error and sends nothing, while ovs-vsctl has
 * already answered success.
 *
 * The caller is responsible for validating the values; the target is escaped
 * here as a second line of defence because it lands in a shell command.
 */
export function buildSFlowConfigureCommand(cfg: SFlowDesiredConfig, agentAddress?: string): string {
  // The target MUST reach ovs-vsctl wrapped in literal double quotes.
  // `targets` is an OVSDB set of strings, and an unquoted host:port makes
  // ovs-vsctl fail with `unexpected ":" parsing set of 1 or more strings`.
  // Shell-quoting alone is not enough: the shell strips its own quotes and
  // ovs-vsctl then sees the bare value. Measured on OVS 3.5.0.
  const quotedTarget = shellEscape(`"${cfg.collectorTarget}"`)
  // Same quoting for the agent, an IPv6 address carries colons too.
  const agent = agentAddress && isIP(agentAddress) ? ` agent=${shellEscape(`"${agentAddress}"`)}` : ""
  const host = shellEscape(collectorHost(cfg.collectorTarget))

  return (
    `for br in $(ovs-vsctl list-br); do ` +
    `ovs-vsctl -- --id=@s create sflow target=${quotedTarget}${agent} header=128 ` +
    `sampling=${cfg.samplingRate} polling=${cfg.pollingInterval} -- set Bridge $br sflow=@s ` +
    `&& echo "SFLOW_OK:$br" || echo "SFLOW_FAILED:$br"; done; ` +
    `addr=$(getent ahosts ${host} | awk 'NR==1{print $1}'); ` +
    `if [ -z "$addr" ]; then echo "SFLOW_UNRESOLVED"; ` +
    `else echo "SFLOW_ROUTE:$(ip route get "$addr" 2>/dev/null | sed -n 's/.* src \\([^ ]*\\).*/\\1/p' | head -1)"; fi`
  )
}

/** Command that reports whether a node currently has any sFlow collector set. */
export const SFLOW_PROBE_COMMAND = `ovs-vsctl list sflow 2>/dev/null | grep -c targets || true`

/** false when the node could not resolve the collector, true when it routed to it, null when it said neither. */
function collectorVerdict(output: string, routed: boolean): boolean | null {
  if (/^SFLOW_UNRESOLVED\s*$/m.test(output)) return false
  return routed ? true : null
}

export function parseConfigureOutput(output: string): {
  configured: number
  failedBridges: string[]
  collectorResolved: boolean | null
  routeSource: string | null
} {
  const route = output.match(/^SFLOW_ROUTE:(\S*)\s*$/m)

  return {
    configured: (output.match(/SFLOW_OK:/g) || []).length,
    failedBridges: [...output.matchAll(/SFLOW_FAILED:(\S+)/g)].map(m => m[1]),
    // null when the node said nothing about the collector, e.g. an older shell
    // that stopped after the loop: no verdict rather than a false failure.
    collectorResolved: collectorVerdict(output, !!route),
    routeSource: route ? route[1] : null,
  }
}

/**
 * Apply the configuration on one node and report precisely what happened.
 *
 * `agentAddress` is the address the node is known by in ProxCenter, the one the
 * Network Flows table and the port map are keyed on.
 */
export async function applySFlowOnNode(
  connectionId: string,
  ip: SshTarget,
  cfg: SFlowDesiredConfig,
  agentAddress?: string,
): Promise<SFlowApplyResult> {
  const result = await executeSSH(connectionId, ip, buildSFlowConfigureCommand(cfg, agentAddress))
  const { configured, failedBridges, collectorResolved, routeSource } = parseConfigureOutput(result.output ?? "")

  if (!result.success && configured === 0) {
    return { success: false, bridgesConfigured: 0, failedBridges, error: result.error || "command failed" }
  }
  if (failedBridges.length > 0) {
    return {
      success: false,
      bridgesConfigured: configured,
      failedBridges,
      error: `sFlow could not be set on ${failedBridges.join(", ")}`,
    }
  }
  if (configured === 0) {
    return {
      success: false,
      bridgesConfigured: 0,
      failedBridges: [],
      error: "no OVS bridge on this node, nothing to configure",
    }
  }

  // The bridges hold the configuration, but Open vSwitch will not send a
  // single datagram to a collector it cannot resolve or reach from here.
  const collector = collectorHost(cfg.collectorTarget)
  if (collectorResolved === false) {
    return {
      success: false,
      bridgesConfigured: configured,
      failedBridges: [],
      error: `sFlow is set, but this node cannot resolve the collector ${collector}, so Open vSwitch sends nothing; use an IP address the node can reach`,
    }
  }
  if (collectorResolved && !routeSource) {
    return {
      success: false,
      bridgesConfigured: configured,
      failedBridges: [],
      error: `sFlow is set, but this node has no route to the collector ${collector}, so Open vSwitch sends nothing`,
    }
  }

  return { success: true, bridgesConfigured: configured, failedBridges: [] }
}
