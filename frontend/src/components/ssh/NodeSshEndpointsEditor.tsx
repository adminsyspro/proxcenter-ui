'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Autocomplete, Box, CircularProgress, TextField, Tooltip, Typography } from '@mui/material'

import { NodeIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'
import { normalizeSshAddress, normalizeSshPort } from '@/lib/ssh/node-endpoint-core'

/** A node's SSH override as the editor holds it (null = not overridden). */
export type NodeSshValue = { address: string | null; port: number | null }

type NodeIface = { ip: string; iface: string; gateway: string }

type Row = {
  hostId: string | null
  status?: string
  address: string
  port: string
  saved: NodeSshValue
  saving: boolean
  error: string | null
}

type Props = {
  connectionId: string
  /** Nodes to show, in this order. Defaults to every node of the connection. */
  nodeNames?: string[]
  /** Placeholder for an empty port: the connection port that applies. */
  defaultPort?: number
  /** Called with every node's saved override once loaded and after each save. */
  onChange?: (values: Record<string, NodeSshValue>) => void
}

const MONO = { fontFamily: 'var(--font-jetbrains-mono, monospace)' }

function savedValues(rows: Record<string, Row>): Record<string, NodeSshValue> {
  return Object.fromEntries(Object.entries(rows).map(([node, r]) => [node, r.saved]))
}

/**
 * Per-node SSH address and port overrides, saved to ManagedHost on blur.
 * The address is free text (a VPN, admin VLAN or NAT address Proxmox does not
 * report is valid); the node's reported interfaces are offered as suggestions.
 */
export default function NodeSshEndpointsEditor({ connectionId, nodeNames, defaultPort, onChange }: Props) {
  const t = useTranslations()
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [order, setOrder] = useState<string[]>([])
  const [ifaces, setIfaces] = useState<Record<string, NodeIface[]>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/nodes`)
      .then(res => res.json())
      .then(json => {
        if (cancelled) return
        const next: Record<string, Row> = {}
        const names: string[] = []

        for (const n of json?.data || []) {
          const name = n.node || n.name
          if (!name) continue
          names.push(name)
          const saved = { address: normalizeSshAddress(n.sshAddress), port: normalizeSshPort(n.sshPort) }
          next[name] = {
            hostId: n.hostId || null,
            status: n.status,
            address: saved.address ?? '',
            port: saved.port === null ? '' : String(saved.port),
            saved,
            saving: false,
            error: null,
          }
        }

        setRows(next)
        setOrder(names)
        onChange?.(savedValues(next))

        names.filter(name => next[name].status === 'online').forEach(name => {
          fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/nodes/${encodeURIComponent(name)}/network`)
            .then(res => res.json())
            .then(netJson => {
              if (cancelled) return
              const list: NodeIface[] = (netJson?.data || [])
                .filter((i: any) => i.address && !String(i.address).startsWith('127.'))
                .map((i: any) => ({ ip: String(i.address).split('/')[0], iface: i.iface || '', gateway: i.gateway || '' }))
              setIfaces(prev => ({ ...prev, [name]: list }))
            })
            .catch(() => {})
        })
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
    // onChange is a notification sink; reloading on its identity would refetch on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId])

  const patchRow = (node: string, patch: Partial<Row>) =>
    setRows(prev => (prev[node] ? { ...prev, [node]: { ...prev[node], ...patch } } : prev))

  const commit = useCallback(async (node: string, address: string, portText: string) => {
    const row = rows[node]
    if (!row?.hostId || row.saving) return

    const nextAddress = normalizeSshAddress(address)
    const nextPort = normalizeSshPort(portText)
    if (portText.trim() && nextPort === null) {
      patchRow(node, { error: t('settings.sshNodeEndpoints.invalidPort') })
      return
    }
    if (nextAddress === row.saved.address && nextPort === row.saved.port) {
      patchRow(node, { error: null })
      return
    }

    patchRow(node, { saving: true, error: null })
    try {
      const res = await fetch(`/api/v1/hosts/${encodeURIComponent(row.hostId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sshAddress: nextAddress, sshPort: nextPort }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)

      const saved = { address: normalizeSshAddress(json?.data?.sshAddress), port: normalizeSshPort(json?.data?.sshPort) }
      setRows(prev => {
        const next = {
          ...prev,
          [node]: { ...prev[node], saved, address: saved.address ?? '', port: saved.port === null ? '' : String(saved.port), saving: false },
        }
        onChange?.(savedValues(next))
        return next
      })
    } catch (e: any) {
      patchRow(node, { saving: false, error: t('settings.sshNodeEndpoints.saveFailed', { error: e?.message || String(e) }) })
    }
  }, [rows, onChange, t])

  if (loading) return <CircularProgress size={18} />

  const visible = (nodeNames ?? order).filter(name => rows[name])
  if (visible.length === 0) {
    return (
      <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>
        {t('settings.sshNodeEndpoints.noNodes')}
      </Typography>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {visible.map(node => {
        const row = rows[node]
        const options = ifaces[node] || []

        return (
          <Box key={node}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: 120, flexShrink: 0, minWidth: 0 }}>
                <NodeIcon status={row.status} size={18} />
                <Tooltip title={node}>
                  <Typography variant='body2' noWrap sx={{ fontWeight: 600, fontSize: 13 }}>{node}</Typography>
                </Tooltip>
              </Box>

              <Autocomplete
                freeSolo
                size='small'
                sx={{ flex: 1, minWidth: 0 }}
                options={options.map(o => o.ip)}
                inputValue={row.address}
                onInputChange={(_e, value, reason) => {
                  if (reason !== 'reset') patchRow(node, { address: value })
                }}
                onChange={(_e, value) => {
                  const address = typeof value === 'string' ? value : ''
                  patchRow(node, { address })
                  void commit(node, address, row.port)
                }}
                disabled={row.saving || !row.hostId}
                groupBy={() => t('settings.sshNodeEndpoints.interfaces')}
                renderOption={(props, ip) => {
                  const iface = options.find(o => o.ip === ip)
                  const { key, ...rest } = props as any

                  return (
                    <li key={key} {...rest}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <span style={MONO}>{ip}</span>
                        <Typography variant='caption' color='text.secondary'>
                          {iface?.iface}{iface?.gateway ? ' (gw)' : ''}
                        </Typography>
                      </Box>
                    </li>
                  )
                }}
                renderInput={params => (
                  <TextField
                    {...params}
                    label={t('settings.sshNodeEndpoints.address')}
                    placeholder={t('settings.sshNodeEndpoints.addressPlaceholder')}
                    onBlur={() => void commit(node, row.address, row.port)}
                    slotProps={{ inputLabel: { shrink: true }, htmlInput: { ...params.inputProps, style: MONO } }}
                  />
                )}
              />

              <TextField
                size='small'
                label={t('settings.sshNodeEndpoints.port')}
                placeholder={defaultPort ? String(defaultPort) : '22'}
                value={row.port}
                onChange={e => patchRow(node, { port: e.target.value.replace(/\D/g, '') })}
                onBlur={() => void commit(node, row.address, row.port)}
                disabled={row.saving || !row.hostId}
                error={!!row.error && !!row.port && normalizeSshPort(row.port) === null}
                sx={{ width: 96, flexShrink: 0 }}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { inputMode: 'numeric', style: MONO } }}
              />

              <Box sx={{ width: 18, flexShrink: 0, display: 'flex' }}>
                {row.saving && <CircularProgress size={16} />}
              </Box>
            </Box>
            {row.error && (
              <Typography variant='caption' color='error' sx={{ display: 'block', ml: '128px' }}>
                {row.error}
              </Typography>
            )}
          </Box>
        )
      })}
    </Box>
  )
}
