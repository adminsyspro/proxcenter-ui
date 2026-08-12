'use client'

import { useTranslations } from 'next-intl'

import { TableCell, TableHead, TableRow, useTheme, alpha } from '@mui/material'

import { RULE_CELL_FONT_SIZE } from './RuleTableCells'

// ── Column header style ──
// Body cells are all `p: 0.5`; without the same padding here the header
// labels sit ~12px right of their column's values (MUI's default 16px).
// Single source of truth for the four rules tables (cluster policy, hosts,
// VMs/CTs and security groups), which used to carry a copy each.
const headCellSx = { fontWeight: 700, fontSize: RULE_CELL_FONT_SIZE, whiteSpace: 'nowrap', p: 0.5 } as const

interface RulesTableHeadProps {
  /**
   * Security groups get one extra column, "Applied to", between Service and
   * Action: it counts the VMs whose rules reference the group. Every other
   * rules table (cluster, host, VM/CT) has nothing to show there, so the
   * column is opt-in rather than rendered empty.
   */
  showAppliedTo?: boolean
}

/**
 * The header row every rules table shares: a leading drag-handle column, the
 * nine rule columns and a trailing actions column — 11 columns, 12 with
 * `showAppliedTo`. Column widths are part of the contract: the body cells
 * pin the same widths, so a change here must be mirrored in the row cells
 * (see RuleTableCells.tsx).
 */
export default function RulesTableHead({ showAppliedTo = false }: RulesTableHeadProps) {
  const theme = useTheme()
  const t = useTranslations()

  return (
    <TableHead>
      <TableRow sx={{ bgcolor: alpha(theme.palette.background.default, 0.5) }}>
        <TableCell sx={{ ...headCellSx, width: 30, p: 0.5 }}></TableCell>
        <TableCell sx={{ ...headCellSx, width: 35 }}>#</TableCell>
        <TableCell sx={{ ...headCellSx, width: 55 }}>{t('common.active')}</TableCell>
        <TableCell sx={{ ...headCellSx, width: 65 }}>{t('firewall.direction')}</TableCell>
        <TableCell sx={headCellSx}>{t('network.source')}</TableCell>
        <TableCell sx={headCellSx}>{t('network.destination')}</TableCell>
        <TableCell sx={{ ...headCellSx, width: 100 }}>{t('firewall.service')}</TableCell>
        {showAppliedTo && <TableCell sx={{ ...headCellSx, width: 90 }}>{t('networkPage.appliedTo')}</TableCell>}
        <TableCell sx={{ ...headCellSx, width: 90 }}>{t('firewall.action')}</TableCell>
        <TableCell sx={{ ...headCellSx, width: 80 }}>{t('firewall.logLevelShort')}</TableCell>
        <TableCell sx={headCellSx}>{t('network.comment')}</TableCell>
        <TableCell sx={{ width: 70 }}></TableCell>
      </TableRow>
    </TableHead>
  )
}
