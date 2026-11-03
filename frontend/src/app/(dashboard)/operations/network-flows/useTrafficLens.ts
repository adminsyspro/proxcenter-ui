'use client'

import { useCallback, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Features, useLicense } from '@/contexts/LicenseContext'
import { usePVEConnections } from '@/hooks/useConnections'
import { useSWRFetch } from '@/hooks/useSWRFetch'
import { zoneGuestsUrl } from '@/lib/microseg/runRefresh'
import { useMicrosegPolicy } from '@/lib/microseg/useMicroseg'
import { useMicrosegSuggestions } from '@/lib/microseg/useMicrosegLists'
import type { MicrosegPolicy, MicrosegSuggestion, MicrosegZone } from '@/lib/microseg/types'
import {
  EXTERNAL_KEY, OTHER_KEY, UNZONED_KEY, buildResolver, groupColor, pairVerdict,
  type LensGuest, type LensPair, type PairVerdict, type Resolver,
} from '@/lib/microseg/trafficLens'

export type GroupBy = 'vm' | 'ip' | 'zone'
export const GROUP_BY_VALUES: readonly GroupBy[] = ['vm', 'ip', 'zone']

const GROUP_BY_KEY = 'networkFlows.groupBy'
const CONNECTION_KEY = 'networkFlows.lensConnection'

/** The pending suggestions the statuses are matched with: one page, the largest the API serves. */
const SUGGESTION_PARAMS = { status: 'pending' as const, limit: 200 }

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function store(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Private window or blocked storage: the choice just is not remembered.
  }
}

function readQuery(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name)
  } catch {
    return null
  }
}

const isGroupBy = (value: unknown): value is GroupBy => GROUP_BY_VALUES.includes(value as GroupBy)

/** The grouping of the page: ?groupBy= first (the link of the Micro-segmentation tab), then the stored choice, then VM. */
export function useGroupBy(): [GroupBy, (next: GroupBy) => void] {
  const [groupBy, setGroupBy] = useState<GroupBy>(() => {
    const asked = readQuery('groupBy')
    if (isGroupBy(asked)) return asked
    const stored = readStored(GROUP_BY_KEY)
    return isGroupBy(stored) ? stored : 'vm'
  })
  const choose = useCallback((next: GroupBy) => {
    setGroupBy(next)
    store(GROUP_BY_KEY, next)
  }, [])
  return [groupBy, choose]
}

export type LensConnection = { id: string; name: string }

/** The PVE connection the zones are read from: ?connection=, then the stored one, then the first. */
export function useLensConnection(): { connections: LensConnection[]; connectionId: string | null; choose: (id: string) => void } {
  const { data } = usePVEConnections()
  const connections = useMemo<LensConnection[]>(
    () => (Array.isArray(data?.data) ? data.data : []).map((c: { id: string; name?: string }) => ({ id: c.id, name: c.name || c.id })),
    [data],
  )
  const [wanted, setWanted] = useState<string | null>(() => readQuery('connection') ?? readStored(CONNECTION_KEY))
  const connectionId = connections.find(c => c.id === wanted)?.id ?? connections[0]?.id ?? null
  const choose = useCallback((id: string) => {
    setWanted(id)
    store(CONNECTION_KEY, id)
  }, [])
  return { connections, connectionId, choose }
}

type VmsResponse = {
  data?: { vms?: { vmid?: string | number; name?: string; node?: string; type?: string; template?: boolean; tags?: string[]; ips?: string[] }[] }
}

function lensGuests(data: VmsResponse | undefined): LensGuest[] {
  return (data?.data?.vms ?? [])
    .filter(vm => !vm.template && vm.node && vm.vmid !== undefined)
    .map(vm => ({
      vmid: Number(vm.vmid),
      name: vm.name || `${vm.type}/${vm.vmid}`,
      tags: Array.isArray(vm.tags) ? vm.tags : [],
      ips: Array.isArray(vm.ips) ? vm.ips.filter(ip => typeof ip === 'string') : [],
    }))
}

/**
 * Not licensed, still loading, no policy applied yet (the zones mean nothing on Proxmox), a read failed, or ready.
 */
export type LensState = 'off' | 'loading' | 'unavailable' | 'error' | 'ready'

export type TrafficLens = {
  connectionId: string
  policy: MicrosegPolicy
  suggestions: MicrosegSuggestion[]
  zonesById: ReadonlyMap<string, MicrosegZone>
  resolve: Resolver
  labelOf: (key: string) => string
  colorOf: (key: string) => string
  verdictOf: (pair: LensPair) => PairVerdict
}

export type TrafficLensRead = {
  state: LensState
  lens: TrafficLens | null
  /** Read the draft and the suggestions again (after a flow was created or a suggestion accepted). */
  reloadPolicy: () => Promise<unknown>
  reloadSuggestions: () => Promise<unknown>
}

function lensState(licensed: boolean, connectionId: string | null, reads: { policy: MicrosegPolicy | undefined; policyError: unknown; ready: boolean; failed: boolean }): LensState {
  if (!licensed || !connectionId) return 'off'
  if (reads.policyError) return 'error'
  if (!reads.policy) return 'loading'
  if (!reads.policy.last_revision) return 'unavailable'
  if (reads.failed) return 'error'
  return reads.ready ? 'ready' : 'loading'
}

/**
 * The micro-segmentation of a connection as the Network flows page reads it: the draft (zones and flows), its pending
 * suggestions and the guests with their tags and addresses. The suggestions and the guests are only read once a
 * policy has been applied. No Proxmox call of its own: the guest list is the inventory route the zone map reads too.
 */
export function useTrafficLens(connectionId: string | null): TrafficLensRead {
  const t = useTranslations('microsegPilot.trafficLens')
  const { hasFeature } = useLicense()
  const licensed = hasFeature(Features.MICROSEGMENTATION)
  const conn = licensed ? connectionId : null

  const policyRead = useMicrosegPolicy(conn)
  const policy = policyRead.data
  const deployed = !!policy?.last_revision
  const suggestionsRead = useMicrosegSuggestions(deployed ? conn : null, SUGGESTION_PARAMS)
  const guestsRead = useSWRFetch<VmsResponse>(deployed && conn ? zoneGuestsUrl(conn) : null, { revalidateOnFocus: false })

  const state = lensState(licensed, conn, {
    policy,
    policyError: policyRead.error,
    ready: !!suggestionsRead.data && !!guestsRead.data,
    failed: !!suggestionsRead.error || !!guestsRead.error,
  })

  const lens = useMemo<TrafficLens | null>(() => {
    if (state !== 'ready' || !policy || !conn) return null
    const zonesById = new Map(policy.zones.map(z => [z.id, z]))
    const suggestions = suggestionsRead.data ?? []
    const resolve = buildResolver(policy.zones, policy.policy.tag_prefix, lensGuests(guestsRead.data))
    const labelOf = (key: string) => {
      if (key === UNZONED_KEY) return t('unzoned')
      if (key === EXTERNAL_KEY) return t('unknownExternal')
      if (key === OTHER_KEY) return t('other')
      return zonesById.get(key.replace(/^zone:/, ''))?.name ?? key
    }
    return {
      connectionId: conn,
      policy,
      suggestions,
      zonesById,
      resolve,
      labelOf,
      colorOf: (key: string) => groupColor(key, zonesById),
      verdictOf: (pair: LensPair) => pairVerdict(pair, resolve, policy.flows, suggestions),
    }
  }, [state, policy, conn, suggestionsRead.data, guestsRead.data, t])

  return { state, lens, reloadPolicy: policyRead.reload, reloadSuggestions: suggestionsRead.reload }
}
