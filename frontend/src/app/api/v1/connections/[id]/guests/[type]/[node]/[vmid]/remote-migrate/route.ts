import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

/**
 * POST /api/v1/connections/{id}/guests/{type}/{node}/{vmid}/remote-migrate
 * 
 * Lance une migration cross-cluster (remote_migrate) d'une VM vers un autre cluster Proxmox.
 * Utilise l'API Proxmox: POST /nodes/{node}/qemu/{vmid}/remote_migrate
 * 
 * Body params:
 * - targetConnectionId: string - ID de la connexion cible dans ProxCenter
 * - targetNode: string - Nom du nœud cible sur le cluster distant
 * - targetVmid?: number - VMID sur le cluster cible (optionnel, garde le même par défaut)
 * - targetStorage: string - Stockage cible sur le cluster distant
 * - targetBridge: string - Bridge réseau cible sur le cluster distant
 * - online?: boolean - Migration live si true (défaut: true si VM running)
 * - delete?: boolean - Supprimer la VM source après migration réussie (défaut: false)
 * - bwlimit?: number - Limite de bande passante en KiB/s (optionnel)
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; type: string; node: string; vmid: string }> }
) {
  try {
    const { id, type, node, vmid } = await ctx.params

    // Vérifier que c'est bien une VM QEMU (remote_migrate n'est pas supporté pour LXC actuellement)
    if (type !== 'qemu') {
      return NextResponse.json(
        { error: "Cross-cluster migration is currently only supported for QEMU VMs, not LXC containers" },
        { status: 400 }
      )
    }

    // RBAC: Check vm.migrate permission
    const resourceId = buildVmResourceId(id, node, type, vmid)
    const denied = await checkPermission(PERMISSIONS.VM_MIGRATE, "vm", resourceId)
    if (denied) return denied

    const body = await req.json()
    const {
      targetConnectionId,
      targetNode,
      targetVmid,
      targetStorage,
      targetBridge,
      online = true,
      delete: deleteSource = false,
      bwlimit,
    } = body

    // Validation des paramètres requis
    if (!targetConnectionId) {
      return NextResponse.json({ error: "targetConnectionId is required" }, { status: 400 })
    }
    if (!targetNode) {
      return NextResponse.json({ error: "targetNode is required" }, { status: 400 })
    }
    if (!targetStorage) {
      return NextResponse.json({ error: "targetStorage is required" }, { status: 400 })
    }
    if (!targetBridge) {
      return NextResponse.json({ error: "targetBridge is required" }, { status: 400 })
    }

    // Récupérer les informations de connexion source et cible
    const sourceConn = await getConnectionById(id)
    const targetConn = await getConnectionById(targetConnectionId)

    // Extraire l'host et le port de l'URL de la connexion cible
    const targetUrl = new URL(targetConn.baseUrl)
    const targetHost = targetUrl.hostname
    const targetPort = targetUrl.port || '8006'

    // Récupérer le fingerprint TLS du certificat du serveur cible
    // C'est le fingerprint SHA-256 du certificat TLS qui est requis par remote_migrate
    let targetFingerprint = ''
    
    try {
      // Méthode 1: Récupérer le fingerprint directement depuis le certificat TLS
      const tls = await import('tls')
      const net = await import('net')
      
      targetFingerprint = await new Promise<string>((resolve, reject) => {
        const socket = tls.connect({
          host: targetHost,
          port: parseInt(targetPort),
          rejectUnauthorized: false, // On accepte les certificats auto-signés
          timeout: 10000,
        }, () => {
          const cert = socket.getPeerCertificate()
          socket.end()
          
          if (cert && cert.fingerprint256) {
            // Le fingerprint est au format XX:XX:XX:... 
            resolve(cert.fingerprint256)
          } else if (cert && cert.fingerprint) {
            // Fallback sur SHA1 si SHA256 non disponible (moins courant)
            resolve(cert.fingerprint)
          } else {
            reject(new Error('No certificate fingerprint available'))
          }
        })
        
        socket.on('error', (err) => {
          reject(err)
        })
        
        socket.on('timeout', () => {
          socket.destroy()
          reject(new Error('Connection timeout'))
        })
      })
      
    } catch (tlsError) {
      console.warn('[remote-migrate] Failed to get TLS fingerprint:', tlsError)
      
      // Fallback: essayer les méthodes API Proxmox
      try {
        // Pour un cluster, essayer /cluster/config/join
        const joinInfo = await pveFetch<any>(targetConn, "/cluster/config/join")
        
        if (joinInfo?.fingerprint) {
          targetFingerprint = joinInfo.fingerprint
        } else if (joinInfo?.nodelist?.[0]?.pve_fp) {
          targetFingerprint = joinInfo.nodelist[0].pve_fp
        }
      } catch {
        // Pas un cluster ou pas d'accès
      }
      
      // Fallback: récupérer depuis /cluster/config/nodes
      if (!targetFingerprint) {
        try {
          const configNodes = await pveFetch<any[]>(targetConn, "/cluster/config/nodes")
          const targetNodeConfig = configNodes?.find((n: any) => n.name === targetNode)
          if (targetNodeConfig?.pve_fp) {
            targetFingerprint = targetNodeConfig.pve_fp
          }
        } catch {
          // Ignorer
        }
      }
    }
    
    if (!targetFingerprint) {
      return NextResponse.json(
        { error: "Could not retrieve TLS fingerprint from target cluster. Please ensure the target is reachable." },
        { status: 400 }
      )
    }

    // Construire le target-endpoint au format attendu par Proxmox
    // Format: apitoken=PVEAPIToken=<user>@<realm>!<token>=<secret>,host=<address>,fingerprint=<fp>[,port=<port>]
    const targetEndpointParts = [
      `apitoken=PVEAPIToken=${targetConn.apiToken}`,
      `host=${targetHost}`,
      `port=${targetPort}`,
      `fingerprint=${targetFingerprint}`,
    ]
    
    const targetEndpoint = targetEndpointParts.join(',')

    // Construire les paramètres de migration
    const migrateParams: Record<string, string> = {
      'target-endpoint': targetEndpoint,
      'target-storage': targetStorage,
      'target-bridge': targetBridge,
    }
    
    // VMID cible (optionnel)
    if (targetVmid !== undefined && targetVmid !== null && targetVmid !== '') {
      migrateParams['target-vmid'] = String(targetVmid)
    }
    
    // Migration online/offline
    if (online) {
      migrateParams['online'] = '1'
    }
    
    // Supprimer la source après migration
    if (deleteSource) {
      migrateParams['delete'] = '1'
    }
    
    // Limite de bande passante
    if (bwlimit !== undefined && bwlimit !== null && bwlimit !== '') {
      migrateParams['bwlimit'] = String(bwlimit)
    }

    // Appeler l'API Proxmox pour la migration cross-cluster
    const result = await pveFetch<string>(
      sourceConn,
      `/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(vmid)}/remote_migrate`,
      {
        method: 'POST',
        body: new URLSearchParams(
          Object.entries(migrateParams).map(([k, v]) => [k, v])
        ).toString(),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    )

    return NextResponse.json({
      success: true,
      data: result, // UPID de la tâche
      message: `Cross-cluster migration of VM ${vmid} to ${targetNode}@${targetHost} started`,
      details: {
        sourceCluster: sourceConn.name,
        targetCluster: targetConn.name,
        targetNode,
        targetStorage,
        targetBridge,
        online,
        deleteSource,
      }
    })

  } catch (e: any) {
    console.error('[remote-migrate] Error:', e)
    
    // Parser le message d'erreur Proxmox pour le rendre plus lisible
    let errorMessage = e?.message || String(e)
    
    // Erreurs communes
    if (errorMessage.includes('no export formats')) {
      errorMessage = 'Cloud-init drives cannot be migrated. Please remove or reconfigure the cloud-init drive before migration.'
    } else if (errorMessage.includes('permission denied') || errorMessage.includes('401')) {
      errorMessage = 'Permission denied on target cluster. Please verify the API token has sufficient permissions (VM.Migrate, Datastore.AllocateSpace, etc.)'
    } else if (errorMessage.includes('storage') && errorMessage.includes('not found')) {
      errorMessage = `Target storage not found or not accessible. Verify the storage "${errorMessage}" exists and the API token has access.`
    }
    
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
