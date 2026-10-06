import { NextResponse } from "next/server"

import { request } from "undici"

import { getConnectionById } from "@/lib/connections/getConnection"
import { getInsecureAgent } from "@/lib/proxmox/client"
import { authorizeFileRestore, fileRestoreDenied, pickFileRestoreNode } from "@/lib/vdc/fileRestoreScope"

export interface FileRestoreTarget {
  conn: Awaited<ReturnType<typeof getConnectionById>>
  dispatcher: ReturnType<typeof getInsecureAgent> | undefined
  nodeName: string
  volumeId: string
}

/**
 * Shared preamble of the three file-restore routes: tenant scope on storage,
 * volume and node (before any Proxmox request), then the node that serves the
 * restore. Returns the response to send when the request cannot go on.
 */
export async function resolveFileRestoreTarget(
  connId: string,
  storage: string,
  volume: string,
): Promise<FileRestoreTarget | Response> {
  const access = await authorizeFileRestore(connId, storage, volume)
  if (access instanceof Response) return access

  const conn = await getConnectionById(connId)

  const dispatcher = conn.insecureDev
    ? getInsecureAgent()
    : undefined

  // Un node qui a accès au storage (important pour PBS avec encryption key)
  const resourcesUrl = `${conn.baseUrl.replace(/\/$/, "")}/api2/json/cluster/resources`

  const resourcesRes = await request(resourcesUrl, {
    method: 'GET',
    headers: { Authorization: `PVEAPIToken=${conn.apiToken}` },
    dispatcher,
  })

  const resourcesJson = JSON.parse(await resourcesRes.body.text())
  const allResources = resourcesJson.data || []

  const nodeName = pickFileRestoreNode(allResources, storage, access.allowedNodes)

  if (!nodeName) {
    if (access.allowedNodes) return fileRestoreDenied()

    return NextResponse.json({ error: "No available node found with storage access" }, { status: 500 })
  }

  return { conn, dispatcher, nodeName, volumeId: access.volumeId }
}
