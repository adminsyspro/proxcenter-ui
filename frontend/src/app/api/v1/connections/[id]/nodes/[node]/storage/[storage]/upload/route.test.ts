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

const { checkPermissionMock, guardMock, nameMock, getConnectionByIdMock, getPrincipalMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  guardMock: vi.fn(),
  nameMock: vi.fn(),
  getConnectionByIdMock: vi.fn(),
  getPrincipalMock: vi.fn(),
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  PERMISSIONS: { CONNECTION_VIEW: "connection.view" },
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

  it("refuses without the connection permission", async () => {
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
