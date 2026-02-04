// src/lib/api/clusters.ts
type ClusterItem = {
  id: string
  name: string
  status: "healthy" | "degraded" | "down"
  nodes: number
  cpuUsagePct: number
  ramUsagePct: number
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" })
  const text = await res.text()

  let json: any = null

  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // non-json
  }

  if (!res.ok) {
    const msg =
      (json && (json.error || json.message)) ||
      (text ? text.slice(0, 200) : `HTTP ${res.status}`)

    throw new Error(msg)
  }

  return json as T
}

export const clustersApi = {
  async list(): Promise<ClusterItem[]> {
    const json = await fetchJson<{ data: ClusterItem[] }>("/api/v1/clusters")

    
return Array.isArray(json?.data) ? json.data : []
  },

  async get(connectionId: string) {
    const json = await fetchJson<{ data: any }>(`/api/v1/connections/${encodeURIComponent(connectionId)}/cluster`)

    
return json?.data
  },
}

