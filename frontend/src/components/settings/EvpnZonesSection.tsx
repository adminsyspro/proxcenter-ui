'use client'

// Provider-only management of the EVPN zones shared between clusters (#1334):
// one Proxmox zone id carried by several clusters, created or adopted, bound
// on each cluster to an EVPN controller that exists or that ProxCenter
// creates. The second card audits the VNIs two clusters carry for unrelated
// networks, which an EVPN peering would bridge. Rendered by VdcTab.

import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
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

type MemberState = 'ok' | 'pending' | 'missing' | 'drift' | 'controller-missing' | 'unreachable'

interface ZoneMember {
  id: string
  connectionId: string
  connectionName: string
  controller: string
  controllerCreated: boolean
  adopted: boolean
}

interface MemberStatus {
  connectionId: string
  connectionName: string
  state: MemberState
  detail: string | null
  vnetCount: number
}

interface ZoneDto {
  id: string
  name: string
  description: string | null
  zoneName: string
  vrfVxlan: number
  mtu: number | null
  vniStart: number
  vniEnd: number
  members: ZoneMember[]
}

interface Discovery {
  connectionId: string
  connectionName: string
  reachable: boolean
  controllers: Array<{ controller: string; asn: number | null; peers: string[] }>
  zones: Array<{ zone: string; controller: string | null; vrfVxlan: number | null; mtu: number | null }>
  nodeIps: string[]
  nodesWithoutFrr: string[]
}

interface CollisionHolder {
  connectionId: string
  connectionName: string
  zone: string
  zoneType: string
  vnet: string | null
  alias: string | null
  vdcVnetId: string | null
  vdcName: string | null
  tenantName: string | null
  renumberable: boolean
}

interface Collision {
  vni: number
  exposed: boolean
  holders: CollisionHolder[]
}

interface ApplyError { connectionName: string; error: string }

interface Props {
  connections: Array<{ id: string; name: string; type?: string }>
}

/** `__new__` in `controller` means "create one"; the three fields below describe it. */
interface MemberForm {
  controller: string
  newName: string
  asn: string
  peers: string
  /** False while the peers still follow the selection. */
  peersEdited: boolean
}

interface ZoneForm {
  name: string
  description: string
  zoneName: string
  vrfVxlan: string
  mtu: string
  vniStart: string
  vniEnd: string
}

const NEW_CONTROLLER = '__new__'
const EMPTY_FORM: ZoneForm = { name: '', description: '', zoneName: '', vrfVxlan: '', mtu: '', vniStart: '', vniEnd: '' }

// Same fix as VdcTab: a small Select is 38 px tall next to 35.9 px inputs.
const SMALL_SELECT_SX = { '& .MuiInputBase-input.MuiSelect-select': { minHeight: '1.4375em', lineHeight: '1.4375em' } } as const

const STATE_COLOR: Record<MemberState, 'success' | 'warning' | 'error' | 'default'> = {
  ok: 'success',
  pending: 'warning',
  missing: 'error',
  drift: 'error',
  'controller-missing': 'error',
  unreachable: 'default',
}

async function request(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || res.statusText)
  return body
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

function memberPayload(connectionId: string, m: MemberForm) {
  return {
    connectionId,
    controller: m.controller === NEW_CONTROLLER
      ? { mode: 'create', name: m.newName.trim(), asn: Number(m.asn), peers: m.peers.split(/[\s,;]+/).filter(Boolean) }
      : { mode: 'existing', name: m.controller },
  }
}

export default function EvpnZonesSection({ connections }: Props) {
  const t = useTranslations()

  const clusters = useMemo(
    () => connections.filter(c => !c.type || c.type === 'pve').sort((a, b) => a.name.localeCompare(b.name)),
    [connections],
  )

  const [zones, setZones] = useState<ZoneDto[]>([])
  const [status, setStatus] = useState<Record<string, MemberStatus[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(20)

  const [dialog, setDialog] = useState<null | { kind: 'create' } | { kind: 'edit'; zone: ZoneDto } | { kind: 'add-member'; zone: ZoneDto }>(null)
  const [form, setForm] = useState<ZoneForm>(EMPTY_FORM)
  const [selected, setSelected] = useState<string[]>([])
  const [memberForms, setMemberForms] = useState<Record<string, MemberForm>>({})
  const [discovery, setDiscovery] = useState<Record<string, Discovery>>({})
  const [discovering, setDiscovering] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dialogError, setDialogError] = useState('')

  const [memberMenu, setMemberMenu] = useState<null | { anchor: HTMLElement; zone: ZoneDto; member: ZoneMember }>(null)
  const [confirm, setConfirm] = useState<
    | null
    | { kind: 'delete'; zone: ZoneDto }
    | { kind: 'remove-member'; zone: ZoneDto; member: ZoneMember }
    | { kind: 'renumber'; vni: number; holder: CollisionHolder }
  >(null)

  const [collisions, setCollisions] = useState<Collision[]>([])
  const [collisionsUnreachable, setCollisionsUnreachable] = useState<string[]>([])
  const [auditing, setAuditing] = useState(false)
  const [auditError, setAuditError] = useState('')

  const reportApplyErrors = useCallback((errors: ApplyError[] | undefined, okMessage: string) => {
    if (errors && errors.length > 0) {
      setSuccess('')
      setError(t('vdc.evpn.applyFailed', { clusters: errors.map(e => e.connectionName).join(', ') }))
    } else {
      setError('')
      setSuccess(okMessage)
    }
  }, [t])

  const loadStatus = useCallback(async (list: ZoneDto[]) => {
    const entries = await Promise.all(list.map(async z => {
      try {
        const body = await request(`/api/v1/admin/evpn-zones/${z.id}`)
        return [z.id, (body.data?.status ?? []) as MemberStatus[]] as const
      } catch {
        return [z.id, [] as MemberStatus[]] as const
      }
    }))
    setStatus(Object.fromEntries(entries))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const body = await request('/api/v1/admin/evpn-zones')
      const list = (body.data ?? []) as ZoneDto[]
      setZones(list)
      void loadStatus(list)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [loadStatus])

  const audit = useCallback(async () => {
    setAuditing(true)
    setAuditError('')
    try {
      const body = await request('/api/v1/admin/evpn-zones/collisions')
      setCollisions(body.data?.collisions ?? [])
      setCollisionsUnreachable(body.data?.unreachable ?? [])
    } catch (e: any) {
      setAuditError(e?.message || String(e))
    } finally {
      setAuditing(false)
    }
  }, [])

  useEffect(() => {
    void load()
    void audit()
  }, [load, audit])

  // ── Declaration form ───────────────────────────────────────────────────

  const defaultPeers = useCallback((ids: string[], found: Record<string, Discovery>) => {
    const ips = ids.flatMap(id => found[id]?.nodeIps ?? [])
    return [...new Set(ips)].join(', ')
  }, [])

  const discover = useCallback(async (ids: string[]) => {
    const missing = ids.filter(id => !discovery[id])
    let found = discovery
    if (missing.length > 0) {
      setDiscovering(true)
      try {
        const body = await request(`/api/v1/admin/evpn-zones/discover?connectionIds=${encodeURIComponent(missing.join(','))}`)
        found = { ...discovery }
        for (const d of (body.data ?? []) as Discovery[]) found[d.connectionId] = d
        setDiscovery(found)
      } catch (e: any) {
        setDialogError(e?.message || String(e))
      } finally {
        setDiscovering(false)
      }
    }
    // A cluster gets its only controller by default, else "create one"; the
    // peers of a new controller follow the selection: every node of every
    // selected cluster, which is what peers two clusters together.
    const peers = defaultPeers(ids, found)
    setMemberForms(prev => {
      const next: Record<string, MemberForm> = {}
      for (const id of ids) {
        const known = found[id]?.controllers ?? []
        const current = prev[id]
        next[id] = current
          ? { ...current, peers: current.peersEdited ? current.peers : peers }
          : { controller: known.length > 0 ? known[0].controller : NEW_CONTROLLER, newName: 'evpn', asn: '65000', peers, peersEdited: false }
      }
      return next
    })
  }, [discovery, defaultPeers])

  const openCreate = () => {
    setForm(EMPTY_FORM)
    setSelected([])
    setMemberForms({})
    setDialogError('')
    setDialog({ kind: 'create' })
  }

  const openEdit = (zone: ZoneDto) => {
    setForm({
      name: zone.name,
      description: zone.description ?? '',
      zoneName: zone.zoneName,
      vrfVxlan: String(zone.vrfVxlan),
      mtu: zone.mtu === null ? '' : String(zone.mtu),
      vniStart: String(zone.vniStart),
      vniEnd: String(zone.vniEnd),
    })
    setDialogError('')
    setDialog({ kind: 'edit', zone })
  }

  const openAddMember = (zone: ZoneDto) => {
    setSelected([])
    setMemberForms({})
    setDialogError('')
    setDialog({ kind: 'add-member', zone })
  }

  const candidates = useMemo(() => {
    if (dialog?.kind !== 'add-member') return clusters
    const taken = new Set(dialog.zone.members.map(m => m.connectionId))
    return clusters.filter(c => !taken.has(c.id))
  }, [dialog, clusters])

  const toggle = (id: string) => {
    const single = dialog?.kind === 'add-member'
    const next = selected.includes(id) ? selected.filter(x => x !== id) : single ? [id] : [...selected, id]
    setSelected(next)
    void discover(next)
  }

  const toggleAll = () => {
    const next = selected.length === candidates.length ? [] : candidates.map(c => c.id)
    setSelected(next)
    void discover(next)
  }

  // Zones Proxmox already runs on the selected clusters: one click adopts.
  const adoptable = useMemo(() => {
    const seen = new Map<string, Discovery['zones'][number]>()
    for (const id of selected) for (const z of discovery[id]?.zones ?? []) if (!seen.has(z.zone)) seen.set(z.zone, z)
    const declared = new Set(zones.map(z => z.zoneName))
    return [...seen.values()].filter(z => !declared.has(z.zone))
  }, [selected, discovery, zones])

  const adopt = (zone: Discovery['zones'][number]) => {
    setForm(f => ({
      ...f,
      zoneName: zone.zone,
      vrfVxlan: zone.vrfVxlan === null ? f.vrfVxlan : String(zone.vrfVxlan),
      mtu: zone.mtu === null ? '' : String(zone.mtu),
    }))
    setMemberForms(prev => {
      const next = { ...prev }
      for (const id of selected) {
        const live = discovery[id]?.zones.find(z => z.zone === zone.zone)
        if (live?.controller && next[id]) next[id] = { ...next[id], controller: live.controller }
      }
      return next
    })
  }

  const submit = async () => {
    if (!dialog) return
    setSaving(true)
    setDialogError('')
    try {
      if (dialog.kind === 'edit') {
        await request(`/api/v1/admin/evpn-zones/${dialog.zone.id}`, jsonInit('PUT', {
          name: form.name, description: form.description, vniStart: Number(form.vniStart), vniEnd: Number(form.vniEnd),
        }))
        setSuccess(t('vdc.evpn.updated', { name: form.name }))
      } else if (dialog.kind === 'add-member') {
        const id = selected[0]
        const body = await request(`/api/v1/admin/evpn-zones/${dialog.zone.id}/members`, jsonInit('POST', memberPayload(id, memberForms[id])))
        reportApplyErrors(body.applyErrors, t('vdc.evpn.memberAdded', { name: dialog.zone.name }))
      } else {
        const body = await request('/api/v1/admin/evpn-zones', jsonInit('POST', {
          name: form.name,
          description: form.description,
          zoneName: form.zoneName,
          vrfVxlan: Number(form.vrfVxlan),
          mtu: form.mtu.trim() === '' ? null : Number(form.mtu),
          vniStart: Number(form.vniStart),
          vniEnd: Number(form.vniEnd),
          members: selected.map(id => memberPayload(id, memberForms[id])),
        }))
        reportApplyErrors(body.applyErrors, t('vdc.evpn.created', { name: form.name }))
      }
      setDialog(null)
      await load()
      void audit()
    } catch (e: any) {
      setDialogError(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  // ── Row actions ────────────────────────────────────────────────────────

  const run = async (zoneId: string, action: () => Promise<void>) => {
    setBusyId(zoneId)
    setError('')
    setSuccess('')
    try {
      await action()
      await load()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setBusyId(null)
    }
  }

  const remove = (zone: ZoneDto) => {
    setConfirm(null)
    void run(zone.id, async () => {
      const body = await request(`/api/v1/admin/evpn-zones/${zone.id}`, { method: 'DELETE' })
      reportApplyErrors(body.applyErrors, t('vdc.evpn.deleted', { name: zone.name }))
    })
  }

  const removeMember = (zone: ZoneDto, member: ZoneMember) => {
    setConfirm(null)
    void run(zone.id, async () => {
      const body = await request(`/api/v1/admin/evpn-zones/${zone.id}/members?connectionId=${encodeURIComponent(member.connectionId)}`, { method: 'DELETE' })
      reportApplyErrors(body.applyErrors, t('vdc.evpn.memberRemoved', { cluster: member.connectionName }))
    })
  }

  const resync = (zone: ZoneDto, member: ZoneMember) => {
    setMemberMenu(null)
    void run(zone.id, async () => {
      await request(`/api/v1/admin/evpn-zones/${zone.id}/members`, jsonInit('PUT', { connectionId: member.connectionId }))
      setSuccess(t('vdc.evpn.resynced', { cluster: member.connectionName }))
    })
  }

  const renumber = async (holder: CollisionHolder) => {
    setConfirm(null)
    setAuditing(true)
    setAuditError('')
    try {
      const body = await request('/api/v1/admin/evpn-zones/collisions', jsonInit('POST', { vdcVnetId: holder.vdcVnetId }))
      setSuccess(t('vdc.evpn.renumbered', { network: holder.alias ?? holder.vnet ?? '', from: body.data.previousVni, to: body.data.vni }))
    } catch (e: any) {
      setAuditError(e?.message || String(e))
    }
    await audit()
  }

  const stateOf = (zone: ZoneDto, member: ZoneMember): MemberStatus | undefined =>
    status[zone.id]?.find(s => s.connectionId === member.connectionId)

  const stateLabel = (s: MemberStatus | undefined): string => {
    if (!s) return t('vdc.evpn.stateLoading')
    const label = t(`vdc.evpn.state.${s.state}`)
    return s.detail ? `${label} (${s.detail})` : label
  }

  const formIncomplete = dialog?.kind === 'edit'
    ? !form.name.trim() || !form.vniStart || !form.vniEnd
    : dialog?.kind === 'add-member'
      ? selected.length !== 1
      : !form.name.trim() || !form.zoneName.trim() || !form.vrfVxlan || !form.vniStart || !form.vniEnd || selected.length === 0

  const membersIncomplete = dialog?.kind !== 'edit' && selected.some(id => {
    const m = memberForms[id]
    return !m || (m.controller === NEW_CONTROLLER && (!m.newName.trim() || !m.asn.trim() || !m.peers.trim()))
  })

  const visible = zones.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)

  const clusterRow = (c: { id: string; name: string }) => {
    const checked = selected.includes(c.id)
    const found = discovery[c.id]
    const m = memberForms[c.id]
    const willAdopt = !!found?.zones.some(z => z.zone === form.zoneName.trim()) || (dialog?.kind === 'add-member' && !!found?.zones.some(z => z.zone === dialog.zone.zoneName))
    return (
      <Box key={c.id}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <FormControlLabel
            sx={{ flex: 1, minWidth: 0, mr: 0 }}
            control={<Checkbox size="small" checked={checked} onChange={() => toggle(c.id)} />}
            label={
              <Stack direction="row" spacing={0.75} alignItems="center">
                <i className="ri-server-line" style={{ opacity: 0.7 }} />
                <Typography variant="body2" noWrap>{c.name}</Typography>
                {checked && willAdopt && <Chip size="small" color="info" variant="outlined" label={t('vdc.evpn.willAdopt')} sx={{ height: 20, fontSize: 11 }} />}
              </Stack>
            }
          />
          {checked && m && (
            <TextField
              select size="small" sx={{ width: 260, ...SMALL_SELECT_SX }}
              label={t('vdc.evpn.controller')}
              value={m.controller}
              onChange={(e) => setMemberForms(prev => ({ ...prev, [c.id]: { ...m, controller: e.target.value } }))}
            >
              {(found?.controllers ?? []).map(ctl => (
                <MenuItem key={ctl.controller} value={ctl.controller}>
                  {ctl.controller}{ctl.asn === null ? '' : ` · AS ${ctl.asn}`}
                </MenuItem>
              ))}
              <MenuItem value={NEW_CONTROLLER}>{t('vdc.evpn.controllerCreate')}</MenuItem>
            </TextField>
          )}
        </Stack>
        {checked && found && !found.reachable && (
          <Alert severity="warning" sx={{ mt: 1 }}>{t('vdc.evpn.clusterUnreachable')}</Alert>
        )}
        {checked && found && found.nodesWithoutFrr.length > 0 && (
          <Alert severity="warning" sx={{ mt: 1 }}>{t('vdc.evpn.frrMissing', { nodes: found.nodesWithoutFrr.join(', ') })}</Alert>
        )}
        {checked && m?.controller === NEW_CONTROLLER && (
          <Stack spacing={1.5} sx={{ mt: 1.5, ml: 4 }}>
            <TextField
              size="small" fullWidth label={t('vdc.evpn.controllerId')} value={m.newName}
              onChange={(e) => setMemberForms(prev => ({ ...prev, [c.id]: { ...m, newName: e.target.value } }))}
            />
            <TextField
              size="small" fullWidth label={t('vdc.evpn.asn')} value={m.asn}
              onChange={(e) => setMemberForms(prev => ({ ...prev, [c.id]: { ...m, asn: e.target.value.replace(/\D/g, '') } }))}
            />
            <TextField
              size="small" fullWidth label={t('vdc.evpn.peers')} value={m.peers}
              helperText={t('vdc.evpn.peersHint')}
              onChange={(e) => setMemberForms(prev => ({ ...prev, [c.id]: { ...m, peers: e.target.value, peersEdited: true } }))}
            />
          </Stack>
        )}
      </Box>
    )
  }

  return (
    <>
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
            <i className="ri-share-line" style={{ opacity: 0.6, fontSize: 18 }} />
            <Typography variant="h6">{t('vdc.evpn.title')}</Typography>
            <Chip label={zones.length} size="small" sx={{ height: 20, fontSize: 11 }} />
            <Box sx={{ flex: 1 }} />
            <Tooltip title={t('common.refresh')} arrow>
              <span>
                <IconButton size="small" aria-label={t('common.refresh')} disabled={loading} onClick={() => void load()}>
                  <i className="ri-refresh-line" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={clusters.length === 0 ? t('vdc.evpn.noCluster') : ''} arrow>
              <span>
                <Button variant="contained" startIcon={<i className="ri-add-line" />} disabled={clusters.length === 0} onClick={openCreate}>
                  {t('vdc.evpn.declare')}
                </Button>
              </span>
            </Tooltip>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
            {t('vdc.evpn.hint')}
          </Typography>

          {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
          {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

          {loading && zones.length === 0 ? (
            <LinearProgress />
          ) : zones.length === 0 ? (
            <Stack alignItems="center" sx={{ py: 4, opacity: 0.55, gap: 0.5 }}>
              <i className="ri-share-line" style={{ fontSize: 28 }} />
              <Typography variant="body2">{t('vdc.evpn.empty')}</Typography>
            </Stack>
          ) : (
            <>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('vdc.evpn.name')}</TableCell>
                      <TableCell>{t('vdc.evpn.zoneId')}</TableCell>
                      <TableCell align="right">{t('vdc.evpn.vrfVni')}</TableCell>
                      <TableCell>{t('vdc.evpn.vniRange')}</TableCell>
                      <TableCell align="right">{t('vdc.evpn.mtu')}</TableCell>
                      <TableCell>{t('vdc.evpn.clusters')}</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {visible.map((z) => {
                      const busy = busyId === z.id
                      const hasVnets = (status[z.id] ?? []).some(s => s.vnetCount > 0)
                      return (
                        <TableRow key={z.id} hover>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>
                            <Stack direction="row" spacing={1} alignItems="center">
                              <i className="ri-share-line" style={{ opacity: 0.7 }} />
                              <Tooltip title={z.description || ''} arrow>
                                <Typography variant="body2" fontWeight={600}>{z.name}</Typography>
                              </Tooltip>
                            </Stack>
                          </TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{z.zoneName}</TableCell>
                          <TableCell align="right">{z.vrfVxlan}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{z.vniStart} - {z.vniEnd}</TableCell>
                          <TableCell align="right">{z.mtu === null ? t('vdc.evpn.mtuDefault') : z.mtu}</TableCell>
                          <TableCell>
                            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap alignItems="center">
                              {z.members.map((m) => {
                                const s = stateOf(z, m)
                                return (
                                  <Tooltip key={m.id} title={`${stateLabel(s)} · ${t('vdc.evpn.controller')}: ${m.controller}`} arrow>
                                    <Chip
                                      size="small"
                                      variant="outlined"
                                      color={s ? STATE_COLOR[s.state] : 'default'}
                                      icon={<i className="ri-server-line" style={{ fontSize: 14 }} />}
                                      label={m.connectionName}
                                      onClick={busy ? undefined : (e) => setMemberMenu({ anchor: e.currentTarget, zone: z, member: m })}
                                    />
                                  </Tooltip>
                                )
                              })}
                              <Tooltip title={t('vdc.evpn.addCluster')} arrow>
                                <span>
                                  <IconButton
                                    size="small"
                                    aria-label={t('vdc.evpn.addCluster')}
                                    disabled={busy || z.members.length >= clusters.length}
                                    onClick={() => openAddMember(z)}
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
                                <Tooltip title={t('common.edit')} arrow>
                                  <IconButton size="small" aria-label={t('vdc.evpn.edit')} onClick={() => openEdit(z)}>
                                    <i className="ri-pencil-line" />
                                  </IconButton>
                                </Tooltip>
                                <Tooltip title={hasVnets ? t('vdc.evpn.deleteBlocked') : t('vdc.evpn.delete')} arrow>
                                  <span>
                                    <IconButton size="small" color="error" aria-label={t('vdc.evpn.delete')} disabled={hasVnets} onClick={() => setConfirm({ kind: 'delete', zone: z })}>
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
                count={zones.length}
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

      {/* VNIs two clusters carry for unrelated networks. */}
      <Card>
        <CardContent>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
            <i className="ri-alert-line" style={{ opacity: 0.6, fontSize: 18 }} />
            <Typography variant="h6">{t('vdc.evpn.collisionsTitle')}</Typography>
            <Chip label={collisions.length} size="small" color={collisions.length > 0 ? 'error' : 'default'} sx={{ height: 20, fontSize: 11 }} />
            <Box sx={{ flex: 1 }} />
            <Button size="small" startIcon={<i className="ri-search-eye-line" />} disabled={auditing} onClick={() => void audit()}>
              {t('vdc.evpn.collisionsCheck')}
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
            {t('vdc.evpn.collisionsHint')}
          </Typography>

          {auditError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setAuditError('')}>{auditError}</Alert>}
          {collisionsUnreachable.length > 0 && (
            <Alert severity="warning" sx={{ mb: 2 }}>{t('vdc.evpn.collisionsUnreachable', { clusters: collisionsUnreachable.join(', ') })}</Alert>
          )}
          {auditing && <LinearProgress sx={{ mb: 1 }} />}

          {!auditing && collisions.length === 0 ? (
            <Stack alignItems="center" sx={{ py: 3, opacity: 0.55, gap: 0.5 }}>
              <i className="ri-shield-check-line" style={{ fontSize: 28 }} />
              <Typography variant="body2">{t('vdc.evpn.collisionsNone')}</Typography>
            </Stack>
          ) : collisions.length > 0 && (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell align="right">{t('vdc.evpn.vni')}</TableCell>
                    <TableCell>{t('vdc.evpn.collisionRisk')}</TableCell>
                    <TableCell>{t('vdc.evpn.collisionHolders')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {collisions.map((c) => (
                    <TableRow key={c.vni} hover>
                      <TableCell align="right" sx={{ verticalAlign: 'top' }}>{c.vni}</TableCell>
                      <TableCell sx={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                        <Tooltip title={c.exposed ? t('vdc.evpn.collisionExposedHint') : t('vdc.evpn.collisionLatentHint')} arrow>
                          <Chip
                            size="small"
                            color={c.exposed ? 'error' : 'warning'}
                            variant="outlined"
                            label={c.exposed ? t('vdc.evpn.collisionExposed') : t('vdc.evpn.collisionLatent')}
                            sx={{ height: 20, fontSize: 11 }}
                          />
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <Stack spacing={0.5}>
                          {c.holders.map((h) => (
                            <Stack key={`${h.connectionId}/${h.zone}/${h.vnet ?? 'vrf'}`} direction="row" spacing={1} alignItems="center">
                              <i className="ri-server-line" style={{ opacity: 0.7 }} />
                              <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                                {h.connectionName} · {h.zone} · {h.vnet === null ? t('vdc.evpn.collisionVrf') : (h.alias ? `${h.alias} (${h.vnet})` : h.vnet)}
                                {h.vdcName ? ` · ${h.tenantName ?? ''} / ${h.vdcName}` : ` · ${t('vdc.evpn.collisionUnmanaged')}`}
                              </Typography>
                              {h.renumberable && (
                                <Button size="small" disabled={auditing} onClick={() => setConfirm({ kind: 'renumber', vni: c.vni, holder: h })}>
                                  {t('vdc.evpn.renumber')}
                                </Button>
                              )}
                            </Stack>
                          ))}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      {/* Member menu: resync, detach. */}
      <Menu open={!!memberMenu} anchorEl={memberMenu?.anchor ?? null} onClose={() => setMemberMenu(null)}>
        {memberMenu && [
          <MenuItem key="state" disabled sx={{ opacity: '1 !important' }}>
            <Typography variant="caption">{stateLabel(stateOf(memberMenu.zone, memberMenu.member))}</Typography>
          </MenuItem>,
          <MenuItem key="resync" onClick={() => resync(memberMenu.zone, memberMenu.member)}>
            <Stack direction="row" spacing={1} alignItems="center">
              <i className="ri-refresh-line" style={{ opacity: 0.7 }} />
              <span>{t('vdc.evpn.resync')}</span>
            </Stack>
          </MenuItem>,
          <MenuItem key="remove" onClick={() => { setConfirm({ kind: 'remove-member', zone: memberMenu.zone, member: memberMenu.member }); setMemberMenu(null) }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <i className="ri-close-line" style={{ opacity: 0.7 }} />
              <span>{t('vdc.evpn.removeCluster')}</span>
            </Stack>
          </MenuItem>,
        ]}
      </Menu>

      {/* Declare / edit / extend */}
      <Dialog open={!!dialog} onClose={() => !saving && setDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {dialog?.kind === 'edit' ? t('vdc.evpn.edit') : dialog?.kind === 'add-member' ? t('vdc.evpn.addClusterTitle', { name: dialog.zone.name }) : t('vdc.evpn.declare')}
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          {dialogError && <Alert severity="error" onClose={() => setDialogError('')}>{dialogError}</Alert>}

          {dialog?.kind !== 'edit' && (
            <Box>
              <Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
                <Typography variant="subtitle2" sx={{ flex: 1 }}>{t('vdc.evpn.clusters')}</Typography>
                {dialog?.kind === 'create' && candidates.length > 1 && (
                  <FormControlLabel
                    sx={{ mr: 0 }}
                    control={
                      <Checkbox
                        size="small"
                        checked={selected.length === candidates.length}
                        indeterminate={selected.length > 0 && selected.length < candidates.length}
                        onChange={toggleAll}
                      />
                    }
                    label={<Typography variant="body2">{t('common.all')}</Typography>}
                    labelPlacement="start"
                  />
                )}
              </Stack>
              <Stack spacing={1.5} sx={{ pt: 0.5 }}>{candidates.map(clusterRow)}</Stack>
              {discovering && <LinearProgress sx={{ mt: 1 }} />}
            </Box>
          )}

          {dialog?.kind === 'create' && adoptable.length > 0 && (
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="caption" color="text.secondary">{t('vdc.evpn.adoptExisting')}</Typography>
              {adoptable.map(z => (
                <Chip
                  key={z.zone}
                  size="small"
                  variant={form.zoneName === z.zone ? 'filled' : 'outlined'}
                  color="info"
                  icon={<i className="ri-share-line" style={{ fontSize: 14 }} />}
                  label={z.zone}
                  onClick={() => adopt(z)}
                />
              ))}
            </Stack>
          )}

          {dialog?.kind !== 'add-member' && (
            <>
              <TextField
                size="small" fullWidth label={t('vdc.evpn.name')} value={form.name}
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
              />
              <TextField
                size="small" fullWidth label={t('vdc.evpn.description')} value={form.description}
                onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
              />
              <TextField
                size="small" fullWidth label={t('vdc.evpn.zoneId')} value={form.zoneName}
                disabled={dialog?.kind === 'edit'}
                helperText={dialog?.kind === 'edit' ? undefined : t('vdc.evpn.zoneIdHint')}
                onChange={(e) => setForm(f => ({ ...f, zoneName: e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) }))}
              />
              <TextField
                size="small" fullWidth label={t('vdc.evpn.vrfVni')} value={form.vrfVxlan}
                disabled={dialog?.kind === 'edit'}
                helperText={dialog?.kind === 'edit' ? undefined : t('vdc.evpn.vrfVniHint')}
                onChange={(e) => setForm(f => ({ ...f, vrfVxlan: e.target.value.replace(/\D/g, '') }))}
              />
              <TextField
                size="small" fullWidth label={t('vdc.evpn.mtu')} value={form.mtu}
                disabled={dialog?.kind === 'edit'}
                placeholder={t('vdc.evpn.mtuDefault')}
                onChange={(e) => setForm(f => ({ ...f, mtu: e.target.value.replace(/\D/g, '') }))}
              />
              <Stack direction="row" spacing={1.5}>
                <TextField
                  size="small" fullWidth label={t('vdc.evpn.vniStart')} value={form.vniStart}
                  onChange={(e) => setForm(f => ({ ...f, vniStart: e.target.value.replace(/\D/g, '') }))}
                />
                <TextField
                  size="small" fullWidth label={t('vdc.evpn.vniEnd')} value={form.vniEnd}
                  onChange={(e) => setForm(f => ({ ...f, vniEnd: e.target.value.replace(/\D/g, '') }))}
                />
              </Stack>
              <Typography variant="caption" color="text.secondary">{t('vdc.evpn.vniRangeHint')}</Typography>
            </>
          )}

          {dialog?.kind !== 'edit' && selected.length > 0 && (
            <Alert severity="info">{t('vdc.evpn.applyNotice')}</Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)} disabled={saving}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            disabled={saving || discovering || formIncomplete || membersIncomplete}
            startIcon={saving ? <CircularProgress size={16} /> : undefined}
            onClick={() => void submit()}
          >
            {dialog?.kind === 'edit' ? t('common.save') : dialog?.kind === 'add-member' ? t('vdc.evpn.addCluster') : t('vdc.evpn.declare')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Confirmations */}
      <Dialog open={!!confirm} onClose={() => setConfirm(null)} maxWidth="xs" fullWidth>
        {confirm?.kind === 'delete' && (
          <>
            <DialogTitle>{t('vdc.evpn.deleteTitle')}</DialogTitle>
            <DialogContent>
              <Typography variant="body2">{t('vdc.evpn.deleteConfirm', { name: confirm.zone.name })}</Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirm(null)}>{t('common.cancel')}</Button>
              <Button color="error" variant="contained" onClick={() => remove(confirm.zone)}>{t('common.delete')}</Button>
            </DialogActions>
          </>
        )}
        {confirm?.kind === 'remove-member' && (
          <>
            <DialogTitle>{t('vdc.evpn.removeClusterTitle')}</DialogTitle>
            <DialogContent>
              <Typography variant="body2">
                {t(confirm.member.adopted ? 'vdc.evpn.removeClusterAdoptedConfirm' : 'vdc.evpn.removeClusterConfirm', { cluster: confirm.member.connectionName, zone: confirm.zone.zoneName })}
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirm(null)}>{t('common.cancel')}</Button>
              <Button color="error" variant="contained" onClick={() => removeMember(confirm.zone, confirm.member)}>{t('common.confirm')}</Button>
            </DialogActions>
          </>
        )}
        {confirm?.kind === 'renumber' && (
          <>
            <DialogTitle>{t('vdc.evpn.renumberTitle')}</DialogTitle>
            <DialogContent>
              <Typography variant="body2">
                {t('vdc.evpn.renumberConfirm', { network: confirm.holder.alias ?? confirm.holder.vnet ?? '', cluster: confirm.holder.connectionName, vni: confirm.vni })}
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirm(null)}>{t('common.cancel')}</Button>
              <Button color="warning" variant="contained" onClick={() => void renumber(confirm.holder)}>{t('vdc.evpn.renumber')}</Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </>
  )
}
