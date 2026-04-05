'use client'

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

import RollingUpdateWizard from '@/components/RollingUpdateWizard'
import { useLicense, Features } from '@/contexts/LicenseContext'

export type ActiveRollingUpdate = {
  id: string
  connection_id: string
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  total_nodes: number
  completed_nodes: number
  current_node: string
  created_at: string
  started_at?: string
}

type RollingUpdateContextValue = {
  /** Currently active rolling updates (running/paused/pending) */
  activeUpdates: ActiveRollingUpdate[]
  /** Open the wizard to monitor an existing rolling update */
  openMonitor: (rollingUpdateId: string, connectionId: string) => void
  /** Whether a rolling update is active for a given connection */
  hasActiveUpdate: (connectionId: string) => string | null
}

const RollingUpdateContext = createContext<RollingUpdateContextValue>({
  activeUpdates: [],
  openMonitor: () => {},
  hasActiveUpdate: () => null,
})

export function useRollingUpdates() {
  return useContext(RollingUpdateContext)
}

export function RollingUpdateProvider({ children }: { children: React.ReactNode }) {
  const { hasFeature, loading: licenseLoading } = useLicense()
  const rollingUpdatesAvailable = !licenseLoading && hasFeature(Features.ROLLING_UPDATES)

  const [activeUpdates, setActiveUpdates] = useState<ActiveRollingUpdate[]>([])
  const [wizardOpen, setWizardOpen] = useState(false)
  const [monitorId, setMonitorId] = useState<string | null>(null)
  const [monitorConnectionId, setMonitorConnectionId] = useState<string>('')

  // Poll for active rolling updates (15s when active, 60s when idle)
  const activeCountRef = useRef(0)

  useEffect(() => {
    if (!rollingUpdatesAvailable) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    const check = async () => {
      try {
        const res = await fetch('/api/v1/orchestrator/rolling-updates')
        const json = await res.json()
        if (cancelled || !res.ok) return
        const items: any[] = Array.isArray(json.data) ? json.data : []
        const active = items.filter((ru: any) => ['running', 'paused', 'pending'].includes(ru.status))
        activeCountRef.current = active.length
        setActiveUpdates(active)
      } catch {
        // orchestrator unavailable
      }

      if (!cancelled) {
        timer = setTimeout(check, activeCountRef.current > 0 ? 15_000 : 60_000)
      }
    }

    check()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [rollingUpdatesAvailable])

  const openMonitor = useCallback((rollingUpdateId: string, connectionId: string) => {
    setMonitorId(rollingUpdateId)
    setMonitorConnectionId(connectionId)
    setWizardOpen(true)
  }, [])

  const hasActiveUpdate = useCallback((connectionId: string): string | null => {
    const found = activeUpdates.find(ru => ru.connection_id === connectionId)
    return found?.id || null
  }, [activeUpdates])

  const handleClose = useCallback(() => {
    setWizardOpen(false)
    setMonitorId(null)
    setMonitorConnectionId('')
  }, [])

  return (
    <RollingUpdateContext.Provider value={{ activeUpdates, openMonitor, hasActiveUpdate }}>
      {children}
      {wizardOpen && (
        <RollingUpdateWizard
          open={wizardOpen}
          onClose={handleClose}
          connectionId={monitorConnectionId}
          nodes={[]}
          nodeUpdates={{}}
          resumeRollingUpdateId={monitorId}
        />
      )}
    </RollingUpdateContext.Provider>
  )
}
