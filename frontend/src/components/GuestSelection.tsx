'use client'

import { useCallback, useMemo, useState } from 'react'

import { Box, Button, Chip, Stack, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import HostDrainDialog from '@/components/HostDrainDialog'
import JobDetailDialog from '@/components/tasks/JobDetailDialog'
import type { VmRow } from '@/components/VmsTable'
import { useLicense } from '@/contexts/LicenseContext'
import { useRBAC } from '@/contexts/RBACContext'
import { useTenant } from '@/contexts/TenantContext'
import { hostDrainJobRows } from '@/lib/tasks/hostDrainRows'
import { runJobAction } from '@/lib/tasks/jobActions'

// "Migrate selection" (#1218): guests ticked in one or several VmsTable,
// wherever they run, handed to the drain planner. A drain covers one cluster,
// so the selection does too: once a guest is ticked, the guests of the other
// clusters can no longer be. Only for a tenant that owns the cluster (the
// routes refuse the others) and on a cluster with two online nodes at least.

type SelectableVm = Pick<VmRow, 'id' | 'connId' | 'vmid' | 'template'>

export type SelectionNode = { connId: string; node: string; status?: string; connName?: string }

export type GuestSelection = {
  tableProps: {
    selectedIds?: ReadonlySet<string>
    onSelectionChange?: (ids: Set<string>) => void
    isRowSelectable?: (vm: SelectableVm) => boolean
  }
  selectedVms: SelectableVm[]
  connId: string | undefined
  connName: string | undefined
  onlineNodes: string[]
  clear: () => void
}

export function useGuestSelection({ vms, nodes, migratingVmIds, resetKey }: {
  vms: SelectableVm[]
  nodes: SelectionNode[]
  migratingVmIds?: Set<string>
  resetKey?: string
}): GuestSelection {
  const { isFullClusterView } = useTenant()
  const { hasPermission } = useRBAC()
  // The selection belongs to the scope it was made in (cluster, node, view).
  const [picked, setPicked] = useState<{ scope?: string; ids: Set<string> }>(() => ({ scope: resetKey, ids: new Set() }))
  const ids = useMemo(() => (picked.scope === resetKey ? picked.ids : new Set<string>()), [picked, resetKey])
  const setIds = useCallback((next: Set<string>) => setPicked({ scope: resetKey, ids: next }), [resetKey])

  const onlineByConn = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const n of nodes) {
      if (n.status !== 'online') continue
      map.set(n.connId, [...(map.get(n.connId) ?? []), n.node])
    }
    return map
  }, [nodes])

  const byId = useMemo(() => new Map(vms.map(vm => [vm.id, vm])), [vms])
  const enabled = isFullClusterView && hasPermission('vm.migrate') && [...onlineByConn.values()].some(n => n.length > 1)
  const connId = [...ids].map(id => byId.get(id)?.connId).find(Boolean)

  const isRowSelectable = useCallback(
    (vm: SelectableVm) => !vm.template
      && !migratingVmIds?.has(`${vm.connId}:${vm.vmid}`)
      && (onlineByConn.get(vm.connId)?.length ?? 0) > 1
      && (!connId || vm.connId === connId),
    [migratingVmIds, onlineByConn, connId],
  )

  // A "select all" over several clusters keeps the first one ticked.
  const onSelectionChange = useCallback((next: Set<string>) => {
    const keep = [...next].map(id => byId.get(id)?.connId).find(Boolean)
    setIds(new Set([...next].filter(id => byId.get(id)?.connId === keep)))
  }, [byId, setIds])

  // Only the guests still listed count: one deleted meanwhile drops out.
  const selectedVms = useMemo(
    () => [...ids].map(id => byId.get(id)).filter((vm): vm is SelectableVm => !!vm && isRowSelectable(vm)),
    [ids, byId, isRowSelectable],
  )

  return {
    tableProps: enabled ? { selectedIds: ids, onSelectionChange, isRowSelectable } : {},
    selectedVms: enabled ? selectedVms : [],
    connId,
    connName: nodes.find(n => n.connId === connId)?.connName,
    onlineNodes: (connId && onlineByConn.get(connId)) || [],
    clear: () => setIds(new Set()),
  }
}

// `inline` puts the count and the buttons in a header row next to its other
// actions; otherwise they make a bar of their own above the tables.
export function GuestSelectionBar({ selection, sticky = false, inline = false }: { selection: GuestSelection; sticky?: boolean; inline?: boolean }) {
  const t = useTranslations()
  const { isEnterprise } = useLicense()
  const [dialogOpen, setDialogOpen] = useState(false)
  // The migration just started, followed in the Task Center's own dialog.
  const [started, setStarted] = useState<any>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const { selectedVms, connId, connName, onlineNodes, clear } = selection

  const content = (
    <>
      <Typography variant="body2" fontWeight={600} noWrap>{t('hostDrain.selectionCount', { count: selectedVms.length })}</Typography>
      {connName && <Chip size="small" variant="outlined" label={connName} sx={{ height: 20, fontSize: 11 }} />}
      {!inline && <Box sx={{ flex: 1 }} />}
      <Button size="small" color="inherit" onClick={clear} sx={{ textTransform: 'none' }}>{t('hostDrain.clearSelection')}</Button>
      <Button
        size="small"
        variant="contained"
        startIcon={<i className="ri-arrow-left-right-line" style={{ fontSize: 16 }} />}
        onClick={() => setDialogOpen(true)}
        data-testid="vm-selection-migrate"
        sx={{ textTransform: 'none' }}
      >
        {t('hostDrain.migrateSelection')}
      </Button>
    </>
  )

  return (
    <>
      {selectedVms.length > 0 && (inline ? (
        <Stack data-testid="vm-selection-bar" direction="row" spacing={1} alignItems="center">{content}</Stack>
      ) : (
        <Box
          data-testid="vm-selection-bar"
          sx={{
            ...(sticky ? { position: 'sticky', top: 0, zIndex: 3 } : {}),
            px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 1.5, borderBottom: '1px solid', borderColor: 'divider',
            bgcolor: 'background.paper', backgroundImage: theme => `linear-gradient(${theme.palette.action.hover}, ${theme.palette.action.hover})`,
          }}
        >
          {content}
        </Box>
      ))}
      {dialogOpen && connId && (
        <HostDrainDialog
          open
          mode="selection"
          connId={connId}
          node=""
          otherNodes={onlineNodes}
          vmids={selectedVms.map(vm => Number(vm.vmid))}
          onClose={() => setDialogOpen(false)}
          onStarted={drain => {
            clear()
            setActionError(null)
            setStarted(hostDrainJobRows([drain], () => connName ?? '').find(row => row.id === drain?.id) ?? null)
            setTimeout(() => fetch('/api/v1/inventory/poll', { method: 'POST' }).catch(() => {}), 2000)
          }}
        />
      )}
      <JobDetailDialog
        open={!!started}
        job={started}
        onClose={() => setStarted(null)}
        onAction={async (job: any, action: any) => {
          const { ok, error } = await runJobAction(job, action)
          setActionError(ok ? null : (error ?? null))
        }}
        actionError={actionError}
        isEnterprise={isEnterprise}
        t={t}
      />
    </>
  )
}
