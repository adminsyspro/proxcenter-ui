'use client'

// Provider-only management of storage policies (Task 15): named QoS profiles
// (IOPS/MBps caps) on a shared storage, scoped to a connection, that a vDC
// can later attach with its own quota. Rendered by VdcTab above the vDC
// list. One Card per connection so an operator managing several clusters
// sees each cluster's policies without leaving the page.

import { Fragment, useCallback, useEffect, useState } from 'react'

import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Button,
  IconButton,
  LinearProgress,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'

import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'

import { useTranslations } from 'next-intl'

interface StoragePolicyDto {
  id: string
  connectionId: string
  name: string
  description: string | null
  storageId: string
  iopsRd: number | null
  iopsWr: number | null
  mbpsRd: number | null
  mbpsWr: number | null
  vdcCount?: number
}

interface CandidateStorage {
  id: string
  type: string
}

interface Props {
  connections: Array<{ id: string; name: string }>
}

interface PolicyForm {
  name: string
  description: string
  storageId: string
  iopsRd: string
  iopsWr: string
  mbpsRd: string
  mbpsWr: string
}

const emptyForm: PolicyForm = {
  name: '',
  description: '',
  storageId: '',
  iopsRd: '',
  iopsWr: '',
  mbpsRd: '',
  mbpsWr: '',
}

interface ApplyLogLine {
  text: string
  isError: boolean
  vmid?: number
  vmName?: string
  vmStatus?: string
  disks?: string[]
}

interface ApplyProgressState {
  total: number
  current: number
  updated: number
  unchanged: number
  errors: number
  log: ApplyLogLine[]
  done: boolean
}

interface QosCaps {
  iopsRd: number | null
  iopsWr: number | null
  mbpsRd: number | null
  mbpsWr: number | null
}

interface PolicyDiskDto {
  key: string
  iopsRd: number | null
  iopsWr: number | null
  mbpsRd: number | null
  mbpsWr: number | null
  inSync: boolean
}

interface PolicyVmDto {
  vmid: number
  name: string
  node: string
  vmstatus: string
  error?: boolean
  disks: PolicyDiskDto[]
}

interface PolicyDisksState {
  loading: boolean
  vms: PolicyVmDto[]
}

/** "scsi1 · 100/100 · 10/10M": disk key, then IOPS read/write, then MBps
 *  read/write (single trailing "M" for the pair). A missing cap renders as
 *  "-" (unlimited on that side). */
function diskCapsLabel(disk: PolicyDiskDto): string {
  const iops = `${disk.iopsRd ?? '-'}/${disk.iopsWr ?? '-'}`
  const mbps = `${disk.mbpsRd ?? '-'}/${disk.mbpsWr ?? '-'}`
  return `${disk.key} · ${iops} · ${mbps}M`
}

/** Whether the just-saved caps differ from the policy's pre-edit values:
 *  gates the bulk re-stamp phase below (only worth running when a cap
 *  actually moved, never on a plain name/description edit). */
function qosCapsChanged(policy: StoragePolicyDto, next: QosCaps): boolean {
  return (
    policy.iopsRd !== next.iopsRd ||
    policy.iopsWr !== next.iopsWr ||
    policy.mbpsRd !== next.mbpsRd ||
    policy.mbpsWr !== next.mbpsWr
  )
}

export default function StoragePoliciesSection({ connections }: Props) {
  const t = useTranslations()

  const [policies, setPolicies] = useState<Record<string, StoragePolicyDto[]>>({})
  const [storagesByConn, setStoragesByConn] = useState<Record<string, CandidateStorage[]>>({})
  const [dialog, setDialog] = useState<{ connectionId: string; policy: StoragePolicyDto | null } | null>(null)
  const [form, setForm] = useState<PolicyForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [dialogError, setDialogError] = useState('')
  const [sectionError, setSectionError] = useState('')
  const [applyState, setApplyState] = useState<ApplyProgressState | null>(null)
  const [expandedPolicies, setExpandedPolicies] = useState<Set<string>>(new Set())
  const [policyDisks, setPolicyDisks] = useState<Record<string, PolicyDisksState>>({})

  const loadPolicyDisks = useCallback(async (connectionId: string, policyId: string) => {
    setPolicyDisks((prev) => ({ ...prev, [policyId]: { loading: true, vms: prev[policyId]?.vms ?? [] } }))
    try {
      const res = await fetch(
        `/api/v1/admin/connections/${encodeURIComponent(connectionId)}/storage-policies/${encodeURIComponent(policyId)}/disks`,
      )
      const json = res.ok ? await res.json() : null
      const vms = Array.isArray(json?.data?.vms) ? json.data.vms : []
      setPolicyDisks((prev) => ({ ...prev, [policyId]: { loading: false, vms } }))
    } catch {
      setPolicyDisks((prev) => ({ ...prev, [policyId]: { loading: false, vms: [] } }))
    }
  }, [])

  // Expand toggle for a policy row: fetches the governed disks on the FIRST
  // expansion only (a cache hit on re-expand does not re-fetch); the cache
  // entry is cleared once a bulk apply run for that policy completes (see
  // runApply's "done" branch below) so re-expanding afterwards picks up the
  // freshly re-stamped disks instead of the stale pre-apply drift state.
  const toggleExpand = (connectionId: string, policyId: string) => {
    setExpandedPolicies((prev) => {
      const next = new Set(prev)
      if (next.has(policyId)) next.delete(policyId)
      else next.add(policyId)
      return next
    })
    if (!policyDisks[policyId]) {
      void loadPolicyDisks(connectionId, policyId)
    }
  }

  const reloadPolicies = useCallback(async (connectionId: string) => {
    try {
      const res = await fetch(`/api/v1/admin/connections/${encodeURIComponent(connectionId)}/storage-policies`)
      if (!res.ok) return
      const json = await res.json()
      setPolicies((prev) => ({ ...prev, [connectionId]: Array.isArray(json.data) ? json.data : [] }))
    } catch {
      // Non-critical: this connection's card just stays empty
    }
  }, [])

  const loadStorages = useCallback(async (connectionId: string) => {
    try {
      const res = await fetch(`/api/v1/admin/connections/${encodeURIComponent(connectionId)}/available-resources`)
      if (!res.ok) return
      const json = await res.json()
      const raw = Array.isArray(json?.data?.storages) ? json.data.storages : []
      setStoragesByConn((prev) => ({
        ...prev,
        [connectionId]: raw.map((s: any) => ({ id: s.id, type: s.type })),
      }))
    } catch {
      // Non-critical: storage picker just stays empty until retried
    }
  }, [])

  // Load once per connection: policies for the table, storages for the
  // "Chip type" column and the dialog's storage picker.
  useEffect(() => {
    for (const conn of connections) {
      void reloadPolicies(conn.id)
      void loadStorages(conn.id)
    }
    // Connections rarely change identity; re-run only when the id set does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connections.map((c) => c.id).join(','), reloadPolicies, loadStorages])

  const openCreate = (connectionId: string) => {
    setDialog({ connectionId, policy: null })
    setForm(emptyForm)
    setDialogError('')
    void loadStorages(connectionId)
  }

  const openEdit = (connectionId: string, policy: StoragePolicyDto) => {
    setDialog({ connectionId, policy })
    setForm({
      name: policy.name,
      description: policy.description || '',
      storageId: policy.storageId,
      iopsRd: policy.iopsRd != null ? String(policy.iopsRd) : '',
      iopsWr: policy.iopsWr != null ? String(policy.iopsWr) : '',
      mbpsRd: policy.mbpsRd != null ? String(policy.mbpsRd) : '',
      mbpsWr: policy.mbpsWr != null ? String(policy.mbpsWr) : '',
    })
    setDialogError('')
    void loadStorages(connectionId)
  }

  const closeDialog = () => {
    setDialog(null)
    setDialogError('')
    setApplyState(null)
  }

  // Live-drives the apply-progress phase (Task 16): reads the streaming
  // NDJSON body line by line and folds each event into applyState. Only
  // reached from handleSave when an edit actually moved one of the 4 QoS
  // caps; the dialog stays open, showing this phase instead of the form,
  // until the "done" event lands.
  const runApply = useCallback(async (connectionId: string, policyId: string) => {
    setApplyState({ total: 0, current: 0, updated: 0, unchanged: 0, errors: 0, log: [], done: false })

    const fail = (message: string) => {
      setApplyState((prev) => ({
        ...(prev ?? { total: 0, current: 0, updated: 0, unchanged: 0, errors: 0, log: [] }),
        done: true,
        log: [...(prev?.log ?? []), { text: message, isError: true }],
      }))
    }

    try {
      const res = await fetch(
        `/api/v1/admin/connections/${encodeURIComponent(connectionId)}/storage-policies/${encodeURIComponent(policyId)}/apply`,
        { method: 'POST' },
      )
      if (!res.ok || !res.body) {
        fail(t('vdc.storagePolicyApplyError'))
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          let evt: any
          try {
            evt = JSON.parse(line)
          } catch {
            continue
          }

          if (evt.type === 'start') {
            setApplyState((prev) => (prev ? { ...prev, total: evt.total } : prev))
          } else if (evt.type === 'vm') {
            const disksText = Array.isArray(evt.disks) && evt.disks.length > 0 ? evt.disks.join(', ') : evt.status
            const text = `${evt.status === 'error' ? evt.message : disksText}`
            setApplyState((prev) => (
              prev ? {
                ...prev,
                current: evt.index + 1,
                log: [...prev.log, {
                  text,
                  isError: evt.status === 'error',
                  vmid: evt.vmid,
                  vmName: evt.name,
                  vmStatus: evt.vmstatus,
                  disks: Array.isArray(evt.disks) ? evt.disks : [],
                }],
              } : prev
            ))
          } else if (evt.type === 'done') {
            setApplyState((prev) => (
              prev ? { ...prev, updated: evt.updated, unchanged: evt.unchanged, errors: evt.errors, done: true } : prev
            ))
            // Drop the cached disk list for this policy: the apply run just
            // re-stamped its disks, so a re-expand of the row should fetch
            // fresh drift state instead of showing what was true before.
            setPolicyDisks((prev) => {
              const next = { ...prev }
              delete next[policyId]
              return next
            })
            await reloadPolicies(connectionId)
          }
        }
      }
    } catch (err: any) {
      fail(err?.message || t('vdc.storagePolicyApplyError'))
    }
  }, [reloadPolicies, t])

  const handleSave = async () => {
    if (!dialog) return
    setSaving(true)
    setDialogError('')

    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        storageId: form.storageId,
        iopsRd: form.iopsRd ? Number.parseInt(form.iopsRd, 10) : null,
        iopsWr: form.iopsWr ? Number.parseInt(form.iopsWr, 10) : null,
        mbpsRd: form.mbpsRd ? Number.parseInt(form.mbpsRd, 10) : null,
        mbpsWr: form.mbpsWr ? Number.parseInt(form.mbpsWr, 10) : null,
      }

      const base = `/api/v1/admin/connections/${encodeURIComponent(dialog.connectionId)}/storage-policies`
      const url = dialog.policy ? `${base}/${encodeURIComponent(dialog.policy.id)}` : base

      const res = await fetch(url, {
        method: dialog.policy ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `HTTP ${res.status}`)
      }

      const existingPolicy = dialog.policy
      if (existingPolicy && qosCapsChanged(existingPolicy, body)) {
        await runApply(dialog.connectionId, existingPolicy.id)
        return
      }

      await reloadPolicies(dialog.connectionId)
      setDialog(null)
    } catch (err: any) {
      setDialogError(err?.message || String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (connectionId: string, policy: StoragePolicyDto) => {
    if (policy.vdcCount) return
    setSectionError('')
    try {
      const res = await fetch(
        `/api/v1/admin/connections/${encodeURIComponent(connectionId)}/storage-policies/${encodeURIComponent(policy.id)}`,
        { method: 'DELETE' },
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      await reloadPolicies(connectionId)
    } catch (err: any) {
      setSectionError(err?.message || String(err))
    }
  }

  const dialogStorages = dialog ? storagesByConn[dialog.connectionId] || [] : []

  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="h6">{t('vdc.storagePoliciesTitle')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('vdc.storagePoliciesHint')}
      </Typography>

      {sectionError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setSectionError('')}>
          {sectionError}
        </Alert>
      )}

      <Stack spacing={2}>
        {connections.map((conn) => {
          const list = policies[conn.id] || []
          const storageType = (storageId: string) => storagesByConn[conn.id]?.find((s) => s.id === storageId)?.type

          return (
            <Card key={conn.id} variant="outlined">
              <CardContent>
                <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <i className="ri-server-line" style={{ fontSize: 18, opacity: 0.8 }} />
                    <Typography variant="subtitle2">{conn.name}</Typography>
                  </Box>
                  <Tooltip title={t('vdc.storagePolicyAdd')} arrow>
                    <IconButton size="small" aria-label={t('vdc.storagePolicyAdd')} onClick={() => openCreate(conn.id)}>
                      <i className="ri-add-line" />
                    </IconButton>
                  </Tooltip>
                </Stack>

                {list.length > 0 && (
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell padding="checkbox" />
                        <TableCell>{t('vdc.storagePolicyName')}</TableCell>
                        <TableCell>{t('vdc.storagePolicyStorage')}</TableCell>
                        <TableCell>{t('vdc.storagePolicyIopsRd')}</TableCell>
                        <TableCell>{t('vdc.storagePolicyIopsWr')}</TableCell>
                        <TableCell>{t('vdc.storagePolicyMbpsRd')}</TableCell>
                        <TableCell>{t('vdc.storagePolicyMbpsWr')}</TableCell>
                        <TableCell>{t('vdc.storagePolicyVdcCount')}</TableCell>
                        <TableCell align="right">{t('common.actions')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {list.map((p) => {
                        const inUse = (p.vdcCount ?? 0) > 0
                        const type = storageType(p.storageId)
                        const isExpanded = expandedPolicies.has(p.id)
                        const disksState = policyDisks[p.id]
                        return (
                          <Fragment key={p.id}>
                            <TableRow>
                              <TableCell padding="checkbox">
                                <IconButton
                                  size="small"
                                  onClick={() => toggleExpand(conn.id, p.id)}
                                  aria-label={isExpanded ? `Collapse ${p.name}` : `Expand ${p.name}`}
                                >
                                  <i className={isExpanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} style={{ fontSize: 18 }} />
                                </IconButton>
                              </TableCell>
                              <TableCell>
                                <Stack direction="row" alignItems="center" spacing={0.75}>
                                  <i className="ri-database-2-line" style={{ fontSize: 16, opacity: 0.7 }} />
                                  <span>{p.name}</span>
                                </Stack>
                              </TableCell>
                              <TableCell>
                                <Stack direction="row" alignItems="center" spacing={0.75}>
                                  <Typography variant="body2">{p.storageId}</Typography>
                                  {type && <Chip size="small" label={type} sx={{ height: 18, fontSize: 10 }} />}
                                </Stack>
                              </TableCell>
                              <TableCell>{p.iopsRd ?? t('vdc.vdcPolicyUnlimited')}</TableCell>
                              <TableCell>{p.iopsWr ?? t('vdc.vdcPolicyUnlimited')}</TableCell>
                              <TableCell>{p.mbpsRd ?? t('vdc.vdcPolicyUnlimited')}</TableCell>
                              <TableCell>{p.mbpsWr ?? t('vdc.vdcPolicyUnlimited')}</TableCell>
                              <TableCell>{p.vdcCount ?? 0}</TableCell>
                              <TableCell align="right">
                                <IconButton size="small" onClick={() => openEdit(conn.id, p)} aria-label={t('common.edit')}>
                                  <i className="ri-pencil-line" />
                                </IconButton>
                                <Tooltip title={inUse ? t('vdc.storagePolicyInUse', { count: p.vdcCount }) : ''} arrow>
                                  <span>
                                    <IconButton
                                      size="small"
                                      color="error"
                                      disabled={inUse}
                                      onClick={() => handleDelete(conn.id, p)}
                                      aria-label={t('common.delete')}
                                    >
                                      <i className="ri-delete-bin-line" />
                                    </IconButton>
                                  </span>
                                </Tooltip>
                              </TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell colSpan={9} sx={{ py: 0, borderBottom: isExpanded ? undefined : 'none' }}>
                                <Collapse in={isExpanded} unmountOnExit>
                                  <Box sx={{ py: 1.5, px: 2 }}>
                                    {disksState?.loading ? (
                                      <Typography variant="caption" color="text.secondary">{t('common.loading')}</Typography>
                                    ) : !disksState || disksState.vms.length === 0 ? (
                                      <Typography variant="caption" color="text.secondary">{t('vdc.storagePolicyNoDisks')}</Typography>
                                    ) : (
                                      <Stack spacing={1}>
                                        {disksState.vms.map((vm) => (
                                          <Stack
                                            key={vm.vmid}
                                            direction="row"
                                            alignItems="center"
                                            spacing={1.5}
                                          >
                                            <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 220, flexShrink: 0 }}>
                                              <StatusIcon type="vm" vmType="qemu" status={vm.vmstatus} size={15} />
                                              <Typography variant="body2" noWrap>{`${vm.name} (${vm.vmid})`}</Typography>
                                              <Typography variant="caption" color="text.secondary" noWrap>{vm.node}</Typography>
                                            </Stack>
                                            {vm.error ? (
                                              <Typography variant="caption" color="error" sx={{ alignSelf: 'center' }}>
                                                {t('common.error')}
                                              </Typography>
                                            ) : (
                                              <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                                                {vm.disks.map((disk) => {
                                                  const chip = (
                                                    <Chip
                                                      size="small"
                                                      variant="outlined"
                                                      color={disk.inSync === false ? 'warning' : 'default'}
                                                      icon={<i className="ri-hard-drive-2-line" />}
                                                      label={diskCapsLabel(disk)}
                                                    />
                                                  )
                                                  return disk.inSync === false ? (
                                                    <Tooltip key={disk.key} title={t('vdc.storagePolicyDiskDrift')} arrow>
                                                      {chip}
                                                    </Tooltip>
                                                  ) : (
                                                    <Box key={disk.key}>{chip}</Box>
                                                  )
                                                })}
                                              </Stack>
                                            )}
                                          </Stack>
                                        ))}
                                      </Stack>
                                    )}
                                  </Box>
                                </Collapse>
                              </TableCell>
                            </TableRow>
                          </Fragment>
                        )
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )
        })}
      </Stack>

      <Dialog open={!!dialog} onClose={applyState ? undefined : closeDialog} maxWidth="sm" fullWidth>
        {applyState ? (
          <>
            <DialogTitle>{t('vdc.storagePolicyApplyTitle')}</DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '20px !important' }}>
              <LinearProgress
                variant="determinate"
                value={applyState.total > 0 ? (applyState.current / applyState.total) * 100 : 100}
              />
              <Typography variant="caption" color="text.secondary">
                {t('vdc.storagePolicyApplyRunning', { current: applyState.current, total: applyState.total })}
              </Typography>

              <Box
                sx={{
                  maxHeight: 160,
                  overflowY: 'auto',
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                  p: 1,
                }}
              >
                {applyState.log.map((line, i) => (
                  <Stack key={i} direction="row" alignItems="center" spacing={1} sx={{ py: 0.25 }}>
                    {line.vmName ? (
                      <StatusIcon type="vm" vmType="qemu" status={line.vmStatus} size={15} />
                    ) : (
                      <i className="ri-error-warning-line" style={{ fontSize: 15, color: 'var(--mui-palette-error-main)' }} />
                    )}
                    {line.vmName ? (
                      <Typography variant="caption" component="span" color={line.isError ? 'error' : 'text.primary'}>
                        {`${line.vmName} (${line.vmid})`}
                      </Typography>
                    ) : null}
                    {line.disks && line.disks.length > 0 ? (
                      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ minWidth: 0 }}>
                        <i className="ri-hard-drive-2-line" style={{ fontSize: 13, opacity: 0.6 }} />
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {line.disks.join(', ')}
                        </Typography>
                      </Stack>
                    ) : (
                      <Typography variant="caption" color={line.isError ? 'error' : 'text.secondary'} noWrap>
                        {line.text}
                      </Typography>
                    )}
                  </Stack>
                ))}
              </Box>

              {applyState.done && (
                <Alert severity={applyState.errors > 0 ? 'warning' : 'success'}>
                  {t('vdc.storagePolicyApplyDone', {
                    updated: applyState.updated,
                    unchanged: applyState.unchanged,
                    errors: applyState.errors,
                  })}
                </Alert>
              )}
            </DialogContent>
            <DialogActions>
              <Button disabled={!applyState.done} onClick={closeDialog}>
                {t('common.close')}
              </Button>
            </DialogActions>
          </>
        ) : (
        <>
        <DialogTitle>{dialog?.policy ? t('common.edit') : t('vdc.storagePolicyAdd')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '20px !important' }}>
          {dialogError && <Alert severity="error">{dialogError}</Alert>}

          <TextField
            label={t('vdc.storagePolicyName')}
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            fullWidth
          />

          <TextField
            select
            required
            label={t('vdc.storagePolicyStorage')}
            value={form.storageId}
            onChange={(e) => setForm((f) => ({ ...f, storageId: e.target.value }))}
            disabled={!!dialog?.policy && (dialog.policy.vdcCount ?? 0) > 0}
            helperText={
              dialog?.policy && (dialog.policy.vdcCount ?? 0) > 0
                ? t('vdc.storagePolicyInUse', { count: dialog.policy.vdcCount })
                : undefined
            }
            fullWidth
          >
            {dialogStorages.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Typography variant="body2">{s.id}</Typography>
                  <Chip size="small" label={s.type} sx={{ height: 18, fontSize: 10 }} />
                </Stack>
              </MenuItem>
            ))}
          </TextField>

          <Stack direction="row" spacing={2}>
            <TextField
              type="number"
              label={t('vdc.storagePolicyIopsRd')}
              value={form.iopsRd}
              onChange={(e) => setForm((f) => ({ ...f, iopsRd: e.target.value }))}
              slotProps={{ htmlInput: { min: 1 } }}
              helperText={t('vdc.vdcPolicyUnlimited')}
              fullWidth
            />
            <TextField
              type="number"
              label={t('vdc.storagePolicyIopsWr')}
              value={form.iopsWr}
              onChange={(e) => setForm((f) => ({ ...f, iopsWr: e.target.value }))}
              slotProps={{ htmlInput: { min: 1 } }}
              helperText={t('vdc.vdcPolicyUnlimited')}
              fullWidth
            />
          </Stack>

          <Stack direction="row" spacing={2}>
            <TextField
              type="number"
              label={t('vdc.storagePolicyMbpsRd')}
              value={form.mbpsRd}
              onChange={(e) => setForm((f) => ({ ...f, mbpsRd: e.target.value }))}
              slotProps={{ htmlInput: { min: 1 } }}
              helperText={t('vdc.vdcPolicyUnlimited')}
              fullWidth
            />
            <TextField
              type="number"
              label={t('vdc.storagePolicyMbpsWr')}
              value={form.mbpsWr}
              onChange={(e) => setForm((f) => ({ ...f, mbpsWr: e.target.value }))}
              slotProps={{ htmlInput: { min: 1 } }}
              helperText={t('vdc.vdcPolicyUnlimited')}
              fullWidth
            />
          </Stack>

          <TextField
            label={t('vdc.storagePolicyDescription')}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            fullWidth
            multiline
            rows={2}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            disabled={saving || !form.name.trim() || !form.storageId}
            onClick={handleSave}
          >
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </DialogActions>
        </>
        )}
      </Dialog>
    </Box>
  )
}
