'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Box,
  Button,
  Card, CardContent,
  Chip,
  CircularProgress,
  Dialog, DialogContent,
  IconButton,
  Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'

import VnetCreateDialog from '@/components/mydc/VnetCreateDialog'
import VnetEditDialog from '@/components/mydc/VnetEditDialog'
import VnetDeleteDialog from '@/components/mydc/VnetDeleteDialog'
import TenantVnetDetailPanel from './TenantVnetDetailPanel'
import { readVdcContextCookie } from '@/lib/vdc/contextCookie'
import { useTenant } from '@/contexts/TenantContext'

interface VlanPool { bridge: string; rangeStart: number; rangeEnd: number }

interface Vdc {
  id: string
  name: string
  connectionId?: string
  enabled?: boolean
  /** Provider-dedicated VLAN ranges; drives the VLAN branch of the create
   *  dialog. Absent (or empty) means the tenant only gets VXLAN. */
  vlanPools?: VlanPool[]
}

interface SubnetView {
  cidr: string
  gateway: string
  dnsServers: string[]
}

interface IpamUsage {
  used: number
  usable: number
}

interface VnetRow {
  id: string
  vdcId: string
  vdcName: string
  /** Tenant-facing name; what we render in the table and pass as URL segment. */
  displayName: string
  /** Hashed 8-char PVE ID; surfaced in a tooltip for provider debugging. */
  pveName: string
  description?: string | null
  tag?: number | null
  type?: string
  firewall?: boolean
  /** L3 / IPAM info attached to the VNet. Always present in the new model. */
  subnet: SubnetView | null
  /** IPAM allocation counts (used / usable). Always returned by the API. */
  ipamUsage: IpamUsage
}

interface Props {
  /** Inventory connections in scope; VNets from vDCs whose connectionId is
   *  outside this set are filtered out. Empty set = no filter. */
  connectionIds: string[]
}

export default function VnetsSection({ connectionIds }: Props) {
  const t = useTranslations()
  const theme = useTheme()
  const { isFullClusterView } = useTenant()
  const [vdcs, setVdcs] = useState<Vdc[]>([])
  const [rows, setRows] = useState<VnetRow[]>([])
  // vDC column (Task 14): visible only for a multi-vDC tenant browsing the
  // union view — a precise vDC context makes every row share the same vDC,
  // so the column would be a constant (mirrors InventoryDetails' vDC
  // column). Provider/MSP explicitly excluded, same as the Network tree.
  const [showVdcColumn, setShowVdcColumn] = useState(false)
  const [loading, setLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [editVnet, setEditVnet] = useState<{ row: VnetRow } | null>(null)
  const [deleteVnet, setDeleteVnet] = useState<{ row: VnetRow } | null>(null)
  // Detail modal: opened by clicking a row. Reuses TenantVnetDetailPanel
  // so we don't duplicate the IPAM table / VM lookup / edit flow.
  const [detailVnet, setDetailVnet] = useState<{ row: VnetRow } | null>(null)

  // Stabilize the conn filter by deriving a string key — the parent
  // rebuilds the connectionIds array on every render (Set spread in
  // InventoryDetails), and using the array reference directly as a memo
  // dep would invalidate `connFilter` → `reload` → useEffect on every
  // poll, kicking the table back to a spinner.
  const connKey = connectionIds.slice().sort((a, b) => a.localeCompare(b)).join(',')
  const connFilter = useMemo(() => new Set(connKey ? connKey.split(',') : []), [connKey])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const vdcsRes = await fetch('/api/v1/vdcs')
      const vdcsJson = await vdcsRes.json()
      const allVdcs: Vdc[] = Array.isArray(vdcsJson?.data) ? vdcsJson.data : []

      // vDC context filter (Task 14): a cookie matching one of the tenant's
      // own active vDCs narrows the table to just that vDC — same
      // fail-open contract as the Network tree (Task 7/14): an unset,
      // foreign, or disabled-vDC cookie leaves the union untouched.
      const ctxCookie = readVdcContextCookie()
      const ctxIsActiveVdc = !isFullClusterView && !!ctxCookie && allVdcs.some(v => v.id === ctxCookie && v.enabled !== false)
      const scopedVdcs = ctxIsActiveVdc ? allVdcs.filter(v => v.id === ctxCookie) : allVdcs
      setShowVdcColumn(!isFullClusterView && !ctxIsActiveVdc && allVdcs.filter(v => v.enabled !== false).length > 1)

      const visibleVdcs = connFilter.size === 0
        ? scopedVdcs
        : scopedVdcs.filter(v => !v.connectionId || connFilter.has(v.connectionId))
      setVdcs(visibleVdcs)

      const all: VnetRow[] = []
      await Promise.all(visibleVdcs.map(async (v) => {
        try {
          const r = await fetch(`/api/v1/vdcs/${encodeURIComponent(v.id)}/vnets`)
          if (!r.ok) return
          const j = await r.json()
          const list = Array.isArray(j?.data) ? j.data : []
          for (const vnet of list) {
            const sn = vnet.subnet
            const subnet: SubnetView | null = sn
              ? {
                  cidr: sn.cidr,
                  gateway: sn.gateway,
                  dnsServers: Array.isArray(sn.dnsServers) ? sn.dnsServers : [],
                }
              : null
            const u = vnet.ipamUsage
            const ipamUsage: IpamUsage = u && typeof u === 'object'
              ? { used: Number(u.used) || 0, usable: Number(u.usable) || 0 }
              : { used: 0, usable: 0 }
            all.push({
              id: vnet.id,
              vdcId: v.id,
              vdcName: v.name,
              displayName: vnet.displayName ?? vnet.pveName,
              pveName: vnet.pveName,
              description: vnet.description,
              tag: vnet.tag,
              type: vnet.type,
              firewall: vnet.firewall,
              subnet,
              ipamUsage,
            })
          }
        } catch { /* skip */ }
      }))
      all.sort((a, b) => a.vdcName.localeCompare(b.vdcName) || a.displayName.localeCompare(b.displayName))
      setRows(all)
    } finally {
      setLoading(false)
    }
  }, [connFilter, isFullClusterView])

  useEffect(() => { void reload() }, [reload])

  return (
    <>
      <Card variant="outlined" sx={{ mt: 3, borderRadius: 2, border: `1px solid ${alpha(theme.palette.divider, 0.8)}` }}>
        <CardContent sx={{ pb: '16px !important' }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
            <i className="ri-git-branch-line" style={{ opacity: 0.6, fontSize: 16 }} />
            <Typography variant="subtitle2" fontWeight={700}>
              {t('myVdc.vnetsTitle')}
            </Typography>
            <Chip label={rows.length} size="small" sx={{ height: 20, fontSize: 11, ml: 0.5, bgcolor: alpha(theme.palette.primary.main, 0.1) }} />
            <Stack direction="row" sx={{ flex: 1 }} />
            <Tooltip title={vdcs.length === 0 ? t('myVdc.vnetNoVdc') : t('myVdc.createVnet')}>
              <span>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<i className="ri-add-line" />}
                  disabled={vdcs.length === 0}
                  onClick={() => setCreateOpen(true)}
                >
                  {t('myVdc.createVnet')}
                </Button>
              </span>
            </Tooltip>
          </Stack>

          {/* Only swap the table for a spinner on the initial load. Once
              we have rows, keep showing them during background refreshes
              so the section doesn't flicker on every inventory poll. */}
          {loading && rows.length === 0 ? (
            <Stack alignItems="center" sx={{ py: 4 }}>
              <CircularProgress size={20} />
            </Stack>
          ) : rows.length === 0 ? (
            <Stack alignItems="center" sx={{ py: 3, opacity: 0.55, gap: 0.5 }}>
              <i className="ri-git-branch-line" style={{ fontSize: 28 }} />
              <Typography variant="body2">{t('myVdc.vnetsEmpty')}</Typography>
            </Stack>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12, opacity: 0.65, py: 1 }}>{t('myVdc.vnetName')}</TableCell>
                    {showVdcColumn && (
                      <TableCell sx={{ fontWeight: 700, fontSize: 12, opacity: 0.65, py: 1 }}>{t('myVdc.vnetVdc')}</TableCell>
                    )}
                    <TableCell sx={{ fontWeight: 700, fontSize: 12, opacity: 0.65, py: 1 }}>{t('myVdc.subnetColumn')}</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12, opacity: 0.65, py: 1 }}>{t('myVdc.subnetGateway')}</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12, opacity: 0.65, py: 1 }}>{t('myVdc.subnetDns')}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, fontSize: 12, opacity: 0.65, py: 1 }}>{t('myVdc.subnetUsage')}</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12, opacity: 0.65, py: 1 }}>{t('myVdc.vnetDescription')}</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 700, fontSize: 12, opacity: 0.65, py: 1 }}>{t('myVdc.vnetFirewall')}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, fontSize: 12, opacity: 0.65, py: 1 }}></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((r) => {
                    const sn = r.subnet
                    return (
                    <TableRow
                      key={r.id}
                      onClick={() => setDetailVnet({ row: r })}
                      sx={{ '&:last-child td': { border: 0 }, cursor: 'pointer' }}
                    >
                      <TableCell sx={{ py: 1 }}>
                        <Tooltip title={`PVE ID: ${r.pveName} · vDC: ${r.vdcName}${r.tag ? ` · ${r.type === 'vlan' ? 'VLAN' : 'VNI'} ${r.tag}` : ''}`} arrow placement="top">
                          <Typography variant="body2" fontWeight={600} sx={{ fontSize: 12 }}>{r.displayName}</Typography>
                        </Tooltip>
                      </TableCell>
                      {showVdcColumn && (
                        <TableCell sx={{ py: 1, fontSize: 12, opacity: 0.85 }}>{r.vdcName}</TableCell>
                      )}
                      <TableCell sx={{ py: 1, fontSize: 12 }}>
                        {sn?.cidr ?? <span style={{ opacity: 0.45 }}>—</span>}
                      </TableCell>
                      <TableCell sx={{ py: 1, fontSize: 12 }}>
                        {sn?.gateway ?? <span style={{ opacity: 0.45 }}>—</span>}
                      </TableCell>
                      <TableCell sx={{ py: 1, fontSize: 12, opacity: 0.85 }}>
                        {sn && sn.dnsServers.length > 0
                          ? sn.dnsServers.join(', ')
                          : <span style={{ opacity: 0.45 }}>—</span>}
                      </TableCell>
                      <TableCell align="right" sx={{ py: 1 }}>
                        {(() => {
                          const { used, usable } = r.ipamUsage
                          if (usable === 0) {
                            return <span style={{ opacity: 0.45, fontSize: 12 }}>—</span>
                          }
                          const pct = Math.min(100, Math.round((used / usable) * 100))
                          const barColor = pct >= 90
                            ? theme.palette.error.main
                            : pct >= 70
                              ? theme.palette.warning.main
                              : theme.palette.success.main
                          return (
                            <Tooltip title={t('myVdc.subnetUsageTooltip', { used, usable })} arrow placement="top">
                              <Stack spacing={0.5} alignItems="flex-end" sx={{ minWidth: 64, display: 'inline-flex' }}>
                                <Typography variant="caption" sx={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.2 }}>
                                  {used} / {usable}
                                </Typography>
                                <Box sx={{ width: 64, height: 4, bgcolor: alpha(theme.palette.divider, 0.4), borderRadius: 2, overflow: 'hidden' }}>
                                  <Box sx={{ width: `${pct}%`, height: '100%', bgcolor: barColor, transition: 'width 200ms ease, background-color 200ms ease' }} />
                                </Box>
                              </Stack>
                            </Tooltip>
                          )
                        })()}
                      </TableCell>
                      <TableCell sx={{ py: 1, fontSize: 12, opacity: 0.75 }}>{r.description || '—'}</TableCell>
                      <TableCell align="center" sx={{ py: 1 }}>
                        <Chip
                          size="small"
                          label={r.firewall ? t('myVdc.fwOn') : t('myVdc.fwOff')}
                          color={r.firewall ? 'success' : 'default'}
                          sx={{ height: 20, fontSize: 11 }}
                        />
                      </TableCell>
                      <TableCell align="right" sx={{ py: 0.5 }}>
                        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                          <IconButton
                            size="small"
                            onClick={(e) => { e.stopPropagation(); setEditVnet({ row: r }) }}
                          >
                            <i className="ri-pencil-line" />
                          </IconButton>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={(e) => { e.stopPropagation(); setDeleteVnet({ row: r }) }}
                          >
                            <i className="ri-delete-bin-line" />
                          </IconButton>
                        </Stack>
                      </TableCell>
                    </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      <VnetCreateDialog
        open={createOpen}
        vdcs={vdcs.map(v => ({ id: v.id, name: v.name, vlanPools: v.vlanPools ?? [] }))}
        onClose={() => setCreateOpen(false)}
        onCreated={() => { setCreateOpen(false); void reload() }}
      />
      {editVnet && (
        <VnetEditDialog
          vnet={editVnet.row}
          vdcId={editVnet.row.vdcId}
          onClose={() => setEditVnet(null)}
          onSaved={() => { setEditVnet(null); void reload() }}
        />
      )}
      {deleteVnet && (
        <VnetDeleteDialog
          vnet={deleteVnet.row}
          vdcId={deleteVnet.row.vdcId}
          onClose={() => setDeleteVnet(null)}
          onDeleted={() => { setDeleteVnet(null); void reload() }}
        />
      )}

      {/* Click-on-row detail modal — reuses the side-panel layout from
          TenantVnetDetailPanel so we keep one source of truth for the
          IPAM table, VM lookup, status pastilles and edit dialog.
          The panel renders its own header (icon + name + CIDR + edit
          button), so we deliberately skip a DialogTitle and just float
          a close button in the top-right corner. */}
      <Dialog
        open={!!detailVnet}
        onClose={() => { setDetailVnet(null); void reload() }}
        maxWidth="lg"
        fullWidth
      >
        <DialogContent sx={{ pt: 3, position: 'relative' }}>
          <IconButton
            size="small"
            onClick={() => { setDetailVnet(null); void reload() }}
            sx={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}
            aria-label="close"
          >
            <i className="ri-close-line" style={{ fontSize: 18 }} />
          </IconButton>
          {detailVnet && (
            <TenantVnetDetailPanel
              selectionId={`${detailVnet.row.vdcId}:${detailVnet.row.displayName}`}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
