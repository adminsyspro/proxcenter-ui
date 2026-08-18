'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Box, Card, CardContent, Chip, CircularProgress, IconButton, InputAdornment, LinearProgress, Stack,
  Table, TableBody, TableCell, TableHead, TableRow, TablePagination, TextField, Tooltip, Typography,
  alpha, useTheme,
} from '@mui/material'
import { StatusIcon } from './components/TreeIcons'
import VnetEditDialog from '@/components/mydc/VnetEditDialog'

interface SubnetView {
  cidr: string
  gateway: string
  dnsServers: string[]
}

interface VnetDetail {
  id: string
  vdcId: string
  pveName: string
  displayName: string
  description: string | null
  tag: number
  type?: string
  firewall: boolean
  subnet: SubnetView | null
}

interface IpamAllocation {
  id: string
  ip: string
  mac: string
  vmid: number | null
  hostname: string | null
  createdAt: string
  vm: { name: string; node: string; status: string; type: string } | null
}

interface IpamSummary {
  connectionId: string
  cidr: string
  gateway: string
  usable: number
  used: number
  allocations: IpamAllocation[]
}

interface Props {
  /** Selection ID format: `tvnet:<vdcId>:<displayName>` (the leading `tvnet:`
   *  is already stripped by `selectionFromItemId`, so we just split on the
   *  first `:`). */
  selectionId: string
}

export default function TenantVnetDetailPanel({ selectionId }: Props) {
  const t = useTranslations()
  const theme = useTheme()
  const [vnet, setVnet] = useState<VnetDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ipam, setIpam] = useState<IpamSummary | null>(null)
  const [ipamLoading, setIpamLoading] = useState(false)
  // Client-side vm-info index: vmid → {name, node, status, type}, fetched
  // from /api/v1/connections/{connId}/guests once we know the connection.
  // This is the SAME endpoint the inventory tree consumes (and it's
  // already behind the right RBAC for tenants), so the sparkline + status
  // pastille get fresh data even if the server-side IPAM enrichment in
  // /vdcs/.../ipam misses for any reason.
  const [vmIndex, setVmIndex] = useState<Map<number, { name: string; node: string; status: string; type: string }>>(new Map())
  // Search + pagination for the IPAM allocations table.
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(10)
  // Edit dialog state.
  const [editOpen, setEditOpen] = useState(false)
  // Bumped after a successful save so the parent useEffect reloads the
  // VNet payload + IPAM list (we already key off `selectionId`, but
  // editing keeps the same id so we need a separate trigger).
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    const colon = selectionId.indexOf(':')
    if (colon < 0) { setError('invalid selection id'); setLoading(false); return }
    const vdcId = selectionId.slice(0, colon)
    const displayName = selectionId.slice(colon + 1)

    let alive = true
    setLoading(true); setError(null); setIpam(null)
    fetch(`/api/v1/vdcs/${encodeURIComponent(vdcId)}/vnets/${encodeURIComponent(displayName)}`)
      .then(async r => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}))
          throw new Error(j?.error || `HTTP ${r.status}`)
        }
        return r.json()
      })
      .then(j => { if (alive) setVnet(j.data) })
      .catch(e => { if (alive) setError(e?.message || String(e)) })
      .finally(() => { if (alive) setLoading(false) })

    // IPAM allocations — fetched in parallel, only matters when the VNet
    // has a subnet so we don't bother on bridge-only mode (the response
    // would 404 on the JOIN).
    setIpamLoading(true)
    fetch(`/api/v1/vdcs/${encodeURIComponent(vdcId)}/vnets/${encodeURIComponent(displayName)}/ipam`)
      .then(async r => {
        if (!r.ok) return null
        const j = await r.json().catch(() => null)
        return j?.data ?? null
      })
      .then(d => { if (alive) setIpam(d) })
      .catch(() => { /* tolerate — panel still useful without IPAM */ })
      .finally(() => { if (alive) setIpamLoading(false) })

    return () => { alive = false }
  }, [selectionId, reloadTick])

  // Client-side vm enrichment. Done independently of the IPAM API's
  // server-side enrichment so the panel doesn't go blank when /cluster/
  // resources from the route fails for any reason. Same endpoint the
  // inventory tree consumes — already proven to work behind tenant RBAC.
  useEffect(() => {
    if (!ipam?.connectionId) return
    const connId = ipam.connectionId
    let alive = true
    fetch(`/api/v1/connections/${encodeURIComponent(connId)}/guests`)
      .then(async (r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive) return
        const list: any[] = Array.isArray(j?.data) ? j.data : []
        const idx = new Map<number, { name: string; node: string; status: string; type: string }>()
        for (const g of list) {
          const vmidNum = Number(g?.vmid)
          if (!Number.isFinite(vmidNum)) continue
          idx.set(vmidNum, {
            name: String(g.name ?? `vm-${vmidNum}`),
            node: String(g.node ?? ''),
            status: String(g.status ?? 'unknown'),
            type: String(g.type ?? 'qemu'),
          })
        }
        setVmIndex(idx)
      })
      .catch(() => { /* tolerate */ })
    return () => { alive = false }
  }, [ipam?.connectionId])

  // Filter + paginate IPAM allocations. Search matches IP, MAC, vmid,
  // hostname or live VM name. These hooks MUST run on every render —
  // putting them after the loading/error early-returns would violate
  // the rules-of-hooks (React: "Rendered more hooks than during the
  // previous render").
  const filteredAllocations = useMemo(() => {
    if (!ipam) return []
    const q = search.trim().toLowerCase()
    if (!q) return ipam.allocations
    return ipam.allocations.filter((a) => {
      const liveName = (a.vmid != null ? vmIndex.get(a.vmid)?.name : null) ?? a.vm?.name ?? a.hostname ?? ''
      return (
        a.ip.toLowerCase().includes(q) ||
        a.mac.toLowerCase().includes(q) ||
        String(a.vmid ?? '').includes(q) ||
        String(liveName).toLowerCase().includes(q)
      )
    })
  }, [ipam, search, vmIndex])

  const pagedAllocations = useMemo(
    () => filteredAllocations.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [filteredAllocations, page, rowsPerPage],
  )

  // Reset to page 0 when filters change so we don't land past the end.
  useEffect(() => {
    if (page > 0 && page * rowsPerPage >= filteredAllocations.length) {
      setPage(0)
    }
  }, [filteredAllocations.length, page, rowsPerPage])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  if (error || !vnet) {
    return (
      <Stack alignItems="center" sx={{ py: 6, opacity: 0.6, gap: 1 }}>
        <i className="ri-error-warning-line" style={{ fontSize: 36 }} />
        <Typography variant="body2">{error ?? 'VNet not found'}</Typography>
      </Stack>
    )
  }

  const sn = vnet.subnet

  return (
    <Stack spacing={2.5}>
      {/* Header — icon + VNet name + subnet CIDR, same h6 typography.
          Edit button anchored top-right. */}
      <Stack direction="row" alignItems="center" spacing={1.25}>
        <Box sx={{
          width: 36, height: 36, borderRadius: 1.5,
          bgcolor: alpha(theme.palette.primary.main, 0.12),
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <i className="ri-git-branch-line" style={{ fontSize: 20, color: theme.palette.primary.main }} />
        </Box>
        <Typography variant="h6" fontWeight={700} sx={{ lineHeight: 1.2, flex: 1, minWidth: 0 }}>
          {vnet.displayName}
          {sn && <span style={{ marginLeft: 12 }}>{sn.cidr}</span>}
        </Typography>
        {/* Segment ID: the VLAN tag on a VLAN-backed VNet, the VNI on the
            VXLAN overlay. Same acronyms as the VNets table tooltip. */}
        {vnet.tag != null && (
          <Chip
            size="small"
            label={`${vnet.type === 'vlan' ? 'VLAN' : 'VNI'} ${vnet.tag}`}
            sx={{
              height: 20, fontSize: 11, flexShrink: 0,
              bgcolor: alpha(theme.palette.primary.main, 0.1),
              color: 'primary.main',
            }}
          />
        )}
        <Tooltip arrow title={t('common.edit')}>
          <IconButton size="small" onClick={() => setEditOpen(true)}>
            <i className="ri-pencil-line" style={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      </Stack>


      {/* IPAM allocations — only relevant when the VNet has a subnet.
          Renders a small usage donut + a table of (IP, MAC, VMID, hostname,
          age). Empty state stays helpful: tells the user their first VM
          deployment will start filling this. */}
      {sn && (
        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <CardContent sx={{ pb: '12px !important' }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.25 }}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ flexShrink: 0 }}>
                {t('myVdc.ipamAllocationsTitle')}
              </Typography>
              {ipam && (
                <Chip
                  size="small"
                  label={`${ipam.used} / ${ipam.usable}`}
                  sx={{ height: 20, fontSize: 11, bgcolor: alpha(theme.palette.primary.main, 0.1), color: 'primary.main', flexShrink: 0 }}
                />
              )}
              {/* Spacer pushes the search input to the right edge. */}
              <Box sx={{ flex: 1 }} />
              <TextField
                size="small"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('myVdc.ipamSearchPlaceholder')}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <i className="ri-search-line" style={{ fontSize: 14, opacity: 0.55 }} />
                    </InputAdornment>
                  ),
                  endAdornment: search ? (
                    <InputAdornment position="end">
                      <IconButton size="small" onClick={() => setSearch('')} sx={{ p: 0.25 }}>
                        <i className="ri-close-line" style={{ fontSize: 14 }} />
                      </IconButton>
                    </InputAdornment>
                  ) : undefined,
                }}
                sx={{ width: 220 }}
              />
            </Stack>

            {ipamLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                <CircularProgress size={20} />
              </Box>
            ) : !ipam ? (
              <Stack alignItems="center" sx={{ py: 3, opacity: 0.55, gap: 0.5 }}>
                <i className="ri-error-warning-line" style={{ fontSize: 24 }} />
                <Typography variant="body2">{t('myVdc.ipamLoadFailed')}</Typography>
              </Stack>
            ) : (
              <>
                {/* Usage bar — green up to 70 %, amber 70-90, red ≥90 so admins
                    notice when a /24 is filling up. */}
                <Box sx={{ mb: 1.5 }}>
                  <Tooltip
                    arrow
                    title={`${ipam.used} of ${ipam.usable} usable IP${ipam.usable > 1 ? 's' : ''} allocated`}
                  >
                    <LinearProgress
                      variant="determinate"
                      value={ipam.usable > 0 ? Math.min(100, (ipam.used / ipam.usable) * 100) : 0}
                      color={
                        ipam.usable === 0 || (ipam.used / ipam.usable) < 0.7
                          ? 'success'
                          : (ipam.used / ipam.usable) < 0.9
                            ? 'warning'
                            : 'error'
                      }
                      sx={{ height: 6, borderRadius: 3 }}
                    />
                  </Tooltip>
                </Box>

                {ipam.allocations.length === 0 ? (
                  <Stack alignItems="center" sx={{ py: 2.5, opacity: 0.55, gap: 0.5 }}>
                    <i className="ri-inbox-line" style={{ fontSize: 22 }} />
                    <Typography variant="body2">{t('myVdc.ipamEmpty')}</Typography>
                  </Stack>
                ) : filteredAllocations.length === 0 ? (
                  <Stack alignItems="center" sx={{ py: 2.5, opacity: 0.55, gap: 0.5 }}>
                    <i className="ri-search-eye-line" style={{ fontSize: 22 }} />
                    <Typography variant="body2">{t('common.noResults')}</Typography>
                  </Stack>
                ) : (
                  <Box sx={{ overflow: 'auto' }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontSize: 11, fontWeight: 700, opacity: 0.65, py: 0.75 }}>{t('myVdc.ipamCol.vm')}</TableCell>
                          <TableCell sx={{ fontSize: 11, fontWeight: 700, opacity: 0.65, py: 0.75 }}>{t('myVdc.ipamCol.vmid')}</TableCell>
                          <TableCell sx={{ fontSize: 11, fontWeight: 700, opacity: 0.65, py: 0.75 }}>{t('myVdc.ipamCol.ip')}</TableCell>
                          <TableCell sx={{ fontSize: 11, fontWeight: 700, opacity: 0.65, py: 0.75 }}>{t('myVdc.ipamCol.mac')}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {pagedAllocations.map((a) => {
                          // Source of truth for VM info, in priority order:
                          //  1. client-side vmIndex (live /guests fetch)
                          //  2. server-side ipam.allocations[].vm (may be
                          //     null if the route's /cluster/resources
                          //     enrichment failed)
                          // Whichever resolves first wins, so the sparkline
                          // and pastille always render when at least one
                          // path succeeded.
                          const vm = (a.vmid != null ? vmIndex.get(a.vmid) : null) ?? a.vm
                          const orphaned = a.vmid != null && !vm
                          return (
                            <TableRow key={a.id} sx={{ '&:last-child td': { border: 0 } }}>
                              <TableCell sx={{ fontSize: 12, py: 0.75 }}>
                                <Stack direction="row" alignItems="center" spacing={1}>
                                  {/* Reuse the inventory tree's StatusIcon so the
                                      pastille colours, icon families (qemu vs
                                      lxc, template, lock…) and sizes match
                                      exactly across screens. Orphan rows fall
                                      into the default "no status" case which
                                      StatusIcon already renders in red. */}
                                  {a.vmid != null ? (
                                    <StatusIcon
                                      type="vm"
                                      vmType={vm?.type ?? 'qemu'}
                                      status={vm?.status ?? 'unknown'}
                                      size={16}
                                    />
                                  ) : (
                                    <Box component="i" className="ri-bookmark-line" sx={{ fontSize: 16, opacity: 0.45 }} />
                                  )}
                                  <Typography
                                    variant="body2"
                                    sx={{
                                      fontSize: 12,
                                      fontWeight: vm ? 500 : 400,
                                      opacity: vm ? 1 : 0.55,
                                      fontStyle: vm ? 'normal' : 'italic',
                                    }}
                                  >
                                    {vm?.name ?? a.hostname ?? t('myVdc.ipamReservedLabel')}
                                  </Typography>
                                </Stack>
                              </TableCell>
                              <TableCell sx={{ fontSize: 12, py: 0.75 }}>
                                {a.vmid != null ? a.vmid : <span style={{ opacity: 0.4 }}>—</span>}
                              </TableCell>
                              <TableCell sx={{ fontSize: 12, py: 0.75 }}>{a.ip}</TableCell>
                              <TableCell sx={{ fontSize: 11, py: 0.75, opacity: 0.85 }}>{a.mac}</TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                    {filteredAllocations.length > rowsPerPage && (
                      <TablePagination
                        component="div"
                        count={filteredAllocations.length}
                        page={page}
                        onPageChange={(_, p) => setPage(p)}
                        rowsPerPage={rowsPerPage}
                        onRowsPerPageChange={(e) => {
                          setRowsPerPage(Number.parseInt(e.target.value, 10) || 10)
                          setPage(0)
                        }}
                        rowsPerPageOptions={[10, 25, 50]}
                        sx={{ '& .MuiTablePagination-toolbar': { minHeight: 40, fontSize: 12 } }}
                      />
                    )}
                  </Box>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Subnet block was removed: its CIDR / gateway / DNS now live
          in the header chips above. The dedicated card was duplicate
          info once that landed. */}

      {editOpen && (
        <VnetEditDialog
          vnet={vnet}
          vdcId={vnet.vdcId}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false)
            setReloadTick((n) => n + 1)
          }}
        />
      )}
    </Stack>
  )
}
