'use client'

import React from 'react'
import { useTranslations } from 'next-intl'
import {
  Alert, Box, Chip, LinearProgress,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography
} from '@mui/material'

function NodesTableWidget({ data, loading }) {
  const t = useTranslations()
  const nodes = data?.nodes || []

  if (nodes.length === 0) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
        <Alert severity='info' sx={{ width: '100%' }}>{t('common.noData')}</Alert>
      </Box>
    )
  }

  return (
    <TableContainer sx={{ height: '100%', overflow: 'auto' }}>
      <Table size='small' stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 800, bgcolor: 'background.paper', fontSize: 12, py: 1 }}>{t('dashboard.widgets.nodes')}</TableCell>
            <TableCell sx={{ fontWeight: 800, bgcolor: 'background.paper', fontSize: 12, py: 1 }}>{t('inventory.clusters')}</TableCell>
            <TableCell align='center' sx={{ fontWeight: 800, bgcolor: 'background.paper', fontSize: 12, py: 1 }}>{t('common.status')}</TableCell>
            <TableCell sx={{ fontWeight: 800, bgcolor: 'background.paper', minWidth: 100, fontSize: 12, py: 1 }}>{t('monitoring.cpu')}</TableCell>
            <TableCell sx={{ fontWeight: 800, bgcolor: 'background.paper', minWidth: 100, fontSize: 12, py: 1 }}>{t('monitoring.memory')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {[...nodes].sort((a, b) => (b.memPct || 0) - (a.memPct || 0)).map((node, idx) => (
            <TableRow key={idx} hover>
              <TableCell sx={{ py: 0.75 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: node.status === 'online' ? '#4caf50' : '#f44336' }} />
                  <Typography variant='body2' sx={{ fontWeight: 700, fontSize: 12 }}>{node.name}</Typography>
                </Box>
              </TableCell>
              <TableCell sx={{ py: 0.75 }}>
                <Typography variant='body2' sx={{ opacity: 0.7, fontSize: 11 }}>{node.connection}</Typography>
              </TableCell>
              <TableCell align='center' sx={{ py: 0.75 }}>
                <Chip
                  size='small'
                  label={node.status === 'online' ? t('common.online') : t('common.offline')}
                  color={node.status === 'online' ? 'success' : 'error'}
                  variant='outlined'
                  sx={{ fontSize: 10, height: 20, fontWeight: 600 }}
                />
              </TableCell>
              <TableCell sx={{ py: 0.75 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <LinearProgress
                    variant='determinate'
                    value={node.cpuPct || 0}
                    sx={{
                      flex: 1, height: 14, borderRadius: 0, bgcolor: 'action.hover',
                      '& .MuiLinearProgress-bar': {
                        borderRadius: 0,
                        bgcolor: (node.cpuPct || 0) > 80 ? '#f44336' : (node.cpuPct || 0) > 60 ? '#ff9800' : '#4caf50'
                      }
                    }}
                  />
                  <Typography variant='body2' sx={{ minWidth: 32, textAlign: 'right', fontWeight: 700, fontSize: 11 }}>
                    {node.cpuPct || 0}%
                  </Typography>
                </Box>
              </TableCell>
              <TableCell sx={{ py: 0.75 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <LinearProgress
                    variant='determinate'
                    value={node.memPct || 0}
                    sx={{
                      flex: 1, height: 14, borderRadius: 0, bgcolor: 'action.hover',
                      '& .MuiLinearProgress-bar': {
                        borderRadius: 0,
                        bgcolor: (node.memPct || 0) > 80 ? '#f44336' : (node.memPct || 0) > 60 ? '#ff9800' : '#4caf50'
                      }
                    }}
                  />
                  <Typography variant='body2' sx={{ minWidth: 32, textAlign: 'right', fontWeight: 700, fontSize: 11 }}>
                    {node.memPct || 0}%
                  </Typography>
                </Box>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}

export default React.memo(NodesTableWidget)
