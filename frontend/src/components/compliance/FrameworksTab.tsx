'use client'

import { useEffect, useState } from 'react'

import { useTranslations } from 'next-intl'
import {
  Accordion, AccordionDetails, AccordionSummary,
  Alert, Autocomplete, Box, Button, Card, CardContent,
  Chip, CircularProgress, Grid, Table, TableBody,
  TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'

import CircularGauge from '@/components/dashboard/widgets/CircularGauge'
import { usePVEConnections } from '@/hooks/useConnections'
import { useFrameworkAssessments } from '@/hooks/useFrameworkAssessments'
import { getFramework } from '@/lib/compliance/frameworks'
import type { NodeCheckResult } from '@/lib/compliance/nodeBreakdown'
import {
  buildReportUrl,
  coverageLabel,
  gaugeColor,
  nodeFailCount,
  scoreColor,
  sortNodeChecks,
  triggerDownload,
} from './frameworksTab.helpers'

function statusChipColor(status: string): 'success' | 'warning' | 'error' | 'default' {
  const key = status.toLowerCase()
  if (key === 'pass' || key === 'satisfied') return 'success'
  if (key === 'warning' || key === 'partial') return 'warning'
  if (key === 'fail') return 'error'
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
      {/* Connection selector (mirrors page.tsx lines ~304-313) */}
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

              return (
                <Grid size={{ xs: 12, md: 4 }} key={a.frameworkId}>
                  <Card sx={{ height: '100%' }}>
                    <CardContent>
                      <Typography variant="h6" gutterBottom>
                        {def.name} {def.version}
                      </Typography>

                      {def.baselineLabel && (
                        <Typography variant="caption" display="block" color="text.secondary" sx={{ mb: 1 }}>
                          {def.baselineLabel}
                        </Typography>
                      )}

                      <Box sx={{ display: 'flex', justifyContent: 'center', my: 1.5 }}>
                        <CircularGauge
                          value={a.score ?? 0}
                          color={color}
                          trackColor={theme.palette.divider}
                          size="5.5em"
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

                      <Typography variant="body2" sx={{ mb: 1 }}>
                        {coverageLabel(a)} {t('controlsAssessed')}
                      </Typography>

                      {def.provenanceNote && (
                        <Typography variant="caption" display="block" color="text.secondary" sx={{ mb: 1 }}>
                          {def.provenanceNote}
                        </Typography>
                      )}

                      {a.families.length > 0 && (
                        <Box sx={{ mb: 1 }}>
                          {a.families.map((f) => (
                            <Typography variant="caption" display="block" key={f.family}>
                              {f.family}: {f.satisfied}/{f.satisfied + f.partial + f.failed + f.notAssessed}
                            </Typography>
                          ))}
                        </Box>
                      )}

                      <Button
                        sx={{ mt: 1 }}
                        variant="outlined"
                        size="small"
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
                    </CardContent>
                  </Card>
                </Grid>
              )
            })}
          </Grid>

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
