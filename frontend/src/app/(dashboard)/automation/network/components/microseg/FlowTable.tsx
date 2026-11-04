'use client'

import { useMemo, useState } from 'react'
import {
  Box, Button, Chip, IconButton, InputAdornment, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, Tooltip, Typography,
} from '@mui/material'
import { useTranslations } from 'next-intl'

import type { PolicyDiff } from '@/lib/microseg/pendingChanges'
import type { MicrosegFlow, MicrosegZone } from '@/lib/microseg/types'
import { serviceLabel, serviceTitle } from '@/lib/network/serviceNames'

import DiffChip from './DiffChip'
import PolicyPager, { usePaged } from './PolicyPager'
import { OUTSIDE_GROUP, flowGroups, type FlowGroup, type FlowRowModel, type FlowState } from './policyTableModel'
import { SlotActions, WriteTip, useMicrosegWrite } from './microsegAccess'
import { uncoveredOf } from './useZoneUncovered'
import TruncatedText from './TruncatedText'

const COLUMNS = 5
const STRUCK = { textDecoration: 'line-through', opacity: 0.7 }
/** Read by a screen reader, not drawn. */
const VISUALLY_HIDDEN = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const

type Props = {
  flows: MicrosegFlow[]
  zones: MicrosegZone[]
  /** What the draft changes over the applied revision; null while the revision is read. */
  diff: PolicyDiff | null
  /** The uncovered hits of the last 24 hours per destination zone name (lower case); null while read or unavailable. */
  uncovered: ReadonlyMap<string, number> | null
  /** The Observation sub-tab filtered on a zone. */
  onOpenObservation?: (zoneId: string) => void
  onAdd: (dstZoneId?: string) => void
  onEdit: (flow: MicrosegFlow) => void
  onDelete: (flow: MicrosegFlow) => void
}

function End({ zoneId, cidr, zonesById }: { zoneId: string; cidr: string; zonesById: ReadonlyMap<string, MicrosegZone> }) {
  const zone = zoneId ? zonesById.get(zoneId) : undefined
  const text = cidr || zone?.name || zoneId
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
      {zone && <Box component='span' sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: zone.color || 'text.disabled', flexShrink: 0 }} />}
      <TruncatedText text={text} variant='body2' fontWeight={zone ? 600 : 400} />
    </Box>
  )
}

const STATE_CHIP: Record<Exclude<FlowState, 'unknown'>, { color: 'default' | 'success' | 'warning' | 'error'; icon: string }> = {
  applied: { color: 'default', icon: 'ri-check-line' },
  pendingAdd: { color: 'success', icon: 'ri-add-line' },
  pendingChange: { color: 'warning', icon: 'ri-edit-line' },
  pendingRemoval: { color: 'error', icon: 'ri-subtract-line' },
  notApplied: { color: 'default', icon: 'ri-information-line' },
}

/** The state of a flow; its colour is the diff's (added green, changed amber, removed red). */
export function FlowStateChip({ state }: { state: FlowState }) {
  const t = useTranslations('microsegPilot.policy.table.state')
  if (state === 'unknown') return <Tooltip title={t('unknownHint')}><Typography variant='body2' color='text.disabled'>-</Typography></Tooltip>
  const { color, icon } = STATE_CHIP[state]
  return (
    <Tooltip title={t(`${state}Hint`)}>
      <Chip size='small' variant='outlined' color={color} icon={<i className={icon} style={{ fontSize: 14 }} />} label={t(state)} sx={{ flexShrink: 0 }} />
    </Tooltip>
  )
}

/**
 * What the history really holds for a zone: the traffic into it that no flow covers (would-block and blocked, logged
 * by its members) over 24 hours. Grey at 0; a link to the Observation sub-tab filtered on the zone when given.
 */
export function UncoveredChip({ count, onOpen }: { count: number; onOpen?: () => void }) {
  const t = useTranslations('microsegPilot.policy.table')
  return (
    <Tooltip title={t('uncoveredHint')} describeChild>
      <Chip
        size='small'
        variant='outlined'
        color={count > 0 ? 'warning' : 'default'}
        icon={<i className='ri-radar-line' style={{ fontSize: 14 }} />}
        label={t('uncovered', { count })}
        onClick={onOpen}
        sx={{ flexShrink: 0, ...(count > 0 ? {} : { color: 'text.secondary' }) }}
      />
    </Tooltip>
  )
}

function FlowTableRow({ row, zonesById, onEdit, onDelete }: { row: FlowRowModel; zonesById: ReadonlyMap<string, MicrosegZone> } & Pick<Props, 'onEdit' | 'onDelete'>) {
  const t = useTranslations('microsegPilot.policy')
  const { canWrite } = useMicrosegWrite()
  const { flow, removed } = row
  const details = [flow.comment, flow.created_by ? t('flow.createdBy', { user: flow.created_by }) : ''].filter(Boolean).join(' · ')
  const struck = removed ? STRUCK : undefined

  return (
    <TableRow hover data-removed={removed || undefined}>
      <TableCell sx={{ maxWidth: 200, ...struck }}><End zoneId={flow.src_zone_id} cidr={flow.src_cidr} zonesById={zonesById} /></TableCell>
      <TableCell sx={{ maxWidth: 200, ...struck }}><End zoneId={flow.dst_zone_id} cidr={flow.dst_cidr} zonesById={zonesById} /></TableCell>
      <TableCell sx={struck}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Tooltip title={serviceTitle(flow.proto, flow.dport)}>
            <Chip size='small' variant='outlined' label={serviceLabel(flow.proto, flow.dport)} sx={{ flexShrink: 0 }} />
          </Tooltip>
          {flow.origin === 'learned' && <Chip size='small' color='info' variant='outlined' label={t('flow.learned')} sx={{ flexShrink: 0 }} />}
          {details && (
            <Tooltip title={details}>
              <Box component='span' sx={{ display: 'inline-flex' }}>
                <i className='ri-chat-3-line' aria-hidden style={{ opacity: 0.6 }} />
                <Box component='span' sx={VISUALLY_HIDDEN}>{details}</Box>
              </Box>
            </Tooltip>
          )}
        </Box>
      </TableCell>
      <TableCell><FlowStateChip state={row.state} /></TableCell>
      <TableCell align='right' sx={{ whiteSpace: 'nowrap', py: 0 }}>
        {!removed && (
          <>
            <WriteTip title={t('flow.edit')}>
              <IconButton size='small' aria-label={t('flow.edit')} disabled={!canWrite} onClick={() => onEdit(flow)}><i className='ri-pencil-line' /></IconButton>
            </WriteTip>
            <WriteTip title={t('flow.delete')}>
              <IconButton size='small' aria-label={t('flow.delete')} disabled={!canWrite} onClick={() => onDelete(flow)}><i className='ri-delete-bin-line' /></IconButton>
            </WriteTip>
          </>
        )}
      </TableCell>
    </TableRow>
  )
}

/** One destination: its header (chevron, colour, name, count, "+ Flow" into it), then its flows ten per page. */
function GroupRows({ group, open, onToggle, zonesById, uncovered, previousName, onOpenObservation, onAdd, onEdit, onDelete }: {
  group: FlowGroup
  open: boolean
  onToggle: () => void
  zonesById: ReadonlyMap<string, MicrosegZone>
  /** The zone's name in the applied revision when the draft renamed it. */
  previousName?: string
} & Pick<Props, 'uncovered' | 'onOpenObservation' | 'onAdd' | 'onEdit' | 'onDelete'>) {
  const t = useTranslations('microsegPilot.policy')
  const { canWrite } = useMicrosegWrite()
  const paged = usePaged(group.rows)
  const outside = group.key === OUTSIDE_GROUP
  const name = outside ? t('table.outside') : (group.zone?.name ?? group.key)
  const addable = !outside && !group.zoneRemoved && !!group.zone
  const zoneId = addable ? group.key : null
  const uncoveredHits = zoneId && uncovered && group.zone ? uncoveredOf(uncovered, group.zone.name, previousName) : null
  const bodyId = `policy-flows-${group.key}`

  return (
    <TableBody aria-label={name} id={bodyId}>
      <TableRow sx={{ bgcolor: 'action.hover' }}>
        <TableCell component='th' scope='rowgroup' colSpan={COLUMNS} sx={{ py: 0.25, fontWeight: 'inherit' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <IconButton size='small' aria-expanded={open} aria-controls={bodyId} aria-label={open ? t('hideDetails') : t('showDetails')} onClick={onToggle}>
              <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />
            </IconButton>
            {outside
              ? <i className='ri-global-line' style={{ opacity: 0.7, flexShrink: 0 }} />
              : <Box component='span' sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: group.zone?.color || 'text.disabled', flexShrink: 0 }} />}
            <Typography noWrap fontWeight={600} sx={group.zoneRemoved ? STRUCK : undefined}>{name}</Typography>
            {group.zoneRemoved && <DiffChip kind='removed' />}
            <Typography noWrap variant='body2' color='text.secondary' sx={{ flex: 1 }}>{t('table.groupCount', { count: group.rows.length })}</Typography>
            {uncoveredHits !== null && zoneId && (
              <UncoveredChip count={uncoveredHits} onOpen={onOpenObservation ? () => onOpenObservation(zoneId) : undefined} />
            )}
            {addable && (
              <WriteTip title={t('table.addFlowInto', { zone: name })}>
                <Button size='small' startIcon={<i className='ri-add-line' />} aria-label={t('table.addFlowInto', { zone: name })} disabled={!canWrite} onClick={() => onAdd(group.key)}>
                  {t('table.addFlowShort')}
                </Button>
              </WriteTip>
            )}
          </Box>
        </TableCell>
      </TableRow>
      {open && paged.count === 0 && (
        <TableRow>
          <TableCell colSpan={COLUMNS}><Typography variant='body2' color='text.secondary'>{t('table.noFlowInto')}</Typography></TableCell>
        </TableRow>
      )}
      {open && paged.rows.map(row => <FlowTableRow key={`${row.removed ? 'removed' : 'draft'}-${row.flow.id}`} row={row} zonesById={zonesById} onEdit={onEdit} onDelete={onDelete} />)}
      {open && paged.count > paged.size && (
        <TableRow>
          <TableCell colSpan={COLUMNS} sx={{ p: 0, borderBottom: 0 }}>
            <PolicyPager count={paged.count} page={paged.page} size={paged.size} onPage={paged.setPage} />
          </TableCell>
        </TableRow>
      )}
    </TableBody>
  )
}

/**
 * The flows of the draft as one table grouped by destination zone (NSX style): source, destination, service, state
 * against the applied revision, actions; each zone group says how much traffic into it no flow covered over 24 hours.
 * Removed flows stay, struck through, until the next apply. A filter (zone or service) applies to every group, rows
 * sorted by source. The history has no per-flow usage: the engine logs dropped traffic only.
 */
export default function FlowTable({ flows, zones, diff, uncovered, onOpenObservation, onAdd, onEdit, onDelete }: Props) {
  const t = useTranslations('microsegPilot.policy')
  const { canWrite } = useMicrosegWrite()
  const [filter, setFilter] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())

  const groups = useMemo(() => flowGroups({ zones, flows, diff, filter }), [zones, flows, diff, filter])
  const zonesById = useMemo(() => new Map([...(diff?.removedZones ?? []), ...zones].map(z => [z.id, z])), [zones, diff])
  const toggle = (key: string) => setCollapsed(prev => {
    const next = new Set(prev)
    if (!next.delete(key)) next.add(key)
    return next
  })
  // The zones show even without a flow: each group says how much traffic into its zone no flow covers.
  const anyFlow = zones.length > 0 || flows.length > 0 || (diff?.removedFlows.length ?? 0) > 0

  return (
    <Box component='section' aria-label={t('flowsTitle')} sx={{ mt: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Typography variant='subtitle1' fontWeight={600} sx={{ flex: 1 }}>{t('flowsTitle')}</Typography>
        {/* A disabled button fires no hover: the tooltip sits on a wrapper. */}
        <SlotActions order={3}>
          <WriteTip title={zones.length === 0 ? t('addFlowNeedsZone') : ''}>
            <Button size='small' variant='outlined' startIcon={<i className='ri-add-line' />} onClick={() => onAdd()} disabled={!canWrite || zones.length === 0}>
              {t('addFlow')}
            </Button>
          </WriteTip>
        </SlotActions>
      </Box>
      {anyFlow ? (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
            <TextField
              size='small'
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder={t('table.filter')}
              slotProps={{
                htmlInput: { 'aria-label': t('table.filter') },
                input: { startAdornment: <InputAdornment position='start'><i className='ri-search-line' /></InputAdornment> },
              }}
              sx={{ flex: '1 1 240px', maxWidth: 360 }}
            />
          </Box>
          {groups.length === 0 ? (
            <Typography color='text.secondary' sx={{ py: 2 }}>{t('table.noMatch')}</Typography>
          ) : (
            <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
              <Table size='small' aria-label={t('flowsTitle')} sx={{ minWidth: 720 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('table.source')}</TableCell>
                    <TableCell>{t('table.destination')}</TableCell>
                    <TableCell>{t('table.service')}</TableCell>
                    <TableCell>{t('table.stateColumn')}</TableCell>
                    <TableCell align='right'><Box component='span' sx={VISUALLY_HIDDEN}>{t('table.actions')}</Box></TableCell>
                  </TableRow>
                </TableHead>
                {groups.map(group => (
                  <GroupRows
                    // A new filter starts every group on its first page.
                    key={`${group.key}|${filter}`}
                    group={group}
                    open={!collapsed.has(group.key)}
                    onToggle={() => toggle(group.key)}
                    zonesById={zonesById}
                    previousName={diff?.renamedZones.get(group.key)}
                    uncovered={uncovered}
                    onOpenObservation={onOpenObservation}
                    onAdd={onAdd}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                ))}
              </Table>
            </TableContainer>
          )}
        </>
      ) : (
        <Typography color='text.secondary' sx={{ py: 2 }}>{t('flowsEmpty')}</Typography>
      )}
    </Box>
  )
}
