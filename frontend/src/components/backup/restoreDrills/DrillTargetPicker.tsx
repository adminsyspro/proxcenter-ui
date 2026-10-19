'use client'

// Target (cluster, node, disk storage) and network isolation of a restore
// drill, shared by the one-off drill dialog and the schedule modal. Offers
// only the clusters that have a PBS storage pointing at the source datastore
// and namespace, then the online nodes that reach it, then their disk
// storages and bridges. The picker fills the first usable choice by itself
// through `onDefaults`; a choice of the user goes through `onChange`.

import { useEffect, useMemo, useState } from 'react'

import { useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  FormControl,
  FormControlLabel,
  FormHelperText,
  InputLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Typography,
} from '@mui/material'

import { nodesReachingPbs } from '@/lib/backups/restoreDrills/display'
import type { DrillNetworkMode } from '@/lib/backups/restoreDrills/types'
import { formatBytes } from '@/utils/format'

// A small Select renders 38px against 35.86px for a small input: same fix as
// the Backups page toolbar.
export const SMALL_SELECT_SX = { '& .MuiInputBase-input.MuiSelect-select': { minHeight: '1.4375em', lineHeight: '1.4375em' } }

const P = 'backups.restoreDrills'

export interface DrillTargetValue {
  connId: string
  node: string
  storage: string
  networkMode: DrillNetworkMode
  bridge: string
}

/** A default the picker fills in: a patch computed from the current value, or null for none. */
export type DrillTargetFill = (current: DrillTargetValue) => Partial<DrillTargetValue> | null

interface PbsTarget { connId: string; connName: string; storage: string; nodes: string[] }
interface NodeStorage { storage: string; type?: string; avail?: number; total?: number; active?: number; enabled?: number }

export async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) return null
  return (await res.json()) as T
}

export function dataOf<T>(json: unknown): T[] {
  if (Array.isArray(json)) return json as T[]
  const data = (json as { data?: unknown } | null)?.data
  return Array.isArray(data) ? (data as T[]) : []
}

interface DrillTargetPickerProps {
  pbsId: string
  datastore: string
  namespace: string
  value: DrillTargetValue
  onChange: (patch: Partial<DrillTargetValue>) => void
  onDefaults: (fill: DrillTargetFill) => void
  /** Inline errors of the schedule modal. */
  targetError?: string
  bridgeError?: string
  idPrefix?: string
}

export default function DrillTargetPicker({
  pbsId, datastore, namespace, value, onChange, onDefaults, targetError, bridgeError, idPrefix = 'drill',
}: DrillTargetPickerProps) {
  const t = useTranslations()
  // Clusters of the current source only: null while they load or without a source.
  const sourceKey = pbsId && datastore ? `${pbsId}|${datastore}|${namespace}` : ''
  const [loaded, setLoaded] = useState<{ key: string; list: PbsTarget[] } | null>(null)
  const targets = sourceKey && loaded?.key === sourceKey ? loaded.list : null
  const [nodes, setNodes] = useState<string[]>([])
  const [storages, setStorages] = useState<NodeStorage[]>([])
  const [bridges, setBridges] = useState<string[]>([])

  // Clusters that see this PBS datastore and namespace.
  useEffect(() => {
    if (!sourceKey) return
    let cancelled = false
    void (async () => {
      try {
        const params = new URLSearchParams({ datastore })
        if (namespace) params.set('ns', namespace)
        const json = await getJson<unknown>(`/api/v1/pbs/${encodeURIComponent(pbsId)}/pve-storages?${params}`)
        if (cancelled) return
        const list = dataOf<PbsTarget>(json)
        setLoaded({ key: sourceKey, list })
        onDefaults(v => (list.some(tg => tg.connId === v.connId) ? null : { connId: list[0]?.connId || '' }))
      } catch {
        if (!cancelled) setLoaded({ key: sourceKey, list: [] })
      }
    })()
    return () => { cancelled = true }
    // onDefaults is a setter wrapper of the parent: not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey])

  const clusters = useMemo(() => {
    const m = new Map<string, string>()
    for (const tg of targets ?? []) if (!m.has(tg.connId)) m.set(tg.connId, tg.connName || tg.connId)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [targets])

  // Online nodes of the cluster that reach the PBS.
  useEffect(() => {
    if (!value.connId || !targets) return
    let cancelled = false
    void (async () => {
      try {
        const json = await getJson<unknown>(`/api/v1/connections/${encodeURIComponent(value.connId)}/nodes`)
        if (cancelled) return
        const online = dataOf<{ node?: string; name?: string; status?: string }>(json)
          .filter(n => n.status === 'online')
          .map(n => String(n.node || n.name || ''))
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b))
        const reachable = nodesReachingPbs(online, targets, value.connId)
        setNodes(reachable)
        onDefaults(v => (reachable.includes(v.node) ? null : { node: reachable[0] || '', storage: '' }))
      } catch {
        if (!cancelled) setNodes([])
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.connId, targets])

  // Disk storages and bridges of the node.
  useEffect(() => {
    if (!value.connId || !value.node) return
    let cancelled = false
    const base = `/api/v1/connections/${encodeURIComponent(value.connId)}/nodes/${encodeURIComponent(value.node)}`
    void (async () => {
      try {
        const json = await getJson<unknown>(`${base}/storages?content=images`)
        if (cancelled) return
        const list = dataOf<NodeStorage>(json).filter(s => s.active !== 0 && s.enabled !== 0)
        list.sort((a, b) => a.storage.localeCompare(b.storage))
        setStorages(list)
        onDefaults(v => (list.some(s => s.storage === v.storage) ? null : { storage: list[0]?.storage || '' }))
      } catch {
        if (!cancelled) setStorages([])
      }
      try {
        const json = await getJson<unknown>(`${base}/network`)
        if (cancelled) return
        const list = dataOf<{ iface?: string; type?: string }>(json)
          .filter(n => n.type === 'bridge' || n.type === 'OVSBridge')
          .map(n => String(n.iface || ''))
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b))
        setBridges(list)
      } catch {
        if (!cancelled) setBridges([])
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.connId, value.node])

  const noTarget = targets !== null && targets.length === 0

  return (
    <>
      <Box>
        <Typography variant='subtitle2' sx={{ mb: 1 }}>{t(`${P}.target`)}</Typography>
        {noTarget ? (
          <Alert severity='warning'>{t(`${P}.noClusters`)}</Alert>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5 }}>
            <FormControl size='small' fullWidth disabled={targets === null} error={!!targetError && !value.connId}>
              <InputLabel id={`${idPrefix}-cluster`}>{t(`${P}.cluster`)}</InputLabel>
              <Select labelId={`${idPrefix}-cluster`} label={t(`${P}.cluster`)} value={clusters.some(([id]) => id === value.connId) ? value.connId : ''} sx={SMALL_SELECT_SX}
                onChange={e => onChange({ connId: String(e.target.value), node: '', storage: '' })}>
                {clusters.map(([id, label]) => <MenuItem key={id} value={id}>{label}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl size='small' fullWidth disabled={!value.connId} error={!!targetError && !value.node}>
              <InputLabel id={`${idPrefix}-node`}>{t(`${P}.node`)}</InputLabel>
              <Select labelId={`${idPrefix}-node`} label={t(`${P}.node`)} value={nodes.includes(value.node) ? value.node : ''} sx={SMALL_SELECT_SX}
                onChange={e => onChange({ node: String(e.target.value), storage: '' })}>
                {nodes.map(n => <MenuItem key={n} value={n}>{n}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl size='small' fullWidth disabled={!value.node} error={!!targetError && !value.storage}>
              <InputLabel id={`${idPrefix}-storage`}>{t(`${P}.storage`)}</InputLabel>
              <Select labelId={`${idPrefix}-storage`} label={t(`${P}.storage`)} value={storages.some(s => s.storage === value.storage) ? value.storage : ''} sx={SMALL_SELECT_SX}
                onChange={e => onChange({ storage: String(e.target.value) })}>
                {storages.map(s => (
                  <MenuItem key={s.storage} value={s.storage}>
                    {s.storage}{typeof s.avail === 'number' ? ` (${t(`${P}.free`, { size: formatBytes(s.avail) })})` : ''}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        )}
        {targetError && !noTarget && <FormHelperText error>{targetError}</FormHelperText>}
      </Box>

      <Box>
        <Typography variant='subtitle2'>{t(`${P}.network`)}</Typography>
        <RadioGroup value={value.networkMode} onChange={e => onChange({ networkMode: e.target.value as DrillNetworkMode })}>
          <FormControlLabel value='link_down' control={<Radio size='small' />} label={t(`${P}.networkLinkDown`)} />
          <FormControlLabel value='bridge' control={<Radio size='small' />} label={t(`${P}.networkBridge`)} />
        </RadioGroup>
        {value.networkMode === 'bridge' && (
          <FormControl size='small' sx={{ mt: 1, minWidth: 240 }} error={!!bridgeError}>
            <InputLabel id={`${idPrefix}-bridge`}>{t(`${P}.bridge`)}</InputLabel>
            <Select labelId={`${idPrefix}-bridge`} label={t(`${P}.bridge`)} value={bridges.includes(value.bridge) ? value.bridge : ''} sx={SMALL_SELECT_SX}
              onChange={e => onChange({ bridge: String(e.target.value) })}>
              {bridges.map(b => <MenuItem key={b} value={b}>{b}</MenuItem>)}
            </Select>
            {bridgeError && <FormHelperText>{bridgeError}</FormHelperText>}
          </FormControl>
        )}
        <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mt: 1 }}>
          {t(`${P}.isolationHint`)}
        </Typography>
      </Box>
    </>
  )
}
