import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ id: string; type: string; node: string; vmid: string }>
}

// Déterminer le type d'OS à partir des infos du guest agent
function getOsType(osInfo: any): 'linux' | 'windows' | 'other' {
  if (!osInfo) return 'other'
  
  const id = (osInfo.id || '').toLowerCase()
  const name = (osInfo.name || '').toLowerCase()
  
  // Windows
  if (id === 'mswindows' || name.includes('windows')) {
    return 'windows'
  }
  
  // Linux distributions
  const linuxDistros = ['debian', 'ubuntu', 'centos', 'rhel', 'fedora', 'alpine', 'arch', 'opensuse', 'suse', 'mint', 'manjaro', 'rocky', 'alma', 'oracle', 'gentoo', 'slackware', 'nixos']

  if (linuxDistros.some(d => id.includes(d) || name.includes(d)) || name.includes('linux')) {
    return 'linux'
  }
  
  return 'other'
}

type OsInfo = {
  type: 'linux' | 'windows' | 'other'
  name: string | null
  version: string | null
  kernel: string | null
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
    
    if (type === 'qemu' && status === 'running') {
      // Récupérer IP et OS info en parallèle
      const [ipResult, osInfoResult, fsInfoResult] = await Promise.allSettled([
        // IP
        (async () => {
          try {
            const agentData = await pveFetch<any>(
              conn,
              `/nodes/${encodeURIComponent(node)}/${encodeURIComponent(type)}/${encodeURIComponent(vmid)}/agent/network-get-interfaces`
            )
            
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
          } catch (e: any) {
            // Distinguer les erreurs de permission (403) des autres erreurs
            const msg = e?.message || ''

            if (msg.includes('403') || msg.includes('Permission')) {
              // Permission manquante sur Proxmox (VM.Monitor requis)
              // Ne pas logger en erreur, c'est une configuration Proxmox
            } else if (msg.includes('500') && msg.includes('QEMU guest agent is not running')) {
              // Guest agent non démarré - normal
            }
          }


return undefined
        })(),

        // OS Info
        (async (): Promise<OsInfo | undefined> => {
          try {
            const osData = await pveFetch<any>(
              conn,
              `/nodes/${encodeURIComponent(node)}/${encodeURIComponent(type)}/${encodeURIComponent(vmid)}/agent/get-osinfo`
            )
            
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
            const fsData = await pveFetch<any>(
              conn,
              `/nodes/${encodeURIComponent(node)}/${encodeURIComponent(type)}/${encodeURIComponent(vmid)}/agent/get-fsinfo`
            )
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
