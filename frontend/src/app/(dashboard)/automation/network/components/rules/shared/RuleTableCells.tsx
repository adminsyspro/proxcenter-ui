'use client'

import { useTranslations } from 'next-intl'

import { Box, Chip, IconButton, Switch, TableCell, Tooltip, useTheme, alpha } from '@mui/material'

import * as firewallAPI from '@/lib/api/firewall'
import { formatLogLevel } from '@/components/firewall/logLevels'

/**
 * The cells a firewall rule row is made of, shared by the four rules tables
 * (cluster policy, hosts, VMs/CTs, security groups).
 *
 * Each export is a fragment of `<TableCell>`s, not a whole `<TableRow>`: the
 * row itself carries per-panel drag & drop wiring and the security groups
 * table slips its own "Applied to" cell between Service and Action, so the
 * panels keep the row and compose these groups inside it.
 *
 * Column widths are duplicated from RulesTableHead on purpose (MUI needs
 * them on the cells too); the two files must stay in step.
 */

// Colour of the ACCEPT/DROP/REJECT chip. Deliberately NOT the ActionChip of
// `@/components/firewall/shared`: that one is drawn lighter (alpha 0.15/0.3)
// and belongs to the VM/node firewall tabs. These four tables use 0.22/0.35.
const ActionChip = ({ action }: { action: string }) => {
  const colors: Record<string, string> = { ACCEPT: '#22c55e', DROP: '#ef4444', REJECT: '#f59e0b' }
  const color = colors[action] || '#94a3b8'

  return <Chip size="small" label={action} sx={{ height: 22, fontSize: 11, fontWeight: 700, bgcolor: alpha(color, 0.22), color, border: `1px solid ${alpha(color, 0.35)}`, minWidth: 70 }} />
}

interface RuleCellsProps {
  rule: firewallAPI.FirewallRule
  /**
   * A `type: 'group'` rule references a security group instead of describing
   * traffic: source, destination and service collapse to a dash and the
   * direction/action chips turn purple. Only cluster, host and VM/CT rules
   * can be group rules — PVE security groups cannot nest, so the security
   * groups table leaves this off and keeps its plain rendering.
   */
  isGroupRule?: boolean
}

interface RuleLeadingCellsProps extends RuleCellsProps {
  /**
   * Whether the rule's Active switch reads as on. Passed in rather than
   * derived: the VM/CT table treats only `enable === 1` as enabled while the
   * others treat anything but `0` as enabled.
   */
  enabled: boolean
  onToggleEnable: () => void
}

/** Drag handle, position, Active switch and direction chip. */
export function RuleRowLeadingCells({ rule, isGroupRule = false, enabled, onToggleEnable }: RuleLeadingCellsProps) {
  const theme = useTheme()

  return (
    <>
      <TableCell sx={{ p: 0.5, cursor: 'grab', width: 30 }}>
        <i className="ri-draggable" style={{ fontSize: 14, color: theme.palette.text.disabled }} />
      </TableCell>
      <TableCell sx={{ fontSize: 11, color: 'text.secondary', p: 0.5, width: 35 }}>{rule.pos}</TableCell>
      <TableCell sx={{ p: 0.5, width: 55 }}>
        <Switch checked={enabled} onChange={onToggleEnable} size="small" color="success" />
      </TableCell>
      <TableCell sx={{ p: 0.5, width: 65 }}>
        <Chip
          label={isGroupRule ? 'GROUP' : rule.type?.toUpperCase() || 'IN'}
          size="small"
          sx={{
            height: 20, fontSize: 10, fontWeight: 600,
            bgcolor: isGroupRule ? alpha('#8b5cf6', 0.22) : rule.type === 'in' ? alpha('#3b82f6', 0.22) : alpha('#ec4899', 0.22),
            color: isGroupRule ? '#8b5cf6' : rule.type === 'in' ? '#3b82f6' : '#ec4899'
          }}
        />
      </TableCell>
    </>
  )
}

/** Protocol and port merged into one "Service" column, PVE macro first. */
function formatService(rule: firewallAPI.FirewallRule): string {
  if (rule.type === 'group') return '-'
  if (rule.macro) return rule.macro
  const proto = rule.proto?.toUpperCase() || ''
  const port = rule.dport || ''
  if (!proto && !port) return 'any'
  if (proto && port) return `${proto}/${port}`

  return proto || port
}

/** Source, Destination and Service. */
export function RuleTrafficCells({ rule, isGroupRule = false }: RuleCellsProps) {
  return (
    <>
      <TableCell sx={{ fontSize: 11, p: 0.5, color: (isGroupRule || !rule.source) ? 'text.disabled' : 'text.primary' }}>
        {isGroupRule ? '-' : (rule.source || 'any')}
      </TableCell>
      <TableCell sx={{ fontSize: 11, p: 0.5, color: (isGroupRule || !rule.dest) ? 'text.disabled' : 'text.primary' }}>
        {isGroupRule ? '-' : (rule.dest || 'any')}
      </TableCell>
      <TableCell sx={{ fontSize: 11, p: 0.5, width: 100 }}>
        {formatService(rule)}
      </TableCell>
    </>
  )
}

/** ACCEPT/DROP/REJECT, or the referenced security group for a group rule. */
export function RuleActionCell({ rule, isGroupRule = false }: RuleCellsProps) {
  return (
    <TableCell sx={{ p: 0.5, width: 90 }}>
      {isGroupRule ? (
        <Chip icon={<i className="ri-shield-line" style={{ fontSize: 10 }} />} label={rule.action} size="small" sx={{ height: 22, fontSize: 10, fontWeight: 600, bgcolor: alpha('#8b5cf6', 0.22), color: '#8b5cf6', '& .MuiChip-icon': { color: '#8b5cf6' } }} />
      ) : (
        <ActionChip action={rule.action || 'ACCEPT'} />
      )}
    </TableCell>
  )
}

/** Log level (a dimmed dash when the rule logs nothing) and comment. */
export function RuleLogCommentCells({ rule }: { rule: firewallAPI.FirewallRule }) {
  // Resolved once: the dash is both the text and the cue to dim the cell.
  const logLevel = formatLogLevel(rule.log)
  const logsNothing = logLevel === '-'

  return (
    <>
      <TableCell sx={{ fontSize: 11, p: 0.5, width: 80, color: logsNothing ? 'text.disabled' : 'text.primary' }}>
        {logLevel}
      </TableCell>
      <TableCell sx={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', p: 0.5 }}>
        <Tooltip title={rule.comment || ''}><span style={{ fontSize: 11 }}>{rule.comment || '-'}</span></Tooltip>
      </TableCell>
    </>
  )
}

/** Trailing edit / delete buttons. */
export function RuleRowActionsCell({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const t = useTranslations()

  return (
    <TableCell sx={{ p: 0.5, width: 70 }}>
      <Box sx={{ display: 'flex', gap: 0 }}>
        <Tooltip title={t('networkPage.edit')}>
          <IconButton size="small" onClick={onEdit}>
            <i className="ri-pencil-line" style={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('networkPage.delete')}>
          <IconButton size="small" color="error" onClick={onDelete}>
            <i className="ri-delete-bin-line" style={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      </Box>
    </TableCell>
  )
}
