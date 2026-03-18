import { NextResponse } from "next/server"
import https from "node:https"
import http from "node:http"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { Transform } from "node:stream"
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

    // Parse the incoming multipart form
    const formData = await req.formData()
    const contentField = formData.get("content") as string | null
    const fileField = formData.get("filename") as File | null

    if (!contentField || !fileField) {
      return NextResponse.json(
        { error: "Missing 'content' or 'filename' field" },
        { status: 400 }
      )
    }

    // Save file to temp dir
    const tmpDir = os.tmpdir()
    const safeName = fileField.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    tmpFile = path.join(tmpDir, `proxcenter-upload-${randomUUID()}-${safeName}`)
    const arrayBuf = await fileField.arrayBuffer()
    fs.writeFileSync(tmpFile, Buffer.from(arrayBuf), { mode: 0o600 })

    console.log(`[upload] Saved "${String(fileField.name).replace(/[\r\n]/g, '')}" (${fileField.size} bytes), uploadId=${uploadId}`)

    // Build a clean multipart form streaming from disk
    const form = new FormData()
    form.append("content", contentField)
    form.append("filename", fs.createReadStream(tmpFile), {
      filename: fileField.name,
      contentType: fileField.type || "application/octet-stream",
      knownLength: fileField.size,
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
