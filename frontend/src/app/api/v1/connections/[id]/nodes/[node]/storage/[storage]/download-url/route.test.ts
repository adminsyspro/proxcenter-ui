/**
 * POST .../storage/[storage]/download-url: the tenant write guard must see the
 * TARGET FILENAME (#894 allowUploads), so the body is parsed before the guard
 * runs and a guard refusal short-circuits before any PVE call.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "@/__tests__/setup/route-test"

const { checkPermissionMock, guardMock, nameMock, getConnectionByIdMock, pveFetchMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  guardMock: vi.fn(),
  nameMock: vi.fn(),
  getConnectionByIdMock: vi.fn(),
  pveFetchMock: vi.fn(),
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  PERMISSIONS: { CONNECTION_VIEW: "connection.view" },
}))
vi.mock("@/lib/vdc/scope", () => ({
  guardTenantStorageWrite: (...a: any[]) => guardMock(...a),
  tenantUploadFilename: (...a: any[]) => nameMock(...a),
}))
vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: (...a: any[]) => getConnectionByIdMock(...a),
}))
vi.mock("@/lib/proxmox/client", () => ({
  pveFetch: (...a: any[]) => pveFetchMock(...a),
}))
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }))

import { POST } from "./route"

const PARAMS = { id: "conn-1", node: "pve1", storage: "isolib" }
const BODY = { url: "https://example.org/x.iso", content: "iso", filename: "custom-acme-x.iso" }

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  guardMock.mockReset().mockResolvedValue(null)
  nameMock.mockReset().mockImplementation(async (_c: string, _s: string, f: string) => f)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: "conn-1" })
  pveFetchMock.mockReset().mockResolvedValue("UPID:pve1:download")
})

describe("POST download-url: tenant write guard sees the filename", () => {
  it("passes the target filename and content type to guardTenantStorageWrite and proceeds when allowed", async () => {
    const res = await callRoute(POST, { method: "POST", params: PARAMS, body: BODY })
    expect(res.status).toBe(200)
    expect(guardMock).toHaveBeenCalledWith("conn-1", "isolib", { filename: "custom-acme-x.iso", content: "iso" })
    expect(pveFetchMock).toHaveBeenCalledTimes(1)
  })

  it("the name namespaced by tenantUploadFilename is what the guard judges and what PVE receives", async () => {
    nameMock.mockResolvedValue("custom-acme-x.iso")
    const res = await callRoute(POST, { method: "POST", params: PARAMS, body: { ...BODY, filename: "x.iso" } })
    expect(res.status).toBe(200)
    expect(nameMock).toHaveBeenCalledWith("conn-1", "isolib", "x.iso")
    expect(guardMock).toHaveBeenCalledWith("conn-1", "isolib", { filename: "custom-acme-x.iso", content: "iso" })
    // The PVE call carries the namespaced filename, never the raw one
    // (the source URL still ends in x.iso, so match the filename field only).
    const sent = JSON.stringify(pveFetchMock.mock.calls[0])
    expect(sent).toMatch(/filename=custom-acme-x\.iso|"filename":"custom-acme-x\.iso"/)
    expect(sent).not.toMatch(/filename=x\.iso|"filename":"x\.iso"/)
  })

  it("returns the guard refusal and never reaches PVE", async () => {
    guardMock.mockResolvedValue(new Response(JSON.stringify({ error: "This storage is a read-only ISO library" }), { status: 403 }))
    const res = await callRoute(POST, { method: "POST", params: PARAMS, body: BODY })
    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it("400s on an incomplete body before consulting the guard", async () => {
    const res = await callRoute(POST, { method: "POST", params: PARAMS, body: { url: "https://x", content: "iso" } })
    expect(res.status).toBe(400)
    expect(guardMock).not.toHaveBeenCalled()
  })
})
