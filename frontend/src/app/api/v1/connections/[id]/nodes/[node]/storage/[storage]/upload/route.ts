import { NextResponse } from "next/server"
import https from "node:https"
import http from "node:http"
import { randomUUID } from "node:crypto"

import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { setProgress, clearProgress } from "@/lib/upload-progress"

export const runtime = "nodejs"
export const maxDuration = 600

// Active streaming sessions: uploadId -> open connection to Proxmox
const streamingSessions = new Map<string, {
  proxyReq: http.ClientRequest
  boundary: string
  bytesSent: number
  totalFormLength: number
  resolve: (value: { statusCode: number; body: string }) => void
  reject: (reason: any) => void
  resultPromise: Promise<{ statusCode: number; body: string }>
}>()

// Build multipart form parts (without file data)
function buildMultipartParts(boundary: string, contentType: string, fileName: string, mimeType: string) {
  const contentField =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="content"\r\n\r\n` +
    `${contentType}\r\n`

  const fileHeader =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="filename"; filename="${fileName}"\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`

  const closing = `\r\n--${boundary}--\r\n`

  return { contentField, fileHeader, closing }
}

// POST /api/v1/connections/{id}/nodes/{node}/storage/{storage}/upload
// Modes (via headers):
//   X-Chunk-Index: stream a chunk directly to Proxmox
//   X-Finalize: close the multipart form and get the Proxmox response
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; node: string; storage: string }> }
) {
  const uploadId = req.headers.get("x-upload-id") || randomUUID()
  const isChunk = req.headers.has("x-chunk-index")
  const isFinalize = req.headers.has("x-finalize")

  if (isChunk) return handleChunk(req, ctx, uploadId)
  if (isFinalize) return handleFinalize(req, ctx, uploadId)
  return NextResponse.json({ error: "Missing X-Chunk-Index or X-Finalize header" }, { status: 400 })
}

// ── Chunk handler: open connection on first chunk, stream data directly ──
async function handleChunk(
  req: Request,
  ctx: { params: Promise<{ id: string; node: string; storage: string }> },
  uploadId: string
) {
  try {
    const { id, node, storage } = await ctx.params

    const denied = await checkPermission(PERMISSIONS.STORAGE_UPLOAD, "connection", id)
    if (denied) return denied

    const chunkIndex = Number.parseInt(req.headers.get("x-chunk-index") || "0", 10)
    const totalSize = Number.parseInt(req.headers.get("x-total-size") || "0", 10)
    const fileName = req.headers.get("x-file-name") || "upload"
    const contentType = req.headers.get("x-content-type") || "iso"
    const mimeType = req.headers.get("x-mime-type") || "application/octet-stream"

    if (!req.body) {
      return NextResponse.json({ error: "Missing body" }, { status: 400 })
    }

    let session = streamingSessions.get(uploadId)

    // First chunk: open connection to Proxmox
    if (!session) {
      const conn = await getConnectionById(id)
      const baseUrl = conn.baseUrl.replace(/\/+$/, "")
      const targetUrl = new URL(
        `${baseUrl}/api2/json/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/upload`
      )

      const boundary = `----ProxCenterUpload${randomUUID().replace(/-/g, "")}`
      const parts = buildMultipartParts(boundary, contentType, fileName, mimeType)

      // Calculate total Content-Length: preamble + file data + closing
      const preambleLength = Buffer.byteLength(parts.contentField + parts.fileHeader, "utf-8")
      const closingLength = Buffer.byteLength(parts.closing, "utf-8")
      const totalFormLength = preambleLength + totalSize + closingLength

      const isHttps = targetUrl.protocol === "https:"
      const transport = isHttps ? https : http
      const agent = isHttps && conn.insecureDev
        ? new https.Agent({ rejectUnauthorized: false })
        : undefined

      setProgress(uploadId, { bytesSent: 0, totalBytes: totalSize, status: "transferring" })

      let resolveResult: any
      let rejectResult: any
      const resultPromise = new Promise<{ statusCode: number; body: string }>((res, rej) => {
        resolveResult = res
        rejectResult = rej
      })

      const proxyReq = transport.request(
        {
          hostname: targetUrl.hostname,
          port: targetUrl.port || (isHttps ? 443 : 80),
          path: targetUrl.pathname + targetUrl.search,
          method: "POST",
          agent,
          headers: {
            "Authorization": `PVEAPIToken=${conn.apiToken}`,
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "Content-Length": totalFormLength,
          },
          timeout: 600_000,
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on("data", (chunk) => chunks.push(chunk))
          res.on("end", () => {
            resolveResult({
              statusCode: res.statusCode || 500,
              body: Buffer.concat(chunks).toString("utf-8"),
            })
          })
          res.on("error", rejectResult)
        }
      )

      proxyReq.on("error", rejectResult)

      // Write the multipart preamble (content field + file headers)
      proxyReq.write(parts.contentField + parts.fileHeader)

      session = {
        proxyReq,
        boundary,
        bytesSent: 0,
        totalFormLength,
        resolve: resolveResult,
        reject: rejectResult,
        resultPromise,
      }
      streamingSessions.set(uploadId, session)

      console.log(`[upload] Streaming "${fileName.replace(/[\r\n]/g, '')}" (${totalSize} bytes) directly to Proxmox, uploadId=${uploadId}`)
    }

    // Stream chunk data directly to the open Proxmox connection
    const reader = req.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        await new Promise<void>((resolve, reject) => {
          session!.proxyReq.write(value, (err: any) => (err ? reject(err) : resolve()))
        })
        session.bytesSent += value.byteLength
        setProgress(uploadId, { bytesSent: session.bytesSent, totalBytes: totalSize || session.totalFormLength, status: "transferring" })
      }
    }

    return NextResponse.json({
      ok: true,
      chunkIndex,
      bytesSent: session.bytesSent,
    })
  } catch (e: any) {
    console.error("Error streaming chunk:", e)
    // Clean up on error
    const session = streamingSessions.get(uploadId)
    if (session) {
      session.proxyReq.destroy()
      streamingSessions.delete(uploadId)
    }
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// ── Finalize handler: close multipart boundary, wait for Proxmox response ──
async function handleFinalize(
  req: Request,
  ctx: { params: Promise<{ id: string; node: string; storage: string }> },
  uploadId: string
) {
  try {
    const { id, node, storage } = await ctx.params

    const denied = await checkPermission(PERMISSIONS.STORAGE_UPLOAD, "connection", id)
    if (denied) return denied

    const session = streamingSessions.get(uploadId)
    if (!session) {
      return NextResponse.json({ error: "No streaming session found. Send chunks first." }, { status: 400 })
    }

    // Write closing boundary
    const closing = `\r\n--${session.boundary}--\r\n`
    await new Promise<void>((resolve, reject) => {
      session.proxyReq.write(closing, (err: any) => (err ? reject(err) : resolve()))
    })
    session.proxyReq.end()

    // Wait for Proxmox response
    const result = await session.resultPromise

    console.log(`[upload] Proxmox responded ${result.statusCode}:`, result.body.substring(0, 500))

    if (result.statusCode < 200 || result.statusCode >= 300) {
      let errMsg = `Proxmox returned ${result.statusCode}`
      try {
        const json = JSON.parse(result.body)
        errMsg = json.errors ? JSON.stringify(json.errors) : json.message || errMsg
      } catch { /* use default */ }
      setProgress(uploadId, { bytesSent: session.bytesSent, totalBytes: session.totalFormLength, status: "error", error: errMsg })
      return NextResponse.json({ error: errMsg, uploadId }, { status: result.statusCode })
    }

    setProgress(uploadId, { bytesSent: session.bytesSent, totalBytes: session.bytesSent, status: "done" })

    let data = null
    try {
      const json = JSON.parse(result.body)
      data = json.data
    } catch { /* ignore */ }

    const { audit } = await import("@/lib/audit")
    await audit({
      action: "update" as any,
      category: "storage",
      resourceType: "storage",
      resourceId: storage,
      details: { node, connectionId: id, operation: "upload" },
    })

    return NextResponse.json({ success: true, data, uploadId })
  } catch (e: any) {
    console.error("Error finalizing upload:", e)
    setProgress(uploadId, { bytesSent: 0, totalBytes: 0, status: "error", error: e?.message || String(e) })
    return NextResponse.json({ error: e?.message || String(e), uploadId }, { status: 500 })
  } finally {
    streamingSessions.delete(uploadId)
    setTimeout(() => clearProgress(uploadId), 30_000)
  }
}
