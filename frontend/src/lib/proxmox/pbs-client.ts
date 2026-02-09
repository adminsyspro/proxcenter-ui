// src/lib/proxmox/pbs-client.ts
import { Agent, request } from "undici"

let insecureAgent: Agent | null = null
function getInsecureAgent(): Agent {
  if (!insecureAgent) {
    insecureAgent = new Agent({ connect: { rejectUnauthorized: false } })
  }
  return insecureAgent
}

export type PbsClientOptions = {
  baseUrl: string
  apiToken: string  // Format attendu: user@realm!tokenid:secret (avec :)
  insecureDev?: boolean
}

/**
 * Client pour Proxmox Backup Server
 * L'API PBS utilise PBSAPIToken avec le format user@realm!tokenid:secret
 * (différent de PVE qui utilise = au lieu de :)
 */
export async function pbsFetch<T>(
  opts: PbsClientOptions,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  if (!opts?.baseUrl) throw new Error("pbsFetch: missing baseUrl")
  if (!opts?.apiToken) throw new Error("pbsFetch: missing apiToken")

  const url = `${opts.baseUrl.replace(/\/$/, "")}/api2/json${path}`

  const dispatcher = opts.insecureDev
    ? getInsecureAgent()
    : undefined

  const method = String(init.method || "GET").toUpperCase()

  // Headers - PBS utilise PBSAPIToken (pas PVEAPIToken)
  // et le format est user@realm!tokenid:secret (avec : pas =)
  const headers: Record<string, string> = {
    Authorization: `PBSAPIToken=${opts.apiToken}`,
    ...(init.headers as any),
  }

  // Body
  let body: any = undefined

  if (init.body !== undefined && init.body !== null) {
    body =
      typeof init.body === "string" || init.body instanceof Uint8Array
        ? init.body
        : JSON.stringify(init.body)

    if (!headers["Content-Type"]) headers["Content-Type"] = "application/json"
  }

  const res = await request(url, {
    method,
    headers,
    body,
    dispatcher,
    signal: init.signal ?? undefined,
  })

  const text = await res.body.text()

  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`PBS ${res.statusCode} ${path}: ${text}`)
  }

  let json: any

  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`PBS invalid JSON (${res.statusCode}): ${text.slice(0, 200)}`)
  }

  return json.data as T
}
