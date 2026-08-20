'use client'

// Provider-only management of storage policies (Task 15): named QoS profiles
// (IOPS/MBps caps) on a shared storage, scoped to a connection, that a vDC
// can later attach with its own quota. Rendered by VdcTab above the vDC
// list. One Card per connection so an operator managing several clusters
// sees each cluster's policies without leaving the page.

import { useCallback, useEffect, useState } from 'react'

import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Button,
  IconButton,
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

export default function StoragePoliciesSection({ connections }: Props) {
  const t = useTranslations()

  const [policies, setPolicies] = useState<Record<string, StoragePolicyDto[]>>({})
  const [storagesByConn, setStoragesByConn] = useState<Record<string, CandidateStorage[]>>({})
  const [dialog, setDialog] = useState<{ connectionId: string; policy: StoragePolicyDto | null } | null>(null)
  const [form, setForm] = useState<PolicyForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [dialogError, setDialogError] = useState('')
  const [sectionError, setSectionError] = useState('')

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
  }

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
                        return (
                          <TableRow key={p.id}>
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

      <Dialog open={!!dialog} onClose={closeDialog} maxWidth="sm" fullWidth>
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
      </Dialog>
    </Box>
  )
}
