import { executeSSH } from "@/lib/ssh/exec"
import { extractHostname, isPrivateIp } from "@/lib/net/ip"

// Flat result shape rather than a discriminated union: this project compiles
// with strictNullChecks off, where narrowing a boolean-discriminant union via
// `if (!check.ok)` does not apply. `status`/`error` are set only when ok=false.
export type TargetCheck = { ok: boolean; status?: number; error?: string }

/**
 * Build a user-facing error for an unreachable SSH target. When the target is a
 * private IP, point the operator at the per-node SSH address override; otherwise
 * fall back to the caller's generic message.
 */
export function sshTargetError(node: string, nodeIp: string, fallback?: string): string {
  if (isPrivateIp(nodeIp)) {
    return `Could not reach node '${node}' at ${nodeIp} over SSH. That looks like a private address, not reachable from ProxCenter (e.g. the node is behind NAT). Set an SSH address override for this node to the address you reach it on.`
  }
  return fallback || `Failed to reach node '${node}' at ${nodeIp} over SSH.`
}

/**
 * Reachability + identity check before a destructive SSH op on a node.
 *
 * The hostname-identity check only runs when resolution substituted the
 * connection host (i.e. `nodeIp` equals the connection address). For direct
 * node-IP resolutions the function returns ok without probing, so existing
 * cluster/LAN behavior is unchanged.
 */
export async function verifyNodeTarget(
  connId: string,
  conn: { host?: string; baseUrl?: string },
  node: string,
  nodeIp: string,
): Promise<TargetCheck> {
  const connHost = extractHostname(conn.host || conn.baseUrl || "")
  const resolvedViaConnHost = !!connHost && nodeIp === connHost
  if (!resolvedViaConnHost) return { ok: true }

  const probe = await executeSSH(connId, nodeIp, "hostname -s")
  if (!probe.success) {
    return { ok: false, status: 502, error: sshTargetError(node, nodeIp, probe.error || "SSH unreachable") }
  }

  // Compare short hostname labels on both sides: `hostname -s` is short, but a
  // misconfigured host can still emit an FQDN, and the Proxmox node name may be
  // an FQDN too. Shortening both can only prevent a false mismatch, never cause
  // a false match.
  const remote = (probe.output || "").trim().toLowerCase().split(".")[0]
  const want = node.split(".")[0].toLowerCase()

  // Fail-closed: an empty/unreadable remote hostname means we cannot confirm the
  // target is the requested node. On this substituted-connection-host path that
  // is exactly the ambiguity we must not run a destructive op through.
  if (!remote) {
    return {
      ok: false,
      status: 409,
      error: `Refusing the operation: could not read a hostname from the address resolved for node '${node}' (${nodeIp}), so its identity cannot be confirmed. Set a per-node SSH address override to the correct host.`,
    }
  }
  if (remote !== want) {
    return {
      ok: false,
      status: 409,
      error: `Refusing the operation: the address resolved for node '${node}' (${nodeIp}) reports hostname '${remote}'. This does not look like that node. Set a per-node SSH address override to the correct host.`,
    }
  }
  return { ok: true }
}
