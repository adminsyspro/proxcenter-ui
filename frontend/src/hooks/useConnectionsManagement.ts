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

  // VMware Connections
  const [vmwareConnections, setVmwareConnections] = useState<any[]>([])
  const [vmwareLoading, setVmwareLoading] = useState(true)
  const [vmwareError, setVmwareError] = useState<string | null>(null)

  // XCP-ng Connections
  const [xcpngConnections, setXcpngConnections] = useState<any[]>([])
  const [xcpngLoading, setXcpngLoading] = useState(true)
  const [xcpngError, setXcpngError] = useState<string | null>(null)

  // Hyper-V Connections
  const [hypervConnections, setHypervConnections] = useState<any[]>([])
  const [hypervLoading, setHypervLoading] = useState(true)
  const [hypervError, setHypervError] = useState<string | null>(null)

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

  const loadVmwareConnections = useCallback(async () => {
    setVmwareLoading(true)
    setVmwareError(null)

    try {
      const json = await fetchJson('/api/v1/connections?type=vmware')
      setVmwareConnections(Array.isArray(json?.data) ? json.data : [])
    } catch (e: any) {
      setVmwareError(e?.message || String(e))
      setVmwareConnections([])
    } finally {
      setVmwareLoading(false)
    }
  }, [])

  const loadXcpngConnections = useCallback(async () => {
    setXcpngLoading(true)
    setXcpngError(null)

    try {
      const json = await fetchJson('/api/v1/connections?type=xcpng')
      setXcpngConnections(Array.isArray(json?.data) ? json.data : [])
    } catch (e: any) {
      setXcpngError(e?.message || String(e))
      setXcpngConnections([])
    } finally {
      setXcpngLoading(false)
    }
  }, [])

  const loadHypervConnections = useCallback(async () => {
    setHypervLoading(true)
    setHypervError(null)

    try {
      const json = await fetchJson('/api/v1/connections?type=hyperv')
      setHypervConnections(Array.isArray(json?.data) ? json.data : [])
    } catch (e: any) {
      setHypervError(e?.message || String(e))
      setHypervConnections([])
    } finally {
      setHypervLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPveConnections()
    loadPbsConnections()
    loadVmwareConnections()
    loadXcpngConnections()
    loadHypervConnections()
  }, [loadPveConnections, loadPbsConnections, loadVmwareConnections, loadXcpngConnections, loadHypervConnections])

  return {
    pveConnections,
    pbsConnections,
    vmwareConnections,
    xcpngConnections,
    hypervConnections,
    pveLoading,
    pbsLoading,
    vmwareLoading,
    xcpngLoading,
    hypervLoading,
    pveError,
    pbsError,
    vmwareError,
    xcpngError,
    hypervError,
    loadPveConnections,
    loadPbsConnections,
    loadVmwareConnections,
    loadXcpngConnections,
    loadHypervConnections,
  }
}
