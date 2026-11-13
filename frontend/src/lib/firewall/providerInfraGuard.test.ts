import { beforeEach, describe, expect, it, vi } from "vitest"

const calls: string[] = []
const answers: Record<string, Response | null> = {}

vi.mock("@/lib/tenant/iaasGuard", () => ({
  denyIaasTenant: async () => (calls.push("iaas"), answers.iaas),
}))
vi.mock("@/lib/tenant", () => ({
  verifyConnectionOwnership: async (id: string) => (calls.push(`owner:${id}`), answers.owner),
}))
vi.mock("@/lib/rbac", () => ({
  checkPermission: async (perm: string, type: string, id: string) => (calls.push(`perm:${perm}:${type}:${id}`), answers.perm),
}))

import { guardProviderInfra } from "./providerInfraGuard"

const res = (status: number) => new Response(null, { status })

beforeEach(() => {
  calls.length = 0
  answers.iaas = null
  answers.owner = null
  answers.perm = null
})

describe("guardProviderInfra", () => {
  it("refuses an IaaS tenant before any ownership or permission lookup", async () => {
    answers.iaas = res(404)
    expect((await guardProviderInfra("c1", "node.view"))?.status).toBe(404)
    expect(calls).toEqual(["iaas"])
  })

  it("then checks the connection belongs to the caller's tenant", async () => {
    answers.owner = res(404)
    expect((await guardProviderInfra("c1", "node.view"))?.status).toBe(404)
    expect(calls).toEqual(["iaas", "owner:c1"])
  })

  it("then applies the permission on the connection", async () => {
    answers.perm = res(403)
    expect((await guardProviderInfra("c1", "node.manage"))?.status).toBe(403)
    expect(calls).toEqual(["iaas", "owner:c1", "perm:node.manage:connection:c1"])
  })

  it("lets the caller through when every check passes", async () => {
    expect(await guardProviderInfra("c1", "node.view")).toBeNull()
    expect(calls).toHaveLength(3)
  })
})
