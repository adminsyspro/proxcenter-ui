/**
 * GHSA-79j6-v2r5-5pw5, defense in depth.
 *
 * notes / tasks / features were the three guest routes that carried no
 * authorization of their own and relied entirely on the middleware. When the
 * middleware's dot rule let a request past, they resolved a connection
 * (which decrypts the Proxmox API token) and proxied it to the hypervisor for
 * an anonymous caller.
 *
 * What is asserted here is the ORDER as much as the check: the permission
 * decision must land before getConnectionById, so a denied caller never
 * causes a secret to be decrypted, and before the features route's
 * constant-answer shortcut, so it cannot be used as an oracle either.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

import { callRoute } from "@/__tests__/setup/route-test"

// vi.hoisted: the vi.mock factories below are hoisted above these
// declarations, so plain consts would not be initialized yet when the routes
// under test are imported.
const { checkPermissionMock, getConnectionByIdMock, getConnectionByIdOrNullMock, pveFetchMock } =
  vi.hoisted(() => ({
    checkPermissionMock: vi.fn<(...a: any[]) => Promise<Response | null>>(),
    getConnectionByIdMock: vi.fn<(...a: any[]) => Promise<any>>(),
    getConnectionByIdOrNullMock: vi.fn<(...a: any[]) => Promise<any>>(),
    pveFetchMock: vi.fn<(...a: any[]) => Promise<any>>(),
  }))

// Mirrors the real helpers (lib/rbac/index.ts:531), kept as a stub so this
// file needs no DB for a pure ordering assertion.
vi.mock("@/lib/rbac", () => ({
  checkPermission: checkPermissionMock,
  buildVmResourceId: (connId: string, node: string, type: string, vmid: string) =>
    `${connId}:${node}:${type}:${vmid}`,
  PERMISSIONS: { VM_VIEW: "vm.view", VM_CONFIG: "vm.config" },
}))

vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: getConnectionByIdMock,
  getConnectionByIdOrNull: getConnectionByIdOrNullMock,
}))

vi.mock("@/lib/proxmox/client", () => ({ pveFetch: pveFetchMock }))

import { GET as notesGet, PUT as notesPut } from "./[vmid]/notes/route"
import { GET as tasksGet } from "./[vmid]/tasks/route"
import { GET as featuresGet } from "./[vmid]/features/route"

/** A guest whose node name carries a dot, the shape that defeated the middleware. */
const VM_KEY = "conn1:qemu:pve1.internal:100"
const LXC_KEY = "conn1:lxc:pve1.internal:100"

const CONN = { id: "conn1", name: "c", baseUrl: "https://pve", apiToken: "secret", insecureDev: false, behindProxy: false }

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getConnectionByIdMock.mockResolvedValue(CONN)
  getConnectionByIdOrNullMock.mockResolvedValue(CONN)
  pveFetchMock.mockResolvedValue({})
})

function denial() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 })
}

describe("guest proxy routes check a permission before touching a connection", () => {
  const cases = [
    {
      name: "GET notes",
      permission: "vm.view",
      key: VM_KEY,
      run: () => callRoute(notesGet, { params: { vmid: VM_KEY }, method: "GET" }),
    },
    {
      name: "PUT notes",
      permission: "vm.config",
      key: VM_KEY,
      run: () =>
        callRoute(notesPut, { params: { vmid: VM_KEY }, method: "PUT", body: { content: "x" } }),
    },
    {
      name: "GET tasks",
      permission: "vm.view",
      key: VM_KEY,
      run: () => callRoute(tasksGet, { params: { vmid: VM_KEY }, method: "GET" }),
    },
    {
      name: "GET features",
      permission: "vm.view",
      key: LXC_KEY,
      run: () =>
        callRoute(featuresGet, {
          params: { vmid: LXC_KEY },
          method: "GET",
          searchParams: { feature: "snapshot" },
        }),
    },
  ]

  for (const c of cases) {
    it(`${c.name} returns the denial and resolves no connection`, async () => {
      checkPermissionMock.mockResolvedValue(denial())

      const res = await c.run()

      expect(res.status).toBe(403)
      expect(getConnectionByIdMock).not.toHaveBeenCalled()
      expect(getConnectionByIdOrNullMock).not.toHaveBeenCalled()
      expect(pveFetchMock).not.toHaveBeenCalled()
    })

    it(`${c.name} asks for ${c.permission} on the guest resource`, async () => {
      await c.run()

      const [permission, kind, resourceId] = checkPermissionMock.mock.calls[0]

      expect(permission).toBe(c.permission)
      expect(kind).toBe("vm")
      // buildVmResourceId reorders the key to connId:node:type:vmid
      const [connId, type, node, vmid] = c.key.split(":")

      expect(resourceId).toBe(`${connId}:${node}:${type}:${vmid}`)
    })
  }

  it("still serves an authorized caller", async () => {
    pveFetchMock.mockResolvedValue({ description: "hello" })

    const res = await callRoute(notesGet, { params: { vmid: VM_KEY }, method: "GET" })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { content: "hello" } })
  })

  // The qemu shortcut answers without any lookup, so the permission check has
  // to come first or the route stays an unauthenticated 200.
  it("denies the features shortcut for a qemu guest too", async () => {
    checkPermissionMock.mockResolvedValue(denial())

    const res = await callRoute(featuresGet, {
      params: { vmid: VM_KEY },
      method: "GET",
      searchParams: { feature: "snapshot" },
    })

    expect(res.status).toBe(403)
  })
})
