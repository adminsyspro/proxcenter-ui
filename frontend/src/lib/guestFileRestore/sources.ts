// src/lib/guestFileRestore/sources.ts
//
// Where restored bytes come from. `resolveGuestRestoreSource` runs in the
// request (session, RBAC, tenant scope) and hands the runner everything it
// needs to stream later without a request context: the connection record
// (token in memory only), the node and the qualified volume.
//
// Verified on the lab (PVE 9.2.11 / PBS 4.2.0):
//  - PVE: GET /nodes/{node}/storage/{storage}/file-restore/download
//         ?volume=&filepath=<base64>&tar=1 : a directory AND a single file
//         come back as tar.zst (the file keeps its mode, owner and mtime in
//         the tar header); without tar a file is raw.
//  - PBS: GET /admin/datastore/{store}/pxar-file-download
//         ?backup-type=&backup-id=&backup-time=&ns=&filepath=<base64>&tar=1
//         where filepath is `<archive>/<path>` (the first component names the
//         archive, `archive-name` is the optional alternative). A directory is
//         tar.zst, a file is always raw.
//  - A download asked from a node other than the one serving the storage is
//    proxied by pveproxy, which buffers the WHOLE body in memory on that
//    node before answering and fails at 2 GiB (SSL "bad length"). Reading
//    straight from the storage node streams (118 MB/s in the lab LAN). The
//    runner therefore prefers the storage node's own address and falls
//    back to the connection's URL when it cannot be reached.

import type { Readable } from 'node:stream'

import { NextResponse } from 'next/server'
import { request } from 'undici'
import type { Dispatcher } from 'undici'

import { getPbsConnectionById, getPbsConnectionByIdUnscoped } from '@/lib/connections/getConnection'
import type { PbsConn, PveConn } from '@/lib/connections/getConnection'
import { prisma } from '@/lib/db/prisma'
import { getInsecureAgent } from '@/lib/proxmox/client'
import { resolveFileRestoreTarget } from '@/lib/proxmox/fileRestoreTarget'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { assertVdcPbsAccess } from '@/lib/vdc/scope'

import { stallWatchdog } from './stream'
import type { GuestRestoreItem, GuestRestoreSource } from './types'

export type ResolvedSource =
  | {
      kind: 'pve'
      conn: PveConn
      dispatcher: Dispatcher | undefined
      nodeName: string
      storage: string
      volumeId: string
      /** API URL of the storage node itself when it is not the connection's node. */
      nodeBaseUrl?: string
    }
  | {
      kind: 'pbs'
      conn: PbsConn
      datastore: string
      namespace: string
      backupType: 'vm' | 'ct' | 'host'
      backupId: string
      backupTime: number
      archive: string
    }

/** Human label of a source for the job log and the audit row (no secret). */
export function sourceLabel(source: GuestRestoreSource): string {
  if (source.kind === 'pve') return `${source.storage}:${source.volume}`
  const ns = source.namespace ? `${source.namespace}/` : ''
  return `${source.datastore}:${ns}${source.backupType}/${source.backupId}/${source.backupTime} (${source.archive})`
}

/**
 * Authorise the caller on the source and resolve what the runner needs.
 * Returns the response to send when the request cannot go on.
 */
export async function resolveGuestRestoreSource(source: GuestRestoreSource): Promise<ResolvedSource | Response> {
  if (source.kind === 'pve') {
    const denied = await checkPermission(PERMISSIONS.BACKUP_VIEW, 'connection', source.connId)
    if (denied) return denied
    const target = await resolveFileRestoreTarget(source.connId, source.storage, source.volume)
    if (target instanceof Response) return target
    return {
      kind: 'pve',
      conn: target.conn,
      dispatcher: target.dispatcher,
      nodeName: target.nodeName,
      storage: source.storage,
      volumeId: target.volumeId,
      nodeBaseUrl: await storageNodeBaseUrl(source.connId, target.nodeName, target.conn.baseUrl),
    }
  }

  const denied = await checkPermission(PERMISSIONS.BACKUP_VIEW, 'pbs', source.pbsId)
  if (denied) return denied
  const access = await assertVdcPbsAccess(source.pbsId)
  if (access instanceof Response) return access
  const namespace = source.namespace ?? ''
  if (access.kind === 'tenant' && !access.allowed.some(a => a.datastore === source.datastore && a.namespace === namespace)) {
    return NextResponse.json({ error: 'Backup not accessible for this tenant' }, { status: 403 })
  }
  const conn = access.kind === 'admin'
    ? await getPbsConnectionById(source.pbsId)
    : await getPbsConnectionByIdUnscoped(source.pbsId)
  return {
    kind: 'pbs',
    conn,
    datastore: source.datastore,
    namespace,
    backupType: source.backupType,
    backupId: source.backupId,
    backupTime: source.backupTime,
    archive: source.archive,
  }
}

function base64(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64')
}

/** Indirection so tests can fake the node lookup and the HTTP client. */
export const _impl = {
  findNodeIp: async (connId: string, node: string): Promise<string | null> => {
    const host = await prisma.managedHost.findFirst({
      where: { connectionId: connId, node, enabled: true, ip: { not: null } },
      select: { ip: true },
    })
    return host?.ip ?? null
  },
  request,
}

/**
 * `https://<ip of node>:<port of the connection>` when the storage node is
 * known by another address than the connection, else undefined.
 */
export async function storageNodeBaseUrl(connId: string, node: string, baseUrl: string): Promise<string | undefined> {
  let ip: string | null
  try {
    ip = await _impl.findNodeIp(connId, node)
  } catch {
    return undefined
  }
  if (!ip) return undefined
  try {
    const url = new URL(baseUrl)
    const hostname = ip.includes(':') ? `[${ip}]` : ip
    if (url.hostname === ip || url.hostname === hostname || url.hostname.toLowerCase() === node.toLowerCase()) return undefined
    url.hostname = hostname
    url.pathname = '/'
    url.search = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return undefined
  }
}

export interface SourceRequestOptions {
  /** Read from the connection's node even when the storage node has its own address. */
  viaConnection?: boolean
}

export interface SourceRequest {
  url: string
  headers: Record<string, string>
  dispatcher: Dispatcher | undefined
  /** Whether the body is tar.zst (else a raw file). */
  tar: boolean
  /** True when the download goes through the connection's node instead of the storage node. */
  proxied: boolean
}

/** Download URL + auth header of an item, without opening anything. */
export function sourceRequest(src: ResolvedSource, item: Pick<GuestRestoreItem, 'path' | 'directory'>, opts: SourceRequestOptions = {}): SourceRequest {
  if (src.kind === 'pve') {
    const direct = !opts.viaConnection && src.nodeBaseUrl
    const base = (direct ? src.nodeBaseUrl! : src.conn.baseUrl).replace(/\/$/, '')
    // tar for files too: the header carries mode, owner, mtime and size.
    const params = new URLSearchParams({ volume: src.volumeId, filepath: base64(item.path), tar: '1' })
    return {
      url: `${base}/api2/json/nodes/${encodeURIComponent(src.nodeName)}/storage/${encodeURIComponent(src.storage)}/file-restore/download?${params}`,
      headers: { Authorization: `PVEAPIToken=${src.conn.apiToken}` },
      dispatcher: src.dispatcher,
      tar: true,
      proxied: !direct && src.nodeBaseUrl !== undefined,
    }
  }
  const base = src.conn.baseUrl.replace(/\/$/, '')
  const inner = '/' + item.path.split('/').filter(Boolean).join('/')
  const params = new URLSearchParams({
    'backup-type': src.backupType,
    'backup-id': src.backupId,
    'backup-time': String(src.backupTime),
    filepath: base64(`${src.archive}${inner}`),
  })
  if (src.namespace) params.set('ns', src.namespace)
  if (item.directory) params.set('tar', '1')
  return {
    url: `${base}/api2/json/admin/datastore/${encodeURIComponent(src.datastore)}/pxar-file-download?${params}`,
    headers: { Authorization: `PBSAPIToken=${src.conn.apiToken}` },
    dispatcher: src.conn.insecureDev ? getInsecureAgent() : undefined,
    tar: item.directory,
    proxied: false,
  }
}

export interface OpenSourceOptions {
  /** Fail the stream when nothing arrives for this long while the consumer waits. */
  stallTimeoutMs: number
  /** Called with every chunk received from the backup. */
  onBytes?: (n: number) => void
  log?: (level: 'info' | 'warn', msg: string) => void
}

export interface SourceStream {
  body: Readable
  /** Whether `body` is tar.zst (else a raw file). */
  tar: boolean
}

/** Sources whose storage node could not be reached directly: stay on the connection for the rest of the job. */
const directUnreachable = new WeakSet<object>()

/**
 * Open the download of one item. Nothing is buffered here: the body streams
 * from Proxmox through the stall watchdog to the caller, who decides whether
 * to write it straight into the guest (SSH) or to stage it (agent).
 */
export async function openSourceStream(src: ResolvedSource, item: Pick<GuestRestoreItem, 'path' | 'directory'>, signal: AbortSignal, opts: OpenSourceOptions): Promise<SourceStream> {
  let req = sourceRequest(src, item, { viaConnection: directUnreachable.has(src) })
  let res
  try {
    res = await _impl.request(req.url, { method: 'GET', headers: req.headers, dispatcher: req.dispatcher, signal, bodyTimeout: 0, headersTimeout: 0 })
  } catch (err) {
    if (signal.aborted || req.proxied || src.kind !== 'pve' || !src.nodeBaseUrl || directUnreachable.has(src)) throw err
    // The storage node is not reachable from here (address, firewall, TLS):
    // go through the connection's node, which buffers each download in memory.
    directUnreachable.add(src)
    opts.log?.('warn', `Storage node ${src.nodeName} not reachable at ${src.nodeBaseUrl} (${err instanceof Error ? err.message : String(err)}): downloading through the connection's node, which buffers each download in memory and cannot serve 2 GiB or more`)
    req = sourceRequest(src, item, { viaConnection: true })
    res = await _impl.request(req.url, { method: 'GET', headers: req.headers, dispatcher: req.dispatcher, signal, bodyTimeout: 0, headersTimeout: 0 })
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    const text = await res.body.text().catch(() => '')
    let message = `HTTP ${res.statusCode}`
    try {
      const json = JSON.parse(text)
      message = json?.message || json?.errors?.volume || json?.errors?.filepath || (typeof json?.error === 'string' ? json.error : message)
    } catch {
      if (text.trim()) message = `${message}: ${text.trim().slice(0, 300)}`
    }
    throw new Error(`Download failed (${message})`)
  }
  const raw = res.body as unknown as Readable
  const body = stallWatchdog(opts.stallTimeoutMs, opts.onBytes)
  raw.on('error', err => body.destroy(err))
  raw.pipe(body)
  // Tearing the watchdog down must close the socket too.
  body.on('close', () => { if (!raw.readableEnded) raw.destroy() })
  return { body, tar: req.tar }
}
