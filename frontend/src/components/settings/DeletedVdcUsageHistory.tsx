'use client'

// vDC settings, "Usage history" section (#902): the deleted vDCs whose usage
// samples are still kept, each with its chart and CSV export, until the
// retention purges them.

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'

import {
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'

import VdcUsageHistoryChart, { rangeHolding } from '@/components/vdc/VdcUsageHistoryChart'

interface DeletedVdc {
  vdcId: string
  vdcName: string
  tenantId: string
  tenantName: string
  firstSampledAt: string
  lastSampledAt: string
  samples: number
}

export default function DeletedVdcUsageHistory() {
  const t = useTranslations('vdcUsageHistory')
  const tc = useTranslations('common')
  const locale = useLocale()

  const [rows, setRows] = useState<DeletedVdc[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(20)
  const [open, setOpen] = useState<DeletedVdc | null>(null)

  useEffect(() => {
    let cancelled = false

    fetch('/api/v1/admin/vdc-usage-history/deleted', { cache: 'no-store' })
      .then(async res => {
        const json = await res.json().catch(() => ({}))

        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
        if (!cancelled) setRows(Array.isArray(json?.data) ? json.data : [])
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message || String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })
  const shown = rows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)

  return (
    <Card sx={{ mt: 2 }}>
      <CardContent>
        <Box sx={{ mb: 2 }}>
          <Typography variant="h6">{t('deletedTitle')}</Typography>
          <Typography variant="body2" color="text.secondary">{t('deletedSubtitle')}</Typography>
        </Box>

        {loading ? (
          <LinearProgress />
        ) : error ? (
          <Typography variant="body2" color="error">{error}</Typography>
        ) : rows.length === 0 ? (
          <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
            <i className="ri-cloud-off-line" style={{ fontSize: 32, opacity: 0.4 }} />
            <Typography variant="body2" sx={{ mt: 1 }}>{t('deletedEmpty')}</Typography>
          </Box>
        ) : (
          <>
            <Table size="small" data-testid="deleted-vdc-history">
              <TableHead>
                <TableRow>
                  <TableCell>{t('colVdc')}</TableCell>
                  <TableCell>{t('colTenant')}</TableCell>
                  <TableCell>{t('colSampled')}</TableCell>
                  <TableCell align="right">{t('samples')}</TableCell>
                  <TableCell width={56} />
                </TableRow>
              </TableHead>
              <TableBody>
                {shown.map(r => (
                  <TableRow key={r.vdcId} hover>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box component="i" className="ri-cloud-off-line" sx={{ fontSize: 16, color: 'text.secondary' }} />
                        <Typography variant="body2" noWrap>{r.vdcName}</Typography>
                      </Box>
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box component="i" className="ri-building-line" sx={{ fontSize: 16, color: 'text.secondary' }} />
                        <Typography variant="body2" noWrap>{r.tenantName}</Typography>
                      </Box>
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {t('sampledBetween', {
                          from: dateFmt.format(new Date(r.firstSampledAt)),
                          to: dateFmt.format(new Date(r.lastSampledAt)),
                        })}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">{r.samples}</TableCell>
                    <TableCell>
                      <Tooltip title={t('title')}>
                        <IconButton size="small" aria-label={t('title')} onClick={() => setOpen(r)}>
                          <i className="ri-line-chart-line" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <TablePagination
              component="div"
              count={rows.length}
              page={page}
              onPageChange={(_e, p) => setPage(p)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={e => {
                setRowsPerPage(Number(e.target.value))
                setPage(0)
              }}
              rowsPerPageOptions={[20, 50, 100]}
              labelRowsPerPage={tc('rowsPerPage')}
            />
          </>
        )}
      </CardContent>

      <Dialog open={!!open} onClose={() => setOpen(null)} maxWidth="md" fullWidth>
        <DialogTitle>{t('dialogTitleDeleted', { name: open?.vdcName || '' })}</DialogTitle>
        <DialogContent>
          {open && (
            <VdcUsageHistoryChart
              bare
              historyUrl={`/api/v1/admin/vdcs/${encodeURIComponent(open.vdcId)}/usage/history`}
              initialRange={rangeHolding(open.lastSampledAt)}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(null)}>{tc('close')}</Button>
        </DialogActions>
      </Dialog>
    </Card>
  )
}
