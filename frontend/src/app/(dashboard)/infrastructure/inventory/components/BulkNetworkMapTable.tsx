'use client'

/**
 * Network table of the bulk migration dialog (ui#1333), VMware sources: the
 * source networks of the selected VMs, read in one SOAP call, each mapped to
 * a target bridge or SDN VNet and an optional VLAN tag. A network left on
 * "default" keeps the dialog's bridge and tag. The table can be saved for the
 * source/target pair and comes back preloaded on the next batch.
 */

import React, { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'

import BridgePicker from '@/components/hardware/BridgePicker'
import { migrationBridgeOption } from '@/components/hardware/bridgeChoices'
import type { MigrationNetworkMapEntry } from '@/lib/migration/target-overrides'

import { toNetworkChoices, type NetworkChoice } from './MigrationReviewStep'
import { buildNetworkMapPayload, mergeNetworkRows, rowTagInvalid, type BulkNetworkRow } from './bulkNetworkMap'

export interface BulkNetworkMapTableProps {
  sourceConnId: string
  targetConnId: string
  /** A node of the target cluster, for its bridges (VNets are cluster-wide). */
  targetNode: string
  vmids: string[]
  defaultBridge: string
  defaultVlanTag: string
  canEditVlan: boolean
  rows: BulkNetworkRow[]
  onRowsChange: (rows: BulkNetworkRow[]) => void
}

export default function BulkNetworkMapTable(p: BulkNetworkMapTableProps) {
  const t = useTranslations()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [choices, setChoices] = useState<NetworkChoice[]>([])
  const [saved, setSaved] = useState<MigrationNetworkMapEntry[]>([])
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const selectionKey = useMemo(() => [...p.vmids].sort((a, b) => a.localeCompare(b)).join(','), [p.vmids])

  // Bridges and VNets of the target.
  useEffect(() => {
    if (!p.targetConnId || !p.targetNode) { setChoices([]); return }
    let cancelled = false
    fetch(`/api/v1/connections/${encodeURIComponent(p.targetConnId)}/network-choices?node=${encodeURIComponent(p.targetNode)}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setChoices(toNetworkChoices(d?.data)) })
      .catch(() => { if (!cancelled) setChoices([]) })
    return () => { cancelled = true }
  }, [p.targetConnId, p.targetNode])

  // The table saved for this pair, then the networks of the selection.
  useEffect(() => {
    if (!p.sourceConnId || !p.targetConnId) return
    let cancelled = false
    fetch(`/api/v1/migrations/network-maps?sourceConnectionId=${encodeURIComponent(p.sourceConnId)}&targetConnectionId=${encodeURIComponent(p.targetConnId)}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setSaved(Array.isArray(d?.data?.networkMap) ? d.data.networkMap : []) })
      .catch(() => { if (!cancelled) setSaved([]) })
    return () => { cancelled = true }
  }, [p.sourceConnId, p.targetConnId])

  useEffect(() => {
    if (!p.sourceConnId || selectionKey === '') { p.onRowsChange([]); return }
    let cancelled = false
    // One read for the whole selection, after the operator stops ticking boxes.
    const timer = setTimeout(() => {
      setLoading(true)
      setError('')
      fetch(`/api/v1/vmware/${encodeURIComponent(p.sourceConnId)}/vms/networks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vmids: selectionKey.split(',') }),
      })
        .then(async r => {
          const d = await r.json().catch(() => null)
          if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`)
          return d
        })
        .then(d => { if (!cancelled) p.onRowsChange(mergeNetworkRows(d?.data?.networks ?? [], saved, p.rows)) })
        .catch(e => { if (!cancelled) setError(e?.message || String(e)) })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 400)
    return () => { cancelled = true; clearTimeout(timer) }
    // p.rows and p.onRowsChange are read, not watched: an edit must not reload the networks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.sourceConnId, selectionKey, saved])

  const setRow = (source: string, patch: Partial<BulkNetworkRow>) => {
    setSaveState('idle')
    p.onRowsChange(p.rows.map(r => (r.source === source ? { ...r, ...patch } : r)))
  }

  const bridgeOptions = (current: string) => {
    const list = choices.some(c => c.name === current) || !current ? choices : [{ name: current, kind: 'bridge' as const, label: '' }, ...choices]
    return list.map(migrationBridgeOption)
  }

  const save = async () => {
    setSaveState('saving')
    try {
      const networkMap = buildNetworkMapPayload(p.rows, p.canEditVlan) ?? []
      const r = await fetch('/api/v1/migrations/network-maps', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceConnectionId: p.sourceConnId, targetConnectionId: p.targetConnId, networkMap }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setSaveState('saved')
    } catch {
      setSaveState('error')
    }
  }

  const tableSx = { '& td, & th': { px: 0.75, py: 0.5, borderBottom: '1px solid', borderColor: 'divider' }, '& th': { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.secondary', fontWeight: 600 } } as const
  const defaultLabel = t('inventoryPage.esxiMigration.bulkNetworkDefault', { bridge: p.defaultBridge || 'vmbr0' })

  return (
    <Box data-testid="bulk-network-map">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
        <Typography variant="subtitle2" sx={{ flex: 1, color: 'text.secondary', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {t('inventoryPage.esxiMigration.bulkNetworkMap')}
        </Typography>
        {loading && <CircularProgress size={14} />}
        {p.rows.length > 0 && (
          <Button
            size="small"
            variant="text"
            onClick={save}
            disabled={saveState === 'saving' || p.rows.some(rowTagInvalid)}
            startIcon={<i className={saveState === 'saved' ? 'ri-check-line' : 'ri-save-3-line'} style={{ fontSize: 14 }} />}
            data-testid="bulk-network-map-save"
          >
            {t(saveState === 'saved' ? 'inventoryPage.esxiMigration.bulkNetworkSaved' : 'inventoryPage.esxiMigration.bulkNetworkSave')}
          </Button>
        )}
      </Box>
      {error && <Typography variant="caption" color="error" sx={{ display: 'block' }} data-testid="bulk-network-map-error">{t('inventoryPage.esxiMigration.bulkNetworkReadError', { error })}</Typography>}
      {saveState === 'error' && <Typography variant="caption" color="error" sx={{ display: 'block' }}>{t('inventoryPage.esxiMigration.bulkNetworkSaveError')}</Typography>}
      {p.rows.length > 0 && (
        <Table size="small" sx={tableSx}>
          <TableHead>
            <TableRow>
              <TableCell>{t('inventoryPage.esxiMigration.reviewNicSourceNetwork')}</TableCell>
              <TableCell sx={{ minWidth: 190 }}>{t('inventoryPage.esxiMigration.reviewNicBridge')}</TableCell>
              <TableCell sx={{ width: 84, whiteSpace: 'nowrap' }}>{t('inventoryPage.esxiMigration.vlanTag')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {p.rows.map(row => (
              <TableRow key={row.source} data-testid={`bulk-network-row-${row.source}`}>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                    <i className="ri-git-branch-line" style={{ fontSize: 14, opacity: 0.6 }} />
                    <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>{row.source}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap', ml: 0.25 }}>
                      · {t('inventoryPage.esxiMigration.bulkNetworkVmCount', { count: row.vmCount })}
                    </Typography>
                  </Box>
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }} data-testid={`bulk-network-row-${row.source}-bridge`}>
                    <BridgePicker
                      options={bridgeOptions(row.bridge)}
                      value={row.bridge}
                      onChange={bridge => setRow(row.source, { bridge })}
                      placeholder={defaultLabel}
                      fullWidth
                    />
                    {row.bridge && (
                      <Tooltip title={defaultLabel} arrow placement="top">
                        <IconButton size="small" onClick={() => setRow(row.source, { bridge: '', vlanTag: '' })} aria-label={defaultLabel} data-testid={`bulk-network-row-${row.source}-reset`}>
                          <i className="ri-arrow-go-back-line" style={{ fontSize: 14 }} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                </TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    value={p.canEditVlan ? row.vlanTag : ''}
                    disabled={!p.canEditVlan || !row.bridge}
                    placeholder={row.bridge ? t('inventoryPage.esxiMigration.vlanTagPlaceholder') : p.defaultVlanTag}
                    onChange={e => setRow(row.source, { vlanTag: e.target.value.replaceAll(/[^0-9]/g, '') })}
                    error={rowTagInvalid(row)}
                    sx={{ width: 76 }}
                    inputProps={{ inputMode: 'numeric', maxLength: 4, 'data-testid': `bulk-network-row-${row.source}-vlan` }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {!loading && !error && p.rows.length === 0 && p.vmids.length > 0 && (
        <Typography variant="caption" color="text.secondary">{t('inventoryPage.esxiMigration.bulkNetworkNone')}</Typography>
      )}
    </Box>
  )
}
