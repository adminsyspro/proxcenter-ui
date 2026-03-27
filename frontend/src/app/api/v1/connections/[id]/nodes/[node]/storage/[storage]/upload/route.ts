import { NextResponse } from "next/server"
import https from "node:https"
import http from "node:http"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { Transform, Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import Busboy from "busboy"
import FormData from "form-data"

import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { setProgress, clearProgress } from "@/lib/upload-progress"

export const runtime = "nodejs"
export const maxDuration = 600

// POST /api/v1/connections/{id}/nodes/{node}/storage/{storage}/upload
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; node: string; storage: string }> }
) {
  let tmpFile: string | null = null
  const uploadId = req.headers.get("x-upload-id") || randomUUID()

  try {
    const { id, node, storage } = await ctx.params

    const denied = await checkPermission(PERMISSIONS.STORAGE_UPLOAD, "connection", id)
    if (denied) return denied

    const conn = await getConnectionById(id)
    const baseUrl = conn.baseUrl.replace(/\/+$/, "")
    const targetUrl = new URL(
      `${baseUrl}/api2/json/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/upload`
    )

    if (!req.body) {
      return NextResponse.json({ error: "No request body" }, { status: 400 })
    }

    // Parse incoming multipart with busboy, streaming file directly to disk
    const contentType = req.headers.get("content-type") || ""
    const parsed = await new Promise<{ content: string; tmpFile: string; fileName: string; fileSize: number; mimeType: string }>((resolve, reject) => {
      const bb = Busboy({ headers: { "content-type": contentType } })
      let content = ""
      let fileName = ""
      let mimeType = ""
      let fileSize = 0
      let fileDone = false
      let fieldDone = false
      const tmpDir = os.tmpdir()
      const safeName = `proxcenter-upload-${randomUUID()}`
      const tmpPath = path.join(tmpDir, safeName)
      let writeStream: fs.WriteStream | null = null

      const tryResolve = () => {
        if (fileDone && fieldDone && content && fileName) {
          resolve({ content, tmpFile: tmpPath, fileName, fileSize, mimeType })
        }
      }

      bb.on("field", (name, val) => {
        if (name === "content") content = val
        fieldDone = true
        tryResolve()
      })

      bb.on("file", (name, stream, info) => {
        if (name === "filename") {
          fileName = info.filename
          mimeType = info.mimeType || "application/octet-stream"
          writeStream = fs.createWriteStream(tmpPath, { mode: 0o600 })
          stream.on("data", (chunk: Buffer) => {
            fileSize += chunk.length
          })
          stream.pipe(writeStream)
          writeStream.on("finish", () => {
            fileDone = true
            tryResolve()
          })
          writeStream.on("error", reject)
        } else {
          stream.resume() // discard unexpected file fields
        }
      })

      bb.on("error", reject)
      bb.on("finish", () => {
        // If no file was received
        if (!fileName) reject(new Error("Missing 'filename' file field"))
        // fieldDone might not be set if content comes after file
        fieldDone = true
        tryResolve()
      })

      // Pipe the request body into busboy
      Readable.fromWeb(req.body as any).pipe(bb)
    })

    tmpFile = parsed.tmpFile

    console.log(`[upload] Saved "${parsed.fileName.replace(/[\r\n]/g, '')}" (${parsed.fileSize} bytes) to disk via streaming, uploadId=${uploadId}`)

    if (!parsed.content) {
      return NextResponse.json({ error: "Missing 'content' field" }, { status: 400 })
    }

    // Build a clean multipart form streaming from disk to Proxmox
    const form = new FormData()
    form.append("content", parsed.content)
    form.append("filename", fs.createReadStream(tmpFile), {
      filename: parsed.fileName,
      contentType: parsed.mimeType,
      knownLength: parsed.fileSize,
    })

    const formLength = await new Promise<number>((res, rej) =>
      form.getLength((err, len) => (err ? rej(err) : res(len)))
    )

    // Init progress tracking
    setProgress(uploadId, { bytesSent: 0, totalBytes: formLength, status: "transferring" })

    // Transform stream to count bytes sent
    let bytesSent = 0
    const progressTracker = new Transform({
      transform(chunk, _encoding, callback) {
        bytesSent += chunk.length
        setProgress(uploadId, { bytesSent, totalBytes: formLength, status: "transferring" })
        callback(null, chunk)
      },
    })

    const isHttps = targetUrl.protocol === "https:"
    const transport = isHttps ? https : http
    // Intentionally allow self-signed certs for Proxmox VE connections (common in private clusters)
    // codeql[js/disabling-certificate-validation]
    const agent = isHttps && conn.insecureDev
      ? new https.Agent({ rejectUnauthorized: false })
      : undefined

    const result = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const proxyReq = transport.request(
        {
          hostname: targetUrl.hostname,
          port: targetUrl.port || (isHttps ? 443 : 80),
          path: targetUrl.pathname + targetUrl.search,
          method: "POST",
          agent,
          headers: {
            "Authorization": `PVEAPIToken=${conn.apiToken}`,
            ...form.getHeaders(),
            "Content-Length": formLength,
          },
          timeout: 600_000,
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on("data", (chunk) => chunks.push(chunk))
          res.on("end", () => {
            resolve({
              statusCode: res.statusCode || 500,
              body: Buffer.concat(chunks).toString("utf-8"),
            })
          })
          res.on("error", reject)
        }
      )

      proxyReq.on("error", reject)
      form.pipe(progressTracker).pipe(proxyReq)
    })

    console.log(`[upload] Proxmox responded ${result.statusCode}:`, result.body.substring(0, 500))

    if (result.statusCode < 200 || result.statusCode >= 300) {
      let errMsg = `Proxmox returned ${result.statusCode}`
      try {
        const json = JSON.parse(result.body)
        errMsg = json.errors ? JSON.stringify(json.errors) : json.message || errMsg
      } catch { /* use default */ }
      setProgress(uploadId, { bytesSent, totalBytes: formLength, status: "error", error: errMsg })
      return NextResponse.json({ error: errMsg, uploadId }, { status: result.statusCode })
    }

    setProgress(uploadId, { bytesSent: formLength, totalBytes: formLength, status: "done" })

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
    console.error("Error uploading to storage:", e)
    setProgress(uploadId, { bytesSent: 0, totalBytes: 0, status: "error", error: e?.message || String(e) })
    return NextResponse.json({ error: e?.message || String(e), uploadId }, { status: 500 })
  } finally {
    if (tmpFile) {
      try { fs.unlinkSync(tmpFile) } catch { /* ignore */ }
    }
    // Clean up progress after 30s
    setTimeout(() => clearProgress(uploadId), 30_000)
  }
}
