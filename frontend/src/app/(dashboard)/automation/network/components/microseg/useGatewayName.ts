'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'

import type { MicrosegZone } from '@/lib/microseg/types'

import { gatewayNameMap, namedAddress } from './gatewayNames'

/** Names the address of a zone's gateway ("Gateway of web (10.30.0.1)"), undefined for any other address. */
export function useGatewayName(zones: Iterable<MicrosegZone>): (ip: string) => string | undefined {
  const tg = useTranslations('microsegPilot.gateway')
  const list = useMemo(() => [...zones], [zones])
  const gateways = useMemo(() => gatewayNameMap(list, names => tg('name', { zones: names })), [list, tg])
  return useMemo(() => (ip: string) => (gateways.has(ip.replace(/\/(32|128)$/, '')) ? namedAddress(ip, gateways) : undefined), [gateways])
}
