/**
 * POST .../storage/[storage]/upload: both legs (chunk, finalize) run the
 * tenant write guard with the TARGET FILENAME (#894 allowUploads). The chunk
 * leg reads it from X-File-Name; the finalize leg carries no such header from
 * the browser, so it falls back to the name recorded on the first chunk.
 * No socket is ever opened here: a refusal or a missing body stops the
 * handler before it dials Proxmox.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "@/__tests__/setup/route-test"

const { checkPermissionMock, guardMock, nameMock, getConnectionByIdMock, getPrincipalMock, excludedMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  guardMock: vi.fn(),
  nameMock: vi.fn(),
  getConnectionByIdMock: vi.fn(),
  getPrincipalMock: vi.fn(),
  excludedMock: vi.fn(),
}))

vi.mock("@/lib/rbac", () => ({
  // Storage-scope helpers (#921): the id builder is the real shape, the
  // perimeter is unrestricted unless a test overrides it.
  buildStorageResourceId: (id: string, storage: string) => `${id}:${storage}`,
  getRequestStorageGrantPerimeter: async () => null,
  filterStoragesByGrant: (items: any[], p: any, of: (i: any) => string) => (p?.restricted ? items.filter((i: any) => p.storages.has(of(i))) : items),
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  PERMISSIONS: { CONNECTION_VIEW: "connection.view", STORAGE_UPLOAD: "storage.upload" },
}))
// tenantUploadFilename namespaces a tenant's file on an upload library; by
// default it hands the name back unchanged (provider / non-library case).
vi.mock("@/lib/vdc/scope", () => ({
  guardTenantStorageWrite: (...a: any[]) => guardMock(...a),
  tenantUploadFilename: (...a: any[]) => nameMock(...a),
}))
vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: (...a: any[]) => getConnectionByIdMock(...a),
}))
vi.mock("@/lib/auth/principal", () => ({
  getPrincipal: (...a: any[]) => getPrincipalMock(...a),
}))
vi.mock("@/lib/upload-progress", () => ({ setProgress: vi.fn(), clearProgress: vi.fn() }))
// The license exclusion of the cluster (roadmap#58) is read from the
// database by the real module; scripted here, the error class stays real.
vi.mock("@/lib/license/exclusions", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/license/exclusions")>()),
  isConnectionLicenseExcluded: (...a: any[]) => excludedMock(...a),
}))

// Fake Proxmox endpoint: the route opens ONE https request on the first chunk
// and reads its response on finalize. `fakeHttps.request` hands back a
// writable stub and answers 200 with a UPID once the request is ended.
const { fakeHttps } = vi.hoisted(() => {
  const { EventEmitter } = require("node:events")
  const request = vi.fn((_opts: any, onResponse: (res: any) => void) => {
    const req: any = new EventEmitter()
    req.write = (_data: any, cb?: (err?: any) => void) => { cb?.(); return true }
    req.destroy = () => {}
    req.end = () => {
      const res: any = new EventEmitter()
      res.statusCode = 200
      onResponse(res)
      res.emit("data", Buffer.from(JSON.stringify({ data: "UPID:pve1:0001:upload" })))
      res.emit("end")
    }
    return req
  })
  return { fakeHttps: { request, Agent: class {} } }
})
vi.mock("node:https", () => ({ default: fakeHttps, ...fakeHttps }))

import { DELETE, POST } from "./route"

const PARAMS = { id: "conn-1", node: "pve1", storage: "isolib" }

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  guardMock.mockReset().mockResolvedValue(null)
  nameMock.mockReset().mockImplementation(async (_c: string, _s: string, f: string) => f)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: "conn-1", baseUrl: "https://pve:8006", apiToken: "t" })
  getPrincipalMock.mockReset().mockResolvedValue({ ok: true, principal: { userId: "u1" } })
  excludedMock.mockReset().mockResolvedValue(false)
})

describe("upload: cluster outside the license (roadmap#58)", () => {
  it("chunk leg: refuses the first chunk with 403 and the code, after RBAC and before the guard or PVE", async () => {
    // This upload dials Proxmox itself instead of going through pveFetch, so
    // the write guard applies by hand: no session, no socket, nothing streamed.
    excludedMock.mockResolvedValue(true)
    const res = await callRoute(POST, {
      method: "POST",
      params: PARAMS,
      headers: { "x-chunk-index": "0", "x-total-size": "10", "x-file-name": "x.iso", "x-upload-id": "u-excluded-1" },
      body: "0123456789",
    })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: "CONNECTION_LICENSE_EXCLUDED" })
    expect(excludedMock).toHaveBeenCalledWith("conn-1")
    expect(checkPermissionMock).toHaveBeenCalledWith("storage.upload", "storage", "conn-1:isolib")
    expect(guardMock).not.toHaveBeenCalled()
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
    expect(fakeHttps.request).not.toHaveBeenCalled()
  })
})

describe("upload: RBAC (#920)", () => {
  it("chunk leg: 403s without storage.upload before the guard or PVE", async () => {
    checkPermissionMock.mockResolvedValue(new Response(JSON.stringify({ error: "denied" }), { status: 403 }))
    const res = await callRoute(POST, {
      method: "POST",
      params: PARAMS,
      headers: { "x-chunk-index": "0", "x-total-size": "10", "x-file-name": "x.iso", "x-upload-id": "u-rbac-1" },
      body: "0123456789",
    })
    expect(res.status).toBe(403)
    expect(checkPermissionMock).toHaveBeenCalledWith("storage.upload", "storage", "conn-1:isolib")
    expect(guardMock).not.toHaveBeenCalled()
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it("finalize leg: 403s without storage.upload before the guard", async () => {
    checkPermissionMock.mockResolvedValue(new Response(JSON.stringify({ error: "denied" }), { status: 403 }))
    const res = await callRoute(POST, {
      method: "POST",
      params: PARAMS,
      headers: { "x-finalize": "1", "x-file-name": "x.iso", "x-upload-id": "u-rbac-2" },
    })
    expect(res.status).toBe(403)
    expect(checkPermissionMock).toHaveBeenCalledWith("storage.upload", "storage", "conn-1:isolib")
    expect(guardMock).not.toHaveBeenCalled()
  })

  it("cancel leg: checks storage.upload", async () => {
    checkPermissionMock.mockResolvedValue(new Response(JSON.stringify({ error: "denied" }), { status: 403 }))
    const res = await callRoute(DELETE as any, { params: PARAMS, method: "DELETE", headers: { "X-Upload-Id": "u-rbac-3" } })
    expect(res.status).toBe(403)
    expect(checkPermissionMock).toHaveBeenCalledWith("storage.upload", "storage", "conn-1:isolib")
  })
})

describe("POST upload: tenant write guard sees the filename on both legs", () => {
  it("chunk leg: passes X-File-Name to the guard and returns its refusal before dialing PVE", async () => {
    guardMock.mockResolvedValue(new Response(JSON.stringify({ error: "nope" }), { status: 403 }))
    const res = await callRoute(POST, {
      method: "POST",
      params: PARAMS,
      headers: { "x-chunk-index": "0", "x-total-size": "10", "x-file-name": "custom-acme-x.iso", "x-upload-id": "u-1" },
      body: "0123456789",
    })
    expect(res.status).toBe(403)
    expect(guardMock).toHaveBeenCalledWith("conn-1", "isolib", { filename: "custom-acme-x.iso", content: "iso" })
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it("chunk leg: an allowed guard verdict lets the handler continue (400 on a missing body, before any socket)", async () => {
    const res = await callRoute(POST, {
      method: "POST",
      params: PARAMS,
      headers: { "x-chunk-index": "0", "x-file-name": "custom-acme-x.iso", "x-upload-id": "u-2" },
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Missing body/)
    expect(guardMock).toHaveBeenCalledWith("conn-1", "isolib", { filename: "custom-acme-x.iso", content: "iso" })
  })

  it("finalize leg: without a recorded session the guard gets a null filename and fails closed downstream", async () => {
    guardMock.mockResolvedValue(new Response(JSON.stringify({ error: "This storage is a read-only ISO library" }), { status: 403 }))
    const res = await callRoute(POST, {
      method: "POST",
      params: PARAMS,
      headers: { "x-finalize": "1", "x-upload-id": "u-unknown" },
    })
    expect(res.status).toBe(403)
    expect(guardMock).toHaveBeenCalledWith("conn-1", "isolib", { filename: null })
  })

  it("finalize leg: an explicit X-File-Name is forwarded as-is", async () => {
    const res = await callRoute(POST, {
      method: "POST",
      params: PARAMS,
      headers: { "x-finalize": "1", "x-upload-id": "u-unknown", "x-file-name": "custom-acme-y.iso" },
    })
    // No streaming session for this id: the route answers 400 after the guard passed.
    expect(res.status).toBe(400)
    expect(guardMock).toHaveBeenCalledWith("conn-1", "isolib", { filename: "custom-acme-y.iso" })
  })

  it("chunk leg: the name namespaced by tenantUploadFilename is what the guard judges, with the declared content type", async () => {
    nameMock.mockResolvedValue("custom-acme-debian.iso")
    guardMock.mockResolvedValue(new Response(JSON.stringify({ error: "Only ISO images can be written to an ISO library" }), { status: 403 }))
    const res = await callRoute(POST, {
      method: "POST",
      params: PARAMS,
      headers: { "x-chunk-index": "0", "x-total-size": "10", "x-file-name": "debian.iso", "x-content-type": "vztmpl", "x-upload-id": "u-4" },
      body: "0123456789",
    })
    expect(res.status).toBe(403)
    expect(nameMock).toHaveBeenCalledWith("conn-1", "isolib", "debian.iso")
    expect(guardMock).toHaveBeenCalledWith("conn-1", "isolib", { filename: "custom-acme-debian.iso", content: "vztmpl" })
  })

  it("finalize leg: an explicit X-File-Name goes through tenantUploadFilename before the guard", async () => {
    nameMock.mockResolvedValue("custom-acme-y.iso")
    const res = await callRoute(POST, {
      method: "POST",
      params: PARAMS,
      headers: { "x-finalize": "1", "x-upload-id": "u-unknown", "x-file-name": "y.iso" },
    })
    expect(res.status).toBe(400)
    expect(guardMock).toHaveBeenCalledWith("conn-1", "isolib", { filename: "custom-acme-y.iso" })
  })

  it("finalize leg: answers the STORED file name so a picker can preselect a namespaced upload (#894)", async () => {
    nameMock.mockResolvedValue("custom-acme-rescue.iso")
    const chunk = await callRoute(POST, {
      method: "POST",
      params: PARAMS,
      headers: { "x-chunk-index": "0", "x-total-chunks": "1", "x-total-size": "10", "x-file-name": "rescue.iso", "x-upload-id": "u-final" },
      body: "0123456789",
    })
    expect(chunk.status).toBe(200)
    expect(fakeHttps.request).toHaveBeenCalledTimes(1)

    const fin = await callRoute(POST, { method: "POST", params: PARAMS, headers: { "x-finalize": "1", "x-upload-id": "u-final" } })
    expect(fin.status).toBe(200)
    const json = await fin.json()
    expect(json.success).toBe(true)
    expect(json.filename).toBe("custom-acme-rescue.iso")
    expect(json.data).toBe("UPID:pve1:0001:upload")
    // The finalize leg judged the name recorded on the chunk, not a raw header.
    expect(guardMock).toHaveBeenLastCalledWith("conn-1", "isolib", { filename: "custom-acme-rescue.iso" })
  })

  it("400s when neither X-Chunk-Index nor X-Finalize is present, without consulting the guard", async () => {
    const res = await callRoute(POST, { method: "POST", params: PARAMS, headers: { "x-upload-id": "u-3" } })
    expect(res.status).toBe(400)
    expect(guardMock).not.toHaveBeenCalled()
  })
})

/**
 * DELETE .../upload: stopping an upload from its task row (#974). The browser
 * stops sending on its own; what this leg owns is the half-written connection
 * to Proxmox, which would otherwise sit open until its 600 s timeout.
 */
describe("DELETE upload: stopping a transfer in flight", () => {
  const startChunk = async () =>
    callRoute(DELETE as any, {
      params: PARAMS,
      method: "DELETE",
      headers: { "X-Upload-Id": "up-del" },
    })

  it("400s without an upload id, so a stray call cannot match a session by accident", async () => {
    const res = await callRoute(DELETE as any, { params: PARAMS, method: "DELETE" })

    expect(res.status).toBe(400)
  })

  it("refuses without storage.upload", async () => {
    checkPermissionMock.mockResolvedValue(new Response(JSON.stringify({ error: "denied" }), { status: 403 }))

    expect((await startChunk()).status).toBe(403)
  })

  it("404s on an id with nothing in flight, which is also what a finished upload gives", async () => {
    const res = await startChunk()

    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/no upload in flight/i)
  })

  it("destroys the open Proxmox request of a transfer that IS in flight", async () => {
    const destroy = vi.fn()
    fakeHttps.request.mockImplementationOnce((_opts: any, _onResponse: any) => {
      const { EventEmitter } = require("node:events")
      const req: any = new EventEmitter()
      req.write = (_d: any, cb?: (e?: any) => void) => { cb?.(); return true }
      req.destroy = destroy
      req.end = () => {}

      return req
    })

    // First chunk opens the session and streams one byte to Proxmox.
    const chunk = await callRoute(POST as any, {
      params: PARAMS,
      body: "x",
      headers: {
        "X-Upload-Id": "up-live",
        "X-Chunk-Index": "0",
        "X-Total-Size": "1",
        "X-File-Name": "big.iso",
      },
    })
    expect(chunk.status).toBe(200)

    const res = await callRoute(DELETE as any, {
      params: PARAMS,
      method: "DELETE",
      headers: { "X-Upload-Id": "up-live" },
    })

    expect(res.status).toBe(200)
    expect(destroy).toHaveBeenCalled()

    // The session is gone: a second stop finds nothing, so a double click
    // cannot destroy a request that a later upload has since opened.
    const again = await callRoute(DELETE as any, {
      params: PARAMS,
      method: "DELETE",
      headers: { "X-Upload-Id": "up-live" },
    })
    expect(again.status).toBe(404)
  })
})

/**
 * Retries behind a reverse proxy (roadmap#55). nginx answers 504 when a chunk
 * write to Proxmox outlasts its read timeout, while the route keeps writing.
 * A retry of that chunk must be acknowledged, never written a second time,
 * and a chunk that finds no session must not open a new, truncated upload.
 */
describe("POST upload: chunk retries are idempotent", () => {
  beforeEach(() => { fakeHttps.request.mockClear() })

  // Fake Proxmox request whose writes are recorded; `hold` keeps a write
  // pending until `release()` is called.
  const recordingRequest = (opts: { hold?: boolean; fail?: boolean } = {}) => {
    const writes: Buffer[] = []
    let pending: (() => void) | null = null
    fakeHttps.request.mockImplementationOnce((_o: any, _onResponse: any) => {
      const { EventEmitter } = require("node:events")
      const req: any = new EventEmitter()
      req.write = (data: any, cb?: (err?: any) => void) => {
        writes.push(Buffer.from(data))
        if (opts.fail) cb?.(new Error("socket hang up"))
        else if (opts.hold) pending = () => cb?.()
        else cb?.()
        return true
      }
      req.destroy = vi.fn()
      req.end = () => {}
      return req
    })
    return { writes, release: () => pending?.() }
  }

  const chunk = (uploadId: string, index: number, body?: string) =>
    callRoute(POST, {
      method: "POST",
      params: PARAMS,
      headers: { "x-chunk-index": String(index), "x-total-size": "8", "x-file-name": "big.iso", "x-upload-id": uploadId },
      body,
    })

  it("acknowledges a chunk sent again after its reply was lost, without writing it twice", async () => {
    const pve = recordingRequest()

    expect((await chunk("r-dup", 0, "aaaa")).status).toBe(200)
    const again = await chunk("r-dup", 0, "aaaa")
    expect(again.status).toBe(200)
    expect((await chunk("r-dup", 1, "bbbb")).status).toBe(200)

    // Multipart preamble, then each chunk once and whole.
    expect(pve.writes.slice(1).map(String)).toEqual(["aaaa", "bbbb"])
  })

  it("refuses a chunk past the first when no session exists, instead of opening a truncated upload", async () => {
    const res = await chunk("r-lost", 2, "cccc")

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "UPLOAD_SESSION_LOST" })
    expect(fakeHttps.request).not.toHaveBeenCalled()
  })

  it("refuses a chunk that skips one", async () => {
    recordingRequest()
    expect((await chunk("r-gap", 0, "aaaa")).status).toBe(200)

    const res = await chunk("r-gap", 2, "cccc")

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "UPLOAD_CHUNK_MISSING" })
  })

  it("answers 202 when the write outlasts the wait, then 200 to a bodiless ask once it is through", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    try {
      const pve = recordingRequest({ hold: true })
      const first = chunk("r-slow", 0, "aaaa")
      await vi.advanceTimersByTimeAsync(25_000)
      const res = await first
      expect(res.status).toBe(202)
      expect(await res.json()).toMatchObject({ pending: true, chunkIndex: 0 })

      pve.release()
      const ask = await chunk("r-slow", 0)
      expect(ask.status).toBe(200)
      expect(pve.writes.slice(1).map(String)).toEqual(["aaaa"])
    } finally {
      vi.useRealTimers()
    }
  })

  it("refuses a chunk that would carry the upload past the size its first chunk announced", async () => {
    const pve = recordingRequest()
    expect((await chunk("r-big", 0, "aaaa")).status).toBe(200)

    const res = await chunk("r-big", 1, "bbbbbbbb")

    expect(res.status).toBe(413)
    expect(pve.writes.slice(1).map(String)).toEqual(["aaaa"])
  })

  it("keeps one chunk in memory per upload: the next one waits for the write in flight", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    try {
      const pve = recordingRequest({ hold: true })
      const first = chunk("r-queue", 0, "aaaa")
      await vi.advanceTimersByTimeAsync(0)

      const second = await chunk("r-queue", 1, "bbbb")
      expect(second.status).toBe(429)

      pve.release()
      await vi.advanceTimersByTimeAsync(0)
      expect((await first).status).toBe(200)

      // Once chunk 0 is through, chunk 1 is taken.
      const third = chunk("r-queue", 1, "bbbb")
      await vi.advanceTimersByTimeAsync(0)
      pve.release()
      expect((await third).status).toBe(200)
      expect(pve.writes.slice(1).map(String)).toEqual(["aaaa", "bbbb"])
    } finally {
      vi.useRealTimers()
    }
  })

  it("ends the session on a failed write, so the next chunk is refused rather than streamed", async () => {
    // The preamble is written without a callback, so only the chunk write fails.
    recordingRequest({ fail: true })

    const res = await chunk("r-fail", 0, "aaaa")
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/socket hang up/)

    const next = await chunk("r-fail", 1, "bbbb")
    expect(next.status).toBe(409)
    expect(await next.json()).toMatchObject({ code: "UPLOAD_SESSION_LOST" })
  })
})
