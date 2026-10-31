'use client'

import { Alert, Box, Button, LinearProgress, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useLocale, useTranslations } from 'next-intl'

import { getDateLocale } from '@/lib/i18n/date'

import { COLORS } from '../../constants'
import { AiPending, SectionCard } from './ui'

const PROVIDER_LABEL: Record<string, string> = { ollama: 'Ollama', openai: 'OpenAI', anthropic: 'Anthropic' }

/** What every AI reading of the page carries about how it was made. */
export type ReadingMeta = { provider: string; model?: string; generatedAt: string; aiFailed?: boolean }

/**
 * Frame shared by the AI readings of the page (forecast reading, optimisation
 * plan): who wrote it and when, a regenerate button, the wait, why the rules
 * stand in for the model, the summary, then the reading itself.
 */
export default function AiReadingCard({ icon, title, idleSubtitle, pendingTitle, pendingHint, reading, summary, loading, failed, onRegenerate, extraAction, children }: {
  icon: string
  title: string
  idleSubtitle: string
  pendingTitle: string
  pendingHint: string
  reading: ReadingMeta | null
  summary: string
  loading: boolean
  failed: boolean
  onRegenerate: () => void
  extraAction?: React.ReactNode
  children: React.ReactNode
}) {
  const t = useTranslations()
  const dateLocale = getDateLocale(useLocale())
  const isBasic = reading?.provider === 'basic'

  let subtitle = idleSubtitle
  if (reading) {
    const time = new Date(reading.generatedAt).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })

    subtitle = isBasic
      ? t('resources.aiReading.byRules', { time })
      : t('resources.aiReading.byModel', { model: reading.model ?? '', provider: PROVIDER_LABEL[reading.provider] ?? reading.provider, time })
  }

  return (
    <SectionCard
      icon={icon}
      title={title}
      subtitle={subtitle}
      action={(
        <Stack direction="row" spacing={1} alignItems="center">
          {reading && extraAction}
          <Button size="small" variant="outlined" onClick={onRegenerate} disabled={loading} startIcon={<i className="ri-refresh-line" />}>
            {t('resources.aiReading.regenerate')}
          </Button>
        </Stack>
      )}
    >
      {loading && !reading && <AiPending title={pendingTitle} hint={pendingHint} />}
      {loading && reading && <LinearProgress aria-label={pendingTitle} sx={{ mb: 2, borderRadius: 1 }} />}

      {failed && !loading && <Alert severity="error" sx={{ mb: 2 }}>{t('resources.aiReading.error')}</Alert>}
      {reading?.aiFailed && !loading && <Alert severity="warning" sx={{ mb: 2 }}>{t('resources.aiReading.modelFailed')}</Alert>}
      {isBasic && !reading?.aiFailed && !loading && <Alert severity="info" sx={{ mb: 2 }}>{t('resources.aiReading.noModel')}</Alert>}

      {reading && (
        <Box sx={loading ? { opacity: 0.5, pointerEvents: 'none', transition: 'opacity 0.2s' } : undefined}>
          {summary && (
            <Box sx={{ p: 2, mb: 2, borderRadius: 1.5, bgcolor: alpha(COLORS.primary, 0.05), border: '1px solid', borderColor: alpha(COLORS.primary, 0.15) }}>
              <Typography variant="body2" sx={{ lineHeight: 1.7 }}>{summary}</Typography>
            </Box>
          )}
          {children}
          {!isBasic && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>{t('resources.aiReading.disclaimer')}</Typography>
          )}
        </Box>
      )}
    </SectionCard>
  )
}
