'use client'

import { ButtonBase } from '@mui/material'
import { useTranslations } from 'next-intl'

import { fillTone } from '@/lib/ceph/hostMap'
import type { CephInventory } from '@/lib/ceph/types'

import type { DotState } from './ui'

/* Shared by the pool table and the pool sheet. */

export type Pool = CephInventory['pools']['list'][number]

/** Name of the CRUSH rule of a pool: its own, else the inventory rule of its id, else the id. */
export function poolRuleName(pool: Pool, rules: CephInventory['crushRules'] | undefined): string {
  return pool.crushRuleName || rules?.find(r => r.id === pool.crushRule)?.name || `#${pool.crushRule}`
}

export function poolDotState(fill: number, ratios: { nearfull: number; full: number }): DotState {
  const tone = fillTone(fill, ratios)

  return tone === 'full' ? 'error' : tone === 'nearfull' ? 'warn' : 'ok'
}

/** The CRUSH rule as a link to the CRUSH tab (a click does not open the pool). */
export function RuleLink({ name, onOpen }: { name: string; onOpen: () => void }) {
  const t = useTranslations('cephCockpit')

  return (
    <ButtonBase
      aria-label={t('pools.ruleOpen', { rule: name })}
      onClick={e => { e.stopPropagation(); onOpen() }}
      onKeyDown={e => e.stopPropagation()}
      sx={{ fontSize: 12.5, fontWeight: 600, color: 'primary.main', borderRadius: 0.5, '&:hover': { textDecoration: 'underline' }, '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main' } }}
    >
      {name}
    </ButtonBase>
  )
}

/** `max_avail` is not in every PVE pool list: a 0 net available below the full mark is "not reported", not a real zero. */
export function poolAvailReported(pool: Pool, fill: number): boolean {
  return pool.maxAvail > 0 || fill >= 0.99
}

/** Same for `objects`: a 0 next to used bytes is "not reported". An empty pool really has none. */
export function poolObjectsReported(pool: Pool): boolean {
  return pool.objects > 0 || pool.bytesUsed === 0
}

/** Where the PVE storages of the pools stand: still reading, the read failed, or done (possibly with none). */
export type StorageReadState = 'loading' | 'error' | 'ready'
