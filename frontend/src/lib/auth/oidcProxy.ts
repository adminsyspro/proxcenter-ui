// src/lib/auth/oidcProxy.ts
//
// Outbound HTTP proxy for the server-side calls to the OIDC identity provider
// (roadmap#78).
//
// The sign-in redirect runs in the browser, which already uses the workstation
// proxy. Discovery, the code-for-token exchange, the signing keys, userinfo and
// the end-session discovery are made by this server, and on a site that only
// reaches the Internet through a web proxy they used to go out directly and
// fail with ENOTFOUND.
//
// The proxy applies to these calls only. The process-wide dispatcher set in
// instrumentation-node.ts stays a direct Agent, so Proxmox, PBS, the
// orchestrator and every other internal call never go through it.
//
// Precedence: the proxy saved in the SSO settings, then HTTPS_PROXY /
// HTTP_PROXY from the environment (the installer writes them to .env), then a
// direct connection. The bypass list is the union of the saved one and
// NO_PROXY.

import http from "node:http"
import https from "node:https"

import { ProxyAgent, type Dispatcher } from "undici"

export interface OidcProxySettings {
  proxyUrl?: string | null
  proxyUsername?: string | null
  proxyPassword?: string | null
  proxyBypass?: string | null
}

export type OidcProxySource = "settings" | "environment"

export interface OidcProxyRoute {
  /** Proxy URL with its credentials: hand it to an agent, never log it. */
  url: string
  /** scheme://host:port, safe to show and to log. */
  display: string
  /** Lower-cased host patterns reached directly. */
  bypass: string[]
  source: OidcProxySource
}

type Env = Record<string, string | undefined>

function envValue(env: Env, name: string): string | undefined {
  const value = env[name] ?? env[name.toLowerCase()]
  const trimmed = value?.trim()
  return trimmed || undefined
}

/** Split a NO_PROXY style list: commas or whitespace, lower-cased. */
export function parseBypassList(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw
    .split(/[\s,]+/)
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean)
}

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host
}

function defaultPort(protocol: string): string {
  return protocol === "https:" ? "443" : "80"
}

/**
 * NO_PROXY matching, curl semantics: `*` matches every host, `example.com`
 * matches the domain and its subdomains, `.example.com` and `*.example.com`
 * the same, and `host:port` only that port.
 */
export function bypassesProxy(target: URL, bypass: readonly string[]): boolean {
  const host = stripBrackets(target.hostname.toLowerCase())
  const port = target.port || defaultPort(target.protocol)

  return bypass.some(entry => {
    if (entry === "*") return true

    let pattern = entry
    let entryPort: string | null = null
    const portMatch = /^(.*):(\d+)$/.exec(pattern)
    if (portMatch && !pattern.endsWith("]") && (pattern.match(/:/g) || []).length === 1) {
      pattern = portMatch[1]
      entryPort = portMatch[2]
    }
    pattern = stripBrackets(pattern.replace(/^\*?\./, ""))
    if (!pattern) return false
    if (entryPort && entryPort !== port) return false

    return host === pattern || host.endsWith(`.${pattern}`)
  })
}

/** scheme://host:port of a proxy URL, without credentials or path. */
export function proxyDisplay(raw: string): string {
  const url = new URL(raw)
  return `${url.protocol}//${url.host}`
}

export type ProxyUrlCheck = { url: string; error?: undefined } | { url?: undefined; error: string }

/**
 * Validate the proxy URL typed in the settings. Only http(s) proxies are
 * accepted, and credentials go in their own fields so the password can be
 * stored encrypted. Returns the normalised scheme://host:port.
 */
export function checkProxyUrl(raw: string): ProxyUrlCheck {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return { error: "Invalid proxy URL: expected http://host:port" }
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { error: "Invalid proxy URL: only http:// and https:// proxies are supported" }
  }
  if (!url.hostname) return { error: "Invalid proxy URL: expected http://host:port" }
  if (url.username || url.password) {
    return { error: "Put the proxy credentials in the username and password fields, not in the URL" }
  }
  return { url: `${url.protocol}//${url.host}` }
}

function withCredentials(proxyUrl: string, username?: string | null, password?: string | null): string {
  if (!username) return proxyUrl
  const url = new URL(proxyUrl)
  // Encoded by hand: the URL setters leave `%` alone, and both undici and
  // Node run decodeURIComponent on the userinfo before building the
  // Proxy-Authorization header, so "p%rd" would throw URI malformed.
  url.username = encodeURIComponent(username)
  if (password) url.password = encodeURIComponent(password)
  return url.toString()
}

/** The proxy from HTTPS_PROXY / HTTP_PROXY, without credentials, for display. */
export function environmentProxyDisplay(env: Env = process.env): string | null {
  const raw = envValue(env, "HTTPS_PROXY") ?? envValue(env, "HTTP_PROXY")
  if (!raw) return null
  try {
    return proxyDisplay(raw)
  } catch {
    return null
  }
}

/**
 * The proxy the calls to the identity provider go through, or null for a
 * direct connection. Bypass entries are not applied here: see proxyFor.
 */
export function resolveOidcProxy(
  settings: OidcProxySettings | null | undefined,
  protocol: string = "https:",
  env: Env = process.env,
): OidcProxyRoute | null {
  const bypass = [...new Set([...parseBypassList(settings?.proxyBypass), ...parseBypassList(envValue(env, "NO_PROXY"))])]

  const saved = settings?.proxyUrl?.trim()
  if (saved) {
    const checked = checkProxyUrl(saved)
    if (checked.url) {
      return {
        url: withCredentials(checked.url, settings?.proxyUsername, settings?.proxyPassword),
        display: checked.url,
        bypass,
        source: "settings",
      }
    }
    // A row edited by hand with a broken URL: say so rather than silently
    // going direct, which would only resurface as ENOTFOUND.
    console.warn("[oidcProxy] ignoring the saved SSO proxy URL, it is not a valid http(s) URL")
  }

  const fromEnv =
    protocol === "https:"
      ? envValue(env, "HTTPS_PROXY") ?? envValue(env, "HTTP_PROXY")
      : envValue(env, "HTTP_PROXY")
  if (!fromEnv) return null
  try {
    const url = new URL(fromEnv)
    if (url.protocol === "http:" || url.protocol === "https:") {
      return { url: url.toString(), display: proxyDisplay(fromEnv), bypass, source: "environment" }
    }
  } catch {
    // reported below
  }
  console.warn("[oidcProxy] ignoring HTTPS_PROXY / HTTP_PROXY, not a valid http(s) URL")
  return null
}

/** The proxy route for one target URL, or null when it is reached directly. */
export function proxyFor(settings: OidcProxySettings | null | undefined, target: string | URL, env: Env = process.env): OidcProxyRoute | null {
  const url = typeof target === "string" ? new URL(target) : target
  const route = resolveOidcProxy(settings, url.protocol, env)
  if (!route || bypassesProxy(url, route.bypass)) return null
  return route
}

// One agent per proxy configuration. The settings rarely change, and a fresh
// agent per sign-in would open a new tunnel every time.
const dispatchers = new Map<string, Dispatcher>()
const nodeAgents = new Map<string, http.Agent>()

/** Exposed for tests. */
export function clearOidcProxyAgents(): void {
  dispatchers.clear()
  nodeAgents.clear()
}

/**
 * undici dispatcher for a `fetch` to the identity provider, or undefined to
 * keep the process-wide direct dispatcher.
 */
export function oidcFetchDispatcher(
  settings: OidcProxySettings | null | undefined,
  target: string | URL,
  env: Env = process.env,
): Dispatcher | undefined {
  const route = proxyFor(settings, target, env)
  if (!route) return undefined
  let dispatcher = dispatchers.get(route.url)
  if (!dispatcher) {
    dispatcher = new ProxyAgent({ uri: route.url, allowH2: false })
    dispatchers.set(route.url, dispatcher)
  }
  return dispatcher
}

/**
 * `agent` for openid-client (used by NextAuth for discovery, token, JWKS and
 * userinfo). Node 26 agents take the proxy through `proxyEnv` and apply the
 * bypass list per request, so a userinfo endpoint on another host is routed
 * on its own merits.
 *
 * `false` when there is no proxy: openid-client keeps its options in a module
 * global that NextAuth only ever merges into, so an agent set by a previous
 * configuration would otherwise outlive it. `false` gives each request a
 * one-off direct agent of the right protocol.
 */
export function oidcOpenidAgent(
  settings: OidcProxySettings | null | undefined,
  issuerUrl: string,
  env: Env = process.env,
): http.Agent | false {
  let protocol: string
  try {
    protocol = new URL(issuerUrl).protocol
  } catch {
    return false
  }
  const route = resolveOidcProxy(settings, protocol, env)
  if (!route) return false

  const key = `${protocol}|${route.url}|${route.bypass.join(",")}`
  let agent = nodeAgents.get(key)
  if (!agent) {
    // ProxyEnv extends ProcessEnv, which the project augments with a required
    // NODE_ENV: irrelevant to an agent, hence the cast.
    const proxyEnv = {
      HTTP_PROXY: route.url,
      HTTPS_PROXY: route.url,
      NO_PROXY: route.bypass.join(","),
    } as NonNullable<http.AgentOptions["proxyEnv"]>
    // openid-client picks https.request or http.request from the URL, and the
    // agent must match that protocol: issuer, token and keys share it.
    agent = protocol === "https:" ? new https.Agent({ keepAlive: true, proxyEnv }) : new http.Agent({ keepAlive: true, proxyEnv })
    nodeAgents.set(key, agent)
  }
  return agent
}

export type OidcFetchErrorCode = "dns" | "timeout" | "unreachable" | "proxy_auth" | "proxy_refused" | "tls" | "other"

export interface OidcFetchError {
  code: OidcFetchErrorCode
  /** Host the failure is about (the proxy when the proxy refused). */
  host: string | null
  /** Proxy status code for proxy_refused. */
  status?: number
  message: string
}

const TLS_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "ERR_TLS_CERT_ALTNAME_INVALID",
])

const UNREACHABLE_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT", "EPIPE", "UND_ERR_SOCKET"])

function causeChain(err: unknown): any[] {
  const chain: any[] = []
  let node: any = err
  while (node && chain.length < 6) {
    chain.push(node)
    node = node.cause
  }
  return chain
}

function redact(message: string): string {
  return message.replace(/\/\/[^/@\s]+@/g, "//***@")
}

/**
 * Turn a failed call to the identity provider into something an admin can act
 * on. undici only says "fetch failed"; the reason is in the cause chain.
 */
export function describeOidcFetchError(err: unknown, target: string | URL, route: OidcProxyRoute | null): OidcFetchError {
  let targetHost: string | null = null
  try {
    targetHost = (typeof target === "string" ? new URL(target) : target).host
  } catch {
    // keep null
  }
  const proxyHost = route ? new URL(route.display).host : null
  const chain = causeChain(err)

  // Before the timeout check: undici reports a refused tunnel as an
  // AbortError ("Proxy response (407) !== 200"), Node as ERR_PROXY_TUNNEL.
  for (const e of chain) {
    const message = typeof e?.message === "string" ? e.message : ""
    const statusMatch = /Proxy response \((\d{3})\)/.exec(message) ?? (e?.code === "ERR_PROXY_TUNNEL" ? /HTTP\/1\.[01] (\d{3})/.exec(message) : null)
    if (statusMatch) {
      const status = Number(statusMatch[1])
      if (status === 407) {
        return { code: "proxy_auth", host: proxyHost, status, message: `The proxy ${route?.display ?? ""} asks for authentication (HTTP 407): check the proxy username and password` }
      }
      return { code: "proxy_refused", host: proxyHost, status, message: `The proxy ${route?.display ?? ""} refused the connection to ${targetHost} (HTTP ${status})` }
    }
  }

  for (const e of chain) {
    if (e?.name === "TimeoutError" || (e?.name === "AbortError" && e?.code !== "UND_ERR_ABORTED")) {
      return {
        code: "timeout",
        host: targetHost,
        message: `No answer from ${targetHost}${route ? ` through the proxy ${route.display}` : ""} in time`,
      }
    }
  }

  for (const e of chain) {
    const code = typeof e?.code === "string" ? e.code : ""
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
      const host = typeof e.hostname === "string" ? e.hostname : targetHost
      return {
        code: "dns",
        host,
        message: route
          ? `Cannot resolve ${host} from the ProxCenter server`
          : `Cannot resolve ${host} from the ProxCenter server. If this server reaches the Internet through an HTTP proxy, set it under Outbound proxy`,
      }
    }
    if (TLS_CODES.has(code)) {
      return { code: "tls", host: targetHost, message: `The TLS certificate of ${targetHost} is not trusted by the ProxCenter server (${code})` }
    }
    if (UNREACHABLE_CODES.has(code)) {
      const host = route ? proxyHost : targetHost
      return { code: "unreachable", host, message: `Cannot connect to ${host} (${code})` }
    }
  }

  const last = chain[chain.length - 1]
  const raw = typeof last?.message === "string" && last.message ? last.message : String(err)
  return { code: "other", host: targetHost, message: redact(raw) }
}
