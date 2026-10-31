'use client'

import React from 'react'

import { Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { ClusterIcon, NodeIcon } from '../../../inventory/components/TreeIcons'
import type { NodeCapacity, ResourceThresholds } from '../../types'
import { formatBytes } from '../../helpers'
import { EmptyState, PagedTable, SectionCard, UsageBar, focusRowSx, type RowFocus } from './ui'

// Same gauge as the cluster and pool tables; an offline node has no load to show.
function LoadCell({ pct, warning, critical, online }: { pct: number; warning: number; critical: number; online: boolean }) {
  return (
    <TableCell>
      {online ? <UsageBar pct={pct} warning={warning} critical={critical} /> : <Typography variant="body2" color="text.disabled">-</Typography>}
    </TableCell>
  )
}

// One row per node, grouped under its cluster: the cluster is a level above the
// node, never a label beside it.
export default function NodeHeatmap({ nodes, thresholds, showClusters, focus }: {
  nodes: NodeCapacity[]
  thresholds: ResourceThresholds
  showClusters: boolean
  /** A node key, or a cluster id to point at all its nodes. */
  focus?: RowFocus | null
}) {
  const t = useTranslations()
  const isFocused = (n: NodeCapacity) => Boolean(focus) && (n.key === focus?.key || n.connectionId === focus?.key)
  const sorted = [...nodes].sort((a, b) => a.connectionName.localeCompare(b.connectionName) || a.node.localeCompare(b.node, undefined, { numeric: true }))

  return (
    <SectionCard id="cockpit-nodes" icon="ri-grid-line" title={t('resources.cockpit.nodeMap')} subtitle={t('resources.cockpit.nodeMapSub')} flush>
      {sorted.length === 0 ? (
        <EmptyState icon="ri-grid-line" text={t('resources.noNodeDataAvailable')} />
      ) : (
        <TableContainer>
          <PagedTable items={sorted} focusIndex={focus ? sorted.findIndex(n => isFocused(n)) : undefined} focusNonce={focus?.nonce}>
            {rows => (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ pl: 2.5 }}>{t('resources.node')}</TableCell>
                    <TableCell sx={{ width: 220 }}>CPU</TableCell>
                    <TableCell sx={{ width: 220 }}>RAM</TableCell>
                    <TableCell>vCPU:pCPU</TableCell>
                    <TableCell>{t('resources.cockpit.colRamAllocated')}</TableCell>
                    <TableCell sx={{ pr: 2.5 }}>{t('resources.cockpit.colGuests')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((node, index) => {
                    const newCluster = showClusters && (index === 0 || rows[index - 1].connectionId !== node.connectionId)
                    const clusterNodes = nodes.filter(n => n.connectionId === node.connectionId).map(n => ({ status: n.online ? 'online' : 'offline' }))

                    return (
                      <React.Fragment key={node.key}>
                        {newCluster && (
                          <TableRow>
                            <TableCell colSpan={6} sx={{ pl: 2.5, py: 0.75, bgcolor: 'action.hover', borderTop: index > 0 ? '1px solid' : undefined, borderColor: 'divider' }}>
                              <Stack direction="row" alignItems="center" spacing={1}>
                                <ClusterIcon nodes={clusterNodes} />
                                <Typography variant="body2" fontWeight={700}>{node.connectionName}</Typography>
                              </Stack>
                            </TableCell>
                          </TableRow>
                        )}
                        <TableRow key={`row:${isFocused(node) ? focus?.nonce : 0}`} hover sx={focusRowSx(isFocused(node))}>
                          <TableCell sx={{ pl: showClusters ? 5 : 2.5, whiteSpace: 'nowrap' }}>
                            <Stack direction="row" alignItems="center" spacing={1}>
                              <NodeIcon status={node.online ? 'online' : 'offline'} size={14} />
                              <Typography variant="body2" fontWeight={600} noWrap>{node.node}</Typography>
                            </Stack>
                          </TableCell>
                          <LoadCell pct={node.cpuPct} warning={thresholds.cpu.warning} critical={thresholds.cpu.critical} online={node.online} />
                          <LoadCell pct={node.ramPct} warning={thresholds.ram.warning} critical={thresholds.ram.critical} online={node.online} />
                          <TableCell>{node.cores > 0 ? `${(node.vcpuAllocated / node.cores).toFixed(1)}:1` : '-'}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatBytes(node.ramAllocated)} / {formatBytes(node.memTotal)}</TableCell>
                          <TableCell sx={{ pr: 2.5 }}>{node.guestsRunning}/{node.guestsTotal}</TableCell>
                        </TableRow>
                      </React.Fragment>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </PagedTable>
        </TableContainer>
      )}
    </SectionCard>
  )
}
