'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Box, CircularProgress, Typography, Chip, Button, IconButton, Tooltip } from '@mui/material'
import { useTranslations } from 'next-intl'

import { fullscreenSupported, isFullscreen, toggleFullscreen } from '@/lib/console/viewport'

interface XTermShellProps {
  sessionId: string
  // Connection and node the session belongs to. Optional because the status
  // bar is the only consumer: without them the pop-out control is hidden
  // rather than opening a window that could not create its own session.
  connId?: string
  node?: string
  // Display-only label shown in the status bar. The actual host/port
  // PVE talks to live server-side in the consume route and never leak
  // to the browser.
  host: string
  onDisconnect?: () => void
}

export default function XTermShell({ sessionId, connId, node, host, onDisconnect }: XTermShellProps) {
  const t = useTranslations()
  const rootRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<any>(null)
  const fitAddonRef = useRef<any>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [canFullscreen, setCanFullscreen] = useState(false)

  // Remesure le terminal et annonce la nouvelle géométrie à Proxmox : termproxy
  // ne demande jamais la taille, donc un redimensionnement que le client garde
  // pour lui laisse le pty distant sur ses anciens cols/rows et casse le retour
  // à la ligne des commandes longues.
  const refit = useCallback(() => {
    if (!fitAddonRef.current || !xtermRef.current) return

    fitAddonRef.current.fit()

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(`1:${xtermRef.current.cols}:${xtermRef.current.rows}:`)
    }
  }, [])

  // Une fenêtre par nœud: le nom de fenêtre est la clé, donc un second clic
  // ramène la fenêtre existante au premier plan au lieu d'empiler les shells.
  // Chaque fenêtre crée SA session termproxy, celle de l'onglet continue de
  // vivre.
  const detach = useCallback(() => {
    if (!connId || !node) return

    const url = `/xterm/console.html?connId=${encodeURIComponent(connId)}&node=${encodeURIComponent(node)}`
    const popup = window.open(
      url,
      `shell-${connId}-${node}`,
      'width=1024,height=768,menubar=no,toolbar=no,location=no,status=no'
    )

    popup?.focus()
  }, [connId, node])

  const connect = useCallback(async () => {
    if (!terminalRef.current) return

    setStatus('connecting')
    setErrorMsg(null)

    try {
      // Import dynamique de xterm (client-side only)
      const { Terminal } = await import('xterm')
      const { FitAddon } = await import('@xterm/addon-fit')
      
      // Importer le CSS
      await import('xterm/css/xterm.css')

      // Créer le terminal si pas encore fait
      if (!xtermRef.current) {
        const terminal = new Terminal({
          cursorBlink: true,
          cursorStyle: 'block',
          fontSize: 14,
          fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", Menlo, Monaco, "Courier New", monospace',
          theme: {
            background: '#0c0c0c',
            foreground: '#cccccc',
            cursor: '#ffffff',
            cursorAccent: '#000000',
            selectionBackground: '#264f78',
            black: '#0c0c0c',
            red: '#c50f1f',
            green: '#13a10e',
            yellow: '#c19c00',
            blue: '#0037da',
            magenta: '#881798',
            cyan: '#3a96dd',
            white: '#cccccc',
            brightBlack: '#767676',
            brightRed: '#e74856',
            brightGreen: '#16c60c',
            brightYellow: '#f9f1a5',
            brightBlue: '#3b78ff',
            brightMagenta: '#b4009e',
            brightCyan: '#61d6d6',
            brightWhite: '#f2f2f2'
          },
          scrollback: 10000,
          allowProposedApi: true,
        })

        const fitAddon = new FitAddon()
        terminal.loadAddon(fitAddon)

        terminal.open(terminalRef.current)
        fitAddon.fit()

        xtermRef.current = terminal
        fitAddonRef.current = fitAddon

        // Input handler - envoyer les données au serveur
        terminal.onData((data: string) => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            // Format Proxmox termproxy: 0:length:data
            wsRef.current.send(`0:${data.length}:${data}`)
          }
        })
      } else {
        // Terminal existe déjà, juste le nettoyer
        xtermRef.current.clear()
      }

      // Fermer l'ancienne connexion si elle existe
      if (wsRef.current) {
        wsRef.current.close()
      }

      // Connexion WebSocket via le proxy. In dev mode, next dev doesn't
      // handle WS upgrades so we redirect to the standalone ws-proxy on
      // 3001. The browser only ever passes a sessionId; host/port/
      // ticket/apiToken stay server-side (NEW-C / NEW-H1).
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const isDev = window.location.port === '3000' && window.location.hostname === 'localhost'
      const wsHost = isDev ? 'localhost:3001' : window.location.host
      const proxyWsUrl = `${wsProtocol}//${wsHost}/api/internal/ws/shell/${encodeURIComponent(sessionId)}`

      console.log('[XTerm] Connecting to proxy:', proxyWsUrl)
      
      const ws = new WebSocket(proxyWsUrl, ['binary'])
      wsRef.current = ws

      ws.binaryType = 'arraybuffer'

      ws.onopen = () => {
        console.log('[XTerm] WebSocket connected')
        setStatus('connected')
        xtermRef.current?.focus()

        // Envoyer les dimensions initiales après un court délai
        setTimeout(refit, 100)
      }

      ws.onmessage = (event) => {
        if (!xtermRef.current) return

        if (event.data instanceof ArrayBuffer) {
          const decoder = new TextDecoder()
          xtermRef.current.write(decoder.decode(event.data))
        } else if (typeof event.data === 'string') {
          xtermRef.current.write(event.data)
        } else if (event.data instanceof Blob) {
          event.data.text().then((text: string) => {
            xtermRef.current?.write(text)
          })
        }
      }

      ws.onclose = (event) => {
        console.log('[XTerm] WebSocket closed:', event.code, event.reason)
        // Ignore stale closes from a previous WS that was superseded
        // (React StrictMode double-mount in dev, manual Reconnect, etc).
        // Without this guard a successful reconnect keeps the red error
        // banner from the obsolete socket forever.
        if (wsRef.current !== ws) return
        setStatus('disconnected')
        // 1000 = normal, 1005 = no status (browser close() without args).
        // Either is a clean shutdown from our side, not an error.
        if (event.code !== 1000 && event.code !== 1005) {
          setErrorMsg(`Connection closed: ${event.reason || 'Unknown reason'}`)
        }
      }

      ws.onerror = (error) => {
        console.error('[XTerm] WebSocket error:', error)
        if (wsRef.current !== ws) return
        setStatus('error')
        setErrorMsg('WebSocket connection failed.')
      }

    } catch (err: any) {
      console.error('[XTerm] Error:', err)
      setStatus('error')
      setErrorMsg(err.message || 'Failed to initialize terminal')
    }
  }, [sessionId, refit])

  // Connexion initiale
  useEffect(() => {
    connect()

    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [connect])

  // Le plein écran n'existe pas côté serveur, et l'élément n'est monté qu'au
  // premier rendu client : sonder au montage évite un bouton qui apparaît après
  // l'hydratation.
  useEffect(() => {
    setCanFullscreen(fullscreenSupported(rootRef.current))
  }, [])

  // Redimensionnement de la fenêtre et entrées/sorties de plein écran changent
  // tous les deux la boîte du terminal. Les orthographes webkit/MS suivent
  // celles de lib/console/viewport : ces écrans s'ouvrent aussi dans le
  // navigateur qu'un serveur de rebond a sous la main.
  useEffect(() => {
    const syncFullscreen = () => {
      setFullscreen(isFullscreen(document))
      // La boîte plein écran n'est mise en page qu'à la frame suivante :
      // mesurer maintenant ajusterait le terminal à la taille qu'il quitte.
      requestAnimationFrame(refit)
    }

    window.addEventListener('resize', refit)
    document.addEventListener('fullscreenchange', syncFullscreen)
    document.addEventListener('webkitfullscreenchange', syncFullscreen)
    document.addEventListener('MSFullscreenChange', syncFullscreen)

    return () => {
      window.removeEventListener('resize', refit)
      document.removeEventListener('fullscreenchange', syncFullscreen)
      document.removeEventListener('webkitfullscreenchange', syncFullscreen)
      document.removeEventListener('MSFullscreenChange', syncFullscreen)
    }
  }, [refit])

  // Focus le terminal quand il devient visible
  useEffect(() => {
    if (status === 'connected' && xtermRef.current) {
      xtermRef.current.focus()
    }
  }, [status])

  return (
    <Box ref={rootRef} sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: '#0c0c0c' }}>
      {/* Status bar */}
      <Box sx={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        px: 2, 
        py: 1, 
        bgcolor: '#1a1a1a', 
        borderBottom: '1px solid #333' 
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              bgcolor: status === 'connected' ? '#22c55e' : 
                       status === 'connecting' ? '#f59e0b' : 
                       status === 'error' ? '#ef4444' : '#6b7280',
              animation: status === 'connecting' ? 'pulse 1s infinite' : 'none',
              '@keyframes pulse': {
                '0%, 100%': { opacity: 1 },
                '50%': { opacity: 0.5 }
              }
            }}
          />
          <Chip 
            label="xterm.js" 
            size="small" 
            sx={{ 
              height: 20, 
              fontSize: 10, 
              bgcolor: '#22c55e', 
              color: '#fff',
              '& .MuiChip-label': { px: 1 }
            }} 
          />
          <Typography sx={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>
            {host}
          </Typography>
          <Typography sx={{ color: '#666', fontSize: 12 }}>
            • {status === 'connected' ? 'Connected' : 
               status === 'connecting' ? 'Connecting...' : 
               status === 'error' ? 'Error' : 'Disconnected'}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {connId && node && (
            <Tooltip title={t('console.openInNewWindow')}>
              <IconButton
                size="small"
                aria-label={t('console.openInNewWindow')}
                onClick={detach}
                sx={{
                  width: 26,
                  height: 26,
                  color: '#ccc',
                  border: '1px solid #444',
                  borderRadius: 1,
                  '&:hover': { borderColor: '#666', bgcolor: '#333' }
                }}
              >
                <i className="ri-external-link-line" style={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          )}
          {canFullscreen && (
            <Tooltip title={fullscreen ? t('console.exitFullscreen') : t('console.fullscreen')}>
              <IconButton
                size="small"
                aria-label={fullscreen ? t('console.exitFullscreen') : t('console.fullscreen')}
                onClick={() => setFullscreen(toggleFullscreen(document, rootRef.current))}
                sx={{
                  width: 26,
                  height: 26,
                  color: '#ccc',
                  border: '1px solid #444',
                  borderRadius: 1,
                  '&:hover': { borderColor: '#666', bgcolor: '#333' }
                }}
              >
                <i className={fullscreen ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line'} style={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          )}
          {status !== 'connected' && (
            <Button 
              size="small" 
              variant="outlined"
              onClick={connect}
              sx={{ 
                color: '#ccc', 
                borderColor: '#444',
                fontSize: 11,
                py: 0.5,
                '&:hover': { borderColor: '#666', bgcolor: '#333' }
              }}
            >
              Reconnect
            </Button>
          )}
          {onDisconnect && (
            <Button 
              size="small" 
              variant="outlined"
              onClick={() => {
                wsRef.current?.close()
                onDisconnect()
              }}
              sx={{ 
                color: '#888', 
                borderColor: '#444',
                fontSize: 11,
                py: 0.5,
                '&:hover': { borderColor: '#666', bgcolor: '#333' }
              }}
            >
              Close
            </Button>
          )}
        </Box>
      </Box>

      {/* Error message */}
      {errorMsg && (
        <Box sx={{ px: 2, py: 1, bgcolor: '#7f1d1d', color: '#fecaca', fontSize: 12 }}>
          {errorMsg}
        </Box>
      )}

      {/* Terminal container */}
      <Box sx={{ flex: 1, position: 'relative' }}>
        {/* Loading overlay */}
        {status === 'connecting' && (
          <Box sx={{ 
            position: 'absolute', 
            inset: 0, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            bgcolor: 'rgba(0,0,0,0.8)',
            zIndex: 10
          }}>
            <Box sx={{ textAlign: 'center' }}>
              <CircularProgress size={32} sx={{ color: '#22c55e' }} />
              <Typography sx={{ mt: 2, color: '#888', fontSize: 13 }}>
                Connecting to {host}...
              </Typography>
            </Box>
          </Box>
        )}

        {/* Disconnected overlay */}
        {status === 'disconnected' && (
          <Box sx={{ 
            position: 'absolute', 
            inset: 0, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            bgcolor: 'rgba(0,0,0,0.8)',
            zIndex: 10
          }}>
            <Box sx={{ textAlign: 'center' }}>
              <i className="ri-wifi-off-line" style={{ fontSize: 48, color: '#666' }} />
              <Typography sx={{ mt: 2, color: '#888', fontSize: 13 }}>
                Disconnected
              </Typography>
              <Button 
                variant="contained" 
                size="small" 
                onClick={connect}
                sx={{ mt: 2 }}
              >
                Reconnect
              </Button>
            </Box>
          </Box>
        )}

        {/* Terminal element */}
        <Box 
          ref={terminalRef}
          sx={{ 
            height: '100%', 
            width: '100%',
            '& .xterm': {
              height: '100%',
              padding: '8px'
            }
          }}
        />
      </Box>
    </Box>
  )
}
