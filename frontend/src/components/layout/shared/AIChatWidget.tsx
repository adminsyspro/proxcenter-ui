'use client'

import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react'
import { useTranslations, useLocale } from 'next-intl'

import {
  Box,
  ButtonBase,
  Chip,
  CircularProgress,
  Fab,
  Grow,
  IconButton,
  InputBase,
  Paper,
  Portal,
  Typography,
  Alert,
  Tooltip
} from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'

import { sanitizeActionCard, sanitizeActionPlan, type ActionCardsPayload } from '@/lib/ai/actions/cards'
import type { ActionCard, ActionPlan } from '@/lib/ai/actions/types'
import { sanitizeChart, type AiChart } from '@/lib/ai/charts'
import { createFrameDecoder, type DecodedChunk } from '@/lib/ai/streamFrames'

import { AIActions } from './AIActionPlan'
import AIChart from './AIChart'
import AIMarkdown from './AIMarkdown'
import { LogoIcon } from './Logo'
import {
  historyContent,
  newConversationId,
  useActionExecution,
  withActionResult,
  type ActionExecution
} from './useActionExecution'

type Translate = (key: string, values?: Record<string, string>) => string

type ToolCall = { name: string; ok: boolean }

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  /** The tools of the round being run, while the answer is still empty. */
  toolActivity?: string[]
  toolTrace?: ToolCall[]
  charts?: AiChart[]
  /** Signed cards and plans proposed by this answer (roadmap#188); never sent back. */
  actions?: ActionCardsPayload
  /** One line per action run from this answer, sent with it to the model. */
  actionResults?: string[]
  stopped?: boolean
}

// The plain route hands its actions over as they came from the tools, unlike
// the stream whose decoder sanitises them: same filter here.
const sanitizeActions = (raw: unknown): ActionCardsPayload | null => {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as { cards?: unknown; plans?: unknown }
  const cards = (Array.isArray(src.cards) ? src.cards : []).map(sanitizeActionCard).filter((c): c is ActionCard => c !== null)
  const plans = (Array.isArray(src.plans) ? src.plans : []).map(sanitizeActionPlan).filter((p): p is ActionPlan => p !== null)

  return cards.length || plans.length ? { cards, plans } : null
}

type AiSettings = { provider?: string; model?: string | null; actionsEnabled?: boolean }

// Human labels for the assistant's read-only tools (#459). A name missing
// here (a newer tool, or one the model invented) falls back to the raw name.
const TOOL_LABEL_KEYS: Record<string, string> = {
  list_hosts: 'ai.tools.listHosts',
  list_guests: 'ai.tools.listGuests',
  rank_guest_hardware: 'ai.tools.rankGuestHardware',
  get_guest_hardware: 'ai.tools.getGuestHardware',
  get_node_hardware: 'ai.tools.getNodeHardware',
  rank_storage: 'ai.tools.rankStorage',
  get_ceph_status: 'ai.tools.getCephStatus',
  list_ceph_osds: 'ai.tools.listCephOsds',
  get_metrics_history: 'ai.tools.getMetricsHistory',
  get_capacity: 'ai.tools.getCapacity',
  list_alerts: 'ai.tools.listAlerts',
  list_tasks: 'ai.tools.listTasks',
  list_changes: 'ai.tools.listChanges',
  get_backup_coverage: 'ai.tools.getBackupCoverage',
  simulate_migration: 'ai.tools.simulateMigration',
  list_migrations: 'ai.tools.listMigrations',
  get_vdc_quotas: 'ai.tools.getVdcQuotas',
  get_health_trend: 'ai.tools.getHealthTrend',
  get_drs_status: 'ai.tools.getDrsStatus',
  get_site_recovery_status: 'ai.tools.getSiteRecovery',
  get_ha_status: 'ai.tools.getHaStatus',
  get_host_maintenance: 'ai.tools.getHostMaintenance',
  forecast_capacity: 'ai.tools.forecastCapacity',
  get_cve_exposure: 'ai.tools.getCveExposure'
}

const toolLabel = (t: Translate, name: string) => (TOOL_LABEL_KEYS[name] ? t(TOOL_LABEL_KEYS[name]) : name)

/**
 * One source per distinct tool, failed when any of its calls failed.
 * `calls` is either a list of names (a round starting) or a list of
 * `{ name, ok }` entries (the finished trace).
 */
export const toolSources = (calls: Array<string | ToolCall>) => {
  const sources = new Map<string, boolean>()

  for (const call of calls) {
    const name = typeof call === 'string' ? call : call.name
    const failed = typeof call !== 'string' && call.ok === false

    sources.set(name, (sources.get(name) ?? false) || failed)
  }

  return [...sources].map(([name, failed]) => ({ name, failed }))
}

const SUGGESTIONS = [
  { icon: 'ri-dashboard-3-line', key: 'suggestInfraStatus' },
  { icon: 'ri-alarm-warning-line', key: 'suggestAlerts' },
  { icon: 'ri-shield-cross-line', key: 'suggestFailedBackups' },
  { icon: 'ri-history-line', key: 'suggestChanges' },
  { icon: 'ri-line-chart-line', key: 'suggestTopCpu' },
  { icon: 'ri-scales-3-line', key: 'suggestCapacity' }
]

const WIDE_STORAGE_KEY = 'proxcenter.aiChat.wide'

const readWide = () => {
  try {
    return window.localStorage.getItem(WIDE_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

const writeWide = (wide: boolean) => {
  try {
    window.localStorage.setItem(WIDE_STORAGE_KEY, wide ? '1' : '0')
  } catch {
    // A blocked storage only loses the remembered width.
  }
}

// So a history answer says "14:05" in the reader's time rather than UTC.
const readerTimeZone = (): string | undefined => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

// How close to the bottom still counts as "following" the answer: past it,
// the reader scrolled up to read and the stream must not pull them down.
const STICK_THRESHOLD_PX = 80

// The launcher sits above the task bar, and above the button that brings a
// hidden task bar back (bottom-right, 56 px high with its margin).
const LAUNCHER_BOTTOM = 'calc(max(var(--taskbar-height, 0px), 56px) + 16px)'
const LAUNCHER_SIZE = 56
const PANEL_GAP = 12

const AssistantAvatar = ({ size = 28 }: { size?: number }) => {
  const theme = useTheme()

  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        border: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        color: 'text.primary'
      }}
    >
      <LogoIcon size={Math.round(size * 0.58)} accentColor={theme.palette.primary.main} />
    </Box>
  )
}

const UserMessage = ({ message }: { message: ChatMessage }) => (
  <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 5 }}>
    <Box
      sx={theme => ({
        maxWidth: '85%',
        px: 4,
        py: 2.5,
        borderRadius: '16px 16px 4px 16px',
        bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.24 : 0.1),
        color: 'text.primary'
      })}
    >
      <Typography sx={{ fontSize: '0.875rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6 }}>
        {message.content}
      </Typography>
    </Box>
  </Box>
)

const WaitingLine = ({ message, t }: { message: ChatMessage; t: Translate }) => {
  // While tools run the model has produced no text yet: name what is being
  // looked up rather than showing the generic "Thinking..." (#459).
  const text = message.toolActivity?.length
    ? t('ai.consulting', {
        tools: toolSources(message.toolActivity)
          .map(s => toolLabel(t, s.name))
          .join(', ')
      })
    : t('ai.thinking')

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, color: 'text.secondary', minHeight: 28 }}>
      <CircularProgress size={14} color='inherit' />
      <Typography variant='body2'>{text}</Typography>
    </Box>
  )
}

const Sources = ({ trace, t }: { trace: ToolCall[]; t: Translate }) => (
  <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5 }}>
    <Typography variant='caption' color='text.secondary' sx={{ mr: 0.5 }}>
      {t('ai.sources')}
    </Typography>
    {toolSources(trace).map(({ name, failed }) => (
      <Chip
        key={name}
        size='small'
        variant='outlined'
        color={failed ? 'warning' : 'default'}
        icon={<i className={failed ? 'ri-error-warning-line' : 'ri-database-2-line'} style={{ fontSize: 13 }} />}
        label={failed ? `${toolLabel(t, name)} (${t('ai.toolFailed')})` : toolLabel(t, name)}
        sx={{ height: 22, fontSize: '0.75rem', '& .MuiChip-icon': { ml: 1.5 } }}
      />
    ))}
  </Box>
)

const CopyButton = ({ text, t }: { text: string; t: Translate }) => {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return undefined
    const timer = setTimeout(() => setCopied(false), 2000)

    return () => clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      // Clipboard refused (insecure origin, denied permission): nothing to undo.
    }
  }

  const label = copied ? t('ai.copied') : t('ai.copy')

  return (
    <Tooltip title={label}>
      <IconButton aria-label={label} size='small' onClick={copy} sx={{ color: 'text.secondary' }}>
        <i className={copied ? 'ri-check-line' : 'ri-file-copy-line'} style={{ fontSize: 16 }} />
      </IconButton>
    </Tooltip>
  )
}

const AssistantMessage = ({
  message,
  isStreaming,
  t,
  locale,
  exec
}: {
  message: ChatMessage
  isStreaming: boolean
  t: Translate
  locale: string
  exec: ActionExecution
}) => {
  const hasTrace = Boolean(message.toolTrace?.length)
  const showFooter = !isStreaming && (message.content || hasTrace)

  return (
    <Box sx={{ display: 'flex', gap: 3, mb: 6 }}>
      <AssistantAvatar />
      <Box sx={{ flex: 1, minWidth: 0, pt: 0.5 }}>
        {isStreaming && !message.content ? (
          <WaitingLine message={message} t={t} />
        ) : (
          <AIMarkdown>{message.content}</AIMarkdown>
        )}
        {isStreaming && message.content && (
          <Box
            component='span'
            aria-hidden
            sx={{
              display: 'inline-block',
              width: 7,
              height: 14,
              mt: 1,
              borderRadius: 0.5,
              bgcolor: 'primary.main',
              animation: 'aiCaret 1s steps(1) infinite',
              '@keyframes aiCaret': { '50%': { opacity: 0 } }
            }}
          />
        )}
        {!isStreaming && message.charts?.map((chart, index) => (
          <AIChart key={`${chart.kind}-${chart.metric ?? index}`} chart={chart} t={t} locale={locale} />
        ))}
        {!isStreaming && message.actions && (
          <AIActions payload={message.actions} runs={exec.runs} busy={exec.busy} onExecute={exec.execute} t={t} />
        )}
        {message.stopped && (
          <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mt: 2, fontStyle: 'italic' }}>
            {t('ai.stopped')}
          </Typography>
        )}
        {showFooter && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
              mt: 3,
              pt: 2,
              borderTop: 1,
              borderColor: 'divider'
            }}
          >
            {message.toolTrace?.length ? <Sources trace={message.toolTrace} t={t} /> : <span />}
            {message.content && <CopyButton text={message.content} t={t} />}
          </Box>
        )}
      </Box>
    </Box>
  )
}

const Welcome = ({ onSelect, disabled, actionsEnabled, t }: { onSelect: (text: string) => void; disabled: boolean; actionsEnabled: boolean; t: Translate }) => (
  <Box sx={{ py: 4 }}>
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', mb: 6 }}>
      <AssistantAvatar size={48} />
      <Typography variant='h6' sx={{ fontWeight: 700, mt: 4, mb: 1 }}>
        {t('ai.welcomeTitle')}
      </Typography>
      <Typography
        variant='body2'
        color='text.secondary'
        sx={{ maxWidth: 360 }}
        dangerouslySetInnerHTML={{ __html: t('ai.welcomeMessage') }}
      />
      {actionsEnabled && (
        <Typography variant='body2' color='text.secondary' sx={{ maxWidth: 360, mt: 1 }}>
          {t('ai.actionsWelcome')}
        </Typography>
      )}
    </Box>

    <Box
      sx={theme => ({
        display: 'flex',
        gap: 2.5,
        alignItems: 'flex-start',
        p: 3,
        mb: 6,
        borderRadius: 1.5,
        border: 1,
        borderColor: alpha(theme.palette.success.main, 0.35),
        bgcolor: alpha(theme.palette.success.main, 0.06)
      })}
    >
      <Box component='i' className='ri-shield-check-line' sx={{ color: 'success.main', fontSize: 18, lineHeight: 1.3 }} />
      <Box>
        <Typography variant='body2' sx={{ fontWeight: 600 }}>
          {t(actionsEnabled ? 'ai.actionsMode' : 'ai.readOnly')}
        </Typography>
        <Typography variant='caption' color='text.secondary' sx={{ display: 'block', lineHeight: 1.5 }}>
          {t(actionsEnabled ? 'ai.actionsScope' : 'ai.readOnlyScope')}
        </Typography>
      </Box>
    </Box>

    <Typography
      variant='overline'
      color='text.secondary'
      sx={{ display: 'block', mb: 2, lineHeight: 1.5, letterSpacing: 0.8 }}
    >
      {t('ai.suggestions')}
    </Typography>
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, gap: 2 }}>
      {SUGGESTIONS.map(s => {
        const text = t(`ai.${s.key}`)

        return (
          <ButtonBase
            key={s.key}
            disabled={disabled}
            onClick={() => onSelect(text)}
            sx={theme => ({
              justifyContent: 'flex-start',
              alignItems: 'flex-start',
              gap: 2.5,
              p: 2.5,
              borderRadius: 1.5,
              border: 1,
              borderColor: 'divider',
              textAlign: 'left',
              transition: 'border-color 0.15s, background-color 0.15s',
              '&:hover': { borderColor: 'primary.main', bgcolor: alpha(theme.palette.primary.main, 0.04) },
              '&.Mui-focusVisible': { borderColor: 'primary.main' }
            })}
          >
            <Box component='i' className={s.icon} sx={{ color: 'primary.main', fontSize: 18, lineHeight: 1.25 }} />
            <Typography variant='body2' sx={{ lineHeight: 1.4 }}>
              {text}
            </Typography>
          </ButtonBase>
        )
      })}
    </Box>
  </Box>
)

/**
 * The assistant (#459): a round launcher bottom-right of every page and the
 * conversation window it opens above it. `available` is the navbar's gate
 * (licence feature and AI enabled).
 */
export default function AIChatWidget({ available }: { available: boolean }) {
  const t = useTranslations()
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  const locale = useLocale()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null)
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Read on first render: the paper is not rendered while closed, so the
  // server and the client never disagree on its width.
  const [wide, setWide] = useState(readWide)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const stickRef = useRef(true)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  // Binds the signed cards to this thread; a cleared conversation is a new one.
  const [conversationId, setConversationId] = useState(newConversationId)

  // Once an action is over, its line rides with the answer that proposed it.
  const onActionFinished = useCallback((card: ActionCard, line: string) => {
    setMessages(prev => withActionResult(prev, card.actionId, line))
  }, [])

  const exec = useActionExecution({ conversationId, paused: !open, onFinished: onActionFinished })

  // Vérifier si l'IA est activée, à chaque ouverture
  useEffect(() => {
    if (!open) return undefined

    let current = true

    fetch('/api/v1/ai/status')
      .then(res => res.json())
      .then(json => {
        if (!current) return
        setAiEnabled(json?.data?.enabled || false)
        setAiSettings(json?.data || null)
      })
      .catch(() => {
        if (current) setAiEnabled(false)
      })

    return () => {
      current = false
    }
  }, [open])

  useEffect(() => {
    if (open && aiEnabled) inputRef.current?.focus()
  }, [open, aiEnabled])

  useEffect(() => {
    if (!open) return undefined

    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Follow the answer while it streams, unless the reader scrolled up.
  useEffect(() => {
    const el = scrollRef.current

    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [messages, streaming])

  const handleScroll = () => {
    const el = scrollRef.current

    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX
  }

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return

    const userMessage: ChatMessage = { role: 'user', content: text.trim() }

    // The stored messages also carry the tool activity shown in the bubbles
    // (#459); the providers only ever get the conversation itself.
    const history = [...messages, userMessage].map(m => ({ role: m.role, content: historyContent(m) }))

    const controller = new AbortController()

    abortControllerRef.current = controller
    stickRef.current = true
    setMessages(prev => [...prev, userMessage, { role: 'assistant', content: '' }])
    setInput('')
    setLoading(true)
    setStreaming(true)
    setError(null)

    let fullContent = ''
    let toolActivity: string[] | null = null
    let toolTrace: ToolCall[] | null = null
    let charts: AiChart[] | null = null
    let actions: ActionCardsPayload | null = null

    // Mettre à jour le message en temps réel
    const publish = (extra: Partial<ChatMessage> = {}) => {
      setMessages(prev => {
        const newMessages = [...prev]

        newMessages[newMessages.length - 1] = {
          role: 'assistant',
          content: fullContent,
          ...(toolActivity ? { toolActivity } : {}),
          ...(toolTrace ? { toolTrace } : {}),
          ...(charts?.length ? { charts } : {}),
          ...(actions ? { actions } : {}),
          ...extra
        }

        return newMessages
      })
    }

    try {
      const res = await fetch('/api/v1/ai/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history,
          locale,
          timeZone: readerTimeZone(),
          conversationId
        }),
        signal: controller.signal
      })

      if (!res.ok) {
        const json = await res.json().catch(() => ({}))

        throw new Error(json?.error || 'Communication error with AI')
      }

      // Lire le stream
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      const frameDecoder = createFrameDecoder()

      // The stream mixes the answer text with activity frames (#459): a
      // `tool` frame names the round being run, a `trace` frame lists what
      // was consulted once the answer is complete, a `charts` frame carries
      // what the tool results let the widget plot.
      const applyDecoded = ({ text, frames }: DecodedChunk) => {
        fullContent += text

        for (const frame of frames) {
          if (frame.type === 'tool') toolActivity = frame.names
          else if (frame.type === 'trace') toolTrace = frame.calls
          else if (frame.type === 'charts') charts = frame.charts
          else if (frame.type === 'actions' && (frame.cards.length || frame.plans.length)) {
            actions = { cards: frame.cards, plans: frame.plans }
          }
        }
      }

      // One read after the other, chained rather than awaited in a loop.
      const pump = async (): Promise<void> => {
        if (!reader) return

        const { done, value } = await reader.read()

        if (done) return

        applyDecoded(frameDecoder.push(decoder.decode(value, { stream: true })))
        publish()

        return pump()
      }

      if (reader) {
        await pump()
        applyDecoded(frameDecoder.flush())
        publish()
      }

    } catch (e) {
      // Stopped by the user: keep what had arrived, never retry.
      if (controller.signal.aborted) {
        publish({ stopped: true })

        return
      }

      // Si le streaming échoue, essayer l'API normale
      try {
        const res = await fetch('/api/v1/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: history,
            locale, // #686: the fallback used to omit it and always answered in English
            timeZone: readerTimeZone(),
            conversationId
          }),
          signal: controller.signal
        })

        const json = await res.json()

        if (!res.ok) {
          throw new Error(json?.error || 'Communication error with AI')
        }

        // The non-streaming route already reports what it consulted.
        fullContent = json.response
        toolTrace = Array.isArray(json.toolCalls) && json.toolCalls.length
          ? json.toolCalls.map((c: { name: string; ok?: boolean }) => ({ name: c.name, ok: c.ok !== false }))
          : null
        charts = Array.isArray(json.charts) ? json.charts.map(sanitizeChart).filter(Boolean) : null
        actions = sanitizeActions(json.actions)
        publish()
      } catch (fallbackError) {
        if (controller.signal.aborted) {
          publish({ stopped: true })

          return
        }

        setError((fallbackError as Error)?.message || t('ai.unknownError'))

        // Retirer le message assistant vide en cas d'erreur
        setMessages(prev => prev.slice(0, -1))
      }
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null
      setLoading(false)
      setStreaming(false)
    }
    // `locale` is a dependency: without it the callback keeps the locale
    // captured at mount and a language switch mid-conversation would keep
    // asking the model for the previous language.
  }, [messages, loading, locale, t, conversationId])

  const handleStop = () => abortControllerRef.current?.abort()

  const handleKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    // An IME composition (Korean, Chinese) also ends on Enter.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void sendMessage(input)
    }
  }

  const handleClear = () => {
    abortControllerRef.current?.abort()
    exec.reset()
    setConversationId(newConversationId())
    setMessages([])
    setError(null)
  }

  const toggleWide = () => {
    setWide(prev => {
      writeWide(!prev)

      return !prev
    })
  }

  const getModelDisplayName = () => {
    if (!aiSettings) return ''

    return aiSettings.model || aiSettings.provider || ''
  }

  const canSend = Boolean(input.trim()) && !loading && aiEnabled
  const wideLabel = wide ? t('ai.narrowView') : t('ai.wideView')

  if (!available) return null

  // Above the task bar (1200), under dialogs opened from an answer's page.
  const zIndex = theme.zIndex.modal - 1
  const launcherLabel = open ? t('common.close') : t('ai.title')

  return (
    <Portal>
      <Grow in={open} style={{ transformOrigin: 'bottom right' }} unmountOnExit>
        <Paper
          role='dialog'
          aria-label={t('ai.title')}
          elevation={12}
          sx={{
            position: 'fixed',
            zIndex,
            inset: { xs: 0, sm: 'auto' },
            right: { sm: 24 },
            bottom: { sm: `calc(${LAUNCHER_BOTTOM} + ${LAUNCHER_SIZE + PANEL_GAP}px)` },
            width: { xs: '100%', sm: wide ? 'min(880px, calc(100vw - 48px))' : 440 },
            height: { xs: '100%', sm: wide ? 860 : 640 },
            maxHeight: {
              sm: `calc(100dvh - var(--top-banner-height, 0px) - ${LAUNCHER_BOTTOM} - ${LAUNCHER_SIZE + PANEL_GAP + 24}px)`
            },
            borderRadius: { xs: 0, sm: 2 },
            border: { sm: 1 },
            borderColor: { sm: 'divider' },
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            transition: 'width 0.2s ease, height 0.2s ease'
          }}
        >
          {/* Header */}
          <Box
            sx={{
              px: 5,
              py: 2.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
              borderBottom: 1,
              borderColor: 'divider',
              bgcolor: 'background.paper',
              flexShrink: 0
            }}
          >
            {/* One line: "AI Assistant qwen3.5:9b · Read-only". */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5, minWidth: 0 }}>
              <AssistantAvatar size={30} />
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, minWidth: 0 }}>
                <Typography variant="subtitle1" noWrap sx={{ fontWeight: 700, lineHeight: 1.3, flexShrink: 0 }}>
                  {t('ai.title')}
                </Typography>
                  {aiSettings && (
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
                      {getModelDisplayName()}
                    </Typography>
                  )}
                  {aiEnabled && (
                    <Tooltip title={t(aiSettings?.actionsEnabled ? 'ai.actionsScope' : 'ai.readOnlyScope')}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        noWrap
                        sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, flexShrink: 0 }}
                      >
                        {aiSettings && <Box component="span" aria-hidden sx={{ opacity: 0.5 }}>·</Box>}
                        <Box
                          component="i"
                          className={aiSettings?.actionsEnabled ? 'ri-shield-check-line' : 'ri-lock-line'}
                          sx={{ fontSize: 12, color: 'success.main' }}
                        />
                        {t(aiSettings?.actionsEnabled ? 'ai.actionsBadge' : 'ai.readOnlyBadge')}
                      </Typography>
                    </Tooltip>
                  )}
              </Box>
            </Box>

            <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
              <Tooltip title={wideLabel}>
                <IconButton
                  aria-label={wideLabel}
                  size="small"
                  onClick={toggleWide}
                  sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
                >
                  <i className={wide ? 'ri-contract-left-right-line' : 'ri-expand-left-right-line'} style={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('ai.clearConversation')}>
                <span>
                  <IconButton
                    aria-label={t('ai.clearConversation')}
                    size="small"
                    onClick={handleClear}
                    disabled={messages.length === 0}
                  >
                    <i className='ri-delete-bin-line' style={{ fontSize: 18 }} />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={t('common.close')}>
                <IconButton aria-label={t('common.close')} size="small" onClick={() => setOpen(false)}>
                  <i className='ri-close-line' style={{ fontSize: 20 }} />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>

          {/* Content */}
          <Box ref={scrollRef} onScroll={handleScroll} sx={{ flex: 1, overflow: 'auto', bgcolor: 'background.paper' }}>
            <Box sx={{ maxWidth: 860, mx: 'auto', px: 5, py: 5, display: 'flex', flexDirection: 'column' }}>
              {/* AI Not Enabled */}
              {aiEnabled === false && (
                <Alert severity="warning" sx={{ mb: 4 }}>
                  <Typography variant="body2" dangerouslySetInnerHTML={{ __html: t('ai.notEnabled') }} />
                </Alert>
              )}

              {messages.length === 0 && aiEnabled && <Welcome onSelect={sendMessage} disabled={loading} actionsEnabled={aiSettings?.actionsEnabled === true} t={t} />}

              {messages.map((msg, i) =>
                msg.role === 'user' ? (
                  <UserMessage key={i} message={msg} />
                ) : (
                  <AssistantMessage
                    key={i}
                    message={msg}
                    isStreaming={streaming && i === messages.length - 1}
                    t={t}
                    locale={locale}
                    exec={exec}
                  />
                )
              )}

              {error && (
                <Alert severity="error" sx={{ mb: 4 }}>
                  {error}
                </Alert>
              )}
            </Box>
          </Box>

          {/* Input */}
          <Box sx={{ px: 5, pt: 3, pb: 2.5, borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper', flexShrink: 0 }}>
            <Paper
              elevation={0}
              sx={theme => ({
                maxWidth: 860,
                mx: 'auto',
                display: 'flex',
                alignItems: 'flex-end',
                gap: 2,
                p: 1.5,
                pl: 3.5,
                border: 1,
                borderColor: 'divider',
                borderRadius: 3,
                bgcolor: 'background.paper',
                transition: 'border-color 0.15s, box-shadow 0.15s',
                '&:focus-within': {
                  borderColor: 'primary.main',
                  boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.15)}`
                }
              })}
            >
              <InputBase
                inputRef={inputRef}
                fullWidth
                multiline
                maxRows={6}
                placeholder={aiEnabled ? t('ai.askQuestion') : t('ai.aiNotEnabled')}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={!aiEnabled}
                sx={{ fontSize: 14, py: 1.5 }}
              />
              {loading ? (
                <Tooltip title={t('ai.stop')}>
                  <IconButton
                    aria-label={t('ai.stop')}
                    onClick={handleStop}
                    sx={{ width: 36, height: 36, border: 1, borderColor: 'divider', color: 'text.primary' }}
                  >
                    <i className='ri-stop-fill' style={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              ) : (
                <Tooltip title={t('ai.send')}>
                  <span>
                    <IconButton
                      aria-label={t('ai.send')}
                      onClick={() => sendMessage(input)}
                      disabled={!canSend}
                      sx={{
                        width: 36,
                        height: 36,
                        bgcolor: 'primary.main',
                        color: 'primary.contrastText',
                        '&:hover': { bgcolor: 'primary.dark' },
                        '&.Mui-disabled': { bgcolor: 'action.disabledBackground', color: 'action.disabled' }
                      }}
                    >
                      <i className='ri-arrow-up-line' style={{ fontSize: 18 }} />
                    </IconButton>
                  </span>
                </Tooltip>
              )}
            </Paper>

            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2, textAlign: 'center', opacity: 0.8 }}>
              {t('ai.disclaimer')}
            </Typography>
          </Box>
        </Paper>
      </Grow>

      <Tooltip title={launcherLabel} placement='left'>
        <Fab
          aria-label={launcherLabel}
          aria-expanded={open}
          onClick={() => setOpen(prev => !prev)}
          sx={{
            position: 'fixed',
            zIndex,
            right: 24,
            bottom: LAUNCHER_BOTTOM,
            width: LAUNCHER_SIZE,
            height: LAUNCHER_SIZE,
            display: { xs: open ? 'none' : 'inline-flex', sm: 'inline-flex' },
            bgcolor: 'background.paper',
            color: 'text.primary',
            border: 1,
            borderColor: 'divider',
            boxShadow: 6,
            transition: 'transform 0.15s, box-shadow 0.15s',
            '&:hover': { bgcolor: 'background.paper', boxShadow: 10, transform: 'scale(1.05)' }
          }}
        >
          {open ? (
            <i className='ri-arrow-down-s-line' style={{ fontSize: 28 }} />
          ) : (
            <LogoIcon size={30} accentColor={theme.palette.primary.main} />
          )}
        </Fab>
      </Tooltip>
    </Portal>
  )
}
