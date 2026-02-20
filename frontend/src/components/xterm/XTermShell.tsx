'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Box, CircularProgress, Typography, Chip, Button } from '@mui/material'

interface XTermShellProps {
  wsUrl: string
  host: string
  port: number
  ticket: string
  node: string
  user?: string
  pvePort?: number
  apiToken?: string
  vmtype?: string  // 'qemu' | 'lxc' for VM/CT shell
  vmid?: string    // VM/CT ID
  onDisconnect?: () => void
}

export default function XTermShell({ wsUrl, host, port, ticket, node, user, pvePort = 8006, apiToken, vmtype, vmid, onDisconnect }: XTermShellProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<any>(null)
  const fitAddonRef = useRef<any>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

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

        // Resize handler
        const handleResize = () => {
          if (fitAddonRef.current) {
            fitAddonRef.current.fit()
            // Envoyer les nouvelles dimensions au serveur Proxmox
            if (wsRef.current?.readyState === WebSocket.OPEN && xtermRef.current) {
              const dims = `1:${xtermRef.current.cols}:${xtermRef.current.rows}:`
              wsRef.current.send(dims)
            }
          }
        }
        window.addEventListener('resize', handleResize)

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

      // Connexion WebSocket via le proxy (unified server handles WS on same port)
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      let proxyWsUrl = `${wsProtocol}//${window.location.host}/api/internal/ws/shell?host=${encodeURIComponent(host)}&port=${port}&ticket=${encodeURIComponent(ticket)}&node=${encodeURIComponent(node)}&pvePort=${pvePort}`

      if (user) {
        proxyWsUrl += `&user=${encodeURIComponent(user)}`
      }
      if (apiToken) {
        proxyWsUrl += `&apiToken=${encodeURIComponent(apiToken)}`
      }
      if (vmtype && vmid) {
        proxyWsUrl += `&vmtype=${encodeURIComponent(vmtype)}&vmid=${encodeURIComponent(vmid)}`
      }
      
      console.log('[XTerm] Connecting to proxy:', proxyWsUrl.replace(/ticket=[^&]+/, 'ticket=***').replace(/apiToken=[^&]+/, 'apiToken=***'))
      
      const ws = new WebSocket(proxyWsUrl, ['binary'])
      wsRef.current = ws

      ws.binaryType = 'arraybuffer'

      ws.onopen = () => {
        console.log('[XTerm] WebSocket connected')
        setStatus('connected')
        xtermRef.current?.focus()

        // Envoyer les dimensions initiales après un court délai
        setTimeout(() => {
          if (fitAddonRef.current && xtermRef.current) {
            fitAddonRef.current.fit()
            const dims = `1:${xtermRef.current.cols}:${xtermRef.current.rows}:`
            ws.send(dims)
          }
        }, 100)
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
        setStatus('disconnected')
        if (event.code !== 1000) {
          setErrorMsg(`Connection closed: ${event.reason || 'Unknown reason'}`)
        }
      }

      ws.onerror = (error) => {
        console.error('[XTerm] WebSocket error:', error)
        setStatus('error')
        setErrorMsg('WebSocket connection failed.')
      }

    } catch (err: any) {
      console.error('[XTerm] Error:', err)
      setStatus('error')
      setErrorMsg(err.message || 'Failed to initialize terminal')
    }
  }, [host, port, ticket, node, user, pvePort, apiToken, vmtype, vmid])

  // Connexion initiale
  useEffect(() => {
    connect()

    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [connect])

  // Focus le terminal quand il devient visible
  useEffect(() => {
    if (status === 'connected' && xtermRef.current) {
      xtermRef.current.focus()
    }
  }, [status])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: '#0c0c0c' }}>
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
            {host}:{port}
          </Typography>
          <Typography sx={{ color: '#666', fontSize: 12 }}>
            • {status === 'connected' ? 'Connected' : 
               status === 'connecting' ? 'Connecting...' : 
               status === 'error' ? 'Error' : 'Disconnected'}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
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
