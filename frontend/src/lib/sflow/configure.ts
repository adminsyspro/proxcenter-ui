/**
 * The one place that knows how sFlow is applied to a node.
 *
 * Two callers need it: the Configure action in Network Flows, and the periodic
 * reconciler that puts the configuration back after a node loses it. Keeping
 * one copy each is how two code paths silently drift apart.
 */
import { executeSSH, shellEscape } from "@/lib/ssh/exec"

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
 * The agent device is deliberately left unset. Pinning it to the bridge broke
 * on bridges with no IP address, which is the normal case for a bridge that
 * only carries guest traffic.
 *
 * The caller is responsible for validating the values; the target is escaped
 * here as a second line of defence because it lands in a shell command.
 */
export function buildSFlowConfigureCommand(cfg: SFlowDesiredConfig): string {
  // The target MUST reach ovs-vsctl wrapped in literal double quotes.
  // `targets` is an OVSDB set of strings, and an unquoted host:port makes
  // ovs-vsctl fail with `unexpected ":" parsing set of 1 or more strings`.
  // Shell-quoting alone is not enough: the shell strips its own quotes and
  // ovs-vsctl then sees the bare value. Measured on OVS 3.5.0.
  const quotedTarget = shellEscape(`"${cfg.collectorTarget}"`)

  return (
    `for br in $(ovs-vsctl list-br); do ` +
    `ovs-vsctl -- --id=@s create sflow target=${quotedTarget} header=128 ` +
    `sampling=${cfg.samplingRate} polling=${cfg.pollingInterval} -- set Bridge $br sflow=@s ` +
    `&& echo "SFLOW_OK:$br" || echo "SFLOW_FAILED:$br"; done`
  )
}

/** Command that reports whether a node currently has any sFlow collector set. */
export const SFLOW_PROBE_COMMAND = `ovs-vsctl list sflow 2>/dev/null | grep -c targets || true`

export function parseConfigureOutput(output: string): { configured: number; failedBridges: string[] } {
  return {
    configured: (output.match(/SFLOW_OK:/g) || []).length,
    failedBridges: [...output.matchAll(/SFLOW_FAILED:(\S+)/g)].map(m => m[1]),
  }
}

/** Apply the configuration on one node and report precisely what happened. */
export async function applySFlowOnNode(
  connectionId: string,
  ip: string,
  cfg: SFlowDesiredConfig,
): Promise<SFlowApplyResult> {
  const result = await executeSSH(connectionId, ip, buildSFlowConfigureCommand(cfg))
  const { configured, failedBridges } = parseConfigureOutput(result.output ?? "")

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

  return { success: true, bridgesConfigured: configured, failedBridges: [] }
}
