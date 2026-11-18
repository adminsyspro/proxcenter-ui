'use client'

import { useEffect, useMemo, useState } from 'react'

import { microsegApi } from '@/lib/microseg/api'
import type { PreflightCheck } from '@/lib/microseg/types'

import { firewallFindings, type FirewallFindings } from './preflightModel'

const NONE: Readonly<Record<string, FirewallFindings>> = {}

/**
 * The firewall findings of each cluster of a policy, read once per `round` (the plan dialog's opening, and each
 * Recompute: a click, never a timer), each through its own cluster's relay, once the plan has answered (`enabled`). A
 * policy of one cluster is read exactly like a shared one. A cluster whose checks cannot be read has no entry: nothing
 * is claimed about it and Apply is not held back.
 */
export function usePlanPreflights(ids: readonly string[], round: number, enabled: boolean): Readonly<Record<string, FirewallFindings>> {
  const key = enabled && ids.length > 0 ? `${round}:${[...ids].sort().join(',')}` : null
  const [read, setRead] = useState<{ key: string | null; byCluster: Readonly<Record<string, FirewallFindings>> }>({ key: null, byCluster: NONE })
  useEffect(() => {
    if (!key) return
    let cancelled = false
    const found: Record<string, FirewallFindings> = {}
    void Promise.all(ids.map(async id => {
      let checks: PreflightCheck[] | undefined
      try {
        checks = await microsegApi(id).getPreflight()
      } catch {
        return
      }
      found[id] = firewallFindings(checks)
    })).then(() => { if (!cancelled) setRead({ key, byCluster: found }) })
    return () => { cancelled = true }
    // `ids` only matters through `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return useMemo(() => (read.key === key ? read.byCluster : NONE), [read, key])
}
