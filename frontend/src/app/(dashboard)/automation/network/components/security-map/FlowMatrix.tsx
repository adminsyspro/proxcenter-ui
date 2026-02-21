'use client'

import { useState } from 'react'

import {
  Box,
  Chip,
  Collapse,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
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
  const [expanded, setExpanded] = useState(true)
  const [dialogCell, setDialogCell] = useState<FlowMatrixCell | null>(null)

  if (flowMatrix.labels.length === 0) return null

  const statusIcon = (status: string) => {
    const color = getFlowStatusColor(status)

    switch (status) {
      case 'allowed': return <i className='ri-check-line' style={{ fontSize: 14, color }} />
      case 'blocked': return <i className='ri-close-line' style={{ fontSize: 14, color }} />
      case 'partial': return <i className='ri-subtract-line' style={{ fontSize: 14, color }} />
      case 'self': return <Box sx={{ width: 10, height: 10, bgcolor: color, borderRadius: 0.5 }} />
      default: return null
    }
  }

  return (
    <Box>
      {/* Toggle button */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 2,
          py: 1,
          cursor: 'pointer',
          '&:hover': { bgcolor: alpha(theme.palette.action.hover, 0.04) },
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <i
          className={expanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'}
          style={{ fontSize: 18 }}
        />
        <Typography variant='subtitle2' fontWeight={600}>
          {t('securityMap.flowMatrix')}
        </Typography>
      </Box>

      <Collapse in={expanded}>
        <TableContainer sx={{ maxHeight: 400, px: 1, pb: 1 }}>
          <Table size='small' stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell
                  sx={{
                    fontSize: '0.6rem',
                    fontWeight: 700,
                    py: 0.5,
                    px: 0.5,
                    bgcolor: 'background.paper',
                    minWidth: 80,
                  }}
                >
                  {t('securityMap.fromTo')}
                </TableCell>
                {flowMatrix.labels.map((label) => (
                  <TableCell
                    key={label}
                    align='center'
                    sx={{
                      fontSize: '0.55rem',
                      fontWeight: 600,
                      py: 0.5,
                      px: 0.25,
                      bgcolor: 'background.paper',
                      maxWidth: 60,
                      writingMode: 'vertical-rl',
                      textOrientation: 'mixed',
                      transform: 'rotate(180deg)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {label}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {flowMatrix.labels.map((rowLabel, rowIdx) => (
                <TableRow key={rowLabel}>
                  <TableCell sx={{ fontSize: '0.6rem', fontWeight: 600, py: 0.3, px: 0.5, whiteSpace: 'nowrap' }}>
                    {rowLabel}
                  </TableCell>
                  {flowMatrix.labels.map((_, colIdx) => {
                    const cell = flowMatrix.matrix[rowIdx]?.[colIdx]

                    if (!cell) return <TableCell key={colIdx} />

                    return (
                      <TableCell
                        key={colIdx}
                        align='center'
                        sx={{
                          py: 0.3,
                          px: 0.25,
                          cursor: cell.status !== 'self' ? 'pointer' : 'default',
                          '&:hover': cell.status !== 'self' ? {
                            bgcolor: alpha(getFlowStatusColor(cell.status), 0.1),
                          } : {},
                        }}
                        onClick={() => {
                          if (cell.status !== 'self') setDialogCell(cell)
                        }}
                      >
                        <Tooltip title={cell.status !== 'self' ? `${cell.from} → ${cell.to}: ${cell.status}` : ''}>
                          <Box sx={{ display: 'flex', justifyContent: 'center' }}>
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
        <Box sx={{ display: 'flex', gap: 2, px: 2, pb: 1, flexWrap: 'wrap' }}>
          <LegendItem icon={statusIcon('allowed')} label={t('securityMap.allowed')} />
          <LegendItem icon={statusIcon('blocked')} label={t('securityMap.blocked')} />
          <LegendItem icon={statusIcon('partial')} label={t('securityMap.partial')} />
          <LegendItem icon={statusIcon('self')} label={t('securityMap.intraZone')} />
        </Box>
      </Collapse>

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
                      <TableCell sx={{ fontSize: '0.7rem', fontWeight: 600 }}>Action</TableCell>
                      <TableCell sx={{ fontSize: '0.7rem', fontWeight: 600 }}>Proto</TableCell>
                      <TableCell sx={{ fontSize: '0.7rem', fontWeight: 600 }}>Source</TableCell>
                      <TableCell sx={{ fontSize: '0.7rem', fontWeight: 600 }}>Dest</TableCell>
                      <TableCell sx={{ fontSize: '0.7rem', fontWeight: 600 }}>DPort</TableCell>
                      <TableCell sx={{ fontSize: '0.7rem', fontWeight: 600 }}>Comment</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {dialogCell.rules.map((rule, i) => (
                      <TableRow key={i}>
                        <TableCell sx={{ py: 0.5 }}>
                          <Chip
                            label={rule.action}
                            size='small'
                            color={rule.action === 'ACCEPT' ? 'success' : 'error'}
                            sx={{ fontSize: '0.6rem', height: 20 }}
                          />
                        </TableCell>
                        <TableCell sx={{ fontSize: '0.7rem', py: 0.5 }}>{rule.macro || rule.proto || '-'}</TableCell>
                        <TableCell sx={{ fontSize: '0.7rem', py: 0.5, fontFamily: 'JetBrains Mono, monospace' }}>{rule.source || '*'}</TableCell>
                        <TableCell sx={{ fontSize: '0.7rem', py: 0.5, fontFamily: 'JetBrains Mono, monospace' }}>{rule.dest || '*'}</TableCell>
                        <TableCell sx={{ fontSize: '0.7rem', py: 0.5, fontFamily: 'JetBrains Mono, monospace' }}>{rule.dport || '-'}</TableCell>
                        <TableCell sx={{ fontSize: '0.7rem', py: 0.5 }}>{rule.comment || '-'}</TableCell>
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
      <Typography variant='caption' color='text.secondary' sx={{ fontSize: '0.6rem' }}>
        {label}
      </Typography>
    </Box>
  )
}
