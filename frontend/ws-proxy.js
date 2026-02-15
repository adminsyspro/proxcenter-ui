#!/usr/bin/env node
/**
 * Unified Gateway — single entry point for ProxCenter
 *
 * Listens on PORT (default 3000) and:
 *   • HTTP requests  → reverse-proxied to Next.js on NEXT_PORT (default 3100)
 *   • WS upgrades on /api/internal/ws/* or /ws/*  → handled directly (shell / console)
 *   • Other WS upgrades → proxied to Next.js (HMR in dev, etc.)
 *
 * This means ProxCenter works out-of-the-box on a single port.
 * If you put nginx in front, just proxy everything to this port.
 */

const http = require('http')
const { WebSocketServer, WebSocket } = require('ws')

const PORT = parseInt(process.env.GATEWAY_PORT || process.env.PORT || '3000')
const NEXT_PORT = parseInt(process.env.NEXT_PORT || '3100')
const INTERNAL_API_URL = `http://127.0.0.1:${NEXT_PORT}`

/* ─────────── HTTP reverse proxy ─────────── */

const server = http.createServer((clientReq, clientRes) => {
  const proxyReq = http.request(
    {
      hostname: '127.0.0.1',
      port: NEXT_PORT,
      path: clientReq.url,
      method: clientReq.method,
      headers: clientReq.headers,
    },
    (proxyRes) => {
      clientRes.writeHead(proxyRes.statusCode, proxyRes.headers)
      proxyRes.pipe(clientRes)
    },
  )
  proxyReq.on('error', (err) => {
    console.error('[Gateway] HTTP proxy error:', err.message)
    if (!clientRes.headersSent) {
      clientRes.writeHead(502)
      clientRes.end('Bad Gateway')
    }
  })
  clientReq.pipe(proxyReq)
})

/* ─────────── WebSocket handling ─────────── */

const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost')
  let pathname = url.pathname

  // Strip /api/internal prefix (browser sends /api/internal/ws/...)
  if (pathname.startsWith('/api/internal/')) {
    pathname = pathname.replace('/api/internal', '')
  }

  if (pathname.startsWith('/ws/')) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleWsConnection(ws, url, pathname)
    })
  } else {
    // Proxy other WS upgrades to Next.js (HMR, etc.)
    const proxyReq = http.request({
      hostname: '127.0.0.1',
      port: NEXT_PORT,
      path: req.url,
      method: req.method,
      headers: req.headers,
    })
    proxyReq.on('upgrade', (proxyRes, proxySocket) => {
      let responseHead = 'HTTP/1.1 101 Switching Protocols\r\n'
      for (const [key, value] of Object.entries(proxyRes.headers)) {
        if (Array.isArray(value)) {
          value.forEach((v) => { responseHead += `${key}: ${v}\r\n` })
        } else if (value != null) {
          responseHead += `${key}: ${value}\r\n`
        }
      }
      responseHead += '\r\n'
      socket.write(responseHead)
      proxySocket.pipe(socket)
      socket.pipe(proxySocket)
    })
    proxyReq.on('error', (err) => {
      console.error('[Gateway] WS proxy error:', err.message)
      socket.destroy()
    })
    proxyReq.end()
  }
})

/* ─────────── WS route handler ─────────── */

async function handleWsConnection(clientWs, url, pathname) {
  const pathParts = pathname.split('/')

  console.log(`[WS] New connection: ${url.pathname} -> ${pathname}`)

  // ── Route: /ws/shell ──
  if (pathParts[1] === 'ws' && pathParts[2] === 'shell') {
    const host = url.searchParams.get('host')
    const port = url.searchParams.get('port')
    const ticket = url.searchParams.get('ticket')
    const node = url.searchParams.get('node')
    const pvePort = url.searchParams.get('pvePort') || '8006'
    const apiToken = url.searchParams.get('apiToken')

    if (!host || !port || !ticket) {
      console.error('[WS] Missing shell parameters')
      clientWs.close(4000, 'Missing parameters: host, port, ticket required')
      return
    }

    console.log(`[WS] Shell connection to ${host}:${pvePort} (VNC port: ${port})`)

    try {
      const pveWsUrl = `wss://${host}:${pvePort}/api2/json/nodes/${encodeURIComponent(node || 'localhost')}/vncwebsocket?port=${port}&vncticket=${encodeURIComponent(ticket)}`
      console.log(`[WS] Connecting to Proxmox: ${pveWsUrl.replace(/vncticket=[^&]+/, 'vncticket=***')}`)

      const wsHeaders = { Origin: `https://${host}:${pvePort}` }
      if (apiToken) {
        wsHeaders['Authorization'] = `PVEAPIToken=${apiToken}`
        console.log('[WS] Using API token authentication')
      }

      const pveWs = new WebSocket(pveWsUrl, ['binary'], {
        rejectUnauthorized: false,
        headers: wsHeaders,
      })

      pveWs.on('open', () => console.log('[WS] Connected to Proxmox shell'))
      pveWs.on('message', (data, isBinary) => {
        if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data, { binary: isBinary })
      })
      pveWs.on('close', (code, reason) => {
        console.log(`[WS] Proxmox shell closed: ${code} ${reason}`)
        if (clientWs.readyState === WebSocket.OPEN) clientWs.close(code, reason?.toString())
      })
      pveWs.on('error', (err) => {
        console.error('[WS] Proxmox shell error:', err.message)
        if (clientWs.readyState === WebSocket.OPEN) clientWs.close(4003, 'Proxmox connection error')
      })

      clientWs.on('message', (data, isBinary) => {
        if (pveWs.readyState === WebSocket.OPEN) pveWs.send(data, { binary: isBinary })
      })
      clientWs.on('close', () => {
        console.log('[WS] Shell client disconnected')
        if (pveWs.readyState === WebSocket.OPEN) pveWs.close()
      })
      clientWs.on('error', (err) => {
        console.error('[WS] Shell client error:', err.message)
        if (pveWs.readyState === WebSocket.OPEN) pveWs.close()
      })
    } catch (err) {
      console.error('[WS] Shell error:', err)
      clientWs.close(4004, 'Internal error')
    }
    return
  }

  // ── Route: /ws/console/{sessionId} ──
  if (pathParts[1] === 'ws' && pathParts[2] === 'console' && pathParts[3]) {
    const sessionId = pathParts[3]
    console.log(`[WS] Console session: ${sessionId}`)

    try {
      const sessionRes = await fetch(`${INTERNAL_API_URL}/api/internal/console/consume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
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

      const pveUrl = new URL(baseUrl)
      const wsProtocol = pveUrl.protocol === 'https:' ? 'wss:' : 'ws:'
      const pveWsUrl = `${wsProtocol}//${pveUrl.host}/api2/json/nodes/${encodeURIComponent(node)}/${session.type}/${session.vmid}/vncwebsocket?port=${port}&vncticket=${encodeURIComponent(ticket)}`
      console.log(`[WS] Connecting to Proxmox: ${pveWsUrl.replace(/vncticket=[^&]+/, 'vncticket=***')}`)

      const wsHeaders = { Origin: baseUrl }
      if (apiToken) wsHeaders['Authorization'] = `PVEAPIToken=${apiToken}`

      const pveWs = new WebSocket(pveWsUrl, ['binary'], {
        rejectUnauthorized: false,
        headers: wsHeaders,
      })

      pveWs.on('open', () => console.log(`[WS] Connected to Proxmox for session: ${sessionId}`))
      pveWs.on('message', (data) => {
        if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data)
      })
      pveWs.on('close', (code, reason) => {
        console.log(`[WS] Proxmox connection closed: ${code} ${reason}`)
        if (clientWs.readyState === WebSocket.OPEN) clientWs.close()
      })
      pveWs.on('error', (err) => {
        console.error('[WS] Proxmox WebSocket error:', err.message)
        if (clientWs.readyState === WebSocket.OPEN) clientWs.close(4003, 'Proxmox connection error')
      })

      clientWs.on('message', (data) => {
        if (pveWs.readyState === WebSocket.OPEN) pveWs.send(data)
      })
      clientWs.on('close', () => {
        console.log(`[WS] Client disconnected: ${sessionId}`)
        if (pveWs.readyState === WebSocket.OPEN) pveWs.close()
      })
      clientWs.on('error', (err) => {
        console.error('[WS] Client WebSocket error:', err.message)
        if (pveWs.readyState === WebSocket.OPEN) pveWs.close()
      })
    } catch (err) {
      console.error('[WS] Error:', err)
      clientWs.close(4004, 'Internal error')
    }
    return
  }

  // Unknown route
  console.error('[WS] Unknown route:', pathname)
  clientWs.close(4000, 'Invalid path')
}

/* ─────────── Start ─────────── */

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
██████╗ ██╗  ██╗ ██████╗
██╔══██╗╚██╗██╔╝██╔════╝
██████╔╝ ╚███╔╝ ██║
██╔═══╝  ██╔██╗ ██║
██║     ██╔╝ ██╗╚██████╗
╚═╝     ╚═╝  ╚═╝ ╚═════╝
ProxCenter - Control Plane

╔════════════════════════════════════════════════════╗
║  Unified Gateway (HTTP + WebSocket)                ║
║  Listening on http://0.0.0.0:${String(PORT).padEnd(25)}║
║  Next.js backend: http://127.0.0.1:${String(NEXT_PORT).padEnd(17)}║
║                                                    ║
║  Routes:                                           ║
║    /ws/console/{sessionId} - VM/CT console         ║
║    /ws/shell?host=...      - Node shell            ║
║    /*                      - Next.js (proxy)       ║
╚════════════════════════════════════════════════════╝
`)
})
