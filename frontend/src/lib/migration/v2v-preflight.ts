import { executeSSH, type SSHResult } from "@/lib/ssh/exec"
import { getConnectionById } from "@/lib/connections/getConnection"
import { getNodeIp } from "@/lib/ssh/node-ip"

export interface PreflightResult {
  ssh: boolean
  virtV2vInstalled: boolean
  pvInstalled: boolean
  diskSpaceAvailableBytes: number
  diskSpaceRequired: number
  diskSpaceSufficient: boolean
  errors: string[]
}

/**
 * Run preflight checks on a Proxmox target node to verify it can run virt-v2v migrations.
 *
 * Checks: SSH connectivity, virt-v2v installed, pv installed, /tmp disk space.
 */
export async function runV2vPreflight(
  targetConnectionId: string,
  targetNode: string,
  requiredDiskBytes: number
): Promise<PreflightResult> {
  const errors: string[] = []
  const result: PreflightResult = {
    ssh: false,
    virtV2vInstalled: false,
    pvInstalled: false,
    diskSpaceAvailableBytes: 0,
    diskSpaceRequired: requiredDiskBytes,
    diskSpaceSufficient: false,
    errors,
  }

  // Resolve node IP
  const conn = await getConnectionById(targetConnectionId)
  const nodeIp = await getNodeIp(conn, targetNode)

  // 1. Check SSH connectivity
  const sshCheck = await executeSSH(targetConnectionId, nodeIp, "echo ok")
  if (!sshCheck.success) {
    errors.push(`SSH connectivity failed: ${sshCheck.error || "unknown error"}`)
    // If SSH fails, no point running the other checks
    return result
  }
  result.ssh = true

  // 2-4: Run remaining checks in parallel
  const [v2vCheck, pvCheck, dfCheck] = await Promise.all([
    executeSSH(targetConnectionId, nodeIp, "which virt-v2v"),
    executeSSH(targetConnectionId, nodeIp, "which pv"),
    executeSSH(targetConnectionId, nodeIp, "df -B1 /tmp | tail -1 | awk '{print $4}'"),
  ])

  // 2. Check virt-v2v installed
  if (v2vCheck.success && v2vCheck.output?.trim()) {
    result.virtV2vInstalled = true
  } else {
    errors.push("virt-v2v is not installed on the target node")
  }

  // 3. Check pv installed
  if (pvCheck.success && pvCheck.output?.trim()) {
    result.pvInstalled = true
  } else {
    errors.push("pv (pipe viewer) is not installed on the target node")
  }

  // 4. Check disk space on /tmp
  if (dfCheck.success && dfCheck.output?.trim()) {
    const availableBytes = parseInt(dfCheck.output.trim(), 10)
    if (!isNaN(availableBytes)) {
      result.diskSpaceAvailableBytes = availableBytes
      result.diskSpaceSufficient = availableBytes >= requiredDiskBytes
      if (!result.diskSpaceSufficient) {
        const availableGB = (availableBytes / 1_073_741_824).toFixed(1)
        const requiredGB = (requiredDiskBytes / 1_073_741_824).toFixed(1)
        errors.push(
          `Insufficient disk space on /tmp: ${availableGB} GB available, ${requiredGB} GB required`
        )
      }
    } else {
      errors.push(`Could not parse /tmp disk space: ${dfCheck.output}`)
    }
  } else {
    errors.push(`Failed to check /tmp disk space: ${dfCheck.error || "unknown error"}`)
  }

  return result
}

/**
 * Install virt-v2v and pv packages on the target Proxmox node via apt.
 */
export async function installV2vPackages(
  targetConnectionId: string,
  targetNode: string
): Promise<SSHResult> {
  const conn = await getConnectionById(targetConnectionId)
  const nodeIp = await getNodeIp(conn, targetNode)

  return executeSSH(
    targetConnectionId,
    nodeIp,
    "apt-get update -qq && apt-get install -y virt-v2v pv"
  )
}
