'use client'

import { useTranslations } from 'next-intl'
import { Box, Chip, CircularProgress, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'

import { buildSmartView } from '@/lib/disks/smartView'

type Props = { smart: unknown; loading: boolean }

/**
 * Render /nodes/{node}/disks/smart?disk=.
 *
 * Driven by the response SHAPE, not by a guessed device type: `attributes` is
 * optional in the Proxmox schema and is genuinely absent on virtualized disks,
 * where PVE returns a plain text blob instead.
 */
export default function SmartDetail({ smart, loading }: Props) {
  const t = useTranslations()

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
        <CircularProgress size={20} />
      </Box>
    )
  }

  const view = buildSmartView(smart)

  if (view.kind === 'unavailable') {
    return (
      <Box sx={{ py: 1.5, textAlign: 'center', opacity: 0.6 }}>
        <Typography variant="caption">{t('inventory.smartUnavailable')}</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ py: 1 }}>
      {view.health && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Typography variant="caption" sx={{ fontWeight: 700 }}>{t('inventory.health.label')}</Typography>
          <Chip size="small" label={view.health}
            color={view.health.toUpperCase() === 'FAILED' ? 'error' : 'success'}
            sx={{ height: 20, fontSize: 10 }} />
        </Box>
      )}

      {view.kind === 'attributes' ? (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>ID</TableCell>
              <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>{t('inventory.smartAttribute')}</TableCell>
              <TableCell sx={{ fontWeight: 700, fontSize: 11, textAlign: 'right' }}>{t('inventory.smartValue')}</TableCell>
              <TableCell sx={{ fontWeight: 700, fontSize: 11, textAlign: 'right' }}>{t('inventory.smartWorst')}</TableCell>
              <TableCell sx={{ fontWeight: 700, fontSize: 11, textAlign: 'right' }}>{t('inventory.smartThreshold')}</TableCell>
              <TableCell sx={{ fontWeight: 700, fontSize: 11, textAlign: 'right' }}>{t('inventory.smartRaw')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {view.rows.map((r, i) => (
              <TableRow key={i} hover>
                <TableCell sx={{ fontSize: 11 }}>{r.id ?? '-'}</TableCell>
                <TableCell sx={{ fontSize: 11 }}>
                  {r.failing && (
                    <i className="ri-error-warning-fill" title={t('inventory.smartBelowThreshold')}
                      style={{ fontSize: 12, color: 'var(--mui-palette-error-main)', marginRight: 4 }} />
                  )}
                  {r.name}
                </TableCell>
                <TableCell sx={{ fontSize: 11, textAlign: 'right', fontFamily: 'monospace' }}>{r.value ?? '-'}</TableCell>
                <TableCell sx={{ fontSize: 11, textAlign: 'right', fontFamily: 'monospace' }}>{r.worst ?? '-'}</TableCell>
                <TableCell sx={{ fontSize: 11, textAlign: 'right', fontFamily: 'monospace' }}>{r.threshold ?? '-'}</TableCell>
                <TableCell sx={{ fontSize: 11, textAlign: 'right', fontFamily: 'monospace' }}>{r.raw ?? '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <Box component="pre" sx={{ m: 0, fontSize: 11, fontFamily: 'monospace', whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto' }}>
          {view.text}
        </Box>
      )}
    </Box>
  )
}
