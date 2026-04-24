'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import PbsStatusChip from './PbsStatusChip'

interface PbsNotificationsTabProps {
  pbsId: string
}

type PbsNotifTarget = {
  name?: string
  type?: string
  comment?: string
  disable?: boolean | number | string
  origin?: string
}

type PbsNotifMatcher = {
  name?: string
  'match-field'?: string | string[]
  'match-severity'?: string | string[]
  'match-calendar'?: string | string[]
  target?: string | string[]
  comment?: string
  disable?: boolean | number | string
  mode?: string
  'invert-match'?: boolean | number | string
  origin?: string
}

type PbsNotifEndpoint = {
  name?: string
  type?: string
  comment?: string
  disable?: boolean | number | string
  origin?: string
  // smtp
  server?: string
  port?: number | string
  'from-address'?: string
  mailto?: string | string[]
  mode?: string
  // gotify / webhook
  url?: string
}

function toArray(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.filter(v => typeof v === 'string' && v.length > 0)
  if (typeof value === 'string' && value.length > 0) {
    return value
      .split(/[,;]+/)
      .map(s => s.trim())
      .filter(Boolean)
  }
  return []
}

function isDisabled(value: boolean | number | string | undefined): boolean {
  if (value === true) return true
  if (value === 1) return true
  if (typeof value === 'string' && (value === '1' || value.toLowerCase() === 'true')) return true
  return false
}

function endpointDetails(e: PbsNotifEndpoint): string {
  const type = e.type
  if (type === 'smtp') {
    const host = e.server ? String(e.server) : ''
    const port = e.port !== undefined && e.port !== '' ? `:${e.port}` : ''
    const from = e['from-address'] ? ` (${e['from-address']})` : ''
    return host ? `${host}${port}${from}` : ''
  }
  if (type === 'gotify' || type === 'webhook') {
    return e.server || e.url || ''
  }
  if (type === 'sendmail') {
    const to = toArray(e.mailto).join(', ')
    return to ? `→ ${to}` : 'sendmail'
  }
  return ''
}

export default function PbsNotificationsTab({ pbsId }: PbsNotificationsTabProps) {
  const t = useTranslations()

  const [targets, setTargets] = useState<PbsNotifTarget[]>([])
  const [endpoints, setEndpoints] = useState<PbsNotifEndpoint[]>([])
  const [matchers, setMatchers] = useState<PbsNotifMatcher[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [tRes, eRes, mRes] = await Promise.all([
        fetch(`/api/v1/pbs/${pbsId}/notifications/targets`, { cache: 'no-store' }),
        fetch(`/api/v1/pbs/${pbsId}/notifications/endpoints`, { cache: 'no-store' }),
        fetch(`/api/v1/pbs/${pbsId}/notifications/matchers`, { cache: 'no-store' }),
      ])

      for (const r of [tRes, eRes, mRes]) {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body?.error || `HTTP ${r.status}`)
        }
      }

      const [tBody, eBody, mBody] = await Promise.all([tRes.json(), eRes.json(), mRes.json()])

      setTargets(Array.isArray(tBody?.data) ? tBody.data : [])
      setEndpoints(Array.isArray(eBody?.data) ? eBody.data : [])
      setMatchers(Array.isArray(mBody?.data) ? mBody.data : [])
    } catch (err: any) {
      setError(err?.message || String(err))
    } finally {
      setLoading(false)
    }
  }, [pbsId])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  const renderStatusChip = (disabled: boolean) =>
    disabled ? (
      <Chip
        size="small"
        label={t('inventory.pbsNotifStatusDisabled')}
        variant="outlined"
        sx={{ fontSize: 11 }}
      />
    ) : (
      <PbsStatusChip color="success" label={t('inventory.pbsNotifStatusActive')} sx={{ fontSize: 11 }} />
    )

  const renderOrigin = (origin?: string) =>
    origin ? (
      <Chip size="small" label={origin} variant="outlined" sx={{ fontSize: 11 }} />
    ) : (
      <Typography variant="caption" sx={{ opacity: 0.6 }}>
        —
      </Typography>
    )

  const renderComment = (comment?: string) => (
    <Typography
      variant="caption"
      sx={{
        display: 'block',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {comment || '—'}
    </Typography>
  )

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
      {/* Toolbar */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
          flexWrap: 'wrap',
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <Button
            variant="outlined"
            size="small"
            onClick={fetchAll}
            disabled={loading}
            startIcon={<i className="ri-refresh-line" style={{ fontSize: 16 }} />}
          >
            {t('inventory.pbsNotifRefresh')}
          </Button>
        </Stack>
      </Box>

      {/* Content */}
      {loading && targets.length === 0 && endpoints.length === 0 && matchers.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, py: 6 }}>
          <CircularProgress size={32} />
        </Box>
      ) : error ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={fetchAll}>
              {t('inventory.pbsNotifRefresh')}
            </Button>
          }
        >
          {t('inventory.pbsNotifLoadError')}: {error}
        </Alert>
      ) : (
        <Stack spacing={1.5}>
          {/* Targets */}
          <Accordion defaultExpanded disableGutters variant="outlined">
            <AccordionSummary expandIcon={<i className="ri-arrow-down-s-line" style={{ fontSize: 20 }} />}>
              <Typography fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className="ri-focus-3-line" style={{ fontSize: 18, opacity: 0.7 }} />
                {t('inventory.pbsNotifTargets')} ({targets.length})
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ p: 0 }}>
              {targets.length === 0 ? (
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    py: 4,
                    opacity: 0.7,
                    gap: 1,
                  }}
                >
                  <i className="ri-focus-3-line" style={{ fontSize: 40 }} />
                  <Typography variant="body2">{t('inventory.pbsNotifEmptyTargets')}</Typography>
                  <Typography variant="caption" sx={{ opacity: 0.7 }}>
                    {t('inventory.pbsNotifEmptyHint')}
                  </Typography>
                </Box>
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>{t('inventory.pbsNotifCol.name')}</TableCell>
                        <TableCell>{t('inventory.pbsNotifCol.type')}</TableCell>
                        <TableCell>{t('inventory.pbsNotifCol.disabled')}</TableCell>
                        <TableCell>{t('inventory.pbsNotifCol.origin')}</TableCell>
                        <TableCell>{t('inventory.pbsNotifCol.comment')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {targets.map((tg, idx) => {
                        const disabled = isDisabled(tg.disable)
                        return (
                          <TableRow key={tg.name || `target-${idx}`} hover>
                            <TableCell sx={{ fontSize: 12 }}>
                              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                                {tg.name || '—'}
                              </Typography>
                            </TableCell>
                            <TableCell sx={{ fontSize: 12 }}>
                              {tg.type ? (
                                <Chip size="small" label={tg.type} variant="outlined" sx={{ fontSize: 11 }} />
                              ) : (
                                <Typography variant="caption" sx={{ opacity: 0.6 }}>
                                  —
                                </Typography>
                              )}
                            </TableCell>
                            <TableCell sx={{ fontSize: 12 }}>{renderStatusChip(disabled)}</TableCell>
                            <TableCell sx={{ fontSize: 12 }}>{renderOrigin(tg.origin)}</TableCell>
                            <TableCell sx={{ fontSize: 12, maxWidth: 280 }}>{renderComment(tg.comment)}</TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </AccordionDetails>
          </Accordion>

          {/* Endpoints */}
          <Accordion defaultExpanded disableGutters variant="outlined">
            <AccordionSummary expandIcon={<i className="ri-arrow-down-s-line" style={{ fontSize: 20 }} />}>
              <Typography fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className="ri-send-plane-line" style={{ fontSize: 18, opacity: 0.7 }} />
                {t('inventory.pbsNotifEndpoints')} ({endpoints.length})
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ p: 0 }}>
              {endpoints.length === 0 ? (
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    py: 4,
                    opacity: 0.7,
                    gap: 1,
                  }}
                >
                  <i className="ri-send-plane-line" style={{ fontSize: 40 }} />
                  <Typography variant="body2">{t('inventory.pbsNotifEmptyEndpoints')}</Typography>
                  <Typography variant="caption" sx={{ opacity: 0.7 }}>
                    {t('inventory.pbsNotifEmptyHint')}
                  </Typography>
                </Box>
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>{t('inventory.pbsNotifCol.name')}</TableCell>
                        <TableCell>{t('inventory.pbsNotifCol.type')}</TableCell>
                        <TableCell>{t('inventory.pbsNotifCol.disabled')}</TableCell>
                        <TableCell>{t('inventory.pbsNotifCol.details')}</TableCell>
                        <TableCell>{t('inventory.pbsNotifCol.comment')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {endpoints.map((ep, idx) => {
                        const disabled = isDisabled(ep.disable)
                        const details = endpointDetails(ep)
                        return (
                          <TableRow key={`${ep.type || 'ep'}-${ep.name || idx}`} hover>
                            <TableCell sx={{ fontSize: 12 }}>
                              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                                {ep.name || '—'}
                              </Typography>
                            </TableCell>
                            <TableCell sx={{ fontSize: 12 }}>
                              {ep.type ? (
                                <Chip size="small" label={ep.type} variant="outlined" sx={{ fontSize: 11 }} />
                              ) : (
                                <Typography variant="caption" sx={{ opacity: 0.6 }}>
                                  —
                                </Typography>
                              )}
                            </TableCell>
                            <TableCell sx={{ fontSize: 12 }}>{renderStatusChip(disabled)}</TableCell>
                            <TableCell sx={{ fontSize: 12, maxWidth: 320 }}>
                              {details ? (
                                <Typography
                                  variant="caption"
                                  sx={{
                                    display: 'block',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {details}
                                </Typography>
                              ) : (
                                <Typography variant="caption" sx={{ opacity: 0.6 }}>
                                  —
                                </Typography>
                              )}
                            </TableCell>
                            <TableCell sx={{ fontSize: 12, maxWidth: 280 }}>{renderComment(ep.comment)}</TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </AccordionDetails>
          </Accordion>

          {/* Matchers */}
          <Accordion defaultExpanded disableGutters variant="outlined">
            <AccordionSummary expandIcon={<i className="ri-arrow-down-s-line" style={{ fontSize: 20 }} />}>
              <Typography fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className="ri-filter-3-line" style={{ fontSize: 18, opacity: 0.7 }} />
                {t('inventory.pbsNotifMatchers')} ({matchers.length})
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ p: 0 }}>
              {matchers.length === 0 ? (
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    py: 4,
                    opacity: 0.7,
                    gap: 1,
                  }}
                >
                  <i className="ri-filter-3-line" style={{ fontSize: 40 }} />
                  <Typography variant="body2">{t('inventory.pbsNotifEmptyMatchers')}</Typography>
                  <Typography variant="caption" sx={{ opacity: 0.7 }}>
                    {t('inventory.pbsNotifEmptyHint')}
                  </Typography>
                </Box>
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>{t('inventory.pbsNotifCol.name')}</TableCell>
                        <TableCell>{t('inventory.pbsNotifCol.mode')}</TableCell>
                        <TableCell>{t('inventory.pbsNotifCol.matchSeverity')}</TableCell>
                        <TableCell>{t('inventory.pbsNotifCol.matchField')}</TableCell>
                        <TableCell>{t('inventory.pbsNotifCol.target')}</TableCell>
                        <TableCell>{t('inventory.pbsNotifCol.disabled')}</TableCell>
                        <TableCell>{t('inventory.pbsNotifCol.origin')}</TableCell>
                        <TableCell>{t('inventory.pbsNotifCol.comment')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {matchers.map((m, idx) => {
                        const disabled = isDisabled(m.disable)
                        const severity = toArray(m['match-severity'])
                        const fields = toArray(m['match-field'])
                        const tgts = toArray(m.target)
                        return (
                          <TableRow key={m.name || `matcher-${idx}`} hover>
                            <TableCell sx={{ fontSize: 12 }}>
                              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                                {m.name || '—'}
                              </Typography>
                            </TableCell>
                            <TableCell sx={{ fontSize: 12 }}>
                              {m.mode ? (
                                <Chip
                                  size="small"
                                  label={m.mode}
                                  variant="outlined"
                                  sx={{ fontSize: 11 }}
                                />
                              ) : (
                                <Typography variant="caption" sx={{ opacity: 0.6 }}>
                                  —
                                </Typography>
                              )}
                            </TableCell>
                            <TableCell sx={{ fontSize: 12 }}>
                              {severity.length === 0 ? (
                                <Typography variant="caption" sx={{ opacity: 0.6 }}>
                                  —
                                </Typography>
                              ) : (
                                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                                  {severity.map(s => (
                                    <Chip
                                      key={s}
                                      size="small"
                                      label={s}
                                      variant="outlined"
                                      sx={{ fontSize: 11 }}
                                    />
                                  ))}
                                </Stack>
                              )}
                            </TableCell>
                            <TableCell sx={{ fontSize: 12, maxWidth: 240 }}>
                              {fields.length === 0 ? (
                                <Typography variant="caption" sx={{ opacity: 0.6 }}>
                                  —
                                </Typography>
                              ) : (
                                <Stack spacing={0.25}>
                                  {fields.map(f => (
                                    <Typography key={f} variant="caption">
                                      {f}
                                    </Typography>
                                  ))}
                                </Stack>
                              )}
                            </TableCell>
                            <TableCell sx={{ fontSize: 12 }}>
                              {tgts.length === 0 ? (
                                <Typography variant="caption" sx={{ opacity: 0.6 }}>
                                  —
                                </Typography>
                              ) : (
                                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                                  {tgts.map(ttg => (
                                    <Chip
                                      key={ttg}
                                      size="small"
                                      color="primary"
                                      variant="outlined"
                                      label={ttg}
                                      sx={{ fontSize: 11 }}
                                    />
                                  ))}
                                </Stack>
                              )}
                            </TableCell>
                            <TableCell sx={{ fontSize: 12 }}>{renderStatusChip(disabled)}</TableCell>
                            <TableCell sx={{ fontSize: 12 }}>{renderOrigin(m.origin)}</TableCell>
                            <TableCell sx={{ fontSize: 12, maxWidth: 240 }}>{renderComment(m.comment)}</TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </AccordionDetails>
          </Accordion>
        </Stack>
      )}
    </Box>
  )
}
