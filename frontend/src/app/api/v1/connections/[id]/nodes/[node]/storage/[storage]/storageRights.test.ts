import { describe, it, expect, vi, beforeEach } from "vitest"

// Issue #920: uploading an ISO and pulling one from a URL are `storage.upload`,
// the right the role editor advertises, not `connection.view`. Every check is
// denied here, so what is asserted is which right the route demanded.
const checkPermission = vi.fn<(...args: any[]) => Promise<Response | null>>()

vi.mock("@/lib/rbac", () => ({
  checkPermission: (...args: any[]) => checkPermission(...args),
  PERMISSIONS: { CONNECTION_VIEW: "connection.view", STORAGE_UPLOAD: "storage.upload" },
}))

const pveFetch = vi.fn(async () => null)

vi.mock("@/lib/proxmox/client", () => ({ pveFetch: (...args: any[]) => pveFetch(...(args as [])) }))
vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: vi.fn(async () => ({ id: "conn-1", host: "h", tokenId: "t", tokenSecret: "s" })),
}))
vi.mock("@/lib/vdc/scope", () => ({ guardTenantStorageWrite: vi.fn(async () => null) }))
vi.mock("@/lib/auth/principal", () => ({ getPrincipal: vi.fn(async () => ({ kind: "session" })) }))
vi.mock("@/lib/upload-progress", () => ({ setProgress: vi.fn(), clearProgress: vi.fn() }))

import { POST as downloadUrl } from "./download-url/route"
import { POST as upload } from "./upload/route"
import { callRoute } from "@/__tests__/setup/route-test"

const PARAMS = { id: "conn-1", node: "pve-node-01", storage: "local" }

beforeEach(() => {
  vi.clearAllMocks()
  checkPermission.mockResolvedValue(
    new Response(JSON.stringify({ error: "forbidden" }), { status: 403 })
  )
})

describe("storage write routes gate on storage.upload (#920)", () => {
  it("refuses a URL download without the right", async () => {
    const res = await callRoute(downloadUrl as any, {
      params: PARAMS,
      body: { url: "https://example.test/debian.iso", content: "iso", filename: "debian.iso" },
    })

    expect(res.status).toBe(403)
    expect(checkPermission).toHaveBeenCalledWith("storage.upload", "connection", "conn-1")
    expect(pveFetch).not.toHaveBeenCalled()
  })

  it("refuses an upload chunk without the right", async () => {
    const res = await callRoute(upload as any, {
      params: PARAMS,
      body: "chunk-bytes",
      headers: { "x-chunk-index": "0", "x-upload-id": "u1" },
    })

    expect(res.status).toBe(403)
    expect(checkPermission).toHaveBeenCalledWith("storage.upload", "connection", "conn-1")
  })

  it("refuses the finalize call without the right", async () => {
    const res = await callRoute(upload as any, {
      params: PARAMS,
      body: "",
      headers: { "x-finalize": "1", "x-upload-id": "u1" },
    })

    expect(res.status).toBe(403)
    expect(checkPermission).toHaveBeenCalledWith("storage.upload", "connection", "conn-1")
  })
})
