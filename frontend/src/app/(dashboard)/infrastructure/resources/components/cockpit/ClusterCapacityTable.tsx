'use client'

import { Chip, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useTranslations } from 'next-intl'

import { ClusterIcon } from '../../../inventory/components/TreeIcons'
import type { ClusterCapacity, NodeCapacity, ResourceThresholds } from '../../types'
import type { ClusterRunway } from '../../algorithms/capacityPlanning'
import { COLORS } from '../../constants'
import { EmptyState, PagedTable, SectionCard, UsageBar, focusRowSx, formatDays, type RowFocus } from './ui'

function NPlusOneChip({ cluster }: { cluster: ClusterCapacity }) {
  const t = useTranslations()
  const n1 = cluster.nPlusOne

  if (!n1.applicable) return <Typography variant="body2" color="text.secondary">{t('resources.cockpit.notApplicable')}</Typography>

  const color = n1.ok ? COLORS.success : COLORS.error

  return (
    <Tooltip arrow title={n1.ramPctAfter === null || n1.cpuPctAfter === null
      ? t('resources.cockpit.n1Empty', { node: n1.largestNode ?? '' })
      : t('resources.cockpit.n1Detail', { node: n1.largestNode ?? '', ram: n1.ramPctAfter, cpu: n1.cpuPctAfter })}>
      <Chip size="small" label={n1.ok ? t('resources.cockpit.n1Ok') : t('resources.cockpit.n1Ko')} sx={{ fontWeight: 700, bgcolor: alpha(color, 0.12), color, cursor: 'help' }} />
    </Tooltip>
  )
}

export default function ClusterCapacityTable({ clusters, nodes, runways, thresholds, focus }: {
  clusters: ClusterCapacity[]
  nodes: NodeCapacity[]
  runways: ClusterRunway[]
  thresholds: ResourceThresholds
  focus?: RowFocus | null
}) {
  const t = useTranslations()

  return (
    <SectionCard id="cockpit-clusters" icon="ri-server-line" title={t('resources.cockpit.clusters')} subtitle={t('resources.cockpit.clustersSub')} flush>
      {clusters.length === 0 ? (
        <EmptyState icon="ri-server-line" text={t('resources.cockpit.noClusters')} />
      ) : (
        <TableContainer>
          <PagedTable items={clusters} focusIndex={focus ? clusters.findIndex(c => c.id === focus.key) : undefined} focusNonce={focus?.nonce}>
            {rows => (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ pl: 2.5 }}>{t('resources.cluster')}</TableCell>
                    <TableCell>{t('resources.cockpit.colNodes')}</TableCell>
                    <TableCell>CPU</TableCell>
                    <TableCell>RAM</TableCell>
                    <TableCell>{t('resources.storageLabel')}</TableCell>
                    <TableCell>vCPU:pCPU</TableCell>
                    <TableCell>{t('resources.cockpit.colRunway')}</TableCell>
                    <TableCell>N+1</TableCell>
                    <TableCell sx={{ pr: 2.5 }}>{t('resources.cockpit.colImbalance')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map(cluster => {
                    const soonest = runways.find(r => r.clusterId === cluster.id)?.soonest ?? null
                    const clusterNodes = nodes.filter(n => n.connectionId === cluster.id).map(n => ({ status: n.online ? 'online' : 'offline' }))

                    return (
                      <TableRow key={`${cluster.id}:${focus?.key === cluster.id ? focus.nonce : 0}`} hover sx={focusRowSx(focus?.key === cluster.id)}>
                        <TableCell sx={{ pl: 2.5, whiteSpace: 'nowrap' }}>
                          <Stack direction="row" alignItems="center" spacing={1}>
                            <ClusterIcon nodes={clusterNodes} />
                            <Typography variant="body2" fontWeight={600} noWrap>{cluster.name}</Typography>
                          </Stack>
                        </TableCell>
                        <TableCell>{cluster.nodesOnline}/{cluster.nodesTotal}</TableCell>
                        <TableCell><UsageBar pct={cluster.cpu.usedPct} warning={thresholds.cpu.warning} critical={thresholds.cpu.critical} /></TableCell>
                        <TableCell><UsageBar pct={cluster.ram.usedPct} warning={thresholds.ram.warning} critical={thresholds.ram.critical} /></TableCell>
                        <TableCell><UsageBar pct={cluster.storage.pct} warning={thresholds.storage.warning} critical={thresholds.storage.critical} /></TableCell>
                        <TableCell>{cluster.cpu.ratio.toFixed(1)}:1</TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          {soonest
                            ? `${formatDays(t, soonest.daysToThreshold)} · ${t(`resources.cockpit.resource.${soonest.resource}`)}`
                            : formatDays(t, null)}
                        </TableCell>
                        <TableCell><NPlusOneChip cluster={cluster} /></TableCell>
                        <TableCell sx={{ pr: 2.5, whiteSpace: 'nowrap' }}>
                          {t('resources.cockpit.imbalanceValue', { points: cluster.imbalance.ram })}
                        </TableCell>
                      </TableRow>
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
