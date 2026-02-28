'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslations, useLocale } from 'next-intl'

import {
  Avatar,
  Box,
  CircularProgress,
  Drawer,
  IconButton,
  InputBase,
  Paper,
  Typography,
  Chip,
  Divider,
  Alert,
  Tooltip
} from '@mui/material'
import { useTheme } from '@mui/material/styles'

// Formatage basique du texte (gras, listes)
const formatText = (text) => {
  if (!text) return ''
  
  // Convertir **texte** en gras
  let formatted = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  
  // Convertir les listes à puces
  formatted = formatted.replace(/^\* /gm, '• ')
  formatted = formatted.replace(/^- /gm, '• ')
  
  // Convertir les listes numérotées
  formatted = formatted.replace(/^(\d+)\. /gm, '$1. ')
  
  return formatted
}

// Composant message
const MessageBubble = ({ message, isUser, isStreaming, thinkingText }) => {
  const theme = useTheme()
  
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        mb: 2
      }}
    >
      {!isUser && (
        <Avatar
          sx={{
            width: 32,
            height: 32,
            mr: 1,
            bgcolor: theme.palette.primary.main,
            fontSize: 14,
            flexShrink: 0
          }}
        >
          <i className='ri-sparkling-2-fill' />
        </Avatar>
      )}
      
      <Paper
        elevation={0}
        sx={{
          maxWidth: '85%',
          p: 1.5,
          px: 2,
          borderRadius: 2,
          bgcolor: isUser 
            ? theme.palette.primary.main 
            : theme.palette.action.hover,
          color: isUser 
            ? theme.palette.primary.contrastText 
            : theme.palette.text.primary
        }}
      >
        {isStreaming && !message.content ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={16} color="inherit" />
            <Typography variant="body2">{thinkingText}</Typography>
          </Box>
        ) : (
          <Typography 
            variant="body2" 
            component="div"
            sx={{ 
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              '& strong': {
                fontWeight: 700
              },
              '& code': {
                bgcolor: 'rgba(0,0,0,0.1)',
                px: 0.5,
                borderRadius: 0.5,
                fontFamily: 'monospace',
                fontSize: '0.85em'
              }
            }}
            dangerouslySetInnerHTML={{ __html: formatText(message.content) }}
          />
        )}
        {isStreaming && message.content && (
          <Box 
            component="span" 
            sx={{ 
              display: 'inline-block',
              width: 8,
              height: 16,
              bgcolor: 'currentColor',
              ml: 0.5,
              animation: 'blink 1s infinite',
              '@keyframes blink': {
                '0%, 50%': { opacity: 1 },
                '51%, 100%': { opacity: 0 }
              }
            }} 
          />
        )}
      </Paper>
      
      {isUser && (
        <Avatar
          sx={{
            width: 32,
            height: 32,
            ml: 1,
            bgcolor: theme.palette.grey[600],
            fontSize: 14,
            flexShrink: 0
          }}
        >
          <i className='ri-user-line' />
        </Avatar>
      )}
    </Box>
  )
}

// Suggestions rapides
const QuickSuggestions = ({ onSelect, disabled, t }) => {
  const suggestions = [
    { icon: 'ri-cpu-line', key: 'suggestTopCpu' },
    { icon: 'ri-ram-line', key: 'suggestTopRam' },
    { icon: 'ri-stop-circle-line', key: 'suggestStoppedVms' },
    { icon: 'ri-dashboard-3-line', key: 'suggestInfraStatus' },
    { icon: 'ri-server-line', key: 'suggestHostStatus' },
    { icon: 'ri-alarm-warning-line', key: 'suggestAlerts' }
  ]

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'center' }}>
      {suggestions.map((s, i) => {
        const text = t(`ai.${s.key}`)
        return (
          <Chip
            key={i}
            icon={<i className={s.icon} style={{ fontSize: 14 }} />}
            label={text}
            size="small"
            variant="outlined"
            onClick={() => !disabled && onSelect(text)}
            disabled={disabled}
            sx={{
              cursor: disabled ? 'not-allowed' : 'pointer',
              '&:hover': { bgcolor: disabled ? 'transparent' : 'action.hover' },
              maxWidth: '100%',
              '& .MuiChip-label': {
                whiteSpace: 'normal',
                textAlign: 'left'
              }
            }}
          />
        )
      })}
    </Box>
  )
}

export default function AIChatDrawer({ open, onClose }) {
  const theme = useTheme()
  const t = useTranslations()
  const locale = useLocale()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [aiEnabled, setAiEnabled] = useState(null)
  const [aiSettings, setAiSettings] = useState(null)
  const [error, setError] = useState(null)
  const messagesEndRef = useRef(null)
  const abortControllerRef = useRef(null)
  
  // Vérifier si l'IA est activée
  useEffect(() => {
    if (open) {
      checkAIEnabled()
    }
  }, [open])
  
  const checkAIEnabled = async () => {
    try {
      const res = await fetch('/api/v1/settings/ai')
      const json = await res.json()

      setAiEnabled(json?.data?.enabled || false)
      setAiSettings(json?.data || null)
    } catch (e) {
      setAiEnabled(false)
    }
  }
  
  // Auto-scroll vers le bas
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming])
  
  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || loading) return
    
    const userMessage = { role: 'user', content: text.trim() }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setLoading(true)
    setStreaming(true)
    setError(null)
    
    // Ajouter un message assistant vide pour le streaming
    setMessages(prev => [...prev, { role: 'assistant', content: '' }])
    
    try {
      const res = await fetch('/api/v1/ai/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, userMessage],
          locale
        })
      })
      
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))

        throw new Error(json?.error || 'Communication error with AI')
      }
      
      // Lire le stream
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let fullContent = ''
      
      if (reader) {
        while (true) {
          const { done, value } = await reader.read()

          if (done) break
          
          const chunk = decoder.decode(value, { stream: true })

          fullContent += chunk
          
          // Mettre à jour le message en temps réel
          setMessages(prev => {
            const newMessages = [...prev]

            newMessages[newMessages.length - 1] = {
              role: 'assistant',
              content: fullContent
            }
            
return newMessages
          })
        }
      }
      
    } catch (e) {
      // Si le streaming échoue, essayer l'API normale
      try {
        const res = await fetch('/api/v1/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [...messages, userMessage]
          })
        })
        
        const json = await res.json()
        
        if (!res.ok) {
          throw new Error(json?.error || 'Communication error with AI')
        }
        
        setMessages(prev => {
          const newMessages = [...prev]

          newMessages[newMessages.length - 1] = {
            role: 'assistant',
            content: json.response
          }
          
return newMessages
        })
        
      } catch (fallbackError) {
        setError(fallbackError?.message || t('ai.unknownError'))

        // Retirer le message assistant vide en cas d'erreur
        setMessages(prev => prev.slice(0, -1))
      }
    } finally {
      setLoading(false)
      setStreaming(false)
    }
  }, [messages, loading])
  
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }
  
  const handleClear = () => {
    setMessages([])
    setError(null)
  }
  
  const getModelDisplayName = () => {
    if (!aiSettings) return ''
    const provider = aiSettings.provider

    if (provider === 'ollama') return aiSettings.ollamaModel || 'Ollama'
    if (provider === 'openai') return aiSettings.openaiModel || 'OpenAI'
    if (provider === 'anthropic') return aiSettings.anthropicModel || 'Claude'
    
return provider
  }
  
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: { 
          width: { xs: '100%', sm: 450 },
          maxWidth: '100%',
          display: 'flex',
          flexDirection: 'column'
        }
      }}
    >
      {/* Header */}
      <Box
        sx={{
          p: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
          flexShrink: 0
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Avatar sx={{ bgcolor: theme.palette.primary.main, width: 40, height: 40 }}>
            <i className='ri-sparkling-2-fill' style={{ fontSize: 22 }} />
          </Avatar>
          <Box>
            <Typography variant="subtitle1" fontWeight={700}>
              {t('ai.title')}
            </Typography>
            {aiSettings && (
              <Typography variant="caption" sx={{ opacity: 0.7 }}>
                {getModelDisplayName()}
              </Typography>
            )}
          </Box>
        </Box>
        
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Tooltip title={t('ai.clearConversation')}>
            <IconButton size="small" onClick={handleClear} disabled={loading}>
              <i className='ri-delete-bin-line' style={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('common.close')}>
            <IconButton size="small" onClick={onClose}>
              <i className='ri-close-line' style={{ fontSize: 20 }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
      
      {/* Content */}
      <Box
        sx={{
          flex: 1,
          overflow: 'auto',
          p: 2,
          display: 'flex',
          flexDirection: 'column',
          bgcolor: theme.palette.mode === 'dark' 
            ? 'rgba(0,0,0,0.2)' 
            : 'rgba(0,0,0,0.02)'
        }}
      >
        {/* AI Not Enabled */}
        {aiEnabled === false && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            <Typography variant="body2" dangerouslySetInnerHTML={{ __html: t('ai.notEnabled') }} />
          </Alert>
        )}
        
        {/* Welcome Message */}
        {messages.length === 0 && aiEnabled && (
          <Box sx={{ textAlign: 'center', py: 3 }}>
            <Avatar 
              sx={{ 
                width: 64, 
                height: 64, 
                mx: 'auto', 
                mb: 2,
                bgcolor: theme.palette.primary.main 
              }}
            >
              <i className='ri-sparkling-2-fill' style={{ fontSize: 32 }} />
            </Avatar>
            <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>
              {t('ai.welcomeTitle')}
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.7, mb: 3 }} dangerouslySetInnerHTML={{ __html: t('ai.welcomeMessage') }} />
            
            <Divider sx={{ my: 2 }}>
              <Typography variant="caption" sx={{ opacity: 0.5 }}>
                {t('ai.suggestions')}
              </Typography>
            </Divider>

            <QuickSuggestions onSelect={sendMessage} disabled={loading} t={t} />
          </Box>
        )}
        
        {/* Messages */}
        {messages.map((msg, i) => (
          <MessageBubble
            key={i}
            message={msg}
            isUser={msg.role === 'user'}
            isStreaming={streaming && i === messages.length - 1 && msg.role === 'assistant'}
            thinkingText={t('ai.thinking')}
          />
        ))}

        {/* Loading indicator (seulement si pas de streaming) */}
        {loading && messages[messages.length - 1]?.role !== 'assistant' && (
          <MessageBubble
            message={{ content: '' }}
            isUser={false}
            isStreaming={true}
            thinkingText={t('ai.thinking')}
          />
        )}
        
        {/* Error */}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        
        <div ref={messagesEndRef} />
      </Box>
      
      {/* Input */}
      <Box
        sx={{
          p: 2,
          borderTop: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
          flexShrink: 0
        }}
      >
        <Paper
          elevation={0}
          sx={{
            display: 'flex',
            alignItems: 'flex-end',
            p: 1,
            pl: 2,
            border: 1,
            borderColor: loading ? 'primary.main' : 'divider',
            borderRadius: 3,
            bgcolor: theme.palette.action.hover,
            transition: 'border-color 0.2s'
          }}
        >
          <InputBase
            fullWidth
            multiline
            maxRows={4}
            placeholder={aiEnabled ? t('ai.askQuestion') : t('ai.aiNotEnabled')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            disabled={!aiEnabled || loading}
            sx={{ fontSize: 14 }}
          />
          <IconButton 
            color="primary" 
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || loading || !aiEnabled}
          >
            {loading ? (
              <CircularProgress size={20} />
            ) : (
              <i className='ri-send-plane-2-fill' />
            )}
          </IconButton>
        </Paper>
        
        <Typography variant="caption" sx={{ display: 'block', mt: 1, opacity: 0.5, textAlign: 'center' }}>
          {t('ai.inputHelp')}
        </Typography>
      </Box>
    </Drawer>
  )
}
