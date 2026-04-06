import { executeSSH, type SSHResult } from "@/lib/ssh/exec"
import { getConnectionById } from "@/lib/connections/getConnection"
import { getNodeIp } from "@/lib/ssh/node-ip"

export interface TempStorageOption {
  path: string
  availableBytes: number
  totalBytes: number
  filesystem: string
}

export interface PreflightResult {
  ssh: boolean
  virtV2vInstalled: boolean
  pvInstalled: boolean
  virtioWinInstalled: boolean
  diskSpaceAvailableBytes: number
  diskSpaceRequired: number
  diskSpaceSufficient: boolean
  errors: string[]
  detectedDisks?: string[]
  tempStorages?: TempStorageOption[]
}

/**
 * Run preflight checks on a Proxmox target node to verify it can run virt-v2v migrations.
 *
 * Checks: SSH connectivity, virt-v2v installed, pv installed, /tmp disk space.
 */
export async function runV2vPreflight(
  targetConnectionId: string,
  targetNode: string,
  requiredDiskBytes: number,
  vmName?: string,
  sourceType?: string
): Promise<PreflightResult> {
  const errors: string[] = []
  const result: PreflightResult = {
    ssh: false,
    virtioWinInstalled: false,
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
  const [v2vCheck, pvCheck, dfCheck, virtioWinCheck] = await Promise.all([
    executeSSH(targetConnectionId, nodeIp, "which virt-v2v"),
    executeSSH(targetConnectionId, nodeIp, "which pv"),
    executeSSH(targetConnectionId, nodeIp, "df -B1 /tmp | tail -1 | awk '{print $4}'"),
    executeSSH(targetConnectionId, nodeIp, "test -f /usr/share/virtio-win/virtio-win.iso && echo yes || echo no"),
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

  // 4. Check virtio-win drivers
  if (virtioWinCheck.success && virtioWinCheck.output?.trim() === 'yes') {
    result.virtioWinInstalled = true
  }

  // 5. Check disk space on /tmp
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

  // 5. Check cifs-utils for Hyper-V only (needed for auto-mount)
  if (sourceType === 'hyperv') {
    const cifsCheck = await executeSSH(targetConnectionId, nodeIp, "which mount.cifs")
    if (!cifsCheck.success || !cifsCheck.output?.trim()) {
      // Not an error - pipeline will install if needed
    }
  }

  // 6. Scan available storage paths for temp files
  try {
    // Get mount points with significant space (excluding tmpfs, devtmpfs, squashfs, etc.)
    const dfAllResult = await executeSSH(targetConnectionId, nodeIp,
      `df -B1 --output=target,avail,size,fstype | tail -n +2 | awk '$4 !~ /tmpfs|devtmpfs|squashfs|overlay/ && $1 !~ /^\\/mnt\\/hyperv/ && $1 != "/" && $2 > 1073741824 {print $1"|"$2"|"$3"|"$4}'`)
    if (dfAllResult.success && dfAllResult.output?.trim()) {
      const storages: TempStorageOption[] = []
      for (const line of dfAllResult.output.trim().split('\n')) {
        const [path, avail, total, fs] = line.split('|')
        if (path && avail && total) {
          storages.push({
            path: path.trim(),
            availableBytes: parseInt(avail.trim(), 10) || 0,
            totalBytes: parseInt(total.trim(), 10) || 0,
            filesystem: fs?.trim() || 'unknown',
          })
        }
      }
      // Sort by available space descending
      storages.sort((a, b) => b.availableBytes - a.availableBytes)
      if (storages.length > 0) {
        result.tempStorages = storages
      }
    }
  } catch {}

  // 7. Scan /mnt/hyperv/ for VHDX/VHD files (Hyper-V only)
  if (sourceType === 'hyperv' && vmName) {
    try {
      const scanResult = await executeSSH(targetConnectionId, nodeIp,
        `find /mnt/hyperv -iname "*${vmName.replace(/[^a-zA-Z0-9._-]/g, '*')}*" \\( -iname "*.vhdx" -o -iname "*.vhd" \\) 2>/dev/null || true`)
      const detected = (scanResult.output || '').split('\n').map(l => l.trim()).filter(l => l && l.startsWith('/'))
      if (detected.length > 0) {
        result.detectedDisks = detected
      } else {
        // Fallback: list all VHDX/VHD in /mnt/hyperv/
        const allResult = await executeSSH(targetConnectionId, nodeIp,
          `find /mnt/hyperv -iname "*.vhdx" -o -iname "*.vhd" 2>/dev/null || true`)
        const all = (allResult.output || '').split('\n').map(l => l.trim()).filter(l => l && l.startsWith('/'))
        if (all.length > 0) {
          result.detectedDisks = all
        }
      }
    } catch {}
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
