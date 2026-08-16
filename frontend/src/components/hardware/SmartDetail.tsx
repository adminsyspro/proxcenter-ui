'use client'

import { useTranslations } from 'next-intl'
import { Box, Chip, CircularProgress, Divider, LinearProgress, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'

import { buildSmartView } from '@/lib/disks/smartView'
import { parseSmartText, type SmartTextDirection } from '@/lib/disks/smartText'

type Props = { smart: unknown; loading: boolean }

/**
 * Colour a percentage bar by what "high" means for that metric. Two SMART
 * percentages mean opposite things (see `smartText.ts`): painting both the
 * same way would repeat the remaining-vs-consumed-life bug this branch
 * already fixed elsewhere, so the thresholds are mirrored between the two
 * known directions and unknown ones never get a health-coded colour.
 */
function smartBarColor(direction: SmartTextDirection, percent: number): 'success' | 'warning' | 'error' | 'primary' {
  if (direction === 'higher-is-better') {
    if (percent >= 50) return 'success'
    if (percent >= 20) return 'warning'
    return 'error'
  }

  if (direction === 'higher-is-worse') {
    if (percent >= 80) return 'error'
    if (percent >= 50) return 'warning'
    return 'success'
  }

  return 'primary'
}

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
            color={
              ['OK', 'PASSED'].includes(view.health.toUpperCase())
                ? 'success'
                : view.health.toUpperCase() === 'FAILED' ? 'error' : 'warning'
            }
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
        (() => {
          const parsed = parseSmartText(view.text)

          return (
            <Box>
              {parsed.header && (
                <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: 12, mb: 0.5 }}>
                  {parsed.header}
                </Typography>
              )}

              {parsed.rows.length > 0 && (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>{t('inventory.smartAttribute')}</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>{t('inventory.smartValue')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {parsed.rows.map((row, i) => (
                      <TableRow key={i} hover>
                        <TableCell sx={{ fontSize: 11 }}>{row.label}</TableCell>
                        <TableCell sx={{ fontSize: 11 }}>
                          {row.percent !== null && !row.isReference ? (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <LinearProgress
                                variant="determinate"
                                value={row.percent}
                                color={smartBarColor(row.direction, row.percent)}
                                sx={{ width: 60, height: 8, borderRadius: 1, bgcolor: 'action.hover', '& .MuiLinearProgress-bar': { borderRadius: 1 } }}
                              />
                              <Typography component="span" sx={{ fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
                                {row.value}
                              </Typography>
                            </Box>
                          ) : (
                            <Typography component="span" sx={{ fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
                              {row.value}
                            </Typography>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {parsed.leftover.length > 0 && (
                <Box sx={{ mt: 1 }}>
                  <Divider sx={{ mb: 1 }} />
                  {parsed.leftover.map((line, i) => (
                    <Typography key={i} variant="caption" sx={{ display: 'block', opacity: 0.7, whiteSpace: 'pre-wrap' }}>
                      {line}
                    </Typography>
                  ))}
                </Box>
              )}
            </Box>
          )
        })()
      )}
    </Box>
  )
}
