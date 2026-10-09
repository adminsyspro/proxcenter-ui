import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "@/__tests__/setup/route-test"

const { pveFetchMock, checkPermissionMock, allowedPoolsMock, auditMock } = vi.hoisted(() => ({
  pveFetchMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  allowedPoolsMock: vi.fn(),
  auditMock: vi.fn(),
}))

vi.mock("@/lib/proxmox/client", () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))
vi.mock("@/lib/connections/getConnection", () => ({ getConnectionById: async () => ({ baseUrl: "https://pve", apiToken: "t" }) }))
vi.mock("@/lib/rbac", () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  PERMISSIONS: { BACKUP_JOB_EDIT: "backup.job.edit" },
}))
vi.mock("@/lib/tenant", () => ({ getCurrentTenantId: async () => "default" }))
vi.mock("@/lib/vdc/backupJobs", () => ({ getAllowedJobPools: (...a: any[]) => allowedPoolsMock(...a) }))
vi.mock("@/lib/audit", () => ({ audit: (...a: any[]) => auditMock(...a) }))

import { POST } from "./route"

const GUESTS = [
  { vmid: 9201, node: "pve2-dr", name: "t-users-a", type: "qemu" },
  { vmid: 5100, node: "pve2-dr", name: "Debian13", type: "qemu" },
]

let job: any

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  allowedPoolsMock.mockResolvedValue(null)
  auditMock.mockResolvedValue("audit-id")
  job = { id: "rc48", vmid: "5100", storage: "local", schedule: "sat 04:44" }
  pveFetchMock.mockImplementation(async (_c: any, path: string, init?: any) => {
    if (path === "/cluster/resources?type=vm") return GUESTS
    if (path === "/cluster/backup/rc48" && !init) return job
    if (path === "/cluster/backup/rc48" && init?.method === "PUT") return null
    throw new Error(`unexpected ${path}`)
  })
})

async function add(vmid: number | string = 9201) {
  const res = await callRoute(POST as any, { params: { id: "c1", jobId: "rc48" }, body: { vmid } })
  return { status: res.status, body: await res.json() }
}

function sentBody(): URLSearchParams | null {
  const put = pveFetchMock.mock.calls.find(c => c[2]?.method === "PUT")
  return put ? new URLSearchParams(put[2].body) : null
}

describe("POST /api/v1/connections/[id]/backup-jobs/[jobId]/guests", () => {
  it("appends the vmid to an explicit vmid job and sends nothing else", async () => {
    const { status, body } = await add()
    expect(status).toBe(200)
    expect(body.data).toEqual({ jobId: "rc48", vmid: 9201, disabled: false })
    expect([...sentBody()!.entries()]).toEqual([["vmid", "5100,9201"]])
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "update", category: "backups", resourceId: "c1:rc48", status: "success",
      details: expect.objectContaining({ operation: "add_guest", vmid: 9201, set: { vmid: "5100,9201" } }),
    }))
  })

  it("drops the vmid from the exclusions of an all job", async () => {
    job = { id: "rc48", all: 1, exclude: "101,9201,102" }
    await add()
    expect([...sentBody()!.entries()]).toEqual([["exclude", "101,102"]])
  })

  it("deletes the exclude field when the guest was its only entry", async () => {
    job = { id: "rc48", all: 1, exclude: "9201" }
    await add()
    expect([...sentBody()!.entries()]).toEqual([["delete", "exclude"]])
  })

  it("refuses a pool job: the guest joins through the pool", async () => {
    job = { id: "rc48", pool: "prod", vmid: "5100" }
    const { status, body } = await add()
    expect(status).toBe(409)
    expect(body.reason).toBe("pool")
    expect(sentBody()).toBeNull()
  })

  it("refuses a job pinned to another node than the guest's", async () => {
    job = { id: "rc48", vmid: "5100", node: "pve1-dr" }
    const { status, body } = await add()
    expect(status).toBe(409)
    expect(body.reason).toBe("other_node")
    expect(sentBody()).toBeNull()
  })

  it("accepts a job pinned to the guest's own node", async () => {
    job = { id: "rc48", vmid: "5100", node: "pve2-dr" }
    expect((await add()).status).toBe(200)
  })

  it("adds to a disabled job but says it stays disabled", async () => {
    job = { id: "rc48", vmid: "5100", enabled: 0 }
    const { status, body } = await add()
    expect(status).toBe(200)
    expect(body.data.disabled).toBe(true)
    expect([...sentBody()!.entries()]).toEqual([["vmid", "5100,9201"]])
  })

  it("refuses a job that already selects the guest, or that selects nothing", async () => {
    job = { id: "rc48", vmid: "5100,9201" }
    expect((await add()).body.reason).toBe("already")
    job = { id: "rc48", all: 1 }
    expect((await add()).body.reason).toBe("already")
    job = { id: "rc48" }
    expect((await add()).body.reason).toBe("no_selection")
    expect(sentBody()).toBeNull()
  })

  it("404s an unknown guest and 400s a malformed vmid", async () => {
    expect((await add(7777)).status).toBe(404)
    expect((await add("12; rm")).status).toBe(400)
  })

  it("refuses a vDC tenant and a caller without the edit permission", async () => {
    allowedPoolsMock.mockResolvedValueOnce(new Set(["vdc-a"]))
    expect((await add()).status).toBe(403)
    checkPermissionMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }))
    expect((await add()).status).toBe(403)
    expect(sentBody()).toBeNull()
  })

  it("audits a PVE refusal as a failure", async () => {
    pveFetchMock.mockImplementation(async (_c: any, path: string, init?: any) => {
      if (path === "/cluster/resources?type=vm") return GUESTS
      if (!init) return job
      throw new Error("API error (status 500): boom")
    })
    expect((await add()).status).toBe(500)
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ status: "failure", errorMessage: "API error (status 500): boom" }))
  })
})
