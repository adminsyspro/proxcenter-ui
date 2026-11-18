'use client'

import { createContext, useContext, type ReactNode } from 'react'

import type { NamedNetwork } from '@/lib/microseg/namedNetworks'

const NONE: readonly NamedNetwork[] = []
const NamedNetworksContext = createContext<readonly NamedNetwork[]>(NONE)

/** Gives the named networks of the policy to the lists and the maps under it. */
export function NamedNetworksProvider({ networks, children }: { networks: readonly NamedNetwork[] | undefined; children: ReactNode }) {
  return <NamedNetworksContext.Provider value={networks ?? NONE}>{children}</NamedNetworksContext.Provider>
}

/** The named networks of the policy (none outside a provider). */
export function useNamedNetworks(): readonly NamedNetwork[] {
  return useContext(NamedNetworksContext)
}
