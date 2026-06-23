'use client'

import { useEffect, useState } from 'react'

import { useTranslations } from 'next-intl'
import {
  Alert, Autocomplete, Box, Button, Card, CardContent,
  CircularProgress, Grid, TextField, Typography,
} from '@mui/material'

import { usePVEConnections } from '@/hooks/useConnections'
import { useFrameworkAssessments } from '@/hooks/useFrameworkAssessments'
import { getFramework } from '@/lib/compliance/frameworks'
import { buildReportUrl, coverageLabel, scoreColor, triggerDownload } from './frameworksTab.helpers'

export default function FrameworksTab() {
  const t = useTranslations('compliance.frameworks')
  const tComp = useTranslations('compliance')

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

  const { assessments, isLoading, error } = useFrameworkAssessments(
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
        <Grid container spacing={2}>
          {assessments.map((a) => {
            let def: ReturnType<typeof getFramework> | null = null
            try {
              def = getFramework(a.frameworkId as any)
            } catch {
              return null
            }

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

                    <Typography
                      variant="h3"
                      sx={{ color: a.score === null ? 'text.secondary' : scoreColor(a.score), mb: 1 }}
                    >
                      {a.score === null ? t('noAssessed') : `${a.score}%`}
                    </Typography>

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
      )}
    </Box>
  )
}
