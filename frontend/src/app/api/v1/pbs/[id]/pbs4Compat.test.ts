/**
 * ui#817 — compatibilité de l'API PBS 4.x.
 *
 * Ces tests épinglent ce que ProxCenter envoie réellement à PBS, sur les
 * points où le schéma PBS avait été mal lu :
 *
 * - `notify`/`quiet`/`enabled` sont des booléens JSON, un 0/1 est rejeté ;
 * - modifier un dépôt APT est un POST, le PUT du même chemin sert à en ajouter ;
 * - lister les jetons d'API exige `include_tokens` (souligné, pas tiret) ;
 * - la CRUD des jobs sync/verify/prune vit sous /config, /admin ne fait que
 *   lister et déclencher ;
 * - un prune job n'est plus adressé par datastore ;
 * - vider un champ dans un `PUT /config/*` passe par le tableau `delete`, PBS
 *   refusant un `null` sur une propriété typée.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "@/__tests__/setup/route-test"

const { checkPermissionMock, getPbsConnectionByIdMock, pbsFetchMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  getPbsConnectionByIdMock: vi.fn(),
  pbsFetchMock: vi.fn(),
}))

vi.mock("@/lib/demo/demo-api", () => ({ demoResponse: () => null }))

vi.mock("@/lib/proxmox/pbs-client", () => ({
  pbsFetch: (...a: any[]) => pbsFetchMock(...a),
}))

vi.mock("@/lib/connections/getConnection", () => ({
  getPbsConnectionById: (...a: any[]) => getPbsConnectionByIdMock(...a),
  getPbsConnectionByIdUnscoped: (...a: any[]) => getPbsConnectionByIdMock(...a),
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  PERMISSIONS: {
    NODE_MANAGE: "node.manage",
    BACKUP_VIEW: "backup.view",
    BACKUP_JOB_CREATE: "backup.job.create",
    BACKUP_JOB_EDIT: "backup.job.edit",
    BACKUP_JOB_DELETE: "backup.job.delete",
  },
}))

const CONN = { id: "pbs-1", baseUrl: "https://pbs.local:8007" }

/** Dernier appel pbsFetch, décomposé en (path, method, body JSON). */
function lastCall(): { path: string; method: string; body: any } {
  const call = pbsFetchMock.mock.calls.at(-1)

  if (!call) throw new Error("pbsFetch was never called")

  const [, path, init] = call

  return {
    path,
    method: String(init?.method || "GET").toUpperCase(),
    body: init?.body ? JSON.parse(init.body) : undefined,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getPbsConnectionByIdMock.mockResolvedValue(CONN)
  pbsFetchMock.mockResolvedValue([])
})

describe("PBS 4.x — types de paramètres", () => {
  it("le rafraîchissement APT envoie notify/quiet en booléens", async () => {
    const { POST } = await import("./updates/refresh/route")
    const res = await callRoute(POST as any, { params: { id: "pbs-1" }, method: "POST" })

    expect(res.status).toBe(200)

    const { path, method, body } = lastCall()

    expect(path).toBe("/nodes/localhost/apt/update")
    expect(method).toBe("POST")
    expect(body).toEqual({ notify: false, quiet: true })
  })

  it("l'activation d'un dépôt est un POST avec un enabled booléen", async () => {
    const { POST } = await import("./repositories/route")
    const res = await callRoute(POST as any, {
      params: { id: "pbs-1" },
      body: { op: "toggle", path: "/etc/apt/sources.list", index: 0, enabled: true, digest: "d1" },
    })

    expect(res.status).toBe(200)

    const { path, method, body } = lastCall()

    expect(path).toBe("/nodes/localhost/apt/repositories")
    expect(method).toBe("POST")
    expect(body).toEqual({
      path: "/etc/apt/sources.list",
      index: 0,
      enabled: true,
      digest: "d1",
    })
  })

  it("l'ajout d'un dépôt reste un PUT porté par handle", async () => {
    const { POST } = await import("./repositories/route")
    const res = await callRoute(POST as any, {
      params: { id: "pbs-1" },
      body: { op: "add", handle: "no-subscription" },
    })

    expect(res.status).toBe(200)

    const { path, method, body } = lastCall()

    expect(path).toBe("/nodes/localhost/apt/repositories")
    expect(method).toBe("PUT")
    expect(body).toEqual({ handle: "no-subscription" })
  })
})

describe("PBS 4.x — jetons d'API", () => {
  it("liste les utilisateurs avec include_tokens", async () => {
    pbsFetchMock.mockResolvedValue([{ userid: "root@pam", tokens: [{ tokenid: "pxc" }] }])

    const { GET } = await import("./access/users/route")
    const res = await callRoute(GET as any, { params: { id: "pbs-1" } })

    expect(res.status).toBe(200)
    expect(lastCall().path).toBe("/access/users?include_tokens=1")

    const payload = await res.json()

    expect(payload.data[0].tokens).toEqual([{ tokenid: "pxc" }])
  })
})

describe("PBS 4.x — CRUD des jobs sous /config", () => {
  it("crée un sync job sur /config/sync", async () => {
    const { POST } = await import("./jobs/sync/route")
    const res = await callRoute(POST as any, {
      params: { id: "pbs-1" },
      body: { id: "s1", store: "ds1", remote: "r1", remoteStore: "rds1", removeVanished: 1 },
    })

    expect(res.status).toBe(200)

    const { path, method, body } = lastCall()

    expect(path).toBe("/config/sync")
    expect(method).toBe("POST")
    expect(body["remote-store"]).toBe("rds1")
    expect(body["remove-vanished"]).toBe(true)
  })

  it("met à jour un sync job sur /config/sync/{id} et efface via delete", async () => {
    const { PUT } = await import("./jobs/sync/[jobId]/route")
    const res = await callRoute(PUT as any, {
      params: { id: "pbs-1", jobId: "s1" },
      method: "PUT",
      body: { schedule: "daily", ns: "", comment: "", disable: 0 },
    })

    expect(res.status).toBe(200)

    const { path, method, body } = lastCall()

    expect(path).toBe("/config/sync/s1")
    expect(method).toBe("PUT")
    expect(body.schedule).toBe("daily")
    expect(body.disable).toBe(false)
    expect(body.delete).toEqual(expect.arrayContaining(["ns", "comment"]))
    expect(body).not.toHaveProperty("ns")
    expect(JSON.stringify(body)).not.toContain("null")
  })

  it("supprime un sync job sur /config/sync/{id}", async () => {
    const { DELETE } = await import("./jobs/sync/[jobId]/route")
    const res = await callRoute(DELETE as any, {
      params: { id: "pbs-1", jobId: "s1" },
      method: "DELETE",
    })

    expect(res.status).toBe(200)
    expect(lastCall().path).toBe("/config/sync/s1")
    expect(lastCall().method).toBe("DELETE")
  })

  it("crée un verify job sur /config/verify avec ignore-verified booléen", async () => {
    const { POST } = await import("./jobs/verify/route")
    const res = await callRoute(POST as any, {
      params: { id: "pbs-1" },
      body: { id: "v1", store: "ds1", ignoreVerified: 1, outdatedAfter: "30" },
    })

    expect(res.status).toBe(200)

    const { path, body } = lastCall()

    expect(path).toBe("/config/verify")
    expect(body["ignore-verified"]).toBe(true)
    expect(body["outdated-after"]).toBe(30)
  })

  it("met à jour un verify job sur /config/verify/{id}", async () => {
    const { PUT } = await import("./jobs/verify/[jobId]/route")
    const res = await callRoute(PUT as any, {
      params: { id: "pbs-1", jobId: "v1" },
      method: "PUT",
      body: { ns: null, schedule: "hourly" },
    })

    expect(res.status).toBe(200)

    const { path, body } = lastCall()

    expect(path).toBe("/config/verify/v1")
    expect(body.delete).toEqual(["ns"])
    expect(body.schedule).toBe("hourly")
  })
})

describe("PBS 4.x — prune jobs hors du datastore", () => {
  it("crée un prune job sur /config/prune", async () => {
    const { POST } = await import("./jobs/prune/route")
    const res = await callRoute(POST as any, {
      params: { id: "pbs-1" },
      body: { id: "p1", store: "ds1", schedule: "daily", keepLast: 3, keepDaily: 0 },
    })

    expect(res.status).toBe(200)

    const { path, method, body } = lastCall()

    expect(path).toBe("/config/prune")
    expect(method).toBe("POST")
    expect(body).toMatchObject({ id: "p1", store: "ds1", schedule: "daily", "keep-last": 3 })
    expect(body).not.toHaveProperty("keep-daily")
  })

  it("refuse une création de prune job sans schedule (obligatoire côté PBS)", async () => {
    const { POST } = await import("./jobs/prune/route")
    const res = await callRoute(POST as any, {
      params: { id: "pbs-1" },
      body: { id: "p1", store: "ds1" },
    })

    expect(res.status).toBe(400)
    expect(pbsFetchMock).not.toHaveBeenCalled()
  })

  it("met à jour un prune job par son seul id, une rétention à 0 étant effacée", async () => {
    const { PUT } = await import("./jobs/prune/[jobId]/route")
    const res = await callRoute(PUT as any, {
      params: { id: "pbs-1", jobId: "p1" },
      method: "PUT",
      body: { keepLast: 5, keepDaily: 0, comment: "nightly" },
    })

    expect(res.status).toBe(200)

    const { path, method, body } = lastCall()

    expect(path).toBe("/config/prune/p1")
    expect(method).toBe("PUT")
    expect(body["keep-last"]).toBe(5)
    expect(body.comment).toBe("nightly")
    expect(body.delete).toEqual(["keep-daily"])
  })

  it("supprime un verify job sur /config/verify/{id}", async () => {
    const { DELETE } = await import("./jobs/verify/[jobId]/route")
    const res = await callRoute(DELETE as any, {
      params: { id: "pbs-1", jobId: "v1" },
      method: "DELETE",
    })

    expect(res.status).toBe(200)
    expect(lastCall().path).toBe("/config/verify/v1")
    expect(lastCall().method).toBe("DELETE")
  })

  it("crée un tape backup job sur /config/tape-backup-job", async () => {
    const { POST } = await import("./jobs/tape/route")
    const res = await callRoute(POST as any, {
      params: { id: "pbs-1" },
      body: { id: "t1", store: "ds1", pool: "pool1", drive: "drive0", ejectMedia: 1 },
    })

    expect(res.status).toBe(200)

    const { path, method, body } = lastCall()

    expect(path).toBe("/config/tape-backup-job")
    expect(method).toBe("POST")
    expect(body).toMatchObject({ id: "t1", pool: "pool1", drive: "drive0", "eject-media": true })
  })

  it("supprime un tape backup job sur /config/tape-backup-job/{id}", async () => {
    const { DELETE } = await import("./jobs/tape/[jobId]/route")
    const res = await callRoute(DELETE as any, {
      params: { id: "pbs-1", jobId: "t1" },
      method: "DELETE",
    })

    expect(res.status).toBe(200)
    expect(lastCall().path).toBe("/config/tape-backup-job/t1")
  })

  it("supprime un prune job sans exiger le datastore", async () => {
    const { DELETE } = await import("./jobs/prune/[jobId]/route")
    const res = await callRoute(DELETE as any, {
      params: { id: "pbs-1", jobId: "p1" },
      method: "DELETE",
    })

    expect(res.status).toBe(200)
    expect(lastCall().path).toBe("/config/prune/p1")
    expect(lastCall().method).toBe("DELETE")
  })
})

describe("PBS 4.x — tape backup jobs", () => {
  it("efface via delete et n'envoie pas de disable (absent du schema PBS)", async () => {
    const { PUT } = await import("./jobs/tape/[jobId]/route")
    const res = await callRoute(PUT as any, {
      params: { id: "pbs-1", jobId: "t1" },
      method: "PUT",
      body: { ns: "", comment: "", ejectMedia: 1, disable: true },
    })

    expect(res.status).toBe(200)

    const { path, body } = lastCall()

    expect(path).toBe("/config/tape-backup-job/t1")
    expect(body["eject-media"]).toBe(true)
    expect(body.delete).toEqual(expect.arrayContaining(["ns", "comment"]))
    expect(body).not.toHaveProperty("disable")
    expect(JSON.stringify(body)).not.toContain("null")
  })
})

describe("PBS 4.x — clients S3", () => {
  it("lit la configuration S3 sur /config/s3", async () => {
    pbsFetchMock.mockResolvedValue([{ id: "minio", endpoint: "s3.local" }])

    const { GET } = await import("./s3-endpoints/route")
    const res = await callRoute(GET as any, { params: { id: "pbs-1" } })

    expect(res.status).toBe(200)
    expect(lastCall().path).toBe("/config/s3")

    const payload = await res.json()

    expect(payload.data).toEqual([{ id: "minio", endpoint: "s3.local" }])
    expect(payload.notSupported).toBeUndefined()
  })
})
