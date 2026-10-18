// Browser-side chunked upload to a PVE storage through ProxCenter's
// streaming route. Shared by the storage content browser and the CD/DVD
// dialogs so both speak the exact same two-leg protocol.

export const UPLOAD_CHUNK_SIZE = 5 * 1024 * 1024

export type UploadPhase = 'uploading' | 'transferring'

export interface UploadFileArgs {
  connId: string
  node: string
  storage: string
  file: File
  /** PVE content type of the file (`iso`, `vztmpl`, `import`, …). Default `iso`. */
  contentType?: string
  /** Percentage of chunks accepted by the server, 0-100. */
  onProgress?: (pct: number) => void
  /** `transferring` fires once every chunk is in and the server hands the file to PVE. */
  onPhase?: (phase: UploadPhase) => void
  /** Reuse an id you already registered elsewhere (task bar, progress polling). */
  uploadId?: string
  signal?: AbortSignal
}

export interface UploadFileResult {
  uploadId: string
  /** Name the file was stored under. On a tenant ISO library the server namespaces it. */
  filename: string
}

function newUploadId(): string {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID()
  // Insecure context without randomUUID: still a CSPRNG, never Math.random.
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return `${Date.now()}-${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`
}

// What a reverse proxy answers when it gives up waiting on the route, not a
// verdict of the route: the chunk is sent again. The route acknowledges a
// chunk it already has instead of writing it twice.
const RETRYABLE_STATUSES = new Set([502, 503, 504])
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000]

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const onAbort = () => { clearTimeout(timer); reject(signal?.reason) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function sendChunk(url: string, headers: Record<string, string>, body: Blob, index: number, signal?: AbortSignal): Promise<void> {
  // After a 202 the route holds the chunk and is still writing it to PVE:
  // ask again without the body until it is through.
  let held = false
  let retries = 0
  for (;;) {
    let res: Response
    try {
      res = await fetch(url, { method: 'POST', signal, headers, body: held ? undefined : body })
    } catch (e) {
      if (signal?.aborted || retries >= RETRY_DELAYS_MS.length) throw e
      await pause(RETRY_DELAYS_MS[retries++], signal)
      continue
    }
    if (res.status === 202) {
      held = true
      continue
    }
    if (res.ok) return
    if (RETRYABLE_STATUSES.has(res.status) && retries < RETRY_DELAYS_MS.length) {
      await pause(RETRY_DELAYS_MS[retries++], signal)
      continue
    }
    throw await errorOf(res, `Chunk ${index} failed: HTTP ${res.status}`)
  }
}

async function errorOf(res: Response, fallback: string): Promise<Error> {
  const json = await res.json().catch(() => ({} as any))
  return new Error(json?.error || fallback)
}

export async function uploadFileToStorage(args: UploadFileArgs): Promise<UploadFileResult> {
  const { connId, node, storage, file, onProgress, onPhase, signal } = args
  const contentType = args.contentType || 'iso'
  const uploadId = args.uploadId || newUploadId()
  const url = `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/upload`
  const totalChunks = Math.max(1, Math.ceil(file.size / UPLOAD_CHUNK_SIZE))

  onPhase?.('uploading')
  for (let i = 0; i < totalChunks; i++) {
    const start = i * UPLOAD_CHUNK_SIZE
    const end = Math.min(start + UPLOAD_CHUNK_SIZE, file.size)
    await sendChunk(url, {
      'X-Upload-Id': uploadId,
      'X-Chunk-Index': String(i),
      'X-Total-Chunks': String(totalChunks),
      'X-Total-Size': String(file.size),
      'X-File-Name': file.name,
      'X-Content-Type': contentType,
      'X-Mime-Type': file.type || 'application/octet-stream',
    }, file.slice(start, end), i, signal)
    onProgress?.(Math.round(((i + 1) / totalChunks) * 100))
  }

  onPhase?.('transferring')
  const finalRes = await fetch(url, {
    method: 'POST',
    signal,
    headers: { 'X-Upload-Id': uploadId, 'X-Finalize': '1' },
  })
  if (!finalRes.ok) throw await errorOf(finalRes, `Finalize failed: HTTP ${finalRes.status}`)
  const json = await finalRes.json().catch(() => ({} as any))
  return { uploadId, filename: typeof json?.filename === 'string' && json.filename ? json.filename : file.name }
}
