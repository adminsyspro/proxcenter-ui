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
const https = require('https')
const { WebSocketServer } = require('ws')

const dir = path.join(__dirname)

process.env.NODE_ENV = 'production'
process.chdir(__dirname)

const PORT = Number.parseInt(process.env.PORT, 10) || 3000
const hostname = process.env.HOSTNAME || '0.0.0.0'

let keepAliveTimeout = Number.parseInt(process.env.KEEP_ALIVE_TIMEOUT, 10)
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

// Import ws-proxy handler and its frame size cap
const { handleWsConnection, WS_MAX_PAYLOAD_BYTES } = require('./ws-proxy')

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

  // ── TLS ────────────────────────────────────────────────────────────
  // Policy applied on every plain-HTTP request. Replaced at runtime by
  // instrumentation-node.ts once the settings are read from the database.
  let httpPolicy = { redirect: false, httpsPublicPort: 443, hstsHeader: null }
  let httpsServer = null
  let httpsPort = null
  let httpsMinVersion = null
  let loadedFingerprint = null
  let loadedServedFingerprint = null

  // The CA must reach this path in clear HTTP to validate an HTTP-01
  // challenge, so it is exempt from the redirect. The whole /api/health
  // subtree is exempt too: docker-compose.ha.yml health-checks
  // /api/health/live in plain HTTP against 127.0.0.1, and a 308 there with a
  // self-signed cert flaps the container.
  //
  // /api/internal is exempt for the same reason, one layer in: ws-proxy.js
  // builds INTERNAL_API_URL as http://localhost:${PORT} and POSTs to
  // /api/internal/shell/consume, /api/internal/console/consume and
  // /api/internal/spice/consume to set up every shell, VNC and SPICE session.
  // A 308 sends those to the PUBLIC HTTPS port, which inside the container is
  // generally not even listening — and where it is, the certificate does not
  // answer to "localhost". Redirecting them turns the consoles off the moment
  // an operator ticks "redirect HTTP to HTTPS".
  const ACME_PREFIX = '/.well-known/acme-challenge/'
  const HEALTH_PREFIX = '/api/health'
  const INTERNAL_PREFIX = '/api/internal'

  // Strips the port from a Host header while keeping IPv6 brackets, and
  // returns null instead of a broken host for anything it cannot parse.
  // Mirrors the tested `redirectHost` in src/lib/tls/policy.ts, which is the
  // source of truth for this rule; start.js is CommonJS outside the Next
  // bundle and cannot import that module directly, so keep the two in sync
  // by hand.
  function redirectHost(hostHeader) {
    const host = String(hostHeader || '').trim()

    if (!host) return null

    if (host.startsWith('[')) {
      const end = host.indexOf(']')

      return end === -1 ? null : host.slice(0, end + 1)
    }

    return host.split(':')[0] || null
  }

  // An open console (an upgraded WebSocket) or an SSE stream such as
  // /api/v1/inventory/stream never lets a server's close() callback fire on
  // its own, so close() alone can hang forever. Give idle connections a
  // moment to end cleanly, then force the rest shut so a TLS toggle, a port
  // change, or shutdown always completes. 3s is long enough for
  // closeIdleConnections() to take effect and short enough that toggling TLS
  // in the settings UI still feels responsive.
  const CLOSE_GRACE_MS = 3000

  function closeServerBounded(srv) {
    return new Promise((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        resolve()
      }

      srv.closeIdleConnections()
      srv.close(finish)

      setTimeout(() => {
        srv.closeAllConnections()
        finish()
      }, CLOSE_GRACE_MS).unref()
    })
  }

  const makeRequestListener = (secure) => async (req, res) => {
    try {
      const pathname = (req.url || '/').split('?')[0]

      const isExempt =
        pathname.startsWith(ACME_PREFIX) ||
        pathname === HEALTH_PREFIX ||
        pathname.startsWith(`${HEALTH_PREFIX}/`) ||
        pathname === INTERNAL_PREFIX ||
        pathname.startsWith(`${INTERNAL_PREFIX}/`)

      if (!secure && httpPolicy.redirect && !isExempt) {
        const host = redirectHost(req.headers.host)

        if (host) {
          const suffix = httpPolicy.httpsPublicPort === 443 ? '' : `:${httpPolicy.httpsPublicPort}`

          res.writeHead(308, { Location: `https://${host}${suffix}${req.url || '/'}` })
          res.end()

          return
        }
        // No usable Host header: fall through and serve the request over
        // plain HTTP rather than emit a broken redirect target.
      }

      if (secure && httpPolicy.hstsHeader) {
        res.setHeader('Strict-Transport-Security', httpPolicy.hstsHeader)
      }

      await nextRequestHandler(req, res)
    } catch (err) {
      console.error('[start] HTTP request error:', err)
      res.statusCode = 500
      res.end('Internal Server Error')
    }
  }

  // Create a single HTTP server
  const server = http.createServer(makeRequestListener(false))

  if (keepAliveTimeout) {
    server.keepAliveTimeout = keepAliveTimeout
  }

  // WebSocket server (noServer mode — we handle upgrade routing ourselves).
  // maxPayload bounds what a browser may send per frame; see ws-proxy.js.
  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD_BYTES })

  wss.on('connection', (clientWs, req) => {
    handleWsConnection(clientWs, req)
  })

  // Route upgrade requests
  const routeUpgrade = (req, socket, head) => {
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
  }

  server.on('upgrade', routeUpgrade)

  globalThis.__proxcenterTls = {
    async start({ port, certPem, chainPem, keyPem, minVersion, fingerprint, servedFingerprint }) {
      if (httpsServer) await globalThis.__proxcenterTls.stop()

      const nextServer = https.createServer(
        { cert: chainPem ? `${certPem}\n${chainPem}` : certPem, key: keyPem, minVersion },
        makeRequestListener(true),
      )
      nextServer.on('upgrade', routeUpgrade)

      if (keepAliveTimeout) {
        nextServer.keepAliveTimeout = keepAliveTimeout
      }

      try {
        // Settle exactly once from whichever of 'listening' or 'error' fires
        // first. Task 7 awaits start() from a settings-save request; an
        // unsettled promise there means that request hangs until nginx cuts
        // it at 60s, with the UI believing HTTPS came up.
        await new Promise((resolve, reject) => {
          nextServer.once('error', reject)
          nextServer.listen(port, hostname, () => {
            nextServer.removeListener('error', reject)
            resolve()
          })
        })
      } catch (err) {
        // A bound port or a bad certificate must never leave anything
        // thinking HTTPS is serving.
        nextServer.removeAllListeners('error')
        nextServer.on('error', () => {})
        try {
          nextServer.close()
        } catch {
          // Nothing to release if the handle never bound.
        }
        console.error('[start] HTTPS listener failed to start:', err)
        throw err
      }

      // Past this point the listener is up; an error here (e.g. a reset
      // connection) must not take the process down — the plain-HTTP
      // listener stays the operator's way back in to fix the setting.
      nextServer.on('error', (err) => console.error('[start] HTTPS listener error:', err))

      httpsServer = nextServer
      httpsMinVersion = minVersion
      httpsPort = port
      loadedFingerprint = fingerprint
      loadedServedFingerprint = servedFingerprint ?? null
      console.log(`[start] HTTPS listening on ${hostname}:${port} (${fingerprint.slice(0, 17)}…)`)
    },

    // setSecureContext swaps the certificate for NEW connections only, so a
    // renewal never drops an open console or an in-flight request. It
    // replaces the WHOLE secure context, so minVersion must be re-supplied
    // every time or a renewal silently drops the server back to the Node
    // default (TLSv1.2) even when it was created pinned to TLSv1.3.
    //
    // A CHANGE of minVersion does not come through here: the caller stops and
    // restarts the listener for that, so the protocol floor is set where it
    // is unambiguous, on a freshly created server.
    reload({ certPem, chainPem, keyPem, fingerprint, servedFingerprint }) {
      if (!httpsServer) return
      httpsServer.setSecureContext({
        cert: chainPem ? `${certPem}\n${chainPem}` : certPem,
        key: keyPem,
        minVersion: httpsMinVersion,
      })
      loadedFingerprint = fingerprint
      loadedServedFingerprint = servedFingerprint ?? null
      console.log(`[start] HTTPS certificate reloaded (${fingerprint.slice(0, 17)}…)`)
    },

    async stop() {
      if (!httpsServer) return

      const closing = httpsServer

      httpsServer = null
      httpsPort = null
      httpsMinVersion = null
      loadedFingerprint = null
      loadedServedFingerprint = null

      await closeServerBounded(closing)
    },

    setHttpPolicy(policy) {
      httpPolicy = policy
    },

    state() {
      return {
        listening: httpsServer?.listening === true,
        port: httpsPort,
        fingerprint: loadedFingerprint,
        servedFingerprint: loadedServedFingerprint,
        minVersion: httpsMinVersion,
      }
    },
  }

  // Start listening
  server.listen(PORT, hostname, () => {
    printBanner()
  })

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n[start] ${signal} received, shutting down...`)

    // Force exit after 10s, whatever happens below. Armed first so a throw in
    // the drain can never leave the process hanging on its signal.
    setTimeout(() => process.exit(1), 10000).unref()

    // BOTH listeners, and wait for both. Firing the HTTPS close and letting
    // the HTTP one decide when to exit cut live HTTPS requests short: on an
    // HTTPS deployment the plain-HTTP server is typically idle, so it closed
    // immediately and called process.exit(0) while uploads and mutations were
    // still running on the other socket. closeServerBounded caps each side at
    // CLOSE_GRACE_MS, so an open console still cannot hold the process.
    try {
      await Promise.all([closeServerBounded(server), ...(httpsServer ? [closeServerBounded(httpsServer)] : [])])
      console.log('[start] Server closed')
    } catch (err) {
      console.error('[start] error while draining listeners:', err)
    }

    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

function printBanner() {
  let appVersion = 'latest'
  try { appVersion = require('./package.json').version } catch {}

  const gitSha = process.env.GIT_SHA
  if (gitSha) appVersion += `-${gitSha.substring(0, 7)}`

  const edition = process.env.ORCHESTRATOR_URL ? 'Enterprise' : 'Community'

  // Derive a label from DATABASE_URL so the banner reflects what the app
  // actually talks to (postgres:// since the SQLite cutover, but the
  // helper degrades gracefully if someone overrides the connection
  // string).
  const dbUrl = process.env.DATABASE_URL || ''
  const dbLabel = /^postgres(ql)?:\/\//i.test(dbUrl) ? 'Postgres'
    : /^file:/i.test(dbUrl) ? 'SQLite'
    : dbUrl ? 'Custom'
    : 'Unset'

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
 ${c.dim}└─${c.reset} Database          ${c.white}${dbLabel.padEnd(11)}${c.reset}        ${c.green}✓${c.reset}

 ${c.dim}WebSocket routes${c.reset}
 ${c.dim}├─${c.reset} /api/internal/ws/shell           ${c.dim}Node/VM/CT shell${c.reset}
 ${c.dim}├─${c.reset} /api/internal/ws/console/{id}    ${c.dim}VM/CT console${c.reset}
 ${c.dim}├─${c.reset} /api/internal/ws/spice/{id}      ${c.dim}VM SPICE console${c.reset}
 ${c.dim}├─${c.reset} /ws/shell                        ${c.dim}(alias)${c.reset}
 ${c.dim}└─${c.reset} /ws/console/{id}                 ${c.dim}(alias)${c.reset}
`)
}

main().catch((err) => {
  console.error('[start] Fatal error:', err)
  process.exit(1)
})
