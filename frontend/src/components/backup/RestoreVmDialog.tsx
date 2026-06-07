'use client'

// Standalone restore dialog used wherever a VM backup is listed (currently
// VmDetailTabs > Backup tab). PbsServerPanel ships its own inlined version
// for the PBS storage browser flow — this component handles the
// "I'm looking at a VM and want to restore one of its backups" flow.
//
// Backend contract: POST /api/v1/connections/{id}/nodes/{node}/restore
// (qmrestore for qemu, vzrestore for lxc). The post-restore IPAM sync is
// scheduled server-side via after(); the dialog just kicks off the task
// and returns the UPID for the caller to track.

import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog, DialogActions, DialogContent,
  FormControl, FormControlLabel, InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'

import AppDialogTitle from '@/components/ui/AppDialogTitle'
import { useTenant } from '@/contexts/TenantContext'
import { formatDateTime } from '@/lib/i18n/date'

interface BackupRef {
  /** Full PVE volid, e.g. `pbs:backup/vm/100/2025-04-01T10:00:00Z`.
   *  Optional — when absent, pass the PBS-side coordinates instead and
   *  the backend will resolve the matching PVE storage to compose the
   *  volid. The /api/v1/guests/{vmid}/backups endpoint queries PBS
   *  directly so it never produces a volid; that's the common case. */
  volid?: string
  /** PBS-side coordinates for the resolution path. */
  pbsId?: string
  datastore?: string
  namespace?: string
  backupPath?: string
  vmid?: number
  format?: string
  size?: number | string
  /** Raw backup epoch (seconds). Preferred over backupTimeFormatted so the
   *  time renders in the viewer's timezone (real local time), not the server
   *  container's UTC clock. See discussion #379. */
  backupTime?: number
  backupTimeFormatted?: string
  /** Friendly VM name from the snapshot's `comment` field (PBS) — used
   *  to label the dialog header instead of leaking the raw backupPath. */
  vmName?: string
}

interface Props {
  open: boolean
  onClose: () => void
  /** PVE connection holding the target node (where the restore runs). When
   *  null/undefined the dialog renders a connection picker — used by the
   *  cross-PVE /operations/backups view where the listed backups don't
   *  carry their target cluster context. */
  connectionId?: string | null
  /** Node where the restore runs. Same nullable semantics as connectionId. */
  node?: string | null
  /** "qemu" or "lxc" — drives endpoint choice + which fields show. */
  type: 'qemu' | 'lxc'
  backup: BackupRef
  /** Original VMID — pre-fills the target field but the user can change it. */
  sourceVmid: number
  /** Optional callback fired when the restore POST returns a UPID. */
  onStarted?: (upid: string) => void
}

interface StorageOption { storage: string; type?: string }

export default function RestoreVmDialog({
  open, onClose, connectionId: connectionIdProp, node: nodeProp, type, backup, sourceVmid, onStarted,
}: Props) {
  const t = useTranslations()
  const locale = useLocale()
  // Tenant mode (vDC) hides every infra picker — VMID, target cluster, node,
  // storage, MAC/start/live/bandwidth flags. The vDC abstraction owns those
  // decisions; a tenant just renames the restored VM. Provider / 'default'
  // tenant keeps the full surface so the operator can pick the target.
  const { currentTenant, loading: tenantLoading } = useTenant()
  const isVdcTenant = !tenantLoading && !!currentTenant && currentTenant.id !== 'default' && currentTenant.operatingModel !== 'msp'

  // When the caller provides connectionId/node, lock them; otherwise we
  // render pickers and the user picks. Internal state holds the effective
  // values used by the load + submit paths.
  const callerLocksConn = !!connectionIdProp
  const callerLocksNode = !!nodeProp
  const [pickedConnectionId, setPickedConnectionId] = useState<string>('')
  const [pickedNode, setPickedNode] = useState<string>('')
  const connectionId = callerLocksConn ? connectionIdProp! : pickedConnectionId
  const node = callerLocksNode ? nodeProp! : pickedNode

  const [pveConnections, setPveConnections] = useState<Array<{ id: string; name: string }>>([])
  const [nodes, setNodes] = useState<Array<{ node: string; status?: string }>>([])

  const [vmid, setVmid] = useState<string>(String(sourceVmid))
  const [storage, setStorage] = useState('')
  const [storages, setStorages] = useState<StorageOption[]>([])
  const [usedVmIds, setUsedVmIds] = useState<Set<number>>(new Set())
  const [unique, setUnique] = useState(false)
  const [start, setStart] = useState(false)
  const [live, setLive] = useState(false)
  const [bwlimit, setBwlimit] = useState('')
  const [overrideName, setOverrideName] = useState(false)
  const [name, setName] = useState('')

  // Tenant-mode-only: pick between overwriting the source VM or spawning
  // a brand-new VM with a fresh VMID. Defaults to overwrite (the more
  // common "rollback" flow); `awaitingConfirm` gates the destructive
  // overwrite behind a second click.
  const [restoreAsNew, setRestoreAsNew] = useState(false)
  const [awaitingConfirm, setAwaitingConfirm] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset when (re)opened. In tenant mode, force overrideName=true so the
  // single tenant-facing field (the new VM name) is always visible.
  useEffect(() => {
    if (!open) return
    setVmid(String(sourceVmid))
    setStorage('')
    setUnique(false)
    setStart(false)
    setLive(false)
    setBwlimit('')
    setOverrideName(isVdcTenant)
    setName('')
    setError(null)
    setRestoreAsNew(false)
    setAwaitingConfirm(false)
    if (!callerLocksConn) setPickedConnectionId('')
    if (!callerLocksNode) setPickedNode('')
  }, [open, sourceVmid, callerLocksConn, callerLocksNode, isVdcTenant])

  // Reset the destructive-confirm guard whenever the tenant flips the
  // mode toggle so a "yes, overwrite" intent can't carry over to a
  // "create new" submission.
  useEffect(() => { setAwaitingConfirm(false) }, [restoreAsNew])

  // Tenant mode + cross-PVE caller (no locked connection) → auto-resolve
  // the target from the tenant's first active vDC. This keeps the simple-
  // mode UI (just a Name field) usable from /operations/backups even when
  // the cluster/node weren't passed in.
  useEffect(() => {
    if (!open || !isVdcTenant) return
    if (callerLocksConn && callerLocksNode) return
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/api/v1/vdcs', { cache: 'no-store' })
        if (cancelled) return
        if (r.ok) {
          const j = await r.json()
          const list: any[] = Array.isArray(j?.data) ? j.data : []
          const first = list.find((v) => v.connectionId)
          if (first) {
            if (!callerLocksConn) setPickedConnectionId(first.connectionId)
            if (!callerLocksNode && Array.isArray(first.nodes) && first.nodes.length > 0) {
              setPickedNode(first.nodes[0])
            }
          }
        }
      } catch { /* ignore — falls through to the normal pickers, which we hide anyway */ }
    })()
    return () => { cancelled = true }
  }, [open, isVdcTenant, callerLocksConn, callerLocksNode])

  // Load PVE connections list when the user needs to pick one.
  useEffect(() => {
    if (!open || callerLocksConn) return
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/api/v1/connections?type=pve', { cache: 'no-store' })
        if (cancelled) return
        if (r.ok) {
          const j = await r.json()
          setPveConnections(Array.isArray(j?.data) ? j.data : [])
        }
      } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  }, [open, callerLocksConn])

  // Load nodes when a connection is known and the caller didn't lock the node.
  useEffect(() => {
    if (!open || callerLocksNode || !connectionId) return
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/nodes`, { cache: 'no-store' })
        if (cancelled) return
        if (r.ok) {
          const j = await r.json()
          const list = Array.isArray(j) ? j : (j?.data || [])
          setNodes(list.filter((n: any) => n.status === 'online'))
        }
      } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  }, [open, callerLocksNode, connectionId])

  // Load target storages + used VMIDs when (connectionId, node) become known.
  useEffect(() => {
    if (!open || !connectionId || !node) return
    let cancelled = false
    ;(async () => {
      try {
        const contentType = type === 'lxc' ? 'rootdir' : 'images'
        const r = await fetch(
          `/api/v1/connections/${encodeURIComponent(connectionId)}/nodes/${encodeURIComponent(node)}/storages?content=${contentType}`,
          { cache: 'no-store' },
        )
        if (cancelled) return
        if (r.ok) {
          const j = await r.json()
          setStorages(Array.isArray(j?.data) ? j.data : [])
        }
      } catch { /* ignore */ }
      try {
        const r = await fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/resources`, { cache: 'no-store' })
        if (cancelled) return
        if (r.ok) {
          const j = await r.json()
          const ids = new Set<number>(
            (Array.isArray(j?.data) ? j.data : [])
              .map((x: any) => Number(x?.vmid))
              .filter((n: number) => Number.isFinite(n)),
          )
          setUsedVmIds(ids)
        }
      } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  }, [open, connectionId, node, type])

  // Auto-default unique=1 when the target VMID is already taken (clone-like
  // restore). This keeps the IPAM safe — same MAC across two live VMs would
  // collide on (subnet, mac) UNIQUE.
  const targetVmidNumber = Number.parseInt(vmid)
  const targetExists = Number.isFinite(targetVmidNumber) && usedVmIds.has(targetVmidNumber)
  useEffect(() => {
    if (targetExists && !unique) setUnique(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetExists])

  const vmidValid = useMemo(() => {
    if (!Number.isFinite(targetVmidNumber)) return false
    if (targetVmidNumber < 100 || targetVmidNumber > 999999999) return false
    // If the target exists and the user hasn't enabled unique, we'll
    // overwrite the running VM — flag it as a soft warning, not a block.
    return true
  }, [targetVmidNumber])

  // Tenant: vmid is derived (sourceVmid for overwrite, /cluster/nextid
  // for new VM) so we don't gate on `vmid` being typed in. Provider:
  // unchanged, the field is required.
  const canSubmit = !submitting && !!connectionId && !!node && (
    isVdcTenant ? true : (!!vmid && vmidValid)
  )

  const handleSubmit = async () => {
    if (!canSubmit) return

    // Tenant mode: overwrite is destructive — require a second click
    // confirming the intent. The first click flips `awaitingConfirm`
    // and surfaces a warning Alert; the second proceeds.
    if (isVdcTenant && !restoreAsNew && !awaitingConfirm) {
      setAwaitingConfirm(true)
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      // Resolve the target VMID. Tenant + restoreAsNew → /cluster/nextid.
      // Tenant + overwrite → reuse source. Provider → use the typed value.
      let effectiveVmid = targetVmidNumber
      if (isVdcTenant) {
        if (restoreAsNew) {
          try {
            const r = await fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/cluster/nextid`, { cache: 'no-store' })
            const j = await r.json()
            if (!r.ok) {
              setError(j?.error || `nextid HTTP ${r.status}`)
              setSubmitting(false)
              return
            }
            const candidate = Number(j?.data ?? j?.vmid ?? j)
            if (!Number.isFinite(candidate)) {
              setError('Could not allocate a fresh VMID')
              setSubmitting(false)
              return
            }
            effectiveVmid = candidate
          } catch (e: any) {
            setError(e?.message || 'Failed to allocate VMID')
            setSubmitting(false)
            return
          }
        } else {
          effectiveVmid = sourceVmid
        }
      }

      const body: Record<string, any> = {
        vmid: effectiveVmid,
        type,
      }
      // Overwrite branch only — `force=1` lets PVE replace the existing
      // VMID. New-VM branch never sets it (the VMID is fresh).
      if (isVdcTenant && !restoreAsNew) {
        body.force = true
      }
      // Tenant + new VM → ensure unique MACs to avoid an L2 collision
      // with the still-running source.
      if (isVdcTenant && restoreAsNew) {
        body.unique = true
      }
      // Caller provided a fully-qualified PVE volid → use it. Otherwise
      // hand the PBS-side coordinates to the backend so it resolves the
      // PVE storage that maps onto this datastore + namespace.
      if (backup.volid) {
        body.archive = backup.volid
      } else if (backup.pbsId && backup.datastore && backup.backupPath) {
        body.pbsBackup = {
          pbsId: backup.pbsId,
          datastore: backup.datastore,
          namespace: backup.namespace || '',
          backupPath: backup.backupPath,
        }
      } else {
        setError('Backup reference incomplete — missing volid or PBS coordinates')
        setSubmitting(false)
        return
      }
      if (storage) body.storage = storage
      if (bwlimit) body.bwlimit = Number.parseInt(bwlimit)
      if (unique) body.unique = true
      if (start) body.start = true
      if (live && type === 'qemu') body.live = true
      // Tenant overwrite path keeps the source name — don't forward
      // the (now hidden) name input. New-VM and provider-override paths
      // honour whatever the user typed.
      const wantName =
        (isVdcTenant && restoreAsNew) || (!isVdcTenant && overrideName)
      if (wantName && name) body.name = name

      const r = await fetch(
        `/api/v1/connections/${encodeURIComponent(connectionId)}/nodes/${encodeURIComponent(node)}/restore`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(j?.error || `HTTP ${r.status}`)
        return
      }
      if (typeof j?.data === 'string') onStarted?.(j.data)
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Restore failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth="sm" fullWidth>
      <AppDialogTitle onClose={onClose}>
        {type === 'lxc' ? t('inventory.pbsRestoreCt') : t('inventory.pbsRestoreVm')}
      </AppDialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          <Alert severity="info" variant="outlined" sx={{ fontSize: '0.8rem' }} icon={<i className="ri-information-line" style={{ fontSize: 16 }} />}>
            {(() => {
              const label = type === 'lxc' ? 'CT' : 'VM'
              const head = backup.vmName
                ? `${label} ${backup.vmName} (${sourceVmid})`
                : `${label} ${sourceVmid}`
              const when = backup.backupTime
                ? formatDateTime(backup.backupTime * 1000, locale)
                : backup.backupTimeFormatted
              return when
                ? `${head} · ${when}`
                : head
            })()}
          </Alert>

          {/* Target pickers + every infra-level field are hidden in tenant
              (vDC) mode. The vDC abstraction owns target cluster/node,
              VMID assignment, storage selection, and the MAC/start/live
              flags — exposing them would break the cloud-style abstraction
              the tenant signed up for. Provider / 'default' tenant keeps
              the full surface so the operator can drive every option. */}
          {!isVdcTenant && !callerLocksConn && (
            <FormControl size="small" fullWidth>
              <InputLabel>{t('inventory.pbsRestoreTargetCluster')}</InputLabel>
              <Select
                value={pickedConnectionId}
                onChange={(e) => { setPickedConnectionId(String(e.target.value)); setPickedNode('') }}
                label={t('inventory.pbsRestoreTargetCluster')}
              >
                {pveConnections.map((c) => (
                  <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          {!isVdcTenant && !callerLocksNode && (
            <FormControl size="small" fullWidth disabled={!connectionId}>
              <InputLabel>{t('inventory.pbsRestoreTargetNode')}</InputLabel>
              <Select
                value={pickedNode}
                onChange={(e) => setPickedNode(String(e.target.value))}
                label={t('inventory.pbsRestoreTargetNode')}
              >
                {nodes.map((n) => (
                  <MenuItem key={n.node} value={n.node}>{n.node}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          {!isVdcTenant && (
            <TextField
              size="small"
              label={t('common.vmId')}
              value={vmid}
              onChange={(e) => setVmid(e.target.value.replace(/[^0-9]/g, ''))}
              error={!!vmid && !vmidValid}
              helperText={
                targetExists
                  ? t('inventory.pbsRestoreUniqueAutoEnabled')
                  : undefined
              }
              fullWidth
            />
          )}

          {!isVdcTenant && (
            <FormControl size="small" fullWidth>
              <InputLabel>{t('inventory.pbsRestoreStorage')}</InputLabel>
              <Select
                value={storage}
                onChange={(e) => setStorage(String(e.target.value))}
                label={t('inventory.pbsRestoreStorage')}
              >
                <MenuItem value="">
                  <em>{t('common.default')}</em>
                </MenuItem>
                {storages.map((s) => (
                  <MenuItem key={s.storage} value={s.storage}>{s.storage}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          {!isVdcTenant && (
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <FormControlLabel
                control={<Switch checked={unique} onChange={(_, v) => setUnique(v)} disabled={targetExists} />}
                label={t('inventory.pbsRestoreUnique')}
              />
              <FormControlLabel
                control={<Switch checked={start} onChange={(_, v) => setStart(v)} />}
                label={t('inventory.pbsRestoreStart')}
              />
              {type === 'qemu' && (
                <FormControlLabel
                  control={<Switch checked={live} onChange={(_, v) => setLive(v)} />}
                  label={t('inventory.pbsRestoreLive')}
                />
              )}
              <FormControlLabel
                control={<Switch checked={overrideName} onChange={(_, v) => setOverrideName(v)} />}
                label={t('inventory.pbsRestoreOverrideName')}
              />
            </Box>
          )}

          {/* Name field is meaningful only when we're spawning a NEW VM
              (tenant: restoreAsNew, provider: explicit override toggle).
              Overwrite path keeps the source VM's existing name. */}
          {((isVdcTenant && restoreAsNew) || (!isVdcTenant && overrideName)) && (
            <TextField
              size="small"
              label={t('common.name')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={backup.vmName || ''}
              fullWidth
            />
          )}

          {/* Tenant-only mode toggle: overwrite source VM (default) vs
              spawn a new VM. The new-VM path auto-allocates a fresh VMID
              via /cluster/nextid and forces unique MACs. */}
          {isVdcTenant && (
            <FormControlLabel
              control={<Switch checked={restoreAsNew} onChange={(_, v) => setRestoreAsNew(v)} />}
              label={t('inventory.pbsRestoreAsNew')}
            />
          )}

          {/* Confirmation banner for the destructive overwrite path —
              only shown in tenant mode after the first submit click. */}
          {isVdcTenant && !restoreAsNew && awaitingConfirm && (
            <Alert severity="warning" icon={<i className="ri-alert-line" style={{ fontSize: 18 }} />}>
              {t('inventory.pbsRestoreOverwriteConfirm', { vmid: sourceVmid })}
            </Alert>
          )}

          {!isVdcTenant && (
            <TextField
              size="small"
              label={t('inventory.pbsRestoreBandwidth')}
              value={bwlimit}
              onChange={(e) => setBwlimit(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder={t('common.unlimited')}
              fullWidth
            />
          )}

          <Typography variant="caption" sx={{ opacity: 0.6 }}>
            {t('inventory.pbsRestoreIpamNote')}
          </Typography>

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          color={isVdcTenant && !restoreAsNew && awaitingConfirm ? 'warning' : 'primary'}
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {submitting
            ? <CircularProgress size={16} />
            : (isVdcTenant && !restoreAsNew && awaitingConfirm
                ? t('inventory.pbsRestoreOverwriteConfirmButton')
                : t('inventory.pbsRestoreVm'))}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
