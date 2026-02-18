import { useState, useEffect, useCallback } from 'react'

async function fetchJson(url: string, init?: RequestInit) {
  const r = await fetch(url, init)
  const text = await r.text()
  let json: any = null

  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // Response is not JSON — use raw text as error message
  }

  if (!r.ok) {
    let msg = json?.error || text || `HTTP ${r.status}`
    if (json?.details?.fieldErrors) {
      const fields = Object.entries(json.details.fieldErrors)
        .filter(([, v]) => (v as string[])?.length)
        .map(([k, v]) => `${k}: ${(v as string[]).join(', ')}`)
      if (fields.length) msg += ' — ' + fields.join('; ')
    }
    throw new Error(msg)
  }

  return json
}

export function useConnectionsManagement() {
  // PVE Connections
  const [pveConnections, setPveConnections] = useState<any[]>([])
  const [pveLoading, setPveLoading] = useState(true)
  const [pveError, setPveError] = useState<string | null>(null)

  // PBS Connections
  const [pbsConnections, setPbsConnections] = useState<any[]>([])
  const [pbsLoading, setPbsLoading] = useState(true)
  const [pbsError, setPbsError] = useState<string | null>(null)

  const loadPveConnections = useCallback(async () => {
    setPveLoading(true)
    setPveError(null)

    try {
      const json = await fetchJson('/api/v1/connections?type=pve')
      setPveConnections(Array.isArray(json?.data) ? json.data : [])
    } catch (e: any) {
      setPveError(e?.message || String(e))
      setPveConnections([])
    } finally {
      setPveLoading(false)
    }
  }, [])

  const loadPbsConnections = useCallback(async () => {
    setPbsLoading(true)
    setPbsError(null)

    try {
      const json = await fetchJson('/api/v1/connections?type=pbs')
      setPbsConnections(Array.isArray(json?.data) ? json.data : [])
    } catch (e: any) {
      setPbsError(e?.message || String(e))
      setPbsConnections([])
    } finally {
      setPbsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPveConnections()
    loadPbsConnections()
  }, [loadPveConnections, loadPbsConnections])

  return {
    pveConnections,
    pbsConnections,
    pveLoading,
    pbsLoading,
    pveError,
    pbsError,
    loadPveConnections,
    loadPbsConnections,
  }
}
