'use client'

import { useState } from 'react'

import {
  Box,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'
import { useTranslations } from 'next-intl'

import type { FlowMatrixData, FlowMatrixCell } from './types'
import { getFlowStatusColor } from './lib/securityMapColors'

interface FlowMatrixProps {
  flowMatrix: FlowMatrixData
}

export default function FlowMatrix({ flowMatrix }: FlowMatrixProps) {
  const theme = useTheme()
  const t = useTranslations('networkPage')
  const [dialogCell, setDialogCell] = useState<FlowMatrixCell | null>(null)

  if (flowMatrix.labels.length === 0) return null

  const statusIcon = (status: string, size = 18) => {
    const color = getFlowStatusColor(status)

    switch (status) {
      case 'allowed': return <i className='ri-check-line' style={{ fontSize: size, color }} />
      case 'blocked': return <i className='ri-close-line' style={{ fontSize: size, color }} />
      case 'partial': return <i className='ri-subtract-line' style={{ fontSize: size, color }} />
      case 'self': return <Box sx={{ width: 12, height: 12, bgcolor: color, borderRadius: 0.5 }} />
      default: return null
    }
  }

  return (
    <Box>
      <TableContainer sx={{ px: 1, pb: 1 }}>
        <Table size='small' stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell
                sx={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  py: 1,
                  px: 1.5,
                  bgcolor: 'background.paper',
                  minWidth: 120,
                  borderBottom: `2px solid ${alpha(theme.palette.divider, 0.2)}`,
                }}
              >
                {t('securityMap.fromTo')}
              </TableCell>
              {flowMatrix.labels.map((label) => (
                <TableCell
                  key={label}
                  align='center'
                  sx={{
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    py: 1,
                    px: 0.5,
                    bgcolor: 'background.paper',
                    minWidth: 40,
                    maxWidth: 50,
                    writingMode: 'vertical-rl',
                    textOrientation: 'mixed',
                    transform: 'rotate(180deg)',
                    whiteSpace: 'nowrap',
                    borderBottom: `2px solid ${alpha(theme.palette.divider, 0.2)}`,
                  }}
                >
                  {label}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {flowMatrix.labels.map((rowLabel, rowIdx) => (
              <TableRow key={rowLabel} sx={{ '&:hover': { bgcolor: alpha(theme.palette.action.hover, 0.04) } }}>
                <TableCell
                  sx={{
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    py: 1.25,
                    px: 1.5,
                    whiteSpace: 'nowrap',
                    borderRight: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                  }}
                >
                  {rowLabel}
                </TableCell>
                {flowMatrix.labels.map((_, colIdx) => {
                  const cell = flowMatrix.matrix[rowIdx]?.[colIdx]

                  if (!cell) return <TableCell key={colIdx} />

                  const isSelf = cell.status === 'self'

                  return (
                    <TableCell
                      key={colIdx}
                      align='center'
                      sx={{
                        py: 1.25,
                        px: 0.5,
                        cursor: !isSelf ? 'pointer' : 'default',
                        transition: 'background-color 0.15s',
                        '&:hover': !isSelf ? {
                          bgcolor: alpha(getFlowStatusColor(cell.status), 0.15),
                        } : {},
                      }}
                      onClick={() => {
                        if (!isSelf) setDialogCell(cell)
                      }}
                    >
                      <Tooltip title={!isSelf ? `${cell.from} → ${cell.to}: ${cell.status}` : ''}>
                        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 20 }}>
                          {statusIcon(cell.status)}
                        </Box>
                      </Tooltip>
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Legend */}
      <Box sx={{ display: 'flex', gap: 3, px: 2, py: 1.5, flexWrap: 'wrap' }}>
        <LegendItem icon={statusIcon('allowed', 16)} label={t('securityMap.allowed')} />
        <LegendItem icon={statusIcon('blocked', 16)} label={t('securityMap.blocked')} />
        <LegendItem icon={statusIcon('partial', 16)} label={t('securityMap.partial')} />
        <LegendItem icon={statusIcon('self', 16)} label={t('securityMap.intraZone')} />
      </Box>

      {/* Rule dialog */}
      <Dialog open={!!dialogCell} onClose={() => setDialogCell(null)} maxWidth='sm' fullWidth>
        {dialogCell && (
          <>
            <DialogTitle sx={{ pb: 1 }}>
              <Typography variant='subtitle1' fontWeight={700}>
                {dialogCell.from} → {dialogCell.to}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                {statusIcon(dialogCell.status)}
                <Typography variant='caption' sx={{ color: getFlowStatusColor(dialogCell.status), fontWeight: 600 }}>
                  {dialogCell.status.charAt(0).toUpperCase() + dialogCell.status.slice(1)}
                </Typography>
                {dialogCell.summary && (
                  <Typography variant='caption' color='text.secondary' sx={{ ml: 1 }}>
                    — {dialogCell.summary}
                  </Typography>
                )}
              </Box>
            </DialogTitle>
            <DialogContent>
              {dialogCell.rules.length === 0 ? (
                <Typography variant='body2' color='text.secondary'>
                  {t('securityMap.noMatchingRules')}
                </Typography>
              ) : (
                <Table size='small'>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600 }}>Action</TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600 }}>Proto</TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600 }}>Source</TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600 }}>Dest</TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600 }}>DPort</TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600 }}>Comment</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {dialogCell.rules.map((rule, i) => (
                      <TableRow key={i}>
                        <TableCell sx={{ py: 0.75 }}>
                          <Chip
                            label={rule.action}
                            size='small'
                            color={rule.action === 'ACCEPT' ? 'success' : 'error'}
                            sx={{ fontSize: '0.65rem', height: 22 }}
                          />
                        </TableCell>
                        <TableCell sx={{ fontSize: '0.75rem', py: 0.75 }}>{rule.macro || rule.proto || '-'}</TableCell>
                        <TableCell sx={{ fontSize: '0.75rem', py: 0.75, fontFamily: 'JetBrains Mono, monospace' }}>{rule.source || '*'}</TableCell>
                        <TableCell sx={{ fontSize: '0.75rem', py: 0.75, fontFamily: 'JetBrains Mono, monospace' }}>{rule.dest || '*'}</TableCell>
                        <TableCell sx={{ fontSize: '0.75rem', py: 0.75, fontFamily: 'JetBrains Mono, monospace' }}>{rule.dport || '-'}</TableCell>
                        <TableCell sx={{ fontSize: '0.75rem', py: 0.75 }}>{rule.comment || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </DialogContent>
          </>
        )}
      </Dialog>
    </Box>
  )
}

function LegendItem({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      {icon}
      <Typography variant='caption' color='text.secondary' sx={{ fontSize: '0.7rem' }}>
        {label}
      </Typography>
    </Box>
  )
}
