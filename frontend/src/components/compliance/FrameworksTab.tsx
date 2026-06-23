'use client'

import { useEffect, useState } from 'react'

import { useTranslations } from 'next-intl'
import {
  Accordion, AccordionDetails, AccordionSummary,
  Alert, Autocomplete, Box, Button, Card, CardContent,
  Chip, CircularProgress, Grid, Link, Table, TableBody,
  TableCell, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'

import CircularGauge from '@/components/dashboard/widgets/CircularGauge'
import { usePVEConnections } from '@/hooks/useConnections'
import { useFrameworkAssessments } from '@/hooks/useFrameworkAssessments'
import { getFramework } from '@/lib/compliance/frameworks'
import type { NodeCheckResult } from '@/lib/compliance/nodeBreakdown'
import {
  breakdownSegments,
  buildReportUrl,
  FRAMEWORK_LOGOS,
  gaugeColor,
  nodeFailCount,
  scoreColor,
  sortNodeChecks,
  triggerDownload,
} from './frameworksTab.helpers'

// Theme-aware tooltip overrides (mirrors InventoryTree.tsx tooltipSlotProps)
const tooltipSlotProps = {
  tooltip: {
    sx: {
      bgcolor: 'background.paper',
      color: 'text.primary',
      border: '1px solid',
      borderColor: 'divider',
      borderRadius: 1.5,
      boxShadow: 3,
      maxWidth: 320,
    },
  },
} as const

function statusChipColor(status: string): 'success' | 'warning' | 'error' | 'default' {
  const key = status.toLowerCase()
  if (key === 'pass' || key === 'satisfied') return 'success'
  if (key === 'warning' || key === 'partial') return 'warning'
  if (key === 'fail' || key === 'failed') return 'error'
  return 'default'
}

interface NodeRowsProps {
  checks: NodeCheckResult[]
  tCol: (k: string) => string
}

function NodeCheckTable({ checks, tCol }: NodeRowsProps) {
  const sorted = sortNodeChecks(checks)
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{tCol('colCategory')}</TableCell>
            <TableCell>{tCol('colCheck')}</TableCell>
            <TableCell>{tCol('colStatus')}</TableCell>
            <TableCell>{tCol('colDetail')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sorted.map((c) => (
            <TableRow key={c.id}>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{c.category}</TableCell>
              <TableCell>{c.name}</TableCell>
              <TableCell>
                <Chip
                  label={c.status}
                  color={statusChipColor(c.status)}
                  size="small"
                  sx={{ fontFamily: 'inherit' }}
                />
              </TableCell>
              <TableCell sx={{ color: 'text.secondary', fontSize: '0.8rem' }}>
                {c.details ?? ''}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  )
}

export default function FrameworksTab() {
  const t = useTranslations('compliance.frameworks')
  const tComp = useTranslations('compliance')
  const theme = useTheme()

  const connections = usePVEConnections().data?.data || []
  const [selectedConnection, setSelectedConnection] = useState<any>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [dlError, setDlError] = useState<string | null>(null)

  // Auto-select first connection (mirrors HardeningTab lines ~270-274)
  useEffect(() => {
    if (connections.length > 0 && !selectedConnection) {
      setSelectedConnection(connections[0])
    }
  }, [connections, selectedConnection])

  const { assessments, nodes, isLoading, error } = useFrameworkAssessments(
    selectedConnection?.id ?? null,
  )

  async function download(frameworkId: string) {
    const connId = selectedConnection?.id
    if (!connId) return
    setBusy(frameworkId)
    setDlError(null)
    try {
      const res = await fetch(buildReportUrl(frameworkId, connId))
      if (!res.ok) throw new Error(t('reportFailed'))
      triggerDownload(await res.blob(), `${frameworkId}.pdf`)
    } catch (e: any) {
      setDlError(e?.message || t('reportFailed'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minHeight: 0 }}>
      {/* Connection selector */}
      <Box sx={{ flexShrink: 0 }}>
        <Autocomplete
          options={connections}
          getOptionLabel={(opt: any) => opt.name || opt.id}
          value={selectedConnection}
          onChange={(_, v) => setSelectedConnection(v)}
          renderInput={(params) => (
            <TextField {...params} label={tComp('selectConnection')} size="small" />
          )}
          sx={{ minWidth: 280 }}
        />
      </Box>

      {dlError && (
        <Alert severity="error" sx={{ flexShrink: 0 }}>
          {dlError}
        </Alert>
      )}

      {isLoading && <CircularProgress />}

      {!isLoading && error && (
        <Alert severity="error">{t('loadFailed')}</Alert>
      )}

      {!isLoading && !error && (
        <>
          {/* 3-up card grid: md=4 each => 3 cards side-by-side on md+ */}
          <Grid container spacing={2}>
            {assessments.map((a) => {
              let def: ReturnType<typeof getFramework> | null = null
              try {
                def = getFramework(a.frameworkId as any)
              } catch {
                return null
              }

              const color = gaugeColor(a.score)
              const label = a.score === null ? t('noAssessedShort') : `${a.score}%`
              const segments = breakdownSegments(a)
              const contextText = t(`context.${a.frameworkId}`)
              const logoSrc = FRAMEWORK_LOGOS[a.frameworkId]

              return (
                <Grid size={{ xs: 12, sm: 6, md: 4 }} key={a.frameworkId}>
                  <Card sx={{ height: '100%' }}>
                    <CardContent
                      sx={{
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 1.5,
                        pb: '16px !important',
                      }}
                    >
                      {/* Header: logo + name + version/baseline + info icon */}
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        {logoSrc && (
                          <Box
                            sx={{
                              flexShrink: 0,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              bgcolor: '#fff',
                              border: '1px solid',
                              borderColor: 'divider',
                              borderRadius: 1,
                              px: 0.75,
                              py: 0.5,
                              height: 40,
                            }}
                          >
                            <Box
                              component="img"
                              src={logoSrc}
                              alt={def.name}
                              sx={{ height: 28, width: 'auto', maxWidth: 80, objectFit: 'contain', display: 'block' }}
                            />
                          </Box>
                        )}
                        <Box sx={{ minWidth: 0 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
                              {def.name}
                            </Typography>
                            <Tooltip
                              title={contextText}
                              placement="top"
                              slotProps={tooltipSlotProps}
                            >
                              <Box
                                component="span"
                                sx={{ display: 'inline-flex', alignItems: 'center', color: 'text.secondary', cursor: 'default' }}
                                aria-label={`info-${a.frameworkId}`}
                              >
                                <i className="ri-information-line" style={{ fontSize: '1rem' }} />
                              </Box>
                            </Tooltip>
                          </Box>
                          <Typography variant="caption" display="block" color="text.secondary">
                            {def.version}
                            {def.baselineLabel ? ` . ${def.baselineLabel}` : ''}
                          </Typography>
                        </Box>
                      </Box>

                      {/* Donut gauge, centered */}
                      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                        <CircularGauge
                          value={a.score ?? 0}
                          color={color}
                          trackColor={theme.palette.divider}
                          size="5em"
                        >
                          <Box
                            component="span"
                            sx={{
                              fontFamily: 'inherit',
                              fontWeight: 700,
                              color: a.score === null ? 'text.secondary' : scoreColor(a.score),
                            }}
                          >
                            {label}
                          </Box>
                        </CircularGauge>
                      </Box>

                      {/* Assessed count */}
                      <Typography variant="body2" align="center">
                        {a.score === null
                          ? t('noAssessed')
                          : `${a.assessedControls} ${t('controlsAssessed')}`}
                      </Typography>

                      {/* Breakdown bar + legend */}
                      <Box>
                        {a.assessedControls > 0 ? (
                          <>
                            {/* Stacked proportional bar */}
                            <Box
                              sx={{
                                display: 'flex',
                                height: 8,
                                borderRadius: 1,
                                overflow: 'hidden',
                                bgcolor: 'divider',
                              }}
                            >
                              {segments.map((seg) =>
                                seg.pct > 0 ? (
                                  <Box
                                    key={seg.key}
                                    sx={{ width: `${seg.pct}%`, bgcolor: seg.color }}
                                  />
                                ) : null,
                              )}
                            </Box>
                            {/* Legend */}
                            <Typography
                              variant="caption"
                              display="block"
                              color="text.secondary"
                              sx={{ mt: 0.5 }}
                            >
                              {segments[0].count} {t('satisfiedShort')}
                              {' . '}
                              {segments[1].count} {t('partialShort')}
                              {' . '}
                              {segments[2].count} {t('failedShort')}
                            </Typography>
                          </>
                        ) : (
                          <Box
                            sx={{
                              height: 8,
                              borderRadius: 1,
                              bgcolor: 'divider',
                              opacity: 0.4,
                            }}
                          />
                        )}
                      </Box>

                      {/* Context: visible clamped to 3 lines */}
                      <Typography
                        variant="caption"
                        display="block"
                        color="text.secondary"
                        data-testid={`context-${a.frameworkId}`}
                        sx={{
                          display: '-webkit-box',
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          flex: 1,
                        }}
                      >
                        {contextText}
                      </Typography>

                      {/* Footer: source link + download */}
                      <Box>
                        {def.sourceUrl && (
                          <Typography variant="caption" display="block" sx={{ mb: 0.75 }}>
                            <Link href={def.sourceUrl} target="_blank" rel="noopener noreferrer">
                              {t('sourceLink')}
                            </Link>
                          </Typography>
                        )}

                        <Button
                          variant="outlined"
                          size="small"
                          fullWidth
                          disabled={busy === a.frameworkId || !selectedConnection}
                          onClick={() => download(a.frameworkId)}
                          startIcon={
                            busy === a.frameworkId ? (
                              <CircularProgress size={14} color="inherit" />
                            ) : (
                              <i className="ri-file-download-line" />
                            )
                          }
                        >
                          {t('downloadReport')}
                        </Button>
                      </Box>
                    </CardContent>
                  </Card>
                </Grid>
              )
            })}
          </Grid>

          {/* Per-node results (unchanged) */}
          {nodes.length > 1 && (
            <Box>
              <Typography variant="subtitle1" sx={{ mb: 1.5, fontWeight: 600 }}>
                {t('perNodeTitle')}
              </Typography>
              {nodes.map((n) => {
                const failCount = nodeFailCount(n.checks)
                return (
                  <Accordion key={n.node} disableGutters>
                    <AccordionSummary expandIcon={<i className="ri-arrow-down-s-line" style={{ fontSize: 18 }} />}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Typography sx={{ fontWeight: 500 }}>{n.node}</Typography>
                        {failCount > 0 && (
                          <Chip
                            label={failCount}
                            color="error"
                            size="small"
                            sx={{ fontFamily: 'inherit' }}
                          />
                        )}
                      </Box>
                    </AccordionSummary>
                    <AccordionDetails sx={{ p: 0 }}>
                      <NodeCheckTable checks={n.checks} tCol={t} />
                    </AccordionDetails>
                  </Accordion>
                )
              })}
            </Box>
          )}
        </>
      )}
    </Box>
  )
}
