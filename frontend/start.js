#!/usr/bin/env node
/**
 * ProxCenter Unified Server
 *
 * Single entry point serving both Next.js HTTP and WebSocket proxy on port 3000.
 * This eliminates the need for a separate ws-proxy process on port 3001 and
 * ensures WebSocket connections work in all deployment modes:
 *   - Community (no nginx): direct access on port 3000
 *   - Enterprise (nginx): nginx proxies to port 3000
 *   - User-configured nginx: upstream points to port 3000
 */

const path = require('path')
const http = require('http')
const { WebSocketServer } = require('ws')

const dir = path.join(__dirname)

process.env.NODE_ENV = 'production'
process.chdir(__dirname)

const PORT = parseInt(process.env.PORT, 10) || 3000
const hostname = process.env.HOSTNAME || '0.0.0.0'

let keepAliveTimeout = parseInt(process.env.KEEP_ALIVE_TIMEOUT, 10)
if (
  Number.isNaN(keepAliveTimeout) ||
  !Number.isFinite(keepAliveTimeout) ||
  keepAliveTimeout < 0
) {
  keepAliveTimeout = undefined
}

// Load Next.js config from standalone build
const nextConfig = require('./.next/required-server-files.json').config
process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig)

require('next')
const { getRequestHandlers } = require('next/dist/server/lib/start-server')

// Import ws-proxy handler
const { handleWsConnection } = require('./ws-proxy')

async function main() {
  // Get Next.js request & upgrade handlers
  const initResult = await getRequestHandlers({
    dir,
    port: PORT,
    isDev: false,
    onDevServerCleanup: undefined,
    hostname,
    minimalMode: false,
    keepAliveTimeout,
    quiet: true,
  })

  const nextRequestHandler = initResult.requestHandler
  const nextUpgradeHandler = initResult.upgradeHandler

  // Create a single HTTP server
  const server = http.createServer(async (req, res) => {
    try {
      await nextRequestHandler(req, res)
    } catch (err) {
      console.error('[start] HTTP request error:', err)
      res.statusCode = 500
      res.end('Internal Server Error')
    }
  })

  if (keepAliveTimeout) {
    server.keepAliveTimeout = keepAliveTimeout
  }

  // WebSocket server (noServer mode — we handle upgrade routing ourselves)
  const wss = new WebSocketServer({ noServer: true })

  wss.on('connection', (clientWs, req) => {
    handleWsConnection(clientWs, req)
  })

  // Route upgrade requests
  server.on('upgrade', (req, socket, head) => {
    const pathname = req.url?.split('?')[0] || ''

    // Route WebSocket paths to our ws-proxy
    if (
      pathname.startsWith('/ws/') ||
      pathname.startsWith('/api/internal/ws/')
    ) {
      wss.handleUpgrade(req, socket, head, (clientWs) => {
        wss.emit('connection', clientWs, req)
      })
      return
    }

    // Everything else (e.g. Next.js HMR) goes to Next.js
    if (nextUpgradeHandler) {
      nextUpgradeHandler(req, socket, head)
    } else {
      socket.destroy()
    }
  })

  // Start listening
  server.listen(PORT, hostname, () => {
    printBanner()
  })

  // Graceful shutdown
  const shutdown = (signal) => {
    console.log(`\n[start] ${signal} received, shutting down...`)
    server.close(() => {
      console.log('[start] Server closed')
      process.exit(0)
    })
    // Force exit after 10s
    setTimeout(() => process.exit(1), 10000).unref()
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

function printBanner() {
  let appVersion = 'latest'
  try { appVersion = require('./package.json').version } catch {}

  const gitSha = process.env.GIT_SHA
  if (gitSha) appVersion += `-${gitSha.substring(0, 7)}`

  const edition = process.env.ORCHESTRATOR_URL ? 'Enterprise' : 'Community'

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

 ${c.dim}Unified server on port ${PORT}${c.reset}
 ${c.dim}├─${c.reset} HTTP + WebSocket  ${c.white}http://${hostname}:${PORT}${c.reset}  ${c.green}✓${c.reset}
 ${c.dim}└─${c.reset} Database          ${c.white}SQLite${c.reset}             ${c.green}✓${c.reset}

 ${c.dim}WebSocket routes${c.reset}
 ${c.dim}├─${c.reset} /api/internal/ws/shell           ${c.dim}Node/VM/CT shell${c.reset}
 ${c.dim}├─${c.reset} /api/internal/ws/console/{id}    ${c.dim}VM/CT console${c.reset}
 ${c.dim}├─${c.reset} /ws/shell                        ${c.dim}(alias)${c.reset}
 ${c.dim}└─${c.reset} /ws/console/{id}                 ${c.dim}(alias)${c.reset}
`)
}

main().catch((err) => {
  console.error('[start] Fatal error:', err)
  process.exit(1)
})
