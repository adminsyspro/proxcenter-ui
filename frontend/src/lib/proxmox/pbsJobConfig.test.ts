/**
 * ui#817 — le squelette partagé des routes de configuration d'un job PBS.
 * Les quatre familles (sync, verify, prune, tape) portaient chacune leur copie
 * de ce chemin ; il n'existe plus qu'ici, donc ses branches (mode démo, params
 * manquants, refus RBAC, erreur PBS) sont vérifiées une seule fois.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const { demoResponseMock, checkPermissionMock, getPbsConnectionByIdMock, pbsFetchMock } = vi.hoisted(
  () => ({
    demoResponseMock: vi.fn(),
    checkPermissionMock: vi.fn(),
    getPbsConnectionByIdMock: vi.fn(),
    pbsFetchMock: vi.fn(),
  })
)

vi.mock("@/lib/demo/demo-api", () => ({ demoResponse: (...a: any[]) => demoResponseMock(...a) }))

vi.mock("@/lib/proxmox/pbs-client", () => ({ pbsFetch: (...a: any[]) => pbsFetchMock(...a) }))

vi.mock("@/lib/connections/getConnection", () => ({
  getPbsConnectionById: (...a: any[]) => getPbsConnectionByIdMock(...a),
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  PERMISSIONS: {
    BACKUP_JOB_CREATE: "backup.job.create",
    BACKUP_JOB_EDIT: "backup.job.edit",
    BACKUP_JOB_DELETE: "backup.job.delete",
  },
}))

import { createPbsJobConfig, deletePbsJobConfig, updatePbsJobConfig } from "./pbsJobConfig"
import { PbsJobRequestError, type PbsJobSpec } from "./pbsJobSpecs"

const SPEC: PbsJobSpec = {
  configPath: "/config/demo",
  label: "Demo job",
  logTag: "pbs-demo-jobs",
  buildCreate: (body: any) => {
    if (!body.id) throw new PbsJobRequestError("Job ID is required")

    return { id: body.id }
  },
  buildUpdate: (body: any) => ({ schedule: body.schedule }),
}

const CONN = { id: "pbs-1", baseUrl: "https://pbs.local:8007" }

function ctx(params: { id?: string; jobId?: string }) {
  return { params: Promise.resolve(params as { id: string; jobId: string }) }
}

function jsonRequest(body: unknown = {}) {
  return new Request("http://test.local/_", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => {})
  demoResponseMock.mockReturnValue(null)
  checkPermissionMock.mockResolvedValue(null)
  getPbsConnectionByIdMock.mockResolvedValue(CONN)
  pbsFetchMock.mockResolvedValue({ ok: true })
})

describe("createPbsJobConfig", () => {
  it("poste le corps de creation sur la collection du spec", async () => {
    const res = await createPbsJobConfig(
      jsonRequest({ id: "j1" }),
      { params: Promise.resolve({ id: "pbs-1" }) },
      SPEC
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      data: { ok: true },
      message: "Demo job created successfully",
    })

    const [, path, init] = pbsFetchMock.mock.calls[0]

    expect(path).toBe("/config/demo")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({ id: "j1" })
  })

  it("traduit un requis manquant en 400 portant le message du spec", async () => {
    const res = await createPbsJobConfig(
      jsonRequest({}),
      { params: Promise.resolve({ id: "pbs-1" }) },
      SPEC
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: "Job ID is required" })
    expect(pbsFetchMock).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
  })

  it("rend la réponse du mode démo sans toucher à PBS", async () => {
    demoResponseMock.mockReturnValue(new Response("demo", { status: 200 }))

    const res = await createPbsJobConfig(
      jsonRequest({ id: "j1" }),
      { params: Promise.resolve({ id: "pbs-1" }) },
      SPEC
    )

    await expect(res.text()).resolves.toBe("demo")
    expect(pbsFetchMock).not.toHaveBeenCalled()
  })

  it("répond 400 quand l'id de connexion manque", async () => {
    const res = await createPbsJobConfig(
      jsonRequest({ id: "j1" }),
      { params: Promise.resolve({} as { id: string }) },
      SPEC
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: "Missing PBS connection ID" })
    expect(checkPermissionMock).not.toHaveBeenCalled()
  })

  it("relaie le refus RBAC de création", async () => {
    checkPermissionMock.mockResolvedValue(new Response(null, { status: 403 }))

    const res = await createPbsJobConfig(
      jsonRequest({ id: "j1" }),
      { params: Promise.resolve({ id: "pbs-1" }) },
      SPEC
    )

    expect(res.status).toBe(403)
    expect(checkPermissionMock).toHaveBeenCalledWith("backup.job.create", "pbs", "pbs-1")
    expect(pbsFetchMock).not.toHaveBeenCalled()
  })

  it("répond 500 quand PBS refuse la création", async () => {
    pbsFetchMock.mockRejectedValue(new Error("PBS 400 /config/demo:\nbad param"))

    const res = await createPbsJobConfig(
      jsonRequest({ id: "j1" }),
      { params: Promise.resolve({ id: "pbs-1" }) },
      SPEC
    )

    expect(res.status).toBe(500)
    expect(console.error).toHaveBeenCalledWith(
      "[pbs-demo-jobs] POST Error:",
      "PBS 400 /config/demo:bad param"
    )
  })
})

describe("updatePbsJobConfig", () => {
  it("envoie le PUT sur la collection du spec, id du job encodé", async () => {
    const res = await updatePbsJobConfig(
      jsonRequest({ schedule: "daily" }),
      ctx({ id: "pbs-1", jobId: "job/one" }),
      SPEC
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      data: { ok: true },
      message: "Demo job updated successfully",
    })

    const [, path, init] = pbsFetchMock.mock.calls[0]

    expect(path).toBe("/config/demo/job%2Fone")
    expect(init.method).toBe("PUT")
    expect(JSON.parse(init.body)).toEqual({ schedule: "daily" })
  })

  it("rend la réponse du mode démo sans toucher à PBS", async () => {
    demoResponseMock.mockReturnValue(new Response("demo", { status: 200 }))

    const res = await updatePbsJobConfig(jsonRequest(), ctx({ id: "pbs-1", jobId: "j1" }), SPEC)

    await expect(res.text()).resolves.toBe("demo")
    expect(pbsFetchMock).not.toHaveBeenCalled()
  })

  it("répond 400 quand l'id du job manque", async () => {
    const res = await updatePbsJobConfig(jsonRequest(), ctx({ id: "pbs-1" }), SPEC)

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: "Missing parameters" })
    expect(checkPermissionMock).not.toHaveBeenCalled()
  })

  it("répond 400 quand l'id de connexion manque", async () => {
    const res = await updatePbsJobConfig(jsonRequest(), ctx({ jobId: "j1" }), SPEC)

    expect(res.status).toBe(400)
    expect(pbsFetchMock).not.toHaveBeenCalled()
  })

  it("relaie le refus RBAC tel quel", async () => {
    checkPermissionMock.mockResolvedValue(new Response(null, { status: 403 }))

    const res = await updatePbsJobConfig(jsonRequest(), ctx({ id: "pbs-1", jobId: "j1" }), SPEC)

    expect(res.status).toBe(403)
    expect(checkPermissionMock).toHaveBeenCalledWith("backup.job.edit", "pbs", "pbs-1")
    expect(pbsFetchMock).not.toHaveBeenCalled()
  })

  it("répond 500 avec le message PBS, et le journal tient sur une ligne", async () => {
    pbsFetchMock.mockRejectedValue(new Error("PBS 400 /config/demo:\nbad param"))

    const res = await updatePbsJobConfig(jsonRequest(), ctx({ id: "pbs-1", jobId: "j1" }), SPEC)

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({
      error: "PBS 400 /config/demo:\nbad param",
    })
    expect(console.error).toHaveBeenCalledWith(
      "[pbs-demo-jobs] PUT Error:",
      "PBS 400 /config/demo:bad param"
    )
  })

  it("répond 500 sur un corps illisible", async () => {
    const bad = new Request("http://test.local/_", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{",
    })

    const res = await updatePbsJobConfig(bad, ctx({ id: "pbs-1", jobId: "j1" }), SPEC)

    expect(res.status).toBe(500)
    expect(pbsFetchMock).not.toHaveBeenCalled()
  })
})

describe("deletePbsJobConfig", () => {
  it("envoie le DELETE sur l'entrée, sans corps", async () => {
    const res = await deletePbsJobConfig(
      new Request("http://test.local/_", { method: "DELETE" }),
      ctx({ id: "pbs-1", jobId: "j1" }),
      SPEC
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ message: "Demo job deleted successfully" })

    const [, path, init] = pbsFetchMock.mock.calls[0]

    expect(path).toBe("/config/demo/j1")
    expect(init).toEqual({ method: "DELETE" })
  })

  it("rend la réponse du mode démo sans toucher à PBS", async () => {
    demoResponseMock.mockReturnValue(new Response("demo", { status: 200 }))

    const res = await deletePbsJobConfig(
      new Request("http://test.local/_", { method: "DELETE" }),
      ctx({ id: "pbs-1", jobId: "j1" }),
      SPEC
    )

    await expect(res.text()).resolves.toBe("demo")
    expect(pbsFetchMock).not.toHaveBeenCalled()
  })

  it("répond 400 sur des params incomplets", async () => {
    const res = await deletePbsJobConfig(
      new Request("http://test.local/_", { method: "DELETE" }),
      ctx({ id: "pbs-1" }),
      SPEC
    )

    expect(res.status).toBe(400)
    expect(checkPermissionMock).not.toHaveBeenCalled()
  })

  it("relaie le refus RBAC avec la permission de suppression", async () => {
    checkPermissionMock.mockResolvedValue(new Response(null, { status: 403 }))

    const res = await deletePbsJobConfig(
      new Request("http://test.local/_", { method: "DELETE" }),
      ctx({ id: "pbs-1", jobId: "j1" }),
      SPEC
    )

    expect(res.status).toBe(403)
    expect(checkPermissionMock).toHaveBeenCalledWith("backup.job.delete", "pbs", "pbs-1")
  })

  it("répond 500 quand PBS refuse la suppression", async () => {
    pbsFetchMock.mockRejectedValue(new Error("PBS 404 /config/demo/j1"))

    const res = await deletePbsJobConfig(
      new Request("http://test.local/_", { method: "DELETE" }),
      ctx({ id: "pbs-1", jobId: "j1" }),
      SPEC
    )

    expect(res.status).toBe(500)
    expect(console.error).toHaveBeenCalledWith(
      "[pbs-demo-jobs] DELETE Error:",
      "PBS 404 /config/demo/j1"
    )
  })
})
