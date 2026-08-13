'use client'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  LinearProgress,
  Paper,
  Skeleton,
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
  const isBasic = analysis.provider === 'basic'

  // Resolve i18n keys for basic (rule-based) provider
  const resolvedSummary = isBasic && analysis.summaryKey
    ? t(analysis.summaryKey, analysis.summaryParams)
    : analysis.summary

  const resolveRec = (rec: typeof analysis.recommendations[number]) => ({
    title: isBasic && rec.titleKey ? t(rec.titleKey, rec.params) : rec.title,
    description: isBasic && rec.descriptionKey ? t(rec.descriptionKey, rec.params) : rec.description,
    savings: isBasic && rec.savingsKey ? t(rec.savingsKey, rec.params) : rec.savings,
  })

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

  const pending = Boolean(analysis.loading)
  const hasContent = Boolean(resolvedSummary || analysis.recommendations.length > 0)

  /**
   * Placeholder for the very first analysis, shaped like the answer it waits
   * for: a summary block then recommendation rows. A local model answers in
   * tens of seconds, and until now the card simply emptied itself for that
   * whole time — the 16px spinner in the button was the only sign anything
   * was happening, which reads as a hung page rather than a slow one.
   */
  const skeleton = (
    <Box data-testid="ai-insights-skeleton" aria-busy="true">
      <Paper sx={{ p: 2.5, mb: 2.5, bgcolor: alpha(COLORS.primary, 0.04), border: '1px solid', borderColor: alpha(COLORS.primary, 0.15), borderRadius: 2 }}>
        <Stack direction="row" spacing={1.5} alignItems="flex-start">
          <Skeleton variant="circular" width={20} height={20} sx={{ mt: 0.25, flexShrink: 0 }} />
          <Box sx={{ flex: 1 }}>
            <Skeleton variant="text" width="100%" />
            <Skeleton variant="text" width="92%" />
            <Skeleton variant="text" width="64%" />
          </Box>
        </Stack>
      </Paper>

      <Skeleton variant="text" width={180} sx={{ mb: 1.5 }} />

      <Stack spacing={1.5}>
        {[0, 1, 2].map(row => (
          <Paper key={row} sx={{ p: 2, border: '1px solid', borderColor: alpha(COLORS.primary, 0.12), borderRadius: 2 }}>
            <Stack direction="row" spacing={1.5} alignItems="flex-start">
              <Skeleton variant="circular" width={18} height={18} sx={{ flexShrink: 0 }} />
              <Box sx={{ flex: 1 }}>
                <Skeleton variant="text" width="45%" />
                <Skeleton variant="text" width="88%" />
              </Box>
              <Skeleton variant="circular" width={18} height={18} sx={{ flexShrink: 0 }} />
            </Stack>
          </Paper>
        ))}
      </Stack>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mt: 2.5 }}>
        {t('resources.analysisMayTakeAWhile')}
      </Typography>
    </Box>
  )

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

        {/* A refresh keeps the previous answer on screen rather than blanking
            the card: the old figures stay readable while the new ones are
            computed. The bar says work is in flight, the dimming says what is
            below it is stale, and pointer events are off so nothing invites a
            click on a value about to change. */}
        {pending && hasContent && (
          <LinearProgress
            aria-label={t('resources.analyzing')}
            sx={{ mb: 2, borderRadius: 1, height: 4 }}
          />
        )}

        {pending && !hasContent && skeleton}

        <Box sx={pending && hasContent ? { opacity: 0.5, pointerEvents: 'none', transition: 'opacity 0.2s' } : undefined}>

        {(resolvedSummary || analysis.summary) && (
          <Paper sx={{ p: 2.5, mb: 2.5, bgcolor: alpha(COLORS.primary, 0.04), border: '1px solid', borderColor: alpha(COLORS.primary, 0.15), borderRadius: 2 }}>
            <Stack direction="row" spacing={1.5} alignItems="flex-start">
              <RocketLaunchIcon sx={{ color: COLORS.primary, fontSize: 20, mt: 0.25 }} />
              <Typography variant="body2" sx={{ lineHeight: 1.7 }}>{resolvedSummary}</Typography>
            </Stack>
          </Paper>
        )}

        {analysis.recommendations.length > 0 && (
          <Box>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>{t('resources.recommendations')} ({analysis.recommendations.length})</Typography>
            <Stack spacing={1.5}>
              {analysis.recommendations.slice(0, 5).map(rec => {
                const severityColor = getSeverityColor(rec.severity)
                const resolved = resolveRec(rec)
                return (
                  <Paper key={rec.id} sx={{ p: 2, border: '1px solid', borderColor: alpha(severityColor, 0.25), bgcolor: alpha(severityColor, 0.03), borderRadius: 2, '&:hover': { bgcolor: alpha(severityColor, 0.06), transform: 'translateX(4px)' }, transition: 'all 0.2s' }}>
                    <Stack direction="row" spacing={1.5} alignItems="flex-start">
                      <Typography sx={{ fontSize: 18 }}>{getTypeIcon(rec.type)}</Typography>
                      <Box sx={{ flex: 1 }}>
                        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                          <Typography variant="subtitle2" fontWeight={700}>{resolved.title}</Typography>
                          {resolved.savings && <Chip size="small" label={resolved.savings} sx={{ height: 18, fontSize: '0.65rem', bgcolor: alpha(COLORS.success, 0.1), color: COLORS.success, fontWeight: 600 }} />}
                        </Stack>
                        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.5 }}>{resolved.description}</Typography>
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

        {!pending && !resolvedSummary && analysis.recommendations.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <PsychologyIcon sx={{ fontSize: 64, color: alpha(COLORS.primary, 0.2), mb: 2 }} />
            <Typography variant="body1" fontWeight={600}>{t('resources.analyzeInfra')}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 300, mx: 'auto' }}>{t('resources.aiWillAnalyze')}</Typography>
          </Box>
        )}

        </Box>
      </CardContent>
    </Card>
  )
}
