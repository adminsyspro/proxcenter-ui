import { describe, expect, it } from "vitest"

import {
  flagSummaryLabels,
  flagsOnOsd,
  healthDetailMessages,
  hostFlagsForNode,
  normalizeScopedFlags,
  scopedFlagEntries,
  scopedFlagKey,
  withScopedFlag,
} from "./osdFlagsView"

/*
   ui#1164: the helpers behind the flag chips, the per-host list and the
   health detail lines, fed with the maps the flags route serialises.
*/

const HOSTS = { pve3: ["noout"], "pve1.lab.local": ["noin", "noout"] }
const OSDS = { "osd.4": ["nodown"], "osd.10": ["noout"] }

describe("normalizeScopedFlags", () => {
  it("keeps string arrays only, lower-cased, trimmed, deduplicated, dropping empty targets", () => {
    expect(normalizeScopedFlags({ pve3: [" NoOut ", "noout", 3, ""], pve1: [], pve2: "noout" })).toEqual({ pve3: ["noout"] })
  })

  it.each([null, undefined, [], "x", 4])("answers an empty map for %j", input => {
    expect(normalizeScopedFlags(input)).toEqual({})
  })
})

describe("withScopedFlag", () => {
  it("adds once, removes, and forgets a target left without flags, without mutating the input", () => {
    const base = { pve3: ["noout"] }
    expect(withScopedFlag(base, "pve3", "noout", true)).toEqual({ pve3: ["noout"] })
    expect(withScopedFlag(base, "pve3", "noin", true)).toEqual({ pve3: ["noout", "noin"] })
    expect(withScopedFlag(base, "pve1", "noup", true)).toEqual({ pve3: ["noout"], pve1: ["noup"] })
    expect(withScopedFlag(base, "pve3", "noout", false)).toEqual({})
    expect(withScopedFlag(base, "pve9", "noout", false)).toEqual({ pve3: ["noout"] })
    expect(base).toEqual({ pve3: ["noout"] })
  })
})

describe("hostFlagsForNode", () => {
  it("matches the CRUSH host exactly, by case, or on the first FQDN label, either way round", () => {
    expect(hostFlagsForNode(HOSTS, "pve3")).toEqual({ host: "pve3", flags: ["noout"] })
    expect(hostFlagsForNode(HOSTS, "PVE3")).toEqual({ host: "pve3", flags: ["noout"] })
    expect(hostFlagsForNode(HOSTS, "pve3.lab.local")).toEqual({ host: "pve3", flags: ["noout"] })
    expect(hostFlagsForNode(HOSTS, "pve1")).toEqual({ host: "pve1.lab.local", flags: ["noin", "noout"] })
  })

  it("answers no host for an unknown node or none at all", () => {
    expect(hostFlagsForNode(HOSTS, "pve2")).toEqual({ host: null, flags: [] })
    expect(hostFlagsForNode(HOSTS, "")).toEqual({ host: null, flags: [] })
    expect(hostFlagsForNode(HOSTS, null)).toEqual({ host: null, flags: [] })
  })
})

describe("scopedFlagEntries", () => {
  it("lists hosts first then OSDs in natural order, each one's flags in the banner order", () => {
    expect(scopedFlagEntries(HOSTS, OSDS)).toEqual([
      { target: "pve1.lab.local", flag: "noout", scope: "host" },
      { target: "pve1.lab.local", flag: "noin", scope: "host" },
      { target: "pve3", flag: "noout", scope: "host" },
      { target: "osd.4", flag: "nodown", scope: "osd" },
      { target: "osd.10", flag: "noout", scope: "osd" },
    ])
    expect(scopedFlagEntries({}, {})).toEqual([])
  })
})

describe("flagsOnOsd", () => {
  it("gives the OSD its own flags first, then the flags of its host it does not already carry", () => {
    expect(flagsOnOsd(10, "pve3", OSDS, HOSTS)).toEqual([{ target: "osd.10", flag: "noout", scope: "osd" }])
    expect(flagsOnOsd(4, "pve3", OSDS, HOSTS)).toEqual([
      { target: "osd.4", flag: "nodown", scope: "osd" },
      { target: "pve3", flag: "noout", scope: "host" },
    ])
    expect(flagsOnOsd("osd.2", "pve1", OSDS, HOSTS)).toEqual([
      { target: "pve1.lab.local", flag: "noin", scope: "host" },
      { target: "pve1.lab.local", flag: "noout", scope: "host" },
    ])
  })

  it("answers nothing for an OSD on a host without flags, or without a host", () => {
    expect(flagsOnOsd(0, "pve2", OSDS, HOSTS)).toEqual([])
    expect(flagsOnOsd(0, undefined, OSDS, HOSTS)).toEqual([])
    expect(flagsOnOsd(0, "unknown", {}, {})).toEqual([])
  })
})

describe("flagSummaryLabels and scopedFlagKey", () => {
  it("puts the cluster flags first, then `target: flag`", () => {
    expect(flagSummaryLabels(["norebalance"], { pve3: ["noout"] }, { "osd.4": ["nodown"] })).toEqual(["norebalance", "pve3: noout", "osd.4: nodown"])
    expect(flagSummaryLabels([], {}, {})).toEqual([])
    expect(scopedFlagKey("pve3", "noout")).toBe("pve3:noout")
  })
})

describe("healthDetailMessages", () => {
  it("reads PVE's [{ message }] entries and plain strings, trimmed, skipping blanks", () => {
    expect(healthDetailMessages([{ message: "host pve3 has flags noout" }, "  osd.4 has flags noout ", { message: "" }, {}, null])).toEqual([
      "host pve3 has flags noout",
      "osd.4 has flags noout",
    ])
  })

  it.each([undefined, null, "x", {}])("answers nothing for %j", input => {
    expect(healthDetailMessages(input)).toEqual([])
  })
})
