#!/usr/bin/env node
/**
 * WebSocket Proxy pour noVNC/xterm.js -> Proxmox VNC/Terminal
 *
 * Can be used in two modes:
 *   1. Imported as module: require('./ws-proxy').handleWsConnection
 *   2. Standalone: node ws-proxy.js (for debugging)
 *
 * Routes:
 *   /ws/console/{sessionId} - Console VM/CT via session stockée
 *   /ws/shell/{sessionId}   - Shell node via session stockée
 */

// Load .env files before reading APP_SECRET / PORT / etc. ws-proxy
// runs under `node`, which (unlike `next dev`) does not auto-load .env,
// so process.env.APP_SECRET would be empty in local dev without this.
// @next/env is bundled with Next and silently no-ops in containers where
// no .env file is present (the secret is provided via the container env).
try {
  const path = require('node:path')
  require('@next/env').loadEnvConfig(path.join(__dirname))
} catch {
  // @next/env unavailable (standalone runtime build) — fall back to
  // whatever the container injected via env.
}

const { WebSocket } = require('ws')

// Always use localhost for internal API calls (ws-proxy runs in same container as frontend)
const APP_PORT = process.env.PORT || 3000
const INTERNAL_API_URL = `http://localhost:${APP_PORT}`

// Shared secret used to authenticate ws-proxy against the Next.js
// /api/internal/* routes. process.env.APP_SECRET is set by the same
// .env that backs the rest of the app; without it the consume routes
// return 500 and no proxy session can be established.
const INTERNAL_SECRET = process.env.APP_SECRET || ''
const INTERNAL_HEADERS = {
  'Content-Type': 'application/json',
  'X-Internal-Caller': 'proxcenter-ws-proxy',
  ...(INTERNAL_SECRET ? { 'X-Internal-Secret': INTERNAL_SECRET } : {}),
}

/**
 * Handle an incoming WebSocket connection.
 * Called by the unified server (start.js) or standalone wss.
 */
async function handleWsConnection(clientWs, req) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)

  // Normalize path: strip /api/internal prefix if present (for direct access without nginx)
  let pathname = url.pathname
  if (pathname.startsWith('/api/internal/')) {
    pathname = pathname.replace('/api/internal', '')
  }

  const pathParts = pathname.split('/')

  console.log(`[WS] New connection: ${url.pathname} -> ${pathname}`)

  // Route: /ws/shell/{sessionId}
  // The browser only ever sees a sessionId. We trade it for the actual
  // PVE termproxy parameters (including the apiToken) here, behind the
  // APP_SECRET-gated /api/internal/shell/consume endpoint.
  if (pathParts[1] === 'ws' && pathParts[2] === 'shell' && pathParts[3]) {
    const sessionId = pathParts[3]

    console.log(`[WS] Shell session: ${sessionId}`)

    let session
    try {
      const sessionRes = await fetch(`${INTERNAL_API_URL}/api/internal/shell/consume`, {
        method: 'POST',
        headers: INTERNAL_HEADERS,
        body: JSON.stringify({ sessionId })
      })
      if (!sessionRes.ok) {
        const err = await sessionRes.text()
        console.error(`[WS] Shell session not found or expired: ${sessionId}`, err)
        clientWs.close(4001, 'Session not found or expired')
        return
      }
      session = await sessionRes.json()
    } catch (err) {
      console.error('[WS] Shell consume error:', err.message)
      clientWs.close(4004, 'Internal error')
      return
    }

    const { host, pvePort, port, ticket, node, user, apiToken, insecure } = session
    if (!host || !port || !ticket || !node) {
      console.error('[WS] Invalid shell session data:', session)
      clientWs.close(4002, 'Invalid session data')
      return
    }

    // Mirror the connection's insecureTLS flag instead of accepting
    // every certificate unconditionally. Default missing/undefined to
    // the legacy permissive behaviour so an in-flight rolling deploy
    // where an old session predates the field does not lock anyone out.
    const rejectUnauthorized = insecure === false

    console.log(`[WS] Shell connection to ${host}:${pvePort} (VNC port: ${port}, user: ${user}, tls_verify: ${rejectUnauthorized})`)

    try {
      const basePath = `/api2/json/nodes/${encodeURIComponent(node)}`
      const pveWsUrl = `wss://${host}:${pvePort}${basePath}/vncwebsocket?port=${port}&vncticket=${encodeURIComponent(ticket)}`

      console.log(`[WS] Connecting to Proxmox: ${pveWsUrl.replace(/vncticket=[^&]+/, 'vncticket=***')}`)

      const wsHeaders = {
        'Origin': `https://${host}:${pvePort}`
      }
      if (apiToken) {
        wsHeaders['Authorization'] = `PVEAPIToken=${apiToken}`
      }

      const pveWs = new WebSocket(pveWsUrl, ['binary'], {
        rejectUnauthorized,
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
        headers: INTERNAL_HEADERS,
        body: JSON.stringify({ sessionId })
      })

      if (!sessionRes.ok) {
        const err = await sessionRes.text()
        console.error(`[WS] Session not found or expired: ${sessionId}`, err)
        clientWs.close(4001, 'Session not found or expired')
        return
      }

      const session = await sessionRes.json()
      const { baseUrl, port, ticket, node, apiToken, insecure } = session

      if (!baseUrl || !port || !ticket) {
        console.error('[WS] Invalid session data:', session)
        clientWs.close(4002, 'Invalid session data')
        return
      }

      // Construire l'URL WebSocket vers Proxmox
      const pveUrl = new URL(baseUrl)
      const wsProtocol = pveUrl.protocol === 'https:' ? 'wss:' : 'ws:'
      const pveWsUrl = `${wsProtocol}//${pveUrl.host}/api2/json/nodes/${encodeURIComponent(node)}/${session.type}/${session.vmid}/vncwebsocket?port=${port}&vncticket=${encodeURIComponent(ticket)}`

      // Mirror the connection's insecureTLS flag rather than blanket-
      // accepting every cert. False means strict TLS verification.
      // Default to permissive on missing field to survive rolling
      // deploys where the consume route predates the change.
      const rejectUnauthorized = insecure === false

      console.log(`[WS] Connecting to Proxmox: ${pveWsUrl.replace(/vncticket=[^&]+/, 'vncticket=***')} (tls_verify: ${rejectUnauthorized})`)

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
        rejectUnauthorized,
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
}

// Export for use by start.js
module.exports = { handleWsConnection }

// Standalone mode (for debugging): node ws-proxy.js
if (require.main === module) {
  const http = require('http')
  const { WebSocketServer } = require('ws')

  const PORT = process.env.WS_PORT || 3001

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('WebSocket Proxy for noVNC/xterm.js (standalone debug mode)\n')
  })

  const wss = new WebSocketServer({ server })
  wss.on('connection', handleWsConnection)

  server.listen(PORT, () => {
    console.log(`[WS] Standalone proxy listening on port ${PORT}`)
  })
}
