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
  return typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
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
    const res = await fetch(url, {
      method: 'POST',
      signal,
      headers: {
        'X-Upload-Id': uploadId,
        'X-Chunk-Index': String(i),
        'X-Total-Chunks': String(totalChunks),
        'X-Total-Size': String(file.size),
        'X-File-Name': file.name,
        'X-Content-Type': contentType,
        'X-Mime-Type': file.type || 'application/octet-stream',
      },
      body: file.slice(start, end),
    })
    if (!res.ok) throw await errorOf(res, `Chunk ${i} failed: HTTP ${res.status}`)
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
