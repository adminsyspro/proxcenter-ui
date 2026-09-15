'use client'

// Provider-only management of stretched tenant networks (#901): one L2
// segment of a tenant carried by several of its vDCs at once, with one VNI,
// one PVE VNet id on every member cluster and one shared subnet. Rendered by
// VdcTab as its third tab. Memberships are the operator's decision; the
// tenant consumes the network like any VNet of its vDCs.

import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  Menu,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'

import { useTranslations } from 'next-intl'

interface TenantNetworkMember {
  vdcId: string
  vdcName: string
  connectionId: string
  connectionName: string
  pveName: string
  zoneName: string | null
}

interface TenantNetworkSubnet {
  id: string
  cidr: string
  gateway: string
  dnsServers: string[]
  ipamEnabled: boolean
}

interface TenantNetworkDto {
  id: string
  tenantId: string
  tenantName: string
  name: string
  description: string | null
  pveName: string
  vni: number
  mtu: number | null
  subnet: TenantNetworkSubnet | null
  members: TenantNetworkMember[]
}

interface ZoneSyncResult {
  vdcId: string
  vdcName: string
  connectionId: string
  zoneName: string
  changed: boolean
  error?: string
}

interface Props {
  tenants: Array<{ id: string; name: string }>
  /** The vDC rows VdcTab already holds; the join picker filters them. */
  vdcs: any[]
  connections: Array<{ id: string; name: string }>
}

interface NetworkForm {
  tenantId: string
  name: string
  description: string
  vni: string
  mtu: string
  cidr: string
  gateway: string
  dns: string
}

const EMPTY_FORM: NetworkForm = { tenantId: '', name: '', description: '', vni: '', mtu: '', cidr: '', gateway: '', dns: '' }

// Same fix as VdcTab: a small Select is 38 px tall next to 35.9 px inputs.
const SMALL_SELECT_SX = { '& .MuiInputBase-input.MuiSelect-select': { minHeight: '1.4375em', lineHeight: '1.4375em' } } as const

const splitDns = (raw: string): string[] => raw.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean)

async function request(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || res.statusText)
  return body
}

export default function TenantNetworksSection({ tenants, vdcs, connections }: Props) {
  const t = useTranslations()

  const [networks, setNetworks] = useState<TenantNetworkDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(20)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<TenantNetworkDto | null>(null)
  const [form, setForm] = useState<NetworkForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [dialogError, setDialogError] = useState('')

  const [memberMenu, setMemberMenu] = useState<{ anchor: HTMLElement; network: TenantNetworkDto } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<
    | { kind: 'remove-member'; network: TenantNetworkDto; member: TenantNetworkMember }
    | { kind: 'delete'; network: TenantNetworkDto }
    | null
  >(null)

  const tenantOptions = useMemo(() => tenants.filter(x => x.id !== 'default'), [tenants])
  const connectionName = useCallback((id: string) => connections.find(c => c.id === id)?.name ?? id, [connections])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const body = await request('/api/v1/admin/tenant-networks')
      setNetworks(Array.isArray(body?.data) ? body.data : [])
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  /** The vDCs that can join: same tenant, a VXLAN zone, a cluster no member holds yet. */
  const candidateVdcs = useCallback((network: TenantNetworkDto) =>
    vdcs.filter(v =>
      v.tenantId === network.tenantId &&
      v.enabled !== false &&
      !!v.sdnZoneName &&
      !network.members.some(m => m.vdcId === v.id) &&
      !network.members.some(m => m.connectionId === v.connectionId),
    ), [vdcs])

  const openCreate = () => {
    setEditing(null)
    setForm({ ...EMPTY_FORM, tenantId: tenantOptions[0]?.id ?? '' })
    setDialogError('')
    setDialogOpen(true)
  }

  const openEdit = (network: TenantNetworkDto) => {
    setEditing(network)
    setForm({
      tenantId: network.tenantId,
      name: network.name,
      description: network.description ?? '',
      vni: String(network.vni),
      mtu: network.mtu === null ? '' : String(network.mtu),
      cidr: network.subnet?.cidr ?? '',
      gateway: network.subnet?.gateway ?? '',
      dns: network.subnet?.dnsServers.join(', ') ?? '',
    })
    setDialogError('')
    setDialogOpen(true)
  }

  const flash = (message: string) => { setError(''); setSuccess(message) }

  const summarizeSync = (results: ZoneSyncResult[]): string | null => {
    const failed = results.filter(r => r.error)
    if (failed.length === 0) return null
    return t('vdc.tenantNetworkSyncErrors', {
      count: failed.length,
      detail: failed.map(r => `${connectionName(r.connectionId)}: ${r.error}`).join('; '),
    })
  }

  const save = async () => {
    setSaving(true)
    setDialogError('')
    try {
      if (editing) {
        const body = await request(`/api/v1/admin/tenant-networks/${encodeURIComponent(editing.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: form.name.trim(),
            description: form.description.trim() || null,
            mtu: form.mtu.trim() === '' ? null : Number(form.mtu),
            subnet: { dnsServers: splitDns(form.dns) },
          }),
        })
        flash(t('vdc.tenantNetworkUpdated', { name: body.data.name }))
      } else {
        const body = await request('/api/v1/admin/tenant-networks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId: form.tenantId,
            name: form.name.trim(),
            description: form.description.trim() || null,
            vni: form.vni.trim() === '' ? null : Number(form.vni),
            mtu: form.mtu.trim() === '' ? null : Number(form.mtu),
            subnet: { cidr: form.cidr.trim(), gateway: form.gateway.trim(), dnsServers: splitDns(form.dns) },
          }),
        })
        flash(t('vdc.tenantNetworkCreated', { name: body.data.name, vni: body.data.vni }))
      }
      setDialogOpen(false)
      await load()
    } catch (e: any) {
      setDialogError(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  const addMember = async (network: TenantNetworkDto, vdc: any) => {
    setMemberMenu(null)
    setBusyId(network.id)
    try {
      const body = await request(`/api/v1/admin/tenant-networks/${encodeURIComponent(network.id)}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vdcId: vdc.id }),
      })
      const syncErrors = summarizeSync(body.data?.zoneSync ?? [])
      flash(t('vdc.tenantNetworkMemberAdded', { vdc: vdc.name, network: network.name, pveName: body.data?.pveName ?? '' }) + (syncErrors ? ` ${syncErrors}` : ''))
      await load()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setBusyId(null)
    }
  }

  const removeMember = async (network: TenantNetworkDto, member: TenantNetworkMember) => {
    setConfirm(null)
    setBusyId(network.id)
    try {
      const body = await request(`/api/v1/admin/tenant-networks/${encodeURIComponent(network.id)}/members?vdcId=${encodeURIComponent(member.vdcId)}`, { method: 'DELETE' })
      const syncErrors = summarizeSync(body.data?.zoneSync ?? [])
      flash(t('vdc.tenantNetworkMemberRemoved', { vdc: member.vdcName, network: network.name }) + (syncErrors ? ` ${syncErrors}` : ''))
      await load()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setBusyId(null)
    }
  }

  const sync = async (network: TenantNetworkDto) => {
    setBusyId(network.id)
    try {
      const body = await request(`/api/v1/admin/tenant-networks/${encodeURIComponent(network.id)}/sync`, { method: 'POST' })
      const results: ZoneSyncResult[] = body.data?.zoneSync ?? []
      const changed = results.filter(r => r.changed && !r.error).length
      const unchanged = results.filter(r => !r.changed && !r.error).length
      const syncErrors = summarizeSync(results)
      flash(t('vdc.tenantNetworkSyncResult', { changed, unchanged }) + (syncErrors ? ` ${syncErrors}` : ''))
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (network: TenantNetworkDto) => {
    setConfirm(null)
    setBusyId(network.id)
    try {
      await request(`/api/v1/admin/tenant-networks/${encodeURIComponent(network.id)}`, { method: 'DELETE' })
      flash(t('vdc.tenantNetworkDeleted', { name: network.name }))
      await load()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setBusyId(null)
    }
  }

  const pageRows = networks.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
  const formValid = form.name.trim() !== '' && (editing !== null || (form.tenantId !== '' && form.cidr.trim() !== '' && form.gateway.trim() !== ''))

  return (
    <>
      <Card>
        <CardContent>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
            <i className="ri-git-branch-line" style={{ opacity: 0.6, fontSize: 18 }} />
            <Typography variant="h6">{t('vdc.tenantNetworksTitle')}</Typography>
            <Chip label={networks.length} size="small" sx={{ height: 20, fontSize: 11 }} />
            <Box sx={{ flex: 1 }} />
            <Tooltip title={tenantOptions.length === 0 ? t('vdc.tenantNetworkNoTenant') : ''} arrow>
              <span>
                <Button variant="contained" startIcon={<i className="ri-add-line" />} disabled={tenantOptions.length === 0} onClick={openCreate}>
                  {t('vdc.tenantNetworkCreate')}
                </Button>
              </span>
            </Tooltip>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
            {t('vdc.tenantNetworksHint')}
          </Typography>

          {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
          {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

          {loading && networks.length === 0 ? (
            <LinearProgress />
          ) : networks.length === 0 ? (
            <Stack alignItems="center" sx={{ py: 4, opacity: 0.55, gap: 0.5 }}>
              <i className="ri-git-branch-line" style={{ fontSize: 28 }} />
              <Typography variant="body2">{t('vdc.tenantNetworkEmpty')}</Typography>
            </Stack>
          ) : (
            <>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('vdc.tenant')}</TableCell>
                      <TableCell>{t('vdc.tenantNetworkName')}</TableCell>
                      <TableCell align="right">{t('vdc.tenantNetworkVni')}</TableCell>
                      <TableCell>{t('vdc.tenantNetworkPveName')}</TableCell>
                      <TableCell>{t('vdc.tenantNetworkSubnet')}</TableCell>
                      <TableCell align="right">{t('vdc.tenantNetworkMtu')}</TableCell>
                      <TableCell>{t('vdc.tenantNetworkMembers')}</TableCell>
                      <TableCell align="right" />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {pageRows.map((n) => {
                      const busy = busyId === n.id
                      const candidates = candidateVdcs(n)
                      return (
                        <TableRow key={n.id} sx={{ '&:last-child td': { border: 0 } }}>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>
                            <Stack direction="row" spacing={0.75} alignItems="center">
                              <i className="ri-building-line" style={{ opacity: 0.7 }} />
                              <span>{n.tenantName}</span>
                            </Stack>
                          </TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>
                            <Tooltip title={n.description ?? ''} arrow placement="top">
                              <Typography variant="body2" fontWeight={600}>{n.name}</Typography>
                            </Tooltip>
                          </TableCell>
                          <TableCell align="right">{n.vni}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{n.pveName}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>
                            {n.subnet ? `${n.subnet.cidr} · ${n.subnet.gateway}` : '—'}
                          </TableCell>
                          <TableCell align="right">{n.mtu === null ? t('vdc.tenantNetworkMtuDefault') : n.mtu}</TableCell>
                          <TableCell>
                            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap alignItems="center">
                              {n.members.length === 0 && (
                                <Typography variant="caption" sx={{ fontStyle: 'italic' }}>{t('vdc.tenantNetworkNoMembers')}</Typography>
                              )}
                              {n.members.map((m) => (
                                <Chip
                                  key={m.vdcId}
                                  size="small"
                                  variant="outlined"
                                  icon={<i className="ri-server-line" style={{ fontSize: 14 }} />}
                                  label={`${m.connectionName} · ${m.vdcName}`}
                                  onDelete={busy ? undefined : () => setConfirm({ kind: 'remove-member', network: n, member: m })}
                                  deleteIcon={<i className="ri-close-line" aria-label={t('vdc.tenantNetworkRemoveMember', { vdc: m.vdcName })} />}
                                />
                              ))}
                              <Tooltip title={candidates.length === 0 ? t('vdc.tenantNetworkNoCandidate') : t('vdc.tenantNetworkAddMember')} arrow>
                                <span>
                                  <IconButton
                                    size="small"
                                    aria-label={t('vdc.tenantNetworkAddMember')}
                                    disabled={busy || candidates.length === 0}
                                    onClick={(e) => setMemberMenu({ anchor: e.currentTarget, network: n })}
                                  >
                                    <i className="ri-add-line" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                            </Stack>
                          </TableCell>
                          <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                            {busy ? (
                              <CircularProgress size={18} sx={{ mr: 1, verticalAlign: 'middle' }} />
                            ) : (
                              <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                                <Tooltip title={t('vdc.tenantNetworkSync')} arrow>
                                  <span>
                                    <IconButton size="small" aria-label={t('vdc.tenantNetworkSync')} disabled={n.members.length === 0} onClick={() => void sync(n)}>
                                      <i className="ri-refresh-line" />
                                    </IconButton>
                                  </span>
                                </Tooltip>
                                <Tooltip title={t('common.edit')} arrow>
                                  <IconButton size="small" aria-label={t('vdc.tenantNetworkEdit')} onClick={() => openEdit(n)}>
                                    <i className="ri-pencil-line" />
                                  </IconButton>
                                </Tooltip>
                                <Tooltip title={n.members.length > 0 ? t('vdc.tenantNetworkDeleteBlocked') : t('vdc.tenantNetworkDelete')} arrow>
                                  <span>
                                    <IconButton
                                      size="small"
                                      color="error"
                                      aria-label={t('vdc.tenantNetworkDelete')}
                                      disabled={n.members.length > 0}
                                      onClick={() => setConfirm({ kind: 'delete', network: n })}
                                    >
                                      <i className="ri-delete-bin-line" />
                                    </IconButton>
                                  </span>
                                </Tooltip>
                              </Stack>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
              <TablePagination
                component="div"
                count={networks.length}
                page={page}
                onPageChange={(_e, p) => setPage(p)}
                rowsPerPage={rowsPerPage}
                onRowsPerPageChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(0) }}
                rowsPerPageOptions={[20, 50, 100]}
                labelRowsPerPage={t('common.rowsPerPage')}
              />
            </>
          )}
        </CardContent>
      </Card>

      {/* Join picker: the candidate vDCs of the network's tenant. */}
      <Menu open={!!memberMenu} anchorEl={memberMenu?.anchor ?? null} onClose={() => setMemberMenu(null)}>
        {memberMenu && candidateVdcs(memberMenu.network).map((v) => (
          <MenuItem key={v.id} onClick={() => void addMember(memberMenu.network, v)}>
            <Stack direction="row" spacing={1} alignItems="center">
              <i className="ri-server-line" style={{ opacity: 0.7 }} />
              <span>{connectionName(v.connectionId)} · {v.name}</span>
            </Stack>
          </MenuItem>
        ))}
      </Menu>

      {/* Create / edit */}
      <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? t('vdc.tenantNetworkEdit') : t('vdc.tenantNetworkCreate')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          {dialogError && <Alert severity="error" onClose={() => setDialogError('')}>{dialogError}</Alert>}
          <TextField
            select size="small" fullWidth sx={SMALL_SELECT_SX}
            label={t('vdc.tenant')}
            value={form.tenantId}
            disabled={!!editing}
            onChange={(e) => setForm(f => ({ ...f, tenantId: e.target.value }))}
          >
            {tenantOptions.map((x) => <MenuItem key={x.id} value={x.id}>{x.name}</MenuItem>)}
          </TextField>
          <Stack direction="row" spacing={1}>
            <TextField
              size="small" sx={{ flex: 1 }}
              label={t('vdc.tenantNetworkName')}
              value={form.name}
              onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
              slotProps={{ htmlInput: { maxLength: 20 } }}
            />
            <TextField
              size="small" sx={{ flex: 2 }}
              label={t('vdc.tenantNetworkDescription')}
              value={form.description}
              onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
            />
          </Stack>
          <Stack direction="row" spacing={1}>
            <TextField
              size="small" type="number" sx={{ flex: 1 }}
              label={t('vdc.tenantNetworkVni')}
              value={form.vni}
              disabled={!!editing}
              onChange={(e) => setForm(f => ({ ...f, vni: e.target.value }))}
              helperText={editing ? undefined : t('vdc.tenantNetworkVniHint')}
              slotProps={{ htmlInput: { min: 1, max: 16777215 } }}
            />
            <TextField
              size="small" type="number" sx={{ flex: 1 }}
              label={t('vdc.tenantNetworkMtu')}
              value={form.mtu}
              disabled={!!editing && editing.members.length > 0}
              onChange={(e) => setForm(f => ({ ...f, mtu: e.target.value }))}
              helperText={t('vdc.tenantNetworkMtuHint')}
              slotProps={{ htmlInput: { min: 1280, max: 9000 } }}
            />
          </Stack>
          <Typography variant="subtitle2">{t('vdc.tenantNetworkSubnet')}</Typography>
          <Stack direction="row" spacing={1}>
            <TextField
              size="small" sx={{ flex: 1 }}
              label={t('vdc.tenantNetworkCidr')}
              value={form.cidr}
              disabled={!!editing}
              placeholder="10.77.0.0/24"
              onChange={(e) => setForm(f => ({ ...f, cidr: e.target.value }))}
            />
            <TextField
              size="small" sx={{ flex: 1 }}
              label={t('vdc.tenantNetworkGateway')}
              value={form.gateway}
              disabled={!!editing}
              placeholder="10.77.0.1"
              onChange={(e) => setForm(f => ({ ...f, gateway: e.target.value }))}
            />
          </Stack>
          <TextField
            size="small" fullWidth
            label={t('vdc.tenantNetworkDns')}
            value={form.dns}
            onChange={(e) => setForm(f => ({ ...f, dns: e.target.value }))}
            helperText={t('vdc.tenantNetworkDnsHint')}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={() => void save()} disabled={saving || !formValid}>
            {editing ? t('common.save') : t('common.create')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Confirmations */}
      <Dialog open={!!confirm} onClose={() => setConfirm(null)} maxWidth="xs" fullWidth>
        {confirm?.kind === 'remove-member' && (
          <>
            <DialogTitle>{t('vdc.tenantNetworkRemoveMemberTitle')}</DialogTitle>
            <DialogContent>
              <Typography variant="body2">
                {t('vdc.tenantNetworkRemoveMemberConfirm', { vdc: confirm.member.vdcName, network: confirm.network.name })}
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirm(null)}>{t('common.cancel')}</Button>
              <Button color="error" variant="contained" onClick={() => void removeMember(confirm.network, confirm.member)}>{t('common.confirm')}</Button>
            </DialogActions>
          </>
        )}
        {confirm?.kind === 'delete' && (
          <>
            <DialogTitle>{t('vdc.tenantNetworkDeleteTitle')}</DialogTitle>
            <DialogContent>
              <Typography variant="body2">{t('vdc.tenantNetworkDeleteConfirm', { name: confirm.network.name, vni: confirm.network.vni })}</Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirm(null)}>{t('common.cancel')}</Button>
              <Button color="error" variant="contained" onClick={() => void remove(confirm.network)}>{t('common.delete')}</Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </>
  )
}
