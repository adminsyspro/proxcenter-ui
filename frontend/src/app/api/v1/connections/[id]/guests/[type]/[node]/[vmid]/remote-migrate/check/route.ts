import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

type ValidationIssue = {
  type: 'error' | 'warning'
  code: string
  message: string
  details?: string
}

/**
 * POST /api/v1/connections/{id}/guests/{type}/{node}/{vmid}/remote-migrate/check
 * 
 * Valide la compatibilité d'une VM pour une migration cross-cluster AVANT de lancer la migration.
 * Retourne une liste de problèmes potentiels (erreurs bloquantes et avertissements).
 * 
 * Body params:
 * - targetConnectionId: string - ID de la connexion cible
 * - targetNode: string - Nom du nœud cible
 * - targetStorage: string - Stockage cible
 * - targetBridge: string - Bridge réseau cible
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; type: string; node: string; vmid: string }> }
) {
  try {
    const { id, type, node, vmid } = await ctx.params
    const issues: ValidationIssue[] = []

    // Vérifier que c'est bien une VM QEMU
    if (type !== 'qemu') {
      issues.push({
        type: 'error',
        code: 'LXC_NOT_SUPPORTED',
        message: 'Cross-cluster migration is only supported for QEMU VMs',
        details: 'LXC containers cannot be migrated using remote_migrate API'
      })
      return NextResponse.json({ valid: false, issues })
    }

    // RBAC
    const resourceId = buildVmResourceId(id, node, type, vmid)
    const denied = await checkPermission(PERMISSIONS.VM_MIGRATE, "vm", resourceId)
    if (denied) return denied

    const body = await req.json()
    const { targetConnectionId, targetNode, targetStorage, targetBridge } = body

    if (!targetConnectionId || !targetNode || !targetStorage || !targetBridge) {
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 })
    }

    // Récupérer les connexions
    const sourceConn = await getConnectionById(id)
    const targetConn = await getConnectionById(targetConnectionId)

    // ========== VÉRIFICATIONS SOURCE ==========
    
    // 1. Récupérer la config de la VM source
    let vmConfig: any = {}
    try {
      vmConfig = await pveFetch<any>(sourceConn, `/nodes/${node}/qemu/${vmid}/config`)
    } catch (e: any) {
      issues.push({
        type: 'error',
        code: 'SOURCE_VM_NOT_FOUND',
        message: 'Cannot retrieve source VM configuration',
        details: e.message
      })
      return NextResponse.json({ valid: false, issues })
    }

    // 2. Vérifier HA
    try {
      const haResources = await pveFetch<any[]>(sourceConn, '/cluster/ha/resources')
      const vmSid = `vm:${vmid}`
      const haResource = haResources?.find((r: any) => r.sid === vmSid)
      if (haResource) {
        issues.push({
          type: 'error',
          code: 'HA_ENABLED',
          message: 'VM is managed by High Availability (HA)',
          details: `State: ${haResource.state || 'unknown'}. Remove from HA before migration.`
        })
      }
    } catch {
      // HA check failed, continue anyway
    }

    // 3. Extraire les infos réseau de la VM source
    const vmNetworks: { id: string; bridge: string; mtu?: number }[] = []
    for (const [key, value] of Object.entries(vmConfig)) {
      if (/^net\d+$/.test(key) && typeof value === 'string') {
        const bridgeMatch = value.match(/bridge=([^,]+)/)
        const mtuMatch = value.match(/mtu=(\d+)/)
        if (bridgeMatch) {
          vmNetworks.push({
            id: key,
            bridge: bridgeMatch[1],
            mtu: mtuMatch ? parseInt(mtuMatch[1]) : undefined
          })
        }
      }
    }

    // 4. Vérifier cloud-init (peut causer des problèmes)
    for (const [key, value] of Object.entries(vmConfig)) {
      if (typeof value === 'string' && value.includes('cloudinit')) {
        issues.push({
          type: 'warning',
          code: 'CLOUD_INIT_DRIVE',
          message: `Cloud-init drive detected on ${key}`,
          details: 'Cloud-init drives may cause "no export formats" errors. Consider removing before migration.'
        })
      }
    }

    // 5. Vérifier CPU type host
    if (vmConfig.cpu && vmConfig.cpu.includes('host')) {
      issues.push({
        type: 'warning',
        code: 'CPU_HOST',
        message: 'VM uses CPU type "host"',
        details: 'Live migration may fail if target CPU is different. Consider using a generic CPU type.'
      })
    }

    // ========== VÉRIFICATIONS CIBLE ==========

    // 6. Vérifier que le nœud cible existe et est online
    try {
      const targetNodes = await pveFetch<any[]>(targetConn, '/nodes')
      const targetNodeInfo = targetNodes?.find((n: any) => n.node === targetNode)
      if (!targetNodeInfo) {
        issues.push({
          type: 'error',
          code: 'TARGET_NODE_NOT_FOUND',
          message: `Target node "${targetNode}" not found`,
          details: 'The specified target node does not exist on the target cluster'
        })
      } else if (targetNodeInfo.status !== 'online') {
        issues.push({
          type: 'error',
          code: 'TARGET_NODE_OFFLINE',
          message: `Target node "${targetNode}" is offline`,
          details: `Current status: ${targetNodeInfo.status}`
        })
      }
    } catch (e: any) {
      issues.push({
        type: 'error',
        code: 'TARGET_CLUSTER_UNREACHABLE',
        message: 'Cannot connect to target cluster',
        details: e.message
      })
      return NextResponse.json({ valid: false, issues })
    }

    // 7. Vérifier le stockage cible
    try {
      const targetStorages = await pveFetch<any[]>(targetConn, `/nodes/${targetNode}/storage`)
      const storageInfo = targetStorages?.find((s: any) => s.storage === targetStorage)
      if (!storageInfo) {
        issues.push({
          type: 'error',
          code: 'TARGET_STORAGE_NOT_FOUND',
          message: `Target storage "${targetStorage}" not found`,
          details: `Storage not available on node ${targetNode}`
        })
      } else {
        // Vérifier si le stockage peut accueillir des images VM
        if (storageInfo.content && !storageInfo.content.includes('images')) {
          issues.push({
            type: 'error',
            code: 'TARGET_STORAGE_NO_IMAGES',
            message: `Target storage "${targetStorage}" cannot store VM images`,
            details: `Content types: ${storageInfo.content}`
          })
        }
        // Vérifier l'espace disponible
        if (storageInfo.avail !== undefined && storageInfo.avail < 1024 * 1024 * 1024) { // < 1GB
          issues.push({
            type: 'warning',
            code: 'TARGET_STORAGE_LOW_SPACE',
            message: `Target storage "${targetStorage}" has low available space`,
            details: `Available: ${(storageInfo.avail / (1024 * 1024 * 1024)).toFixed(2)} GB`
          })
        }
      }
    } catch (e: any) {
      issues.push({
        type: 'warning',
        code: 'TARGET_STORAGE_CHECK_FAILED',
        message: 'Could not verify target storage',
        details: e.message
      })
    }

    // 8. Vérifier le bridge cible et son MTU
    try {
      const targetNetwork = await pveFetch<any[]>(targetConn, `/nodes/${targetNode}/network`)
      const bridgeInfo = targetNetwork?.find((n: any) => n.iface === targetBridge)
      
      if (!bridgeInfo) {
        issues.push({
          type: 'error',
          code: 'TARGET_BRIDGE_NOT_FOUND',
          message: `Target bridge "${targetBridge}" not found`,
          details: `Bridge not available on node ${targetNode}`
        })
      } else {
        // Vérifier le type (doit être un bridge)
        if (bridgeInfo.type !== 'bridge' && bridgeInfo.type !== 'OVSBridge') {
          issues.push({
            type: 'warning',
            code: 'TARGET_NOT_A_BRIDGE',
            message: `"${targetBridge}" is not a bridge interface`,
            details: `Type: ${bridgeInfo.type}`
          })
        }

        // Vérifier MTU
        const targetMtu = bridgeInfo.mtu || 1500
        for (const net of vmNetworks) {
          const vmMtu = net.mtu || 1500
          if (vmMtu > targetMtu) {
            issues.push({
              type: 'error',
              code: 'MTU_MISMATCH',
              message: `MTU mismatch: VM ${net.id} has MTU ${vmMtu}, target bridge has MTU ${targetMtu}`,
              details: `Reduce VM's ${net.id} MTU to ${targetMtu} or less, or increase target bridge MTU`
            })
          }
        }
      }
    } catch (e: any) {
      issues.push({
        type: 'warning',
        code: 'TARGET_NETWORK_CHECK_FAILED',
        message: 'Could not verify target network configuration',
        details: e.message
      })
    }

    // 9. Vérifier si le VMID est déjà utilisé sur la cible
    try {
      const targetVms = await pveFetch<any[]>(targetConn, '/cluster/resources?type=vm')
      const existingVm = targetVms?.find((v: any) => v.vmid === parseInt(vmid))
      if (existingVm) {
        issues.push({
          type: 'warning',
          code: 'VMID_EXISTS_ON_TARGET',
          message: `VMID ${vmid} already exists on target cluster`,
          details: `Existing VM: ${existingVm.name || 'unnamed'} on ${existingVm.node}. Use a different target VMID.`
        })
      }
    } catch {
      // Non-blocking check
    }

    // 10. Vérifier les ressources du nœud cible (CPU/RAM)
    try {
      const targetNodeStatus = await pveFetch<any>(targetConn, `/nodes/${targetNode}/status`)
      const vmCores = vmConfig.cores || 1
      const vmSockets = vmConfig.sockets || 1
      const vmMemory = vmConfig.memory || 512

      // Vérifier CPU
      const targetMaxCpu = targetNodeStatus.cpuinfo?.cpus || 0
      if (vmCores * vmSockets > targetMaxCpu) {
        issues.push({
          type: 'warning',
          code: 'INSUFFICIENT_CPU',
          message: `VM requires ${vmCores * vmSockets} vCPUs, target has ${targetMaxCpu}`,
          details: 'VM may have performance issues'
        })
      }

      // Vérifier RAM disponible
      const targetFreeMemory = (targetNodeStatus.memory?.free || 0) / (1024 * 1024) // En MB
      if (vmMemory > targetFreeMemory) {
        issues.push({
          type: 'warning',
          code: 'INSUFFICIENT_MEMORY',
          message: `VM requires ${vmMemory} MB RAM, target has ${Math.round(targetFreeMemory)} MB free`,
          details: 'Consider freeing up memory on target node'
        })
      }
    } catch {
      // Non-blocking check
    }

    // Déterminer si la migration est valide (pas d'erreurs bloquantes)
    const hasErrors = issues.some(i => i.type === 'error')

    return NextResponse.json({
      valid: !hasErrors,
      issues,
      summary: {
        errors: issues.filter(i => i.type === 'error').length,
        warnings: issues.filter(i => i.type === 'warning').length
      }
    })

  } catch (e: any) {
    console.error('[remote-migrate/check] Error:', e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
