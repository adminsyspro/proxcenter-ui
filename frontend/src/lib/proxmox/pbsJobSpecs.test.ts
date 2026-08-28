/**
 * ui#817 — les quatre descriptions de job PBS. Ce sont des fonctions pures :
 * elles traduisent le corps reçu de l'UI en corps PBS, et c'est là que vivent
 * les règles de type du schéma 4.x (booléens réels, entiers, champs
 * obligatoires non effaçables, rétention à zéro).
 */
import { describe, expect, it } from "vitest"

import { PbsJobRequestError, PRUNE_JOB, SYNC_JOB, TAPE_JOB, VERIFY_JOB } from "./pbsJobSpecs"

/** Corps de création minimal accepté par chaque famille. */
const MINIMAL_CREATE: Array<[typeof SYNC_JOB, Record<string, unknown>]> = [
  [SYNC_JOB, { id: "j1", store: "ds1", remote: "r1", remoteStore: "rds1" }],
  [VERIFY_JOB, { id: "j1", store: "ds1" }],
  [PRUNE_JOB, { id: "j1", store: "ds1", schedule: "daily" }],
  [TAPE_JOB, { id: "j1", store: "ds1", pool: "pool1", drive: "drive0" }],
]

describe("création : champs obligatoires", () => {
  for (const [spec, minimal] of MINIMAL_CREATE) {
    it(`${spec.label} : le corps minimal passe et porte l'id`, () => {
      expect(spec.buildCreate(minimal)).toMatchObject({ id: "j1", store: "ds1" })
    })

    for (const missing of Object.keys(minimal)) {
      it(`${spec.label} : refuse un corps sans ${missing}`, () => {
        const body = { ...minimal, [missing]: undefined }

        expect(() => spec.buildCreate(body)).toThrow(PbsJobRequestError)
        expect(() => spec.buildCreate(body)).toThrow(/is required$/)
      })
    }

    it(`${spec.label} : ns, comment et max-depth ne partent que renseignés`, () => {
      expect(spec.buildCreate({ ...minimal, ns: "", comment: "" })).not.toHaveProperty("ns")
      expect(spec.buildCreate({ ...minimal, ns: "team", comment: "c", maxDepth: "2" })).toMatchObject(
        { ns: "team", comment: "c", "max-depth": 2 }
      )
    })
  }
})

describe("création : champs propres à chaque famille", () => {
  it("SYNC_JOB mappe remote-store, remote-ns et remove-vanished", () => {
    expect(
      SYNC_JOB.buildCreate({
        id: "j1",
        store: "ds1",
        remote: "r1",
        remoteStore: "rds1",
        remoteNs: "team",
        schedule: "daily",
        removeVanished: 1,
      })
    ).toEqual({
      id: "j1",
      store: "ds1",
      remote: "r1",
      "remote-store": "rds1",
      "remote-ns": "team",
      schedule: "daily",
      "remove-vanished": true,
    })
  })

  it("VERIFY_JOB convertit ignore-verified et outdated-after", () => {
    expect(
      VERIFY_JOB.buildCreate({ id: "j1", store: "ds1", ignoreVerified: 0, outdatedAfter: "30" })
    ).toEqual({ id: "j1", store: "ds1", "ignore-verified": false, "outdated-after": 30 })
  })

  it("PRUNE_JOB ne garde que les rétentions strictement positives", () => {
    const params = PRUNE_JOB.buildCreate({
      id: "j1",
      store: "ds1",
      schedule: "daily",
      keepLast: 3,
      keepHourly: 0,
      keepDaily: "7",
      keepWeekly: null,
      keepYearly: -1,
      disable: 1,
    })

    expect(params).toEqual({
      id: "j1",
      store: "ds1",
      schedule: "daily",
      disable: true,
      "keep-last": 3,
      "keep-daily": 7,
    })
  })

  it("TAPE_JOB ne transmet ses drapeaux que lorsqu'ils sont vrais", () => {
    const minimal = { id: "j1", store: "ds1", pool: "pool1", drive: "drive0" }

    expect(TAPE_JOB.buildCreate({ ...minimal, ejectMedia: 0, latestOnly: false })).toEqual(minimal)
    expect(
      TAPE_JOB.buildCreate({
        ...minimal,
        notifyUser: "root@pam",
        ejectMedia: true,
        exportMediaSet: 1,
        latestOnly: "yes",
      })
    ).toMatchObject({
      "notify-user": "root@pam",
      "eject-media": true,
      "export-media-set": true,
      "latest-only": true,
    })
  })
})

describe("collections /config des quatre jobs", () => {
  it("pointe la collection et le libellé de chaque famille", () => {
    expect([SYNC_JOB.configPath, SYNC_JOB.label]).toEqual(["/config/sync", "Sync job"])
    expect([VERIFY_JOB.configPath, VERIFY_JOB.label]).toEqual(["/config/verify", "Verify job"])
    expect([PRUNE_JOB.configPath, PRUNE_JOB.label]).toEqual(["/config/prune", "Prune job"])
    expect([TAPE_JOB.configPath, TAPE_JOB.label]).toEqual([
      "/config/tape-backup-job",
      "Tape backup job",
    ])
  })
})

describe("champs partagés", () => {
  for (const spec of [SYNC_JOB, VERIFY_JOB, PRUNE_JOB, TAPE_JOB]) {
    it(`${spec.label} : un corps vide ne transmet rien`, () => {
      expect(spec.buildUpdate({})).toEqual({})
    })

    it(`${spec.label} : ns et comment vides passent par delete`, () => {
      const body = spec.buildUpdate({ ns: "", comment: "" })

      expect(body.delete).toEqual(expect.arrayContaining(["ns", "comment"]))
      expect(JSON.stringify(body)).not.toContain("null")
    })

    it(`${spec.label} : max-depth arrive en entier`, () => {
      expect(spec.buildUpdate({ maxDepth: "3" })).toMatchObject({ "max-depth": 3 })
    })

    it(`${spec.label} : un store vide ne supprime pas le champ obligatoire`, () => {
      const body = spec.buildUpdate({ store: "" })

      expect(body).not.toHaveProperty("store")
      expect(body.delete ?? []).not.toContain("store")
    })
  }
})

describe("SYNC_JOB", () => {
  it("mappe les noms PBS et convertit remove-vanished en booléen", () => {
    expect(
      SYNC_JOB.buildUpdate({
        store: "ds1",
        remote: "r1",
        remoteStore: "rds1",
        remoteNs: "team-a",
        schedule: "daily",
        removeVanished: 1,
        disable: 0,
      })
    ).toEqual({
      store: "ds1",
      remote: "r1",
      "remote-store": "rds1",
      "remote-ns": "team-a",
      schedule: "daily",
      "remove-vanished": true,
      disable: false,
    })
  })

  it("efface un schedule et un remote-ns vidés", () => {
    const body = SYNC_JOB.buildUpdate({ schedule: "", remoteNs: "" })

    expect(body.delete).toEqual(expect.arrayContaining(["remote-ns", "schedule"]))
  })

  it("ne supprime pas remote-store, obligatoire côté PBS", () => {
    const body = SYNC_JOB.buildUpdate({ remoteStore: "", remote: "" })

    expect(body.delete ?? []).not.toContain("remote-store")
    expect(body.delete ?? []).not.toContain("remote")
  })
})

describe("VERIFY_JOB", () => {
  it("convertit ignore-verified en booléen et outdated-after en entier", () => {
    expect(
      VERIFY_JOB.buildUpdate({ store: "ds1", ignoreVerified: 1, outdatedAfter: "30" })
    ).toEqual({ store: "ds1", "ignore-verified": true, "outdated-after": 30 })
  })

  it("efface outdated-after vidé", () => {
    expect(VERIFY_JOB.buildUpdate({ outdatedAfter: "" }).delete).toEqual(["outdated-after"])
  })
})

describe("PRUNE_JOB", () => {
  it("accepte datastore comme alias de store", () => {
    expect(PRUNE_JOB.buildUpdate({ datastore: "ds1" })).toMatchObject({ store: "ds1" })
    expect(PRUNE_JOB.buildUpdate({ store: "ds1", datastore: "ds2" })).toMatchObject({
      store: "ds1",
    })
  })

  it("garde une rétention positive et efface celle à zéro", () => {
    const body = PRUNE_JOB.buildUpdate({
      keepLast: 5,
      keepHourly: 0,
      keepDaily: "7",
      keepWeekly: null,
      keepMonthly: "",
      keepYearly: 2,
    })

    expect(body).toMatchObject({ "keep-last": 5, "keep-daily": 7, "keep-yearly": 2 })
    expect(body.delete).toEqual(
      expect.arrayContaining(["keep-hourly", "keep-weekly", "keep-monthly"])
    )
    expect(JSON.stringify(body)).not.toContain("null")
  })

  it("ne supprime pas un schedule vidé, il est obligatoire", () => {
    const body = PRUNE_JOB.buildUpdate({ schedule: "" })

    expect(body).not.toHaveProperty("schedule")
    expect(body.delete ?? []).not.toContain("schedule")
  })
})

describe("TAPE_JOB", () => {
  it("convertit ses trois drapeaux en booléens", () => {
    expect(
      TAPE_JOB.buildUpdate({
        pool: "pool1",
        drive: "drive0",
        notifyUser: "root@pam",
        ejectMedia: 1,
        exportMediaSet: 0,
        latestOnly: true,
      })
    ).toEqual({
      pool: "pool1",
      drive: "drive0",
      "notify-user": "root@pam",
      "eject-media": true,
      "export-media-set": false,
      "latest-only": true,
    })
  })

  it("n'envoie jamais disable, absent du schéma d'un tape backup job", () => {
    const body = TAPE_JOB.buildUpdate({ disable: true })

    expect(body).not.toHaveProperty("disable")
    expect(body.delete ?? []).not.toContain("disable")
  })

  it("ne supprime ni pool ni drive vidés, ils sont obligatoires", () => {
    const body = TAPE_JOB.buildUpdate({ pool: "", drive: "" })

    expect(body.delete ?? []).not.toContain("pool")
    expect(body.delete ?? []).not.toContain("drive")
  })
})
