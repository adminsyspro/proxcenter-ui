// src/lib/auth/oidcMetadata.ts
//
// IdP metadata and per-connection HTTP options (issue #1289).
//
// openid-client keeps ONE process-wide set of default HTTP options, and NextAuth
// overwrites it (custom.setHttpOptionsDefaults) with the options of whichever
// provider it builds last. With a single IdP that was harmless. With one IdP per
// tenant, two sign-ins in flight would race: a self-service tenant's token or
// keys request could go out without its strict agent (an internal address from
// its discovery document then reachable), and the provider's internal IdP could
// be refused by a tenant's strict agent. So:
//  - discovery is done here, through the connection's own route, and NextAuth
//    receives explicit endpoints (it then never discovers itself);
//  - a strict connection's discovered endpoints must be public HTTPS, checked
//    here as well, which also covers a connection reached through a proxy;
//  - every connection's options are set on its own openid-client instances
//    (see bindConnectionHttpOptions), which take precedence over the defaults.

import { custom } from "openid-client"

import type { OidcConfig } from "./oidc"
import { oidcFetchDispatcher, oidcOpenidAgent } from "./oidcProxy"
import { assertPublicHttpsUrl } from "./oidcUrlGuard"

export type OidcMetadata = {
  issuer: string
  authorization_endpoint: string
  token_endpoint?: string
  userinfo_endpoint?: string
  jwks_uri?: string
}

type MetadataConfig = Pick<
  OidcConfig,
  "id" | "issuerUrl" | "authorizationUrl" | "tokenUrl" | "userinfoUrl" | "proxyUrl" | "proxyUsername" | "proxyPassword" | "proxyBypass" | "strictUrls"
>

const TTL_MS = 5 * 60_000
const TIMEOUT_MS = 10_000
const cache = new Map<string, { at: number; value: OidcMetadata }>()

/** Exposed for tests. */
export function clearOidcMetadataCache(): void {
  cache.clear()
}

/** Discovery document URL of an issuer, trailing slashes trimmed. */
export function discoveryUrlOf(issuerUrl: string): string {
  let base = issuerUrl
  while (base.endsWith("/")) base = base.slice(0, -1)
  return `${base}/.well-known/openid-configuration`
}

const text = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined)

/**
 * Endpoints of a connection: the manual ones when set (the issuer then kept as
 * typed, it is what the id_token `iss` is compared with), else its discovery
 * document read through the connection's own route and cached for 5 minutes.
 */
export async function resolveOidcMetadata(
  config: MetadataConfig,
  deps: { fetchImpl?: typeof fetch; resolve?: (host: string) => Promise<string[]> } = {},
): Promise<OidcMetadata> {
  if (config.authorizationUrl) {
    return {
      issuer: config.issuerUrl,
      authorization_endpoint: config.authorizationUrl,
      token_endpoint: config.tokenUrl || undefined,
      userinfo_endpoint: config.userinfoUrl || undefined,
    }
  }

  const strict = config.strictUrls === true
  const url = discoveryUrlOf(config.issuerUrl)
  const key = `${config.id}|${url}|${strict}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value

  const fetchImpl = deps.fetchImpl ?? fetch
  const dispatcher = oidcFetchDispatcher(config, url, process.env, { strict })
  const res = await fetchImpl(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    ...(strict ? { redirect: "error" } : {}),
    ...(dispatcher ? { dispatcher } : {}),
  } as RequestInit)
  if (!res.ok) throw new Error(`OIDC discovery answered HTTP ${res.status}`)

  const doc = await res.json()
  const issuer = text(doc?.issuer)
  const authorization = text(doc?.authorization_endpoint)
  if (!issuer || !authorization) throw new Error("OIDC discovery document lacks issuer or authorization_endpoint")

  const value: OidcMetadata = {
    issuer,
    authorization_endpoint: authorization,
    token_endpoint: text(doc.token_endpoint),
    userinfo_endpoint: text(doc.userinfo_endpoint),
    jwks_uri: text(doc.jwks_uri),
  }
  if (strict) {
    // This server calls these three; the authorization endpoint is the browser's.
    const called = [value.token_endpoint, value.userinfo_endpoint, value.jwks_uri].filter((e): e is string => !!e)
    await Promise.all(called.map(endpoint => assertPublicHttpsUrl(endpoint, deps.resolve)))
  }

  cache.set(key, { at: Date.now(), value })
  return value
}

type HttpOptionsFn = (url: URL, options: Record<string, any>) => Record<string, any>

/** openid-client per-instance HTTP options of a connection: its own agent, always. */
export function connectionHttpOptions(config: MetadataConfig): HttpOptionsFn {
  return (url, options) => ({
    ...options,
    timeout: TIMEOUT_MS,
    agent: oidcOpenidAgent(config, url.toString(), process.env, { strict: config.strictUrls === true }),
  })
}

/** Set a connection's options on the openid-client instances of one sign-in. */
export function bindConnectionHttpOptions(client: any, options: HttpOptionsFn): void {
  client[custom.http_options] = options
  if (client.issuer) client.issuer[custom.http_options] = options
}
