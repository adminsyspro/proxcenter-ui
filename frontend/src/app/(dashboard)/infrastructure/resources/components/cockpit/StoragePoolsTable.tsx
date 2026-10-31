'use client'

import { Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { NodeIcon } from '../../../inventory/components/TreeIcons'
import type { NodeCapacity, ResourceThresholds, StoragePool } from '../../types'
import { formatBytes } from '../../helpers'
import { EmptyState, PagedTable, SectionCard, UsageBar, focusRowSx, formatDays, type RowFocus } from './ui'

export default function StoragePoolsTable({ pools, nodes, thresholds, showClusters, focus }: {
  pools: StoragePool[]
  nodes: NodeCapacity[]
  thresholds: ResourceThresholds
  showClusters: boolean
  focus?: RowFocus | null
}) {
  const t = useTranslations()
  const nodeOnline = (pool: StoragePool) => nodes.find(n => n.connectionId === pool.connectionId && n.node === pool.node)?.online

  return (
    <SectionCard id="cockpit-pools" icon="ri-database-2-line" title={t('resources.cockpit.pools')} subtitle={t('resources.cockpit.poolsSub')} flush>
      {pools.length === 0 ? (
        <EmptyState icon="ri-database-2-line" text={t('resources.cockpit.noPools')} />
      ) : (
        <TableContainer>
          <PagedTable items={pools} focusIndex={focus ? pools.findIndex(p => p.key === focus.key) : undefined} focusNonce={focus?.nonce}>
            {rows => (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ pl: 2.5 }}>{t('resources.cockpit.colPool')}</TableCell>
                    {showClusters && <TableCell>{t('resources.cluster')}</TableCell>}
                    <TableCell>{t('resources.cockpit.colScope')}</TableCell>
                    <TableCell>{t('resources.cockpit.colType')}</TableCell>
                    <TableCell>{t('resources.cockpit.colUsage')}</TableCell>
                    <TableCell>{t('resources.cockpit.colCapacity')}</TableCell>
                    <TableCell>{t('resources.cockpit.colGrowth')}</TableCell>
                    <TableCell sx={{ pr: 2.5 }}>{t('resources.cockpit.colRunway')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map(pool => (
                    <TableRow key={`${pool.key}:${focus?.key === pool.key ? focus.nonce : 0}`} hover sx={focusRowSx(focus?.key === pool.key)}>
                      <TableCell sx={{ pl: 2.5, whiteSpace: 'nowrap' }}>
                        <Stack direction="row" alignItems="center" spacing={1}>
                          <i className={pool.shared ? 'ri-share-line' : 'ri-hard-drive-2-line'} style={{ fontSize: 15, opacity: 0.7 }} />
                          <Typography variant="body2" fontWeight={600} noWrap>{pool.name}</Typography>
                        </Stack>
                      </TableCell>
                      {showClusters && <TableCell sx={{ whiteSpace: 'nowrap' }}>{pool.connectionName}</TableCell>}
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        {pool.node ? (
                          <Stack direction="row" alignItems="center" spacing={1}>
                            <NodeIcon status={nodeOnline(pool) === false ? 'offline' : 'online'} size={14} />
                            <Typography variant="body2" noWrap>{pool.node}</Typography>
                          </Stack>
                        ) : t('resources.cockpit.sharedScope')}
                      </TableCell>
                      <TableCell>{pool.type}</TableCell>
                      <TableCell><UsageBar pct={pool.pct} warning={thresholds.storage.warning} critical={thresholds.storage.critical} /></TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatBytes(pool.used)} / {formatBytes(pool.total)}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        {pool.growthPctPerDay === null ? '-' : t('resources.cockpit.growthValue', { points: (pool.growthPctPerDay * 30).toFixed(1) })}
                      </TableCell>
                      <TableCell sx={{ pr: 2.5, whiteSpace: 'nowrap' }}>{formatDays(t, pool.daysToThreshold)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </PagedTable>
        </TableContainer>
      )}
    </SectionCard>
  )
}
