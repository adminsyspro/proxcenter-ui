/**
 * XCP-ng source abstraction.
 *
 * An XCP-ng connection reaches the pool either through Xen Orchestra's REST API
 * (`subType = "xo"`, the only mode until now) or directly through XAPI on the pool
 * master (`subType = "xapi"`, required for warm migration). Both expose the same
 * `XcpngSource` surface so the inventory routes and the offline pipeline do not
 * care which one they talk to.
 */
import { getSessionPrisma } from "@/lib/tenant"
import { decryptSecret } from "@/lib/crypto/secret"
import type { XoVmConfig, XoDiskInfo } from "./client"
import type { XcpngVmListItem } from "./xapi-client"
import { XoSource } from "./xo-source"
import { XapiSource } from "./xapi-source"

export type XcpngSubType = "xo" | "xapi"

export interface XcpngHostInfo { name_label: string; address: string; version: string }

/** What the offline pipeline needs to run curl on the PVE node: the URL and its auth/TLS flags. */
export interface XcpngDiskDownload { url: string; curlArgs: string }

export interface XcpngSource {
  readonly kind: XcpngSubType
  /** Base URL shown in logs and status payloads (no trailing slash). */
  readonly displayUrl: string
  listHosts(): Promise<XcpngHostInfo[]>
  listVms(): Promise<XcpngVmListItem[]>
  /** Raw VM record of the backend (XO REST object or XAPI record), for the VM detail route. */
  getVm(uuid: string): Promise<any>
  getVmConfig(uuid: string): Promise<XoVmConfig>
  diskDownload(disk: XoDiskInfo, format: "vhd" | "raw"): Promise<XcpngDiskDownload>
  keepAlive(): Promise<void>
  close(): Promise<void>
}

export interface XcpngCredentials {
  subType: XcpngSubType
  baseUrl: string
  user: string
  password: string
  insecureTLS: boolean
}

/** Default login per mode: XO accounts are e-mail addresses, XAPI pools authenticate the local root. */
export function xcpngDefaultUser(subType: XcpngSubType): string {
  return subType === "xapi" ? "root" : "admin@admin.net"
}

/** An XCP-ng connection is either a direct pool ("xapi") or goes through Xen Orchestra ("xo", the legacy default). */
export function xcpngSubTypeOf(conn: { subType?: string | null }): XcpngSubType {
  return conn.subType === "xapi" ? "xapi" : "xo"
}

/** Split "user:password" on the first colon; a bare secret is the password of `defaultUser`. */
export function splitCreds(creds: string, defaultUser: string): { user: string; password: string } {
  const i = creds.indexOf(":")
  return i > 0 ? { user: creds.substring(0, i), password: creds.substring(i + 1) } : { user: defaultUser, password: creds }
}

export async function openXcpngSourceWith(c: XcpngCredentials): Promise<XcpngSource> {
  return c.subType === "xapi" ? XapiSource.open(c) : new XoSource(c)
}

/**
 * Open the source behind a stored connection. `db` lets a detached job (migration
 * pipeline) pass its tenant-scoped client; routes rely on the session client.
 */
export async function openXcpngSource(
  connectionId: string,
  db?: { connection: { findUnique: (args: any) => Promise<any> } },
): Promise<XcpngSource> {
  const prisma = db ?? await getSessionPrisma()
  const conn = await prisma.connection.findUnique({
    where: { id: connectionId },
    select: { type: true, subType: true, baseUrl: true, apiTokenEnc: true, insecureTLS: true },
  })
  if (!conn || conn.type !== "xcpng") throw new Error("XCP-ng connection not found")
  const subType = xcpngSubTypeOf(conn)
  const { user, password } = splitCreds(decryptSecret(conn.apiTokenEnc), xcpngDefaultUser(subType))
  return openXcpngSourceWith({ subType, baseUrl: conn.baseUrl, user, password, insecureTLS: conn.insecureTLS })
}

export function isXcpngAuthError(message: string): boolean {
  return /SESSION_AUTHENTICATION_FAILED|XO API error: 401\b|XAPI HTTP 401\b/.test(message)
}

export async function testXcpngConnection(c: XcpngCredentials): Promise<{ ok: true; hosts: number } | { ok: false; error: string }> {
  let src: XcpngSource | null = null
  try {
    src = await openXcpngSourceWith(c)
    const hosts = await src.listHosts()
    return { ok: true, hosts: hosts.length }
  } catch (e: any) {
    const m = String(e?.message || e)
    if (isXcpngAuthError(m)) return { ok: false, error: "Invalid credentials" }
    return { ok: false, error: m }
  } finally {
    await src?.close().catch(() => {})
  }
}
