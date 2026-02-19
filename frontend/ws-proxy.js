#!/usr/bin/env node
/**
 * WebSocket Proxy pour noVNC/xterm.js -> Proxmox VNC/Terminal
 * 
 * Usage:
 *   node ws-proxy.js
 * 
 * Ce script :
 * 1. Écoute sur ws://localhost:3001
 * 2. Reçoit les connexions noVNC/xterm avec les paramètres ou sessionId
 * 3. Se connecte au VNC/Terminal de Proxmox et relaie les données
 * 
 * Routes:
 *   /ws/console/{sessionId} - Console VM/CT via session stockée
 *   /ws/shell?host=...&port=...&ticket=... - Shell node direct
 */

const http = require('http')

const { WebSocketServer, WebSocket } = require('ws')

const PORT = process.env.WS_PORT || 3001
// Always use localhost for internal API calls (ws-proxy runs in same container as frontend)
// APP_URL might be external HTTPS which would fail with self-signed certs
const APP_PORT = process.env.PORT || 3000
const INTERNAL_API_URL = `http://localhost:${APP_PORT}`

// Créer le serveur HTTP
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('WebSocket Proxy for noVNC/xterm.js\n')
})

// Créer le serveur WebSocket
const wss = new WebSocketServer({ server })

wss.on('connection', async (clientWs, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`)

  // Normalize path: strip /api/internal prefix if present (for direct access without nginx)
  let pathname = url.pathname
  if (pathname.startsWith('/api/internal/')) {
    pathname = pathname.replace('/api/internal', '')
  }

  const pathParts = pathname.split('/')

  console.log(`[WS] New connection: ${url.pathname} -> ${pathname}`)

  // Route: /ws/shell?host=...&port=...&ticket=...&node=...&user=...&apiToken=...&vmtype=...&vmid=...
  if (pathParts[1] === 'ws' && pathParts[2] === 'shell') {
    const host = url.searchParams.get('host')
    const port = url.searchParams.get('port')
    const ticket = url.searchParams.get('ticket')
    const node = url.searchParams.get('node')
    const user = url.searchParams.get('user')
    const pvePort = url.searchParams.get('pvePort') || '8006'
    const apiToken = url.searchParams.get('apiToken')
    const vmtype = url.searchParams.get('vmtype')  // 'qemu' or 'lxc' (optional, for VM/CT shell)
    const vmid = url.searchParams.get('vmid')      // VM/CT ID (optional)

    if (!host || !port || !ticket) {
      console.error('[WS] Missing shell parameters')
      clientWs.close(4000, 'Missing parameters: host, port, ticket required')
      return
    }

    console.log(`[WS] Shell connection to ${host}:${pvePort} (VNC port: ${port}, user: ${user}${vmtype ? `, ${vmtype}/${vmid}` : ''})`)

    try {
      // Build path: /nodes/{node}/vncwebsocket (node shell)
      //          or /nodes/{node}/qemu/{vmid}/vncwebsocket (VM shell)
      //          or /nodes/{node}/lxc/{vmid}/vncwebsocket (LXC shell)
      const basePath = `/api2/json/nodes/${encodeURIComponent(node || 'localhost')}`
      const vmPath = vmtype && vmid ? `/${vmtype}/${encodeURIComponent(vmid)}` : ''
      const pveWsUrl = `wss://${host}:${pvePort}${basePath}${vmPath}/vncwebsocket?port=${port}&vncticket=${encodeURIComponent(ticket)}`

      console.log(`[WS] Connecting to Proxmox: ${pveWsUrl.replace(/vncticket=[^&]+/, 'vncticket=***')}`)

      const wsHeaders = {
        'Origin': `https://${host}:${pvePort}`
      }

      if (apiToken) {
        wsHeaders['Authorization'] = `PVEAPIToken=${apiToken}`
        console.log('[WS] Using API token authentication')
      }

      const pveWs = new WebSocket(pveWsUrl, ['binary'], {
        rejectUnauthorized: false,
        headers: wsHeaders
      })

      // Proxmox termproxy handshake: send "user:ticket\n", wait for "OK"
      let authenticated = false

      pveWs.on('open', () => {
        console.log('[WS] Connected to Proxmox shell, sending auth handshake...')
        // Proxmox termproxy expects "user:ticket\n" as the first message
        // The ticket is bound to the full API token identity (user@realm!tokenname)
        const authUser = user || (apiToken ? apiToken.split('!')[0] : 'root@pam')
        pveWs.send(`${authUser}:${ticket}\n`)
      })

      pveWs.on('message', (data, isBinary) => {
        if (!authenticated) {
          // First message should be "OK" from Proxmox
          const text = Buffer.isBuffer(data) ? data.toString() :
                       data instanceof ArrayBuffer ? Buffer.from(data).toString() : String(data)
          if (text.startsWith('OK')) {
            authenticated = true
            console.log('[WS] Shell auth OK, session ready')
            return
          } else {
            console.error('[WS] Shell auth failed:', text)
            clientWs.close(4003, 'Proxmox auth failed')
            pveWs.close()
            return
          }
        }
        // After auth: relay data to client
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(data, { binary: isBinary })
        }
      })

      pveWs.on('close', (code, reason) => {
        console.log(`[WS] Proxmox shell closed: ${code} ${reason}`)
        if (clientWs.readyState === WebSocket.OPEN) {
          const safeCode = (code === 1000 || (code >= 3000 && code <= 4999)) ? code : 1000
          clientWs.close(safeCode, reason?.toString() || '')
        }
      })

      pveWs.on('error', (err) => {
        console.error('[WS] Proxmox shell error:', err.message)
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.close(4003, 'Proxmox connection error')
        }
      })

      // Relay client messages to Proxmox (only after auth)
      clientWs.on('message', (data, isBinary) => {
        if (pveWs.readyState === WebSocket.OPEN && authenticated) {
          pveWs.send(data, { binary: isBinary })
        }
      })

      clientWs.on('close', () => {
        console.log('[WS] Shell client disconnected')
        if (pveWs.readyState === WebSocket.OPEN) {
          pveWs.close()
        }
      })

      clientWs.on('error', (err) => {
        console.error('[WS] Shell client error:', err.message)
        if (pveWs.readyState === WebSocket.OPEN) {
          pveWs.close()
        }
      })

    } catch (err) {
      console.error('[WS] Shell error:', err)
      clientWs.close(4004, 'Internal error')
    }

    return
  }
  
  // Route: /ws/console/{sessionId} - VM/CT console via session
  if (pathParts[1] === 'ws' && pathParts[2] === 'console' && pathParts[3]) {
    const sessionId = pathParts[3]
    
    console.log(`[WS] Console session: ${sessionId}`)
    
    try {
      // Récupérer les infos de session depuis l'API (internal call via localhost)
      const sessionRes = await fetch(`${INTERNAL_API_URL}/api/internal/console/consume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      })
      
      if (!sessionRes.ok) {
        const err = await sessionRes.text()
        console.error(`[WS] Session not found or expired: ${sessionId}`, err)
        clientWs.close(4001, 'Session not found or expired')
        return
      }
      
      const session = await sessionRes.json()
      const { baseUrl, port, ticket, node, apiToken } = session
      
      if (!baseUrl || !port || !ticket) {
        console.error('[WS] Invalid session data:', session)
        clientWs.close(4002, 'Invalid session data')
        return
      }
      
      // Construire l'URL WebSocket vers Proxmox
      const pveUrl = new URL(baseUrl)
      const wsProtocol = pveUrl.protocol === 'https:' ? 'wss:' : 'ws:'
      const pveWsUrl = `${wsProtocol}//${pveUrl.host}/api2/json/nodes/${encodeURIComponent(node)}/${session.type}/${session.vmid}/vncwebsocket?port=${port}&vncticket=${encodeURIComponent(ticket)}`
      
      console.log(`[WS] Connecting to Proxmox: ${pveWsUrl.replace(/vncticket=[^&]+/, 'vncticket=***')}`)
      
      // Headers d'authentification pour Proxmox
      const wsHeaders = {
        'Origin': baseUrl
      }
      
      // Ajouter le token API si disponible
      if (apiToken) {
        wsHeaders['Authorization'] = `PVEAPIToken=${apiToken}`
      }
      
      // Se connecter à Proxmox
      const pveWs = new WebSocket(pveWsUrl, ['binary'], {
        rejectUnauthorized: false, // Pour les certificats auto-signés
        headers: wsHeaders
      })
      
      // Gérer la connexion Proxmox
      pveWs.on('open', () => {
        console.log(`[WS] Connected to Proxmox for session: ${sessionId}`)
      })
      
      pveWs.on('message', (data, isBinary) => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(data)
        }
      })
      
      pveWs.on('close', (code, reason) => {
        console.log(`[WS] Proxmox connection closed: ${code} ${reason}`)
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.close()
        }
      })
      
      pveWs.on('error', (err) => {
        console.error('[WS] Proxmox WebSocket error:', err.message)
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.close(4003, 'Proxmox connection error')
        }
      })
      
      // Relayer les messages du client vers Proxmox
      clientWs.on('message', (data, isBinary) => {
        if (pveWs.readyState === WebSocket.OPEN) {
          pveWs.send(data)
        }
      })
      
      clientWs.on('close', () => {
        console.log(`[WS] Client disconnected: ${sessionId}`)
        if (pveWs.readyState === WebSocket.OPEN) {
          pveWs.close()
        }
      })
      
      clientWs.on('error', (err) => {
        console.error('[WS] Client WebSocket error:', err.message)
        if (pveWs.readyState === WebSocket.OPEN) {
          pveWs.close()
        }
      })
      
    } catch (err) {
      console.error('[WS] Error:', err)
      clientWs.close(4004, 'Internal error')
    }
    
    return
  }
  
  // Route inconnue
  console.error('[WS] Unknown route:', url.pathname)
  clientWs.close(4000, 'Invalid path')
})

// Read version from package.json
let appVersion = 'latest'
try { appVersion = require('./package.json').version } catch {}

// Append git SHA for build traceability (e.g., 1.2.0-abc1234)
const gitSha = process.env.GIT_SHA
if (gitSha) appVersion += `-${gitSha.substring(0, 7)}`

const edition = process.env.ORCHESTRATOR_URL ? 'Enterprise' : 'Community'

server.listen(PORT, () => {
  const c = {
    orange: '\x1b[38;5;208m',
    green: '\x1b[32m',
    dim: '\x1b[90m',
    bold: '\x1b[1m',
    reset: '\x1b[0m',
    white: '\x1b[37m',
  }

  console.log(`
${c.orange}${c.bold} ██████╗ ██╗  ██╗ ██████╗
 ██╔══██╗╚██╗██╔╝██╔════╝
 ██████╔╝ ╚███╔╝ ██║
 ██╔═══╝  ██╔██╗ ██║
 ██║     ██╔╝ ██╗╚██████╗
 ╚═╝     ╚═╝  ╚═╝ ╚═════╝${c.reset}
 ${c.bold}ProxCenter${c.reset} ${c.dim}v${appVersion}${c.reset} ${c.dim}—${c.reset} ${c.white}${edition} Edition${c.reset}

 ${c.dim}Services${c.reset}
 ${c.dim}├─${c.reset} Frontend     ${c.white}http://0.0.0.0:${APP_PORT}${c.reset}   ${c.green}✓${c.reset}
 ${c.dim}├─${c.reset} WebSocket    ${c.white}ws://0.0.0.0:${PORT}${c.reset}     ${c.green}✓${c.reset}
 ${c.dim}└─${c.reset} Database     ${c.white}SQLite${c.reset}              ${c.green}✓${c.reset}

 ${c.dim}Routes${c.reset}
 ${c.dim}├─${c.reset} /ws/console/{sessionId}  ${c.dim}VM/CT console${c.reset}
 ${c.dim}└─${c.reset} /ws/shell?host=...       ${c.dim}Node shell${c.reset}
`)
})
