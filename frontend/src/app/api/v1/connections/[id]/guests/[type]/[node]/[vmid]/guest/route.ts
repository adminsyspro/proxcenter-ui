import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { callGuestAgent } from "@/lib/proxmox/guestAgentCall"
import { getOsType } from "@/lib/proxmox/guestOs"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"
import { guardSessionGuest } from "@/lib/vdc/guestGuard"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ id: string; type: string; node: string; vmid: string }>
}

type OsInfo = {
  type: 'linux' | 'windows' | 'other'
  name: string | null
  version: string | null
  kernel: string | null
}

/**
 * A guest that started less than this many seconds ago may simply not have
 * its agent up yet: its silence does not start the mute.
 */
const AGENT_BOOT_GRACE_S = 120

type AgentConn = Parameters<typeof callGuestAgent>[0]

/**
 * The network interfaces the guest agent reports, or null when the agent is
 * not there. It is the first thing asked, alone, and it goes through the
 * node's pvedaemon slots: PVE waits about three seconds for an agent that is
 * not running, with a pvedaemon worker held meanwhile, and a node has three
 * of them. Asking three things at once to a silent agent stalled every other
 * protected read of the node at each selection of the guest. An agent that
 * did not answer is then left alone for a while (guestAgentCall.ts).
 */
async function agentInterfaces(conn: AgentConn, node: string, vmid: string, uptime: number | undefined): Promise<{ answer: any } | null> {
  const booting = typeof uptime === "number" && uptime < AGENT_BOOT_GRACE_S

  try {
    return { answer: await callGuestAgent<any>(conn, node, vmid, "network-get-interfaces", { mute: !booting }) }
  } catch {
    // Not running, left alone, or not allowed: no agent data either way.
    return null
  }
}

/**
 * GET /api/v1/connections/[id]/guests/[type]/[node]/[vmid]/guest
 *
 * Récupère les informations du QEMU Guest Agent (IP, uptime, OS info, etc.)
 * Combine les données de status/current, agent/network-get-interfaces et agent/get-osinfo
 */
export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const { id, type, node, vmid } = await ctx.params

    if (!id || !type || !node || !vmid) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 })
    }

    // RBAC: Check vm.view permission
    const resourceId = buildVmResourceId(id, node, type, vmid)
    const denied = await checkPermission(PERMISSIONS.VM_VIEW, "vm", resourceId)

    if (denied) return denied

    const conn = await getConnectionById(id)

    // Agent data (IPs, OS, filesystems) of a guest outside the vDC stays hidden.
    const scopeDenied = await guardSessionGuest({ connectionId: id, conn, type, node, vmid })
    if (scopeDenied) return scopeDenied

    // Récupérer le status actuel (contient uptime, pid)
    let uptime: number | undefined
    let status: string | undefined
    let pid: number | undefined

    try {
      const statusData = await pveFetch<any>(
        conn,
        `/nodes/${encodeURIComponent(node)}/${encodeURIComponent(type)}/${encodeURIComponent(vmid)}/status/current`
      )

      uptime = statusData?.uptime
      status = statusData?.status
      pid = statusData?.pid
    } catch (e) {
      console.error("[guest] Error fetching status:", e)
    }
    
    // Récupérer les interfaces réseau et infos OS via QEMU Guest Agent (seulement pour qemu, pas lxc)
    let ip: string | undefined
    let osInfo: OsInfo | undefined
    let diskUsage: { used: number; total: number } | undefined
    
    const agentConn = { ...conn, id }
    const interfaces = type === 'qemu' && status === 'running' ? await agentInterfaces(agentConn, node, vmid, uptime) : null

    if (interfaces) {
      // The agent answered: OS and filesystems in parallel. A command it
      // lacks or refuses does not start the mute.
      const [ipResult, osInfoResult, fsInfoResult] = await Promise.allSettled([
        // IP
        (async () => {
          try {
            const agentData = interfaces.answer
            
            // Chercher la première IP IPv4 non-loopback
            if (agentData?.result) {
              for (const iface of agentData.result) {
                if (iface['ip-addresses']) {
                  const ipv4 = iface['ip-addresses'].find(
                    (addr: any) => addr['ip-address-type'] === 'ipv4' && !addr['ip-address'].startsWith('127.')
                  )

                  if (ipv4) {
                    return ipv4['ip-address']
                  }
                }
              }
            }
          } catch {
            // An answer that does not have the expected shape: no address.
          }


return undefined
        })(),

        // OS Info
        (async (): Promise<OsInfo | undefined> => {
          try {
            const osData = await callGuestAgent<any>(agentConn, node, vmid, 'get-osinfo', { mute: false })
            
            const result = osData?.result || osData

            if (result && (result.id || result.name || result['pretty-name'])) {
              return {
                type: getOsType(result),
                name: result['pretty-name'] || result.name || null,
                version: result.version || result['version-id'] || null,
                kernel: result['kernel-release'] || null
              }
            }
          } catch {
            // Guest agent osinfo non disponible
          }

          
return undefined
        })(),

        // Filesystem info
        (async () => {
          try {
            const fsData = await callGuestAgent<any>(agentConn, node, vmid, 'get-fsinfo', { mute: false })
            const filesystems = fsData?.result || []

            // Virtual/network filesystem types to exclude -- these are not
            // backed by the VM's own virtual disks and would skew the totals
            // (e.g. a ZFS dataset mounted from the host reports the entire pool size).
            const virtualFsTypes = new Set([
              'tmpfs', 'devtmpfs', 'sysfs', 'proc', 'devpts', 'securityfs',
              'cgroup', 'cgroup2', 'pstore', 'efivarfs', 'bpf', 'debugfs',
              'tracefs', 'hugetlbfs', 'mqueue', 'fusectl', 'configfs',
              'overlay', 'squashfs', 'ramfs', 'autofs',
              'nfs', 'nfs4', 'cifs', 'smbfs', '9p', 'fuse.sshfs',
              'fuse.gvfsd-fuse', 'virtiofs',
            ])

            // Only count filesystems backed by real disk devices.
            // The guest agent populates the "disk" array only for filesystems
            // on actual virtual disks (virtio, scsi, ide, sata).
            const localFs = filesystems.filter((fs: any) => {
              if (!fs['total-bytes'] || fs['total-bytes'] <= 0) return false
              const fsType = (fs.type || '').toLowerCase()
              if (virtualFsTypes.has(fsType)) return false
              // Require at least one disk device entry
              if (Array.isArray(fs.disk) && fs.disk.length > 0) return true
              // Windows: guest agent may omit disk array but type is reliable
              if (['ntfs', 'refs', 'fat32', 'fat16', 'exfat', 'fat'].includes(fsType)) return true
              return false
            })

            // Fallback: if filtering excluded everything but raw data exists,
            // use all non-virtual filesystems (some guest agent versions
            // don't populate the disk array).
            const effective = localFs.length > 0
              ? localFs
              : filesystems.filter((fs: any) => {
                  if (!fs['total-bytes'] || fs['total-bytes'] <= 0) return false
                  const fsType = (fs.type || '').toLowerCase()
                  return !virtualFsTypes.has(fsType)
                })

            let totalBytes = 0
            let usedBytes = 0
            for (const fs of effective) {
              totalBytes += Number(fs['total-bytes'])
              usedBytes += Number(fs['used-bytes'] || 0)
            }
            if (totalBytes > 0) return { used: usedBytes, total: totalBytes }
          } catch {
            // Guest agent fsinfo not available
          }
          return undefined
        })()
      ])

      if (ipResult.status === 'fulfilled') ip = ipResult.value
      if (osInfoResult.status === 'fulfilled') osInfo = osInfoResult.value
      diskUsage = fsInfoResult.status === 'fulfilled' ? fsInfoResult.value : undefined
    }
    
    // Pour LXC, récupérer l'IP et l'OS depuis la config
    if (type === 'lxc') {
      try {
        const configData = await pveFetch<any>(
          conn,
          `/nodes/${encodeURIComponent(node)}/${encodeURIComponent(type)}/${encodeURIComponent(vmid)}/config`
        )
        
        // Récupérer l'IP - d'abord via les interfaces runtime (supporte DHCP), sinon fallback config statique
        if (status === 'running') {
          // Essayer l'endpoint interfaces pour obtenir l'IP réelle (DHCP inclus)
          try {
            const interfaces = await pveFetch<any[]>(
              conn,
              `/nodes/${encodeURIComponent(node)}/lxc/${encodeURIComponent(vmid)}/interfaces`
            )

            if (Array.isArray(interfaces)) {
              for (const iface of interfaces) {
                if (iface.name === 'lo') continue
                const inet = iface.inet

                if (inet) {
                  ip = inet.split('/')[0]
                  break
                }
              }
            }
          } catch {
            // interfaces endpoint not available, fallback to config
          }

          // Fallback: lire l'IP statique depuis la config
          if (!ip) {
            for (const key of Object.keys(configData || {})) {
              if (key.startsWith('net') && configData[key]) {
                const netConfig = configData[key]
                const ipMatch = netConfig.match(/ip=([^,\/]+)/)

                if (ipMatch && ipMatch[1] && ipMatch[1] !== 'dhcp') {
                  ip = ipMatch[1]
                  break
                }
              }
            }
          }
        }
        
        // Récupérer le type d'OS depuis ostype
        const ostype = configData?.ostype || ''

        if (ostype) {
          const isLinux = ['debian', 'ubuntu', 'centos', 'fedora', 'archlinux', 'alpine', 'gentoo', 'nixos', 'opensuse'].includes(ostype)

          osInfo = {
            type: isLinux ? 'linux' : 'other',
            name: ostype.charAt(0).toUpperCase() + ostype.slice(1),
            version: null,
            kernel: null
          }
        }
      } catch (e) {
        // LXC config fetch failed, non-critical
      }
    }

    return NextResponse.json({
      data: {
        ip,
        uptime,
        status,
        pid,
        osInfo,
        diskUsage
      }
    })
  } catch (e: any) {
    console.error("[guest] Error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
