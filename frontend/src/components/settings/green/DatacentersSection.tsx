'use client'

import { useCallback, useEffect, useState } from 'react'

import { useTranslations } from 'next-intl'

import {
  Alert, Box, Button, Chip, IconButton, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material'

import DatacenterDialog, { type DatacenterValues } from './DatacenterDialog'

interface DatacenterRow extends DatacenterValues {
  id: string
  clusterCount?: number
  nodeCount?: number
  comment?: string | null
}

export default function DatacentersSection() {
  const t = useTranslations()
  const [rows, setRows] = useState<DatacenterRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<DatacenterRow | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/v1/admin/datacenters')

      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()

      setRows(Array.isArray(json?.data) ? json.data : [])
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const handleDelete = async (row: DatacenterRow) => {
    if (!confirm(t('settings.green.dc.deleteConfirm', { name: row.name }))) return

    try {
      const res = await fetch(`/api/v1/admin/datacenters/${encodeURIComponent(row.id)}`, { method: 'DELETE' })

      if (!res.ok) {
        const json = await res.json().catch(() => ({}))

        throw new Error(json?.error || `HTTP ${res.status}`)
      }

      await load()
    } catch (e: any) {
      setError(e?.message || String(e))
    }
  }

  const handlePromote = async (row: DatacenterRow) => {
    try {
      const res = await fetch(`/api/v1/admin/datacenters/${encodeURIComponent(row.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isDefault: true }),
      })

      if (!res.ok) {
        const json = await res.json().catch(() => ({}))

        throw new Error(json?.error || `HTTP ${res.status}`)
      }

      await load()
    } catch (e: any) {
      setError(e?.message || String(e))
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <i className="ri-building-line" />
          <Typography variant="subtitle1" fontWeight={600}>
            {t('settings.green.dc.sectionTitle')}
          </Typography>
        </Stack>
        <Button
          size="small"
          variant="contained"
          startIcon={<i className="ri-add-line" />}
          onClick={() => { setEditing(null); setDialogOpen(true) }}
        >
          {t('settings.green.dc.add')}
        </Button>
      </Stack>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
        {t('settings.green.dc.sectionHint')}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError(null)}>{error}</Alert>}

      {loading ? (
        <Typography variant="caption" color="text.secondary">…</Typography>
      ) : rows.length === 0 ? (
        <Typography variant="caption" color="text.secondary">{t('settings.green.dc.empty')}</Typography>
      ) : (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('settings.green.dc.name')}</TableCell>
                <TableCell>{t('settings.green.dc.location')}</TableCell>
                <TableCell>{t('settings.green.dc.comment')}</TableCell>
                <TableCell align="right">{t('settings.green.dc.pue')}</TableCell>
                <TableCell align="right">{t('settings.green.dc.electricityPrice')}</TableCell>
                <TableCell align="right">{t('settings.green.dc.co2Factor')}</TableCell>
                <TableCell>{t('settings.green.dc.resources')}</TableCell>
                <TableCell>{t('settings.green.dc.default')}</TableCell>
                <TableCell align="right">{t('common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={500}>{r.name}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {r.locationLabel || (r.country ? r.country : '—')}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Tooltip title={r.comment || ''} placement="top" disableHoverListener={!r.comment}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{
                          display: '-webkit-box',
                          WebkitBoxOrient: 'vertical',
                          WebkitLineClamp: 2,
                          overflow: 'hidden',
                          maxWidth: 220,
                        }}
                      >
                        {r.comment || '—'}
                      </Typography>
                    </Tooltip>
                  </TableCell>
                  <TableCell align="right">{r.pue}</TableCell>
                  <TableCell align="right">{r.electricityPrice} {r.currency}</TableCell>
                  <TableCell align="right">{r.co2Factor} kg/kWh</TableCell>
                  <TableCell>
                    {(r.clusterCount ?? 0) === 0 && (r.nodeCount ?? 0) === 0 ? (
                      <Chip
                        size="small"
                        variant="outlined"
                        color="default"
                        label={t('settings.green.dc.empty')}
                        sx={{ height: 20, fontSize: 10, opacity: 0.6 }}
                      />
                    ) : (
                      <Chip
                        size="small"
                        variant="outlined"
                        color="primary"
                        label={
                          (r.clusterCount ?? 0) > 0
                            ? t('settings.green.dc.resourcesSummary', {
                                clusters: r.clusterCount ?? 0,
                                nodes: r.nodeCount ?? 0,
                              })
                            : t('settings.green.dc.resourcesNodesOnly', { nodes: r.nodeCount ?? 0 })
                        }
                        sx={{ height: 20, fontSize: 10 }}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    {r.isDefault ? (
                      <Chip size="small" icon={<i className="ri-star-fill" style={{ fontSize: 12 }} />} label={t('settings.green.dc.defaultBadge')} color="primary" />
                    ) : (
                      <Tooltip title={t('settings.green.dc.promoteTooltip')}>
                        <Button size="small" variant="text" onClick={() => handlePromote(r)}>
                          {t('settings.green.dc.promote')}
                        </Button>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                      <Tooltip title={t('common.edit')}>
                        <IconButton size="small" onClick={() => { setEditing(r); setDialogOpen(true) }}>
                          <i className="ri-edit-line" style={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('common.delete')}>
                        <span>
                          <IconButton
                            size="small"
                            color="error"
                            disabled={!!r.isDefault}
                            onClick={() => handleDelete(r)}
                          >
                            <i className="ri-delete-bin-line" style={{ fontSize: 16 }} />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <DatacenterDialog
        open={dialogOpen}
        initial={editing}
        onClose={() => setDialogOpen(false)}
        onSaved={() => { void load() }}
      />
    </Paper>
  )
}
