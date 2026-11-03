'use client'

import type { DragEvent, ReactNode } from 'react'
import { useTranslations } from 'next-intl'

import {
  Box, Button, Checkbox, Chip, IconButton, Link, MenuItem, Select, Switch, TableCell, TableHead, TableRow, Tooltip, Typography, alpha, useTheme,
} from '@mui/material'

import type { Theme } from '@mui/material/styles'

import { SMALL_SELECT_SX } from '@/components/settings/destinations/DestinationDialogParts'
import RuleLogsButton from '@/components/firewall/RuleLogsButton'
import type { EntryState } from '@/lib/firewall/draft'
import type { RuleFields } from '@/lib/firewall/publishOps'

import { WriteTip } from '../microseg/microsegAccess'
import { ruleName, ruleService } from './dfwModel'

/** Columns of the table: handle, checkbox, #, enabled, name, source, destination, service, applied to, action, log, hits. */
export const DFW_COLUMNS = 12

const CELL = { fontSize: 13, py: 0.5, px: 0.75, whiteSpace: 'nowrap' } as const
const HEAD = { ...CELL, fontWeight: 700, color: 'text.secondary' } as const

/** A disabled checkbox reads as one: the theme draws it like an enabled empty box otherwise. */
const CHECK_SX = { '&.Mui-disabled': { opacity: 0.35 } } as const

export const ACTION_COLOURS: Record<string, string> = { ACCEPT: '#22c55e', DROP: '#ef4444', REJECT: '#f59e0b' }

const Dot = ({ colour }: { colour: string }) => (
  <Box component='span' aria-hidden sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: colour, flexShrink: 0, display: 'inline-block' }} />
)

/** `show` false: no rule of the table can be checked, the cell stays empty (as on a zone header). */
export function DfwHead({ allChecked, someChecked, onCheckAll, canCheck, show = true }: { allChecked: boolean; someChecked: boolean; onCheckAll: (checked: boolean) => void; canCheck: boolean; show?: boolean }) {
  const t = useTranslations()
  const theme = useTheme()
  return (
    <TableHead>
      <TableRow sx={{ bgcolor: alpha(theme.palette.background.default, 0.6) }}>
        <TableCell sx={{ ...HEAD, width: 28 }} />
        <TableCell sx={{ ...HEAD, width: 36 }} padding='checkbox'>
          {show && (
            <Checkbox size='small' sx={CHECK_SX} checked={allChecked} indeterminate={someChecked && !allChecked} disabled={!canCheck}
              onChange={e => onCheckAll(e.target.checked)} inputProps={{ 'aria-label': t('microsegPilot.dfw.selectAll') }} />
          )}
        </TableCell>
        <TableCell sx={{ ...HEAD, width: 34 }}>#</TableCell>
        <TableCell sx={{ ...HEAD, width: 56 }}>{t('common.active')}</TableCell>
        <TableCell sx={HEAD}>{t('common.name')}</TableCell>
        <TableCell sx={HEAD}>{t('network.source')}</TableCell>
        <TableCell sx={HEAD}>{t('network.destination')}</TableCell>
        <TableCell sx={HEAD}>{t('firewall.service')}</TableCell>
        <TableCell sx={HEAD}>{t('networkPage.appliedTo')}</TableCell>
        <TableCell sx={{ ...HEAD, width: 130 }}>{t('firewall.action')}</TableCell>
        <TableCell sx={{ ...HEAD, width: 72 }}>{t('firewall.logLevelShort')}</TableCell>
        <TableCell sx={{ ...HEAD, width: 90 }}>{t('microsegPilot.dfw.hits24h')}</TableCell>
      </TableRow>
    </TableHead>
  )
}

/** An address of a rule: an alias or ipset reference as a chip, any address in grey. */
function AddressCell({ value }: { value: string }) {
  const t = useTranslations('microsegPilot.dfw')
  if (!value) return <TableCell sx={{ ...CELL, color: 'text.disabled' }}>{t('any')}</TableCell>
  const ref = value.startsWith('+') || /^[a-z][\w-]*$/i.test(value)
  return (
    <TableCell sx={{ ...CELL, maxWidth: 200 }}>
      <Tooltip title={value}>
        {ref
          ? <Chip size='small' variant='outlined' label={value} sx={{ height: 22, fontSize: 12, fontWeight: 600, maxWidth: 190 }} />
          : <Typography component='span' noWrap sx={{ fontSize: 13, display: 'block' }}>{value}</Typography>}
      </Tooltip>
    </TableCell>
  )
}

function ServiceCell({ rule }: { rule: RuleFields }) {
  const t = useTranslations('microsegPilot.dfw')
  const { label, raw } = ruleService(rule)
  if (!label) return <TableCell sx={{ ...CELL, color: 'text.disabled' }}>{t('any')}</TableCell>
  return (
    <TableCell sx={CELL}>
      <Tooltip title={raw}><span>{label}</span></Tooltip>
    </TableCell>
  )
}

function ActionCell({ rule, editable, onAction }: { rule: RuleFields; editable: boolean; onAction: (action: string) => void }) {
  const t = useTranslations('microsegPilot.dfw')
  if (rule.type === 'group') {
    return (
      <TableCell sx={CELL}>
        <Chip size='small' icon={<i className='ri-shield-line' style={{ fontSize: 12 }} />} label={rule.action} sx={{ height: 22, fontSize: 12, fontWeight: 600 }} />
      </TableCell>
    )
  }
  const colour = ACTION_COLOURS[rule.action] ?? '#94a3b8'
  if (!editable) {
    return (
      <TableCell sx={CELL}>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}><Dot colour={colour} />{t(`action.${rule.action}` as 'action.ACCEPT')}</Box>
      </TableCell>
    )
  }
  return (
    <TableCell sx={CELL}>
      <WriteTip>
        <Select size='small' value={rule.action} onChange={e => onAction(String(e.target.value))} inputProps={{ 'aria-label': t('actionLabel') }}
          sx={{ ...SMALL_SELECT_SX, fontSize: 13, minWidth: 116, color: colour, fontWeight: 600 }}
          renderValue={v => <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}><Dot colour={ACTION_COLOURS[v] ?? colour} />{t(`action.${v}` as 'action.ACCEPT')}</Box>}>
          {Object.entries(ACTION_COLOURS).map(([a, c]) => (
            <MenuItem key={a} value={a} sx={{ fontSize: 13, gap: 1 }}><Dot colour={c} />{t(`action.${a}` as 'action.ACCEPT')}</MenuItem>
          ))}
        </Select>
      </WriteTip>
    </TableCell>
  )
}

const STATE_BADGE: Record<Exclude<EntryState, null>, string> = { added: 'rowAdded', edited: 'rowEdited', moved: 'rowMoved' }

export type RuleRowDrag = {
  enabled: boolean
  dragging: boolean
  over: boolean
  onDragStart: (e: DragEvent) => void
  onDragOver: (e: DragEvent) => void
  onDrop: (e: DragEvent) => void
  onDragEnd: () => void
}

export type RuleRowProps = {
  index: number
  rule: RuleFields
  state: EntryState
  /** The engine's rule, or a rule of a zone group: no control. */
  managed: boolean
  /** The user may write (node.manage) and the rule is not managed. */
  editable: boolean
  selected: boolean
  appliedTo: string
  /** Hits of the last 24 h, null where they cannot be told. */
  hits: number | null
  hitsTitle: string
  drag: RuleRowDrag
  onSelect: (checked: boolean) => void
  onToggleEnable: () => void
  onToggleLog: () => void
  onAction: (action: string) => void
  onOpen: () => void
  /** The guest rule's log (its terminal icon). */
  onLogs?: () => void
  /** The lock of a managed rule: its tooltip, or null for none (a zone rule editable as its flow). */
  lockTitle?: string | null
  /** Controls after the name (a zone rule's menu, a guest's Edit zone). */
  actions?: ReactNode
  onDoubleClick?: () => void
}

function NameCell({ rule, index, state, managed, editable, onOpen, lockTitle, actions }: Pick<RuleRowProps, 'rule' | 'index' | 'state' | 'managed' | 'editable' | 'onOpen' | 'lockTitle' | 'actions'>) {
  const t = useTranslations('microsegPilot.dfw')
  const name = ruleName(rule) || t('unnamed', { pos: index })
  const direction = rule.type === 'group' ? 'GROUP' : rule.type.toUpperCase()
  return (
    <TableCell sx={{ ...CELL, maxWidth: 280 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
        <Chip size='small' label={direction} sx={{ height: 18, fontSize: 10, fontWeight: 700, flexShrink: 0 }} />
        {managed && lockTitle !== null && <Tooltip title={lockTitle ?? t('managedRule')}><i className='ri-lock-line' aria-label={lockTitle ?? t('managedRule')} style={{ fontSize: 14, flexShrink: 0 }} /></Tooltip>}
        <Tooltip title={name}>
          {editable
            ? <Link component='button' type='button' underline='hover' onClick={onOpen} sx={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{name}</Link>
            : <Typography component='span' noWrap sx={{ fontSize: 13, color: managed ? 'text.secondary' : 'text.primary', minWidth: 0 }}>{name}</Typography>}
        </Tooltip>
        {state && <Chip size='small' color='warning' variant='outlined' label={t(STATE_BADGE[state] as 'rowAdded')} sx={{ height: 18, fontSize: 10, fontWeight: 600, flexShrink: 0 }} />}
        {rule.enable !== 1 && <Chip size='small' label={t('rowDisabled')} sx={{ height: 18, fontSize: 10, flexShrink: 0 }} />}
        {actions}
      </Box>
    </TableCell>
  )
}

function rowOpacity(dragging: boolean, enabled: boolean): number {
  if (dragging) return 0.4
  return enabled ? 1 : 0.6
}

function rowBackground(theme: Theme, selected: boolean, state: EntryState): string | undefined {
  if (selected) return alpha(theme.palette.primary.main, 0.1)
  if (state) return alpha(theme.palette.warning.main, 0.06)
  return undefined
}

export function RuleRow(props: RuleRowProps) {
  const { index, rule, state, managed, editable, selected, appliedTo, hits, hitsTitle, drag, onSelect, onToggleEnable, onToggleLog, onAction, onLogs, onDoubleClick } = props
  const t = useTranslations('microsegPilot.dfw')
  const theme = useTheme()
  const logging = !!rule.log && rule.log !== 'nolog'
  return (
    <TableRow
      hover
      selected={selected}
      draggable={drag.enabled}
      onDragStart={drag.onDragStart}
      onDragOver={drag.onDragOver}
      onDrop={drag.onDrop}
      onDragEnd={drag.onDragEnd}
      onDoubleClick={onDoubleClick}
      data-testid='dfw-rule-row'
      data-state={state ?? ''}
      sx={{
        opacity: rowOpacity(drag.dragging, rule.enable === 1),
        bgcolor: rowBackground(theme, selected, state),
        boxShadow: drag.over ? `inset 0 2px 0 ${theme.palette.primary.main}` : undefined,
      }}
    >
      <TableCell sx={{ ...CELL, width: 28, cursor: drag.enabled ? 'grab' : 'default', color: drag.enabled ? 'text.secondary' : 'text.disabled' }}>
        {/* A rule of the engine never moves: no handle at all, its lock says why. */}
        {!managed && <i className='ri-draggable' aria-hidden style={{ fontSize: 14 }} />}
      </TableCell>
      <TableCell padding='checkbox' sx={{ width: 36 }}>
        {/* A rule of the engine is never selected: no checkbox at all, like the zone's default deny row. */}
        {!managed && (
          <Checkbox size='small' sx={CHECK_SX} checked={selected} onChange={e => onSelect(e.target.checked)}
            inputProps={{ 'aria-label': t('selectRule', { pos: index }) }} />
        )}
      </TableCell>
      <TableCell sx={{ ...CELL, width: 34, color: 'text.secondary' }}>{index}</TableCell>
      <TableCell sx={{ ...CELL, width: 56 }}>
        <WriteTip>
          <Switch size='small' color='success' checked={rule.enable === 1} disabled={!editable} onChange={onToggleEnable} slotProps={{ input: { role: 'switch', 'aria-label': t('enableLabel', { pos: index }) } }} />
        </WriteTip>
      </TableCell>
      <NameCell rule={rule} index={index} state={state} managed={managed} editable={editable} onOpen={props.onOpen} lockTitle={props.lockTitle} actions={props.actions} />
      <AddressCell value={rule.type === 'group' ? '' : rule.source} />
      <AddressCell value={rule.type === 'group' ? '' : rule.dest} />
      <ServiceCell rule={rule} />
      <TableCell sx={{ ...CELL, color: 'text.secondary', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{appliedTo}</TableCell>
      <ActionCell rule={rule} editable={editable} onAction={onAction} />
      <TableCell sx={{ ...CELL, width: 72 }}>
        <Box sx={{ display: 'inline-flex', alignItems: 'center' }}>
          <WriteTip>
            <Switch size='small' checked={logging} disabled={!editable || rule.type === 'group'} onChange={onToggleLog} slotProps={{ input: { role: 'switch', 'aria-label': t('logLabel', { pos: index }) } }} />
          </WriteTip>
          {onLogs && <RuleLogsButton rule={rule} onClick={onLogs} />}
        </Box>
      </TableCell>
      <TableCell sx={{ ...CELL, width: 90, color: hits ? 'text.primary' : 'text.secondary', fontWeight: hits ? 600 : 400 }}>
        <Tooltip title={hitsTitle}><span data-testid='dfw-hits'>{hits === null ? '-' : hits.toLocaleString()}</span></Tooltip>
      </TableCell>
    </TableRow>
  )
}

export type SectionRowProps = {
  title: string
  icon: ReactNode
  open: boolean
  onToggle: () => void
  badges: ReactNode
  /** Object, rule count and links on the right. */
  right: ReactNode
  /** The section checkbox: checks every rule of it; hidden for a read-only section. */
  check?: { checked: boolean; indeterminate: boolean; disabled: boolean; onChange: (checked: boolean) => void }
  menu?: ReactNode
  /** The section's "Add rule": always shown on an open section, on hover or focus of a collapsed one (always on touch). */
  addRule?: { onClick: () => void; disabled: boolean }
  indent?: number
  testId?: string
}

/** The class of the header's Add rule button, for the hover rule of its row. */
const ADD_CLASS = 'dfw-section-add'

/** The Add rule of a section header (revealed on hover of a collapsed row by the row's own rule). */
export function SectionAddButton({ title, onClick, disabled }: { title: string; open?: boolean; onClick: () => void; disabled: boolean }) {
  const t = useTranslations('microsegPilot.dfw')
  return (
    <WriteTip>
      <Button size='small' className={ADD_CLASS} onClick={onClick} disabled={disabled}
        startIcon={<i className='ri-add-line' />} aria-label={t('addRuleTo', { name: title })}
        sx={{ textTransform: 'none', fontSize: 12, fontWeight: 600, py: 0, minWidth: 0, whiteSpace: 'nowrap' }}>
        {t('addRuleShort')}
      </Button>
    </WriteTip>
  )
}

export function SectionRow({ title, icon, open, onToggle, badges, right, check, menu, addRule, indent = 0, testId }: SectionRowProps) {
  const t = useTranslations('microsegPilot.dfw')
  const theme = useTheme()
  const reveal = {
    [`& .${ADD_CLASS}`]: { opacity: open ? 1 : 0, transition: 'opacity 120ms' },
    [`&:hover .${ADD_CLASS}, &:focus-within .${ADD_CLASS}`]: { opacity: 1 },
    [`@media (hover: none)`]: { [`& .${ADD_CLASS}`]: { opacity: 1 } },
    [theme.breakpoints.down('md')]: { [`& .${ADD_CLASS}`]: { opacity: 1 } },
  }
  return (
    <TableRow data-testid={testId ?? 'dfw-section'} sx={{ bgcolor: alpha(theme.palette.primary.main, 0.06), '& td': { borderBottom: `1px solid ${alpha(theme.palette.divider, 0.3)}` }, ...reveal }}>
      <TableCell sx={{ ...CELL, width: 28 }} />
      <TableCell padding='checkbox' sx={{ width: 36 }}>
        {check && (
          <Checkbox size='small' sx={CHECK_SX} checked={check.checked} indeterminate={check.indeterminate} disabled={check.disabled}
            onChange={e => check.onChange(e.target.checked)} inputProps={{ 'aria-label': t('selectSection', { name: title }) }} />
        )}
      </TableCell>
      <TableCell colSpan={7} sx={{ ...CELL, pl: 0.75 + indent * 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <IconButton size='small' onClick={onToggle} aria-expanded={open} aria-label={open ? t('collapse', { name: title }) : t('expand', { name: title })}>
            <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} style={{ fontSize: 18 }} />
          </IconButton>
          {icon}
          <Tooltip title={title}>
            <Typography component='span' noWrap sx={{ fontSize: 13, fontWeight: 700, minWidth: 0, cursor: 'pointer' }} onClick={onToggle}>{title}</Typography>
          </Tooltip>
          {badges}
        </Box>
      </TableCell>
      <TableCell colSpan={3} sx={{ ...CELL, textAlign: 'right', color: 'text.secondary' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1 }}>
          {right}
          {addRule && <SectionAddButton title={title} open={open} onClick={addRule.onClick} disabled={addRule.disabled} />}
          {menu}
        </Box>
      </TableCell>
    </TableRow>
  )
}

/** "No rules" (or "no match") of an open section: a quiet caption under the Name column, not a full-width row. */
export function EmptyRulesRow({ text, action }: { text: string; action?: { label: string; onClick: () => void; disabled: boolean } }) {
  return (
    <TableRow data-testid='dfw-empty'>
      <TableCell colSpan={4} sx={{ ...CELL, py: 0.5 }} />
      <TableCell colSpan={DFW_COLUMNS - 4} sx={{ ...CELL, py: 0.5 }}>
        <Typography component='span' sx={{ fontSize: 12, color: 'text.secondary' }}>{text}</Typography>
        {action && (
          <>
            <Typography component='span' sx={{ fontSize: 12, color: 'text.secondary' }}>{' · '}</Typography>
            <WriteTip>
              <Link component='button' type='button' underline='hover' disabled={action.disabled} onClick={action.onClick} sx={{ fontSize: 12, fontWeight: 600 }}>
                {action.label}
              </Link>
            </WriteTip>
          </>
        )}
      </TableCell>
    </TableRow>
  )
}

/** A row spanning the table: a VLAN group header, a loading bar, a message, a pager. */
export function WideRow({ children, testId, tone = 'plain' }: { children: ReactNode; testId?: string; tone?: 'plain' | 'group' }) {
  const theme = useTheme()
  return (
    <TableRow data-testid={testId} sx={tone === 'group' ? { bgcolor: alpha(theme.palette.text.primary, 0.04) } : undefined}>
      <TableCell colSpan={DFW_COLUMNS} sx={{ ...CELL, py: tone === 'group' ? 0.75 : 1 }}>{children}</TableCell>
    </TableRow>
  )
}

export function Badge({ label, tone = 'default', title }: { label: string; tone?: 'default' | 'warning' | 'error' | 'success' | 'info'; title?: string }) {
  const chip = <Chip size='small' label={label} color={tone} variant={tone === 'default' ? 'filled' : 'outlined'} sx={{ height: 20, fontSize: 11, fontWeight: 600, flexShrink: 0 }} />
  return title ? <Tooltip title={title}>{chip}</Tooltip> : chip
}

/**
 * The last row of a zone section: what the engine does with what no rule of the zone allowed (enforce: blocked,
 * observe: logged as would-block). Not a Proxmox rule: read-only, never selected; it carries the zone's hits.
 */
export function DefaultDenyRow({ enforce, appliedTo, hits, hitsTitle }: { enforce: boolean; appliedTo: string; hits: number | null; hitsTitle: string }) {
  const t = useTranslations('microsegPilot.dfw')
  const colour = enforce ? ACTION_COLOURS.DROP : ACTION_COLOURS.REJECT
  return (
    <TableRow data-testid='dfw-default-deny'>
      <TableCell sx={{ ...CELL, width: 28 }} />
      <TableCell padding='checkbox' sx={{ width: 36 }} />
      <TableCell sx={{ ...CELL, width: 34, color: 'text.disabled' }}>-</TableCell>
      <TableCell sx={{ ...CELL, width: 56 }} />
      <TableCell sx={CELL}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Tooltip title={t('managedRule')}><i className='ri-lock-line' aria-label={t('managedRule')} style={{ fontSize: 14 }} /></Tooltip>
          <Typography component='span' noWrap sx={{ fontSize: 13, color: 'text.secondary' }}>{t('defaultDeny')}</Typography>
        </Box>
      </TableCell>
      <TableCell sx={{ ...CELL, color: 'text.disabled' }}>{t('any')}</TableCell>
      <TableCell sx={{ ...CELL, color: 'text.secondary' }}>{appliedTo}</TableCell>
      <TableCell sx={{ ...CELL, color: 'text.disabled' }}>{t('any')}</TableCell>
      <TableCell sx={{ ...CELL, color: 'text.secondary' }}>{appliedTo}</TableCell>
      <TableCell sx={CELL}>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}><Dot colour={colour} />{enforce ? t('denyBlock') : t('denyWouldBlock')}</Box>
      </TableCell>
      <TableCell sx={{ ...CELL, color: 'text.disabled' }}>-</TableCell>
      <TableCell sx={{ ...CELL, width: 90, fontWeight: hits ? 600 : 400 }}>
        <Tooltip title={hitsTitle}><span data-testid='dfw-hits'>{hits === null ? '-' : hits.toLocaleString()}</span></Tooltip>
      </TableCell>
    </TableRow>
  )
}
