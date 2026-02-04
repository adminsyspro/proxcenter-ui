import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

/**
 * POST /api/v1/vms/ips
 * 
 * Récupère les IPs, snapshots, uptime et infos OS pour une liste de VMs.
 * Appelé à la demande via le bouton "Charger IPs".
 * 
 * Body: { vms: [{ connId, type, node, vmid, status }] }
 * Response: { data: { "connId:type:node:vmid": { ip, snapshots, uptime, osInfo }, ... } }
 */

function secondsToUptime(seconds: number) {
  if (!seconds || seconds < 0) return null
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)

  if (d > 0) return `${d}j ${h}h`
  if (h > 0) return `${h}h ${m}m`
  
return `${m}m`
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
  
  // FreeBSD, etc.
  if (id.includes('freebsd') || id.includes('openbsd') || id.includes('netbsd')) {
    return 'other'
  }
  
  return 'other'
}

type OsInfo = {
  type: 'linux' | 'windows' | 'other'
  name: string | null
  version: string | null
  kernel: string | null
}

async function getVmDetails(connData: any, vm: { type: string, node: string, vmid: string, status?: string }): Promise<{ ip: string | null, snapshots: number, uptime: string | null, osInfo: OsInfo | null }> {
  const { type, node, vmid, status } = vm
  let ip: string | null = null
  let snapshots = 0
  let uptime: string | null = null
  let osInfo: OsInfo | null = null
  
  // Récupérer IP, snapshots, status (pour uptime) et OS info en parallèle
  const [ipResult, snapshotsResult, statusResult, osInfoResult] = await Promise.allSettled([
    // IP
    (async () => {
      if (status !== 'running') return null
      
      if (type === 'qemu') {
        // Essayer le guest-agent
        try {
          const interfaces = await pveFetch<any>(
            connData,
            `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/agent/network-get-interfaces`
          )
          
          const result = interfaces?.result || interfaces || []

          for (const iface of result) {
            if (iface.name === 'lo') continue
            const ipAddrs = iface['ip-addresses'] || []

            for (const addr of ipAddrs) {
              if (addr['ip-address-type'] === 'ipv4' && addr['ip-address'] && !addr['ip-address'].startsWith('127.')) {
                return addr['ip-address']
              }
            }
          }
        } catch {
          // Fallback sur la config
          try {
            const config = await pveFetch<any>(
              connData,
              `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`
            )

            const ipconfigValue = config?.ipconfig0 || ''

            if (ipconfigValue) {
              const match = ipconfigValue.match(/ip=([^/,]+)/)

              if (match && match[1] !== 'dhcp') return match[1]
            }
          } catch {}
        }
      } else if (type === 'lxc') {
        try {
          const config = await pveFetch<any>(
            connData,
            `/nodes/${encodeURIComponent(node)}/lxc/${vmid}/config`
          )

          const netValue = config?.net0 || ''

          if (netValue) {
            const match = netValue.match(/ip=([^/,]+)/)

            if (match && match[1] !== 'dhcp') return match[1]
          }
        } catch {}
      }

      
return null
    })(),
    
    // Snapshots
    (async () => {
      try {
        const snapshotList = await pveFetch<any[]>(
          connData,
          `/nodes/${encodeURIComponent(node)}/${type}/${vmid}/snapshot`
        )


        // Le snapshot "current" n'est pas un vrai snapshot
        return Array.isArray(snapshotList) 
          ? snapshotList.filter(s => s.name !== 'current').length 
          : 0
      } catch {
        return 0
      }
    })(),
    
    // Status (pour uptime)
    (async () => {
      if (status !== 'running') return null

      try {
        const vmStatus = await pveFetch<any>(
          connData,
          `/nodes/${encodeURIComponent(node)}/${type}/${vmid}/status/current`
        )

        
return vmStatus?.uptime ? secondsToUptime(vmStatus.uptime) : null
      } catch {
        return null
      }
    })(),
    
    // OS Info via guest agent
    (async (): Promise<OsInfo | null> => {
      if (status !== 'running') return null
      
      if (type === 'qemu') {
        try {
          const osData = await pveFetch<any>(
            connData,
            `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/agent/get-osinfo`
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
          // Guest agent non disponible ou non installé
        }
      } else if (type === 'lxc') {
        // Pour LXC, on peut essayer de deviner depuis la config
        try {
          const config = await pveFetch<any>(
            connData,
            `/nodes/${encodeURIComponent(node)}/lxc/${vmid}/config`
          )

          const ostype = config?.ostype || ''

          if (ostype) {
            // ostype peut être: debian, ubuntu, centos, fedora, archlinux, alpine, gentoo, nixos, opensuse, unmanaged
            const isLinux = ['debian', 'ubuntu', 'centos', 'fedora', 'archlinux', 'alpine', 'gentoo', 'nixos', 'opensuse'].includes(ostype)

            
return {
              type: isLinux ? 'linux' : 'other',
              name: ostype.charAt(0).toUpperCase() + ostype.slice(1),
              version: null,
              kernel: null
            }
          }
        } catch {}
      }

      
return null
    })()
  ])
  
  if (ipResult.status === 'fulfilled') ip = ipResult.value
  if (snapshotsResult.status === 'fulfilled') snapshots = snapshotsResult.value
  if (statusResult.status === 'fulfilled') uptime = statusResult.value
  if (osInfoResult.status === 'fulfilled') osInfo = osInfoResult.value
  
  return { ip, snapshots, uptime, osInfo }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const vms = body.vms || []
    
    if (!Array.isArray(vms) || vms.length === 0) {
      return NextResponse.json({ data: {} })
    }

    // Grouper par connexion
    const byConnection = new Map<string, Array<{ type: string, node: string, vmid: string, status?: string }>>()

    for (const vm of vms) {
      if (!vm.connId || !vm.type || !vm.node || !vm.vmid) continue

      if (!byConnection.has(vm.connId)) {
        byConnection.set(vm.connId, [])
      }

      byConnection.get(vm.connId)!.push({ type: vm.type, node: vm.node, vmid: vm.vmid, status: vm.status })
    }

    const data: Record<string, { ip: string | null, snapshots: number, uptime: string | null, osInfo: OsInfo | null }> = {}

    // Traiter chaque connexion en parallèle
    await Promise.all(
      Array.from(byConnection.entries()).map(async ([connId, connVms]) => {
        try {
          const connData = await getConnectionById(connId)
          
          // Récupérer les détails en parallèle
          const results = await Promise.allSettled(
            connVms.map(async (vm) => {
              const details = await getVmDetails(connData, vm)
              const key = `${connId}:${vm.type}:${vm.node}:${vm.vmid}`

              
return { key, ...details }
            })
          )
          
          for (const result of results) {
            if (result.status === 'fulfilled') {
              data[result.value.key] = { 
                ip: result.value.ip, 
                snapshots: result.value.snapshots,
                uptime: result.value.uptime,
                osInfo: result.value.osInfo
              }
            }
          }
        } catch (e) {
          console.error(`[vms/ips] Error for connection ${connId}:`, e)
        }
      })
    )

    return NextResponse.json({ data })
  } catch (e: any) {
    console.error("[vms/ips] Error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
