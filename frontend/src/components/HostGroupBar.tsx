'use client'

import { useState } from 'react'

import { Box, Button, Stack, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import HostDrainDialog from '@/components/HostDrainDialog'
import HostGroupExitDialog from '@/components/HostGroupExitDialog'
import type { NodeRow } from '@/components/NodesTable'

// Several nodes of a cluster in maintenance as one operation (roadmap#198),
// above the Nodes table of the cluster: enter maintenance for the selected
// nodes (one plan that never targets one of them), or leave it together.

type HostLike = Pick<NodeRow, 'id' | 'name' | 'status'>

/** Why the selected nodes cannot enter maintenance together, or null. */
export function groupEnterBlocker(selected: HostLike[], all: HostLike[]): 'count' | 'state' | 'remaining' | null {
  if (selected.length < 2) return 'count'
  if (selected.some(n => n.status !== 'online')) return 'state'
  const picked = new Set(selected.map(n => n.id))
  if (!all.some(n => !picked.has(n.id) && n.status === 'online')) return 'remaining'

  return null
}

/** Whether the selected nodes can leave maintenance together. */
export const canGroupExit = (selected: HostLike[]): boolean => selected.length >= 2 && selected.every(n => n.status === 'maintenance')

export default function HostGroupBar({ connId, nodes, selectedIds, onClear }: {
  connId: string
  /** Every node of the cluster. */
  nodes: HostLike[]
  selectedIds: ReadonlySet<string>
  onClear: () => void
}) {
  const t = useTranslations()
  const [dialog, setDialog] = useState<'enter' | 'exit' | null>(null)
  const selected = nodes.filter(n => selectedIds.has(n.id))
  const names = selected.map(n => n.name)
  const blocker = groupEnterBlocker(selected, nodes)
  const exitable = canGroupExit(selected)

  if (selected.length === 0) return null

  const close = () => {
    setDialog(null)
    onClear()
  }

  return (
    <>
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        data-testid="host-group-bar"
        sx={{ px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'action.hover' }}
      >
        <Typography variant="body2" fontWeight={600} noWrap>{t('hostGroup.selectionCount', { count: selected.length })}</Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" color="inherit" onClick={onClear} sx={{ textTransform: 'none' }}>{t('hostDrain.clearSelection')}</Button>
        <Tooltip title={blocker ? t(`hostGroup.cannotEnter.${blocker}`) : ''}>
          <span>
            <Button
              size="small"
              variant="contained"
              color="warning"
              disabled={!!blocker}
              onClick={() => setDialog('enter')}
              startIcon={<i className="ri-tools-fill" style={{ fontSize: 16 }} />}
              data-testid="host-group-enter"
              sx={{ textTransform: 'none' }}
            >
              {t('hostGroup.enter', { count: selected.length })}
            </Button>
          </span>
        </Tooltip>
        <Tooltip title={exitable ? '' : t('hostGroup.cannotExit')}>
          <span>
            <Button
              size="small"
              variant="outlined"
              color="success"
              disabled={!exitable}
              onClick={() => setDialog('exit')}
              startIcon={<i className="ri-play-circle-line" style={{ fontSize: 16 }} />}
              data-testid="host-group-exit"
              sx={{ textTransform: 'none' }}
            >
              {t('hostGroup.exit', { count: selected.length })}
            </Button>
          </span>
        </Tooltip>
      </Stack>
      {dialog === 'enter' && (
        <HostDrainDialog
          open
          mode="maintenance"
          connId={connId}
          node=""
          nodes={names}
          otherNodes={nodes.filter(n => !selectedIds.has(n.id) && n.status === 'online').map(n => n.name)}
          onClose={() => setDialog(null)}
          onStarted={close}
        />
      )}
      {dialog === 'exit' && <HostGroupExitDialog connId={connId} nodes={names} onClose={() => setDialog(null)} />}
    </>
  )
}
