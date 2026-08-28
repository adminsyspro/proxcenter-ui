/**
 * ui#817 — PBS refuse un `null` sur une propriété typée : effacer un champ
 * dans un `PUT /config/*` passe par le tableau `delete`. Ces tests épinglent
 * la convention du constructeur et des normalisateurs de champ.
 */
import { describe, expect, it } from "vitest"

import {
  optionalBoolean,
  optionalNumber,
  optionalPositiveNumber,
  pbsConfigUpdate,
} from "./pbsConfigUpdate"

describe("pbsConfigUpdate", () => {
  it("ne transmet pas un champ laissé à undefined", () => {
    const update = pbsConfigUpdate()

    update.set("ns", undefined)

    expect(update.build()).toEqual({})
  })

  it("met un null et une chaîne vide dans delete, jamais dans le corps", () => {
    const update = pbsConfigUpdate()

    update.set("ns", "")
    update.set("comment", null)

    const body = update.build()

    expect(body).toEqual({ delete: ["ns", "comment"] })
    expect(JSON.stringify(body)).not.toContain("null")
  })

  it("conserve false et 0, qui sont des valeurs et non des effacements", () => {
    const update = pbsConfigUpdate()

    update.set("disable", false)
    update.set("max-depth", 0)

    expect(update.build()).toEqual({ disable: false, "max-depth": 0 })
  })

  it("mélange les champs transmis et les champs effacés", () => {
    const update = pbsConfigUpdate()

    update.set("schedule", "daily")
    update.set("ns", "")

    expect(update.build()).toEqual({ schedule: "daily", delete: ["ns"] })
  })

  it("rend un objet neuf à chaque build", () => {
    const update = pbsConfigUpdate()

    update.set("schedule", "daily")

    expect(update.build()).not.toBe(update.build())
    expect(update.build()).toEqual(update.build())
  })
})

describe("normalisateurs de champ", () => {
  it("optionalBoolean laisse passer undefined et convertit le reste", () => {
    expect(optionalBoolean(undefined)).toBeUndefined()
    expect(optionalBoolean(1)).toBe(true)
    expect(optionalBoolean(0)).toBe(false)
    expect(optionalBoolean(true)).toBe(true)
    expect(optionalBoolean(null)).toBe(false)
  })

  it("optionalNumber distingue non transmis, effacement et valeur", () => {
    expect(optionalNumber(undefined)).toBeUndefined()
    expect(optionalNumber(null)).toBeNull()
    expect(optionalNumber("")).toBeNull()
    expect(optionalNumber("30")).toBe(30)
    expect(optionalNumber(0)).toBe(0)
  })

  it("optionalPositiveNumber efface une rétention à zéro ou négative", () => {
    expect(optionalPositiveNumber(undefined)).toBeUndefined()
    expect(optionalPositiveNumber(null)).toBeNull()
    expect(optionalPositiveNumber("")).toBeNull()
    expect(optionalPositiveNumber(0)).toBeNull()
    expect(optionalPositiveNumber(-2)).toBeNull()
    expect(optionalPositiveNumber("7")).toBe(7)
  })
})
