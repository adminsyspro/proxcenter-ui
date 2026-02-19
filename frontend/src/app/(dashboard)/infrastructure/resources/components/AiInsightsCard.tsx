'use client'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Typography,
  useTheme,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useTranslations } from 'next-intl'

import type { AiAnalysis } from '../types'
import { COLORS } from '../constants'
import {
  PsychologyIcon, BoltIcon, RocketLaunchIcon,
  ErrorIcon, WarningAmberIcon, InsightsIcon, CheckCircleIcon,
} from './icons'

export default function AiInsightsCard({ analysis, onAnalyze, loading }: { analysis: AiAnalysis; onAnalyze: () => void; loading?: boolean }) {
  const theme = useTheme()
  const t = useTranslations()

  const isAi = analysis.provider === 'ollama'

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high': return COLORS.error
      case 'medium': return COLORS.warning
      case 'low': return COLORS.info
      default: return COLORS.success
    }
  }

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'high': return <ErrorIcon sx={{ fontSize: 18 }} />
      case 'medium': return <WarningAmberIcon sx={{ fontSize: 18 }} />
      case 'low': return <InsightsIcon sx={{ fontSize: 18 }} />
      default: return <CheckCircleIcon sx={{ fontSize: 18 }} />
    }
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'prediction': return '🔮'
      case 'optimization': return '⚡'
      case 'overprovisioned': return '📦'
      case 'underused': return '💤'
      case 'stopped': return '⏹️'
      default: return '💡'
    }
  }

  return (
    <Card sx={{ height: '100%', background: `linear-gradient(180deg, ${alpha(COLORS.primary, 0.03)} 0%, transparent 100%)`, border: '1px solid', borderColor: alpha(COLORS.primary, 0.2) }}>
      <CardContent sx={{ p: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2.5 }}>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Box sx={{ p: 1, borderRadius: 2, bgcolor: alpha(COLORS.primary, 0.1), color: COLORS.primary, display: 'flex' }}>
              {isAi ? <PsychologyIcon /> : <i className="ri-sparkling-line" style={{ fontSize: 20 }} />}
            </Box>
            <Box>
              <Typography variant="h6" fontWeight={700}>
                {isAi ? t('resources.aiIntelligence') : t('resources.smartAnalysis')}
              </Typography>
              {analysis.provider && (
                <Typography variant="caption" color="text.secondary">
                  {isAi ? t('resources.poweredBy', { provider: t('resources.ollamaLocal') }) : t('resources.ruleBasedSubtitle')}
                </Typography>
              )}
            </Box>
          </Stack>
          {isAi && (
            <Button variant={analysis.summary ? 'outlined' : 'contained'} size="small" startIcon={analysis.loading ? <CircularProgress size={16} color="inherit" /> : <BoltIcon />} onClick={onAnalyze} disabled={analysis.loading || loading} sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 600 }}>
              {analysis.loading ? t('resources.analyzing') : analysis.summary ? t('resources.refresh') : t('resources.analyze')}
            </Button>
          )}
        </Stack>

        {analysis.error && <Alert severity="error" sx={{ mb: 2 }}>{analysis.error}</Alert>}

        {analysis.summary && (
          <Paper sx={{ p: 2.5, mb: 2.5, bgcolor: alpha(COLORS.primary, 0.04), border: '1px solid', borderColor: alpha(COLORS.primary, 0.15), borderRadius: 2 }}>
            <Stack direction="row" spacing={1.5} alignItems="flex-start">
              <RocketLaunchIcon sx={{ color: COLORS.primary, fontSize: 20, mt: 0.25 }} />
              <Typography variant="body2" sx={{ lineHeight: 1.7 }}>{analysis.summary}</Typography>
            </Stack>
          </Paper>
        )}

        {analysis.recommendations.length > 0 && (
          <Box>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>{t('resources.recommendations')} ({analysis.recommendations.length})</Typography>
            <Stack spacing={1.5}>
              {analysis.recommendations.slice(0, 5).map(rec => {
                const severityColor = getSeverityColor(rec.severity)
                return (
                  <Paper key={rec.id} sx={{ p: 2, border: '1px solid', borderColor: alpha(severityColor, 0.25), bgcolor: alpha(severityColor, 0.03), borderRadius: 2, '&:hover': { bgcolor: alpha(severityColor, 0.06), transform: 'translateX(4px)' }, transition: 'all 0.2s' }}>
                    <Stack direction="row" spacing={1.5} alignItems="flex-start">
                      <Typography sx={{ fontSize: 18 }}>{getTypeIcon(rec.type)}</Typography>
                      <Box sx={{ flex: 1 }}>
                        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                          <Typography variant="subtitle2" fontWeight={700}>{rec.title}</Typography>
                          {rec.savings && <Chip size="small" label={rec.savings} sx={{ height: 18, fontSize: '0.65rem', bgcolor: alpha(COLORS.success, 0.1), color: COLORS.success, fontWeight: 600 }} />}
                        </Stack>
                        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.5 }}>{rec.description}</Typography>
                        {rec.vmName && <Chip size="small" label={rec.vmName} sx={{ mt: 1, height: 20, fontSize: '0.7rem' }} />}
                      </Box>
                      <Box sx={{ color: severityColor }}>{getSeverityIcon(rec.severity)}</Box>
                    </Stack>
                  </Paper>
                )
              })}
            </Stack>
          </Box>
        )}

        {!analysis.loading && !analysis.summary && analysis.recommendations.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <PsychologyIcon sx={{ fontSize: 64, color: alpha(COLORS.primary, 0.2), mb: 2 }} />
            <Typography variant="body1" fontWeight={600}>{t('resources.analyzeInfra')}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 300, mx: 'auto' }}>{t('resources.aiWillAnalyze')}</Typography>
          </Box>
        )}
      </CardContent>
    </Card>
  )
}
