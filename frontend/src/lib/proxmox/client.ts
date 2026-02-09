// src/lib/proxmox/client.ts
import { Agent, request } from "undici"

let insecureAgent: Agent | null = null
export function getInsecureAgent(): Agent {
  if (!insecureAgent) {
    insecureAgent = new Agent({ connect: { rejectUnauthorized: false } })
  }
  return insecureAgent
}

export type ProxmoxClientOptions = {
  baseUrl: string
  apiToken: string
  insecureDev?: boolean // tu peux continuer à utiliser ce nom
}

export async function pveFetch<T>(
  opts: ProxmoxClientOptions,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  if (!opts?.baseUrl) throw new Error("pveFetch: missing baseUrl")
  if (!opts?.apiToken) throw new Error("pveFetch: missing apiToken")

  const url = `${opts.baseUrl.replace(/\/$/, "")}/api2/json${path}`

  const dispatcher = opts.insecureDev
    ? getInsecureAgent()
    : undefined

  const method = String(init.method || "GET").toUpperCase()

  // Headers
  const headers: Record<string, string> = {
    Authorization: `PVEAPIToken=${opts.apiToken}`,
    ...(init.headers as any),
  }

  // Body (si tu postes du JSON un jour)
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
    throw new Error(`PVE ${res.statusCode} ${path}: ${text}`)
  }

  let json: any

  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`PVE invalid JSON (${res.statusCode}): ${text.slice(0, 200)}`)
  }

  return json.data as T
}
